// Wholesale lead pipeline store — localStorage persistence, guarded for non-browser.
// Key: 'sahjony.wholesale.v1'. Falls back to in-memory storage outside a browser.
// No cesium, no network, no API keys.

import { scoreLead } from './dealEngine.js';

export const STORAGE_KEY = 'sahjony.wholesale.v1';

export const STATUSES = Object.freeze([
  'new',
  'researching',
  'analyzed',
  'offer',
  'contract',
  'assigned',
  'closed',
  'dead',
]);

export const STATUS_LABELS = Object.freeze({
  new: { es: 'Nueva', en: 'New' },
  researching: { es: 'En investigación', en: 'Researching' },
  analyzed: { es: 'Analizada', en: 'Analyzed' },
  offer: { es: 'Oferta', en: 'Offer' },
  contract: { es: 'Contrato', en: 'Contract' },
  assigned: { es: 'Asignada', en: 'Assigned' },
  closed: { es: 'Cerrada', en: 'Closed' },
  dead: { es: 'Descartada', en: 'Dead' },
});

export const OWNER_TYPES = Object.freeze(['individual', 'entity', 'unknown']);

/** ~15 m dedupe radius for coordinate matching. */
export const DEDUPE_RADIUS_M = 15;

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
      const probe = '__sahjony_wholesale_probe__';
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

export function normalizeAddress(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ');
}

