import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  gapCount,
  renewalsWithin,
  claimStageCounts,
  bestQuotes,
  stateRollup,
  stateHealth,
  NO_STATE_CODE,
} = await import('./insuranceEngine.js');

const NOW = Date.parse('2026-09-17T12:00:00Z');

const BIZ = {
  personal: {
    coverages: [
      { id: 'c1', type: 'auto', status: 'gap' },
      { id: 'c2', type: 'home', status: 'active', exp: '2026-10-10', state: 'TX' }, // 23d
      { id: 'c3', type: 'life', status: 'active', exp: '2027-06-01', state: '' }, // far, blank state
    ],
    claims: [],
  },
  wholesale: {
    coverages: [
      { id: 'c4', type: 'gl', status: 'gap', state: 'FL' },
      { id: 'c5', type: 'prop', status: 'active', exp: '2026-09-20', state: 'FL' }, // 3d
      { id: 'c6', type: 'wc', status: 'active', exp: 'not-a-date', state: 'FL' },
    ],
    claims: [],
  },
};

test('gapCount counts status === gap across businesses', () => {
  assert.equal(gapCount(BIZ), 2);
  assert.equal(gapCount({}), 0);
  assert.equal(gapCount(undefined), 0);
  assert.equal(gapCount({ x: {} }), 0);
});

test('renewalsWithin returns expiring coverages, gaps excluded, sorted', () => {
  const r = renewalsWithin(BIZ, 30, NOW);
  assert.deepEqual(r.map((x) => x.coverage.id), ['c5', 'c2']);
  assert.equal(r[0].daysLeft, 3);
  assert.equal(r[1].daysLeft, 23);
  assert.ok(r.every((x) => x.coverage.status !== 'gap'));
  // narrow window
  assert.deepEqual(
    renewalsWithin(BIZ, 10, NOW).map((x) => x.coverage.id),
    ['c5'],
  );
  // invalid dates are skipped
  assert.ok(!renewalsWithin(BIZ, 30, NOW).some((x) => x.coverage.id === 'c6'));
});

test('claimStageCounts buckets stages 0-5', () => {
  const counts = claimStageCounts([
    { stage: 0 },
    { stage: 1 },
    { stage: 1 },
    { stage: 5 },
    { stage: 9 },
    {},
  ]);
  assert.equal(counts['0'], 1);
  assert.equal(counts['1'], 2);
  assert.equal(counts['5'], 1);
  assert.equal(counts['3'], 0);
});

test('bestQuotes picks the cheapest quote per type', () => {
  const best = bestQuotes([
    { id: 'q1', type: 'auto', premium: 1200 },
    { id: 'q2', type: 'auto', premium: 900 },
    { id: 'q3', type: 'home', premium: 2000 },
    { id: 'q4', type: 'home', premium: 'n/a' },
    { id: 'q5', type: 'boat', premium: 0 },
  ]);
  assert.equal(best.auto.id, 'q2');
  assert.equal(best.home.id, 'q3');
  assert.ok(!('boat' in best), 'zero/invalid premiums never win');
});

test('stateRollup groups by coverage state, blank → US', () => {
  const roll = stateRollup(BIZ, 30, NOW);
  assert.equal(roll.TX.gaps, 0);
  assert.equal(roll.TX.active, 1);
  assert.equal(roll.TX.expiring, 1);
  assert.equal(roll.FL.gaps, 1);
  assert.equal(roll.FL.expiring, 1);
  assert.equal(roll[NO_STATE_CODE].active, 1); // c3 blank state
});

test('stateHealth: red > amber > green > gray', () => {
  assert.equal(stateHealth({ gaps: 1, active: 5 }), 'red');
  assert.equal(stateHealth({ expiring: 2, active: 5 }), 'amber');
  assert.equal(stateHealth({ active: 5 }), 'green');
  assert.equal(stateHealth({}), 'gray');
  assert.equal(stateHealth(), 'gray');
});
