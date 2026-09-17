import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeNum,
  formatMoney,
  formatBbl,
  spreadPerBbl,
  grossMargin,
  totalCosts,
  netMargin,
  brokerCommission,
  netPerBbl,
  missingFields,
  cargoVerdict,
  scoreCargo,
  GRADE_PRESETS,
  INCOTERMS,
  VERDICT_TIERS,
} from './cargoEngine.js';

test('safeNum: finite non-negative values pass through', () => {
  assert.equal(safeNum(12), 12);
  assert.equal(safeNum('12.5'), 12.5);
  assert.equal(safeNum(0), 0);
});

test('safeNum: bad input falls back', () => {
  assert.equal(safeNum(), 0);
  assert.equal(safeNum('abc'), 0);
  assert.equal(safeNum(NaN), 0);
  assert.equal(safeNum(Infinity), 0);
  assert.equal(safeNum(-5), 0);
  assert.equal(safeNum(null), 0); // Number(null) is 0 — finite and non-negative
  assert.equal(safeNum('abc', 42), 42);
  assert.equal(safeNum(undefined, 7), 7);
});

test('formatMoney: USD with commas, no decimals', () => {
  assert.equal(formatMoney(1250000), '$1,250,000');
  assert.equal(formatMoney(0), '$0');
  assert.equal(formatMoney(99.9), '$100');
});

test('formatMoney: bad input -> "$0"', () => {
  assert.equal(formatMoney('abc'), '$0');
  assert.equal(formatMoney(), '$0');
  assert.equal(formatMoney(NaN), '$0');
});

test('formatBbl: volume with "bbl" suffix', () => {
  assert.equal(formatBbl(1250000), '1,250,000 bbl');
  assert.equal(formatBbl(0), '0 bbl');
  assert.equal(formatBbl('abc'), '0 bbl');
  assert.equal(formatBbl(), '0 bbl');
});

test('spreadPerBbl: sell minus buy, can be negative', () => {
  assert.equal(spreadPerBbl({ buyPrice: 50, sellPrice: 60 }), 10);
  assert.equal(spreadPerBbl({ buyPrice: 60, sellPrice: 50 }), -10);
  assert.equal(spreadPerBbl({}), 0);
  assert.equal(spreadPerBbl(), 0);
});

test('grossMargin: volume * spread', () => {
  assert.equal(
    grossMargin({ volumeBbl: 100000, buyPrice: 50, sellPrice: 60 }),
    1000000,
  );
  assert.equal(
    grossMargin({ volumeBbl: 100000, buyPrice: 60, sellPrice: 50 }),
    -1000000,
  );
  assert.equal(grossMargin({}), 0);
});

test('totalCosts: sums the four cost buckets', () => {
  assert.equal(
    totalCosts({ freight: 100, insurance: 50, inspection: 25, other: 25 }),
    200,
  );
  assert.equal(totalCosts({ freight: 100 }), 100);
  assert.equal(totalCosts({}), 0);
  assert.equal(totalCosts(), 0);
});

test('netMargin: gross minus costs', () => {
  const cargo = {
    volumeBbl: 100000,
    buyPrice: 50,
    sellPrice: 60,
    costs: {
      freight: 100000,
      insurance: 50000,
      inspection: 25000,
      other: 25000,
    },
  };
  // 1,000,000 - 200,000 = 800,000
  assert.equal(netMargin(cargo), 800000);
});

test('netMargin: never throws on bad input', () => {
  assert.equal(netMargin(), 0);
  assert.equal(netMargin(null), 0);
  assert.equal(netMargin({ volumeBbl: 100 }), 0);
});

test('brokerCommission: volume * commissionPerBbl', () => {
  assert.equal(
    brokerCommission({ volumeBbl: 100000, commissionPerBbl: 0.5 }),
    50000,
  );
  assert.equal(brokerCommission({ volumeBbl: 0, commissionPerBbl: 2 }), 0);
  assert.equal(brokerCommission({}), 0);
});

