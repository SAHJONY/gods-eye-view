import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import the module BEFORE installing the DOM double: cesium's widget bundle
// sniffs for a real document at load time, and a half-mocked one crashes it.
// (In the browser the document is always real.)
const { initTankerMapLayer, CARGO_STATUS_COLORS } = await import(
  './tankerMapLayer.js'
);
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
  location: { href: 'http://localhost/' },
  getElementById: () => null,
  createElement: () => makeEl(),
  head: makeEl(),
  body: makeEl(),
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
};

function makeCanvas() {
  return {
    clientWidth: 800,
    clientHeight: 600,
    addEventListener() {},
    removeEventListener() {},
    getContext: () => null,
  };
}

/** Minimal fake Cesium viewer: records entity definitions passed to add(). */
function makeViewer() {
  const defs = [];
  return {
    defs,
    scene: { canvas: makeCanvas() },
    camera: {
      lastFly: null,
      flyTo(opts) { this.lastFly = opts; },
      setView() {},
    },
    entities: {
      add(def) {
        const entity = { ...def, show: def.show !== false };
        defs.push(entity);
        return entity;
      },
      remove(entity) {
        const i = defs.indexOf(entity);
        if (i !== -1) defs.splice(i, 1);
        else {
          const j = defs.findIndex((d) => d.id === (entity && entity.id));
          if (j !== -1) defs.splice(j, 1);
        }
      },
    },
  };
}

// Fixture cargoes only: synthetic ref, synthetic port names, synthetic
// coordinates — no real ports, vessels, or terminals anywhere.
const cargo = (over = {}) => ({
  id: over.id ?? 'C1',
  ref: over.ref ?? 'FIXTURE-001',
  loadPort: over.loadPort !== undefined ? over.loadPort : 'Fixture Load Port',
  dischargePort:
    over.dischargePort !== undefined
      ? over.dischargePort
      : 'Fixture Discharge Port',
  loadLat: over.loadLat !== undefined ? over.loadLat : 10,
  loadLng: over.loadLng !== undefined ? over.loadLng : -20,
  dischargeLat: over.dischargeLat !== undefined ? over.dischargeLat : 30,
  dischargeLng: over.dischargeLng !== undefined ? over.dischargeLng : 40,
  status: over.status ?? 'prospect',
  grade: over.grade ?? 'Fixture Blend',
  volumeBbl: over.volumeBbl ?? 500000,
});

test('cssForStatus maps every status and defaults unknown to gray', () => {
  assert.equal(CARGO_STATUS_COLORS.cssForStatus('prospect'), '#9ca3af');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus('diligence'), '#38bdf8');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus('negotiating'), '#eab308');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus('contracted'), '#22c55e');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus('loading'), '#fb923c');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus('in-transit'), '#22d3ee');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus('delivered'), '#16a34a');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus('closed'), '#6b7280');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus('whatever'), '#9ca3af');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus(null), '#9ca3af');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus(undefined), '#9ca3af');
  assert.equal(CARGO_STATUS_COLORS.cssForStatus(''), '#9ca3af');
});

test('refresh creates load pin + discharge pin + route per cargo, skips dead/closed', () => {
  const viewer = makeViewer();
  const store = [
    cargo({ id: 'A', status: 'prospect' }),
    cargo({ id: 'B', status: 'contracted' }),
    cargo({ id: 'C', status: 'dead' }),
    cargo({ id: 'D', status: 'closed' }),
  ];
  const layer = initTankerMapLayer({ viewer, cargoStore: store });
  const stats = layer.refresh();
  assert.equal(stats.added, 6); // 3 entities × 2 visible cargoes
  assert.equal(viewer.defs.length, 6);
  assert.deepEqual(
    viewer.defs.map((d) => d.id).sort(),
    [
      'gev-cargo-A-discharge',
      'gev-cargo-A-load',
      'gev-cargo-A-route',
      'gev-cargo-B-discharge',
      'gev-cargo-B-load',
      'gev-cargo-B-route',
    ],
  );
  const kinds = Object.fromEntries(
    viewer.defs.map((d) => [d.id, d.properties]),
  );
  assert.equal(kinds['gev-cargo-A-load'].kind, 'load');
  assert.equal(kinds['gev-cargo-A-load'].cargoId, 'A');
  assert.equal(kinds['gev-cargo-A-discharge'].kind, 'discharge');
  assert.equal(kinds['gev-cargo-A-route'].kind, 'route');
  // Route is a polyline; pins are billboards (browser) or points (headless).
  const route = viewer.defs.find((d) => d.id === 'gev-cargo-A-route');
  assert.ok(route.polyline, 'route has a polyline');
  assert.equal(route.polyline.positions.length, 32);
  const pin = viewer.defs.find((d) => d.id === 'gev-cargo-A-load');
  assert.ok(pin.billboard || pin.point, 'pin has graphics');
  assert.equal(pin.label.text, 'Fixture Load Port');
  layer.destroy();
});

