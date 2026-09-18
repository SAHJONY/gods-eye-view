// Cuba car market A–Z pipeline store — localStorage persistence, guarded for
// non-browser. Key: 'sahjony.cars.v1'. Falls back to in-memory storage
// outside a browser. No cesium, no network, no API keys.
//
// What lives here: buyer leads (qualification funnel), deal records,
// Rosmel gestor draft queue (drafts only — never sent from here), and
// competition price snapshots fed by the daily `car-competition-price-scan`
// cron data.
//
// Honesty conventions: missing data is reported, never invented. Buyer
// records are created only from real interactions Juan logs. No public
// inventory: the store holds pipeline data, never a public listing.
//
// CONFIDENTIAL: the store intentionally has NO field for internal economics.
// Deal math that needs a cost lives only in carEngine's pure functions with
// values Juan enters at runtime; nothing confidential is seeded, logged, or
// rendered.
//
// Broker disclosure: SAHJONY is a fee broker for cars in Cuba — never the end
// buyer, never holds inventory/title/money. Copy must keep this positioning.

import { chicagoIso } from './carTime.js';

export const STORAGE_KEY = 'sahjony.cars.v1';

// Buyer qualification funnel: nuevo → contactado → calificado → oferta → cierre.
// 'descartado' is terminal (Juan moves leads there manually).
export const LEAD_STAGES = Object.freeze([
  'nuevo',
  'contactado',
  'calificado',
  'oferta',
  'cierre',
  'descartado',
]);

export const LEAD_STAGE_LABELS = Object.freeze({
  nuevo: { es: 'Nuevo', en: 'New' },
  contactado: { es: 'Contactado', en: 'Contacted' },
  calificado: { es: 'Calificado', en: 'Qualified' },
  oferta: { es: 'Oferta', en: 'Offer' },
  cierre: { es: 'Cierre', en: 'Closed' },
  descartado: { es: 'Descartado', en: 'Dropped' },
});

// Deal pipeline statuses. Juan advances them; the workforce never does.
export const DEAL_STATUSES = Object.freeze([
  'abierto',
  'activo',
  'firmado',
  'cerrado',
  'caido',
]);

export const DEAL_STATUS_LABELS = Object.freeze({
  abierto: { es: 'Abierto', en: 'Open' },
  activo: { es: 'Activo', en: 'Active' },
  firmado: { es: 'Firmado', en: 'Signed' },
  cerrado: { es: 'Cerrado', en: 'Closed' },
  caido: { es: 'Caído', en: 'Dead' },
});

// Rosmel draft approve-states. There is intentionally no "sent" state —
// sending happens on Juan's phone, outside this app.
export const DRAFT_STATES = Object.freeze(['draft', 'approved', 'discarded']);

export const DRAFT_STATE_LABELS = Object.freeze({
  draft: { es: 'Borrador', en: 'Draft' },
  approved: { es: 'Aprobado por Juan', en: 'Approved by Juan' },
  discarded: { es: 'Descartado', en: 'Discarded' },
});

export const BROKER_DISCLOSURE = Object.freeze({
  es: 'SAHJONY actúa como intermediario (broker) de pago por comisión: no somos el vendedor final, no tenemos inventario ni tomamos posesión de vehículos o dinero.',
  en: 'SAHJONY acts as a commission fee broker: we are not the end seller, we hold no inventory and take no custody of vehicles or money.',
});

