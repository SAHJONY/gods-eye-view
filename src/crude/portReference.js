// Static vessel/port reference for the crude desk — pure, zero dependencies.
// Real ports and terminals relevant to the desk, reference data ONLY.
// No live vessel tracking (free-only rule), no invented terminals.
// Coordinates are approximate map references, not navigation data.

/**
 * Curated reference ports. type:
 *  - 'sts': ship-to-ship transfer area
 *  - 'load': loading terminal
 *  - 'hub': major bunkering/trading hub
 */
export const PORTS = Object.freeze([
  {
    id: 'sohar-sts',
    name: 'Sohar STS area',
    country: 'Oman',
    type: 'sts',
    lat: 24.65,
    lng: 56.75,
    es: 'Área de transferencia buque a buque frente a Sohar, Omán — punto típico de STS en el Golfo de Omán.',
    en: 'Ship-to-ship transfer area off Sohar, Oman — typical Gulf of Oman STS point.',
  },
  {
    id: 'yanbu',
    name: 'Yanbu',
    country: 'Saudi Arabia',
    type: 'load',
    lat: 24.08,
    lng: 38.06,
    es: 'Terminal de carga en el Mar Rojo, Arabia Saudita — salida del oleoducto Este-Oeste.',
    en: 'Red Sea loading terminal, Saudi Arabia — outlet of the East-West pipeline.',
  },
  {
    id: 'fujairah',
    name: 'Fujairah',
    country: 'United Arab Emirates',
    type: 'hub',
    lat: 25.12,
    lng: 56.34,
    es: 'Centro de bunkering y almacenamiento en la costa este de EAU, fuera del Estrecho de Ormuz.',
    en: 'Bunkering and storage hub on the UAE east coast, outside the Strait of Hormuz.',
  },
]);

export const PORT_TYPES = Object.freeze(['sts', 'load', 'hub']);

export const PORT_TYPE_LABELS = Object.freeze({
  sts: { es: 'Transferencia STS', en: 'STS transfer' },
  load: { es: 'Terminal de carga', en: 'Loading terminal' },
  hub: { es: 'Centro / hub', en: 'Hub' },
});

/** Find a reference port by id. Null when unknown — never invents. */
export function findPort(id) {
  if (typeof id !== 'string') return null;
  const key = id.trim().toLowerCase();
  return PORTS.find((p) => p.id === key) ?? null;
}

/** Reference ports filtered by type. Empty array for unknown types. */
export function portsByType(type) {
  if (!PORT_TYPES.includes(type)) return [];
  return PORTS.filter((p) => p.type === type);
}

/** Bilingual one-line label for a port entry. */
export function portLabel(port, lang = 'es') {
  if (!port) return lang === 'es' ? 'Puerto desconocido' : 'Unknown port';
  return `${port.name} — ${port.country}`;
}

/** Approximate-coordinates disclaimer (bilingual). */
export const COORDS_DISCLAIMER = Object.freeze({
  es: 'Coordenadas aproximadas, solo referencia en mapa — no para navegación.',
  en: 'Approximate coordinates, map reference only — not for navigation.',
});
