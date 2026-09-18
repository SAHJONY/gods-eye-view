import { test } from 'node:test';
import assert from 'node:assert/strict';

// This module never imports cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initCarDashboard,
  createMemoryCarStore,
  draftRosmelWhatsapp,
} = await import('./carDashboard.js');

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

globalThis.window = globalThis;
globalThis.document = {
  location: { href: 'http://localhost/' },
  getElementById: () => null,
  createElement: () => makeEl(),
  head: makeEl(),
  body: makeEl(),
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
};

// Text content only (no tags, no attributes): internal economics must never
// render as readable content; CSS like style="margin:..." is irrelevant.
function textOf(html) {
  return html.replace(/<[^>]*>/g, ' ');
}

function seededStore() {
  const store = createMemoryCarStore();
  const lead = store.createLead({
    name: 'Sample Buyer',
    whatsapp: '+1 555-0100',
    interest: 'Sample Model (fictional)',
    budgetUsd: 99999,
    stage: 'calificado',
  });
  store.createDeal({ leadId: lead.id, model: 'Sample Model (fictional)', buyerPrice: 99999 });
  store.createDraft({
    kind: 'rosmel',
    title: 'Sample Rosmel draft',
    bodyEs: draftRosmelWhatsapp({
      leadName: 'Sample Buyer',
      model: 'Sample Model (fictional)',
      price: 99999,
      lang: 'es',
    }),
    state: 'draft',
  });
  store.addSnapshot({
    competitor: 'Sample Competitor (fictional)',
    model: 'Sample Model (fictional)',
    price: 88888,
    date: '2026-09-17',
    sourceUrl: 'https://example.com/sample',
  });
  store.setOurPrice('Sample Model (fictional)', 77777);
  return store;
}

test('dashboard opens with ES-first title and nav', () => {
  const dash = initCarDashboard({ carStore: seededStore() });
  const el = dash.open();
  assert.ok(el);
  assert.equal(el.id, 'gev-cars-panel');
  assert.ok(el.innerHTML.includes('CARROS CUBA'));
  dash.close();
  dash.destroy();
});

test('all four v1 sections render', () => {
  const dash = initCarDashboard({ carStore: seededStore() });
  for (const section of ['funnel', 'drafts', 'prices', 'deals']) {
    const html = dash.renderSectionHtml(section);
    assert.ok(html.length > 100, `section ${section} renders`);
  }
  dash.destroy();
});

test('funnel renders buyer name but no internal economics', () => {
  const dash = initCarDashboard({ carStore: seededStore() });
  const html = dash.renderSectionHtml('funnel');
  assert.ok(html.includes('Sample Buyer'));
  assert.ok(html.includes('Sample Model (fictional)'));
  assert.ok(!/margen|margin|diferencial|spread|floor|proveedor|supplier/i.test(textOf(html)));
  dash.destroy();
});

test('drafts section shows the draft with broker disclosure and DRAFTS-ONLY banner', () => {
  const dash = initCarDashboard({ carStore: seededStore() });
  const html = dash.renderSectionHtml('drafts');
  assert.ok(html.includes('Sample Rosmel draft'));
  assert.ok(html.includes('intermediario'));
  assert.ok(html.includes('BORRADORES SOLAMENTE'));
  assert.ok(!/margen|floor|supplier/i.test(html));
  dash.destroy();
});

test('prices section renders undercut indicator against our price', () => {
  const dash = initCarDashboard({ carStore: seededStore() });
  const html = dash.renderSectionHtml('prices');
  assert.ok(html.includes('Sample Competitor (fictional)'));
  assert.ok(html.includes('$77,777'));
  // Our price 77777 vs competitor 88888 -> we are under.
  assert.ok(html.includes('Por debajo') || html.includes('Under'));
  assert.ok(!/margen|margin|spread|floor|proveedor|supplier/i.test(textOf(html)));
  dash.destroy();
});

test('deals section renders buyer price only — never internal math', () => {
  const dash = initCarDashboard({ carStore: seededStore() });
  const html = dash.renderSectionHtml('deals');
  assert.ok(html.includes('$99,999'));
  assert.ok(html.includes('intermediario'));
  assert.ok(!/margen|margin|spread|diferencial|floor|proveedor|supplier/i.test(textOf(html)));
  dash.destroy();
});

test('toggle opens and closes the panel', () => {
  const dash = initCarDashboard({ carStore: seededStore() });
  dash.toggle();
  dash.toggle();
  dash.destroy();
});

test('lang switches to English', () => {
  const dash = initCarDashboard({ carStore: seededStore() });
  dash.setLang('en');
  assert.equal(dash.getLang(), 'en');
  const html = dash.renderSectionHtml('drafts');
  assert.ok(html.includes('DRAFTS ONLY'));
  dash.destroy();
});
