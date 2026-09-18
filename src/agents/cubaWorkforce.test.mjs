// Unit tests for the Cuba desk workforce: cubaWorkforce.js.
// All fixture values are deliberately fictional. No real buyers, partners,
// or requests appear anywhere in these fixtures.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_TIERS,
  LANG_POLICY,
  SANCTIONS_HARD_STOP,
  WORKFORCE_LOG_KEY,
  registerWorkforce,
  logAction,
  escalate,
  classifyTrack,
  AGENT_DEFS,
  createWorkforce,
  getWorkforceSummary,
} from './cubaWorkforce.js';

// --- workforce core contract ------------------------------------------------

test('AGENT_TIERS: READ/DRAFT/PROPOSE only — no execute tier exists', () => {
  assert.deepEqual(Object.keys(AGENT_TIERS).sort(), [
    'DRAFT',
    'PROPOSE',
    'READ',
  ]);
  assert.ok(!Object.keys(AGENT_TIERS).includes('EXECUTE'));
});

test('LANG_POLICY: cuba is es-first', () => {
  assert.equal(LANG_POLICY.cuba, 'es-first');
});

test('SANCTIONS_HARD_STOP: escalate-always gate', () => {
  assert.equal(SANCTIONS_HARD_STOP.gate, 'sanctions');
  assert.equal(SANCTIONS_HARD_STOP.action, 'escalate-always');
});

test('WORKFORCE_LOG_KEY namespaced for the cuba desk', () => {
  assert.equal(WORKFORCE_LOG_KEY, 'sahjony.workforce.cuba.log.v1');
});

test('registerWorkforce: validates tiers, defaults lang from LANG_POLICY', () => {
  const roster = registerWorkforce('cuba', [
    { id: 'a1', role: 'triage', tier: 'draft' },
    { id: 'a2', role: 'x', tier: 'execute' }, // invalid → read
  ]);
  assert.equal(roster[0].tier, 'draft');
  assert.equal(roster[1].tier, 'read');
  assert.equal(roster[0].lang, 'es-first');
  assert.throws(() => registerWorkforce(''), /moduleId/);
});

test('logAction: entry shape stored under the cuba log key', () => {
  const entry = logAction('cuba', 'sourcing-scout', {
    kind: 'triaged',
    es: 'Validada',
    en: 'Validated',
    tier: 'read',
    refId: 'r1',
  });
  assert.equal(entry.module, 'cuba');
  assert.equal(entry.agent, 'sourcing-scout');
  assert.equal(entry.action, 'triaged');
  assert.equal(entry.status, 'logged');
  assert.equal(entry.refId, 'r1');
  assert.ok(typeof entry.ts === 'number');
});

test('escalate: stages an awaiting-juan entry, never auto-resolves', () => {
  const e = escalate('cuba', 'sanctions', { requestId: 'r1' });
  assert.equal(e.module, 'cuba');
  assert.equal(e.reason, 'sanctions');
  assert.equal(e.status, 'awaiting-juan');
  assert.equal(e.payload.requestId, 'r1');
});

test('classifyTrack: exactly one track per conversation', () => {
  assert.equal(classifyTrack('Necesito arroz para mi MIPYME en Cuba'), 'cuba');
  assert.equal(classifyTrack('cuba MIPYME habana sourcing RFQ'), 'cuba');
  assert.equal(classifyTrack('track a crude oil tanker'), 'crude');
  assert.equal(classifyTrack(''), 'unknown');
  assert.equal(classifyTrack(null), 'unknown');
});

// --- roster -----------------------------------------------------------------

test('AGENT_DEFS: 6 agents, none with send/execute authority', () => {
  assert.equal(AGENT_DEFS.length, 6);
  const ids = AGENT_DEFS.map((a) => a.id);
  assert.deepEqual(ids, [
    'sourcing-scout',
    'counterparty-diligence',
    'compliance',
    'outreach-drafting',
    'follow-up',
    'oversight',
  ]);
  for (const a of AGENT_DEFS) {
    assert.ok(['read', 'draft', 'propose'].includes(a.tier));
    assert.ok(a.name.es.length > 0 && a.name.en.length > 0);
  }
});

// --- orchestrator -----------------------------------------------------------

