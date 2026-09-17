/**
 * Street View for GOD'S EYE VIEW — $0, no API keys.
 *
 * Three keyless providers:
 *  1. KartaView — crowdsourced street-level photos embedded in an iframe
 *     (https://kartaview.org/map/@lat,lng,18z). No key, no account.
 *  2. 3D street level — drops the Cesium camera to ~eye level on the
 *     photorealistic tiles. Works everywhere the tiles have coverage.
 *  3. Google Street View — universal maps URL opened in a new tab
 *     (no API key needed for a plain link).
 *
 * Pure URL builders are exported for unit tests; the live Cesium/DOM
 * wiring lives in initStreetView().
 */

const KARTAVIEW_ZOOM = 18;

/** KartaView embed URL centered on a coordinate. */
export function kartaViewUrl(lat, lng) {
  const la = Number(lat).toFixed(6);
  const ln = Number(lng).toFixed(6);
  return `https://kartaview.org/map/@${la},${ln},${KARTAVIEW_ZOOM}z`;
}

/** Google Street View universal URL (no API key needed for a plain link). */
export function googleStreetViewUrl(lat, lng) {
  const la = Number(lat).toFixed(6);
  const ln = Number(lng).toFixed(6);
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${la},${ln}`;
}

/** Human-readable coordinate label. */
export function formatLatLng(lat, lng) {
  const la = Number(lat).toFixed(5);
  const ln = Number(lng).toFixed(5);
  return `${Math.abs(la)}° ${la >= 0 ? 'N' : 'S'}, ${Math.abs(ln)}° ${ln >= 0 ? 'E' : 'W'}`;
}

const SV_CSS = `
#gev-streetview-btn{display:flex;align-items:center;gap:8px;padding:10px 12px;margin-top:8px;background:rgba(10,14,22,.82);border:1px solid rgba(125,211,252,.28);border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.06em;min-width:172px;max-width:210px}
#gev-streetview-btn:hover{border-color:rgba(125,211,252,.6)}
#gev-streetview-btn.is-picking{border-color:#ffd166;box-shadow:0 0 0 3px rgba(255,209,102,.25)}
#gev-streetview-btn .sv-emoji{font-size:20px}
#gev-streetview-panel{position:fixed;z-index:60;right:12px;bottom:12px;width:min(430px,calc(100vw - 24px));height:min(380px,calc(100vh - 24px));background:rgba(8,11,18,.94);border:1px solid rgba(125,211,252,.3);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7}
#gev-streetview-panel .svp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(125,211,252,.18)}
#gev-streetview-panel .svp-title{font-size:12px;font-weight:800;letter-spacing:.1em;color:#7dd3fc;flex:1}
#gev-streetview-panel .svp-coords{font-size:10px;color:#9fb0c9}
#gev-streetview-panel .svp-close{background:none;border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:14px}
#gev-streetview-panel .svp-tabs{display:flex;gap:6px;padding:8px 12px 0}
#gev-streetview-panel .svp-tab{flex:1;padding:8px 4px;border-radius:9px 9px 0 0;border:1px solid rgba(125,211,252,.18);border-bottom:none;background:rgba(125,211,252,.06);color:#cfe3f5;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit}
#gev-streetview-panel .svp-tab.is-active{background:rgba(125,211,252,.16);color:#fff}
#gev-streetview-panel .svp-body{flex:1;position:relative;border-top:1px solid rgba(125,211,252,.18)}
#gev-streetview-panel .svp-body iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#0b0f16}
#gev-streetview-panel .svp-note{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;padding:20px;text-align:center;font-size:12px;color:#c8d4e4;background:#0b0f16}
#gev-streetview-panel .svp-note button{padding:10px 16px;border-radius:10px;border:1px solid rgba(255,209,102,.4);background:rgba(255,209,102,.12);color:#ffd166;font-weight:800;cursor:pointer;font-size:12px;font-family:inherit}
#gev-streetview-panel .svp-note a{color:#7dd3fc}
#gev-streetview-hint{position:fixed;z-index:61;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(8,11,18,.92);border:1px solid rgba(255,209,102,.45);color:#ffd166;font-size:13px;font-weight:700;padding:10px 18px;border-radius:999px;pointer-events:none;font-family:inherit;white-space:nowrap}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-streetview-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-streetview-styles';
  style.textContent = SV_CSS;
  document.head.appendChild(style);
}

