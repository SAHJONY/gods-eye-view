/**
 * Crude-oil cargo map layer — Cesium tanker route pins for GOD'S EYE VIEW.
 *
 * $0, no API keys. Draws, per active crude cargo, a load-port pin, a
 * discharge-port pin, and a great-circle route arc between them, colored by
 * cargo status. Cargoes with status dead/closed are excluded, and cargoes
 * missing either endpoint's coordinates are skipped silently — coordinates
 * are never invented.
 *
 * NOTE: this module imports Cesium as an ES module (matching the rest of
 * the app). It NEVER sniffs window.Cesium — that global does not exist in
 * this build.
 *
 * Usage:
 *   const layer = initTankerMapLayer({ viewer, cargoStore });
 *   layer.refresh();
 *   layer.onCargoClick((cargo) => openCargoPanel(cargo));
 */

import * as Cesium from 'cesium';

const ENTITY_ID_PREFIX = 'gev-cargo-';

export const CARGO_STATUS_COLORS = {
  prospect: '#9ca3af', // gray
  diligence: '#38bdf8', // light blue
  negotiating: '#eab308', // yellow
  contracted: '#22c55e', // green
  loading: '#fb923c', // orange
  intransit: '#22d3ee', // cyan
  delivered: '#16a34a', // dark green
  closed: '#6b7280', // dim
  unknown: '#9ca3af', // gray

  /** Return the css color string for a cargo status (unknown → gray). */
  cssForStatus(status) {
    if (status === null || status === undefined || status === '') {
      return this.unknown;
    }
    const key = String(status)
      .toLowerCase()
      .replace(/[\s_-]/g, '');
    return this[key] || this.unknown;
  },
};

// dead cargoes are never rendered, so they carry no color.
const HIDDEN_STATUSES = new Set(['dead', 'closed']);

/** A number is usable only when present and finite. */
function finiteNumber(v) {
  if (v === null || v === undefined || v === '') return false;
  return Number.isFinite(Number(v));
}

/**
 * A cargo renders only when BOTH load and discharge endpoints have finite
 * coordinates. Never invent a point: skip the cargo silently otherwise.
 */
function hasRouteCoords(cargo) {
  if (!cargo) return false;
  return (
    finiteNumber(cargo.loadLat) &&
    finiteNumber(cargo.loadLng) &&
    finiteNumber(cargo.dischargeLat) &&
    finiteNumber(cargo.dischargeLng)
  );
}

function readCargoes(cargoStore) {
  try {
    if (!cargoStore) return [];
    if (Array.isArray(cargoStore)) return cargoStore;
    if (Array.isArray(cargoStore.cargoes)) return cargoStore.cargoes;
    if (typeof cargoStore.listCargoes === 'function') {
      const out = cargoStore.listCargoes();
      return Array.isArray(out) ? out : [];
    }
    return [];
  } catch {
    return [];
  }
}

