/**
 * Cuba market map layer — Cesium pins for the major Cuban receiving ports.
 *
 * $0, no API keys. Draws one pin per Cuban receiving port with a 15px+
 * label (readable on phone viewports). Port coordinates are real public
 * geography; no business records are invented or rendered from thin air.
 *
 * NOTE: this module imports Cesium as an ES module (matching the rest of
 * the app). It NEVER sniffs window.Cesium — that global does not exist in
 * this build.
 *
 * Usage:
 *   const layer = initCubaMapLayer({ viewer });
 *   layer.refresh();
 *   layer.flyToPort('mariel');
 *   layer.onPortClick((port) => openSomething(port));
 */

import * as Cesium from 'cesium';

const ENTITY_ID_PREFIX = 'gev-cuba-port-';
const LABEL_FONT = '15px sans-serif'; // readability floor: labels >= 15px

// Real Cuban receiving ports. Coordinates are public geographic facts
// (port anchorages), NOT business data. Used by the sourcing-request
// intake as the destination-port reference.
export const CUBA_PORTS = Object.freeze([
  {
    id: 'mariel',
    name: { es: 'Puerto de Mariel', en: 'Port of Mariel' },
    lat: 23.0186,
    lng: -82.755,
  },
  {
    id: 'la-habana',
    name: { es: 'Puerto de La Habana', en: 'Port of Havana' },
    lat: 23.137,
    lng: -82.355,
  },
  {
    id: 'santiago',
    name: { es: 'Puerto de Santiago de Cuba', en: 'Port of Santiago de Cuba' },
    lat: 20.011,
    lng: -75.83,
  },
  {
    id: 'cienfuegos',
    name: { es: 'Puerto de Cienfuegos', en: 'Port of Cienfuegos' },
    lat: 22.145,
    lng: -80.454,
  },
]);

const PORT_COLOR = '#38bdf8';

export function portColor() {
  return PORT_COLOR;
}

function finiteNumber(v) {
  if (v === null || v === undefined || v === '') return false;
  return Number.isFinite(Number(v));
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

function makePinDef({ id, lat, lng, label, visible }) {
  const color = Cesium.Color.fromCssColorString(PORT_COLOR);
  const def = {
    id,
    position: Cesium.Cartesian3.fromDegrees(Number(lng), Number(lat)),
    properties: { cubaPortId: id.replace(ENTITY_ID_PREFIX, ''), kind: 'port' },
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
    font: LABEL_FONT,
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 2,
    pixelOffset: new Cesium.Cartesian2(0, image ? -52 : -18),
    showBackground: true,
    backgroundColor: new Cesium.Color(0, 0, 0, 0.55),
  };
  return def;
}

/**
 * Init the Cuba port map layer.
 *
 * @param {object} opts
 * @param {object} opts.viewer — Cesium viewer (required for entities).
 * @param {string} [opts.lang] — label language: 'es' (default) or 'en'.
 * @param {object} [opts.signal] — optional abort/cleanup signal.
 * @returns {{ refresh(), setVisible(bool), destroy(), flyToPort(id), onPortClick(fn), _count() }}
 */
export function initCubaMapLayer(opts = {}) {
  const viewer = opts.viewer || null;
  const lang = opts.lang === 'en' ? 'en' : 'es';
  const signal = opts.signal || null;

  const byId = new Map(); // port id → { entity, port }
  const clickHandlers = new Set();
  let clickHandler = null;
  let visible = true;

  const hasViewer = () =>
    !!viewer && !!viewer.entities && typeof viewer.entities.add === 'function';

  function entityIdFor(portId) {
    return `${ENTITY_ID_PREFIX}${portId}`;
  }

  function portLabel(port) {
    return lang === 'en' ? port.name.en : port.name.es;
  }

  function addPort(port) {
    if (!finiteNumber(port.lat) || !finiteNumber(port.lng)) return false;
    const key = String(port.id);
    if (byId.has(key)) return false;
    const def = makePinDef({
      id: entityIdFor(key),
      lat: Number(port.lat),
      lng: Number(port.lng),
      label: portLabel(port),
      visible,
    });
    try {
      const entity = viewer.entities.add(def);
      byId.set(key, { entity, port });
      return true;
    } catch {
      return false;
    }
  }

  /** Rebuild port pins: dedupe by port id, drop stale. */
  function refresh() {
    if (!hasViewer()) return { added: 0, removed: 0 };
    let added = 0;
    for (const port of CUBA_PORTS) {
      if (addPort(port)) added += 1;
    }
    const wanted = new Set(CUBA_PORTS.map((p) => String(p.id)));
    let removed = 0;
    for (const [key, record] of Array.from(byId)) {
      if (!wanted.has(key)) {
        try {
          viewer.entities.remove(record.entity);
        } catch {
          /* ignore */
        }
        byId.delete(key);
        removed += 1;
      }
    }
    return { added, removed };
  }

  function findPort(id) {
    return (
      CUBA_PORTS.find((p) => String(p.id) === String(id)) || null
    );
  }

  /** Fly the camera to a Cuban port. */
  function flyToPort(id) {
    if (!viewer || !viewer.camera) return false;
    const port = findPort(id);
    if (!port || !finiteNumber(port.lat) || !finiteNumber(port.lng)) {
      return false;
    }
    try {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          Number(port.lng),
          Number(port.lat),
          250000,
        ),
      });
      return true;
    } catch {
      return false;
    }
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

  function resolvePortFromPicked(picked) {
    if (!picked || !picked.id) return null;
    let entityId = picked.id;
    if (typeof entityId === 'object') {
      entityId = entityId.id || null;
    }
    if (!entityId) return null;
    const s = String(entityId);
    if (!s.startsWith(ENTITY_ID_PREFIX)) return null;
    const key = s.slice(ENTITY_ID_PREFIX.length);
    const record = byId.get(key);
    return record ? record.port : null;
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
          const port = resolvePortFromPicked(picked);
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

  /** Register a port-click callback (tap a pin to act on it — no hover-only). */
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
          viewer.entities.remove(record.entity);
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
      if (typeof window !== 'undefined' && window.__gevCubaMap === api) {
        delete window.__gevCubaMap;
      }
    } catch {
      /* ignore */
    }
  }

  const api = {
    refresh,
    flyToPort,
    setVisible,
    destroy,
    onPortClick,
    ports: () => CUBA_PORTS.map((p) => ({ ...p, name: { ...p.name } })),
    // Debug/testing hooks (not part of the public UI contract).
    _count: () => byId.size,
    _pick: (picked) => {
      const port = resolvePortFromPicked(picked);
      if (port) emitClick(port);
      return port;
    },
  };

  try {
    if (typeof window !== 'undefined') {
      window.__gevCubaMap = api;
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
