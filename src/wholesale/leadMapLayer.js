/**
 * Wholesale lead map layer — Cesium lead pins for GOD'S EYE VIEW.
 *
 * $0, no API keys. Draws one marker per wholesale lead, colored by the
 * deal-engine score (green ≥ 70, yellow 40–69, red < 40, gray when not
 * scored yet). Leads with status dead/closed are excluded.
 *
 * NOTE: this module imports Cesium as an ES module (matching the rest of
 * the app). It NEVER sniffs window.Cesium — that global does not exist in
 * this build.
 *
 * Usage:
 *   const layer = initLeadMapLayer({ viewer, leadStore, dealEngine });
 *   layer.refresh();
 *   layer.onLeadClick((lead) => openDealPanel(lead));
 */

import * as Cesium from 'cesium';

const ENTITY_ID_PREFIX = 'gev-lead-';

const COLORS = {
  scored_high: Cesium.Color.fromCssColorString('#22c55e'), // green ≥ 70
  scored_mid: Cesium.Color.fromCssColorString('#eab308'), // yellow 40–69
  scored_low: Cesium.Color.fromCssColorString('#ef4444'), // red < 40
  unscored: Cesium.Color.fromCssColorString('#9ca3af'), // dim gray
};

export const LEAD_SCORE_COLORS = {
  /** Return the css color string for a score (null = unscored). */
  cssFor(score) {
    if (score === null || score === undefined || Number.isNaN(Number(score))) {
      return '#9ca3af';
    }
    const n = Number(score);
    if (n >= 70) return '#22c55e';
    if (n >= 40) return '#eab308';
    return '#ef4444';
  },
};

const HIDDEN_STATUSES = new Set(['dead', 'closed', 'deadlead', 'archived']);

/** A lead has usable coordinates only when lat/lng are present and numeric. */
function hasCoords(lead) {
  if (!lead) return false;
  for (const key of ['lat', 'lng']) {
    const v = lead[key];
    if (v === null || v === undefined || v === '') return false;
    const n = Number(v);
    if (!Number.isFinite(n)) return false;
  }
  return true;
}

function readLeads(leadStore) {
  try {
    if (!leadStore) return [];
    if (Array.isArray(leadStore)) return leadStore;
    if (Array.isArray(leadStore.leads)) return leadStore.leads;
    if (typeof leadStore.listLeads === 'function') {
      const out = leadStore.listLeads();
      return Array.isArray(out) ? out : [];
    }
    return [];
  } catch {
    return [];
  }
}

