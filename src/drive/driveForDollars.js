/**
 * Driver for Dollars — wholesaling mode for GOD'S EYE VIEW.
 *
 * $0, no API keys. While Juan drives a neighborhood, the app records the
 * GPS route, lets him drop pins on distressed properties (condition, notes,
 * photo, reverse-geocoded address via free Nominatim), and exports CSV/JSON
 * shaped for the Vacant Property Scanner's importer.
 *
 * Pure helpers (haversine, CSV, reverse-geocode, storage codec) are exported
 * for unit tests; the live GPS/Cesium/DOM wiring lives in
 * initDriveForDollars().
 */
import * as Cesium from 'cesium';

const STORAGE_KEY = 'sahjony.d4d.v1';
const REVERSE_GEOCODE_MIN_INTERVAL_MS = 1200;
const MAX_GPS_ACCURACY_M = 60;

/** Condition options, bilingual labels. */
export const PROPERTY_CONDITIONS = [
  { id: 'vacant', es: 'Vacía', en: 'Vacant' },
  { id: 'boarded', es: 'Tapiada', en: 'Boarded up' },
  { id: 'overgrown', es: 'Descuidada / monte alto', en: 'Overgrown' },
  { id: 'fire-damaged', es: 'Dañada por fuego', en: 'Fire damaged' },
  { id: 'roof-damage', es: 'Techo dañado', en: 'Roof damage' },
  { id: 'for-sale-by-owner', es: 'Venta por dueño', en: 'For sale by owner' },
  { id: 'other', es: 'Otra', en: 'Other' },
];
// Default UI language for drive-mode labels (Spanish-first, like the app).
const UI_LANG = 'es';

export function conditionLabel(id, lang = UI_LANG) {
  const found = PROPERTY_CONDITIONS.find((c) => c.id === id);
  if (!found) return id;
  return lang === 'en' ? found.en : found.es;
}

/** Great-circle distance in meters between two lat/lng points. */
export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Sum of segment distances over [{lat,lng}...] in meters. */
export function routeDistanceM(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineM(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng,
    );
  }
  return total;
}

let lastReverseAt = 0;

/**
 * Free reverse geocode via Nominatim (no key). Best-effort: resolves to a
 * display address string or null. Throttled to respect the 1 req/s policy.
 * fetchImpl is injectable for tests.
 */
