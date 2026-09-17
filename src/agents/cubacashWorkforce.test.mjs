/**
 * Tests for the MY CUBA CASH workforce.
 * node:test with fake in-memory providerStore + fake corridorEngine doubles.
 * No real-world data — fixtures only ("Fixture Provider", "Fixtureland").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkforce,
  getWorkforceSummary,
  hasAgentNote,
  WORKFORCE_NOTE,
  WORKFORCE_LOG_KEY,
} from './cubacashWorkforce.js';

function makeStore(seedProviders = [], seedCorridors = []) {
  const providers = new Map();
  const corridors = new Map();
  let seq = 0;
  let cseq = 0;
  const store = {
    getAll() {
      return [...providers.values()];
    },
    get(id) {
      return providers.get(id);
    },
    update(id, patch) {
      const current = providers.get(id);
      if (!current) throw new Error(`unknown provider ${id}`);
      providers.set(id, { ...current, ...patch });
    },
    add(provider) {
      const id = provider.id || `provider-${++seq}`;
      providers.set(id, { notes: [], ...provider, id });
      return id;
    },
    listCorridors() {
      return [...corridors.values()];
    },
    getCorridor(id) {
      return corridors.get(id);
    },
    updateCorridor(id, patch) {
      const current = corridors.get(id);
      if (!current) throw new Error(`unknown corridor ${id}`);
      corridors.set(id, { ...current, ...patch });
    },
    addCorridor(corridor) {
      const id = corridor.id || `corridor-${++cseq}`;
      corridors.set(id, { notes: [], ...corridor, id });
      return id;
    },
  };
  for (const p of seedProviders) store.add(p);
  for (const c of seedCorridors) store.addCorridor(c);
  return store;
}

/** Provider store without any corridor surface (defensive path). */
function makeProviderOnlyStore(seedProviders = []) {
  const full = makeStore(seedProviders);
  return {
    getAll: full.getAll,
    get: full.get,
    update: full.update,
    add: full.add,
  };
}

function makeEngine(overrides = {}) {
  return {
    corridorMath: ({ sendAmount, fee, fxRate }) => ({
      fee,
      netBeforeFx: sendAmount - fee,
      received: (sendAmount - fee) * fxRate,
      effectiveFeePct: sendAmount > 0 ? (fee / sendAmount) * 100 : 0,
    }),
    compareProviders: () => [],
    ...overrides,
  };
}

function throwingEngine() {
  const boom = () => {
    throw new Error('engine boom');
  };
  return { corridorMath: boom, compareProviders: boom };
}

function provider(store, overrides = {}) {
  return store.add({
    name: 'Fixture Provider',
    channels: ['whatsapp'],
    coverageCountries: ['Cuba'],
    feeModel: { type: 'percentage', pct: 1.75, flat: 0, min: 1, max: 12 },
    status: 'live',
    ...overrides,
  });
}

function corridor(store, overrides = {}) {
  return store.addCorridor({
    providerId: null,
    label: 'US → Cuba',
    sendAmount: 100,
    fee: 1.75,
    fxRate: 320,
    ...overrides,
  });
}

test('WORKFORCE_NOTE is honest about app-open-only operation', () => {
  assert.match(WORKFORCE_NOTE.es, /mientras la app est/i);
  assert.match(WORKFORCE_NOTE.en, /while the app is open/i);
  assert.ok(typeof WORKFORCE_LOG_KEY === 'string');
  assert.match(WORKFORCE_LOG_KEY, /cubacash/);
});

test('createWorkforce validates its collaborators', () => {
  assert.throws(
    () => createWorkforce({ corridorEngine: makeEngine() }),
    /providerStore/,
  );
  assert.throws(
    () => createWorkforce({ providerStore: makeStore() }),
    /corridorEngine/,
  );
  assert.throws(
    () => createWorkforce({ providerStore: { getAll() {} } }),
    /providerStore/,
  );
  assert.throws(() => getWorkforceSummary({}), /workforce handle/);
});

