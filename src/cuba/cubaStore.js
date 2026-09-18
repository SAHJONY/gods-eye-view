// Cuba market (MIPYME) pipeline store — localStorage persistence, guarded
// for non-browser. Key: 'sahjony.cuba.v1'. Falls back to in-memory storage
// outside a browser.
//
// Entities:
// - buyers: MIPYME buyer directory (real records ONLY — never invented).
// - requests: sourcing-request intake → triage queue.
// - partners: real partner network only.
//
// Hard constraints (no exceptions):
// - Blocker #4: NO street address and NO registration-number fields exist
//   anywhere in this store. They are not collected, not stored, not rendered.
// - Never invent buyers, partners, or requests. Seeds ship EMPTY; real data
//   enters via the import path (see cubaImporter.js) or manual entry.
// - SAHJONY is a fee/spread BROKER — never the end buyer, zero capital at
//   risk. Copy in consumers of this store must keep broker positioning.
// Mirrors src/trade/supplierStore.js conventions.

import { scoreSourcingRequest } from './cubaEngine.js';

export const STORAGE_KEY = 'sahjony.cuba.v1';

export const REQUEST_STATUSES = Object.freeze([
  'intake',
  'triage',
  'quoted',
  'negotiating',
  'won',
  'lost',
]);

export const REQUEST_STATUS_LABELS = Object.freeze({
  intake: { es: 'Nueva solicitud', en: 'New request' },
  triage: { es: 'En triaje', en: 'In triage' },
  quoted: { es: 'Cotizada', en: 'Quoted' },
  negotiating: { es: 'Negociando', en: 'Negotiating' },
  won: { es: 'Ganada', en: 'Won' },
  lost: { es: 'Perdida', en: 'Lost' },
});

/** Statuses that keep a request in the open pipeline. */
export const OPEN_REQUEST_STATUSES = Object.freeze(
  REQUEST_STATUSES.filter((s) => s !== 'won' && s !== 'lost'),
);

export const BUYER_TYPES = Object.freeze([
  'mipyme-privada',
  'mipyme-estatal',
  'tcp',
  'cooperativa',
  'otro',
]);

export const BUYER_TYPE_LABELS = Object.freeze({
  'mipyme-privada': { es: 'MIPYME privada', en: 'Private MIPYME' },
  'mipyme-estatal': { es: 'MIPYME estatal', en: 'State MIPYME' },
  tcp: { es: 'Trabajador por cuenta propia', en: 'Self-employed (TCP)' },
  cooperativa: { es: 'Cooperativa', en: 'Cooperative' },
  otro: { es: 'Otro actor económico', en: 'Other economic actor' },
});

export const PARTNER_TYPES = Object.freeze([
  'commercial',
  'logistics',
  'financiero',
  'otro',
]);

