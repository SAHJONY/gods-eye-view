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
    value: '',
    files: [],
    disabled: false,
    removed: false,
    appendChild(c) { this.children.push(c); return c; },
    remove() { this.removed = true; },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    click() {},
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
  scene: { canvas: { clientWidth: 800, clientHeight: 600 } },
  camera: {
    heading: 0, pitch: 0, roll: 0,
    pickEllipsoid: () => null,
    flyTo() {},
    setView() {},
  },
  entities: { add: () => ({ __stub: true }), remove: () => {} },
};

const { initDriveForDollars } = await import('./driveForDollars.js');

test('drive: start/stop cycle works headless (no GPS in node)', () => {
  const drive = initDriveForDollars({ viewer });
  assert.equal(drive.driving, false);

  const started = drive.start();
  assert.equal(started.ok, true);
  assert.equal(drive.driving, true);

  const stopped = drive.stop();
  assert.equal(stopped.ok, true);
  assert.equal(drive.driving, false);
  assert.ok(stopped.distanceM === 0);

  drive.destroy();
});

test('drive: mark without GPS or Cesium reports no-location', async () => {
  const drive = initDriveForDollars({ viewer });
  const result = await drive.markProperty();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no-location');
  drive.destroy();
});

test('drive: start is idempotent', () => {
  const drive = initDriveForDollars({ viewer });
  drive.start();
  const again = drive.start();
  assert.equal(again.already, true);
  drive.stop();
  drive.destroy();
});

test('drive: requires a viewer', () => {
  assert.throws(() => initDriveForDollars({}), /viewer is required/);
});
