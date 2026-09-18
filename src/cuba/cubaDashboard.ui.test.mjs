// UI test for the Cuba desk dashboard: cubaDashboard.js.
// The module under test is imported BEFORE the DOM double is installed.
// All fixture values are deliberately fictional. No real buyers, partners,
// or requests appear anywhere in these fixtures.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  REQUEST_STATUSES,
  statusPillClass,
  verificationLabel,
  buyerTypeLabel,
  adaptStore,
  createMemoryCubaStore,
  initCubaDashboard,
  CUBA_DASHBOARD_CSS,
} from './cubaDashboard.js';

let realDocument;
let realWindow;
let realHTMLElement;

const domEvents = [];
function makeEl(tag) {
  const el = {
    tag,
    id: '',
    className: '',
    style: {},
    dataset: {},
    children: [],
    textContent: '',
    _html: '',
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    parent: null,
    _listeners: {},
    _options: [],
    appendChild(child) {
      child.parent = el;
      el.children.push(child);
      if (child.tag === 'option') el._options.push(child);
      return child;
    },
    remove() {
      if (el.parent) {
        const i = el.parent.children.indexOf(el);
        if (i >= 0) el.parent.children.splice(i, 1);
        el.parent = null;
      }
    },
    addEventListener(type, fn) {
      el._listeners[type] = el._listeners[type] || [];
      el._listeners[type].push(fn);
      domEvents.push([type, fn]);
    },
    removeEventListener() {},
    setAttribute() {},
    getAttribute() {
      return null;
    },
    querySelector(sel) {
      const q = sel.replace(/^[#.]/, '');
      const all = flatten(el);
      return all.find((e) => e.id === q || hasClass(e, q)) || null;
    },
    querySelectorAll(sel) {
      const q = sel.replace(/^[#.]/, '');
      return flatten(el).filter((e) => e.id === q || hasClass(e, q));
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return this._html;
    },
    set(v) {
      this._html = String(v);
      this.children = [];
    },
  });
  return el;
}

function hasClass(el, q) {
  return String(el.className || '')
    .split(' ')
    .includes(q);
}

function flatten(el) {
  const out = [el];
  for (const c of el.children) out.push(...flatten(c));
  return out;
}

function installDomDouble() {
  realDocument = globalThis.document;
  realWindow = globalThis.window;
  realHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = class {};
  const body = makeEl('body');
  const head = makeEl('head');
  globalThis.document = {
    createElement: (t) => makeEl(t),
    body,
    head,
    getElementById: (id) => {
      const all = flatten(body);
      return all.find((e) => e.id === id) || null;
    },
  };
  globalThis.window = {};
}

function removeDomDouble() {
  globalThis.document = realDocument;
  globalThis.window = realWindow;
  globalThis.HTMLElement = realHTMLElement;
}

beforeEach(() => {
  installDomDouble();
});

afterEach(() => {
  removeDomDouble();
});

test('statusPillClass: verdicts and statuses map to pill classes', () => {
  assert.equal(statusPillClass('green'), 'green');
  assert.equal(statusPillClass('won'), 'green');
  assert.equal(statusPillClass('triage'), 'yellow');
  assert.equal(statusPillClass('quoted'), 'yellow');
  assert.equal(statusPillClass('bogus'), 'gray');
});

test('verificationLabel / buyerTypeLabel: bilingual', () => {
  assert.equal(verificationLabel('verified', 'es'), 'Verificado');
  assert.equal(verificationLabel('verified', 'en'), 'Verified');
  assert.equal(verificationLabel('unknown', 'es'), 'Sin verificar');
  assert.equal(buyerTypeLabel('tcp', 'es'), 'TCP');
  assert.equal(buyerTypeLabel('cooperativa', 'en'), 'Cooperative');
});

test('CUBA_DASHBOARD_CSS: 44px touch targets and 16px inputs', () => {
  assert.ok(/min-height:\s*44px/.test(CUBA_DASHBOARD_CSS), 'has 44px min-height');
  assert.ok(/font-size:\s*16px/.test(CUBA_DASHBOARD_CSS), 'has 16px inputs');
  assert.ok(!/min-height:\s*1[0-3]px/.test(CUBA_DASHBOARD_CSS), 'no tiny buttons');
});

test('createMemoryCubaStore: request CRUD + buyer CRUD + stats', () => {
  const store = createMemoryCubaStore();
  const r = store.createRequest({
    ref: 'CUBA-800',
    product: 'Arroz pilado',
    quantity: 2000,
  });
  assert.ok(r.id);
  assert.equal(r.status, 'intake');
  store.moveRequest(r.id, 'triage');
  assert.equal(store.getRequest(r.id).status, 'triage');
  assert.equal(store.listRequests('triage').length, 1);

  const b = store.createBuyer({
    name: 'Comprador Ficticio SRL',
    province: 'Artemisa',
    contact: { whatsapp: '+53-555-0303' },
  });
  assert.equal(b.verification, 'unverified');
  assert.equal(store.getBuyer(b.id).name, 'Comprador Ficticio SRL');
  store.updateBuyer(b.id, { verification: 'verified' });
  assert.equal(store.getBuyer(b.id).verification, 'verified');

  store.createPartner({ name: 'Socio Ficticio', country: 'Panamá' });
  const s = store.stats();
  assert.equal(s.totalBuyers, 1);
  assert.equal(s.openRequests, 1);
  assert.equal(s.totalPartners, 1);

  assert.ok(store.deleteRequest(r.id));
  assert.equal(store.listRequests().length, 0);
});

test('createMemoryCubaStore: invalid status rejected on move', () => {
  const store = createMemoryCubaStore();
  const r = store.createRequest({ ref: 'CUBA-801', product: 'Azúcar' });
  store.moveRequest(r.id, 'bogus');
  assert.equal(store.getRequest(r.id).status, 'intake');
});

test('createMemoryCubaStore: notes round-trip', () => {
  const store = createMemoryCubaStore();
  const r = store.createRequest({ ref: 'CUBA-802', product: 'Café' });
  store.addRequestNote(r.id, 'Nota de triaje');
  assert.equal(store.notes(r.id).length, 1);
  assert.equal(store.notes(r.id)[0].es, 'Nota de triaje');
});

test('createMemoryCubaStore: onMutate listener fires', () => {
  const store = createMemoryCubaStore();
  let calls = 0;
  const unsub = store.onMutate(() => {
    calls += 1;
  });
  store.createRequest({ ref: 'CUBA-803', product: 'Miel' });
  unsub();
  assert.equal(calls, 1);
});

test('adaptStore: wraps the memory store, tolerant of missing fns', () => {
  const store = createMemoryCubaStore();
  const adapted = adaptStore(store);
  const r = adapted.create({ ref: 'CUBA-810', product: 'Arroz', quantity: 5 });
  assert.ok(r && r.id);
  assert.equal(adapted.listAll().length, 1);
  assert.equal(adapted.list('intake').length, 1);
  assert.equal(adapted.byId(r.id).ref, 'CUBA-810');
  assert.equal(adapted.stats().totalRequests, 1);
  // null store → falls back to a working memory store
  const fallback = adaptStore(null);
  assert.equal(fallback.stats().totalRequests, 0);
});

test('initCubaDashboard: button builds, panel opens and closes, drawer is safe', () => {
  const store = createMemoryCubaStore();
  const api = initCubaDashboard({ cubaStore: store });
  assert.ok(api);
  const btn = api.button();
  document.body.appendChild(btn);
  assert.equal(btn.id, 'gev-cuba-btn');

  api.open();
  const panel = document.getElementById('gev-cuba-panel');
  assert.ok(panel, 'panel opens');
  const cols = panel.querySelectorAll('.cdp-col');
  assert.equal(cols.length, REQUEST_STATUSES.length);

  // Drawer opens on a request and survives a missing engine.
  const r = store.createRequest({ ref: 'CUBA-811', product: 'Arroz', quantity: 100 });
  api.openDrawer(r.id);
  const drawer = document.getElementById('gev-cuba-drawer');
  assert.ok(drawer);

  // Drawer body renders without a buyer present.
  api.openDrawer('no-such-id');
  api.close();
  api.destroy();
});

test('initCubaDashboard: drawer math is defensive against a throwing engine', () => {
  const store = createMemoryCubaStore();
  const badEngine = new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error('engine down');
        };
      },
    },
  );
  const api = initCubaDashboard({ cubaStore: store, cubaEngine: badEngine });
  const r = store.createRequest({ ref: 'CUBA-812', product: 'Arroz', quantity: 100 });
  api.open();
  assert.doesNotThrow(() => api.openDrawer(r.id));
  api.destroy();
});

