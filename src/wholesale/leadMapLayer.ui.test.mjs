import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import the module BEFORE installing the DOM double: cesium's widget bundle
// sniffs for a real document at load time, and a half-mocked one crashes it.
// (In the browser the document is always real.)
const { initLeadMapLayer, LEAD_SCORE_COLORS } = await import('./leadMapLayer.js');
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

const lead = (over = {}) => ({
  id: over.id ?? 'L1',
  address: over.address ?? '1234 Canal St',
  city: 'Houston',
  lat: over.lat !== undefined ? over.lat : 29.7545,
  lng: over.lng !== undefined ? over.lng : -95.3621,
  owner: 'John Doe',
  ownerType: 'individual',
  source: 'csv-import',
  score: over.score !== undefined ? over.score : null,
  status: over.status ?? 'new',
});

test('score color mapping (green/yellow/red/gray)', () => {
  assert.equal(LEAD_SCORE_COLORS.cssFor(70), '#22c55e');
  assert.equal(LEAD_SCORE_COLORS.cssFor(95), '#22c55e');
  assert.equal(LEAD_SCORE_COLORS.cssFor(40), '#eab308');
  assert.equal(LEAD_SCORE_COLORS.cssFor(69), '#eab308');
  assert.equal(LEAD_SCORE_COLORS.cssFor(39), '#ef4444');
  assert.equal(LEAD_SCORE_COLORS.cssFor(0), '#ef4444');
  assert.equal(LEAD_SCORE_COLORS.cssFor(null), '#9ca3af');
  assert.equal(LEAD_SCORE_COLORS.cssFor(undefined), '#9ca3af');
});

test('refresh creates one entity per active lead, skips dead/closed', () => {
  const viewer = makeViewer();
  const store = [
    lead({ id: 'A', score: 85 }),
    lead({ id: 'B', score: 55 }),
    lead({ id: 'C', score: 20 }),
    lead({ id: 'D', score: null }),
    lead({ id: 'E', score: 90, status: 'dead' }),
    lead({ id: 'F', score: 90, status: 'closed' }),
    lead({ id: 'G', lat: null, lng: null }), // no coords → skipped
  ];
  const layer = initLeadMapLayer({ viewer, leadStore: store });
  const stats = layer.refresh();
  assert.equal(stats.added, 4);
  assert.equal(viewer.defs.length, 4);
  assert.deepEqual(
    viewer.defs.map((d) => d.id).sort(),
    ['gev-lead-A', 'gev-lead-B', 'gev-lead-C', 'gev-lead-D'],
  );
  layer.destroy();
});

test('pins are colored by score (point fallback in headless env)', () => {
  const viewer = makeViewer();
  const layer = initLeadMapLayer({
    viewer,
    leadStore: [lead({ id: 'A', score: 85 }), lead({ id: 'B', score: 55 }), lead({ id: 'C', score: 20 }), lead({ id: 'D', score: null })],
  });
  layer.refresh();
  const byId = Object.fromEntries(viewer.defs.map((d) => [d.id, d]));
  for (const d of viewer.defs) {
    // In the browser this is a billboard pin; headless falls back to a point.
    assert.ok(d.billboard || d.point, `no graphics for ${d.id}`);
  }
  const css = (def) => {
    if (def.point) return def.point.color;
    return null;
  };
  // Compare as Cesium.Color instances — toCssColorString() emits rgb(...),
  // not the hex our mapping table uses.
  if (byId['gev-lead-A'].point) {
    assert.ok(css(byId['gev-lead-A']).equals(Cesium.Color.fromCssColorString(LEAD_SCORE_COLORS.cssFor(85))));
    assert.ok(css(byId['gev-lead-B']).equals(Cesium.Color.fromCssColorString(LEAD_SCORE_COLORS.cssFor(55))));
    assert.ok(css(byId['gev-lead-C']).equals(Cesium.Color.fromCssColorString(LEAD_SCORE_COLORS.cssFor(20))));
    assert.ok(css(byId['gev-lead-D']).equals(Cesium.Color.fromCssColorString(LEAD_SCORE_COLORS.cssFor(null))));
  }
  layer.destroy();
});

