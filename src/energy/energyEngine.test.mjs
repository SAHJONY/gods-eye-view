import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeNum,
  formatMoney,
  formatGal,
  formatMt,
  PRODUCTS,
  PRODUCT_LABELS,
  productLabel,
  PRODUCT_SPECS,
  getSpecSheet,
  REF_DENSITY_KG_L,
  mtToGal,
  galToMt,
  galToBbl,
  bblToGal,
  mtToBbl,
  spreadPerUnit,
  totalSpread,
  brokerFee,
  pricePerGal,
  parcelEconomics,
  GATE_CHECKLIST_TEMPLATE,
  normalizeGateAnswers,
  evaluateGate,
  gateItemCount,
} from './energyEngine.js';

test('safeNum: bad input falls back', () => {
  assert.equal(safeNum('abc'), 0);
  assert.equal(safeNum(-3), 0);
  assert.equal(safeNum('12.5'), 12.5);
});

test('formatMoney / formatGal / formatMt', () => {
  assert.equal(formatMoney(1250000), '$1,250,000');
  assert.equal(formatGal(42000), '42,000 gal');
  assert.equal(formatMt(12.345), '12.35 MT');
});

test('productLabel is bilingual and safe for unknown', () => {
  assert.equal(productLabel('diesel', 'es'), 'Diésel');
  assert.equal(productLabel('lpg', 'en'), 'LPG (propane)');
  assert.equal(productLabel('nope', 'es'), 'nope');
});

test('spec sheets: diesel/gasoline/lpg present, static reference framing', () => {
  for (const p of ['diesel', 'gasoline', 'lpg']) {
    const sheet = getSpecSheet(p);
    assert.ok(sheet, `spec sheet for ${p}`);
    assert.ok(sheet.standard.length > 0);
    assert.ok(Array.isArray(sheet.rows) && sheet.rows.length > 0);
    assert.ok(
      sheet.standardNote.es.length > 0 && sheet.standardNote.en.length > 0,
    );
    for (const row of sheet.rows) {
      assert.ok(row.param.es && row.param.en, 'bilingual param');
      assert.equal(typeof row.value, 'string');
    }
  }
  assert.equal(getSpecSheet('nope'), null);
});

test('diesel spec contains EN 590 sulfur and cetane reference rows', () => {
  const rows = getSpecSheet('diesel').rows;
  const sulfur = rows.find((r) => r.param.en === 'Sulfur (S)');
  assert.ok(sulfur, 'sulfur row');
  assert.equal(sulfur.value, '≤ 10');
  const cetane = rows.find((r) => r.param.en === 'Cetane number');
  assert.ok(cetane, 'cetane row');
  assert.equal(cetane.value, '≥ 51');
});

test('conversions are consistent and reversible', () => {
  const gal = mtToGal('diesel', 10);
  assert.ok(gal > 0);
  assert.ok(Math.abs(galToMt('diesel', gal) - 10) < 1e-9);
  assert.equal(galToBbl(42), 1);
  assert.equal(bblToGal(2), 84);
  assert.ok(mtToBbl('diesel', 1) > 0);
  assert.equal(mtToGal('nope', 10), 0);
  assert.equal(mtToGal('diesel', -5), 0);
});

test('reference densities are positive midpoints', () => {
  for (const p of PRODUCTS) {
    assert.ok(REF_DENSITY_KG_L[p] > 0, p);
  }
});

test('spreadPerUnit / totalSpread / brokerFee: broker spread arithmetic', () => {
  // SAMPLE TEST FIGURES — not live prices; the engine does pure arithmetic.
  assert.equal(spreadPerUnit({ buyPerUnit: 900, sellPerUnit: 950 }), 50);
  assert.equal(spreadPerUnit({}), 0);
  assert.equal(totalSpread({ perUnitSpread: 50, volumeUnits: 100 }), 5000);
  assert.equal(brokerFee({ volumeUnits: 100, feePerUnit: 5 }), 500);
});

test('pricePerGal converts an MT price using the reference density', () => {
  const p = pricePerGal('diesel', 1000);
  assert.ok(p > 0 && p < 10);
  assert.equal(pricePerGal('nope', 1000), 0);
});

