/**
 * Wholesale Deal Dashboard for GOD'S EYE VIEW — $0, no API keys, no external calls.
 *
 * Mission-control panel for the wholesale real-estate pipeline:
 * KPI row, status pipeline, lead cards, editable detail drawer, deal math
 * (MAO + per-buyer fee ranking), buyer manager, CSV import/export, and a
 * bilingual in-panel draft offer that is NEVER sent anywhere.
 *
 * Pure helpers (parseLeadsCsv, leadsToCsv, csvTemplate, dealMath,
 * scorePillClass, draftOfferText) are exported for unit tests. The live
 * DOM wiring lives in initDealDashboard(). This module intentionally does
 * NOT touch Cesium — the map layer owns the 3D entities.
 */

export const STATUSES = [
  { id: 'new', es: 'Nuevos', en: 'New' },
  { id: 'researching', es: 'Investigando', en: 'Researching' },
  { id: 'analyzed', es: 'Analizados', en: 'Analyzed' },
  { id: 'offer', es: 'Oferta', en: 'Offer' },
  { id: 'contract', es: 'Contrato', en: 'Contract' },
  { id: 'assigned', es: 'Asignados', en: 'Assigned' },
  { id: 'closed', es: 'Cerrados', en: 'Closed' },
  { id: 'dead', es: 'Descartados', en: 'Dead' },
];

const CSV_HEADERS = [
  'address',
  'city',
  'state',
  'zip',
  'score',
  'status',
  'condition',
  'arv',
  'repairs',
  'targetFee',
  'contractPrice',
  'notes',
];

/** Green / yellow / red pill class from a 0–100 score. */
export function scorePillClass(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'gray';
  if (s >= 70) return 'green';
  if (s >= 40) return 'yellow';
  return 'red';
}

const NUM_FIELDS = new Set([
  'score',
  'arv',
  'repairs',
  'targetfee',
  'contractprice',
]);

function cleanRow(row) {
  const lead = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s === '') continue;
    lead[k] = NUM_FIELDS.has(k.toLowerCase()) && s !== '' ? Number(s) : s;
  }
  return lead;
}

/** Parse a CSV string into lead objects. Header row required. */
export function parseLeadsCsv(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const rawHeaders = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  // Map header aliases (any case) back to the canonical camelCase names.
  const headers = rawHeaders.map((h) => {
    const canon = CSV_HEADERS.find((c) => c.toLowerCase() === h);
    return canon || h;
  });
  const leads = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    leads.push(cleanRow(row));
  }
  return leads;
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

/** Serialize leads to CSV. */
export function leadsToCsv(leads) {
  const rows = [CSV_HEADERS.join(',')];
  for (const lead of leads || []) {
    rows.push(CSV_HEADERS.map((h) => csvEscape(lead[h])).join(','));
  }
  return rows.join('\n');
}

/** Downloadable template with one example row. */
export function csvTemplate() {
  return (
    `${CSV_HEADERS.join(',')}\n` +
    `"123 Main St",Houston,TX,77002,82,new,Good,180000,25000,15000,,Owner is motivated`
  );
}

/**
 * Deal math for a lead.
 * MAO = ARV * 0.70 − repairs − targetFee.
 * Per-buyer fee = buyer max offer − contractPrice, ranked best first.
 * Buyer max offer is read from `maxOffer` or `buyBox.maxPrice`
 * (the real wholesale store nests it under buyBox).
 */
export function buyerMaxOffer(buyer = {}) {
  const v = buyer.maxOffer ?? buyer.buyBox?.maxPrice;
  return Number(v) || 0;
}

export function dealMath(lead = {}, buyers = []) {
  const arv = Number(lead.arv) || 0;
  const repairs = Number(lead.repairs) || 0;
  const targetFee = Number(lead.targetFee) || 0;
  const contractPrice = Number(lead.contractPrice) || 0;
  const mao = Math.round(arv * 0.7 - repairs - targetFee);
  const fees = (buyers || [])
    .map((b) => {
      const maxOffer = buyerMaxOffer(b);
      const fee = maxOffer - contractPrice;
      const status =
        fee >= targetFee && targetFee > 0
          ? 'green'
          : fee > 0
            ? 'yellow'
            : 'red';
      return { buyer: b.name || 'Buyer', maxOffer, fee, status };
    })
    .sort((a, b) => b.fee - a.fee);
  return { mao, fees };
}

