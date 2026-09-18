// Cuba car market A–Z dashboard for GOD'S EYE VIEW — $0, no API keys, no
// external calls. Mission-control panel: buyer qualification funnel, Rosmel
// gestor draft queue (drafts only), competition price panel, deal pipeline.
//
// Phone-first: 44px touch targets, 16px inputs, ES-first bilingual, nothing
// hover-only. No Cesium. Buyer-facing surfaces only — this panel NEVER
// renders internal economics. The economics in carEngine.js are for Juan's
// internal decision support and are never called from this module.
//
// Broker disclosure: SAHJONY is a fee broker for Cuba cars — never the end
// buyer, never holds inventory/title/money. Rendered on every draft surface.

import {
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  DEAL_STATUSES,
  DEAL_STATUS_LABELS,
  DRAFT_STATE_LABELS,
  BROKER_DISCLOSURE,
} from './carStore.js';
import {
  pricePosition,
  PRICE_POSITION_LABELS,
  summarizeModelPricing,
  scoreLead,
  qualificationVerdict,
} from './carEngine.js';

export const SECTIONS = Object.freeze(['funnel', 'drafts', 'prices', 'deals']);

/** Pill color class for a lead stage. */
export function leadStagePillClass(stage) {
  switch (stage) {
    case 'nuevo':
      return 'gray';
    case 'contactado':
      return 'blue';
    case 'calificado':
      return 'green';
    case 'oferta':
      return 'yellow';
    case 'cierre':
      return 'green';
    case 'descartado':
      return 'red';
    default:
      return 'gray';
  }
}

/** Pill color class for a deal status. */
export function dealStatusPillClass(status) {
  switch (status) {
    case 'abierto':
      return 'gray';
    case 'activo':
      return 'blue';
    case 'firmado':
      return 'yellow';
    case 'cerrado':
      return 'green';
    case 'caido':
      return 'red';
    default:
      return 'gray';
  }
}

/** Pill color class for a draft approve-state. */
export function draftStatePillClass(state) {
  switch (state) {
    case 'draft':
      return 'yellow';
    case 'approved':
      return 'green';
    case 'discarded':
      return 'red';
    default:
      return 'gray';
  }
}

/** Pill color class for a price position (our price vs competitor). */
export function positionPillClass(position) {
  switch (position) {
    case 'under':
      return 'green';
    case 'over':
      return 'red';
    case 'equal':
      return 'yellow';
    default:
      return 'gray';
  }
}

/** Count leads per funnel stage: { stage, count, label }. */
export function funnelCounts(leads = []) {
  return LEAD_STAGES.map((stage) => ({
    stage,
    count: leads.filter((l) => (l?.stage || 'nuevo') === stage).length,
  }));
}

/** Group deals by status. */
export function groupDealsByStatus(deals = []) {
  const groups = {};
  for (const status of DEAL_STATUSES) groups[status] = [];
  for (const deal of deals || []) {
    const status = DEAL_STATUSES.includes(deal?.status)
      ? deal.status
      : 'abierto';
    groups[status].push(deal);
  }
  return groups;
}

/** Undercut indicator text: "+$1,200" (they are higher) etc. */
export function positionIndicator(position, diff) {
  if (position === 'unknown') return '—';
  const sign = diff > 0 ? '+' : '';
  return `${sign}$${Math.abs(diff).toLocaleString('en-US')}`;
}

/**
 * Build a WhatsApp-ready Rosmel draft (Spanish-first). Buyer price and broker
 * disclosure only — never margins, floors, or supplier names.
 */
export function draftRosmelWhatsapp({ leadName, model, price, lang = 'es' } = {}) {
  const L = lang === 'es';
  const name = (leadName || '').trim();
  const modelText = (model || '').trim() || (L ? '(modelo por confirmar)' : '(model to confirm)');
  const priceText =
    price != null && Number(price) > 0
      ? `$${Number(price).toLocaleString('en-US')}`
      : L
        ? '(precio por confirmar)'
        : '(price to confirm)';
  if (L) {
    return (
      `Hola Rosmel, te paso un comprador interesado:\n` +
      `- Comprador: ${name || '(nombre por confirmar)'}\n` +
      `- Modelo: ${modelText}\n` +
      `- Precio al comprador: ${priceText}\n\n` +
      `${BROKER_DISCLOSURE.es}\n\n` +
      `Borrador — no enviar sin la aprobación de Juan.`
    );
  }
  return (
    `Hi Rosmel, passing you an interested buyer:\n` +
    `- Buyer: ${name || '(name to confirm)'}\n` +
    `- Model: ${modelText}\n` +
    `- Buyer price: ${priceText}\n\n` +
    `${BROKER_DISCLOSURE.en}\n\n` +
    `Draft — do not send without Juan's approval.`
  );
}

/**
 * Normalize any cars-like store to the interface this dashboard uses.
 * Accepts the real car store exports or a minimal in-memory double.
 */
export function adaptStore(raw) {
  const s = raw || {};
  const must = (name, fallback) =>
    typeof s[name] === 'function' ? s[name].bind(s) : fallback;
  return {
    listLeads: must('listLeads', () => []),
    createLead: must('createLead', () => null),
    getLead: must('getLead', () => null),
    updateLead: must('updateLead', () => null),
    moveLead: must('moveLead', () => null),
    deleteLead: must('deleteLead', () => false),
    addLeadNote: must('addLeadNote', () => null),
    listDeals: must('listDeals', () => []),
    createDeal: must('createDeal', () => null),
    getDeal: must('getDeal', () => null),
    moveDeal: must('moveDeal', () => null),
    deleteDeal: must('deleteDeal', () => false),
    listDrafts: must('listDrafts', () => []),
    createDraft: must('createDraft', () => null),
    updateDraft: must('updateDraft', () => null),
    setDraftState: must('setDraftState', () => null),
    deleteDraft: must('deleteDraft', () => false),
    addSnapshot: must('addSnapshot', () => null),
    listSnapshots: must('listSnapshots', () => []),
    deleteSnapshot: must('deleteSnapshot', () => false),
    getOurPrices: must('getOurPrices', () => ({})),
    setOurPrice: must('setOurPrice', () => null),
    getReferencePrices: must('getReferencePrices', () => []),
    stats: must('stats', () => ({
      totalLeads: 0,
      byStage: {},
      totalDeals: 0,
      byStatus: {},
      totalDrafts: 0,
      byDraftState: {},
      pendingDrafts: 0,
      totalSnapshots: 0,
      modelsTracked: 0,
    })),
  };
}

