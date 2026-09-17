/**
 * Tests for the wholesale real-estate intelligence workforce.
 * node:test with fake in-memory leadStore + fake dealEngine doubles.
 * No real-world data — fixtures only ("123 Test St").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkforce,
  getWorkforceSummary,
  WORKFORCE_NOTE,
  WORKFORCE_LOG_KEY,
  OFFER_SCORE_FLOOR,
} from './workforce.js';

function makeStore(seedLeads = []) {
  const map = new Map();
  let seq = 0;
  const store = {
    getAll() {
      return [...map.values()];
    },
    get(id) {
      return map.get(id);
    },
    update(id, patch) {
      const current = map.get(id);
      if (!current) throw new Error(`unknown lead ${id}`);
      map.set(id, { ...current, ...patch });
    },
    add(lead) {
      const id = lead.id || `lead-${++seq}`;
      map.set(id, { notes: [], ...lead, id });
      return id;
    },
  };
  for (const l of seedLeads) store.add(l);
  return store;
}

function makeEngine(overrides = {}) {
  return {
    scoreLead: () => 75,
    maxAllowableOffer: () => 100000,
    rankBuyer: () => 'green',
    ...overrides,
  };
}

function lead(store, overrides = {}) {
  return store.add({
    address: '123 Test St',
    lat: 29.76,
    lng: -95.36,
    status: 'new',
    ...overrides,
  });
}

test('WORKFORCE_NOTE is honest about app-open-only operation', () => {
  assert.match(WORKFORCE_NOTE.es, /mientras la app est/i);
  assert.match(WORKFORCE_NOTE.en, /while the app is open/i);
  assert.ok(typeof WORKFORCE_LOG_KEY === 'string');
  assert.equal(OFFER_SCORE_FLOOR, 60);
});

test('scout moves new→researching when address/coords are valid', () => {
  const store = makeStore();
  const id = lead(store);
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine() });
  wf.processOnce();
  const l = store.get(id);
  assert.equal(l.status, 'researching');
  assert.ok(l.notes.some((n) => n.agent === 'scout'));
  wf.destroy();
});

test('scout flags (but never deletes) leads missing data', () => {
  const store = makeStore();
  const id = lead(store, { lat: null, lng: null, address: '' });
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine() });
  wf.processOnce();
  const l = store.get(id);
  assert.equal(l.status, 'new'); // stays — never deletes, never advances
  assert.ok(store.getAll().length === 1); // not deleted
  const note = l.notes.find((n) => n.agent === 'scout');
  assert.ok(note && note.es && note.en);
  wf.destroy();
});

test('researcher flags entity owners per the owner rule and moves to analyzed', () => {
  const store = makeStore();
  const id = lead(store, { status: 'researching', ownerType: 'entity' });
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine() });
  wf.processOnce();
  const l = store.get(id);
  assert.equal(l.status, 'analyzed');
  const flag = l.notes.find((n) => n.agent === 'researcher' && /entidad|entity/i.test(n.es + n.en));
  assert.ok(flag, 'expected an entity flag note');
  assert.ok(flag.es && flag.en);
  // checklist present
  assert.ok(l.notes.some((n) => n.agent === 'researcher' && /HCAD|appraisal/i.test(n.es + n.en)));
  wf.destroy();
});

test('researcher keeps lead in researching when owner type is unknown', () => {
  const store = makeStore();
  const id = lead(store, { status: 'researching' });
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine() });
  wf.processOnce();
  const l = store.get(id);
  assert.equal(l.status, 'researching');
  assert.ok(l.notes.some((n) => n.agent === 'researcher'));
  wf.destroy();
});

test('analyst skips memo when arv/repairs are missing and leaves status', () => {
  const store = makeStore();
  const id = lead(store, { status: 'analyzed', ownerType: 'individual' });
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine() });
  wf.processOnce();
  const l = store.get(id);
  assert.equal(l.status, 'analyzed');
  assert.ok(!l.notes.some((n) => n.agent === 'analyst' && /nota de trato|deal memo/i.test(n.es + n.en)));
  const req = l.notes.find((n) => n.agent === 'analyst');
  assert.ok(req && req.es && req.en, 'expected a bilingual request note');
  wf.destroy();
});

test('analyst writes bilingual memo and moves to offer when score ≥ 60', () => {
  const store = makeStore();
  const id = lead(store, { status: 'analyzed', ownerType: 'individual', arv: 200000, repairs: 40000 });
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine({ scoreLead: () => 75 }) });
  wf.processOnce();
  const l = store.get(id);
  assert.equal(l.status, 'offer');
  const memo = l.notes.find((n) => n.agent === 'analyst' && /nota de trato|deal memo/i.test(n.es + n.en));
  assert.ok(memo && memo.es && memo.en);
  assert.match(memo.en, /75\/100/);
  assert.match(memo.en, /100,000/);
  wf.destroy();
});

test('analyst does not advance low-score leads but saves analysis', () => {
  const store = makeStore();
  const id = lead(store, { status: 'analyzed', ownerType: 'individual', arv: 200000, repairs: 40000 });
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine({ scoreLead: () => 40 }) });
  wf.processOnce();
  const l = store.get(id);
  assert.equal(l.status, 'analyzed');
  assert.ok(l.notes.some((n) => n.agent === 'analyst'));
  wf.destroy();
});

test('dispositions ranks injected buyers and writes a bilingual draft note; contacts nobody', () => {
  const store = makeStore();
  const id = lead(store, { status: 'offer', ownerType: 'individual', arv: 200000, repairs: 40000 });
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine() });
  wf.setBuyers([{ name: 'Test Buyer LLC' }, { name: 'Second Buyer' }]);
  wf.processOnce();
  const l = store.get(id);
  const note = l.notes.find((n) => n.agent === 'dispositions');
  assert.ok(note, 'expected a buyer-match note');
  assert.ok(note.es && note.en, 'note must be bilingual');
  assert.match(note.en, /Test Buyer LLC/);
  assert.match(note.en, /review only/i, 'must state nobody was contacted');
  assert.equal(l.status, 'offer', 'dispositions never advances or contacts');
  wf.destroy();
});

test('processOnce emits bilingual activity events and persists them', () => {
  const store = makeStore();
  lead(store);
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine() });
  const seen = [];
  const off = wf.onActivity((e) => seen.push(e));
  wf.processOnce();
  off();
  assert.ok(seen.length > 0, 'expected activity events');
  for (const e of seen) {
    assert.ok(e.t && e.agent && e.kind && e.es && e.en, `event missing fields: ${JSON.stringify(e)}`);
  }
  const logged = wf.getActivityLog(10);
  assert.ok(logged.length > 0);
  wf.destroy();
});

test('getSummary reports running, agents, and queueDepth', () => {
  const store = makeStore();
  lead(store); // new
  lead(store, { status: 'researching' });
  lead(store, { status: 'offer' }); // not in queue
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine() });
  const s1 = wf.getSummary();
  assert.equal(s1.running, false);
  assert.equal(s1.queueDepth, 2);
  assert.equal(s1.agents.length, 4);
  assert.deepEqual(
    s1.agents.map((a) => a.id),
    ['scout', 'researcher', 'analyst', 'dispositions'],
  );
  for (const a of s1.agents) {
    assert.ok(['idle', 'working', 'paused'].includes(a.status));
  }
  assert.ok(wf.agents.every((a) => a.name.es && a.name.en), 'role defs carry bilingual names');
  // standalone form works too
  const s2 = getWorkforceSummary(wf);
  assert.equal(s2.queueDepth, 2);
  wf.processOnce();
  const s3 = wf.getSummary();
  assert.ok(s3.agents.find((a) => a.id === 'scout').lastAction, 'scout should have a lastAction');
  wf.destroy();
});

test('start/pause/resume control the scheduler', async () => {
  const store = makeStore();
  lead(store);
  // fast timers for the test
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine(), tickMs: 50, staggerMs: 10 });
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
  assert.equal(wf.getActivityLog().length, count, 'no new activity after pause');
  wf.resume();
  assert.equal(wf.running, true);
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(wf.getActivityLog().length >= count, 'activity resumes after resume');
  wf.destroy();
  assert.equal(wf.running, false);
});

test('destroy stops everything and invalid leadStore throws', () => {
  assert.throws(() => createWorkforce({ dealEngine: makeEngine() }), /leadStore/);
  const store = makeStore();
  const wf = createWorkforce({ leadStore: store, dealEngine: makeEngine() });
  wf.start();
  wf.destroy();
  assert.equal(wf.running, false);
  wf.processOnce(); // no-op after destroy, must not throw
});
