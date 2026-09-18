/**
 * Cuba market (Dedicated Cuba Desk) dashboard for GOD'S EYE VIEW — $0, no
 * API keys, no external calls.
 *
 * Mission-control panel for the Cuba desk of the import-export department
 * (Module 2). The worldwide global desk is a separate module with its own
 * pipeline — a sourcing request is either Cuba-desk or global, never both,
 * and nothing here files into the global pipeline.
 *
 * Sections (Spanish-first): KPI row, sourcing-request intake form (Spanish),
 * triage pipeline columns, request detail drawer with scoring + broker
 * spread sizing, MIPYME buyer directory (EMPTY unless real records arrive
 * via the CRM import path), partner network list, CSV import/export for the
 * buyer directory.
 *
 * Pure helpers (statusPillClass, verificationLabel, parseBuyersCsv,
 * buyersToCsv, csvTemplate, createMemoryCubaStore, adaptStore,
 * CUBA_DASHBOARD_CSS) are exported for unit tests. The live DOM wiring
 * lives in initCubaDashboard(). This module intentionally does NOT touch
 * Cesium — the port layer owns the 3D entities.
 *
 * Phone-first: 44px touch targets, 16px inputs, ES/EN, nothing hover-only.
 */

export const REQUEST_STATUSES = [
  { id: 'intake', es: 'Nuevas', en: 'New' },
  { id: 'triage', es: 'Triaje', en: 'Triage' },
  { id: 'quoted', es: 'Cotizadas', en: 'Quoted' },
  { id: 'negotiating', es: 'Negociando', en: 'Negotiating' },
  { id: 'won', es: 'Ganadas', en: 'Won' },
  { id: 'lost', es: 'Perdidas', en: 'Lost' },
];

const VALID_REQUEST_STATUSES = new Set(REQUEST_STATUSES.map((s) => s.id));

/** Requests that still count as "open" Cuba-desk business. */
const OPEN_STATUSES = new Set(['intake', 'triage', 'quoted', 'negotiating']);

/** CSS pill class from a verdict tier or request status. */
export function statusPillClass(status) {
  const s = String(status || '').toLowerCase();
  if (['green', 'yellow', 'red', 'gray'].includes(s)) return s;
  if (s === 'won') return 'green';
  if (['triage', 'quoted', 'negotiating'].includes(s)) return 'yellow';
  return 'gray';
}

const VERIFICATION_LABELS = {
  verified: { es: 'Verificado', en: 'Verified' },
  'in-review': { es: 'En revisión', en: 'In review' },
  unverified: { es: 'Sin verificar', en: 'Unverified' },
  flagged: { es: 'Marcado', en: 'Flagged' },
};

export function verificationLabel(status, lang = 'es') {
  const v = VERIFICATION_LABELS[String(status || '').toLowerCase()];
  if (!v) return lang === 'es' ? 'Sin verificar' : 'Unverified';
  return lang === 'es' ? v.es : v.en;
}

function verificationPill(verification) {
  const s = String(verification || '').toLowerCase();
  if (s === 'verified') return 'green';
  if (s === 'in-review') return 'yellow';
  if (s === 'flagged') return 'red';
  return 'gray';
}

export function buyerTypeLabel(type, lang = 'es') {
  const map = {
    'mipyme-privada': { es: 'MIPYME privada', en: 'Private MIPYME' },
    'mipyme-estatal': { es: 'MIPYME estatal', en: 'State MIPYME' },
    tcp: { es: 'TCP', en: 'TCP (self-employed)' },
    cooperativa: { es: 'Cooperativa', en: 'Cooperative' },
    otro: { es: 'Otro', en: 'Other' },
  };
  const v = map[String(type || '').toLowerCase()] || map.otro;
  return lang === 'es' ? v.es : v.en;
}

/**
 * Defensive reads from the injected cubaEngine. Every call is wrapped in
 * try/catch with a neutral fallback, so a missing or throwing engine can
 * never break the drawer.
 */
function engineRead(engine, fn, arg, fallback) {
  try {
    if (engine && typeof engine[fn] === 'function') {
      const v = engine[fn](arg);
      return v === undefined || v === null ? fallback : v;
    }
  } catch {
    /* fall through */
  }
  return fallback;
}