/** In-memory store double for tests. */
export function createMemoryCarStore() {
  const leads = [];
  const deals = [];
  const drafts = [];
  const snapshots = [];
  const ourPrices = {};
  let n = 0;
  const id = () => `test-${(n += 1)}`;
  return {
    listLeads: (f) => (!f ? [...leads] : leads.filter((l) => l.stage === f.stage)),
    createLead: (d) => {
      const lead = { id: id(), stage: 'nuevo', notes: [], agentNotes: [], ...(d || {}) };
      leads.push(lead);
      return lead;
    },
    getLead: (i) => leads.find((l) => l.id === i) ?? null,
    updateLead: (i, p) => {
      const l = leads.find((x) => x.id === i);
      return l ? Object.assign(l, p) : null;
    },
    moveLead: (i, s) => {
      const l = leads.find((x) => x.id === i);
      return l ? ((l.stage = s), l) : null;
    },
    deleteLead: (i) => {
      const k = leads.findIndex((x) => x.id === i);
      if (k < 0) return false;
      leads.splice(k, 1);
      return true;
    },
    addLeadNote: (i, text) => {
      const l = leads.find((x) => x.id === i);
      if (!l) return null;
      const note = { at: '2026-09-17', text };
      l.notes.push(note);
      return note;
    },
    listDeals: () => [...deals],
    createDeal: (d) => {
      const deal = { id: id(), status: 'abierto', notes: [], agentNotes: [], ...(d || {}) };
      deals.push(deal);
      return deal;
    },
    getDeal: (i) => deals.find((d) => d.id === i) ?? null,
    moveDeal: (i, s) => {
      const d = deals.find((x) => x.id === i);
      return d ? ((d.status = s), d) : null;
    },
    deleteDeal: (i) => {
      const k = deals.findIndex((x) => x.id === i);
      if (k < 0) return false;
      deals.splice(k, 1);
      return true;
    },
    listDrafts: (f) => (!f ? [...drafts] : drafts.filter((d) => d.state === f.state)),
    createDraft: (d) => {
      const draft = { id: id(), state: 'draft', ...(d || {}) };
      drafts.push(draft);
      return draft;
    },
    updateDraft: (i, p) => {
      const d = drafts.find((x) => x.id === i);
      return d ? Object.assign(d, p) : null;
    },
    setDraftState: (i, st) => {
      const d = drafts.find((x) => x.id === i);
      return d ? ((d.state = st), d) : null;
    },
    deleteDraft: (i) => {
      const k = drafts.findIndex((x) => x.id === i);
      if (k < 0) return false;
      drafts.splice(k, 1);
      return true;
    },
    addSnapshot: (d) => {
      const s = { id: id(), ...(d || {}) };
      snapshots.push(s);
      return s;
    },
    listSnapshots: () => [...snapshots],
    deleteSnapshot: (i) => {
      const k = snapshots.findIndex((x) => x.id === i);
      if (k < 0) return false;
      snapshots.splice(k, 1);
      return true;
    },
    getOurPrices: () => ({ ...ourPrices }),
    setOurPrice: (m, p) => {
      if (p == null) delete ourPrices[m];
      else ourPrices[m] = p;
      return { ...ourPrices };
    },
    getReferencePrices: () => [],
    stats: () => ({
      totalLeads: leads.length,
      byStage: Object.fromEntries(funnelCounts(leads).map((f) => [f.stage, f.count])),
      totalDeals: deals.length,
      byStatus: {},
      totalDrafts: drafts.length,
      byDraftState: {},
      pendingDrafts: drafts.filter((d) => d.state === 'draft').length,
      totalSnapshots: snapshots.length,
      modelsTracked: new Set(snapshots.map((s) => s.model)).size,
    }),
  };
}

