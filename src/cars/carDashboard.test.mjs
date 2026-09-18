import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SECTIONS,
  leadStagePillClass,
  dealStatusPillClass,
  draftStatePillClass,
  positionPillClass,
  funnelCounts,
  groupDealsByStatus,
  positionIndicator,
  draftRosmelWhatsapp,
  adaptStore,
  createMemoryCarStore,
} from './carDashboard.js';

test('pill classes cover all enums', () => {
  for (const stage of ['nuevo', 'contactado', 'calificado', 'oferta', 'cierre', 'descartado']) {
    assert.ok(leadStagePillClass(stage));
  }
  for (const status of ['abierto', 'activo', 'firmado', 'cerrado', 'caido']) {
    assert.ok(dealStatusPillClass(status));
  }
  for (const state of ['draft', 'approved', 'discarded']) {
    assert.ok(draftStatePillClass(state));
  }
  for (const pos of ['under', 'over', 'equal', 'unknown']) {
    assert.ok(positionPillClass(pos));
  }
  assert.equal(leadStagePillClass('bogus'), 'gray');
});

test('funnelCounts counts per stage', () => {
  const counts = funnelCounts([
    { stage: 'nuevo' },
    { stage: 'nuevo' },
    { stage: 'calificado' },
    { stage: undefined },
  ]);
  const byStage = Object.fromEntries(counts.map((c) => [c.stage, c.count]));
  assert.equal(byStage.nuevo, 3);
  assert.equal(byStage.calificado, 1);
  assert.equal(byStage.contactado, 0);
  assert.equal(counts.length, 6);
});

test('groupDealsByStatus groups and defaults unknown statuses', () => {
  const groups = groupDealsByStatus([
    { status: 'activo' },
    { status: 'activo' },
    { status: 'bogus' },
  ]);
  assert.equal(groups.activo.length, 2);
  assert.equal(groups.abierto.length, 1);
  assert.equal(groups.caido.length, 0);
});

test('positionIndicator formats diff text', () => {
  assert.equal(positionIndicator('under', 22222), '+$22,222');
  assert.equal(positionIndicator('over', -500), '$500');
  assert.equal(positionIndicator('unknown', 0), '—');
});

test('draftRosmelWhatsapp is bilingual, buyer-price only', () => {
  const es = draftRosmelWhatsapp({
    leadName: 'Sample Buyer',
    model: 'Sample Model',
    price: 99999,
    lang: 'es',
  });
  assert.ok(es.includes('Sample Buyer'));
  assert.ok(es.includes('Sample Model'));
  assert.ok(es.includes('$99,999'));
  assert.ok(es.includes('intermediario'));
  assert.ok(es.includes('no enviar sin la aprobación de Juan'));
  assert.ok(!es.toLowerCase().includes('margen'));
  assert.ok(!es.toLowerCase().includes('floor'));

  const en = draftRosmelWhatsapp({ leadName: 'Sample Buyer', lang: 'en' });
  assert.ok(en.includes('do not send without'));
  assert.ok(en.includes('broker'));
});

test('memory car store double round-trips leads, deals, drafts, snapshots', () => {
  const store = createMemoryCarStore();
  const lead = store.createLead({ name: 'Sample Buyer', whatsapp: '+1 555-0100' });
  assert.equal(lead.stage, 'nuevo');
  store.moveLead(lead.id, 'calificado');
  assert.equal(store.getLead(lead.id).stage, 'calificado');
  const note = store.addLeadNote(lead.id, 'nota de muestra');
  assert.equal(note.text, 'nota de muestra');

  const deal = store.createDeal({ model: 'Sample Model', buyerPrice: 99999, leadId: lead.id });
  assert.equal(store.listDeals().length, 1);
  store.moveDeal(deal.id, 'activo');
  assert.equal(store.getDeal(deal.id).status, 'activo');

  store.createDraft({ kind: 'rosmel', title: 'd', bodyEs: 'x' });
  assert.equal(store.listDrafts().length, 1);
  assert.equal(store.listDrafts({ state: 'draft' }).length, 1);
  assert.equal(store.stats().pendingDrafts, 1);

  store.addSnapshot({ competitor: 'C', model: 'M', price: 99999, date: '2026-09-17' });
  assert.equal(store.listSnapshots().length, 1);
  store.setOurPrice('M', 77777);
  assert.equal(store.getOurPrices().M, 77777);

  assert.equal(store.deleteLead(lead.id), true);
  assert.equal(store.deleteDeal(deal.id), true);
});

test('adaptStore stays honest with a null store', () => {
  const store = adaptStore(null);
  assert.deepEqual(store.listLeads(), []);
  assert.deepEqual(store.listDrafts(), []);
  assert.deepEqual(store.listSnapshots(), []);
  assert.deepEqual(store.getOurPrices(), {});
  assert.equal(store.stats().totalLeads, 0);
});

test('sections are exactly the v1 scope', () => {
  assert.deepEqual([...SECTIONS], ['funnel', 'drafts', 'prices', 'deals']);
});
