/**
 * SAHJONY Client Portal — autonomous shipment activation (AIS watcher).
 *
 * Watches every pendiente/en_transito shipment that carries port coordinates
 * and flips its status from live AIS positions — no manual step needed when
 * the container is on the ship:
 *
 *   pendiente   → en_transito   when the vessel EXITS the origin geofence
 *                                 (~15 km) OR shows sustained speed > 3 kn
 *                                 (2 consecutive ticks) outside the port area
 *   en_transito → en_puerto     when the vessel ENTERS the destination geofence
 *   en_puerto   → entregado     MANUAL ONLY (owner confirms discharge)
 *
 * Honesty rules (never fake a status the AIS data doesn't support):
 * - No AIS position for the vessel → no transition, ever.
 * - No port coords on the shipment → the watcher skips it (manual mode).
 * - The watcher never regresses a status and never sets entregado.
 * - One noisy tick never flips anything: speed-based activation requires
 *   SUSTAINED speed over consecutive ticks — the same "report quickly, act
 *   slowly" pattern as src/data/aisWatchdog.js.
 */
import { hasWatcherCoords } from './shipments.js';

export const WATCHER_GEOFENCE_KM = 15;
export const WATCHER_SPEED_KN = 3;
/** Consecutive fast ticks required before a speed-based activation. */
export const WATCHER_SUSTAINED_TICKS = 2;
/** Default evaluation cadence. */
export const WATCHER_TICK_MS = 60_000;

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function vesselPosition(lookupResult) {
  const vessel = lookupResult?.vessel;
  const lat = Number(vessel?.lat);
  const lon = Number(vessel?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const speed = Number(vessel?.speed);
  return {
    lat,
    lon,
    speed: Number.isFinite(speed) ? speed : 0,
  };
}

/**
 * @param {{
 *   shipmentStore: object,
 *   vesselLookup: (mmsi:string)=>({vessel:object|null}|null),
 *   geofenceKm?: number,
 *   speedKn?: number,
 *   sustainedTicks?: number,
 *   tickMs?: number,
 * }} opts
 */
export function createShipmentWatcher(opts = {}) {
  const {
    shipmentStore,
    vesselLookup,
    geofenceKm = WATCHER_GEOFENCE_KM,
    speedKn = WATCHER_SPEED_KN,
    sustainedTicks = WATCHER_SUSTAINED_TICKS,
    tickMs = WATCHER_TICK_MS,
  } = opts;
  if (!shipmentStore) throw new Error('shipmentStore is required');
  if (typeof vesselLookup !== 'function') throw new Error('vesselLookup is required');

  /** shipmentId → consecutive ticks with speed > threshold */
  const fastTicks = new Map();
  let timer = null;
  let lastTickAt = null;
  let lastTransitions = [];

  /**
   * Evaluate every watchable shipment once.
   * @returns {Array<{shipmentId:string,clientId:string,from:string,to:string,reason:string}>}
   */
  function tick() {
    const transitions = [];
    let candidates = [];
    try {
      candidates = shipmentStore.listForWatcher();
    } catch {
      return transitions;
    }
    for (const shipment of candidates) {
      if (!hasWatcherCoords(shipment)) continue;
      let position = null;
      try {
        position = vesselPosition(vesselLookup(shipment.vesselMmsi));
      } catch {
        position = null;
      }
      // No AIS data → no transition. Never fake it.
      if (!position) {
        fastTicks.delete(shipment.id);
        continue;
      }

      if (shipment.status === 'pendiente') {
        const distOrigin = haversineKm(
          position.lat,
          position.lon,
          shipment.originLat,
          shipment.originLon,
        );
        if (distOrigin > geofenceKm) {
          const transition = applyTransition(shipment, 'en_transito', 'geofence_exit');
          if (transition) transitions.push(transition);
          fastTicks.delete(shipment.id);
          continue;
        }
        // Inside the geofence: only sustained speed counts (AIS jitter near
        // the port must not flip a shipment on one noisy tick).
        const count = position.speed > speedKn ? (fastTicks.get(shipment.id) || 0) + 1 : 0;
        if (count > 0) fastTicks.set(shipment.id, count);
        else fastTicks.delete(shipment.id);
        if (count >= sustainedTicks) {
          const transition = applyTransition(shipment, 'en_transito', 'sustained_speed');
          if (transition) transitions.push(transition);
          fastTicks.delete(shipment.id);
        }
      } else if (shipment.status === 'en_transito') {
        const distDest = haversineKm(
          position.lat,
          position.lon,
          shipment.destLat,
          shipment.destLon,
        );
        if (distDest <= geofenceKm) {
          const transition = applyTransition(shipment, 'en_puerto', 'geofence_enter');
          if (transition) transitions.push(transition);
        }
        fastTicks.delete(shipment.id);
      }
      // en_puerto / entregado: the watcher never touches them.
    }
    lastTickAt = new Date().toISOString();
    lastTransitions = transitions;
    return transitions;
  }

  function applyTransition(shipment, to, reason) {
    const from = shipment.status;
    try {
      shipmentStore.update(shipment.id, { status: to });
    } catch {
      return null;
    }
    return { shipmentId: shipment.id, clientId: shipment.clientId, from, to, reason };
  }

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        try {
          tick();
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn('[portal-watcher] tick failed', error?.message || error);
        }
      }, tickMs);
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      fastTicks.clear();
    },
    status() {
      return {
        running: timer !== null,
        tickMs,
        geofenceKm,
        speedKn,
        sustainedTicks,
        lastTickAt,
        lastTransitions,
      };
    },
    /** Test hook: how many consecutive fast ticks a shipment has banked. */
    _fastTicks(id) {
      return fastTicks.get(id) || 0;
    },
  };
}