test('provider-verifier moves candidate→verifying with the manual checklist', () => {
  const store = makeStore();
  const id = provider(store, { status: 'candidate' });
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  const p = store.get(id);
  assert.equal(p.status, 'verifying');
  const note = p.notes.find((n) => n.agent === 'provider-verifier');
  assert.ok(note && note.es && note.en, 'expected a bilingual verifier note');
  assert.match(note.es, /verificación manual/i);
  assert.match(note.es, /No hay verificación automática/);
  assert.match(note.en, /Juan's job/);
  assert.match(note.en, /Only Juan decides/);
  const event = wf
    .getActivityLog()
    .find((e) => e.kind === 'verifying' && e.agent === 'provider-verifier');
  assert.ok(event, 'expected a "verifying" event');
  assert.equal(event.providerId, id);
  wf.destroy();
});

test('provider-verifier flags candidates missing data and never invents it', () => {
  const store = makeStore();
  const id = provider(store, { status: 'candidate', name: '', channels: [] });
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  const p = store.get(id);
  assert.equal(
    p.status,
    'candidate',
    'stays — never auto-advances, never deletes',
  );
  assert.equal(store.getAll().length, 1);
  assert.equal(p.name, '', 'agent must never invent a name');
  assert.deepEqual(p.channels, [], 'agent must never invent a channel');
  const note = p.notes.find((n) => n.agent === 'provider-verifier');
  assert.ok(note && note.es && note.en);
  assert.match(note.es, /nombre/);
  assert.match(note.es, /canal/);
  assert.match(note.en, /Nothing is invented/);
  const event = wf
    .getActivityLog()
    .find((e) => e.kind === 'flagged' && e.agent === 'provider-verifier');
  assert.ok(event, 'expected a verifier "flagged" event');
  wf.destroy();
});

test('dedup: repeated passes never write a second own-note (no infinite notes)', () => {
  const store = makeStore();
  // verifier missing-data path keeps the provider in candidate, so the
  // second pass would re-flag it without the dedup rule.
  provider(store, { status: 'candidate', name: '', channels: [] });
  // fee-watcher path: live + undisclosed.
  provider(store, {
    name: 'Fixture Undisclosed',
    feeModel: { type: 'undisclosed' },
  });
  // intake path: live providers get drafts.
  provider(store, { name: 'Fixture Live' });
  corridor(store, { providerId: null });
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  wf.processOnce();
  for (const p of store.getAll()) {
    for (const agentId of [
      'provider-verifier',
      'fee-watcher',
      'intake-helper',
    ]) {
      const own = p.notes.filter((n) => n.agent === agentId);
      assert.ok(
        own.length <= 1,
        `expected ≤1 note from ${agentId} on ${p.id}, got ${own.length}`,
      );
    }
  }
  for (const c of store.listCorridors()) {
    const own = c.notes.filter((n) => n.agent === 'corridor-analyst');
    assert.ok(own.length <= 1, `expected ≤1 analyst note on ${c.id}`);
  }
  // hasAgentNote is the exported dedup helper.
  const p = store.getAll()[0];
  assert.equal(hasAgentNote(p, 'provider-verifier'), true);
  assert.equal(hasAgentNote(p, 'intake-helper'), false);
  assert.equal(hasAgentNote(null, 'provider-verifier'), false);
  assert.equal(hasAgentNote({ notes: null }, 'provider-verifier'), false);
  wf.destroy();
});

test('fee-watcher flags undisclosed fee models and never invents fees', () => {
  const store = makeStore();
  const id = provider(store, { feeModel: { type: 'undisclosed' } });
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  const p = store.get(id);
  const note = p.notes.find((n) => n.agent === 'fee-watcher');
  assert.ok(note && note.es && note.en, 'expected a bilingual fee note');
  assert.match(note.es, /sin declarar/);
  assert.match(note.en, /never invented/);
  assert.match(note.en, /manually/);
  assert.deepEqual(
    p.feeModel,
    { type: 'undisclosed' },
    'agent must never invent a fee model',
  );
  const event = wf
    .getActivityLog()
    .find((e) => e.kind === 'flagged' && e.agent === 'fee-watcher');
  assert.ok(event, 'expected a fee-watcher "flagged" event');
  wf.destroy();
});

test('fee-watcher stays quiet for providers with a declared fee model', () => {
  const store = makeStore();
  provider(store); // pct model, declared
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  assert.ok(
    !wf.getActivityLog().some((e) => e.agent === 'fee-watcher'),
    'no fee-watcher activity for declared models',
  );
  wf.destroy();
});

test('corridor-analyst writes a bilingual memo with defensive engine math', () => {
  const store = makeStore();
  const cid = corridor(store, {
    label: 'US → Cuba',
    sendAmount: 100,
    fee: 1.75,
    fxRate: 320,
  });
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  const c = store.getCorridor(cid);
  const note = c.notes.find((n) => n.agent === 'corridor-analyst');
  assert.ok(note && note.es && note.en, 'expected a bilingual corridor memo');
  // 100 - 1.75 = 98.25 net; 98.25 * 320 = 31440 received; 1.75% effective.
  assert.match(note.en, /\$98\.25/, 'net before FX');
  assert.match(note.en, /\$31,440\.00/, 'received amount');
  assert.match(note.en, /1\.75%/, 'effective fee pct');
  assert.match(note.en, /US → Cuba/);
  assert.match(note.en, /manually by Juan/);
  const event = wf
    .getActivityLog()
    .find((e) => e.kind === 'memo' && e.agent === 'corridor-analyst');
  assert.ok(event, 'expected an analyst "memo" event');
  wf.destroy();
});

test('corridor-analyst reads the real engine key shape (netSend/receivedAmount)', () => {
  const store = makeStore();
  const cid = corridor(store, {
    label: 'US → Cuba',
    sendAmount: 100,
    fee: 1.75,
    fxRate: 320,
  });
  // Mirrors the real corridorEngine.corridorMath return shape.
  const realShapeEngine = {
    corridorMath: ({ sendAmount, fee, fxRate }) => ({
      sendAmount,
      fee,
      netSend: sendAmount - fee,
      fxRate,
      receivedAmount: (sendAmount - fee) * fxRate,
      effectiveFeePct: (fee / sendAmount) * 100,
    }),
  };
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: realShapeEngine,
  });
  wf.processOnce();
  const note = store
    .getCorridor(cid)
    .notes.find((n) => n.agent === 'corridor-analyst');
  assert.ok(note, 'expected the memo from the real engine shape');
  assert.match(note.en, /\$98\.25/);
  assert.match(note.en, /\$31,440\.00/);
  wf.destroy();
});