export const PARTNER_TYPE_LABELS = Object.freeze({
  commercial: { es: 'Comercial', en: 'Commercial' },
  logistics: { es: 'Logística', en: 'Logistics' },
  financiero: { es: 'Financiero', en: 'Financial' },
  otro: { es: 'Otro', en: 'Other' },
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

/** Real Cuba receiving ports for sourcing requests (public geography). */
export const CUBA_PORTS = Object.freeze([
  { id: 'mariel', es: 'Mariel', en: 'Mariel', lat: 23.0186, lng: -82.755 },
  {
    id: 'la-habana',
    es: 'La Habana',
    en: 'Havana',
    lat: 23.137,
    lng: -82.355,
  },
  {
    id: 'santiago',
    es: 'Santiago de Cuba',
    en: 'Santiago de Cuba',
    lat: 20.011,
    lng: -75.83,
  },
  {
    id: 'cienfuegos',
    es: 'Cienfuegos',
    en: 'Cienfuegos',
    lat: 22.145,
    lng: -80.454,
  },
]);

export const INCOTERMS = Object.freeze(['FOB', 'CIF', 'EXW', 'DAP', 'DDP']);

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
      const probe = '__sahjony_cuba_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStorage;
}

/** ISO timestamp with America/Chicago offset, e.g. 2026-09-17T23:00:00-05:00. */
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

function coerceRequestStatus(status) {
  if (typeof status === 'string' && REQUEST_STATUSES.includes(status))
    return status;
  throw new Error(`Unknown cuba request status: ${String(status)}`);
}

function coerceBuyerType(type) {
  return BUYER_TYPES.includes(type) ? type : 'mipyme-privada';
}

function coercePartnerType(type) {
  return PARTNER_TYPES.includes(type) ? type : 'commercial';
}

function coerceVerification(verification) {
  return VERIFICATION.includes(verification) ? verification : 'unverified';
}

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const asMoney = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const asList = (value) =>
  Array.isArray(value)
    ? value.map((v) => asText(v)).filter(Boolean)
    : typeof value === 'string'
      ? value
          .split(/[,;]/)
          .map((v) => v.trim())
          .filter(Boolean)
      : [];

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

// NOTE: buyer records deliberately carry NO street-address and NO
// registration-number fields (Blocker #4). They are not collected, stored,
// or rendered anywhere in this module.
function normalizeBuyer(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    name: asText(data.name),
    type: coerceBuyerType(data.type),
    province: asText(data.province),
    municipality: asText(data.municipality),
    contact: {
      name: asText(data.contact?.name),
      phone: asText(data.contact?.phone),
      email: asText(data.contact?.email),
      whatsapp: asText(data.contact?.whatsapp),
    },
    activity: asText(data.activity),
    interestedProducts: asList(data.interestedProducts),
    verification: coerceVerification(data.verification),
    notes: typeof data.notes === 'string' ? data.notes : '',
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...normalizeAgentNote(n) }))
      : [],
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

function normalizeRequest(data = {}) {
  const req = {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    ref: asText(data.ref),
    buyerId: asText(data.buyerId),
    product: asText(data.product),
    quantity: asMoney(data.quantity),
    targetPrice: asMoney(data.targetPrice),
    currency: asText(data.currency) || 'USD',
    incoterms: asText(data.incoterms),
    destinationPort: asText(data.destinationPort),
    timeline: asText(data.timeline),
    status: data.status ? coerceRequestStatus(data.status) : 'intake',
    notes: typeof data.notes === 'string' ? data.notes : '',
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...normalizeAgentNote(n) }))
      : [],
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
  req.score =
    Number.isFinite(Number(data.score)) && data.score !== undefined
      ? Math.min(100, Math.max(0, Math.round(Number(data.score))))
      : scoreSourcingRequest(req);
  return req;
}

