/**
 * Cuba Cars AI Workforce Panel for GOD'S EYE VIEW — $0, no API keys, no
 * external calls.
 *
 * Roster of the 4 local Cuba car-market AI agents: status dots, last action,
 * Start/Pause/Resume, live bilingual activity feed (newest first, refreshes
 * while open via workforce.onActivity), queue depth via getSummary(), and
 * the honest WORKFORCE_NOTE. Agents process local data in the browser only;
 * nothing is sent anywhere and nothing acts without the owner's approval.
 *
 * Pure helpers (AGENT_DEFS, WORKFORCE_NOTE, statusLabel, normalizeAgents,
 * sortFeedNewest) are exported for unit tests. The live DOM wiring lives in
 * initCarsWorkforcePanel(). This module intentionally does NOT touch
 * Cesium. Agents are DRAFT-ONLY by design: there is no send function.
 */

export const AGENT_DEFS = [
  {
    id: 'lead-qualifier',
    name: { es: 'Calificador de compradores', en: 'Lead Qualifier' },
    desc: {
      es: 'Califica compradores nuevos y anota el veredicto (borrador).',
      en: 'Scores new buyers and notes the verdict (draft).',
    },
  },
  {
    id: 'price-watcher',
    name: { es: 'Vigilante de precios', en: 'Price Watcher' },
    desc: {
      es: 'Revisa precios de competencia contra nuestros precios (solo lectura).',
      en: 'Reviews competition prices against our prices (read-only).',
    },
  },
  {
    id: 'rosmel-drafter',
    name: { es: 'Redactor Rosmel', en: 'Rosmel Drafter' },
    desc: {
      es: 'Prepara borradores WhatsApp para Rosmel. Solo borradores.',
      en: 'Prepares WhatsApp drafts for Rosmel. Drafts only.',
    },
  },
  {
    id: 'oversight',
    name: { es: 'Supervisión', en: 'Oversight' },
    desc: {
      es: 'Revisa borradores por datos inventados; escala legalidad a Juan.',
      en: 'Reviews drafts for invented facts; escalates legality to Juan.',
    },
  },
];

/** Honest framing — the workforce is active only while the app is open. */
export const WORKFORCE_NOTE = {
  es: 'La fuerza trabaja mientras la app está abierta.',
  en: 'The workforce runs while the app is open.',
};

const VALID_STATUSES = new Set(['idle', 'working', 'paused']);

/** Bilingual label for an agent status. */
export function statusLabel(status, lang = 'es') {
  const L = lang === 'es';
  switch (status) {
    case 'working':
      return L ? 'Trabajando' : 'Working';
    case 'paused':
      return L ? 'Pausado' : 'Paused';
    default:
      return L ? 'Inactivo' : 'Idle';
  }
}

/** Normalize a raw agent state object against the known roster. */
export function normalizeAgents(raw = []) {
  const byId = new Map((raw || []).map((a) => [a?.id, a]));
  return AGENT_DEFS.map((def) => {
    const r = byId.get(def.id) || {};
    const status = VALID_STATUSES.has(r.status) ? r.status : 'idle';
    return { ...def, status, lastAction: r.lastAction || null };
  });
}

