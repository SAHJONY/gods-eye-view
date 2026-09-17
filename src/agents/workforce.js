/**
 * SAHJONY · GOD'S EYE VIEW — Wholesale Real Estate Intelligence Workforce
 * -----------------------------------------------------------------------
 * Client-side only. $0. No API keys. No external network calls.
 * The workforce runs ONLY while the app is open — nothing runs in the
 * background (see WORKFORCE_NOTE).
 *
 * HARD RULES (approval gates — never bypassed):
 *   - Agents NEVER send, email, post, purchase, sign, call, or text.
 *   - Agents NEVER delete leads.
 *   - All outputs are drafts, notes, and memos stored inside the lead record.
 *   - The UI decides what Juan sees; the engine only proposes.
 *
 * Injected collaborators:
 *   - leadStore: { getAll(), get(id), update(id, patch) }
 *     Lead shape: { id, address, lat, lng, status, ownerType, arv, repairs,
 *                   notes: [{ t, agent, es, en }] }
 *     Lead statuses: new → researching → analyzed → offer → contract
 *   - dealEngine: { scoreLead(lead) -> number,
 *                   maxAllowableOffer(lead) -> number,
 *                   rankBuyer(buyer, lead) -> 'green'|'yellow'|'red' }
 *   - buyers are injected via setBuyers([...]) and ranked by dispositions.
 */

export const WORKFORCE_LOG_KEY = 'sahjony.workforce.log.v1';
const LOG_CAP = 300;

/** Honest framing — the workforce is active only while the app is open. */
export const WORKFORCE_NOTE = {
  es: 'La fuerza trabaja mientras la app está abierta.',
  en: 'The workforce runs while the app is open.',
};

export const OFFER_SCORE_FLOOR = 60;

// Appraisal-district research templates (no API key, plain links).
const HCAD_SEARCH_TEMPLATE =
  'https://hcad.org/iSearch/zz/dia/asp/actSearch.asp'; // Harris County (HCAD) — search by address

const ROLE_DEFS = [
  { id: 'scout', name: { es: 'Explorador', en: 'Scout' }, role: 'triage' },
  {
    id: 'researcher',
    name: { es: 'Investigador', en: 'Researcher' },
    role: 'research',
  },
  { id: 'analyst', name: { es: 'Analista', en: 'Analyst' }, role: 'analysis' },
  {
    id: 'dispositions',
    name: { es: 'Disposiciones', en: 'Dispositions' },
    role: 'dispositions',
  },
];

const QUEUE_STATUSES = ['new', 'researching', 'analyzed'];

function hasValidLocation(lead) {
  return (
    lead &&
    typeof lead.address === 'string' &&
    lead.address.trim().length > 0 &&
    typeof lead.lat === 'number' &&
    typeof lead.lng === 'number' &&
    Number.isFinite(lead.lat) &&
    Number.isFinite(lead.lng) &&
    Math.abs(lead.lat) <= 90 &&
    Math.abs(lead.lng) <= 180
  );
}

function researchChecklist(lead) {
  const address = lead.address || '';
  return {
    es:
      'Lista de investigación:\n' +
      `1. Verificar propietario en HCAD (Harris County): ${HCAD_SEARCH_TEMPLATE} — buscar "${address}".\n` +
      '2. Verificar en el distrito de tasación del condado correspondiente (enlace genérico: el sitio web del "county appraisal district").\n' +
      '3. Confirmar tipo de propietario: individuo vs. entidad (las entidades se marcan — la meta son individuos).\n' +
      '4. Revisar historial de impuestos y gravámenes si está disponible.',
    en:
      'Research checklist:\n' +
      `1. Verify owner at HCAD (Harris County): ${HCAD_SEARCH_TEMPLATE} — search "${address}".\n` +
      '2. Check the matching county appraisal district website (generic: the "county appraisal district" site).\n' +
      '3. Confirm owner type: individual vs. entity (entities are flagged — individuals are the target).\n' +
      '4. Review tax and lien history where available.',
  };
}

function readStoredLog() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(WORKFORCE_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredLog(events) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      WORKFORCE_LOG_KEY,
      JSON.stringify(events.slice(-LOG_CAP)),
    );
  } catch {
    // Storage may be unavailable/private — the in-memory log still works.
  }
}

