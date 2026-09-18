// SAHJONY · GOD'S EYE VIEW — Energy desk store (diesel/gasoline/LPG → Cuba).
// ---------------------------------------------------------------------------
// localStorage pipeline store, guarded for non-browser. Key:
// 'sahjony.energy.v1'. Falls back to in-memory storage outside a browser.
//
// Records: product inquiries (broker pipeline), benchmark price log (dated +
// sourced, seeded ONLY with values verified via web search on 2026-09-18),
// Cuban receiving ports (static reference), compliance-gate checklists and
// the escalation queue.
//
// SANCTIONS HARD STOP: the ONLY path to move an inquiry past the compliance
// gate is advanceGate(), which evaluates the checklist through the pure
// engine and escalates to Juan on ANY red flag or ANY unknown answer.
// There is deliberately no other function that sets a gate-passed status —
// the gate cannot be bypassed in code.

import { PRODUCTS, evaluateGate, parcelEconomics } from './energyEngine.js';

export const STORAGE_KEY = 'sahjony.energy.v1';

export const INQUIRY_STATUSES = Object.freeze([
  'inquiry',
  'diligence',
  'gate-review',
  'commercial',
  'awaiting-juan',
  'closed',
  'dead',
]);

export const INQUIRY_STATUS_LABELS = Object.freeze({
  inquiry: { es: 'Consulta', en: 'Inquiry' },
  diligence: { es: 'Diligencia', en: 'Diligence' },
  'gate-review': { es: 'Revisión de gate', en: 'Gate review' },
  commercial: { es: 'Comercial (gate aprobado)', en: 'Commercial (gate passed)' },
  'awaiting-juan': { es: 'Esperando a Juan', en: 'Awaiting Juan' },
  closed: { es: 'Cerrado', en: 'Closed' },
  dead: { es: 'Descartado', en: 'Dead' },
});

export const ESCALATION_REASONS = Object.freeze([
  'sanctions',
  'compliance',
  'missing-data',
]);

// ---------------------------------------------------------------------------
// Static Cuban receiving-port reference (real ports, static reference data).
// Coordinates are port anchorages published on nautical charts; this is
// reference data, not live vessel information.
// ---------------------------------------------------------------------------

export const CUBAN_FUEL_PORTS = Object.freeze([
  {
    id: 'mariel',
    name: { es: 'Mariel', en: 'Mariel' },
    lat: 23.0267,
    lng: -82.7736,
    note: {
      es: 'Terminal de contenedores y graneles. Referencia estática.',
      en: 'Container and bulk terminal. Static reference.',
    },
  },
  {
    id: 'havana',
    name: { es: 'La Habana', en: 'Havana' },
    lat: 23.1433,
    lng: -82.3458,
    note: {
      es: 'Puerto principal. Referencia estática.',
      en: 'Main port. Static reference.',
    },
  },
  {
    id: 'santiago',
    name: { es: 'Santiago de Cuba', en: 'Santiago de Cuba' },
    lat: 19.9972,
    lng: -75.875,
    note: {
      es: 'Puerto del oriente. Referencia estática.',
      en: 'Eastern port. Static reference.',
    },
  },
  {
    id: 'cienfuegos',
    name: { es: 'Cienfuegos', en: 'Cienfuegos' },
    lat: 22.1464,
    lng: -80.4542,
    note: {
      es: 'Refinería y terminal de combustibles. Referencia estática.',
      en: 'Refinery and fuel terminal. Static reference.',
    },
  },
]);

// ---------------------------------------------------------------------------
// Seed benchmark log — verified via web search on 2026-09-18. Each entry is
// dated and sourced. The seed applies only to an empty store; entries are
// never invented.
// ---------------------------------------------------------------------------