function makeStore(seed = []) {
  const map = new Map();
  let seq = 1;
  for (const r of seed) {
    const rec = {
      id: r.id || `r${seq++}`,
      status: 'intake',
      agentNotes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...r,
    };
    map.set(rec.id, rec);
  }
  return {
    getAll: () => [...map.values()],
    get: (id) => map.get(id) || null,
    update: (id, patch) => {
      const cur = map.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      map.set(id, next);
      return next;
    },
    notes: (id) => {
      const cur = map.get(id);
      if (!cur) return [];
      return (cur.agentNotes || []).map((n) => ({
        t: n.at,
        agent: n.agent,
        es: n.es,
        en: n.en,
      }));
    },
  };
}

const GOOD_ENGINE = {
  scoreSourcingRequest: () => 95,
  requestValue: () => 10000,
  requestVerdict: () => ({ tier: 'green', es: 'Lista', en: 'Ready' }),
  missingFields: () => [],
  formatMoney: (n) => `$${Number(n)}`,
  formatQty: (n) => `${Math.round(n)}`,
};

const THROWING_ENGINE = new Proxy(
  {},
  {
    get() {
      return () => {
        throw new Error('engine down');
      };
    },
  },
);

test('createWorkforce: requires requestStore + cubaEngine', () => {
  assert.throws(() => createWorkforce({}), /requestStore/);
  assert.throws(
    () => createWorkforce({ requestStore: makeStore() }),
    /cubaEngine/,
  );
});

