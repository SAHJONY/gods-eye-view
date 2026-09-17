/**
 * Crude Oil Brokerage Dashboard for GOD'S EYE VIEW — $0, no API keys, no external calls.
 *
 * Mission-control panel for the crude oil brokerage pipeline:
 * KPI row, status pipeline columns, cargo cards, editable detail drawer with
 * deal math (spread / margins / commission), a counterparty manager, CSV
 * import/export, and a bilingual in-panel commission draft that is NEVER
 * sent anywhere.
 *
 * Pure helpers (STATUSES, parseCargoesCsv, cargoesToCsv, csvTemplate,
 * dealMath, statusPillClass, verdictOf, draftCommissionText,
 * createMemoryCargoStore) are exported for unit tests. The live DOM wiring
 * lives in initCrudeDashboard(). This module intentionally does NOT touch
 * Cesium — the map layer owns the 3D entities.
 */

export const STATUSES = [
  { id: 'prospect', es: 'Prospectos', en: 'Prospects' },
  { id: 'diligence', es: 'Diligencia', en: 'Diligence' },
  { id: 'negotiating', es: 'Negociando', en: 'Negotiating' },
  { id: 'contracted', es: 'Contratados', en: 'Contracted' },
  { id: 'loading', es: 'Cargando', en: 'Loading' },
  { id: 'in-transit', es: 'En tránsito', en: 'In transit' },
  { id: 'delivered', es: 'Entregados', en: 'Delivered' },
  { id: 'closed', es: 'Cerrados', en: 'Closed' },
  { id: 'dead', es: 'Descartados', en: 'Dead' },
];

const VALID_STATUSES = new Set(STATUSES.map((s) => s.id));
/** Cargoes that still count as "open" pipeline business. */
const OPEN_STATUSES = new Set([
  'prospect',
  'diligence',
  'negotiating',
  'contracted',
  'loading',
  'in-transit',
]);

const CSV_HEADERS = [
  'ref',
  'grade',
  'volume',
  'buy',
  'sell',
  'commissionPerBbl',
  'costs',
  'status',
  'incoterms',
  'laycan',
  'loadPort',
  'dischargePort',
  'notes',
];

const CP_CSV_HEADERS = [
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
  'volume',
  'buy',
  'sell',
  'commissionperbbl',
  'costs',
]);

/** CSS pill class from a verdict or cargo status. */
export function statusPillClass(status) {
  const s = String(status || '').toLowerCase();
  if (['green', 'yellow', 'red', 'gray'].includes(s)) return s;
  if (s === 'dead') return 'red';
  if (['closed', 'delivered', 'contracted'].includes(s)) return 'green';
  if (['negotiating', 'diligence', 'loading', 'in-transit'].includes(s))
    return 'yellow';
  return 'gray';
}

function round2(n) {
  const v = Number(n) || 0;
  return Math.round(v * 100) / 100;
}

/**
 * Deal math for a crude cargo.
 * spreadPerBbl = sell − buy ($/bbl)
 * grossMargin  = spreadPerBbl × volume
 * totalCosts   = costs (all-in, $)
 * netMargin    = grossMargin − totalCosts
 * netPerBbl    = volume > 0 ? netMargin / volume : 0
 * commissionTotal = commissionPerBbl × volume
 * Pure: no store or engine imports, defensive against junk input.
 */
export function dealMath(cargo = {}) {
  const volume = Number(cargo.volume) || 0;
  const buy = Number(cargo.buy) || 0;
  const sell = Number(cargo.sell) || 0;
  const commissionPerBbl = Number(cargo.commissionPerBbl) || 0;
  const totalCosts = round2(cargo.costs);
  const spreadPerBbl = round2(sell - buy);
  const grossMargin = round2(spreadPerBbl * volume);
  const netMargin = round2(grossMargin - totalCosts);
  const netPerBbl = volume > 0 ? round2(netMargin / volume) : 0;
  const commissionTotal = round2(commissionPerBbl * volume);
  return {
    spreadPerBbl,
    grossMargin,
    totalCosts,
    netMargin,
    netPerBbl,
    commissionTotal,
  };
}

