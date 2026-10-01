/**
 * SAHJONY client container tracker — GET /api/track
 *
 * Dead-simple client API: ?numbers=MSKU1234567,TCLU7654321 (max 10).
 * For each number it does ShipsGo v2 LOOKUPS ONLY (never POST/create, so no
 * credits are ever spent), fetches shipment details with mapPoint, and
 * cross-checks the vessel against our own live AIS feed for a fresher
 * position. Every result carries a SAHJONY LIVE VIEW 3D deep link.
 *
 * Auth: SHIPSGO_TOKEN env var (header X-Shipsgo-User-Token), set by the
 * owner in Provider Settings (see src/keySetupCore.mjs). Without it the
 * endpoint answers 503 honestly instead of failing silently.
 */
import { aisStreamRows } from './ais-store.js';

const SHIPSGO_BASE = 'https://api.shipsgo.com';
const MAX_NUMBERS = 10;
const UPSTREAM_TIMEOUT_MS = 25_000;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function shipsgoToken() {
  return String(process.env.SHIPSGO_TOKEN || '').trim();
}

async function shipsgoGet(path) {
  const token = shipsgoToken();
  if (!token) return { error: 'not-configured' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(SHIPSGO_BASE + path, {
      headers: { 'X-Shipsgo-User-Token': token },
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (error) {
    return { error: 'upstream-failed', detail: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

function first(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

/** Lookup cascade: container -> BL -> booking. Lookup endpoints are free. */
async function findShipment(number) {
  for (const param of ['container_number', 'bl_number', 'booking_number']) {
    const r = await shipsgoGet(
      `/ocean/shipments?${param}=${encodeURIComponent(number)}`,
    );
    if (r.error) return r;
    if (r.status >= 400) return { error: 'upstream-failed', status: r.status };
    const rows =
      r.data?.shipments || r.data?.data || (Array.isArray(r.data) ? r.data : []);
    if (rows.length) return { shipment: rows[0] };
  }
  return { shipment: null };
}

async function shipmentDetails(id) {
  const r = await shipsgoGet(`/ocean/shipments/${encodeURIComponent(String(id))}?mapPoint=true`);
  if (r.error) return r;
  if (r.status >= 400) return { error: 'upstream-failed', status: r.status };
  const ship = r.data?.shipment || r.data;
  return { shipment: ship && typeof ship === 'object' ? ship : null };
}

/** Fresher live position from SAHJONY's own AIS feed (best effort). */
function aisPosition(vesselName) {
  try {
    const name = String(vesselName || '').trim().toUpperCase();
    if (!name) return null;
    const rows = aisStreamRows(50000);
    for (const r of rows) {
      const rn = String(r?.name || '').trim().toUpperCase();
      if (rn && (rn === name || name.includes(rn) || rn.includes(name))) {
        const lat = Number(r.lat);
        const lon = Number(r.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          return { lat, lon, mmsi: r.mmsi || null };
        }
      }
    }
  } catch {
    // best effort only
  }
  return null;
}

function summarize(query, ship) {
  const vessel = ship.vessel || {};
  const coords = ship.coordinates || {};
  const pol = ship.pol || {};
  const pod = ship.pod || {};
  let lat = first(coords, 'lat', 'latitude');
  let lon = first(coords, 'lng', 'lon', 'longitude');
  lat = lat === null ? null : Number(lat);
  lon = lon === null ? null : Number(lon);
  if (!Number.isFinite(lat)) lat = null;
  if (!Number.isFinite(lon)) lon = null;
  const vesselName =
    (vessel && typeof vessel === 'object' ? first(vessel, 'name') : vessel) || null;
  let positionSource = lat !== null ? 'shipsgo' : null;
  let aisMmsi = null;
  if (vesselName) {
    const live = aisPosition(vesselName);
    if (live) {
      lat = live.lat;
      lon = live.lon;
      aisMmsi = live.mmsi;
      positionSource = 'shipsgo+ais-live';
    }
  }
  return {
    query,
    found: true,
    container: first(ship, 'container_number', 'containerNumber'),
    bl: first(ship, 'bl_number', 'blNumber'),
    booking: first(ship, 'booking_number', 'bookingNumber'),
    vessel: vesselName,
    vessel_imo:
      (vessel && typeof vessel === 'object' ? first(vessel, 'imo') : null) || null,
    shipping_line: first(ship, 'carrier', 'shippingLine', 'shipping_line'),
    origin: (pol && typeof pol === 'object' ? first(pol, 'name') : pol) || null,
    destination: (pod && typeof pod === 'object' ? first(pod, 'name') : pod) || null,
    eta: (pod && typeof pod === 'object' ? first(pod, 'eta') : first(ship, 'eta')) || null,
    status: ship.status || null,
    lat,
    lon,
    position_source: positionSource,
    ais_mmsi: aisMmsi,
    live_3d:
      lat !== null && lon !== null
        ? `/live-view/#lat=${lat}&lon=${lon}&alt=80000&pitch=-45&v=2&l=a`
        : null,
  };
}

async function trackOne(raw) {
  const query = String(raw || '').trim().toUpperCase();
  if (!query) return null;
  const found = await findShipment(query);
  if (found.error) return { query, found: false, error: found.error };
  if (!found.shipment) return { query, found: false };
  const id = found.shipment.id;
  if (id === undefined || id === null) return { query, found: false };
  const details = await shipmentDetails(id);
  if (details.error) return { query, found: false, error: details.error };
  if (!details.shipment) return { query, found: false };
  return summarize(query, details.shipment);
}

export function containerTrackProxy() {
  async function middleware(req, res, next) {
    let url;
    try {
      url = new URL(req.url || '', 'http://localhost');
    } catch {
      return next();
    }
    if (url.pathname !== '/api/track') return next();
    if (req.method !== 'GET') return next();
    if (!shipsgoToken()) {
      return sendJson(res, 503, {
        error: 'not-configured',
        message:
          'El rastreador aún no está conectado. El dueño debe agregar la clave de ShipsGo en Ajustes de proveedor.',
      });
    }
    const numbers = String(url.searchParams.get('numbers') || '')
      .split(/[,\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_NUMBERS);
    if (!numbers.length) {
      return sendJson(res, 400, {
        error: 'missing-numbers',
        message: 'Escribe al menos un número de contenedor.',
      });
    }
    const results = [];
    for (const n of numbers) {
      try {
        results.push(await trackOne(n));
      } catch {
        results.push({ query: n, found: false, error: 'upstream-failed' });
      }
    }
    return sendJson(res, 200, { results: results.filter(Boolean) });
  }

  return {
    name: 'sahjony-container-track',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
