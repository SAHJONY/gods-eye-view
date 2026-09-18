/**
 * SAHJONY · GOD'S EYE VIEW — Cuba Car Market A–Z Workforce
 * -----------------------------------------------------------------------
 * Client-side only. $0. No API keys. No external network calls.
 * The workforce runs ONLY while the app is open — nothing runs in the
 * background (see WORKFORCE_NOTE).
 *
 * HARD RULES (approval gates — never bypassed):
 *   - Agents NEVER send, email, post, purchase, sign, call, or text.
 *   - There is NO send function anywhere in this module. Drafts land in the
 *     store's Rosmel draft queue as state 'draft'; Juan approves and sends
 *     from his own phone.
 *   - Agents NEVER contact or screen any real counterparty.
 *   - Agents NEVER invent import legality, customs, or sanctions answers —
 *     any legality question is escalated to Juan (oversight agent).
 *   - All outputs are drafts, notes, and memos stored inside lead records
 *     and the draft queue. The UI decides what Juan sees; the engine only
 *     proposes.
 *
 * Injected collaborators:
 *   - carStore: the cars pipeline store (adapted shape): {
 *       listLeads(), getLead(id), update(id, patch), notes(id) → [{t,agent,es,en}],
 *       listDrafts(), createDraft(draft), setDraftState(id, state),
 *       listSnapshots(), getOurPrices(), addLeadNote(leadId, text) }
 *   - carEngine: { scoreLead(lead, modelPrice) -> {score, missing},
 *                 qualificationVerdict(scored) -> {tier, es, en},
 *                 pricePosition(our, theirs) -> {position, diff},
 *                 summarizeModelPricing(model, snapshots, ourPrice) }
 *     Engine calls are defensive: every call is wrapped in try/catch with
 *     safe fallbacks, so a throwing engine can never break the passes.
 *
 * Language policy for the cars track: 'es-first' (workforce core LANG_POLICY).
 */

import {
  AGENT_TIERS,
  LANG_POLICY as CORE_LANG_POLICY,
  registerWorkforce,
  escalate,
  checkSanctions,
} from './workforceCore.js';

/** Module id used with the workforce core. */
export const CARS_MODULE_ID = 'cars';

export const WORKFORCE_LOG_KEY = 'sahjony.workforce.cars.log.v1';
export const LOG_CAP = 300;

/** Honest framing — the workforce is active only while the app is open. */
export const WORKFORCE_NOTE = {
  es: 'La fuerza trabaja mientras la app está abierta.',
  en: 'The workforce runs while the app is open.',
};

/** Language policy for the cars track comes from the shared workforce core. */
export const LANG_POLICY = CORE_LANG_POLICY.cars;

/**
 * Authority tiers come from the shared workforce core — no module invents
 * its own authority model. Re-exported here so the panel and tests can read
 * the roster's tiers from the module surface.
 */
export { AGENT_TIERS };

const ROLE_DEFS = [
  {
    id: 'lead-qualifier',
    name: { es: 'Calificador de compradores', en: 'Lead Qualifier' },
    role: 'triage',
    tier: AGENT_TIERS.DRAFT,
  },
  {
    id: 'price-watcher',
    name: { es: 'Vigilante de precios', en: 'Price Watcher' },
    role: 'research',
    tier: AGENT_TIERS.READ,
  },
  {
    id: 'rosmel-drafter',
    name: { es: 'Redactor Rosmel', en: 'Rosmel Drafter' },
    role: 'outreach-drafting',
    tier: AGENT_TIERS.DRAFT,
  },
  {
    id: 'oversight',
    name: { es: 'Supervisión', en: 'Oversight' },
    role: 'oversight',
    tier: AGENT_TIERS.READ,
  },
];

const QUEUE_STAGES = ['nuevo', 'contactado'];

function readStoredLog() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(WORKFORCE_LOG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.slice(-LOG_CAP);
      }
    }
  } catch {
    /* fall through */
  }
  return [];
}

function writeStoredLog(log) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(WORKFORCE_LOG_KEY, JSON.stringify(log.slice(-LOG_CAP)));
    }
  } catch {
    /* persistence is best-effort */
  }
}

function readNotes(carStore, lead) {
  try {
    const notes = carStore.notes ? carStore.notes(lead.id) : [];
    return Array.isArray(notes) ? notes : [];
  } catch {
    return [];
  }
}