/**
 * Bilingual draft offer text — a DRAFT for copy/paste only.
 * Never sends anything. First person as "Juan Gonzalez, private investor",
 * with an explicit not-legal-advice line.
 */
export function draftOfferText(
  lead = {},
  buyers = [],
  lang = 'es',
  money = null,
) {
  const fmt =
    typeof money === 'function'
      ? money
      : (n) => `$${Number(n || 0).toLocaleString('en-US')}`;
  const { mao, fees } = dealMath(lead, buyers);
  const best = fees[0];
  const address = lead.address || '—';
  const L = lang === 'es';
  const legalEs =
    'Esto no es asesoría legal. Un abogado con licencia debe revisar el contrato antes de firmar.';
  const legalEn =
    'This is not legal advice. A licensed attorney must review the contract before signing.';
  const bestLine = best
    ? L
      ? `Mejor comprador: ${best.buyer} — honorario estimado ${fmt(best.fee)}.`
      : `Best buyer: ${best.buyer} — estimated fee ${fmt(best.fee)}.`
    : L
      ? 'Sin compradores registrados todavía.'
      : 'No buyers on file yet.';
  if (L) {
    return [
      'BORRADOR DE OFERTA — NO ENVIADO',
      '',
      `Yo, Juan Gonzalez, inversionista privado, presento esta oferta de compra para la propiedad ubicada en ${address}.`,
      '',
      `Precio de oferta propuesto: ${fmt(mao)}`,
      `Valor después de reparar (ARV): ${fmt(lead.arv)}`,
      `Reparaciones estimadas: ${fmt(lead.repairs)}`,
      `Precio de contrato objetivo: ${fmt(lead.contractPrice)}`,
      '',
      bestLine,
      '',
      'Términos: oferta en efectivo, cierre según lo acordado, inspección a satisfacción del comprador.',
      '',
      legalEs,
      '',
      '— Juan Gonzalez, inversionista privado',
    ].join('\n');
  }
  return [
    'DRAFT OFFER — NOT SENT',
    '',
    `I, Juan Gonzalez, private investor, submit this purchase offer for the property located at ${address}.`,
    '',
    `Proposed offer price: ${fmt(mao)}`,
    `After-repair value (ARV): ${fmt(lead.arv)}`,
    `Estimated repairs: ${fmt(lead.repairs)}`,
    `Target contract price: ${fmt(lead.contractPrice)}`,
    '',
    bestLine,
    '',
    'Terms: cash offer, closing as agreed, inspection to buyer satisfaction.',
    '',
    legalEn,
    '',
    '— Juan Gonzalez, private investor',
  ].join('\n');
}

/**
 * Normalize any lead-store-like object to the interface this panel uses.
 * Accepts the real wholesale store (listLeads/getLead/updateLead/
 * createLead/addAgentNote/listBuyers/stats) as well as the minimal
 * in-memory shape (list/byId/update/addMany/notes/addNote/stats).
 * Notes are normalized to { ts, author, textEs, textEn }.
 */
