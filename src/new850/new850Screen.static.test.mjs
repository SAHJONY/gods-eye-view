// Static audit of the New850 standalone screen (public/new850/index.html).
// Revenue-first gate: the fee model is UNDECIDED, so the screen must show a
// prominent pending state — and must never build payment collection.
// Phone-first: no Cesium, no external requests, no send/submit controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', '..', 'public', 'new850', 'index.html'), 'utf8');

test('screen: no Cesium, no external resource requests, no forms', () => {
  assert.ok(!/cesium/i.test(html), 'no Cesium');
  // External RESOURCES (scripts, styles, images, fetches) are banned — the
  // page must make no external calls by itself. User-tapped deep links
  // (<a href="https://…">) are the unified-ecosystem navigation (Juan's
  // standing rule) and are allowed: they navigate only when Juan taps them.
  const resourceUrls = [
    ...html.matchAll(
      /<(?:script|link|img|iframe|source|video|audio)[^>]+(?:src|href)\s*=\s*["']https?:\/\//gi,
    ),
  ];
  assert.equal(resourceUrls.length, 0, 'no external resource requests');
  assert.ok(!/fetch\(\s*["']https?:\/\//i.test(html), 'no external fetch');
  assert.ok(!/<form/i.test(html), 'no forms');
  assert.ok(!/type="submit"/i.test(html), 'no submit controls');
});

test('screen: fee-model-pending banner present in ES/EN, no payment collection', () => {
  assert.ok(html.includes('id="t_fee"'), 'fee banner element exists');
  assert.match(html, /Modelo de tarifa: pendiente de tu decisi/);
  assert.match(html, /Fee model: pending your decision/);
  // "sin cobros" is the pending-state copy; payment collection means prices,
  // checkout, pay actions. None may appear.
  assert.ok(!/checkout/i.test(html), 'no checkout');
  assert.ok(!/\$\s?\d/.test(html), 'no prices');
  assert.ok(!/stripe|paypal|cashapp/i.test(html), 'no payment rails');
});

test('screen: approval-decision safety copy is intact', () => {
  assert.match(html, /solo registra tu decisi/);
  assert.match(html, /nunca envía nada autom/);
});
