/**
 * Tests for the trade workforce v1 extensions: compliance (READ +
 * sanctions hard-stop escalation) and follow-up (DRAFT only) agents,
 * workforce-core registration/tiers, and the draft-only guarantee.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkforce,
  AGENT_TIER_BY_ID,
  TRADE_MODULE_ID,
  FOLLOWUP_COOLDOWN_MS,
} from './tradeWorkforce.js';
import { AGENT_TIERS } from './workforceCore.js';
import {
  resetFollowupDrafts,
  listDrafts,
  openDraftForRfq,
} from '../trade/followupDrafts.js';

function makeStore(seedRfqs = []) {
  const map = new Map();
  let seq = 0;
  const store = {
    getAll: () => [...map.values()],
    get: (id) => map.get(id),
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
    rfqVerdict: () => ({ tier: 'green', es: 'Verde.', en: 'Green.', reasons: [] }),
    scoreRfq: () => 80,
    formatMoney: (n) => `$${Number(n).toLocaleString('en-US')}`,
    formatQty: (n) => `${Number(n).toLocaleString('en-US')}`,
    ...overrides,
  };
}

/** Install a memory localStorage so the core's audit writes are observable. */
function stubLocalStorage() {
  const data = new Map();
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
  return {
    data,
    restore() {
      if (prev === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev;
    },
  };
}

const rfq = (over = {}) => ({
  ref: 'FIX-001',
  product: 'Fixture Product',
  quantity: 1000,
  unitCost: 12.5,
  sellUnitPrice: 18,
  originPort: 'Fixture Origin Port',
  destinationPort: 'Fixture Destination Port',
  status: 'negotiating',
  ...over,
});

test('roster has 6 agents; tiers follow the core spec (no execute tier)', () => {
  const wf = createWorkforce({ rfqStore: makeStore(), rfqEngine: makeEngine() });
  const ids = wf.agents.map((a) => a.id);
  assert.deepEqual(ids, [
    'supplier-scout',
    'rfq-researcher',
    'logistics-analyst',
    'deal-coordinator',
    'compliance',
    'follow-up',
  ]);
  assert.equal(TRADE_MODULE_ID, 'trade');
  assert.ok(FOLLOWUP_COOLDOWN_MS > 0);
  const tiers = new Set(Object.values(AGENT_TIER_BY_ID));
  assert.ok(tiers.has(AGENT_TIERS.DRAFT));
  assert.ok(tiers.has(AGENT_TIERS.READ));
  assert.ok(tiers.has(AGENT_TIERS.PROPOSE));
  assert.equal(AGENT_TIER_BY_ID['follow-up'], AGENT_TIERS.DRAFT);
  assert.equal(AGENT_TIER_BY_ID.compliance, AGENT_TIERS.READ);
  assert.ok(!('execute' in AGENT_TIERS), 'there is NO execute tier');
  wf.destroy();
});

test('workforce handle exposes no send/post/publish function', () => {
  const wf = createWorkforce({ rfqStore: makeStore(), rfqEngine: makeEngine() });
  for (const name of ['send', 'post', 'publish', 'dispatch', 'transmit', 'email', 'text', 'call']) {
    assert.equal(typeof wf[name], 'undefined', `workforce.${name} must not exist`);
  }
  wf.destroy();
});

test('agent actions are recorded in the core audit log with resolved tiers', () => {
  const ls = stubLocalStorage();
  try {
    const store = makeStore([rfq({ status: 'prospect' })]);
    const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
    wf.processOnce();
    const raw = ls.data.get('sahjony.workforce.trade.log.v1');
    assert.ok(raw, 'core audit log written');
    const entries = JSON.parse(raw);
    assert.ok(entries.length > 0);
    for (const e of entries) {
      assert.equal(e.module, 'trade');
      assert.equal(e.status, 'logged');
      assert.ok(['read', 'draft', 'propose'].includes(e.tier), `tier resolved: ${e.tier}`);
    }
    wf.destroy();
  } finally {
    ls.restore();
  }
});

test('compliance: sanctions topic → escalates to Juan, never answers', () => {
  const ls = stubLocalStorage();
  resetFollowupDrafts();
  try {
    const store = makeStore([
      rfq({ id: 'risky', ref: 'RISK-1', product: 'Fixture embargo goods', status: 'contacted' }),
      rfq({ id: 'clean', ref: 'OK-1', product: 'Fixture Product', status: 'contacted' }),
    ]);
    const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
    wf.processOnce();
    const riskyNotes = store.notes('risky');
    const escNote = riskyNotes.find((n) => n.agent === 'compliance');
    assert.ok(escNote, 'compliance note written on the risky RFQ');
    assert.match(`${escNote.es} ${escNote.en}`, /escalado|escalat/i);
    const cleanNotes = store.notes('clean');
    assert.ok(!cleanNotes.some((n) => n.agent === 'compliance' && /escalad/i.test(n.es || '')));
    const queueRaw = ls.data.get('sahjony.workforce.escalations.v1');
    assert.ok(queueRaw, 'escalation queue written');
    const queue = JSON.parse(queueRaw);
    const item = queue.find((q) => q.reason === 'sanctions' && q.module === 'trade');
    assert.ok(item, 'sanctions escalation queued');
    assert.equal(item.status, 'awaiting-juan');
    assert.equal(item.payload.ref, 'RISK-1');
    wf.destroy();
  } finally {
    ls.restore();
    resetFollowupDrafts();
  }
});

test('compliance: sanctions question in the RFQ notes field also escalates', () => {
  const ls = stubLocalStorage();
  try {
    const store = makeStore([
      rfq({
        id: 'risky3',
        ref: 'RISK-3',
        product: 'Fixture Product',
        status: 'quoting',
        notes: '¿Esta mercancía tiene algún problema de sanciones?',
      }),
    ]);
    const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
    wf.processOnce();
    const queue = JSON.parse(ls.data.get('sahjony.workforce.escalations.v1') || '[]');
    assert.ok(
      queue.some((q) => q.reason === 'sanctions' && q.payload && q.payload.rfqId === 'risky3'),
      'sanctions question in notes escalates',
    );
    wf.destroy();
  } finally {
    ls.restore();
  }
});

test('compliance: does not escalate twice for the same RFQ', () => {
  const ls = stubLocalStorage();
  try {
    const store = makeStore([
      rfq({ id: 'risky2', ref: 'RISK-2', product: 'OFAC-listed fixture goods', status: 'quoting' }),
    ]);
    const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
    wf.processOnce();
    wf.processOnce();
    const queue = JSON.parse(ls.data.get('sahjony.workforce.escalations.v1') || '[]');
    const hits = queue.filter((q) => q.payload && q.payload.rfqId === 'risky2');
    assert.equal(hits.length, 1, 'exactly one escalation per RFQ');
    wf.destroy();
  } finally {
    ls.restore();
  }
});

test('follow-up: drafts a bilingual follow-up into the draft queue (never sends)', () => {
  resetFollowupDrafts();
  const store = makeStore([rfq({ id: 'fu1', ref: 'FU-1', status: 'negotiating' })]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  wf.processOnce();
  const draft = openDraftForRfq('fu1');
  assert.ok(draft, 'follow-up draft created');
  assert.equal(draft.kind, 'followup');
  assert.equal(draft.status, 'draft', 'drafts wait for Juan — never sent');
  assert.equal(draft.channel, 'whatsapp');
  assert.match(draft.es, /SAHJONY/);
  assert.match(draft.es, /bróker/i);
  assert.match(draft.en, /broker/i);
  assert.match(draft.es, /FU-1/);
  const notes = store.notes('fu1');
  assert.ok(notes.some((n) => n.agent === 'follow-up' && /NO enviado|NOT sent/.test(`${n.es} ${n.en}`)));
  wf.destroy();
  resetFollowupDrafts();
});

test('follow-up: one open draft per RFQ max; cooldown respected', () => {
  resetFollowupDrafts();
  const store = makeStore([rfq({ id: 'fu2', ref: 'FU-2', status: 'negotiating' })]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  wf.processOnce();
  wf.processOnce();
  const drafts = listDrafts((d) => d.rfqId === 'fu2');
  assert.equal(drafts.length, 1, 'no duplicate drafts while one is open');
  // Fresh agent note → cooldown blocks a second draft.
  const store2 = makeStore([
    rfq({
      id: 'fu3',
      ref: 'FU-3',
      status: 'negotiating',
      notes: [{ t: Date.now(), agent: 'follow-up', es: 'reciente', en: 'recent' }],
    }),
  ]);
  const wf2 = createWorkforce({ rfqStore: store2, rfqEngine: makeEngine() });
  wf2.processOnce();
  assert.equal(openDraftForRfq('fu3'), null, 'cooldown blocks drafting');
  wf.destroy();
  wf2.destroy();
  resetFollowupDrafts();
});

test('follow-up: skips RFQs outside contacted/quoting/negotiating', () => {
  resetFollowupDrafts();
  const store = makeStore([
    rfq({ id: 'p1', ref: 'P-1', status: 'prospect' }),
    rfq({ id: 'w1', ref: 'W-1', status: 'won' }),
  ]);
  const wf = createWorkforce({ rfqStore: store, rfqEngine: makeEngine() });
  wf.processOnce();
  assert.equal(listDrafts().length, 0);
  wf.destroy();
  resetFollowupDrafts();
});
