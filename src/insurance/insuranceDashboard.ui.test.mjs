import { test } from 'node:test';
import assert from 'node:assert/strict';

// insuranceDashboard never imports cesium, so the DOM double can be
// installed before the import without breaking anything.
const {
  initInsuranceDashboard,
  statCards,
} = await import('./insuranceDashboard.js');

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
    removed: false,
    _handlers: {},
    appendChild(c) { this.children.push(c); return c; },
    remove() { this.removed = true; },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener(type, fn) { this._handlers[type] = fn; },
    removeEventListener() {},
    click() { if (typeof this._handlers.click === 'function') this._handlers.click(); },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  return el;
}

const bodyEl = makeEl();
let openedUrl = null;

globalThis.window = globalThis;
globalThis.window.open = (url) => {
  openedUrl = url;
  return null;
};
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
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

const SAMPLE = {
  businesses: {
    personal: {
      coverages: [
        { id: 'c1', status: 'gap' },
        { id: 'c2', status: 'active', exp: '2026-09-25' },
      ],
      claims: [{ id: 'cl1', stage: 1 }, { id: 'cl2', stage: 5 }],
    },
  },
  quotes: [{ id: 'q1', premium: 100 }],
};

const store = { getState: () => SAMPLE, saveState: () => true };

test('statCards counts gaps, renewals, open claims, quotes', () => {
  const cards = statCards(SAMPLE, null, 'es');
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(byId.gaps.value, 1);
  assert.equal(byId.renewals.value, 1);
  assert.equal(byId.claims.value, 1);
  assert.equal(byId.quotes.value, 1);
  assert.equal(byId.gaps.tone, 'alert');
  assert.match(byId.gaps.label, /Brechas/);
});

test('statCards handles missing state safely', () => {
  const cards = statCards(null, null, 'en');
  for (const c of cards) assert.equal(c.value, 0);
  assert.match(cards[0].label, /Coverage gaps/);
});

test('initInsuranceDashboard opens panel and renders 4 KPI cards', () => {
  bodyEl.children.length = 0;
  const dash = initInsuranceDashboard(null, { store });
  dash.open();
  const panel = bodyEl.children.find((c) => c.id === 'gev-insurance-panel');
  assert.ok(panel, 'panel mounted');
  const kpis = panel.children[1].children[0];
  assert.equal(kpis.children.length, 4, 'four KPI cards');
  const values = kpis.children.map((k) => k.children[1].textContent);
  assert.deepEqual(values, ['1', '1', '1', '1']);
  dash.destroy();
  assert.ok(panel.removed, 'panel removed on destroy');
});

test('openDeepLink opens /insurance/#<view>', () => {
  openedUrl = null;
  const dash = initInsuranceDashboard(null, { store });
  dash.openDeepLink('claims');
  assert.equal(openedUrl, '/insurance/#claims');
  dash.destroy();
});

test('toggle opens and closes', () => {
  bodyEl.children.length = 0;
  const dash = initInsuranceDashboard(null, { store });
  dash.toggle();
  const panel = bodyEl.children.find(
    (c) => c.id === 'gev-insurance-panel' && !c.removed,
  );
  assert.ok(panel, 'panel opened');
  dash.toggle();
  assert.ok(panel.removed, 'panel removed on toggle-close');
  dash.destroy();
});

test('setLang switches ES/EN', () => {
  const dash = initInsuranceDashboard(null, { store });
  assert.equal(dash.getLang(), 'es');
  assert.equal(dash.setLang('en'), 'en');
  assert.equal(dash.getLang(), 'en');
  dash.destroy();
});
