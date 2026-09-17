import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  BUSINESSES,
  GLOBE_CARD,
  initBusinessLauncher,
  openBusinessScreen,
} = await import('./businessLauncher.js');

function makeEl(tag = 'div') {
  const el = {
    children: [],
    dataset: {},
    style: {},
    tagName: String(tag).toUpperCase(),
    textContent: '',
    id: '',
    className: '',
    removed: false,
    _handlers: {},
    _attrs: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, f) {
        if (f === undefined) this._set.has(c) ? this._set.delete(c) : this._set.add(c);
        else f ? this._set.add(c) : this._set.delete(c);
      },
      contains(c) { return this._set.has(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    remove() { this.removed = true; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] ?? null; },
    addEventListener(type, fn) { this._handlers[type] = fn; },
    removeEventListener() {},
    click() { if (typeof this._handlers.click === 'function') this._handlers.click(); },
    querySelector(sel) {
      const all = this.querySelectorAll(sel);
      return all[0] || null;
    },
    querySelectorAll(sel) {
      const out = [];
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      const walk = (n) => {
        for (const c of n.children || []) {
          if (cls && (c.className || '').split(' ').includes(cls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    },
  };
  return el;
}

const head = makeEl('head');
const body = makeEl('body');
const store = {};
globalThis.document = {
  createElement: (tag) => makeEl(tag),
  getElementById: () => null,
  head,
  body,
  addEventListener() {},
};
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

test('five businesses, one per module, with standalone screen URLs', () => {
  assert.equal(BUSINESSES.length, 5);
  const byId = Object.fromEntries(BUSINESSES.map((b) => [b.id, b]));
  assert.equal(byId.wholesale.screen, '/wholesale/index.html');
  assert.equal(byId.crude.screen, '/crude/index.html');
  assert.equal(byId.insurance.screen, '/insurance/index.html');
  assert.equal(byId.trade.screen, '/import-export/index.html');
  assert.equal(byId.cubacash.screen, '/cubacash/index.html');
  for (const b of BUSINESSES) {
    assert.ok(b.es && b.en, `${b.id} bilingual labels`);
    assert.ok(b.esDesc && b.enDesc, `${b.id} bilingual description`);
    assert.ok(b.icon, `${b.id} icon`);
  }
});

test('launcher builds floating button and overlay; toggle opens and closes', () => {
  body.children.length = 0;
  const launcher = initBusinessLauncher({ autoOpen: false });
  const fab = body.children.find((c) => c.id === 'gev-bizlauncher-btn');
  const overlay = body.children.find(
    (c) => c.id === 'gev-bizlauncher-overlay',
  );
  assert.ok(fab, 'floating button exists');
  assert.ok(overlay, 'overlay exists');
  assert.ok(!overlay.classList.contains('open'), 'starts closed');
  fab.click();
  assert.ok(overlay.classList.contains('open'), 'opens on tap');
  const bizButtons = overlay.querySelectorAll('.bl-biz');
  assert.equal(bizButtons.length, 6, 'five business buttons + globe card');
  const globe = overlay.querySelectorAll('.bl-globe');
  assert.equal(globe.length, 1, 'exactly one globe card');
  fab.click();
  assert.ok(!overlay.classList.contains('open'), 'closes on second tap');
  launcher.destroy();
  assert.ok(fab.removed && overlay.removed, 'elements removed on destroy');
});

test('ES/EN toggle relabels the business buttons', () => {
  body.children.length = 0;
  const launcher = initBusinessLauncher();
  const overlay = body.children.find(
    (c) => c.id === 'gev-bizlauncher-overlay',
  );
  launcher.setLang('en');
  const namesEn = overlay
    .querySelectorAll('.bl-biz')
    .map((b) => b.querySelector('.bl-name').textContent);
  assert.ok(
    namesEn.includes('Wholesale Real Estate'),
    'english labels applied',
  );
  launcher.setLang('es');
  const namesEs = overlay
    .querySelectorAll('.bl-biz')
    .map((b) => b.querySelector('.bl-name').textContent);
  assert.ok(
    namesEs.includes('Bienes raíces mayoristas'),
    'spanish labels applied',
  );
  assert.equal(store['sahjony.gev.lang'], 'es', 'language persisted');
  launcher.destroy();
});

test('globe card is bilingual and separate from the five businesses', () => {
  assert.equal(BUSINESSES.length, 5, 'business roster stays five');
  assert.ok(
    !BUSINESSES.some((b) => b.id === 'globe'),
    'globe is not a business',
  );
  assert.equal(GLOBE_CARD.id, 'globe');
  assert.equal(GLOBE_CARD.icon, '🌐');
  assert.ok(GLOBE_CARD.es && GLOBE_CARD.en, 'globe card bilingual');
});

test('hub architecture: launcher auto-opens as the default entry view', () => {
  body.children.length = 0;
  const launcher = initBusinessLauncher();
  const overlay = body.children.find(
    (c) => c.id === 'gev-bizlauncher-overlay',
  );
  assert.ok(
    overlay.classList.contains('open'),
    'overlay opens automatically by default',
  );
  launcher.destroy();
});

test('autoOpen:false keeps the pre-hub behavior (reversible)', () => {
  body.children.length = 0;
  const launcher = initBusinessLauncher({ autoOpen: false });
  const overlay = body.children.find(
    (c) => c.id === 'gev-bizlauncher-overlay',
  );
  assert.ok(
    !overlay.classList.contains('open'),
    'overlay stays closed with autoOpen:false',
  );
  launcher.destroy();
});

test('globe card dismisses the hub and relabels ES/EN', () => {
  body.children.length = 0;
  const launcher = initBusinessLauncher();
  const overlay = () =>
    body.children.find((c) => c.id === 'gev-bizlauncher-overlay');
  // NOTE: the node DOM double does not clear children on innerHTML='',
  // so re-query (like the ES/EN toggle test) instead of holding an element.
  const globeNames = () =>
    overlay()
      .querySelectorAll('.bl-globe')
      .map((g) => g.querySelector('.bl-name').textContent);
  launcher.setLang('es');
  assert.ok(globeNames().includes('Globo'), 'spanish globe label');
  launcher.setLang('en');
  assert.ok(globeNames().includes('Globe'), 'english globe label');
  assert.ok(overlay().classList.contains('open'), 'hub open before tap');
  overlay().querySelectorAll('.bl-globe')[0].click();
  assert.ok(
    !overlay().classList.contains('open'),
    'globe card closes the hub overlay',
  );
  launcher.destroy();
});

test('openBusinessScreen opens the standalone screen URL', () => {
  let opened = null;
  globalThis.window.open = (url, target) => {
    opened = { url, target };
    return null;
  };
  const ret = openBusinessScreen('/crude/index.html');
  assert.equal(opened.url, '/crude/index.html');
  assert.equal(opened.target, '_blank');
  assert.equal(ret, '/crude/index.html');
  delete globalThis.window.open;
});

test('launcher CSS uses large touch targets', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('./businessLauncher.js', import.meta.url),
    'utf8',
  );
  assert.ok(src.includes('min-height:84px'), 'business buttons are tall');
  assert.ok(src.includes('min-height:48px'), 'header controls are tall');
  assert.ok(src.includes('width:64px'), 'floating button is 64px');
});