test('scout: valid intake → triage with validated note; invalid stays flagged', () => {
  const store = makeStore([
    { ref: 'CUBA-900', product: 'Arroz pilado', quantity: 5000 },
    { ref: '', product: '', quantity: 0 },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.processOnce();
  const reqs = store.getAll();
  assert.equal(reqs[0].status, 'triage');
  assert.equal(reqs[1].status, 'intake');
  assert.ok(reqs[0].agentNotes.length > 0);
  assert.ok(reqs[1].agentNotes.length > 0);
  const kinds = wf.getActivityLog().map((e) => e.kind);
  assert.ok(kinds.includes('triaged'));
  assert.ok(kinds.includes('flagged'));
  wf.destroy();
});

test('scout: missing fields are named in the flag note, nothing invented', () => {
  const store = makeStore([{ ref: 'CUBA-901' }]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.processOnce();
  const notes = store.notes(store.getAll()[0].id);
  assert.ok(notes[0].es.includes('producto'));
  assert.ok(notes[0].es.includes('cantidad'));
  wf.destroy();
});

test('diligence: triage request gets a checklist note and stays in triage', () => {
  const store = makeStore([
    { ref: 'CUBA-902', product: 'Aceite', quantity: 100, status: 'triage' },
  ]);
  const engine = { ...GOOD_ENGINE, requestVerdict: () => ({ tier: 'yellow' }) };
  const wf = createWorkforce({ requestStore: store, cubaEngine: engine });
  wf.setBuyers([{ id: 'b1', name: 'Comprador Ficticio' }]);
  wf.processOnce();
  const req = store.getAll()[0];
  assert.equal(req.status, 'triage', 'workforce never auto-advances');
  assert.ok(
    req.agentNotes.some((n) => n.es.includes('Lista de diligencia')),
    'checklist note written',
  );
  assert.equal(wf.getProposals().length, 0, 'yellow verdict → no proposal');
  wf.destroy();
});

test('diligence: green verdict stages a proposal for Juan — never applies it', () => {
  const store = makeStore([
    { ref: 'CUBA-903', product: 'Arroz', quantity: 1000, status: 'triage' },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.processOnce();
  const proposals = wf.getProposals();
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].proposedStatus, 'quoted');
  assert.equal(proposals[0].status, 'pending');
  assert.equal(store.getAll()[0].status, 'triage', 'status untouched');
  wf.destroy();
});

test('diligence: flagged buyer escalates and request never advances', () => {
  const store = makeStore([
    {
      ref: 'CUBA-904',
      product: 'Azúcar',
      quantity: 100,
      status: 'triage',
      buyerId: 'bx',
    },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.setBuyers([{ id: 'bx', name: 'Marcado Ficticio', verification: 'flagged' }]);
  wf.processOnce();
  const req = store.getAll()[0];
  assert.equal(req.status, 'triage');
  const esc = wf.getEscalations().find((e) => e.reason === 'flagged-buyer');
  assert.ok(esc, 'flagged-buyer escalation staged');
  assert.equal(esc.status, 'awaiting-juan');
  wf.destroy();
});

test('compliance: sanctions mention escalates ALWAYS, request untouched', () => {
  const store = makeStore([
    {
      ref: 'CUBA-905',
      product: 'Arroz',
      quantity: 100,
      status: 'triage',
      notes: '¿Hay sanciones OFAC que apliquen aquí?',
    },
  ]);
  const engine = { ...GOOD_ENGINE, requestVerdict: () => ({ tier: 'yellow' }) };
  const wf = createWorkforce({ requestStore: store, cubaEngine: engine });
  wf.processOnce();
  const esc = wf.getEscalations().find((e) => e.reason === 'sanctions');
  assert.ok(esc, 'sanctions escalation staged');
  assert.equal(esc.status, 'awaiting-juan');
  const req = store.getAll()[0];
  assert.equal(req.status, 'triage');
  assert.ok(
    req.agentNotes.some((n) => n.agent === 'compliance'),
    'compliance note written',
  );
  wf.destroy();
});

test('compliance: sanctions escalation fires only once per request', () => {
  const store = makeStore([
    {
      ref: 'CUBA-906',
      product: 'Arroz',
      quantity: 100,
      notes: 'pregunta sobre el embargo',
    },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.processOnce();
  wf.processOnce();
  const count = wf
    .getEscalations()
    .filter((e) => e.reason === 'sanctions').length;
  assert.equal(count, 1);
  wf.destroy();
});

test('outreach: green quoted request gets a Spanish WhatsApp DRAFT — never sent', () => {
  const store = makeStore([
    { ref: 'CUBA-907', product: 'Arroz pilado', quantity: 2000, status: 'quoted' },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.setBuyers([{ id: 'b2', name: 'Comprador Ficticio' }]);
  wf.processOnce();
  const req = store.getAll()[0];
  const drafts = req.agentNotes.filter((n) => n.agent === 'outreach-drafting');
  assert.equal(drafts.length, 1);
  assert.ok(drafts[0].es.includes('BORRADOR'));
  assert.ok(drafts[0].es.includes('NADA ENVIADO'));
  assert.ok(drafts[0].es.startsWith('BORRADOR DE WHATSAPP'));
  assert.equal(req.status, 'quoted', 'drafts never move status');
  // idempotent: second pass does not duplicate the draft
  wf.processOnce();
  assert.equal(
    store
      .getAll()[0]
      .agentNotes.filter((n) => n.agent === 'outreach-drafting').length,
    1,
  );
  wf.destroy();
});

test('outreach: no drafts on escalated requests or weak verdicts', () => {
  const store = makeStore([
    {
      ref: 'CUBA-908',
      product: 'Arroz',
      quantity: 100,
      status: 'quoted',
      notes: 'sanciones pendientes',
    },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.processOnce();
  const drafts = store
    .getAll()[0]
    .agentNotes.filter((n) => n.agent === 'outreach-drafting');
  assert.equal(drafts.length, 0, 'sanctions-escalated request gets no draft');
  wf.destroy();
});

test('follow-up: stale negotiating request gets a follow-up draft', () => {
  const store = makeStore([
    {
      ref: 'CUBA-909',
      product: 'Café',
      quantity: 50,
      status: 'negotiating',
      updatedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.processOnce();
  const drafts = store
    .getAll()[0]
    .agentNotes.filter((n) => n.agent === 'follow-up');
  assert.equal(drafts.length, 1);
  assert.ok(drafts[0].es.includes('BORRADOR DE SEGUIMIENTO'));
  assert.ok(drafts[0].es.includes('NADA ENVIADO'));
  wf.destroy();
});

test('follow-up: fresh negotiating request gets no draft', () => {
  const store = makeStore([
    {
      ref: 'CUBA-910',
      product: 'Café',
      quantity: 50,
      status: 'negotiating',
      updatedAt: Date.now(),
    },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.processOnce();
  const drafts = store
    .getAll()[0]
    .agentNotes.filter((n) => n.agent === 'follow-up');
  assert.equal(drafts.length, 0);
  wf.destroy();
});

test('oversight: commitment language in a draft escalates to Juan', () => {
  const store = makeStore([
    {
      ref: 'CUBA-911',
      product: 'Arroz',
      quantity: 100,
      status: 'quoted',
      agentNotes: [
        {
          at: Date.now(),
          agent: 'outreach-drafting',
          es: 'BORRADOR: Garantizamos la entrega en 10 días.',
          en: 'DRAFT: We guarantee delivery in 10 days.',
        },
      ],
    },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.processOnce();
  const esc = wf
    .getEscalations()
    .find((e) => e.reason === 'draft-commitment');
  assert.ok(esc, 'commitment draft escalated');
  assert.equal(esc.status, 'awaiting-juan');
  wf.destroy();
});

test('oversight: clean drafts log a reviewed event, no escalation', () => {
  const store = makeStore([
    {
      ref: 'CUBA-912',
      product: 'Arroz',
      quantity: 100,
      status: 'quoted',
      agentNotes: [
        {
          at: Date.now(),
          agent: 'outreach-drafting',
          es: 'BORRADOR DE WHATSAPP — NADA ENVIADO. Hola, ¿le interesa?',
          en: 'WHATSAPP DRAFT — NOTHING SENT. Hello, interested?',
        },
      ],
    },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.processOnce();
  const kinds = wf.getActivityLog().map((e) => e.kind);
  assert.ok(kinds.includes('reviewed'));
  assert.ok(
    !wf.getEscalations().some((e) => e.reason === 'draft-commitment'),
  );
  wf.destroy();
});

test('defensive engine: a throwing engine never breaks the passes', () => {
  const store = makeStore([
    { ref: 'CUBA-913', product: 'Arroz', quantity: 100, status: 'triage' },
  ]);
  const wf = createWorkforce({
    requestStore: store,
    cubaEngine: THROWING_ENGINE,
  });
  assert.doesNotThrow(() => wf.processOnce());
  const req = store.getAll()[0];
  assert.ok(req.agentNotes.length > 0, 'diligence note still written');
  wf.destroy();
});

test('getSummary: running, agents, queue depth, pending proposals', () => {
  const store = makeStore([
    { ref: 'CUBA-914', product: 'Arroz', quantity: 100 },
    { ref: 'CUBA-915', product: 'Aceite', quantity: 50, status: 'won' },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  const s = getWorkforceSummary(wf);
  assert.equal(s.running, false);
  assert.equal(s.agents.length, 6);
  assert.equal(s.queueDepth, 1, 'only the open request counts');
  assert.ok(s.note.es.length > 0);
  assert.equal(getWorkforceSummary(wf).running, false);
  wf.destroy();
});

test('resolveProposal: approve applies the move to quoted', () => {
  const store = makeStore([
    { ref: 'CUBA-916', product: 'Arroz', quantity: 1000, status: 'triage' },
  ]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  wf.processOnce();
  const [proposal] = wf.getProposals();
  assert.ok(proposal);
  const resolved = wf.resolveProposal(proposal.id, true);
  assert.equal(resolved.status, 'approved');
  assert.equal(store.getAll()[0].status, 'quoted');
  wf.destroy();
});

test('no send/post/publish/contact function exists on the handle', () => {
  const store = makeStore();
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  for (const key of ['send', 'post', 'publish', 'contact', 'email', 'call']) {
    assert.equal(
      wf[key],
      undefined,
      `workforce must not expose ${key}()`,
    );
  }
  wf.destroy();
});

test('onActivity: listeners fire on events, unsubscribe works', () => {
  const store = makeStore([{ ref: 'CUBA-917', product: 'Arroz', quantity: 10 }]);
  const wf = createWorkforce({ requestStore: store, cubaEngine: GOOD_ENGINE });
  let calls = 0;
  const unsub = wf.onActivity(() => {
    calls += 1;
  });
  wf.processOnce();
  assert.ok(calls > 0);
  unsub();
  const before = calls;
  wf.processOnce();
  assert.equal(calls, before);
  wf.destroy();
});
