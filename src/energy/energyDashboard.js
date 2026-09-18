/**
 * Energy desk dashboard for GOD'S EYE VIEW — diesel/gasoline/LPG → Cuba.
 *
 * $0, no API keys, no external calls. Spanish-first (ES default, EN toggle),
 * phone-first: 44px touch targets, 16px inputs, larger type, no hover-only
 * interactions (everything is a button/tap; content is always visible).
 *
 * Sections:
 *   1. COMPLIANCE GATE panel — first-class, always visible. ANY red flag or
 *      ANY sanctions/customs question triggers a hard stop: the inquiry is
 *      forced to 'awaiting-juan' and an escalation record is written.
 *      The gate cannot be bypassed in this UI — the only path past it is
 *      advanceGate() with an all-yes checklist.
 *   2. Product spec sheets (diesel EN 590, gasoline EN 228, LPG HD-5).
 *   3. Benchmark price log (dated + sourced; never invented).
 *   4. Inquiry pipeline (broker inquiries; economics drawer).
 *   5. Product-tanker logistics checklist (static reference fields).
 *
 * Pure helpers (LOGISTICS_CHECKLIST, productTabs, gateSummaryText,
 * benchmarkRows, specRows) are exported for unit tests. Live DOM wiring is
 * in initEnergyDashboard(). This module never touches Cesium directly —
 * the map layer owns the 3D entities.
 *
 * Broker positioning: SAHJONY is a fee/spread broker — never the buyer or
 * seller of product, zero capital at risk. All copy uses that language.
 */

import {
  PRODUCTS,
  productLabel,
  getSpecSheet,
  parcelEconomics,
  formatMoney,
  formatGal,
  formatMt,
  evaluateGate,
  GATE_CHECKLIST_TEMPLATE,
} from './energyEngine.js';
import { CUBAN_FUEL_PORTS } from './energyStore.js';

export const WORKFORCE_LOG_KEY = 'sahjony.workforce.energy.log.v1';

/** Honest framing — the workforce is active only while the app is open. */
export const WORKFORCE_NOTE = {
  es: 'La fuerza trabaja mientras la app está abierta.',
  en: 'The workforce runs while the app is open.',
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests).
// ---------------------------------------------------------------------------

/** Static product-tanker logistics checklist (reference fields, not live data). */
export const LOGISTICS_CHECKLIST = Object.freeze([
  {
    id: 'parcel-size',
    es: 'Tamaño de la parcela (MT/gal) confirmado con ambas partes.',
    en: 'Parcel size (MT/gal) confirmed with both parties.',
  },
  {
    id: 'discharge-port',
    es: 'Puerto de descarga cubano elegido de la referencia (Mariel, La Habana, Santiago, Cienfuegos).',
    en: 'Cuban discharge port chosen from the reference (Mariel, Havana, Santiago, Cienfuegos).',
  },
  {
    id: 'draft-limits',
    es: 'Calado máximo del puerto de descarga verificado (dato de referencia, no en vivo).',
    en: 'Discharge-port max draft verified (reference data, not live).',
  },
  {
    id: 'laycan',
    es: 'Ventana de laycan acordada y documentada.',
    en: 'Laycan window agreed and documented.',
  },
  {
    id: 'docs',
    es: 'Documentos: certificado de análisis, conocimiento de embarque, manifiesto de carga.',
    en: 'Documents: certificate of analysis, bill of lading, cargo manifest.',
  },
  {
    id: 'insurance',
    es: 'Seguro de carga confirmado por las partes (sin cotización automática en v1).',
    en: 'Cargo insurance confirmed by the parties (no automated quoting in v1).',
  },
]);

/** Products shown as spec-sheet tabs (crude excluded — context only). */
export function productTabs() {
  return ['diesel', 'gasoline', 'lpg'];
}

/** Rows of a spec sheet as { paramEs, paramEn, value, unit, noteEs, noteEn }. */
export function specRows(product) {
  const sheet = getSpecSheet(product);
  if (!sheet) return [];
  return sheet.rows.map((r) => ({
    paramEs: r.param.es,
    paramEn: r.param.en,
    value: r.value,
    unit: r.unit || '',
    noteEs: r.note?.es || '',
    noteEn: r.note?.en || '',
  }));
}

