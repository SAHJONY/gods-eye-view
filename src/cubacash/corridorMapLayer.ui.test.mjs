import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import the module BEFORE installing the DOM double: cesium's widget bundle
// sniffs for a real document at load time, and a half-mocked one crashes it.
// (In the browser the document is always real.)
const {
  initCorridorMapLayer,
  PROVIDER_STATUS_COLORS,
  CORRIDOR_COLORS,
  routeLabelText,
} = await import('./corridorMapLayer.js');
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
        if (i >= 0) defs.splice(i, 1);
      },
    },
  };
}

const engineDouble = {
  corridorMath: ({ sendAmount, fxRate }) => ({
    receivedAmount:
      Number(sendAmount) > 0 && Number(fxRate) > 0
        ? Number(sendAmount) * Number(fxRate)
        : null,
  }),
};

test('status colors map statuses and fall back to gray', () => {
  assert.equal(PROVIDER_STATUS_COLORS.cssForStatus('live'), '#22c55e');
  assert.equal(PROVIDER_STATUS_COLORS.cssForStatus('verifying'), '#eab308');
  assert.equal(PROVIDER_STATUS_COLORS.cssForStatus('nope'), '#9ca3af');
  assert.equal(PROVIDER_STATUS_COLORS.cssForStatus(''), '#9ca3af');
  assert.equal(CORRIDOR_COLORS.complete, '#22c55e');
  assert.equal(CORRIDOR_COLORS.incomplete, '#9ca3af');
});

test('refresh renders provider pins only with real coordinates', () => {
  const viewer = makeViewer();
  const store = {
    listProviders: () => [
      { id: 'p1', name: 'Western Union', status: 'live', lat: 25.76, lng: -80.19 },
      { id: 'p2', name: 'Cubamax', status: 'verifying' }, // no coords → skip
      { id: 'p3', name: 'Sendvalu', status: 'paused', lat: 10, lng: 10 }, // hidden
    ],
    listCorridors: () => [],
  };
  const layer = initCorridorMapLayer({
    viewer,
    providerStore: store,
    corridorEngine: engineDouble,
  });
  const res = layer.refresh();
  assert.equal(res.added, 1);
  const pin = viewer.defs[0];
  assert.ok(pin.id.includes('gev-cubacash-'));
  assert.ok(pin.id.endsWith('-pin'));
  assert.equal(pin.label.text, 'Western Union');
  layer.destroy();
});

test('refresh renders corridor pins + route, skips coordinate-less ones', () => {
  const viewer = makeViewer();
  const store = {
    listProviders: () => [],
    listCorridors: () => [
      {
        id: 'c1',
        fromCountry: 'USA',
        toCountry: 'Cuba',
        fromLat: 25.76,
        fromLng: -80.19,
        toLat: 23.13,
        toLng: -82.37,
        sendAmount: 100,
        fxRate: 100,
      },
      {
        id: 'c2',
        fromCountry: 'USA',
        toCountry: 'Cuba',
        sendAmount: 100,
        fxRate: 100,
        // no coords → skip silently
      },
    ],
  };
  const layer = initCorridorMapLayer({
    viewer,
    providerStore: store,
    corridorEngine: engineDouble,
  });
  const res = layer.refresh();
  assert.equal(res.added, 4); // from pin, to pin, route, route label
  const route = viewer.defs.find((d) => d.id.endsWith('-route'));
  assert.ok(route);
  assert.equal(route.polyline.positions.length, 32);
  // thick route reads at a glance, even on a phone screen
  assert.equal(route.polyline.width, 5);
  // green: corridor is computable
  const green = Cesium.Color.fromCssColorString(CORRIDOR_COLORS.complete);
  assert.ok(route.polyline.material.equals(green));
  // the route carries an always-visible label — never hover-dependent
  const routeLabel = viewer.defs.find((d) => d.id.endsWith('-routelabel'));
  assert.ok(routeLabel);
  assert.equal(routeLabel.label.text, 'USA → Cuba · $100');
  assert.match(routeLabel.label.font, /bold 14px/);
  layer.destroy();
});

test('provider pins are larger than corridor endpoint pins', () => {
  const viewer = makeViewer();
  const store = {
    listProviders: () => [
      { id: 'p1', name: 'Cubamax', status: 'live', lat: 1, lng: 1 },
    ],
    listCorridors: () => [
      {
        id: 'c1',
        fromCountry: 'USA',
        toCountry: 'Cuba',
        fromLat: 25.76,
        fromLng: -80.19,
        toLat: 23.13,
        toLng: -82.37,
        sendAmount: 100,
        fxRate: 100,
      },
    ],
  };
  const layer = initCorridorMapLayer({
    viewer,
    providerStore: store,
    corridorEngine: engineDouble,
  });
  layer.refresh();
  const providerPin = viewer.defs.find((d) => d.id.endsWith('-pin'));
  const corridorPin = viewer.defs.find((d) => d.id.endsWith('-from'));
  assert.ok(providerPin && corridorPin);
  // canvas-less fallback: point pixelSize 14 (provider) vs 9 (corridor)
  assert.equal(providerPin.point.pixelSize, 14);
  assert.equal(corridorPin.point.pixelSize, 9);
  assert.equal(providerPin.label.text, 'Cubamax');
  assert.equal(corridorPin.label.text, 'USA');
  layer.destroy();
});