/** Feed entries newest-first. Entry: { ts, agentId, es, en }. */
export function sortFeedNewest(entries = []) {
  return [...(entries || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

/**
 * Normalize any workforce-like object to the interface this panel uses.
 * Accepts the real cars workforce ({ agents: [...], running getter,
 * onActivity(), getActivityLog(), getSummary(), start/pause/resume }) as
 * well as the minimal double shape ({ agents()/feed()/queueDepth()/
 * running()/start/pause/resume }).
 */
export function adaptWorkforce(raw) {
  const w = raw || {};
  const readRawAgents = () => {
    try {
      if (typeof w.agents === 'function') return w.agents() || [];
      if (Array.isArray(w.agents)) return w.agents;
    } catch {
      /* fall through */
    }
    return [];
  };
  const defById = Object.fromEntries(AGENT_DEFS.map((d) => [d.id, d]));
  return {
    agents() {
      const seen = new Set();
      const out = [];
      for (const r of readRawAgents()) {
        if (!r || seen.has(r.id)) continue;
        seen.add(r.id);
        const def = defById[r.id] || {};
        const name =
          r.name && r.name.es ? r.name : def.name || { es: r.id, en: r.id };
        const desc = def.desc || { es: '', en: '' };
        const status = VALID_STATUSES.has(r.status) ? r.status : 'idle';
        let lastActionEs = null;
        let lastActionEn = null;
        const la = r.lastAction;
        if (la && typeof la === 'object' && (la.es || la.en)) {
          lastActionEs = la.es || null;
          lastActionEn = la.en || null;
        } else if (typeof la === 'string' && la) {
          lastActionEs = la;
          lastActionEn = la;
        }
        out.push({ id: r.id, name, desc, status, lastActionEs, lastActionEn });
      }
      // No workforce connected: show the 4 canonical cars roles, all idle,
      // so the roster is never a lie about activity.
      if (!out.length) {
        for (const def of AGENT_DEFS) {
          out.push({
            id: def.id,
            name: def.name,
            desc: def.desc,
            status: 'idle',
            lastActionEs: null,
            lastActionEn: null,
          });
        }
      }
      return out;
    },
    feed() {
      try {
        if (typeof w.feed === 'function') return sortFeedNewest(w.feed() || []);
        if (typeof w.getActivityLog === 'function') {
          return sortFeedNewest(
            (w.getActivityLog() || []).map((e) => ({
              ts: e.t || e.ts || 0,
              agentId: e.agent || e.agentId || '',
              es: e.es || '',
              en: e.en || '',
            })),
          );
        }
      } catch {
        /* fall through */
      }
      return [];
    },
    queueDepth() {
      try {
        if (typeof w.queueDepth === 'function')
          return Number(w.queueDepth()) || 0;
        if (typeof w.getSummary === 'function') {
          const s = w.getSummary() || {};
          return Number(s.queueDepth) || 0;
        }
      } catch {
        /* noop */
      }
      return 0;
    },
    running() {
      try {
        if (typeof w.running === 'function') return Boolean(w.running());
        return Boolean(w.running);
      } catch {
        return false;
      }
    },
    start() {
      try {
        w.start?.();
      } catch {
        /* noop */
      }
    },
    pause() {
      try {
        w.pause?.();
      } catch {
        /* noop */
      }
    },
    resume() {
      try {
        w.resume?.();
      } catch {
        /* noop */
      }
    },
    onActivity(fn) {
      try {
        if (typeof w.onActivity === 'function') return w.onActivity(fn);
      } catch {
        /* noop */
      }
      return null;
    },
  };
}

const CWF_CSS = `
#gev-cars-workforce-btn{display:flex;align-items:center;gap:8px;padding:12px;margin-top:8px;background:rgba(10,14,22,.85);border:1px solid rgba(56,189,248,.35);border-radius:14px;color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:13px;font-weight:700;letter-spacing:.04em;min-height:44px}
#gev-cars-workforce-panel{position:fixed;z-index:60;left:12px;top:12px;width:min(400px,calc(100vw - 24px));height:min(600px,calc(100vh - 24px));background:rgba(8,11,18,.97);border:1px solid rgba(56,189,248,.35);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7}
#gev-cars-workforce-panel .cwp-head{display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid rgba(56,189,248,.2)}
#gev-cars-workforce-panel .cwp-title{font-size:12px;font-weight:800;letter-spacing:.08em;color:#38bdf8;flex:1}
#gev-cars-workforce-panel .cwp-lang{min-height:44px;min-width:64px;border-radius:12px;border:2px solid rgba(56,189,248,.45);background:#0c2a3d;color:#f1f5f9;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit}
#gev-cars-workforce-panel .cwp-close{min-height:44px;min-width:44px;border-radius:12px;border:2px solid rgba(255,255,255,.2);background:#1e293b;color:#fff;font-size:18px;cursor:pointer;font-family:inherit}
#gev-cars-workforce-panel .cwp-controls{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(56,189,248,.2)}
#gev-cars-workforce-panel .cwp-btn{min-height:44px;padding:0 18px;border-radius:12px;border:2px solid rgba(56,189,248,.5);background:rgba(56,189,248,.12);color:#e0f2fe;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit}
#gev-cars-workforce-panel .cwp-queue{font-size:13px;color:#9fb0c9;margin-left:auto}
#gev-cars-workforce-panel .cwp-roster{padding:6px 12px;border-bottom:1px solid rgba(56,189,248,.2);max-height:280px;overflow-y:auto}
#gev-cars-workforce-panel .cwp-agent{display:flex;gap:10px;padding:10px 4px;border-bottom:1px solid rgba(56,189,248,.08)}
#gev-cars-workforce-panel .cwp-agent:last-child{border-bottom:none}
#gev-cars-workforce-panel .dot{width:12px;height:12px;border-radius:50%;margin-top:4px;flex:none}
#gev-cars-workforce-panel .dot.idle{background:#64748b}
#gev-cars-workforce-panel .dot.working{background:#34d399;box-shadow:0 0 8px rgba(52,211,153,.8)}
#gev-cars-workforce-panel .dot.paused{background:#fbbf24}
#gev-cars-workforce-panel .cwp-agent .aname{font-size:14px;font-weight:800;color:#fff}
#gev-cars-workforce-panel .cwp-agent .astatus{font-size:11px;font-weight:700;letter-spacing:.06em;color:#38bdf8;text-transform:uppercase}
#gev-cars-workforce-panel .cwp-agent .adesc{font-size:12px;color:#9fb0c9;margin-top:2px}
#gev-cars-workforce-panel .cwp-agent .alast{font-size:11px;color:#5b6b82;margin-top:2px;font-style:italic}
#gev-cars-workforce-panel .cwp-feedhead{font-size:11px;font-weight:800;letter-spacing:.08em;color:#38bdf8;padding:10px 12px 4px}
#gev-cars-workforce-panel .cwp-feed{flex:1;overflow-y:auto;padding:4px 12px 10px;display:flex;flex-direction:column;gap:8px;min-height:0}
#gev-cars-workforce-panel .cwp-item{background:rgba(56,189,248,.05);border:1px solid rgba(56,189,248,.14);border-radius:10px;padding:9px 11px;font-size:13px;color:#c8d4e4}
#gev-cars-workforce-panel .cwp-item .fts{font-size:11px;color:#5b6b82}
#gev-cars-workforce-panel .cwp-note{padding:10px 12px;border-top:1px solid rgba(56,189,248,.2);font-size:11px;color:#8fa3bd;line-height:1.5;background:rgba(56,189,248,.04)}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-cars-workforce-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-cars-workforce-styles';
  style.textContent = CWF_CSS;
  document.head.appendChild(style);
}

const FEED_REFRESH_MS = 3000;

/**
 * Live controller: dock button + floating cars AI workforce panel.
 * options: { workforce, signal }
 *
 * workforce shape (all optional, panel stays honest without one).
 * See adaptWorkforce() for the normalization.
 */
export function initCarsWorkforcePanel({ workforce = null, signal = null } = {}) {
  injectStyles();
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
  let refreshTimer = null;
  let unsubActivity = null;
  const t = (es, en) => (lang === 'es' ? es : en);
  const refs = {
    roster: null,
    agentRows: [],
    feed: null,
    feedItems: [],
    toggleBtn: null,
    queueEl: null,
  };

  const wf = adaptWorkforce(workforce);
  const readAgents = () => {
    try {
      return wf.agents() || [];
    } catch {
      return [];
    }
  };
  const readFeed = () => {
    try {
      return wf.feed() || [];
    } catch {
      return [];
    }
  };
  const readQueue = () => {
    try {
      return wf.queueDepth() || 0;
    } catch {
      return 0;
    }
  };
  const isRunning = () => {
    try {
      return wf.running();
    } catch {
      return false;
    }
  };

  function renderRoster() {
    if (!refs.roster) return;
    refs.roster.innerHTML = '';
    refs.agentRows = [];
    for (const a of readAgents()) {
      const row = document.createElement('div');
      row.className = 'cwp-agent';
      row.dataset.agentId = a.id;
      const dot = document.createElement('span');
      dot.className = `dot ${a.status}`;
      const body = document.createElement('div');
      const nm = document.createElement('div');
      nm.className = 'aname';
      nm.textContent = t(a.name.es, a.name.en);
      const st = document.createElement('div');
      st.className = 'astatus';
      st.textContent = statusLabel(a.status, lang);
      const de = document.createElement('div');
      de.className = 'adesc';
      de.textContent = t(a.desc.es, a.desc.en);
      body.appendChild(nm);
      body.appendChild(st);
      body.appendChild(de);
      const lastTxt = t(a.lastActionEs, a.lastActionEn);
      if (lastTxt) {
        const la = document.createElement('div');
        la.className = 'alast';
        la.textContent = lastTxt;
        body.appendChild(la);
      }
      row.appendChild(dot);
      row.appendChild(body);
      refs.roster.appendChild(row);
      refs.agentRows.push(row);
    }
  }

  function renderFeed() {
    if (!refs.feed) return;
    refs.feed.innerHTML = '';
    refs.feedItems = [];
    const entries = readFeed();
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'cwp-item';
      empty.textContent = t('Sin actividad todavía.', 'No activity yet.');
      refs.feed.appendChild(empty);
      return;
    }
    for (const e of entries) {
      const item = document.createElement('div');
      item.className = 'cwp-item';
      const tx = document.createElement('div');
      tx.textContent = t(e.es, e.en) || '';
      const ts = document.createElement('div');
      ts.className = 'fts';
      const when = e.ts ? new Date(e.ts).toLocaleString() : '';
      const who = e.agentId ? ` · ${e.agentId}` : '';
      ts.textContent = `${when}${who}`;
      item.appendChild(tx);
      item.appendChild(ts);
      refs.feed.appendChild(item);
      refs.feedItems.push(item);
    }
  }

  function renderControls() {
    if (refs.toggleBtn) {
      refs.toggleBtn.textContent = isRunning()
        ? t('⏸ Pausar', '⏸ Pause')
        : t('▶ Iniciar', '▶ Start');
    }
    if (refs.queueEl) {
      refs.queueEl.textContent = `${t('Cola', 'Queue')}: ${readQueue()}`;
    }
  }

  function refresh() {
    if (!panelEl || aborted.current) return;
    renderRoster();
    renderFeed();
    renderControls();
  }

  function toggleRun() {
    try {
      if (isRunning()) wf.pause();
      else if (readAgents().some((a) => a.status === 'paused')) wf.resume();
      else wf.start();
    } catch {
      /* workforce unavailable */
    }
    refresh();
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    try {
      refreshTimer = setInterval(() => {
        if (!panelEl || aborted.current) {
          stopAutoRefresh();
          return;
        }
        refresh();
      }, FEED_REFRESH_MS);
    } catch {
      refreshTimer = null;
    }
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      try {
        clearInterval(refreshTimer);
      } catch {
        /* noop */
      }
      refreshTimer = null;
    }
  }

  function subscribeActivity() {
    unsubscribeActivity();
    try {
      const unsub = wf.onActivity(() => {
        if (panelEl && !aborted.current) refresh();
      });
      if (typeof unsub === 'function') unsubActivity = unsub;
    } catch {
      unsubActivity = null;
    }
  }

  function unsubscribeActivity() {
    if (typeof unsubActivity === 'function') {
      try {
        unsubActivity();
      } catch {
        /* noop */
      }
    }
    unsubActivity = null;
  }

  function open() {
    if (aborted.current || typeof document === 'undefined') return null;
    if (panelEl) {
      refresh();
      return panelEl;
    }
    panelEl = document.createElement('div');
    panelEl.id = 'gev-cars-workforce-panel';
    panelEl.innerHTML = `
      <div class="cwp-head">
        <div class="cwp-title">CARROS CUBA · AGENTES IA</div>
        <button class="cwp-lang" type="button">ES</button>
        <button class="cwp-close" type="button" aria-label="Cerrar / close">✕</button>
      </div>
      <div class="cwp-controls">
        <button class="cwp-btn cwp-toggle" type="button"></button>
        <div class="cwp-queue"></div>
      </div>
      <div class="cwp-roster"></div>
      <div class="cwp-feedhead">${t('ACTIVIDAD EN VIVO', 'LIVE ACTIVITY')}</div>
      <div class="cwp-feed"></div>
      <div class="cwp-note"></div>
    `;
    refs.roster = panelEl.querySelector('.cwp-roster');
    refs.feed = panelEl.querySelector('.cwp-feed');
    refs.toggleBtn = panelEl.querySelector('.cwp-toggle');
    refs.queueEl = panelEl.querySelector('.cwp-queue');
    const note = panelEl.querySelector('.cwp-note');
    if (note) note.textContent = t(WORKFORCE_NOTE.es, WORKFORCE_NOTE.en);
    refs.toggleBtn?.addEventListener('click', toggleRun);
    panelEl
      .querySelector('.cwp-lang')
      ?.addEventListener('click', () => setLang(lang === 'es' ? 'en' : 'es'));
    panelEl.querySelector('.cwp-close')?.addEventListener('click', close);
    document.body.appendChild(panelEl);
    refresh();
    subscribeActivity();
    startAutoRefresh();
    return panelEl;
  }

  function close() {
    stopAutoRefresh();
    unsubscribeActivity();
    panelEl?.remove();
    panelEl = null;
    refs.roster = refs.feed = refs.toggleBtn = refs.queueEl = null;
    refs.agentRows = [];
    refs.feedItems = [];
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'es';
    if (!panelEl) return lang;
    unsubscribeActivity();
    panelEl.remove();
    panelEl = null;
    open();
    return lang;
  }

  if (typeof document !== 'undefined') {
    btnEl = document.createElement('button');
    btnEl.id = 'gev-cars-workforce-btn';
    btnEl.type = 'button';
    btnEl.innerHTML =
      '<span style="font-size:20px">🚗</span><span>Carros</span>';
    btnEl.setAttribute('aria-label', 'Carros Cuba agentes IA / Cuba cars AI agents');
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
    toggleRun,
    setLang,
    getLang: () => lang,
    getAgents: readAgents,
    getFeed: readFeed,
    getQueueDepth: readQueue,
    refs,
    destroy() {
      aborted.current = true;
      stopAutoRefresh();
      unsubscribeActivity();
      if (panelEl) {
        try {
          panelEl.remove();
        } catch {
          /* noop */
        }
      }
      panelEl = null;
      if (btnEl) {
        try {
          btnEl.remove();
        } catch {
          /* noop */
        }
      }
      btnEl = null;
    },
  };
  return api;
}