function normalizePartner(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    name: asText(data.name),
    type: coercePartnerType(data.type),
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

class CubaStore {
  constructor() {
    this.backend = storageBackend();
    this.db = this.load();
    this.listeners = new Set();
  }

  load() {
    try {
      const raw = this.backend.getItem(STORAGE_KEY);
      if (!raw) return { buyers: [], requests: [], partners: [] };
      const parsed = JSON.parse(raw);
      return {
        buyers: Array.isArray(parsed.buyers) ? parsed.buyers : [],
        requests: Array.isArray(parsed.requests) ? parsed.requests : [],
        partners: Array.isArray(parsed.partners) ? parsed.partners : [],
      };
    } catch {
      return { buyers: [], requests: [], partners: [] };
    }
  }

  save() {
    try {
      this.backend.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* persistence is best-effort */
    }
    this.notify();
  }

  notify() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* a listener must never break the store */
      }
    }
  }

  onMutate(fn) {
    if (typeof fn === 'function') this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Clear buyers, requests and partners (used by tests). */
  reset() {
    this.db = { buyers: [], requests: [], partners: [] };
    this.save();
  }

  // ---- Buyers ----
  findDuplicateBuyer(data) {
    const name = normalizeName(data.name);
    const province = normalizeName(data.province);
    if (!name || !province) return null;
    return (
      this.db.buyers.find(
        (b) =>
          normalizeName(b.name) === name &&
          normalizeName(b.province) === province,
      ) ?? null
    );
  }

  createBuyer(data = {}) {
    const existing = this.findDuplicateBuyer(data);
    if (existing) return existing;
    const buyer = normalizeBuyer(data);
    this.db.buyers.push(buyer);
    this.save();
    return buyer;
  }

  getBuyer(id) {
    return this.db.buyers.find((b) => b.id === id) ?? null;
  }

  updateBuyer(id, patch = {}) {
    const buyer = this.getBuyer(id);
    if (!buyer) return null;
    const merged = normalizeBuyer({ ...buyer, ...patch, id: buyer.id });
    merged.createdAt = buyer.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(buyer, merged);
    this.save();
    return buyer;
  }

  deleteBuyer(id) {
    const index = this.db.buyers.findIndex((b) => b.id === id);
    if (index < 0) return false;
    this.db.buyers.splice(index, 1);
    this.save();
    return true;
  }

  listBuyers(filter) {
    const buyers = [...this.db.buyers];
    if (!filter) return buyers;
    if (typeof filter === 'function') return buyers.filter(filter);
    return buyers.filter((b) =>
      Object.entries(filter).every(([key, value]) => b[key] === value),
    );
  }

  addBuyerNote(buyerId, agent, es, en) {
    const buyer = this.getBuyer(buyerId);
    if (!buyer) return null;
    const note = normalizeAgentNote({ agent, es, en });
    note.at = chicagoIso();
    buyer.agentNotes.push(note);
    buyer.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Requests ----
  findDuplicateRequest(data) {
    const ref = normalizeName(data.ref);
    if (!ref) return null;
    return (
      this.db.requests.find((r) => normalizeName(r.ref) === ref) ?? null
    );
  }

  createRequest(data = {}) {
    const existing = this.findDuplicateRequest(data);
    if (existing) return existing;
    const req = normalizeRequest(data);
    this.db.requests.push(req);
    this.save();
    return req;
  }

  getRequest(id) {
    return this.db.requests.find((r) => r.id === id) ?? null;
  }

  updateRequest(id, patch = {}) {
    const req = this.getRequest(id);
    if (!req) return null;
    const merged = normalizeRequest({ ...req, ...patch, id: req.id });
    merged.createdAt = req.createdAt;
    merged.score = Object.prototype.hasOwnProperty.call(patch, 'score')
      ? merged.score
      : scoreSourcingRequest(merged);
    merged.updatedAt = chicagoIso();
    Object.assign(req, merged);
    this.save();
    return req;
  }

  moveRequest(id, status) {
    const req = this.getRequest(id);
    if (!req) return null;
    req.status = coerceRequestStatus(status);
    req.updatedAt = chicagoIso();
    this.save();
    return req;
  }

  deleteRequest(id) {
    const index = this.db.requests.findIndex((r) => r.id === id);
    if (index < 0) return false;
    this.db.requests.splice(index, 1);
    this.save();
    return true;
  }

  listRequests(filter) {
    const requests = [...this.db.requests];
    if (!filter) return requests;
    if (typeof filter === 'function') return requests.filter(filter);
    return requests.filter((r) =>
      Object.entries(filter).every(([key, value]) => {
        if (key === 'minScore') return (r.score ?? 0) >= value;
        return r[key] === value;
      }),
    );
  }

  addRequestNote(requestId, agent, es, en) {
    const req = this.getRequest(requestId);
    if (!req) return null;
    const note = normalizeAgentNote({ agent, es, en });
    note.at = chicagoIso();
    req.agentNotes.push(note);
    req.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Partners ----
  findDuplicatePartner(data) {
    const name = normalizeName(data.name);
    const country = normalizeName(data.country);
    if (!name || !country) return null;
    return (
      this.db.partners.find(
        (p) =>
          normalizeName(p.name) === name &&
          normalizeName(p.country) === country,
      ) ?? null
    );
  }

  createPartner(data = {}) {
    const existing = this.findDuplicatePartner(data);
    if (existing) return existing;
    const partner = normalizePartner(data);
    this.db.partners.push(partner);
    this.save();
    return partner;
  }

  getPartner(id) {
    return this.db.partners.find((p) => p.id === id) ?? null;
  }

  updatePartner(id, patch = {}) {
    const partner = this.getPartner(id);
    if (!partner) return null;
    const merged = normalizePartner({ ...partner, ...patch, id: partner.id });
    merged.createdAt = partner.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(partner, merged);
    this.save();
    return partner;
  }

  deletePartner(id) {
    const index = this.db.partners.findIndex((p) => p.id === id);
    if (index < 0) return false;
    this.db.partners.splice(index, 1);
    this.save();
    return true;
  }

  listPartners(filter) {
    const partners = [...this.db.partners];
    if (!filter) return partners;
    if (typeof filter === 'function') return partners.filter(filter);
    return partners.filter((p) =>
      Object.entries(filter).every(([key, value]) => p[key] === value),
    );
  }

  addPartnerNote(partnerId, agent, es, en) {
    const partner = this.getPartner(partnerId);
    if (!partner) return null;
    const note = normalizeAgentNote({ agent, es, en });
    note.at = chicagoIso();
    partner.agentNotes.push(note);
    partner.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Stats ----
  stats() {
    const requests = this.db.requests;
    const byStatus = {};
    for (const status of REQUEST_STATUSES) byStatus[status] = 0;
    let openRequests = 0;
    let scoreSum = 0;
    for (const req of requests) {
      const status = REQUEST_STATUSES.includes(req.status)
        ? req.status
        : 'intake';
      byStatus[status] += 1;
      if (OPEN_REQUEST_STATUSES.includes(status)) {
        openRequests += 1;
        scoreSum += Number(req.score) || 0;
      }
    }
    const buyers = this.db.buyers;
    const partners = this.db.partners;
    return {
      totalBuyers: buyers.length,
      verifiedBuyers: buyers.filter((b) => b.verification === 'verified')
        .length,
      totalRequests: requests.length,
      openRequests,
      avgRequestScore:
        openRequests > 0 ? Math.round(scoreSum / openRequests) : 0,
      byStatus,
      totalPartners: partners.length,
      verifiedPartners: partners.filter((p) => p.verification === 'verified')
        .length,
    };
  }
}

const store = new CubaStore();

// ---- Public API ----
export const createBuyer = (data) => store.createBuyer(data);
export const getBuyer = (id) => store.getBuyer(id);
export const updateBuyer = (id, patch) => store.updateBuyer(id, patch);
export const deleteBuyer = (id) => store.deleteBuyer(id);
export const listBuyers = (filter) => store.listBuyers(filter);
export const addBuyerNote = (buyerId, agent, es, en) =>
  store.addBuyerNote(buyerId, agent, es, en);

export const createRequest = (data) => store.createRequest(data);
export const getRequest = (id) => store.getRequest(id);
export const updateRequest = (id, patch) => store.updateRequest(id, patch);
export const moveRequest = (id, status) => store.moveRequest(id, status);
export const deleteRequest = (id) => store.deleteRequest(id);
export const listRequests = (filter) => store.listRequests(filter);
export const addRequestNote = (requestId, agent, es, en) =>
  store.addRequestNote(requestId, agent, es, en);

export const createPartner = (data) => store.createPartner(data);
export const getPartner = (id) => store.getPartner(id);
export const updatePartner = (id, patch) => store.updatePartner(id, patch);
export const deletePartner = (id) => store.deletePartner(id);
export const listPartners = (filter) => store.listPartners(filter);
export const addPartnerNote = (partnerId, agent, es, en) =>
  store.addPartnerNote(partnerId, agent, es, en);

export const stats = () => store.stats();
export const onMutate = (fn) => store.onMutate(fn);

const noteKey = (note) =>
  `${note?.at ?? ''}|${note?.agent ?? ''}|${note?.es ?? ''}`;

/**
 * Workforce-adapter view over sourcing requests. Workforce-written notes
 * are normalized to {at, agent, es, en} and deduped by (at|agent|es) so
 * repeat updates never duplicate notes.
 */
export function asWorkforceStore() {
  return {
    getAll: () => store.listRequests(),
    get: (id) => store.getRequest(id),
    update: (id, patch = {}) => {
      const req = store.getRequest(id);
      if (!req) return null;
      const { agentNotes, ...rest } = patch;
      const updated = store.updateRequest(id, rest);
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
      const req = store.getRequest(id);
      if (!req) return [];
      return (req.agentNotes || []).map((n) => ({
        t: n.at,
        agent: n.agent,
        es: n.es,
        en: n.en,
      }));
    },
  };
}

/** Testing / maintenance helper: wipe the store. */
export const resetCubaStore = () => store.reset();

/** Exposed for tests: force reload from the storage backend. */
export const reloadCubaStore = () => {
  store.db = store.load();
  return store.db;
};
