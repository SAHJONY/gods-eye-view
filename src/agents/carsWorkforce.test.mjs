import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKFORCE_LOG_KEY,
  WORKFORCE_NOTE,
  LANG_POLICY,
  AGENT_TIERS,
  createWorkforce,
  getWorkforceSummary,
} from './carsWorkforce.js';
import {
  AGENT_TIERS as CORE_AGENT_TIERS,
  LANG_POLICY as CORE_LANG_POLICY,
  logAction as coreLogAction,
} from './workforceCore.js';

function fakeStore() {
  const leads = [];
  const drafts = [];
  const snapshots = [];
  let n = 0;
  return {
    getAll: () => [...leads],
    get: (id) => leads.find((l) => l.id === id) ?? null,
    update: (id, patch) => {
      const lead = leads.find((l) => l.id === id);
      return lead ? Object.assign(lead, patch) : null;
    },
    notes: (id) => (leads.find((l) => l.id === id)?.agentNotes || []),
    addLead: (lead) => {
      const l = { id: `lead-${(n += 1)}`, stage: 'nuevo', agentNotes: [], notes: [], ...lead };
      leads.push(l);
      return l;
    },
    listDrafts: () => [...drafts],
    createDraft: (d) => {
      const draft = { id: `draft-${(n += 1)}`, state: 'draft', ...d };
      drafts.push(draft);
      return draft;
    },
    listSnapshots: () => [...snapshots],
    getOurPrices: () => ({}),
  };
}

const fakeEngine = {
  scoreLead: (lead) => ({
    score: lead.whatsapp ? 80 : 20,
    missing: lead.whatsapp ? [] : [{ field: 'contact', es: 'contacto', en: 'contact' }],
  }),
  qualificationVerdict: (scored) => ({
    tier: scored.score >= 70 ? 'green' : 'red',
    es: scored.score >= 70 ? 'Calificable' : 'Descartable',
    en: scored.score >= 70 ? 'Qualifiable' : 'Drop',
    reasons: [],
  }),
  summarizeModelPricing: () => ({ ourPrice: null }),
};

test('workforce constants: log key, language policy, draft-only tiers', () => {
  assert.equal(WORKFORCE_LOG_KEY, 'sahjony.workforce.cars.log.v1');
  assert.equal(LANG_POLICY, 'es-first');
  assert.ok(WORKFORCE_NOTE.es && WORKFORCE_NOTE.en);
  assert.deepEqual(AGENT_TIERS, { READ: 'read', DRAFT: 'draft', PROPOSE: 'propose' });
});

test('authority model comes from the shared workforce core (never invented)', () => {
  // Same object identity: the module re-exports the core's tiers.
  assert.equal(AGENT_TIERS, CORE_AGENT_TIERS);
  assert.equal(LANG_POLICY, CORE_LANG_POLICY.cars);
});

test('createWorkforce registers its roster with the shared core', () => {
  const store = fakeStore();
  const wf = createWorkforce({ carStore: store, carEngine: fakeEngine });
  try {
    // Tier resolution through the core proves registration happened.
    assert.equal(coreLogAction('cars', 'lead-qualifier', 'probe').tier, 'draft');
    assert.equal(coreLogAction('cars', 'price-watcher', 'probe').tier, 'read');
    assert.equal(coreLogAction('cars', 'rosmel-drafter', 'probe').tier, 'draft');
    assert.equal(coreLogAction('cars', 'oversight', 'probe').tier, 'read');
  } finally {
    wf.destroy();
  }
});

test('createWorkforce validates collaborators', () => {
  assert.throws(() => createWorkforce({}), /carStore/);
  assert.throws(() => createWorkforce({ carStore: fakeStore() }), /carEngine/);
});

test('passes score leads, watch prices, stage rosmel drafts, and log (drafts only)', async () => {
  const store = fakeStore();
  store.addLead({ name: 'Sample Buyer', whatsapp: '+1 555-0100', stage: 'nuevo' });
  store.addLead({ name: 'Sample Qualified', whatsapp: '+1 555-0101', stage: 'calificado' });
  const wf = createWorkforce({
    carStore: store,
    carEngine: fakeEngine,
    staggerMs: 5,
    tickMs: 60000,
  });
  assert.equal(wf.running, false);
  wf.start();
  assert.equal(wf.running, true);
  await new Promise((r) => setTimeout(r, 150));

  const summary = getWorkforceSummary(wf);
  assert.equal(summary.running, true);
  assert.equal(summary.agents.length, 4);
  assert.deepEqual(
    summary.agents.map((a) => a.id).sort(),
    ['lead-qualifier', 'oversight', 'price-watcher', 'rosmel-drafter'].sort(),
  );

  const feed = wf.getActivityLog();
  assert.ok(feed.length >= 3, `expected activity, got ${feed.length}`);
  const kinds = new Set(feed.map((e) => e.kind));
  assert.ok(kinds.has('scored') || kinds.has('idle'));

  // Lead notes were written for the nuevo lead.
  const nuevo = store.getAll().find((l) => l.stage === 'nuevo');
  assert.ok(nuevo.agentNotes.length >= 1);

  // A Rosmel draft was staged for the qualified lead — draft state, broker disclosure, no send.
  const drafts = store.listDrafts();
  assert.ok(drafts.length >= 1, 'expected at least one staged draft');
  for (const d of drafts) {
    assert.equal(d.state, 'draft');
    assert.ok(d.bodyEs.includes('Borrador'));
    assert.ok(d.bodyEs.includes('intermediario'));
    assert.ok(!('sent' in d) || d.sent !== true);
  }

  wf.pause();
  assert.equal(wf.running, false);
  wf.destroy();
});

test('oversight escalates drafts that touch import legality', async () => {
  const store = fakeStore();
  store.createDraft({
    kind: 'rosmel',
    title: 'Legal question draft',
    bodyEs: '¿Es legal traer este carro por la aduana? pregunta de legalidad',
    state: 'draft',
  });
  const wf = createWorkforce({
    carStore: store,
    carEngine: fakeEngine,
    staggerMs: 5,
    tickMs: 60000,
  });
  wf.start();
  await new Promise((r) => setTimeout(r, 150));
  const feed = wf.getActivityLog();
  const escalated = feed.find((e) => e.kind === 'escalated');
  assert.ok(escalated, 'oversight must escalate legality drafts to Juan');
  assert.ok(escalated.es.includes('ESCALADO'));
  wf.destroy();
});

test('a throwing engine never breaks a pass', async () => {
  const store = fakeStore();
  store.addLead({ name: 'Sample Buyer', stage: 'nuevo' });
  const wf = createWorkforce({
    carStore: store,
    carEngine: {
      scoreLead: () => {
        throw new Error('boom');
      },
      qualificationVerdict: () => {
        throw new Error('boom');
      },
      summarizeModelPricing: () => {
        throw new Error('boom');
      },
    },
    staggerMs: 5,
    tickMs: 60000,
  });
  wf.start();
  await new Promise((r) => setTimeout(r, 150));
  const feed = wf.getActivityLog();
  assert.ok(feed.length >= 1);
  wf.destroy();
});

test('no send function exists on the workforce surface', () => {
  const store = fakeStore();
  const wf = createWorkforce({ carStore: store, carEngine: fakeEngine });
  for (const key of ['send', 'post', 'publish', 'contact', 'text', 'email', 'call']) {
    assert.equal(typeof wf[key], 'undefined', `wf.${key} must not exist`);
  }
  wf.destroy();
});
