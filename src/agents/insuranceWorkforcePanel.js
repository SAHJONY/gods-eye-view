/**
 * Insurance Workforce Panel for GOD'S EYE VIEW — $0, no API keys, no external calls.
 *
 * Roster of the 3 insurance agents (gap analyst, renewal watcher, claim-prep):
 * status dots, last action, Start/Pause/Resume + Run-once buttons, live
 * bilingual activity feed (newest first), findings summary, the honest
 * WORKFORCE_NOTE, and the hard rules (agents never send/email/post/purchase/
 * file/sign/call/text — memos and notes only).
 *
 * Pure helpers (INSURANCE_AGENT_DEFS, insStatusLabel, formatInsuranceFeedEntry)
 * are exported for unit tests. The live DOM wiring lives in
 * initInsuranceWorkforcePanel(). This module intentionally does NOT touch
 * Cesium — the map layer owns the 3D entities.
 */

export const INSURANCE_AGENT_DEFS = [
  {
    id: 'gap-analyst',
    name: { es: 'Analista de brechas', en: 'Gap analyst' },
    desc: {
      es: 'Detecta coberturas con brecha en los datos locales.',
      en: 'Detects coverage gaps in local data.',
    },
  },
  {
    id: 'renewal-watcher',
    name: { es: 'Vigilante de renovaciones', en: 'Renewal watcher' },
    desc: {
      es: 'Avisa de renovaciones dentro de 30 días.',
      en: 'Flags renewals due within 30 days.',
    },
  },
  {
    id: 'claim-prep',
    name: { es: 'Asistente de reclamos', en: 'Claim-prep assistant' },
    desc: {
      es: 'Prepara listas de documentos para reclamos abiertos.',
      en: 'Prepares document checklists for open claims.',
    },
  },
];

export const INSURANCE_WORKFORCE_NOTE = {
  es: 'La fuerza trabaja mientras la app está abierta.',
  en: 'The workforce runs while the app is open.',
};

export const INSURANCE_AGENT_HARD_RULES_PANEL = {
  es: 'Regla dura: los agentes NUNCA envían, escriben correos, publican, compran, presentan, firman, llaman ni envían mensajes. Solo producen memos y notas.',
  en: 'Hard rule: agents NEVER send, email, post, purchase, file, sign, call, or text. They only produce memos and notes.',
};

const VALID_STATUSES = new Set(['idle', 'working', 'paused']);