/**
 * createWorkforce({ leadStore, dealEngine, signal, tickMs, staggerMs })
 * Returns the orchestrator handle.
 */
export function createWorkforce(opts = {}) {
  const {
    leadStore,
    dealEngine,
    signal,
    tickMs = 20000,
    staggerMs = 5000,
  } = opts;
  if (
    !leadStore ||
    typeof leadStore.getAll !== 'function' ||
    typeof leadStore.update !== 'function'
  ) {
    throw new Error(
      'createWorkforce requires a leadStore with getAll()/update().',
    );
  }
  if (!dealEngine) {
    throw new Error('createWorkforce requires a dealEngine.');
  }

  let running = false;
  let destroyed = false;
  let buyers = [];
  const listeners = new Set();
  let log = readStoredLog();

  const agents = ROLE_DEFS.map((def) => ({
    id: def.id,
    name: { ...def.name },
    role: def.role,
    status: 'idle', // idle | working | paused
    lastAction: null,
    _timers: [],
  }));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  function addNote(lead, agentId, es, en) {
    const note = { t: Date.now(), agent: agentId, es, en };
    const existing = leadStore.get ? leadStore.get(lead.id) : null;
    const current = existing || lead;
    const notes = [...(current.notes || []), note];
    leadStore.update(lead.id, { ...current, notes });
    return note;
  }

  function setStatus(lead, status) {
    leadStore.update(lead.id, { status });
  }

  function emit(agentId, kind, es, en, leadId) {
    const agent = byId[agentId];
    const event = { t: Date.now(), agent: agentId, kind, es, en };
    if (leadId !== undefined && leadId !== null) event.leadId = leadId;
    agent.lastAction = event;
    log.push(event);
    if (log.length > LOG_CAP) log = log.slice(-LOG_CAP);
    writeStoredLog(log);
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        // A listener must never break the workforce.
      }
    }
  }

  function allLeads() {
    try {
      const leads = leadStore.getAll();
      return Array.isArray(leads) ? leads : [];
    } catch {
      return [];
    }
  }

  // -- scout: new → researching after address/coords validation ----------------
  function runScout() {
    const agent = byId.scout;
    for (const lead of allLeads()) {
      if (lead.status !== 'new') continue;
      if (hasValidLocation(lead)) {
        setStatus(lead, 'researching');
        addNote(
          lead,
          'scout',
          `Dirección y coordenadas validadas (${lead.address}). Pasando a investigación.`,
          `Address and coordinates validated (${lead.address}). Moving to research.`,
        );
        emit(
          'scout',
          'triaged',
          `Nuevo lead validado: ${lead.address}`,
          `New lead validated: ${lead.address}`,
          lead.id,
        );
      } else {
        addNote(
          lead,
          'scout',
          'Faltan datos: dirección o coordenadas inválidas. Se necesita la dirección completa y lat/lng antes de investigar.',
          'Missing data: invalid address or coordinates. Needs a full address and lat/lng before research.',
        );
        emit(
          'scout',
          'flagged',
          `Lead sin datos suficientes: ${lead.id}`,
          `Lead missing data: ${lead.id}`,
          lead.id,
        );
      }
    }
  }

  // -- researcher: researching → analyzed when owner known --------------------
  function runResearcher() {
    const agent = byId.researcher;
    for (const lead of allLeads()) {
      if (lead.status !== 'researching') continue;
      const checklist = researchChecklist(lead);
      const ownerType = lead.ownerType || null;

      if (ownerType === 'entity') {
        addNote(
          lead,
          'researcher',
          'BANDERA: el propietario es una entidad. La regla del dueño es trabajar con individuos — este lead queda marcado para revisión.',
          'FLAG: owner is an entity. The owner rule targets individuals — this lead is flagged for review.',
        );
      }
      addNote(lead, 'researcher', checklist.es, checklist.en);

      if (ownerType === 'individual' || ownerType === 'entity') {
        addNote(
          lead,
          'researcher',
          `Propietario conocido (${ownerType === 'individual' ? 'individuo' : 'entidad'}). Pasando a análisis.`,
          `Owner known (${ownerType}). Moving to analysis.`,
        );
        setStatus(lead, 'analyzed');
        emit(
          'researcher',
          'researched',
          `Investigación completa: ${lead.address} (propietario: ${ownerType})`,
          `Research complete: ${lead.address} (owner: ${ownerType})`,
          lead.id,
        );
      } else {
        addNote(
          lead,
          'researcher',
          'Tipo de propietario aún desconocido. Lista de investigación guardada; se queda en investigación.',
          'Owner type still unknown. Research checklist saved; stays in research.',
        );
        emit(
          'researcher',
          'flagged',
          `Propietario desconocido: ${lead.address}`,
          `Owner unknown: ${lead.address}`,
          lead.id,
        );
      }
    }
  }

  // -- analyst: analyzed → offer when score ≥ 60 --------------------------------
  function runAnalyst() {
    const agent = byId.analyst;
    for (const lead of allLeads()) {
      if (lead.status !== 'analyzed') continue;
      const arv = lead.arv;
      const repairs = lead.repairs;
      if (
        typeof arv !== 'number' ||
        arv <= 0 ||
        typeof repairs !== 'number' ||
        repairs < 0
      ) {
        addNote(
          lead,
          'analyst',
          'Faltan ARV y/o reparaciones estimadas. Por favor agrega ambos valores para calcular el puntaje y la oferta máxima.',
          'Missing ARV and/or estimated repairs. Please add both values so score and max offer can be computed.',
        );
        emit(
          'analyst',
          'flagged',
          `Faltan ARV/reparaciones: ${lead.address}`,
          `Missing ARV/repairs: ${lead.address}`,
          lead.id,
        );
        continue;
      }
      const score = Number(dealEngine.scoreLead(lead));
      const mao = Number(dealEngine.maxAllowableOffer(lead));
      const memoEs =
        `Nota de trato — ${lead.address}:\n` +
        `Puntaje: ${score}/100. Oferta máxima admisible: $${Math.round(mao).toLocaleString('en-US')}.\n` +
        `ARV: $${Math.round(arv).toLocaleString('en-US')}, reparaciones: $${Math.round(repairs).toLocaleString('en-US')}.\n` +
        (score >= OFFER_SCORE_FLOOR
          ? 'Puntaje ≥ 60: listo para oferta. La oferta final la aprueba Juan.'
          : 'Puntaje < 60: no avanza a oferta; se guarda el análisis.');
      const memoEn =
        `Deal memo — ${lead.address}:\n` +
        `Score: ${score}/100. Max allowable offer: $${Math.round(mao).toLocaleString('en-US')}.\n` +
        `ARV: $${Math.round(arv).toLocaleString('en-US')}, repairs: $${Math.round(repairs).toLocaleString('en-US')}.\n` +
        (score >= OFFER_SCORE_FLOOR
          ? 'Score ≥ 60: ready for offer. Juan approves the final offer.'
          : 'Score < 60: not moving to offer; analysis saved.');
      addNote(lead, 'analyst', memoEs, memoEn);
      if (score >= OFFER_SCORE_FLOOR) {
        setStatus(lead, 'offer');
        emit(
          'analyst',
          'memo',
          `Nota de trato escrita (${score}/100): ${lead.address}`,
          `Deal memo written (${score}/100): ${lead.address}`,
          lead.id,
        );
      } else {
        emit(
          'analyst',
          'flagged',
          `Puntaje bajo (${score}/100): ${lead.address}`,
          `Low score (${score}/100): ${lead.address}`,
          lead.id,
        );
      }
    }
  }

  // -- dispositions: rank buyers for offer/contract leads ----------------------
  function runDispositions() {
    const agent = byId.dispositions;
    for (const lead of allLeads()) {
      if (lead.status !== 'offer' && lead.status !== 'contract') continue;
      if (buyers.length === 0) {
        emit(
          'dispositions',
          'flagged',
          `Sin compradores cargados para: ${lead.address}. Agrega compradores para comparar.`,
          `No buyers loaded for: ${lead.address}. Add buyers to compare.`,
          lead.id,
        );
        continue;
      }
      const ranked = buyers.map((b) => {
        let fit = 'yellow';
        let fee = 0;
        try {
          // Real dealEngine contract: rankBuyer({ buyerMaxOffer, contractPrice, targetFee })
          // returns { tier, fee, note }. Buyer max offer may live on maxOffer
          // (dashboard shape) or buyBox.maxPrice (leadStore shape).
          const buyMax = Number(b?.maxOffer ?? b?.buyBox?.maxPrice ?? 0) || 0;
          const ranked0 = dealEngine.rankBuyer({
            buyerMaxOffer: buyMax,
            contractPrice: lead.contractPrice,
            targetFee: lead.targetFee,
          });
          if (ranked0 && typeof ranked0.tier === 'string') fit = ranked0.tier;
          else if (typeof ranked0 === 'string') fit = ranked0; // legacy/test doubles
          if (ranked0 && typeof ranked0.fee === 'number') fee = ranked0.fee;
        } catch {
          fit = 'yellow';
        }
        return { buyer: b, fit, fee };
      });
      const order = { green: 0, yellow: 1, red: 2 };
      ranked.sort((a, b2) => (order[a.fit] ?? 1) - (order[b2.fit] ?? 1));
      const lines = ranked.map(({ buyer, fit }) => {
        const label = buyer && buyer.name ? buyer.name : 'Comprador';
        return { label, fit };
      });
      const es =
        `Coincidencia de compradores — ${lead.address}:\n` +
        lines
          .map(
            (l) =>
              `• ${l.label}: ${l.fit === 'green' ? 'verde (encaja)' : l.fit === 'red' ? 'rojo (no encaja)' : 'amarillo (revisar)'}`,
          )
          .join('\n') +
        '\nNadie ha sido contactado — esto es solo un borrador para revisión.';
      const en =
        `Buyer match — ${lead.address}:\n` +
        lines
          .map(
            (l) =>
              `• ${l.label}: ${l.fit === 'green' ? 'green (fits)' : l.fit === 'red' ? 'red (no fit)' : 'yellow (review)'}`,
          )
          .join('\n') +
        '\nNobody has been contacted — this is a draft for review only.';
      addNote(lead, 'dispositions', es, en);
      emit(
        'dispositions',
        'buyer-match',
        `Compradores evaluados para ${lead.address} (${ranked.filter((r) => r.fit === 'green').length} en verde)`,
        `Buyers ranked for ${lead.address} (${ranked.filter((r) => r.fit === 'green').length} green)`,
        lead.id,
      );
    }
  }

  const passes = [runScout, runResearcher, runAnalyst, runDispositions];

  function runAgentPass(agent) {
    if (destroyed) return;
    try {
      passes[agents.indexOf(agent)]();
    } catch (err) {
      emit(
        agent.id,
        'error',
        `Error en el agente ${agent.name.es}: ${err && err.message ? err.message : err}`,
        `Agent ${agent.name.en} error: ${err && err.message ? err.message : err}`,
      );
    }
  }

  function processOnce() {
    if (destroyed) return;
    for (const agent of agents) {
      const prev = agent.status;
      agent.status = 'working';
      try {
        passes[agents.indexOf(agent)]();
      } finally {
        agent.status = running
          ? 'working'
          : prev === 'paused'
            ? 'paused'
            : 'idle';
      }
    }
  }

  function clearTimers() {
    for (const agent of agents) {
      for (const t of agent._timers) {
        clearTimeout(t);
        clearInterval(t);
      }
      agent._timers = [];
    }
  }

  function start() {
    if (destroyed || running) return;
    running = true;
    agents.forEach((agent, i) => {
      agent.status = 'working';
      const startTimer = setTimeout(() => {
        if (!running || destroyed) return;
        runAgentPass(agent);
        const iv = setInterval(() => {
          if (!running || destroyed) return;
          runAgentPass(agent);
        }, tickMs);
        agent._timers.push(iv);
      }, i * staggerMs);
      agent._timers.push(startTimer);
    });
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
    return allLeads().filter((l) => QUEUE_STATUSES.includes(l.status)).length;
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
    setBuyers(list) {
      buyers = Array.isArray(list) ? list : [];
    },
    getBuyers() {
      return [...buyers];
    },
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