// Buyer-facing PRELIMINARY reference prices confirmed via Rosmel (Sep 2026).
// Final prices are confirmed in writing only; no discounts. These are the
// figures Rosmel publishes to buyers — floors and margins never live here.
export const PRELIMINARY_BUYER_PRICES = Object.freeze([
  {
    model: 'Hyundai Elantra',
    price: 24900,
    note: {
      es: 'Precio preliminar al comprador — final confirmado por escrito, sin descuentos',
      en: 'Preliminary buyer price — final confirmed in writing, no discounts',
    },
  },
  {
    model: 'Infiniti Q50',
    price: 27600,
    note: {
      es: 'Precio preliminar al comprador — final confirmado por escrito, sin descuentos',
      en: 'Preliminary buyer price — final confirmado por escrito, sin descuentos',
    },
  },
  {
    model: 'Jeep Renegade',
    price: 26000,
    note: {
      es: 'Precio preliminar al comprador — final confirmado por escrito, sin descuentos',
      en: 'Preliminary buyer price — final confirmed in writing, no discounts',
    },
  },
]);

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
      const probe = '__sahjony_cars_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStorage;
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const asMoney = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Empty string stays empty — prices Juan hasn't set must not become 0. */
export function asOptionalMoney(value) {
  if (value === undefined || value === null || String(value).trim() === '')
    return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const normalizeKey = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

function coerceLeadStage(stage) {
  if (typeof stage === 'string' && LEAD_STAGES.includes(stage)) return stage;
  throw new Error(`Unknown car lead stage: ${String(stage)}`);
}

function coerceDealStatus(status) {
  if (typeof status === 'string' && DEAL_STATUSES.includes(status))
    return status;
  throw new Error(`Unknown car deal status: ${String(status)}`);
}

function coerceDraftState(state) {
  return DRAFT_STATES.includes(state) ? state : 'draft';
}

function normalizeNotes(notes) {
  return Array.isArray(notes)
    ? notes.map((n) => ({
        at: typeof n?.at === 'string' ? n.at : chicagoIso(),
        text: typeof n?.text === 'string' ? n.text : '',
      }))
    : [];
}

function normalizeAgentNotes(notes) {
  return Array.isArray(notes)
    ? notes.map((n) => ({
        at: typeof n?.at === 'string' ? n.at : chicagoIso(),
        agent: typeof n?.agent === 'string' ? n.agent : '',
        es: typeof n?.es === 'string' ? n.es : '',
        en: typeof n?.en === 'string' ? n.en : '',
      }))
    : [];
}

function normalizeLead(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    name: asText(data.name),
    whatsapp: asText(data.whatsapp),
    phone: asText(data.phone),
    // Exactly one record per person: dedupe key = name + whatsapp.
    interest: asText(data.interest),
    budgetUsd: asOptionalMoney(data.budgetUsd),
    source: asText(data.source),
    stage: data.stage ? coerceLeadStage(data.stage) : 'nuevo',
    notes: normalizeNotes(data.notes),
    agentNotes: normalizeAgentNotes(data.agentNotes),
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

function normalizeDeal(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    leadId: asText(data.leadId),
    model: asText(data.model),
    // Buyer-facing asking price only — the only price this app stores.
    buyerPrice: asOptionalMoney(data.buyerPrice),
    status: data.status ? coerceDealStatus(data.status) : 'abierto',
    notes: normalizeNotes(data.notes),
    agentNotes: normalizeAgentNotes(data.agentNotes),
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

function normalizeSnapshot(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    competitor: asText(data.competitor),
    model: asText(data.model),
    price: asOptionalMoney(data.price),
    date: asText(data.date),
    sourceUrl: asText(data.sourceUrl),
    createdAt: data.createdAt || chicagoIso(),
  };
}

function normalizeDraft(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    // 'rosmel' = WhatsApp-ready copy for Rosmel (gestor in Cuba);
    // 'buyer' = follow-up copy for a buyer lead. Drafts only — never sent.
    kind: data.kind === 'buyer' ? 'buyer' : 'rosmel',
    title: asText(data.title),
    bodyEs: typeof data.bodyEs === 'string' ? data.bodyEs : '',
    bodyEn: typeof data.bodyEn === 'string' ? data.bodyEn : '',
    leadId: asText(data.leadId),
    state: coerceDraftState(data.state),
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

class CarsStore {
  constructor() {
    this.backend = storageBackend();
    this.db = this.load();
  }

  load() {
    try {
      const raw = this.backend.getItem(STORAGE_KEY);
      if (!raw)
        return {
          leads: [],
          deals: [],
          drafts: [],
          snapshots: [],
          ourPrices: {},
          referencePrices: PRELIMINARY_BUYER_PRICES.map((p) => ({ ...p })),
        };
      const parsed = JSON.parse(raw);
      return {
        leads: Array.isArray(parsed.leads) ? parsed.leads : [],
        deals: Array.isArray(parsed.deals) ? parsed.deals : [],
        drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
        ourPrices:
          parsed.ourPrices && typeof parsed.ourPrices === 'object'
            ? parsed.ourPrices
            : {},
        referencePrices: Array.isArray(parsed.referencePrices)
          ? parsed.referencePrices
          : PRELIMINARY_BUYER_PRICES.map((p) => ({ ...p })),
      };
    } catch {
      return {
        leads: [],
        deals: [],
        drafts: [],
        snapshots: [],
        ourPrices: {},
        referencePrices: PRELIMINARY_BUYER_PRICES.map((p) => ({ ...p })),
      };
    }
  }

  save() {
    try {
      this.backend.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* persistence is best-effort */
    }
  }

  reset() {
    this.db = {
      leads: [],
      deals: [],
      drafts: [],
      snapshots: [],
      ourPrices: {},
      referencePrices: PRELIMINARY_BUYER_PRICES.map((p) => ({ ...p })),
    };
    this.save();
  }

  // ---- Buyer leads (exactly one record per person) ----
  leadKey(data) {
    const name = normalizeKey(data.name);
    const whatsapp = normalizeKey(data.whatsapp || data.phone);
    return name && whatsapp ? `${name}|${whatsapp}` : null;
  }

  findDuplicateLead(data) {
    const key = this.leadKey(data);
    if (!key) return null;
    return this.db.leads.find((l) => this.leadKey(l) === key) ?? null;
  }

  createLead(data = {}) {
    const existing = this.findDuplicateLead(data);
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
    merged.updatedAt = chicagoIso();
    Object.assign(lead, merged);
    this.save();
    return lead;
  }

  moveLead(id, stage) {
    const lead = this.getLead(id);
    if (!lead) return null;
    lead.stage = coerceLeadStage(stage);
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
      Object.entries(filter).every(([key, value]) => lead[key] === value),
    );
  }

  addLeadNote(leadId, text) {
    const lead = this.getLead(leadId);
    if (!lead) return null;
    const note = { at: chicagoIso(), text: String(text ?? '') };
    lead.notes.push(note);
    lead.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  addLeadAgentNote(leadId, agent, es, en) {
    const lead = this.getLead(leadId);
    if (!lead) return null;
    const note = {
      at: chicagoIso(),
      agent: typeof agent === 'string' ? agent : '',
      es: typeof es === 'string' ? es : '',
      en: typeof en === 'string' ? en : '',
    };
    lead.agentNotes.push(note);
    lead.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Deal records ----
  createDeal(data = {}) {
    const deal = normalizeDeal(data);
    this.db.deals.push(deal);
    this.save();
    return deal;
  }

  getDeal(id) {
    return this.db.deals.find((d) => d.id === id) ?? null;
  }

  updateDeal(id, patch = {}) {
    const deal = this.getDeal(id);
    if (!deal) return null;
    const merged = normalizeDeal({ ...deal, ...patch, id: deal.id });
    merged.createdAt = deal.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(deal, merged);
    this.save();
    return deal;
  }

  moveDeal(id, status) {
    const deal = this.getDeal(id);
    if (!deal) return null;
    deal.status = coerceDealStatus(status);
    deal.updatedAt = chicagoIso();
    this.save();
    return deal;
  }

  deleteDeal(id) {
    const index = this.db.deals.findIndex((d) => d.id === id);
    if (index < 0) return false;
    this.db.deals.splice(index, 1);
    this.save();
    return true;
  }

  listDeals(filter) {
    const deals = [...this.db.deals];
    if (!filter) return deals;
    if (typeof filter === 'function') return deals.filter(filter);
    return deals.filter((deal) =>
      Object.entries(filter).every(([key, value]) => deal[key] === value),
    );
  }

  // ---- Rosmel draft queue (drafts only — never sent) ----
  createDraft(data = {}) {
    const draft = normalizeDraft(data);
    this.db.drafts.push(draft);
    this.save();
    return draft;
  }

  getDraft(id) {
    return this.db.drafts.find((d) => d.id === id) ?? null;
  }

  updateDraft(id, patch = {}) {
    const draft = this.getDraft(id);
    if (!draft) return null;
    const merged = normalizeDraft({ ...draft, ...patch, id: draft.id });
    merged.createdAt = draft.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(draft, merged);
    this.save();
    return draft;
  }

  setDraftState(id, state) {
    const draft = this.getDraft(id);
    if (!draft) return null;
    draft.state = coerceDraftState(state);
    draft.updatedAt = chicagoIso();
    this.save();
    return draft;
  }

  deleteDraft(id) {
    const index = this.db.drafts.findIndex((d) => d.id === id);
    if (index < 0) return false;
    this.db.drafts.splice(index, 1);
    this.save();
    return true;
  }

  listDrafts(filter) {
    const drafts = [...this.db.drafts];
    if (!filter) return drafts;
    if (typeof filter === 'function') return drafts.filter(filter);
    return drafts.filter((draft) =>
      Object.entries(filter).every(([key, value]) => draft[key] === value),
    );
  }

  // ---- Competition price snapshots (from car-competition-price-scan cron) ----
  addSnapshot(data = {}) {
    const snapshot = normalizeSnapshot(data);
    this.db.snapshots.push(snapshot);
    this.save();
    return snapshot;
  }

  listSnapshots(filter) {
    const snapshots = [...this.db.snapshots].sort((a, b) =>
      String(b.date || b.createdAt).localeCompare(String(a.date || a.createdAt)),
    );
    if (!filter) return snapshots;
    if (typeof filter === 'function') return snapshots.filter(filter);
    return snapshots.filter((s) =>
      Object.entries(filter).every(([key, value]) => s[key] === value),
    );
  }

  deleteSnapshot(id) {
    const index = this.db.snapshots.findIndex((s) => s.id === id);
    if (index < 0) return false;
    this.db.snapshots.splice(index, 1);
    this.save();
    return true;
  }

  // ---- Our asking prices per model (set by Juan; default empty) ----
  getOurPrices() {
    return { ...this.db.ourPrices };
  }

  setOurPrice(model, price) {
    const key = asText(model);
    const value = asOptionalMoney(price);
    if (!key) return null;
    if (value === null) delete this.db.ourPrices[key];
    else this.db.ourPrices[key] = value;
    this.save();
    return this.getOurPrices();
  }

  getReferencePrices() {
    return this.db.referencePrices.map((p) => ({ ...p }));
  }

  // ---- Stats ----
  stats() {
    const byStage = {};
    for (const stage of LEAD_STAGES) byStage[stage] = 0;
    for (const lead of this.db.leads) {
      const stage = LEAD_STAGES.includes(lead.stage) ? lead.stage : 'nuevo';
      byStage[stage] += 1;
    }
    const byStatus = {};
    for (const status of DEAL_STATUSES) byStatus[status] = 0;
    for (const deal of this.db.deals) {
      const status = DEAL_STATUSES.includes(deal.status)
        ? deal.status
        : 'abierto';
      byStatus[status] += 1;
    }
    const byDraftState = {};
    for (const state of DRAFT_STATES) byDraftState[state] = 0;
    for (const draft of this.db.drafts) {
      const state = DRAFT_STATES.includes(draft.state) ? draft.state : 'draft';
      byDraftState[state] += 1;
    }
    const models = new Set();
    for (const s of this.db.snapshots) if (asText(s.model)) models.add(asText(s.model));
    return {
      totalLeads: this.db.leads.length,
      byStage,
      qualified: byStage.calificado + byStage.oferta + byStage.cierre,
      totalDeals: this.db.deals.length,
      byStatus,
      totalDrafts: this.db.drafts.length,
      byDraftState,
      pendingDrafts: byDraftState.draft,
      totalSnapshots: this.db.snapshots.length,
      modelsTracked: models.size,
    };
  }
}

const store = new CarsStore();

// ---- Public API ----
export const createLead = (data) => store.createLead(data);
export const getLead = (id) => store.getLead(id);
export const updateLead = (id, patch) => store.updateLead(id, patch);
export const moveLead = (id, stage) => store.moveLead(id, stage);
export const deleteLead = (id) => store.deleteLead(id);
export const listLeads = (filter) => store.listLeads(filter);
export const addLeadNote = (leadId, text) => store.addLeadNote(leadId, text);
export const addLeadAgentNote = (leadId, agent, es, en) =>
  store.addLeadAgentNote(leadId, agent, es, en);

export const createDeal = (data) => store.createDeal(data);
export const getDeal = (id) => store.getDeal(id);
export const updateDeal = (id, patch) => store.updateDeal(id, patch);
export const moveDeal = (id, status) => store.moveDeal(id, status);
export const deleteDeal = (id) => store.deleteDeal(id);
export const listDeals = (filter) => store.listDeals(filter);

export const createDraft = (data) => store.createDraft(data);
export const getDraft = (id) => store.getDraft(id);
export const updateDraft = (id, patch) => store.updateDraft(id, patch);
export const setDraftState = (id, state) => store.setDraftState(id, state);
export const deleteDraft = (id) => store.deleteDraft(id);
export const listDrafts = (filter) => store.listDrafts(filter);

export const addSnapshot = (data) => store.addSnapshot(data);
export const listSnapshots = (filter) => store.listSnapshots(filter);
export const deleteSnapshot = (id) => store.deleteSnapshot(id);

export const getOurPrices = () => store.getOurPrices();
export const setOurPrice = (model, price) => store.setOurPrice(model, price);
export const getReferencePrices = () => store.getReferencePrices();

export const stats = () => store.stats();

/**
 * Workforce-adapter view over leads. The AI workforce expects notes shaped
 * {t, agent, es, en}; leads store them as {at, agent, es, en}.
 */
export function asWorkforceStore() {
  return {
    getAll: () => store.listLeads(),
    get: (id) => store.getLead(id),
    update: (id, patch = {}) => {
      const lead = store.getLead(id);
      if (!lead) return null;
      const { agentNotes, ...rest } = patch;
      const updated = store.updateLead(id, rest);
      if (updated && Array.isArray(agentNotes)) {
        const seen = new Set(
          updated.agentNotes.map((n) => `${n.at}|${n.agent}|${n.es}`),
        );
        for (const raw of agentNotes) {
          if (!raw || typeof raw !== 'object') continue;
          const key = `${raw.at ?? ''}|${raw.agent ?? ''}|${raw.es ?? ''}`;
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
      const lead = store.getLead(id);
      if (!lead) return [];
      return (lead.agentNotes || []).map((n) => ({
        t: n.at,
        agent: n.agent,
        es: n.es,
        en: n.en,
      }));
    },
  };
}

/** Testing / maintenance helper: wipe the store (re-seeds reference prices). */
export const resetCarsStore = () => store.reset();

/** Exposed for tests: force reload from the storage backend. */
export const reloadCarsStore = () => {
  store.db = store.load();
  return store.db;
};