export async function reverseGeocode(lat, lng, fetchImpl = null) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return null;
  try {
    const wait = REVERSE_GEOCODE_MIN_INTERVAL_MS - (Date.now() - lastReverseAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastReverseAt = Date.now();
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${Number(lat).toFixed(6)}&lon=${Number(lng).toFixed(6)}` +
      `&zoom=18&addressdetails=1`;
    const res = await doFetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return typeof data?.display_name === 'string' ? data.display_name : null;
  } catch {
    return null;
  }
}

const CSV_HEADER = 'fecha,latitud,longitud,direccion,condicion,notas,foto';
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Properties → CSV shaped for the Vacant Property Scanner importer. */
export function propertiesToCsv(properties) {
  const lines = [CSV_HEADER];
  for (const p of properties || []) {
    lines.push(
      [
        csvCell(p.timestamp || ''),
        csvCell(p.lat ?? ''),
        csvCell(p.lng ?? ''),
        csvCell(p.address || ''),
        csvCell(p.condition || ''),
        csvCell((p.notes || '').replace(/[\r\n]+/g, ' ')),
        csvCell(p.photoName || ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** Storage codec (photos are session-only, never persisted). */
export function encodeStorage({ drives, properties }) {
  return JSON.stringify({
    v: 1,
    drives: (drives || []).map((d) => ({
      id: d.id,
      startedAt: d.startedAt,
      endedAt: d.endedAt || null,
      distanceM: Math.round(d.distanceM || 0),
      points: (d.points || []).map((p) => [p.lat, p.lng]),
    })),
    properties: (properties || []).map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      address: p.address || '',
      condition: p.condition || '',
      notes: p.notes || '',
      photoName: p.photoName || '',
      timestamp: p.timestamp || '',
    })),
  });
}

export function decodeStorage(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object')
      return { drives: [], properties: [] };
    return {
      drives: Array.isArray(data.drives) ? data.drives : [],
      properties: Array.isArray(data.properties) ? data.properties : [],
    };
  } catch {
    return { drives: [], properties: [] };
  }
}

function loadState() {
  try {
    if (typeof localStorage === 'undefined')
      return { drives: [], properties: [] };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { drives: [], properties: [] };
    return decodeStorage(raw);
  } catch {
    return { drives: [], properties: [] };
  }
}

function saveState(state) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, encodeStorage(state));
  } catch {
    /* quota or privacy mode — session continues in memory */
  }
}

export function driveFileName(kind, when = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `d4d-propiedades-${stamp}.${kind}`;
}

const D4D_CSS = `
#gev-drive-btn{display:flex;align-items:center;gap:8px;padding:10px 12px;margin-top:8px;background:rgba(10,14,22,.82);border:1px solid rgba(255,209,102,.28);border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.06em;min-width:172px;max-width:210px}
#gev-drive-btn:hover{border-color:rgba(255,209,102,.6)}
#gev-drive-btn.is-driving{border-color:#ff5d5d;box-shadow:0 0 0 3px rgba(255,93,93,.25)}
#gev-drive-btn .sv-emoji{font-size:20px}
#gev-drive-panel{position:fixed;z-index:60;left:12px;bottom:12px;width:min(360px,calc(100vw - 24px));max-height:min(520px,calc(100vh - 24px));background:rgba(8,11,18,.94);border:1px solid rgba(255,209,102,.3);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7}
#gev-drive-panel .d4d-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,209,102,.18)}
#gev-drive-panel .d4d-title{font-size:12px;font-weight:800;letter-spacing:.1em;color:#ffd166;flex:1}
#gev-drive-panel .d4d-close{background:none;border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:14px}
#gev-drive-panel .d4d-body{padding:10px 12px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
#gev-drive-panel .d4d-gps{font-size:11px;color:#9fb0c9}
#gev-drive-panel .d4d-gps.ok{color:#7dffa8}
#gev-drive-panel .d4d-gps.warn{color:#ffb35d}
#gev-drive-panel .d4d-stats{display:flex;gap:8px}
#gev-drive-panel .d4d-stat{flex:1;background:rgba(255,209,102,.07);border:1px solid rgba(255,209,102,.18);border-radius:10px;padding:8px;text-align:center}
#gev-drive-panel .d4d-stat .v{font-size:15px;font-weight:800;color:#ffd166}
#gev-drive-panel .d4d-stat .k{font-size:9px;letter-spacing:.1em;color:#9fb0c9;margin-top:2px}
#gev-drive-panel .d4d-actions{display:flex;gap:8px}
#gev-drive-panel .d4d-btn{flex:1;padding:11px 8px;border-radius:11px;border:1px solid rgba(255,209,102,.45);background:rgba(255,209,102,.14);color:#ffd166;font-weight:800;cursor:pointer;font-size:12px;font-family:inherit}
#gev-drive-panel .d4d-btn.stop{border-color:rgba(255,93,93,.5);background:rgba(255,93,93,.14);color:#ff8d8d}
#gev-drive-panel .d4d-btn:disabled{opacity:.4;cursor:default}
#gev-drive-panel .d4d-mark{padding:13px 8px;font-size:13px}
#gev-drive-panel .d4d-list{display:flex;flex-direction:column;gap:6px;max-height:150px;overflow-y:auto}
#gev-drive-panel .d4d-item{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px;font-size:11px}
#gev-drive-panel .d4d-item .addr{color:#eef2f7;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#gev-drive-panel .d4d-item .meta{color:#9fb0c9;margin-top:2px}
#gev-drive-panel .d4d-item .row{display:flex;gap:6px;margin-top:6px}
#gev-drive-panel .d4d-item .row button{flex:1;padding:6px;border-radius:8px;border:1px solid rgba(125,211,252,.35);background:rgba(125,211,252,.08);color:#bfe3ff;font-size:11px;cursor:pointer;font-family:inherit}
#gev-drive-panel .d4d-foot{display:flex;gap:8px}
#gev-drive-panel .d4d-foot button{flex:1;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:#dfe7f2;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit}
#gev-drive-panel .d4d-note{font-size:10px;color:#8a97ab}
#gev-drive-form{position:fixed;z-index:70;left:50%;top:50%;transform:translate(-50%,-50%);width:min(340px,calc(100vw - 32px));background:rgba(10,14,22,.97);border:1px solid rgba(255,209,102,.4);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px;font-family:inherit;color:#eef2f7;box-shadow:0 16px 50px rgba(0,0,0,.7)}
#gev-drive-form h3{margin:0;font-size:13px;letter-spacing:.08em;color:#ffd166}
#gev-drive-form .addr{font-size:11px;color:#9fb0c9}
#gev-drive-form label{font-size:10px;letter-spacing:.1em;color:#9fb0c9}
#gev-drive-form select,#gev-drive-form textarea{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:9px;color:#fff;padding:9px;font-size:12px;font-family:inherit}
#gev-drive-form textarea{min-height:64px;resize:vertical}
#gev-drive-form input[type=file]{font-size:11px;color:#c8d4e4}
#gev-drive-form .frow{display:flex;gap:8px}
#gev-drive-form .frow button{flex:1;padding:11px;border-radius:10px;font-weight:800;cursor:pointer;font-size:12px;font-family:inherit}
#gev-drive-form .save{border:1px solid rgba(255,209,102,.5);background:rgba(255,209,102,.16);color:#ffd166}
#gev-drive-form .cancel{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.05);color:#dfe7f2}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-drive-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-drive-styles';
  style.textContent = D4D_CSS;
  document.head.appendChild(style);
}

function downloadFile(name, content, mime) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 4000);
}

