/**
 * MY CUBA CASH Dashboard for GOD'S EYE VIEW — $0, no API keys, no external calls.
 *
 * Mission-control panel for the MY CUBA CASH beta (v0.9) remittance comparison
 * layer: KPI row with HONEST beta stats (zero customers/transactions/reviews
 * until real ones exist — nothing is ever invented), provider status pipeline,
 * provider cards, editable detail drawer with corridor math, a corridor
 * manager with per-provider FX rates, a fee-comparison tool, CSV
 * import/export, and a bilingual internal fee-comparison draft that is NEVER
 * sent anywhere.
 *
 * Pure helpers (STATUSES, statusPillClass, providersToCsv, corridorsToCsv,
 * providerCsvTemplate, corridorCsvTemplate, feeCompare, draftFeeComparisonText,
 * adaptStore, createMemoryProviderStore) are exported for unit tests. The live
 * DOM wiring lives in initCubacashDashboard(). This module intentionally does
 * NOT touch Cesium — the map layer owns the 3D entities.
 */

export const STATUSES = [
  { id: 'candidate', es: 'Candidatos', en: 'Candidates' },
  { id: 'verifying', es: 'Verificando', en: 'Verifying' },
  { id: 'live', es: 'En vivo', en: 'Live' },
  { id: 'paused', es: 'Pausados', en: 'Paused' },
];

const VALID_STATUSES = new Set(STATUSES.map((s) => s.id));

const PROVIDER_CSV_HEADERS = [
  'name',
  'channels',
  'coverageCountries',
  'feeModelType',
  'feePct',
  'feeFlat',
  'feeMin',
  'feeMax',
  'status',
  'website',
  'lat',
  'lng',
  'notes',
];

const CORRIDOR_CSV_HEADERS = [
  'fromCountry',
  'toCountry',
  'providerName',
  'sendAmount',
  'fxRate',
  'fxRateAsOf',
  'fromLat',
  'fromLng',
  'toLat',
  'toLng',
  'notes',
];

