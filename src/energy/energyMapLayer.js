/**
 * Energy map layer — Cuban receiving-port pins for GOD'S EYE VIEW.
 *
 * $0, no API keys. Renders the four static Cuban receiving ports
 * (Mariel, Havana, Santiago de Cuba, Cienfuegos) as labeled pins.
 * Coordinates are static published-port reference data — never live vessel
 * positions. No hover-only interactions: every port is a tappable pin with
 * an always-visible ≥15px label and a LEFT_CLICK handler.
 *
 * NOTE: this module imports Cesium as an ES module (matching the rest of
 * the app). It NEVER sniffs window.Cesium — that global does not exist in
 * this build.
 *
 * Usage:
 *   const layer = initEnergyPortLayer({ viewer, ports });
 *   layer.refresh();
 *   layer.onPortClick((port) => openPortPanel(port));
 */

import * as Cesium from 'cesium';

const ENTITY_ID_PREFIX = 'gev-energy-port-';

/** Port pin color: fuel-receiving reference (amber). */
export const PORT_PIN_COLOR = '#f59e0b';

export function entityIdForPort(portId) {
  return `${ENTITY_ID_PREFIX}${portId}`;
}

function finiteNumber(v) {
  if (v === null || v === undefined || v === '') return false;
  return Number.isFinite(Number(v));
}

/** A port renders only when it has finite coordinates. Never invent a pin. */
export function hasPortCoords(port) {
  if (!port) return false;
  return finiteNumber(port.lat) && finiteNumber(port.lng);
}

function portLabel(port, lang = 'es') {
  if (port && port.name && (port.name[lang] || port.name.es)) {
    return port.name[lang] || port.name.es;
  }
  return String(port?.id ?? 'port');
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
    properties: { portId: null, kind: 'fuel-port' },
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
  // Labels are always visible and ≥15px — no hover-only interactions.
  def.label = {
    text: String(label),
    font: '16px sans-serif',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 2,
    pixelOffset: new Cesium.Cartesian2(0, image ? -52 : -18),
    showBackground: true,
    backgroundColor: new Cesium.Color(0, 0, 0, 0.55),
  };
  return def;
}

function resolvePortFromPicked(picked, byId) {
  if (!picked || !picked.id) return null;
  let entityId = picked.id;
  if (typeof entityId === 'object') entityId = entityId.id || null;
  if (!entityId) return null;
  const s = String(entityId);
  if (!s.startsWith(ENTITY_ID_PREFIX)) return null;
  const key = s.slice(ENTITY_ID_PREFIX.length);
  const record = byId.get(key);
  return record ? record.port : null;
}

/**
 * Init the energy port map layer.
 *
 * @param {object} opts
 * @param {object} opts.viewer — Cesium viewer (required for entities).
 * @param {array}  opts.ports  — [{ id, name:{es,en}, lat, lng, note }] or a
 *                               store-shaped { getPorts() } / { ports }.
 * @param {string} [opts.lang] — label language ('es' default).
 * @param {object} [opts.signal] — optional abort/cleanup signal.
 * @returns {{ refresh(), setVisible(bool), destroy(), onPortClick(fn) }}
 */
export function initEnergyPortLayer(opts = {}) {
  const viewer = opts.viewer || null;
  const signal = opts.signal || null;
  let lang = opts.lang === 'en' ? 'en' : 'es';

  const byId = new Map(); // port id → { entity, port }
  const clickHandlers = new Set();
  let clickHandler = null;
  let visible = true;

  const hasViewer = () =>
    !!viewer && !!viewer.entities && typeof viewer.entities.add === 'function';

  function readPorts() {
    const src = opts.ports;
    try {
      if (Array.isArray(src)) return src;
      if (src && typeof src.getPorts === 'function') return src.getPorts() || [];
      if (src && Array.isArray(src.ports)) return src.ports;
    } catch {
      /* fall through */
    }
    return [];
  }

  /** Rebuild pins from the port list: dedupe by id, drop stale. */
  function refresh() {
    if (!hasViewer()) return { added: 0, removed: 0 };
    const seen = new Set();
    let added = 0;
    for (const port of readPorts()) {
      if (!hasPortCoords(port)) continue; // never invent a pin
      const key = String(port.id);
      if (seen.has(key)) continue;
      seen.add(key);
      if (byId.has(key)) continue;
      try {
        const color = Cesium.Color.fromCssColorString(PORT_PIN_COLOR);
        const def = makePinDef({
          id: entityIdForPort(key),
          lat: Number(port.lat),
          lng: Number(port.lng),
          label: portLabel(port, lang),
          color,
          visible,
        });
        def.properties = { portId: port.id, kind: 'fuel-port' };
        const entity = viewer.entities.add(def);
        byId.set(key, { entity, port });
        added += 1;
      } catch {
        /* entity creation failed — skip this port */
      }
    }
    let removed = 0;
    for (const [key, record] of Array.from(byId)) {
      if (!seen.has(key)) {
        try {
          viewer.entities.remove(record.entity || { id: entityIdForPort(key) });
        } catch {
          /* ignore */
        }
        byId.delete(key);
        removed += 1;
      }
    }
    return { added, removed };
  }

  /** Show/hide all port pins. */
  function setVisible(next) {
    visible = !!next;
    for (const { entity } of byId.values()) {
      try {
        if (entity) entity.show = visible;
      } catch {
        /* ignore */
      }
    }
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'es';
  }

  function emitClick(port) {
    for (const fn of clickHandlers) {
      try {
        fn(port);
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
          const port = resolvePortFromPicked(picked, byId);
          if (port) emitClick(port);
        } catch {
          /* ignore pick errors */
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      clickHandler = handler;
    } catch {
      clickHandler = null;
    }
  }

  /** Register a port-click callback. */
  function onPortClick(fn) {
    if (typeof fn === 'function') clickHandlers.add(fn);
    ensureClickWiring();
    return () => clickHandlers.delete(fn);
  }

  /** Remove every entity and click wiring. */
  function destroy() {
    if (hasViewer()) {
      for (const record of byId.values()) {
        try {
          viewer.entities.remove(record.entity || { id: 'unknown' });
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
      if (typeof window !== 'undefined' && window.__gevEnergyPorts === api) {
        delete window.__gevEnergyPorts;
      }
    } catch {
      /* non-browser runtimes */
    }
  }

  const api = {
    refresh,
    setVisible,
    setLang,
    destroy,
    onPortClick,
    _count: () => byId.size,
    _pick: (picked) => {
      const port = resolvePortFromPicked(picked, byId);
      if (port) emitClick(port);
      return port;
    },
  };

  try {
    if (typeof window !== 'undefined') {
      window.__gevEnergyPorts = api;
    }
  } catch {
    /* non-browser runtimes */
  }

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