/** Profitability verdict for a cargo: 'green' | 'yellow' | 'red' | 'gray'. */
export function verdictOf(cargo = {}) {
  const { netPerBbl } = dealMath(cargo);
  if (!Number.isFinite(netPerBbl)) return 'gray';
  if (netPerBbl > 0) return 'green';
  if (netPerBbl < 0) return 'red';
  return 'yellow';
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
 * Parse a CSV string into cargoes (and optionally counterparties).
 * Returns { cargoes, counterparties, errors }.
 * An optional `#COUNTERPARTIES` marker starts a second table with
 * CP_CSV_HEADERS. Rows with neither ref nor grade nor volume count as
 * errors. Unknown statuses normalize to 'prospect'.
 */
export function parseCargoesCsv(text) {
  const result = { cargoes: [], counterparties: [], errors: 0 };
  if (typeof text !== 'string' || !text.trim()) return result;
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const marker = lines.findIndex(
    (l) => l.trim().toLowerCase() === '#counterparties',
  );
  const cargoLines = marker === -1 ? lines : lines.slice(0, marker);
  const cpLines = marker === -1 ? [] : lines.slice(marker + 1);
  if (cargoLines.length >= 2) {
    for (const row of rowsToObjects(cargoLines, CSV_HEADERS, CSV_NUM_FIELDS)) {
      if (!row.ref && !row.grade && !row.volume) {
        result.errors += 1;
        continue;
      }
      if (!VALID_STATUSES.has(String(row.status))) row.status = 'prospect';
      result.cargoes.push(row);
    }
  }
  if (cpLines.length >= 2) {
    for (const row of rowsToObjects(cpLines, CP_CSV_HEADERS, new Set())) {
      if (!row.name) {
        result.errors += 1;
        continue;
      }
      result.counterparties.push(row);
    }
  }
  return result;
}

/** Serialize cargoes to CSV. */
export function cargoesToCsv(cargoes) {
  const rows = [CSV_HEADERS.join(',')];
  for (const c of cargoes || []) {
    rows.push(CSV_HEADERS.map((h) => csvEscape(c[h])).join(','));
  }
  return rows.join('\n');
}

/** Downloadable template with one obviously-fictional sample row. */
export function csvTemplate() {
  return (
    `${CSV_HEADERS.join(',')}\n` +
    `SAMPLE-001,Sample Blend,500000,68.50,70.25,0.10,25000,prospect,FOB,2026-10-01/2026-10-05,Port Example,Port Example,Obviously fictional sample - do not trade on this\n` +
    `#COUNTERPARTIES\n` +
    `${CP_CSV_HEADERS.join(',')}\n` +
    `Example Trading Ltd,trader,buyer,Exampleland,unverified,Sample Contact,sample@example.test,+1-555-0100`
  );
}

const VERIFICATION_LABELS = {
  verified: { es: 'Verificado', en: 'Verified' },
  pending: { es: 'En verificación', en: 'Pending' },
  unverified: { es: 'Sin verificar', en: 'Unverified' },
};

function verificationLabel(status, lang = 'es') {
  const v = VERIFICATION_LABELS[String(status || '').toLowerCase()];
  if (!v) return lang === 'es' ? 'Sin verificar' : 'Unverified';
  return lang === 'es' ? v.es : v.en;
}

function verificationPill(verification) {
  const s = String(verification || '').toLowerCase();
  if (s === 'verified') return 'green';
  if (s === 'pending') return 'yellow';
  return 'red';
}

/**
 * Bilingual commission draft — DRAFT for copy/paste only. Never sends
 * anything. First person as "Juan Gonzalez, private broker", with an
 * explicit not-legal-advice line and a "nothing sent" line.
 */
export function draftCommissionText(
  cargo = {},
  counterparty = {},
  lang = 'es',
  money = null,
) {
  const fmt =
    typeof money === 'function'
      ? money
      : (n) => `$${(Number(n) || 0).toLocaleString('en-US')}`;
  const price = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const m = dealMath(cargo);
  const L = lang === 'es';
  const cpName = counterparty?.name || '—';
  const cpDetail = [
    counterparty?.type,
    counterparty?.role,
    counterparty?.country,
    verificationLabel(counterparty?.verification, lang),
  ]
    .filter(Boolean)
    .join(' · ');
  const ref = cargo.ref || '—';
  const grade = cargo.grade || '—';
  const volume = `${(Number(cargo.volume) || 0).toLocaleString('en-US')} bbl`;
  const legalEs =
    'Esto no es asesoría legal. Un abogado con licencia debe revisar el contrato antes de firmar.';
  const legalEn =
    'This is not legal advice. A licensed attorney must review the contract before signing.';
  if (L) {
    return [
      'BORRADOR DE COMISIÓN — NADA ENVIADO',
      '(borrador — nada enviado / draft — nothing sent)',
      '',
      `Yo, Juan Gonzalez, corredor privado, presento este borrador de acuerdo de comisión sobre el cargamento ${ref}.`,
      '',
      `Cargamento: ${grade} — ${volume}`,
      `Compra: ${price(cargo.buy)}/bbl · Venta: ${price(cargo.sell)}/bbl`,
      `Diferencial: ${price(m.spreadPerBbl)}/bbl`,
      `Margen bruto: ${fmt(m.grossMargin)} · Costos estimados: ${fmt(m.totalCosts)}`,
      `Margen neto: ${fmt(m.netMargin)} (${price(m.netPerBbl)}/bbl)`,
      `Comisión propuesta: ${price(cargo.commissionPerBbl)}/bbl = ${fmt(m.commissionTotal)}`,
      `Incoterms: ${cargo.incoterms || '—'} · Laycan: ${cargo.laycan || '—'}`,
      `Puerto de carga: ${cargo.loadPort || '—'} · Puerto de descarga: ${cargo.dischargePort || '—'}`,
      `Contraparte: ${cpName}${cpDetail ? ` (${cpDetail})` : ''}`,
      '',
      'Este borrador es solo para revisión y copia — nada se ha enviado a nadie.',
      '',
      legalEs,
      '',
      '— Juan Gonzalez, corredor privado',
    ].join('\n');
  }
  return [
    'COMMISSION DRAFT — NOTHING SENT',
    '(draft — nothing sent / borrador — nada enviado)',
    '',
    `I, Juan Gonzalez, private broker, submit this draft commission agreement for cargo ${ref}.`,
    '',
    `Cargo: ${grade} — ${volume}`,
    `Buy: ${price(cargo.buy)}/bbl · Sell: ${price(cargo.sell)}/bbl`,
    `Spread: ${price(m.spreadPerBbl)}/bbl`,
    `Gross margin: ${fmt(m.grossMargin)} · Estimated costs: ${fmt(m.totalCosts)}`,
    `Net margin: ${fmt(m.netMargin)} (${price(m.netPerBbl)}/bbl)`,
    `Proposed commission: ${price(cargo.commissionPerBbl)}/bbl = ${fmt(m.commissionTotal)}`,
    `Incoterms: ${cargo.incoterms || '—'} · Laycan: ${cargo.laycan || '—'}`,
    `Load port: ${cargo.loadPort || '—'} · Discharge port: ${cargo.dischargePort || '—'}`,
    `Counterparty: ${cpName}${cpDetail ? ` (${cpDetail})` : ''}`,
    '',
    'This draft is for review and copy only — nothing has been sent to anyone.',
    '',
    legalEn,
    '',
    '— Juan Gonzalez, private broker',
  ].join('\n');
}

/**
 * Normalize any cargo-store-like object to the interface this panel uses.
 * Accepts the real crude store (createCargo/getCargo/updateCargo/moveCargo/
 * deleteCargo/listCargoes/stats + listCounterparties/addCounterparty/
 * updateCounterparty/addCargoNote/addCounterpartyNote) as well as the
 * minimal in-memory shape (list/byId/update/addMany/notes/addNote/stats).
 */
export function adaptStore(raw) {
  if (!raw) return createMemoryCargoStore();
  const byId = (id) => {
    if (typeof raw.byId === 'function') return raw.byId(id);
    if (typeof raw.getCargo === 'function') return raw.getCargo(id);
    return null;
  };
  const counterpartyById = (id) => {
    if (!id) return null;
    try {
      if (typeof raw.counterpartyById === 'function')
        return raw.counterpartyById(id);
      if (typeof raw.getCounterparty === 'function')
        return raw.getCounterparty(id);
      const all = listCounterparties();
      return (all || []).find((c) => c.id === id) || null;
    } catch {
      return null;
    }
  };
  const list = (status) => {
    try {
      if (typeof raw.list === 'function') return raw.list(status) || [];
      if (typeof raw.listCargoes === 'function') {
        return raw.listCargoes(status) || [];
      }
    } catch {
      /* fall through */
    }
    return [];
  };
  const update = (id, patch) => {
    try {
      if (typeof raw.update === 'function') return raw.update(id, patch);
      if (typeof raw.updateCargo === 'function')
        return raw.updateCargo(id, patch);
    } catch {
      /* noop */
    }
    return null;
  };
  const addMany = (arr) => {
    try {
      if (typeof raw.addMany === 'function') return raw.addMany(arr) || [];
      if (typeof raw.createCargo === 'function') {
        return (arr || []).map((c) => raw.createCargo(c)).filter(Boolean);
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
          ts: n.ts || n.t || Date.now(),
          author: n.author || n.agent || '',
          textEs: n.textEs ?? n.es ?? n.text ?? '',
          textEn: n.textEn ?? n.en ?? n.text ?? '',
        }));
      }
    } catch {
      /* fall through to cargo.notes */
    }
    try {
      const cargo = byId(id);
      return ((cargo && cargo.notes) || []).map((n) => ({
        ts: n.ts || n.t || Date.now(),
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
      if (typeof raw.addNote === 'function') return raw.addNote(id, text);
      if (typeof raw.addCargoNote === 'function') {
        return raw.addCargoNote(id, String(text));
      }
    } catch {
      /* noop */
    }
    return null;
  };
  const listCounterparties = () => {
    try {
      if (typeof raw.listCounterparties === 'function')
        return raw.listCounterparties() || [];
      if (Array.isArray(raw.counterparties)) return raw.counterparties;
      if (typeof raw.counterpartyList === 'function')
        return raw.counterpartyList() || [];
    } catch {
      /* fall through */
    }
    return [];
  };
  const addCounterparty = (data) => {
    try {
      if (typeof raw.addCounterparty === 'function')
        return raw.addCounterparty(data);
    } catch {
      /* noop */
    }
    return null;
  };
  const updateCounterparty = (id, patch) => {
    try {
      if (typeof raw.updateCounterparty === 'function')
        return raw.updateCounterparty(id, patch);
    } catch {
      /* noop */
    }
    return null;
  };
  return {
    list,
    byId,
    update,
    addMany,
    move(id, status) {
      try {
        if (typeof raw.move === 'function') return raw.move(id, status);
        if (typeof raw.moveCargo === 'function')
          return raw.moveCargo(id, status);
        return update(id, { status });
      } catch {
        return null;
      }
    },
    remove(id) {
      try {
        if (typeof raw.remove === 'function') return raw.remove(id);
        if (typeof raw.deleteCargo === 'function') return raw.deleteCargo(id);
      } catch {
        /* noop */
      }
      return null;
    },
    notes,
    addNote,
    stats() {
      try {
        return (
          raw.stats?.() || {
            total: 0,
            openCargoes: 0,
            totalVolume: 0,
            potentialCommission: 0,
          }
        );
      } catch {
        return {
          total: 0,
          openCargoes: 0,
          totalVolume: 0,
          potentialCommission: 0,
        };
      }
    },
    listCounterparties,
    counterpartyById,
    addCounterparty,
    updateCounterparty,
    addCounterpartyNote(id, text) {
      try {
        if (typeof raw.addCounterpartyNote === 'function')
          return raw.addCounterpartyNote(id, String(text));
      } catch {
        /* noop */
      }
      return null;
    },
  };
}

/** In-memory cargo store exposing the real store's API, for tests and standalone use. */
export function createMemoryCargoStore(seed = []) {
  let seq = 1;
  let cpSeq = 1;
  const cargoes = new Map();
  const cargoNotes = new Map();
  const counterparties = new Map();
  const cpNotes = new Map();
  const norm = (c) => ({
    id: c.id || `cargo-${seq++}`,
    ref: c.ref || `CARGO-${String(seq).padStart(3, '0')}`,
    grade: c.grade || '',
    volume: Number(c.volume) || 0,
    buy: Number(c.buy) || 0,
    sell: Number(c.sell) || 0,
    commissionPerBbl: Number(c.commissionPerBbl) || 0,
    costs: Number(c.costs) || 0,
    status: VALID_STATUSES.has(c.status) ? c.status : 'prospect',
    incoterms: c.incoterms || '',
    laycan: c.laycan || '',
    loadPort: c.loadPort || '',
    dischargePort: c.dischargePort || '',
    counterpartyId: c.counterpartyId || '',
    notes: c.notes || '',
  });
  const normCp = (c) => ({
    id: c.id || `cp-${cpSeq++}`,
    name: c.name || '',
    type: c.type || 'trader',
    role: c.role || 'buyer',
    country: c.country || '',
    verification: ['verified', 'pending', 'unverified'].includes(
      String(c.verification || '').toLowerCase(),
    )
      ? String(c.verification).toLowerCase()
      : 'unverified',
    contactName: c.contactName || '',
    contactEmail: c.contactEmail || '',
    contactPhone: c.contactPhone || '',
    notes: c.notes || '',
  });
  for (const c of seed) {
    const n = norm(c);
    cargoes.set(n.id, n);
  }
  const pushNote = (map, id, text, author) => {
    const list = map.get(id) || [];
    list.push({
      ts: Date.now(),
      author: author || '',
      text: String(text || ''),
    });
    map.set(id, list);
    return list;
  };
  return {
    createCargo(data) {
      const n = norm(data || {});
      cargoes.set(n.id, n);
      return n;
    },
    getCargo(id) {
      return cargoes.get(id) || null;
    },
    byId(id) {
      return cargoes.get(id) || null;
    },
    updateCargo(id, patch) {
      const cur = cargoes.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, id };
      if (patch && patch.status && !VALID_STATUSES.has(patch.status)) {
        next.status = cur.status;
      }
      cargoes.set(id, next);
      return next;
    },
    moveCargo(id, status) {
      return this.updateCargo(id, { status });
    },
    deleteCargo(id) {
      cargoNotes.delete(id);
      return cargoes.delete(id);
    },
    listCargoes(status) {
      const all = [...cargoes.values()];
      return status ? all.filter((c) => c.status === status) : all;
    },
    list(status) {
      return this.listCargoes(status);
    },
    addMany(arr) {
      return (arr || []).map((c) => this.createCargo(c));
    },
    notes(id) {
      return cargoNotes.get(id) || [];
    },
    addCargoNote(id, text) {
      return pushNote(cargoNotes, id, text, 'Juan Gonzalez');
    },
    listCounterparties() {
      return [...counterparties.values()];
    },
    counterpartyById(id) {
      return counterparties.get(id) || null;
    },
    addCounterparty(data) {
      const n = normCp(data || {});
      counterparties.set(n.id, n);
      return n;
    },
    updateCounterparty(id, patch) {
      const cur = counterparties.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, id };
      counterparties.set(id, next);
      return next;
    },
    counterpartyNotes(id) {
      return cpNotes.get(id) || [];
    },
    addCounterpartyNote(id, text) {
      return pushNote(cpNotes, id, text, 'Juan Gonzalez');
    },
    stats() {
      const all = [...cargoes.values()];
      const open = all.filter((c) => OPEN_STATUSES.has(c.status));
      return {
        total: all.length,
        openCargoes: open.length,
        totalVolume: open.reduce((a, c) => a + (Number(c.volume) || 0), 0),
        potentialCommission:
          Math.round(
            open.reduce(
              (a, c) =>
                a + (Number(c.commissionPerBbl) || 0) * (Number(c.volume) || 0),
              0,
            ) * 100,
          ) / 100,
      };
    },
  };
}

