import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commissionPerBblFromTotal,
  commissionShareOfSpread,
  netback,
  cargoPnL,
  BROKER_BASIS,
} from './cargoEngine.js';

test('commissionPerBblFromTotal: total / volume', () => {
  assert.equal(
    commissionPerBblFromTotal({ volumeBbl: 500000, commissionTotal: 50000 }),
    0.1,
  );
  assert.equal(commissionPerBblFromTotal({ volumeBbl: 0, commissionTotal: 1 }), 0);
  assert.equal(commissionPerBblFromTotal({}), 0);
  assert.equal(commissionPerBblFromTotal(), 0);
});

test('commissionShareOfSpread: share of the spread, 0 when no spread', () => {
  assert.equal(
    commissionShareOfSpread({
      commissionPerBbl: 0.1,
      buyPrice: 100,
      sellPrice: 102,
    }),
    0.05,
  );
  assert.equal(
    commissionShareOfSpread({ commissionPerBbl: 0.1, buyPrice: 100, sellPrice: 100 }),
    0,
  );
  assert.equal(
    commissionShareOfSpread({ commissionPerBbl: 0.1, buyPrice: 102, sellPrice: 100 }),
    0,
  );
  assert.equal(commissionShareOfSpread({}), 0);
});

test('netback: benchmark minus explicit per-barrel deductions', () => {
  const nb = netback({
    benchmarkPrice: 104.59,
    freightPerBbl: 2.5,
    insurancePerBbl: 0.35,
    warRiskPerBbl: 0.75,
  });
  assert.equal(nb.benchmarkPrice, 104.59);
  assert.equal(nb.deductions.length, 3);
  assert.equal(nb.totalDeductionsPerBbl, 3.6);
  assert.ok(Math.abs(nb.netbackPerBbl - 100.99) < 1e-9);
  const labels = nb.deductions.map((d) => d.es);
  assert.deepEqual(labels, ['Flete', 'Seguro', 'Riesgo de guerra']);
  assert.ok(nb.deductions.every((d) => d.en && d.es));
});

test('netback: explicit named adjustments are itemized', () => {
  const nb = netback({
    benchmarkPrice: 101.29,
    adjustments: [{ es: 'Descuento calidad', en: 'Quality discount', amountPerBbl: 1.25 }],
  });
  assert.equal(nb.deductions.length, 1);
  assert.equal(nb.deductions[0].es, 'Descuento calidad');
  assert.equal(nb.deductions[0].en, 'Quality discount');
  assert.ok(Math.abs(nb.netbackPerBbl - 100.04) < 1e-9);
});

test('netback: junk input never throws, zero-safe', () => {
  const nb = netback();
  assert.equal(nb.benchmarkPrice, 0);
  assert.equal(nb.netbackPerBbl, 0);
  assert.deepEqual(nb.deductions, []);
  const nb2 = netback({ benchmarkPrice: -5, freightPerBbl: 'abc' });
  assert.equal(nb2.benchmarkPrice, 0);
  assert.deepEqual(nb2.deductions, []);
});

test('cargoPnL: deal vs broker economics stay separate', () => {
  const pnl = cargoPnL({
    volumeBbl: 500000,
    buyPrice: 100,
    sellPrice: 102,
    grade: 'WTI',
    loadPort: 'Port Alpha (fixture)',
    dischargePort: 'Port Beta (fixture)',
    commissionPerBbl: 0.1,
    costs: { freight: 25000, insurance: 5000, inspection: 2000, other: 1000 },
    netback: { benchmarkPrice: 104.59, freightPerBbl: 2.5 },
  });
  assert.equal(pnl.volumeBbl, 500000);
  assert.equal(pnl.spreadPerBbl, 2);
  assert.equal(pnl.deal.grossSpread, 1000000);
  assert.equal(pnl.deal.costsTotal, 33000);
  assert.equal(pnl.deal.netTotal, 967000);
  assert.equal(pnl.broker.commissionPerBbl, 0.1);
  assert.equal(pnl.broker.commissionTotal, 50000);
  assert.ok(pnl.broker.basis.es.includes('corredor'));
  assert.ok(pnl.netback);
  assert.equal(pnl.netback.benchmarkPrice, 104.59);
  assert.ok(pnl.netback.netbackPerBbl < 104.59);
  assert.equal(pnl.missing.length, 0);
});

test('cargoPnL: no benchmark → netback is null; missing fields reported', () => {
  const pnl = cargoPnL({ volumeBbl: 1000 });
  assert.equal(pnl.netback, null);
  assert.equal(pnl.deal.netPerBbl, 0);
  assert.ok(pnl.missing.some((m) => m.field === 'buyPrice'));
  assert.ok(pnl.missing.some((m) => m.field === 'sellPrice'));
  const junk = cargoPnL('nope');
  assert.equal(junk.volumeBbl, 0);
  assert.equal(junk.broker.commissionTotal, 0);
});

test('BROKER_BASIS: fee-only positioning in both languages', () => {
  assert.ok(BROKER_BASIS.es.includes('corredor por comisión'));
  assert.ok(BROKER_BASIS.en.toLowerCase().includes('commission broker'));
  assert.ok(BROKER_BASIS.en.includes('zero capital at risk'));
});