test('corridor-analyst treats null engine fields as unknown, never inventing', () => {
  const store = makeStore();
  const cid = corridor(store, {
    label: 'US → Cuba',
    sendAmount: 100,
    fee: 0,
    fxRate: 320,
  });
  // Real engine returns nulls for undisclosed fees — the memo must say
  // "unknown", not invent a number.
  const nullFeeEngine = {
    corridorMath: () => ({
      sendAmount: 100,
      fee: null,
      netSend: null,
      fxRate: 320,
      receivedAmount: null,
      effectiveFeePct: null,
    }),
  };
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: nullFeeEngine,
  });
  wf.processOnce();
  const note = store
    .getCorridor(cid)
    .notes.find((n) => n.agent === 'corridor-analyst');
  assert.ok(note, 'expected a memo even with null fee fields');
  assert.match(note.en, /unknown \(not invented\)/);
  wf.destroy();
});

test('corridor-analyst writes a no-invention note when the FX rate is missing', () => {
  const store = makeStore();
  const cid = corridor(store, { fxRate: 0 });
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  const c = store.getCorridor(cid);
  const note = c.notes.find((n) => n.agent === 'corridor-analyst');
  assert.ok(note && note.es && note.en);
  assert.match(note.en, /no FX rate/i);
  assert.match(note.en, /Nothing is invented/);
  const event = wf
    .getActivityLog()
    .find((e) => e.kind === 'flagged' && e.agent === 'corridor-analyst');
  assert.ok(event, 'expected an analyst "flagged" event for missing rate');
  wf.destroy();
});

