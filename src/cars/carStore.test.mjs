import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_KEY,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  DEAL_STATUSES,
  DRAFT_STATES,
  BROKER_DISCLOSURE,
  PRELIMINARY_BUYER_PRICES,
  createLead,
  getLead,
  updateLead,
  moveLead,
  deleteLead,
  listLeads,
  addLeadNote,
  addLeadAgentNote,
  createDeal,
  getDeal,
  moveDeal,
  listDeals,
  createDraft,
  getDraft,
  setDraftState,
  listDrafts,
  addSnapshot,
  listSnapshots,
  deleteSnapshot,
  getOurPrices,
  setOurPrice,
  getReferencePrices,
  stats,
  asWorkforceStore,
  resetCarsStore,
  reloadCarsStore,
} from './carStore.js';

// Tests run against the real store module in non-browser mode (memory
// backend). Figures below are clearly samples. Nothing confidential is
// seeded — the store has no field for margins or floors by design.

test('storage key is tenant-isolated', () => {
  assert.equal(STORAGE_KEY, 'sahjony.cars.v1');
});

test('lead lifecycle: create, dedupe, move, note, delete', () => {
  resetCarsStore();
  const lead = createLead({
    name: 'Sample Buyer',
    whatsapp: '+1 555-0100',
    interest: 'Sample Model (fictional)',
    budgetUsd: 99999,
    source: 'whatsapp-sample',
  });
  assert.equal(lead.stage, 'nuevo');
  assert.ok(lead.id);

  // Exactly one record per person: same name+whatsapp returns the same record.
  const dup = createLead({ name: 'sample buyer', whatsapp: '+1 555-0100' });
  assert.equal(dup.id, lead.id);
  assert.equal(listLeads().length, 1);

  moveLead(lead.id, 'contactado');
  assert.equal(getLead(lead.id).stage, 'contactado');
  assert.throws(() => moveLead(lead.id, 'nope'));

  const note = addLeadNote(lead.id, 'Llamó por el Sample Model');
  assert.equal(note.text, 'Llamó por el Sample Model');
  assert.equal(getLead(lead.id).notes.length, 1);

  const an = addLeadAgentNote(lead.id, 'lead-qualifier', 'es-note', 'en-note');
  assert.equal(an.agent, 'lead-qualifier');

  assert.equal(deleteLead(lead.id), true);
  assert.equal(listLeads().length, 0);
});

test('lead budget stays null when empty (never becomes 0)', () => {
  resetCarsStore();
  const lead = createLead({ name: 'Sample Buyer 2', whatsapp: '+1 555-0101' });
  assert.equal(lead.budgetUsd, null);
  updateLead(lead.id, { budgetUsd: '' });
  assert.equal(getLead(lead.id).budgetUsd, null);
  deleteLead(lead.id);
});

test('deal lifecycle and stats grouping', () => {
  resetCarsStore();
  const deal = createDeal({
    model: 'Sample Model (fictional)',
    buyerPrice: 99999,
    leadId: 'sample-lead',
  });
  assert.equal(deal.status, 'abierto');
  assert.equal(deal.buyerPrice, 99999);
  assert.throws(() => moveDeal(deal.id, 'nope'));
  moveDeal(deal.id, 'activo');
  assert.equal(getDeal(deal.id).status, 'activo');
  const s = stats();
  assert.equal(s.totalDeals, 1);
  assert.equal(s.byStatus.activo, 1);
});

test('draft queue approve states (no sent state exists)', () => {
  resetCarsStore();
  assert.deepEqual(DRAFT_STATES, ['draft', 'approved', 'discarded']);
  const draft = createDraft({
    kind: 'rosmel',
    title: 'Sample Rosmel draft',
    bodyEs: 'Hola Rosmel (borrador de muestra)',
    bodyEn: 'Hi Rosmel (sample draft)',
    state: 'draft',
  });
  assert.equal(draft.state, 'draft');
  setDraftState(draft.id, 'approved');
  assert.equal(getDraft(draft.id).state, 'approved');
  assert.equal(stats().byDraftState.approved, 1);
  assert.equal(listDrafts({ state: 'approved' }).length, 1);
});

