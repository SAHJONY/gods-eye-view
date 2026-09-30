/**
 * SAHJONY Client Portal — shipment store.
 *
 * Persisted as JSON under server/portal/data/ (gitignored). Records hold
 * CLIENT-SAFE fields only: what the client is allowed to see about their own
 * cargo. NEVER add supplier identity, acquisition cost, margin, spread or any
 * other proprietary field — this store backs a client-facing surface and its
 * rows are serialized straight to the browser (scoped by owner clientId).
 *
 * Lifecycle (see server/portal/watcher.js): pendiente → en_transito →
 * en_puerto → entregado. The first three transitions can happen autonomously
 * via the AIS watcher; entregado is always a manual owner confirmation.
 */
import { randomBytes } from 'node:crypto';
import { SERVICE_INTEREST_OPTIONS } from './clients.js';

/** pendiente → en_transito → en_puerto → entregado (entregado is manual-only) */
export const SHIPMENT_STATUSES = Object.freeze([
  'pendiente',
  'en_transito',
  'en_puerto',
  'entregado',
]);

export const SHIPMENT_STATUS_LABELS = Object.freeze({
  pendiente: 'Pendiente',
  en_transito: 'En tránsito',
  en_puerto: 'En puerto',
  entregado: 'Entregado',
});

/** Statuses the AIS watcher is allowed to evaluate (never entregado). */
export const WATCHABLE_STATUSES = Object.freeze(['pendiente', 'en_transito']);

/**
 * Short tier labels for the "Mis envíos" cards and tier filter.
 * Maps each service-interest value to its one-word card label.
 */
export const TIER_SHORT_LABELS = Object.freeze({
  'Comprar mercancía': 'Compra',
  'Enviar contenedor completo': 'Contenedor',
  'Enviar carga por pallet': 'Pallet',
  'Enviar paquetería': 'Paquetería',
  'Varios servicios': 'Varios',
});

/** Short label for a shipment's service tier ('' when the tier is unset). */
export function tierShortLabel(serviceTier) {
  return TIER_SHORT_LABELS[serviceTier] || '';
}

/** Synthetic client id for the no-password prospect demo. */
export const DEMO_CLIENT_ID = 'demo';

function newId() {
  return `shp_${randomBytes(8).toString('hex')}`;
}

function assertMmsi(value) {
  const mmsi = String(value || '').trim();
  if (!/^\d{5,10}$/.test(mmsi)) throw new Error('vesselMmsi must be 5-10 digits');
  return mmsi;
}

function assertStatus(value) {
  if (!SHIPMENT_STATUSES.includes(value)) {
    throw new Error(`status must be one of: ${SHIPMENT_STATUSES.join(', ')}`);
  }
  return value;
}

/**
 * Optional port coordinate. Empty/undefined stays undefined (manual mode);
 * otherwise must be a finite number in range.
 */
function assertCoord(value, name, min, max) {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return num;
}

/**
 * Optional container number. Validated LOOSELY on purpose: the typical BIC
 * format is 4 letters + 7 digits, but the owner must never be blocked from
 * registering a shipment because a carrier used a non-standard reference —
 * so any non-empty value (≤ 32 chars) is accepted and stored as typed.
 */
function assertContainerNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const num = String(value).trim();
  if (num.length > 32) throw new Error('containerNumber is too long');
  return num;
}

/**
 * Optional service tier (one of the portal's service-interest values).
 * Drives the tier label + filter on "Mis envíos". Empty stays unset so
 * older shipments without a tier keep rendering cleanly.
 */
function assertServiceTier(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const tier = String(value).trim();
  if (!SERVICE_INTEREST_OPTIONS.includes(tier)) {
    throw new Error('serviceTier must be one of: ' + SERVICE_INTEREST_OPTIONS.join(' / '));
  }
  return tier;
}

/** True when the shipment carries the coords the watcher needs. */
export function hasWatcherCoords(shipment) {
  return (
    Number.isFinite(shipment?.originLat) &&
    Number.isFinite(shipment?.originLon) &&
    Number.isFinite(shipment?.destLat) &&
    Number.isFinite(shipment?.destLon)
  );
}

