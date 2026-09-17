/**
 * AI Workforce Panel for GOD'S EYE VIEW — $0, no API keys, no external calls.
 *
 * Roster of the 4 local AI agents: status dots, last action, Start/Pause/Resume,
 * live bilingual activity feed (newest first, auto-refreshes while open),
 * queue depth, and the honest WORKFORCE_NOTE. Agents process local data in
 * the browser only; nothing is sent anywhere and nothing acts without the
 * owner's approval.
 *
 * Pure helpers (AGENT_DEFS, statusLabel, formatFeedEntry) are exported for
 * unit tests. The live DOM wiring lives in initWorkforcePanel(). This module
 * intentionally does NOT touch Cesium — the map layer owns the 3D entities.
 */

export const AGENT_DEFS = [
  {
    id: 'scout',
    name: { es: 'Explorador', en: 'Scout' },
    desc: {
      es: 'Busca leads vacantes en los datos locales y los puntúa.',
      en: 'Finds vacant leads in local data and scores them.',
    },
  },
  {
    id: 'analyst',
    name: { es: 'Analista', en: 'Analyzer' },
    desc: {
      es: 'Calcula MAO, reparaciones y honorarios por comprador.',
      en: 'Computes MAO, repairs, and per-buyer fees.',
    },
  },
  {
    id: 'researcher',
    name: { es: 'Investigador', en: 'Researcher' },
    desc: {
      es: 'Investiga propietario y gravámenes en registros públicos.',
      en: 'Researches owner and liens in public records.',
    },
  },
  {
    id: 'dispositions',
    name: { es: 'Disposiciones', en: 'Dispositions' },
    desc: {
      es: 'Prepara la asignación del contrato con compradores en efectivo.',
      en: 'Prepares contract assignment with cash buyers.',
    },
  },
  {
    id: 'followup',
    name: { es: 'Seguimiento', en: 'Follow-up' },
    desc: {
      es: 'Prepara borradores de mensajes de seguimiento para tu revisión.',
      en: 'Drafts follow-up messages for your review.',
    },
  },
  {
    id: 'contracts',
    name: { es: 'Contratos', en: 'Contracts' },
    desc: {
      es: 'Genera borradores de oferta en primera persona para copiar.',
      en: 'Generates first-person draft offers for you to copy.',
    },
  },
];

