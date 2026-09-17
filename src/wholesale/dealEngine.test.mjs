import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maxAllowableOffer,
  assignmentFee,
  rankBuyer,
  scoreLead,
  dealVerdict,
  formatMoney,
} from './dealEngine.js';

test('maxAllowableOffer: standard 70% rule', () => {
  // 200k * 0.70 - 40k repairs - 15k fee = 85k
  assert.equal(
    maxAllowableOffer({ arv: 200000, repairs: 40000, targetFee: 15000 }),
    85000,
  );
});

test('maxAllowableOffer: honors custom pct', () => {
  // 200k * 0.75 - 40k - 15k = 95k
  assert.equal(
    maxAllowableOffer({ arv: 200000, repairs: 40000, targetFee: 15000, pct: 0.75 }),
    95000,
  );
});

test('maxAllowableOffer: floors at 0 instead of going negative', () => {
  assert.equal(
    maxAllowableOffer({ arv: 100000, repairs: 90000, targetFee: 20000 }),
    0,
  );
});

test('maxAllowableOffer: bad inputs are safe (no throw)', () => {
  assert.equal(maxAllowableOffer(), 0);
  assert.equal(maxAllowableOffer({ arv: NaN, repairs: -5, targetFee: 'abc' }), 0);
  assert.equal(maxAllowableOffer({ arv: 200000, repairs: 0, targetFee: 0, pct: 99 }), 140000);
  assert.equal(
    maxAllowableOffer({ arv: Infinity, repairs: 0, targetFee: 0 }),
    0,
  );
});

test('assignmentFee: buyer max minus contract price', () => {
  assert.equal(
    assignmentFee({ buyerMaxOffer: 150000, contractPrice: 120000 }),
    30000,
  );
  assert.equal(assignmentFee({ buyerMaxOffer: 100000, contractPrice: 100000 }), 0);
  assert.equal(assignmentFee({}), 0);
});

test('rankBuyer: green when fee >= targetFee', () => {
  const r = rankBuyer({ buyerMaxOffer: 150000, contractPrice: 120000, targetFee: 25000 });
  assert.equal(r.tier, 'green');
  assert.equal(r.fee, 30000);
  assert.ok(r.note.es && r.note.en);
});

test('rankBuyer: yellow when fee is positive but below target', () => {
  const r = rankBuyer({ buyerMaxOffer: 130000, contractPrice: 120000, targetFee: 25000 });
  assert.equal(r.tier, 'yellow');
  assert.equal(r.fee, 10000);
  assert.match(r.note.es, /10,000/);
});

test('rankBuyer: red when no fee, shows contract price needed', () => {
  const r = rankBuyer({ buyerMaxOffer: 120000, contractPrice: 125000, targetFee: 25000 });
  assert.equal(r.tier, 'red');
  assert.equal(r.fee, -5000);
  // buyerMaxOffer - targetFee = 95k
  assert.match(r.note.es, /95,000/);
  assert.match(r.note.en, /95,000/);
});

test('rankBuyer: zero fee is red', () => {
  const r = rankBuyer({ buyerMaxOffer: 100000, contractPrice: 100000, targetFee: 10000 });
  assert.equal(r.tier, 'red');
});

test('scoreLead: condition severity uses max, not sum', () => {
  // vacant(25) + fire(20) would be 45 if summed; max gives 25
  const lead = { condition: ['vacant', 'fire'] };
  assert.equal(scoreLead(lead), 25);
});

test('scoreLead: distress flags and completeness stack', () => {
  // vacant 25 + taxDelinquent 20 + absenteeOwner 10 + owner 15 + lat/lng 10 = 80
  const lead = {
    condition: 'vacant',
    distress: ['taxDelinquent', 'absenteeOwner'],
    owner: 'Maria Gonzalez',
    lat: 29.76,
    lng: -95.36,
  };
  assert.equal(scoreLead(lead), 80);
});

test('scoreLead: capped at 100', () => {
  const lead = {
    condition: 'vacant',
    distress: ['taxDelinquent', 'absenteeOwner', 'vacantLand'],
    owner: 'Test Owner',
    lat: 29.76,
    lng: -95.36,
  };
  assert.ok(scoreLead(lead) <= 100);
});

test('scoreLead: unknown conditions score as other, missing fields score 0', () => {
  assert.equal(scoreLead({ condition: 'something-weird' }), 5);
  assert.equal(scoreLead({}), 0);
  assert.equal(scoreLead(null), 0);
});

test('dealVerdict: thresholds green/yellow/red', () => {
  assert.deepEqual(dealVerdict(70), {
    tier: 'green',
    es: 'Oferta fuerte',
    en: 'Strong offer',
  });
  assert.deepEqual(dealVerdict(95), {
    tier: 'green',
    es: 'Oferta fuerte',
    en: 'Strong offer',
  });
  assert.deepEqual(dealVerdict(69), {
    tier: 'yellow',
    es: 'Analizar',
    en: 'Analyze',
  });
  assert.deepEqual(dealVerdict(40), {
    tier: 'yellow',
    es: 'Analizar',
    en: 'Analyze',
  });
  assert.deepEqual(dealVerdict(39), {
    tier: 'red',
    es: 'Descartar',
    en: 'Pass',
  });
});

test('dealVerdict: bad input defaults to red pass', () => {
  assert.equal(dealVerdict(undefined).tier, 'red');
  assert.equal(dealVerdict(NaN).tier, 'red');
});

test('formatMoney: commas, no decimals', () => {
  assert.equal(formatMoney(1234567), '$1,234,567');
  assert.equal(formatMoney(85000.9), '$85,001');
  assert.equal(formatMoney(0), '$0');
  assert.equal(formatMoney(NaN), '$0');
  assert.equal(formatMoney(-500), '$0');
});