/** Haversine distance in meters between two lat/lng pairs. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const dLat = toRad(lat2) - toRad(lat1);
  const dLng = toRad(lng2) - toRad(lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function coerceStatus(status) {
  if (typeof status === 'string' && STATUSES.includes(status)) return status;
  throw new Error(`Unknown wholesale status: ${String(status)}`);
}

function coerceOwnerType(ownerType) {
  return OWNER_TYPES.includes(ownerType) ? ownerType : 'unknown';
}

function normalizeLead(data = {}) {
  const lead = {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    address: typeof data.address === 'string' ? data.address.trim() : '',
    city: typeof data.city === 'string' ? data.city.trim() : '',
    state: typeof data.state === 'string' ? data.state.trim() : '',
    zip: typeof data.zip === 'string' ? data.zip.trim() : '',
    lat: Number.isFinite(Number(data.lat)) ? Number(data.lat) : null,
    lng: Number.isFinite(Number(data.lng)) ? Number(data.lng) : null,
    owner: typeof data.owner === 'string' ? data.owner.trim() : '',
    ownerType: coerceOwnerType(data.ownerType),
    source: typeof data.source === 'string' ? data.source.trim() : '',
    condition: Array.isArray(data.condition)
      ? [...data.condition]
      : (data.condition ?? ''),
    distress: Array.isArray(data.distress) ? [...data.distress] : [],
    notes: typeof data.notes === 'string' ? data.notes : '',
    status: data.status ? coerceStatus(data.status) : 'new',
    arv:
      Number.isFinite(Number(data.arv)) && Number(data.arv) >= 0
        ? Number(data.arv)
        : 0,
    repairs:
      Number.isFinite(Number(data.repairs)) && Number(data.repairs) >= 0
        ? Number(data.repairs)
        : 0,
    targetFee:
      Number.isFinite(Number(data.targetFee)) && Number(data.targetFee) >= 0
        ? Number(data.targetFee)
        : 0,
    contractPrice:
      Number.isFinite(Number(data.contractPrice)) &&
      Number(data.contractPrice) >= 0
        ? Number(data.contractPrice)
        : 0,
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...n }))
      : [],
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
  lead.score =
    Number.isFinite(Number(data.score)) && data.score !== undefined
      ? Math.min(100, Math.max(0, Math.round(Number(data.score))))
      : scoreLead(lead);
  return lead;
}

function normalizeBuyer(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    name: typeof data.name === 'string' ? data.name.trim() : '',
    contact: typeof data.contact === 'string' ? data.contact.trim() : '',
    buyBox: {
      maxPrice:
        Number.isFinite(Number(data.buyBox?.maxPrice)) &&
        Number(data.buyBox.maxPrice) >= 0
          ? Number(data.buyBox.maxPrice)
          : 0,
      areas: Array.isArray(data.buyBox?.areas) ? [...data.buyBox.areas] : [],
      minDiscountPct:
        Number.isFinite(Number(data.buyBox?.minDiscountPct)) &&
        Number(data.buyBox.minDiscountPct) >= 0
          ? Number(data.buyBox.minDiscountPct)
          : 0,
    },
    notes: typeof data.notes === 'string' ? data.notes : '',
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

class WholesaleStore {
  constructor() {
    this.backend = storageBackend();
    this.db = this.load();
  }

  load() {
    try {
      const raw = this.backend.getItem(STORAGE_KEY);
      if (!raw) return { leads: [], buyers: [] };
      const parsed = JSON.parse(raw);
      return {
        leads: Array.isArray(parsed.leads) ? parsed.leads : [],
        buyers: Array.isArray(parsed.buyers) ? parsed.buyers : [],
      };
    } catch {
      return { leads: [], buyers: [] };
    }
  }

  save() {
    try {
      this.backend.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* persistence is best-effort */
    }
  }

  /** Clear all leads and buyers (used by tests). */
  reset() {
    this.db = { leads: [], buyers: [] };
    this.save();
  }

  findDuplicate(data) {
    const addr = normalizeAddress(data.address);
    const lat = Number(data.lat);
    const lng = Number(data.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    return (
      this.db.leads.find((lead) => {
        if (addr && normalizeAddress(lead.address) === addr) return true;
        if (
          hasCoords &&
          Number.isFinite(Number(lead.lat)) &&
          Number.isFinite(Number(lead.lng))
        ) {
          const d = haversineMeters(
            lat,
            lng,
            Number(lead.lat),
            Number(lead.lng),
          );
          if (d <= DEDUPE_RADIUS_M) return true;
        }
        return false;
      }) ?? null
    );
  }

  createLead(data = {}) {
    const existing = this.findDuplicate(data);
    if (existing) return existing;
    const lead = normalizeLead(data);
    this.db.leads.push(lead);
    this.save();
    return lead;
  }

  getLead(id) {
    return this.db.leads.find((l) => l.id === id) ?? null;
  }

  updateLead(id, patch = {}) {
    const lead = this.getLead(id);
    if (!lead) return null;
    const merged = normalizeLead({ ...lead, ...patch, id: lead.id });
    merged.createdAt = lead.createdAt;
    merged.score = Object.prototype.hasOwnProperty.call(patch, 'score')
      ? merged.score
      : scoreLead(merged);
    merged.updatedAt = chicagoIso();
    Object.assign(lead, merged);
    this.save();
    return lead;
  }

  moveLead(id, status) {
    const lead = this.getLead(id);
    if (!lead) return null;
    lead.status = coerceStatus(status);
    lead.updatedAt = chicagoIso();
    this.save();
    return lead;
  }

  deleteLead(id) {
    const index = this.db.leads.findIndex((l) => l.id === id);
    if (index < 0) return false;
    this.db.leads.splice(index, 1);
    this.save();
    return true;
  }

  listLeads(filter) {
    const leads = [...this.db.leads];
    if (!filter) return leads;
    if (typeof filter === 'function') return leads.filter(filter);
    return leads.filter((lead) =>
      Object.entries(filter).every(([key, value]) => {
        if (key === 'minScore') return (lead.score ?? 0) >= value;
        if (key === 'distress') {
          const list = Array.isArray(lead.distress) ? lead.distress : [];
          return list.includes(value);
        }
        return lead[key] === value;
      }),
    );
  }

  addAgentNote(leadId, agent, es, en) {
    const lead = this.getLead(leadId);
    if (!lead) return null;
    const note = {
      agent: typeof agent === 'string' ? agent : '',
      es: typeof es === 'string' ? es : '',
      en: typeof en === 'string' ? en : '',
      at: chicagoIso(),
    };
    lead.agentNotes.push(note);
    lead.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Buyers ----
  addBuyer(data = {}) {
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
    return buyers.filter((buyer) =>
      Object.entries(filter).every(([key, value]) => buyer[key] === value),
    );
  }

  // ---- Stats ----
  stats() {
    const leads = this.db.leads;
    const byStatus = {};
    for (const status of STATUSES) byStatus[status] = 0;
    let scoreSum = 0;
    let pipelineValue = 0;
    let potentialFees = 0;
    for (const lead of leads) {
      const status = STATUSES.includes(lead.status) ? lead.status : 'new';
      byStatus[status] += 1;
      scoreSum += Number.isFinite(Number(lead.score)) ? Number(lead.score) : 0;
      if (status !== 'dead') pipelineValue += safeMoney(lead.arv);
      if (['offer', 'contract', 'assigned'].includes(status)) {
        potentialFees += safeMoney(lead.targetFee);
      }
    }
    return {
      total: leads.length,
      byStatus,
      avgScore: leads.length
        ? Math.round((scoreSum / leads.length) * 10) / 10
        : 0,
      pipelineValue: Math.round(pipelineValue),
      potentialFees: Math.round(potentialFees),
    };
  }
}

function safeMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const store = new WholesaleStore();

// ---- Public API ----
export const createLead = (data) => store.createLead(data);
export const getLead = (id) => store.getLead(id);
export const updateLead = (id, patch) => store.updateLead(id, patch);
export const listLeads = (filter) => store.listLeads(filter);
export const moveLead = (id, status) => store.moveLead(id, status);
export const deleteLead = (id) => store.deleteLead(id);
export const addAgentNote = (leadId, agent, es, en) =>
  store.addAgentNote(leadId, agent, es, en);

export const addBuyer = (data) => store.addBuyer(data);
export const getBuyer = (id) => store.getBuyer(id);
export const updateBuyer = (id, patch) => store.updateBuyer(id, patch);
export const deleteBuyer = (id) => store.deleteBuyer(id);
export const listBuyers = (filter) => store.listBuyers(filter);

export const stats = () => store.stats();

/** Testing / maintenance helper: wipe the store. */
export const resetWholesaleStore = () => store.reset();

/** Exposed for tests: force reload from the storage backend. */
export const reloadWholesaleStore = () => {
  store.db = store.load();
  return store.db;
};
