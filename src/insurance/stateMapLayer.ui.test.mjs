import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import the module BEFORE installing the DOM double: cesium's widget bundle
// sniffs for a real document at load time, and a half-mocked one crashes it.
// (In the browser the document is always real.)
const {
  initStateMapLayer,
  stateSummary,
  STATE_CENTROIDS,
  STATE_HEALTH_COLORS,
} = await import('./stateMapLayer.js');
const insuranceEngine = await import('./insuranceEngine.js');
import * as Cesium from 'cesium';

function makeEl() {
  const el = {
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    _html: '',
    textContent: '',
    id: '',
    value: '',
    disabled: false,
    removed: false,
    _handlers: {},
    appendChild(c) { this.children.push(c); return c; },
    remove() { this.removed = true; },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener(type, fn) { this._handlers[type] = fn; },
    removeEventListener() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    click() { if (typeof this._handlers.click === 'function') this._handlers.click(); },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
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

function makeViewer() {
  const byId = new Map();
  const added = [];
  return {
    added,
    entities: {
      add(def) {
        added.push(def);
        byId.set(def.id, def);
        return def;
      },
      remove(ref) {
        byId.delete(typeof ref === 'string' ? ref : ref?.id);
      },
      getById(id) {
        return byId.get(id);
      },
    },
    scene: {
      canvas: { addEventListener() {}, removeEventListener() {} },
      pick: () => null,
    },
    camera: {
      lastFly: null,
      flyTo(opts) {
        this.lastFly = opts;
      },
    },
  };
}

const MAPSTATE = {
  businesses: {
    wholesale: {
      coverages: [
        { id: 'm1', status: 'gap', state: 'TX' },
        { id: 'm2', status: 'active', exp: '2026-09-20', state: 'FL' }, // ≤30d
        { id: 'm3', status: 'active', exp: '2027-01-01', state: 'CA' },
      ],
      claims: [],
    },
  },
};

const store = { getState: () => MAPSTATE };

function colorOf(viewer, code) {
  const def = viewer.added.find((d) => d.id === `gev-ins-state-${code}`);
  return def?.point?.color;
}

function colorEquals(color, hex) {
  return Cesium.Color.equals(color, Cesium.Color.fromCssColorString(hex));
}

test('51 state/DC centroids exist and are documented as approximate', () => {
  assert.equal(Object.keys(STATE_CENTROIDS).length, 51);
  assert.ok(STATE_CENTROIDS.DC, 'includes DC');
  assert.ok(STATE_CENTROIDS.TX);
});

test('refresh creates 51 entities colored from user data', () => {
  const viewer = makeViewer();
  const layer = initStateMapLayer(viewer, { store, engine: insuranceEngine });
  layer.refresh();
  assert.equal(layer._count(), 51);
  assert.ok(colorEquals(colorOf(viewer, 'TX'), STATE_HEALTH_COLORS.red), 'TX red = gaps');
  assert.ok(colorEquals(colorOf(viewer, 'FL'), STATE_HEALTH_COLORS.amber), 'FL amber = renewal');
  assert.ok(colorEquals(colorOf(viewer, 'CA'), STATE_HEALTH_COLORS.green), 'CA green = active');
  assert.ok(colorEquals(colorOf(viewer, 'NY'), STATE_HEALTH_COLORS.gray), 'NY gray = no data');
  layer.destroy();
  assert.equal(layer._count(), 0);
});

test('stateSummary is bilingual and honest', () => {
  const es = stateSummary('TX', { gaps: 2, active: 1, expiring: 0 }, 'es');
  assert.equal(es.health, 'red');
  assert.match(es.text, /2 brechas/);
  const en = stateSummary('NY', {}, 'en');
  assert.equal(en.health, 'gray');
  assert.equal(en.text, 'No data');
});

test('_pick on a state flies the camera and returns a summary', () => {
  bodyEl.children.length = 0;
  const viewer = makeViewer();
  const seen = [];
  const layer = initStateMapLayer(viewer, { store, engine: insuranceEngine });
  layer.onStateClick((code, summary) => seen.push([code, summary]));
  layer.refresh();
  const summary = layer._pick({ id: { id: 'gev-ins-state-TX' } });
  assert.ok(summary, 'summary returned');
  assert.equal(summary.code, 'TX');
  assert.equal(summary.health, 'red');
  assert.ok(viewer.camera.lastFly, 'camera flew');
  assert.deepEqual(seen.map((s) => s[0]), ['TX']);
  // small summary shown in DOM
  assert.ok(bodyEl.children.some((c) => c.id === 'gev-ins-state-summary'));
  layer.destroy();
});

test('_pick on unknown entity returns null', () => {
  const viewer = makeViewer();
  const layer = initStateMapLayer(viewer, { store, engine: insuranceEngine });
  layer.refresh();
  assert.equal(layer._pick({ id: { id: 'something-else' } }), null);
  layer.destroy();
});

test('no viewer: refresh is a no-op, no crash', () => {
  const layer = initStateMapLayer(null, { viewer: null, store, engine: insuranceEngine });
  layer.refresh();
  assert.equal(layer._count(), 0);
  layer.destroy();
});
