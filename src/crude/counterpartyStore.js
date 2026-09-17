// Crude brokerage pipeline store — localStorage persistence, guarded for non-browser.
// Key: 'sahjony.crude.v1'. Falls back to in-memory storage outside a browser.
// Cargoes (deal pipeline) + counterparties (suppliers/buyers). No cesium,
// no network, no API keys. Honesty convention: missing data is reported,
// never invented; names/contacts stay empty until Juan adds them.

import { scoreCargo, brokerCommission } from './cargoEngine.js';

export const STORAGE_KEY = 'sahjony.crude.v1';

export const CARGO_STATUSES = Object.freeze([
  'prospect',
  'diligence',
  'negotiating',
  'contracted',
  'loading',
  'in-transit',
  'delivered',
  'closed',
  'dead',
]);

export const STATUS_LABELS = Object.freeze({
  prospect: { es: 'Prospecto', en: 'Prospect' },
  diligence: { es: 'Diligencia', en: 'Diligence' },
  negotiating: { es: 'Negociando', en: 'Negotiating' },
  contracted: { es: 'Contratado', en: 'Contracted' },
  loading: { es: 'Cargando', en: 'Loading' },
  'in-transit': { es: 'En tránsito', en: 'In transit' },
  delivered: { es: 'Entregado', en: 'Delivered' },
  closed: { es: 'Cerrado', en: 'Closed' },
  dead: { es: 'Descartado', en: 'Dead' },
});

export const COUNTERPARTY_TYPES = Object.freeze([
  'producer',
  'noc',
  'trader',
  'refinery',
  'end-user',
]);

export const COUNTERPARTY_ROLES = Object.freeze(['supplier', 'buyer', 'both']);

export const VERIFICATION = Object.freeze([
  'unverified',
  'in-review',
  'verified',
  'flagged',
]);

export const VERIFICATION_LABELS = Object.freeze({
  unverified: { es: 'Sin verificar', en: 'Unverified' },
  'in-review': { es: 'En revisión', en: 'In review' },
  verified: { es: 'Verificado', en: 'Verified' },
  flagged: { es: 'Marcado', en: 'Flagged' },
});

const memoryStorage = (() => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
})();

function storageBackend() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      // Probe — some contexts define localStorage but throw on access.
      const probe = '__sahjony_crude_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStorage;
}

