import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chicagoIso } from './carTime.js';

test('chicagoIso returns ISO with Chicago offset', () => {
  const iso = chicagoIso(new Date('2026-09-17T12:00:00Z'));
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  // 12:00 UTC in September (CDT, UTC-5) -> 07:00 local
  assert.ok(iso.includes('T07:00:00-05:00'), `got ${iso}`);
});

test('chicagoIso defaults to now', () => {
  const iso = chicagoIso();
  assert.match(iso, /^2026-/);
});
