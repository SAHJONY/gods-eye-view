// Import/Export RFQ pipeline store — localStorage persistence, guarded for non-browser.
// Key: 'sahjony.trade.v1'. Falls back to in-memory storage outside a browser.
// RFQs (deal pipeline) + suppliers (manufacturers, distributors, traders, logistics).
// No cesium, no network, no API keys. Honesty convention: missing data is
// reported, never invented; supplier/buyer names stay empty until Juan adds
// them. Costs are flattened on the RFQ (freight, duties, otherCosts).
// Mirrors src/crude/counterpartyStore.js.

import { scoreRfq, commissionAmount } from './rfqEngine.js';

export const STORAGE_KEY = 'sahjony.trade.v1';

export const RFQ_STATUSES = Object.freeze([
  'prospect',
  'contacted',
  'quoting',
  'negotiating',
  'won',
  'lost',
]);

export const STATUS_LABELS = Object.freeze({
  prospect: { es: 'Prospecto', en: 'Prospect' },
  contacted: { es: 'Contactado', en: 'Contacted' },
  quoting: { es: 'Cotizando', en: 'Quoting' },
  negotiating: { es: 'Negociando', en: 'Negotiating' },
  won: { es: 'Ganado', en: 'Won' },
  lost: { es: 'Perdido', en: 'Lost' },
});

/** Statuses that keep an RFQ in the open pipeline. */
export const OPEN_STATUSES = Object.freeze(
  RFQ_STATUSES.filter((s) => s !== 'won' && s !== 'lost'),
);

export const SUPPLIER_TYPES = Object.freeze([
  'manufacturer',
  'distributor',
  'trader',
  'logistics',
]);

export const SUPPLIER_TYPE_LABELS = Object.freeze({
  manufacturer: { es: 'Fabricante', en: 'Manufacturer' },
  distributor: { es: 'Distribuidor', en: 'Distributor' },
  trader: { es: 'Comercializadora', en: 'Trader' },
  logistics: { es: 'Logística', en: 'Logistics' },
});

export const SUPPLIER_ROLES = Object.freeze(['supplier', 'buyer', 'both']);

export const SUPPLIER_ROLE_LABELS = Object.freeze({
  supplier: { es: 'Proveedor', en: 'Supplier' },
  buyer: { es: 'Comprador', en: 'Buyer' },
  both: { es: 'Ambos', en: 'Both' },
});

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
      const probe = '__sahjony_trade_probe__';
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

function coerceRfqStatus(status) {
  if (typeof status === 'string' && RFQ_STATUSES.includes(status))
    return status;
  throw new Error(`Unknown trade RFQ status: ${String(status)}`);
}

function coerceSupplierType(type) {
  return SUPPLIER_TYPES.includes(type) ? type : 'trader';
}

