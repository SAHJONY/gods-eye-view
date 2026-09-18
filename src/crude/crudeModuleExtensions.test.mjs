import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCounterparty,
  getCounterparty,
  setDiligenceItem,
  setDiligence,
  getDiligenceEvaluation,
  createCargo,
  getCargo,
  seedBenchmarks,
  addBenchmark,
  listBenchmarks,
  latestBenchmark,
  resetCrudeStore,
  reloadCrudeStore,
} from './counterpartyStore.js';

beforeEach(() => {
  resetCrudeStore();
  reloadCrudeStore();
});

test('benchmarks: seed is idempotent and carries the verified values', () => {
  const first = seedBenchmarks();
  assert.equal(first.length, 2);
  assert.equal(latestBenchmark('WTI').price, 101.29);
  assert.equal(latestBenchmark('Brent').price, 104.59);
  assert.equal(latestBenchmark('Brent').source, 'verified-seed');
  const second = seedBenchmarks();
  assert.equal(second.length, 2, 'seeding twice does not duplicate');
  reloadCrudeStore();
  assert.equal(listBenchmarks('WTI').length, 1);
});

test('benchmarks: manual entries append; junk rejected', () => {
  seedBenchmarks();
  const added = addBenchmark({
    grade: 'Brent',
    price: 105.1,
    date: '2026-09-18',
    source: 'manual-entry',
    note: 'desk note (fixture)',
  });
  assert.ok(added);
  assert.equal(added.source, 'manual-entry');
  assert.equal(latestBenchmark('Brent').price, 105.1);
  assert.equal(addBenchmark({ grade: 'WTI' }), null);
  assert.equal(listBenchmarks('WTI').length, 1);
});

test('counterparty: diligence state is normalized on create/update', () => {
  const cp = createCounterparty({
    name: 'Diligence Fixture Ltd',
    country: 'Fictitia',
    diligence: {
      'identity-direct-contact': { status: 'done', ref: '', note: '' },
      'bogus-item': { status: 'done' },
    },
  });
  assert.ok(cp.diligence['identity-direct-contact']);
  assert.equal(cp.diligence['identity-direct-contact'].status, 'done');
  assert.equal(cp.diligence['bogus-item'], undefined);
  const ev = getDiligenceEvaluation(cp.id);
  assert.equal(ev.status, 'pending');
  assert.ok(ev.score > 0 && ev.score < 100);
});

test('setDiligenceItem: sanctions red flag → escalate', () => {
  const cp = createCounterparty({ name: 'Flag Fixture', country: 'Fictitia' });
  setDiligenceItem(cp.id, 'sanctions-redflag', { status: 'flagged' });
  const ev = getDiligenceEvaluation(cp.id);
  assert.equal(ev.status, 'escalate');
  assert.equal(ev.sanctionsStop, true);
  assert.deepEqual(ev.flagged, ['sanctions-redflag']);
  // Clearing the flag returns to pending — nothing auto-resolves.
  setDiligenceItem(cp.id, 'sanctions-redflag', { status: 'open' });
  assert.equal(getDiligenceEvaluation(cp.id).status, 'pending');
});

test('setDiligenceItem: unknown item or counterparty is a safe no-op', () => {
  const cp = createCounterparty({ name: 'Safe Fixture', country: 'Fictitia' });
  const same = setDiligenceItem(cp.id, 'not-a-real-item', { status: 'done' });
  assert.equal(same.id, cp.id);
  assert.equal(setDiligenceItem('no-such-id', 'sanctions-redflag', {}), null);
  assert.equal(setDiligence({}, 'sanctions-redflag', {}), null);
  assert.equal(getDiligenceEvaluation('no-such-id'), null);
});

test('setDiligence: full replacement with refs', () => {
  const cp = createCounterparty({ name: 'Ref Fixture', country: 'Fictitia' });
  setDiligence(cp.id, {
    'registry-number': { status: 'done', ref: 'REG-2026-001', note: '' },
  });
  const fresh = getCounterparty(cp.id);
  assert.equal(fresh.diligence['registry-number'].ref, 'REG-2026-001');
});

test('cargo: netback fields normalize to zero until Juan adds them', () => {
  const cargo = createCargo({
    ref: 'NB-001',
    volumeBbl: 500000,
    buyPrice: 100,
    sellPrice: 102,
  });
  assert.equal(cargo.benchmarkPrice, 0);
  assert.equal(cargo.freightPerBbl, 0);
  assert.equal(cargo.insurancePerBbl, 0);
  assert.equal(cargo.warRiskPerBbl, 0);
  assert.deepEqual(cargo.netbackAdjustments, []);
  const updated = getCargo(cargo.id);
  assert.equal(updated.benchmarkPrice, 0);
});

test('cargo: netback inputs persist through create and update', () => {
  const cargo = createCargo({
    ref: 'NB-002',
    benchmarkPrice: 104.59,
    freightPerBbl: 2.5,
    warRiskPerBbl: 0.75,
    netbackAdjustments: [{ es: 'Ajuste', en: 'Adjustment', amountPerBbl: 1 }],
  });
  assert.equal(cargo.benchmarkPrice, 104.59);
  assert.equal(cargo.freightPerBbl, 2.5);
  assert.equal(cargo.netbackAdjustments.length, 1);
});
