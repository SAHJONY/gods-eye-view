/**
 * MY CUBA CASH corridor map layer — Cesium provider pins + remittance
 * corridor arcs for GOD'S EYE VIEW.
 *
 * $0, no API keys. Per provider with real coordinates, one coverage pin.
 * Per corridor with real endpoint coordinates, one from-pin, one to-pin,
 * and a great-circle arc between them (e.g. USA → Cuba), colored by
 * corridor completeness (green = computable, gray = missing rate/amount).
 * Anything missing coordinates renders nothing — coordinates are never
 * invented, and there is no geocoding of country names.
 *
 * NOTE: this module imports Cesium as an ES module (matching the rest of
 * the app). It NEVER sniffs window.Cesium — that global does not exist in
 * this build.
 *
 * Usage:
 *   const layer = initCorridorMapLayer({ viewer, providerStore, corridorEngine });
 *   layer.refresh();
 *   layer.onProviderClick((provider) => openDrawer(provider));
 */

import * as Cesium from 'cesium';

const ENTITY_ID_PREFIX = 'gev-cubacash-';

export const PROVIDER_STATUS_COLORS = {
  live: '#22c55e', // green
  verifying: '#eab308', // yellow
  candidate: '#9ca3af', // gray
  paused: '#6b7280', // dim
  unknown: '#9ca3af', // gray

  /** Return the css color string for a provider status (unknown → gray). */
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

export const CORRIDOR_COLORS = {
  complete: '#22c55e', // green — math is computable
  incomplete: '#9ca3af', // gray — missing rate or amount
};

const HIDDEN_PROVIDER_STATUSES = new Set(['paused']);

/** A number is usable only when present and finite. */
function finiteNumber(v) {
  if (v === null || v === undefined || v === '') return false;
  return Number.isFinite(Number(v));
}

function readProviders(providerStore) {
  try {
    if (!providerStore) return [];
    if (Array.isArray(providerStore)) return providerStore;
    if (Array.isArray(providerStore.providers)) return providerStore.providers;
    if (typeof providerStore.listProviders === 'function') {
      const out = providerStore.listProviders();
      return Array.isArray(out) ? out : [];
    }
    return [];
  } catch {
    return [];
  }
}

function readCorridors(providerStore) {
  try {
    if (!providerStore) return [];
    if (Array.isArray(providerStore.corridors)) return providerStore.corridors;
    if (typeof providerStore.listCorridors === 'function') {
      const out = providerStore.listCorridors();
      return Array.isArray(out) ? out : [];
    }
    return [];
  } catch {
    return [];
  }
}

function providerVisible(provider) {
  if (!provider) return false;
  return !HIDDEN_PROVIDER_STATUSES.has(
    String(provider.status || '').toLowerCase(),
  );
}

function hasPinCoords(provider) {
  if (!provider) return false;
  return finiteNumber(provider.lat) && finiteNumber(provider.lng);
}

/** A corridor renders only when BOTH endpoints have finite coordinates. */
function hasRouteCoords(corridor) {
  if (!corridor) return false;
  return (
    finiteNumber(corridor.fromLat) &&
    finiteNumber(corridor.fromLng) &&
    finiteNumber(corridor.toLat) &&
    finiteNumber(corridor.toLng)
  );
}

function corridorComplete(corridor, corridorEngine) {
  try {
    if (corridorEngine && typeof corridorEngine.corridorMath === 'function') {
      const math = corridorEngine.corridorMath({
        sendAmount: corridor && corridor.sendAmount,
        fee: corridor && corridor.fee,
        fxRate: corridor && corridor.fxRate,
      });
      return math && math.receivedAmount !== null;
    }
  } catch {
    /* fall through to manual check */
  }
  const amount = Number(corridor && corridor.sendAmount);
  const rate = Number(corridor && corridor.fxRate);
  return (
    Number.isFinite(amount) && amount > 0 && Number.isFinite(rate) && rate > 0
  );
}

function colorForProvider(status) {
  return Cesium.Color.fromCssColorString(
    PROVIDER_STATUS_COLORS.cssForStatus(status),
  );
}

function colorForCorridor(complete) {
  return Cesium.Color.fromCssColorString(
    complete ? CORRIDOR_COLORS.complete : CORRIDOR_COLORS.incomplete,
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

function makePinDef({ id, lat, lng, label, color, visible, properties, size }) {
  const large = size !== 'small'; // provider pins are large; corridor endpoint pins are small
  const def = {
    id,
    position: Cesium.Cartesian3.fromDegrees(Number(lng), Number(lat)),
    properties: properties || null,
    show: visible,
  };
  const image = pinImage(color);
  if (image) {
    def.billboard = {
      image,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      width: large ? 32 : 22,
      height: large ? 48 : 34,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
  } else {
    // Canvas unavailable (e.g. headless tests): colored point fallback.
    def.point = {
      pixelSize: large ? 14 : 9,
      color,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
  }
  def.label = {
    text: String(label),
    font: large ? 'bold 13px sans-serif' : '12px sans-serif',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 2,
    pixelOffset: new Cesium.Cartesian2(
      0,
      image ? (large ? -52 : -38) : large ? -18 : -13,
    ),
    showBackground: true,
    backgroundColor: new Cesium.Color(0, 0, 0, 0.55),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
  return def;
}

/**
 * Label-only entity pinned to a corridor route's arc midpoint — always
 * readable (depth test disabled), never hover-dependent. Text names the
 * corridor and the send amount when known; the background is tinted with the
 * route color so the label reads as part of its route at a glance.
 */
function makeRouteLabelDef({ id, position, text, color, visible, properties }) {
  let background = new Cesium.Color(0, 0, 0, 0.65);
  try {
    if (color && typeof color.withAlpha === 'function') {
      background = color.withAlpha(0.8);
    }
  } catch {
    /* keep the dark default */
  }
  return {
    id,
    position,
    properties: properties || null,
    show: visible,
    label: {
      text: String(text),
      font: 'bold 14px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      showBackground: true,
      backgroundColor: background,
      pixelOffset: new Cesium.Cartesian2(0, -14),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  };
}

/** Human-readable route label: "USA → Cuba · $100" or "USA → Cuba". */
export function routeLabelText(corridor) {
  const from = corridor && corridor.fromCountry ? corridor.fromCountry : '?';
  const to = corridor && corridor.toCountry ? corridor.toCountry : '?';
  const amount =
    corridor && Number(corridor.sendAmount) > 0
      ? ` · $${Number(corridor.sendAmount).toLocaleString('en-US')}`
      : '';
  return `${from} → ${to}${amount}`;
}

const EARTH_RADIUS_M = 6371000;
const ROUTE_SAMPLES = 32;

/**
 * Great-circle-ish route between two lat/lng pairs, lifted by an altitude
 * proportional to the distance so long hauls arc above the globe.
 * Returns { positions, distanceMeters, midLat, midLng }.
 */
function routeGeometry(fromLat, fromLng, toLat, toLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const la1 = toRad(fromLat);
  const lo1 = toRad(fromLng);
  const la2 = toRad(toLat);
  const lo2 = toRad(toLng);
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
  const midLat = (fromLat + toLat) / 2;
  const midLng = (fromLng + toLng) / 2;
  return { positions, distanceMeters, midLat, midLng };
}

/**
 * Init the MY CUBA CASH corridor map layer.
 *
 * @param {object} opts
 * @param {object} opts.viewer        — Cesium viewer (required for entities).
 * @param {object} opts.providerStore — { listProviders(), listCorridors() }.
 * @param {object} [opts.corridorEngine] — optional { corridorMath() }.
 * @param {object} [opts.signal]         — optional abort/cleanup signal.
 * @returns {{ refresh(), flyToProvider(id), flyToCorridor(id), setVisible(bool),
 *            destroy(), onProviderClick(fn), onCorridorClick(fn) }}
 */
export function initCorridorMapLayer(opts = {}) {
  const viewer = opts.viewer || null;
  const providerStore = opts.providerStore || null;
  const corridorEngine = opts.corridorEngine || null;
  const signal = opts.signal || null;

  const byId = new Map(); // entity key → { entities, kind, status/complete }
  const providerHandlers = new Set();
  const corridorHandlers = new Set();
  let clickHandler = null;
  let visible = true;

  const hasViewer = () =>
    !!viewer && !!viewer.entities && typeof viewer.entities.add === 'function';

  function entityIdFor(key, kind) {
    return `${ENTITY_ID_PREFIX}${key}-${kind}`;
  }

  function addEntityGroup(id, defs, meta) {
    const entities = {};
    let added = 0;
    for (const [slot, def] of Object.entries(defs)) {
      try {
        entities[slot] = viewer.entities.add(def);
        added += 1;
      } catch {
        /* entity creation failed — skip this slot */
      }
    }
    if (added > 0) byId.set(id, { entities, ...meta });
    return added;
  }

  /** Rebuild pins/routes from the store: dedupe by id, drop stale. */
  function refresh() {
    if (!hasViewer()) return { added: 0, updated: 0, removed: 0 };
    const seen = new Set();
    let added = 0;
    let updated = 0;

    for (const provider of readProviders(providerStore)) {
      if (!providerVisible(provider) || !hasPinCoords(provider)) continue;
      const key = `provider-${String(provider.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const status = String(provider.status || '');
      const existing = byId.get(key);
      if (existing) {
        if (existing.status !== status && existing.entities) {
          existing.status = status;
          try {
            const color = colorForProvider(status);
            const pin = existing.entities.one;
            if (pin && pin.billboard) pin.billboard.color = color;
            if (pin && pin.point) pin.point.color = color;
            updated += 1;
          } catch {
            /* ignore */
          }
        }
        continue;
      }
      const color = colorForProvider(status);
      const def = makePinDef({
        id: entityIdFor(key, 'pin'),
        lat: Number(provider.lat),
        lng: Number(provider.lng),
        label: provider.name || `provider #${provider.id}`,
        color,
        visible,
        properties: { providerId: provider.id, kind: 'provider' },
      });
      try {
        const entity = viewer.entities.add(def);
        byId.set(key, { entities: { one: entity }, kind: 'provider', status });
        added += 1;
      } catch {
        /* entity creation failed — skip this provider */
      }
    }

    for (const corridor of readCorridors(providerStore)) {
      if (!hasRouteCoords(corridor)) continue;
      const key = `corridor-${String(corridor.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const complete = corridorComplete(corridor, corridorEngine);
      const existing = byId.get(key);
      if (existing) {
        if (existing.complete !== complete) {
          existing.complete = complete;
          try {
            const color = colorForCorridor(complete);
            const { from, to, route, routeLabel } = existing.entities;
            for (const pin of [from, to]) {
              if (pin && pin.billboard) pin.billboard.color = color;
              if (pin && pin.point) pin.point.color = color;
            }
            if (route && route.polyline) route.polyline.material = color;
            if (
              routeLabel &&
              routeLabel.label &&
              typeof color.withAlpha === 'function'
            ) {
              routeLabel.label.backgroundColor = color.withAlpha(0.8);
            }
            updated += 1;
          } catch {
            /* ignore */
          }
        }
        continue;
      }
      const color = colorForCorridor(complete);
      const fromLat = Number(corridor.fromLat);
      const fromLng = Number(corridor.fromLng);
      const toLat = Number(corridor.toLat);
      const toLng = Number(corridor.toLng);
      const fromLabel = corridor.fromCountry || `from #${corridor.id}`;
      const toLabel = corridor.toCountry || `to #${corridor.id}`;
      const props = (kind) => ({
        corridorId: corridor.id,
        providerId: corridor.providerId || null,
        kind,
      });
      const fromDef = makePinDef({
        id: entityIdFor(key, 'from'),
        lat: fromLat,
        lng: fromLng,
        label: fromLabel,
        color,
        visible,
        properties: props('from'),
        size: 'small', // corridor endpoints stay visually subordinate to provider pins
      });
      const toDef = makePinDef({
        id: entityIdFor(key, 'to'),
        lat: toLat,
        lng: toLng,
        label: toLabel,
        color,
        visible,
        properties: props('to'),
        size: 'small',
      });
      const { positions, distanceMeters, midLat, midLng } = routeGeometry(
        fromLat,
        fromLng,
        toLat,
        toLng,
      );
      const routeDef = {
        id: entityIdFor(key, 'route'),
        polyline: {
          positions,
          width: 5, // thick route reads at a glance, even on a phone screen
          material: color,
          clampToGround: false,
        },
        properties: props('route'),
        show: visible,
      };
      const midPosition = positions[Math.floor(positions.length / 2)] || null;
      const routeLabelDef = midPosition
        ? makeRouteLabelDef({
            id: entityIdFor(key, 'routelabel'),
            position: midPosition,
            text: routeLabelText(corridor),
            color,
            visible,
            properties: props('routelabel'),
          })
        : null;
      const group = { from: fromDef, to: toDef, route: routeDef };
      if (routeLabelDef) group.routeLabel = routeLabelDef;
      added += addEntityGroup(key, group, {
        kind: 'corridor',
        complete,
        routeMeta: { distanceMeters, midLat, midLng },
      });
    }

    // Remove stale entities.
    let removed = 0;
    for (const [key, record] of Array.from(byId)) {
      if (!seen.has(key)) {
        try {
          for (const entity of Object.values(record.entities || {})) {
            viewer.entities.remove(entity || { id: key });
          }
        } catch {
          /* ignore */
        }
        byId.delete(key);
        removed += 1;
      }
    }
    return { added, updated, removed };
  }

  function findCorridor(id) {
    return (
      readCorridors(providerStore).find((c) => String(c.id) === String(id)) ||
      null
    );
  }

  function findProvider(id) {
    return (
      readProviders(providerStore).find((p) => String(p.id) === String(id)) ||
      null
    );
  }

  /** Fly the camera to a provider pin or a corridor's route midpoint. */
  function flyTo(target, id) {
    if (!viewer || !viewer.camera) return false;
    let lat;
    let lng;
    let distanceMeters = 0;
    if (target === 'provider') {
      const provider = findProvider(id);
      if (!hasPinCoords(provider)) return false;
      lat = Number(provider.lat);
      lng = Number(provider.lng);
      distanceMeters = 200000;
    } else {
      const corridor = findCorridor(id);
      if (!hasRouteCoords(corridor)) return false;
      const record = byId.get(`corridor-${String(id)}`);
      if (record && record.routeMeta) {
        lat = record.routeMeta.midLat;
        lng = record.routeMeta.midLng;
        distanceMeters = record.routeMeta.distanceMeters;
      } else {
        lat = (Number(corridor.fromLat) + Number(corridor.toLat)) / 2;
        lng = (Number(corridor.fromLng) + Number(corridor.toLng)) / 2;
      }
    }
    const altitude = Math.min(Math.max(distanceMeters * 0.75, 5000), 4000000);
    try {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, altitude),
      });
      return true;
    } catch {
      return false;
    }
  }

  function flyToProvider(id) {
    return flyTo('provider', id);
  }

  function flyToCorridor(id) {
    return flyTo('corridor', id);
  }

  /** Show/hide all pins and routes. */
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

  function resolveFromPicked(picked) {
    if (!picked || !picked.id) return null;
    let entityId = picked.id;
    if (typeof entityId === 'object') entityId = entityId.id || null;
    if (!entityId) return null;
    const s = String(entityId);
    if (!s.startsWith(ENTITY_ID_PREFIX)) return null;
    const rest = s.slice(ENTITY_ID_PREFIX.length);
    const match = rest.match(
      /^(provider|corridor)-(.+)-(pin|from|to|route|routelabel)$/,
    );
    if (!match) return null;
    const [, target, rawId] = match;
    if (target === 'provider') {
      const record = byId.get(`provider-${rawId}`);
      const provider =
        findProvider(rawId) ||
        (record && record.providerId ? findProvider(record.providerId) : null);
      return provider ? { kind: 'provider', provider } : null;
    }
    const corridor = findCorridor(rawId);
    return corridor ? { kind: 'corridor', corridor } : null;
  }

  function emitClick(resolved) {
    const handlers =
      resolved.kind === 'provider' ? providerHandlers : corridorHandlers;
    for (const fn of handlers) {
      try {
        fn(
          resolved.kind === 'provider' ? resolved.provider : resolved.corridor,
        );
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
          const resolved = resolveFromPicked(picked);
          if (resolved) emitClick(resolved);
        } catch {
          /* ignore pick errors */
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      clickHandler = handler;
    } catch {
      clickHandler = null;
    }
  }

  function onProviderClick(fn) {
    if (typeof fn === 'function') providerHandlers.add(fn);
    ensureClickWiring();
    return () => providerHandlers.delete(fn);
  }

  function onCorridorClick(fn) {
    if (typeof fn === 'function') corridorHandlers.add(fn);
    ensureClickWiring();
    return () => corridorHandlers.delete(fn);
  }

  /** Remove every entity and click wiring. */
  function destroy() {
    if (hasViewer()) {
      for (const record of byId.values()) {
        try {
          for (const entity of Object.values(record.entities || {})) {
            viewer.entities.remove(entity || { id: record.id });
          }
        } catch {
          /* ignore */
        }
      }
    }
    byId.clear();
    providerHandlers.clear();
    corridorHandlers.clear();
    try {
      if (clickHandler && typeof clickHandler.destroy === 'function') {
        clickHandler.destroy();
      }
    } catch {
      /* ignore */
    }
    clickHandler = null;
    try {
      if (typeof window !== 'undefined' && window.__gevCorridorMap === api) {
        delete window.__gevCorridorMap;
      }
    } catch {
      /* ignore */
    }
  }

  const api = {
    refresh,
    flyToProvider,
    flyToCorridor,
    setVisible,
    destroy,
    onProviderClick,
    onCorridorClick,
    // Debug/testing hooks (not part of the public UI contract).
    _count: () => byId.size,
    _pick: (picked) => {
      const resolved = resolveFromPicked(picked);
      if (resolved) emitClick(resolved);
      return resolved;
    },
  };

  try {
    if (typeof window !== 'undefined') {
      window.__gevCorridorMap = api;
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
