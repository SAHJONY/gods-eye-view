/**
 * Cuba vessel styling — SAHJONY LIVE VIEW.
 *
 * Client-facing cohorts get their own billboard colors so anyone can
 * spot Cuba traffic at a glance:
 *  - "Rumbo a Cuba"    (green  #00e676): AIS destination names a Cuban port.
 *  - "Saliendo de Cuba" (purple #b388ff): inside Cuban waters and moving,
 *    not bound for Cuba (AIS destination is elsewhere or empty).
 *  - "En Cuba"          (purple #b388ff): inside Cuban waters, stationary.
 *  - "Ruta Cuba"        (gold   #ffc107): known Cuba-lane vessels (fleet).
 *
 * Precedence: bound > in-zone (departing/anchored) > lane. A fleet vessel
 * currently sailing to Cuba shows green; one leaving Cuban waters shows
 * purple.
 */
import { CUBA_FLEET_MMSI } from './cubaFleet.js';

export const CUBA_BOUND_CSS = '#00e676';
export const CUBA_DEPARTING_CSS = '#b388ff';
export const CUBA_LANE_CSS = '#ffc107';
export const CUBA_BOUND_ACCENT = '0, 230, 118';
export const CUBA_DEPARTING_ACCENT = '179, 136, 255';
export const CUBA_LANE_ACCENT = '255, 193, 7';

/** Cuba + its immediate approaches (AIS coverage of the island is sparse). */
export const CUBA_ZONE = Object.freeze({
  latMin: 19.5,
  latMax: 23.6,
  lonMin: -85.2,
  lonMax: -73.8,
});

/** Minimum speed (knots) to count as "saliendo" rather than anchored. */
export const CUBA_DEPARTING_MIN_KN = 0.5;

const FLEET_SET = new Set(
  (CUBA_FLEET_MMSI || []).map((m) => String(m).trim()),
);

// Exact-word matches against the normalized AIS destination words.
const CUBA_WORDS = new Set([
  'HAVANA',
  'HABANA',
  'HAV',
  'MARIEL',
  'CIENFUEGOS',
  'MATANZAS',
  'NUEVITAS',
  'MOA',
  'ANTILLA',
  'GUANTANAMO',
  'MANZANILLO',
  'CAIBARIEN',
  'CARDENAS',
  'FELTON',
  // UN/LOCODEs
  'CUHAV',
  'CUMAR',
  'CUSCU',
  'CUCFG',
  'CUMAT',
  'CUNVT',
  'CUMOA',
  'CUANT',
  'CUGIT',
  'CUMZO',
  'CUCCM',
  'CUNGO',
  'CUGER',
  'CUPPD',
  'CUFEL',
  'CUBHO',
  'CUCTM',
]);

// Longer tokens also match as substrings ("LAHABANA" contains "HABANA").
// Kept at length >= 5 so short tokens never fuzzy-match ("SAMOA" ≠ Cuba).
const CUBA_SUBSTRINGS = Object.freeze([
  'HAVANA',
  'HABANA',
  'MARIEL',
  'SANTIAGODECUBA',
  'CIENFUEGOS',
  'MATANZAS',
  'NUEVITAS',
  'ANTILLA',
  'GUANTANAMO',
  'MANZANILLO',
  'CAIBARIEN',
  'NUEVAGERONA',
  'ISLADELAJUVENTUD',
  'PUERTOPADRE',
  'BAHIAHONDA',
]);

/**
 * Split a raw AIS destination into normalized uppercase words.
 * @param {*} dest Raw destination value.
 * @returns {string[]} Normalized words.
 */