export const SEED_BENCHMARKS = Object.freeze([
  {
    date: '2026-09-14',
    product: 'diesel',
    value: 6.027,
    unit: '$/gal',
    market: 'Golfo de EE. UU. (PADD 3) — diésel minorista en carretera',
    marketEn: 'US Gulf Coast (PADD 3) — on-highway diesel retail',
    source: 'EIA (vía truckdrivernews, publicado 2026-09-15)',
    sourceUrl:
      'https://truckdrivernews.com/diesel-prices-surge-31-8-cents-in-new-eia-update/',
    note: 'Promedio semanal EIA al 2026-09-14.',
  },
  {
    date: '2026-09-14',
    product: 'gasoline',
    value: 3.852,
    unit: '$/gal',
    market: 'Golfo de EE. UU. (PADD 3) — gasolina regular minorista',
    marketEn: 'US Gulf Coast (PADD 3) — regular gasoline retail',
    source: 'EIA (vía IndexBox Weekly Fuel Update, 2026-09-15)',
    sourceUrl:
      'https://www.indexbox.io/blog/eia-weekly-fuel-update-gasoline-and-diesel-prices-rise-on-september-15-2026/',
    note: 'Precio semanal EIA al 2026-09-14.',
  },
  {
    date: '2026-09-14',
    product: 'gasoline',
    value: 4.703,
    unit: '$/gal',
    market: 'Golfo de EE. UU. (PADD 3) — gasolina premium minorista',
    marketEn: 'US Gulf Coast (PADD 3) — premium gasoline retail',
    source: 'EIA Weekly Gulf Coast Premium (publicado 2026-09-15)',
    sourceUrl:
      'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMM_EPMP_PTE_R30_DPG&f=W',
    note: 'Precio semanal EIA al 2026-09-14.',
  },
  {
    date: '2026-09-14',
    product: 'lpg',
    value: 0.85,
    unit: '$/gal',
    market: 'Mont Belvieu, TX — propano spot FOB (referencia GLP)',
    marketEn: 'Mont Belvieu, TX — propane spot FOB (LPG proxy)',
    source: 'Trading Economics (commodity propane, actualizado 2026-09-14)',
    sourceUrl: 'https://tradingeconomics.com/commodity/propane',
    note: 'Precio spot de referencia; no es una cotización de suministro.',
  },
  {
    date: '2026-09-04',
    product: 'lpg',
    value: 0.753,
    unit: '$/gal',
    market: 'Mont Belvieu, TX — propano spot semanal',
    marketEn: 'Mont Belvieu, TX — weekly propane spot',
    source: 'EIA vía FRED (WPROPANEMBTX, actualizado 2026-09-10)',
    sourceUrl: 'https://fred.stlouisfed.org/series/WPROPANEMBTX',
    note: 'Serie semanal EIA; última observación disponible el 2026-09-04.',
  },
  {
    date: '2026-09-14',
    product: 'diesel',
    value: 5.0108,
    unit: '$/gal',
    market: 'NYMEX ULSD futuro octubre (referencia mayorista)',
    marketEn: 'NYMEX ULSD October futures (wholesale proxy)',
    source: 'OPIS vía Morningstar (2026-09-14)',
    sourceUrl:
      'https://www.morningstar.com/news/dow-jones/202609144955/nymex-overview-petroleum-futures-starting-the-week-with-sharp-gains-as-mideast-fighting-intensifies-opis',
    note: 'Futuro, no precio al contado; referencia de tendencia.',
  },
  {
    date: '2026-09-14',
    product: 'gasoline',
    value: 3.3693,
    unit: '$/gal',
    market: 'NYMEX RBOB futuro octubre (referencia mayorista)',
    marketEn: 'NYMEX RBOB October futures (wholesale proxy)',
    source: 'OPIS vía Morningstar (2026-09-14)',
    sourceUrl:
      'https://www.morningstar.com/news/dow-jones/202609144955/nymex-overview-petroleum-futures-starting-the-week-with-sharp-gains-as-mideast-fighting-intensifies-opis',
    note: 'Futuro, no precio al contado; referencia de tendencia.',
  },
]);

// ---------------------------------------------------------------------------
// Storage plumbing (mirrors the crude store conventions).
// ---------------------------------------------------------------------------

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
      const probe = '__sahjony_energy_probe__';
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

const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const asNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function coerceStatus(status) {
  if (typeof status === 'string' && INQUIRY_STATUSES.includes(status))
    return status;
  throw new Error(`Unknown energy inquiry status: ${String(status)}`);
}

function coerceProduct(product) {
  return PRODUCTS.includes(product) ? product : 'diesel';
}