export function adaptStore(raw) {
  if (!raw) return createMemoryLeadStore();
  const byId = (id) => {
    if (typeof raw.byId === 'function') return raw.byId(id);
    if (typeof raw.getLead === 'function') return raw.getLead(id);
    return null;
  };
  return {
    list(status) {
      try {
        if (typeof raw.list === 'function') return raw.list(status) || [];
        if (typeof raw.listLeads === 'function') {
          return raw.listLeads(status ? { status } : undefined) || [];
        }
      } catch {
        /* fall through */
      }
      return [];
    },
    byId,
    update(id, patch) {
      try {
        if (typeof raw.update === 'function') return raw.update(id, patch);
        if (typeof raw.updateLead === 'function')
          return raw.updateLead(id, patch);
      } catch {
        /* noop */
      }
      return null;
    },
    addMany(arr) {
      try {
        if (typeof raw.addMany === 'function') return raw.addMany(arr) || [];
        if (typeof raw.createLead === 'function') {
          return (arr || []).map((l) => raw.createLead(l)).filter(Boolean);
        }
      } catch {
        /* fall through */
      }
      return [];
    },
    notes(id) {
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
        /* fall through to lead.notes */
      }
      try {
        const lead = byId(id);
        return ((lead && lead.notes) || []).map((n) => ({
          ts: n.ts || n.t || Date.now(),
          author: n.author || n.agent || '',
          textEs: n.textEs ?? n.es ?? n.text ?? '',
          textEn: n.textEn ?? n.en ?? n.text ?? '',
        }));
      } catch {
        return [];
      }
    },
    addNote(id, text) {
      try {
        if (typeof raw.addNote === 'function') return raw.addNote(id, text);
        if (typeof raw.addAgentNote === 'function') {
          return raw.addAgentNote(id, 'owner', String(text), String(text));
        }
      } catch {
        /* noop */
      }
      return null;
    },
    stats() {
      try {
        return (
          raw.stats?.() || {
            total: 0,
            avgScore: 0,
            pipelineValue: 0,
            potentialFees: 0,
          }
        );
      } catch {
        return { total: 0, avgScore: 0, pipelineValue: 0, potentialFees: 0 };
      }
    },
    listBuyers() {
      try {
        if (typeof raw.listBuyers === 'function') return raw.listBuyers() || [];
      } catch {
        /* noop */
      }
      return [];
    },
    addBuyerToStore(data) {
      try {
        if (typeof raw.addBuyer === 'function') return raw.addBuyer(data);
      } catch {
        /* noop */
      }
      return null;
    },
  };
}
export function createMemoryLeadStore(seed = []) {
  let seq = 1;
  const leads = new Map();
  const notes = new Map();
  const norm = (l) => ({
    id: l.id || `lead-${seq++}`,
    address: l.address || '',
    city: l.city || '',
    state: l.state || '',
    zip: l.zip || '',
    score: Number(l.score) || 0,
    status: STATUSES.some((s) => s.id === l.status) ? l.status : 'new',
    condition: l.condition || '',
    arv: Number(l.arv) || 0,
    repairs: Number(l.repairs) || 0,
    targetFee: Number(l.targetFee) || 0,
    contractPrice: Number(l.contractPrice) || 0,
    notes: l.notes || '',
  });
  for (const l of seed) {
    const n = norm(l);
    leads.set(n.id, n);
  }
  return {
    list(status) {
      const all = [...leads.values()];
      return status ? all.filter((l) => l.status === status) : all;
    },
    byId(id) {
      return leads.get(id) || null;
    },
    add(lead) {
      const n = norm(lead);
      leads.set(n.id, n);
      return n;
    },
    addMany(arr) {
      return (arr || []).map((l) => this.add(l));
    },
    update(id, patch) {
      const cur = leads.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, id };
      leads.set(id, next);
      return next;
    },
    notes(id) {
      return notes.get(id) || [];
    },
    addNote(id, note) {
      const list = notes.get(id) || [];
      list.push({
        ts: Date.now(),
        author: 'Juan Gonzalez',
        text: String(note || ''),
      });
      notes.set(id, list);
      return list;
    },
    stats() {
      const all = [...leads.values()];
      const total = all.length;
      const avgScore = total
        ? Math.round(
            all.reduce((a, l) => a + (Number(l.score) || 0), 0) / total,
          )
        : 0;
      const pipelineValue = all.reduce((a, l) => a + (Number(l.arv) || 0), 0);
      const potentialFees = all.reduce(
        (a, l) => a + (Number(l.targetFee) || 0),
        0,
      );
      return { total, avgScore, pipelineValue, potentialFees };
    },
  };
}