function requestEconomics(req, engine, buyers) {
  const call = (fn, arg, fallback = 0) => {
    const v = engineRead(engine, fn, arg, fallback);
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  let verdict = { tier: 'gray', es: '', en: '', score: 0, reasons: [] };
  try {
    if (engine && typeof engine.requestVerdict === 'function') {
      const v = engine.requestVerdict(req);
      if (v && typeof v === 'object') verdict = v;
    }
  } catch {
    /* keep gray */
  }
  let missing = [];
  try {
    if (engine && typeof engine.missingFields === 'function') {
      const m = engine.missingFields(req);
      if (Array.isArray(m)) missing = m;
    }
  } catch {
    /* keep empty */
  }
  let matches = [];
  try {
    if (engine && typeof engine.rankBuyersForRequest === 'function') {
      const ranked = engine.rankBuyersForRequest(req, buyers || []);
      if (Array.isArray(ranked)) matches = ranked.slice(0, 5);
    }
  } catch {
    /* keep empty */
  }
  return {
    score: call('scoreSourcingRequest', req),
    value: call('requestValue', req),
    verdict,
    missing,
    matches,
  };
}

/**
 * Normalize any Cuba-store-like object to the interface this dashboard
 * uses. Accepts the real cuba store wrapped by tools.js
 * (listRequests/getRequest/createRequest/updateRequest/moveRequest/
 * deleteRequest/addRequestNote/listBuyers/getBuyer/createBuyer/
 * updateBuyer/deleteBuyer/listPartners/getPartner/createPartner/
 * updatePartner/deletePartner/stats/onMutate) or the minimal in-memory
 * shape — adaptStore() normalizes either.
 */
export function adaptStore(raw) {
  if (!raw) return createMemoryCubaStore();
  const listAll = () => {
    try {
      if (typeof raw.listRequests === 'function')
        return raw.listRequests() || [];
      if (typeof raw.getAll === 'function') return raw.getAll() || [];
    } catch {
      /* fall through */
    }
    return [];
  };
  const byId = (id) => {
    if (!id) return null;
    try {
      if (typeof raw.getRequest === 'function') return raw.getRequest(id);
      if (typeof raw.get === 'function') return raw.get(id);
    } catch {
      /* fall through */
    }
    return null;
  };
  const list = (status) => {
    const all = listAll();
    return status ? all.filter((r) => r.status === status) : all;
  };
  const update = (id, patch) => {
    try {
      if (typeof raw.updateRequest === 'function')
        return raw.updateRequest(id, patch);
      if (typeof raw.update === 'function') return raw.update(id, patch);
    } catch {
      /* noop */
    }
    return null;
  };
  const create = (data) => {
    try {
      if (typeof raw.createRequest === 'function') return raw.createRequest(data);
      if (typeof raw.create === 'function') return raw.create(data);
    } catch {
      /* noop */
    }
    return null;
  };
  const addMany = (arr) => {
    try {
      if (typeof raw.createRequest === 'function') {
        return (arr || []).map((r) => raw.createRequest(r)).filter(Boolean);
      }
      if (typeof raw.create === 'function') {
        return (arr || []).map((r) => raw.create(r)).filter(Boolean);
      }
    } catch {
      /* fall through */
    }
    return [];
  };
  const notes = (id) => {
    try {
      if (typeof raw.notes === 'function') {
        return (raw.notes(id) || []).map((n) => ({
          ts: n.ts || n.t || n.at || Date.now(),
          author: n.author || n.agent || '',
          textEs: n.textEs ?? n.es ?? n.text ?? '',
          textEn: n.textEn ?? n.en ?? n.text ?? '',
        }));
      }
    } catch {
      /* fall through to record fields */
    }
    try {
      const req = byId(id);
      const list = (req && (req.agentNotes || req.notes)) || [];
      return (Array.isArray(list) ? list : []).map((n) => ({
        ts: n.ts || n.t || n.at || Date.now(),
        author: n.author || n.agent || '',
        textEs: n.textEs ?? n.es ?? n.text ?? '',
        textEn: n.textEn ?? n.en ?? n.text ?? '',
      }));
    } catch {
      return [];
    }
  };
  const addNote = (id, text) => {
    try {
      if (typeof raw.addRequestNote === 'function') {
        try {
          return raw.addRequestNote(id, text);
        } catch {
          return raw.addRequestNote(id, {
            agent: 'juan',
            es: String(text),
            en: String(text),
          });
        }
      }
      if (typeof raw.addNote === 'function') return raw.addNote(id, text);
    } catch {
      /* noop */
    }
    return null;
  };
  const listBuyers = () => {
    try {
      if (typeof raw.listBuyers === 'function') return raw.listBuyers() || [];
      if (Array.isArray(raw.buyers)) return raw.buyers;
    } catch {
      /* fall through */
    }
    return [];
  };
  const buyerById = (id) => {
    if (!id) return null;
    try {
      if (typeof raw.getBuyer === 'function') return raw.getBuyer(id);
    } catch {
      /* fall through */
    }
    try {
      return listBuyers().find((b) => b.id === id) || null;
    } catch {
      return null;
    }
  };
  const addBuyer = (data) => {
    try {
      if (typeof raw.createBuyer === 'function') return raw.createBuyer(data);
    } catch {
      /* noop */
    }
    return null;
  };
  const updateBuyer = (id, patch) => {
    try {
      if (typeof raw.updateBuyer === 'function')
        return raw.updateBuyer(id, patch);
    } catch {
      /* noop */
    }
    return null;
  };
  const listPartners = () => {
    try {
      if (typeof raw.listPartners === 'function')
        return raw.listPartners() || [];
      if (Array.isArray(raw.partners)) return raw.partners;
    } catch {
      /* fall through */
    }
    return [];
  };
  const addPartner = (data) => {
    try {
      if (typeof raw.createPartner === 'function')
        return raw.createPartner(data);
    } catch {
      /* noop */
    }
    return null;
  };
  const stats = () => {
    try {
      const s = raw.stats?.();
      if (s && typeof s === 'object') return s;
    } catch {
      /* fall through to computed */
    }
    const all = listAll();
    const open = all.filter((r) => OPEN_STATUSES.has(r.status));
    return {
      totalBuyers: listBuyers().length,
      totalRequests: all.length,
      openRequests: open.length,
      totalPartners: listPartners().length,
    };
  };
  const onMutate = (cb) => {
    try {
      if (typeof raw.onMutate === 'function') return raw.onMutate(cb);
    } catch {
      /* noop */
    }
    return null;
  };
  return {
    list,
    listAll,
    byId,
    update,
    create,
    addMany,
    move(id, status) {
      try {
        if (typeof raw.moveRequest === 'function')
          return raw.moveRequest(id, status);
        if (typeof raw.move === 'function') return raw.move(id, status);
        return update(id, { status });
      } catch {
        return null;
      }
    },
    remove(id) {
      try {
        if (typeof raw.deleteRequest === 'function')
          return raw.deleteRequest(id);
        if (typeof raw.remove === 'function') return raw.remove(id);
      } catch {
        /* noop */
      }
      return null;
    },
    notes,
    addNote,
    stats,
    listBuyers,
    buyerById,
    addBuyer,
    updateBuyer,
    listPartners,
    addPartner,
    onMutate,
  };
}

/** In-memory Cuba store exposing the tools.js-wrapped API, for tests and standalone use. */
export function createMemoryCubaStore(seed = {}) {
  let reqSeq = 1;
  let buyerSeq = 1;
  let partnerSeq = 1;
  const requests = new Map();
  const reqNotes = new Map();
  const buyers = new Map();
  const partners = new Map();
  const listeners = new Set();
  const normReq = (r) => ({
    id: r.id || `sreq-${reqSeq++}`,
    ref: r.ref || `CUBA-${String(reqSeq).padStart(3, '0')}`,
    buyerId: r.buyerId || '',
    product: r.product || '',
    quantity: Number(r.quantity) || 0,
    targetPrice: Number(r.targetPrice) || 0,
    currency: r.currency || 'USD',
    incoterms: r.incoterms || '',
    destinationPort: r.destinationPort || '',
    timeline: r.timeline || '',
    status: VALID_REQUEST_STATUSES.has(r.status) ? r.status : 'intake',
    notes: typeof r.notes === 'string' ? r.notes : '',
    agentNotes: Array.isArray(r.agentNotes) ? r.agentNotes : [],
    createdAt: r.createdAt || Date.now(),
    updatedAt: r.updatedAt || Date.now(),
    score: Number(r.score) || 0,
  });
  const normBuyer = (b) => ({
    id: b.id || `buyer-${buyerSeq++}`,
    name: b.name || '',
    type: b.type || 'mipyme-privada',
    province: b.province || '',
    municipality: b.municipality || '',
    contact: {
      name: b.contact?.name || b.contactName || '',
      phone: b.contact?.phone || b.contactPhone || '',
      email: b.contact?.email || b.contactEmail || '',
      whatsapp: b.contact?.whatsapp || b.contactWhatsapp || '',
    },
    activity: b.activity || '',
    interestedProducts: Array.isArray(b.interestedProducts)
      ? b.interestedProducts
      : [],
    verification: ['verified', 'in-review', 'unverified', 'flagged'].includes(
      String(b.verification || '').toLowerCase(),
    )
      ? String(b.verification).toLowerCase()
      : 'unverified',
    notes: typeof b.notes === 'string' ? b.notes : '',
    createdAt: b.createdAt || Date.now(),
    updatedAt: b.updatedAt || Date.now(),
  });
  const normPartner = (p) => ({
    id: p.id || `partner-${partnerSeq++}`,
    name: p.name || '',
    type: p.type || 'commercial',
    country: p.country || '',
    contact: {
      name: p.contact?.name || '',
      phone: p.contact?.phone || '',
      email: p.contact?.email || '',
    },
    verification: ['verified', 'in-review', 'unverified', 'flagged'].includes(
      String(p.verification || '').toLowerCase(),
    )
      ? String(p.verification).toLowerCase()
      : 'unverified',
    notes: typeof p.notes === 'string' ? p.notes : '',
    createdAt: p.createdAt || Date.now(),
    updatedAt: p.updatedAt || Date.now(),
  });
  const notify = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* listener must not break the store */
      }
    }
  };
  for (const r of seed.requests || []) {
    const n = normReq(r);
    requests.set(n.id, n);
  }
  for (const b of seed.buyers || []) {
    const n = normBuyer(b);
    buyers.set(n.id, n);
  }
  for (const p of seed.partners || []) {
    const n = normPartner(p);
    partners.set(n.id, n);
  }
  return {
    createRequest(data) {
      const n = normReq(data || {});
      requests.set(n.id, n);
      notify();
      return n;
    },
    getRequest(id) {
      return requests.get(id) || null;
    },
    updateRequest(id, patch) {
      const cur = requests.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, id, updatedAt: Date.now() };
      if (patch && patch.status && !VALID_REQUEST_STATUSES.has(patch.status)) {
        next.status = cur.status;
      }
      requests.set(id, next);
      notify();
      return next;
    },
    moveRequest(id, status) {
      return this.updateRequest(id, { status });
    },
    deleteRequest(id) {
      reqNotes.delete(id);
      const out = requests.delete(id);
      notify();
      return out;
    },
    listRequests(status) {
      const all = [...requests.values()];
      return status ? all.filter((r) => r.status === status) : all;
    },
    addMany(arr) {
      return (arr || []).map((r) => this.createRequest(r));
    },
    notes(id) {
      return reqNotes.get(id) || [];
    },
    addRequestNote(id, text) {
      const list = reqNotes.get(id) || [];
      const note = {
        t: Date.now(),
        agent: 'juan',
        es: String(text),
        en: String(text),
      };
      list.push(note);
      reqNotes.set(id, list);
      notify();
      return note;
    },
    createBuyer(data) {
      const n = normBuyer(data || {});
      buyers.set(n.id, n);
      notify();
      return n;
    },
    getBuyer(id) {
      return buyers.get(id) || null;
    },
    updateBuyer(id, patch) {
      const cur = buyers.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, id, updatedAt: Date.now() };
      buyers.set(id, next);
      notify();
      return next;
    },
    listBuyers() {
      return [...buyers.values()];
    },
    createPartner(data) {
      const n = normPartner(data || {});
      partners.set(n.id, n);
      notify();
      return n;
    },
    getPartner(id) {
      return partners.get(id) || null;
    },
    listPartners() {
      return [...partners.values()];
    },
    stats() {
      const all = [...requests.values()];
      const open = all.filter((r) => OPEN_STATUSES.has(r.status));
      return {
        totalBuyers: buyers.size,
        totalRequests: all.length,
        openRequests: open.length,
        totalPartners: partners.size,
      };
    },
    onMutate(fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const CUBA_CSS = `
#gev-cuba-btn{display:flex;align-items:center;gap:8px;padding:12px 14px;margin-top:8px;background:rgba(10,14,22,.82);border:1px solid rgba(52,211,153,.32);border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:14px;font-weight:700;letter-spacing:.06em;min-width:172px;max-width:220px;min-height:52px}
#gev-cuba-btn:hover{border-color:rgba(52,211,153,.65)}
#gev-cuba-btn .tbadge{background:#34d399;color:#08111b;font-weight:800;font-size:12px;border-radius:999px;padding:2px 9px;margin-left:auto}
#gev-cuba-btn .tbadge.zero{background:rgba(148,163,184,.35);color:#e2e8f0}
#gev-cuba-panel{position:fixed;z-index:60;right:12px;top:12px;width:min(860px,calc(100vw - 24px));height:min(660px,calc(100vh - 24px));background:rgba(8,11,18,.98);border:1px solid rgba(52,211,153,.4);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7;font-size:14px}
#gev-cuba-panel .cdp-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(52,211,153,.18)}
#gev-cuba-panel .cdp-title{font-size:15px;font-weight:800;letter-spacing:.1em;color:#6ee7b7;flex:1}
#gev-cuba-panel .cdp-lang{background:none;border:1px solid rgba(52,211,153,.4);color:#6ee7b7;border-radius:10px;padding:10px 14px;cursor:pointer;font-size:13px;font-weight:800;font-family:inherit;min-height:44px}
#gev-cuba-panel .cdp-close{background:none;border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:10px;min-width:44px;min-height:44px;cursor:pointer;font-size:18px}
#gev-cuba-panel .cdp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px 14px;border-bottom:1px solid rgba(52,211,153,.18)}
#gev-cuba-panel .cdp-kpi{background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.2);border-radius:10px;padding:10px}
#gev-cuba-panel .cdp-kpi .k{font-size:11px;font-weight:700;color:#c3d0e4;letter-spacing:.05em}
#gev-cuba-panel .cdp-kpi .v{font-size:20px;font-weight:800;color:#fff}
#gev-cuba-panel .cdp-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 14px;border-bottom:1px solid rgba(52,211,153,.18)}
#gev-cuba-panel .cdp-btn{padding:11px 16px;border-radius:10px;border:1px solid rgba(52,211,153,.4);background:rgba(52,211,153,.12);color:#d1fae5;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px}
#gev-cuba-panel .cdp-btn:hover{background:rgba(52,211,153,.22)}
#gev-cuba-panel .cdp-btn.primary{background:rgba(52,211,153,.28);color:#fff}
#gev-cuba-panel .cdp-status{font-size:12px;color:#c3d0e4}
#gev-cuba-panel .cdp-empty{margin:12px 14px 0;padding:18px;border:1px dashed rgba(52,211,153,.4);border-radius:10px;font-size:14px;color:#c3d0e4;text-align:center}
#gev-cuba-panel .cdp-boundary{margin:12px 14px 0;padding:10px 14px;border:1px solid rgba(251,191,36,.35);border-radius:10px;font-size:12px;color:#fbbf24;background:rgba(251,191,36,.06)}
#gev-cuba-panel .cdp-cols{flex:1;display:flex;gap:8px;overflow-x:auto;padding:12px 14px;min-height:0}
#gev-cuba-panel .cdp-col{min-width:200px;flex:1;background:rgba(255,255,255,.03);border:1px solid rgba(52,211,153,.15);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
#gev-cuba-panel .cdp-colhead{font-size:12px;font-weight:800;letter-spacing:.08em;color:#6ee7b7;padding:10px 12px;border-bottom:1px solid rgba(52,211,153,.12);text-transform:uppercase}
#gev-cuba-panel .cdp-cards{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:10px}
#gev-cuba-panel .cdp-card{background:rgba(10,14,22,.9);border:1px solid rgba(52,211,153,.25);border-radius:12px;padding:12px;cursor:pointer;font-size:13px;min-height:44px}
#gev-cuba-panel .cdp-card:hover{border-color:rgba(52,211,153,.55)}
#gev-cuba-panel .cdp-card .rref{font-weight:800;color:#fff;margin-bottom:6px;font-size:14px}
#gev-cuba-panel .cdp-card .rmeta{display:flex;align-items:center;gap:8px;color:#c3d0e4;flex-wrap:wrap;font-size:13px}
#gev-cuba-panel .pill{font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px}
#gev-cuba-panel .pill.green{background:rgba(52,211,153,.18);color:#34d399;border:1px solid rgba(52,211,153,.4)}
#gev-cuba-panel .pill.yellow{background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.4)}
#gev-cuba-panel .pill.red{background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.4)}
#gev-cuba-panel .pill.gray{background:rgba(148,163,184,.15);color:#94a3b8;border:1px solid rgba(148,163,184,.4)}
#gev-cuba-panel .cdp-colempty{font-size:11px;color:#5b6b82;padding:12px;text-align:center}
#gev-cuba-drawer{position:absolute;top:0;right:0;bottom:0;width:min(420px,94%);background:rgba(10,14,22,.99);border-left:1px solid rgba(52,211,153,.4);padding:16px;overflow-y:auto;font-size:14px}
#gev-cuba-drawer h3{margin:0 0 6px;font-size:17px;color:#fff}
#gev-cuba-drawer .dsub{font-size:13px;color:#c3d0e4;margin-bottom:12px}
#gev-cuba-drawer label{display:block;font-size:12px;font-weight:700;color:#c3d0e4;margin:10px 0 5px;letter-spacing:.05em}
#gev-cuba-drawer input,#gev-cuba-drawer select,#gev-cuba-drawer textarea{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(52,211,153,.35);border-radius:10px;color:#fff;padding:12px;font-size:16px;font-family:inherit;min-height:48px}
#gev-cuba-drawer .math{background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.25);border-radius:12px;padding:12px;margin-top:12px}
#gev-cuba-drawer .math .mrow{display:flex;justify-content:space-between;margin:5px 0;font-size:14px;color:#c3d0e4}
#gev-cuba-drawer .math .mrow b{color:#fff;font-size:15px}
#gev-cuba-drawer .math .mrow.total{border-top:1px solid rgba(52,211,153,.25);padding-top:8px;margin-top:8px}
#gev-cuba-drawer .note{border-left:2px solid rgba(52,211,153,.5);padding:6px 10px;margin:8px 0;font-size:13px;color:#d4deee}
#gev-cuba-drawer .note .nts{font-size:11px;color:#8a99ae}
#gev-cuba-intake{background:rgba(52,211,153,.05);border-top:1px solid rgba(52,211,153,.18);padding:12px 14px;font-size:14px}
#gev-cuba-intake .intitle{font-size:12px;font-weight:800;letter-spacing:.08em;color:#6ee7b7;margin-bottom:8px}
#gev-cuba-intake .inform{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#gev-cuba-intake input,#gev-cuba-intake select{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(52,211,153,.35);border-radius:10px;color:#fff;padding:12px;font-size:16px;font-family:inherit;min-height:48px;min-width:0}
#gev-cuba-list{background:rgba(52,211,153,.03);border-top:1px solid rgba(52,211,153,.18);padding:12px 14px;font-size:13px;max-height:220px;overflow-y:auto}
#gev-cuba-list .lrow{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;color:#d4deee;border-bottom:1px solid rgba(52,211,153,.08);min-height:44px}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-cuba-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-cuba-styles';
  style.textContent = CUBA_CSS;
  document.head.appendChild(style);
}

/**
 * Exported for tests: phone-usability assertions verify the touch-target
 * and readability rules (min-height 44px, 16px inputs, larger type) from
 * the shipped stylesheet itself.
 */
export const CUBA_DASHBOARD_CSS = CUBA_CSS;

function defaultMoney(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US')}`;
}

