// Unit tests for the Cuba desk deal math engine: cubaEngine.js.
// All fixture values are deliberately fictional. No real buyers, partners,
// prices, or transactions appear anywhere in these fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  safeNum,
  formatMoney,
  formatQty,
  missingFields,
  scoreSourcingRequest,
  requestVerdict,
  requestValue,
  partnerTier,
  buyerCompleteness,
  matchBuyerToRequest,
  rankBuyersForRequest,
  REQUEST_VERDICT_TIERS,
  PARTNER_TIERS,
} from './cubaEngine.js';

const FULL_REQUEST = {
  ref: 'CUBA-900',
  product: 'Arroz pilado',
  quantity: 5000,
  targetPrice: 0.65,
  currency: 'USD',
  buyerId: 'buyer-1',
  incoterms: 'CIF',
  destinationPort: 'Mariel',
  timeline: '30 días',
  notes: 'Nota de prueba ficticia',
};

test('safeNum coerces to finite non-negative', () => {
  assert.equal(safeNum('12'), 12);
  assert.equal(safeNum(-5), 0);
  assert.equal(safeNum('nope'), 0);
  assert.equal(safeNum('nope', 7), 7);
  assert.equal(safeNum(null), 0);
});

test('formatMoney / formatQty', () => {
  assert.equal(formatMoney(1234567), '$1,234,567');
  assert.equal(formatMoney('junk'), '$0');
  assert.equal(formatQty(987654), '987,654');
});

test('scoreSourcingRequest: full record scores high, empty scores 0', () => {
  assert.equal(scoreSourcingRequest({}), 0);
  assert.equal(scoreSourcingRequest(null), 0);
  const score = scoreSourcingRequest(FULL_REQUEST);
  assert.ok(score >= 90, `expected >= 90, got ${score}`);
  const partial = scoreSourcingRequest({ product: 'Aceite' });
  assert.ok(partial > 0 && partial < 40, `partial=${partial}`);
});

test('scoreSourcingRequest caps at 100', () => {
  const score = scoreSourcingRequest({
    ...FULL_REQUEST,
    extra: 'ignored',
  });
  assert.ok(score <= 100);
});

test('missingFields reports absent bilingual fields', () => {
  const missing = missingFields({ product: 'Café' });
  const fields = missing.map((m) => m.field);
  assert.ok(fields.includes('ref'));
  assert.ok(fields.includes('quantity'));
  assert.ok(!fields.includes('product'));
  assert.equal(missing[0].es.length > 0 && missing[0].en.length > 0, true);
});

test('requestVerdict: gray when core data missing', () => {
  const v = requestVerdict({ ref: 'CUBA-901' });
  assert.equal(v.tier, 'gray');
  assert.equal(v.es, 'Faltan datos');
  assert.equal(v.en, 'Missing data');
  assert.ok(v.reasons.length > 0);
});

test('requestVerdict: green/yellow/red by score', () => {
  const green = requestVerdict(FULL_REQUEST);
  assert.equal(green.tier, 'green');
  const yellowish = requestVerdict({
    ref: 'CUBA-902',
    product: 'Frijoles',
    quantity: 100,
  });
  assert.ok(['yellow', 'red', 'gray'].includes(yellowish.tier));
  const weak = requestVerdict({
    ref: 'CUBA-903',
    product: 'Azúcar',
    quantity: 1,
  });
  assert.ok(['yellow', 'red'].includes(weak.tier));
});

test('requestVerdict never throws on bad input', () => {
  assert.doesNotThrow(() => requestVerdict(undefined));
  assert.doesNotThrow(() => requestVerdict('junk'));
  assert.doesNotThrow(() => scoreSourcingRequest(42));
});

test('requestValue: targetPrice*quantity, zero when unpriceable', () => {
  assert.equal(requestValue(FULL_REQUEST), 0.65 * 5000);
  assert.equal(requestValue({ product: 'Arroz' }), 0);
  assert.equal(requestValue(null), 0);
});

test('partnerTier: bronze/silver/gold thresholds', () => {
  assert.equal(partnerTier({}).tier, 'bronze');
  assert.equal(partnerTier({ closedVolume: 9999 }).tier, 'bronze');
  assert.equal(partnerTier({ closedVolume: 10000 }).tier, 'silver');
  assert.equal(partnerTier({ referrals: 10 }).tier, 'silver');
  assert.equal(partnerTier({ closedVolume: 50000 }).tier, 'gold');
  const silver = partnerTier({ closedVolume: 12000 });
  assert.equal(silver.es, 'Plata');
  assert.equal(silver.en, 'Silver');
  assert.ok(silver.progressToNext.usdNeeded > 0);
  const gold = partnerTier({ closedVolume: 60000 });
  assert.equal(gold.progressToNext, null);
});

test('buyerCompleteness: share of present fields', () => {
  assert.equal(buyerCompleteness({}), 0);
  const full = buyerCompleteness({
    name: 'Ficticio',
    type: 'mipyme-privada',
    province: 'La Habana',
    municipality: 'Playa',
    contact: { whatsapp: '+53-555-0100' },
    activity: 'Comercio',
    interestedProducts: ['arroz'],
    verification: 'verified',
  });
  assert.equal(full, 100);
  const partial = buyerCompleteness({ name: 'Ficticio' });
  assert.ok(partial > 0 && partial < 100);
});

test('matchBuyerToRequest: product + verified + whatsapp scoring', () => {
  const buyer = {
    id: 'b1',
    name: 'Comprador Ficticio',
    province: 'Artemisa',
    interestedProducts: ['Arroz pilado', 'Aceite vegetal'],
    verification: 'verified',
    contact: { whatsapp: '+53-555-0199' },
  };
  const score = matchBuyerToRequest(
    { product: 'arroz', destinationPort: 'Mariel' },
    buyer,
  );
  assert.ok(score >= 80, `expected >= 80, got ${score}`);
  assert.equal(matchBuyerToRequest({}, {}), 0);
  assert.equal(matchBuyerToRequest(null, buyer), 0);
});

test('matchBuyerToRequest: no product overlap scores lower', () => {
  const buyer = {
    interestedProducts: ['madera'],
    verification: 'unverified',
    contact: {},
  };
  const score = matchBuyerToRequest({ product: 'arroz' }, buyer);
  assert.ok(score < 50, `expected < 50, got ${score}`);
});

test('rankBuyersForRequest: sorted desc, zero-score filtered', () => {
  const buyers = [
    { id: 'low', name: 'Bajo', interestedProducts: ['madera'] },
    {
      id: 'high',
      name: 'Alto',
      interestedProducts: ['arroz'],
      verification: 'verified',
      contact: { whatsapp: 'x' },
    },
  ];
  const ranked = rankBuyersForRequest({ product: 'arroz' }, buyers);
  assert.equal(ranked[0].buyer.id, 'high');
  assert.ok(ranked[0].score >= ranked[ranked.length - 1].score);
  assert.ok(ranked.every((r) => r.score > 0));
});

test('verdict tiers + partner tiers constants', () => {
  assert.deepEqual(REQUEST_VERDICT_TIERS, ['green', 'yellow', 'red', 'gray']);
  assert.deepEqual(PARTNER_TIERS, ['bronze', 'silver', 'gold']);
});