const CC_CSS = `
#gev-crude-btn{display:flex;align-items:center;gap:8px;padding:10px 12px;margin-top:8px;background:rgba(10,14,22,.82);border:1px solid rgba(255,180,84,.32);border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.06em;min-width:172px;max-width:210px}
#gev-crude-btn:hover{border-color:rgba(255,180,84,.65)}
#gev-crude-panel{position:fixed;z-index:60;right:12px;top:12px;width:min(860px,calc(100vw - 24px));height:min(660px,calc(100vh - 24px));background:rgba(8,11,18,.96);border:1px solid rgba(255,180,84,.32);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7}
#gev-crude-panel .ccp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,180,84,.18)}
#gev-crude-panel .ccp-title{font-size:12px;font-weight:800;letter-spacing:.1em;color:#ffb454;flex:1}
#gev-crude-panel .ccp-lang{background:none;border:1px solid rgba(255,180,84,.4);color:#ffb454;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:800;font-family:inherit}
#gev-crude-panel .ccp-manage{padding:5px 12px;border-radius:8px;border:1px solid rgba(125,211,252,.35);background:rgba(125,211,252,.1);color:#eaf4ff;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;min-height:44px}
#gev-crude-panel .ccp-close{background:none;border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:14px}
#gev-crude-panel .ccp-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,180,84,.18)}
#gev-crude-panel .ccp-kpi{background:rgba(255,180,84,.06);border:1px solid rgba(255,180,84,.15);border-radius:10px;padding:8px 10px}
#gev-crude-panel .ccp-kpi .k{font-size:10px;color:#9fb0c9;letter-spacing:.05em}
#gev-crude-panel .ccp-kpi .v{font-size:16px;font-weight:800;color:#fff}
#gev-crude-panel .ccp-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 12px;border-bottom:1px solid rgba(255,180,84,.18)}
#gev-crude-panel .ccp-btn{padding:7px 12px;border-radius:9px;border:1px solid rgba(255,180,84,.4);background:rgba(255,180,84,.1);color:#ffe9c9;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit}
#gev-crude-panel .ccp-btn:hover{background:rgba(255,180,84,.22)}
#gev-crude-panel .ccp-status{font-size:11px;color:#9fb0c9}
#gev-crude-panel .ccp-cols{flex:1;display:flex;gap:8px;overflow-x:auto;padding:10px 12px;min-height:0}
#gev-crude-panel .ccp-col{min-width:170px;flex:1;background:rgba(255,255,255,.02);border:1px solid rgba(255,180,84,.12);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
#gev-crude-panel .ccp-colhead{font-size:10px;font-weight:800;letter-spacing:.08em;color:#ffb454;padding:8px 10px;border-bottom:1px solid rgba(255,180,84,.12);text-transform:uppercase}
#gev-crude-panel .ccp-cards{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px}
#gev-crude-panel .ccp-card{background:rgba(10,14,22,.85);border:1px solid rgba(255,180,84,.22);border-radius:10px;padding:8px 10px;cursor:pointer;font-size:11px}
#gev-crude-panel .ccp-card:hover{border-color:rgba(255,180,84,.55)}
#gev-crude-panel .ccp-card .cref{font-weight:700;color:#fff;margin-bottom:4px}
#gev-crude-panel .ccp-card .cmeta{display:flex;align-items:center;gap:6px;color:#9fb0c9}
#gev-crude-panel .pill{font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px}
#gev-crude-panel .pill.green{background:rgba(52,211,153,.18);color:#34d399;border:1px solid rgba(52,211,153,.4)}
#gev-crude-panel .pill.yellow{background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.4)}
#gev-crude-panel .pill.red{background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.4)}
#gev-crude-panel .pill.gray{background:rgba(148,163,184,.15);color:#94a3b8;border:1px solid rgba(148,163,184,.4)}
#gev-crude-panel .ccp-empty{font-size:11px;color:#5b6b82;padding:12px;text-align:center}
#gev-crude-drawer{position:absolute;top:0;right:0;bottom:0;width:min(360px,92%);background:rgba(10,14,22,.98);border-left:1px solid rgba(255,180,84,.35);padding:14px;overflow-y:auto;font-size:12px}
#gev-crude-drawer h3{margin:0 0 4px;font-size:14px;color:#fff}
#gev-crude-drawer .dsub{font-size:11px;color:#9fb0c9;margin-bottom:10px}
#gev-crude-drawer label{display:block;font-size:10px;color:#9fb0c9;margin:8px 0 3px;letter-spacing:.05em}
#gev-crude-drawer input,#gev-crude-drawer select,#gev-crude-drawer textarea{width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,180,84,.3);border-radius:8px;color:#fff;padding:7px 9px;font-size:12px;font-family:inherit}
#gev-crude-drawer .math{background:rgba(255,180,84,.06);border:1px solid rgba(255,180,84,.22);border-radius:10px;padding:10px;margin-top:10px}
#gev-crude-drawer .math .mrow{display:flex;justify-content:space-between;margin:3px 0}
#gev-crude-drawer .math .mrow b{color:#fff}
#gev-crude-drawer .note{border-left:2px solid rgba(255,180,84,.5);padding:4px 8px;margin:6px 0;font-size:11px;color:#c8d4e4}
#gev-crude-drawer .note .nts{font-size:10px;color:#5b6b82}
#gev-crude-drawer pre.draft{white-space:pre-wrap;background:rgba(255,255,255,.04);border:1px solid rgba(255,209,102,.35);border-radius:10px;padding:10px;font-size:11px;color:#f3e9cf;font-family:inherit}
#gev-crude-counterparties{padding:10px 12px;border-top:1px solid rgba(255,180,84,.18);font-size:11px;max-height:180px;overflow-y:auto}
#gev-crude-counterparties .cprow{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;color:#c8d4e4;border-bottom:1px solid rgba(255,180,84,.08)}
#gev-crude-counterparties .cpform{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
#gev-crude-counterparties input,#gev-crude-counterparties select{background:rgba(255,255,255,.05);border:1px solid rgba(255,180,84,.3);border-radius:8px;color:#fff;padding:6px 8px;font-size:11px;font-family:inherit;min-width:0}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-crude-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-crude-styles';
  style.textContent = CC_CSS;
  document.head.appendChild(style);
}

function defaultMoney(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US')}`;
}