/**
 * Live controller: dock button + drive panel + GPS route + property pins.
 * options: { viewer, streetView, signal }
 */
export function initDriveForDollars({
  viewer,
  streetView = null,
  signal = null,
  onPropertySaved = null,
} = {}) {
  if (!viewer) throw new Error('driveForDollars: viewer is required');
  injectStyles();
  const aborted = { current: false };
  signal?.addEventListener?.(
    'abort',
    () => {
      aborted.current = true;
    },
    { once: true },
  );

  const C = Cesium;
  const state = loadState();
  let drives = state.drives;
  let properties = state.properties;
  const photos = new Map(); // property id -> dataURL (session only)

  let driving = false;
  let watchId = null;
  let driveStart = null;
  let drivePoints = []; // [{lat,lng,t}]
  let lastFix = null; // {lat,lng,accuracy,t}
  let gpsStatus = 'idle'; // idle|waiting|active|denied|unavailable
  let routeEntity = null;
  let markerEntity = null;
  const pinEntities = [];

  let btnEl = null;
  let panelEl = null;
  let gpsEl = null;
  let statTime = null;
  let statDist = null;
  let statMarks = null;
  let startStopBtn = null;
  let markBtn = null;
  let listEl = null;
  let tickTimer = null;

  function persist() {
    saveState({ drives, properties });
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
  }

  function fmtDist(m) {
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(2)} km`;
  }

  function renderStats() {
    if (!panelEl) return;
    const elapsed = driving && driveStart ? Date.now() - driveStart : 0;
    if (statTime) statTime.textContent = fmtTime(elapsed);
    if (statDist) statDist.textContent = fmtDist(routeDistanceM(drivePoints));
    if (statMarks) statMarks.textContent = String(properties.length);
    if (gpsEl) {
      const map = {
        idle: ['GPS en espera', ''],
        waiting: ['Buscando GPS…', 'warn'],
        active: ['GPS activo ✓', 'ok'],
        denied: ['GPS denegado — se usará el centro del mapa', 'warn'],
        unavailable: [
          'GPS no disponible — se usará el centro del mapa',
          'warn',
        ],
      };
      const [label, cls] = map[gpsStatus] || map.idle;
      gpsEl.textContent = label;
      gpsEl.className = `d4d-gps ${cls}`;
    }
    if (startStopBtn) {
      startStopBtn.textContent = driving
        ? '⏹ Terminar recorrido'
        : '▶ Empezar recorrido';
      startStopBtn.classList.toggle('stop', driving);
    }
    if (markBtn) markBtn.disabled = false;
    btnEl?.classList.toggle('is-driving', driving);
  }

  function positionsCallback() {
    if (!C) return [];
    return drivePoints.map((p) => C.Cartesian3.fromDegrees(p.lng, p.lat, 2));
  }

  function ensureRouteEntity() {
    if (!C || routeEntity || typeof document === 'undefined') return;
    try {
      routeEntity = viewer.entities.add({
        polyline: {
          positions: new C.CallbackProperty(() => positionsCallback(), false),
          width: 4,
          material: new C.ColorMaterialProperty(C.Color.GOLD.withAlpha(0.9)),
          clampToGround: true,
        },
      });
      markerEntity = viewer.entities.add({
        position: new C.CallbackProperty(() => {
          if (!lastFix) return null;
          return C.Cartesian3.fromDegrees(lastFix.lng, lastFix.lat, 2);
        }, false),
        point: {
          pixelSize: 14,
          color: C.Color.DEEPSKYBLUE,
          outlineColor: C.Color.WHITE,
          outlineWidth: 2,
        },
      });
    } catch {
      routeEntity = null;
      markerEntity = null;
    }
  }

  function clearRouteEntity() {
    try {
      if (routeEntity) viewer.entities.remove(routeEntity);
      if (markerEntity) viewer.entities.remove(markerEntity);
    } catch {
      /* noop */
    }
    routeEntity = null;
    markerEntity = null;
  }

  function onGpsPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    lastFix = { lat: latitude, lng: longitude, accuracy, t: Date.now() };
    if (gpsStatus !== 'active') {
      gpsStatus = 'active';
      renderStats();
    }
    if (!driving) return;
    if (accuracy && accuracy > MAX_GPS_ACCURACY_M) return; // ignore jumps
    const prev = drivePoints[drivePoints.length - 1];
    if (prev && haversineM(prev.lat, prev.lng, latitude, longitude) < 5) return; // dedupe
    drivePoints.push({ lat: latitude, lng: longitude, t: Date.now() });
    renderStats();
  }

  function onGpsError(err) {
    gpsStatus = err && err.code === 1 ? 'denied' : 'unavailable';
    renderStats();
  }

  function startGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      gpsStatus = 'unavailable';
      renderStats();
      return;
    }
    gpsStatus = 'waiting';
    renderStats();
    try {
      watchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsError, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 5000,
      });
    } catch {
      gpsStatus = 'unavailable';
      renderStats();
    }
  }

  function stopGps() {
    try {
      if (watchId != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
    } catch {
      /* noop */
    }
    watchId = null;
  }

  function start() {
    if (driving) return { ok: true, already: true };
    driving = true;
    driveStart = Date.now();
    drivePoints = [];
    ensureRouteEntity();
    startGps();
    if (!tickTimer) {
      tickTimer = setInterval(() => {
        if (driving) renderStats();
      }, 1000);
    }
    renderStats();
    return { ok: true };
  }

  function stop() {
    if (!driving) return { ok: true, already: true };
    driving = false;
    stopGps();
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    const distanceM = routeDistanceM(drivePoints);
    drives.push({
      id: `drive-${Date.now()}`,
      startedAt: new Date(driveStart).toISOString(),
      endedAt: new Date().toISOString(),
      distanceM,
      points: drivePoints.map((p) => ({ lat: p.lat, lng: p.lng })),
    });
    persist();
    clearRouteEntity();
    drivePoints = [];
    renderStats();
    return { ok: true, distanceM };
  }

  function currentFix() {
    return lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : null;
  }

  function mapCenterLatLng() {
    if (!C) return null;
    try {
      const canvas = viewer.scene.canvas;
      const center = new C.Cartesian2(
        canvas.clientWidth / 2,
        canvas.clientHeight / 2,
      );
      const cartesian = viewer.camera.pickEllipsoid(
        center,
        viewer.scene.globe.ellipsoid,
      );
      if (!cartesian) return null;
      const carto = C.Cartographic.fromCartesian(cartesian);
      return {
        lat: C.Math.toDegrees(carto.latitude),
        lng: C.Math.toDegrees(carto.longitude),
      };
    } catch {
      return null;
    }
  }

  function addPin(property) {
    if (!C || typeof document === 'undefined') return;
    try {
      const entity = viewer.entities.add({
        name:
          property.address ||
          `${property.lat.toFixed(5)}, ${property.lng.toFixed(5)}`,
        description: `${conditionLabel(property.condition, UI_LANG)} — ${property.address || ''}`,
        position: C.Cartesian3.fromDegrees(property.lng, property.lat, 4),
        point: {
          pixelSize: 13,
          color: C.Color.GOLD,
          outlineColor: C.Color.BLACK,
          outlineWidth: 2,
        },
      });
      entity.__d4dId = property.id;
      pinEntities.push(entity);
    } catch {
      /* noop */
    }
  }

  function restorePins() {
    for (const p of properties) addPin(p);
  }

  function showMarkForm(lat, lng, address) {
    if (typeof document === 'undefined') return;
    document.getElementById('gev-drive-form')?.remove();
    const form = document.createElement('div');
    form.id = 'gev-drive-form';
    const condOptions = PROPERTY_CONDITIONS.map(
      (c) => `<option value="${c.id}">${c.es} / ${c.en}</option>`,
    ).join('');
    form.innerHTML = `
      <h3>📍 MARCAR PROPIEDAD</h3>
      <div class="addr">${address ? address : `${lat.toFixed(6)}, ${lng.toFixed(6)}`}</div>
      <label>CONDICIÓN / CONDITION</label>
      <select id="d4d-cond">${condOptions}</select>
      <label>NOTAS / NOTES</label>
      <textarea id="d4d-notes" placeholder="Ej: techo caído, maleza alta, se ve abandonada…"></textarea>
      <label>FOTO / PHOTO</label>
      <input id="d4d-photo" type="file" accept="image/*" capture="environment" />
      <div class="frow">
        <button class="cancel" type="button">Cancelar</button>
        <button class="save" type="button">Guardar ✓</button>
      </div>
    `;
    document.body.appendChild(form);
    form
      .querySelector('.cancel')
      .addEventListener('click', () => form.remove());
    form.querySelector('.save').addEventListener('click', () => {
      const condition = form.querySelector('#d4d-cond').value;
      const notes = form.querySelector('#d4d-notes').value.trim();
      const fileInput = form.querySelector('#d4d-photo');
      const file = fileInput?.files?.[0] || null;
      const property = {
        id: `prop-${Date.now()}`,
        lat,
        lng,
        address: address || '',
        condition,
        notes,
        photoName: file ? file.name : '',
        timestamp: new Date().toISOString(),
      };
      const finish = () => {
        properties.push(property);
        persist();
        addPin(property);
        renderList();
        renderStats();
        form.remove();
        // Wholesale bridge: hand the marked property to the host app so it
        // can enter the lead pipeline (the host owns the store).
        try {
          onPropertySaved?.({ ...property });
        } catch {
          /* host hook */
        }
      };
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const dataUrl = String(reader.result || '');
            if (dataUrl.length < 2_000_000) photos.set(property.id, dataUrl);
          } catch {
            /* skip photo */
          }
          finish();
        };
        reader.onerror = finish;
        reader.readAsDataURL(file);
      } else {
        finish();
      }
    });
  }

  async function markProperty() {
    const ll = currentFix() || mapCenterLatLng();
    if (!ll) return { ok: false, error: 'no-location' };
    let address = null;
    try {
      address = await reverseGeocode(ll.lat, ll.lng);
    } catch {
      /* best effort */
    }
    if (aborted.current) return { ok: false, error: 'aborted' };
    showMarkForm(ll.lat, ll.lng, address);
    return { ok: true, lat: ll.lat, lng: ll.lng, address };
  }

  function flyToProperty(p) {
    if (!C) return;
    try {
      viewer.camera.flyTo({
        destination: C.Cartesian3.fromDegrees(p.lng, p.lat, 600),
        duration: 2,
      });
    } catch {
      /* noop */
    }
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!properties.length) {
      const empty = document.createElement('div');
      empty.className = 'd4d-note';
      empty.textContent =
        'Sin propiedades marcadas todavía. / No properties marked yet.';
      listEl.appendChild(empty);
      return;
    }
    const items = [...properties].reverse();
    for (const p of items) {
      const item = document.createElement('div');
      item.className = 'd4d-item';
      const addr = document.createElement('div');
      addr.className = 'addr';
      addr.textContent =
        p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
      addr.title = p.address || '';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${conditionLabel(p.condition, UI_LANG)} · ${new Date(p.timestamp).toLocaleDateString()}`;
      const row = document.createElement('div');
      row.className = 'row';
      const flyBtn = document.createElement('button');
      flyBtn.type = 'button';
      flyBtn.textContent = '✈ Ir';
      flyBtn.addEventListener('click', () => flyToProperty(p));
      const svBtn = document.createElement('button');
      svBtn.type = 'button';
      svBtn.textContent = '🛣️ Calle';
      svBtn.addEventListener('click', () => streetView?.openAt(p.lat, p.lng));
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '🗑';
      delBtn.setAttribute('aria-label', 'Eliminar');
      delBtn.addEventListener('click', () => {
        properties = properties.filter((x) => x.id !== p.id);
        photos.delete(p.id);
        try {
          const ent = pinEntities.find((e) => e.__d4dId === p.id);
          if (ent) viewer.entities.remove(ent);
        } catch {
          /* noop */
        }
        persist();
        renderList();
        renderStats();
      });
      row.appendChild(flyBtn);
      row.appendChild(svBtn);
      row.appendChild(delBtn);
      item.appendChild(addr);
      item.appendChild(meta);
      item.appendChild(row);
      listEl.appendChild(item);
    }
  }

  function exportCsv() {
    downloadFile(
      driveFileName('csv'),
      propertiesToCsv(properties),
      'text/csv;charset=utf-8',
    );
  }

  function exportJson() {
    const payload = properties.map((p) => ({
      ...p,
      photo: photos.get(p.id) || null,
    }));
    downloadFile(
      driveFileName('json'),
      JSON.stringify(
        { exportedAt: new Date().toISOString(), properties: payload },
        null,
        2,
      ),
      'application/json',
    );
  }

  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.id = 'gev-drive-panel';
    panelEl.innerHTML = `
      <div class="d4d-head">
        <div class="d4d-title">🚗 DRIVER FOR DOLLARS</div>
        <button class="d4d-close" type="button" aria-label="Cerrar / close">✕</button>
      </div>
      <div class="d4d-body">
        <div class="d4d-gps" id="d4d-gps">GPS en espera</div>
        <div class="d4d-actions">
          <button class="d4d-btn" id="d4d-startstop" type="button">▶ Empezar recorrido</button>
        </div>
        <div class="d4d-stats">
          <div class="d4d-stat"><div class="v" id="d4d-time">0:00</div><div class="k">TIEMPO</div></div>
          <div class="d4d-stat"><div class="v" id="d4d-dist">0 m</div><div class="k">DISTANCIA</div></div>
          <div class="d4d-stat"><div class="v" id="d4d-marks">0</div><div class="k">MARCADAS</div></div>
        </div>
        <button class="d4d-btn d4d-mark" id="d4d-mark" type="button">📍 Marcar propiedad aquí</button>
        <div class="d4d-list" id="d4d-list"></div>
        <div class="d4d-foot">
          <button id="d4d-csv" type="button">⬇ CSV</button>
          <button id="d4d-json" type="button">⬇ JSON</button>
        </div>
        <div class="d4d-note">Las fotos se guardan en la sesión · Photos are session-only. El CSV sirve para el Vacant Property Scanner.</div>
      </div>
    `;
    document.body.appendChild(panelEl);
    gpsEl = panelEl.querySelector('#d4d-gps');
    statTime = panelEl.querySelector('#d4d-time');
    statDist = panelEl.querySelector('#d4d-dist');
    statMarks = panelEl.querySelector('#d4d-marks');
    startStopBtn = panelEl.querySelector('#d4d-startstop');
    markBtn = panelEl.querySelector('#d4d-mark');
    listEl = panelEl.querySelector('#d4d-list');
    panelEl.querySelector('.d4d-close').addEventListener('click', () => {
      panelEl?.remove();
      panelEl = null;
    });
    startStopBtn.addEventListener('click', () => {
      if (driving) stop();
      else start();
    });
    markBtn.addEventListener('click', () => {
      void markProperty();
    });
    panelEl.querySelector('#d4d-csv').addEventListener('click', exportCsv);
    panelEl.querySelector('#d4d-json').addEventListener('click', exportJson);
    renderStats();
    renderList();
  }

  function togglePanel() {
    if (typeof document === 'undefined') return;
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
      return;
    }
    buildPanel();
  }

  if (typeof document !== 'undefined') {
    btnEl = document.createElement('button');
    btnEl.id = 'gev-drive-btn';
    btnEl.type = 'button';
    btnEl.innerHTML = '<span class="sv-emoji">🚗</span><span>Driver $</span>';
    btnEl.setAttribute('aria-label', 'Driver for dollars / modo manejo');
    btnEl.addEventListener('click', togglePanel);
    const dock = document.getElementById('command-dock');
    if (dock) dock.appendChild(btnEl);
    else document.body.appendChild(btnEl);
  }

  restorePins();

  const api = {
    start,
    stop,
    markProperty,
    currentFix,
    get driving() {
      return driving;
    },
    get propertyCount() {
      return properties.length;
    },
    exportCsv,
    exportJson,
    destroy() {
      aborted.current = true;
      try {
        if (driving) stop();
      } catch {
        /* noop */
      }
      stopGps();
      if (tickTimer) clearInterval(tickTimer);
      try {
        for (const e of pinEntities) viewer.entities.remove(e);
      } catch {
        /* noop */
      }
      pinEntities.length = 0;
      document.getElementById('gev-drive-form')?.remove();
      panelEl?.remove();
      panelEl = null;
      btnEl?.remove();
      btnEl = null;
    },
  };
  if (typeof window !== 'undefined') window.__gevDriveForDollars = api;
  return api;
}