function coerceSupplierRole(role) {
  return SUPPLIER_ROLES.includes(role) ? role : 'both';
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

function normalizeAgentNote(raw = {}) {
  return {
    at: asText(raw.at) || asText(raw.t),
    agent: asText(raw.agent),
    es: asText(raw.es),
    en: asText(raw.en),
  };
}

function normalizeRfq(data = {}) {
  const rfq = {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    ref: asText(data.ref),
    product: asText(data.product),
    quantity: asMoney(data.quantity),
    unitCost: asMoney(data.unitCost),
    sellUnitPrice: asMoney(data.sellUnitPrice),
    freight: asMoney(data.freight),
    duties: asMoney(data.duties),
    otherCosts: asMoney(data.otherCosts),
    commissionPct: asMoney(data.commissionPct),
    incoterms: asText(data.incoterms),
    originPort: asText(data.originPort),
    destinationPort: asText(data.destinationPort),
    originLat: asLatLng(data.originLat),
    originLng: asLatLng(data.originLng),
    destLat: asLatLng(data.destLat),
    destLng: asLatLng(data.destLng),
    supplierId: asText(data.supplierId),
    buyerId: asText(data.buyerId),
    status: data.status ? coerceRfqStatus(data.status) : 'prospect',
    // Intake & desk routing (see src/trade/tradeIntake.js). intakeAt is
    // stamped at creation when missing; desk defaults to the worldwide
    // 'trade' desk and is only 'cuba' when explicitly set.
    intakeAt: asText(data.intakeAt),
    desk: asText(data.desk) === 'cuba' ? 'cuba' : 'trade',
    // Live-deal marker + provenance (real 2026 deals only; source names
    // where each fact was verified — never invented).
    liveDeal: data.liveDeal === true,
    source: asText(data.source),
    sourceDate: asText(data.sourceDate),
    notes: typeof data.notes === 'string' ? data.notes : '',
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...normalizeAgentNote(n) }))
      : [],
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
  if (!rfq.intakeAt) rfq.intakeAt = rfq.createdAt;
  rfq.score =
    Number.isFinite(Number(data.score)) && data.score !== undefined
      ? Math.min(100, Math.max(0, Math.round(Number(data.score))))
      : scoreRfq(rfq);
  return rfq;
}

function normalizeSupplier(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    name: asText(data.name),
    type: coerceSupplierType(data.type),
    role: coerceSupplierRole(data.role),
    country: asText(data.country),
    contact: {
      name: asText(data.contact?.name),
      phone: asText(data.contact?.phone),
      email: asText(data.contact?.email),
    },
    verification: coerceVerification(data.verification),
    notes: typeof data.notes === 'string' ? data.notes : '',
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...normalizeAgentNote(n) }))
      : [],
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

class TradeStore {
  constructor() {
    this.backend = storageBackend();
    this.db = this.load();
  }

  load() {
    try {
      const raw = this.backend.getItem(STORAGE_KEY);
      if (!raw) return { rfqs: [], suppliers: [] };
      const parsed = JSON.parse(raw);
      return {
        rfqs: Array.isArray(parsed.rfqs) ? parsed.rfqs : [],
        suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
      };
    } catch {
      return { rfqs: [], suppliers: [] };
    }
  }

  save() {
    try {
      this.backend.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* persistence is best-effort */
    }
  }

  /** Clear all RFQs and suppliers (used by tests). */
  reset() {
    this.db = { rfqs: [], suppliers: [] };
    this.save();
  }

  // ---- Suppliers ----
  findDuplicateSupplier(data) {
    const name = normalizeName(data.name);
    const country = normalizeName(data.country);
    if (!name || !country) return null;
    return (
      this.db.suppliers.find(
        (s) =>
          normalizeName(s.name) === name &&
          normalizeName(s.country) === country,
      ) ?? null
    );
  }

  createSupplier(data = {}) {
    const existing = this.findDuplicateSupplier(data);
    if (existing) return existing;
    const supplier = normalizeSupplier(data);
    this.db.suppliers.push(supplier);
    this.save();
    return supplier;
  }

  getSupplier(id) {
    return this.db.suppliers.find((s) => s.id === id) ?? null;
  }

  updateSupplier(id, patch = {}) {
    const supplier = this.getSupplier(id);
    if (!supplier) return null;
    const merged = normalizeSupplier({
      ...supplier,
      ...patch,
      id: supplier.id,
    });
    merged.createdAt = supplier.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(supplier, merged);
    this.save();
    return supplier;
  }

  deleteSupplier(id) {
    const index = this.db.suppliers.findIndex((s) => s.id === id);
    if (index < 0) return false;
    this.db.suppliers.splice(index, 1);
    this.save();
    return true;
  }

  listSuppliers(filter) {
    const suppliers = [...this.db.suppliers];
    if (!filter) return suppliers;
    if (typeof filter === 'function') return suppliers.filter(filter);
    return suppliers.filter((s) =>
      Object.entries(filter).every(([key, value]) => s[key] === value),
    );
  }