test('clicking the route label resolves the corridor', () => {
  const viewer = makeViewer();
  const store = {
    listProviders: () => [],
    listCorridors: () => [
      {
        id: 'c7',
        fromCountry: 'USA',
        toCountry: 'Cuba',
        fromLat: 25.76,
        fromLng: -80.19,
        toLat: 23.13,
        toLng: -82.37,
        sendAmount: 50,
        fxRate: 100,
      },
    ],
  };
  const layer = initCorridorMapLayer({
    viewer,
    providerStore: store,
    corridorEngine: engineDouble,
  });
  layer.refresh();
  const routeLabel = viewer.defs.find((d) => d.id.endsWith('-routelabel'));
  assert.ok(routeLabel);
  let clicked = null;
  layer.onCorridorClick((c) => {
    clicked = c;
  });
  const resolved = layer._pick({ id: { id: routeLabel.id } });
  assert.equal(resolved.kind, 'corridor');
  assert.equal(clicked.id, 'c7');
  layer.destroy();
});

test('routeLabelText names the corridor and amount', () => {
  assert.equal(
    routeLabelText({ fromCountry: 'USA', toCountry: 'Cuba', sendAmount: 100 }),
    'USA → Cuba · $100',
  );
  assert.equal(
    routeLabelText({ fromCountry: 'USA', toCountry: 'Cuba' }),
    'USA → Cuba',
  );
  assert.equal(routeLabelText(null), '? → ?');
});

test('incomplete corridors render gray', () => {
  const viewer = makeViewer();
  const store = {
    listProviders: () => [],
    listCorridors: () => [
      {
        id: 'c9',
        fromLat: 25.76,
        fromLng: -80.19,
        toLat: 23.13,
        toLng: -82.37,
        sendAmount: 100,
        // no fxRate → incomplete
      },
    ],
  };
  const layer = initCorridorMapLayer({
    viewer,
    providerStore: store,
    corridorEngine: engineDouble,
  });
  layer.refresh();
  const route = viewer.defs.find((d) => d.id.endsWith('-route'));
  const gray = Cesium.Color.fromCssColorString(CORRIDOR_COLORS.incomplete);
  assert.ok(route.polyline.material.equals(gray));
  layer.destroy();
});

test('refresh dedupes and removes stale entities', () => {
  const viewer = makeViewer();
  let providers = [
    { id: 'p1', name: 'A', status: 'live', lat: 1, lng: 1 },
    { id: 'p2', name: 'B', status: 'live', lat: 2, lng: 2 },
  ];
  const store = {
    listProviders: () => providers,
    listCorridors: () => [],
  };
  const layer = initCorridorMapLayer({ viewer, providerStore: store });
  layer.refresh();
  assert.equal(viewer.defs.length, 2);
  providers = [{ id: 'p1', name: 'A', status: 'live', lat: 1, lng: 1 }];
  const res = layer.refresh();
  assert.equal(res.removed, 1);
  assert.equal(viewer.defs.length, 1);
  layer.destroy();
});

test('flyToProvider and flyToCorridor drive the camera', () => {
  const viewer = makeViewer();
  const store = {
    listProviders: () => [
      { id: 'p1', name: 'A', status: 'live', lat: 25.76, lng: -80.19 },
    ],
    listCorridors: () => [
      {
        id: 'c1',
        fromLat: 25.76,
        fromLng: -80.19,
        toLat: 23.13,
        toLng: -82.37,
        sendAmount: 100,
        fxRate: 100,
      },
    ],
  };
  const layer = initCorridorMapLayer({ viewer, providerStore: store });
  layer.refresh();
  assert.equal(layer.flyToProvider('p1'), true);
  assert.ok(viewer.camera.lastFly);
  assert.equal(layer.flyToCorridor('c1'), true);
  assert.equal(layer.flyToProvider('missing'), false);
  layer.destroy();
});

test('click wiring resolves providers and corridors', () => {
  const viewer = makeViewer();
  const store = {
    listProviders: () => [
      { id: 'p1', name: 'A', status: 'live', lat: 1, lng: 1 },
    ],
    listCorridors: () => [],
  };
  const layer = initCorridorMapLayer({ viewer, providerStore: store });
  layer.refresh();
  const pin = viewer.defs[0];
  let clicked = null;
  layer.onProviderClick((p) => {
    clicked = p;
  });
  const resolved = layer._pick({ id: { id: pin.id } });
  assert.equal(resolved.kind, 'provider');
  assert.equal(clicked.id, 'p1');
  layer.destroy();
});

test('no viewer → refresh is a safe no-op', () => {
  const layer = initCorridorMapLayer({ viewer: null, providerStore: {} });
  const res = layer.refresh();
  assert.deepEqual(res, { added: 0, updated: 0, removed: 0 });
  layer.destroy();
});