test('dealEngine.scoreLead overrides the stored score', () => {
  const viewer = makeViewer();
  const layer = initLeadMapLayer({
    viewer,
    leadStore: [lead({ id: 'A', score: null })],
    dealEngine: { scoreLead: () => 95 },
  });
  layer.refresh();
  const def = viewer.defs[0];
  assert.ok(def, 'entity created');
  if (def.point) {
    assert.ok(
      def.point.color.equals(Cesium.Color.fromCssColorString(LEAD_SCORE_COLORS.cssFor(95))),
      'engine score 95 renders as green pin',
    );
  }
  layer.destroy();
});

test('refresh dedupes and removes stale entities', () => {
  const viewer = makeViewer();
  let store = [lead({ id: 'A', score: 80 }), lead({ id: 'A', score: 80 }), lead({ id: 'B', score: 30 })];
  const layer = initLeadMapLayer({ viewer, leadStore: store });
  assert.equal(layer.refresh().added, 2);
  // Second refresh: no duplicates added.
  const s2 = layer.refresh();
  assert.equal(s2.added, 0);
  assert.equal(viewer.defs.length, 2);
  // Remove B from the store: stale entity goes away.
  store = [lead({ id: 'A', score: 80 })];
  layer._storeSwap(store);
  const s3 = layer.refresh();
  assert.equal(s3.removed, 1);
  assert.equal(viewer.defs.length, 1);
  assert.equal(viewer.defs[0].id, 'gev-lead-A');
  layer.destroy();
});

test('flyToLead flies the camera to the lead', () => {
  const viewer = makeViewer();
  const layer = initLeadMapLayer({ viewer, leadStore: [lead({ id: 'A' })] });
  layer.refresh();
  assert.ok(layer.flyToLead('A'));
  assert.ok(viewer.camera.lastFly, 'flyTo called');
  const dest = viewer.camera.lastFly.destination;
  assert.ok(dest && Number.isFinite(dest.x), 'destination is a Cartesian3');
  assert.equal(layer.flyToLead('missing-id'), false);
  layer.destroy();
});

test('setVisible toggles entity visibility', () => {
  const viewer = makeViewer();
  const layer = initLeadMapLayer({ viewer, leadStore: [lead({ id: 'A' }), lead({ id: 'B' })] });
  layer.refresh();
  layer.setVisible(false);
  assert.ok(viewer.defs.every((d) => d.show === false));
  layer.setVisible(true);
  assert.ok(viewer.defs.every((d) => d.show === true));
  layer.destroy();
});

test('onLeadClick fires with the lead on entity pick', () => {
  const viewer = makeViewer();
  const layer = initLeadMapLayer({ viewer, leadStore: [lead({ id: 'A' })] });
  layer.refresh();
  let got = null;
  layer.onLeadClick((l) => { got = l; });
  const picked = layer._pick({ id: 'gev-lead-A' });
  assert.equal(picked.id, 'A');
  assert.equal(got.id, 'A');
  // Picking an unknown / lead-less entity does not fire.
  got = null;
  assert.equal(layer._pick({ id: 'gev-lead-ZZZ' }), null);
  assert.equal(got, null);
  layer.destroy();
});

test('destroy removes entities and clears window.__gevLeadMap', () => {
  const viewer = makeViewer();
  const layer = initLeadMapLayer({ viewer, leadStore: [lead({ id: 'A' })] });
  layer.refresh();
  assert.ok(globalThis.window.__gevLeadMap, 'exposed for debugging');
  layer.destroy();
  assert.equal(viewer.defs.length, 0);
  assert.equal(globalThis.window.__gevLeadMap, undefined);
});

test('missing viewer degrades gracefully (no throw)', () => {
  const layer = initLeadMapLayer({});
  assert.doesNotThrow(() => {
    layer.refresh();
    layer.flyToLead('A');
    layer.setVisible(false);
    layer.onLeadClick(() => {});
    layer.destroy();
  });
});