/** CSS pill class from a verdict tier or provider status. */
export function statusPillClass(status) {
  const s = String(status || '').toLowerCase();
  if (['green', 'yellow', 'red', 'gray'].includes(s)) return s;
  if (s === 'live') return 'green';
  if (s === 'verifying') return 'yellow';
  if (s === 'paused') return 'gray';
  return 'gray';
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function numOrBlank(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '';
}

/** Serialize providers to CSV (canonical headers). */
export function providersToCsv(providers = []) {
  const lines = [PROVIDER_CSV_HEADERS.join(',')];
  for (const p of providers || []) {
    const fm = p.feeModel || {};
    lines.push(
      [
        csvEscape(p.name),
        csvEscape((p.channels || []).join(';')),
        csvEscape((p.coverageCountries || []).join(';')),
        csvEscape(fm.type || 'undisclosed'),
        numOrBlank(fm.pct),
        numOrBlank(fm.flat),
        numOrBlank(fm.min),
        numOrBlank(fm.max),
        csvEscape(p.status || ''),
        csvEscape(p.website),
        numOrBlank(p.lat),
        numOrBlank(p.lng),
        csvEscape(p.notes),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Serialize corridors to CSV (canonical headers). */
export function corridorsToCsv(corridors = [], providersById = {}) {
  const lines = [CORRIDOR_CSV_HEADERS.join(',')];
  for (const c of corridors || []) {
    const provider =
      c.providerId && providersById[c.providerId]
        ? providersById[c.providerId]
        : null;
    lines.push(
      [
        csvEscape(c.fromCountry),
        csvEscape(c.toCountry),
        csvEscape(provider ? provider.name : c.providerName),
        numOrBlank(c.sendAmount),
        numOrBlank(c.fxRate),
        csvEscape(c.fxRateAsOf),
        numOrBlank(c.fromLat),
        numOrBlank(c.fromLng),
        numOrBlank(c.toLat),
        numOrBlank(c.toLng),
        csvEscape(c.notes),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Downloadable provider template — sample row is clearly fictional. */
export function providerCsvTemplate() {
  const sample = [
    '"Sample Provider (fictional)"',
    'app;web',
    'USA;Spain',
    'flat',
    '',
    '3.99',
    '',
    '',
    'candidate',
    '',
    '',
    '',
    '"Sample row only — do not use (fila de ejemplo)"',
  ].join(',');
  return `${PROVIDER_CSV_HEADERS.join(',')}\n${sample}\n`;
}

/** Downloadable corridor template — sample row is clearly fictional. */
export function corridorCsvTemplate() {
  const sample = [
    '"USA (sample)"',
    '"Cuba (sample)"',
    '"Sample Provider (fictional)"',
    '100',
    '100',
    '2026-09-17',
    '25.76',
    '-80.19',
    '23.13',
    '-82.37',
    '"Sample row only — do not use (fila de ejemplo)"',
  ].join(',');
  return `${CORRIDOR_CSV_HEADERS.join(',')}\n${sample}\n`;
}

/**
 * Fee comparison across providers for one send amount.
 * Wraps the corridor engine defensively; returns [] on any failure.
 * corridors carry the fxRate per provider ({ [providerId]: corridor }).
 */
export function feeCompare(corridorEngine, amount, providers, fxByProvider) {
  try {
    if (
      !corridorEngine ||
      typeof corridorEngine.compareProviders !== 'function'
    )
      return [];
    return (
      corridorEngine.compareProviders({ amount, providers, fxByProvider }) || []
    );
  } catch {
    return [];
  }
}

/**
 * Honest beta stats banner lines. Customers/transactions/reviews are ALWAYS
 * zero in this layer — real counts live in the production platform, never in
 * the visual OS.
 */
export function betaBanner(t) {
  const tx = typeof t === 'function' ? t : (es, en) => es;
  return [
    tx(
      'Beta v0.9 — 0 clientes verificados · 0 transacciones · 0 reseñas',
      'Beta v0.9 — 0 verified customers · 0 transactions · 0 reviews',
    ),
    tx(
      'Sin datos inventados: los conteos solo cambian con datos reales.',
      'No invented data: counts only change with real data.',
    ),
  ];
}

/**
 * Internal fee-comparison draft text (bilingual). NEVER sent anywhere —
 * it stays inside the panel for Juan to copy by hand if he wants.
 */
export function draftFeeComparisonText(rows = [], amount, lang = 'es') {
  const L = lang === 'es';
  const lines = [
    L
      ? `Comparación de tarifas — envío de $${amount} (BORRADOR INTERNO, no enviado)`
      : `Fee comparison — $${amount} send (INTERNAL DRAFT, not sent)`,
    '',
  ];
  const complete = (rows || []).filter((r) => r && r.complete);
  if (complete.length === 0) {
    lines.push(
      L
        ? 'Sin datos completos: faltan tarifas de proveedor o tasas de cambio. Nada se inventó.'
        : 'No complete data: provider fees or FX rates are missing. Nothing was invented.',
    );
    return lines.join('\n');
  }
  for (const r of complete) {
    const fee = r.fee !== null ? `$${r.fee.toFixed(2)}` : '—';
    const received =
      r.receivedAmount !== null ? `$${r.receivedAmount.toFixed(2)}` : '—';
    const asOf = r.fxAsOf
      ? ` (${L ? 'tasa al' : 'rate as of'} ${r.fxAsOf})`
      : '';
    lines.push(
      `• ${r.name}: ${L ? 'tarifa' : 'fee'} ${fee} → ${L ? 'recibe' : 'receives'} ${received}${asOf}`,
    );
  }
  lines.push('');
  lines.push(
    L
      ? 'Tasas ingresadas manualmente por Juan. Verifica antes de enviar.'
      : 'Rates entered manually by Juan. Verify before sending.',
  );
  return lines.join('\n');
}

/**
 * Normalize any provider-store-like object to the interface this dashboard
 * uses. Accepts the real cubacash store ({ listProviders(), getProvider(),
 * createProvider(), updateProvider(), moveProvider(), deleteProvider(),
 * listCorridors(), createCorridor(), ... }) as well as the minimal double
 * shape used in tests.
 */
export function adaptStore(raw) {
  if (!raw) return adaptStore(createMemoryProviderStore());
  const byId = (id) => {
    try {
      if (typeof raw.byId === 'function') return raw.byId(id);
      if (typeof raw.getProvider === 'function') return raw.getProvider(id);
    } catch {
      /* noop */
    }
    return null;
  };
  const list = (status) => {
    try {
      if (typeof raw.list === 'function') return raw.list(status) || [];
      if (typeof raw.listProviders === 'function') {
        const all = raw.listProviders() || [];
        return status ? all.filter((p) => p.status === status) : all;
      }
    } catch {
      /* fall through */
    }
    return [];
  };
  const update = (id, patch) => {
    try {
      if (typeof raw.update === 'function') return raw.update(id, patch);
      if (typeof raw.updateProvider === 'function')
        return raw.updateProvider(id, patch);
    } catch {
      /* noop */
    }
    return null;
  };
  const addMany = (arr) => {
    try {
      if (typeof raw.addMany === 'function') return raw.addMany(arr) || [];
      if (typeof raw.createProvider === 'function') {
        return (arr || []).map((p) => raw.createProvider(p)).filter(Boolean);
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
      /* fall through */
    }
    try {
      const provider = byId(id);
      return ((provider && provider.agentNotes) || []).map((n) => ({
        ts: n.at || n.t || Date.now(),
        author: n.agent || '',
        textEs: n.es || '',
        textEn: n.en || '',
      }));
    } catch {
      return [];
    }
  };
  const addNote = (id, es, en) => {
    try {
      if (typeof raw.addProviderNote === 'function')
        return raw.addProviderNote(id, 'panel', es, en);
    } catch {
      /* noop */
    }
    return null;
  };
  const listCorridors = () => {
    try {
      if (typeof raw.listCorridors === 'function')
        return raw.listCorridors() || [];
      if (Array.isArray(raw.corridors)) return raw.corridors;
    } catch {
      /* fall through */
    }
    return [];
  };
  return {
    list,
    byId,
    update,
    addMany,
    move(id, status) {
      try {
        if (typeof raw.move === 'function') return raw.move(id, status);
        if (typeof raw.moveProvider === 'function')
          return raw.moveProvider(id, status);
        return update(id, { status });
      } catch {
        return null;
      }
    },
    remove(id) {
      try {
        if (typeof raw.remove === 'function') return raw.remove(id);
        if (typeof raw.deleteProvider === 'function')
          return raw.deleteProvider(id);
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
            totalProviders: 0,
            liveProviders: 0,
            byStatus: {},
            totalCorridors: 0,
          }
        );
      } catch {
        return {
          totalProviders: 0,
          liveProviders: 0,
          byStatus: {},
          totalCorridors: 0,
        };
      }
    },
    listCorridors,
    addCorridor(data) {
      try {
        if (typeof raw.addCorridor === 'function')
          return raw.addCorridor(data) || null;
        if (typeof raw.createCorridor === 'function')
          return raw.createCorridor(data) || null;
      } catch {
        /* noop */
      }
      return null;
    },
    updateCorridor(id, patch) {
      try {
        if (typeof raw.updateCorridor === 'function')
          return raw.updateCorridor(id, patch) || null;
      } catch {
        /* noop */
      }
      return null;
    },
    removeCorridor(id) {
      try {
        if (typeof raw.removeCorridor === 'function')
          return raw.removeCorridor(id) || null;
        if (typeof raw.deleteCorridor === 'function')
          return raw.deleteCorridor(id) || null;
      } catch {
        /* noop */
      }
      return null;
    },
  };
}

/** In-memory provider store exposing the real store's API, for tests. */
export function createMemoryProviderStore(seed = []) {
  let providers = Array.isArray(seed) ? seed.map((p) => ({ ...p })) : [];
  let corridors = [];
  let seq = 1;
  const nextId = () => `mem-${seq++}`;
  return {
    listProviders: (filter) => {
      const all = providers.map((p) => ({ ...p }));
      if (typeof filter === 'function') return all.filter(filter);
      return all;
    },
    getProvider: (id) => {
      const p = providers.find((x) => x.id === id);
      return p ? { ...p } : null;
    },
    createProvider: (data) => {
      const p = { id: nextId(), status: 'candidate', ...(data || {}) };
      providers.push(p);
      return { ...p };
    },
    updateProvider: (id, patch) => {
      const p = providers.find((x) => x.id === id);
      if (!p) return null;
      Object.assign(p, patch, { id: p.id });
      return { ...p };
    },
    moveProvider: (id, status) => {
      const p = providers.find((x) => x.id === id);
      if (!p) return null;
      p.status = status;
      return { ...p };
    },
    deleteProvider: (id) => {
      const i = providers.findIndex((x) => x.id === id);
      if (i < 0) return false;
      providers.splice(i, 1);
      return true;
    },
    listCorridors: () => corridors.map((c) => ({ ...c })),
    createCorridor: (data) => {
      const c = { id: nextId(), ...(data || {}) };
      corridors.push(c);
      return { ...c };
    },
    updateCorridor: (id, patch) => {
      const c = corridors.find((x) => x.id === id);
      if (!c) return null;
      Object.assign(c, patch, { id: c.id });
      return { ...c };
    },
    deleteCorridor: (id) => {
      const i = corridors.findIndex((x) => x.id === id);
      if (i < 0) return false;
      corridors.splice(i, 1);
      return true;
    },
    addProviderNote: () => null,
    stats: () => ({
      totalProviders: providers.length,
      liveProviders: providers.filter((p) => p.status === 'live').length,
      byStatus: providers.reduce((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      }, {}),
      totalCorridors: corridors.length,
      betaCustomers: 0,
      betaTransactions: 0,
      betaReviews: 0,
    }),
    __reset: () => {
      providers = [];
      corridors = [];
    },
  };
}

function defaultMoney(n) {
  const v = Number(n);
  const shown = Number.isFinite(v) ? v : 0;
  return `$${shown.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/**
 * Dashboard stylesheet — phone-first readability is a hard requirement:
 * solid high-contrast panel, 44px minimum touch targets, 16px inputs (no
 * iOS auto-zoom), uppercase section headings, full-screen sheet on narrow
 * screens. Nothing is hover-dependent: every action is a tap/click.
 * Exported so tests can assert the touch-target and contrast rules.
 */
export const CUBACASH_CSS = [
  '.mcc-panel{position:fixed;top:64px;right:12px;bottom:12px;width:min(560px,94vw);',
  'background:#0b1220;color:#f3f4f6;border:1px solid #374151;border-radius:12px;font-size:15px;',
  'display:flex;flex-direction:column;z-index:60;box-shadow:0 8px 40px rgba(0,0,0,.6)}',
  '.mcc-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #374151;gap:8px}',
  '.mcc-title{font-weight:800;font-size:17px;letter-spacing:.02em}',
  '.mcc-body{overflow-y:auto;padding:14px;flex:1}',
  '.mcc-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}',
  '.mcc-kpi{background:#111c30;border:1px solid #374151;border-radius:10px;padding:10px 12px}',
  '.mcc-kpi .k{font-size:11px;font-weight:700;color:#d1d5db;letter-spacing:.08em}',
  '.mcc-kpi .v{font-size:24px;font-weight:800;margin-top:4px;color:#ffffff}',
  '.mcc-banner{background:#3b2f0b;border:1px solid #d97706;color:#fef3c7;border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:12px}',
  '.mcc-cols{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}',
  '.mcc-col{background:#111c30;border:1px solid #374151;border-radius:10px;padding:10px;min-height:96px}',
  '.mcc-colhead{font-size:13px;font-weight:800;color:#e5e7eb;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em}',
  '.mcc-card{background:#16233a;border:1px solid #4b5563;border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;min-height:44px}',
  '.mcc-card:hover{border-color:#38bdf8}',
  '.mcc-empty{color:#9ca3af;font-size:13px}',
  '.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:800}',
  '.pill.green{background:#052e16;color:#86efac}.pill.yellow{background:#3b2f0b;color:#fde68a}',
  '.pill.red{background:#450a0a;color:#fca5a5}.pill.gray{background:#1f2937;color:#d1d5db}',
  '.mcc-section{margin-top:18px}',
  '.mcc-section h4{font-size:15px;font-weight:800;margin:0 0 10px;color:#ffffff;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #4b5563;padding-bottom:8px}',
  '.mcc-h4{font-size:15px;font-weight:800;margin:14px 0 10px;color:#ffffff;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #4b5563;padding-bottom:8px}',
  '.mcc-row{display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap}',
  '.mcc-input{background:#0b1220;border:1px solid #6b7280;color:#ffffff;border-radius:8px;padding:10px 12px;font-size:16px;flex:1;min-width:90px;min-height:44px}',
  '.mcc-btn{background:#0e7490;border:1px solid #155e75;color:#fff;border-radius:8px;padding:10px 16px;font-size:15px;font-weight:700;cursor:pointer;min-height:44px}',
  '.mcc-btn:hover{background:#155e75}',
  '.mcc-btn.ghost{background:#16233a;border-color:#6b7280}',
  '.mcc-btn:focus-visible,.mcc-input:focus-visible,.mcc-card:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}',
  '.mcc-table{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px}',
  '.mcc-table th,.mcc-table td{border-bottom:1px solid #374151;padding:8px 6px;text-align:left}',
  '.mcc-table th{color:#d1d5db;font-weight:700}',
  '.mcc-drawer{border-top:2px solid #4b5563;padding:14px;max-height:50%;overflow-y:auto;background:#0a0f1a}',
  '.mcc-note{font-size:13px;color:#e5e7eb;border-left:3px solid #38bdf8;padding:6px 10px;margin:8px 0}',
  '.mcc-note .who{color:#38bdf8;font-weight:700}',
  '.mcc-draft{white-space:pre-wrap;font-size:13px;background:#0b1220;border:1px dashed #d97706;border-radius:8px;padding:10px}',
  '.mcc-dockbtn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:10px 16px;',
  'font-size:15px;font-weight:800;background:#0e7490;color:#fff;border:1px solid #155e75;border-radius:10px;cursor:pointer}',
  '.mcc-lang{background:#16233a;border:1px solid #6b7280;color:#fff;border-radius:8px;min-width:44px;min-height:44px;font-size:14px;font-weight:800;cursor:pointer}',
  '.mcc-manage{background:#16233a;border:1px solid #6b7280;color:#e5e7eb;font-size:13px;font-weight:700;cursor:pointer;border-radius:8px;min-height:44px;padding:6px 12px;font-family:inherit}',
  '.mcc-close{background:#16233a;border:1px solid #6b7280;color:#e5e7eb;font-size:22px;font-weight:700;cursor:pointer;border-radius:8px;min-width:44px;min-height:44px;line-height:1}',
  // Phone sheet: full-screen panel, single-column pipeline — one thumb away.
  '@media (max-width:640px){',
  '.mcc-panel{top:0;right:0;bottom:0;left:0;width:100%;border-radius:0;border:none}',
  '.mcc-cols{grid-template-columns:1fr}',
  '.mcc-kpis{grid-template-columns:repeat(3,1fr)}',
  '.mcc-body{padding:12px}',
  '}',
].join('');

export const DOCK_BUTTON_ID = 'gev-cubacash-btn';

function injectStyles() {
  try {
    if (typeof document === 'undefined') return;
    if (document.getElementById('mcc-dashboard-styles')) return;
    const style = document.createElement('style');
    style.id = 'mcc-dashboard-styles';
    style.textContent = CUBACASH_CSS;
    document.head.appendChild(style);
  } catch {
    /* non-browser runtimes */
  }
}

/**
 * Init the MY CUBA CASH dashboard.
 *
 * @param {object} opts
 * @param {object} opts.providerStore — cubacash provider store.
 * @param {object} opts.corridorEngine — { corridorMath, compareProviders, formatMoney, providerFee }.
 * @param {object} [opts.corridorMap]  — map layer ({ refresh(), flyToProvider() }).
 * @param {object} [opts.workforce]    — workforce handle ({ processOnce() }).
 * @param {object} [opts.signal]       — optional abort signal.
 * @param {function} [opts.parseCsv]   — CSV text → { providers, corridors, errors }.
 * @returns {{ open(), close(), toggle(), destroy(), openDrawer(id) }}
 */
export function initCubacashDashboard({
  providerStore = null,
  corridorEngine = null,
  corridorMap = null,
  workforce = null,
  signal = null,
  parseCsv = null,
  onOpenManagement = null,
} = {}) {
  injectStyles();
  const store = adaptStore(providerStore);
  const fmtMoney =
    typeof corridorEngine?.formatMoney === 'function'
      ? corridorEngine.formatMoney
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
  const t = (es, en) => (lang === 'es' ? es : en);
  const refs = {
    kpis: null,
    banner: null,
    cols: null,
    corridors: null,
    compare: null,
    draft: null,
    drawer: null,
    importStatus: null,
  };

  /**
   * Deep-link to the standalone full-screen MY CUBA CASH screen
   * (/cubacash/index.html#<view>) — same pattern as the insurance panel.
   */
  function openDeepLink(view) {
    const url = `/cubacash/index.html#${view}`;
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

  function statusLabel(id) {
    const s = STATUSES.find((x) => x.id === id);
    return s ? t(s.es, s.en) : id;
  }

  function renderKpis() {
    if (!refs.kpis) return;
    let stats = { totalProviders: 0, liveProviders: 0, totalCorridors: 0 };
    try {
      stats = store.stats() || stats;
    } catch {
      /* keep defaults */
    }
    const rows = [
      [t('PROVEEDORES', 'PROVIDERS'), stats.totalProviders],
      [t('EN VIVO', 'LIVE'), stats.liveProviders],
      [t('CORREDORES', 'CORRIDORS'), stats.totalCorridors],
    ];
    refs.kpis.innerHTML = rows
      .map(
        ([k, v]) =>
          `<div class="mcc-kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`,
      )
      .join('');
  }

  function renderBanner() {
    if (!refs.banner) return;
    const [line1, line2] = betaBanner(t);
    refs.banner.innerHTML = `<div>${line1}</div><div style="margin-top:4px">${line2}</div>`;
  }

  function providerById(id) {
    try {
      return store.byId(id) || null;
    } catch {
      return null;
    }
  }

  function renderColumns() {
    if (!refs.cols) return;
    refs.cols.innerHTML = '';
    for (const st of STATUSES) {
      const col = document.createElement('div');
      col.className = 'mcc-col';
      const head = document.createElement('div');
      head.className = 'mcc-colhead';
      const cards = document.createElement('div');
      let providers = [];
      try {
        providers = store.list(st.id) || [];
      } catch {
        providers = [];
      }
      head.textContent = `${statusLabel(st.id)} (${providers.length})`;
      if (!providers.length) {
        const empty = document.createElement('div');
        empty.className = 'mcc-empty';
        empty.textContent = t('Sin proveedores', 'No providers');
        cards.appendChild(empty);
      }
      for (const p of providers) {
        const card = document.createElement('div');
        card.className = 'mcc-card';
        const name = document.createElement('div');
        name.style.fontWeight = '700';
        name.style.fontSize = '13px';
        name.textContent = p.name || t('(sin nombre)', '(no name)');
        const meta = document.createElement('div');
        meta.style.fontSize = '11px';
        meta.style.color = '#9ca3af';
        meta.style.marginTop = '4px';
        const pill = document.createElement('span');
        pill.className = `pill ${statusPillClass(p.status)}`;
        pill.textContent = statusLabel(p.status);
        const fm = p.feeModel || {};
        const feeText =
          fm.type && fm.type !== 'undisclosed'
            ? t('tarifa declarada', 'fee disclosed')
            : t('tarifa sin declarar', 'fee undisclosed');
        const info = document.createElement('span');
        info.style.marginLeft = '8px';
        info.textContent = feeText;
        meta.appendChild(pill);
        meta.appendChild(info);
        card.appendChild(name);
        card.appendChild(meta);
        card.addEventListener('click', () => openDrawer(p.id));
        cards.appendChild(card);
      }
      col.appendChild(head);
      col.appendChild(cards);
      refs.cols.appendChild(col);
    }
  }

  function corridorProviderName(corridor) {
    if (!corridor || !corridor.providerId)
      return t('Sin proveedor', 'No provider');
    const p = providerById(corridor.providerId);
    return p ? p.name : t('Proveedor eliminado', 'Provider removed');
  }

  function renderCorridors() {
    if (!refs.corridors) return;
    let corridors = [];
    try {
      corridors = store.listCorridors() || [];
    } catch {
      corridors = [];
    }
    if (!corridors.length) {
      refs.corridors.innerHTML = `<div class="mcc-empty">${t(
        'Sin corredores. Agrega el primero abajo.',
        'No corridors. Add the first one below.',
      )}</div>`;
      return;
    }
    const rows = corridors
      .map((c) => {
        const label = `${c.fromCountry || '?'} → ${c.toCountry || '?'}`;
        const amount = c.sendAmount ? fmtMoney(c.sendAmount) : '—';
        const rate = c.fxRate
          ? `${c.fxRate}${c.fxRateAsOf ? ` (${c.fxRateAsOf})` : ''}`
          : t('sin tasa', 'no rate');
        return `<tr data-corridor="${c.id}"><td>${label}</td><td>${corridorProviderName(c)}</td><td>${amount}</td><td>${rate}</td></tr>`;
      })
      .join('');
    refs.corridors.innerHTML = `
      <table class="mcc-table">
        <thead><tr>
          <th>${t('Corredor', 'Corridor')}</th><th>${t('Proveedor', 'Provider')}</th>
          <th>${t('Monto', 'Amount')}</th><th>${t('Tasa', 'Rate')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderCompare() {
    if (!refs.compare) return;
    refs.compare.innerHTML = `
      <h4>${t('Comparar tarifas', 'Compare fees')}</h4>
      <div class="mcc-row">
        <input class="mcc-input" data-mcc="cmp-amount" type="number" min="1" step="1"
          placeholder="${t('Monto USD', 'USD amount')}" value="100" />
        <button class="mcc-btn" data-mcc="cmp-run">${t('Comparar', 'Compare')}</button>
      </div>
      <div data-mcc="cmp-result"></div>`;
    const run = refs.compare.querySelector('[data-mcc="cmp-run"]');
    run.addEventListener('click', () => {
      const amountInput = refs.compare.querySelector('[data-mcc="cmp-amount"]');
      const amount = Number(amountInput.value);
      const result = refs.compare.querySelector('[data-mcc="cmp-result"]');
      let providers = [];
      let corridors = [];
      try {
        providers = store.list() || [];
        corridors = store.listCorridors() || [];
      } catch {
        /* keep empty */
      }
      const fxByProvider = {};
      for (const c of corridors) {
        if (
          c.providerId &&
          Number(c.fxRate) > 0 &&
          !fxByProvider[c.providerId]
        ) {
          fxByProvider[c.providerId] = {
            rate: Number(c.fxRate),
            asOf: c.fxRateAsOf || '',
          };
        }
      }
      const rows = feeCompare(corridorEngine, amount, providers, fxByProvider);
      if (!rows.length) {
        result.innerHTML = `<div class="mcc-empty">${t(
          'Sin proveedores para comparar.',
          'No providers to compare.',
        )}</div>`;
        return;
      }
      const body = rows
        .map((r) => {
          const fee =
            r.fee !== null ? fmtMoney(r.fee) : t('sin declarar', 'undisclosed');
          const received =
            r.receivedAmount !== null ? fmtMoney(r.receivedAmount) : '—';
          const missing =
            r.missing && r.missing.length
              ? ` <span style="color:#9ca3af">(${r.missing.map((m) => t(m.es, m.en)).join(', ')})</span>`
              : '';
          return `<tr><td>${r.name || '—'}</td><td>${fee}</td><td>${received}</td><td>${missing || '✓'}</td></tr>`;
        })
        .join('');
      result.innerHTML = `
        <table class="mcc-table">
          <thead><tr>
            <th>${t('Proveedor', 'Provider')}</th><th>${t('Tarifa', 'Fee')}</th>
            <th>${t('Recibe', 'Receives')}</th><th>${t('Datos', 'Data')}</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>`;
    });
  }

  function renderDraft() {
    if (!refs.draft) return;
    refs.draft.innerHTML = `
      <h4>${t('Borrador de comparación (interno)', 'Comparison draft (internal)')}</h4>
      <div class="mcc-draft" data-mcc="draft-text">${t(
        'Pulsa "Generar" para crear el borrador. Nunca se envía solo.',
        'Press "Generate" to create the draft. It is never sent on its own.',
      )}</div>
      <div class="mcc-row" style="margin-top:6px">
        <button class="mcc-btn" data-mcc="draft-gen">${t('Generar', 'Generate')}</button>
      </div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px">${t(
        'Borrador interno: Juan lo copia a mano si lo quiere usar.',
        'Internal draft: Juan copies it by hand if he wants to use it.',
      )}</div>`;
    const gen = refs.draft.querySelector('[data-mcc="draft-gen"]');
    gen.addEventListener('click', () => {
      const amountInput = refs.compare?.querySelector(
        '[data-mcc="cmp-amount"]',
      );
      const amount = amountInput ? Number(amountInput.value) || 100 : 100;
      let providers = [];
      let corridors = [];
      try {
        providers = store.list() || [];
        corridors = store.listCorridors() || [];
      } catch {
        /* keep empty */
      }
      const fxByProvider = {};
      for (const c of corridors) {
        if (
          c.providerId &&
          Number(c.fxRate) > 0 &&
          !fxByProvider[c.providerId]
        ) {
          fxByProvider[c.providerId] = {
            rate: Number(c.fxRate),
            asOf: c.fxRateAsOf || '',
          };
        }
      }
      const rows = feeCompare(corridorEngine, amount, providers, fxByProvider);
      const text = draftFeeComparisonText(rows, amount, lang);
      const box = refs.draft.querySelector('[data-mcc="draft-text"]');
      box.textContent = text;
    });
  }

  function renderDrawer() {
    if (!refs.drawer) return;
    const provider = selectedId ? providerById(selectedId) : null;
    if (!provider) {
      refs.drawer.style.display = 'none';
      refs.drawer.innerHTML = '';
      return;
    }
    refs.drawer.style.display = '';
    const fm = provider.feeModel || { type: 'undisclosed' };
    const channels = (provider.channels || []).join(', ') || '—';
    const coverage = (provider.coverageCountries || []).join(', ') || '—';
    const feeDesc =
      fm.type === 'percentage'
        ? `${fm.pct}%`
        : fm.type === 'flat'
          ? fmtMoney(fm.flat)
          : fm.type === 'mixed'
            ? `${fmtMoney(fm.flat)} + ${fm.pct}%`
            : t('Sin declarar', 'Undisclosed');
    let notes = [];
    try {
      notes = store.notes(provider.id) || [];
    } catch {
      notes = [];
    }
    const notesHtml = notes.length
      ? notes
          .map(
            (n) =>
              `<div class="mcc-note"><span class="who">${n.author || ''}</span> — ${t(n.textEs, n.textEn)}</div>`,
          )
          .join('')
      : `<div class="mcc-empty">${t('Sin notas', 'No notes')}</div>`;
    const statusOptions = STATUSES.map(
      (s) =>
        `<option value="${s.id}"${provider.status === s.id ? ' selected' : ''}>${t(s.es, s.en)}</option>`,
    ).join('');
    const providerCorridors = [];
    try {
      for (const c of store.listCorridors() || []) {
        if (c.providerId === provider.id) providerCorridors.push(c);
      }
    } catch {
      /* ignore */
    }
    const corridorRows = providerCorridors.length
      ? providerCorridors
          .map(
            (c) =>
              `<tr><td>${c.fromCountry || '?'} → ${c.toCountry || '?'}</td>` +
              `<td>${c.sendAmount ? fmtMoney(c.sendAmount) : '—'}</td>` +
              `<td>${c.fxRate ? `${c.fxRate}${c.fxRateAsOf ? ` (${c.fxRateAsOf})` : ''}` : t('sin tasa', 'no rate')}</td></tr>`,
          )
          .join('')
      : `<tr><td colspan="3" class="mcc-empty">${t('Sin corredores', 'No corridors')}</td></tr>`;
    refs.drawer.innerHTML = `
      <div class="mcc-row" style="justify-content:space-between;align-items:center">
        <strong style="font-size:14px">${provider.name || t('(sin nombre)', '(no name)')}</strong>
        <button class="mcc-close" data-mcc="drawer-close">×</button>
      </div>
      <div class="mcc-row">
        <select class="mcc-input" data-mcc="p-status" style="flex:0 1 160px">${statusOptions}</select>
        <button class="mcc-btn" data-mcc="p-save">${t('Guardar', 'Save')}</button>
        <button class="mcc-btn ghost" data-mcc="p-fly">${t('Ver en mapa', 'View on map')}</button>
      </div>
      <div style="font-size:12px;color:#9ca3af;margin:6px 0">
        ${t('Canales', 'Channels')}: ${channels} ·
        ${t('Cobertura', 'Coverage')}: ${coverage} ·
        ${t('Tarifa', 'Fee')}: ${feeDesc}
      </div>
      <div class="mcc-row">
        <input class="mcc-input" data-mcc="p-website" placeholder="${t('Sitio web', 'Website')}" value="${provider.website || ''}" />
      </div>
      <div class="mcc-row">
        <textarea class="mcc-input" data-mcc="p-notes" rows="2" placeholder="${t('Notas', 'Notes')}">${provider.notes || ''}</textarea>
      </div>
      <h4 class="mcc-h4">${t('Corredores', 'Corridors')}</h4>
      <table class="mcc-table"><tbody>${corridorRows}</tbody></table>
      <h4 class="mcc-h4">${t('Notas de la fuerza', 'Workforce notes')}</h4>
      ${notesHtml}`;
    refs.drawer
      .querySelector('[data-mcc="drawer-close"]')
      .addEventListener('click', () => {
        selectedId = null;
        renderDrawer();
      });
    refs.drawer
      .querySelector('[data-mcc="p-save"]')
      .addEventListener('click', () => {
        const status = refs.drawer.querySelector('[data-mcc="p-status"]').value;
        const website = refs.drawer.querySelector(
          '[data-mcc="p-website"]',
        ).value;
        const notesText = refs.drawer.querySelector(
          '[data-mcc="p-notes"]',
        ).value;
        try {
          store.move(provider.id, status);
          store.update(provider.id, { website, notes: notesText });
        } catch {
          /* noop */
        }
        refresh();
        try {
          corridorMap?.refresh?.();
        } catch {
          /* noop */
        }
      });
    refs.drawer
      .querySelector('[data-mcc="p-fly"]')
      .addEventListener('click', () => {
        try {
          corridorMap?.flyToProvider?.(provider.id);
        } catch {
          /* noop */
        }
      });
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'mcc-panel';
    panel.innerHTML = `
      <div class="mcc-head">
        <div class="mcc-title">${t('MY CUBA CASH · Centro de control', 'MY CUBA CASH · Mission control')}</div>
        <div class="mcc-row" style="margin-bottom:0">
          <button class="mcc-manage" data-mcc="manage">⚙️ Gestionar / Manage</button>
          <button class="mcc-lang" data-mcc="lang" aria-label="Idioma / Language">${lang === 'es' ? 'ES' : 'EN'}</button>
          <button class="mcc-close" data-mcc="close" aria-label="${t('Cerrar', 'Close')}">×</button>
        </div>
      </div>
      <div class="mcc-body">
        <div class="mcc-kpis" data-mcc="kpis"></div>
        <div class="mcc-banner" data-mcc="banner"></div>
        <div class="mcc-cols" data-mcc="cols"></div>
        <div class="mcc-section" data-mcc="corridors-sec">
          <h4>${t('Corredores de remesa', 'Remittance corridors')}</h4>
          <div data-mcc="corridors"></div>
          <div class="mcc-row" style="margin-top:8px">
            <input class="mcc-input" data-mcc="new-from" placeholder="${t('Origen (p. ej. USA)', 'From (e.g. USA)')}" />
            <input class="mcc-input" data-mcc="new-to" placeholder="${t('Destino (p. ej. Cuba)', 'To (e.g. Cuba)')}" />
          </div>
          <div class="mcc-row">
            <input class="mcc-input" data-mcc="new-amount" type="number" min="0" step="1" placeholder="${t('Monto USD', 'USD amount')}" />
            <input class="mcc-input" data-mcc="new-fx" type="number" min="0" step="0.01" placeholder="${t('Tasa (manual)', 'Rate (manual)')}" />
            <input class="mcc-input" data-mcc="new-fxasof" placeholder="${t('Tasa al (fecha)', 'Rate as of (date)')}" />
          </div>
          <div class="mcc-row">
            <button class="mcc-btn" data-mcc="new-add">${t('Agregar corredor', 'Add corridor')}</button>
          </div>
        </div>
        <div class="mcc-section" data-mcc="compare"></div>
        <div class="mcc-section" data-mcc="draft"></div>
        <div class="mcc-section">
          <h4>${t('Importar / Exportar CSV', 'Import / Export CSV')}</h4>
          <div class="mcc-row">
            <button class="mcc-btn" data-mcc="imp-providers">${t('Importar proveedores', 'Import providers')}</button>
            <button class="mcc-btn" data-mcc="imp-corridors">${t('Importar corredores', 'Import corridors')}</button>
          </div>
          <div class="mcc-row">
            <button class="mcc-btn ghost" data-mcc="exp-providers">${t('Exportar proveedores', 'Export providers')}</button>
            <button class="mcc-btn ghost" data-mcc="exp-corridors">${t('Exportar corredores', 'Export corridors')}</button>
          </div>
          <div class="mcc-row">
            <button class="mcc-btn ghost" data-mcc="tpl-providers">${t('Plantilla proveedores', 'Provider template')}</button>
            <button class="mcc-btn ghost" data-mcc="tpl-corridors">${t('Plantilla corredores', 'Corridor template')}</button>
          </div>
          <div class="mcc-empty" data-mcc="import-status" style="margin-top:6px"></div>
          <input type="file" accept=".csv,text/csv" data-mcc="file" style="display:none" />
        </div>
      </div>
      <div class="mcc-drawer" data-mcc="drawer" style="display:none"></div>`;
    refs.kpis = panel.querySelector('[data-mcc="kpis"]');
    refs.banner = panel.querySelector('[data-mcc="banner"]');
    refs.cols = panel.querySelector('[data-mcc="cols"]');
    refs.corridors = panel.querySelector('[data-mcc="corridors"]');
    refs.compare = panel.querySelector('[data-mcc="compare"]');
    refs.draft = panel.querySelector('[data-mcc="draft"]');
    refs.drawer = panel.querySelector('[data-mcc="drawer"]');
    refs.importStatus = panel.querySelector('[data-mcc="import-status"]');

    panel.querySelector('[data-mcc="close"]').addEventListener('click', close);
    panel.querySelector('[data-mcc="manage"]').addEventListener('click', () => { try { onOpenManagement && onOpenManagement('approvals'); } catch {} });
    panel
      .querySelector('[data-mcc="lang"]')
      .addEventListener('click', () => setLang(lang === 'es' ? 'en' : 'es'));

    // Add-corridor form.
    const val = (sel) => {
      const el = panel.querySelector(sel);
      return el ? el.value.trim() : '';
    };
    panel
      .querySelector('[data-mcc="new-add"]')
      .addEventListener('click', () => {
        const fromCountry = val('[data-mcc="new-from"]');
        const toCountry = val('[data-mcc="new-to"]');
        const amount = Number(val('[data-mcc="new-amount"]'));
        const fx = val('[data-mcc="new-fx"]');
        const fxAsOf = val('[data-mcc="new-fxasof"]');
        if (!fromCountry || !toCountry) {
          refs.importStatus.textContent = t(
            'Origen y destino son obligatorios.',
            'From and to countries are required.',
          );
          return;
        }
        if (fx && !fxAsOf) {
          refs.importStatus.textContent = t(
            'La tasa necesita su fecha ("tasa al"). Nada se guarda sin fecha.',
            'The rate needs its as-of date. Nothing is saved without a date.',
          );
          return;
        }
        try {
          store.addCorridor({
            fromCountry,
            toCountry,
            sendAmount: Number.isFinite(amount) && amount > 0 ? amount : 0,
            fxRate: fx ? Number(fx) : null,
            fxRateAsOf: fxAsOf,
          });
        } catch {
          /* noop */
        }
        refresh();
        try {
          corridorMap?.refresh?.();
        } catch {
          /* noop */
        }
      });

    // CSV import/export.
    const fileInput = panel.querySelector('[data-mcc="file"]');
    let importMode = 'providers';
    const download = (filename, text) => {
      try {
        const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch {
        /* noop */
      }
    };
    const wireImport = (btnSel, mode) => {
      panel.querySelector(btnSel).addEventListener('click', () => {
        importMode = mode;
        fileInput.click();
      });
    };
    wireImport('[data-mcc="imp-providers"]', 'providers');
    wireImport('[data-mcc="imp-corridors"]', 'corridors');
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed =
            typeof parseCsv === 'function'
              ? parseCsv(String(reader.result || ''))
              : { providers: [], corridors: [], errors: [] };
          const rows =
            importMode === 'providers'
              ? parsed.providers || []
              : parsed.corridors || [];
          let added = 0;
          for (const row of rows) {
            try {
              if (importMode === 'providers') {
                if (store.addMany([row]).length) added += 1;
              } else if (store.addCorridor(row)) {
                added += 1;
              }
            } catch {
              /* skip bad rows */
            }
          }
          const errors = (parsed.errors || []).length;
          refs.importStatus.textContent = t(
            `Importados: ${added}. Errores: ${errors}.`,
            `Imported: ${added}. Errors: ${errors}.`,
          );
          refresh();
          try {
            corridorMap?.refresh?.();
          } catch {
            /* noop */
          }
        } catch {
          refs.importStatus.textContent = t(
            'No se pudo leer el archivo.',
            'Could not read the file.',
          );
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    });
    panel
      .querySelector('[data-mcc="exp-providers"]')
      .addEventListener('click', () => {
        let providers = [];
        try {
          providers = store.list() || [];
        } catch {
          /* keep empty */
        }
        download('mycubacash-providers.csv', providersToCsv(providers));
      });
    panel
      .querySelector('[data-mcc="exp-corridors"]')
      .addEventListener('click', () => {
        let corridors = [];
        let providers = [];
        try {
          corridors = store.listCorridors() || [];
          providers = store.list() || [];
        } catch {
          /* keep empty */
        }
        const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
        download('mycubacash-corridors.csv', corridorsToCsv(corridors, byId));
      });
    panel
      .querySelector('[data-mcc="tpl-providers"]')
      .addEventListener('click', () => {
        download('mycubacash-providers-template.csv', providerCsvTemplate());
      });
    panel
      .querySelector('[data-mcc="tpl-corridors"]')
      .addEventListener('click', () => {
        download('mycubacash-corridors-template.csv', corridorCsvTemplate());
      });

    return panel;
  }

  function refresh() {
    if (aborted.current || !panelEl) return;
    renderKpis();
    renderBanner();
    renderColumns();
    renderCorridors();
    renderDrawer();
  }

  function open() {
    if (aborted.current) return;
    if (!panelEl) {
      try {
        panelEl = buildPanel();
        document.body.appendChild(panelEl);
      } catch {
        return;
      }
      renderCompare();
      renderDraft();
    }
    panelEl.style.display = '';
    refresh();
  }

  /** Switch ES/EN and rebuild the panel so every heading re-renders. */
  function setLang(next) {
    lang = next === 'en' ? 'en' : 'es';
    if (!panelEl) return lang;
    const keepSelected = selectedId;
    try {
      panelEl.remove();
    } catch {
      /* noop */
    }
    panelEl = null;
    open();
    if (keepSelected) openDrawer(keepSelected);
    return lang;
  }

  function openDrawer(id) {
    selectedId = id;
    open();
    renderDrawer();
    try {
      refs.drawer.scrollIntoView({ block: 'nearest' });
    } catch {
      /* noop */
    }
  }

  function close() {
    if (panelEl) panelEl.style.display = 'none';
  }

  function toggle() {
    if (panelEl && panelEl.style.display !== 'none') close();
    else open();
  }

  /**
   * One-tap command-dock entry for the MY CUBA CASH workspace — clearly
   * labeled, 44px touch target, bilingual aria-label. Appends to the shared
   * #command-dock like every other business panel; falls back to the body
   * only when the dock does not exist (tests, embeds).
   */
  function ensureButton() {
    try {
      if (btnEl || typeof document === 'undefined') return;
      btnEl = document.createElement('button');
      btnEl.id = DOCK_BUTTON_ID;
      btnEl.type = 'button';
      btnEl.className = 'mcc-dockbtn';
      btnEl.innerHTML =
        '<span style="font-size:20px">💸</span><span>MY CUBA CASH</span>';
      btnEl.setAttribute('aria-label', 'MY CUBA CASH — remesas / remittances');
      btnEl.addEventListener('click', toggle);
      const dock = document.getElementById('command-dock');
      if (dock) dock.appendChild(btnEl);
      else document.body.appendChild(btnEl);
    } catch {
      /* noop */
    }
  }

  function destroy() {
    try {
      if (panelEl && panelEl.remove) panelEl.remove();
      if (btnEl && btnEl.remove) btnEl.remove();
    } catch {
      /* ignore */
    }
    panelEl = null;
    btnEl = null;
    selectedId = null;
    try {
      if (typeof window !== 'undefined' && window.__gevCubacash === api) {
        delete window.__gevCubacash;
      }
    } catch {
      /* ignore */
    }
  }

  const api = {
    open,
    close,
    toggle,
    destroy,
    openDrawer,
    openDeepLink,
    refresh,
    setLang,
    getLang: () => lang,
    adaptStore,
  };

  ensureButton();

  try {
    if (typeof window !== 'undefined') {
      window.__gevCubacash = api;
    }
  } catch {
    /* non-browser runtimes */
  }

  return api;
}
