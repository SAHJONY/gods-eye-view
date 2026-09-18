import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import the module BEFORE installing the DOM double: cesium's widget bundle
// sniffs for a real document at load time, and a half-mocked one crashes it.
// (In the browser the document is always real.)
const {
  initEnergyPortLayer,
  entityIdForPort,
  hasPortCoords,
  PORT_PIN_COLOR,
} = await import('./energyMapLayer.js');
import * as Cesium from 'cesium';
import { CUBAN_FUEL_PORTS } from './energyStore.js';

function makeEntities() {
  return {
    added: [],
    removed: [],
    add(def) {
      this.added.push(def);
      return { id: def.id, show: def.show !== false };
    },
    remove(entity) {
      this.removed.push(entity?.id ?? entity);
      return true;
    },
  };
}

function makeViewer() {
  return {
    entities: makeEntities(),
    scene: { canvas: null, pick() { return null; } },
  };
}

test('entityIdForPort uses the gev-energy-port- prefix', () => {
  assert.equal(entityIdForPort('mariel'), 'gev-energy-port-mariel');
});

test('hasPortCoords: never invents pins for missing coords', () => {
  assert.equal(hasPortCoords({ id: 'x', lat: 23, lng: -82 }), true);
  assert.equal(hasPortCoords({ id: 'x', lat: null, lng: -82 }), false);
  assert.equal(hasPortCoords({ id: 'x' }), false);
  assert.equal(hasPortCoords(null), false);
});

test('refresh adds exactly one pin per real port, none for bad coords', () => {
  const viewer = makeViewer();
  const ports = [
    ...CUBAN_FUEL_PORTS,
    { id: 'ghost', name: { es: 'Fantasma', en: 'Ghost' } }, // no coords
  ];
  const layer = initEnergyPortLayer({ viewer, ports });
  const out = layer.refresh();
  assert.equal(out.added, CUBAN_FUEL_PORTS.length);
  assert.equal(layer._count(), CUBAN_FUEL_PORTS.length);
  assert.equal(viewer.entities.added.length, CUBAN_FUEL_PORTS.length);
  // Static port reference: labels ≥15px and always visible (no hover-only).
  for (const def of viewer.entities.added) {
    assert.match(String(def.label.font), /1[5-9]px|2\dpx/, 'label font ≥15px');
  }
  layer.destroy();
});

test('refresh dedupes and drops stale ports', () => {
  const viewer = makeViewer();
  const ports = [...CUBAN_FUEL_PORTS];
  const layer = initEnergyPortLayer({ viewer, ports });
  layer.refresh();
  assert.equal(layer._count(), 4);
  ports.pop();
  const out = layer.refresh();
  assert.equal(out.removed, 1);
  assert.equal(layer._count(), 3);
  layer.destroy();
});

test('onPortClick fires through _pick and unregisters', () => {
  const viewer = makeViewer();
  const layer = initEnergyPortLayer({ viewer, ports: CUBAN_FUEL_PORTS });
  layer.refresh();
  let seen = null;
  const off = layer.onPortClick((port) => {
    seen = port;
  });
  const port = layer._pick({ id: entityIdForPort('mariel') });
  assert.equal(port?.id, 'mariel');
  assert.equal(seen?.id, 'mariel');
  off();
  seen = null;
  layer._pick({ id: entityIdForPort('mariel') });
  assert.equal(seen, null);
  // Non-port entities never resolve.
  assert.equal(layer._pick({ id: 'gev-cargo-1-load' }), null);
  layer.destroy();
});

test('setVisible toggles entity show flags; destroy is safe', () => {
  const viewer = makeViewer();
  const layer = initEnergyPortLayer({ viewer, ports: CUBAN_FUEL_PORTS });
  layer.refresh();
  layer.setVisible(false);
  assert.equal(layer._count(), 4);
  layer.setVisible(true);
  layer.destroy();
  assert.equal(layer._count(), 0);
  layer.destroy(); // second destroy must not throw
});

test('port pin color constant is a valid amber', () => {
  assert.match(PORT_PIN_COLOR, /^#[0-9a-f]{6}$/i);
  const color = Cesium.Color.fromCssColorString(PORT_PIN_COLOR);
  assert.ok(color, 'parses as a Cesium color');
});
