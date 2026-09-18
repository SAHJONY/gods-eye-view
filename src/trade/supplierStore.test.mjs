/**
 * Tests for the supplierStore extensions: intakeAt stamping, desk/liveDeal
 * provenance fields, listLiveDeals, linkedCounterparties, setVerification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRfq,
  createSupplier,
  listLiveDeals,
  linkedCounterparties,
  setVerification,
  getRfq,
  resetTradeStore,
} from './supplierStore.js';

test('createRfq stamps intakeAt from createdAt and defaults desk to trade', () => {
  resetTradeStore();
  const r = createRfq({ ref: 'INTAKE-1', product: 'Fixture' });
  assert.ok(r.intakeAt, 'intakeAt stamped');
  assert.equal(r.intakeAt, r.createdAt, 'backfilled from createdAt');
  assert.equal(r.desk, 'trade');
  assert.equal(r.liveDeal, false);
  assert.equal(r.source, '');
});

test('createRfq preserves explicit intakeAt, desk, liveDeal, source', () => {
  resetTradeStore();
  const r = createRfq({
    ref: 'INTAKE-2',
    product: 'Fixture',
    intakeAt: '2026-09-17T10:00:00.000Z',
    desk: 'cuba',
    liveDeal: true,
    source: 'Fixture source',
    sourceDate: '2026-09-17',
  });
  assert.equal(r.intakeAt, '2026-09-17T10:00:00.000Z');
  assert.equal(r.desk, 'cuba');
  assert.equal(r.liveDeal, true);
  assert.equal(r.source, 'Fixture source');
  assert.equal(r.sourceDate, '2026-09-17');
});

test('desk coerces unknown values to trade', () => {
  resetTradeStore();
  const r = createRfq({ ref: 'INTAKE-3', desk: 'europe' });
  assert.equal(r.desk, 'trade');
});

test('listLiveDeals returns only flagged deals', () => {
  resetTradeStore();
  createRfq({ ref: 'LIVE-A', liveDeal: true });
  createRfq({ ref: 'PLAIN-B' });
  const live = listLiveDeals();
  assert.equal(live.length, 1);
  assert.equal(live[0].ref, 'LIVE-A');
});

test('linkedCounterparties resolves supplier + buyer records', () => {
  resetTradeStore();
  const sup = createSupplier({ name: 'Fixture Supplier', country: 'Fixtureland' });
  const buy = createSupplier({
    name: 'Fixture Buyer',
    country: 'Fixtureland',
    role: 'buyer',
  });
  const r = createRfq({
    ref: 'LINK-1',
    supplierId: sup.id,
    buyerId: buy.id,
  });
  const { supplier, buyer } = linkedCounterparties(r.id);
  assert.equal(supplier.id, sup.id);
  assert.equal(buyer.id, buy.id);
  const empty = linkedCounterparties(r.id === 'x' ? 'nope' : 'nope');
  assert.deepEqual(empty, { supplier: null, buyer: null });
  const unlinked = createRfq({ ref: 'LINK-2' });
  const none = linkedCounterparties(unlinked.id);
  assert.equal(none.supplier, null);
  assert.equal(none.buyer, null);
});

test('setVerification updates the verification state', () => {
  resetTradeStore();
  const s = createSupplier({ name: 'Fixture Co', country: 'Fixtureland' });
  assert.equal(s.verification, 'unverified');
  const updated = setVerification(s.id, 'verified');
  assert.equal(updated.verification, 'verified');
  assert.equal(setVerification('missing', 'verified'), null);
  const coerced = setVerification(s.id, 'bogus');
  assert.equal(coerced.verification, 'unverified', 'unknown coerces to unverified');
});

test('intake fields survive a getRfq round-trip', () => {
  resetTradeStore();
  const r = createRfq({ ref: 'INTAKE-4', desk: 'trade', liveDeal: true });
  const back = getRfq(r.id);
  assert.equal(back.intakeAt, r.intakeAt);
  assert.equal(back.desk, 'trade');
  assert.equal(back.liveDeal, true);
});
