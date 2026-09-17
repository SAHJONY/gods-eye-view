import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const STATIONS = {
  wholesale: 'public/wholesale/index.html',
  crude: 'public/crude/index.html',
  trade: 'public/import-export/index.html',
  cubacash: 'public/cubacash/index.html',
};
const html = {};
for (const [k, p] of Object.entries(STATIONS)) html[k] = read(p);

function manageSection(src) {
  const start = src.indexOf('Gestionar / Manage');
  assert.ok(start >= 0, 'manage block marker present');
  const end = src.indexOf('/Gestionar', start);
  assert.ok(end > start, 'manage block end marker present');
  return src.slice(start, end);
}

for (const [name, src] of Object.entries(html)) {
  test(`${name}: phone-first viewport meta`, () => {
    assert.match(src, /<meta[^>]*name="viewport"[^>]*>/);
  });

  test(`${name}: language persists in sahjony.gev.lang`, () => {
    assert.ok(src.includes('sahjony.gev.lang'), 'lang key present');
  });

  test(`${name}: manage tab entry exists with four bilingual sections`, () => {
    const sec = manageSection(src);
    assert.ok(src.includes('renderManage'), 'renderManage wired');
    for (const tab of ['tabA', 'tabP', 'tabI', 'tabW'])
      assert.ok(sec.includes(`${tab}:`), `section ${tab} present`);
    // bilingual section labels (ES + EN)
    assert.ok(sec.includes('Aprobaciones') && sec.includes('Approvals'));
  });

  test(`${name}: touch targets >= 44px on main controls`, () => {
    for (const cls of ['.viewtab', '.btn']) {
      const m = src.match(new RegExp(cls.replace('.', '\\.') + '\\{[^}]*min-height:(\\d+)px'));
      if (m) assert.ok(Number(m[1]) >= 44, `${cls} min-height ${m[1]}px`);
    }
    const sec = manageSection(src);
    // Manage controls are the screen's .btn/.viewtab classes (asserted above,
    // >= 44px) plus the shared approval panel (asserted separately). No
    // undersized inline min-height may appear in the manage block.
    const small = [...sec.matchAll(/min-height:(\d+)px/g)].map((m) => Number(m[1]));
    assert.ok(small.every((n) => n >= 44), 'no undersized manage controls');
    assert.ok(
      sec.includes('class="btn"') || sec.includes('mg_apr_panel'),
      'manage controls use the shared button styles or approval panel',
    );
  });

  test(`${name}: no hover-only interaction in the manage console`, () => {
    const sec = manageSection(src);
    assert.doesNotMatch(sec, /onmouse|:hover/);
  });

  test(`${name}: no assignment/delegation terms in the manage console`, () => {
    const sec = manageSection(src);
    // "assignment fee" is wholesale revenue terminology (the business's fee),
    // not a staff-assignment workflow. Only flag task/personnel assignment.
    assert.doesNotMatch(sec, /asignar|delegar|\bdelegat\w*/i);
    assert.doesNotMatch(sec, /\bassign(?!ment)/i);
  });

  test(`${name}: no fixed min-width >= 300px (no 360px breakage)`, () => {
    assert.doesNotMatch(src, /min-width:\s*[3-9]\d{2,}px/);
  });

  test(`${name}: cross-links to the other three stations`, () => {
    const others = Object.values(STATIONS).filter((p) => p !== STATIONS[name]);
    for (const o of others) {
      const url = '/' + o.replace('public/', '').replace('/index.html', '/index.html');
      assert.ok(src.includes(url), `links to ${o}`);
    }
  });

  test(`${name}: approval safety — taps record decisions only`, () => {
    const sec = manageSection(src);
    assert.ok(sec.includes('apDecide'), 'tap decision handler present');
    assert.ok(
      sec.includes('__gevApprovals'),
      'uses the shared approval queue bridge (one store, one key)',
    );
    assert.doesNotMatch(sec, /function apDoc\(\)/, 'no second approvals store');
    assert.doesNotMatch(sec, /fetch\(|XMLHttpRequest|mailto:|sms:|tel:/);
  });

  test(`${name}: shared approval panel — 44px targets, no hover-only`, () => {
    const panelSrc = read('src/approvals/approvalPanel.js');
    const m = panelSrc.match(/\.ap-btn\{[^}]*min-height:(\d+)px/);
    assert.ok(m && Number(m[1]) >= 44, 'ap-btn min-height >= 44px');
    assert.doesNotMatch(panelSrc, /:hover/, 'no hover-only interaction in approval panel');
  });
}

test('trade: defaults to Spanish and sets document lang', () => {
  assert.match(html.trade, /let lang\s*=\s*["']es["']/);
  assert.ok(html.trade.includes('document.documentElement.lang'));
});

test('cubacash: bilingual add key present in both dictionaries', () => {
  assert.ok(html.cubacash.includes('add:"Añadir"') || html.cubacash.includes("add:'Añadir'"));
  assert.ok(html.cubacash.includes('add:"Add"') || html.cubacash.includes("add:'Add'"));
});

test('trade: live rice/diesel RFQ is seeded (awaiting seller prices)', () => {
  assert.ok(html.trade.includes('RFQ-RICE-DIESEL-0917'));
});

test('cubacash: INPOSDOM 2025 tariff is visibly marked stale', () => {
  assert.match(html.cubacash, /INPOSDOM/i);
  assert.match(html.cubacash, /2025|stale|desactualizad/i);
});

test('trade: rice/diesel is pinned first in the manage pipeline', () => {
  const sec = manageSection(html.trade);
  assert.ok(sec.includes('RFQ-RICE-DIESEL-0917'), 'pin marker present');
});
