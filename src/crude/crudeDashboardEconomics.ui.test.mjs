import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure dashboard helpers only — no DOM double needed for these.
const {
  diligencePillClass,
  diligenceLabel,
  economicsRows,
  toEngineCargo,
  cargoFieldValue,
  FIELD_ALIASES,
  todayChicago,
} = await import('./crudeDashboard.js');

test('diligencePillClass: clear→green, pending→yellow, escalate→red', () => {
  assert.equal(diligencePillClass('clear'), 'green');
  assert.equal(diligencePillClass('pending'), 'yellow');
  assert.equal(diligencePillClass('escalate'), 'red');
  assert.equal(diligencePillClass('bogus'), 'yellow');
  assert.equal(diligenceLabel('escalate', 'es'), 'ESCALADO — revisar sanciones');
  assert.equal(diligenceLabel('clear', 'en'), 'Diligence clear');
});

test('economicsRows: commission rows always, netback only with a benchmark', () => {
  const noNb = economicsRows({ volumeBbl: 500000, commissionPerBbl: 0.1 }, 'es');
  assert.equal(noNb.commission.length, 2);
  assert.equal(noNb.netback, null);
  assert.equal(noNb.commission[0].value, '$0.10');
  assert.ok(noNb.commission[1].value.includes('$50,000'));

  const withNb = economicsRows(
    {
      volumeBbl: 500000,
      commissionPerBbl: 0.1,
      netback: { benchmarkPrice: 104.59, freightPerBbl: 2.5 },
    },
    'en',
  );
  assert.ok(withNb.netback);
  assert.equal(withNb.netback.benchmark.value, '$104.59');
  assert.equal(withNb.netback.deductions.length, 1);
  assert.equal(withNb.netback.netbackPerBbl.value, '$102.09');
});

test('economicsRows: bilingual labels, junk-safe', () => {
  const rows = economicsRows(null, 'es');
  assert.equal(rows.commission[0].es, 'Comisión ($/bbl)');
  assert.equal(rows.commission[0].en, 'Commission ($/bbl)');
  assert.equal(rows.netback, null);
});

test('toEngineCargo: normalizes both cargo shapes', () => {
  const real = toEngineCargo({
    volumeBbl: 500000,
    buyPrice: 100,
    sellPrice: 102,
    costs: { freight: 1, insurance: 2, inspection: 3, other: 4 },
    benchmarkPrice: 104.59,
  });
  assert.equal(real.volumeBbl, 500000);
  assert.deepEqual(real.costs, {
    freight: 1,
    insurance: 2,
    inspection: 3,
    other: 4,
  });
  const mem = toEngineCargo({ volume: 500000, buy: 100, sell: 102, costs: 25000 });
  assert.equal(mem.volumeBbl, 500000);
  assert.equal(mem.buyPrice, 100);
  assert.equal(mem.costs.other, 25000);
  const junk = toEngineCargo('nope');
  assert.equal(junk.volumeBbl, undefined); // missing stays missing; the engine coerces
});

test('cargoFieldValue: store shape wins, alias falls back', () => {
  assert.equal(cargoFieldValue({ volume: 10, volumeBbl: 20 }, 'volume'), 10);
  assert.equal(cargoFieldValue({ volumeBbl: 20 }, 'volume'), 20);
  assert.equal(cargoFieldValue({}, 'volume'), undefined);
  assert.equal(cargoFieldValue({ grade: 'WTI' }, 'grade'), 'WTI');
  assert.deepEqual(FIELD_ALIASES, {
    volume: 'volumeBbl',
    buy: 'buyPrice',
    sell: 'sellPrice',
  });
});

test('todayChicago: YYYY-MM-DD shape', () => {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(todayChicago()));
});
