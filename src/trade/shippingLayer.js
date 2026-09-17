/**
 * Trade RFQ shipping-lane map layer — Cesium route pins for GOD'S EYE VIEW.
 *
 * $0, no API keys. Draws, per active RFQ (request for quote), an origin
 * pin, a destination pin, and a great-circle shipping lane between them,
 * colored by RFQ status. RFQs with status won/lost are excluded, and RFQs
 * missing either endpoint's coordinates are skipped silently — coordinates
 * are never invented.
 *
 * NOTE: this module imports Cesium as an ES module (matching the rest of
 * the app). It NEVER sniffs window.Cesium — that global does not exist in
 * this build.
 *
 * Usage:
 *   const layer = initShippingMapLayer({ viewer, rfqStore, rfqEngine });
 *   layer.refresh();
 *   layer.onRfqClick((rfq) => openRfqPanel(rfq));
 */

import * as Cesium from 'cesium';

const ENTITY_ID_PREFIX = 'gev-rfq-';

export const RFQ_STATUS_COLORS = {
  prospect: '#9ca3af', // gray
  contacted: '#38bdf8', // light blue
  quoting: '#eab308', // yellow
  negotiating: '#fb923c', // orange
  won: '#22c55e', // green
  lost: '#6b7280', // dim
  unknown: '#9ca3af', // gray

  /** Return the css color string for an RFQ status (unknown → gray). */
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

// won/lost RFQs are never rendered, so they carry no color.
const HIDDEN_STATUSES = new Set(['won', 'lost']);

/** A number is usable only when present and finite. */
function finiteNumber(v) {
  if (v === null || v === undefined || v === '') return false;
  return Number.isFinite(Number(v));
}

/**
 * An RFQ renders only when BOTH origin and destination endpoints have
 * finite coordinates. Never invent a point: skip the RFQ silently
 * otherwise (no (0,0) fallback pins, ever).
 */
function hasRouteCoords(rfq) {
  if (!rfq) return false;
  return (
    finiteNumber(rfq.originLat) &&
    finiteNumber(rfq.originLng) &&
    finiteNumber(rfq.destLat) &&
    finiteNumber(rfq.destLng)
  );
}

function readRfqs(rfqStore) {
  try {
    if (!rfqStore) return [];
    if (Array.isArray(rfqStore)) return rfqStore;
    if (Array.isArray(rfqStore.rfqs)) return rfqStore.rfqs;
    if (typeof rfqStore.listRfqs === 'function') {
      const out = rfqStore.listRfqs();
      return Array.isArray(out) ? out : [];
    }
    return [];
  } catch {
    return [];
  }
}

function rfqVisible(rfq) {
  if (!rfq) return false;
  const status = String(rfq.status || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  if (HIDDEN_STATUSES.has(status)) return false;
  return true;
}

function rfqStatus(rfq, rfqEngine) {
  try {
    if (rfqEngine && typeof rfqEngine.statusFor === 'function') {
      const s = rfqEngine.statusFor(rfq);
      if (s !== null && s !== undefined && s !== '') return String(s);
    }
  } catch {
    /* fall through to rfq.status */
  }
  return rfq && rfq.status !== undefined && rfq.status !== null
    ? String(rfq.status)
    : '';
}

function colorForStatus(status) {
  return Cesium.Color.fromCssColorString(
    RFQ_STATUS_COLORS.cssForStatus(status),
  );
}

/** Build a pin image data URL; returns null when canvas is unavailable. */
let pinBuilder = null;
function pinImage(color, kind) {
  try {
    if (!pinBuilder) pinBuilder = new Cesium.PinBuilder();
    // Phone-glanceable endpoint distinction: origin = classic teardrop pin,
    // destination = round badge with an anchor glyph. Both keep the status
    // color so the lane's meaning is readable at a glance.
    const canvas =
      kind === 'destination'
        ? pinBuilder.fromText('⚓', color, 64)
        : pinBuilder.fromColor(color, 64);
    return typeof canvas.toDataURL === 'function' ? canvas.toDataURL() : null;
  } catch {
    return null;
  }
}

function makePinDef({ id, lat, lng, label, color, visible, kind }) {
  const def = {
    id,
    position: Cesium.Cartesian3.fromDegrees(Number(lng), Number(lat)),
    properties: { rfqId: null, kind: 'port' },
    show: visible,
  };
  const image = pinImage(color, kind);
  // Larger pins than the wholesale/crude layers: readable on a phone screen.
  const isDestination = kind === 'destination';
  if (image) {
    def.billboard = {
      image,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      width: isDestination ? 44 : 36,
      height: isDestination ? 44 : 54,
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
    // 15px labels stay legible on a phone at typical globe zoom levels.
    font: '15px sans-serif',
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
 * Great-circle-ish lane between two lat/lng pairs, lifted by an altitude
 * proportional to the distance so long hauls arc above the globe.
 * Returns { positions, distanceMeters, midLat, midLng }.
 */
function routeGeometry(originLat, originLng, destLat, destLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const la1 = toRad(originLat);
  const lo1 = toRad(originLng);
  const la2 = toRad(destLat);
  const lo2 = toRad(destLng);
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
  const midLat = (originLat + destLat) / 2;
  const midLng = (originLng + destLng) / 2;
  return { positions, distanceMeters, midLat, midLng };
}

/**
 * Init the trade RFQ shipping-lane map layer.
 *
 * @param {object} opts
 * @param {object} opts.viewer      — Cesium viewer (required for entities).
 * @param {object|array} opts.rfqStore — RFQ array, { rfqs }, or { listRfqs() }.
 * @param {object} [opts.rfqEngine]    — optional { statusFor(rfq) }.
 * @param {object} [opts.signal]       — optional abort/cleanup signal.
 * @returns {{ refresh(), flyToRfq(id), setVisible(bool), destroy(), onRfqClick(fn) }}
 */
export function initShippingMapLayer(opts = {}) {
  const viewer = opts.viewer || null;
  const rfqStore = opts.rfqStore || null;
  const rfqEngine = opts.rfqEngine || null;
  const signal = opts.signal || null;

  const byId = new Map(); // rfq id → { entities: { origin, destination, lane }, rfq, status }
  const clickHandlers = new Set();
  let clickHandler = null;
  let visible = true;

  const hasViewer = () =>
    !!viewer && !!viewer.entities && typeof viewer.entities.add === 'function';

  function entityIdFor(rfqId, kind) {
    return `${ENTITY_ID_PREFIX}${rfqId}-${kind}`;
  }

  function pinLabel(rfq, kind) {
    // Labels name the endpoint AND its role: readable without tapping.
    if (kind === 'origin') return `${rfq.originPort || 'origen'} (origen)`;
    return `${rfq.destinationPort || 'destino'} (destino)`;
  }

  function makeRfqEntities(rfq, status) {
    const color = colorForStatus(status);
    const key = String(rfq.id);
    const originLat = Number(rfq.originLat);
    const originLng = Number(rfq.originLng);
    const destLat = Number(rfq.destLat);
    const destLng = Number(rfq.destLng);

    const originDef = makePinDef({
      id: entityIdFor(key, 'origin'),
      lat: originLat,
      lng: originLng,
      label: pinLabel(rfq, 'origin'),
      color,
      visible,
      kind: 'origin',
    });
    originDef.properties = { rfqId: rfq.id, kind: 'origin' };

    const destinationDef = makePinDef({
      id: entityIdFor(key, 'destination'),
      lat: destLat,
      lng: destLng,
      label: pinLabel(rfq, 'destination'),
      color,
      visible,
      kind: 'destination',
    });
    destinationDef.properties = { rfqId: rfq.id, kind: 'destination' };

    const { positions, distanceMeters, midLat, midLng } = routeGeometry(
      originLat,
      originLng,
      destLat,
      destLng,
    );
    const laneDef = {
      id: entityIdFor(key, 'lane'),
      polyline: {
        positions,
        // 3px lane: visible on a phone screen without zooming in.
        width: 3,
        material: color,
        clampToGround: false,
      },
      properties: { rfqId: rfq.id, kind: 'lane' },
      show: visible,
    };

    return {
      originDef,
      destinationDef,
      laneDef,
      routeMeta: { distanceMeters, midLat, midLng },
    };
  }

  /** Rebuild RFQ pins/lanes from the store: dedupe by RFQ id, drop stale. */
  function refresh() {
    if (!hasViewer()) return { added: 0, updated: 0, removed: 0 };
    const rfqs = readRfqs(rfqStore);
    const seen = new Set();
    let added = 0;
    let updated = 0;
    for (const rfq of rfqs) {
      if (!rfqVisible(rfq)) continue;
      if (!hasRouteCoords(rfq)) continue;
      const key = String(rfq.id);
      if (seen.has(key)) continue; // dedupe within the store
      seen.add(key);
      const status = rfqStatus(rfq, rfqEngine);
      const existing = byId.get(key);
      if (existing) {
        // Recolor the lane (and pins) in place when the status changed.
        if (existing.status !== status && existing.entities) {
          existing.status = status;
          existing.rfq = rfq;
          applyStatusColor(existing.entities, status);
          updated += 1;
        }
        continue;
      }
      try {
        const defs = makeRfqEntities(rfq, status);
        const origin = viewer.entities.add(defs.originDef);
        const destination = viewer.entities.add(defs.destinationDef);
        const lane = viewer.entities.add(defs.laneDef);
        byId.set(key, {
          entities: { origin, destination, lane },
          rfq,
          status,
          routeMeta: defs.routeMeta,
        });
        added += 3;
      } catch {
        /* entity creation failed — skip this RFQ */
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
      const { origin, destination, lane } = entities;
      for (const pin of [origin, destination]) {
        if (pin && pin.billboard) pin.billboard.color = color;
        if (pin && pin.point) pin.point.color = color;
      }
      if (lane && lane.polyline) lane.polyline.material = color;
    } catch {
      /* ignore */
    }
  }

  function findRfq(id) {
    const record = byId.get(String(id));
    if (record) return record.rfq;
    return readRfqs(rfqStore).find((r) => String(r.id) === String(id)) || null;
  }

  /** Fly the camera to an RFQ's lane midpoint (falls back to origin pin). */
  function flyToRfq(id) {
    if (!viewer || !viewer.camera) return false;
    const rfq = findRfq(id);
    if (!hasRouteCoords(rfq)) return false;
    const record = byId.get(String(id));
    const originLat = Number(rfq.originLat);
    const originLng = Number(rfq.originLng);
    let midLat = originLat;
    let midLng = originLng;
    let distanceMeters = 0;
    if (record && record.routeMeta) {
      midLat = record.routeMeta.midLat;
      midLng = record.routeMeta.midLng;
      distanceMeters = record.routeMeta.distanceMeters;
    } else {
      try {
        const geo = routeGeometry(
          originLat,
          originLng,
          Number(rfq.destLat),
          Number(rfq.destLng),
        );
        midLat = geo.midLat;
        midLng = geo.midLng;
        distanceMeters = geo.distanceMeters;
      } catch {
        /* keep origin-pin fallback */
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

  /** Show/hide all RFQ pins and lanes. */
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

  function resolveRfqFromPicked(picked) {
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
    // Entity ids end in -origin, -destination, or -lane.
    const match = rest.match(/^(.*)-(origin|destination|lane)$/);
    const key = match ? match[1] : rest;
    const record = byId.get(key);
    return record ? record.rfq : null;
  }

  function emitClick(rfq) {
    for (const fn of clickHandlers) {
      try {
        fn(rfq);
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
          const rfq = resolveRfqFromPicked(picked);
          if (rfq) emitClick(rfq);
        } catch {
          /* ignore pick errors */
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      clickHandler = handler;
    } catch {
      clickHandler = null;
    }
  }

  /** Register an RFQ-click callback. */
  function onRfqClick(fn) {
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
      if (typeof window !== 'undefined' && window.__gevShippingMap === api) {
        delete window.__gevShippingMap;
      }
    } catch {
      /* ignore */
    }
  }

  const api = {
    refresh,
    flyToRfq,
    setVisible,
    destroy,
    onRfqClick,
    // Debug/testing hooks (not part of the public UI contract).
    _count: () => byId.size,
    _storeSwap: (next) => {
      // Test hook: replace the store without re-init.
      if (Array.isArray(next)) {
        if (Array.isArray(rfqStore)) {
          rfqStore.length = 0;
          rfqStore.push(...next);
        } else if (rfqStore && Array.isArray(rfqStore.rfqs)) {
          rfqStore.rfqs = next;
        }
      }
    },
    _pick: (picked) => {
      const rfq = resolveRfqFromPicked(picked);
      if (rfq) emitClick(rfq);
      return rfq;
    },
  };

  try {
    if (typeof window !== 'undefined') {
      window.__gevShippingMap = api;
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