function normalizeInquiry(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    ref: asText(data.ref),
    product: coerceProduct(data.product),
    volumeMt: Math.max(0, asNum(data.volumeMt)),
    volumeGal: Math.max(0, asNum(data.volumeGal)),
    volumeBbl: Math.max(0, asNum(data.volumeBbl)),
    unit: ['MT', 'gal', 'bbl'].includes(data.unit) ? data.unit : 'MT',
    buyPerUnit: asNum(data.buyPerUnit),
    sellPerUnit: asNum(data.sellPerUnit),
    feePerUnit: Math.max(0, asNum(data.feePerUnit)),
    dischargePort: asText(data.dischargePort),
    counterpartyName: asText(data.counterpartyName),
    status: data.status ? coerceStatus(data.status) : 'inquiry',
    notes: typeof data.notes === 'string' ? data.notes : '',
    meta:
      data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)
        ? { ...data.meta }
        : {},
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...n }))
      : [],
    gateResult: data.gateResult && typeof data.gateResult === 'object'
      ? { ...data.gateResult }
      : null,
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

function normalizeBenchmark(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    date: asText(data.date),
    product: coerceProduct(data.product),
    value: asNum(data.value),
    unit: asText(data.unit) || '$/gal',
    market: asText(data.market),
    marketEn: asText(data.marketEn),
    source: asText(data.source),
    sourceUrl: asText(data.sourceUrl),
    note: asText(data.note),
    createdAt: data.createdAt || chicagoIso(),
  };
}

function normalizeEscalation(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    ts: data.ts || chicagoIso(),
    module: 'energy',
    reason: ESCALATION_REASONS.includes(data.reason) ? data.reason : 'compliance',
    inquiryId: asText(data.inquiryId),
    summary: typeof data.summary === 'string' ? data.summary : '',
    payload: data.payload && typeof data.payload === 'object' ? { ...data.payload } : {},
    status: 'awaiting-juan',
  };
}

class EnergyStore {
  constructor() {
    this.backend = storageBackend();
    this.db = this.load();
    this.applySeeds();
  }

  /** Seed the benchmark log on an empty store. Runs after constructor load
   * AND after reset(), so a fresh store always starts with the verified
   * reference data. Re-running is idempotent (seeded flag). */
  applySeeds() {
    if (this.db.benchmarks.length === 0 && !this.db.seeded) {
      for (const seed of SEED_BENCHMARKS) {
        this.db.benchmarks.push(normalizeBenchmark(seed));
      }
      this.db.seeded = true;
      this.save();
    }
  }

