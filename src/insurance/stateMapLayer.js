/**
 * Insurance state map layer for GOD'S EYE VIEW — $0, no API keys, no external calls.
 *
 * One point + label per US state + DC (51 total), colored from the user's
 * OWN insurance data: red = has coverage gaps, amber = a renewal within
 * 30 days, green = all active, gray = no data for that state.
 *
 * ---------------------------------------------------------------------------
 * APPROXIMATE CENTROIDS — VISUALIZATION ONLY. These are rough geographic
 * centers used only to place a status dot per state on the globe. They are
 * NOT survey-grade coordinates and must never be used for navigation,
 * mapping, or legal purposes.
 * ---------------------------------------------------------------------------
 *
 * NOTE: imports Cesium as an ES module (matching the rest of the app).
 * It NEVER sniffs window.Cesium — that global does not exist in this build.
 *
 * Usage:
 *   const layer = initStateMapLayer({ viewer, store, engine });
 *   layer.refresh();
 *   layer.onStateClick((code, summary) => ...);
 */

import * as Cesium from 'cesium';

const ENTITY_ID_PREFIX = 'gev-ins-state-';

/** Approximate state centroids [lat, lon] — visualization only (see note above). */
export const STATE_CENTROIDS = {
  AL: [32.8, -86.8],
  AK: [61.4, -152.3],
  AZ: [33.7, -111.5],
  AR: [34.8, -92.3],
  CA: [36.1, -119.7],
  CO: [39.0, -105.5],
  CT: [41.6, -72.7],
  DE: [39.3, -75.5],
  DC: [38.9, -77.0],
  FL: [27.8, -81.7],
  GA: [32.9, -83.1],
  HI: [21.1, -157.0],
  ID: [44.2, -114.5],
  IL: [40.3, -89.2],
  IN: [39.8, -86.1],
  IA: [42.0, -93.5],
  KS: [38.5, -98.4],
  KY: [37.5, -85.3],
  LA: [31.0, -92.0],
  ME: [45.4, -69.4],
  MD: [39.0, -76.8],
  MA: [42.2, -71.4],
  MI: [44.3, -84.5],
  MN: [46.3, -94.2],
  MS: [32.7, -89.6],
  MO: [38.4, -92.5],
  MT: [46.9, -110.0],
  NE: [41.1, -99.9],
  NV: [38.3, -116.8],
  NH: [43.5, -71.5],
  NJ: [40.3, -74.5],
  NM: [34.8, -106.2],
  NY: [42.2, -74.9],
  NC: [35.6, -79.5],
  ND: [47.5, -100.5],
  OH: [40.4, -82.9],
  OK: [35.6, -97.5],
  OR: [44.6, -120.5],
  PA: [41.0, -77.5],
  RI: [41.7, -71.5],
  SC: [33.8, -80.9],
  SD: [44.3, -100.2],
  TN: [35.7, -86.7],
  TX: [31.0, -100.0],
  UT: [39.4, -111.6],
  VT: [44.0, -72.7],
  VA: [37.9, -78.0],
  WA: [47.4, -120.6],
  WV: [39.0, -80.5],
  WI: [44.3, -89.5],
  WY: [43.0, -107.5],
};

export const STATE_HEALTH_COLORS = {
  red: '#ef4444', // coverage gaps
  amber: '#f59e0b', // renewal within 30 days
  green: '#22c55e', // all active
  gray: '#9ca3af', // no data
};

export const STATE_NAMES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

function healthColor(health) {
  return Cesium.Color.fromCssColorString(
    STATE_HEALTH_COLORS[health] || STATE_HEALTH_COLORS.gray,
  );
}

/**
 * Small per-state summary from a rollup bucket. Exported for unit tests.
 */
