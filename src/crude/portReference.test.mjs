import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PORTS,
  PORT_TYPES,
  PORT_TYPE_LABELS,
  findPort,
  portsByType,
  portLabel,
  COORDS_DISCLAIMER,
} from './portReference.js';

test('reference ports: real desks-relevant ports only, bilingual notes', () => {
  assert.ok(PORTS.length >= 3);
  const ids = PORTS.map((p) => p.id);
  assert.ok(ids.includes('sohar-sts'));
  assert.ok(ids.includes('yanbu'));
  assert.ok(ids.includes('fujairah'));
  for (const p of PORTS) {
    assert.ok(p.name && p.country && p.es && p.en);
    assert.ok(PORT_TYPES.includes(p.type));
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }
  assert.ok(Object.isFrozen(PORTS));
});

test('findPort: by id, null when unknown — never invents', () => {
  const sohar = findPort('sohar-sts');
  assert.equal(sohar.name, 'Sohar STS area');
  assert.equal(sohar.type, 'sts');
  assert.equal(findPort('  YANBU '), findPort('yanbu'));
  assert.equal(findPort('made-up-terminal'), null);
  assert.equal(findPort(null), null);
});

test('portsByType: filtered, empty for unknown types', () => {
  assert.ok(portsByType('sts').every((p) => p.type === 'sts'));
  assert.ok(portsByType('load').length >= 1);
  assert.deepEqual(portsByType('nope'), []);
});

test('portLabel: bilingual fallback', () => {
  const yanbu = findPort('yanbu');
  assert.equal(portLabel(yanbu, 'es'), 'Yanbu — Saudi Arabia');
  assert.equal(portLabel(null, 'es'), 'Puerto desconocido');
  assert.equal(portLabel(null, 'en'), 'Unknown port');
});

test('disclaimer and type labels are bilingual', () => {
  assert.ok(COORDS_DISCLAIMER.es.includes('aproximadas'));
  assert.ok(COORDS_DISCLAIMER.en.includes('Approximate'));
  assert.ok(PORT_TYPE_LABELS.sts.es && PORT_TYPE_LABELS.sts.en);
});