test('netPerBbl: net margin divided by volume', () => {
  const cargo = {
    volumeBbl: 100000,
    buyPrice: 50,
    sellPrice: 60,
    costs: { freight: 0, insurance: 0, inspection: 0, other: 0 },
  };
  assert.equal(netPerBbl(cargo), 10);
});

test('netPerBbl: 0 on missing/zero volume', () => {
  assert.equal(netPerBbl({}), 0);
  assert.equal(netPerBbl({ volumeBbl: 0, buyPrice: 50, sellPrice: 60 }), 0);
  assert.equal(netPerBbl(), 0);
});

test('missingFields: reports all six fields for an empty cargo', () => {
  const fields = missingFields({});
  assert.equal(fields.length, 6);
  assert.deepEqual(
    fields.map((f) => f.field),
    [
      'buyPrice',
      'sellPrice',
      'volumeBbl',
      'grade',
      'loadPort',
      'dischargePort',
    ],
  );
  for (const f of fields) assert.ok(f.es && f.en);
});

test('missingFields: empty result for a complete cargo', () => {
  const cargo = {
    buyPrice: 50,
    sellPrice: 60,
    volumeBbl: 100000,
    grade: 'WTI',
    loadPort: 'PORT ALPHA (fixture)',
    dischargePort: 'PORT BETA (fixture)',
  };
  assert.deepEqual(missingFields(cargo), []);
});

test('missingFields: zero prices count as missing; never throws', () => {
  const fields = missingFields({ buyPrice: 0, sellPrice: 60 });
  assert.ok(fields.some((f) => f.field === 'buyPrice'));
  assert.equal(missingFields().length, 6);
  assert.equal(missingFields(null).length, 6);
});

test('cargoVerdict: gray when prices or volume are missing', () => {
  const v = cargoVerdict({ grade: 'WTI' });
  assert.equal(v.tier, 'gray');
  assert.equal(v.es, 'Faltan datos');
  assert.equal(v.en, 'Missing data');
  assert.ok(v.reasons.some((r) => r.en.startsWith('Missing:')));
});

test('cargoVerdict: green when netPerBbl >= 2', () => {
  const v = cargoVerdict({
    volumeBbl: 100000,
    buyPrice: 50,
    sellPrice: 60,
    costs: { freight: 0, insurance: 0, inspection: 0, other: 0 },
  });
  assert.equal(v.tier, 'green');
  assert.equal(v.es, 'Viable');
  assert.equal(v.en, 'Viable');
});

test('cargoVerdict: yellow when netPerBbl between 0.5 and 2', () => {
  const v = cargoVerdict({
    volumeBbl: 100000,
    buyPrice: 50,
    sellPrice: 51,
    costs: { freight: 0, insurance: 0, inspection: 0, other: 0 },
  });
  assert.equal(v.tier, 'yellow');
  assert.equal(v.es, 'Marginal');
  assert.equal(v.en, 'Marginal');
});

test('cargoVerdict: red when netPerBbl < 0.5', () => {
  const v = cargoVerdict({
    volumeBbl: 100000,
    buyPrice: 60,
    sellPrice: 50,
    costs: { freight: 0, insurance: 0, inspection: 0, other: 0 },
  });
  assert.equal(v.tier, 'red');
  assert.equal(v.es, 'No viable');
  assert.equal(v.en, 'No deal');
});

test('cargoVerdict: reasons always include spread, net, commission lines', () => {
  for (const cargo of [
    {},
    { volumeBbl: 100000, buyPrice: 50, sellPrice: 60 },
    { volumeBbl: 100000, buyPrice: 60, sellPrice: 50 },
  ]) {
    const v = cargoVerdict(cargo);
    const esText = v.reasons.map((r) => r.es).join(' | ');
    const enText = v.reasons.map((r) => r.en).join(' | ');
    assert.ok(esText.includes('Margen por barril'), JSON.stringify(v.reasons));
    assert.ok(esText.includes('Neto por barril'));
    assert.ok(esText.includes('Comisión total'));
    assert.ok(enText.includes('Spread per barrel'));
    assert.ok(enText.includes('Net per barrel'));
    assert.ok(enText.includes('Total commission'));
  }
});

