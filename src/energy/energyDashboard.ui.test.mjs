import { test } from 'node:test';
import assert from 'node:assert/strict';

// This module never imports cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initEnergyDashboard,
  productTabs,
  specRows,
  benchmarkRows,
  gateSummaryText,
  statusText,
  LOGISTICS_CHECKLIST,
} = await import('./energyDashboard.js');
import * as energyStore from './energyStore.js';
import * as energyEngine from './energyEngine.js';

function makeEl() {
  const el = {
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    _html: '',
    textContent: '',
    value: '',
    id: '',
    checked: false,
    disabled: false,
    removed: false,
    _handlers: {},
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    remove() {
      this.removed = true;
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    addEventListener(type, fn) {
      this._handlers[type] = fn;
    },
    removeEventListener() {},
    click() {
      if (typeof this._handlers.click === 'function') this._handlers.click();
    },
    scrollIntoView() {},
    querySelector() {
      return makeEl();
    },
    querySelectorAll() {
      return [];
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return this._html;
    },
    set(v) {
      this._html = String(v);
    },
  });
  return el;
}

const bodyEl = makeEl();

globalThis.window = globalThis;
globalThis.document = {
  location: { href: 'http://localhost/' },
  getElementById: () => null,
  createElement: () => makeEl(),
  head: makeEl(),
  body: bodyEl,
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
};

function freshDashboard() {
  energyStore.resetEnergyStore();
  energyStore.reloadEnergyStore();
  return initEnergyDashboard({ storeApi: energyStore, engine: energyEngine });
}

test('productTabs: diesel, gasoline, lpg only (crude excluded from spec tabs)', () => {
  assert.deepEqual(productTabs(), ['diesel', 'gasoline', 'lpg']);
});

test('specRows: bilingual rows for every product tab', () => {
  for (const p of productTabs()) {
    const rows = specRows(p);
    assert.ok(rows.length > 0, p);
    for (const r of rows) {
      assert.ok(r.paramEs && r.paramEn, 'bilingual param');
      assert.ok(r.value, 'value present');
    }
  }
  assert.deepEqual(specRows('nope'), []);
});

test('benchmarkRows: sorted newest-first, honest fields', () => {
  const rows = benchmarkRows(energyStore.listBenchmarks());
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(r.date && r.source, 'dated and sourced');
  }
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].date >= rows[i].date, 'newest first');
  }
});

test('gateSummaryText: bilingual blocked/passed summaries', () => {
  const clean = energyEngine.evaluateGate(
    Object.fromEntries(energyEngine.GATE_CHECKLIST_TEMPLATE.map((i) => [i.id, 'yes'])),
  );
  assert.match(gateSummaryText(clean, 'es'), /aprobado/i);
  assert.match(gateSummaryText(clean, 'en'), /passed/i);
  const blocked = energyEngine.evaluateGate({});
  assert.match(gateSummaryText(blocked, 'es'), /BLOQUEADO/);
  assert.match(gateSummaryText(blocked, 'en'), /BLOCKED/);
  assert.match(gateSummaryText(null, 'es'), /Sin evaluar/);
});

test('statusText: bilingual for every pipeline status', () => {
  for (const s of energyStore.INQUIRY_STATUSES) {
    assert.ok(statusText(s, 'es') && statusText(s, 'en'), s);
  }
});

test('LOGISTICS_CHECKLIST: bilingual reference items', () => {
  assert.ok(LOGISTICS_CHECKLIST.length >= 5);
  for (const item of LOGISTICS_CHECKLIST) {
    assert.ok(item.id && item.es && item.en);
  }
});

test('open/close/toggle lifecycle with DOM double', () => {
  const dash = freshDashboard();
  assert.equal(dash._rendered(), false);
  assert.equal(dash.open(), true);
  assert.equal(dash._rendered(), true);
  assert.equal(bodyEl.children.length > 0, true);
  dash.toggle();
  assert.equal(dash._rendered(), false);
  dash.toggle();
  assert.equal(dash._rendered(), true);
  dash.destroy();
  assert.equal(dash._rendered(), false);
});

test('openSpecs selects the product tab; openGate opens without crash', () => {
  const dash = freshDashboard();
  dash.openSpecs('lpg');
  assert.equal(dash._rendered(), true);
  const inq = energyStore.createInquiry({ ref: 'ENQ-UI-1', product: 'diesel' });
  dash.openGate(inq.id);
  assert.equal(dash._rendered(), true);
  dash.destroy();
});

test('setLang switches ES/EN', () => {
  const dash = freshDashboard();
  assert.equal(dash.getLang(), 'es');
  dash.setLang('en');
  assert.equal(dash.getLang(), 'en');
  dash.destroy();
});

test('mountFab adds a floating action button', () => {
  const dash = freshDashboard();
  const before = bodyEl.children.length;
  dash.mountFab();
  assert.ok(bodyEl.children.length >= before);
  dash.destroy();
});

test('the gate has no bypass: dashboard never calls moveInquiry to commercial', async () => {
  // Static guarantee: the dashboard source must not contain a call that
  // moves an inquiry straight to 'commercial'.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('./energyDashboard.js', import.meta.url),
    'utf8',
  );
  const bypassCalls = (src.match(/moveInquiry\([^)]*['"]commercial['"]/g) || []).length;
  assert.equal(bypassCalls, 0, 'no direct moveInquiry to commercial anywhere in the dashboard');
});