/**
 * Live controller: dock button + floating Cuba-desk mission-control panel.
 * options: { cubaStore, cubaEngine, cubaMap, workforce, signal, parseCsv }
 * cubaStore may be the real cuba store wrapped by tools.js
 * (listRequests/getRequest/createRequest/updateRequest/moveRequest/
 * deleteRequest/listBuyers/getBuyer/createBuyer/updateBuyer/deleteBuyer/
 * listPartners/createPartner/stats/onMutate) or the minimal in-memory
 * shape — adaptStore() normalizes either.
 */
export function initCubaDashboard({
  cubaStore = null,
  cubaEngine = null,
  cubaMap = null,
  workforce = null,
  signal = null,
  parseCsv = null,
} = {}) {
  injectStyles();
  const store = adaptStore(cubaStore);
  // Defensive: a throwing or hostile engine must never break the drawer.
  const fmtMoney = (n) => {
    const v = engineRead(cubaEngine, 'formatMoney', n, null);
    if (typeof v === 'string' && v) return v;
    return defaultMoney(n);
  };
  const aborted = { current: false };
  signal?.addEventListener?.(
    'abort',
    () => {
      aborted.current = true;
    },
    { once: true },
  );

  let lang = 'es'; // Cuba desk is Spanish-first.
  let panelEl = null;
  let btnEl = null;
  let selectedId = null;
  let unsubMutate = null;
  const t = (es, en) => (lang === 'es' ? es : en);

  function statusLabel(id) {
    const s = REQUEST_STATUSES.find((x) => x.id === id);
    return s ? t(s.es, s.en) : id;
  }

  function listAll() {
    try {
      return store.listAll() || store.list() || [];
    } catch {
      return [];
    }
  }

  function renderKpis() {
    const box = panelEl?.querySelector('#gev-cuba-kpis');
    if (!box) return;
    let s = {
      totalBuyers: 0,
      verifiedBuyers: 0,
      totalRequests: 0,
      openRequests: 0,
      avgRequestScore: 0,
      totalPartners: 0,
      verifiedPartners: 0,
    };
    try {
      s = { ...s, ...(store.stats() || {}) };
    } catch {
      /* keep defaults */
    }
    box.innerHTML = `
      <div class="cdp-kpi"><div class="k">${t('COMPRADORES MIPYME', 'MIPYME BUYERS')}</div><div class="v">${Number(s.totalBuyers) || 0}</div></div>
      <div class="cdp-kpi"><div class="k">${t('SOLICITUDES ABIERTAS', 'OPEN REQUESTS')}</div><div class="v">${Number(s.openRequests) || 0}</div></div>
      <div class="cdp-kpi"><div class="k">${t('SOCIOS VERIFICADOS', 'VERIFIED PARTNERS')}</div><div class="v">${Number(s.verifiedPartners) || 0}</div></div>
      <div class="cdp-kpi"><div class="k">${t('PUNTAJE PROMEDIO', 'AVG SCORE')}</div><div class="v">${Number(s.avgRequestScore) || 0}</div></div>
    `;
  }

  function renderColumns() {
    const cols = panelEl?.querySelector('#gev-cuba-cols');
    if (!cols) return;
    cols.innerHTML = '';
    const total = listAll().length;
    if (total === 0) {
      const empty = document.createElement('div');
      empty.className = 'cdp-empty';
      empty.textContent = t(
        'Sin solicitudes — registra la primera abajo o importa el CSV',
        'No requests yet — log the first one below or import a CSV',
      );
      cols.appendChild(empty);
    }
    for (const st of REQUEST_STATUSES) {
      const col = document.createElement('div');
      col.className = 'cdp-col';
      col.dataset.status = st.id;
      const head = document.createElement('div');
      head.className = 'cdp-colhead';
      const cards = document.createElement('div');
      cards.className = 'cdp-cards';
      let reqs = [];
      try {
        reqs = store.list(st.id) || [];
      } catch {
        reqs = [];
      }
      head.textContent = `${t(st.es, st.en)} (${reqs.length})`;
      if (!reqs.length) {
        const empty = document.createElement('div');
        empty.className = 'cdp-colempty';
        empty.textContent = '—';
        cards.appendChild(empty);
      }
      for (const req of reqs) {
        const card = document.createElement('div');
        card.className = 'cdp-card';
        card.dataset.requestId = req.id;
        const ref = document.createElement('div');
        ref.className = 'rref';
        ref.textContent = req.ref || t('(sin referencia)', '(no ref)');
        const meta = document.createElement('div');
        meta.className = 'rmeta';
        const pill = document.createElement('span');
        let tier = 'gray';
        try {
          const v = requestEconomics(req, cubaEngine, store.listBuyers())
            .verdict;
          if (v && v.tier) tier = v.tier;
        } catch {
          /* keep gray */
        }
        pill.className = `pill ${statusPillClass(tier)}`;
        pill.textContent = tier === 'green'
          ? t('LISTA', 'READY')
          : tier === 'yellow'
            ? t('PARCIAL', 'PARTIAL')
            : tier === 'red'
              ? t('DÉBIL', 'WEAK')
              : '—';
        const info = document.createElement('span');
        const qty = (Number(req.quantity) || 0).toLocaleString('en-US');
        info.textContent = `${req.product || ''} · ${qty} u`;
        meta.appendChild(pill);
        meta.appendChild(info);
        card.appendChild(ref);
        card.appendChild(meta);
        card.addEventListener('click', () => openDrawer(req.id));
        cards.appendChild(card);
      }
      col.appendChild(head);
      col.appendChild(cards);
      cols.appendChild(col);
    }
  }

  function buyerName(id) {
    if (!id) return '—';
    try {
      const b = store.buyerById(id);
      return b?.name || '—';
    } catch {
      return '—';
    }
  }

  function renderDrawerBody() {
    const drawer = panelEl?.querySelector('#gev-cuba-drawer');
    if (!drawer) return;
    const req = store.byId(selectedId);
    if (!req) {
      drawer.innerHTML = '';
      return;
    }
    const econ = requestEconomics(req, cubaEngine, store.listBuyers());
    const verdict = econ.verdict || { tier: 'gray', es: '', en: '' };
    drawer.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = req.ref || t('(sin referencia)', '(no ref)');
    const sub = document.createElement('div');
    sub.className = 'dsub';
    sub.textContent = [
      req.product,
      `${(Number(req.quantity) || 0).toLocaleString('en-US')} u`,
      buyerName(req.buyerId),
    ]
      .filter(Boolean)
      .join(' · ');
    const vpill = document.createElement('span');
    vpill.className = `pill ${statusPillClass(verdict.tier)}`;
    vpill.style.marginLeft = '8px';
    vpill.textContent = t(
      {
        green: 'LISTA',
        yellow: 'PARCIAL',
        red: 'DÉBIL',
        gray: '—',
      }[verdict.tier] || verdict.tier,
      String(verdict.tier || '').toUpperCase(),
    );
    h.appendChild(vpill);
    drawer.appendChild(h);
    drawer.appendChild(sub);

    const fieldDefs = [
      ['status', t('Estado', 'Status'), 'status'],
      ['ref', t('Referencia', 'Reference'), 'text'],
      ['buyerId', t('Comprador', 'Buyer'), 'buyer'],
      ['product', t('Producto', 'Product'), 'text'],
      ['quantity', t('Cantidad', 'Quantity'), 'number'],
      ['targetPrice', t('Precio objetivo ($/u)', 'Target price ($/u)'), 'number'],
      ['currency', t('Moneda', 'Currency'), 'text'],
      ['incoterms', 'Incoterms', 'text'],
      ['destinationPort', t('Puerto de destino', 'Destination port'), 'text'],
      ['timeline', t('Plazo de entrega', 'Delivery timeline'), 'text'],
    ];
    for (const [key, label, kind] of fieldDefs) {
      const lab = document.createElement('label');
      lab.textContent = label;
      drawer.appendChild(lab);
      let input;
      if (kind === 'status') {
        input = document.createElement('select');
        for (const st of REQUEST_STATUSES) {
          const opt = document.createElement('option');
          opt.value = st.id;
          opt.textContent = t(st.es, st.en);
          if (req.status === st.id) opt.selected = true;
          input.appendChild(opt);
        }
      } else if (kind === 'buyer') {
        input = document.createElement('select');
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '—';
        input.appendChild(none);
        let buyers = [];
        try {
          buyers = store.listBuyers() || [];
        } catch {
          buyers = [];
        }
        for (const b of buyers) {
          const opt = document.createElement('option');
          opt.value = b.id;
          opt.textContent = b.name || b.id;
          if (req.buyerId === b.id) opt.selected = true;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.type = kind === 'number' ? 'number' : 'text';
        input.value = req[key] ?? '';
      }
      input.dataset.field = key;
      input.addEventListener('change', () => {
        const patch = {};
        if (kind === 'number') {
          const v = Number(input.value);
          patch[key] = Number.isFinite(v) ? v : 0;
        } else patch[key] = input.value;
        if (key === 'status') store.move(selectedId, patch[key]);
        else store.update(selectedId, patch);
        refresh();
        renderDrawerBody();
      });
      drawer.appendChild(input);
    }

    const math = document.createElement('div');
    math.className = 'math';
    const mTitle = document.createElement('div');
    mTitle.style.cssText =
      'font-size:10px;font-weight:800;letter-spacing:.08em;color:#6ee7b7;margin-bottom:6px';
    mTitle.textContent = t('TRIAJE DE LA SOLICITUD', 'REQUEST TRIAGE');
    math.appendChild(mTitle);
    const rows = [
      [t('Puntaje', 'Score'), `${Math.round(econ.score)}/100`],
      [t('Valor bruto de la solicitud', 'Gross request value'), fmtMoney(econ.value)],
      [t('Destino', 'Destination'), req.destinationPort || '—'],
    ];
    for (const [label, val] of rows) {
      const r = document.createElement('div');
      r.className = 'mrow';
      const lab = document.createElement('span');
      lab.textContent = label;
      const b = document.createElement('b');
      b.textContent = val;
      r.appendChild(lab);
      r.appendChild(b);
      math.appendChild(r);
    }
    const brokerNote = document.createElement('div');
    brokerNote.style.cssText =
      'margin-top:8px;font-size:11px;color:#fbbf24';
    brokerNote.textContent = t(
      'SAHJONY actúa como intermediario por honorario/comisión — nunca compra la mercancía, cero capital en riesgo.',
      'SAHJONY acts as a fee/commission broker — never buys the goods, zero capital at risk.',
    );
    math.appendChild(brokerNote);
    if ((econ.missing || []).length) {
      const miss = document.createElement('div');
      miss.style.cssText = 'margin-top:8px;font-size:11px;color:#fbbf24';
      miss.textContent = `${t('Faltan campos', 'Missing fields')}: ${econ.missing
        .map((m) => (lang === 'es' ? m.es || m.field : m.en || m.field))
        .filter(Boolean)
        .join(', ')}`;
      math.appendChild(miss);
    }
    drawer.appendChild(math);

    if ((econ.matches || []).length) {
      const mt = document.createElement('div');
      mt.style.cssText =
        'font-size:10px;font-weight:800;letter-spacing:.08em;color:#6ee7b7;margin:12px 0 4px';
      mt.textContent = t('COMPRADORES COMPATIBLES', 'MATCHED BUYERS');
      drawer.appendChild(mt);
      for (const { buyer, score } of econ.matches) {
        const d = document.createElement('div');
        d.className = 'note';
        const tx = document.createElement('div');
        tx.textContent = `${buyer.name || '—'} — ${score}/100`;
        const ts = document.createElement('div');
        ts.className = 'nts';
        ts.textContent = [buyer.province, buyerTypeLabel(buyer.type, lang)]
          .filter(Boolean)
          .join(' · ');
        d.appendChild(tx);
        d.appendChild(ts);
        drawer.appendChild(d);
      }
    }

    const notesTitle = document.createElement('div');
    notesTitle.style.cssText =
      'font-size:10px;font-weight:800;letter-spacing:.08em;color:#6ee7b7;margin:12px 0 4px';
    notesTitle.textContent = t('NOTAS DEL AGENTE', 'AGENT NOTES');
    drawer.appendChild(notesTitle);
    let ns = [];
    try {
      ns = store.notes(req.id) || [];
    } catch {
      ns = [];
    }
    for (const n of ns) {
      const d = document.createElement('div');
      d.className = 'note';
      const tx = document.createElement('div');
      tx.textContent = t(n.textEs, n.textEn) || '';
      const ts = document.createElement('div');
      ts.className = 'nts';
      const when = n.ts ? new Date(n.ts).toLocaleString() : '';
      ts.textContent = `${n.author || ''}${when ? ` · ${when}` : ''}`;
      d.appendChild(tx);
      d.appendChild(ts);
      drawer.appendChild(d);
    }
    const noteRow = document.createElement('div');
    noteRow.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = t('Agregar nota…', 'Add a note…');
    const noteBtn = document.createElement('button');
    noteBtn.className = 'cdp-btn';
    noteBtn.type = 'button';
    noteBtn.textContent = t('Guardar', 'Save');
    noteBtn.addEventListener('click', () => {
      const v = String(noteInput.value || '').trim();
      if (!v) return;
      store.addNote(req.id, v);
      refresh();
      renderDrawerBody();
    });
    noteRow.appendChild(noteInput);
    noteRow.appendChild(noteBtn);
    drawer.appendChild(noteRow);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'cdp-btn';
    closeBtn.type = 'button';
    closeBtn.style.marginTop = '12px';
    closeBtn.textContent = t('Cerrar', 'Close');
    closeBtn.addEventListener('click', () => {
      selectedId = null;
      drawer.innerHTML = '';
    });
    drawer.appendChild(closeBtn);
  }

  function openDrawer(id) {
    selectedId = id;
    renderDrawerBody();
  }

  function renderIntake() {
    const box = panelEl?.querySelector('#gev-cuba-intake');
    if (!box) return;
    box.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'intitle';
    title.textContent = t(
      'NUEVA SOLICITUD DE ABASTECIMIENTO',
      'NEW SOURCING REQUEST',
    );
    box.appendChild(title);
    const form = document.createElement('div');
    form.className = 'inform';
    const fields = {};
    const mk = (key, placeholder, kind = 'text', options = null) => {
      let input;
      if (kind === 'select') {
        input = document.createElement('select');
        const none = document.createElement('option');
        none.value = '';
        none.textContent = placeholder;
        input.appendChild(none);
        for (const opt of options || []) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          input.appendChild(o);
        }
      } else {
        input = document.createElement('input');
        input.type = kind === 'number' ? 'number' : 'text';
        input.placeholder = placeholder;
      }
      form.appendChild(input);
      fields[key] = input;
      return input;
    };
    mk('ref', t('Referencia (ej. CUBA-001)', 'Reference (e.g. CUBA-001)'));
    mk('product', t('Producto *', 'Product *'));
    mk('quantity', t('Cantidad *', 'Quantity *'), 'number');
    mk('targetPrice', t('Precio objetivo $/u', 'Target price $/unit'), 'number');
    let buyers = [];
    try {
      buyers = store.listBuyers() || [];
    } catch {
      buyers = [];
    }
    mk(
      'buyerId',
      t('Comprador', 'Buyer'),
      'select',
      buyers.map((b) => ({ value: b.id, label: b.name || b.id })),
    );
    mk(
      'destinationPort',
      t('Puerto de destino', 'Destination port'),
      'select',
      [
        { value: 'Mariel', label: 'Mariel' },
        { value: 'La Habana', label: t('La Habana', 'Havana') },
        {
          value: 'Santiago de Cuba',
          label: t('Santiago de Cuba', 'Santiago de Cuba'),
        },
        { value: 'Cienfuegos', label: 'Cienfuegos' },
      ],
    );
    mk('timeline', t('Plazo de entrega', 'Delivery timeline'));
    mk(
      'incoterms',
      'Incoterms',
      'select',
      ['FOB', 'CIF', 'EXW', 'DAP', 'DDP'].map((v) => ({
        value: v,
        label: v,
      })),
    );
    const actions = document.createElement('div');
    actions.style.gridColumn = '1 / -1';
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'cdp-btn primary';
    saveBtn.type = 'button';
    saveBtn.textContent = t('Registrar solicitud', 'Log request');
    saveBtn.addEventListener('click', () => {
      const data = {};
      for (const [key, input] of Object.entries(fields)) {
        const v = String(input.value || '').trim();
        if (v) data[key] = key === 'quantity' || key === 'targetPrice'
          ? Number(v)
          : v;
      }
      if (!data.product || !data.quantity) {
        const st = panelEl.querySelector('#gev-cuba-intake-status');
        if (st)
          st.textContent = t(
            'Producto y cantidad son obligatorios.',
            'Product and quantity are required.',
          );
        return;
      }
      const created = store.create(data);
      if (created) {
        for (const input of Object.values(fields)) input.value = '';
        refresh();
      }
    });
    actions.appendChild(saveBtn);
    form.appendChild(actions);
    box.appendChild(form);
    const st = document.createElement('div');
    st.id = 'gev-cuba-intake-status';
    st.className = 'cdp-status';
    st.style.marginTop = '8px';
    box.appendChild(st);
  }

  function renderBuyers() {
    const box = panelEl?.querySelector('#gev-cuba-buyers');
    if (!box) return;
    box.innerHTML = '';
    const title = document.createElement('div');
    title.style.cssText =
      'font-weight:800;color:#6ee7b7;letter-spacing:.08em;font-size:10px;margin-bottom:6px';
    title.textContent = t('DIRECTORIO DE COMPRADORES MIPYME', 'MIPYME BUYER DIRECTORY');
    box.appendChild(title);
    let buyers = [];
    try {
      buyers = store.listBuyers() || [];
    } catch {
      buyers = [];
    }
    if (!buyers.length) {
      const empty = document.createElement('div');
      empty.className = 'cdp-colempty';
      empty.textContent = t(
        'Directorio vacío — solo registros reales del CRM. Importe un CSV o agregue un comprador verificado.',
        'Directory empty — real CRM records only. Import a CSV or add a verified buyer.',
      );
      box.appendChild(empty);
    }
    for (const b of buyers) {
      const row = document.createElement('div');
      row.className = 'lrow';
      const left = document.createElement('div');
      const nm = document.createElement('div');
      nm.style.fontWeight = '700';
      nm.style.color = '#fff';
      nm.textContent = b.name || '—';
      const sub = document.createElement('div');
      sub.style.fontSize = '10px';
      sub.style.color = '#9fb0c9';
      sub.textContent = [b.province, b.municipality, buyerTypeLabel(b.type, lang)]
        .filter(Boolean)
        .join(' · ');
      left.appendChild(nm);
      left.appendChild(sub);
      const vpill = document.createElement('span');
      vpill.className = `pill ${verificationPill(b.verification)}`;
      vpill.textContent = verificationLabel(b.verification, lang);
      row.appendChild(left);
      row.appendChild(vpill);
      box.appendChild(row);
    }
    // Quick-add buyer (real records only — never invented).
    const form = document.createElement('div');
    form.style.cssText =
      'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px';
    const fields = {};
    const mk = (key, placeholder) => {
      const input = document.createElement('input');
      input.placeholder = placeholder;
      form.appendChild(input);
      fields[key] = input;
      return input;
    };
    mk('name', t('Nombre del comprador *', 'Buyer name *'));
    mk('province', t('Provincia', 'Province'));
    mk('municipality', t('Municipio', 'Municipality'));
    mk('whatsapp', t('WhatsApp', 'WhatsApp'));
    const addBtn = document.createElement('button');
    addBtn.className = 'cdp-btn';
    addBtn.type = 'button';
    addBtn.style.gridColumn = '1 / -1';
    addBtn.textContent = t('Agregar comprador verificado', 'Add verified buyer');
    addBtn.addEventListener('click', () => {
      const name = String(fields.name.value || '').trim();
      if (!name) return;
      store.addBuyer({
        name,
        province: String(fields.province.value || '').trim(),
        municipality: String(fields.municipality.value || '').trim(),
        contact: { whatsapp: String(fields.whatsapp.value || '').trim() },
      });
      refresh();
    });
    form.appendChild(addBtn);
    box.appendChild(form);
  }

  function renderPartners() {
    const box = panelEl?.querySelector('#gev-cuba-partners');
    if (!box) return;
    box.innerHTML = '';
    const title = document.createElement('div');
    title.style.cssText =
      'font-weight:800;color:#6ee7b7;letter-spacing:.08em;font-size:10px;margin-bottom:6px';
    title.textContent = t('RED DE SOCIOS', 'PARTNER NETWORK');
    box.appendChild(title);
    let partners = [];
    try {
      partners = store.listPartners() || [];
    } catch {
      partners = [];
    }
    if (!partners.length) {
      const empty = document.createElement('div');
      empty.className = 'cdp-colempty';
      empty.textContent = t(
        'Sin socios registrados — solo socios reales.',
        'No partners registered — real partners only.',
      );
      box.appendChild(empty);
    }
    for (const p of partners) {
      const row = document.createElement('div');
      row.className = 'lrow';
      const left = document.createElement('div');
      const nm = document.createElement('div');
      nm.style.fontWeight = '700';
      nm.style.color = '#fff';
      nm.textContent = p.name || '—';
      const sub = document.createElement('div');
      sub.style.fontSize = '10px';
      sub.style.color = '#9fb0c9';
      sub.textContent = [p.type, p.country].filter(Boolean).join(' · ');
      left.appendChild(nm);
      left.appendChild(sub);
      const vpill = document.createElement('span');
      vpill.className = `pill ${verificationPill(p.verification)}`;
      vpill.textContent = verificationLabel(p.verification, lang);
      row.appendChild(left);
      row.appendChild(vpill);
      box.appendChild(row);
    }
    const form = document.createElement('div');
    form.style.cssText =
      'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px';
    const fields = {};
    const mk = (key, placeholder) => {
      const input = document.createElement('input');
      input.placeholder = placeholder;
      form.appendChild(input);
      fields[key] = input;
      return input;
    };
    mk('name', t('Nombre del socio *', 'Partner name *'));
    mk('country', t('País', 'Country'));
    const addBtn = document.createElement('button');
    addBtn.className = 'cdp-btn';
    addBtn.type = 'button';
    addBtn.style.gridColumn = '1 / -1';
    addBtn.textContent = t('Agregar socio', 'Add partner');
    addBtn.addEventListener('click', () => {
      const name = String(fields.name.value || '').trim();
      if (!name) return;
      store.addPartner({
        name,
        country: String(fields.country.value || '').trim(),
      });
      refresh();
    });
    form.appendChild(addBtn);
    box.appendChild(form);
  }

  function renderWorkforceControls() {
    const old = panelEl?.querySelectorAll?.('.cdp-wf');
    old?.forEach((el) => el.remove());
    if (!workforce || !panelEl) return;
    const tools = panelEl.querySelector('.cdp-tools');
    if (!tools) return;
    const wfBtn = document.createElement('button');
    wfBtn.className = 'cdp-btn cdp-wf';
    wfBtn.type = 'button';
    wfBtn.textContent = t('⚙ Procesar una vez', '⚙ Process once');
    wfBtn.addEventListener('click', () => {
      try {
        if (typeof workforce.processOnce === 'function') {
          workforce.processOnce();
          refresh();
        }
      } catch {
        /* workforce unavailable */
      }
    });
    const wfStatus = document.createElement('span');
    wfStatus.className = 'cdp-status cdp-wf';
    try {
      const s =
        typeof workforce.getSummary === 'function'
          ? workforce.getSummary()
          : null;
      if (s) {
        wfStatus.textContent = `${t('Agentes', 'Agents')}: ${s.agents.length} · ${t('Cola', 'Queue')}: ${s.queueDepth}`;
      }
    } catch {
      /* noop */
    }
    tools.appendChild(wfBtn);
    tools.appendChild(wfStatus);
  }

  function renderImport() {
    const box = panelEl?.querySelector('#gev-cuba-import');
    if (!box) return;
    box.innerHTML = '';
    if (typeof parseCsv !== 'function') return;
    const title = document.createElement('div');
    title.style.cssText =
      'font-size:10px;font-weight:800;letter-spacing:.08em;color:#6ee7b7;margin-bottom:6px';
    title.textContent = t('IMPORTAR CSV', 'IMPORT CSV');
    box.appendChild(title);
    const ta = document.createElement('textarea');
    ta.rows = 4;
    ta.placeholder = t(
      'Pegue aquí el CSV de compradores…',
      'Paste buyer CSV here…',
    );
    ta.style.cssText =
      'width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(52,211,153,.35);border-radius:10px;color:#fff;padding:12px;font-size:14px;font-family:inherit;min-height:80px';
    box.appendChild(ta);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    const impBtn = document.createElement('button');
    impBtn.className = 'cdp-btn';
    impBtn.type = 'button';
    impBtn.textContent = t('Importar', 'Import');
    const st = document.createElement('span');
    st.className = 'cdp-status';
    impBtn.addEventListener('click', () => {
      let parsed = null;
      try {
        parsed = parseCsv(ta.value);
      } catch {
        /* invalid */
      }
      if (!parsed) {
        st.textContent = t('CSV inválido.', 'Invalid CSV.');
        return;
      }
      const buyersAdded = (parsed.buyers || [])
        .map((b) => store.addBuyer(b))
        .filter(Boolean).length;
      const reqsAdded = store.addMany
        ? store.addMany(parsed.requests || []).length
        : 0;
      st.textContent = t(
        `Importados: ${buyersAdded} compradores, ${reqsAdded} solicitudes, ${parsed.errors || 0} errores.`,
        `Imported: ${buyersAdded} buyers, ${reqsAdded} requests, ${parsed.errors || 0} errors.`,
      );
      refresh();
    });
    row.appendChild(impBtn);
    row.appendChild(st);
    box.appendChild(row);
  }

  function refresh() {
    if (aborted.current || !panelEl) return;
    renderKpis();
    renderColumns();
    renderIntake();
    renderBuyers();
    renderPartners();
    renderImport();
    renderWorkforceControls();
    renderBadge();
    if (selectedId) renderDrawerBody();
  }

  function renderBadge() {
    if (!btnEl) return;
    const badge = btnEl.querySelector('.tbadge');
    if (!badge) return;
    let open = 0;
    try {
      open = listAll().filter((r) => OPEN_STATUSES.has(r.status)).length;
    } catch {
      open = 0;
    }
    badge.textContent = String(open);
    badge.classList.toggle('zero', open === 0);
  }

  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.id = 'gev-cuba-panel';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', t('Mesa Cuba', 'Cuba Desk'));
    const head = document.createElement('div');
    head.className = 'cdp-head';
    const title = document.createElement('div');
    title.className = 'cdp-title';
    title.textContent = t('MESA CUBA · IMPORTACIÓN/EXPORTACIÓN', 'CUBA DESK · IMPORT/EXPORT');
    const langBtn = document.createElement('button');
    langBtn.className = 'cdp-lang';
    langBtn.type = 'button';
    langBtn.textContent = lang === 'es' ? 'EN' : 'ES';
    langBtn.addEventListener('click', () => {
      lang = lang === 'es' ? 'en' : 'es';
      rebuild();
    });
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cdp-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', t('Cerrar', 'Close'));
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => toggle(false));
    head.appendChild(title);
    head.appendChild(langBtn);
    head.appendChild(closeBtn);
    panelEl.appendChild(head);

    const kpis = document.createElement('div');
    kpis.className = 'cdp-kpis';
    kpis.id = 'gev-cuba-kpis';
    panelEl.appendChild(kpis);

    const tools = document.createElement('div');
    tools.className = 'cdp-tools';
    const mapBtn = document.createElement('button');
    mapBtn.className = 'cdp-btn';
    mapBtn.type = 'button';
    mapBtn.textContent = t('🗺 Ver puertos', '🗺 View ports');
    mapBtn.addEventListener('click', () => {
      try {
        if (cubaMap && typeof cubaMap.flyToPort === 'function') {
          cubaMap.flyToPort('mariel');
        }
      } catch {
        /* map unavailable */
      }
    });
    tools.appendChild(mapBtn);
    const status = document.createElement('span');
    status.className = 'cdp-status';
    status.textContent = t(
      'Solo registros reales del CRM — nada inventado.',
      'Real CRM records only — nothing invented.',
    );
    tools.appendChild(status);
    panelEl.appendChild(tools);

    // Desk boundary banner: Cuba-desk vs worldwide global desk.
    const boundary = document.createElement('div');
    boundary.className = 'cdp-boundary';
    boundary.textContent = t(
      'Mesa dedicada Cuba: las solicitudes aquí son solo para Cuba. El negocio mundial va en la mesa global (módulo separado) — nunca se mezclan.',
      'Dedicated Cuba desk: requests here are Cuba-only. Worldwide business lives on the global desk (separate module) — never mixed.',
    );
    panelEl.appendChild(boundary);

    const cols = document.createElement('div');
    cols.className = 'cdp-cols';
    cols.id = 'gev-cuba-cols';
    panelEl.appendChild(cols);

    const intake = document.createElement('div');
    intake.id = 'gev-cuba-intake';
    panelEl.appendChild(intake);

    const buyers = document.createElement('div');
    buyers.id = 'gev-cuba-buyers';
    panelEl.appendChild(buyers);

    const partners = document.createElement('div');
    partners.id = 'gev-cuba-partners';
    panelEl.appendChild(partners);

    const imp = document.createElement('div');
    imp.id = 'gev-cuba-import';
    panelEl.appendChild(imp);

    const drawer = document.createElement('div');
    drawer.id = 'gev-cuba-drawer';
    panelEl.appendChild(drawer);

    document.body.appendChild(panelEl);
    if (unsubMutate && typeof unsubMutate === 'function') unsubMutate();
    unsubMutate = store.onMutate(() => refresh()) || null;
    refresh();
  }

  function rebuild() {
    selectedId = null;
    if (unsubMutate && typeof unsubMutate === 'function') {
      unsubMutate();
      unsubMutate = null;
    }
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
    buildPanel();
  }

  function toggle(force) {
    const show =
      typeof force === 'boolean' ? force : !panelEl || panelEl.style.display === 'none';
    if (show) {
      if (!panelEl) buildPanel();
      else panelEl.style.display = 'flex';
      refresh();
    } else if (panelEl) {
      panelEl.style.display = 'none';
    }
  }

  function buildButton() {
    btnEl = document.createElement('button');
    btnEl.id = 'gev-cuba-btn';
    btnEl.type = 'button';
    const label = document.createElement('span');
    label.textContent = t('🇨🇺 MESA CUBA', '🇨🇺 CUBA DESK');
    const badge = document.createElement('span');
    badge.className = 'tbadge zero';
    badge.textContent = '0';
    btnEl.appendChild(label);
    btnEl.appendChild(badge);
    btnEl.addEventListener('click', () => toggle());
    renderBadge();
    return btnEl;
  }

  function destroy() {
    if (unsubMutate && typeof unsubMutate === 'function') {
      unsubMutate();
      unsubMutate = null;
    }
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
    if (btnEl) {
      btnEl.remove();
      btnEl = null;
    }
    try {
      if (typeof window !== 'undefined' && window.__gevCuba === api) {
        delete window.__gevCuba;
      }
    } catch {
      /* ignore */
    }
  }

  const api = {
    toggle,
    open() {
      toggle(true);
    },
    close() {
      toggle(false);
    },
    openDrawer: openDrawer,
    refresh,
    destroy,
    button: buildButton,
    get lang() {
      return lang;
    },
  };

  try {
    if (typeof window !== 'undefined') {
      window.__gevCuba = api;
    }
  } catch {
    /* non-browser runtimes */
  }

  try {
    if (signal) {
      if (signal.aborted) {
        destroy();
      } else if (typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', () => destroy(), { once: true });
      } else if (typeof signal.on === 'function') {
        signal.on('abort', () => destroy());
      }
    }
  } catch {
    /* ignore signal wiring errors */
  }

  return api;
}