export const WORKFORCE_NOTE = {
  es: 'Estos agentes trabajan con datos locales en tu navegador. No llaman a servicios externos, no gastan dinero y no actúan sin tu aprobación: cada acción importante espera tu visto bueno.',
  en: 'These agents work with local data in your browser. They make no external calls, spend no money, and never act without your approval: every important action waits for your OK.',
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
 * Accepts the real workforce (agents array, running getter, getActivityLog(),
 * start/pause/resume) as well as the minimal double shape
 * (agents()/feed()/queueDepth()/running()/start/pause/resume).
 * Normalized agent: { id, name:{es,en}, desc:{es,en}, status,
 *   lastActionEs, lastActionEn }.
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
      // No workforce connected: show the 4 canonical roles, all idle,
      // so the roster is never a lie about activity.
      if (!out.length) {
        for (const def of AGENT_DEFS.slice(0, 4)) {
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
  };
}

const WF_CSS = `
#gev-workforce-btn{display:flex;align-items:center;gap:8px;padding:10px 12px;margin-top:8px;background:rgba(10,14,22,.82);border:1px solid rgba(125,211,252,.28);border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.06em;min-width:172px;max-width:210px}
#gev-workforce-btn:hover{border-color:rgba(125,211,252,.6)}
#gev-workforce-panel{position:fixed;z-index:60;left:12px;top:12px;width:min(400px,calc(100vw - 24px));height:min(600px,calc(100vh - 24px));background:rgba(8,11,18,.96);border:1px solid rgba(125,211,252,.3);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7}
#gev-workforce-panel .wfp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(125,211,252,.18)}
#gev-workforce-panel .wfp-title{font-size:12px;font-weight:800;letter-spacing:.1em;color:#7dd3fc;flex:1}
#gev-workforce-panel .wfp-lang{background:none;border:1px solid rgba(125,211,252,.35);color:#7dd3fc;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:800;font-family:inherit}
#gev-workforce-panel .wfp-close{background:none;border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:14px}
#gev-workforce-panel .wfp-controls{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(125,211,252,.18)}
#gev-workforce-panel .wfp-btn{padding:7px 14px;border-radius:9px;border:1px solid rgba(125,211,252,.35);background:rgba(125,211,252,.1);color:#eaf4ff;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit}
#gev-workforce-panel .wfp-btn:hover{background:rgba(125,211,252,.2)}
#gev-workforce-panel .wfp-queue{font-size:11px;color:#9fb0c9;margin-left:auto}
#gev-workforce-panel .wfp-roster{padding:6px 12px;border-bottom:1px solid rgba(125,211,252,.18);max-height:280px;overflow-y:auto}
#gev-workforce-panel .wfp-agent{display:flex;gap:10px;padding:9px 4px;border-bottom:1px solid rgba(125,211,252,.08)}
#gev-workforce-panel .wfp-agent:last-child{border-bottom:none}
#gev-workforce-panel .dot{width:10px;height:10px;border-radius:50%;margin-top:4px;flex:none}
#gev-workforce-panel .dot.idle{background:#64748b}
#gev-workforce-panel .dot.working{background:#34d399;box-shadow:0 0 8px rgba(52,211,153,.8)}
#gev-workforce-panel .dot.paused{background:#fbbf24}
#gev-workforce-panel .wfp-agent .aname{font-size:12px;font-weight:800;color:#fff}
#gev-workforce-panel .wfp-agent .astatus{font-size:10px;font-weight:700;letter-spacing:.06em;color:#7dd3fc;text-transform:uppercase}
#gev-workforce-panel .wfp-agent .adesc{font-size:11px;color:#9fb0c9;margin-top:2px}
#gev-workforce-panel .wfp-agent .alast{font-size:10px;color:#5b6b82;margin-top:2px;font-style:italic}
#gev-workforce-panel .wfp-feedhead{font-size:10px;font-weight:800;letter-spacing:.08em;color:#7dd3fc;padding:10px 12px 4px}
#gev-workforce-panel .wfp-feed{flex:1;overflow-y:auto;padding:4px 12px 10px;display:flex;flex-direction:column;gap:6px;min-height:0}
#gev-workforce-panel .wfp-item{background:rgba(125,211,252,.05);border:1px solid rgba(125,211,252,.14);border-radius:9px;padding:7px 10px;font-size:11px;color:#c8d4e4}
#gev-workforce-panel .wfp-item .fts{font-size:10px;color:#5b6b82}
#gev-workforce-panel .wfp-note{padding:10px 12px;border-top:1px solid rgba(125,211,252,.18);font-size:10px;color:#8fa3bd;line-height:1.5;background:rgba(255,209,102,.04)}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-workforce-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-workforce-styles';
  style.textContent = WF_CSS;
  document.head.appendChild(style);
}

const FEED_REFRESH_MS = 3000;

/**
 * Live controller: dock button + floating AI workforce panel.
 * options: { workforce, signal }
 *
 * workforce shape (all optional, panel stays honest without one).
 * Accepts the real workforce ({ agents: [...], running, getActivityLog(),
 * start/pause/resume }) as well as the minimal double shape
 * ({ agents()/feed()/queueDepth()/running()/start/pause/resume }).
 * See adaptWorkforce() for the normalization.
 */
export function initWorkforcePanel({ workforce = null, signal = null } = {}) {
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
      row.className = 'wfp-agent';
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
      empty.className = 'wfp-item';
      empty.textContent = t('Sin actividad todavía.', 'No activity yet.');
      refs.feed.appendChild(empty);
      return;
    }
    for (const e of entries) {
      const item = document.createElement('div');
      item.className = 'wfp-item';
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

  function open() {
    if (aborted.current || typeof document === 'undefined') return null;
    if (panelEl) {
      refresh();
      return panelEl;
    }
    panelEl = document.createElement('div');
    panelEl.id = 'gev-workforce-panel';
    panelEl.innerHTML = `
      <div class="wfp-head">
        <div class="wfp-title">AGENTES IA · AI WORKFORCE</div>
        <button class="wfp-lang" type="button">ES / EN</button>
        <button class="wfp-close" type="button" aria-label="Cerrar / close">✕</button>
      </div>
      <div class="wfp-controls">
        <button class="wfp-btn wfp-toggle" type="button"></button>
        <div class="wfp-queue"></div>
      </div>
      <div class="wfp-roster"></div>
      <div class="wfp-feedhead">${t('ACTIVIDAD EN VIVO', 'LIVE ACTIVITY')}</div>
      <div class="wfp-feed"></div>
      <div class="wfp-note"></div>
    `;
    refs.roster = panelEl.querySelector('.wfp-roster');
    refs.feed = panelEl.querySelector('.wfp-feed');
    refs.toggleBtn = panelEl.querySelector('.wfp-toggle');
    refs.queueEl = panelEl.querySelector('.wfp-queue');
    const note = panelEl.querySelector('.wfp-note');
    if (note) note.textContent = t(WORKFORCE_NOTE.es, WORKFORCE_NOTE.en);
    refs.toggleBtn?.addEventListener('click', toggleRun);
    panelEl
      .querySelector('.wfp-lang')
      ?.addEventListener('click', () => setLang(lang === 'es' ? 'en' : 'es'));
    panelEl.querySelector('.wfp-close')?.addEventListener('click', close);
    document.body.appendChild(panelEl);
    refresh();
    startAutoRefresh();
    return panelEl;
  }

  function close() {
    stopAutoRefresh();
    panelEl?.remove();
    panelEl = null;
    refs.roster = refs.feed = refs.toggleBtn = refs.queueEl = null;
    refs.agentRows = [];
    refs.feedItems = [];
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'es';
    if (!panelEl) return lang;
    panelEl.remove();
    panelEl = null;
    open();
    return lang;
  }

  if (typeof document !== 'undefined') {
    btnEl = document.createElement('button');
    btnEl.id = 'gev-workforce-btn';
    btnEl.type = 'button';
    btnEl.innerHTML =
      '<span style="font-size:20px">🤖</span><span>Agentes</span>';
    btnEl.setAttribute('aria-label', 'Agentes IA / AI agents');
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
      close();
      btnEl?.remove();
      btnEl = null;
    },
  };
  if (typeof window !== 'undefined') window.__gevWorkforceUI = api;
  return api;
}