  load() {
    try {
      const raw = this.backend.getItem(STORAGE_KEY);
      if (!raw) return { inquiries: [], benchmarks: [], escalations: [], seeded: false };
      const parsed = JSON.parse(raw);
      return {
        inquiries: Array.isArray(parsed.inquiries) ? parsed.inquiries : [],
        benchmarks: Array.isArray(parsed.benchmarks) ? parsed.benchmarks : [],
        escalations: Array.isArray(parsed.escalations) ? parsed.escalations : [],
        seeded: !!parsed.seeded,
      };
    } catch {
      return { inquiries: [], benchmarks: [], escalations: [], seeded: false };
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
    this.db = { inquiries: [], benchmarks: [], escalations: [], seeded: false };
    this.save();
    // A fresh store restarts with the verified reference data (see seeds).
    this.applySeeds();
  }

  // ---- Inquiries ----
  createInquiry(data = {}) {
    const inq = normalizeInquiry(data);
    this.db.inquiries.push(inq);
    this.save();
    return inq;
  }

  getInquiry(id) {
    return this.db.inquiries.find((i) => i.id === id) ?? null;
  }

  updateInquiry(id, patch = {}) {
    const inq = this.getInquiry(id);
    if (!inq) return null;
    // 'commercial' (gate passed) is reachable ONLY through advanceGate() —
    // a direct patch may not bypass the compliance gate.
    if (patch && patch.status === 'commercial') {
      throw new Error(
        'Inquiries reach "commercial" only through advanceGate() after a clean compliance gate.',
      );
    }
    const merged = normalizeInquiry({ ...inq, ...patch, id: inq.id });
    merged.createdAt = inq.createdAt;
    merged.updatedAt = chicagoIso();
    // A patch may never mark the gate passed directly — only advanceGate()
    // sets gateResult.
    if (!patch || typeof patch.gateResult === 'undefined') {
      merged.gateResult = inq.gateResult;
    }
    Object.assign(inq, merged);
    this.save();
    return inq;
  }

  moveInquiry(id, status) {
    const inq = this.getInquiry(id);
    if (!inq) return null;
    // 'commercial' (gate passed) is reachable ONLY through advanceGate().
    if (status === 'commercial') {
      throw new Error(
        'Inquiries reach "commercial" only through advanceGate() after a clean compliance gate.',
      );
    }
    inq.status = coerceStatus(status);
    inq.updatedAt = chicagoIso();
    this.save();
    return inq;
  }

  deleteInquiry(id) {
    const index = this.db.inquiries.findIndex((i) => i.id === id);
    if (index < 0) return false;
    this.db.inquiries.splice(index, 1);
    this.save();
    return true;
  }

  listInquiries(filter) {
    const rows = [...this.db.inquiries];
    if (!filter) return rows;
    if (typeof filter === 'function') return rows.filter(filter);
    return rows.filter((row) =>
      Object.entries(filter).every(([key, value]) => row[key] === value),
    );
  }

  addInquiryNote(inquiryId, agent, es, en) {
    const inq = this.getInquiry(inquiryId);
    if (!inq) return null;
    const note = {
      agent: typeof agent === 'string' ? agent : '',
      es: typeof es === 'string' ? es : '',
      en: typeof en === 'string' ? en : '',
      at: chicagoIso(),
    };
    inq.agentNotes.push(note);
    inq.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Compliance gate (the ONLY path past the gate) ----
  /**
   * Evaluate the compliance gate for an inquiry and act on the result.
   * - Gate PASSES (all 'yes', zero red flags, zero unknowns): the inquiry
   *   moves to 'commercial' and the gate result is recorded.
   * - ANY red flag or ANY unknown: the inquiry moves to 'awaiting-juan',
   *   an escalation record is written, and the caller receives
   *   { advanced: false, escalated: true }. Nothing proceeds commercially.
   *
   * answers: { [checklistItemId]: 'yes'|'no'|'unknown' }.
   */
  advanceGate(inquiryId, answers = {}) {
    const inq = this.getInquiry(inquiryId);
    if (!inq) return { advanced: false, escalated: false, error: 'not-found' };
    const result = evaluateGate(answers);
    inq.gateResult = {
      at: chicagoIso(),
      answers: result.answers,
      passed: result.passed,
      redFlags: result.redFlags.map((f) => f.id),
    };
    if (result.passed) {
      inq.status = 'commercial';
      inq.updatedAt = chicagoIso();
      this.save();
      return { advanced: true, escalated: false, result };
    }
    const escalation = this.createEscalation({
      reason: result.redFlags.length > 0 ? 'sanctions' : 'compliance',
      inquiryId: inq.id,
      summary:
        `Gate de cumplimiento NO aprobado para ${inq.ref || inq.id}: ` +
        `${result.redFlags.length} bandera(s) roja(s), ${result.unanswered.length} sin responder. ` +
        `Nada continúa sin la revisión de Juan.`,
      payload: {
        redFlags: result.redFlags.map((f) => ({
          id: f.id,
          es: f.es,
          en: f.en,
        })),
        unanswered: result.unanswered.map((u) => u.id),
        ref: inq.ref,
      },
    });
    inq.status = 'awaiting-juan';
    inq.updatedAt = chicagoIso();
    this.save();
    return { advanced: false, escalated: true, result, escalation };
  }

  // ---- Benchmarks ----
  addBenchmark(data = {}) {
    const entry = normalizeBenchmark(data);
    this.db.benchmarks.push(entry);
    this.save();
    return entry;
  }

  listBenchmarks(filter) {
    const rows = [...this.db.benchmarks].sort((a, b) =>
      String(b.date).localeCompare(String(a.date)),
    );
    if (!filter) return rows;
    if (typeof filter === 'function') return rows.filter(filter);
    return rows.filter((row) =>
      Object.entries(filter).every(([key, value]) => row[key] === value),
    );
  }

  deleteBenchmark(id) {
    const index = this.db.benchmarks.findIndex((b) => b.id === id);
    if (index < 0) return false;
    this.db.benchmarks.splice(index, 1);
    this.save();
    return true;
  }

  // ---- Escalations ----
  createEscalation(data = {}) {
    const esc = normalizeEscalation(data);
    this.db.escalations.push(esc);
    this.save();
    return esc;
  }

  listEscalations(filter) {
    const rows = [...this.db.escalations];
    if (!filter) return rows;
    if (typeof filter === 'function') return rows.filter(filter);
    return rows.filter((row) =>
      Object.entries(filter).every(([key, value]) => row[key] === value),
    );
  }

  resolveEscalation(id) {
    const esc = this.db.escalations.find((e) => e.id === id);
    if (!esc) return null;
    esc.status = 'resolved-by-juan';
    this.save();
    return esc;
  }

  // ---- Stats ----
  stats() {
    const byStatus = {};
    for (const s of INQUIRY_STATUSES) byStatus[s] = 0;
    for (const inq of this.db.inquiries) {
      if (byStatus[inq.status] !== undefined) byStatus[inq.status] += 1;
    }
    const open = this.db.inquiries.filter(
      (i) => i.status !== 'closed' && i.status !== 'dead',
    );
    let potentialSpread = 0;
    for (const inq of open) {
      try {
        potentialSpread += parcelEconomics(inq).totalSpread;
      } catch {
        /* ignore */
      }
    }
    return {
      totalInquiries: this.db.inquiries.length,
      openInquiries: open.length,
      byStatus,
      pendingEscalations: this.db.escalations.filter(
        (e) => e.status === 'awaiting-juan',
      ).length,
      benchmarkCount: this.db.benchmarks.length,
      potentialSpread: Math.round(potentialSpread),
    };
  }
}

const noteKey = (note) =>
  `${note?.at ?? ''}|${note?.agent ?? ''}|${note?.es ?? ''}`;

const store = new EnergyStore();

// ---- Public API ----
export const createInquiry = (data) => store.createInquiry(data);
export const getInquiry = (id) => store.getInquiry(id);
export const updateInquiry = (id, patch) => store.updateInquiry(id, patch);
export const moveInquiry = (id, status) => store.moveInquiry(id, status);
export const deleteInquiry = (id) => store.deleteInquiry(id);
export const listInquiries = (filter) => store.listInquiries(filter);
export const addInquiryNote = (inquiryId, agent, es, en) =>
  store.addInquiryNote(inquiryId, agent, es, en);
export const advanceGate = (inquiryId, answers) =>
  store.advanceGate(inquiryId, answers);

export const addBenchmark = (data) => store.addBenchmark(data);
export const listBenchmarks = (filter) => store.listBenchmarks(filter);
export const deleteBenchmark = (id) => store.deleteBenchmark(id);

export const createEscalation = (data) => store.createEscalation(data);
export const listEscalations = (filter) => store.listEscalations(filter);
export const resolveEscalation = (id) => store.resolveEscalation(id);

export const stats = () => store.stats();

export function getPorts() {
  return CUBAN_FUEL_PORTS.map((p) => ({ ...p, name: { ...p.name }, note: { ...p.note } }));
}

/**
 * Workforce-adapter view over inquiries. Notes shaped {t, agent, es, en}.
 */
export function asWorkforceStore() {
  return {
    getAll: () => store.listInquiries(),
    get: (id) => store.getInquiry(id),
    update: (id, patch = {}) => {
      const inq = store.getInquiry(id);
      if (!inq) return null;
      const { agentNotes, ...rest } = patch;
      const updated = store.updateInquiry(id, rest);
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
      const inq = store.getInquiry(id);
      if (!inq) return [];
      return (inq.agentNotes || []).map((n) => ({
        t: n.at,
        agent: n.agent,
        es: n.es,
        en: n.en,
      }));
    },
  };
}

/** Testing / maintenance helper: wipe the store. */
export const resetEnergyStore = () => store.reset();

/** Exposed for tests: force reload from the storage backend. */
export const reloadEnergyStore = () => {
  store.db = store.load();
  return store.db;
};