function leadVisible(lead) {
  if (!lead) return false;
  const status = String(lead.status || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  if (HIDDEN_STATUSES.has(status)) return false;
  return true;
}

function leadScore(lead, dealEngine) {
  try {
    if (dealEngine && typeof dealEngine.scoreLead === 'function') {
      const s = dealEngine.scoreLead(lead);
      if (s !== null && s !== undefined && s !== '') return Number(s);
    }
  } catch {
    /* fall through to lead.score */
  }
  if (
    lead &&
    lead.score !== null &&
    lead.score !== undefined &&
    lead.score !== ''
  ) {
    const n = Number(lead.score);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function colorForScore(score) {
  const css = LEAD_SCORE_COLORS.cssFor(score);
  if (css === '#22c55e') return COLORS.scored_high;
  if (css === '#eab308') return COLORS.scored_mid;
  if (css === '#ef4444') return COLORS.scored_low;
  return COLORS.unscored;
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

/**
 * Init the wholesale lead pin layer.
 *
 * @param {object} opts
 * @param {object} opts.viewer     — Cesium viewer (required for pins).
 * @param {object|array} opts.leadStore — leads array, { leads }, or { listLeads() }.
 * @param {object} [opts.dealEngine]    — optional { scoreLead(lead) }.
 * @param {object} [opts.signal]        — optional abort/cleanup signal.
 * @returns {{ refresh(), flyToLead(id), setVisible(bool), destroy(), onLeadClick(fn) }}
 */
export function initLeadMapLayer(opts = {}) {
  const viewer = opts.viewer || null;
  const leadStore = opts.leadStore || null;
  const dealEngine = opts.dealEngine || null;

  const byId = new Map(); // lead id → { entityId, lead }
  const clickHandlers = new Set();
  let clickHandler = null;
  let visible = true;

  const hasViewer = () =>
    !!viewer && !!viewer.entities && typeof viewer.entities.add === 'function';

  function entityIdFor(leadId) {
    return `${ENTITY_ID_PREFIX}${leadId}`;
  }

  function makeEntityDef(lead, score) {
    const color = colorForScore(score);
    const def = {
      id: entityIdFor(String(lead.id)),
      position: Cesium.Cartesian3.fromDegrees(
        Number(lead.lng),
        Number(lead.lat),
      ),
      properties: { leadId: lead.id },
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
    const labelText = lead.address || lead.owner || `#${lead.id}`;
    def.label = {
      text: String(labelText),
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

  /** Rebuild pins from the store: dedupe by lead id, drop stale entities. */
  function refresh() {
    if (!hasViewer()) return { added: 0, updated: 0, removed: 0 };
    const leads = readLeads(leadStore);
    const seen = new Set();
    let added = 0;
    let updated = 0;
    for (const lead of leads) {
      if (!leadVisible(lead)) continue;
      if (!hasCoords(lead)) continue;
      const lat = Number(lead.lat);
      const lng = Number(lead.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const key = String(lead.id);
      if (seen.has(key)) continue; // dedupe within the store
      seen.add(key);
      const score = leadScore(lead, dealEngine);
      const existing = byId.get(key);
      if (existing) {
        // Update score/color in place when the engine rescored.
        if (existing.score !== score && existing.entity) {
          existing.score = score;
          applyColor(existing.entity, score);
          updated += 1;
        }
        continue;
      }
      try {
        const entity = viewer.entities.add(makeEntityDef(lead, score));
        byId.set(key, { entityId: entityIdFor(key), lead, score, entity });
        added += 1;
      } catch {
        /* entity creation failed — skip this lead */
      }
    }
    // Remove stale entities (no longer in store or newly hidden).
    let removed = 0;
    for (const [key, record] of Array.from(byId)) {
      if (!seen.has(key)) {
        try {
          viewer.entities.remove(record.entity || { id: record.entityId });
        } catch {
          /* ignore */
        }
        byId.delete(key);
        removed += 1;
      }
    }
    return { added, updated, removed };
  }

  function applyColor(entity, score) {
    try {
      const color = colorForScore(score);
      if (entity.billboard) entity.billboard.color = color;
      if (entity.point) entity.point.color = color;
    } catch {
      /* ignore */
    }
  }

  /** Fly the camera to a lead's coordinates. */
  function flyToLead(id) {
    if (!viewer || !viewer.camera) return false;
    const record = byId.get(String(id));
    let candidate = record ? record.lead : null;
    if (!candidate) {
      candidate =
        readLeads(leadStore).find((l) => String(l.id) === String(id)) || null;
    }
    if (!hasCoords(candidate)) return false;
    const lat = Number(candidate.lat);
    const lng = Number(candidate.lng);
    try {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, 1200),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Show/hide all lead pins. */
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

  function resolveLeadFromPicked(picked) {
    if (!picked || !picked.id) return null;
    let entityId = picked.id;
    if (typeof entityId === 'object') {
      // picked.id may be the entity object itself.
      entityId = entityId.id || null;
    }
    if (!entityId || !String(entityId).startsWith(ENTITY_ID_PREFIX))
      return null;
    const key = String(entityId).slice(ENTITY_ID_PREFIX.length);
    const record = byId.get(key);
    return record ? record.lead : null;
  }

  function emitClick(lead) {
    for (const fn of clickHandlers) {
      try {
        fn(lead);
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
          const lead = resolveLeadFromPicked(picked);
          if (lead) emitClick(lead);
        } catch {
          /* ignore pick errors */
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      clickHandler = handler;
    } catch {
      clickHandler = null;
    }
  }

  /** Register a lead-click callback. */
  function onLeadClick(fn) {
    if (typeof fn === 'function') clickHandlers.add(fn);
    ensureClickWiring();
    return () => clickHandlers.delete(fn);
  }

  /** Remove every entity and click wiring. */
  function destroy() {
    if (hasViewer()) {
      for (const { entity, entityId } of byId.values()) {
        try {
          viewer.entities.remove(entity || { id: entityId });
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
      if (typeof window !== 'undefined' && window.__gevLeadMap === api) {
        delete window.__gevLeadMap;
      }
    } catch {
      /* ignore */
    }
  }

  const api = {
    refresh,
    flyToLead,
    setVisible,
    destroy,
    onLeadClick,
    // Debug/testing hooks (not part of the public UI contract).
    _count: () => byId.size,
    _storeSwap: (next) => {
      // Test hook: replace the store without re-init.
      if (Array.isArray(next)) {
        if (Array.isArray(leadStore)) {
          leadStore.length = 0;
          leadStore.push(...next);
        } else if (leadStore && Array.isArray(leadStore.leads)) {
          leadStore.leads = next;
        }
      }
    },
    _pick: (picked) => {
      const lead = resolveLeadFromPicked(picked);
      if (lead) emitClick(lead);
      return lead;
    },
  };

  try {
    if (typeof window !== 'undefined') {
      window.__gevLeadMap = api;
    }
  } catch {
    /* non-browser runtimes */
  }

  return api;
}