test('parcelEconomics: volume in MT, gal and bbl with spread totals', () => {
  const e = parcelEconomics({
    product: 'lpg',
    unit: 'MT',
    volumeMt: 100,
    buyPerUnit: 600,
    sellPerUnit: 640,
    feePerUnit: 5,
  });
  assert.equal(e.product, 'lpg');
  assert.equal(e.volumeMt, 100);
  assert.ok(e.volumeGal > 0 && e.volumeBbl > 0);
  assert.equal(e.perUnitSpread, 40);
  assert.equal(e.totalSpread, 4000);
  assert.equal(e.flatFee, 500);
});

test('parcelEconomics: gallons and barrels convert to MT', () => {
  // SAMPLE TEST FIGURES — not live prices.
  const e = parcelEconomics({
    product: 'diesel',
    unit: 'gal',
    volumeGal: 10000,
    buyPerUnit: 5,
    sellPerUnit: 5.5,
  });
  assert.ok(e.volumeMt > 0);
  assert.equal(e.unit, 'gal');
  assert.ok(Math.abs(e.volumeGal - 10000) / 10000 < 1e-9);
  // Pricing-unit contract: per-unit spread ($/gal) × volume IN GALLONS,
  // never × MT.
  assert.equal(e.perUnitSpread, 0.5);
  assert.ok(Math.abs(e.totalSpread - 0.5 * 10000) < 1e-6);
});

test('parcelEconomics: bbl unit keeps per-unit × volume-in-bbl consistent', () => {
  // SAMPLE TEST FIGURES — not live prices.
  const e = parcelEconomics({
    product: 'diesel',
    unit: 'bbl',
    volumeBbl: 500,
    buyPerUnit: 200,
    sellPerUnit: 210,
    feePerUnit: 2,
  });
  assert.equal(e.perUnitSpread, 10);
  assert.equal(e.totalSpread, 10 * 500);
  assert.equal(e.flatFee, 2 * 500);
});

test('parcelEconomics never throws on garbage', () => {
  const e = parcelEconomics(null);
  assert.equal(e.totalSpread, 0);
  assert.equal(e.volumeMt, 0);
});

test('gate checklist: all-yes passes', () => {
  const answers = {};
  for (const item of GATE_CHECKLIST_TEMPLATE) answers[item.id] = 'yes';
  const r = evaluateGate(answers);
  assert.equal(r.passed, true);
  assert.equal(r.redFlags.length, 0);
  assert.equal(r.unanswered.length, 0);
});

test('gate: ANY no → hard fail with red flags; ANY unknown → not passed', () => {
  const base = {};
  for (const item of GATE_CHECKLIST_TEMPLATE) base[item.id] = 'yes';
  const rNo = evaluateGate({
    ...base,
    'restricted-party-screen': 'no',
  });
  assert.equal(rNo.passed, false);
  assert.equal(rNo.redFlags.length, 1);
  assert.equal(rNo.redFlags[0].id, 'restricted-party-screen');
  const rUnknown = evaluateGate({
    ...base,
    'legal-authorization-basis': 'unknown',
  });
  assert.equal(rUnknown.passed, false);
  assert.equal(rUnknown.unanswered.length, 1);
  // Missing answers count as unknown (never assumed 'yes').
  const rMissing = evaluateGate({});
  assert.equal(rMissing.passed, false);
  assert.equal(rMissing.unanswered.length, gateItemCount());
});

test('normalizeGateAnswers coerces garbage to unknown', () => {
  const n = normalizeGateAnswers({ 'origin-route-documented': 'maybe' });
  assert.equal(n['origin-route-documented'], 'unknown');
  assert.equal(n['private-sector-eligibility'], 'unknown');
});

test('gate item template is bilingual and has the sanctions-screen item', () => {
  const item = GATE_CHECKLIST_TEMPLATE.find(
    (i) => i.id === 'restricted-party-screen',
  );
  assert.ok(item, 'sanctions screening item present');
  assert.ok(item.es.includes('Juan') && item.en.includes('Juan'));
});