/** ISO timestamp with America/Chicago offset, e.g. 2026-09-17T00:51:00-05:00. */
export function chicagoIso(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  const local = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;

  const utcMs = d.getTime();
  const chicagoWall = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  );
  const offsetMin = Math.round((chicagoWall - utcMs) / 60000);
  const sign = offsetMin <= 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local}${sign}${hh}:${mm}`;
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function coerceCargoStatus(status) {
  if (typeof status === 'string' && CARGO_STATUSES.includes(status))
    return status;
  throw new Error(`Unknown crude cargo status: ${String(status)}`);
}

function coerceCounterpartyType(type) {
  return COUNTERPARTY_TYPES.includes(type) ? type : 'trader';
}

function coerceCounterpartyRole(role) {
  return COUNTERPARTY_ROLES.includes(role) ? role : 'both';
}

function coerceVerification(verification) {
  return VERIFICATION.includes(verification) ? verification : 'unverified';
}

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const asMoney = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Coordinates stay null when blank — never (0,0) from missing input. */
const asLatLng = (value) => {
  if (value === undefined || value === null || String(value).trim() === '')
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeName = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

function normalizeCargo(data = {}) {
  const cargo = {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    ref: asText(data.ref),
    grade: asText(data.grade),
    volumeBbl: asMoney(data.volumeBbl),
    buyPrice: asMoney(data.buyPrice),
    sellPrice: asMoney(data.sellPrice),
    commissionPerBbl: asMoney(data.commissionPerBbl),
    incoterms: asText(data.incoterms),
    laycanStart: asText(data.laycanStart),
    laycanEnd: asText(data.laycanEnd),
    loadPort: asText(data.loadPort),
    dischargePort: asText(data.dischargePort),
    loadLat: asLatLng(data.loadLat),
    loadLng: asLatLng(data.loadLng),
    dischargeLat: asLatLng(data.dischargeLat),
    dischargeLng: asLatLng(data.dischargeLng),
    supplierId: asText(data.supplierId),
    buyerId: asText(data.buyerId),
    status: data.status ? coerceCargoStatus(data.status) : 'prospect',
    notes: typeof data.notes === 'string' ? data.notes : '',
    costs: {
      freight: asMoney(data.costs?.freight),
      insurance: asMoney(data.costs?.insurance),
      inspection: asMoney(data.costs?.inspection),
      other: asMoney(data.costs?.other),
    },
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...n }))
      : [],
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
  cargo.score =
    Number.isFinite(Number(data.score)) && data.score !== undefined
      ? Math.min(100, Math.max(0, Math.round(Number(data.score))))
      : scoreCargo(cargo);
  return cargo;
}

function normalizeCounterparty(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    name: asText(data.name),
    type: coerceCounterpartyType(data.type),
    role: coerceCounterpartyRole(data.role),
    country: asText(data.country),
    contact: {
      name: asText(data.contact?.name),
      phone: asText(data.contact?.phone),
      email: asText(data.contact?.email),
    },
    verification: coerceVerification(data.verification),
    notes: typeof data.notes === 'string' ? data.notes : '',
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...n }))
      : [],
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

class CrudeStore {
  constructor() {
    this.backend = storageBackend();
    this.db = this.load();
  }

  load() {
    try {
      const raw = this.backend.getItem(STORAGE_KEY);
      if (!raw) return { cargoes: [], counterparties: [] };
      const parsed = JSON.parse(raw);
      return {
        cargoes: Array.isArray(parsed.cargoes) ? parsed.cargoes : [],
        counterparties: Array.isArray(parsed.counterparties)
          ? parsed.counterparties
          : [],
      };
    } catch {
      return { cargoes: [], counterparties: [] };
    }
  }

  save() {
    try {
      this.backend.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* persistence is best-effort */
    }
  }

  /** Clear all cargoes and counterparties (used by tests). */
  reset() {
    this.db = { cargoes: [], counterparties: [] };
    this.save();
  }

  // ---- Counterparties ----
  findDuplicateCounterparty(data) {
    const name = normalizeName(data.name);
    const country = normalizeName(data.country);
    if (!name || !country) return null;
    return (
      this.db.counterparties.find(
        (cp) =>
          normalizeName(cp.name) === name &&
          normalizeName(cp.country) === country,
      ) ?? null
    );
  }

  createCounterparty(data = {}) {
    const existing = this.findDuplicateCounterparty(data);
    if (existing) return existing;
    const cp = normalizeCounterparty(data);
    this.db.counterparties.push(cp);
    this.save();
    return cp;
  }

  getCounterparty(id) {
    return this.db.counterparties.find((c) => c.id === id) ?? null;
  }

  updateCounterparty(id, patch = {}) {
    const cp = this.getCounterparty(id);
    if (!cp) return null;
    const merged = normalizeCounterparty({ ...cp, ...patch, id: cp.id });
    merged.createdAt = cp.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(cp, merged);
    this.save();
    return cp;
  }

  deleteCounterparty(id) {
    const index = this.db.counterparties.findIndex((c) => c.id === id);
    if (index < 0) return false;
    this.db.counterparties.splice(index, 1);
    this.save();
    return true;
  }

  listCounterparties(filter) {
    const cps = [...this.db.counterparties];
    if (!filter) return cps;
    if (typeof filter === 'function') return cps.filter(filter);
    return cps.filter((cp) =>
      Object.entries(filter).every(([key, value]) => cp[key] === value),
    );
  }

  addCounterpartyNote(cpId, agent, es, en) {
    const cp = this.getCounterparty(cpId);
    if (!cp) return null;
    const note = {
      agent: typeof agent === 'string' ? agent : '',
      es: typeof es === 'string' ? es : '',
      en: typeof en === 'string' ? en : '',
      at: chicagoIso(),
    };
    cp.agentNotes.push(note);
    cp.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Cargoes ----
  findDuplicateCargo(data) {
    const ref = normalizeName(data.ref);
    if (!ref) return null;
    return (
      this.db.cargoes.find((cargo) => normalizeName(cargo.ref) === ref) ?? null
    );
  }

  createCargo(data = {}) {
    const existing = this.findDuplicateCargo(data);
    if (existing) return existing;
    const cargo = normalizeCargo(data);
    this.db.cargoes.push(cargo);
    this.save();
    return cargo;
  }

  getCargo(id) {
    return this.db.cargoes.find((c) => c.id === id) ?? null;
  }

  updateCargo(id, patch = {}) {
    const cargo = this.getCargo(id);
    if (!cargo) return null;
    const merged = normalizeCargo({ ...cargo, ...patch, id: cargo.id });
    merged.createdAt = cargo.createdAt;
    merged.score = Object.prototype.hasOwnProperty.call(patch, 'score')
      ? merged.score
      : scoreCargo(merged);
    merged.updatedAt = chicagoIso();
    Object.assign(cargo, merged);
    this.save();
    return cargo;
  }

  moveCargo(id, status) {
    const cargo = this.getCargo(id);
    if (!cargo) return null;
    cargo.status = coerceCargoStatus(status);
    cargo.updatedAt = chicagoIso();
    this.save();
    return cargo;
  }

  deleteCargo(id) {
    const index = this.db.cargoes.findIndex((c) => c.id === id);
    if (index < 0) return false;
    this.db.cargoes.splice(index, 1);
    this.save();
    return true;
  }

  listCargoes(filter) {
    const cargoes = [...this.db.cargoes];
    if (!filter) return cargoes;
    if (typeof filter === 'function') return cargoes.filter(filter);
    return cargoes.filter((cargo) =>
      Object.entries(filter).every(([key, value]) => {
        if (key === 'minScore') return (cargo.score ?? 0) >= value;
        return cargo[key] === value;
      }),
    );
  }

  addCargoNote(cargoId, agent, es, en) {
    const cargo = this.getCargo(cargoId);
    if (!cargo) return null;
    const note = {
      agent: typeof agent === 'string' ? agent : '',
      es: typeof es === 'string' ? es : '',
      en: typeof en === 'string' ? en : '',
      at: chicagoIso(),
    };
    cargo.agentNotes.push(note);
    cargo.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Stats ----
  stats() {
    const cargoes = this.db.cargoes;
    const byStatus = {};
    for (const status of CARGO_STATUSES) byStatus[status] = 0;
    let openCargoes = 0;
    let totalVolumeBbl = 0;
    let potentialCommission = 0;
    for (const cargo of cargoes) {
      const status = CARGO_STATUSES.includes(cargo.status)
        ? cargo.status
        : 'prospect';
      byStatus[status] += 1;
      const open = status !== 'closed' && status !== 'dead';
      if (open) {
        openCargoes += 1;
        totalVolumeBbl += safeVolume(cargo.volumeBbl);
        potentialCommission += brokerCommission(cargo);
      }
    }
    const counterparties = this.db.counterparties;
    return {
      totalCargoes: cargoes.length,
      openCargoes,
      byStatus,
      totalVolumeBbl,
      potentialCommission: Math.round(potentialCommission),
      totalCounterparties: counterparties.length,
      verifiedCounterparties: counterparties.filter(
        (cp) => cp.verification === 'verified',
      ).length,
    };
  }
}

function safeVolume(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const noteKey = (note) =>
  `${note?.at ?? ''}|${note?.agent ?? ''}|${note?.es ?? ''}`;

const store = new CrudeStore();

// ---- Public API (mirrors the wholesale store names) ----
export const createCounterparty = (data) => store.createCounterparty(data);
export const getCounterparty = (id) => store.getCounterparty(id);
export const updateCounterparty = (id, patch) =>
  store.updateCounterparty(id, patch);
export const deleteCounterparty = (id) => store.deleteCounterparty(id);
export const listCounterparties = (filter) => store.listCounterparties(filter);
export const addCounterpartyNote = (cpId, agent, es, en) =>
  store.addCounterpartyNote(cpId, agent, es, en);

export const createCargo = (data) => store.createCargo(data);
export const getCargo = (id) => store.getCargo(id);
export const updateCargo = (id, patch) => store.updateCargo(id, patch);
export const moveCargo = (id, status) => store.moveCargo(id, status);
export const deleteCargo = (id) => store.deleteCargo(id);
export const listCargoes = (filter) => store.listCargoes(filter);
export const addCargoNote = (cargoId, agent, es, en) =>
  store.addCargoNote(cargoId, agent, es, en);

export const stats = () => store.stats();

/**
 * Workforce-adapter view over cargoes. The AI workforce agent expects
 * notes shaped {t, agent, es, en}; cargoes store them as {at, agent, es, en}.
 */
export function asWorkforceStore() {
  return {
    getAll: () => store.listCargoes(),
    get: (id) => store.getCargo(id),
    update: (id, patch = {}) => {
      const cargo = store.getCargo(id);
      if (!cargo) return null;
      const { agentNotes, ...rest } = patch;
      const updated = store.updateCargo(id, rest);
      if (updated && Array.isArray(agentNotes)) {
        const seen = new Set(updated.agentNotes.map(noteKey));
        for (const raw of agentNotes) {
          if (!raw || typeof raw !== 'object') continue;
          const key = noteKey(raw);
          if (seen.has(key)) continue;
          seen.add(key);
          updated.agentNotes.push({ ...raw });
        }
        updated.updatedAt = chicagoIso();
        store.save();
      }
      return updated;
    },
    notes: (id) => {
      const cargo = store.getCargo(id);
      if (!cargo) return [];
      return (cargo.agentNotes || []).map((n) => ({
        t: n.at,
        agent: n.agent,
        es: n.es,
        en: n.en,
      }));
    },
  };
}

/** Testing / maintenance helper: wipe the store. */
export const resetCrudeStore = () => store.reset();

/** Exposed for tests: force reload from the storage backend. */
export const reloadCrudeStore = () => {
  store.db = store.load();
  return store.db;
};
