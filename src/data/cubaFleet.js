/**
 * Cuba fleet — the tracked US–Cuba traffic-lane vessels.
 * Single source of truth for the fleet deep-link (`#fleet=cuba`).
 * SEABOARD GALAXY has no MMSI on record yet, so it is listed by name only.
 */
export const CUBA_FLEET_ID = 'cuba';

export const CUBA_FLEET_MMSI = Object.freeze([
  '304304000', // REGULA
  '636025531', // SEABOARD RANGER
  '636091731', // SEABOARD OCEAN
  '636021440', // SEABOARD PRIDE
  '636025203', // SEABOARD VALOR
  '636025683', // SEABOARD VENTURE
  '352001274', // ASIAN KATRA
  '354380000', // ASMAR
  '304010708', // PERA
  '305799000', // BF-AYITA
  '353600000', // OCEAN-INTEGRITY
  '275544000', // AZURE
]);

export const CUBA_FLEET_NAMES = Object.freeze({
  304304000: 'REGULA',
  636025531: 'SEABOARD RANGER',
  636091731: 'SEABOARD OCEAN',
  636021440: 'SEABOARD PRIDE',
  636025203: 'SEABOARD VALOR',
  636025683: 'SEABOARD VENTURE',
  352001274: 'ASIAN KATRA',
  354380000: 'ASMAR',
  304010708: 'PERA',
  305799000: 'BF-AYITA',
  353600000: 'OCEAN-INTEGRITY',
  275544000: 'AZURE',
});

/** Fallback camera view (Florida strait / Cuba corridor) when no fleet vessel is in the live feed. */
export const CUBA_FLEET_DEFAULT_VIEW = Object.freeze({
  lat: 24.2,
  lon: -80.8,
  rangeM: 4200000,
});