function getCesium() {
  if (typeof Cesium !== 'undefined') return Cesium;
  if (typeof window !== 'undefined' && window.Cesium) return window.Cesium;
  return null;
}

/** Lat/lng under the center of the screen, or null. */
export function screenCenterLatLng(viewer) {
  try {
    const C = getCesium();
    if (!C || !viewer?.scene?.canvas) return null;
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

/** Lat/lng for a click event on the canvas, or null. */
function clickLatLng(viewer, movement) {
  try {
    const C = getCesium();
    if (!C) return null;
    const cartesian = viewer.camera.pickEllipsoid(
      movement.position,
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

/**
 * Drop the camera to ~3 m above ground, 25 m back from the target along the
 * current heading — a street-level view on the photorealistic 3D tiles.
 * Returns a restore function for the previous camera pose.
 */
export function dropToStreetLevel(viewer, lat, lng) {
  const C = getCesium();
  if (!C) throw new Error('Cesium unavailable');
  const camera = viewer.camera;
  const prev = {
    destination: camera.position.clone(),
    orientation: {
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    },
  };
  const BACK_M = 25;
  const EYE_M = 3;
  const heading = camera.heading;
  const latRad = C.Math.toRadians(lat);
  const lngRad = C.Math.toRadians(lng);
  const metersToLat = 1 / 111320;
  const metersToLng = 1 / (111320 * Math.max(0.2, Math.cos(latRad)));
  const eyeLat = latRad - Math.sin(heading) * BACK_M * metersToLat;
  const eyeLng = lngRad - Math.cos(heading) * BACK_M * metersToLng;
  const destination = C.Cartesian3.fromRadians(eyeLng, eyeLat, EYE_M);
  try {
    camera.flyTo({
      destination,
      orientation: { heading, pitch: C.Math.toRadians(-4), roll: 0 },
      duration: 2.2,
    });
  } catch {
    camera.setView({
      destination,
      orientation: { heading, pitch: C.Math.toRadians(-4), roll: 0 },
    });
  }
  return function restore() {
    try {
      camera.flyTo({ ...prev, duration: 1.6 });
    } catch {
      camera.setView(prev);
    }
  };
}

/**
 * Live controller: dock button + pick mode + floating provider panel.
 * options: { viewer, signal }
 */
export function initStreetView({ viewer, signal = null } = {}) {
  if (!viewer) throw new Error('streetView: viewer is required');
  injectStyles();
  const aborted = { current: false };
  signal?.addEventListener?.('abort', () => { aborted.current = true; }, { once: true });

  let focusProvider = null; // () => { lat, lng } | null — e.g. drive GPS fix
  let pickHandler = null;
  let hintEl = null;
  let panelEl = null;
  let activeTab = 'kartaview';
  let restoreStreetCam = null;
  let current = null; // { lat, lng }

  function setFocusProvider(fn) {
    focusProvider = typeof fn === 'function' ? fn : null;
  }

  function focusLatLng() {
    const fromFocus = focusProvider?.();
    if (fromFocus && Number.isFinite(fromFocus.lat) && Number.isFinite(fromFocus.lng)) {
      return { lat: fromFocus.lat, lng: fromFocus.lng };
    }
    return screenCenterLatLng(viewer);
  }

  function endPickMode() {
    try { pickHandler?.destroy(); } catch { /* noop */ }
    pickHandler = null;
    hintEl?.remove();
    hintEl = null;
    btnEl?.classList.remove('is-picking');
  }

  function startPickMode() {
    if (aborted.current || typeof document === 'undefined') return;
    const C = getCesium();
    if (!C) return;
    endPickMode();
    btnEl?.classList.add('is-picking');
    hintEl = document.createElement('div');
    hintEl.id = 'gev-streetview-hint';
    hintEl.textContent = 'Toca el mapa para ver la calle · Tap the map for street view';
    document.body.appendChild(hintEl);
    pickHandler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    pickHandler.setInputAction((movement) => {
      const ll = clickLatLng(viewer, movement);
      endPickMode();
      if (ll) openAt(ll.lat, ll.lng);
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    const cancel = (e) => {
      if (e.key === 'Escape') {
        endPickMode();
        document.removeEventListener('keydown', cancel);
      }
    };
    document.addEventListener('keydown', cancel);
  }

  function renderPanelBody() {
    if (!panelEl || !current) return;
    const body = panelEl.querySelector('.svp-body');
    if (!body) return;
    body.innerHTML = '';
    document.querySelectorAll('#gev-streetview-panel .svp-tab').forEach((t) => {
      t.classList.toggle('is-active', t.dataset.tab === activeTab);
    });
    if (activeTab === 'kartaview') {
      const frame = document.createElement('iframe');
      frame.title = 'KartaView street-level imagery';
      frame.src = kartaViewUrl(current.lat, current.lng);
      frame.setAttribute('allow', 'fullscreen');
      body.appendChild(frame);
    } else if (activeTab === 'street3d') {
      const note = document.createElement('div');
      note.className = 'svp-note';
      note.innerHTML = '';
      const p = document.createElement('p');
      p.textContent =
        'Cámara a nivel de calle sobre las imágenes 3D. / Street-level camera on the 3D tiles.';
      const back = document.createElement('button');
      back.type = 'button';
      back.textContent = '↩ Volver / Back';
      back.addEventListener('click', () => {
        try { restoreStreetCam?.(); } catch { /* noop */ }
        restoreStreetCam = null;
      });
      note.appendChild(p);
      note.appendChild(back);
      body.appendChild(note);
      try {
        restoreStreetCam?.();
      } catch { /* noop */ }
      restoreStreetCam = dropToStreetLevel(viewer, current.lat, current.lng);
    } else if (activeTab === 'google') {
      const note = document.createElement('div');
      note.className = 'svp-note';
      const p = document.createElement('p');
      p.textContent =
        'Google Street View se abre en una pestaña nueva (sin API key). / Google Street View opens in a new tab (no API key).';
      const a = document.createElement('a');
      a.href = googleStreetViewUrl(current.lat, current.lng);
      a.target = '_blank';
      a.rel = 'noopener';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Abrir Google Street View ↗';
      a.appendChild(btn);
      note.appendChild(p);
      note.appendChild(a);
      body.appendChild(note);
    }
  }

  function openAt(lat, lng) {
    if (aborted.current || typeof document === 'undefined') return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    endPickMode();
    close();
    current = { lat, lng };
    activeTab = 'kartaview';
    panelEl = document.createElement('div');
    panelEl.id = 'gev-streetview-panel';
    panelEl.innerHTML = `
      <div class="svp-head">
        <div class="svp-title">VISTA DE CALLE · STREET VIEW</div>
        <div class="svp-coords">${formatLatLng(lat, lng)}</div>
        <button class="svp-close" type="button" aria-label="Cerrar / close">✕</button>
      </div>
      <div class="svp-tabs">
        <button class="svp-tab" type="button" data-tab="kartaview">📷 KartaView</button>
        <button class="svp-tab" type="button" data-tab="street3d">🏙️ 3D nivel calle</button>
        <button class="svp-tab" type="button" data-tab="google">🗺️ Google ↗</button>
      </div>
      <div class="svp-body"></div>
    `;
    panelEl.querySelector('.svp-close').addEventListener('click', close);
    panelEl.querySelectorAll('.svp-tab').forEach((t) => {
      t.addEventListener('click', () => {
        activeTab = t.dataset.tab;
        renderPanelBody();
      });
    });
    document.body.appendChild(panelEl);
    renderPanelBody();
    return { lat, lng };
  }

  function openAtCurrent() {
    const ll = focusLatLng();
    if (!ll) return null;
    return openAt(ll.lat, ll.lng);
  }

  function close() {
    try { restoreStreetCam?.(); } catch { /* noop */ }
    restoreStreetCam = null;
    panelEl?.remove();
    panelEl = null;
    current = null;
  }

  let btnEl = null;
  if (typeof document !== 'undefined') {
    btnEl = document.createElement('button');
    btnEl.id = 'gev-streetview-btn';
    btnEl.type = 'button';
    btnEl.innerHTML = '<span class="sv-emoji">🛣️</span><span>Vista de calle</span>';
    btnEl.setAttribute('aria-label', 'Vista de calle / street view');
    btnEl.addEventListener('click', () => {
      if (pickHandler) endPickMode();
      else startPickMode();
    });
    const dock = document.getElementById('command-dock');
    if (dock) dock.appendChild(btnEl);
    else document.body.appendChild(btnEl);
  }

  const api = {
    openAt,
    openAtCurrent,
    openPickMode: startPickMode,
    close,
    setFocusProvider,
    destroy() {
      aborted.current = true;
      endPickMode();
      close();
      btnEl?.remove();
      btnEl = null;
    },
  };
  if (typeof window !== 'undefined') window.__gevStreetView = api;
  return api;
}