export function stateSummary(code, bucket = {}, lang = 'es') {
  const health =
    bucket.gaps > 0
      ? 'red'
      : bucket.expiring > 0
        ? 'amber'
        : bucket.active > 0
          ? 'green'
          : 'gray';
  const L = lang === 'es';
  const parts = [];
  if (bucket.gaps > 0)
    parts.push(L ? `${bucket.gaps} brechas` : `${bucket.gaps} gaps`);
  if (bucket.expiring > 0)
    parts.push(
      L ? `${bucket.expiring} renovaciones` : `${bucket.expiring} renewals`,
    );
  if (bucket.active > 0)
    parts.push(L ? `${bucket.active} activas` : `${bucket.active} active`);
  return {
    code,
    name: STATE_NAMES[code] || code,
    health,
    gaps: bucket.gaps || 0,
    active: bucket.active || 0,
    expiring: bucket.expiring || 0,
    text: parts.length ? parts.join(' · ') : L ? 'Sin datos' : 'No data',
  };
}

export function initStateMapLayer(first = null, second = {}) {
  // Accept both initStateMapLayer(viewer, { store, engine }) and
  // initStateMapLayer({ viewer, store, engine }).
  let viewer = null;
  let opts = {};
  if (
    first &&
    typeof first === 'object' &&
    ('entities' in first || 'scene' in first || 'camera' in first)
  ) {
    viewer = first;
    opts = second && typeof second === 'object' ? second : {};
  } else if (first && typeof first === 'object') {
    opts = first;
    viewer = opts.viewer ?? null;
  }
  const {
    store = null,
    engine = null,
    signal = null,
    onStateClick = null,
  } = opts;
  const byCode = new Map(); // code -> entityId
  const clickHandlers = new Set();
  let clickHandler = null;
  let summaryEl = null;
  let lang = 'es';
  const aborted = { current: false };
  signal?.addEventListener?.(
    'abort',
    () => {
      aborted.current = true;
    },
    { once: true },
  );
  if (typeof onStateClick === 'function') clickHandlers.add(onStateClick);

  const hasViewer = () =>
    viewer && viewer.entities && typeof viewer.entities.add === 'function';

  function readRollup() {
    try {
      const state = store?.getState() || null;
      if (!state || !engine) return {};
      return engine.stateRollup(state.businesses || {}) || {};
    } catch {
      return {};
    }
  }

  function ensureEntities() {
    if (!hasViewer()) return;
    const rollup = readRollup();
    for (const [code, [lat, lon]] of Object.entries(STATE_CENTROIDS)) {
      if (byCode.has(code)) continue;
      const summary = stateSummary(code, rollup[code]);
      const entityId = ENTITY_ID_PREFIX + code;
      try {
        viewer.entities.add({
          id: entityId,
          name: `Insurance · ${code}`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          point: {
            pixelSize: 14,
            color: healthColor(summary.health),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
          },
          label: {
            text: code,
            font: 'bold 13px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -18),
          },
        });
        byCode.set(code, entityId);
      } catch {
        /* entity creation is best-effort */
      }
    }
  }

  /** Re-read the store and recolor all 51 state entities. */
  function refresh() {
    if (aborted.current) return;
    ensureEntities();
    if (!hasViewer()) return;
    const rollup = readRollup();
    for (const [code, entityId] of byCode) {
      const summary = stateSummary(code, rollup[code]);
      try {
        const entity = viewer.entities.getById
          ? viewer.entities.getById(entityId)
          : null;
        if (entity && entity.point) {
          entity.point.color = healthColor(summary.health);
        }
      } catch {
        /* noop */
      }
    }
  }

  function flyToState(code) {
    const c = STATE_CENTROIDS[code];
    if (!c || !viewer?.camera?.flyTo) return false;
    const [lat, lon] = c;
    try {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 2200000),
        duration: 1.6,
      });
      return true;
    } catch {
      return false;
    }
  }

  function showSummary(code) {
    const summary = stateSummary(code, readRollup()[code], lang);
    hideSummary();
    if (typeof document === 'undefined') return summary;
    summaryEl = document.createElement('div');
    summaryEl.id = 'gev-ins-state-summary';
    summaryEl.style.cssText =
      'position:fixed;z-index:70;left:12px;bottom:12px;max-width:min(340px,calc(100vw - 24px));' +
      'background:rgba(8,11,18,.95);border:1px solid rgba(52,211,153,.35);border-radius:14px;' +
      'padding:12px 14px;color:#eef2f7;font-family:inherit;font-size:13px';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:800;color:#34d399;margin-bottom:4px';
    title.textContent = `🛡️ ${summary.name} (${summary.code})`;
    const body = document.createElement('div');
    body.textContent = summary.text;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    close.style.cssText =
      'margin-top:8px;min-height:44px;min-width:44px;border-radius:10px;border:1px solid rgba(255,255,255,.25);' +
      'background:none;color:#fff;font-size:14px;cursor:pointer';
    close.addEventListener('click', hideSummary);
    summaryEl.appendChild(title);
    summaryEl.appendChild(body);
    summaryEl.appendChild(close);
    document.body.appendChild(summaryEl);
    return summary;
  }

  function hideSummary() {
    try {
      summaryEl?.remove();
    } catch {
      /* noop */
    }
    summaryEl = null;
  }

  function handleStateClick(code) {
    if (!STATE_CENTROIDS[code]) return null;
    flyToState(code);
    const summary = showSummary(code);
    for (const fn of clickHandlers) {
      try {
        fn(code, summary);
      } catch {
        /* ignore handler errors */
      }
    }
    return summary;
  }

  function resolveCodeFromPicked(picked) {
    try {
      const entity = picked?.id || picked;
      const id = typeof entity === 'string' ? entity : entity?.id;
      if (typeof id === 'string' && id.startsWith(ENTITY_ID_PREFIX)) {
        return id.slice(ENTITY_ID_PREFIX.length);
      }
    } catch {
      /* noop */
    }
    return null;
  }

  function ensureClickWiring() {
    if (clickHandler || !viewer?.scene?.canvas) return;
    try {
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement) => {
        try {
          const picked = viewer.scene.pick(movement.position);
          const code = resolveCodeFromPicked(picked);
          if (code) handleStateClick(code);
        } catch {
          /* ignore pick errors */
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      clickHandler = handler;
    } catch {
      clickHandler = null;
    }
  }

  function onStateClickFn(fn) {
    if (typeof fn === 'function') clickHandlers.add(fn);
    ensureClickWiring();
    return () => clickHandlers.delete(fn);
  }

  function setVisible(visible) {
    if (!hasViewer()) return;
    for (const entityId of byCode.values()) {
      try {
        const entity = viewer.entities.getById?.(entityId);
        if (entity) entity.show = visible !== false;
      } catch {
        /* noop */
      }
    }
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'es';
    return lang;
  }

  function destroy() {
    if (hasViewer()) {
      for (const entityId of byCode.values()) {
        try {
          viewer.entities.remove({ id: entityId });
        } catch {
          /* ignore */
        }
      }
    }
    byCode.clear();
    clickHandlers.clear();
    hideSummary();
    try {
      clickHandler?.destroy?.();
    } catch {
      /* ignore */
    }
    clickHandler = null;
    try {
      if (typeof window !== 'undefined' && window.__gevInsStateMap === api) {
        delete window.__gevInsStateMap;
      }
    } catch {
      /* non-browser runtimes */
    }
  }

  ensureClickWiring();

  const api = {
    refresh,
    flyToState,
    setVisible,
    setLang,
    destroy,
    onStateClick: onStateClickFn,
    stateSummary: (code) => stateSummary(code, readRollup()[code], lang),
    // Debug/testing hooks (not part of the public UI contract).
    _count: () => byCode.size,
    _codes: () => [...byCode.keys()],
    _pick: (picked) => {
      const code = resolveCodeFromPicked(picked);
      return code ? handleStateClick(code) : null;
    },
  };

  try {
    if (typeof window !== 'undefined') window.__gevInsStateMap = api;
  } catch {
    /* non-browser runtimes */
  }

  return api;
}
