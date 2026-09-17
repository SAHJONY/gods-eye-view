import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  safeNum,
  formatMoney,
  formatPct,
  MY_CUBA_CASH_FEES,
  FEE_TIERS,
  platformFee,
  providerFee,
  corridorMath,
  missingFields,
  corridorVerdict,
  compareProviders,
  scoreProvider,
} from './corridorEngine.js';

test('safeNum coerces junk to fallback', () => {
  assert.equal(safeNum('abc'), 0);
  assert.equal(safeNum(-5), 0);
  assert.equal(safeNum(NaN), 0);
  assert.equal(safeNum('10'), 10);
  assert.equal(safeNum(null), 0); // Number(null) → 0, same convention as crude
  assert.equal(safeNum('abc', 7), 7);
});

test('formatMoney and formatPct format sensibly', () => {
  assert.equal(formatMoney(1234.5), '$1,234.50');
  assert.equal(formatMoney('nope'), '$0.00');
  assert.equal(formatPct(1.25), '1.25%');
  assert.equal(formatPct(NaN), '0.00%');
});

test('MY_CUBA_CASH_FEES carries the real beta fee schedule', () => {
  assert.equal(MY_CUBA_CASH_FEES.family.pct, 1.25);
  assert.equal(MY_CUBA_CASH_FEES.family.min, 1);
  assert.equal(MY_CUBA_CASH_FEES.family.max, 12);
  assert.equal(MY_CUBA_CASH_FEES.business.pct, 1.75);
  assert.equal(MY_CUBA_CASH_FEES.marketplace.pct, 2.5);
  assert.ok(Object.isFrozen(MY_CUBA_CASH_FEES));
  assert.deepEqual(FEE_TIERS, ['family', 'business', 'marketplace']);
});

test('platformFee applies the tier schedule with caps', () => {
  // family 1.25%: $100 → $1.25
  assert.equal(platformFee(100, 'family'), 1.25);
  // min $1: $10 → raw $0.125, floored to $1
  assert.equal(platformFee(10, 'family'), 1);
  // max $12: $5000 → raw $62.50, capped to $12
  assert.equal(platformFee(5000, 'family'), 12);
  // business 1.75%, no cap: $1000 → $17.50
  assert.equal(platformFee(1000, 'business'), 17.5);
  // marketplace 2.5%: $200 → $5
  assert.equal(platformFee(200, 'marketplace'), 5);
  // junk
  assert.equal(platformFee(0, 'family'), null);
  assert.equal(platformFee(-5, 'family'), null);
  assert.equal(platformFee(100, 'nope'), null);
  assert.equal(platformFee(NaN, 'family'), null);
});

test('providerFee computes only from disclosed models', () => {
  const pct = { feeModel: { type: 'percentage', pct: 2 } };
  assert.deepEqual(providerFee(100, pct).fee, 2);
  const flat = { feeModel: { type: 'flat', flat: 4.99 } };
  assert.deepEqual(providerFee(100, flat).fee, 4.99);
  const mixed = { feeModel: { type: 'mixed', pct: 1, flat: 2 } };
  assert.deepEqual(providerFee(100, mixed).fee, 3);
  const capped = { feeModel: { type: 'percentage', pct: 10, max: 5 } };
  assert.deepEqual(providerFee(1000, capped).fee, 5);
  const floored = { feeModel: { type: 'percentage', pct: 1, min: 3 } };
  assert.deepEqual(providerFee(100, floored).fee, 3);
  // undisclosed → null, never invented
  assert.equal(providerFee(100, { feeModel: { type: 'undisclosed' } }), null);
  assert.equal(providerFee(100, {}), null);
  assert.equal(providerFee(100, null), null);
  assert.equal(providerFee(0, pct), null);
});