/**
 * Live controller: dock button + floating crude mission-control panel.
 * options: { cargoStore, cargoEngine, tankerMap, workforce, signal, parseCsv }
 * cargoStore may be the real crude store (createCargo/getCargo/updateCargo/
 * moveCargo/deleteCargo/listCargoes/stats + listCounterparties/addCounterparty/
 * updateCounterparty/addCargoNote/addCounterpartyNote) or the minimal
 * in-memory shape — adaptStore() normalizes either.
 */
export function initCrudeDashboard({
  cargoStore = null,
  cargoEngine = null,
  tankerMap = null,
  workforce = null,
  signal = null,
  parseCsv = parseCargoesCsv,
  onOpenManagement = null,
} = {}) {
  injectStyles();
  const store = adaptStore(cargoStore);
  const fmtMoney =
    typeof cargoEngine?.formatMoney === 'function'
      ? cargoEngine.formatMoney
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
  let editingCpId = null;
  const t = (es, en) => (lang === 'es' ? es : en);
  const refs = {
    kpis: null,
    cols: null,
    importBtn: null,
    exportBtn: null,
    templateBtn: null,
    importStatus: null,
    cargoCards: [],
    draftBtn: null,
    drawer: null,
    cpList: null,
    cpForm: {},
  };

  function statusLabel(id) {
    const s = STATUSES.find((x) => x.id === id);
    return s ? t(s.es, s.en) : id;
  }

  function renderKpis() {
    if (!refs.kpis) return;
    let stats = {
      total: 0,
      openCargoes: 0,
      totalVolume: 0,
      potentialCommission: 0,
    };
    try {
      stats = store.stats() || stats;
    } catch {
      /* keep defaults */
    }
    refs.kpis.innerHTML = `
      <div class="ccp-kpi"><div class="k">${t('CARGAMENTOS ABIERTOS', 'OPEN CARGOES')}</div><div class="v">${stats.openCargoes}</div></div>
      <div class="ccp-kpi"><div class="k">${t('VOLUMEN TOTAL (BBL)', 'TOTAL VOLUME (BBL)')}</div><div class="v">${(Number(stats.totalVolume) || 0).toLocaleString('en-US')}</div></div>
      <div class="ccp-kpi"><div class="k">${t('COMISIÓN POTENCIAL', 'POTENTIAL COMMISSION')}</div><div class="v">${fmtMoney(stats.potentialCommission)}</div></div>
    `;
  }

  function renderColumns() {
    if (!refs.cols) return;
    refs.cols.innerHTML = '';
    refs.cargoCards = [];
    for (const st of STATUSES) {
      const col = document.createElement('div');
      col.className = 'ccp-col';
      col.dataset.status = st.id;
      const head = document.createElement('div');
      head.className = 'ccp-colhead';
      const cards = document.createElement('div');
      cards.className = 'ccp-cards';
      let cargoes = [];
      try {
        cargoes = store.list(st.id) || [];
      } catch {
        cargoes = [];
      }
      head.textContent = `${t(st.es, st.en)} (${cargoes.length})`;
      if (!cargoes.length) {
        const empty = document.createElement('div');
        empty.className = 'ccp-empty';
        empty.textContent = '—';
        cards.appendChild(empty);
      }
      for (const cargo of cargoes) {
        const card = document.createElement('div');
        card.className = 'ccp-card';
        card.dataset.cargoId = cargo.id;
        const ref = document.createElement('div');
        ref.className = 'cref';
        ref.textContent = cargo.ref || t('(sin referencia)', '(no ref)');
        const meta = document.createElement('div');
        meta.className = 'cmeta';
        const pill = document.createElement('span');
        const verdict = verdictOf(cargo);
        pill.className = `pill ${statusPillClass(verdict)}`;
        pill.textContent = t(
          { green: 'Positivo', yellow: 'Empate', red: 'Negativo', gray: '—' }[
            verdict
          ] || verdict,
          verdict,
        );
        const info = document.createElement('span');
        const vol = (Number(cargo.volume) || 0).toLocaleString('en-US');
        info.textContent = `${cargo.grade || ''} · ${vol} bbl`;
        meta.appendChild(pill);
        meta.appendChild(info);
        card.appendChild(ref);
        card.appendChild(meta);
        card.addEventListener('click', () => openDrawer(cargo.id));
        cards.appendChild(card);
        refs.cargoCards.push(card);
      }
      col.appendChild(head);
      col.appendChild(cards);
      refs.cols.appendChild(col);
    }
  }

  function counterpartyName(id) {
    if (!id) return '—';
    try {
      const cp = store.counterpartyById(id);
      return cp?.name || '—';
    } catch {
      return '—';
    }
  }

  function renderCounterparties() {
    const box = panelEl?.querySelector('#gev-crude-counterparties');
    if (!box) return;
    box.innerHTML = '';
    refs.cpList = box;
    const title = document.createElement('div');
    title.style.cssText =
      'font-weight:800;color:#ffb454;letter-spacing:.08em;font-size:10px;margin-bottom:6px';
    title.textContent = t('CONTRAPARTES', 'COUNTERPARTIES');
    box.appendChild(title);
    const list = document.createElement('div');
    let cps = [];
    try {
      cps = store.listCounterparties() || [];
    } catch {
      cps = [];
    }
    if (!cps.length) {
      const empty = document.createElement('div');
      empty.className = 'ccp-empty';
      empty.textContent = t(
        'Agrega tu primera contraparte abajo.',
        'Add your first counterparty below.',
      );
      list.appendChild(empty);
    }
    for (const cp of cps) {
      const row = document.createElement('div');
      row.className = 'cprow';
      row.dataset.cpId = cp.id;
      const left = document.createElement('div');
      const nm = document.createElement('div');
      nm.style.fontWeight = '700';
      nm.style.color = '#fff';
      nm.textContent = cp.name || '—';
      const sub = document.createElement('div');
      sub.style.fontSize = '10px';
      sub.style.color = '#9fb0c9';
      sub.textContent = [cp.type, cp.role, cp.country]
        .filter(Boolean)
        .join(' · ');
      left.appendChild(nm);
      left.appendChild(sub);
      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '6px';
      right.style.alignItems = 'center';
      const vpill = document.createElement('span');
      vpill.className = `pill ${verificationPill(cp.verification)}`;
      vpill.textContent = verificationLabel(cp.verification, lang);
      const editBtn = document.createElement('button');
      editBtn.className = 'ccp-btn';
      editBtn.type = 'button';
      editBtn.style.padding = '4px 8px';
      editBtn.textContent = t('Editar', 'Edit');
      editBtn.addEventListener('click', () => startEditCounterparty(cp.id));
      right.appendChild(vpill);
      right.appendChild(editBtn);
      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    }
    box.appendChild(list);
    renderCpForm(box);
  }

  function renderCpForm(box) {
    const form = document.createElement('div');
    form.className = 'cpform';
    const editing = editingCpId ? store.counterpartyById(editingCpId) : null;
    const f = editing || {};
    const mk = (key, placeholder, kind = 'text') => {
      let input;
      if (kind === 'select-ver') {
        input = document.createElement('select');
        for (const v of ['unverified', 'pending', 'verified']) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = verificationLabel(v, lang);
          if ((f.verification || 'unverified') === v) opt.selected = true;
          input.appendChild(opt);
        }
      } else if (kind === 'select-type') {
        input = document.createElement('select');
        for (const v of ['supplier', 'buyer', 'trader', 'broker']) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          if ((f.type || 'trader') === v) opt.selected = true;
          input.appendChild(opt);
        }
      } else if (kind === 'select-role') {
        input = document.createElement('select');
        for (const v of ['supplier', 'buyer', 'broker', 'both']) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          if ((f.role || 'buyer') === v) opt.selected = true;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.placeholder = placeholder;
        input.value = f[key] || '';
      }
      input.dataset.cpField = key;
      form.appendChild(input);
      refs.cpForm[key] = input;
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
    saveBtn.className = 'ccp-btn';
    saveBtn.type = 'button';
    saveBtn.textContent = editing
      ? t('Guardar', 'Save')
      : t('Agregar contraparte', 'Add counterparty');
    saveBtn.addEventListener('click', () => {
      const data = {};
      for (const [key, input] of Object.entries(refs.cpForm)) {
        const v = String(input.value || '').trim();
        if (v) data[key] = v;
      }
      if (!data.name) return;
      if (editingCpId) {
        store.updateCounterparty(editingCpId, data);
        editingCpId = null;
      } else {
        store.addCounterparty(data);
      }
      refresh();
    });
    actions.appendChild(saveBtn);
    if (editingCpId) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ccp-btn';
      cancelBtn.type = 'button';
      cancelBtn.textContent = t('Cancelar', 'Cancel');
      cancelBtn.addEventListener('click', () => {
        editingCpId = null;
        refresh();
      });
      actions.appendChild(cancelBtn);
    }
    form.appendChild(actions);
    box.appendChild(form);
    refs.cpSaveBtn = saveBtn;
  }

  function startEditCounterparty(id) {
    editingCpId = id;
    renderCounterparties();
  }

  function renderDrawerBody() {
    const drawer = refs.drawer;
    if (!drawer) return;
    const cargo = store.byId(selectedId);
    if (!cargo) {
      drawer.innerHTML = '';
      return;
    }
    const m = dealMath(cargo);
    const verdict = verdictOf(cargo);
    drawer.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = cargo.ref || t('(sin referencia)', '(no ref)');
    const sub = document.createElement('div');
    sub.className = 'dsub';
    sub.textContent = [
      cargo.grade,
      `${(Number(cargo.volume) || 0).toLocaleString('en-US')} bbl`,
      counterpartyName(cargo.counterpartyId),
    ]
      .filter(Boolean)
      .join(' · ');
    const vpill = document.createElement('span');
    vpill.className = `pill ${statusPillClass(verdict)}`;
    vpill.style.marginLeft = '8px';
    vpill.textContent = t(
      {
        green: 'POSITIVO',
        yellow: 'EMPATE',
        red: 'NEGATIVO',
        gray: '—',
      }[verdict] || verdict,
      verdict.toUpperCase(),
    );
    h.appendChild(vpill);
    drawer.appendChild(h);
    drawer.appendChild(sub);

    const fieldDefs = [
      ['status', t('Estado', 'Status'), 'status'],
      ['grade', t('Grado', 'Grade'), 'text'],
      ['volume', t('Volumen (bbl)', 'Volume (bbl)'), 'number'],
      ['buy', t('Compra ($/bbl)', 'Buy ($/bbl)'), 'number'],
      ['sell', t('Venta ($/bbl)', 'Sell ($/bbl)'), 'number'],
      [
        'commissionPerBbl',
        t('Comisión ($/bbl)', 'Commission ($/bbl)'),
        'number',
      ],
      ['costs', t('Costos ($)', 'Costs ($)'), 'number'],
      ['incoterms', 'Incoterms', 'text'],
      ['laycan', 'Laycan', 'text'],
      ['loadPort', t('Puerto de carga', 'Load port'), 'text'],
      ['dischargePort', t('Puerto de descarga', 'Discharge port'), 'text'],
      ['counterpartyId', t('Contraparte', 'Counterparty'), 'counterparty'],
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
          if (cargo.status === st.id) opt.selected = true;
          input.appendChild(opt);
        }
      } else if (kind === 'counterparty') {
        input = document.createElement('select');
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '—';
        input.appendChild(none);
        let cps = [];
        try {
          cps = store.listCounterparties() || [];
        } catch {
          cps = [];
        }
        for (const cp of cps) {
          const opt = document.createElement('option');
          opt.value = cp.id;
          opt.textContent = cp.name || cp.id;
          if (cargo.counterpartyId === cp.id) opt.selected = true;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.type = kind === 'number' ? 'number' : 'text';
        input.value = cargo[key] ?? '';
      }
      input.dataset.field = key;
      input.addEventListener('change', () => {
        const patch = {};
        if (kind === 'number') patch[key] = Number(input.value) || 0;
        else patch[key] = input.value;
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
      'font-size:10px;font-weight:800;letter-spacing:.08em;color:#ffb454;margin-bottom:6px';
    mTitle.textContent = t('NÚMEROS DEL NEGOCIO', 'DEAL MATH');
    math.appendChild(mTitle);
    const rows = [
      [
        t('Diferencial ($/bbl)', 'Spread ($/bbl)'),
        `$${m.spreadPerBbl.toFixed(2)}`,
      ],
      [t('Margen bruto', 'Gross margin'), fmtMoney(m.grossMargin)],
      [t('Costos', 'Costs'), fmtMoney(m.totalCosts)],
      [t('Margen neto', 'Net margin'), fmtMoney(m.netMargin)],
      [t('Neto ($/bbl)', 'Net ($/bbl)'), `$${m.netPerBbl.toFixed(2)}`],
      [t('Comisión total', 'Commission total'), fmtMoney(m.commissionTotal)],
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
    drawer.appendChild(math);

    const notesTitle = document.createElement('div');
    notesTitle.style.cssText =
      'font-size:10px;font-weight:800;letter-spacing:.08em;color:#ffb454;margin:12px 0 4px';
    notesTitle.textContent = t('NOTAS DEL AGENTE', 'AGENT NOTES');
    drawer.appendChild(notesTitle);
    const tl = document.createElement('div');
    let ns = [];
    try {
      ns = store.notes(cargo.id) || [];
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
    noteBtn.className = 'ccp-btn';
    noteBtn.type = 'button';
    noteBtn.style.marginTop = '6px';
    noteBtn.textContent = t('Guardar nota', 'Save note');
    noteBtn.addEventListener('click', () => {
      const v = noteIn.value.trim();
      if (!v) return;
      store.addNote(cargo.id, v);
      renderDrawerBody();
    });
    drawer.appendChild(noteIn);
    drawer.appendChild(noteBtn);
    refs.noteInput = noteIn;
    refs.noteBtn = noteBtn;

    const draftBtn = document.createElement('button');
    draftBtn.className = 'ccp-btn';
    draftBtn.type = 'button';
    draftBtn.style.cssText =
      'margin-top:12px;width:100%;border-color:rgba(255,209,102,.45);color:#ffd166;background:rgba(255,209,102,.08)';
    draftBtn.textContent = t(
      '📝 Generar borrador de comisión / Draft commission',
      '📝 Generar borrador de comisión / Draft commission',
    );
    draftBtn.addEventListener('click', () => {
      let cp = null;
      try {
        cp = cargo.counterpartyId
          ? store.counterpartyById(cargo.counterpartyId)
          : null;
      } catch {
        cp = null;
      }
      const pre = document.createElement('pre');
      pre.className = 'draft';
      pre.textContent = draftCommissionText(cargo, cp || {}, lang, fmtMoney);
      const old = drawer.querySelector('pre.draft');
      old?.remove();
      drawer.appendChild(pre);
      refs.draftPre = pre;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'ccp-btn';
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

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ccp-btn';
    closeBtn.type = 'button';
    closeBtn.style.cssText = 'margin-top:8px;width:100%';
    closeBtn.textContent = t('Cerrar', 'Close');
    closeBtn.addEventListener('click', closeDrawer);
    drawer.appendChild(closeBtn);
  }

  function openDrawer(id) {
    selectedId = id;
    if (!panelEl) return;
    let drawer = panelEl.querySelector('#gev-crude-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'gev-crude-drawer';
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
    if (!panelEl || aborted.current) return;
    renderKpis();
    renderColumns();
    renderCounterparties();
    if (selectedId) renderDrawerBody();
  }

  function importCsvText(text) {
    let parsed = { cargoes: [], counterparties: [], errors: 0 };
    try {
      const raw = parseCsv(text);
      if (Array.isArray(raw)) parsed = { ...parsed, cargoes: raw };
      else if (raw && typeof raw === 'object') {
        parsed = {
          cargoes: Array.isArray(raw.cargoes) ? raw.cargoes : [],
          counterparties: Array.isArray(raw.counterparties)
            ? raw.counterparties
            : [],
          errors: Number(raw.errors) || 0,
        };
      }
    } catch {
      parsed = { cargoes: [], counterparties: [], errors: 1 };
    }
    let addedCargoes = [];
    let addedCps = [];
    try {
      addedCargoes = store.addMany(parsed.cargoes) || [];
    } catch {
      addedCargoes = [];
    }
    try {
      addedCps = (parsed.counterparties || [])
        .map((c) => store.addCounterparty(c))
        .filter(Boolean);
    } catch {
      addedCps = [];
    }
    refresh();
    const msg = t(
      `Importados: ${addedCargoes.length} cargamentos, ${addedCps.length} contrapartes. Errores: ${parsed.errors}`,
      `Imported: ${addedCargoes.length} cargoes, ${addedCps.length} counterparties. Errors: ${parsed.errors}`,
    );
    if (refs.importStatus) refs.importStatus.textContent = msg;
    return {
      cargoes: addedCargoes,
      counterparties: addedCps,
      errors: parsed.errors,
    };
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
    panelEl.id = 'gev-crude-panel';
    panelEl.innerHTML = `
      <div class="ccp-head">
        <div class="ccp-title">CRUDO · MISSION CONTROL</div>
        <button class="ccp-manage" type="button">⚙️ Gestionar / Manage</button>
        <button class="ccp-lang" type="button">ES / EN</button>
        <button class="ccp-close" type="button" aria-label="Cerrar / close">✕</button>
      </div>
      <div class="ccp-kpis"></div>
      <div class="ccp-tools">
        <button class="ccp-btn ccp-import" type="button">📥 ${t('Importar CSV / Import CSV', 'Importar CSV / Import CSV')}</button>
        <button class="ccp-btn ccp-template" type="button">📄 ${t('Descargar plantilla / Download template', 'Descargar plantilla / Download template')}</button>
        <button class="ccp-btn ccp-export" type="button">📤 ${t('Exportar CSV / Export CSV', 'Exportar CSV / Export CSV')}</button>
        <span class="ccp-status"></span>
      </div>
      <div class="ccp-cols"></div>
      <div id="gev-crude-counterparties"></div>
    `;
    refs.kpis = panelEl.querySelector('.ccp-kpis');
    refs.cols = panelEl.querySelector('.ccp-cols');
    refs.importBtn = panelEl.querySelector('.ccp-import');
    refs.templateBtn = panelEl.querySelector('.ccp-template');
    refs.exportBtn = panelEl.querySelector('.ccp-export');
    refs.importStatus = panelEl.querySelector('.ccp-status');
    const langBtn = panelEl.querySelector('.ccp-lang');
    const closeBtn = panelEl.querySelector('.ccp-close');
    const manageBtn = panelEl.querySelector('.ccp-manage');
    if (manageBtn) manageBtn.addEventListener('click', () => { try { onOpenManagement && onOpenManagement('approvals'); } catch {} });

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
      downloadFile('crude-template.csv', csvTemplate(), 'text/csv'),
    );
    refs.exportBtn?.addEventListener('click', () =>
      downloadFile('crude-cargoes.csv', cargoesToCsv(store.list()), 'text/csv'),
    );
    langBtn?.addEventListener('click', () =>
      setLang(lang === 'es' ? 'en' : 'es'),
    );
    closeBtn?.addEventListener('click', close);

    document.body.appendChild(panelEl);
    refresh();
    return panelEl;
  }

  function close() {
    closeDrawer();
    panelEl?.remove();
    panelEl = null;
    refs.kpis = refs.cols = refs.drawer = null;
    refs.cargoCards = [];
  }

  function openDeepLink(view) {
    const url = `/crude/index.html#${view}`;
    try {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(url, '_blank', 'noopener');
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      if (typeof window !== 'undefined') window.location.href = url;
    } catch {
      /* noop */
    }
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
    btnEl.id = 'gev-crude-btn';
    btnEl.type = 'button';
    btnEl.innerHTML =
      '<span style="font-size:20px">🛢️</span><span>Crudo</span>';
    btnEl.setAttribute('aria-label', 'Crudo / Crude oil');
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
    exportCsvText: () => cargoesToCsv(store.list()),
    draftCommission: (cargoId) => {
      const cargo = store.byId(cargoId || selectedId);
      if (!cargo) return null;
      let cp = null;
      try {
        cp = cargo.counterpartyId
          ? store.counterpartyById(cargo.counterpartyId)
          : null;
      } catch {
        cp = null;
      }
      return draftCommissionText(cargo, cp || {}, lang, fmtMoney);
    },
    addCounterparty: (data) => {
      const cp = store.addCounterparty(data || {});
      refresh();
      return cp;
    },
    getCounterparties: () => {
      try {
        return store.listCounterparties() || [];
      } catch {
        return [];
      }
    },
    openDrawer,
    closeDrawer,
    openDeepLink,
    refs,
    destroy() {
      aborted.current = true;
      close();
      btnEl?.remove();
      btnEl = null;
    },
  };
  if (typeof window !== 'undefined') window.__gevCrude = api;
  return api;
}
