/**
 * Cuba vessel styling — SAHJONY LIVE VIEW.
 *
 * Two client-facing cohorts get their own billboard colors so anyone can
 * spot Cuba traffic at a glance:
 *  - "Rumbo a Cuba" (green #00e676): the AIS destination names a Cuban port.
 *  - "Ruta Cuba"    (gold  #ffc107): known Cuba-lane vessels (fleet MMSIs).
 *
 * Bound beats lane: a fleet vessel currently sailing to Cuba shows green.
 */
import { CUBA_FLEET_MMSI } from './cubaFleet.js';

export const CUBA_BOUND_CSS = '#00e676';
export const CUBA_LANE_CSS = '#ffc107';
export const CUBA_BOUND_ACCENT = '0, 230, 118';
export const CUBA_LANE_ACCENT = '255, 193, 7';

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
 * Billboard CSS color for a Cuba-traffic vessel, or null when the vessel
 * keeps its regular type color.
 * @param {Object} record Vessel record.
 * @returns {string|null}
 */
export function cubaVesselCss(record) {
  if (isCubaBound(record)) return CUBA_BOUND_CSS;
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
    css: CUBA_LANE_CSS,
    title: 'Ruta Cuba',
    detail: 'Buques de la ruta Cuba',
  },
]);
