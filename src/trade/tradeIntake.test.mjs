/**
 * Tests for the trade desk intake & triage queue.
 * Pure functions only — no storage, no network. Fixture data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deskFor,
  stampIntake,
  slaStatus,
  slaLabel,
  triageQueue,
  TRIAGE_SLA_HOURS,
  TRIAGE_COPY,
} from './tradeIntake.js';

const H = 3_600_000;
const NOW = Date.UTC(2026, 8, 17, 18, 0, 0);

const rfq = (over = {}) => ({
  id: over.id || 'r1',
  ref: over.ref || 'FIX-001',
  product: 'Fixture Product',
  status: 'prospect',
  originPort: 'Fixture Origin Port',
  destinationPort: 'Fixture Destination Port',
  intakeAt: new Date(NOW - 2 * H).toISOString(),
  ...over,
});

test('deskFor: explicit desk field always wins (grandfathered live deals)', () => {
  assert.equal(deskFor({ desk: 'trade', destinationPort: 'Mariel' }), 'trade');
  assert.equal(deskFor({ desk: 'cuba', destinationPort: 'Qingdao' }), 'cuba');
});

test('deskFor: Cuba port signals route to the Cuba desk', () => {
  assert.equal(deskFor({ destinationPort: 'Mariel' }), 'cuba');
  assert.equal(deskFor({ originPort: 'La Habana' }), 'cuba');
  assert.equal(deskFor({ destinationPort: 'Cienfuegos' }), 'cuba');
  assert.equal(deskFor({ originPort: 'Moa, Cuba' }), 'cuba');
});

test('deskFor: worldwide ports stay on the trade desk', () => {
  assert.equal(deskFor(rfq()), 'trade');
  assert.equal(deskFor({ originPort: 'Qingdao', destinationPort: 'Houston' }), 'trade');
  assert.equal(deskFor({}), 'trade');
  assert.equal(deskFor(null), 'trade');
});

test('stampIntake: stamps intakeAt when missing, routes desk, never mutates', () => {
  const input = { ref: 'X', destinationPort: 'Mariel' };
  const stamped = stampIntake(input, new Date(NOW));
  assert.equal(stamped.desk, 'cuba');
  assert.ok(stamped.intakeAt);
  assert.ok(!('intakeAt' in input), 'input must not be mutated');
  const keeps = stampIntake({ ref: 'Y', intakeAt: '2026-09-01T00:00:00.000Z' });
  assert.equal(keeps.intakeAt, '2026-09-01T00:00:00.000Z');
});

test('slaStatus: ok / due / breached / unknown', () => {
  assert.equal(slaStatus(rfq({ intakeAt: new Date(NOW - 2 * H).toISOString() }), NOW), 'ok');
  assert.equal(slaStatus(rfq({ intakeAt: new Date(NOW - 20 * H).toISOString() }), NOW), 'due');
  assert.equal(slaStatus(rfq({ intakeAt: new Date(NOW - 25 * H).toISOString() }), NOW), 'breached');
  assert.equal(slaStatus({ ref: 'NODATE' }, NOW), 'unknown');
  assert.equal(TRIAGE_SLA_HOURS, 24);
});

test('slaLabel: bilingual labels', () => {
  assert.equal(slaLabel('breached', 'es'), 'SLA vencido');
  assert.equal(slaLabel('breached', 'en'), 'SLA breached');
  assert.equal(slaLabel('due', 'es'), 'Por vencer');
});

test('triageQueue: only prospects, breached first, oldest first', () => {
  const list = [
    rfq({ id: 'ok1', ref: 'OK1', intakeAt: new Date(NOW - 1 * H).toISOString() }),
    rfq({ id: 'br1', ref: 'BR1', intakeAt: new Date(NOW - 30 * H).toISOString() }),
    rfq({ id: 'due1', ref: 'DUE1', intakeAt: new Date(NOW - 20 * H).toISOString() }),
    rfq({ id: 'old-ok', ref: 'OLDOK', intakeAt: new Date(NOW - 3 * H).toISOString() }),
    rfq({ id: 'not-prospect', ref: 'NP', status: 'contacted' }),
  ];
  const { queue, rerouted, counts } = triageQueue(list, NOW);
  assert.deepEqual(queue.map((q) => q.rfq.id), ['br1', 'due1', 'old-ok', 'ok1']);
  assert.deepEqual(rerouted, []);
  assert.equal(counts.total, 4);
  assert.equal(counts.breached, 1);
  assert.equal(counts.due, 1);
  assert.equal(counts.ok, 2);
  assert.ok(queue[0].slaLabelEs.length > 0 && queue[0].slaLabelEn.length > 0);
});

test('triageQueue: Cuba-desk RFQs are rerouted, never filed in the trade queue', () => {
  const list = [
    rfq({ id: 'c1', ref: 'C1', destinationPort: 'Mariel' }),
    rfq({ id: 't1', ref: 'T1' }),
  ];
  const { queue, rerouted, counts } = triageQueue(list, NOW);
  assert.deepEqual(queue.map((q) => q.rfq.id), ['t1']);
  assert.deepEqual(rerouted.map((r) => r.rfq.id), ['c1']);
  assert.equal(rerouted[0].desk, 'cuba');
  assert.equal(counts.rerouted, 1);
});

test('triageQueue: never throws on hostile input', () => {
  assert.doesNotThrow(() => triageQueue(null));
  assert.doesNotThrow(() => triageQueue('nope'));
  assert.doesNotThrow(() => triageQueue([null, 42, { status: 'prospect' }]));
  const empty = triageQueue(undefined, NOW);
  assert.deepEqual(empty.queue, []);
});

test('TRIAGE_COPY carries bilingual strings', () => {
  assert.ok(TRIAGE_COPY.title.es && TRIAGE_COPY.title.en);
  assert.ok(TRIAGE_COPY.slaNote.es && TRIAGE_COPY.slaNote.en);
});