/** Benchmark rows normalized for the log table. */
export function benchmarkRows(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((b) => ({
      id: b.id,
      date: String(b.date || ''),
      product: b.product,
      value: Number(b.value) || 0,
      unit: String(b.unit || ''),
      market: String(b.market || b.marketEn || ''),
      source: String(b.source || ''),
      sourceUrl: String(b.sourceUrl || ''),
      note: String(b.note || ''),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Bilingual one-line summary of a gate evaluation.
 * Pure — never answers sanctions questions, only reports the predicate.
 */
export function gateSummaryText(evalResult, lang = 'es') {
  if (!evalResult) return lang === 'es' ? 'Sin evaluar.' : 'Not evaluated.';
  if (evalResult.passed) {
    return lang === 'es'
      ? 'Gate aprobado: todos los puntos en "sí".'
      : 'Gate passed: every item answered "yes".';
  }
  const reds = (evalResult.redFlags || []).length;
  const unknowns = (evalResult.unanswered || []).length;
  return lang === 'es'
    ? `Gate BLOQUEADO: ${reds} bandera(s) roja(s), ${unknowns} sin responder. Escalado a Juan — nada continúa.`
    : `Gate BLOCKED: ${reds} red flag(s), ${unknowns} unanswered. Escalated to Juan — nothing continues.`;
}

/** Bilingual status pill text for an inquiry status. */
export function statusText(status, lang = 'es') {
  const labels = {
    inquiry: ['Consulta', 'Inquiry'],
    diligence: ['Diligencia', 'Diligence'],
    'gate-review': ['Revisión de gate', 'Gate review'],
    commercial: ['Comercial (gate aprobado)', 'Commercial (gate passed)'],
    'awaiting-juan': ['Esperando a Juan', 'Awaiting Juan'],
    closed: ['Cerrado', 'Closed'],
    dead: ['Descartado', 'Dead'],
  };
  const pair = labels[status] || [status, status];
  return lang === 'es' ? pair[0] : pair[1];
}

// ---------------------------------------------------------------------------
// Dashboard.
// ---------------------------------------------------------------------------

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-energy-dashboard-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-energy-dashboard-styles';
  style.textContent = `
    .gev-energy-fab{position:fixed;right:16px;bottom:16px;z-index:60;min-height:52px;min-width:52px;border-radius:26px;border:none;background:#b45309;color:#fff;font-size:20px;font-weight:700;padding:0 20px;box-shadow:0 4px 16px rgba(0,0,0,.45);cursor:pointer}
    .gev-energy-panel{position:fixed;inset:0;z-index:59;background:rgba(8,10,14,.97);color:#e8ecf1;overflow-y:auto;font-family:system-ui,-apple-system,sans-serif;font-size:17px;line-height:1.5}
    .gev-energy-head{position:sticky;top:0;background:#0d1117;padding:14px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #26303b;z-index:2}
    .gev-energy-title{font-size:21px;font-weight:800;flex:1}
    .gev-energy-btn{min-height:44px;padding:10px 16px;border-radius:10px;border:1px solid #3b4756;background:#16202b;color:#e8ecf1;font-size:16px;cursor:pointer}
    .gev-energy-btn.primary{background:#b45309;border-color:#b45309;color:#fff;font-weight:700}
    .gev-energy-btn.danger{background:#7f1d1d;border-color:#ef4444;color:#fff;font-weight:700}
    .gev-energy-btn.ghost{background:transparent}
    .gev-energy-sec{padding:16px;border-bottom:1px solid #1c2530}
    .gev-energy-sec h2{font-size:19px;margin:0 0 10px;color:#fbbf24}
    .gev-energy-sec h3{font-size:17px;margin:14px 0 8px;color:#e8ecf1}
    .gev-energy-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:4px}
    .gev-energy-kpi{background:#131a23;border:1px solid #26303b;border-radius:12px;padding:12px;text-align:center}
    .gev-energy-kpi .n{font-size:26px;font-weight:800}
    .gev-energy-kpi .l{font-size:13px;color:#9aa7b5}
    .gev-energy-gate{border:2px solid #ef4444;border-radius:14px;padding:16px;background:#1f1113;margin:4px 0}
    .gev-energy-gate.ok{border-color:#22c55e;background:#0f1d14}
    .gev-energy-gate h2{color:#fff}
    .gev-energy-flag{background:#7f1d1d;border-radius:10px;padding:10px 12px;margin:8px 0;font-size:16px}
    .gev-energy-tabs{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
    .gev-energy-table{width:100%;border-collapse:collapse;font-size:15px}
    .gev-energy-table th,.gev-energy-table td{border:1px solid #26303b;padding:10px 8px;text-align:left;vertical-align:top}
    .gev-energy-table th{background:#131a23;color:#fbbf24;font-size:14px}
    .gev-energy-card{background:#131a23;border:1px solid #26303b;border-radius:12px;padding:14px;margin:10px 0}
    .gev-energy-card .ref{font-weight:800;font-size:18px}
    .gev-energy-pill{display:inline-block;padding:4px 12px;border-radius:20px;font-size:14px;font-weight:700;background:#26303b;margin:6px 0}
    .gev-energy-pill.gate-review{background:#7c2d12}
    .gev-energy-pill.commercial{background:#14532d}
    .gev-energy-pill.awaiting-juan{background:#7f1d1d}
    .gev-energy-input{width:100%;min-height:44px;font-size:16px;padding:10px 12px;border-radius:10px;border:1px solid #3b4756;background:#0b0f14;color:#e8ecf1;margin:6px 0;box-sizing:border-box}
    .gev-energy-check{display:flex;gap:12px;align-items:flex-start;min-height:44px;padding:10px 4px;border-bottom:1px solid #1c2530;cursor:pointer}
    .gev-energy-check input{width:26px;height:26px;margin-top:2px;flex-shrink:0}
    .gev-energy-check .q{flex:1}
    .gev-energy-check .ans{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
    .gev-energy-ansbtn{min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid #3b4756;background:#0b0f14;color:#e8ecf1;font-size:15px;cursor:pointer}
    .gev-energy-ansbtn.sel-yes{background:#14532d;border-color:#22c55e;font-weight:700}
    .gev-energy-ansbtn.sel-no{background:#7f1d1d;border-color:#ef4444;font-weight:700}
    .gev-energy-ansbtn.sel-unknown{background:#4b3b12;border-color:#eab308;font-weight:700}
    .gev-energy-muted{color:#9aa7b5;font-size:14px}
    .gev-energy-broker{border:1px solid #b45309;border-radius:12px;padding:12px;background:#1c1410;font-size:15px}
    .gev-energy-drawer{background:#0d1117;border-top:2px solid #b45309;padding:16px}
  `;
  document.head.appendChild(style);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function btn(label, cls, onClick) {
  const b = el('button', `gev-energy-btn ${cls || ''}`, label);
  b.type = 'button';
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    try {
      onClick(ev);
    } catch {
      /* UI errors never break the app */
    }
  });
  return b;
}

export function initEnergyDashboard({
  storeApi = null,
  engine = null,
  workforce = null,
  signal = null,
} = {}) {
  injectStyles();

  const store =
    storeApi || {
      createInquiry: () => null,
      getInquiry: () => null,
      updateInquiry: () => null,
      moveInquiry: () => null,
      deleteInquiry: () => false,
      listInquiries: () => [],
      addInquiryNote: () => null,
      advanceGate: () => ({ advanced: false, escalated: false }),
      addBenchmark: () => null,
      listBenchmarks: () => [],
      listEscalations: () => [],
      resolveEscalation: () => null,
      stats: () => ({}),
      getPorts: () => [...CUBAN_FUEL_PORTS],
    };

  const E = {
    productLabel: (p, l) => productLabel(p, l),
    getSpecSheet: (p) => getSpecSheet(p),
    parcelEconomics: (i) => parcelEconomics(i),
    formatMoney: (n) => formatMoney(n),
    formatGal: (n) => formatGal(n),
    formatMt: (n) => formatMt(n),
    evaluateGate: (a) => evaluateGate(a),
    checklist: GATE_CHECKLIST_TEMPLATE,
    ...(engine || {}),
  };

  let lang = 'es';
  let panelEl = null;
  let fabEl = null;
  let specProduct = 'diesel';
  let openDrawerFor = null; // inquiry id with the gate/economics drawer open
  let gateAnswers = {}; // inquiryId -> { itemId: 'yes'|'no'|'unknown' }
  let gateMessage = {}; // inquiryId -> bilingual message after submit
  const aborted = { current: false };
  signal?.addEventListener?.('abort', () => {
    aborted.current = true;
  }, { once: true });

  const t = (es, en) => (lang === 'es' ? es : en);

  function renderGateSummary(result) {
    return gateSummaryText(result, lang);
  }

  function renderKpis(root) {
    let s = {};
    try {
      s = store.stats() || {};
    } catch {
      /* ignore */
    }
    const kpis = el('div', 'gev-energy-kpis');
    const items = [
      [s.openInquiries ?? 0, t('Consultas abiertas', 'Open inquiries')],
      [s.pendingEscalations ?? 0, t('Escalaciones pendientes', 'Pending escalations')],
      [s.benchmarkCount ?? 0, t('Precios de referencia', 'Benchmark prices')],
    ];
    for (const [n, label] of items) {
      const card = el('div', 'gev-energy-kpi');
      card.appendChild(el('div', 'n', String(n)));
      card.appendChild(el('div', 'l', label));
      kpis.appendChild(card);
    }
    root.appendChild(kpis);
  }

  function renderComplianceGate(root) {
    const sec = el('section', 'gev-energy-sec');
    sec.id = 'gev-energy-gate';
    sec.appendChild(el('h2', null, t('🚧 GATE DE CUMPLIMIENTO', '🚧 COMPLIANCE GATE')));
    let escalations = [];
    try {
      escalations = (store.listEscalations() || []).filter(
        (e) => e.status === 'awaiting-juan',
      );
    } catch {
      /* ignore */
    }
    const box = el('div', `gev-energy-gate${escalations.length ? '' : ' ok'}`);
    if (escalations.length === 0) {
      box.appendChild(
        el('p', null, t(
          'Sin bloqueos activos. Toda consulta pasa por el gate antes de cualquier paso comercial — sin excepciones.',
          'No active blocks. Every inquiry passes through the gate before any commercial step — no exceptions.',
        )),
      );
    } else {
      box.appendChild(
        el('p', null, t(
          `⛔ ${escalations.length} escalación(es) esperando a Juan. NADA continúa hasta que él decida.`,
          `⛔ ${escalations.length} escalation(s) awaiting Juan. NOTHING continues until he decides.`,
        )),
      );
      for (const esc of escalations) {
        const f = el('div', 'gev-energy-flag');
        f.appendChild(el('div', null, esc.summary || esc.id));
        f.appendChild(
          btn(t('Marcar resuelto (solo Juan)', 'Mark resolved (Juan only)'), '', () => {
            try {
              store.resolveEscalation(esc.id);
            } catch {
              /* ignore */
            }
            rerender();
          }),
        );
        box.appendChild(f);
      }
    }
    box.appendChild(
      el('p', 'gev-energy-muted', t(
        'Regla dura: cualquier pregunta sobre sanciones, aduanas o embargos NUNCA la responde la fuerza ni el módulo — se escala a Juan automáticamente. La fuerza nunca evalúa listas de sancionados.',
        'Hard rule: any question about sanctions, customs, or embargoes is NEVER answered by the workforce or this module — it escalates to Juan automatically. The workforce never screens sanctions lists.',
      )),
    );
    sec.appendChild(box);
    root.appendChild(sec);
  }

  function renderSpecSheets(root) {
    const sec = el('section', 'gev-energy-sec');
    sec.appendChild(el('h2', null, t('📋 Fichas de producto', '📋 Product spec sheets')));
    const tabs = el('div', 'gev-energy-tabs');
    for (const p of productTabs()) {
      const b = btn(t(productLabel(p, 'es'), productLabel(p, 'en')), p === specProduct ? 'primary' : '', () => {
        specProduct = p;
        rerender();
      });
      tabs.appendChild(b);
    }
    sec.appendChild(tabs);
    const sheet = E.getSpecSheet(specProduct);
    if (sheet) {
      sec.appendChild(
        el('p', 'gev-energy-muted', `${sheet.standard} — ${t(sheet.standardNote.es, sheet.standardNote.en)}`),
      );
      const table = el('table', 'gev-energy-table');
      const head = el('tr');
      head.appendChild(el('th', null, t('Parámetro', 'Parameter')));
      head.appendChild(el('th', null, t('Valor', 'Value')));
      table.appendChild(head);
      for (const r of specRows(specProduct)) {
        const tr = el('tr');
        const paramCell = el('td');
        paramCell.appendChild(el('div', null, t(r.paramEs, r.paramEn)));
        if (r.noteEs || r.noteEn) {
          paramCell.appendChild(el('div', 'gev-energy-muted', t(r.noteEs, r.noteEn)));
        }
        tr.appendChild(paramCell);
        tr.appendChild(el('td', null, `${r.value}${r.unit ? ' ' + r.unit : ''}`));
        table.appendChild(tr);
      }
      sec.appendChild(table);
    }
    root.appendChild(sec);
  }

  function renderBenchmarks(root) {
    const sec = el('section', 'gev-energy-sec');
    sec.appendChild(el('h2', null, t('📈 Precios de referencia', '📈 Benchmark prices')));
    sec.appendChild(
      el('p', 'gev-energy-muted', t(
        'Valores verificados con fecha y fuente. Referencia de tendencia — no son cotizaciones de suministro.',
        'Verified, dated, sourced values. Trend reference — not supply quotes.',
      )),
    );
    let rows = [];
    try {
      rows = benchmarkRows(store.listBenchmarks());
    } catch {
      /* ignore */
    }
    const table = el('table', 'gev-energy-table');
    const head = el('tr');
    head.appendChild(el('th', null, t('Fecha', 'Date')));
    head.appendChild(el('th', null, t('Producto', 'Product')));
    head.appendChild(el('th', null, t('Precio', 'Price')));
    head.appendChild(el('th', null, t('Mercado / Fuente', 'Market / Source')));
    table.appendChild(head);
    for (const r of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', null, r.date));
      tr.appendChild(el('td', null, t(productLabel(r.product, 'es'), productLabel(r.product, 'en'))));
      tr.appendChild(el('td', null, `${E.formatMoney(r.value)} ${r.unit}`));
      const market = el('td');
      market.appendChild(el('div', null, r.market));
      market.appendChild(el('div', 'gev-energy-muted', r.source));
      if (r.note) market.appendChild(el('div', 'gev-energy-muted', r.note));
      tr.appendChild(market);
      table.appendChild(tr);
    }
    sec.appendChild(table);
    root.appendChild(sec);
  }

  function renderInquiryCard(sec, inq) {
    const card = el('div', 'gev-energy-card');
    card.appendChild(el('div', 'ref', inq.ref || t('(sin referencia)', '(no reference)')));
    const pill = el('span', `gev-energy-pill ${inq.status || ''}`, statusText(inq.status, lang));
    card.appendChild(pill);
    let econLine = '';
    try {
      const econ = E.parcelEconomics(inq);
      econLine = `${E.formatMt(econ.volumeMt)} · ${E.formatGal(econ.volumeGal)} · ${t('spread', 'spread')} ${E.formatMoney(econ.totalSpread)}`;
    } catch {
      /* ignore */
    }
    card.appendChild(el('div', null, `${t(productLabel(inq.product, 'es'), productLabel(inq.product, 'en'))} — ${econLine}`));
    if (inq.dischargePort) {
      card.appendChild(el('div', 'gev-energy-muted', `${t('Descarga', 'Discharge')}: ${inq.dischargePort}`));
    }
    if (inq.gateResult) {
      card.appendChild(
        el('div', 'gev-energy-muted', `${t('Gate', 'Gate')}: ${inq.gateResult.passed ? '✅' : '⛔'}`),
      );
    }
    const actions = el('div', 'gev-energy-tabs');
    actions.appendChild(
      btn(t('Abrir gate / economía', 'Open gate / economics'), '', () => {
        openDrawerFor = openDrawerFor === inq.id ? null : inq.id;
        rerender();
      }),
    );
    if (inq.status === 'awaiting-juan') {
      actions.appendChild(el('span', 'gev-energy-muted', t('⛔ Bloqueado — esperando a Juan', '⛔ Blocked — awaiting Juan')));
    }
    card.appendChild(actions);
    if (openDrawerFor === inq.id) renderDrawer(card, inq);
    sec.appendChild(card);
  }

  function answerBtn(label, sel, cls, onClick) {
    const b = el('button', `gev-energy-ansbtn ${sel ? cls : ''}`, label);
    b.type = 'button';
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onClick();
    });
    return b;
  }

  function renderDrawer(card, inq) {
    const drawer = el('div', 'gev-energy-drawer');
    // Economics (broker positioning).
    drawer.appendChild(el('h3', null, t('💰 Economía del corredor', '💰 Broker economics')));
    try {
      const econ = E.parcelEconomics(inq);
      drawer.appendChild(el('div', null,
        `${t('Volumen', 'Volume')}: ${E.formatMt(econ.volumeMt)} = ${E.formatGal(econ.volumeGal)} = ${Math.round(econ.volumeBbl).toLocaleString('en-US')} bbl`));
      drawer.appendChild(el('div', null,
        `${t('Spread por unidad (MT)', 'Per-unit spread (MT)')}: ${E.formatMoney(econ.perUnitSpread)}`));
      drawer.appendChild(el('div', null,
        `${t('Spread total estimado', 'Estimated total spread')}: ${E.formatMoney(econ.totalSpread)}`));
      if (econ.flatFee > 0) {
        drawer.appendChild(el('div', null,
          `${t('Honorario fijo estimado', 'Estimated flat fee')}: ${E.formatMoney(econ.flatFee)}`));
      }
    } catch {
      /* ignore */
    }
    drawer.appendChild(el('p', 'gev-energy-muted', t(
      'SAHJONY actúa como corredor por honorario/spread — nunca compra ni vende el producto, cero capital en riesgo.',
      'SAHJONY acts as a fee/spread broker — never buys or sells the product, zero capital at risk.',
    )));

    // Compliance gate.
    drawer.appendChild(el('h3', null, t('🚧 Gate de cumplimiento', '🚧 Compliance gate')));
    const answers = gateAnswers[inq.id] || {};
    gateAnswers[inq.id] = answers;
    E.checklist.forEach((item, idx) => {
      const rowEl = el('div', 'gev-energy-check');
      const q = el('div', 'q', t(item.es, item.en));
      const ans = el('div', 'ans');
      const cur = answers[item.id] || 'unknown';
      ans.appendChild(answerBtn(t('Sí', 'Yes'), cur === 'yes', 'sel-yes', () => {
        answers[item.id] = 'yes';
        rerender();
      }));
      ans.appendChild(answerBtn(t('No', 'No'), cur === 'no', 'sel-no', () => {
        answers[item.id] = 'no';
        rerender();
      }));
      ans.appendChild(answerBtn(t('No sé', "Don't know"), cur === 'unknown', 'sel-unknown', () => {
        answers[item.id] = 'unknown';
        rerender();
      }));
      q.appendChild(ans);
      rowEl.appendChild(el('div', null, `${idx + 1}.`));
      rowEl.appendChild(q);
      drawer.appendChild(rowEl);
    });

    const liveEval = E.evaluateGate(answers);
    drawer.appendChild(el('div', null, renderGateSummary(liveEval)));
    if (gateMessage[inq.id]) {
      drawer.appendChild(el('div', 'gev-energy-flag', gateMessage[inq.id]));
    }

    const gateBtns = el('div', 'gev-energy-tabs');
    gateBtns.appendChild(
      btn(t('Evaluar gate ahora', 'Evaluate gate now'), liveEval.passed ? 'primary' : 'danger', () => {
        let out;
        try {
          out = store.advanceGate(inq.id, { ...answers });
        } catch {
          out = { advanced: false, escalated: false };
        }
        if (out.escalated) {
          gateMessage[inq.id] = t(
            '⛔ GATE BLOQUEADO. Escalado a Juan — nada continúa sin su decisión. La fuerza nunca responde preguntas de sanciones.',
            '⛔ GATE BLOCKED. Escalated to Juan — nothing continues without his decision. The workforce never answers sanctions questions.',
          );
        } else if (out.advanced) {
          gateMessage[inq.id] = t(
            '✅ Gate aprobado. La consulta pasa a comercial — Juan decide el siguiente paso.',
            '✅ Gate passed. The inquiry moves to commercial — Juan decides the next step.',
          );
        }
        rerender();
      }),
    );
    drawer.appendChild(gateBtns);

    // Logistics checklist (static reference).
    drawer.appendChild(el('h3', null, t('🚢 Lista logística (referencia)', '🚢 Logistics checklist (reference)')));
    const logistics = (inq.meta && inq.meta.logistics) || {};
    for (const item of LOGISTICS_CHECKLIST) {
      const rowEl = el('div', 'gev-energy-check');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!logistics[item.id];
      cb.setAttribute('aria-label', t(item.es, item.en));
      cb.addEventListener('change', () => {
        try {
          const next = { ...(inq.meta?.logistics || {}), [item.id]: cb.checked };
          store.updateInquiry(inq.id, { meta: { ...(inq.meta || {}), logistics: next } });
        } catch {
          /* ignore */
        }
      });
      rowEl.appendChild(cb);
      rowEl.appendChild(el('div', 'q', t(item.es, item.en)));
      drawer.appendChild(rowEl);
    }
    drawer.appendChild(el('p', 'gev-energy-muted', t(
      'Campos de referencia — se completan manualmente. Sin seguimiento de buques en vivo en v1.',
      'Reference fields — completed manually. No live vessel tracking in v1.',
    )));
    card.appendChild(drawer);
  }

  function renderInquiries(root) {
    const sec = el('section', 'gev-energy-sec');
    sec.appendChild(el('h2', null, t('🛢️ Consultas de producto', '🛢️ Product inquiries')));
    sec.appendChild(el('div', 'gev-energy-broker', t(
      'SAHJONY es corredor por honorario/spread en cada trato — nunca el comprador ni el vendedor del producto.',
      'SAHJONY is a fee/spread broker on every deal — never the buyer or seller of the product.',
    )));
    let inquiries = [];
    try {
      inquiries = store.listInquiries() || [];
    } catch {
      /* ignore */
    }
    const form = el('div', 'gev-energy-card');
    form.appendChild(el('h3', null, t('Nueva consulta', 'New inquiry')));
    const refInput = el('input', 'gev-energy-input');
    refInput.placeholder = t('Referencia (ej. ENQ-2026-001)', 'Reference (e.g. ENQ-2026-001)');
    refInput.setAttribute('aria-label', refInput.placeholder);
    const prodSelect = el('select', 'gev-energy-input');
    for (const p of productTabs()) {
      const opt = el('option', null, t(productLabel(p, 'es'), productLabel(p, 'en')));
      opt.value = p;
      prodSelect.appendChild(opt);
    }
    const volInput = el('input', 'gev-energy-input');
    volInput.type = 'number';
    volInput.min = '0';
    volInput.placeholder = t('Volumen (MT)', 'Volume (MT)');
    volInput.setAttribute('aria-label', volInput.placeholder);
    const portSelect = el('select', 'gev-energy-input');
    const portBlank = el('option', null, t('Puerto de descarga…', 'Discharge port…'));
    portBlank.value = '';
    portSelect.appendChild(portBlank);
    for (const port of CUBAN_FUEL_PORTS) {
      const opt = el('option', null, t(port.name.es, port.name.en));
      opt.value = t(port.name.es, port.name.en);
      portSelect.appendChild(opt);
    }
    form.appendChild(refInput);
    form.appendChild(prodSelect);
    form.appendChild(volInput);
    form.appendChild(portSelect);
    form.appendChild(
      btn(t('Crear consulta', 'Create inquiry'), 'primary', () => {
        let created = null;
        try {
          created = store.createInquiry({
            ref: refInput.value,
            product: prodSelect.value,
            volumeMt: Number(volInput.value) || 0,
            dischargePort: portSelect.value,
            status: 'inquiry',
          });
        } catch {
          /* ignore */
        }
        if (created) {
          try {
            store.moveInquiry(created.id, 'gate-review');
          } catch {
            /* ignore */
          }
          openDrawerFor = created.id;
        }
        rerender();
      }),
    );
    sec.appendChild(form);
    const open = inquiries.filter((i) => i.status !== 'closed' && i.status !== 'dead');
    const done = inquiries.filter((i) => i.status === 'closed' || i.status === 'dead');
    for (const inq of open) renderInquiryCard(sec, inq);
    if (done.length) {
      sec.appendChild(el('h3', null, t('Cerradas / descartadas', 'Closed / dead')));
      for (const inq of done) renderInquiryCard(sec, inq);
    }
    root.appendChild(sec);
  }

  function renderBody() {
    const body = el('div');
    renderKpis(body);
    renderComplianceGate(body);
    renderInquiries(body);
    renderSpecSheets(body);
    renderBenchmarks(body);
    const sec = el('section', 'gev-energy-sec');
    sec.appendChild(el('h2', null, t('⛽ Puertos receptores (referencia)', '⛽ Receiving ports (reference)')));
    for (const port of CUBAN_FUEL_PORTS) {
      const c = el('div', 'gev-energy-card');
      c.appendChild(el('div', 'ref', t(port.name.es, port.name.en)));
      c.appendChild(el('div', 'gev-energy-muted', `${port.lat.toFixed(4)}, ${port.lng.toFixed(4)}`));
      c.appendChild(el('div', null, t(port.note.es, port.note.en)));
      sec.appendChild(c);
    }
    body.appendChild(sec);
    return body;
  }

  function rerender() {
    if (!panelEl || aborted.current) return;
    try {
      const head = panelEl.querySelector('[data-gev-energy-head]');
      panelEl.innerHTML = '';
      if (head) panelEl.appendChild(head);
      else panelEl.appendChild(buildHead());
      panelEl.appendChild(renderBody());
    } catch {
      /* UI errors never break the app */
    }
  }

  function buildHead() {
    const head = el('div', 'gev-energy-head');
    head.setAttribute('data-gev-energy-head', '1');
    head.appendChild(el('div', 'gev-energy-title', t('⚡ Energía → Cuba', '⚡ Energy → Cuba')));
    head.appendChild(
      btn(lang === 'es' ? 'EN' : 'ES', 'ghost', () => {
        lang = lang === 'es' ? 'en' : 'es';
        rerender();
      }),
    );
    head.appendChild(btn('✕', 'ghost', () => close()));
    return head;
  }

  function open() {
    if (typeof document === 'undefined') return false;
    if (panelEl) {
      rerender();
      return true;
    }
    panelEl = el('div', 'gev-energy-panel');
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', t('Energía a Cuba', 'Energy to Cuba'));
    panelEl.appendChild(buildHead());
    panelEl.appendChild(renderBody());
    document.body.appendChild(panelEl);
    return true;
  }

  function close() {
    if (panelEl) {
      try {
        panelEl.remove();
      } catch {
        /* ignore */
      }
      panelEl = null;
    }
  }

  function toggle() {
    if (panelEl) close();
    else open();
    return !!panelEl;
  }

  function destroy() {
    close();
    if (fabEl) {
      try {
        fabEl.remove();
      } catch {
        /* ignore */
      }
      fabEl = null;
    }
    try {
      if (typeof window !== 'undefined' && window.__gevEnergy === api) {
        delete window.__gevEnergy;
      }
    } catch {
      /* ignore */
    }
  }

  function mountFab() {
    if (typeof document === 'undefined' || fabEl) return;
    fabEl = el('button', 'gev-energy-fab', '⚡');
    fabEl.type = 'button';
    fabEl.setAttribute('aria-label', t('Abrir energía', 'Open energy'));
    fabEl.addEventListener('click', () => toggle());
    document.body.appendChild(fabEl);
  }

  const api = {
    open,
    close,
    toggle,
    destroy,
    mountFab,
    openGate(inquiryId) {
      openDrawerFor = inquiryId || openDrawerFor;
      open();
      try {
        const gate = panelEl?.querySelector('#gev-energy-gate');
        gate?.scrollIntoView?.();
      } catch {
        /* ignore */
      }
    },
    openSpecs(product) {
      if (productTabs().includes(product)) specProduct = product;
      open();
    },
    setLang(next) {
      lang = next === 'en' ? 'en' : 'es';
      if (panelEl) rerender();
    },
    getLang: () => lang,
    // Test hooks (not part of the public UI contract).
    _specRows: specRows,
    _benchmarkRows: benchmarkRows,
    _gateSummaryText: gateSummaryText,
    _rendered: () => !!panelEl,
  };

  try {
    if (typeof window !== 'undefined') {
      window.__gevEnergy = api;
    }
  } catch {
    /* non-browser runtimes */
  }

  try {
    if (signal) {
      if (signal.aborted) destroy();
      else if (typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', () => destroy(), { once: true });
      }
    }
  } catch {
    /* ignore */
  }

  return api;
}
