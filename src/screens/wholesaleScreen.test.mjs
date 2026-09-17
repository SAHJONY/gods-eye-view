import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Standalone full-screen wholesale app: assertions run against the built
// HTML file, no DOM needed.
const ROOT = new URL('../../', import.meta.url);
const HTML_PATH = new URL('public/wholesale/index.html', ROOT);

test('wholesale standalone app file exists', () => {
  assert.ok(existsSync(HTML_PATH), 'public/wholesale/index.html exists');
});

const html = readFileSync(HTML_PATH, 'utf8');

test('has the phone-first viewport meta', () => {
  assert.ok(
    html.includes(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">',
    ),
    'viewport meta present',
  );
});

test('reads/writes the shared wholesale storage key', () => {
  assert.ok(
    html.includes('sahjony.wholesale.v1'),
    'shared storage key sahjony.wholesale.v1 present',
  );
});

test('hash-view routing covers #pipeline, #buyers, #add', () => {
  for (const h of ['#pipeline', '#buyers', '#add']) {
    assert.ok(html.includes(h), `hash view ${h} present`);
  }
  assert.ok(html.includes('hashchange'), 'hashchange listener wired');
});

test('ES/EN language toggle persisted to sahjony.gev.lang', () => {
  assert.ok(html.includes('sahjony.gev.lang'), 'lang key persisted');
  assert.ok(html.includes("setLang('en')"), 'EN toggle wired');
  assert.ok(html.includes("setLang('es')"), 'ES toggle wired');
});

test('CSS sets phone-sized min-height on buttons/inputs', () => {
  assert.ok(
    html.includes('min-height:52px') || html.includes('min-height:44px'),
    'min-height >= 44px on interactive elements',
  );
  assert.ok(html.includes('font-size:16px'), 'base input font size set');
});

test('cross-links to GEV home and the other standalone screens', () => {
  for (const u of [
    '"/"',
    '"/insurance/index.html"',
    '"/crude/index.html"',
    '"/import-export/index.html"',
    '"/cubacash/index.html"',
  ]) {
    assert.ok(html.includes(u), `cross-link ${u} present`);
  }
});

test('contains no external http(s) URLs at all', () => {
  assert.ok(!/https?:\/\//.test(html), 'no external URLs');
});

test('does not contain other modules\' storage keys', () => {
  for (const k of [
    'sahjony_insurance_v1',
    'sahjony.crude.v1',
    'sahjony.cubacash.v1',
    'sahjony.trade.v1',
  ]) {
    assert.ok(!html.includes(k), `foreign key ${k} absent`);
  }
});

test('renders deal economics from stored data (MAO, per-buyer fees)', () => {
  assert.ok(html.includes('arv'), 'ARV field present');
  assert.ok(html.includes('targetFee'), 'targetFee field present');
  assert.ok(html.includes('contractPrice'), 'contractPrice field present');
  assert.ok(html.includes('0.7'), 'MAO = ARV*0.70 formula present');
});

test('never invents data: empty states, no seeded leads/buyers', () => {
  assert.ok(
    /No leads yet|Sin leads/.test(html),
    'empty-state copy present',
  );
  assert.ok(
    !/123 Main St|Main Street|Oak Ave|Pine Rd/.test(html),
    'no seeded example addresses',
  );
});
