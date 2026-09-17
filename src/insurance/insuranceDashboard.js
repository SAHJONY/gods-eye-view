/**
 * Insurance Command Center dashboard for GOD'S EYE VIEW — $0, no API keys, no external calls.
 *
 * Mission-control panel: big bilingual KPI cards (coverage gaps, renewals
 * ≤30 days, open claims, quotes tracked) plus one-tap buttons that open the
 * full standalone app at /insurance/#<view> on the same origin (shared
 * localStorage, so the same data). Backup export/import included.
 *
 * Pure helpers (statCards) are exported for unit tests. The live DOM wiring
 * lives in initInsuranceDashboard(). This module intentionally does NOT
 * touch Cesium — the map layer owns the 3D entities.
 */

import { exportBackup, parseBackup } from './insuranceImporter.js';
import * as defaultEngine from './insuranceEngine.js';

const INS_CSS = `
#gev-insurance-btn{display:flex;align-items:center;gap:8px;padding:10px 12px;margin-top:8px;background:rgba(10,14,22,.82);border:1px solid rgba(52,211,153,.28);border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.06em;min-width:172px;max-width:210px}
#gev-insurance-btn:hover{border-color:rgba(52,211,153,.6)}
#gev-insurance-panel{position:fixed;z-index:60;right:12px;top:12px;width:min(560px,calc(100vw - 24px));max-height:min(640px,calc(100vh - 24px));background:rgba(8,11,18,.96);border:1px solid rgba(52,211,153,.3);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7}
#gev-insurance-panel .isp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(52,211,153,.18)}
#gev-insurance-panel .isp-title{font-size:12px;font-weight:800;letter-spacing:.1em;color:#34d399;flex:1}
#gev-insurance-panel .isp-lang{background:none;border:1px solid rgba(52,211,153,.35);color:#34d399;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:800;font-family:inherit;min-height:44px;min-width:44px}
#gev-insurance-panel .isp-close{background:none;border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;width:44px;height:44px;min-width:44px;cursor:pointer;font-size:16px}
#gev-insurance-panel .isp-body{overflow-y:auto;padding:10px 12px}
#gev-insurance-panel .isp-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px}
#gev-insurance-panel .isp-kpi{background:rgba(52,211,153,.06);border:1px solid rgba(52,211,153,.15);border-radius:12px;padding:12px;min-height:64px}
#gev-insurance-panel .isp-kpi .k{font-size:11px;color:#9fb0c9;letter-spacing:.05em;margin-bottom:4px}
#gev-insurance-panel .isp-kpi .v{font-size:26px;font-weight:800;color:#fff}
#gev-insurance-panel .isp-kpi.alert .v{color:#f87171}
#gev-insurance-panel .isp-kpi.warn .v{color:#fbbf24}
#gev-insurance-panel .isp-nav{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px}
#gev-insurance-panel .isp-btn{min-height:44px;border-radius:12px;border:1px solid rgba(52,211,153,.35);background:rgba(52,211,153,.1);color:#eaf4ff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;padding:10px 12px;text-align:left}
#gev-insurance-panel .isp-btn:active{background:rgba(52,211,153,.22)}
#gev-insurance-panel .isp-tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
#gev-insurance-panel .isp-tool{min-height:44px;padding:10px 14px;border-radius:10px;border:1px solid rgba(125,211,252,.35);background:rgba(125,211,252,.08);color:#eaf4ff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
#gev-insurance-panel .isp-note{font-size:11px;color:#9fb0c9;line-height:1.5}
#gev-insurance-panel .isp-err{font-size:12px;color:#f87171;margin-top:8px}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-insurance-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-insurance-styles';
  style.textContent = INS_CSS;
  document.head.appendChild(style);
}

/** Build the four stat cards from a state snapshot. Exported for tests. */
export function statCards(state, engine, lang = 'es') {
  const eng = engine || defaultEngine;
  const businesses = state?.businesses || {};
  const gaps = eng.gapCount(businesses);
  const renewals = eng.renewalsWithin(businesses, 30).length;
  const allClaims = Object.values(businesses).flatMap((b) => b?.claims || []);
  const openAll = allClaims.filter(
    (c) => Number(c?.stage) <= eng.OPEN_CLAIM_MAX_STAGE,
  ).length;
  const quotes = Array.isArray(state?.quotes) ? state.quotes.length : 0;
  const L = lang === 'es';
  return [
    {
      id: 'gaps',
      label: L ? 'Brechas de cobertura' : 'Coverage gaps',
      value: gaps,
      tone: gaps > 0 ? 'alert' : '',
    },
    {
      id: 'renewals',
      label: L ? 'Renovaciones ≤ 30 días' : 'Renewals ≤ 30 days',
      value: renewals,
      tone: renewals > 0 ? 'warn' : '',
    },
    {
      id: 'claims',
      label: L ? 'Reclamos abiertos' : 'Open claims',
      value: openAll,
      tone: openAll > 0 ? 'warn' : '',
    },
    {
      id: 'quotes',
      label: L ? 'Cotizaciones' : 'Quotes tracked',
      value: quotes,
      tone: '',
    },
  ];
}

const DEEP_LINKS = [
  { view: 'coverage', es: '📋 Cobertura', en: '📋 Coverage' },
  { view: 'claims', es: '📝 Reclamos', en: '📝 Claims' },
  { view: 'attorney', es: '⚖️ Abogados', en: '⚖️ Attorney claims' },
  { view: 'shop', es: '🛒 Cotizar', en: '🛒 Shop quotes' },
];

/**
 * initInsuranceDashboard(root, { store, engine, signal })
 * store: insurance store (createInsuranceStore()); engine: insuranceEngine module.
 */
export function initInsuranceDashboard(
  root = null,
  { store = null, engine = defaultEngine, signal = null } = {},
) {
  void root;
  injectStyles();
  const eng = engine || defaultEngine;
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
  const t = (es, en) => (lang === 'es' ? es : en);
  const refs = { kpis: null, err: null, fileInput: null };

  function openDeepLink(view) {
    const url = `/insurance/#${view}`;
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

  function renderKpis() {
    if (!refs.kpis) return;
    let state = null;
    try {
      state = store?.getState() || null;
    } catch {
      state = null;
    }
    const cards = statCards(state, eng, lang);
    refs.kpis.innerHTML = '';
    for (const c of cards) {
      const el = document.createElement('div');
      el.className = `isp-kpi${c.tone ? ` ${c.tone}` : ''}`;
      el.dataset.card = c.id;
      const k = document.createElement('div');
      k.className = 'k';
      k.textContent = c.label;
      const v = document.createElement('div');
      v.className = 'v';
      v.textContent = String(c.value);
      el.appendChild(k);
      el.appendChild(v);
      refs.kpis.appendChild(el);
    }
  }

  function refresh() {
    if (!panelEl || aborted.current) return;
    renderKpis();
  }

  function doExport() {
    let state = null;
    try {
      state = store?.getState() || null;
    } catch {
      state = null;
    }
    exportBackup(state || { businesses: {} });
  }

  function doImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseBackup(String(reader.result || ''), lang);
        const ok = store?.saveState(parsed);
        if (refs.err)
          refs.err.textContent = ok
            ? t('Copia restaurada.', 'Backup restored.')
            : t('No se pudo guardar.', 'Could not save.');
        refresh();
      } catch (e) {
        if (refs.err) refs.err.textContent = e?.message || String(e);
      }
    };
    reader.readAsText(file);
  }

  function open() {
    if (aborted.current || typeof document === 'undefined') return null;
    if (panelEl) {
      refresh();
      return panelEl;
    }
    panelEl = document.createElement('div');
    panelEl.id = 'gev-insurance-panel';
    const head = document.createElement('div');
    head.className = 'isp-head';
    const title = document.createElement('div');
    title.className = 'isp-title';
    title.textContent = t(
      'SEGUROS · CENTRO DE COMANDO',
      'INSURANCE · COMMAND CENTER',
    );
    const langBtn = document.createElement('button');
    langBtn.className = 'isp-lang';
    langBtn.type = 'button';
    langBtn.textContent = 'ES / EN';
    langBtn.addEventListener('click', () =>
      setLang(lang === 'es' ? 'en' : 'es'),
    );
    const closeBtn = document.createElement('button');
    closeBtn.className = 'isp-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Cerrar / Close');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', close);
    head.appendChild(title);
    head.appendChild(langBtn);
    head.appendChild(closeBtn);
    panelEl.appendChild(head);

    const body = document.createElement('div');
    body.className = 'isp-body';
    const kpis = document.createElement('div');
    kpis.className = 'isp-kpis';
    body.appendChild(kpis);
    refs.kpis = kpis;

    const nav = document.createElement('div');
    nav.className = 'isp-nav';
    for (const link of DEEP_LINKS) {
      const b = document.createElement('button');
      b.className = 'isp-btn';
      b.type = 'button';
      b.textContent = t(link.es, link.en);
      b.addEventListener('click', () => openDeepLink(link.view));
      nav.appendChild(b);
    }
    body.appendChild(nav);

    const tools = document.createElement('div');
    tools.className = 'isp-tools';
    const expBtn = document.createElement('button');
    expBtn.className = 'isp-tool';
    expBtn.type = 'button';
    expBtn.textContent = t('📥 Exportar copia', '📥 Export backup');
    expBtn.addEventListener('click', doExport);
    const impBtn = document.createElement('button');
    impBtn.className = 'isp-tool';
    impBtn.type = 'button';
    impBtn.textContent = t('📤 Importar copia', '📤 Import backup');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      doImport(fileInput.files?.[0]);
      fileInput.value = '';
    });
    impBtn.addEventListener('click', () => fileInput.click());
    tools.appendChild(expBtn);
    tools.appendChild(impBtn);
    body.appendChild(tools);
    body.appendChild(fileInput);
    refs.fileInput = fileInput;

    const err = document.createElement('div');
    err.className = 'isp-err';
    body.appendChild(err);
    refs.err = err;

    const note = document.createElement('div');
    note.className = 'isp-note';
    note.textContent = t(
      'Los datos viven en este dispositivo (localStorage compartido con la app /insurance/). Nada se envía a ningún servidor.',
      'Data lives on this device (localStorage shared with the /insurance/ app). Nothing is sent to any server.',
    );
    body.appendChild(note);

    panelEl.appendChild(body);
    document.body.appendChild(panelEl);
    refresh();
    return panelEl;
  }

  function close() {
    panelEl?.remove();
    panelEl = null;
    refs.kpis = refs.err = refs.fileInput = null;
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'es';
    if (!panelEl) return lang;
    close();
    open();
    return lang;
  }

  if (typeof document !== 'undefined') {
    btnEl = document.createElement('button');
    btnEl.id = 'gev-insurance-btn';
    btnEl.type = 'button';
    btnEl.innerHTML =
      '<span style="font-size:20px">🛡️</span><span>Seguros</span>';
    btnEl.setAttribute('aria-label', 'Seguros / Insurance');
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
    openDeepLink,
    statCards: (state, l) => statCards(state, eng, l || lang),
    refs,
    destroy() {
      aborted.current = true;
      close();
      btnEl?.remove();
      btnEl = null;
    },
  };
  if (typeof window !== 'undefined') window.__gevInsurance = api;
  return api;
}