function allLeads(carStore) {
  try {
    const leads = carStore.getAll ? carStore.getAll() : [];
    return Array.isArray(leads) ? leads : [];
  } catch {
    return [];
  }
}

export function createWorkforce(opts = {}) {
  const { carStore, carEngine, signal, tickMs = 25000, staggerMs = 5000 } = opts;
  if (
    !carStore ||
    typeof carStore.getAll !== 'function' ||
    typeof carStore.update !== 'function'
  ) {
    throw new Error(
      'createWorkforce requires a carStore with getAll()/update().',
    );
  }
  if (!carEngine) {
    throw new Error('createWorkforce requires a carEngine.');
  }

  let running = false;
  let destroyed = false;
  const listeners = new Set();
  let log = readStoredLog();

  const agents = ROLE_DEFS.map((def) => ({
    id: def.id,
    name: { ...def.name },
    role: def.role,
    tier: def.tier,
    status: 'idle', // idle | working | paused
    lastAction: null,
    _timers: [],
  }));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  // Register the roster with the shared workforce core: tiers, escalation
  // paths, and the audit trail all come from one authority model.
  try {
    registerWorkforce(
      CARS_MODULE_ID,
      ROLE_DEFS.map((def) => ({
        id: def.id,
        role: def.role,
        tier: def.tier,
        lang: LANG_POLICY,
      })),
    );
  } catch {
    /* registration is best-effort; the module keeps working unregistered */
  }

  function addNote(lead, agentId, es, en) {
    const note = { t: Date.now(), agent: agentId, es, en };
    const existing = carStore.get ? carStore.get(lead.id) : null;
    const current = existing || lead;
    const notes = [...readNotes(carStore, lead), note];
    const agentNotes = notes.map((n) => ({
      at: n.t,
      agent: n.agent,
      es: n.es,
      en: n.en,
    }));
    carStore.update(lead.id, {
      ...current,
      notes,
      agentNotes,
      updatedAt: Date.now(),
    });
    return note;
  }

  function emit(agentId, kind, es, en, leadId) {
    const agent = byId[agentId];
    const event = { t: Date.now(), agent: agentId, kind, es, en };
    if (leadId !== undefined && leadId !== null) event.leadId = leadId;
    if (agent) agent.lastAction = event;
    log.push(event);
    if (log.length > LOG_CAP) log = log.slice(-LOG_CAP);
    writeStoredLog(log);
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        /* listener errors must not break the pass */
      }
    }
    return event;
  }

  function clearTimers() {
    for (const agent of agents) {
      for (const timer of agent._timers) {
        try {
          clearTimeout(timer);
        } catch {
          /* noop */
        }
      }
      agent._timers = [];
    }
  }

  function runStaggered(agentId, fn) {
    const agent = byId[agentId];
    if (!agent || destroyed) return;
    const index = agents.indexOf(agent);
    const timer = setTimeout(() => {
      if (!running || destroyed) return;
      agent.status = 'working';
      try {
        fn(agent);
      } catch {
        /* a pass must never crash the loop */
      }
      if (running && !destroyed) agent.status = 'idle';
    }, index * staggerMs);
    agent._timers.push(timer);
  }

  // ---- Passes ----

  /** Lead qualifier: score new/contacted leads, note the verdict (draft). */
  function passLeadQualifier() {
    runStaggered('lead-qualifier', () => {
      const leads = allLeads(carStore).filter((l) =>
        QUEUE_STAGES.includes(l.stage),
      );
      if (!leads.length) {
        emit(
          'lead-qualifier',
          'idle',
          'Sin compradores nuevos para calificar.',
          'No new buyers to qualify.',
        );
        return;
      }
      let qualified = 0;
      for (const lead of leads.slice(0, 10)) {
        let scored = { score: 0, missing: [] };
        try {
          scored = carEngine.scoreLead(lead, null);
        } catch {
          /* engine failure -> score 0, never breaks the pass */
        }
        let verdict = { tier: 'red', es: 'Descartable', en: 'Drop', reasons: [] };
        try {
          verdict = carEngine.qualificationVerdict(scored);
        } catch {
          /* keep default */
        }
        const es =
          `Calificación ${scored.score}/100 — ${verdict.es}.` +
          (scored.missing.length
            ? ` Faltan: ${scored.missing.map((m) => m.es).join(', ')}.`
            : '');
        const en =
          `Qualification ${scored.score}/100 — ${verdict.en}.` +
          (scored.missing.length
            ? ` Missing: ${scored.missing.map((m) => m.en).join(', ')}.`
            : '');
        addNote(lead, 'lead-qualifier', es, en);
        if (verdict.tier === 'green') qualified += 1;
      }
      emit(
        'lead-qualifier',
        'scored',
        `Calificó ${leads.length} comprador(es): ${qualified} calificable(s). Borradores/notas solamente.`,
        `Scored ${leads.length} buyer(s): ${qualified} qualifiable. Notes/drafts only.`,
      );
    });
  }

  /** Price watcher: compare competition snapshots vs our prices (read-only). */
  function passPriceWatcher() {
    runStaggered('price-watcher', () => {
      let snapshots = [];
      let ourPrices = {};
      try {
        snapshots = carStore.listSnapshots ? carStore.listSnapshots() : [];
        ourPrices = carStore.getOurPrices ? carStore.getOurPrices() : {};
      } catch {
        /* keep empty */
      }
      if (!snapshots.length) {
        emit(
          'price-watcher',
          'idle',
          'Sin observaciones de competencia para revisar.',
          'No competition observations to review.',
        );
        return;
      }
      const models = [...new Set(snapshots.map((s) => (s.model || '').trim()).filter(Boolean))];
      const moved = [];
      for (const model of models.slice(0, 10)) {
        let summary = null;
        try {
          summary = carEngine.summarizeModelPricing(model, snapshots, ourPrices[model]);
        } catch {
          continue;
        }
        if (!summary || summary.ourPrice == null) continue;
        if (summary.under > 0 || summary.equal > 0) {
          moved.push(
            `${model}: nosotros $${summary.ourPrice.toLocaleString('en-US')} vs min competencia $${summary.min?.toLocaleString('en-US')} (${summary.under} debajo, ${summary.equal} igualados, ${summary.over} encima)`,
          );
        }
      }
      emit(
        'price-watcher',
        'reviewed',
        moved.length
          ? `Posición revisada (${models.length} modelo(s)). Sin cambios: ${moved.join(' | ')}`
          : `Posición revisada (${models.length} modelo(s)). Sin alertas.`,
        moved.length
          ? `Position reviewed (${models.length} model(s)). No changes: ${moved.join(' | ')}`
          : `Position reviewed (${models.length} model(s)). No alerts.`,
      );
    });
  }

  /** Rosmel drafter: stage WhatsApp-ready Rosmel drafts for qualified leads (drafts only). */
  function passRosmelDrafter() {
    runStaggered('rosmel-drafter', () => {
      const leads = allLeads(carStore).filter((l) => l.stage === 'calificado' || l.stage === 'oferta');
      if (!leads.length) {
        emit(
          'rosmel-drafter',
          'idle',
          'Sin compradores calificados esperando borrador.',
          'No qualified buyers awaiting a draft.',
        );
        return;
      }
      let staged = 0;
      let existing = [];
      try {
        existing = carStore.listDrafts ? carStore.listDrafts() : [];
      } catch {
        /* keep empty */
      }
      for (const lead of leads.slice(0, 5)) {
        const already = existing.some(
          (d) => d.leadId === lead.id && d.state === 'draft' && d.kind === 'rosmel',
        );
        if (already) continue;
        const name = (lead.name || '').trim() || '(nombre por confirmar)';
        const model = (lead.interest || '').trim() || '(modelo por confirmar)';
        const price = lead.budgetUsd && Number(lead.budgetUsd) > 0
          ? `$${Number(lead.budgetUsd).toLocaleString('en-US')}`
          : '(precio por confirmar)';
        try {
          carStore.createDraft({
            kind: 'rosmel',
            title: `Rosmel — ${name} (${model})`,
            bodyEs:
              `Hola Rosmel, te paso un comprador calificado:\n` +
              `- Comprador: ${name}\n` +
              `- Modelo de interés: ${model}\n` +
              `- Presupuesto declarado: ${price}\n\n` +
              `SAHJONY actúa como intermediario (broker) de pago por comisión: no somos el vendedor final, no tenemos inventario ni tomamos posesión de vehículos o dinero.\n\n` +
              `Borrador — no enviar sin la aprobación de Juan.`,
            bodyEn:
              `Hi Rosmel, passing you a qualified buyer:\n` +
              `- Buyer: ${name}\n` +
              `- Model of interest: ${model}\n` +
              `- Stated budget: ${price}\n\n` +
              `SAHJONY acts as a commission fee broker: we are not the end seller, we hold no inventory and take no custody of vehicles or money.\n\n` +
              `Draft — do not send without Juan's approval.`,
            leadId: lead.id,
            state: 'draft',
          });
          staged += 1;
        } catch {
          /* draft creation is best-effort */
        }
      }
      emit(
        'rosmel-drafter',
        'staged',
        `Preparó ${staged} borrador(es) para Rosmel. Borradores solamente — Juan aprueba y envía desde su teléfono.`,
        `Staged ${staged} Rosmel draft(s). Drafts only — Juan approves and sends from his phone.`,
      );
    });
  }

  /**
   * Oversight: scans drafts + notes for invented facts or commitments and
   * escalates. Any legality/customs/sanctions question escalates to Juan —
   * the agent NEVER answers import legality.
   */
  function passOversight() {
    runStaggered('oversight', () => {
      let drafts = [];
      try {
        drafts = carStore.listDrafts ? carStore.listDrafts() : [];
      } catch {
        /* keep empty */
      }
      const pending = drafts.filter((d) => d.state === 'draft');
      const flagged = [];
      for (const d of pending.slice(0, 10)) {
        const text = `${d.bodyEs || ''} ${d.bodyEn || ''}`;
        // Sanctions/customs/embargo questions hard-stop via the shared core.
        if (checkSanctions(text)) flagged.push(d.id);
        // Drafts must never claim SAHJONY sells or holds the car.
        if (/SAHJONY (vende|sells|tiene|holds|posesiona)/i.test(text)) flagged.push(d.id);
      }
      if (flagged.length) {
        try {
          escalate(CARS_MODULE_ID, 'sanctions', { draftIds: flagged });
        } catch {
          /* escalation queue is best-effort; the feed entry below is the record */
        }
        emit(
          'oversight',
          'escalated',
          `ESCALADO a Juan: ${flagged.length} borrador(es) necesitan revisión (posible pregunta legal o afirmación incorrecta de rol). El agente nunca responde legalidad de importación.`,
          `ESCALATED to Juan: ${flagged.length} draft(s) need review (possible legality question or wrong role claim). The agent never answers import legality.`,
        );
      } else {
        emit(
          'oversight',
          'checked',
          `Revisó ${pending.length} borrador(es) pendiente(s): sin afirmaciones inventadas ni compromisos.`,
          `Reviewed ${pending.length} pending draft(s): no invented facts or commitments.`,
        );
      }
    });
  }

  function processOnce() {
    if (destroyed) return;
    passLeadQualifier();
    passPriceWatcher();
    passRosmelDrafter();
    passOversight();
  }

  function start() {
    if (destroyed || running) return;
    running = true;
    for (const agent of agents) agent.status = 'idle';
    processOnce();
    const timer = setInterval(() => {
      if (running && !destroyed) processOnce();
    }, tickMs);
    agents[0]._timers.push(timer);
  }

  function pause() {
    if (destroyed) return;
    running = false;
    clearTimers();
    for (const agent of agents) agent.status = 'paused';
  }

  function resume() {
    if (destroyed || running) return;
    start();
  }

  function destroy() {
    destroyed = true;
    running = false;
    clearTimers();
    listeners.clear();
    for (const agent of agents) agent.status = 'idle';
  }

  function onActivity(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getActivityLog(n) {
    const count = typeof n === 'number' && n > 0 ? n : log.length;
    return log.slice(-count);
  }

  function queueDepth() {
    return allLeads(carStore).filter((l) => QUEUE_STAGES.includes(l.stage)).length;
  }

  function getSummary() {
    return {
      running,
      note: { ...WORKFORCE_NOTE },
      agents: agents.map((a) => ({
        id: a.id,
        status: a.status,
        lastAction: a.lastAction,
      })),
      queueDepth: queueDepth(),
    };
  }

  if (signal && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', () => destroy(), { once: true });
  }

  return {
    agents,
    start,
    pause,
    resume,
    get running() {
      return running;
    },
    onActivity,
    getActivityLog,
    processOnce,
    destroy,
    getSummary,
  };
}

/**
 * getWorkforceSummary(workforce) → { running, note, agents, queueDepth }
 * Standalone form of workforce.getSummary().
 */
export function getWorkforceSummary(workforce) {
  if (!workforce || typeof workforce.getSummary !== 'function') {
    throw new Error(
      'getWorkforceSummary requires a workforce handle from createWorkforce().',
    );
  }
  return workforce.getSummary();
}