test('corridor-analyst falls back defensively when the engine throws', () => {
  const store = makeStore();
  const cid = corridor(store, {
    label: 'ES → Cuba',
    sendAmount: 200,
    fee: 4,
    fxRate: 350,
  });
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: throwingEngine(),
  });
  wf.processOnce();
  const c = store.getCorridor(cid);
  const note = c.notes.find((n) => n.agent === 'corridor-analyst');
  assert.ok(note, 'expected a defensive memo even when the engine fails');
  // fallback: 200 - 4 = 196 net; 196 * 350 = 68600 received; 2.00% fee.
  assert.match(note.en, /\$196\.00/);
  assert.match(note.en, /\$68,600\.00/);
  assert.match(note.en, /2\.00%/);
  wf.destroy();
});

test('corridor-analyst falls back to the provider record when the store has no corridor surface', () => {
  const store = makeProviderOnlyStore();
  const pid = provider(store, { name: 'Fixture Corridor Co' });
  // Corridor surface absent: the analyst has nothing to do, and must not
  // throw or write phantom notes.
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  const p = store.get(pid);
  assert.ok(
    !p.notes.some((n) => n.agent === 'corridor-analyst'),
    'no corridor surface → no corridor notes',
  );
  wf.destroy();
});

test('corridor-analyst attaches to the providerId provider when corridors cannot be updated', () => {
  const store = makeStore();
  const pid = provider(store, { name: 'Fixture Carrier' });
  // Emulate a provider-only store that still surfaces corridors via the
  // plain update()/get() on provider ids only.
  const corridors = [
    { id: 'corr-x', providerId: pid, sendAmount: 50, fxRate: 320 },
  ];
  const thin = {
    getAll: store.getAll,
    get: store.get,
    update: store.update,
    listCorridors: () => corridors,
  };
  const wf = createWorkforce({
    providerStore: thin,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  const p = store.get(pid);
  const note = p.notes.find((n) => n.agent === 'corridor-analyst');
  assert.ok(note, 'analyst note falls back to the corridor provider record');
  assert.match(note.en, /corr-x/);
  wf.destroy();
});

test('intake-helper drafts ONE internal outreach message per live provider, labeled NOT sent', () => {
  const store = makeStore();
  const id = provider(store, { name: 'Fixture Outreach Co' });
  provider(store, { name: 'Fixture Candidate', status: 'candidate' });
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  const p = store.get(id);
  const draft = p.notes.find((n) => n.agent === 'intake-helper');
  assert.ok(draft && draft.es && draft.en, 'expected a bilingual draft');
  assert.match(draft.es, /Borrador interno — NO enviado/);
  assert.match(draft.en, /Internal draft — NOT sent/);
  assert.match(draft.en, /zero customers and zero transactions/);
  assert.match(draft.en, /v0\.9/);
  assert.match(draft.en, /NOT sent automatically/);
  // The candidate provider gets no outreach draft.
  for (const other of store.getAll()) {
    if (other.id === id) continue;
    assert.ok(
      !other.notes.some((n) => n.agent === 'intake-helper'),
      'drafts only for live providers',
    );
  }
  const event = wf
    .getActivityLog()
    .find((e) => e.kind === 'draft' && e.agent === 'intake-helper');
  assert.ok(event, 'expected an intake-helper "draft" event');
  assert.match(event.en, /NOT sent/);
  wf.destroy();
});

test('processOnce emits bilingual activity events and persists them', () => {
  const store = makeStore();
  provider(store, { status: 'candidate' });
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  const seen = [];
  const off = wf.onActivity((e) => seen.push(e));
  wf.processOnce();
  off();
  assert.ok(seen.length > 0, 'expected activity events');
  for (const e of seen) {
    assert.ok(
      e.t && e.agent && e.kind && e.es && e.en,
      `event missing fields: ${JSON.stringify(e)}`,
    );
  }
  assert.ok(wf.getActivityLog(10).length > 0);
  wf.destroy();
});

test('activity log caps at 300 entries', () => {
  const store = makeStore();
  for (let i = 0; i < 310; i++) {
    provider(store, { name: `Fixture Live ${i}` });
  }
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.processOnce();
  assert.equal(wf.getActivityLog().length, 300);
  wf.destroy();
});

test('getSummary reports running, agents, note, and queueDepth (candidate|verifying)', () => {
  const store = makeStore();
  provider(store, { status: 'candidate', name: 'Fixture A' });
  provider(store, { status: 'verifying', name: 'Fixture B' });
  provider(store, { status: 'live', name: 'Fixture C' });
  provider(store, { status: 'archived', name: 'Fixture D' }); // not in queue
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  const s1 = wf.getSummary();
  assert.equal(s1.running, false);
  assert.equal(s1.queueDepth, 2);
  assert.equal(s1.agents.length, 4);
  assert.deepEqual(
    s1.agents.map((a) => a.id),
    ['provider-verifier', 'fee-watcher', 'corridor-analyst', 'intake-helper'],
  );
  for (const a of s1.agents) {
    assert.ok(['idle', 'working', 'paused'].includes(a.status));
  }
  assert.ok(
    wf.agents.every((a) => a.name.es && a.name.en),
    'role defs carry bilingual names',
  );
  assert.ok(s1.note.es && s1.note.en, 'summary carries the workforce note');
  // standalone form works too
  const s2 = getWorkforceSummary(wf);
  assert.equal(s2.queueDepth, 2);
  wf.processOnce();
  const s3 = wf.getSummary();
  assert.ok(
    s3.agents.find((a) => a.id === 'provider-verifier').lastAction,
    'verifier should have a lastAction',
  );
  wf.destroy();
});

test('setProviders/getProviders mirror the injected list', () => {
  const store = makeStore();
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.setProviders([{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(
    wf.getProviders().map((p) => p.id),
    ['a', 'b'],
  );
  wf.setProviders(null);
  assert.deepEqual(wf.getProviders(), []);
  wf.destroy();
});

test('start/pause/resume control the scheduler', async () => {
  const store = makeStore();
  provider(store, { status: 'candidate' });
  // fast timers for the test
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
    tickMs: 50,
    staggerMs: 10,
  });
  assert.equal(wf.running, false);
  wf.start();
  assert.equal(wf.running, true);
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(wf.getActivityLog().length > 0, 'expected activity while running');
  const count = wf.getActivityLog().length;
  wf.pause();
  assert.equal(wf.running, false);
  assert.ok(wf.getSummary().agents.every((a) => a.status === 'paused'));
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(
    wf.getActivityLog().length,
    count,
    'no new activity after pause',
  );
  wf.resume();
  assert.equal(wf.running, true);
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(
    wf.getActivityLog().length >= count,
    'activity resumes after resume',
  );
  wf.destroy();
  assert.equal(wf.running, false);
});

test('destroy stops everything and processOnce after destroy is a no-op', () => {
  const store = makeStore();
  provider(store);
  const wf = createWorkforce({
    providerStore: store,
    corridorEngine: makeEngine(),
  });
  wf.start();
  wf.destroy();
  assert.equal(wf.running, false);
  wf.processOnce(); // no-op after destroy, must not throw
});