export function destinationWords(dest) {
  return String(dest || '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/**
 * True when the vessel's AIS destination names a Cuban port.
 * @param {Object} record Vessel record with a `destination` field.
 * @returns {boolean}
 */
export function isCubaBound(record) {
  const words = destinationWords(record?.destination);
  if (words.length === 0) return false;
  // Multi-word port names ("Santiago de Cuba") only survive joined.
  const flat = words.join('');
  if (CUBA_SUBSTRINGS.some((token) => flat.includes(token))) return true;
  return words.some(
    (w) =>
      CUBA_WORDS.has(w) || CUBA_SUBSTRINGS.some((token) => w.includes(token)),
  );
}

/**
 * True when the vessel sails the known Cuba lane (fleet MMSI list).
 * @param {Object} record Vessel record with an `mmsi` field.
 * @returns {boolean}
 */
export function isCubaLaneVessel(record) {
  const mmsi = String(record?.mmsi ?? '').trim();
  return mmsi !== '' && FLEET_SET.has(mmsi);
}

/**
 * True when the vessel sits inside Cuban waters (see CUBA_ZONE).
 * @param {Object} record Vessel record with `lat`/`lon` (or
 *   `latitude`/`longitude`).
 * @returns {boolean}
 */
export function isInCubaZone(record) {
  const lat = Number(record?.latitude ?? record?.lat);
  const lon = Number(record?.longitude ?? record?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return (
    lat >= CUBA_ZONE.latMin &&
    lat <= CUBA_ZONE.latMax &&
    lon >= CUBA_ZONE.lonMin &&
    lon <= CUBA_ZONE.lonMax
  );
}

function vesselSpeedKn(record) {
  const speed = Number(record?.speed);
  return Number.isFinite(speed) ? speed : 0;
}

/**
 * True when the vessel is leaving Cuba: inside Cuban waters, moving, and
 * not declaring Cuba as its destination.
 * @param {Object} record Vessel record.
 * @returns {boolean}
 */
export function isDepartingCuba(record) {
  return (
    isInCubaZone(record) &&
    !isCubaBound(record) &&
    vesselSpeedKn(record) > CUBA_DEPARTING_MIN_KN
  );
}

/**
 * True when the vessel sits in Cuban waters, stationary (anchored / in
 * port), and not declaring Cuba as destination.
 * @param {Object} record Vessel record.
 * @returns {boolean}
 */
export function isAnchoredInCuba(record) {
  return (
    isInCubaZone(record) &&
    !isCubaBound(record) &&
    vesselSpeedKn(record) <= CUBA_DEPARTING_MIN_KN
  );
}

/**
 * Billboard CSS color for a Cuba-traffic vessel, or null when the vessel
 * keeps its regular type color.
 * @param {Object} record Vessel record.
 * @returns {string|null}
 */
export function cubaVesselCss(record) {
  if (isCubaBound(record)) return CUBA_BOUND_CSS;
  if (isDepartingCuba(record) || isAnchoredInCuba(record))
    return CUBA_DEPARTING_CSS;
  if (isCubaLaneVessel(record)) return CUBA_LANE_CSS;
  return null;
}

/**
 * Card accent ("r, g, b") for a Cuba-traffic vessel, or null.
 * @param {Object} record Vessel record.
 * @returns {string|null}
 */
export function cubaVesselAccent(record) {
  if (isCubaBound(record)) return CUBA_BOUND_ACCENT;
  if (isDepartingCuba(record) || isAnchoredInCuba(record))
    return CUBA_DEPARTING_ACCENT;
  if (isCubaLaneVessel(record)) return CUBA_LANE_ACCENT;
  return null;
}

/**
 * Badge for the selected-vessel card, or null.
 * @param {Object} record Vessel record.
 * @returns {{text: string, css: string}|null}
 */
export function cubaVesselBadge(record) {
  if (isCubaBound(record))
    return { text: '🇨🇺 RUMBO A CUBA', css: CUBA_BOUND_CSS };
  if (isDepartingCuba(record))
    return { text: '🇨🇺 SALIENDO DE CUBA', css: CUBA_DEPARTING_CSS };
  if (isAnchoredInCuba(record))
    return { text: '🇨🇺 EN CUBA', css: CUBA_DEPARTING_CSS };
  if (isCubaLaneVessel(record))
    return { text: '🇨🇺 RUTA CUBA', css: CUBA_LANE_CSS };
  return null;
}

/** Legend rows for the floating client legend. */
export const CUBA_LEGEND_ROWS = Object.freeze([
  {
    css: CUBA_BOUND_CSS,
    title: 'Rumbo a Cuba',
    detail: 'Destino a puerto cubano',
  },
  {
    css: CUBA_DEPARTING_CSS,
    title: 'Saliendo de Cuba',
    detail: 'En aguas cubanas rumbo afuera',
  },
  {
    css: CUBA_LANE_CSS,
    title: 'Ruta Cuba',
    detail: 'Buques de la ruta Cuba',
  },
]);