test('missing coordinates skip the cargo — no (0,0) pins', () => {
  const viewer = makeViewer();
  const store = [
    cargo({ id: 'A' }),
    cargo({ id: 'B', loadLat: null, loadLng: null }),
    cargo({ id: 'C', dischargeLat: null, dischargeLng: null }),
    cargo({ id: 'D', loadLat: NaN, loadLng: 'abc' }),
  ];
  const layer = initTankerMapLayer({ viewer, cargoStore: store });
  const stats = layer.refresh();
  assert.equal(stats.added, 3);
  assert.equal(viewer.defs.length, 3);
  assert.ok(viewer.defs.every((d) => d.id.startsWith('gev-cargo-A-')));
  // Nothing rendered at the null island (0,0) fallback position.
  for (const d of viewer.defs) {
    assert.ok(
      !d.id.includes('B-') && !d.id.includes('C-') && !d.id.includes('D-'),
      `skipped cargo leaked an entity: ${d.id}`,
    );
  }
  layer.destroy();
});

test('refresh dedupes by cargo id and removes stale entities', () => {
  const viewer = makeViewer();
  let store = [cargo({ id: 'A' }), cargo({ id: 'A' }), cargo({ id: 'B' })];
  const layer = initTankerMapLayer({ viewer, cargoStore: store });
  assert.equal(layer.refresh().added, 6);
  assert.equal(layer._count(), 2);
  // Second refresh: no duplicates added.
  const s2 = layer.refresh();
  assert.equal(s2.added, 0);
  assert.equal(viewer.defs.length, 6);
  // Remove B from the store: all 3 stale entities go away.
  store = [cargo({ id: 'A' })];
  layer._storeSwap(store);
  const s3 = layer.refresh();
  assert.equal(s3.removed, 3);
  assert.equal(viewer.defs.length, 3);
  assert.ok(viewer.defs.every((d) => d.id.startsWith('gev-cargo-A-')));
  layer.destroy();
});

test('status change recolors the route in place', () => {
  const viewer = makeViewer();
  const store = [cargo({ id: 'A', status: 'prospect' })];
  const layer = initTankerMapLayer({ viewer, cargoStore: store });
  layer.refresh();
  const routeDef = () => viewer.defs.find((d) => d.id === 'gev-cargo-A-route');
  const routeColor = () => routeDef().polyline.material;
  assert.ok(
    routeColor().equals(
      Cesium.Color.fromCssColorString(
        CARGO_STATUS_COLORS.cssForStatus('prospect'),
      ),
    ),
    'route starts gray for prospect',
  );
  // Change status in the store and refresh.
  store[0].status = 'contracted';
  const stats = layer.refresh();
  assert.equal(stats.added, 0);
  assert.equal(stats.updated, 1);
  assert.equal(viewer.defs.length, 3, 'no new entities on status change');
  assert.ok(
    routeColor().equals(
      Cesium.Color.fromCssColorString(
        CARGO_STATUS_COLORS.cssForStatus('contracted'),
      ),
    ),
    'route recolored green for contracted',
  );
  layer.destroy();
});

test('route polyline is colored by cargo status', () => {
  const viewer = makeViewer();
  const layer = initTankerMapLayer({
    viewer,
    cargoStore: [cargo({ id: 'A', status: 'in-transit' })],
  });
  layer.refresh();
  const route = viewer.defs.find((d) => d.id === 'gev-cargo-A-route');
  assert.ok(
    route.polyline.material.equals(
      Cesium.Color.fromCssColorString(
        CARGO_STATUS_COLORS.cssForStatus('in-transit'),
      ),
    ),
    'route renders cyan for in-transit',
  );
  layer.destroy();
});

test('cargoEngine.statusFor overrides the stored status', () => {
  const viewer = makeViewer();
  const layer = initTankerMapLayer({
    viewer,
    cargoStore: [cargo({ id: 'A', status: 'prospect' })],
    cargoEngine: { statusFor: () => 'delivered' },
  });
  layer.refresh();
  const route = viewer.defs.find((d) => d.id === 'gev-cargo-A-route');
  assert.ok(
    route.polyline.material.equals(
      Cesium.Color.fromCssColorString(
        CARGO_STATUS_COLORS.cssForStatus('delivered'),
      ),
    ),
    'engine status delivered renders dark green',
  );
  layer.destroy();
});