test('corridorMath computes received amounts, nulls on missing input', () => {
  const m = corridorMath({ sendAmount: 100, fee: 1.25, fxRate: 100 });
  assert.equal(m.sendAmount, 100);
  assert.equal(m.fee, 1.25);
  assert.equal(m.netSend, 98.75);
  assert.equal(m.receivedAmount, 9875);
  assert.equal(m.effectiveFeePct, 1.25);
  const noRate = corridorMath({ sendAmount: 100, fee: 1.25 });
  assert.equal(noRate.fxRate, null);
  assert.equal(noRate.receivedAmount, null);
  const noFee = corridorMath({ sendAmount: 100, fxRate: 100 });
  assert.equal(noFee.fee, null);
  assert.equal(noFee.effectiveFeePct, null);
  assert.equal(noFee.receivedAmount, null);
  const junk = corridorMath({ sendAmount: 'abc' });
  assert.equal(junk.sendAmount, null);
  assert.equal(junk.receivedAmount, null);
});

test('missingFields reports bilingual gaps', () => {
  const missing = missingFields({});
  assert.equal(missing.length, 5);
  for (const m of missing) {
    assert.ok(m.es && m.en && m.field);
  }
  const partial = missingFields({ sendAmount: 50 });
  assert.ok(!partial.some((m) => m.field === 'sendAmount'));
});

test('corridorVerdict is gray without data, tiered by effective fee', () => {
  const gray = corridorVerdict({});
  assert.equal(gray.tier, 'gray');
  assert.ok(gray.es.includes('Faltan datos'));
  const noRate = corridorVerdict({ sendAmount: 100, fee: 1 });
  assert.equal(noRate.tier, 'gray');
  const green = corridorVerdict({ sendAmount: 100, fee: 1.25, fxRate: 100 });
  assert.equal(green.tier, 'green');
  const yellow = corridorVerdict({ sendAmount: 100, fee: 4, fxRate: 100 });
  assert.equal(yellow.tier, 'yellow');
  const red = corridorVerdict({ sendAmount: 100, fee: 8, fxRate: 100 });
  assert.equal(red.tier, 'red');
  // fee undisclosed → gray, never guessed
  const noFee = corridorVerdict({ sendAmount: 100, fxRate: 100 });
  assert.equal(noFee.tier, 'gray');
});

test('compareProviders sorts by received amount, flags incomplete rows', () => {
  const a = { id: 'a', name: 'A', feeModel: { type: 'flat', flat: 1 } };
  const b = { id: 'b', name: 'B', feeModel: { type: 'flat', flat: 5 } };
  const c = { id: 'c', name: 'C', feeModel: { type: 'undisclosed' } };
  const rows = compareProviders({
    amount: 100,
    providers: [b, a, c],
    fxByProvider: {
      a: { rate: 100, asOf: '2026-09-17' },
      b: { rate: 100, asOf: '2026-09-17' },
      c: { rate: 100, asOf: '2026-09-17' },
    },
  });
  assert.equal(rows[0].providerId, 'a'); // lowest fee → most received
  assert.equal(rows[1].providerId, 'b');
  assert.equal(rows[2].providerId, 'c'); // incomplete → last
  assert.equal(rows[2].complete, false);
  assert.ok(rows[2].missing.some((m) => m.en === 'provider fee'));
  // rate missing → incomplete
  const rows2 = compareProviders({
    amount: 100,
    providers: [a],
    fxByProvider: {},
  });
  assert.equal(rows2[0].complete, false);
  assert.equal(rows2[0].receivedAmount, null);
  assert.equal(rows2[0].fxAsOf, '');
});

test('scoreProvider rewards only present data', () => {
  assert.equal(scoreProvider(null), 0);
  assert.equal(scoreProvider({}), 0);
  const full = {
    name: 'X',
    channels: ['app'],
    coverageCountries: ['USA'],
    feeModel: { type: 'flat', flat: 2 },
    website: 'https://x.example',
    lat: 25,
    lng: -80,
  };
  assert.equal(scoreProvider(full), 100);
  const thin = { name: 'Y', feeModel: { type: 'undisclosed' } };
  assert.equal(scoreProvider(thin), 25);
});
