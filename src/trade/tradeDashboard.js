/**
 * Trade (Import/Export) RFQ Dashboard for GOD'S EYE VIEW — $0, no API keys, no external calls.
 *
 * Mission-control panel for the import/export RFQ pipeline:
 * KPI row, status pipeline columns, RFQ cards, editable detail drawer with
 * deal economics (landed cost / margin / commission / verdict), a supplier
 * manager with verification badges, CSV import/export, and a bilingual
 * in-panel commission draft that is NEVER sent anywhere.
 *
 * Pure helpers (STATUSES, parseRfqsCsv, rfqsToCsv, csvTemplate,
 * statusPillClass, verificationLabel, draftCommissionText,
 * createMemoryRfqStore, adaptStore) are exported for unit tests. The live
 * DOM wiring lives in initTradeDashboard(). This module intentionally does
 * NOT touch Cesium — the shipping layer owns the 3D entities.
 */

export const STATUSES = [
  { id: 'prospect', es: 'Prospectos', en: 'Prospects' },
  { id: 'contacted', es: 'Contactados', en: 'Contacted' },
  { id: 'quoting', es: 'Cotizando', en: 'Quoting' },
  { id: 'negotiating', es: 'Negociando', en: 'Negotiating' },
  { id: 'won', es: 'Ganados', en: 'Won' },
  { id: 'lost', es: 'Perdidos', en: 'Lost' },
];

const VALID_STATUSES = new Set(STATUSES.map((s) => s.id));
/** RFQs that still count as "open" pipeline business. */
const OPEN_STATUSES = new Set([
  'prospect',
  'contacted',
  'quoting',
  'negotiating',
]);

const CSV_HEADERS = [
  'ref',
  'product',
  'quantity',
  'unitCost',
  'sellUnitPrice',
  'freight',
  'duties',
  'otherCosts',
  'commissionPct',
  'status',
  'incoterms',
  'originPort',
  'destinationPort',
  'originLat',
  'originLng',
  'destLat',
  'destLng',
  'supplierId',
  'notes',
];

const SUP_CSV_HEADERS = [
  'name',
  'type',
  'role',
  'country',
  'verification',
  'contactName',
  'contactEmail',
  'contactPhone',
];

const CSV_NUM_FIELDS = new Set([
  'quantity',
  'unitcost',
  'sellunitprice',
  'freight',
  'duties',
  'othercosts',
  'commissionpct',
  'originlat',
  'originlng',
  'destlat',
  'destlng',
]);

/** CSS pill class from a verdict tier or RFQ status. */
export function statusPillClass(status) {
  const s = String(status || '').toLowerCase();
  if (['green', 'yellow', 'red', 'gray'].includes(s)) return s;
  if (s === 'won') return 'green';
  if (['contacted', 'quoting', 'negotiating'].includes(s)) return 'yellow';
  return 'gray';
}

function cleanRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s === '') continue;
    out[k] = CSV_NUM_FIELDS.has(k.toLowerCase()) && s !== '' ? Number(s) : s;
  }
  return out;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToObjects(lines, canonicalHeaders, numFields) {
  const rawHeaders = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const headers = rawHeaders.map((h) => {
    const canon = canonicalHeaders.find((c) => c.toLowerCase() === h);
    return canon || h;
  });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    rows.push(cleanRow(row, numFields));
  }
  return rows;
}

/**
 * Parse a CSV string into RFQs (and optionally suppliers).
 * Returns { rfqs, suppliers, errors }.
 * An optional `#SUPPLIERS` marker starts a second table with
 * SUP_CSV_HEADERS. Rows with neither ref nor product nor quantity count
 * as errors. Unknown statuses normalize to 'prospect'.
 */
export function parseRfqsCsv(text) {
  const result = { rfqs: [], suppliers: [], errors: 0 };
  if (typeof text !== 'string' || !text.trim()) return result;
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const marker = lines.findIndex(
    (l) => l.trim().toLowerCase() === '#suppliers',
  );
  const rfqLines = marker === -1 ? lines : lines.slice(0, marker);
  const supLines = marker === -1 ? [] : lines.slice(marker + 1);
  if (rfqLines.length >= 2) {
    for (const row of rowsToObjects(rfqLines, CSV_HEADERS, CSV_NUM_FIELDS)) {
      if (!row.ref && !row.product && !row.quantity) {
        result.errors += 1;
        continue;
      }
      if (!VALID_STATUSES.has(String(row.status))) row.status = 'prospect';
      result.rfqs.push(row);
    }
  }
  if (supLines.length >= 2) {
    for (const row of rowsToObjects(supLines, SUP_CSV_HEADERS, new Set())) {
      if (!row.name) {
        result.errors += 1;
        continue;
      }
      result.suppliers.push(row);
    }
  }
  return result;
}

/** Serialize RFQs to CSV. */
export function rfqsToCsv(rfqs) {
  const rows = [CSV_HEADERS.join(',')];
  for (const r of rfqs || []) {
    rows.push(CSV_HEADERS.map((h) => csvEscape(r[h])).join(','));
  }
  return rows.join('\n');
}

/** Downloadable template with obviously-fictional sample rows. */
export function csvTemplate() {
  return (
    `${CSV_HEADERS.join(',')}\n` +
    `SAMPLE-001,Sample Product,1000,12.50,18.00,1200,300,150,5,prospect,FOB,Port Example,Port Example,,,,,,"Obviously fictional sample - do not trade on this"\n` +
    `#SUPPLIERS\n` +
    `${SUP_CSV_HEADERS.join(',')}\n` +
    `Example Supplier Ltd,manufacturer,supplier,Exampleland,unverified,Sample Contact,sample@example.test,+1-555-0100`
  );
}

const VERIFICATION_LABELS = {
  verified: { es: 'Verificado', en: 'Verified' },
  pending: { es: 'En verificación', en: 'Pending' },
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
  if (s === 'pending') return 'yellow';
  if (s === 'flagged') return 'red';
  return 'gray';
}

/**
 * Defensive reads from the injected rfqEngine. Every call is wrapped in
 * try/catch with a neutral fallback, so a missing or throwing engine can
 * never break the drawer.
 */
function engineRead(engine, fn, fallback) {
  try {
    if (engine && typeof engine[fn] === 'function') {
      const v = engine[fn]();
      return v === undefined || v === null ? fallback : v;
    }
  } catch {
    /* fall through */
  }
  return fallback;
}

function dealEconomics(rfq, engine) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const call = (fn, arg) => {
    try {
      if (engine && typeof engine[fn] === 'function') {
        const v = Number(engine[fn](arg));
        return Number.isFinite(v) ? v : 0;
      }
    } catch {
      /* fall through */
    }
    return 0;
  };
  let verdict = { tier: 'gray', es: '', en: '' };
  try {
    if (engine && typeof engine.rfqVerdict === 'function') {
      const v = engine.rfqVerdict(rfq);
      if (v && typeof v === 'object') verdict = v;
    }
  } catch {
    /* keep gray */
  }
  let missing = [];
  try {
    if (engine && typeof engine.missingFields === 'function') {
      const m = engine.missingFields(rfq);
      if (Array.isArray(m)) missing = m;
    }
  } catch {
    /* keep empty */
  }
  return {
    landedUnit: call('landedCostUnit', rfq),
    netMargin: call('netMarginTotal', rfq),
    netMarginPct: call('netMarginPct', rfq),
    commission: call('commissionAmount', rfq),
    score: num(call('scoreRfq', rfq)),
    verdict,
    missing,
  };
}

