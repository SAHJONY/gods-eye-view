import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BENCHMARK_GRADES,
  SEED_BENCHMARKS,
  normalizeBenchmark,
  addBenchmark,
  listBenchmarks,
  latestBenchmark,
  daysStale,
  stalenessLabel,
  seedBenchmarkPayload,
  hasSeed,
} from './benchmarkLog.js';

test('seed: exactly the verified 2026-09-17 values, labeled', () => {
  assert.equal(SEED_BENCHMARKS.length, 2);
  const wti = SEED_BENCHMARKS.find((b) => b.grade === 'WTI');
  const brent = SEED_BENCHMARKS.find((b) => b.grade === 'Brent');
  assert.equal(wti.price, 101.29);
  assert.equal(brent.price, 104.59);
  for (const b of SEED_BENCHMARKS) {
    assert.equal(b.date, '2026-09-17');
    assert.equal(b.source, 'verified-seed');
    assert.equal(b.basis, 'front-month');
    assert.ok(b.note && b.nota);
  }
  assert.ok(Object.isFrozen(SEED_BENCHMARKS));
});

test('seedBenchmarkPayload: deep copy, mutation-safe', () => {
  const payload = seedBenchmarkPayload();
  assert.equal(payload.length, 2);
  payload[0].price = 999;
  assert.equal(SEED_BENCHMARKS[0].price, 101.29);
  assert.ok(!hasSeed([]));
  assert.ok(hasSeed(payload));
  assert.ok(!hasSeed([{ grade: 'WTI', price: 1, source: 'manual-entry' }]));
});

test('normalizeBenchmark: defensive, junk rejected', () => {
  assert.equal(normalizeBenchmark(null), null);
  assert.equal(normalizeBenchmark({ grade: 'WTI' }), null);
  assert.equal(normalizeBenchmark({ grade: 'WTI', price: -5 }), null);
  const b = normalizeBenchmark({
    grade: 'Brent',
    price: '104.59',
    date: '2026-09-18',
    source: 'manual-entry',
    note: 'desk quote',
  });
  assert.equal(b.grade, 'Brent');
  assert.equal(b.price, 104.59);
  assert.equal(b.date, '2026-09-18');
  assert.equal(b.source, 'manual-entry');
  const unknown = normalizeBenchmark({ grade: 'Dubai', price: 90 });
  assert.equal(unknown.grade, 'WTI'); // unknown grades coerce, never invent a grade
});

test('addBenchmark: pure append, invalid entries ignored', () => {
  const list = addBenchmark([], { grade: 'WTI', price: 101.29, date: '2026-09-17' });
  assert.equal(list.length, 1);
  assert.equal(list[0].source, 'manual-entry'); // seed source is not assumed
  const same = addBenchmark(list, { grade: 'WTI' });
  assert.equal(same.length, 1);
  const empty = addBenchmark(null, { grade: 'WTI', price: 100 });
  assert.equal(empty.length, 1);
});

test('list/latest: per grade, chronological, null when empty', () => {
  const list = [
    { grade: 'Brent', price: 104.59, date: '2026-09-17' },
    { grade: 'WTI', price: 101.29, date: '2026-09-17' },
    { grade: 'WTI', price: 102.0, date: '2026-09-18' },
  ];
  assert.equal(listBenchmarks(list, 'WTI').length, 2);
  assert.equal(listBenchmarks(list, 'Brent').length, 1);
  assert.equal(latestBenchmark(list, 'WTI').price, 102.0);
  assert.equal(latestBenchmark(list, 'Brent').price, 104.59);
  assert.equal(latestBenchmark([], 'WTI'), null);
  assert.equal(latestBenchmark(null, 'WTI'), null);
});

test('daysStale / stalenessLabel: honest as-of dating', () => {
  assert.equal(daysStale('2026-09-17', '2026-09-17'), 0);
  assert.equal(daysStale('2026-09-17', '2026-09-20'), 3);
  assert.equal(daysStale(null, '2026-09-20'), null);
  assert.equal(stalenessLabel({ date: '2026-09-17' }, '2026-09-17', 'es'), 'Hoy');
  assert.equal(stalenessLabel({ date: '2026-09-17' }, '2026-09-18', 'en'), 'Yesterday');
  assert.equal(stalenessLabel({ date: '2026-09-17' }, '2026-09-20', 'es'), 'Hace 3 días');
  assert.equal(stalenessLabel({}, '2026-09-20', 'es'), 'Fecha desconocida');
});

test('BENCHMARK_GRADES lists WTI and Brent', () => {
  assert.deepEqual([...BENCHMARK_GRADES], ['WTI', 'Brent']);
});
