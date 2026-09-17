import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone full-screen MY CUBA CASH screen contract: public/cubacash/index.html
// must be self-contained, phone-first, bilingual, and share the exact
// `sahjony.cubacash.v1` storage shape with the in-app dashboard panel.

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', '..', 'public', 'cubacash', 'index.html');

const html = () => readFileSync(htmlPath, 'utf8');
const cssOf = (text) => {
  const m = text.match(/<style>([\s\S]*)<\/style>/);
  assert.ok(m, 'inline <style> block present');
  return m[1];
};

test('standalone cubacash screen file exists', () => {
  assert.ok(existsSync(htmlPath), 'public/cubacash/index.html exists');
  assert.ok(html().length > 5000, 'file is a full app, not a stub');
});

test('viewport meta locks to device width for phone use', () => {
  const text = html();
  assert.ok(text.includes('name="viewport"'), 'viewport meta present');
  assert.ok(
    text.includes('maximum-scale=1.0, user-scalable=no'),
    'zoom locked like the insurance screen',
  );
});

test('reads/writes the cubacash storage key with the store shape', () => {
  const text = html();
  assert.ok(
    text.includes('sahjony.cubacash.v1'),
    'shares the dashboard store key',
  );
  // The shared shape: { providers, corridors, seeded } — never the trade key.
  assert.ok(text.includes('corridors'), 'corridor list rendered');
  assert.ok(text.includes('providers'), 'provider list rendered');
  assert.ok(text.includes('seeded'), 'seeded flag honored');
});

test('hash-view routing: #corridors, #providers, #add', () => {
  const text = html();
  for (const h of ['#corridors', '#providers', '#add']) {
    assert.ok(text.includes(h), `hash route ${h} present`);
  }
  assert.ok(text.includes('hashchange'), 'hashchange listener wired');
});

test('ES/EN toggle persisted in sahjony.gev.lang', () => {
  const text = html();
  assert.ok(text.includes('sahjony.gev.lang'), 'shared language key used');
  assert.ok(text.includes("setLang('es')"), 'ES toggle wired');
  assert.ok(text.includes("setLang('en')"), 'EN toggle wired');
  assert.ok(text.includes('>ES<') || text.includes('>ES</button>'), 'ES label');
  assert.ok(text.includes('>EN<') || text.includes('>EN</button>'), 'EN label');
});

test('CSS: min-height >= 44px on all buttons and inputs (phone-first)', () => {
  const css = cssOf(html());
  const hits = [...css.matchAll(/min-height:\s*(\d+)px/g)].map((m) =>
    Number(m[1]),
  );
  assert.ok(hits.length > 0, 'min-height rules exist');
  for (const px of hits) {
    assert.ok(px >= 44, `min-height ${px}px must be >= 44px`);
  }
  // Buttons and text inputs explicitly covered.
  assert.match(css, /\.btn\{[^}]*min-height:\s*[4-9]\dpx/);
  assert.match(css, /input[^{]*\{[^}]*min-height:\s*[4-9]\dpx/);
});

test('cross-links to GEV home and the other business screens', () => {
  const text = html();
  assert.ok(text.includes('"/"'), 'GEV home link present');
  for (const href of [
    '/insurance/index.html',
    '/wholesale/index.html',
    '/crude/index.html',
    '/import-export/index.html',
  ]) {
    assert.ok(text.includes(href), `cross-link ${href} present`);
  }
});

test('the allowed external URLs are mycubacash.com and Sofia WhatsApp — nothing else', () => {
  const text = html();
  assert.ok(
    text.includes('https://www.mycubacash.com'),
    'mycubacash.com link present',
  );
  assert.ok(
    text.includes('https://wa.me/12816628581'),
    'Sofia WhatsApp link present',
  );
  const urls = text.match(/https?:\/\/[^\s"'`<>()]+/g) || [];
  const allowed = ['https://www.mycubacash.com', 'https://wa.me/12816628581'];
  assert.deepEqual(
    urls.filter((u) => !allowed.includes(u)),
    [],
    `no other external URLs allowed, found: ${JSON.stringify(urls)}`,
  );
});

test('businesses stay data-separate: no other modules\' storage keys', () => {
  const text = html();
  assert.ok(
    !text.includes('sahjony.trade.v1'),
    'never the import/export key',
  );
  assert.ok(
    !text.includes('sahjony_insurance_v1'),
    'never the insurance key',
  );
  for (const key of ['sahjony.wholesale', 'sahjony.crude', 'sahjony.trade']) {
    assert.ok(!text.includes(key), `no foreign storage key: ${key}`);
  }
});

test('honesty contract: no invented fees, rates, or providers', () => {
  const text = html();
  // Fees stay undisclosed until Juan enters them.
  assert.ok(text.includes('feeUndisclosed'), 'undisclosed-fee label rendered');
  // The 6 seed providers are names only — mirrored from the store.
  for (const name of [
    'Western Union',
    'Cubamax',
    'Sendvalu',
    'Fonmoney',
    'Correos España',
    'Íkualo Rem',
  ]) {
    assert.ok(text.includes(name), `seed provider "${name}" present`);
  }
  // Empty states never invent data.
  assert.ok(
    text.includes('No corridors yet — add your first one'),
    'English corridor empty state',
  );
  // Zero-custody positioning.
  assert.ok(
    /moves no money/i.test(text),
    'zero-custody positioning present',
  );
});
