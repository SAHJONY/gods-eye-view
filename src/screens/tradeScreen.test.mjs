// Static assertions for the standalone full-screen Import/Export trade app.
// Runs against the built public/import-export/index.html — no DOM needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const HTML_PATH = path.join(ROOT, 'public', 'import-export', 'index.html');

test('import/export standalone screen file exists', () => {
  assert.ok(fs.existsSync(HTML_PATH), 'public/import-export/index.html exists');
});

const html = fs.readFileSync(HTML_PATH, 'utf8');

test('has phone viewport meta and self-contained structure', () => {
  assert.ok(
    html.includes(
      'name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"',
    ),
    'viewport meta for phone use',
  );
  assert.ok(html.includes('<style>'), 'inline styles');
  assert.ok(html.includes('<script>'), 'inline script');
  assert.ok(!html.includes('<link'), 'no external stylesheets');
  assert.ok(!html.includes('src="http'), 'no external scripts');
  assert.ok(!html.includes('@import'), 'no CSS imports');
});

test('reads/writes the shared trade storage key', () => {
  assert.ok(
    html.includes('sahjony.trade.v1'),
    'uses the same localStorage key as the GEV trade panel',
  );
});

test('supports hash-view routing for rfqs, suppliers, add', () => {
  for (const v of ['rfqs', 'suppliers', 'add']) {
    assert.ok(
      html.includes(`"${v}"`) || html.includes(`'${v}'`),
      `view "${v}" present`,
    );
  }
  assert.ok(
    html.includes('location.hash') && html.includes('hashchange'),
    'hash routing wired',
  );
});

test('has ES/EN language toggle with persisted choice', () => {
  assert.ok(html.includes('sahjony.gev.lang'), 'lang persisted');
  assert.ok(html.includes("setLang('en')"), 'EN button');
  assert.ok(html.includes("setLang('es')"), 'ES button');
});

test('touch targets are phone-sized in CSS', () => {
  const minHeights = [...html.matchAll(/min-height\s*:\s*(\d+)px/g)].map((m) =>
    Number(m[1]),
  );
  assert.ok(minHeights.length > 0, 'min-height rules exist');
  assert.ok(
    minHeights.every((v) => v >= 44),
    `all min-height rules >= 44px (found: ${minHeights.join(',')})`,
  );
  assert.ok(html.includes('font-size:17px'), 'base font 17px');
});

test('cross-links to every business module and GEV home', () => {
  for (const url of [
    '"/"',
    '/insurance/index.html',
    '/wholesale/index.html',
    '/crude/index.html',
    '/cubacash/index.html',
  ]) {
    assert.ok(html.includes(url), `cross-link ${url} present`);
  }
});

test('links the business website and Sofia WhatsApp — nothing else external', () => {
  assert.ok(
    html.includes('https://www.sahjony.com'),
    'sahjony.com link present',
  );
  assert.ok(
    html.includes('https://wa.me/12816628581'),
    'Sofia WhatsApp link present',
  );
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0]);
  const allowed = ['https://www.sahjony.com', 'https://wa.me/12816628581'];
  const others = urls.filter((u) => !allowed.includes(u));
  assert.deepEqual(others, [], `no other external URLs (found: ${others})`);
});

test('never touches other businesses’ storage keys', () => {
  for (const key of [
    'sahjony.cubacash.v1',
    'sahjony_insurance_v1',
    'sahjony.crude',
    'sahjony.wholesale',
    'sahjony_cubacash',
  ]) {
    assert.ok(!html.includes(key), `no ${key}`);
  }
});

test('renders only stored data — no invented content', () => {
  assert.ok(
    html.includes('No RFQs yet — add your first one'),
    'EN empty state for RFQs',
  );
  assert.ok(
    html.includes('No suppliers yet — add your first one'),
    'EN empty state for suppliers',
  );
  assert.ok(
    html.includes('Aún no hay RFQs — agrega el primero'),
    'ES empty state for RFQs',
  );
  assert.ok(
    html.includes('Sin proveedores — agrega el primero'),
    'ES empty state for suppliers',
  );
});

test('positions SAHJONY as broker-for-a-fee', () => {
  assert.ok(
    /broker/i.test(html),
    'broker positioning text present',
  );
  assert.ok(
    html.includes('never the end buyer') || html.includes('nunca es el comprador final'),
    'broker-for-a-fee caveat present',
  );
});
