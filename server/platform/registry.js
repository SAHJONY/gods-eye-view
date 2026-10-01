/**
 * SAHJONY Trade & Energy Platform — module registry.
 *
 * Single source of truth for every business module in the unified platform
 * (Phase 1). The owner shell (public/owner/index.html) and the JSON API
 * (GET /api/platform/modules) both read from here, so adding a module is one
 * entry — nav, shell home cards and deep links update automatically.
 *
 * Conventions:
 * - Spanish-first: every user-facing string is { es, en }.
 * - `status: 'live'` modules have a working page at `path`; `'soon'` modules
 *   are on the roadmap (their `phase` says which one) and render as disabled
 *   cards in the shell — never a dead link.
 * - Businesses stay separate: this registry covers the trade & energy
 *   platform only (MY CUBA CASH, SPORT, etc. are not listed here).
 */

export const MODULE_STATUSES = Object.freeze(['live', 'soon']);
export const MODULE_PHASES = Object.freeze(['1', '2a', '2b', '2c', '3']);

export const PLATFORM_MODULES = Object.freeze([
  {
    id: 'import-export',
    path: '/import-export/',
    icon: '📊',
    name: { es: 'Importación / Exportación', en: 'Import / Export' },
    tagline: {
      es: 'Mesa de comercio global + Cuba: Market Intel, RFQ, proveedores y envíos.',
      en: 'Global + Cuba trade desk: Market Intel, RFQs, suppliers and shipments.',
    },
    phase: '2a',
    status: 'live',
    audience: 'owner',
  },
  {
    id: 'crude',
    path: '/crude/',
    icon: '🛢️',
    name: { es: 'Petróleo crudo', en: 'Crude oil' },
    tagline: {
      es: 'Corretaje de crudo: pipeline de cargas, tanqueros y diligencia.',
      en: 'Crude brokerage: cargo pipeline, tankers and diligence.',
    },
    phase: '2c',
    status: 'live',
    audience: 'owner',
  },
  {
    id: 'energia',
    path: '/energy/',
    icon: '⚡',
    name: { es: 'Energía', en: 'Energy' },
    tagline: {
      es: 'Diésel, gasolina y gas para Cuba: especificaciones, precios y puertos.',
      en: 'Diesel, gasoline and gas for Cuba: specs, pricing and ports.',
    },
    phase: '2c',
    status: 'soon',
    audience: 'owner',
  },
  {
    id: 'carros',
    path: '/cars/',
    icon: '🚗',
    name: { es: 'Carros Cuba', en: 'Cuba cars' },
    tagline: {
      es: 'Mercado de carros para Cuba, de la A a la Z.',
      en: 'Cuba car market, A to Z.',
    },
    phase: '2c',
    status: 'soon',
    audience: 'owner',
  },
  {
    id: 'paqueteria',
    path: '/paqueteria/',
    icon: '📦',
    name: { es: 'Paquetería', en: 'Parcels' },
    tagline: {
      es: 'Agencia de paquetes: registro, QR, rastreo por paquete y avisos por WhatsApp.',
      en: 'Parcel agency: intake, QR, per-package tracking and WhatsApp notices.',
    },
    phase: '2b',
    status: 'soon',
    audience: 'owner',
  },
  {
    id: 'portal',
    path: '/portal/',
    icon: '👤',
    name: { es: 'Portal del cliente', en: 'Client portal' },
    tagline: {
      es: 'Acceso de clientes: envíos, cotizaciones y paquetes.',
      en: 'Client access: shipments, quotes and parcels.',
    },
    phase: '3',
    status: 'live',
    audience: 'both',
    adminPath: '/portal/admin.html',
  },
  {
    id: 'insurance',
    path: '/insurance/',
    icon: '🛡️',
    name: { es: 'Seguros', en: 'Insurance' },
    tagline: {
      es: 'Ajuste público + ventas: reclamos, pipeline, códigos y fuerza laboral IA.',
      en: 'Public adjusting + sales: claims, pipeline, industry codes and AI workforce.',
    },
    phase: '2c',
    status: 'live',
    audience: 'owner',
  },
  {
    id: 'suppliers',
    path: '/suppliers/',
    icon: '📇',
    name: { es: 'Directorio de proveedores', en: 'Supplier directory' },
    tagline: {
      es: 'Todos los proveedores por producto: contactos verificados, Non-OFAC y USA.',
      en: 'All suppliers by product: verified contacts, Non-OFAC and USA.',
    },
    phase: '2a',
    status: 'live',
    audience: 'owner',
  },
]);

function copyModule(m) {
  return {
    ...m,
    name: { ...m.name },
    tagline: { ...m.tagline },
  };
}

/** All modules, in nav order. Returns copies — the registry itself is frozen. */
export function listModules() {
  return PLATFORM_MODULES.map(copyModule);
}

/** One module by id, or null. Returns a copy. */
export function getModule(id) {
  const found = PLATFORM_MODULES.find((m) => m.id === id);
  return found ? copyModule(found) : null;
}

/** Only the modules with a working page. */
export function liveModules() {
  return PLATFORM_MODULES.filter((m) => m.status === 'live').map(copyModule);
}