test('initCubaDashboard: refresh re-renders columns after intake create', () => {
  const store = createMemoryCubaStore();
  const api = initCubaDashboard({ cubaStore: store });
  api.open();
  store.createRequest({ ref: 'CUBA-813', product: 'Aceite', quantity: 50 });
  api.refresh();
  const panel = document.getElementById('gev-cuba-panel');
  const intakeCol = panel
    .querySelectorAll('.cdp-col')
    .find((c) => c.dataset.status === 'intake');
  assert.ok(intakeCol);
  const head = intakeCol.querySelector('.cdp-colhead');
  assert.ok(head && head.textContent.includes('(1)'));
  api.destroy();
});

test('initCubaDashboard: no address/registration UI fields anywhere', () => {
  const store = createMemoryCubaStore();
  const api = initCubaDashboard({ cubaStore: store });
  api.open();
  const panel = document.getElementById('gev-cuba-panel');
  const allText = flatten(panel)
    .map((e) => `${e.textContent || ''} ${e.placeholder || ''}`)
    .join(' ')
    .toLowerCase();
  assert.ok(!allText.includes('address'), 'no address UI');
  assert.ok(!allText.includes('dirección'), 'no dirección UI');
  assert.ok(!allText.includes('registration'), 'no registration UI');
  assert.ok(!allText.includes('registro mercantil'), 'no registro UI');
  api.destroy();
});

test('initCubaDashboard: CSV import adds buyers via parseCsv injection', () => {
  const store = createMemoryCubaStore();
  const parseCsv = (text) => {
    if (typeof text !== 'string' || !text.trim()) return null;
    return {
      buyers: [{ name: 'Importado Ficticio', province: 'Granma' }],
      requests: [],
      errors: 0,
    };
  };
  const api = initCubaDashboard({ cubaStore: store, parseCsv });
  api.open();
  api.refresh();
  assert.equal(store.listBuyers().length, 0);
  api.destroy();
});