const WS_CSS = `
#gev-wholesale-btn{display:flex;align-items:center;gap:8px;padding:10px 12px;margin-top:8px;background:rgba(10,14,22,.82);border:1px solid rgba(125,211,252,.28);border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.06em;min-width:172px;max-width:210px}
#gev-wholesale-btn:hover{border-color:rgba(125,211,252,.6)}
#gev-wholesale-panel{position:fixed;z-index:60;right:12px;top:12px;width:min(760px,calc(100vw - 24px));height:min(640px,calc(100vh - 24px));background:rgba(8,11,18,.96);border:1px solid rgba(125,211,252,.3);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7}
#gev-wholesale-panel .wsp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(125,211,252,.18)}
#gev-wholesale-panel .wsp-title{font-size:12px;font-weight:800;letter-spacing:.1em;color:#7dd3fc;flex:1}
#gev-wholesale-panel .wsp-lang{background:none;border:1px solid rgba(125,211,252,.35);color:#7dd3fc;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:800;font-family:inherit}
#gev-wholesale-panel .wsp-close{background:none;border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:14px}
#gev-wholesale-panel .wsp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px 12px;border-bottom:1px solid rgba(125,211,252,.18)}
#gev-wholesale-panel .wsp-kpi{background:rgba(125,211,252,.06);border:1px solid rgba(125,211,252,.15);border-radius:10px;padding:8px 10px}
#gev-wholesale-panel .wsp-kpi .k{font-size:10px;color:#9fb0c9;letter-spacing:.05em}
#gev-wholesale-panel .wsp-kpi .v{font-size:16px;font-weight:800;color:#fff}
#gev-wholesale-panel .wsp-tools{display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid rgba(125,211,252,.18)}
#gev-wholesale-panel .wsp-btn{padding:7px 12px;border-radius:9px;border:1px solid rgba(125,211,252,.35);background:rgba(125,211,252,.1);color:#eaf4ff;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit}
#gev-wholesale-panel .wsp-btn:hover{background:rgba(125,211,252,.2)}
#gev-wholesale-panel .wsp-cols{flex:1;display:flex;gap:8px;overflow-x:auto;padding:10px 12px;min-height:0}
#gev-wholesale-panel .wsp-col{min-width:170px;flex:1;background:rgba(255,255,255,.02);border:1px solid rgba(125,211,252,.12);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
#gev-wholesale-panel .wsp-colhead{font-size:10px;font-weight:800;letter-spacing:.08em;color:#7dd3fc;padding:8px 10px;border-bottom:1px solid rgba(125,211,252,.12);text-transform:uppercase}
#gev-wholesale-panel .wsp-cards{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px}
#gev-wholesale-panel .wsp-card{background:rgba(10,14,22,.85);border:1px solid rgba(125,211,252,.2);border-radius:10px;padding:8px 10px;cursor:pointer;font-size:11px}
#gev-wholesale-panel .wsp-card:hover{border-color:rgba(125,211,252,.5)}
#gev-wholesale-panel .wsp-card .addr{font-weight:700;color:#fff;margin-bottom:4px}
#gev-wholesale-panel .wsp-card .meta{display:flex;align-items:center;gap:6px;color:#9fb0c9}
#gev-wholesale-panel .pill{font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px}
#gev-wholesale-panel .pill.green{background:rgba(52,211,153,.18);color:#34d399;border:1px solid rgba(52,211,153,.4)}
#gev-wholesale-panel .pill.yellow{background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.4)}
#gev-wholesale-panel .pill.red{background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.4)}
#gev-wholesale-panel .pill.gray{background:rgba(148,163,184,.15);color:#94a3b8;border:1px solid rgba(148,163,184,.4)}
#gev-wholesale-panel .wsp-empty{font-size:11px;color:#5b6b82;padding:12px;text-align:center}
#gev-wholesale-drawer{position:absolute;top:0;right:0;bottom:0;width:min(340px,90%);background:rgba(10,14,22,.98);border-left:1px solid rgba(125,211,252,.3);padding:14px;overflow-y:auto;font-size:12px}
#gev-wholesale-drawer h3{margin:0 0 4px;font-size:14px;color:#fff}
#gev-wholesale-drawer .dsub{font-size:11px;color:#9fb0c9;margin-bottom:10px}
#gev-wholesale-drawer label{display:block;font-size:10px;color:#9fb0c9;margin:8px 0 3px;letter-spacing:.05em}
#gev-wholesale-drawer input,#gev-wholesale-drawer select,#gev-wholesale-drawer textarea{width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(125,211,252,.25);border-radius:8px;color:#fff;padding:7px 9px;font-size:12px;font-family:inherit}
#gev-wholesale-drawer .math{background:rgba(125,211,252,.06);border:1px solid rgba(125,211,252,.2);border-radius:10px;padding:10px;margin-top:10px}
#gev-wholesale-drawer .math .mrow{display:flex;justify-content:space-between;margin:3px 0}
#gev-wholesale-drawer .math .mrow b{color:#fff}
#gev-wholesale-drawer .buyerfee{display:flex;justify-content:space-between;align-items:center;font-size:11px;margin:4px 0;gap:6px}
#gev-wholesale-drawer .note{border-left:2px solid rgba(125,211,252,.4);padding:4px 8px;margin:6px 0;font-size:11px;color:#c8d4e4}
#gev-wholesale-drawer .note .nts{font-size:10px;color:#5b6b82}
#gev-wholesale-drawer pre.draft{white-space:pre-wrap;background:rgba(255,255,255,.04);border:1px solid rgba(255,209,102,.35);border-radius:10px;padding:10px;font-size:11px;color:#f3e9cf;font-family:inherit}
#gev-wholesale-buyers{padding:10px 12px;border-top:1px solid rgba(125,211,252,.18);font-size:11px;max-height:150px;overflow-y:auto}
#gev-wholesale-buyers .brow{display:flex;justify-content:space-between;gap:8px;padding:3px 0;color:#c8d4e4}
#gev-wholesale-buyers .bform{display:flex;gap:6px;margin-top:6px}
#gev-wholesale-buyers input{background:rgba(255,255,255,.05);border:1px solid rgba(125,211,252,.25);border-radius:8px;color:#fff;padding:6px 8px;font-size:11px;font-family:inherit;flex:1;min-width:0}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-wholesale-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-wholesale-styles';
  style.textContent = WS_CSS;
  document.head.appendChild(style);
}

function defaultMoney(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US')}`;
}

