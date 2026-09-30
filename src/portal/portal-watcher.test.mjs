import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createShipmentStore } from '../../server/portal/shipments.js';
import {
  createShipmentWatcher,
  haversineKm,
  WATCHER_GEOFENCE_KM,
} from '../../server/portal/watcher.js';

function makeStore() {
  return createShipmentStore();
}

/** Mutable AIS position stub: mmsi -> {lat, lon, speed} | null (no data). */
function makeLookup(positions) {
  return (mmsi) => {
    const hit = positions[String(mmsi)];
    return hit === undefined ? { vessel: null } : { vessel: { mmsi: String(mmsi), ...hit } };
  };
}

function makeShipment(store, overrides = {}) {
  return store.create({
    clientId: 'cli_A',
    vesselMmsi: '11111',
    vesselName: 'BARCO A',
    origin: 'Puerto Origen',
    destination: 'Puerto Destino',
    cargoLabel: 'Contenedor 40ft — alimentos',
    originLat: 0,
    originLon: 0,
    destLat: 1,
    destLon: 1,
    ...overrides,
  });
}

describe('portal watcher: haversine', () => {
  it('measures plausible distances', () => {
    // 1 degree of latitude ≈ 111 km.
    const d = haversineKm(0, 0, 1, 0);
    assert.ok(d > 110 && d < 112, `got ${d}`);
    assert.equal(haversineKm(10, 20, 10, 20), 0);
  });
});

describe('portal watcher: pendiente → en_transito', () => {
  it('activates when the vessel exits the origin geofence', () => {
    const store = makeStore();
    const shipment = makeShipment(store);
    // 0.2° lat ≈ 22 km > 15 km geofence.
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup({ 11111: { lat: 0.2, lon: 0, speed: 8 } }),
    });
    const transitions = watcher.tick();
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].to, 'en_transito');
    assert.equal(transitions[0].reason, 'geofence_exit');
    assert.equal(transitions[0].shipmentId, shipment.id);
    assert.equal(store.get(shipment.id).status, 'en_transito');
  });

  it('stays pendiente while the vessel sits in port', () => {
    const store = makeStore();
    const shipment = makeShipment(store);
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup({ 11111: { lat: 0.01, lon: 0.01, speed: 0 } }),
    });
    assert.deepEqual(watcher.tick(), []);
    assert.equal(store.get(shipment.id).status, 'pendiente');
  });

  it('requires SUSTAINED speed: one fast tick is not enough', () => {
    const store = makeStore();
    const shipment = makeShipment(store);
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup({ 11111: { lat: 0.01, lon: 0, speed: 6 } }),
      sustainedTicks: 2,
    });
    assert.deepEqual(watcher.tick(), []);
    assert.equal(store.get(shipment.id).status, 'pendiente');
    assert.equal(watcher._fastTicks(shipment.id), 1);
    const transitions = watcher.tick();
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].reason, 'sustained_speed');
    assert.equal(store.get(shipment.id).status, 'en_transito');
  });

  it('resets the speed counter when the vessel slows down', () => {
    const store = makeStore();
    const shipment = makeShipment(store);
    const positions = { 11111: { lat: 0.01, lon: 0, speed: 6 } };
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup(positions),
      sustainedTicks: 2,
    });
    watcher.tick();
    assert.equal(watcher._fastTicks(shipment.id), 1);
    positions['11111'].speed = 0;
    watcher.tick();
    assert.equal(watcher._fastTicks(shipment.id), 0);
    assert.equal(store.get(shipment.id).status, 'pendiente');
  });

  it('never transitions without AIS data (never fakes it)', () => {
    const store = makeStore();
    const shipment = makeShipment(store);
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup({}),
    });
    assert.deepEqual(watcher.tick(), []);
    assert.equal(store.get(shipment.id).status, 'pendiente');
  });

  it('skips shipments without port coords (manual mode)', () => {
    const store = makeStore();
    const shipment = store.create({
      clientId: 'cli_A',
      vesselMmsi: '11111',
      origin: 'A',
      destination: 'B',
      cargoLabel: 'C',
    });
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup({ 11111: { lat: 50, lon: 50, speed: 10 } }),
    });
    assert.deepEqual(watcher.tick(), []);
    assert.equal(store.get(shipment.id).status, 'pendiente');
  });
});

describe('portal watcher: en_transito → en_puerto', () => {
  it('marks arrival when the vessel enters the destination geofence', () => {
    const store = makeStore();
    const shipment = makeShipment(store, { status: 'en_transito' });
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup({ 11111: { lat: 1.001, lon: 1.0, speed: 2 } }),
    });
    const transitions = watcher.tick();
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].to, 'en_puerto');
    assert.equal(transitions[0].reason, 'geofence_enter');
    assert.equal(store.get(shipment.id).status, 'en_puerto');
  });

  it('stays en_transito mid-voyage', () => {
    const store = makeStore();
    const shipment = makeShipment(store, { status: 'en_transito' });
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup({ 11111: { lat: 0.5, lon: 0.5, speed: 12 } }),
    });
    assert.deepEqual(watcher.tick(), []);
    assert.equal(store.get(shipment.id).status, 'en_transito');
  });

  it('never regresses and never sets entregado', () => {
    const store = makeStore();
    const shipment = makeShipment(store, { status: 'en_puerto' });
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      // Vessel sails far away again — watcher must NOT move it back.
      vesselLookup: makeLookup({ 11111: { lat: 45, lon: 45, speed: 12 } }),
    });
    assert.deepEqual(watcher.tick(), []);
    assert.equal(store.get(shipment.id).status, 'en_puerto');
  });

  it('owner manual override to entregado works (the watcher stays out)', () => {
    const store = makeStore();
    const shipment = makeShipment(store, { status: 'en_puerto' });
    const updated = store.update(shipment.id, { status: 'entregado' });
    assert.equal(updated.status, 'entregado');
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup({ 11111: { lat: 1.0, lon: 1.0, speed: 0 } }),
    });
    assert.deepEqual(watcher.tick(), []);
    assert.equal(store.get(shipment.id).status, 'entregado');
  });
});

describe('portal watcher: cross-client isolation', () => {
  it('only the moved vessel transitions; the other client is untouched', () => {
    const store = makeStore();
    const a = makeShipment(store, { clientId: 'cli_A', vesselMmsi: '11111' });
    const b = makeShipment(store, { clientId: 'cli_B', vesselMmsi: '22222' });
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup({
        11111: { lat: 0.3, lon: 0, speed: 9 },
        22222: { lat: 0.01, lon: 0, speed: 0 },
      }),
    });
    const transitions = watcher.tick();
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].shipmentId, a.id);
    assert.equal(transitions[0].clientId, 'cli_A');
    assert.equal(store.get(a.id).status, 'en_transito');
    assert.equal(store.get(b.id).status, 'pendiente');
  });
});

describe('portal watcher: lifecycle', () => {
  it('start/stop is idempotent and unref-safe', () => {
    const store = makeStore();
    const watcher = createShipmentWatcher({
      shipmentStore: store,
      vesselLookup: makeLookup({}),
      tickMs: 30,
    });
    assert.equal(watcher.status().running, false);
    watcher.start();
    watcher.start();
    assert.equal(watcher.status().running, true);
    assert.equal(watcher.status().geofenceKm, WATCHER_GEOFENCE_KM);
    watcher.stop();
    assert.equal(watcher.status().running, false);
  });
});
