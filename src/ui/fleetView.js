/**
 * Cuba fleet view — "direct to the vessels".
 *
 * Boots the globe onto the Cuba fleet: fetches the live AIS feed, finds the
 * Cuba-traffic vessels (known Cuba-lane fleet + AIS destinations naming a
 * Cuban port), lists them in the Cuba traffic panel (tap a row to fly to
 * that vessel), and flies the camera to a bounding sphere around every
 * found vessel. Falls back to the default Cuba-corridor view when no
 * Cuba-traffic vessel is in the feed.
 */
import * as Cesium from 'cesium';
import {
  CUBA_FLEET_DEFAULT_VIEW,
} from '../data/cubaFleet.js';
import {
  isCubaBound,
  isCubaLaneVessel,
  isDepartingCuba,
  isAnchoredInCuba,
  cubaVesselCss,
  cubaVesselBadge,
} from '../data/cubaVessels.js';
import { showCubaTrafficPanel } from './cubaTrafficPanel.js';
import { getVesselLivePosition } from '../data/aisLiveVessels.js';

const AIS_URL = '/api/ais-live?maxRows=50000';

function rowLatLon(row) {
  const lat = Number(row?.latitude ?? row?.lat);
  const lon = Number(row?.longitude ?? row?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function vesselName(row) {
  const name = String(row?.name || '').trim();
  return name || 'BUQUE';
}

async function fetchCubaTraffic() {
  const res = await fetch(AIS_URL, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
  const found = [];
  const seen = new Set();
  for (const row of rows) {
    const ll = rowLatLon(row);
    if (!ll) continue;
    const record = {
      mmsi: String(row?.mmsi ?? row?.id ?? '').trim(),
      destination: String(row?.destination || ''),
      lat: ll.lat,
      lon: ll.lon,
      speed: row?.speed,
    };
    const badge = cubaVesselBadge(record);
    if (!badge) continue;
    const key = record.mmsi || `${ll.lat},${ll.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      mmsi: record.mmsi,
      name: vesselName(row),
      destination: String(row?.destination || '').trim(),
      css: cubaVesselCss(record),
      badge: badge.text,
      ...ll,
    });
  }
  // Bound for Cuba first, then departing/anchored in Cuba, then lane.
  const rankOf = (v) =>
    v.badge.includes('RUMBO') ? 0 : v.badge.includes('RUTA') ? 2 : 1;
  found.sort(
    (a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name),
  );
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
 * Go straight to a vessel from the traffic panel.
 *
 * The camera flight runs immediately and synchronously so the tap always
 * produces visible movement — no async chain in front of it. Afterwards we
 * try to open the vessel's inspection card as a bonus.
 */
function goToVessel(viewer, vessel) {
  if (!viewer?.camera || !vessel) return;
  // Prefer the layer's live position (refreshed every second) over the
  // panel's fetch-time fix — vessels keep moving after the list loads.
  let lat = vessel.lat;
  let lon = vessel.lon;
  if (vessel.mmsi) {
    try {
      const live = getVesselLivePosition(vessel.mmsi);
      if (live) {
        lat = live.lat;
        lon = live.lon;
      }
    } catch {
      /* keep the panel's position */
    }
  }
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  try {
    viewer.camera.cancelFlight?.();
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(position, 0), {
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-55),
        150000,
      ),
      duration: 1.6,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  } catch {
    return;
  }
  if (vessel.mmsi) {
    import('../data/aisLiveVessels.js')
      .then(({ selectVesselByMmsi }) => {
        try {
          selectVesselByMmsi(vessel.mmsi);
        } catch {
          /* card is a bonus — the camera already moved */
        }
      })
      .catch(() => {
        /* card is a bonus — the camera already moved */
      });
  }
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
      found = await fetchCubaTraffic();
    } catch {
      found = [];
    }
    if (found.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (!viewer?.camera) return { found: found.length, selected: false };

  // Always surface the traffic panel on the fleet deep-link, even when the
  // feed carries no Cuba traffic right now.
  try {
    showCubaTrafficPanel(found, (vessel) => goToVessel(viewer, vessel));
  } catch {
    /* panel is decorative — never break the view */
  }

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
    // Select the first found vessel so its card opens; exact MMSI.
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

// Re-exported for tests.
export { isCubaBound, isCubaLaneVessel, isDepartingCuba, isAnchoredInCuba };