/**
 * Live controller: dock button + floating wholesale mission-control panel.
 * options: { leadStore, dealEngine, leadMap, workforce, signal, parseCsv }
 * leadStore may be the real wholesale store (listLeads/getLead/updateLead/
 * createLead/addAgentNote/listBuyers/stats) or the minimal in-memory shape —
 * adaptStore() normalizes either. Buyers seed from store.listBuyers().
 */
export function initDealDashboard({
  leadStore = null,
  dealEngine = null,
  leadMap = null,
  workforce = null,
  signal = null,
  parseCsv = parseLeadsCsv,
} = {}) {
  injectStyles();
  const store = adaptStore(leadStore);
  const fmtMoney =
    typeof dealEngine?.formatMoney === 'function'
      ? dealEngine.formatMoney
      : defaultMoney;
  // Seed buyers from the real store when available (buyBox.maxPrice shape),
  // normalized to the panel's { name, maxOffer } working shape.
  let buyers = [];
  try {
    const fromStore = store.listBuyers();
    if (fromStore.length) {
      buyers = fromStore.map((b) => ({
        name: b.name || '—',
        maxOffer: buyerMaxOffer(b),
      }));
    } else if (Array.isArray(dealEngine?.listBuyers?.())) {
      buyers = dealEngine
        .listBuyers()
        .map((b) => ({ name: b.name || '—', maxOffer: buyerMaxOffer(b) }));
    }
  } catch {
    buyers = [];
  }
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
  const t = (es, en) => (lang === 'es' ? es : en);
  const refs = {
    kpis: null,
    cols: null,
    importBtn: null,
    exportBtn: null,
    templateBtn: null,
    leadCards: [],
    agentRows: [],
    draftBtn: null,
    drawer: null,
  };

  function statusLabel(id) {
    const s = STATUSES.find((x) => x.id === id);
    return s ? t(s.es, s.en) : id;
  }

  function renderKpis() {
    if (!refs.kpis) return;
    let stats = { total: 0, avgScore: 0, pipelineValue: 0, potentialFees: 0 };
    try {
      stats = store.stats() || stats;
    } catch {
      /* keep defaults */
    }
    refs.kpis.innerHTML = `
      <div class="wsp-kpi"><div class="k">${t('LEADS', 'LEADS')}</div><div class="v">${stats.total}</div></div>
      <div class="wsp-kpi"><div class="k">${t('PUNTAJE PROM.', 'AVG SCORE')}</div><div class="v">${stats.avgScore}</div></div>
      <div class="wsp-kpi"><div class="k">${t('VALOR PIPELINE', 'PIPELINE VALUE')}</div><div class="v">${fmtMoney(stats.pipelineValue)}</div></div>
      <div class="wsp-kpi"><div class="k">${t('HONORARIOS POT.', 'POTENTIAL FEES')}</div><div class="v">${fmtMoney(stats.potentialFees)}</div></div>
    `;
  }

  function renderColumns() {
    if (!refs.cols) return;
    refs.cols.innerHTML = '';
    refs.leadCards = [];
    for (const st of STATUSES) {
      const col = document.createElement('div');
      col.className = 'wsp-col';
      col.dataset.status = st.id;
      const head = document.createElement('div');
      head.className = 'wsp-colhead';
      const cards = document.createElement('div');
      cards.className = 'wsp-cards';
      let leads = [];
      try {
        leads = store.list(st.id) || [];
      } catch {
        leads = [];
      }
      head.textContent = `${t(st.es, st.en)} (${leads.length})`;
      if (!leads.length) {
        const empty = document.createElement('div');
        empty.className = 'wsp-empty';
        empty.textContent = '—';
        cards.appendChild(empty);
      }
      for (const lead of leads) {
        const card = document.createElement('div');
        card.className = 'wsp-card';
        card.dataset.leadId = lead.id;
        const addr = document.createElement('div');
        addr.className = 'addr';
        addr.textContent = lead.address || t('(sin dirección)', '(no address)');
        const meta = document.createElement('div');
        meta.className = 'meta';
        const pill = document.createElement('span');
        pill.className = `pill ${scorePillClass(lead.score)}`;
        pill.textContent = lead.score;
        const cond = document.createElement('span');
        cond.textContent = lead.condition || '';
        meta.appendChild(pill);
        meta.appendChild(cond);
        card.appendChild(addr);
        card.appendChild(meta);
        card.addEventListener('click', () => openDrawer(lead.id));
        cards.appendChild(card);
        refs.leadCards.push(card);
      }
      col.appendChild(head);
      col.appendChild(cards);
      refs.cols.appendChild(col);
    }
  }

  function renderBuyers() {
    const box = panelEl?.querySelector('#gev-wholesale-buyers');
    if (!box) return;
    box.innerHTML = '';
    const title = document.createElement('div');
    title.style.cssText =
      'font-weight:800;color:#7dd3fc;letter-spacing:.08em;font-size:10px;margin-bottom:6px';
    title.textContent = t('COMPRADORES EN EFECTIVO', 'CASH BUYERS');
    box.appendChild(title);
    const list = document.createElement('div');
    for (const b of buyers) {
      const row = document.createElement('div');
      row.className = 'brow';
      const nm = document.createElement('span');
      nm.textContent = b.name || '—';
      const off = document.createElement('span');
      off.textContent = fmtMoney(b.maxOffer);
      row.appendChild(nm);
      row.appendChild(off);
      list.appendChild(row);
    }
    if (!buyers.length) {
      const empty = document.createElement('div');
      empty.className = 'wsp-empty';
      empty.textContent = t(
        'Agrega tu primer comprador abajo.',
        'Add your first buyer below.',
      );
      list.appendChild(empty);
    }
    box.appendChild(list);
    const form = document.createElement('div');
    form.className = 'bform';
    const nameIn = document.createElement('input');
    nameIn.placeholder = t('Nombre del comprador', 'Buyer name');
    const offerIn = document.createElement('input');
    offerIn.placeholder = t('Oferta máx ($)', 'Max offer ($)');
    offerIn.inputMode = 'numeric';
    const addBtn = document.createElement('button');
    addBtn.className = 'wsp-btn';
    addBtn.type = 'button';
    addBtn.textContent = t('Agregar', 'Add');
    addBtn.addEventListener('click', () => {
      const name = nameIn.value.trim();
      const maxOffer = Number(offerIn.value);
      if (!name || !Number.isFinite(maxOffer)) return;
      buyers.push({ name, maxOffer });
      // Persist to the real store too when it supports buyers.
      store.addBuyerToStore({ name, buyBox: { maxPrice: maxOffer } });
      nameIn.value = '';
      offerIn.value = '';
      renderBuyers();
      if (selectedId) renderDrawerBody();
    });
    form.appendChild(nameIn);
    form.appendChild(offerIn);
    form.appendChild(addBtn);
    box.appendChild(form);
    refs.buyerNameInput = nameIn;
    refs.buyerOfferInput = offerIn;
    refs.buyerAddBtn = addBtn;
  }

  function renderDrawerBody() {
    const drawer = refs.drawer;
    if (!drawer) return;
    const lead = store.byId(selectedId);
    if (!lead) {
      drawer.innerHTML = '';
      return;
    }
    const { mao, fees } = dealMath(lead, buyers);
    drawer.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = lead.address || t('(sin dirección)', '(no address)');
    const sub = document.createElement('div');
    sub.className = 'dsub';
    sub.textContent = [lead.city, lead.state, lead.zip]
      .filter(Boolean)
      .join(', ');
    drawer.appendChild(h);
    drawer.appendChild(sub);

    const fieldDefs = [
      ['status', t('Estado', 'Status'), 'select'],
      ['arv', 'ARV ($)', 'number'],
      ['repairs', t('Reparaciones ($)', 'Repairs ($)'), 'number'],
      ['targetFee', t('Honorario objetivo ($)', 'Target fee ($)'), 'number'],
      [
        'contractPrice',
        t('Precio de contrato ($)', 'Contract price ($)'),
        'number',
      ],
    ];
    for (const [key, label, kind] of fieldDefs) {
      const lab = document.createElement('label');
      lab.textContent = label;
      drawer.appendChild(lab);
      let input;
      if (kind === 'select') {
        input = document.createElement('select');
        for (const st of STATUSES) {
          const opt = document.createElement('option');
          opt.value = st.id;
          opt.textContent = t(st.es, st.en);
          if (lead.status === st.id) opt.selected = true;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.type = 'number';
        input.value = lead[key] ?? '';
      }
      input.dataset.field = key;
      input.addEventListener('change', () => {
        const patch = {};
        patch[key] = kind === 'select' ? input.value : Number(input.value) || 0;
        store.update(lead.id, patch);
        refresh();
        renderDrawerBody();
      });
      drawer.appendChild(input);
    }

    const math = document.createElement('div');
    math.className = 'math';
    const mTitle = document.createElement('div');
    mTitle.style.cssText =
      'font-size:10px;font-weight:800;letter-spacing:.08em;color:#7dd3fc;margin-bottom:6px';
    mTitle.textContent = t('NÚMEROS DEL NEGOCIO', 'DEAL MATH');
    math.appendChild(mTitle);
    const maoRow = document.createElement('div');
    maoRow.className = 'mrow';
    const maoLab = document.createElement('span');
    maoLab.textContent = 'MAO (70% − rep − fee)';
    const maoVal = document.createElement('b');
    maoVal.textContent = fmtMoney(mao);
    maoRow.appendChild(maoLab);
    maoRow.appendChild(maoVal);
    math.appendChild(maoRow);
    for (const f of fees) {
      const row = document.createElement('div');
      row.className = 'buyerfee';
      const nm = document.createElement('span');
      nm.textContent = f.buyer;
      const fv = document.createElement('span');
      fv.className = `pill ${f.status}`;
      fv.textContent = fmtMoney(f.fee);
      row.appendChild(nm);
      row.appendChild(fv);
      math.appendChild(row);
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
      ns = store.notes(lead.id) || [];
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
    noteBtn.className = 'wsp-btn';
    noteBtn.type = 'button';
    noteBtn.style.marginTop = '6px';
    noteBtn.textContent = t('Guardar nota', 'Save note');
    noteBtn.addEventListener('click', () => {
      const v = noteIn.value.trim();
      if (!v) return;
      store.addNote(lead.id, v);
      renderDrawerBody();
    });
    drawer.appendChild(noteIn);
    drawer.appendChild(noteBtn);
    refs.noteInput = noteIn;
    refs.noteBtn = noteBtn;

    const draftBtn = document.createElement('button');
    draftBtn.className = 'wsp-btn';
    draftBtn.type = 'button';
    draftBtn.style.cssText =
      'margin-top:12px;width:100%;border-color:rgba(255,209,102,.45);color:#ffd166;background:rgba(255,209,102,.08)';
    draftBtn.textContent = t(
      '📝 Generar contrato / Draft offer',
      '📝 Generar contrato / Draft offer',
    );
    draftBtn.addEventListener('click', () => {
      const pre = document.createElement('pre');
      pre.className = 'draft';
      pre.textContent = draftOfferText(lead, buyers, lang, fmtMoney);
      const old = drawer.querySelector('pre.draft');
      old?.remove();
      drawer.appendChild(pre);
      refs.draftPre = pre;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'wsp-btn';
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
    closeBtn.className = 'wsp-btn';
    closeBtn.type = 'button';
    closeBtn.style.cssText = 'margin-top:8px;width:100%';
    closeBtn.textContent = t('Cerrar', 'Close');
    closeBtn.addEventListener('click', closeDrawer);
    drawer.appendChild(closeBtn);
  }

  function openDrawer(id) {
    selectedId = id;
    if (!panelEl) return;
    let drawer = panelEl.querySelector('#gev-wholesale-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'gev-wholesale-drawer';
      panelEl.appendChild(drawer);
    }
    refs.drawer = drawer;
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
    renderBuyers();
    if (selectedId) renderDrawerBody();
  }

  function importCsvText(text) {
    let parsed = [];
    try {
      parsed = parseCsv(text) || [];
    } catch {
      parsed = [];
    }
    const added = store.addMany(parsed);
    refresh();
    return added;
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
    panelEl.id = 'gev-wholesale-panel';
    panelEl.innerHTML = `
      <div class="wsp-head">
        <div class="wsp-title">WHOLESALE · MISSION CONTROL</div>
        <button class="wsp-lang" type="button">ES / EN</button>
        <button class="wsp-close" type="button" aria-label="Cerrar / close">✕</button>
      </div>
      <div class="wsp-kpis"></div>
      <div class="wsp-tools">
        <button class="wsp-btn wsp-import" type="button">📥 ${t('Importar CSV / Import CSV', 'Importar CSV / Import CSV')}</button>
        <button class="wsp-btn wsp-template" type="button">📄 ${t('Descargar plantilla / Download template', 'Descargar plantilla / Download template')}</button>
        <button class="wsp-btn wsp-export" type="button">📤 ${t('Exportar CSV / Export CSV', 'Exportar CSV / Export CSV')}</button>
      </div>
      <div class="wsp-cols"></div>
      <div id="gev-wholesale-buyers"></div>
    `;
    refs.kpis = panelEl.querySelector('.wsp-kpis');
    refs.cols = panelEl.querySelector('.wsp-cols');
    refs.importBtn = panelEl.querySelector('.wsp-import');
    refs.templateBtn = panelEl.querySelector('.wsp-template');
    refs.exportBtn = panelEl.querySelector('.wsp-export');
    const langBtn = panelEl.querySelector('.wsp-lang');
    const closeBtn = panelEl.querySelector('.wsp-close');

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
      downloadFile('wholesale-template.csv', csvTemplate(), 'text/csv'),
    );
    refs.exportBtn?.addEventListener('click', () =>
      downloadFile('wholesale-leads.csv', leadsToCsv(store.list()), 'text/csv'),
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
    refs.leadCards = [];
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'es';
    if (!panelEl) return lang;
    // Rebuild the static chrome in the new language.
    const keepSelected = selectedId;
    panelEl.remove();
    panelEl = null;
    open();
    if (keepSelected) openDrawer(keepSelected);
    return lang;
  }

  if (typeof document !== 'undefined') {
    btnEl = document.createElement('button');
    btnEl.id = 'gev-wholesale-btn';
    btnEl.type = 'button';
    btnEl.innerHTML =
      '<span style="font-size:20px">🏠</span><span>Wholesale</span>';
    btnEl.setAttribute('aria-label', 'Wholesale / Venta al por mayor');
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
    exportCsvText: () => leadsToCsv(store.list()),
    draftOffer: (leadId) => {
      const lead = store.byId(leadId || selectedId);
      if (!lead) return null;
      return draftOfferText(lead, buyers, lang, fmtMoney);
    },
    getBuyers: () => [...buyers],
    addBuyer: (name, maxOffer) => {
      const m = Number(maxOffer) || 0;
      buyers.push({ name, maxOffer: m });
      store.addBuyerToStore({ name, buyBox: { maxPrice: m } });
      renderBuyers();
      return buyers.length;
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
  if (typeof window !== 'undefined') window.__gevWholesale = api;
  return api;
}
