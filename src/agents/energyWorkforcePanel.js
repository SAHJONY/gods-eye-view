/**
 * Energy Desk AI Workforce Panel for GOD'S EYE VIEW — $0, no API keys, no
 * external calls.
 *
 * Roster of the 5 energy-desk agents: status dots, tier badges, last action,
 * Start/Pause/Resume, live bilingual activity feed (newest first, refreshes
 * while open via workforce.onActivity), escalation feed (sanctions hard-stop
 * events are surfaced here first), queue depth via getSummary(), and the
 * honest WORKFORCE_NOTE. Agents process local data in the browser only;
 * nothing is sent anywhere and nothing acts without the owner's approval.
 *
 * The Gate Keeper's hard-stop events render in red and pin to the top of
 * the feed: the panel makes it impossible to miss an escalation.
 *
 * Pure helpers (AGENT_DEFS, WORKFORCE_NOTE, statusLabel, tierLabel,
 * normalizeAgents, sortFeedNewest, isHardStopEvent) are exported for unit
 * tests. The live DOM wiring lives in initEnergyWorkforcePanel().
 */

import { WORKFORCE_LOG_KEY } from './energyWorkforce.js';

export const AGENT_DEFS = [
  {
    id: 'spec-analyst',
    name: { es: 'Analista de especificaciones', en: 'Spec Analyst' },
    desc: {
      es: 'Fichas de referencia por producto (notas, sin ofertas).',
      en: 'Reference spec sheets per product (notes, no offers).',
    },
  },
  {
    id: 'gate-keeper',
    name: { es: 'Guardián del gate', en: 'Gate Keeper' },
    desc: {
      es: 'Vigila el hard-stop de sanciones: escala, nunca asesora.',
      en: 'Watches the sanctions hard-stop: escalates, never advises.',
    },
  },
  {
    id: 'economics-memo',
    name: { es: 'Memorista de economía', en: 'Economics Memo' },
    desc: {
      es: 'Memos de spread/honorario del corredor (motor puro).',
      en: 'Broker spread/fee memos (pure engine).',
    },
  },
  {
    id: 'logistics-checker',
    name: { es: 'Revisor de logística', en: 'Logistics Checker' },
    desc: {
      es: 'Valida puerto y volumen contra la referencia.',
      en: 'Validates port and volume against the reference.',
    },
  },
  {
    id: 'outreach-drafter',
    name: { es: 'Redactor de alcance', en: 'Outreach Drafter' },
    desc: {
      es: 'Borradores WhatsApp — nunca enviados.',
      en: 'WhatsApp drafts — never sent.',
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

/** Bilingual label for an authority tier (read/draft/propose only). */
export function tierLabel(tier, lang = 'es') {
  const L = lang === 'es';
  switch (tier) {
    case 'draft':
      return L ? 'Borrador' : 'Draft';
    case 'propose':
      return L ? 'Propone' : 'Propose';
    default:
      return L ? 'Lectura' : 'Read';
  }
}

/** Normalize a raw agent state object against the known roster. */
export function normalizeAgents(raw = []) {
  const byId = new Map((raw || []).map((a) => [a?.id, a]));
  return AGENT_DEFS.map((def) => {
    const r = byId.get(def.id) || {};
    const status = VALID_STATUSES.has(r.status) ? r.status : 'idle';
    const tier = ['read', 'draft', 'propose'].includes(r.tier) ? r.tier : 'read';
    return { ...def, status, tier, lastAction: r.lastAction || null };
  });
}

/** A hard-stop event pins to the top of the feed (never missed). */
export function isHardStopEvent(entry = {}) {
  return entry.kind === 'hard-stop' || entry.agent === 'gate-keeper' && /hard-stop|escalad|⛔/.test(`${entry.es || ''} ${entry.en || ''}`);
}

/** Feed entries newest-first; hard-stop events pinned above the rest. */
export function sortFeedNewest(entries = []) {
  const list = [...(entries || [])];
  const pinned = list.filter(isHardStopEvent).sort((a, b) => (b.t || 0) - (a.t || 0));
  const rest = list.filter((e) => !isHardStopEvent(e)).sort((a, b) => (b.t || 0) - (a.t || 0));
  return [...pinned, ...rest];
}

/**
 * Normalize any workforce-like object to the interface this panel uses.
 * Accepts the real energy workforce ({ agents: [...], running getter,
 * onActivity(), getActivityLog(), getEscalations(), getSummary(),
 * start/pause/resume }) as well as a minimal double.
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
  const readEscalations = () => {
    try {
      if (typeof w.getEscalations === 'function') return w.getEscalations() || [];
    } catch {
      /* fall through */
    }
    return [];
  };
  return {
    agents() {
      const seen = new Set();
      const out = [];
      for (const r of readRawAgents()) {
        if (!r || seen.has(r.id)) continue;
        seen.add(r.id);
        const def = defById[r.id] || {};
        const name = r.name && r.name.es ? r.name : def.name || { es: r.id, en: r.id };
        const desc = def.desc || { es: '', en: '' };
        const status = VALID_STATUSES.has(r.status) ? r.status : 'idle';
        const tier = ['read', 'draft', 'propose'].includes(r.tier) ? r.tier : 'read';
        out.push({ id: r.id, name, desc, status, tier, lastAction: r.lastAction || null });
      }
      return out;
    },
    running() {
      try {
        return !!w.running;
      } catch {
        return false;
      }
    },
    queueDepth() {
      try {
        const s = typeof w.getSummary === 'function' ? w.getSummary() : null;
        if (s && typeof s.queueDepth === 'number') return s.queueDepth;
      } catch {
        /* fall through */
      }
      return 0;
    },
    escalations() {
      return readEscalations();
    },
    feed(limit) {
      try {
        if (typeof w.getActivityLog === 'function') {
          const list = w.getActivityLog(limit) || [];
          return sortFeedNewest(list);
        }
      } catch {
        /* fall through */
      }
      return [];
    },
    onActivity(fn) {
      try {
        if (typeof w.onActivity === 'function') return w.onActivity(fn);
      } catch {
        /* fall through */
      }
      return () => {};
    },
    start() {
      try {
        w.start?.();
      } catch {
        /* ignore */
      }
    },
    pause() {
      try {
        w.pause?.();
      } catch {
        /* ignore */
      }
    },
    resume() {
      try {
        w.resume?.();
      } catch {
        /* ignore */
      }
    },
  };
}

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-energy-wf-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-energy-wf-panel-styles';
  style.textContent = `
    .gev-energy-wf-fab{position:fixed;right:16px;bottom:84px;z-index:60;min-height:52px;min-width:52px;border-radius:26px;border:none;background:#92400e;color:#fff;font-size:20px;font-weight:700;padding:0 18px;box-shadow:0 4px 16px rgba(0,0,0,.45);cursor:pointer}
    .gev-energy-wf-panel{position:fixed;inset:0;z-index:59;background:rgba(8,10,14,.97);color:#e8ecf1;overflow-y:auto;font-family:system-ui,-apple-system,sans-serif;font-size:17px;line-height:1.5}
    .gev-energy-wf-head{position:sticky;top:0;background:#0d1117;padding:14px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #26303b;z-index:2}
    .gev-energy-wf-title{font-size:21px;font-weight:800;flex:1}
    .gev-energy-wf-btn{min-height:44px;padding:10px 16px;border-radius:10px;border:1px solid #3b4756;background:#16202b;color:#e8ecf1;font-size:16px;cursor:pointer}
    .gev-energy-wf-btn.primary{background:#b45309;border-color:#b45309;color:#fff;font-weight:700}
    .gev-energy-wf-sec{padding:16px;border-bottom:1px solid #1c2530}
    .gev-energy-wf-sec h2{font-size:19px;margin:0 0 10px;color:#fbbf24}
    .gev-energy-wf-agent{background:#131a23;border:1px solid #26303b;border-radius:12px;padding:14px;margin:10px 0}
    .gev-energy-wf-agent .nm{font-weight:800;font-size:18px}
    .gev-energy-wf-dot{display:inline-block;width:12px;height:12px;border-radius:6px;margin-right:8px}
    .gev-energy-wf-dot.working{background:#22c55e}
    .gev-energy-wf-dot.paused{background:#eab308}
    .gev-energy-wf-dot.idle{background:#6b7280}
    .gev-energy-wf-tier{display:inline-block;padding:2px 10px;border-radius:14px;font-size:13px;background:#26303b;margin-left:8px}
    .gev-energy-wf-feed{background:#131a23;border:1px solid #26303b;border-radius:12px;padding:14px;margin:10px 0}
    .gev-energy-wf-feed.hardstop{border-color:#ef4444;background:#1f1113}
    .gev-energy-wf-feed .meta{font-size:13px;color:#9aa7b5}
    .gev-energy-wf-note{color:#9aa7b5;font-size:14px}
  `;
  document.head.appendChild(style);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export function initEnergyWorkforcePanel({ workforce = null, signal = null } = {}) {
  injectStyles();
  const w = adaptWorkforce(workforce);

  let lang = 'es';
  let panelEl = null;
  let fabEl = null;
  const aborted = { current: false };
  signal?.addEventListener?.('abort', () => {
    aborted.current = true;
  }, { once: true });

  const t = (es, en) => (lang === 'es' ? es : en);

  function renderAgents(root) {
    const sec = el('section', 'gev-energy-wf-sec');
    sec.appendChild(el('h2', null, t('🤖 Fuerza de trabajo — Energía', '🤖 Energy workforce')));
    sec.appendChild(el('p', 'gev-energy-wf-note', t(WORKFORCE_NOTE.es, WORKFORCE_NOTE.en)));
    const ctrls = el('div');
    ctrls.style.display = 'flex';
    ctrls.style.gap = '8px';
    ctrls.style.flexWrap = 'wrap';
    const mkBtn = (label, cls, fn) => {
      const b = el('button', `gev-energy-wf-btn ${cls || ''}`, label);
      b.type = 'button';
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        fn();
        rerender();
      });
      return b;
    };
    ctrls.appendChild(mkBtn(t('Iniciar', 'Start'), 'primary', () => w.start()));
    ctrls.appendChild(mkBtn(t('Pausar', 'Pause'), '', () => w.pause()));
    ctrls.appendChild(mkBtn(t('Reanudar', 'Resume'), '', () => w.resume()));
    sec.appendChild(ctrls);
    sec.appendChild(
      el('p', 'gev-energy-wf-note', t(
        `Cola: ${w.queueDepth()} · Estado: ${w.running() ? t('activa', 'active') : t('detenida', 'stopped')}`,
        `Queue: ${w.queueDepth()} · State: ${w.running() ? 'running' : 'stopped'}`,
      )),
    );
    for (const agent of normalizeAgents(w.agents())) {
      const card = el('div', 'gev-energy-wf-agent');
      const nm = el('div', 'nm');
      const dot = el('span', `gev-energy-wf-dot ${agent.status}`);
      nm.appendChild(dot);
      nm.appendChild(el('span', null, t(agent.name.es, agent.name.en)));
      nm.appendChild(el('span', 'gev-energy-wf-tier', tierLabel(agent.tier, lang)));
      card.appendChild(nm);
      card.appendChild(el('div', 'gev-energy-wf-note', t(agent.desc.es, agent.desc.en)));
      card.appendChild(el('div', null, statusLabel(agent.status, lang)));
      if (agent.lastAction) {
        card.appendChild(
          el('div', 'gev-energy-wf-note', t(agent.lastAction.es, agent.lastAction.en) || ''),
        );
      }
      sec.appendChild(card);
    }
    root.appendChild(sec);
  }

  function renderEscalations(root) {
    const esc = w.escalations();
    if (!esc.length) return;
    const sec = el('section', 'gev-energy-wf-sec');
    sec.appendChild(el('h2', null, t('⛔ Escalaciones (hard-stop)', '⛔ Escalations (hard-stop)')));
    for (const e of esc.slice(-10).reverse()) {
      const card = el('div', 'gev-energy-wf-feed hardstop');
      card.appendChild(el('div', null, t('Motivo', 'Reason') + `: ${e.reason || ''}`));
      card.appendChild(el('div', 'meta', String(e.ts || '')));
      root.appendChild(sec);
      sec.appendChild(card);
    }
    root.appendChild(sec);
  }

  function renderFeed(root) {
    const sec = el('section', 'gev-energy-wf-sec');
    sec.appendChild(el('h2', null, t('📡 Actividad', '📡 Activity')));
    const feed = w.feed(50);
    if (!feed.length) {
      sec.appendChild(el('p', 'gev-energy-wf-note', t('Sin actividad todavía.', 'No activity yet.')));
    }
    for (const entry of feed) {
      const card = el('div', `gev-energy-wf-feed${isHardStopEvent(entry) ? ' hardstop' : ''}`);
      if (isHardStopEvent(entry)) {
        card.appendChild(el('div', null, t('⛔ HARD-STOP DE SANCIONES', '⛔ SANCTIONS HARD-STOP')));
      }
      card.appendChild(el('div', null, t(entry.es, entry.en) || ''));
      const meta = el('div', 'meta', `${entry.agent || ''} · ${new Date(entry.t || Date.now()).toLocaleString()}`);
      card.appendChild(meta);
      sec.appendChild(card);
    }
    root.appendChild(sec);
  }

  function rerender() {
    if (!panelEl || aborted.current) return;
    try {
      panelEl.innerHTML = '';
      const head = el('div', 'gev-energy-wf-head');
      head.appendChild(el('div', 'gev-energy-wf-title', t('⚡ Fuerza — Energía', '⚡ Energy workforce')));
      const langBtn = el('button', 'gev-energy-wf-btn', lang === 'es' ? 'EN' : 'ES');
      langBtn.type = 'button';
      langBtn.addEventListener('click', () => {
        lang = lang === 'es' ? 'en' : 'es';
        rerender();
      });
      head.appendChild(langBtn);
      const closeBtn = el('button', 'gev-energy-wf-btn', '✕');
      closeBtn.type = 'button';
      closeBtn.addEventListener('click', () => close());
      head.appendChild(closeBtn);
      panelEl.appendChild(head);
      renderEscalations(panelEl);
      renderAgents(panelEl);
      renderFeed(panelEl);
    } catch {
      /* UI errors never break the app */
    }
  }

  function open() {
    if (typeof document === 'undefined') return false;
    if (panelEl) {
      rerender();
      return true;
    }
    panelEl = el('div', 'gev-energy-wf-panel');
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', t('Fuerza de trabajo de energía', 'Energy workforce'));
    document.body.appendChild(panelEl);
    rerender();
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
  }

  function mountFab() {
    if (typeof document === 'undefined' || fabEl) return;
    fabEl = el('button', 'gev-energy-wf-fab', '🤖');
    fabEl.type = 'button';
    fabEl.setAttribute('aria-label', t('Abrir fuerza de energía', 'Open energy workforce'));
    fabEl.addEventListener('click', () => toggle());
    document.body.appendChild(fabEl);
  }

  if (workforce && typeof workforce.onActivity === 'function') {
    try {
      workforce.onActivity(() => {
        if (panelEl) rerender();
      });
    } catch {
      /* ignore */
    }
  }

  const api = {
    open,
    close,
    toggle,
    destroy,
    mountFab,
    setLang(next) {
      lang = next === 'en' ? 'en' : 'es';
      if (panelEl) rerender();
    },
    getLang: () => lang,
    _rendered: () => !!panelEl,
    _sortFeedNewest: sortFeedNewest,
    _isHardStopEvent: isHardStopEvent,
  };

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

// Re-export the log key so tooling can find it from the panel module.
export { WORKFORCE_LOG_KEY };
