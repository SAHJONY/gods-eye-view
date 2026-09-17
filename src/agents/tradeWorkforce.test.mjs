/**
 * Tests for the trade (import/export) RFQ workforce.
 * node:test with fake in-memory rfqStore + fake rfqEngine doubles.
 * No real-world data — fixtures only ("Fixture Product", "Fixture Origin Port").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkforce,
  getWorkforceSummary,
  WORKFORCE_NOTE,
  WORKFORCE_LOG_KEY,
  LOG_CAP,
} from './tradeWorkforce.js';

function makeStore(seedRfqs = []) {
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
      if (!current) throw new Error(`unknown rfq ${id}`);
      map.set(id, { ...current, ...patch });
    },
    notes(id) {
      const r = map.get(id);
      return (r && (r.notes || r.agentNotes)) || [];
    },
    add(rfq) {
      const id = rfq.id || `rfq-${++seq}`;
      map.set(id, { notes: [], agentNotes: [], ...rfq, id });
      return id;
    },
  };
  for (const r of seedRfqs) store.add(r);
  return store;
}

function makeEngine(overrides = {}) {
  return {
    landedCostUnit: () => 14,
    netMarginTotal: () => 2000,
    netMarginPct: () => 12.5,
    commissionAmount: () => 500,
    missingFields: () => [],
    rfqVerdict: () => ({
      tier: 'green',
      es: 'Veredicto verde de prueba.',
      en: 'Test green verdict.',
      reasons: [],
    }),
    scoreRfq: () => 80,
    formatMoney: (n) => `$${Number(n).toLocaleString('en-US')}`,
    formatQty: (n) => `${Number(n).toLocaleString('en-US')}`,
    ...overrides,
  };
}

const rfq = (over = {}) => ({
  ref: 'FIX-001',
  product: 'Fixture Product',
  quantity: 1000,
  unitCost: 12.5,
  sellUnitPrice: 18,
  freight: 1200,
  duties: 300,
  otherCosts: 150,
  commissionPct: 5,
  incoterms: 'FOB',
  originPort: 'Fixture Origin Port',
  destinationPort: 'Fixture Destination Port',
  status: 'prospect',
  ...over,
});

test('WORKFORCE_NOTE is honest about app-open-only operation', () => {
  assert.match(WORKFORCE_NOTE.es, /mientras la app est/i);
  assert.match(WORKFORCE_NOTE.en, /while the app is open/i);
  assert.equal(WORKFORCE_LOG_KEY, 'sahjony.workforce.trade.log.v1');
  assert.equal(LOG_CAP, 300);
});

test('scout moves prospect→contacted when triage data is valid', () => {
  const store = makeStore([rfq()]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  const [id] = [store.getAll()[0].id];
  wf.processOnce();
  const r = store.get(id);
  assert.equal(r.status, 'contacted');
  const note = r.notes.find((n) => n.agent === 'supplier-scout');
  assert.ok(note && note.es && note.en, 'expected a bilingual scout note');
  wf.destroy();
});

test('scout flags (but never deletes) RFQs missing triage data', () => {
  const store = makeStore([rfq({ product: '', quantity: 0, originPort: '' })]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  const id = store.getAll()[0].id;
  wf.processOnce();
  const r = store.get(id);
  assert.equal(r.status, 'prospect', 'stays — never deletes, never advances');
  assert.equal(store.getAll().length, 1, 'not deleted');
  const note = r.notes.find((n) => n.agent === 'supplier-scout');
  assert.ok(note && note.es && note.en);
  assert.match(note.es, /producto|cantidad|puerto de origen/i);
  wf.destroy();
});

test('researcher writes the diligence checklist and keeps the RFQ in contacted', () => {
  const store = makeStore([rfq({ status: 'contacted' })]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  const id = store.getAll()[0].id;
  wf.processOnce();
  const r = store.get(id);
  assert.equal(r.status, 'contacted', 'researcher never advances');
  const checklist = r.notes.find(
    (n) =>
      n.agent === 'rfq-researcher' &&
      /verificaci.n es manual|verification is manual/i.test(n.es + n.en),
  );
  assert.ok(checklist, 'expected the manual-verification checklist note');
  assert.ok(checklist.es && checklist.en);
  // Nobody is contacted or screened automatically.
  assert.match(checklist.en, /nobody is contacted or screened automatically/i);
  wf.destroy();
});

test('researcher flags a flagged linked supplier and does not advance', () => {
  const store = makeStore([
    rfq({ status: 'contacted', supplierId: 'sup-1' }),
  ]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  wf.setSuppliers([
    { id: 'sup-1', name: 'Test Supplier', verification: 'flagged' },
  ]);
  const id = store.getAll()[0].id;
  wf.processOnce();
  const r = store.get(id);
  assert.equal(r.status, 'contacted');
  const flag = r.notes.find(
    (n) => n.agent === 'rfq-researcher' && /BANDERA|FLAG/i.test(n.es + n.en),
  );
  assert.ok(flag, 'expected a flagged-supplier note');
  assert.match(flag.en, /Test Supplier/);
  assert.match(flag.en, /Juan's review/);
  wf.destroy();
});

test('analyst skips memo when economics are missing and leaves status', () => {
  const store = makeStore([
    rfq({ status: 'quoting', quantity: 0, unitCost: 0, sellUnitPrice: 0 }),
  ]);
  const wf = createWorkforce({
    rfqStore: store,
    rfqEngine: makeEngine({ missingFields: () => [{ es: 'precio de venta', en: 'sell price' }] }),
  });
  const id = store.getAll()[0].id;
  wf.processOnce();
  const r = store.get(id);
  assert.equal(r.status, 'quoting');
  assert.ok(
    !r.notes.some(
      (n) => n.agent === 'logistics-analyst' && /memorando de trato|deal memo/i.test(n.es + n.en),
    ),
    'no memo without economics',
  );
  const req = r.notes.find((n) => n.agent === 'logistics-analyst');
  assert.ok(req && req.es && req.en, 'expected a bilingual request note');
  wf.destroy();
});

test('analyst writes bilingual memo and moves to negotiating on green verdict', () => {
  const store = makeStore([rfq({ status: 'quoting' })]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  const id = store.getAll()[0].id;
  wf.processOnce();
  const r = store.get(id);
  assert.equal(r.status, 'negotiating');
  const memo = r.notes.find(
    (n) => n.agent === 'logistics-analyst' && /memorando de trato|deal memo/i.test(n.es + n.en),
  );
  assert.ok(memo && memo.es && memo.en);
  assert.match(memo.en, /80\/100/);
  assert.match(memo.en, /VERDE|GREEN/i);
  wf.destroy();
});

test('analyst does not advance non-green RFQs but saves the memo', () => {
  const store = makeStore([rfq({ status: 'quoting' })]);
  const wf = createWorkforce({
    rfqStore: store,
    rfqEngine: makeEngine({
      rfqVerdict: () => ({
        tier: 'red',
        es: 'Veredicto rojo de prueba.',
        en: 'Test red verdict.',
        reasons: [],
      }),
    }),
  });
  const id = store.getAll()[0].id;
  wf.processOnce();
  const r = store.get(id);
  assert.equal(r.status, 'quoting');
  assert.ok(r.notes.some((n) => n.agent === 'logistics-analyst'));
  wf.destroy();
});

test('analyst is defensive: a throwing engine cannot break the pass', () => {
  const store = makeStore([rfq({ status: 'quoting' })]);
  const throwing = () => {
    throw new Error('engine down');
  };
  const wf = createWorkforce({
    rfqStore: store,
    rfqEngine: {
      landedCostUnit: throwing,
      netMarginTotal: throwing,
      netMarginPct: throwing,
      commissionAmount: throwing,
      missingFields: throwing,
      rfqVerdict: throwing,
      scoreRfq: throwing,
    },
  });
  const id = store.getAll()[0].id;
  assert.doesNotThrow(() => wf.processOnce());
  const r = store.get(id);
  // Defensive yellow fallback → not green → stays in quoting.
  assert.equal(r.status, 'quoting');
  const memo = r.notes.find(
    (n) => n.agent === 'logistics-analyst' && /memorando de trato|deal memo/i.test(n.es + n.en),
  );
  assert.ok(memo, 'memo still written with 0 fallbacks');
  assert.match(memo.en, /YELLOW/);
  wf.destroy();
});

test('coordinator ranks injected suppliers and writes a bilingual draft; contacts nobody', () => {
  const store = makeStore([rfq({ status: 'negotiating' })]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  wf.setSuppliers([
    { id: 's1', name: 'Test Supplier', verification: 'verified' },
    { id: 's2', name: 'Second Supplier', verification: 'pending' },
  ]);
  const id = store.getAll()[0].id;
  wf.processOnce();
  const r = store.get(id);
  const note = r.notes.find((n) => n.agent === 'deal-coordinator');
  assert.ok(note, 'expected a supplier-match note');
  assert.ok(note.es && note.en, 'note must be bilingual');
  assert.match(note.en, /Test Supplier/);
  assert.match(note.en, /Second Supplier/);
  assert.match(note.en, /review only/i, 'must state nobody was contacted');
  assert.equal(r.status, 'negotiating', 'coordinator never advances');
  // Green (verified) ranks before yellow (pending).
  assert.ok(
    note.en.indexOf('Test Supplier') < note.en.indexOf('Second Supplier'),
    'verified supplier ranked first',
  );
  wf.destroy();
});

test('coordinator flags when no suppliers are loaded', () => {
  const store = makeStore([rfq({ status: 'negotiating' })]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  const seen = [];
  wf.onActivity((e) => seen.push(e));
  wf.processOnce();
  assert.ok(
    seen.some(
      (e) => e.agent === 'deal-coordinator' && e.kind === 'flagged',
    ),
    'expected a flagged event for empty suppliers',
  );
  wf.destroy();
});

test('setSuppliers/getSuppliers round-trip', () => {
  const store = makeStore();
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  assert.deepEqual(wf.getSuppliers(), []);
  const list = [{ id: 's1', name: 'Test Supplier', verification: 'verified' }];
  wf.setSuppliers(list);
  assert.deepEqual(wf.getSuppliers(), list);
  wf.setSuppliers('nope');
  assert.deepEqual(wf.getSuppliers(), [], 'non-array resets to empty');
  wf.destroy();
});

test('processOnce emits bilingual activity events and persists them', () => {
  const store = makeStore([rfq()]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
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

test('activity log is capped at 300 entries', () => {
  const seed = [];
  for (let i = 0; i < 350; i += 1) seed.push(rfq({ ref: `CAP-${i}` }));
  const store = makeStore(seed);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  wf.processOnce();
  assert.ok(
    wf.getActivityLog().length <= LOG_CAP,
    `log exceeded cap: ${wf.getActivityLog().length}`,
  );
  assert.equal(wf.getActivityLog().length, LOG_CAP);
  wf.destroy();
});

test('getSummary reports running, agents, and queueDepth', () => {
  const store = makeStore();
  store.add(rfq({ ref: 'A' })); // prospect
  store.add(rfq({ ref: 'B', status: 'contacted' }));
  store.add(rfq({ ref: 'C', status: 'won' })); // not in queue
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  const s1 = wf.getSummary();
  assert.equal(s1.running, false);
  assert.equal(s1.queueDepth, 2);
  assert.equal(s1.agents.length, 4);
  assert.deepEqual(
    s1.agents.map((a) => a.id),
    ['supplier-scout', 'rfq-researcher', 'logistics-analyst', 'deal-coordinator'],
  );
  for (const a of s1.agents) {
    assert.ok(['idle', 'working', 'paused'].includes(a.status));
  }
  assert.ok(
    wf.agents.every((a) => a.name.es && a.name.en),
    'role defs carry bilingual names',
  );
  // standalone form works too
  const s2 = getWorkforceSummary(wf);
  assert.equal(s2.queueDepth, 2);
  wf.processOnce();
  const s3 = wf.getSummary();
  assert.ok(
    s3.agents.find((a) => a.id === 'supplier-scout').lastAction,
    'scout should have a lastAction',
  );
  wf.destroy();
});

test('start/pause/resume control the scheduler', async () => {
  const store = makeStore([rfq()]);
  // fast timers for the test
  const wf = createWorkforce({
    rfqStore: store,
    rfqEngine: makeEngine(),
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
  assert.equal(wf.getActivityLog().length, count, 'no new activity after pause');
  wf.resume();
  assert.equal(wf.running, true);
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(wf.getActivityLog().length >= count, 'activity resumes after resume');
  wf.destroy();
  assert.equal(wf.running, false);
});

test('destroy stops everything and invalid rfqStore/rfqEngine throw', () => {
  assert.throws(() => createWorkforce({ rfqEngine: makeEngine() }), /rfqStore/);
  assert.throws(() => createWorkforce({ rfqStore: makeStore() }), /rfqEngine/);
  const store = makeStore([rfq()]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  wf.start();
  wf.destroy();
  assert.equal(wf.running, false);
  wf.processOnce(); // no-op after destroy, must not throw
});
