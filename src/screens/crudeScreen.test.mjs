import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Static assertions against the built standalone crude screen.
// The app is a self-contained single HTML file: inline <style> + inline
// <script>, no imports, no build step, no network.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const HTML_PATH = path.join(REPO_ROOT, 'public', 'crude', 'index.html');

assert.ok(existsSync(HTML_PATH), `crude screen exists at ${HTML_PATH}`);
const html = readFileSync(HTML_PATH, 'utf8');

test('screen file exists and is self-contained', () => {
  assert.ok(existsSync(HTML_PATH), 'public/crude/index.html exists');
  assert.ok(
    html.length > 10000,
    'screen is a substantial self-contained file',
  );
  assert.ok(
    !/<script[^>]+src=/.test(html),
    'no external <script src> — inline script only',
  );
  assert.ok(
    !/<link[^>]+rel=["']stylesheet["']/.test(html),
    'no external stylesheets — inline <style> only',
  );
});

test('viewport meta is phone-first', () => {
  assert.ok(
    html.includes(
      'name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"',
    ),
    'exact phone-first viewport meta present',
  );
});

test('reads/writes the real crude storage key', () => {
  assert.ok(
    html.includes('sahjony.crude.v1'),
    'uses the same sahjony.crude.v1 storage key as the GEV panel',
  );
});

test('hash-view routing covers deals, counterparties, add', () => {
  for (const hash of ['#deals', '#counterparties', '#add']) {
    assert.ok(
      html.includes(hash),
      `hash view ${hash} routed`,
    );
  }
  assert.ok(html.includes('hashchange'), 'listens for hashchange');
});

test('ES/EN language toggle persists choice', () => {
  assert.ok(
    html.includes('sahjony.gev.lang'),
    'language choice persists in sahjony.gev.lang',
  );
  assert.ok(html.includes('>ES</button>'), 'ES toggle button present');
  assert.ok(html.includes('>EN</button>'), 'EN toggle button present');
});

test('touch targets: buttons/inputs get min-height >= 44px', () => {
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(styleMatch, 'inline <style> block present');
  const css = styleMatch[1];
  const BTN_INPUT =
    /button|input|select|textarea|\.btn|\.chip|\.langbtn|\.viewtab|\.fab/i;
  let big = 0;
  let small = 0;
  for (const rule of css.split('}')) {
    const [selector = '', body = ''] = rule.split('{');
    if (!BTN_INPUT.test(selector)) continue;
    for (const m of body.matchAll(/min-height\s*:\s*(\d+)px/gi)) {
      if (Number(m[1]) >= 44) big++;
      else small++;
    }
  }
  assert.ok(
    big > 0,
    'at least one button/input rule sets min-height >= 44px',
  );
  assert.equal(
    small,
    0,
    'no button/input rule sets min-height below 44px',
  );
});

test('cross-links to GEV home and the other business screens', () => {
  for (const link of [
    '/',
    '/insurance/index.html',
    '/wholesale/index.html',
    '/import-export/index.html',
    '/cubacash/index.html',
  ]) {
    assert.ok(
      html.includes(`"${link}"`),
      `cross-link target "${link}" present`,
    );
  }
});

test('no external network calls except the approved deep-links, no API keys, no fonts/CDN', () => {
  // Unified-ecosystem rule: the screen may deep-link to its business site and
  // to Sofia on WhatsApp — nothing else external.
  const urls = html.match(/https?:\/\/[^\s"'`<>()]+/g) || [];
  const allowed = ['https://www.sahjony.com', 'https://wa.me/12816628581'];
  for (const u of urls) assert.ok(allowed.includes(u), `unexpected external URL: ${u}`);
  for (const u of allowed) assert.ok(urls.includes(u), `approved URL present: ${u}`);
  assert.ok(!/fonts\.googleapis/.test(html), 'no web fonts');
});

test('does not touch other modules\u2019 storage keys', () => {
  for (const key of [
    'sahjony_insurance_v1',
    'sahjony.wholesale.v1',
    'sahjony.cubacash.v1',
    'sahjony.trade.v1',
    'sahjony.d4d.v1',
  ]) {
    assert.ok(!html.includes(key), `no foreign key ${key}`);
  }
});