test('cargoVerdict: never throws on bad input', () => {
  assert.equal(cargoVerdict().tier, 'gray');
  assert.equal(cargoVerdict(null).tier, 'gray');
});

test('scoreCargo: complete cargo scores 100', () => {
  const cargo = {
    buyPrice: 50,
    sellPrice: 60,
    volumeBbl: 100000,
    supplierId: 'cp-1',
    incoterms: 'FOB',
    laycanStart: '2026-10-01',
    laycanEnd: '2026-10-10',
    costs: { freight: 100, insurance: 50, inspection: 25, other: 25 },
    grade: 'WTI',
    loadPort: 'PORT ALPHA (fixture)',
    dischargePort: 'PORT BETA (fixture)',
  };
  assert.equal(scoreCargo(cargo), 100);
});

test('scoreCargo: empty cargo scores 0', () => {
  assert.equal(scoreCargo({}), 0);
  assert.equal(scoreCargo(), 0);
  assert.equal(scoreCargo(null), 0);
});

test('scoreCargo: prices 30, volume 20, counterparty 15', () => {
  assert.equal(scoreCargo({ buyPrice: 50, sellPrice: 60 }), 30);
  assert.equal(scoreCargo({ volumeBbl: 100000 }), 20);
  assert.equal(scoreCargo({ buyerId: 'cp-1' }), 15);
  assert.equal(
    scoreCargo({ buyPrice: 50, sellPrice: 60, volumeBbl: 100000 }),
    50,
  );
});

test('scoreCargo: incoterms 5, laycan pair 5, costs 15, grade 5, ports 5', () => {
  assert.equal(scoreCargo({ incoterms: 'CIF' }), 5);
  assert.equal(
    scoreCargo({ laycanStart: '2026-10-01', laycanEnd: '2026-10-10' }),
    5,
  );
  assert.equal(scoreCargo({ laycanStart: '2026-10-01' }), 0);
  assert.equal(
    scoreCargo({
      costs: { freight: 0, insurance: 0, inspection: 0, other: 0 },
    }),
    15,
  );
  assert.equal(scoreCargo({ costs: { freight: 0 } }), 0);
  assert.equal(scoreCargo({ grade: 'WTI' }), 5);
  assert.equal(
    scoreCargo({
      loadPort: 'PORT ALPHA (fixture)',
      dischargePort: 'PORT BETA (fixture)',
    }),
    5,
  );
  assert.equal(scoreCargo({ loadPort: 'PORT ALPHA (fixture)' }), 0);
});

test('scoreCargo: capped at 100', () => {
  const cargo = {
    buyPrice: 50,
    sellPrice: 60,
    volumeBbl: 100000,
    supplierId: 'cp-1',
    buyerId: 'cp-2',
    incoterms: 'FOB',
    laycanStart: '2026-10-01',
    laycanEnd: '2026-10-10',
    costs: { freight: 1, insurance: 1, inspection: 1, other: 1 },
    grade: 'Brent',
    loadPort: 'PORT ALPHA (fixture)',
    dischargePort: 'PORT BETA (fixture)',
  };
  assert.equal(scoreCargo(cargo), 100);
});

test('constants are frozen with the expected values', () => {
  assert.ok(Object.isFrozen(GRADE_PRESETS));
  assert.ok(Object.isFrozen(INCOTERMS));
  assert.ok(Object.isFrozen(VERDICT_TIERS));
  assert.deepEqual(GRADE_PRESETS, [
    'WTI',
    'Brent',
    'Maya',
    'Urals',
    'Dubai',
    'Bonny Light',
    'Arab Light',
  ]);
  assert.deepEqual(INCOTERMS, ['FOB', 'CIF', 'DAP']);
  assert.deepEqual(VERDICT_TIERS, ['green', 'yellow', 'red', 'gray']);
});
