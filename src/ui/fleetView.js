/**
 * Cuba fleet view — "direct to the vessels".
 *
 * Boots the globe onto the Cuba fleet: fetches the live AIS feed, finds the
 * fleet MMSIs, flies the camera to a bounding sphere around every found
 * vessel, and selects the first one so its inspection card opens. Falls back
 * to the default Cuba-corridor view when no fleet vessel is in the feed.
 */
import * as Cesium from 'cesium';
import {
  CUBA_FLEET_MMSI,
  CUBA_FLEET_DEFAULT_VIEW,
} from '../data/cubaFleet.js';

const FLEET_SET = new Set(CUBA_FLEET_MMSI);
const AIS_URL = '/api/ais-live?maxRows=50000';

function rowLatLon(row) {
  const lat = Number(row?.latitude ?? row?.lat);
  const lon = Number(row?.longitude ?? row?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

async function fetchFleetPositions() {
  const res = await fetch(AIS_URL, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
  const found = [];
  for (const row of rows) {
    const mmsi = String(row?.mmsi ?? row?.id ?? '').trim();
    if (!FLEET_SET.has(mmsi)) continue;
    const ll = rowLatLon(row);
    if (!ll) continue;
    found.push({ mmsi, ...ll });
  }
  return found;
}

function flyToDefault(viewer) {
  if (!viewer?.camera) return false;
  const { lat, lon, rangeM } = CUBA_FLEET_DEFAULT_VIEW;
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  viewer.camera.cancelFlight?.();
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(position, 0), {
    offset: new Cesium.HeadingPitchRange(
      0,
      Cesium.Math.toRadians(-62),
      rangeM,
    ),
    duration: 2.4,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
  return true;
}

/**
 * Show the Cuba fleet. Resolves with `{ found, selected }`.
 * @param {{ viewer?: object, timeoutMs?: number }} options
 */
export async function showCubaFleetView({ viewer, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let found = [];
  while (Date.now() < deadline) {
    try {
      found = await fetchFleetPositions();
    } catch {
      found = [];
    }
    if (found.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (!viewer?.camera) return { found: found.length, selected: false };

  if (found.length > 0) {
    const points = found.map((v) =>
      Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 0),
    );
    const sphere = Cesium.BoundingSphere.fromPoints(points);
    const range = Math.max(sphere.radius * 2.4, 600000);
    viewer.camera.cancelFlight?.();
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-62),
        range,
      ),
      duration: 2.4,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
    // Select the first found fleet vessel so its card opens; exact MMSI.
    try {
      const { selectVesselByMmsi } = await import('../data/aisLiveVessels.js');
      const ok = selectVesselByMmsi(found[0].mmsi) === true;
      return { found: found.length, selected: ok };
    } catch {
      return { found: found.length, selected: false };
    }
  }
  flyToDefault(viewer);
  return { found: 0, selected: false };
}