/**
 * Bilingual commission draft — DRAFT for copy/paste only. Never sends
 * anything. First person as "Juan Gonzalez, private trader", with an
 * explicit not-legal-advice line and a "nothing sent" line.
 */
export function draftCommissionText(
  rfq = {},
  supplier = {},
  lang = 'es',
  money = null,
) {
  const fmt =
    typeof money === 'function'
      ? money
      : (n) => `$${(Number(n) || 0).toLocaleString('en-US')}`;
  const price = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const landed = Number(rfq.landedUnit ?? rfq.landedCostUnit) || 0;
  const margin = Number(rfq.netMargin ?? rfq.netMarginTotal) || 0;
  const commission = Number(rfq.commission ?? rfq.commissionAmount) || 0;
  const L = lang === 'es';
  const supName = supplier?.name || '—';
  const supDetail = [
    supplier?.type,
    supplier?.role,
    supplier?.country,
    verificationLabel(supplier?.verification, lang),
  ]
    .filter(Boolean)
    .join(' · ');
  const ref = rfq.ref || '—';
  const product = rfq.product || '—';
  const qty = `${(Number(rfq.quantity) || 0).toLocaleString('en-US')} u`;
  const legalEs =
    'Esto no es asesoría legal. Un abogado con licencia debe revisar el contrato antes de firmar.';
  const legalEn =
    'This is not legal advice. A licensed attorney must review the contract before signing.';
  if (L) {
    return [
      'BORRADOR DE COMISIÓN — NADA ENVIADO',
      '(borrador — nada enviado / draft — nothing sent)',
      '',
      `Yo, Juan Gonzalez, comerciante privado, presento este borrador de acuerdo de comisión sobre el RFQ ${ref}.`,
      '',
      `Producto: ${product} — ${qty}`,
      `Costo unitario: ${price(rfq.unitCost)}/u · Venta: ${price(rfq.sellUnitPrice)}/u`,
      `Costo landed por unidad: ${price(landed)}`,
      `Margen neto: ${fmt(margin)}`,
      `Comisión propuesta: ${rfq.commissionPct != null ? `${rfq.commissionPct}%` : '—'} = ${fmt(commission)}`,
      `Incoterms: ${rfq.incoterms || '—'}`,
      `Puerto de origen: ${rfq.originPort || '—'} · Puerto de destino: ${rfq.destinationPort || '—'}`,
      `Proveedor: ${supName}${supDetail ? ` (${supDetail})` : ''}`,
      '',
      'Este borrador es solo para revisión y copia — nada se ha enviado a nadie.',
      '',
      legalEs,
      '',
      '— Juan Gonzalez, comerciante privado',
    ].join('\n');
  }
  return [
    'COMMISSION DRAFT — NOTHING SENT',
    '(draft — nothing sent / borrador — nada enviado)',
    '',
    `I, Juan Gonzalez, private trader, submit this draft commission agreement for RFQ ${ref}.`,
    '',
    `Product: ${product} — ${qty}`,
    `Unit cost: ${price(rfq.unitCost)}/unit · Sell: ${price(rfq.sellUnitPrice)}/unit`,
    `Landed cost per unit: ${price(landed)}`,
    `Net margin: ${fmt(margin)}`,
    `Proposed commission: ${rfq.commissionPct != null ? `${rfq.commissionPct}%` : '—'} = ${fmt(commission)}`,
    `Incoterms: ${rfq.incoterms || '—'}`,
    `Origin port: ${rfq.originPort || '—'} · Destination port: ${rfq.destinationPort || '—'}`,
    `Supplier: ${supName}${supDetail ? ` (${supDetail})` : ''}`,
    '',
    'This draft is for review and copy only — nothing has been sent to anyone.',
    '',
    legalEn,
    '',
    '— Juan Gonzalez, private trader',
  ].join('\n');
}

/**
 * Normalize any RFQ-store-like object to the interface this dashboard uses.
 * Accepts the real trade store wrapped by tools.js
 * (listRfqs/getRfq/createRfq/updateRfq/moveRfq/deleteRfq/addRfqNote/
 * listSuppliers/getSupplier/createSupplier/updateSupplier/deleteSupplier/
 * stats/onMutate), the asWorkforceStore() view, or a minimal in-memory
 * shape — adaptStore() normalizes whichever fields are present.
 */
