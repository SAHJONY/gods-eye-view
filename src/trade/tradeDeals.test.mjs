/**
 * Tests for the trade desk live-deal seeds.
 * Asserts the seeded records carry ONLY verified 2026 facts: real
 * counterparties, real prices/terms, broker positioning, and nothing
 * invented (no unnamed-seller fabrication, no guessed prices).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  liveDealSeeds,
  liveCounterpartySeeds,
  seedLiveDeals,
  liveDealNextAction,
  LIVE_DEAL_REFS,
} from './tradeDeals.js';

function makeStoreDouble() {
  const rfqs = [];
  const suppliers = [];
  let seq = 0;
  return {
    _rfqs: rfqs,
    _suppliers: suppliers,
    listRfqs: () => [...rfqs],
    createRfq: (data) => {
      const rec = { id: `rfq-${++seq}`, ...data };
      rfqs.push(rec);
      return rec;
    },
    listSuppliers: () => [...suppliers],
    createSupplier: (data) => {
      const rec = { id: `sup-${++seq}`, ...data };
      suppliers.push(rec);
      return rec;
    },
  };
}

test('LIVE_DEAL_REFS lists exactly the three live deals', () => {
  assert.deepEqual([...LIVE_DEAL_REFS], [
    'DEAL-2026-RD01',
    'DEAL-2026-TNJ01',
    'DEAL-2026-V942-01',
  ]);
});

test('seeds: rice/diesel — inquiry sent by Juan, awaiting pricing, no invented seller', () => {
  const deal = liveDealSeeds().find((d) => d.ref === 'DEAL-2026-RD01');
  assert.equal(deal.status, 'contacted');
  assert.equal(deal.supplierId, '', 'seller unnamed: no invented supplier link');
  assert.equal(deal.unitCost, 0, 'no price yet — never guessed');
  assert.equal(deal.sellUnitPrice, 0);
  assert.equal(deal.desk, 'trade');
  assert.equal(deal.liveDeal, true);
  assert.equal(deal.sourceDate, '2026-09-17');
  const text = deal.agentNotes.map((n) => `${n.es} ${n.en}`).join(' ');
  assert.match(text, /Juan/i);
  assert.match(text, /WhatsApp/);
  assert.match(text, /arroz pilado/i);
  assert.match(text, /diésel nacionalizado|nationalized diesel/i);
  assert.match(text, /bróker|broker/i, 'broker positioning required');
});

test('seeds: TNJ soda ash — 210 MT @ $265/MT FOB Qingdao, Katharine Xu', () => {
  const deal = liveDealSeeds().find((d) => d.ref === 'DEAL-2026-TNJ01');
  assert.equal(deal.status, 'quoting');
  assert.equal(deal.quantity, 210);
  assert.equal(deal.unitCost, 265);
  assert.equal(deal.incoterms, 'FOB');
  assert.equal(deal.originPort, 'Qingdao');
  assert.equal(deal.sellUnitPrice, 0, 'buyer price not agreed — stays empty');
  const text = deal.agentNotes.map((n) => `${n.es} ${n.en}`).join(' ');
  assert.match(text, /Katharine Xu/);
  assert.match(text, /sales19@tnjchem\.com/);
  assert.match(text, /210/);
  assert.match(text, /carta de crédito|LC/i);
  assert.match(text, /NO enviada|NOT sent/);
});

test('seeds: Siemens V94.2 — $37.5M EXW, quote on file, no buyer', () => {
  const deal = liveDealSeeds().find((d) => d.ref === 'DEAL-2026-V942-01');
  assert.equal(deal.status, 'contacted');
  assert.equal(deal.quantity, 1);
  assert.equal(deal.unitCost, 37500000);
  assert.equal(deal.incoterms, 'EXW');
  assert.equal(deal.sellUnitPrice, 0, 'no buyer yet — stays empty');
  const text = deal.agentNotes.map((n) => `${n.es} ${n.en}`).join(' ');
  assert.match(text, /American Plant & Equipment/);
  assert.match(text, /37,500,000/);
  assert.match(text, /445 MW/);
  assert.match(text, /LOI/);
});

test('counterparty seeds: only verified real contacts, no invented phones', () => {
  const seeds = liveCounterpartySeeds();
  assert.equal(seeds.length, 2);
  const tnj = seeds.find((s) => s.name === 'TNJ Chemical');
  assert.equal(tnj.country, 'China');
  assert.equal(tnj.contact.name, 'Katharine Xu');
  assert.equal(tnj.contact.email, 'sales19@tnjchem.com');
  assert.equal(tnj.contact.phone, '', 'no phone on record — stays empty');
  const ape = seeds.find((s) => s.name === 'American Plant & Equipment');
  assert.equal(ape.contact.name, '', 'individual contact unverified — stays empty');
  assert.equal(ape.verification, 'unverified');
});

test('seedLiveDeals: idempotent, links deals to counterparties', () => {
  const store = makeStoreDouble();
  const first = seedLiveDeals(store);
  assert.equal(first.createdRfqs, 3);
  assert.equal(first.createdSuppliers, 2);
  const tnjDeal = first.rfqs.find((r) => r.ref === 'DEAL-2026-TNJ01');
  const tnjSup = first.suppliers.find((s) => s.name === 'TNJ Chemical');
  assert.equal(tnjDeal.supplierId, tnjSup.id);
  const v942 = first.rfqs.find((r) => r.ref === 'DEAL-2026-V942-01');
  const ape = first.suppliers.find((s) => s.name === 'American Plant & Equipment');
  assert.equal(v942.supplierId, ape.id);
  const rice = first.rfqs.find((r) => r.ref === 'DEAL-2026-RD01');
  assert.equal(rice.supplierId, '', 'rice/diesel seller stays unlinked');
  const second = seedLiveDeals(store);
  assert.equal(second.createdRfqs, 0);
  assert.equal(second.createdSuppliers, 0);
  assert.equal(store._rfqs.length, 3);
});

test('seedLiveDeals: never throws on a hostile store', () => {
  assert.doesNotThrow(() => seedLiveDeals(null));
  assert.doesNotThrow(() => seedLiveDeals({}));
  const hostile = {
    listRfqs: () => { throw new Error('boom'); },
    createRfq: () => { throw new Error('boom'); },
    listSuppliers: () => { throw new Error('boom'); },
    createSupplier: () => { throw new Error('boom'); },
  };
  const result = seedLiveDeals(hostile);
  assert.equal(result.createdRfqs, 0);
});

test('liveDealNextAction: bilingual next actions, empty for unknown ref', () => {
  assert.ok(liveDealNextAction('DEAL-2026-RD01', 'es').length > 0);
  assert.ok(liveDealNextAction('DEAL-2026-TNJ01', 'en').length > 0);
  assert.ok(liveDealNextAction('DEAL-2026-V942-01', 'es').length > 0);
  assert.equal(liveDealNextAction('NOPE'), '');
});
