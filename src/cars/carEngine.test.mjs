import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  safeNum,
  formatMoney,
  dealSpread,
  brokerFee,
  spreadPct,
  spreadVerdict,
  scoreLead,
  qualificationVerdict,
  pricePosition,
  PRICE_POSITION_LABELS,
  summarizeModelPricing,
} from './carEngine.js';

// All figures are clearly samples. The engine is pure — no I/O, no DOM.
// These math helpers are INTERNAL decision support and are never rendered
// by the dashboard (tested separately in the ui test).

test('safeNum and formatMoney never throw on bad input', () => {
  assert.equal(safeNum('nope'), 0);
  assert.equal(safeNum(-5), 0);
  assert.equal(safeNum(null), 0);
  assert.equal(formatMoney('nope'), '$0');
  assert.equal(formatMoney(99999), '$99,999');
});

test('internal deal spread math (pure, never rendered)', () => {
  assert.equal(dealSpread({ buyerPrice: 99999, internalAllInCost: 88888 }), 11111);
  assert.equal(dealSpread({}), 0);
  assert.ok(
    Math.abs(brokerFee({ buyerPrice: 99999, commissionPct: 0.05 }) - 4999.95) < 1e-6,
    `expected 4999.95, got ${brokerFee({ buyerPrice: 99999, commissionPct: 0.05 })}`,
  );
  assert.equal(spreadPct({ buyerPrice: 99999, internalAllInCost: 88888 }) > 0, true);
  assert.equal(spreadPct({ buyerPrice: 0, internalAllInCost: 88888 }), 0);
});

test('spreadVerdict tiers against a runtime target', () => {
  const green = spreadVerdict({
    buyerPrice: 99999,
    internalAllInCost: 88888,
    targetSpread: 7777, // obviously fictional — never a real business figure
  });
  assert.equal(green.tier, 'green');
  const red = spreadVerdict({
    buyerPrice: 99999,
    internalAllInCost: 99000,
    targetSpread: 7777, // obviously fictional — never a real business figure
  });
  assert.equal(red.tier, 'red');
  const gray = spreadVerdict({ buyerPrice: 99999 });
  assert.equal(gray.tier, 'gray');
  assert.equal(gray.reasons.length > 0, true);
  const yellow = spreadVerdict({
    buyerPrice: 99999,
    internalAllInCost: 94000,
    targetSpread: 7777, // obviously fictional — never a real business figure
  });
  assert.equal(yellow.tier, 'yellow');
});

test('lead scoring from lead data only', () => {
  const full = scoreLead(
    {
      name: 'Sample Buyer',
      whatsapp: '+1 555-0100',
      interest: 'Hyundai Elantra (preliminary)',
      budgetUsd: 99999,
      lastContactAt: '2026-09-17T10:00:00-05:00',
      notes: [{ at: 'x', text: 'nota' }],
      stage: 'contactado',
    },
    24900, // buyer-facing model price powers the budget-fit check
  );
  assert.ok(full.score >= 80, `score ${full.score}`);
  assert.equal(full.missing.length, 0);

  const bare = scoreLead({ name: 'Sample Buyer' });
  assert.ok(bare.score < 40, `score ${bare.score}`);
  assert.ok(bare.missing.some((m) => m.field === 'contact'));

  // Budget fit check against the model price.
  const under = scoreLead(
    { whatsapp: '+1 555-0100', interest: 'M', budgetUsd: 5000, stage: 'nuevo', notes: [] },
    99999,
  );
  assert.ok(under.missing.some((m) => m.field === 'budgetFit'));

  assert.equal(scoreLead(null).score, 0);
  assert.equal(scoreLead(undefined).score, 0);
});

test('qualification verdict tiers', () => {
  assert.equal(qualificationVerdict(scoreLead({})).tier, 'red');
  const v = qualificationVerdict({
    score: 75,
    missing: [{ field: 'x', es: 'falta x', en: 'missing x' }],
  });
  assert.equal(v.tier, 'green');
  assert.equal(v.reasons.length, 1);
  assert.equal(qualificationVerdict({ score: 50, missing: [] }).tier, 'yellow');
});

test('price position: under / over / equal / unknown', () => {
  assert.deepEqual(pricePosition(77777, 99999), { position: 'under', diff: 22222 });
  assert.deepEqual(pricePosition(99999, 77777), { position: 'over', diff: -22222 });
  assert.deepEqual(pricePosition(99999, 99950), { position: 'equal', diff: -49 });
  assert.deepEqual(pricePosition(null, 99999), { position: 'unknown', diff: 0 });
  assert.deepEqual(pricePosition(99999, null), { position: 'unknown', diff: 0 });
  for (const key of ['under', 'over', 'equal', 'unknown']) {
    assert.ok(PRICE_POSITION_LABELS[key]?.es);
    assert.ok(PRICE_POSITION_LABELS[key]?.en);
  }
});

test('summarizeModelPricing aggregates buyer-facing snapshots', () => {
  const snaps = [
    { model: 'Sample Model (fictional)', price: 99999 },
    { model: 'Sample Model (fictional)', price: 88888 },
    { model: 'Other Model (fictional)', price: 77777 },
  ];
  const s = summarizeModelPricing('sample model (FICTIONAL)', snaps, 77777);
  assert.equal(s.count, 2);
  assert.equal(s.min, 88888);
  assert.equal(s.max, 99999);
  assert.equal(s.under, 2);
  assert.equal(s.over, 0);
  assert.equal(s.equal, 0);
  assert.equal(s.ourPrice, 77777);
  const noOur = summarizeModelPricing('Sample Model (fictional)', snaps, null);
  assert.equal(noOur.ourPrice, null);
  assert.equal(noOur.unknown, 2);
});