/** Bilingual label for an agent status. */
export function insStatusLabel(status, lang = 'es') {
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
export function normalizeInsuranceAgents(raw = []) {
  const byId = new Map((raw || []).map((a) => [a?.id, a]));
  return INSURANCE_AGENT_DEFS.map((def) => {
    const r = byId.get(def.id) || {};
    const status = VALID_STATUSES.has(r.status) ? r.status : 'idle';
    return { ...def, status, lastAction: r.lastAction || null };
  });
}

/** Newest-first sort for feed entries. */
export function sortInsuranceFeedNewest(entries = []) {
  return [...(entries || [])].sort((a, b) => (b?.t || 0) - (a?.t || 0));
}

/** Render one log entry as bilingual text. */
export function formatInsuranceFeedEntry(entry, lang = 'es') {
  if (!entry) return '';
  const text = lang === 'es' ? entry.es || entry.en : entry.en || entry.es;
  const agent =
    INSURANCE_AGENT_DEFS.find((d) => d.id === entry.agent)?.name?.[
      lang === 'es' ? 'es' : 'en'
    ] || entry.agent;
  const when = entry.t
    ? new Date(entry.t).toLocaleString(lang === 'es' ? 'es-US' : 'en-US')
    : '';
  return `${agent} · ${text || ''}${when ? ` — ${when}` : ''}`;
}

const INS_WF_CSS = `
#gev-ins-wf-btn{display:flex;align-items:center;gap:8px;padding:10px 12px;margin-top:8px;background:rgba(10,14,22,.82);border:1px solid rgba(52,211,153,.28);border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f2f4f8;font-family:inherit;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.06em;min-width:172px;max-width:210px}
#gev-ins-wf-btn:hover{border-color:rgba(52,211,153,.6)}
#gev-ins-wf-panel{position:fixed;z-index:60;right:12px;top:12px;width:min(560px,calc(100vw - 24px));max-height:min(640px,calc(100vh - 24px));background:rgba(8,11,18,.96);border:1px solid rgba(52,211,153,.3);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.6);font-family:inherit;color:#eef2f7}
#gev-ins-wf-panel .iwf-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(52,211,153,.18)}
#gev-ins-wf-panel .iwf-title{font-size:12px;font-weight:800;letter-spacing:.1em;color:#34d399;flex:1}
#gev-ins-wf-panel .iwf-lang{background:none;border:1px solid rgba(52,211,153,.35);color:#34d399;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:800;font-family:inherit;min-height:44px;min-width:44px}
#gev-ins-wf-panel .iwf-close{background:none;border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;width:44px;height:44px;min-width:44px;cursor:pointer;font-size:16px}
#gev-ins-wf-panel .iwf-body{overflow-y:auto;padding:10px 12px}
#gev-ins-wf-panel .iwf-row{display:flex;align-items:center;gap:10px;background:rgba(52,211,153,.05);border:1px solid rgba(52,211,153,.14);border-radius:12px;padding:10px 12px;margin-bottom:8px}
#gev-ins-wf-panel .iwf-dot{width:10px;height:10px;border-radius:50%;background:#6b7280;flex:none}
#gev-ins-wf-panel .iwf-dot.working{background:#22c55e}
#gev-ins-wf-panel .iwf-dot.paused{background:#f59e0b}
#gev-ins-wf-panel .iwf-agent{flex:1}
#gev-ins-wf-panel .iwf-name{font-size:13px;font-weight:700}
#gev-ins-wf-panel .iwf-desc{font-size:11px;color:#9fb0c9}
#gev-ins-wf-panel .iwf-status{font-size:11px;color:#9fb0c9;white-space:nowrap}
#gev-ins-wf-panel .iwf-controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
#gev-ins-wf-panel .iwf-btn{min-height:44px;padding:10px 14px;border-radius:10px;border:1px solid rgba(52,211,153,.35);background:rgba(52,211,153,.1);color:#eaf4ff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
#gev-ins-wf-panel .iwf-findings{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:12px}
#gev-ins-wf-panel .iwf-find{background:rgba(52,211,153,.06);border:1px solid rgba(52,211,153,.15);border-radius:10px;padding:8px 10px}
#gev-ins-wf-panel .iwf-feed{max-height:180px;overflow-y:auto;font-size:12px;background:rgba(255,255,255,.03);border-radius:10px;padding:8px 10px;margin-bottom:10px}
#gev-ins-wf-panel .iwf-entry{padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06)}
#gev-ins-wf-panel .iwf-note{font-size:11px;color:#9fb0c9;line-height:1.5}
#gev-ins-wf-panel .iwf-rules{font-size:11px;color:#fbbf24;line-height:1.5;margin-top:6px}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-ins-wf-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-ins-wf-styles';
  style.textContent = INS_WF_CSS;
  document.head.appendChild(style);
}

/** initInsuranceWorkforcePanel({ workforce, signal }) */
export function initInsuranceWorkforcePanel({
  workforce = null,
  signal = null,
} = {}) {
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
  let feedTimer = null;
  const t = (es, en) => (lang === 'es' ? es : en);
  const refs = { roster: null, feed: null, findings: null };

  function summary() {
    try {
      return workforce?.getSummary?.() || null;
    } catch {
      return null;
    }
  }

  function renderRoster() {
    if (!refs.roster) return;
    refs.roster.innerHTML = '';
    const agents = normalizeInsuranceAgents(summary()?.agents || []);
    for (const a of agents) {
      const row = document.createElement('div');
      row.className = 'iwf-row';
      const dot = document.createElement('span');
      dot.className = `iwf-dot ${a.status}`;
      const agent = document.createElement('div');
      agent.className = 'iwf-agent';
      const name = document.createElement('div');
      name.className = 'iwf-name';
      name.textContent = a.name[lang];
      const desc = document.createElement('div');
      desc.className = 'iwf-desc';
      desc.textContent = a.desc[lang];
      agent.appendChild(name);
      agent.appendChild(desc);
      const status = document.createElement('div');
      status.className = 'iwf-status';
      status.textContent = insStatusLabel(a.status, lang);
      row.appendChild(dot);
      row.appendChild(agent);
      row.appendChild(status);
      refs.roster.appendChild(row);
    }
  }

  function renderFindings() {
    if (!refs.findings) return;
    refs.findings.innerHTML = '';
    const f = summary()?.findings || { gaps: 0, renewals: 0, openClaims: 0 };
    const items = [
      [t('Brechas', 'Gaps'), f.gaps],
      [t('Renovaciones ≤30d', 'Renewals ≤30d'), f.renewals],
      [t('Reclamos abiertos', 'Open claims'), f.openClaims],
    ];
    for (const [label, value] of items) {
      const el = document.createElement('div');
      el.className = 'iwf-find';
      el.textContent = `${label}: ${value}`;
      refs.findings.appendChild(el);
    }
  }

  function renderFeed() {
    if (!refs.feed) return;
    refs.feed.innerHTML = '';
    let entries = [];
    try {
      entries = workforce?.getActivityLog?.(30) || [];
    } catch {
      entries = [];
    }
    for (const entry of sortInsuranceFeedNewest(entries)) {
      const el = document.createElement('div');
      el.className = 'iwf-entry';
      el.textContent = formatInsuranceFeedEntry(entry, lang);
      refs.feed.appendChild(el);
    }
  }

  function refresh() {
    if (!panelEl || aborted.current) return;
    renderRoster();
    renderFindings();
    renderFeed();
  }

  function open() {
    if (aborted.current || typeof document === 'undefined') return null;
    if (panelEl) {
      refresh();
      return panelEl;
    }
    panelEl = document.createElement('div');
    panelEl.id = 'gev-ins-wf-panel';

    const head = document.createElement('div');
    head.className = 'iwf-head';
    const title = document.createElement('div');
    title.className = 'iwf-title';
    title.textContent = t(
      'SEGUROS · FUERZA DE TRABAJO',
      'INSURANCE · WORKFORCE',
    );
    const langBtn = document.createElement('button');
    langBtn.className = 'iwf-lang';
    langBtn.type = 'button';
    langBtn.textContent = 'ES / EN';
    langBtn.addEventListener('click', () =>
      setLang(lang === 'es' ? 'en' : 'es'),
    );
    const closeBtn = document.createElement('button');
    closeBtn.className = 'iwf-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Cerrar / Close');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', close);
    head.appendChild(title);
    head.appendChild(langBtn);
    head.appendChild(closeBtn);
    panelEl.appendChild(head);

    const body = document.createElement('div');
    body.className = 'iwf-body';

    const roster = document.createElement('div');
    refs.roster = roster;
    body.appendChild(roster);

    const findings = document.createElement('div');
    findings.className = 'iwf-findings';
    refs.findings = findings;
    body.appendChild(findings);

    const controls = document.createElement('div');
    controls.className = 'iwf-controls';
    const mkBtn = (es, en, fn) => {
      const b = document.createElement('button');
      b.className = 'iwf-btn';
      b.type = 'button';
      b.textContent = t(es, en);
      b.addEventListener('click', () => {
        try {
          fn();
        } catch {
          /* ignore */
        }
        refresh();
      });
      return b;
    };
    controls.appendChild(
      mkBtn('▶ Iniciar', '▶ Start', () => workforce?.start?.()),
    );
    controls.appendChild(
      mkBtn('⏸ Pausar', '⏸ Pause', () => workforce?.pause?.()),
    );
    controls.appendChild(
      mkBtn('↻ Ejecutar una vez', '↻ Run once', () =>
        workforce?.processOnce?.(),
      ),
    );
    body.appendChild(controls);

    const feed = document.createElement('div');
    feed.className = 'iwf-feed';
    refs.feed = feed;
    body.appendChild(feed);

    const note = document.createElement('div');
    note.className = 'iwf-note';
    note.textContent = t(
      INSURANCE_WORKFORCE_NOTE.es,
      INSURANCE_WORKFORCE_NOTE.en,
    );
    body.appendChild(note);

    const rules = document.createElement('div');
    rules.className = 'iwf-rules';
    rules.textContent = t(
      INSURANCE_AGENT_HARD_RULES_PANEL.es,
      INSURANCE_AGENT_HARD_RULES_PANEL.en,
    );
    body.appendChild(rules);

    panelEl.appendChild(body);
    document.body.appendChild(panelEl);

    if (workforce?.onActivity) {
      feedTimer = setInterval(() => {
        if (aborted.current) return;
        renderFeed();
        renderRoster();
        renderFindings();
      }, 5000);
      // Never hold a node test process open; no-op in browsers.
      try {
        if (feedTimer && typeof feedTimer.unref === 'function')
          feedTimer.unref();
      } catch {
        /* ignore */
      }
    }
    refresh();
    return panelEl;
  }

  function close() {
    if (feedTimer) clearInterval(feedTimer);
    feedTimer = null;
    panelEl?.remove();
    panelEl = null;
    refs.roster = refs.feed = refs.findings = null;
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
    btnEl.id = 'gev-ins-wf-btn';
    btnEl.type = 'button';
    btnEl.innerHTML =
      '<span style="font-size:20px">🤖</span><span>Seguros · IA</span>';
    btnEl.setAttribute('aria-label', 'Seguros workforce / Insurance workforce');
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
    refs,
    destroy() {
      aborted.current = true;
      close();
      btnEl?.remove();
      btnEl = null;
    },
  };
  if (typeof window !== 'undefined') window.__gevInsWorkforcePanel = api;
  return api;
}
