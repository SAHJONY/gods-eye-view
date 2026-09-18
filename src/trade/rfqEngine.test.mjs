/**
 * Tests for the broker-economics extensions to rfqEngine.js.
 * SAHJONY is a fee/spread broker: the broker's take is the commission;
 * the spread is reported as deal room, never as broker revenue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  breakEvenUnitPrice,
  spreadPerUnit,
  spreadTotal,
  commissionPerUnit,
  brokerEconomics,
  landedCostUnit,
} from './rfqEngine.js';

const deal = (over = {}) => ({
  product: 'Fixture Product',
  quantity: 210,
  unitCost: 265,
  sellUnitPrice: 300,
  freight: 2000,
  duties: 500,
  otherCosts: 100,
  commissionPct: 3,
  originPort: 'Fixture Origin Port',
  destinationPort: 'Fixture Destination Port',
  ...over,
});

test('breakEvenUnitPrice equals landed cost per unit', () => {
  const d = deal();
  assert.equal(breakEvenUnitPrice(d), landedCostUnit(d));
  // (265*210 + 2000 + 500 + 100) / 210
  assert.ok(Math.abs(breakEvenUnitPrice(d) - 277.381) < 0.01);
  assert.equal(breakEvenUnitPrice({}), 0);
  assert.equal(breakEvenUnitPrice(null), 0);
});

test('spreadPerUnit: sell − landed, 0 when prices missing', () => {
  const d = deal();
  assert.ok(Math.abs(spreadPerUnit(d) - (300 - landedCostUnit(d))) < 1e-9);
  assert.equal(spreadPerUnit({ quantity: 10 }), 0);
  assert.equal(spreadPerUnit({ sellUnitPrice: 300, quantity: 0 }), 0);
});

test('spreadTotal: spread per unit × quantity', () => {
  const d = deal();
  assert.ok(Math.abs(spreadTotal(d) - spreadPerUnit(d) * 210) < 1e-6);
  assert.equal(spreadTotal({}), 0);
});

test('commissionPerUnit: commission / quantity', () => {
  const d = deal();
  // revenue 63000 * 3% = 1890; /210 = 9
  assert.ok(Math.abs(commissionPerUnit(d) - 9) < 1e-9);
  assert.equal(commissionPerUnit({ sellUnitPrice: 10, commissionPct: 5 }), 0);
});

test('brokerEconomics: composite summary, never throws', () => {
  const d = deal();
  const e = brokerEconomics(d);
  assert.equal(e.quantity, 210);
  assert.ok(e.landedUnit > 0);
  assert.ok(e.landedTotal > 0);
  assert.equal(e.revenue, 63000);
  assert.ok(e.spreadTotal > 0);
  assert.equal(e.commissionPct, 3);
  assert.equal(e.commissionTotal, 1890);
  assert.ok(Math.abs(e.commissionUnit - 9) < 1e-9);
  assert.equal(e.breakEvenUnit, e.landedUnit);
  assert.ok(e.netMarginPct > 0);
  assert.deepEqual(e.missing, [], 'full deal has no missing core fields');
});

test('brokerEconomics: missing data → zeros + missing list, never throws', () => {
  const e = brokerEconomics({ product: 'Fixture' });
  assert.equal(e.landedUnit, 0);
  assert.equal(e.revenue, 0);
  assert.equal(e.commissionTotal, 0);
  assert.ok(e.missing.includes('unitCost'));
  assert.ok(e.missing.includes('sellUnitPrice'));
  assert.ok(e.missing.includes('quantity'));
  assert.doesNotThrow(() => brokerEconomics(null));
  assert.doesNotThrow(() => brokerEconomics('nope'));
});

test('brokerEconomics: TNJ-shaped deal (no sell price yet) stays honest', () => {
  const e = brokerEconomics({ quantity: 210, unitCost: 265 });
  assert.equal(e.landedUnit, 265);
  assert.equal(e.revenue, 0);
  assert.equal(e.commissionTotal, 0, 'no commission without a sell price');
  assert.ok(e.missing.includes('sellUnitPrice'));
});
