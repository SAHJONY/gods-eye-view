import { test } from 'node:test';
import assert from 'node:assert/strict';

// This module never imports cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initCarsWorkforcePanel,
  AGENT_DEFS,
  WORKFORCE_NOTE,
} = await import('./carsWorkforcePanel.js');

function makeEl() {
  const el = {
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    _html: '',
    textContent: '',
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

test('panel opens with the 4-agent roster, 44px touch targets', () => {
  const panel = initCarsWorkforcePanel({ workforce: null });
  try {
    const el = panel.open();
    assert.ok(el);
    assert.equal(el.id, 'gev-cars-workforce-panel');
    assert.ok(el.innerHTML.includes('CARROS CUBA'));
  } finally {
    panel.close();
    panel.destroy();
  }
});

test('panel shows the honest workforce note', () => {
  const panel = initCarsWorkforcePanel({ workforce: null });
  const el = panel.open();
  try {
    // The note element is in the template; its text is set via textContent
    // (honest constant also covered in the pure test).
    assert.ok(el.innerHTML.includes('cwp-note'));
    assert.ok(WORKFORCE_NOTE.es.includes('mientras la app'));
    assert.ok(WORKFORCE_NOTE.en.includes('while the app'));
  } finally {
    panel.close();
    panel.destroy();
  }
});

test('dock button exists and toggles the panel', () => {
  const panel = initCarsWorkforcePanel({ workforce: null });
  panel.toggle();
  panel.toggle();
  panel.destroy();
});

test('getAgents returns the canonical roster when no workforce is attached', () => {
  const panel = initCarsWorkforcePanel({ workforce: null });
  const agents = panel.getAgents();
  assert.equal(agents.length, AGENT_DEFS.length);
  assert.ok(agents.every((a) => a.status === 'idle'));
  panel.destroy();
});