test('competition snapshots newest-first and our prices', () => {
  resetCarsStore();
  addSnapshot({
    competitor: 'Sample Competitor (fictional)',
    model: 'Sample Model (fictional)',
    price: 99999,
    date: '2026-09-16',
    sourceUrl: 'https://example.com/sample',
  });
  addSnapshot({
    competitor: 'Sample Competitor (fictional)',
    model: 'Sample Model (fictional)',
    price: 88888,
    date: '2026-09-17',
    sourceUrl: 'https://example.com/sample2',
  });
  const rows = listSnapshots();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026-09-17');
  setOurPrice('Sample Model (fictional)', 77777);
  assert.equal(getOurPrices()['Sample Model (fictional)'], 77777);
  setOurPrice('Sample Model (fictional)', null);
  assert.ok(!('Sample Model (fictional)' in getOurPrices()));
  deleteSnapshot(rows[0].id);
  assert.equal(listSnapshots().length, 1);
});

test('reference prices seed the Rosmel preliminary buyer figures', () => {
  resetCarsStore();
  const refs = getReferencePrices();
  assert.equal(refs.length, 3);
  const byModel = Object.fromEntries(refs.map((r) => [r.model, r.price]));
  assert.equal(byModel['Hyundai Elantra'], 24900);
  assert.equal(byModel['Infiniti Q50'], 27600);
  assert.equal(byModel['Jeep Renegade'], 26000);
});

test('broker disclosure is present in ES and EN', () => {
  assert.ok(BROKER_DISCLOSURE.es.includes('intermediario'));
  assert.ok(BROKER_DISCLOSURE.en.includes('broker'));
});

test('lead stage labels cover the full funnel', () => {
  assert.deepEqual(LEAD_STAGES, [
    'nuevo',
    'contactado',
    'calificado',
    'oferta',
    'cierre',
    'descartado',
  ]);
  for (const stage of LEAD_STAGES) {
    assert.ok(LEAD_STAGE_LABELS[stage]?.es);
    assert.ok(LEAD_STAGE_LABELS[stage]?.en);
  }
  assert.equal(DEAL_STATUSES.length, 5);
});

test('workforce adapter shapes notes for the agent engine', () => {
  resetCarsStore();
  const store = asWorkforceStore();
  const lead = createLead({ name: 'Sample Buyer 3', whatsapp: '+1 555-0102' });
  const adapted = store.get(lead.id);
  assert.ok(adapted);
  store.update(lead.id, {
    agentNotes: [{ at: '2026-09-17T00:00:00-05:00', agent: 'a', es: 'x', en: 'y' }],
  });
  const notes = store.notes(lead.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].t, '2026-09-17T00:00:00-05:00');
  // Duplicate note writes are deduped.
  store.update(lead.id, {
    agentNotes: [{ at: '2026-09-17T00:00:00-05:00', agent: 'a', es: 'x', en: 'y' }],
  });
  assert.equal(store.notes(lead.id).length, 1);
});

test('reload round-trips persisted data', () => {
  resetCarsStore();
  createLead({ name: 'Sample Buyer 4', whatsapp: '+1 555-0103' });
  reloadCarsStore();
  assert.equal(listLeads().length, 1);
  assert.equal(stats().totalLeads, 1);
  resetCarsStore();
});

test('preliminary buyer prices constant is buyer-facing only (no floors)', () => {
  for (const p of PRELIMINARY_BUYER_PRICES) {
    assert.ok(p.model && p.price > 0);
    assert.ok(p.note.es.includes('preliminar'));
    assert.ok(!('floor' in p) && !('margin' in p) && !('cost' in p));
  }
});