function cargoVisible(cargo) {
  if (!cargo) return false;
  const status = String(cargo.status || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  if (HIDDEN_STATUSES.has(status)) return false;
  return true;
}

function cargoStatus(cargo, cargoEngine) {
  try {
    if (cargoEngine && typeof cargoEngine.statusFor === 'function') {
      const s = cargoEngine.statusFor(cargo);
      if (s !== null && s !== undefined && s !== '') return String(s);
    }
  } catch {
    /* fall through to cargo.status */
  }
  return cargo && cargo.status !== undefined && cargo.status !== null
    ? String(cargo.status)
    : '';
}

function colorForStatus(status) {
  return Cesium.Color.fromCssColorString(
    CARGO_STATUS_COLORS.cssForStatus(status),
  );
}

/** Build a pin image data URL; returns null when canvas is unavailable. */
let pinBuilder = null;
function pinImage(color) {
  try {
    if (!pinBuilder) pinBuilder = new Cesium.PinBuilder();
    const canvas = pinBuilder.fromColor(color, 64);
    return typeof canvas.toDataURL === 'function' ? canvas.toDataURL() : null;
  } catch {
    return null;
  }
}

function makePinDef({ id, lat, lng, label, color, visible }) {
  const def = {
    id,
    position: Cesium.Cartesian3.fromDegrees(Number(lng), Number(lat)),
    properties: { cargoId: null, kind: 'port' },
    show: visible,
  };
  const image = pinImage(color);
  if (image) {
    def.billboard = {
      image,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      width: 32,
      height: 48,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
  } else {
    // Canvas unavailable (e.g. headless tests): colored point fallback.
    def.point = {
      pixelSize: 14,
      color,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
  }
  def.label = {
    text: String(label),
    font: '13px sans-serif',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 2,
    pixelOffset: new Cesium.Cartesian2(0, image ? -52 : -18),
    showBackground: true,
    backgroundColor: new Cesium.Color(0, 0, 0, 0.55),
  };
  return def;
}

const EARTH_RADIUS_M = 6371000;
const ROUTE_SAMPLES = 32;

/**
 * Great-circle-ish route between two lat/lng pairs, lifted by an altitude
 * proportional to the distance so long hauls arc above the globe.
 * Returns { positions, distanceMeters, midLat, midLng }.
 */
function routeGeometry(loadLat, loadLng, dischargeLat, dischargeLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const la1 = toRad(loadLat);
  const lo1 = toRad(loadLng);
  const la2 = toRad(dischargeLat);
  const lo2 = toRad(dischargeLng);
  const v1 = [
    Math.cos(la1) * Math.cos(lo1),
    Math.cos(la1) * Math.sin(lo1),
    Math.sin(la1),
  ];
  const v2 = [
    Math.cos(la2) * Math.cos(lo2),
    Math.cos(la2) * Math.sin(lo2),
    Math.sin(la2),
  ];
  const dot = Math.min(
    1,
    Math.max(-1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]),
  );
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);
  const distanceMeters = omega * EARTH_RADIUS_M;
  const peakAltitude = distanceMeters * 0.15;
  const positions = [];
  for (let i = 0; i < ROUTE_SAMPLES; i += 1) {
    const t = i / (ROUTE_SAMPLES - 1);
    let x;
    let y;
    let z;
    if (sinOmega < 1e-10) {
      [x, y, z] = v1;
    } else {
      const a = Math.sin((1 - t) * omega) / sinOmega;
      const b = Math.sin(t * omega) / sinOmega;
      x = a * v1[0] + b * v2[0];
      y = a * v1[1] + b * v2[1];
      z = a * v1[2] + b * v2[2];
    }
    const len = Math.hypot(x, y, z) || 1;
    x /= len;
    y /= len;
    z /= len;
    const lat = (Math.asin(Math.min(1, Math.max(-1, z))) * 180) / Math.PI;
    const lng = (Math.atan2(y, x) * 180) / Math.PI;
    const alt = peakAltitude * Math.sin(Math.PI * t);
    positions.push(Cesium.Cartesian3.fromDegrees(lng, lat, alt));
  }
  const midLat = (loadLat + dischargeLat) / 2;
  const midLng = (loadLng + dischargeLng) / 2;
  return { positions, distanceMeters, midLat, midLng };
}

/**
 * Init the crude cargo map layer.
 *
 * @param {object} opts
 * @param {object} opts.viewer      — Cesium viewer (required for entities).
 * @param {object|array} opts.cargoStore — cargo array, { cargoes }, or { listCargoes() }.
 * @param {object} [opts.cargoEngine]    — optional { statusFor(cargo) }.
 * @param {object} [opts.signal]         — optional abort/cleanup signal.
 * @returns {{ refresh(), flyToCargo(id), setVisible(bool), destroy(), onCargoClick(fn) }}
 */
export function initTankerMapLayer(opts = {}) {
  const viewer = opts.viewer || null;
  const cargoStore = opts.cargoStore || null;
  const cargoEngine = opts.cargoEngine || null;
  const signal = opts.signal || null;

  const byId = new Map(); // cargo id → { entities: { load, discharge, route }, cargo, status }
  const clickHandlers = new Set();
  let clickHandler = null;
  let visible = true;

  const hasViewer = () =>
    !!viewer && !!viewer.entities && typeof viewer.entities.add === 'function';

  function entityIdFor(cargoId, kind) {
    return `${ENTITY_ID_PREFIX}${cargoId}-${kind}`;
  }

  function pinLabel(cargo, kind) {
    if (kind === 'load') return cargo.loadPort || `load #${cargo.id}`;
    return cargo.dischargePort || `discharge #${cargo.id}`;
  }

  function makeCargoEntities(cargo, status) {
    const color = colorForStatus(status);
    const key = String(cargo.id);
    const loadLat = Number(cargo.loadLat);
    const loadLng = Number(cargo.loadLng);
    const dischargeLat = Number(cargo.dischargeLat);
    const dischargeLng = Number(cargo.dischargeLng);

    const loadDef = makePinDef({
      id: entityIdFor(key, 'load'),
      lat: loadLat,
      lng: loadLng,
      label: pinLabel(cargo, 'load'),
      color,
      visible,
    });
    loadDef.properties = { cargoId: cargo.id, kind: 'load' };

    const dischargeDef = makePinDef({
      id: entityIdFor(key, 'discharge'),
      lat: dischargeLat,
      lng: dischargeLng,
      label: pinLabel(cargo, 'discharge'),
      color,
      visible,
    });
    dischargeDef.properties = { cargoId: cargo.id, kind: 'discharge' };

    const { positions, distanceMeters, midLat, midLng } = routeGeometry(
      loadLat,
      loadLng,
      dischargeLat,
      dischargeLng,
    );
    const routeDef = {
      id: entityIdFor(key, 'route'),
      polyline: {
        positions,
        width: 2,
        material: color,
        clampToGround: false,
      },
      properties: { cargoId: cargo.id, kind: 'route' },
      show: visible,
    };

    return {
      loadDef,
      dischargeDef,
      routeDef,
      routeMeta: { distanceMeters, midLat, midLng },
    };
  }

  /** Rebuild cargo pins/routes from the store: dedupe by cargo id, drop stale. */
  function refresh() {
    if (!hasViewer()) return { added: 0, updated: 0, removed: 0 };
    const cargoes = readCargoes(cargoStore);
    const seen = new Set();
    let added = 0;
    let updated = 0;
    for (const cargo of cargoes) {
      if (!cargoVisible(cargo)) continue;
      if (!hasRouteCoords(cargo)) continue;
      const key = String(cargo.id);
      if (seen.has(key)) continue; // dedupe within the store
      seen.add(key);
      const status = cargoStatus(cargo, cargoEngine);
      const existing = byId.get(key);
      if (existing) {
        // Recolor the route (and pins) in place when the status changed.
        if (existing.status !== status && existing.entities) {
          existing.status = status;
          existing.cargo = cargo;
          applyStatusColor(existing.entities, status);
          updated += 1;
        }
        continue;
      }
      try {
        const defs = makeCargoEntities(cargo, status);
        const load = viewer.entities.add(defs.loadDef);
        const discharge = viewer.entities.add(defs.dischargeDef);
        const route = viewer.entities.add(defs.routeDef);
        byId.set(key, {
          entities: { load, discharge, route },
          cargo,
          status,
          routeMeta: defs.routeMeta,
        });
        added += 3;
      } catch {
        /* entity creation failed — skip this cargo */
      }
    }
    // Remove stale entities (no longer in store or newly hidden).
    let removed = 0;
    for (const [key, record] of Array.from(byId)) {
      if (!seen.has(key)) {
        try {
          for (const entity of Object.values(record.entities || {})) {
            viewer.entities.remove(entity || { id: record.entityId });
          }
        } catch {
          /* ignore */
        }
        byId.delete(key);
        removed += 3;
      }
    }
    return { added, updated, removed };
  }

  function applyStatusColor(entities, status) {
    try {
      const color = colorForStatus(status);
      const { load, discharge, route } = entities;
      for (const pin of [load, discharge]) {
        if (pin && pin.billboard) pin.billboard.color = color;
        if (pin && pin.point) pin.point.color = color;
      }
      if (route && route.polyline) route.polyline.material = color;
    } catch {
      /* ignore */
    }
  }

  function findCargo(id) {
    const record = byId.get(String(id));
    if (record) return record.cargo;
    return (
      readCargoes(cargoStore).find((c) => String(c.id) === String(id)) || null
    );
  }

  /** Fly the camera to a cargo's route midpoint (falls back to load port). */
  function flyToCargo(id) {
    if (!viewer || !viewer.camera) return false;
    const cargo = findCargo(id);
    if (!hasRouteCoords(cargo)) return false;
    const record = byId.get(String(id));
    const loadLat = Number(cargo.loadLat);
    const loadLng = Number(cargo.loadLng);
    let midLat = loadLat;
    let midLng = loadLng;
    let distanceMeters = 0;
    if (record && record.routeMeta) {
      midLat = record.routeMeta.midLat;
      midLng = record.routeMeta.midLng;
      distanceMeters = record.routeMeta.distanceMeters;
    } else {
      try {
        const geo = routeGeometry(
          loadLat,
          loadLng,
          Number(cargo.dischargeLat),
          Number(cargo.dischargeLng),
        );
        midLat = geo.midLat;
        midLng = geo.midLng;
        distanceMeters = geo.distanceMeters;
      } catch {
        /* keep load-port fallback */
      }
    }
    const altitude = Math.min(Math.max(distanceMeters * 0.75, 5000), 4000000);
    try {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(midLng, midLat, altitude),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Show/hide all cargo pins and routes. */
  function setVisible(next) {
    visible = !!next;
    for (const { entities } of byId.values()) {
      try {
        for (const entity of Object.values(entities || {})) {
          if (entity) entity.show = visible;
        }
      } catch {
        /* ignore */
      }
    }
  }

  function resolveCargoFromPicked(picked) {
    if (!picked || !picked.id) return null;
    let entityId = picked.id;
    if (typeof entityId === 'object') {
      // picked.id may be the entity object itself.
      entityId = entityId.id || null;
    }
    if (!entityId) return null;
    const s = String(entityId);
    if (!s.startsWith(ENTITY_ID_PREFIX)) return null;
    const rest = s.slice(ENTITY_ID_PREFIX.length);
    // Entity ids end in -load, -discharge, or -route.
    const match = rest.match(/^(.*)-(load|discharge|route)$/);
    const key = match ? match[1] : rest;
    const record = byId.get(key);
    return record ? record.cargo : null;
  }

  function emitClick(cargo) {
    for (const fn of clickHandlers) {
      try {
        fn(cargo);
      } catch {
        /* ignore handler errors */
      }
    }
  }

  function ensureClickWiring() {
    if (clickHandler || !viewer || !viewer.scene || !viewer.scene.canvas)
      return;
    try {
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement) => {
        try {
          const picked = viewer.scene.pick(movement.position);
          const cargo = resolveCargoFromPicked(picked);
          if (cargo) emitClick(cargo);
        } catch {
          /* ignore pick errors */
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      clickHandler = handler;
    } catch {
      clickHandler = null;
    }
  }

  /** Register a cargo-click callback. */
  function onCargoClick(fn) {
    if (typeof fn === 'function') clickHandlers.add(fn);
    ensureClickWiring();
    return () => clickHandlers.delete(fn);
  }

  /** Remove every entity and click wiring. */
  function destroy() {
    if (hasViewer()) {
      for (const record of byId.values()) {
        try {
          for (const entity of Object.values(record.entities || {})) {
            viewer.entities.remove(entity || { id: record.entityId });
          }
        } catch {
          /* ignore */
        }
      }
    }
    byId.clear();
    clickHandlers.clear();
    try {
      if (clickHandler && typeof clickHandler.destroy === 'function') {
        clickHandler.destroy();
      }
    } catch {
      /* ignore */
    }
    clickHandler = null;
    try {
      if (typeof window !== 'undefined' && window.__gevTankerMap === api) {
        delete window.__gevTankerMap;
      }
    } catch {
      /* ignore */
    }
  }

  const api = {
    refresh,
    flyToCargo,
    setVisible,
    destroy,
    onCargoClick,
    // Debug/testing hooks (not part of the public UI contract).
    _count: () => byId.size,
    _storeSwap: (next) => {
      // Test hook: replace the store without re-init.
      if (Array.isArray(next)) {
        if (Array.isArray(cargoStore)) {
          cargoStore.length = 0;
          cargoStore.push(...next);
        } else if (cargoStore && Array.isArray(cargoStore.cargoes)) {
          cargoStore.cargoes = next;
        }
      }
    },
    _pick: (picked) => {
      const cargo = resolveCargoFromPicked(picked);
      if (cargo) emitClick(cargo);
      return cargo;
    },
  };

  try {
    if (typeof window !== 'undefined') {
      window.__gevTankerMap = api;
    }
  } catch {
    /* non-browser runtimes */
  }

  // Optional abort/cleanup signal: destroying on abort frees all entities.
  try {
    if (signal) {
      if (signal.aborted) {
        destroy();
      } else if (typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', () => destroy(), { once: true });
      } else if (typeof signal.on === 'function') {
        signal.on('abort', () => destroy());
      }
    }
  } catch {
    /* ignore signal wiring errors */
  }

  return api;
}