export function createShipmentStore({ load, save } = {}) {
  /** @type {Map<string,object>} */
  const shipments = new Map();
  let loaded = false;

  function ensureLoaded() {
    if (loaded || !load) return;
    loaded = true;
    try {
      const raw = load();
      const list = Array.isArray(raw?.shipments) ? raw.shipments : [];
      for (const shipment of list) {
        if (shipment?.id && shipment?.clientId) shipments.set(shipment.id, shipment);
      }
    } catch {
      // Corrupt snapshot: start empty rather than crash.
    }
  }

  function persist() {
    if (!save) return;
    try {
      save({ shipments: [...shipments.values()] });
    } catch {
      // best-effort
    }
  }

  return {
    /**
     * Create a shipment (owner-only). All fields are client-safe by design.
     * Port coords are optional; without them the shipment stays manual-only
     * (the AIS watcher skips it).
     */
    create({
      clientId,
      vesselMmsi,
      vesselName = '',
      origin,
      destination,
      cargoLabel,
      status = 'pendiente',
      eta = '',
      containerNumber,
      serviceTier,
      originLat,
      originLon,
      destLat,
      destLon,
    }) {
      ensureLoaded();
      if (!clientId) throw new Error('clientId is required');
      origin = String(origin || '').trim();
      destination = String(destination || '').trim();
      cargoLabel = String(cargoLabel || '').trim();
      if (!origin) throw new Error('origin is required');
      if (!destination) throw new Error('destination is required');
      if (!cargoLabel) throw new Error('cargoLabel is required');
      const now = new Date().toISOString();
      const shipment = {
        id: newId(),
        clientId: String(clientId),
        vesselMmsi: assertMmsi(vesselMmsi),
        vesselName: String(vesselName || '').trim(),
        origin,
        destination,
        cargoLabel,
        status: assertStatus(status),
        eta: String(eta || '').trim(),
        containerNumber: assertContainerNumber(containerNumber),
        serviceTier: assertServiceTier(serviceTier),
        originLat: assertCoord(originLat, 'originLat', -90, 90),
        originLon: assertCoord(originLon, 'originLon', -180, 180),
        destLat: assertCoord(destLat, 'destLat', -90, 90),
        destLon: assertCoord(destLon, 'destLon', -180, 180),
        demo: false,
        createdAt: now,
        updatedAt: now,
      };
      shipments.set(shipment.id, shipment);
      persist();
      return shipment;
    },

    get(id) {
      ensureLoaded();
      return shipments.get(id) || null;
    },

    /**
     * Scoped read: returns the shipment ONLY when it belongs to clientId,
     * otherwise null (the route layer answers 404 so one client can never
     * probe another client's shipment existence).
     * The 'demo' client sees ONLY demo shipments; real clients never see them.
     */
    getForClient(id, clientId) {
      const shipment = this.get(id);
      if (!shipment) return null;
      if (clientId === DEMO_CLIENT_ID) return shipment.demo === true ? shipment : null;
      if (shipment.demo === true) return null;
      if (shipment.clientId !== clientId) return null;
      return shipment;
    },

    /** Every shipment owned by one client, newest first. Demo is separated. */
    listForClient(clientId) {
      ensureLoaded();
      const demoOnly = clientId === DEMO_CLIENT_ID;
      return [...shipments.values()]
        .filter((s) =>
          demoOnly ? s.demo === true : s.demo !== true && s.clientId === clientId,
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    /** Owner-only: every REAL shipment (demo excluded — it has its own endpoint). */
    listAll() {
      ensureLoaded();
      return [...shipments.values()]
        .filter((s) => s.demo !== true)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    /**
     * Shipments the AIS watcher should evaluate: pendiente/en_transito WITH
     * port coords. Demo shipments are permanently en tránsito for show and
     * are NEVER auto-activated.
     */
    listForWatcher() {
      ensureLoaded();
      return [...shipments.values()].filter(
        (s) =>
          s.demo !== true &&
          WATCHABLE_STATUSES.includes(s.status) &&
          hasWatcherCoords(s),
      );
    },

    /**
     * The single demo shipment (Juan's prospect demo). Created lazily on the
     * first demo login; flagged demo:true so it never mixes with real data.
     */
    ensureDemoShipment(attrs = {}) {
      ensureLoaded();
      for (const shipment of shipments.values()) {
        if (shipment.demo === true) return shipment;
      }
      const now = new Date().toISOString();
      const shipment = {
        id: newId(),
        clientId: DEMO_CLIENT_ID,
        vesselMmsi: assertMmsi(attrs.vesselMmsi || '244780354'),
        vesselName: String(attrs.vesselName || 'MICHIEL DE RUYTER').trim(),
        origin: String(attrs.origin || 'Puerto de Houston').trim(),
        destination: String(attrs.destination || 'Puerto del Mariel').trim(),
        cargoLabel: String(attrs.cargoLabel || 'Contenedor 40ft — alimentos').trim(),
        status: 'en_transito',
        eta: String(attrs.eta || '').trim(),
        containerNumber: 'MSKU 7654321',
        serviceTier: 'Enviar contenedor completo',
        originLat: 29.72,
        originLon: -95.08,
        destLat: 23.01,
        destLon: -82.75,
        demo: true,
        createdAt: now,
        updatedAt: now,
      };
      shipments.set(shipment.id, shipment);
      persist();
      return shipment;
    },

    /** The demo shipment for the owner console (null when never seeded). */
    getDemo() {
      ensureLoaded();
      for (const shipment of shipments.values()) {
        if (shipment.demo === true) return shipment;
      }
      return null;
    },

    /**
     * Owner update of the demo shipment (e.g. point it at another live
     * vessel). Whitelisted fields only; demo:true can never be unset here.
     */
    updateDemo(patch = {}) {
      ensureLoaded();
      const shipment = this.getDemo();
      if (!shipment) return null;
      const allowed = [
        'vesselMmsi', 'vesselName', 'origin', 'destination', 'cargoLabel',
        'eta', 'containerNumber', 'serviceTier',
        'originLat', 'originLon', 'destLat', 'destLon',
      ];
      for (const key of allowed) {
        if (patch[key] === undefined) continue;
        if (key === 'vesselMmsi') shipment.vesselMmsi = assertMmsi(patch[key]);
        else if (key === 'containerNumber') shipment.containerNumber = assertContainerNumber(patch[key]);
        else if (key === 'serviceTier') shipment.serviceTier = assertServiceTier(patch[key]);
        else if (key === 'originLat') shipment.originLat = assertCoord(patch[key], 'originLat', -90, 90);
        else if (key === 'originLon') shipment.originLon = assertCoord(patch[key], 'originLon', -180, 180);
        else if (key === 'destLat') shipment.destLat = assertCoord(patch[key], 'destLat', -90, 90);
        else if (key === 'destLon') shipment.destLon = assertCoord(patch[key], 'destLon', -180, 180);
        else shipment[key] = String(patch[key]).trim();
      }
      shipment.status = 'en_transito'; // permanently for show
      shipment.updatedAt = new Date().toISOString();
      persist();
      return shipment;
    },

    /**
     * Owner update. Whitelisted client-safe fields only. The owner can set any
     * status manually — this is the override fallback for AIS coverage gaps.
     */
    update(id, patch = {}) {
      ensureLoaded();
      const shipment = shipments.get(id);
      if (!shipment) return null;
      const allowed = [
        'vesselMmsi',
        'vesselName',
        'origin',
        'destination',
        'cargoLabel',
        'status',
        'eta',
        'containerNumber',
        'serviceTier',
        'clientId',
        'originLat',
        'originLon',
        'destLat',
        'destLon',
      ];
      for (const key of allowed) {
        if (patch[key] === undefined) continue;
        if (key === 'vesselMmsi') shipment.vesselMmsi = assertMmsi(patch[key]);
        else if (key === 'status') shipment.status = assertStatus(patch[key]);
        else if (key === 'containerNumber') shipment.containerNumber = assertContainerNumber(patch[key]);
        else if (key === 'serviceTier') shipment.serviceTier = assertServiceTier(patch[key]);
        else if (key === 'originLat') shipment.originLat = assertCoord(patch[key], 'originLat', -90, 90);
        else if (key === 'originLon') shipment.originLon = assertCoord(patch[key], 'originLon', -180, 180);
        else if (key === 'destLat') shipment.destLat = assertCoord(patch[key], 'destLat', -90, 90);
        else if (key === 'destLon') shipment.destLon = assertCoord(patch[key], 'destLon', -180, 180);
        else shipment[key] = String(patch[key]).trim();
      }
      if (patch.origin !== undefined && !shipment.origin) throw new Error('origin cannot be empty');
      if (patch.destination !== undefined && !shipment.destination) throw new Error('destination cannot be empty');
      if (patch.cargoLabel !== undefined && !shipment.cargoLabel) throw new Error('cargoLabel cannot be empty');
      shipment.updatedAt = new Date().toISOString();
      persist();
      return shipment;
    },

    delete(id) {
      ensureLoaded();
      const existed = shipments.delete(id);
      if (existed) persist();
      return existed;
    },

    _size() {
      ensureLoaded();
      return shipments.size;
    },
  };
}
