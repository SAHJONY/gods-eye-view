import { test } from 'node:test';
import assert from 'node:assert/strict';

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
    appendChild(c) { this.children.push(c); return c; },
    remove() { this.removed = true; },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  return el;
}

globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => null,
  createElement: () => makeEl(),
  head: makeEl(),
  body: makeEl(),
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
};

const viewer = {
  scene: { canvas: {} },
  camera: {
    heading: 0, pitch: 0, roll: 0,
    position: { clone: () => ({}) },
    pickEllipsoid: () => null,
    flyTo() {},
    setView() {},
  },
  entities: { add: () => ({ __stub: true }), remove: () => {} },
};

const { initStreetView } = await import('./streetView.js');

test('streetView: dock button builds and panel opens/closes', () => {
  const sv = initStreetView({ viewer });
  assert.ok(sv);
  assert.equal(typeof sv.openAt, 'function');

  const opened = sv.openAt(29.7604, -95.3698);
  assert.deepEqual(opened, { lat: 29.7604, lng: -95.3698 });

  sv.close();
  sv.openAtCurrent(); // no focus provider, no Cesium pick → null-safe
  sv.destroy();
});

test('streetView: rejects invalid coordinates', () => {
  const sv = initStreetView({ viewer });
  assert.equal(sv.openAt(NaN, -95.36), null);
  assert.equal(sv.openAt(29.76, Infinity), null);
  sv.destroy();
});

test('streetView: requires a viewer', () => {
  assert.throws(() => initStreetView({}), /viewer is required/);
});
