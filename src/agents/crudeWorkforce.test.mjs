/**
 * Tests for the crude-oil brokerage intelligence workforce.
 * node:test with fake in-memory cargoStore + fake cargoEngine doubles.
 * No real-world data — fixtures only ("FIXTURE-001", "Fixture Port A").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkforce,
  getWorkforceSummary,
  WORKFORCE_NOTE,
  WORKFORCE_LOG_KEY,
} from './crudeWorkforce.js';

function makeStore(seedCargoes = []) {
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
      if (!current) throw new Error(`unknown cargo ${id}`);
      map.set(id, { ...current, ...patch });
    },
    add(cargo) {
      const id = cargo.id || `cargo-${++seq}`;
      map.set(id, { notes: [], ...cargo, id });
      return id;
    },
  };
  for (const c of seedCargoes) store.add(c);
  return store;
}

function makeEngine(overrides = {}) {
  return {
    cargoVerdict: () => ({
      tier: 'green',
      es: 'Veredicto verde.',
      en: 'Green verdict.',
    }),
    brokerCommission: ({ volumeBbl, commissionPerBbl }) =>
      volumeBbl * commissionPerBbl,
    netPerBbl: (cargo) => (cargo.sellPrice || 0) - (cargo.buyPrice || 0),
    missingFields: () => [],
    scoreCargo: () => 75,
    ...overrides,
  };
}

function throwingEngine() {
  const boom = () => {
    throw new Error('engine boom');
  };
  return {
    cargoVerdict: boom,
    brokerCommission: boom,
    netPerBbl: boom,
    missingFields: boom,
    scoreCargo: boom,
  };
}

function cargo(store, overrides = {}) {
  return store.add({
    ref: 'FIXTURE-001',
    grade: 'Fixture Crude',
    volumeBbl: 500000,
    buyPrice: 70,
    sellPrice: 73,
    commissionPerBbl: 0.25,
    incoterms: 'FOB',
    laycanStart: '2026-10-01',
    laycanEnd: '2026-10-05',
    loadPort: 'Fixture Port A',
    dischargePort: 'Fixture Port B',
    supplierId: null,
    buyerId: null,
    status: 'prospect',
    costs: { freight: 0, insurance: 0, inspection: 0, other: 0 },
    ...overrides,
  });
}

function fixtureBuyer(overrides = {}) {
  return {
    name: 'Fixture Buyer Co',
    type: 'refinery',
    role: 'buyer',
    verification: 'verified',
    country: 'Fixtureland',
    ...overrides,
  };
}

test('WORKFORCE_NOTE is honest about app-open-only operation', () => {
  assert.match(WORKFORCE_NOTE.es, /mientras la app est/i);
  assert.match(WORKFORCE_NOTE.en, /while the app is open/i);
  assert.ok(typeof WORKFORCE_LOG_KEY === 'string');
  assert.match(WORKFORCE_LOG_KEY, /crude/);
});

test('scout moves prospect→diligence when triage data is valid', () => {
  const store = makeStore();
  const id = cargo(store);
  // yellow verdict so the analyst pass holds the cargo in diligence
  const engine = makeEngine({
    cargoVerdict: () => ({ tier: 'yellow', es: 'Amarillo.', en: 'Yellow.' }),
  });
  const wf = createWorkforce({ cargoStore: store, cargoEngine: engine });
  wf.processOnce();
  const c = store.get(id);
  assert.equal(c.status, 'diligence');
  const note = c.notes.find((n) => n.agent === 'scout');
  assert.ok(note && note.es && note.en, 'expected a bilingual scout note');
  assert.ok(/triaje|triage/i.test(note.es + note.en));
  const event = wf.getActivityLog().find((e) => e.kind === 'triaged');
  assert.ok(event, 'expected a "triaged" event');
  wf.destroy();
});

test('scout flags (but never deletes or invents for) cargoes missing data', () => {
  const store = makeStore();
  const id = cargo(store, { volumeBbl: 0, loadPort: '' });
  const wf = createWorkforce({ cargoStore: store, cargoEngine: makeEngine() });
  wf.processOnce();
  const c = store.get(id);
  assert.equal(c.status, 'prospect'); // stays — never deletes, never advances
  assert.equal(store.getAll().length, 1); // not deleted
  assert.equal(c.volumeBbl, 0, 'agent must never invent a volume');
  const note = c.notes.find((n) => n.agent === 'scout');
  assert.ok(note && note.es && note.en);
  assert.match(note.en, /Missing triage data/i);
  const event = wf
    .getActivityLog()
    .find((e) => e.kind === 'flagged' && e.agent === 'scout');
  assert.ok(event, 'expected a scout "flagged" event');
  wf.destroy();
});

test('researcher writes the diligence checklist with the manual-verification honesty line', () => {
  const store = makeStore();
  const id = cargo(store, { status: 'diligence' });
  // yellow verdict so the analyst pass holds the cargo in diligence
  const engine = makeEngine({
    cargoVerdict: () => ({ tier: 'yellow', es: 'Amarillo.', en: 'Yellow.' }),
  });
  const wf = createWorkforce({ cargoStore: store, cargoEngine: engine });
  wf.processOnce();
  const c = store.get(id);
  assert.equal(c.status, 'diligence', 'researcher never auto-advances');
  const checklist = c.notes.find(
    (n) => n.agent === 'researcher' && /lista de diligencia/i.test(n.es),
  );
  assert.ok(checklist, 'expected the diligence checklist note');
  assert.ok(checklist.es && checklist.en, 'checklist must be bilingual');
  assert.match(
    checklist.es,
    /No hay fuente automática de verificación de sanciones o listas: la verificación es manual\./,
  );
  assert.match(
    checklist.en,
    /There is no automatic sanctions-screening data source: verification is manual\./,
  );
  assert.match(checklist.en, /Juan/i, "identity verification is Juan's job");
  wf.destroy();
});

test('researcher explicitly flags a "flagged" counterparty and holds diligence', () => {
  const store = makeStore();
  const id = cargo(store, {
    status: 'diligence',
    buyerId: 'Fixture Buyer Co',
  });
  const wf = createWorkforce({
    // yellow verdict so the analyst pass holds the cargo in diligence
    cargoStore: store,
    cargoEngine: makeEngine({
      cargoVerdict: () => ({ tier: 'yellow', es: 'Amarillo.', en: 'Yellow.' }),
    }),
  });
  wf.setBuyers([
    fixtureBuyer({ name: 'Fixture Buyer Co', verification: 'flagged' }),
  ]);
  wf.processOnce();
  const c = store.get(id);
  assert.equal(c.status, 'diligence');
  const flag = c.notes.find(
    (n) => n.agent === 'researcher' && /BANDERA|FLAG/i.test(n.es + n.en),
  );
  assert.ok(flag, 'expected an explicit flagged-counterparty note');
  assert.match(flag.es, /Fixture Buyer Co/);
  assert.match(flag.en, /Juan/i);
  const event = wf
    .getActivityLog()
    .find((e) => e.kind === 'flagged' && e.agent === 'researcher');
  assert.ok(event, 'expected a researcher "flagged" event');
  wf.destroy();
});

test('analyst flags missing prices and lists missing fields bilingually', () => {
  const store = makeStore();
  const id = cargo(store, {
    status: 'diligence',
    buyPrice: 0,
    sellPrice: 0,
    ref: 'FIXTURE-001',
  });
  const wf = createWorkforce({
    cargoStore: store,
    cargoEngine: makeEngine({
      missingFields: () => [
        { field: 'buyPrice', es: 'Precio de compra', en: 'Buy price' },
        { field: 'sellPrice', es: 'Precio de venta', en: 'Sell price' },
      ],
    }),
  });
  wf.processOnce();
  const c = store.get(id);
  assert.equal(c.status, 'diligence', 'missing economics → stays in diligence');
  const note = c.notes.find((n) => n.agent === 'analyst');
  assert.ok(
    note && note.es && note.en,
    'expected a bilingual missing-fields note',
  );
  assert.match(note.es, /Precio de compra/);
  assert.match(note.en, /Buy price/);
  const event = wf
    .getActivityLog()
    .find((e) => e.kind === 'flagged' && e.agent === 'analyst');
  assert.ok(event, 'expected an analyst "flagged" event');
  wf.destroy();
});

test('analyst writes a bilingual deal memo and moves to negotiating on green', () => {
  const store = makeStore();
  const id = cargo(store, { status: 'diligence' });
  const wf = createWorkforce({ cargoStore: store, cargoEngine: makeEngine() });
  wf.processOnce();
  const c = store.get(id);
  assert.equal(c.status, 'negotiating');
  const memo = c.notes.find(
    (n) => n.agent === 'analyst' && /memorando|deal memo/i.test(n.es + n.en),
  );
  assert.ok(memo && memo.es && memo.en, 'expected a bilingual deal memo');
  assert.match(memo.en, /500,000 bbl/);
  assert.match(memo.en, /\$3\.00\/bbl/, 'spread/bbl = 73 - 70');
  assert.match(memo.en, /125,000/, 'commission total = 500000 * 0.25');
  assert.match(memo.en, /GREEN/i);
  wf.destroy();
});

test('analyst saves the memo but does not advance on a non-green verdict', () => {
  const store = makeStore();
  const id = cargo(store, { status: 'diligence' });
  const wf = createWorkforce({
    cargoStore: store,
    cargoEngine: makeEngine({
      cargoVerdict: () => ({
        tier: 'red',
        es: 'Veredicto rojo.',
        en: 'Red verdict.',
      }),
    }),
  });
  wf.processOnce();
  const c = store.get(id);
  assert.equal(c.status, 'diligence');
  assert.ok(
    c.notes.some((n) => n.agent === 'analyst'),
    'analysis is saved even when the verdict is not green',
  );
  wf.destroy();
});

test('analyst falls back defensively when the engine throws', () => {
  const store = makeStore();
  const id = cargo(store, { status: 'diligence' });
  const wf = createWorkforce({
    cargoStore: store,
    cargoEngine: throwingEngine(),
  });
  wf.processOnce();
  const c = store.get(id);
  assert.equal(c.status, 'diligence', 'fallback yellow → no advance');
  const memo = c.notes.find(
    (n) => n.agent === 'analyst' && /memorando|deal memo/i.test(n.es + n.en),
  );
  assert.ok(memo, 'expected a defensive memo even when the engine fails');
  wf.destroy();
});

test('dispositions ranks buyers verified-green / flagged-red, contacts nobody', () => {
  const store = makeStore();
  const id = cargo(store, { status: 'negotiating' });
  const wf = createWorkforce({ cargoStore: store, cargoEngine: makeEngine() });
  wf.setBuyers([
    fixtureBuyer({ name: 'Fixture Red Co', verification: 'flagged' }),
    fixtureBuyer({ name: 'Fixture Green Co', verification: 'verified' }),
    fixtureBuyer({ name: 'Fixture Yellow Co', verification: 'unverified' }),
    fixtureBuyer({
      name: 'Fixture Supplier',
      role: 'supplier',
      verification: 'verified',
    }),
  ]);
  assert.deepEqual(
    wf.getBuyers().map((b) => b.name),
    [
      'Fixture Red Co',
      'Fixture Green Co',
      'Fixture Yellow Co',
      'Fixture Supplier',
    ],
  );
  wf.processOnce();
  const c = store.get(id);
  assert.equal(
    c.status,
    'negotiating',
    'dispositions never advances or contacts',
  );
  const note = c.notes.find((n) => n.agent === 'dispositions');
  assert.ok(note, 'expected a buyer-match note');
  assert.ok(note.es && note.en, 'note must be bilingual');
  assert.ok(
    !note.en.includes('Fixture Supplier'),
    'supplier-role buyers are excluded',
  );
  const greenIdx = note.en.indexOf('Fixture Green Co');
  const yellowIdx = note.en.indexOf('Fixture Yellow Co');
  const redIdx = note.en.indexOf('Fixture Red Co');
  assert.ok(greenIdx !== -1 && yellowIdx !== -1 && redIdx !== -1);
  assert.ok(
    greenIdx < yellowIdx && yellowIdx < redIdx,
    'verified first, flagged last',
  );
  assert.match(note.en, /green \(verified\)/);
  assert.match(note.en, /red \(flagged\)/);
  assert.match(
    note.en,
    /Nobody has been contacted — this is a draft for review only\./,
  );
  assert.match(
    note.es,
    /Nadie ha sido contactado — esto es solo un borrador para revisión\./,
  );
  const event = wf.getActivityLog().find((e) => e.kind === 'buyer-match');
  assert.ok(event, 'expected a buyer-match event');
  wf.destroy();
});

test('dispositions flags when no buyers are loaded', () => {
  const store = makeStore();
  cargo(store, { status: 'negotiating' });
  const wf = createWorkforce({ cargoStore: store, cargoEngine: makeEngine() });
  wf.processOnce();
  const event = wf
    .getActivityLog()
    .find((e) => e.kind === 'flagged' && e.agent === 'dispositions');
  assert.ok(event, 'expected a dispositions "flagged" event with no buyers');
  wf.destroy();
});

test('processOnce emits bilingual activity events and persists them', () => {
  const store = makeStore();
  cargo(store);
  const wf = createWorkforce({ cargoStore: store, cargoEngine: makeEngine() });
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
    cargo(store, { ref: `FIXTURE-001-${i}` });
  }
  const wf = createWorkforce({ cargoStore: store, cargoEngine: makeEngine() });
  wf.processOnce();
  assert.equal(wf.getActivityLog().length, 300);
  wf.destroy();
});

test('getSummary reports running, agents, and queueDepth', () => {
  const store = makeStore();
  cargo(store); // prospect
  cargo(store, { status: 'diligence', ref: 'FIXTURE-002' });
  cargo(store, { status: 'closed', ref: 'FIXTURE-003' }); // not in queue
  const wf = createWorkforce({ cargoStore: store, cargoEngine: makeEngine() });
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
    s3.agents.find((a) => a.id === 'scout').lastAction,
    'scout should have a lastAction',
  );
  wf.destroy();
});

test('start/pause/resume control the scheduler', async () => {
  const store = makeStore();
  cargo(store);
  // fast timers for the test
  const wf = createWorkforce({
    cargoStore: store,
    cargoEngine: makeEngine(),
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

test('destroy stops everything and invalid cargoStore throws', () => {
  assert.throws(
    () => createWorkforce({ cargoEngine: makeEngine() }),
    /cargoStore/,
  );
  const store = makeStore();
  const wf = createWorkforce({ cargoStore: store, cargoEngine: makeEngine() });
  wf.start();
  wf.destroy();
  assert.equal(wf.running, false);
  wf.processOnce(); // no-op after destroy, must not throw
});