test('cargoStore shapes: array, { cargoes }, { listCargoes() }', () => {
  for (const store of [
    [cargo({ id: 'A' })],
    { cargoes: [cargo({ id: 'A' })] },
    { listCargoes: () => [cargo({ id: 'A' })] },
  ]) {
    const viewer = makeViewer();
    const layer = initTankerMapLayer({ viewer, cargoStore: store });
    assert.equal(layer.refresh().added, 3);
    layer.destroy();
  }
});

test('flyToCargo flies to the route midpoint, false without coords', () => {
  const viewer = makeViewer();
  const layer = initTankerMapLayer({ viewer, cargoStore: [cargo({ id: 'A' })] });
  layer.refresh();
  assert.ok(layer.flyToCargo('A'));
  assert.ok(viewer.camera.lastFly, 'flyTo called');
  const dest = viewer.camera.lastFly.destination;
  assert.ok(
    dest && Number.isFinite(dest.x) && Number.isFinite(dest.z),
    'destination is a Cartesian3 with altitude',
  );
  // Midpoint of (10,-20) and (30,40) → lat 20, lng 10 (z > 0 means above surface).
  assert.ok(dest.z > 0, 'destination is above the ellipsoid');
  assert.equal(layer.flyToCargo('missing-id'), false);
  // Cargo without coords is un-flyable.
  const viewer2 = makeViewer();
  const layer2 = initTankerMapLayer({
    viewer: viewer2,
    cargoStore: [cargo({ id: 'B', loadLat: null })],
  });
  assert.equal(layer2.flyToCargo('B'), false);
  layer.destroy();
  layer2.destroy();
});

test('setVisible toggles entity visibility', () => {
  const viewer = makeViewer();
  const layer = initTankerMapLayer({
    viewer,
    cargoStore: [cargo({ id: 'A' }), cargo({ id: 'B' })],
  });
  layer.refresh();
  layer.setVisible(false);
  assert.ok(viewer.defs.every((d) => d.show === false));
  layer.setVisible(true);
  assert.ok(viewer.defs.every((d) => d.show === true));
  layer.destroy();
});

test('onCargoClick resolves the cargo via _pick for pins and route', () => {
  const viewer = makeViewer();
  const layer = initTankerMapLayer({ viewer, cargoStore: [cargo({ id: 'A' })] });
  layer.refresh();
  let got = null;
  layer.onCargoClick((c) => {
    got = c;
  });
  // Route line click resolves to the cargo.
  const pickedRoute = layer._pick({ id: 'gev-cargo-A-route' });
  assert.equal(pickedRoute.id, 'A');
  assert.equal(got.id, 'A');
  assert.equal(got.ref, 'FIXTURE-001');
  // Pin click resolves to the same cargo.
  got = null;
  assert.equal(layer._pick({ id: 'gev-cargo-A-load' }).id, 'A');
  assert.equal(got.id, 'A');
  // Picking an unknown / cargo-less entity does not fire.
  got = null;
  assert.equal(layer._pick({ id: 'gev-cargo-ZZZ' }), null);
  assert.equal(got, null);
  layer.destroy();
});

test('init exposes window.__gevTankerMap and destroy clears it', () => {
  const viewer = makeViewer();
  const layer = initTankerMapLayer({ viewer, cargoStore: [cargo({ id: 'A' })] });
  assert.ok(globalThis.window.__gevTankerMap, 'exposed for debugging');
  layer.refresh();
  layer.destroy();
  assert.equal(viewer.defs.length, 0);
  assert.equal(globalThis.window.__gevTankerMap, undefined);
});

test('aborted signal cleans up the layer', () => {
  const viewer = makeViewer();
  const controller = new AbortController();
  const layer = initTankerMapLayer({
    viewer,
    cargoStore: [cargo({ id: 'A' })],
    signal: controller.signal,
  });
  layer.refresh();
  assert.equal(viewer.defs.length, 3);
  controller.abort();
  assert.equal(viewer.defs.length, 0, 'entities removed on abort');
  assert.equal(globalThis.window.__gevTankerMap, undefined);
});

test('missing viewer degrades gracefully (no throw)', () => {
  const layer = initTankerMapLayer({});
  assert.doesNotThrow(() => {
    layer.refresh();
    layer.flyToCargo('A');
    layer.setVisible(false);
    layer.onCargoClick(() => {});
    layer.destroy();
  });
});
