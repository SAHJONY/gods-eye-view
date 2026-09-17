import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import the module BEFORE installing the DOM double: cesium's widget bundle
// sniffs for a real document at load time, and a half-mocked one crashes it.
// (In the browser the document is always real.)
const { initShippingMapLayer, RFQ_STATUS_COLORS } = await import(
  './shippingLayer.js'
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

// Fixture RFQs only: synthetic ref, synthetic port names, synthetic
// coordinates — no real ports, routes, or transactions anywhere.
const rfq = (over = {}) => ({
  id: over.id ?? 'R1',
  ref: over.ref ?? 'FIXTURE-001',
  product: over.product ?? 'Fixture Product',
  quantity: over.quantity ?? 1000,
  originPort: over.originPort !== undefined ? over.originPort : 'Fixture Origin Port',
  destinationPort:
    over.destinationPort !== undefined
      ? over.destinationPort
      : 'Fixture Destination Port',
  originLat: over.originLat !== undefined ? over.originLat : 10,
  originLng: over.originLng !== undefined ? over.originLng : -20,
  destLat: over.destLat !== undefined ? over.destLat : 30,
  destLng: over.destLng !== undefined ? over.destLng : 40,
  status: over.status ?? 'prospect',
});

test('cssForStatus maps every RFQ status and defaults unknown to gray', () => {
  assert.equal(RFQ_STATUS_COLORS.cssForStatus('prospect'), '#9ca3af');
  assert.equal(RFQ_STATUS_COLORS.cssForStatus('contacted'), '#38bdf8');
  assert.equal(RFQ_STATUS_COLORS.cssForStatus('quoting'), '#eab308');
  assert.equal(RFQ_STATUS_COLORS.cssForStatus('negotiating'), '#fb923c');
  assert.equal(RFQ_STATUS_COLORS.cssForStatus('won'), '#22c55e');
  assert.equal(RFQ_STATUS_COLORS.cssForStatus('lost'), '#6b7280');
  assert.equal(RFQ_STATUS_COLORS.cssForStatus('whatever'), '#9ca3af');
  assert.equal(RFQ_STATUS_COLORS.cssForStatus(null), '#9ca3af');
  assert.equal(RFQ_STATUS_COLORS.cssForStatus(undefined), '#9ca3af');
  assert.equal(RFQ_STATUS_COLORS.cssForStatus(''), '#9ca3af');
});

test('refresh creates origin pin + destination pin + lane per RFQ, skips won/lost', () => {
  const viewer = makeViewer();
  const store = [
    rfq({ id: 'A', status: 'prospect' }),
    rfq({ id: 'B', status: 'quoting' }),
    rfq({ id: 'C', status: 'won' }),
    rfq({ id: 'D', status: 'lost' }),
  ];
  const layer = initShippingMapLayer({ viewer, rfqStore: store });
  const stats = layer.refresh();
  assert.equal(stats.added, 6); // 3 entities × 2 visible RFQs
  assert.equal(viewer.defs.length, 6);
  assert.deepEqual(
    viewer.defs.map((d) => d.id).sort(),
    [
      'gev-rfq-A-destination',
      'gev-rfq-A-lane',
      'gev-rfq-A-origin',
      'gev-rfq-B-destination',
      'gev-rfq-B-lane',
      'gev-rfq-B-origin',
    ],
  );
  const kinds = Object.fromEntries(
    viewer.defs.map((d) => [d.id, d.properties]),
  );
  assert.equal(kinds['gev-rfq-A-origin'].kind, 'origin');
  assert.equal(kinds['gev-rfq-A-origin'].rfqId, 'A');
  assert.equal(kinds['gev-rfq-A-destination'].kind, 'destination');
  assert.equal(kinds['gev-rfq-A-lane'].kind, 'lane');
  // Lane is a polyline; pins are billboards (browser) or points (headless).
  const lane = viewer.defs.find((d) => d.id === 'gev-rfq-A-lane');
  assert.ok(lane.polyline, 'lane has a polyline');
  assert.equal(lane.polyline.positions.length, 32);
  const pin = viewer.defs.find((d) => d.id === 'gev-rfq-A-origin');
  assert.ok(pin.billboard || pin.point, 'pin has graphics');
  assert.equal(pin.label.text, 'Fixture Origin Port (origen)');
  layer.destroy();
});

test('missing coordinates skip the RFQ — no (0,0) pins', () => {
  const viewer = makeViewer();
  const store = [
    rfq({ id: 'A' }),
    rfq({ id: 'B', originLat: null, originLng: null }),
    rfq({ id: 'C', destLat: null, destLng: null }),
    rfq({ id: 'D', originLat: NaN, originLng: 'abc' }),
  ];
  const layer = initShippingMapLayer({ viewer, rfqStore: store });
  const stats = layer.refresh();
  assert.equal(stats.added, 3);
  assert.equal(viewer.defs.length, 3);
  assert.ok(viewer.defs.every((d) => d.id.startsWith('gev-rfq-A-')));
  // Nothing rendered at the null island (0,0) fallback position.
  for (const d of viewer.defs) {
    assert.ok(
      !d.id.includes('B-') && !d.id.includes('C-') && !d.id.includes('D-'),
      `skipped RFQ leaked an entity: ${d.id}`,
    );
  }
  layer.destroy();
});

test('refresh dedupes by RFQ id and removes stale entities', () => {
  const viewer = makeViewer();
  let store = [rfq({ id: 'A' }), rfq({ id: 'A' }), rfq({ id: 'B' })];
  const layer = initShippingMapLayer({ viewer, rfqStore: store });
  assert.equal(layer.refresh().added, 6);
  assert.equal(layer._count(), 2);
  // Second refresh: no duplicates added.
  const s2 = layer.refresh();
  assert.equal(s2.added, 0);
  assert.equal(viewer.defs.length, 6);
  // Remove B from the store: all 3 stale entities go away.
  store = [rfq({ id: 'A' })];
  layer._storeSwap(store);
  const s3 = layer.refresh();
  assert.equal(s3.removed, 3);
  assert.equal(viewer.defs.length, 3);
  assert.ok(viewer.defs.every((d) => d.id.startsWith('gev-rfq-A-')));
  layer.destroy();
});

test('status change recolors the lane in place', () => {
  const viewer = makeViewer();
  const store = [rfq({ id: 'A', status: 'prospect' })];
  const layer = initShippingMapLayer({ viewer, rfqStore: store });
  layer.refresh();
  const laneDef = () => viewer.defs.find((d) => d.id === 'gev-rfq-A-lane');
  const laneColor = () => laneDef().polyline.material;
  assert.ok(
    laneColor().equals(
      Cesium.Color.fromCssColorString(
        RFQ_STATUS_COLORS.cssForStatus('prospect'),
      ),
    ),
    'lane starts gray for prospect',
  );
  // Change status in the store and refresh.
  store[0].status = 'quoting';
  const stats = layer.refresh();
  assert.equal(stats.added, 0);
  assert.equal(stats.updated, 1);
  assert.equal(viewer.defs.length, 3, 'no new entities on status change');
  assert.ok(
    laneColor().equals(
      Cesium.Color.fromCssColorString(
        RFQ_STATUS_COLORS.cssForStatus('quoting'),
      ),
    ),
    'lane recolored yellow for quoting',
  );
  layer.destroy();
});

test('shipping lane polyline is colored by RFQ status', () => {
  const viewer = makeViewer();
  const layer = initShippingMapLayer({
    viewer,
    rfqStore: [rfq({ id: 'A', status: 'negotiating' })],
  });
  layer.refresh();
  const lane = viewer.defs.find((d) => d.id === 'gev-rfq-A-lane');
  assert.ok(
    lane.polyline.material.equals(
      Cesium.Color.fromCssColorString(
        RFQ_STATUS_COLORS.cssForStatus('negotiating'),
      ),
    ),
    'lane renders orange for negotiating',
  );
  layer.destroy();
});

test('rfqEngine.statusFor overrides the stored status', () => {
  const viewer = makeViewer();
  const layer = initShippingMapLayer({
    viewer,
    rfqStore: [rfq({ id: 'A', status: 'prospect' })],
    rfqEngine: { statusFor: () => 'contacted' },
  });
  layer.refresh();
  const lane = viewer.defs.find((d) => d.id === 'gev-rfq-A-lane');
  assert.ok(
    lane.polyline.material.equals(
      Cesium.Color.fromCssColorString(
        RFQ_STATUS_COLORS.cssForStatus('contacted'),
      ),
    ),
    'engine status contacted renders light blue',
  );
  layer.destroy();
});

test('rfqStore shapes: array, { rfqs }, { listRfqs() }', () => {
  for (const store of [
    [rfq({ id: 'A' })],
    { rfqs: [rfq({ id: 'A' })] },
    { listRfqs: () => [rfq({ id: 'A' })] },
  ]) {
    const viewer = makeViewer();
    const layer = initShippingMapLayer({ viewer, rfqStore: store });
    assert.equal(layer.refresh().added, 3);
    layer.destroy();
  }
});

test('flyToRfq flies to the lane midpoint, false without coords', () => {
  const viewer = makeViewer();
  const layer = initShippingMapLayer({ viewer, rfqStore: [rfq({ id: 'A' })] });
  layer.refresh();
  assert.ok(layer.flyToRfq('A'));
  assert.ok(viewer.camera.lastFly, 'flyTo called');
  const dest = viewer.camera.lastFly.destination;
  assert.ok(
    dest && Number.isFinite(dest.x) && Number.isFinite(dest.z),
    'destination is a Cartesian3 with altitude',
  );
  // Midpoint of (10,-20) and (30,40) → lat 20, lng 10 (z > 0 means above surface).
  assert.ok(dest.z > 0, 'destination is above the ellipsoid');
  assert.equal(layer.flyToRfq('missing-id'), false);
  // RFQ without coords is un-flyable.
  const viewer2 = makeViewer();
  const layer2 = initShippingMapLayer({
    viewer: viewer2,
    rfqStore: [rfq({ id: 'B', originLat: null })],
  });
  assert.equal(layer2.flyToRfq('B'), false);
  layer.destroy();
  layer2.destroy();
});

test('setVisible toggles entity visibility', () => {
  const viewer = makeViewer();
  const layer = initShippingMapLayer({
    viewer,
    rfqStore: [rfq({ id: 'A' }), rfq({ id: 'B' })],
  });
  layer.refresh();
  layer.setVisible(false);
  assert.ok(viewer.defs.every((d) => d.show === false));
  layer.setVisible(true);
  assert.ok(viewer.defs.every((d) => d.show === true));
  layer.destroy();
});

test('onRfqClick resolves the RFQ via _pick for pins and lane', () => {
  const viewer = makeViewer();
  const layer = initShippingMapLayer({ viewer, rfqStore: [rfq({ id: 'A' })] });
  layer.refresh();
  let got = null;
  layer.onRfqClick((r) => {
    got = r;
  });
  // Lane click resolves to the RFQ.
  const pickedLane = layer._pick({ id: 'gev-rfq-A-lane' });
  assert.equal(pickedLane.id, 'A');
  assert.equal(got.id, 'A');
  assert.equal(got.ref, 'FIXTURE-001');
  // Pin click resolves to the same RFQ.
  got = null;
  assert.equal(layer._pick({ id: 'gev-rfq-A-origin' }).id, 'A');
  assert.equal(got.id, 'A');
  got = null;
  assert.equal(layer._pick({ id: 'gev-rfq-A-destination' }).id, 'A');
  assert.equal(got.id, 'A');
  // Picking an unknown / RFQ-less entity does not fire.
  got = null;
  assert.equal(layer._pick({ id: 'gev-rfq-ZZZ' }), null);
  assert.equal(got, null);
  layer.destroy();
});

test('init exposes window.__gevShippingMap and destroy clears it', () => {
  const viewer = makeViewer();
  const layer = initShippingMapLayer({ viewer, rfqStore: [rfq({ id: 'A' })] });
  assert.ok(globalThis.window.__gevShippingMap, 'exposed for debugging');
  layer.refresh();
  layer.destroy();
  assert.equal(viewer.defs.length, 0);
  assert.equal(globalThis.window.__gevShippingMap, undefined);
});

test('aborted signal cleans up the layer', () => {
  const viewer = makeViewer();
  const controller = new AbortController();
  const layer = initShippingMapLayer({
    viewer,
    rfqStore: [rfq({ id: 'A' })],
    signal: controller.signal,
  });
  layer.refresh();
  assert.equal(viewer.defs.length, 3);
  controller.abort();
  assert.equal(viewer.defs.length, 0, 'entities removed on abort');
  assert.equal(globalThis.window.__gevShippingMap, undefined);
});

test('missing viewer degrades gracefully (no throw)', () => {
  const layer = initShippingMapLayer({});
  assert.doesNotThrow(() => {
    layer.refresh();
    layer.flyToRfq('A');
    layer.setVisible(false);
    layer.onRfqClick(() => {});
    layer.destroy();
  });
});

test('origin/destination labels fall back to bilingual defaults', () => {
  const viewer = makeViewer();
  const layer = initShippingMapLayer({
    viewer,
    rfqStore: [rfq({ id: 'A', originPort: '', destinationPort: '' })],
  });
  layer.refresh();
  const origin = viewer.defs.find((d) => d.id === 'gev-rfq-A-origin');
  const dest = viewer.defs.find((d) => d.id === 'gev-rfq-A-destination');
  assert.equal(origin.label.text, 'origen (origen)');
  assert.equal(dest.label.text, 'destino (destino)');
  layer.destroy();
});

test('phone readability: pins are large, labels are 15px, lanes are 3px wide', () => {
  const viewer = makeViewer();
  const layer = initShippingMapLayer({
    viewer,
    rfqStore: [rfq({ id: 'B' })],
  });
  layer.refresh();
  const origin = viewer.defs.find((d) => d.id === 'gev-rfq-B-origin');
  const dest = viewer.defs.find((d) => d.id === 'gev-rfq-B-destination');
  const lane = viewer.defs.find((d) => d.id === 'gev-rfq-B-lane');
  if (origin.billboard) {
    // Browser path: teardrop origin (36x54), larger round destination (44x44).
    assert.equal(origin.billboard.width, 36);
    assert.equal(origin.billboard.height, 54);
    assert.equal(dest.billboard.width, 44);
    assert.equal(dest.billboard.height, 44);
  } else {
    // Headless path: colored point fallback.
    assert.ok(origin.point && dest.point, 'pins have graphics');
  }
  assert.equal(origin.label.font, '15px sans-serif');
  assert.equal(dest.label.font, '15px sans-serif');
  assert.equal(lane.polyline.width, 3);
  layer.destroy();
});

test('endpoint distinction: origin label names port + (origen), destination + (destino)', () => {
  const viewer = makeViewer();
  const layer = initShippingMapLayer({
    viewer,
    rfqStore: [
      rfq({ id: 'C', originPort: 'Puerto X', destinationPort: 'Puerto Y' }),
    ],
  });
  layer.refresh();
  const origin = viewer.defs.find((d) => d.id === 'gev-rfq-C-origin');
  const dest = viewer.defs.find((d) => d.id === 'gev-rfq-C-destination');
  assert.equal(origin.label.text, 'Puerto X (origen)');
  assert.equal(dest.label.text, 'Puerto Y (destino)');
  layer.destroy();
});
