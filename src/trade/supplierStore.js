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
    notes: typeof data.notes === 'string' ? data.notes : '',
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...normalizeAgentNote(n) }))
      : [],
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
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

// ---- Real-deal backfill (2026-09-17 audit) ---------------------------------
// Juan's real import/export deals as of 2026-09-17 (America/Chicago).
// Runs explicitly (called once from app startup and from the standalone
// screen) — never from the store constructor, so unit tests keep a clean
// slate. Idempotent: RFQs key on `ref`, suppliers on name+country.
// Real data only. Prices/quantities stay 0 (reported as missing) wherever
// the seller has not quoted yet — nothing is estimated or invented.
const REAL_DEAL_REFS = Object.freeze([
  'RFQ-RICE-DIESEL-0917',
  'RFQ-SIEMENS-V942-0917',
  'RFQ-SODA-ASH-TNJ-0917',
]);

export function applyRealDealSeed() {
  const now = chicagoIso();
  const dealNote = (es, en) => ({ at: now, agent: 'sahjony', es, en });

  // TNJ Chemical (Katharine Xu) — soda ash supplier, in active negotiation.
  // Verification stays 'unverified' until Juan confirms it.
  let tnj = store.findDuplicateSupplier({
    name: 'TNJ Chemical',
    country: 'China',
  });
  if (!tnj) {
    tnj = store.createSupplier({
      name: 'TNJ Chemical',
      type: 'manufacturer',
      role: 'supplier',
      country: 'China',
      verification: 'unverified',
      notes:
        'Soda ash supplier — Katharine Xu (sales). In active negotiation on the 210 MT soda ash RFQ; verification pending Juan.',
      agentNotes: [
        dealNote(
          'Proveedor registrado desde la negociación real de soda ash (contraoferta 210 MT a $265/MT FOB Qingdao, 2026-09-17). Sin verificar — pendiente de Juan.',
          'Supplier registered from the live soda ash negotiation (210 MT counter at $265/MT FOB Qingdao, 2026-09-17). Unverified — pending Juan.',
        ),
      ],
      createdAt: now,
      updatedAt: now,
    });
  }

  // 1) Rice + diesel — Juan sent the WhatsApp inquiry himself; awaiting prices.
  if (!store.findDuplicateRfq({ ref: 'RFQ-RICE-DIESEL-0917' })) {
    store.createRfq({
      ref: 'RFQ-RICE-DIESEL-0917',
      product:
        'Arroz pilado (1–2 contenedores) + diésel nacionalizado (por IBC / por contenedor)',
      quantity: 0, // awaiting seller prices — missing, never estimated
      unitCost: 0,
      sellUnitPrice: 0,
      incoterms: '',
      originPort: 'Cuba',
      destinationPort: 'Cuba',
      status: 'contacted',
      notes:
        'Consulta enviada por Juan vía WhatsApp el 2026-09-17 (hora Chicago): arroz pilado (1–2 contenedores) y diésel nacionalizado (precio por IBC y por contenedor). Mercancía ya en Cuba, lista para nacionalizar — sin logística de importación. Esperando precios del vendedor.',
      agentNotes: [
        dealNote(
          'Juan envió la consulta al vendedor el 2026-09-17. Estado: esperando precios — cantidades y precios quedan en 0 (faltantes), no estimados.',
          'Juan sent the inquiry to the seller on 2026-09-17. Status: awaiting seller prices — quantity and prices stay 0 (missing), never estimated.',
        ),
      ],
      createdAt: now,
      updatedAt: now,
    });
  }

  // 2) Siemens V94.2 gas turbine — $37.5M EXW stated price; fee protection sent.
  if (!store.findDuplicateRfq({ ref: 'RFQ-SIEMENS-V942-0917' })) {
    store.createRfq({
      ref: 'RFQ-SIEMENS-V942-0917',
      product: 'Turbina de gas Siemens V94.2 (precio declarado $37.5M EXW)',
      quantity: 1,
      unitCost: 0, // SAHJONY never buys — cost unknown, reported as missing
      // sellUnitPrice stays 0 (missing): SAHJONY is broker/intermediary,
      // commission % unknown — the engine must not invent a $37.5M margin.
      sellUnitPrice: 0,
      incoterms: 'EXW',
      status: 'contacted',
      notes:
        'Precio declarado $37.5M EXW. Acuerdo de protección de comisión (fee protection / non-circumvention) enviado al vendedor el 2026-09-17 ~12:45 CDT. Compradores aún no contactados. SAHJONY actúa como bróker por comisión — nunca comprador final, sin capital en riesgo.',
      agentNotes: [
        dealNote(
          'Fee-protection enviado 2026-09-17 ~12:45 CDT; compradores aún no contactados. Comisión % pendiente — queda en 0, no inventada.',
          'Fee protection sent 2026-09-17 ~12:45 CDT; buyers not yet contacted. Commission % pending — stays 0, not invented.',
        ),
      ],
      createdAt: now,
      updatedAt: now,
    });
  }

  // 3) Soda ash via TNJ Chemical — 210 MT @ $265/MT FOB Qingdao countered.
  if (!store.findDuplicateRfq({ ref: 'RFQ-SODA-ASH-TNJ-0917' })) {
    store.createRfq({
      ref: 'RFQ-SODA-ASH-TNJ-0917',
      product: 'Soda ash (carbonato de sodio)',
      quantity: 210,
      unitCost: 265,
      sellUnitPrice: 0, // sell price not set — missing, not estimated
      incoterms: 'FOB',
      originPort: 'Qingdao',
      supplierId: tnj.id,
      status: 'quoting',
      notes:
        'TNJ Chemical (Katharine Xu) contraofertó 210 MT a $265/MT FOB Qingdao. Su respuesta del 2026-09-17 llegó vacía — solicitud de reenvío redactada, NO enviada (pendiente de Juan).',
      agentNotes: [
        dealNote(
          'Contraoferta real: 210 MT a $265/MT FOB Qingdao. Respuesta del 2026-09-17 vacía; reenvío redactado, no enviado.',
          'Live counter: 210 MT at $265/MT FOB Qingdao. 2026-09-17 reply arrived empty; resend drafted, not sent.',
        ),
      ],
      createdAt: now,
      updatedAt: now,
    });
  }

  return REAL_DEAL_REFS.filter((ref) => store.findDuplicateRfq({ ref }));
}

export { REAL_DEAL_REFS };