export function adaptStore(raw) {
  if (!raw) return createMemoryRfqStore();
  const listAll = () => {
    try {
      if (typeof raw.listRfqs === 'function') return raw.listRfqs() || [];
      if (typeof raw.list === 'function') return raw.list() || [];
      if (typeof raw.getAll === 'function') return raw.getAll() || [];
    } catch {
      /* fall through */
    }
    return [];
  };
  const byId = (id) => {
    if (!id) return null;
    try {
      if (typeof raw.getRfq === 'function') return raw.getRfq(id);
      if (typeof raw.byId === 'function') return raw.byId(id);
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
      if (typeof raw.updateRfq === 'function') return raw.updateRfq(id, patch);
      if (typeof raw.update === 'function') return raw.update(id, patch);
    } catch {
      /* noop */
    }
    return null;
  };
  const addMany = (arr) => {
    try {
      if (typeof raw.addMany === 'function') return raw.addMany(arr) || [];
      if (typeof raw.createRfq === 'function') {
        return (arr || []).map((r) => raw.createRfq(r)).filter(Boolean);
      }
      if (typeof raw.create === 'function') {
        return (arr || []).map((r) => raw.create(r)).filter(Boolean);
      }
    } catch {
      /* fall through */
    }
    return [];
  };
  const create = (data) => {
    try {
      if (typeof raw.createRfq === 'function') return raw.createRfq(data);
      if (typeof raw.create === 'function') return raw.create(data);
    } catch {
      /* noop */
    }
    return null;
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
      const rfq = byId(id);
      const list = (rfq && (rfq.agentNotes || rfq.notes)) || [];
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
    // The object-signature fallback only fires when the text signature
    // throws — a successful text call must never double-write.
    try {
      if (typeof raw.addRfqNote === 'function') {
        try {
          return raw.addRfqNote(id, text);
        } catch {
          return raw.addRfqNote(id, {
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
  const listSuppliers = () => {
    try {
      if (typeof raw.listSuppliers === 'function')
        return raw.listSuppliers() || [];
      if (Array.isArray(raw.suppliers)) return raw.suppliers;
    } catch {
      /* fall through */
    }
    return [];
  };
  const supplierById = (id) => {
    if (!id) return null;
    try {
      if (typeof raw.getSupplier === 'function') return raw.getSupplier(id);
    } catch {
      /* fall through */
    }
    try {
      return listSuppliers().find((s) => s.id === id) || null;
    } catch {
      return null;
    }
  };
  const addSupplier = (data) => {
    try {
      if (typeof raw.createSupplier === 'function')
        return raw.createSupplier(data);
      if (typeof raw.addSupplier === 'function') return raw.addSupplier(data);
    } catch {
      /* noop */
    }
    return null;
  };
  const updateSupplier = (id, patch) => {
    try {
      if (typeof raw.updateSupplier === 'function')
        return raw.updateSupplier(id, patch);
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
      total: all.length,
      openRfqs: open.length,
      potentialCommission: 0,
      supplierCount: listSuppliers().length,
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
        if (typeof raw.moveRfq === 'function') return raw.moveRfq(id, status);
        if (typeof raw.move === 'function') return raw.move(id, status);
        return update(id, { status });
      } catch {
        return null;
      }
    },
    remove(id) {
      try {
        if (typeof raw.deleteRfq === 'function') return raw.deleteRfq(id);
        if (typeof raw.remove === 'function') return raw.remove(id);
        if (typeof raw.delete === 'function') return raw.delete(id);
      } catch {
        /* noop */
      }
      return null;
    },
    notes,
    addNote,
    stats,
    listSuppliers,
    supplierById,
    addSupplier,
    updateSupplier,
    onMutate,
  };
}

/** In-memory RFQ store exposing the tools.js-wrapped API, for tests and standalone use. */
export function createMemoryRfqStore(seed = []) {
  let seq = 1;
  let supSeq = 1;
  const rfqs = new Map();
  const rfqNotes = new Map();
  const suppliers = new Map();
  const listeners = new Set();
  const norm = (r) => ({
    id: r.id || `rfq-${seq++}`,
    ref: r.ref || `RFQ-${String(seq).padStart(3, '0')}`,
    product: r.product || '',
    quantity: Number(r.quantity) || 0,
    unitCost: Number(r.unitCost) || 0,
    sellUnitPrice: Number(r.sellUnitPrice) || 0,
    freight: Number(r.freight) || 0,
    duties: Number(r.duties) || 0,
    otherCosts: Number(r.otherCosts) || 0,
    commissionPct: Number(r.commissionPct) || 0,
    status: VALID_STATUSES.has(r.status) ? r.status : 'prospect',
    incoterms: r.incoterms || '',
    originPort: r.originPort || '',
    destinationPort: r.destinationPort || '',
    originLat: r.originLat ?? null,
    originLng: r.originLng ?? null,
    destLat: r.destLat ?? null,
    destLng: r.destLng ?? null,
    supplierId: r.supplierId || '',
    buyerId: r.buyerId || '',
    agentNotes: Array.isArray(r.agentNotes) ? r.agentNotes : [],
    createdAt: r.createdAt || Date.now(),
    updatedAt: r.updatedAt || Date.now(),
  });
  const normSup = (s) => ({
    id: s.id || `sup-${supSeq++}`,
    name: s.name || '',
    type: s.type || 'supplier',
    role: s.role || 'supplier',
    country: s.country || '',
    verification: ['verified', 'pending', 'unverified', 'flagged'].includes(
      String(s.verification || '').toLowerCase(),
    )
      ? String(s.verification).toLowerCase()
      : 'unverified',
    contactName: s.contactName || '',
    contactEmail: s.contactEmail || '',
    contactPhone: s.contactPhone || '',
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
  for (const r of seed) {
    const n = norm(r);
    rfqs.set(n.id, n);
  }
  return {
    createRfq(data) {
      const n = norm(data || {});
      rfqs.set(n.id, n);
      notify();
      return n;
    },
    getRfq(id) {
      return rfqs.get(id) || null;
    },
    byId(id) {
      return rfqs.get(id) || null;
    },
    updateRfq(id, patch) {
      const cur = rfqs.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, id, updatedAt: Date.now() };
      if (patch && patch.status && !VALID_STATUSES.has(patch.status)) {
        next.status = cur.status;
      }
      rfqs.set(id, next);
      notify();
      return next;
    },
    moveRfq(id, status) {
      return this.updateRfq(id, { status });
    },
    deleteRfq(id) {
      rfqNotes.delete(id);
      const out = rfqs.delete(id);
      notify();
      return out;
    },
    listRfqs(status) {
      const all = [...rfqs.values()];
      return status ? all.filter((r) => r.status === status) : all;
    },
    list(status) {
      return this.listRfqs(status);
    },
    addMany(arr) {
      return (arr || []).map((r) => this.createRfq(r));
    },
    notes(id) {
      return rfqNotes.get(id) || [];
    },
    addRfqNote(id, text) {
      const list = rfqNotes.get(id) || [];
      const note = {
        t: Date.now(),
        agent: 'juan',
        es: String(text),
        en: String(text),
      };
      list.push(note);
      rfqNotes.set(id, list);
      notify();
      return note;
    },
    addNote(id, text) {
      return this.addRfqNote(id, text);
    },
    listSuppliers() {
      return [...suppliers.values()];
    },
    getSupplier(id) {
      return suppliers.get(id) || null;
    },
    createSupplier(data) {
      const n = normSup(data || {});
      suppliers.set(n.id, n);
      notify();
      return n;
    },
    updateSupplier(id, patch) {
      const cur = suppliers.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, id };
      suppliers.set(id, next);
      notify();
      return next;
    },
    deleteSupplier(id) {
      const out = suppliers.delete(id);
      notify();
      return out;
    },
    stats() {
      const all = [...rfqs.values()];
      const open = all.filter((r) => OPEN_STATUSES.has(r.status));
      return {
        total: all.length,
        openRfqs: open.length,
        potentialCommission: 0, // dashboard computes via rfqEngine when present
        supplierCount: suppliers.size,
      };
    },
    onMutate(fn) {
      if (typeof fn === 'function') listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const TD_CSS = `
#gev-trade-btn{display:flex;align-items:center;gap:8px;padding:12px 14px;margin-top:8px;background:rgba(10,14,22,.82);border:1px solid rgba(56,189,248,.32);border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:14px;font-weight:700;letter-spacing:.06em;min-width:172px;max-width:220px;min-height:52px}
#gev-trade-btn:hover{border-color:rgba(56,189,248,.65)}
#gev-trade-btn .tbadge{background:#38bdf8;color:#08111b;font-weight:800;font-size:12px;border-radius:999px;padding:2px 9px;margin-left:auto}
#gev-trade-btn .tbadge.zero{background:rgba(148,163,184,.35);color:#e2e8f0}
#gev-trade-panel{position:fixed;z-index:60;right:12px;top:12px;width:min(860px,calc(100vw - 24px));height:min(660px,calc(100vh - 24px));background:rgba(8,11,18,.98);border:1px solid rgba(56,189,248,.4);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7;font-size:14px}
#gev-trade-panel .tdp-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(56,189,248,.18)}
#gev-trade-panel .tdp-title{font-size:15px;font-weight:800;letter-spacing:.1em;color:#7dd3fc;flex:1}
#gev-trade-panel .tdp-lang{background:none;border:1px solid rgba(56,189,248,.4);color:#7dd3fc;border-radius:10px;padding:10px 14px;cursor:pointer;font-size:13px;font-weight:800;font-family:inherit;min-height:44px}
#gev-trade-panel .tdp-close{background:none;border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:10px;min-width:44px;min-height:44px;cursor:pointer;font-size:18px}
#gev-trade-panel .tdp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px 14px;border-bottom:1px solid rgba(56,189,248,.18)}
#gev-trade-panel .tdp-kpi{background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);border-radius:10px;padding:10px}
#gev-trade-panel .tdp-kpi .k{font-size:11px;font-weight:700;color:#c3d0e4;letter-spacing:.05em}
#gev-trade-panel .tdp-kpi .v{font-size:20px;font-weight:800;color:#fff}
#gev-trade-panel .tdp-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 14px;border-bottom:1px solid rgba(56,189,248,.18)}
#gev-trade-panel .tdp-btn{padding:11px 16px;border-radius:10px;border:1px solid rgba(56,189,248,.4);background:rgba(56,189,248,.12);color:#e0f2fe;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px}
#gev-trade-panel .tdp-btn:hover{background:rgba(56,189,248,.22)}
#gev-trade-panel .tdp-btn.primary{background:rgba(56,189,248,.28);color:#fff}
#gev-trade-panel .tdp-status{font-size:12px;color:#c3d0e4}
#gev-trade-panel .tdp-empty{margin:12px 14px 0;padding:18px;border:1px dashed rgba(56,189,248,.4);border-radius:10px;font-size:14px;color:#c3d0e4;text-align:center}
#gev-trade-panel .tdp-cols{flex:1;display:flex;gap:8px;overflow-x:auto;padding:12px 14px;min-height:0}
#gev-trade-panel .tdp-col{min-width:200px;flex:1;background:rgba(255,255,255,.03);border:1px solid rgba(56,189,248,.15);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
#gev-trade-panel .tdp-colhead{font-size:12px;font-weight:800;letter-spacing:.08em;color:#7dd3fc;padding:10px 12px;border-bottom:1px solid rgba(56,189,248,.12);text-transform:uppercase}
#gev-trade-panel .tdp-cards{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:10px}
#gev-trade-panel .tdp-card{background:rgba(10,14,22,.9);border:1px solid rgba(56,189,248,.25);border-radius:12px;padding:12px;cursor:pointer;font-size:13px;min-height:44px}
#gev-trade-panel .tdp-card:hover{border-color:rgba(56,189,248,.55)}
#gev-trade-panel .tdp-card .rref{font-weight:800;color:#fff;margin-bottom:6px;font-size:14px}
#gev-trade-panel .tdp-card .rmeta{display:flex;align-items:center;gap:8px;color:#c3d0e4;flex-wrap:wrap;font-size:13px}
#gev-trade-panel .tdp-card .rmap{background:none;border:1px solid rgba(56,189,248,.4);color:#7dd3fc;border-radius:8px;padding:8px 14px;font-size:12px;cursor:pointer;font-family:inherit;min-height:36px;font-weight:700}
#gev-trade-panel .pill{font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px}
#gev-trade-panel .pill.green{background:rgba(52,211,153,.18);color:#34d399;border:1px solid rgba(52,211,153,.4)}
#gev-trade-panel .pill.yellow{background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.4)}
#gev-trade-panel .pill.red{background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.4)}
#gev-trade-panel .pill.gray{background:rgba(148,163,184,.15);color:#94a3b8;border:1px solid rgba(148,163,184,.4)}
#gev-trade-panel .tdp-colempty{font-size:11px;color:#5b6b82;padding:12px;text-align:center}
#gev-trade-drawer{position:absolute;top:0;right:0;bottom:0;width:min(420px,94%);background:rgba(10,14,22,.99);border-left:1px solid rgba(56,189,248,.4);padding:16px;overflow-y:auto;font-size:14px}
#gev-trade-drawer h3{margin:0 0 6px;font-size:17px;color:#fff}
#gev-trade-drawer .dsub{font-size:13px;color:#c3d0e4;margin-bottom:12px}
#gev-trade-drawer label{display:block;font-size:12px;font-weight:700;color:#c3d0e4;margin:10px 0 5px;letter-spacing:.05em}
#gev-trade-drawer input,#gev-trade-drawer select,#gev-trade-drawer textarea{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(56,189,248,.35);border-radius:10px;color:#fff;padding:12px;font-size:16px;font-family:inherit;min-height:48px}
#gev-trade-drawer .math{background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.25);border-radius:12px;padding:12px;margin-top:12px}
#gev-trade-drawer .math .mrow{display:flex;justify-content:space-between;margin:5px 0;font-size:14px;color:#c3d0e4}
#gev-trade-drawer .math .mrow b{color:#fff;font-size:15px}
#gev-trade-drawer .math .mrow.total{border-top:1px solid rgba(56,189,248,.25);padding-top:8px;margin-top:8px}
#gev-trade-drawer .note{border-left:2px solid rgba(56,189,248,.5);padding:6px 10px;margin:8px 0;font-size:13px;color:#d4deee}
#gev-trade-drawer .note .nts{font-size:11px;color:#8a99ae}
#gev-trade-drawer pre.draft{white-space:pre-wrap;background:rgba(255,255,255,.04);border:1px solid rgba(56,189,248,.35);border-radius:10px;padding:12px;font-size:13px;color:#e0f2fe;font-family:inherit}
#gev-trade-suppliers{padding:12px 14px;border-top:1px solid rgba(56,189,248,.18);font-size:13px;max-height:220px;overflow-y:auto}
#gev-trade-suppliers .sprow{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;color:#d4deee;border-bottom:1px solid rgba(56,189,248,.08);min-height:44px}
#gev-trade-suppliers .spform{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
#gev-trade-suppliers input,#gev-trade-suppliers select{background:rgba(255,255,255,.06);border:1px solid rgba(56,189,248,.3);border-radius:10px;color:#fff;padding:11px;font-size:14px;font-family:inherit;min-width:0;min-height:44px}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-trade-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-trade-styles';
  style.textContent = TD_CSS;
  document.head.appendChild(style);
}

/**
 * Exported for tests: phone-usability assertions verify the touch-target
 * and readability rules (min-height 44px, 16px inputs, larger type) from
 * the shipped stylesheet itself.
 */
export const TRADE_DASHBOARD_CSS = TD_CSS;

function defaultMoney(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US')}`;
}

/**
 * Live controller: dock button + floating trade mission-control panel.
 * options: { rfqStore, rfqEngine, shippingMap, workforce, signal, parseCsv }
 * rfqStore may be the real trade store wrapped by tools.js
 * (listRfqs/getRfq/createRfq/updateRfq/moveRfq/deleteRfq/listSuppliers/
 * getSupplier/createSupplier/updateSupplier/deleteSupplier/stats/onMutate)
 * or the minimal in-memory shape — adaptStore() normalizes either.
 */
export function initTradeDashboard({
  rfqStore = null,
  rfqEngine = null,
  shippingMap = null,
  workforce = null,
  signal = null,
  parseCsv = parseRfqsCsv,
} = {}) {
  injectStyles();
  const store = adaptStore(rfqStore);
  const fmtMoney =
    typeof rfqEngine?.formatMoney === 'function'
      ? rfqEngine.formatMoney
      : defaultMoney;
  const aborted = { current: false };
  signal?.addEventListener?.(
    'abort',
    () => {
      aborted.current = true;
    },
    { once: true },
  );

  let lang = 'es';
  let panelEl = null;
  let btnEl = null;
  let selectedId = null;
  let editingSupId = null;
  let unsubMutate = null;
  const t = (es, en) => (lang === 'es' ? es : en);
  const refs = {
    kpis: null,
    cols: null,
    emptyState: null,
    importBtn: null,
    exportBtn: null,
    templateBtn: null,
    importStatus: null,
    rfqCards: [],
    draftBtn: null,
    drawer: null,
    supList: null,
    supForm: {},
    wfBtn: null,
    wfStatus: null,
  };

  function statusLabel(id) {
    const s = STATUSES.find((x) => x.id === id);
    return s ? t(s.es, s.en) : id;
  }

  function potentialCommission(openRfqs) {
    try {
      const stats = store.stats() || {};
      if (
        typeof stats.potentialCommission === 'number' &&
        stats.potentialCommission > 0
      ) {
        return stats.potentialCommission;
      }
    } catch {
      /* compute from the engine instead */
    }
    if (rfqEngine && typeof rfqEngine.commissionAmount === 'function') {
      let total = 0;
      for (const rfq of openRfqs) {
        try {
          const c = Number(rfqEngine.commissionAmount(rfq));
          if (Number.isFinite(c)) total += c;
        } catch {
          /* skip */
        }
      }
      return Math.round(total * 100) / 100;
    }
    return 0;
  }

  function renderKpis() {
    if (!refs.kpis) return;
    let stats = {
      total: 0,
      openRfqs: 0,
      potentialCommission: 0,
      supplierCount: 0,
    };
    try {
      stats = { ...stats, ...(store.stats() || {}) };
    } catch {
      /* keep defaults */
    }
    let openRfqs = [];
    try {
      openRfqs = listAll().filter((r) => OPEN_STATUSES.has(r.status));
    } catch {
      /* keep empty */
    }
    if (typeof stats.openRfqs !== 'number') stats.openRfqs = openRfqs.length;
    let supplierCount = 0;
    try {
      supplierCount = (store.listSuppliers() || []).length;
    } catch {
      /* keep 0 */
    }
    refs.kpis.innerHTML = `
      <div class="tdp-kpi"><div class="k">${t('RFQS TOTALES', 'TOTAL RFQS')}</div><div class="v">${Number(stats.total) || 0}</div></div>
      <div class="tdp-kpi"><div class="k">${t('RFQS ABIERTOS', 'OPEN RFQS')}</div><div class="v">${Number(stats.openRfqs) || 0}</div></div>
      <div class="tdp-kpi"><div class="k">${t('COMISIÓN POTENCIAL', 'POTENTIAL COMMISSION')}</div><div class="v">${fmtMoney(potentialCommission(openRfqs))}</div></div>
      <div class="tdp-kpi"><div class="k">${t('PROVEEDORES', 'SUPPLIERS')}</div><div class="v">${supplierCount}</div></div>
    `;
  }

  function listAll() {
    try {
      return store.listAll() || store.list() || [];
    } catch {
      return [];
    }
  }

  function renderColumns() {
    if (!refs.cols) return;
    refs.cols.innerHTML = '';
    refs.rfqCards = [];
    const total = listAll().length;
    if (total === 0) {
      const empty = document.createElement('div');
      empty.className = 'tdp-empty';
      empty.textContent = t(
        'Sin RFQs — importa un CSV o agrega un RFQ',
        'No RFQs yet — import a CSV or add one',
      );
      refs.cols.appendChild(empty);
      refs.emptyState = empty;
    } else {
      refs.emptyState = null;
    }
    for (const st of STATUSES) {
      const col = document.createElement('div');
      col.className = 'tdp-col';
      col.dataset.status = st.id;
      const head = document.createElement('div');
      head.className = 'tdp-colhead';
      const cards = document.createElement('div');
      cards.className = 'tdp-cards';
      let rfqs = [];
      try {
        rfqs = store.list(st.id) || [];
      } catch {
        rfqs = [];
      }
      head.textContent = `${t(st.es, st.en)} (${rfqs.length})`;
      if (!rfqs.length) {
        const empty = document.createElement('div');
        empty.className = 'tdp-colempty';
        empty.textContent = '—';
        cards.appendChild(empty);
      }
      for (const rfq of rfqs) {
        const card = document.createElement('div');
        card.className = 'tdp-card';
        card.dataset.rfqId = rfq.id;
        const ref = document.createElement('div');
        ref.className = 'rref';
        ref.textContent = rfq.ref || t('(sin referencia)', '(no ref)');
        const meta = document.createElement('div');
        meta.className = 'rmeta';
        const pill = document.createElement('span');
        const verdict = dealEconomics(rfq, rfqEngine).verdict;
        pill.className = `pill ${statusPillClass(verdict.tier)}`;
        pill.textContent = t(
          {
            green: 'Positivo',
            yellow: 'Precaución',
            red: 'Negativo',
            gray: '—',
          }[verdict.tier] || verdict.tier,
          verdict.tier.toUpperCase(),
        );
        const info = document.createElement('span');
        const qty = (Number(rfq.quantity) || 0).toLocaleString('en-US');
        info.textContent = `${rfq.product || ''} · ${qty} u`;
        meta.appendChild(pill);
        meta.appendChild(info);
        if (shippingMap && typeof shippingMap.flyToRfq === 'function') {
          const mapBtn = document.createElement('button');
          mapBtn.className = 'rmap';
          mapBtn.type = 'button';
          mapBtn.textContent = '🗺';
          mapBtn.setAttribute('aria-label', t('Ver en el mapa', 'View on map'));
          mapBtn.addEventListener('click', (e) => {
            e?.stopPropagation?.();
            try {
              shippingMap.flyToRfq(rfq.id);
            } catch {
              /* map unavailable */
            }
          });
          meta.appendChild(mapBtn);
        }
        card.appendChild(ref);
        card.appendChild(meta);
        card.addEventListener('click', () => openDrawer(rfq.id));
        cards.appendChild(card);
        refs.rfqCards.push(card);
      }
      col.appendChild(head);
      col.appendChild(cards);
      refs.cols.appendChild(col);
    }
  }

  function supplierName(id) {
    if (!id) return '—';
    try {
      const sup = store.supplierById(id);
      return sup?.name || '—';
    } catch {
      return '—';
    }
  }

  function renderSuppliers() {
    const box = panelEl?.querySelector('#gev-trade-suppliers');
    if (!box) return;
    box.innerHTML = '';
    refs.supList = box;
    const title = document.createElement('div');
    title.style.cssText =
      'font-weight:800;color:#7dd3fc;letter-spacing:.08em;font-size:10px;margin-bottom:6px';
    title.textContent = t('PROVEEDORES', 'SUPPLIERS');
    box.appendChild(title);
    const list = document.createElement('div');
    let sups = [];
    try {
      sups = store.listSuppliers() || [];
    } catch {
      sups = [];
    }
    if (!sups.length) {
      const empty = document.createElement('div');
      empty.className = 'tdp-colempty';
      empty.textContent = t(
        'Agrega tu primer proveedor abajo.',
        'Add your first supplier below.',
      );
      list.appendChild(empty);
    }
    for (const sup of sups) {
      const row = document.createElement('div');
      row.className = 'sprow';
      row.dataset.supId = sup.id;
      const left = document.createElement('div');
      const nm = document.createElement('div');
      nm.style.fontWeight = '700';
      nm.style.color = '#fff';
      nm.textContent = sup.name || '—';
      const sub = document.createElement('div');
      sub.style.fontSize = '10px';
      sub.style.color = '#9fb0c9';
      sub.textContent = [sup.type, sup.role, sup.country]
        .filter(Boolean)
        .join(' · ');
      left.appendChild(nm);
      left.appendChild(sub);
      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '6px';
      right.style.alignItems = 'center';
      const vpill = document.createElement('span');
      vpill.className = `pill ${verificationPill(sup.verification)}`;
      vpill.textContent = verificationLabel(sup.verification, lang);
      const editBtn = document.createElement('button');
      editBtn.className = 'tdp-btn';
      editBtn.type = 'button';
      editBtn.style.padding = '4px 8px';
      editBtn.textContent = t('Editar', 'Edit');
      editBtn.addEventListener('click', () => startEditSupplier(sup.id));
      right.appendChild(vpill);
      right.appendChild(editBtn);
      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    }
    box.appendChild(list);
    renderSupForm(box);
  }

  function renderSupForm(box) {
    const form = document.createElement('div');
    form.className = 'spform';
    const editing = editingSupId ? store.supplierById(editingSupId) : null;
    const f = editing || {};
    const mk = (key, placeholder, kind = 'text') => {
      let input;
      if (kind === 'select-ver') {
        input = document.createElement('select');
        for (const v of ['unverified', 'pending', 'verified', 'flagged']) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = verificationLabel(v, lang);
          if ((f.verification || 'unverified') === v) opt.selected = true;
          input.appendChild(opt);
        }
      } else if (kind === 'select-type') {
        input = document.createElement('select');
        for (const v of ['manufacturer', 'distributor', 'trader', 'agent']) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          if ((f.type || 'manufacturer') === v) opt.selected = true;
          input.appendChild(opt);
        }
      } else if (kind === 'select-role') {
        input = document.createElement('select');
        for (const v of ['supplier', 'buyer', 'broker', 'both']) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          if ((f.role || 'supplier') === v) opt.selected = true;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.placeholder = placeholder;
        input.value = f[key] || '';
      }
      input.dataset.supField = key;
      form.appendChild(input);
      refs.supForm[key] = input;
      return input;
    };
    mk('name', t('Nombre *', 'Name *'));
    mk('country', t('País', 'Country'));
    mk('type', '', 'select-type');
    mk('role', '', 'select-role');
    mk('verification', '', 'select-ver');
    mk('contactName', t('Contacto (nombre)', 'Contact (name)'));
    mk('contactEmail', t('Contacto (email)', 'Contact (email)'));
    mk('contactPhone', t('Contacto (teléfono)', 'Contact (phone)'));
    const actions = document.createElement('div');
    actions.style.gridColumn = '1 / -1';
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'tdp-btn';
    saveBtn.type = 'button';
    saveBtn.textContent = editing
      ? t('Guardar', 'Save')
      : t('Agregar proveedor', 'Add supplier');
    saveBtn.addEventListener('click', () => {
      const data = {};
      for (const [key, input] of Object.entries(refs.supForm)) {
        const v = String(input.value || '').trim();
        if (v) data[key] = v;
      }
      if (!data.name) return;
      if (editingSupId) {
        store.updateSupplier(editingSupId, data);
        editingSupId = null;
      } else {
        store.addSupplier(data);
      }
      refresh();
    });
    actions.appendChild(saveBtn);
    if (editingSupId) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'tdp-btn';
      cancelBtn.type = 'button';
      cancelBtn.textContent = t('Cancelar', 'Cancel');
      cancelBtn.addEventListener('click', () => {
        editingSupId = null;
        refresh();
      });
      actions.appendChild(cancelBtn);
    }
    form.appendChild(actions);
    box.appendChild(form);
    refs.supSaveBtn = saveBtn;
  }

  function startEditSupplier(id) {
    editingSupId = id;
    renderSuppliers();
  }

  function renderWorkforceControls() {
    if (refs.wfBtn) refs.wfBtn.remove();
    if (refs.wfStatus) refs.wfStatus.remove();
    refs.wfBtn = null;
    refs.wfStatus = null;
    if (!workforce || !panelEl) return;
    const tools = panelEl.querySelector('.tdp-tools');
    if (!tools) return;
    const wfBtn = document.createElement('button');
    wfBtn.className = 'tdp-btn';
    wfBtn.type = 'button';
    wfBtn.textContent = t('⚙ Procesar una vez', '⚙ Process once');
    wfBtn.addEventListener('click', () => {
      try {
        if (typeof workforce.processOnce === 'function') {
          workforce.processOnce();
          refresh();
        } else if (typeof workforce.start === 'function') {
          workforce.start();
          if (typeof workforce.pause === 'function') workforce.pause();
          refresh();
        }
      } catch {
        /* workforce unavailable */
      }
    });
    const wfStatus = document.createElement('span');
    wfStatus.className = 'tdp-status';
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
    refs.wfBtn = wfBtn;
    refs.wfStatus = wfStatus;
  }

  function renderDrawerBody() {
    const drawer = refs.drawer;
    if (!drawer) return;
    const rfq = store.byId(selectedId);
    if (!rfq) {
      drawer.innerHTML = '';
      return;
    }
    const econ = dealEconomics(rfq, rfqEngine);
    const verdict = econ.verdict || { tier: 'gray', es: '', en: '' };
    drawer.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = rfq.ref || t('(sin referencia)', '(no ref)');
    const sub = document.createElement('div');
    sub.className = 'dsub';
    sub.textContent = [
      rfq.product,
      `${(Number(rfq.quantity) || 0).toLocaleString('en-US')} u`,
      supplierName(rfq.supplierId),
    ]
      .filter(Boolean)
      .join(' · ');
    const vpill = document.createElement('span');
    vpill.className = `pill ${statusPillClass(verdict.tier)}`;
    vpill.style.marginLeft = '8px';
    vpill.textContent = t(
      {
        green: 'POSITIVO',
        yellow: 'PRECAUCIÓN',
        red: 'NEGATIVO',
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
      ['product', t('Producto', 'Product'), 'text'],
      ['quantity', t('Cantidad', 'Quantity'), 'number'],
      ['unitCost', t('Costo unitario ($)', 'Unit cost ($)'), 'number'],
      [
        'sellUnitPrice',
        t('Precio de venta ($/u)', 'Sell price ($/u)'),
        'number',
      ],
      ['freight', t('Flete ($)', 'Freight ($)'), 'number'],
      ['duties', t('Aranceles ($)', 'Duties ($)'), 'number'],
      ['otherCosts', t('Otros costos ($)', 'Other costs ($)'), 'number'],
      ['commissionPct', t('Comisión (%)', 'Commission (%)'), 'number'],
      ['incoterms', 'Incoterms', 'text'],
      ['originPort', t('Puerto de origen', 'Origin port'), 'text'],
      ['destinationPort', t('Puerto de destino', 'Destination port'), 'text'],
      ['originLat', t('Origen lat.', 'Origin lat.'), 'number'],
      ['originLng', t('Origen lng.', 'Origin lng.'), 'number'],
      ['destLat', t('Destino lat.', 'Dest lat.'), 'number'],
      ['destLng', t('Destino lng.', 'Dest lng.'), 'number'],
      ['supplierId', t('Proveedor', 'Supplier'), 'supplier'],
    ];
    for (const [key, label, kind] of fieldDefs) {
      const lab = document.createElement('label');
      lab.textContent = label;
      drawer.appendChild(lab);
      let input;
      if (kind === 'status') {
        input = document.createElement('select');
        for (const st of STATUSES) {
          const opt = document.createElement('option');
          opt.value = st.id;
          opt.textContent = t(st.es, st.en);
          if (rfq.status === st.id) opt.selected = true;
          input.appendChild(opt);
        }
      } else if (kind === 'supplier') {
        input = document.createElement('select');
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '—';
        input.appendChild(none);
        let sups = [];
        try {
          sups = store.listSuppliers() || [];
        } catch {
          sups = [];
        }
        for (const sup of sups) {
          const opt = document.createElement('option');
          opt.value = sup.id;
          opt.textContent = sup.name || sup.id;
          if (rfq.supplierId === sup.id) opt.selected = true;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.type = kind === 'number' ? 'number' : 'text';
        input.value = rfq[key] ?? '';
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
      refs.drawerFields = refs.drawerFields || {};
      refs.drawerFields[key] = input;
    }

    const math = document.createElement('div');
    math.className = 'math';
    const mTitle = document.createElement('div');
    mTitle.style.cssText =
      'font-size:10px;font-weight:800;letter-spacing:.08em;color:#7dd3fc;margin-bottom:6px';
    mTitle.textContent = t('ECONOMÍA DEL TRATO', 'DEAL ECONOMICS');
    math.appendChild(mTitle);
    const rows = [
      [t('Costo landed /u', 'Landed cost /unit'), fmtMoney(econ.landedUnit)],
      [t('Margen neto', 'Net margin'), fmtMoney(econ.netMargin)],
      [
        t('Margen neto (%)', 'Net margin (%)'),
        `${econ.netMarginPct.toFixed(1)}%`,
      ],
      [t('Comisión estimada', 'Est. commission'), fmtMoney(econ.commission)],
      [t('Puntaje', 'Score'), `${Math.round(econ.score)}/100`],
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

    const notesTitle = document.createElement('div');
    notesTitle.style.cssText =
      'font-size:10px;font-weight:800;letter-spacing:.08em;color:#7dd3fc;margin:12px 0 4px';
    notesTitle.textContent = t('NOTAS DEL AGENTE', 'AGENT NOTES');
    drawer.appendChild(notesTitle);
    const tl = document.createElement('div');
    let ns = [];
    try {
      ns = store.notes(rfq.id) || [];
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
      tl.appendChild(d);
    }
    drawer.appendChild(tl);
    const noteIn = document.createElement('textarea');
    noteIn.rows = 2;
    noteIn.placeholder = t('Agregar nota…', 'Add a note…');
    const noteBtn = document.createElement('button');
    noteBtn.className = 'tdp-btn';
    noteBtn.type = 'button';
    noteBtn.style.marginTop = '6px';
    noteBtn.textContent = t('Guardar nota', 'Save note');
    noteBtn.addEventListener('click', () => {
      const v = noteIn.value.trim();
      if (!v) return;
      store.addNote(rfq.id, v);
      renderDrawerBody();
    });
    drawer.appendChild(noteIn);
    drawer.appendChild(noteBtn);
    refs.noteInput = noteIn;
    refs.noteBtn = noteBtn;

    const draftBtn = document.createElement('button');
    draftBtn.className = 'tdp-btn';
    draftBtn.type = 'button';
    draftBtn.style.cssText =
      'margin-top:12px;width:100%;border-color:rgba(125,211,252,.45);color:#7dd3fc;background:rgba(125,211,252,.08)';
    draftBtn.textContent = t(
      '📝 Generar borrador de comisión / Draft commission',
      '📝 Generar borrador de comisión / Draft commission',
    );
    draftBtn.addEventListener('click', () => {
      let sup = null;
      try {
        sup = rfq.supplierId ? store.supplierById(rfq.supplierId) : null;
      } catch {
        sup = null;
      }
      const enriched = {
        ...rfq,
        landedUnit: econ.landedUnit,
        netMargin: econ.netMargin,
        commission: econ.commission,
      };
      const pre = document.createElement('pre');
      pre.className = 'draft';
      pre.textContent = draftCommissionText(
        enriched,
        sup || {},
        lang,
        fmtMoney,
      );
      const old = drawer.querySelector('pre.draft');
      old?.remove();
      drawer.appendChild(pre);
      refs.draftPre = pre;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'tdp-btn';
      copyBtn.type = 'button';
      copyBtn.style.marginTop = '6px';
      copyBtn.textContent = t('Copiar', 'Copy');
      copyBtn.addEventListener('click', () => {
        try {
          navigator.clipboard?.writeText(pre.textContent);
        } catch {
          /* clipboard unavailable */
        }
      });
      const oldCopy = drawer.querySelector('button.draft-copy');
      oldCopy?.remove();
      copyBtn.classList.add('draft-copy');
      drawer.appendChild(copyBtn);
      refs.draftCopyBtn = copyBtn;
    });
    drawer.appendChild(draftBtn);
    refs.draftBtn = draftBtn;

    const delBtn = document.createElement('button');
    delBtn.className = 'tdp-btn';
    delBtn.type = 'button';
    delBtn.style.cssText = 'margin-top:8px;width:100%';
    delBtn.textContent = t('Eliminar RFQ', 'Delete RFQ');
    delBtn.addEventListener('click', () => {
      store.remove(selectedId);
      closeDrawer();
      refresh();
    });
    drawer.appendChild(delBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tdp-btn';
    closeBtn.type = 'button';
    closeBtn.style.cssText = 'margin-top:8px;width:100%';
    closeBtn.textContent = t('Cerrar', 'Close');
    closeBtn.addEventListener('click', closeDrawer);
    drawer.appendChild(closeBtn);
  }

  function openDrawer(id) {
    selectedId = id;
    if (!panelEl) return;
    let drawer = panelEl.querySelector('#gev-trade-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'gev-trade-drawer';
      panelEl.appendChild(drawer);
    }
    refs.drawer = drawer;
    refs.drawerFields = {};
    renderDrawerBody();
  }

  function closeDrawer() {
    selectedId = null;
    refs.drawer?.remove();
    refs.drawer = null;
  }

  function refresh() {
    updateDockBadge();
    if (!panelEl || aborted.current) return;
    renderKpis();
    renderColumns();
    renderSuppliers();
    renderWorkforceControls();
    if (selectedId) renderDrawerBody();
  }

  // One-tap business switcher badge: the dock button always shows the live
  // open-RFQ count, so the workspace is glanceable without opening it.
  function updateDockBadge() {
    try {
      if (!btnEl) return;
      const openCount = listAll().filter((r) =>
        OPEN_STATUSES.has(r.status),
      ).length;
      const badge = btnEl.querySelector('.tbadge');
      if (badge) {
        badge.textContent = String(openCount);
        badge.classList.toggle('zero', openCount === 0);
      }
    } catch {
      /* badge is best-effort */
    }
  }

  function importCsvText(text) {
    let parsed = { rfqs: [], suppliers: [], errors: 0 };
    try {
      const raw = parseCsv(text);
      if (Array.isArray(raw)) parsed = { ...parsed, rfqs: raw };
      else if (raw && typeof raw === 'object') {
        parsed = {
          rfqs: Array.isArray(raw.rfqs) ? raw.rfqs : [],
          suppliers: Array.isArray(raw.suppliers) ? raw.suppliers : [],
          errors: Number(raw.errors) || 0,
        };
      }
    } catch {
      parsed = { rfqs: [], suppliers: [], errors: 1 };
    }
    let addedRfqs = [];
    let addedSups = [];
    try {
      addedRfqs = store.addMany(parsed.rfqs) || [];
    } catch {
      addedRfqs = [];
    }
    try {
      addedSups = (parsed.suppliers || [])
        .map((s) => store.addSupplier(s))
        .filter(Boolean);
    } catch {
      addedSups = [];
    }
    refresh();
    const msg = t(
      `Importados: ${addedRfqs.length} RFQs, ${addedSups.length} proveedores. Errores: ${parsed.errors}`,
      `Imported: ${addedRfqs.length} RFQs, ${addedSups.length} suppliers. Errors: ${parsed.errors}`,
    );
    if (refs.importStatus) refs.importStatus.textContent = msg;
    return { rfqs: addedRfqs, suppliers: addedSups, errors: parsed.errors };
  }

  function downloadFile(name, content, mime) {
    try {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 500);
    } catch {
      /* downloads unavailable in this environment */
    }
  }

  function open() {
    if (aborted.current || typeof document === 'undefined') return null;
    if (panelEl) {
      refresh();
      return panelEl;
    }
    panelEl = document.createElement('div');
    panelEl.id = 'gev-trade-panel';
    panelEl.innerHTML = `
      <div class="tdp-head">
        <div class="tdp-title">COMERCIO · MISSION CONTROL</div>
        <button class="tdp-lang" type="button">ES / EN</button>
        <button class="tdp-close" type="button" aria-label="Cerrar / close">✕</button>
      </div>
      <div class="tdp-kpis"></div>
      <div class="tdp-tools">
        <button class="tdp-btn tdp-import" type="button">📥 ${t('Importar CSV / Import CSV', 'Importar CSV / Import CSV')}</button>
        <button class="tdp-btn tdp-template" type="button">📄 ${t('Descargar plantilla / Download template', 'Descargar plantilla / Download template')}</button>
        <button class="tdp-btn tdp-export" type="button">📤 ${t('Exportar CSV / Export CSV', 'Exportar CSV / Export CSV')}</button>
        <span class="tdp-status"></span>
      </div>
      <div class="tdp-cols"></div>
      <div id="gev-trade-suppliers"></div>
    `;
    refs.kpis = panelEl.querySelector('.tdp-kpis');
    refs.cols = panelEl.querySelector('.tdp-cols');
    refs.importBtn = panelEl.querySelector('.tdp-import');
    refs.templateBtn = panelEl.querySelector('.tdp-template');
    refs.exportBtn = panelEl.querySelector('.tdp-export');
    refs.importStatus = panelEl.querySelector('.tdp-status');
    const langBtn = panelEl.querySelector('.tdp-lang');
    const closeBtn = panelEl.querySelector('.tdp-close');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,text/csv';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => importCsvText(String(reader.result || ''));
      reader.readAsText(f);
      fileInput.value = '';
    });
    panelEl.appendChild(fileInput);
    refs.fileInput = fileInput;

    refs.importBtn?.addEventListener('click', () => fileInput.click());
    refs.templateBtn?.addEventListener('click', () =>
      downloadFile('trade-template.csv', csvTemplate(), 'text/csv'),
    );
    refs.exportBtn?.addEventListener('click', () =>
      downloadFile('trade-rfqs.csv', rfqsToCsv(listAll()), 'text/csv'),
    );
    langBtn?.addEventListener('click', () =>
      setLang(lang === 'es' ? 'en' : 'es'),
    );
    closeBtn?.addEventListener('click', close);

    // Re-render when the underlying store mutates (if it exposes onMutate).
    try {
      unsubMutate = store.onMutate(() => {
        if (panelEl && !aborted.current) refresh();
      });
    } catch {
      unsubMutate = null;
    }

    document.body.appendChild(panelEl);
    refresh();
    return panelEl;
  }

  function close() {
    closeDrawer();
    if (typeof unsubMutate === 'function') {
      try {
        unsubMutate();
      } catch {
        /* noop */
      }
      unsubMutate = null;
    }
    panelEl?.remove();
    panelEl = null;
    refs.kpis = refs.cols = refs.drawer = null;
    refs.rfqCards = [];
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'es';
    if (!panelEl) return lang;
    const keepSelected = selectedId;
    panelEl.remove();
    panelEl = null;
    open();
    if (keepSelected) openDrawer(keepSelected);
    return lang;
  }

  if (typeof document !== 'undefined') {
    btnEl = document.createElement('button');
    btnEl.id = 'gev-trade-btn';
    btnEl.type = 'button';
    btnEl.innerHTML =
      '<span style="font-size:22px">🚢</span><span>Comercio · Trade</span><span class="tbadge zero" aria-hidden="true">0</span>';
    btnEl.setAttribute('aria-label', 'Comercio / Trade — abrir el panel');
    btnEl.addEventListener('click', () => (panelEl ? close() : open()));
    const dock = document.getElementById('command-dock');
    if (dock) dock.appendChild(btnEl);
    else document.body.appendChild(btnEl);
  }

  const api = {
    open,
    close,
    toggle: () => (panelEl ? close() : open()),
    refresh,
    setLang,
    getLang: () => lang,
    importCsvText,
    downloadTemplate: () => csvTemplate(),
    exportCsvText: () => rfqsToCsv(listAll()),
    draftCommission: (rfqId) => {
      const rfq = store.byId(rfqId || selectedId);
      if (!rfq) return null;
      let sup = null;
      try {
        sup = rfq.supplierId ? store.supplierById(rfq.supplierId) : null;
      } catch {
        sup = null;
      }
      const econ = dealEconomics(rfq, rfqEngine);
      return draftCommissionText(
        {
          ...rfq,
          landedUnit: econ.landedUnit,
          netMargin: econ.netMargin,
          commission: econ.commission,
        },
        sup || {},
        lang,
        fmtMoney,
      );
    },
    addSupplier: (data) => {
      const sup = store.addSupplier(data || {});
      refresh();
      return sup;
    },
    getSuppliers: () => {
      try {
        return store.listSuppliers() || [];
      } catch {
        return [];
      }
    },
    addRfq: (data) => {
      const rfq = store.create(data || {});
      refresh();
      return rfq;
    },
    openDrawer,
    closeDrawer,
    refs,
    destroy() {
      aborted.current = true;
      close();
      btnEl?.remove();
      btnEl = null;
    },
  };
  if (typeof window !== 'undefined') window.__gevTrade = api;
  return api;
}