  addSupplierNote(supplierId, agent, es, en) {
    const supplier = this.getSupplier(supplierId);
    if (!supplier) return null;
    const note = normalizeAgentNote({ agent, es, en });
    note.at = chicagoIso();
    supplier.agentNotes.push(note);
    supplier.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- RFQs ----
  findDuplicateRfq(data) {
    const ref = normalizeName(data.ref);
    if (!ref) return null;
    return this.db.rfqs.find((rfq) => normalizeName(rfq.ref) === ref) ?? null;
  }

  /** RFQs flagged as live deals (seeded real 2026 deals), oldest first. */
  listLiveDeals() {
    return this.db.rfqs
      .filter((r) => r && r.liveDeal === true)
      .sort((a, b) => String(a.ref || '').localeCompare(String(b.ref || '')));
  }

  /** Resolve the linked supplier + buyer records for an RFQ. */
  linkedCounterparties(rfqId) {
    const rfq = this.getRfq(rfqId);
    if (!rfq) return { supplier: null, buyer: null };
    const byId = (id) =>
      id ? this.db.suppliers.find((s) => s.id === id) ?? null : null;
    return { supplier: byId(rfq.supplierId), buyer: byId(rfq.buyerId) };
  }

  /** Set a counterparty's verification state (validated). */
  setVerification(id, verification) {
    const supplier = this.getSupplier(id);
    if (!supplier) return null;
    return this.updateSupplier(id, { verification });
  }

  createRfq(data = {}) {
    const existing = this.findDuplicateRfq(data);
    if (existing) return existing;
    const rfq = normalizeRfq(data);
    this.db.rfqs.push(rfq);
    this.save();
    return rfq;
  }

  getRfq(id) {
    return this.db.rfqs.find((r) => r.id === id) ?? null;
  }

  updateRfq(id, patch = {}) {
    const rfq = this.getRfq(id);
    if (!rfq) return null;
    const merged = normalizeRfq({ ...rfq, ...patch, id: rfq.id });
    merged.createdAt = rfq.createdAt;
    merged.score = Object.prototype.hasOwnProperty.call(patch, 'score')
      ? merged.score
      : scoreRfq(merged);
    merged.updatedAt = chicagoIso();
    Object.assign(rfq, merged);
    this.save();
    return rfq;
  }

  moveRfq(id, status) {
    const rfq = this.getRfq(id);
    if (!rfq) return null;
    rfq.status = coerceRfqStatus(status);
    rfq.updatedAt = chicagoIso();
    this.save();
    return rfq;
  }

  deleteRfq(id) {
    const index = this.db.rfqs.findIndex((r) => r.id === id);
    if (index < 0) return false;
    this.db.rfqs.splice(index, 1);
    this.save();
    return true;
  }

  listRfqs(filter) {
    const rfqs = [...this.db.rfqs];
    if (!filter) return rfqs;
    if (typeof filter === 'function') return rfqs.filter(filter);
    return rfqs.filter((rfq) =>
      Object.entries(filter).every(([key, value]) => {
        if (key === 'minScore') return (rfq.score ?? 0) >= value;
        return rfq[key] === value;
      }),
    );
  }

  addRfqNote(rfqId, agent, es, en) {
    const rfq = this.getRfq(rfqId);
    if (!rfq) return null;
    const note = normalizeAgentNote({ agent, es, en });
    note.at = chicagoIso();
    rfq.agentNotes.push(note);
    rfq.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Stats ----
  stats() {
    const rfqs = this.db.rfqs;
    const byStatus = {};
    for (const status of RFQ_STATUSES) byStatus[status] = 0;
    let openRfqs = 0;
    let totalQuantity = 0;
    let potentialCommission = 0;
    for (const rfq of rfqs) {
      const status = RFQ_STATUSES.includes(rfq.status)
        ? rfq.status
        : 'prospect';
      byStatus[status] += 1;
      if (OPEN_STATUSES.includes(status)) {
        openRfqs += 1;
        totalQuantity += safeQuantity(rfq.quantity);
        potentialCommission += commissionAmount(rfq);
      }
    }
    const suppliers = this.db.suppliers;
    return {
      totalRfqs: rfqs.length,
      openRfqs,
      byStatus,
      totalQuantity,
      potentialCommission: Math.round(potentialCommission),
      totalSuppliers: suppliers.length,
      verifiedSuppliers: suppliers.filter((s) => s.verification === 'verified')
        .length,
    };
  }
}

function safeQuantity(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const noteKey = (note) =>
  `${note?.at ?? ''}|${note?.agent ?? ''}|${note?.es ?? ''}`;

const store = new TradeStore();

// ---- Public API (mirrors the crude store names) ----
export const createSupplier = (data) => store.createSupplier(data);
export const getSupplier = (id) => store.getSupplier(id);
export const updateSupplier = (id, patch) => store.updateSupplier(id, patch);
export const deleteSupplier = (id) => store.deleteSupplier(id);
export const listSuppliers = (filter) => store.listSuppliers(filter);
export const addSupplierNote = (supplierId, agent, es, en) =>
  store.addSupplierNote(supplierId, agent, es, en);

export const createRfq = (data) => store.createRfq(data);
export const getRfq = (id) => store.getRfq(id);
export const updateRfq = (id, patch) => store.updateRfq(id, patch);
export const moveRfq = (id, status) => store.moveRfq(id, status);
export const deleteRfq = (id) => store.deleteRfq(id);
export const listRfqs = (filter) => store.listRfqs(filter);
export const addRfqNote = (rfqId, agent, es, en) =>
  store.addRfqNote(rfqId, agent, es, en);

/** Live-deal RFQs (seeded real 2026 deals). */
export const listLiveDeals = () => store.listLiveDeals();

/** Linked supplier + buyer records for an RFQ. */
export const linkedCounterparties = (rfqId) =>
  store.linkedCounterparties(rfqId);

/** Set a counterparty's verification state (validated). */
export const setVerification = (id, verification) =>
  store.setVerification(id, verification);

export const stats = () => store.stats();

/**
 * Workforce-adapter view over RFQs. The AI workforce agent expects notes
 * shaped {t, agent, es, en}; RFQs store them as {at, agent, es, en}.
 * Workforce-written notes are normalized to {at, agent, es, en} and deduped
 * by (at|agent|es) so repeat updates never duplicate notes.
 */
export function asWorkforceStore() {
  return {
    getAll: () => store.listRfqs(),
    get: (id) => store.getRfq(id),
    update: (id, patch = {}) => {
      const rfq = store.getRfq(id);
      if (!rfq) return null;
      const { agentNotes, ...rest } = patch;
      const updated = store.updateRfq(id, rest);
      if (updated && Array.isArray(agentNotes)) {
        const seen = new Set(updated.agentNotes.map(noteKey));
        for (const raw of agentNotes) {
          if (!raw || typeof raw !== 'object') continue;
          const normalized = normalizeAgentNote(raw);
          const key = noteKey(normalized);
          if (seen.has(key)) continue;
          seen.add(key);
          updated.agentNotes.push(normalized);
        }
        updated.updatedAt = chicagoIso();
        store.save();
      }
      return updated;
    },
    notes: (id) => {
      const rfq = store.getRfq(id);
      if (!rfq) return [];
      return (rfq.agentNotes || []).map((n) => ({
        t: n.at,
        agent: n.agent,
        es: n.es,
        en: n.en,
      }));
    },
  };
}

/** Testing / maintenance helper: wipe the store. */
export const resetTradeStore = () => store.reset();

/** Exposed for tests: force reload from the storage backend. */
export const reloadTradeStore = () => {
  store.db = store.load();
  return store.db;
};