const CARS_CSS = `
#gev-cars-btn{display:flex;align-items:center;gap:8px;padding:12px;margin-top:8px;background:rgba(10,14,22,.85);border:1px solid rgba(56,189,248,.35);border-radius:14px;color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:13px;font-weight:700;letter-spacing:.04em;min-height:44px}
#gev-cars-panel{position:fixed;z-index:60;right:12px;top:12px;width:min(920px,calc(100vw - 24px));height:min(700px,calc(100vh - 24px));background:rgba(8,11,18,.97);border:1px solid rgba(56,189,248,.35);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7}
#gev-cars-panel .cd-head{display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid rgba(56,189,248,.2)}
#gev-cars-panel .cd-title{font-size:13px;font-weight:800;letter-spacing:.08em;color:#38bdf8;flex:1}
#gev-cars-panel .cd-lang{min-height:44px;min-width:64px;border-radius:12px;border:2px solid rgba(56,189,248,.45);background:#0c2a3d;color:#f1f5f9;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit}
#gev-cars-panel .cd-close{min-height:44px;min-width:44px;border-radius:12px;border:2px solid rgba(255,255,255,.2);background:#1e293b;color:#fff;font-size:18px;cursor:pointer;font-family:inherit}
#gev-cars-panel .cd-nav{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(56,189,248,.18);overflow-x:auto}
#gev-cars-panel .cd-navbtn{min-height:44px;padding:0 16px;border-radius:12px;border:2px solid #334155;background:#1e293b;color:#f1f5f9;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap}
#gev-cars-panel .cd-navbtn.on{border-color:#38bdf8;background:#0c2a3d}
#gev-cars-panel .cd-body{flex:1;overflow-y:auto;padding:12px;min-height:0}
#gev-cars-panel .cd-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px}
#gev-cars-panel .cd-kpi{background:rgba(56,189,248,.06);border:1px solid rgba(56,189,248,.15);border-radius:12px;padding:10px 12px}
#gev-cars-panel .cd-kpi .k{font-size:11px;color:#9fb0c9;letter-spacing:.05em}
#gev-cars-panel .cd-kpi .v{font-size:20px;font-weight:800;color:#fff}
#gev-cars-panel .cd-sec-title{font-size:12px;font-weight:800;letter-spacing:.08em;color:#38bdf8;margin:14px 0 8px;text-transform:uppercase}
#gev-cars-panel .cd-funnel{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
#gev-cars-panel .cd-stage{min-width:120px;flex:1;background:rgba(255,255,255,.02);border:1px solid rgba(56,189,248,.15);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
#gev-cars-panel .cd-stagehead{font-size:11px;font-weight:800;color:#38bdf8;padding:8px;text-align:center;border-bottom:1px solid rgba(56,189,248,.12);text-transform:uppercase;letter-spacing:.05em}
#gev-cars-panel .cd-cards{display:flex;flex-direction:column;gap:8px;padding:8px}
#gev-cars-panel .cd-card{background:rgba(10,14,22,.9);border:1px solid rgba(56,189,248,.25);border-radius:12px;padding:10px;cursor:pointer}
#gev-cars-panel .cd-card .cname{font-weight:800;color:#fff;font-size:15px}
#gev-cars-panel .cd-card .cmeta{font-size:13px;color:#9fb0c9;margin-top:4px}
#gev-cars-panel .pill{display:inline-block;font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px;margin-top:6px}
#gev-cars-panel .pill.green{background:rgba(52,211,153,.18);color:#34d399;border:1px solid rgba(52,211,153,.4)}
#gev-cars-panel .pill.yellow{background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.4)}
#gev-cars-panel .pill.red{background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.4)}
#gev-cars-panel .pill.gray{background:rgba(148,163,184,.15);color:#94a3b8;border:1px solid rgba(148,163,184,.4)}
#gev-cars-panel .pill.blue{background:rgba(56,189,248,.15);color:#38bdf8;border:1px solid rgba(56,189,248,.4)}
#gev-cars-panel .cd-empty{font-size:13px;color:#5b6b82;padding:12px;text-align:center}
#gev-cars-panel label{display:block;font-size:12px;color:#9fb0c9;margin:10px 0 4px;letter-spacing:.03em}
#gev-cars-panel input,#gev-cars-panel select,#gev-cars-panel textarea{width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(56,189,248,.35);border-radius:10px;color:#fff;padding:12px;font-size:16px;font-family:inherit;min-height:44px}
#gev-cars-panel .cd-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 18px;border-radius:12px;border:2px solid rgba(56,189,248,.5);background:rgba(56,189,248,.12);color:#e0f2fe;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;margin-top:10px}
#gev-cars-panel .cd-btn:active{background:rgba(56,189,248,.25)}
#gev-cars-panel .cd-btn.warn{border-color:rgba(248,113,113,.5);background:rgba(248,113,113,.1);color:#fecaca}
#gev-cars-panel .cd-btn.ghost{border-color:#334155;background:#1e293b;color:#f1f5f9}
#gev-cars-panel .cd-disclosure{background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.35);border-radius:12px;padding:10px 12px;font-size:12px;color:#fde68a;line-height:1.5;margin:12px 0}
#gev-cars-panel table.cd-table{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px}
#gev-cars-panel table.cd-table th{text-align:left;font-size:11px;color:#9fb0c9;letter-spacing:.05em;padding:8px;border-bottom:1px solid rgba(56,189,248,.25);text-transform:uppercase}
#gev-cars-panel table.cd-table td{padding:10px 8px;border-bottom:1px solid rgba(56,189,248,.1);color:#e2e8f0;vertical-align:top}
#gev-cars-panel table.cd-table a{color:#38bdf8}
#gev-cars-panel pre.draft{white-space:pre-wrap;background:rgba(255,255,255,.04);border:1px solid rgba(251,191,36,.4);border-radius:12px;padding:12px;font-size:14px;color:#f3e9cf;font-family:inherit;line-height:1.5}
#gev-cars-panel .cd-drawer{position:absolute;top:0;right:0;bottom:0;width:min(380px,94%);background:rgba(10,14,22,.99);border-left:1px solid rgba(56,189,248,.4);padding:14px;overflow-y:auto}
#gev-cars-panel .cd-drawer h3{margin:0 0 4px;font-size:18px;color:#fff}
#gev-cars-panel .cd-drawer .dsub{font-size:13px;color:#9fb0c9;margin-bottom:10px}
#gev-cars-panel .note{border-left:2px solid rgba(56,189,248,.5);padding:6px 10px;margin:8px 0;font-size:13px;color:#c8d4e4}
#gev-cars-panel .note .nts{font-size:11px;color:#5b6b82}
#gev-cars-panel .cd-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-cars-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-cars-styles';
  style.textContent = CARS_CSS;
  document.head.appendChild(style);
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/**
 * Live controller: dock button + floating car mission-control panel.
 * options: { carStore, carEngine, workforce, signal, parseCsv }
 * carStore may be the real store or the minimal in-memory shape — adaptStore()
 * normalizes either.
 */
export function initCarDashboard({
  carStore = null,
  carEngine = null,
  workforce = null,
  signal = null,
  parseCsv = null,
} = {}) {
  injectStyles();
  const store = adaptStore(carStore);
  const aborted = { current: false };
  signal?.addEventListener?.(
    'abort',
    () => {
      aborted.current = true;
    },
    { once: true },
  );

  let lang = 'es';
  let section = 'funnel';
  let panelEl = null;
  let bodyEl = null;
  let drawerLeadId = null;
  let drawerDealId = null;
  const t = (es, en) => (lang === 'es' ? es : en);

  function stageLabel(stage) {
    const l = LEAD_STAGE_LABELS[stage];
    return l ? t(l.es, l.en) : stage;
  }

  function dealLabel(status) {
    const l = DEAL_STATUS_LABELS[status];
    return l ? t(l.es, l.en) : status;
  }

  function draftLabel(state) {
    const l = DRAFT_STATE_LABELS[state];
    return l ? t(l.es, l.en) : state;
  }

  function posLabel(pos) {
    const l = PRICE_POSITION_LABELS[pos];
    return l ? t(l.es, l.en) : pos;
  }

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = 'gev-cars-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', t('Mercado de carros Cuba', 'Cuba car market'));
    btn.innerHTML = `<span aria-hidden="true">🚗</span><span>${t('CARROS CUBA', 'CUBA CARS')}</span>`;
    btn.addEventListener('click', toggle);
    return btn;
  }

  function renderKpis() {
    let s;
    try {
      s = store.stats();
    } catch {
      s = { totalLeads: 0, byStage: {}, totalDeals: 0, pendingDrafts: 0, totalSnapshots: 0, modelsTracked: 0 };
    }
    return `
      <div class="cd-kpis">
        <div class="cd-kpi"><div class="k">${t('COMPRADORES EN FUNNEL', 'BUYERS IN FUNNEL')}</div><div class="v">${s.totalLeads}</div></div>
        <div class="cd-kpi"><div class="k">${t('BORRADORES PENDIENTES', 'PENDING DRAFTS')}</div><div class="v">${s.pendingDrafts}</div></div>
        <div class="cd-kpi"><div class="k">${t('DEALS ACTIVOS', 'ACTIVE DEALS')}</div><div class="v">${s.totalDeals}</div></div>
        <div class="cd-kpi"><div class="k">${t('PRECIOS COMPETENCIA', 'COMPETITION PRICES')}</div><div class="v">${s.totalSnapshots}</div></div>
      </div>
    `;
  }

  function renderFunnel() {
    const leads = safeList(() => store.listLeads());
    const counts = funnelCounts(leads);
    const leadById = new Map(leads.map((l) => [l.id, l]));
    let html = renderKpis();
    html += `<div class="cd-sec-title">${t('Funnel de calificación de compradores', 'Buyer qualification funnel')}</div>`;
    html += `<div class="cd-funnel">`;
    for (const { stage, count } of counts) {
      html += `<div class="cd-stage" data-stage="${escHtml(stage)}">
        <div class="cd-stagehead">${escHtml(stageLabel(stage))} (${count})</div>
        <div class="cd-cards">`;
      const stageLeads = leads.filter((l) => (l.stage || 'nuevo') === stage);
      if (!stageLeads.length) html += `<div class="cd-empty">—</div>`;
      for (const lead of stageLeads) {
        html += `<div class="cd-card" data-lead-id="${escHtml(lead.id)}" role="button" tabindex="0">
          <div class="cname">${escHtml(lead.name || t('(sin nombre)', '(no name)'))}</div>
          <div class="cmeta">${escHtml(lead.interest || '')}${lead.budgetUsd ? ` · ${money(lead.budgetUsd)}` : ''}</div>
          <span class="pill ${leadStagePillClass(lead.stage)}">${escHtml(stageLabel(lead.stage))}</span>
        </div>`;
      }
      html += `</div></div>`;
    }
    html += `</div>`;
    html += `<div class="cd-sec-title">${t('Nuevo comprador', 'New buyer')}</div>`;
    html += `
      <label for="cd-new-name">${t('Nombre', 'Name')}</label>
      <input id="cd-new-name" data-field="name" autocomplete="off" />
      <label for="cd-new-wa">${t('WhatsApp', 'WhatsApp')}</label>
      <input id="cd-new-wa" data-field="whatsapp" inputmode="tel" autocomplete="off" />
      <label for="cd-new-model">${t('Modelo de interés', 'Model of interest')}</label>
      <input id="cd-new-model" data-field="interest" autocomplete="off" />
      <label for="cd-new-budget">${t('Presupuesto (USD)', 'Budget (USD)')}</label>
      <input id="cd-new-budget" data-field="budgetUsd" inputmode="numeric" autocomplete="off" />
      <label for="cd-new-src">${t('Origen', 'Source')}</label>
      <input id="cd-new-src" data-field="source" autocomplete="off" />
      <button class="cd-btn" data-action="create-lead">${t('➕ Agregar comprador', '➕ Add buyer')}</button>
    `;
    return { html, leadById };
  }

  function renderDrafts() {
    const drafts = safeList(() => store.listDrafts()).slice().reverse();
    let html = `<div class="cd-sec-title">${t('Cola de borradores — Rosmel (gestor en Cuba)', 'Draft queue — Rosmel (Cuba agent)')}</div>`;
    html += `<div class="cd-disclosure">⚠️ ${escHtml(t(BROKER_DISCLOSURE.es, BROKER_DISCLOSURE.en))}</div>`;
    html += `<div class="cd-disclosure">📝 ${t('BORRADORES SOLAMENTE — nada se envía desde aquí. Juan aprueba y envía desde su teléfono.', 'DRAFTS ONLY — nothing is sent from here. Juan approves and sends from his phone.')}</div>`;
    if (!drafts.length) {
      html += `<div class="cd-empty">${t('Sin borradores. Genera uno desde un comprador o escríbelo aquí.', 'No drafts. Generate one from a buyer or write it here.')}</div>`;
    }
    for (const d of drafts) {
      const body = lang === 'es' ? d.bodyEs : d.bodyEn;
      html += `<div class="cd-card" style="cursor:default">
        <div class="cname">${escHtml(d.title || t('(sin título)', '(untitled)'))}</div>
        <div class="cmeta">${d.kind === 'rosmel' ? t('Para Rosmel', 'For Rosmel') : t('Para comprador', 'For buyer')}</div>
        <span class="pill ${draftStatePillClass(d.state)}">${escHtml(draftLabel(d.state))}</span>
        <pre class="draft">${escHtml(body || '')}</pre>
        <div class="cd-row">
          ${d.state === 'draft' ? `<button class="cd-btn" data-action="draft-approve" data-draft-id="${escHtml(d.id)}">✅ ${t('Aprobar', 'Approve')}</button>` : ''}
          <button class="cd-btn ghost" data-action="draft-copy" data-draft-id="${escHtml(d.id)}">📋 ${t('Copiar', 'Copy')}</button>
          ${d.state !== 'discarded' ? `<button class="cd-btn warn" data-action="draft-discard" data-draft-id="${escHtml(d.id)}">🗑️ ${t('Descartar', 'Discard')}</button>` : ''}
        </div>
      </div><br/>`;
    }
    html += `<div class="cd-sec-title">${t('Nuevo borrador manual', 'New manual draft')}</div>
      <label>${t('Título', 'Title')}</label><input data-field="draft-title" autocomplete="off" />
      <label>${t('Texto (ES)', 'Text (ES)')}</label><textarea data-field="draft-es" rows="4"></textarea>
      <button class="cd-btn" data-action="create-draft">${t('➕ Guardar borrador', '➕ Save draft')}</button>`;
    return html;
  }

  function renderPrices() {
    const snapshots = safeList(() => store.listSnapshots());
    const ourPrices = safeObj(() => store.getOurPrices());
    const models = [...new Set(snapshots.map((s) => (s.model || '').trim()).filter(Boolean))];
    const refPrices = safeList(() => store.getReferencePrices());
    let html = `<div class="cd-sec-title">${t('Panel de precios de competencia', 'Competition price panel')}</div>`;
    html += `<div class="cd-disclosure">${t('Datos del escaneo diario car-competition-price-scan. Precios publicados por la competencia — verificados contra la URL fuente.', 'Data from the daily car-competition-price-scan. Prices published by competitors — verify against the source URL.')}</div>`;
    if (models.length && ourPrices) {
      for (const model of models) {
        const summary = summarizeModelPricing(model, snapshots, ourPrices[model]);
        html += `<div class="cd-sec-title">${escHtml(model)}</div>`;
        html += `<div class="cd-row">
          <div class="cd-kpi" style="flex:1;min-width:140px"><div class="k">${t('NUESTRO PRECIO', 'OUR PRICE')}</div>
          <div class="v">${ourPrices[model] ? money(ourPrices[model]) : t('sin definir', 'not set')}</div></div>
          <div class="cd-kpi" style="flex:1;min-width:140px"><div class="k">${t('MÍN / MÁX COMPETENCIA', 'COMPETITION MIN / MAX')}</div>
          <div class="v">${summary.min ? money(summary.min) : '—'} / ${summary.max ? money(summary.max) : '—'}</div></div>
        </div>
        <div class="cd-row">
          <label style="margin:10px 0 4px;flex:1;min-width:200px">${t('Fijar nuestro precio (USD)', 'Set our price (USD)')}
          <input data-ourprice-model="${escHtml(model)}" value="${ourPrices[model] || ''}" inputmode="numeric" autocomplete="off" /></label>
          <button class="cd-btn" data-action="set-our-price" data-model="${escHtml(model)}">💾 ${t('Guardar', 'Save')}</button>
        </div>`;
      }
    }
    if (refPrices.length) {
      html += `<div class="cd-sec-title">${t('Precios preliminares al comprador (Rosmel)', 'Preliminary buyer prices (Rosmel)')}</div>`;
      html += `<table class="cd-table"><tr><th>${t('Modelo', 'Model')}</th><th>${t('Precio', 'Price')}</th></tr>`;
      for (const r of refPrices) {
        html += `<tr><td>${escHtml(r.model)}</td><td>${money(r.price)}</td></tr>`;
      }
      html += `</table><div class="cd-disclosure">${t('Precios preliminares — final confirmado por escrito, sin descuentos.', 'Preliminary prices — final confirmed in writing, no discounts.')}</div>`;
    }
    html += `<div class="cd-sec-title">${t('Últimas observaciones', 'Latest observations')}</div>`;
    if (!snapshots.length) {
      html += `<div class="cd-empty">${t('Sin datos de competencia todavía. Importa el CSV del escaneo diario.', 'No competition data yet. Import the daily scan CSV.')}</div>`;
    } else {
      html += `<table class="cd-table"><tr><th>${t('Competidor', 'Competitor')}</th><th>${t('Modelo', 'Model')}</th><th>${t('Precio', 'Price')}</th><th>${t('Posición', 'Position')}</th><th>${t('Fuente', 'Source')}</th></tr>`;
      for (const s of snapshots.slice(0, 60)) {
        const pos = pricePosition(ourPrices[s.model], s.price);
        const link = s.sourceUrl
          ? `<a href="${escHtml(s.sourceUrl)}" target="_blank" rel="noopener">🔗</a>`
          : '—';
        html += `<tr>
          <td>${escHtml(s.competitor)}</td>
          <td>${escHtml(s.model)}<br/><span style="font-size:11px;color:#5b6b82">${escHtml(s.date || '')}</span></td>
          <td>${s.price != null ? money(s.price) : '—'}</td>
          <td><span class="pill ${positionPillClass(pos.position)}">${escHtml(posLabel(pos.position))} ${pos.position !== 'unknown' ? positionIndicator(pos.position, pos.diff) : ''}</span></td>
          <td>${link}</td>
        </tr>`;
      }
      html += `</table>`;
    }
    html += `<div class="cd-row">
      <button class="cd-btn" data-action="csv-template">${t('📄 Plantilla CSV', '📄 CSV template')}</button>
      <button class="cd-btn ghost" data-action="csv-export">${t('⬇️ Exportar CSV', '⬇️ Export CSV')}</button>
    </div>
    <label>${t('Importar CSV del escaneo (competitor, model, price, date, sourceUrl)', 'Import scan CSV (competitor, model, price, date, sourceUrl)')}</label>
    <textarea data-field="csv-input" rows="4" placeholder="competitor,model,price,date,sourceUrl"></textarea>
    <button class="cd-btn" data-action="csv-import">${t('📥 Importar precios', '📥 Import prices')}</button>
    <div class="cd-empty" data-ref="import-status"></div>`;
    return html;
  }

  function renderDeals() {
    const deals = safeList(() => store.listDeals());
    const groups = groupDealsByStatus(deals);
    const leads = safeList(() => store.listLeads());
    let html = `<div class="cd-sec-title">${t('Pipeline de deals', 'Deal pipeline')}</div>`;
    html += `<div class="cd-disclosure">⚠️ ${escHtml(t(BROKER_DISCLOSURE.es, BROKER_DISCLOSURE.en))}</div>`;
    for (const status of DEAL_STATUSES) {
      const rows = groups[status];
      html += `<div class="cd-sec-title">${escHtml(dealLabel(status))} (${rows.length})</div>`;
      if (!rows.length) html += `<div class="cd-empty">—</div>`;
      for (const d of rows) {
        const lead = leads.find((l) => l.id === d.leadId);
        html += `<div class="cd-card" data-deal-id="${escHtml(d.id)}" role="button" tabindex="0">
          <div class="cname">${escHtml(d.model || t('(sin modelo)', '(no model)'))}</div>
          <div class="cmeta">${escHtml(lead?.name || '')}${d.buyerPrice ? ` · ${t('Precio al comprador', 'Buyer price')}: ${money(d.buyerPrice)}` : ''}</div>
          <span class="pill ${dealStatusPillClass(d.status)}">${escHtml(dealLabel(d.status))}</span>
        </div>`;
      }
    }
    html += `<div class="cd-sec-title">${t('Nuevo deal', 'New deal')}</div>
      <label>${t('Comprador', 'Buyer')}</label>
      <select data-field="deal-lead">${leads.map((l) => `<option value="${escHtml(l.id)}">${escHtml(l.name || l.id)}</option>`).join('')}</select>
      <label>${t('Modelo', 'Model')}</label><input data-field="deal-model" autocomplete="off" />
      <label>${t('Precio al comprador (USD)', 'Buyer price (USD)')}</label><input data-field="deal-price" inputmode="numeric" autocomplete="off" />
      <button class="cd-btn" data-action="create-deal">${t('➕ Crear deal', '➕ Create deal')}</button>`;
    return html;
  }

  function renderSection() {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    if (section === 'funnel') {
      const { html, leadById } = renderFunnel();
      bodyEl.innerHTML = html;
      bodyEl._leadById = leadById;
    } else if (section === 'drafts') {
      bodyEl.innerHTML = renderDrafts();
    } else if (section === 'prices') {
      bodyEl.innerHTML = renderPrices();
    } else {
      bodyEl.innerHTML = renderDeals();
    }
  }

  function openDrawerLead(leadId) {
    closeDrawer();
    const lead = store.getLead(leadId);
    if (!lead || !panelEl) return;
    const drawer = document.createElement('div');
    drawer.className = 'cd-drawer';
    drawer.setAttribute('role', 'dialog');
    const scored = carEngine?.scoreLead
      ? carEngine.scoreLead(lead, null)
      : scoreLead(lead, null);
    const verdict = qualificationVerdict(scored);
    drawer.innerHTML = `
      <h3>${escHtml(lead.name || t('(sin nombre)', '(no name)'))}</h3>
      <div class="dsub">${escHtml(lead.whatsapp || lead.phone || '')}</div>
      <span class="pill ${leadStagePillClass(lead.stage)}">${escHtml(stageLabel(lead.stage))}</span>
      <div class="cd-sec-title">${t('Calificación', 'Qualification')}</div>
      <div class="cd-kpi"><div class="k">${t('PUNTAJE', 'SCORE')}</div><div class="v">${scored.score}/100</div></div>
      <div style="margin-top:6px"><span class="pill ${verdict.tier}">${escHtml(t(verdict.es, verdict.en))}</span></div>
      <div class="cd-sec-title">${t('Mover de etapa', 'Move stage')}</div>
      <div class="cd-row">
        ${LEAD_STAGES.map((s) => `<button class="cd-btn ghost" data-action="lead-stage" data-lead-id="${escHtml(lead.id)}" data-stage="${s}">${escHtml(stageLabel(s))}</button>`).join('')}
      </div>
      <div class="cd-sec-title">${t('Notas', 'Notes')}</div>
      ${(lead.notes || []).map((n) => `<div class="note">${escHtml(n.text)}<div class="nts">${escHtml(n.at || '')}</div></div>`).join('')}
      <label>${t('Agregar nota', 'Add note')}</label>
      <textarea data-field="lead-note" rows="2"></textarea>
      <button class="cd-btn" data-action="lead-note" data-lead-id="${escHtml(lead.id)}">${t('💾 Guardar nota', '💾 Save note')}</button>
      <div class="cd-row">
        <button class="cd-btn" data-action="rosmel-draft" data-lead-id="${escHtml(lead.id)}">✍️ ${t('Borrador Rosmel', 'Rosmel draft')}</button>
        <button class="cd-btn warn" data-action="lead-delete" data-lead-id="${escHtml(lead.id)}">${t('Eliminar', 'Delete')}</button>
        <button class="cd-btn ghost" data-action="drawer-close">✖️ ${t('Cerrar', 'Close')}</button>
      </div>`;
    panelEl.appendChild(drawer);
    drawerLeadId = lead.id;
  }

  function openDrawerDeal(dealId) {
    closeDrawer();
    const deal = store.getDeal(dealId);
    if (!deal || !panelEl) return;
    const drawer = document.createElement('div');
    drawer.className = 'cd-drawer';
    drawer.setAttribute('role', 'dialog');
    const lead = store.getLead(deal.leadId);
    drawer.innerHTML = `
      <h3>${escHtml(deal.model || t('(sin modelo)', '(no model)'))}</h3>
      <div class="dsub">${escHtml(lead?.name || '')}${deal.buyerPrice ? ` · ${money(deal.buyerPrice)}` : ''}</div>
      <span class="pill ${dealStatusPillClass(deal.status)}">${escHtml(dealLabel(deal.status))}</span>
      <div class="cd-sec-title">${t('Mover de estado', 'Move status')}</div>
      <div class="cd-row">
        ${DEAL_STATUSES.map((s) => `<button class="cd-btn ghost" data-action="deal-status" data-deal-id="${escHtml(deal.id)}" data-status="${s}">${escHtml(dealLabel(s))}</button>`).join('')}
      </div>
      <div class="cd-row">
        <button class="cd-btn warn" data-action="deal-delete" data-deal-id="${escHtml(deal.id)}">${t('Eliminar', 'Delete')}</button>
        <button class="cd-btn ghost" data-action="drawer-close">✖️ ${t('Cerrar', 'Close')}</button>
      </div>`;
    panelEl.appendChild(drawer);
    drawerDealId = deal.id;
  }

  function closeDrawer() {
    drawerLeadId = null;
    drawerDealId = null;
    const existing = panelEl?.querySelector?.('.cd-drawer');
    if (existing && existing.remove) existing.remove();
  }

  function onActionClick(ev) {
    const btn = ev.target?.closest?.('[data-action]');
    if (!btn || !panelEl) return;
    const action = btn.dataset.action;
    const field = (name) =>
      panelEl.querySelector(`[data-field="${name}"]`)?.value ?? '';
    try {
      if (action === 'create-lead') {
        const budget = field('budgetUsd');
        store.createLead({
          name: field('name'),
          whatsapp: field('whatsapp'),
          interest: field('model'),
          budgetUsd: budget === '' ? null : Number(budget),
          source: field('src'),
        });
        renderSection();
      } else if (action === 'lead-stage') {
        store.moveLead(btn.dataset.leadId, btn.dataset.stage);
        closeDrawer();
        renderSection();
      } else if (action === 'lead-note') {
        const note = field('lead-note');
        if (note.trim()) store.addLeadNote(btn.dataset.leadId, note.trim());
        openDrawerLead(btn.dataset.leadId);
      } else if (action === 'lead-delete') {
        store.deleteLead(btn.dataset.leadId);
        closeDrawer();
        renderSection();
      } else if (action === 'rosmel-draft') {
        const lead = store.getLead(btn.dataset.leadId);
        const refPrices = safeList(() => store.getReferencePrices());
        const match = refPrices.find(
          (r) =>
            (r.model || '').toLowerCase().trim() ===
            (lead?.interest || '').toLowerCase().trim(),
        );
        store.createDraft({
          kind: 'rosmel',
          title: t('Borrador Rosmel — ', 'Rosmel draft — ') + (lead?.name || ''),
          bodyEs: draftRosmelWhatsapp({
            leadName: lead?.name,
            model: lead?.interest,
            price: match?.price,
            lang: 'es',
          }),
          bodyEn: draftRosmelWhatsapp({
            leadName: lead?.name,
            model: lead?.interest,
            price: match?.price,
            lang: 'en',
          }),
          leadId: lead?.id,
          state: 'draft',
        });
        closeDrawer();
        section = 'drafts';
        renderNav();
        renderSection();
      } else if (action === 'create-draft') {
        store.createDraft({
          kind: 'rosmel',
          title: field('draft-title') || t('(sin título)', '(untitled)'),
          bodyEs: field('draft-es'),
          bodyEn: '',
          state: 'draft',
        });
        renderSection();
      } else if (action === 'draft-approve') {
        store.setDraftState(btn.dataset.draftId, 'approved');
        renderSection();
      } else if (action === 'draft-discard') {
        store.setDraftState(btn.dataset.draftId, 'discarded');
        renderSection();
      } else if (action === 'draft-copy') {
        const d = store.listDrafts().find((x) => x.id === btn.dataset.draftId);
        const text = lang === 'es' ? d?.bodyEs : d?.bodyEn || d?.bodyEs;
        try {
          navigator?.clipboard?.writeText?.(text || '');
        } catch {
          /* clipboard unavailable — Juan can select manually */
        }
      } else if (action === 'set-our-price') {
        const model = btn.dataset.model;
        const input = panelEl.querySelector(
          `[data-ourprice-model="${model.replace(/"/g, '\\"')}"]`,
        );
        store.setOurPrice(model, input?.value === '' ? null : Number(input?.value));
        renderSection();
      } else if (action === 'csv-import') {
        const text = field('csv-input');
        if (parseCsv && text.trim()) {
          const { rows, errors } = parseCsv(text);
          for (const r of rows) store.addSnapshot(r);
          const statusEl = panelEl.querySelector('[data-ref="import-status"]');
          if (statusEl) {
            statusEl.textContent = errors.length
              ? t('Errores: ', 'Errors: ') + errors.join(' | ')
              : t('Importadas ', 'Imported ') + rows.length + t(' filas', ' rows');
          }
          renderSection();
        }
      } else if (action === 'csv-template') {
        if (parseCsv?.csvTemplate) downloadText('competition-template.csv', parseCsv.csvTemplate());
      } else if (action === 'csv-export') {
        if (parseCsv?.toCsv) {
          downloadText('competition-prices.csv', parseCsv.toCsv(store.listSnapshots()));
        }
      } else if (action === 'create-deal') {
        store.createDeal({
          leadId: field('deal-lead'),
          model: field('deal-model'),
          buyerPrice: field('deal-price') === '' ? null : Number(field('deal-price')),
        });
        renderSection();
      } else if (action === 'deal-status') {
        store.moveDeal(btn.dataset.dealId, btn.dataset.status);
        closeDrawer();
        renderSection();
      } else if (action === 'deal-delete') {
        store.deleteDeal(btn.dataset.dealId);
        closeDrawer();
        renderSection();
      } else if (action === 'drawer-close') {
        closeDrawer();
      } else if (action === 'nav') {
        section = btn.dataset.section;
        renderNav();
        renderSection();
      }
    } catch {
      /* actions are best-effort */
    }
  }

  function downloadText(filename, text) {
    try {
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* download unavailable */
    }
  }

  function renderNav() {
    const nav = panelEl?.querySelector?.('.cd-nav');
    if (!nav) return;
    const labels = {
      funnel: t('🧲 Funnel', '🧲 Funnel'),
      drafts: t('✍️ Borradores', '✍️ Drafts'),
      prices: t('💲 Precios', '💲 Prices'),
      deals: t('🤝 Deals', '🤝 Deals'),
    };
    nav.innerHTML = SECTIONS.map(
      (s) =>
        `<button class="cd-navbtn${s === section ? ' on' : ''}" data-action="nav" data-section="${s}">${labels[s]}</button>`,
    ).join('');
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'gev-cars-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('Mercado de carros Cuba', 'Cuba car market'));
    panel.innerHTML = `
      <div class="cd-head">
        <div class="cd-title">🚗 ${t('CARROS CUBA A–Z', 'CUBA CARS A–Z')}</div>
        <button class="cd-lang" data-action="lang">ES</button>
        <button class="cd-close" data-action="close" aria-label="${t('Cerrar', 'Close')}">✕</button>
      </div>
      <div class="cd-nav"></div>
      <div class="cd-body"></div>`;
    bodyEl = panel.querySelector('.cd-body');
    panel.addEventListener('click', (ev) => {
      const el = ev.target?.closest?.('[data-action]');
      if (el?.dataset?.action === 'close') {
        close();
        return;
      }
      if (el?.dataset?.action === 'lang') {
        lang = lang === 'es' ? 'en' : 'es';
        el.textContent = lang.toUpperCase();
        buildPanelLabels(panel);
        renderNav();
        renderSection();
        return;
      }
      const card = ev.target?.closest?.('[data-lead-id]:not([data-action])');
      const dcard = ev.target?.closest?.('[data-deal-id]:not([data-action])');
      if (card) openDrawerLead(card.dataset.leadId);
      else if (dcard) openDrawerDeal(dcard.dataset.dealId);
    });
    panel.addEventListener('click', onActionClick);
    panel.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        const card = ev.target?.closest?.('[data-lead-id]');
        const dcard = ev.target?.closest?.('[data-deal-id]');
        if (card) openDrawerLead(card.dataset.leadId);
        else if (dcard) openDrawerDeal(dcard.dataset.dealId);
      }
    });
    document.body.appendChild(panel);
    return panel;
  }

  function buildPanelLabels(panel) {
    const title = panel.querySelector('.cd-title');
    if (title) title.textContent = `🚗 ${t('CARROS CUBA A–Z', 'CUBA CARS A–Z')}`;
  }

  function safeList(fn) {
    try {
      const v = fn();
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  function safeObj(fn) {
    try {
      const v = fn();
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }

  function open(openSection = null) {
    if (aborted.current) return null;
    if (!panelEl) panelEl = buildPanel();
    if (openSection && SECTIONS.includes(openSection)) section = openSection;
    panelEl.style.display = 'flex';
    renderNav();
    renderSection();
    return panelEl;
  }

  function close() {
    closeDrawer();
    if (panelEl) panelEl.style.display = 'none';
  }

  function toggle() {
    if (!panelEl || panelEl.style.display === 'none') open();
    else close();
  }

  function destroy() {
    aborted.current = true;
    if (panelEl && panelEl.remove) panelEl.remove();
    panelEl = null;
    bodyEl = null;
  }

  return {
    open,
    close,
    toggle,
    destroy,
    setLang: (l) => {
      lang = l === 'en' ? 'en' : 'es';
    },
    getLang: () => lang,
    openSection: (s) => open(s),
    refresh: () => {
      if (panelEl && panelEl.style.display !== 'none') renderSection();
    },
    // Test seam: section html without a live panel.
    renderSectionHtml: (s) => {
      const prev = section;
      section = SECTIONS.includes(s) ? s : prev;
      let html;
      if (section === 'funnel') html = renderFunnel().html;
      else if (section === 'drafts') html = renderDrafts();
      else if (section === 'prices') html = renderPrices();
      else html = renderDeals();
      section = prev;
      return html;
    },
  };
}
