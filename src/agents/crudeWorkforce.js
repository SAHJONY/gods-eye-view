/**
 * SAHJONY · GOD'S EYE VIEW — Crude Oil Brokerage Workforce
 * -----------------------------------------------------------------------
 * Client-side only. $0. No API keys. No external network calls.
 * The workforce runs ONLY while the app is open — nothing runs in the
 * background (see WORKFORCE_NOTE).
 *
 * HARD RULES (approval gates — never bypassed):
 *   - Agents NEVER send, email, post, purchase, sign, call, or text.
 *   - Agents NEVER contact or screen any real counterparty.
 *   - Agents NEVER delete cargoes.
 *   - All outputs are drafts, notes, and memos stored inside the cargo record.
 *   - The UI decides what Juan sees; the engine only proposes.
 *
 * Injected collaborators:
 *   - cargoStore: { getAll(), get(id), update(id, patch) }
 *     Cargo shape: { id, ref, grade, volumeBbl, buyPrice, sellPrice,
 *                    commissionPerBbl, incoterms, laycanStart, laycanEnd,
 *                    loadPort, dischargePort, supplierId, buyerId, status,
 *                    costs: { freight, insurance, inspection, other },
 *                    notes: [{ t, agent, es, en }] }
 *     Cargo statuses: prospect → diligence → negotiating → (beyond agent scope)
 *   - cargoEngine: { cargoVerdict(cargo) -> { tier, es, en },
 *                    brokerCommission({ volumeBbl, commissionPerBbl }) -> number,
 *                    netPerBbl(cargo) -> number,
 *                    missingFields(cargo) -> [{ field, es, en }],
 *                    scoreCargo(cargo) -> number }
 *     Engine calls are defensive: every call is wrapped in try/catch with
 *     'yellow'/0 fallbacks, so a throwing engine can never break the passes.
 *   - buyers are injected via setBuyers([...]) and ranked by dispositions.
 *     Buyer shape: { name, type, role, verification, country, diligence? }
 *     (diligence is an optional checklist state from
 *     src/crude/diligenceChecklist.js; any sanctions red flag triggers the
 *     SANCTIONS_HARD_STOP escalation — the workforce never advises.)
 *
 * Workforce-core integration (src/agents/workforceCore.js, Module 6):
 * the core may not exist yet, so it is imported defensively. When present,
 * this module registers its agent roster and routes every logged action and
 * every escalation through the core (logAction / escalate); when absent,
 * the local log + local escalation record carry the same shape.
 */

import {
  SANCTIONS_HARD_STOP,
  SANCTIONS_BANNER,
  hasSanctionsFlag,
  buildSanctionsEscalation,
} from '../crude/diligenceChecklist.js';

export { SANCTIONS_HARD_STOP };

/** Defensive handle on the workforce core (Module 6) — null until it lands. */
const workforceCore = await import('./workforceCore.js').catch(() => null);

/**
 * Agent roster in the workforce-core shape (registerWorkforce).
 * Tiers follow the core spec: READ observe, DRAFT write internal drafts,
 * PROPOSE stage in Juan's approval queue. There is NO execute tier.
 */
export const CRUDE_AGENT_ROSTER = Object.freeze([
  { id: 'scout', role: 'sourcing', tier: 'read', lang: 'bilingual' },
  {
    id: 'researcher',
    role: 'counterparty-diligence',
    tier: 'propose',
    lang: 'bilingual',
  },
  { id: 'analyst', role: 'pricing-economics', tier: 'read', lang: 'bilingual' },
  {
    id: 'dispositions',
    role: 'outreach-drafting',
    tier: 'draft',
    lang: 'bilingual',
  },
]);

/** Register this module's workforce with the core (no-op until the core lands). */
export function registerCrudeWorkforce() {
  try {
    workforceCore?.registerWorkforce?.('crude', CRUDE_AGENT_ROSTER);
    return true;
  } catch {
    return false;
  }
}

// Best-effort registration at module load; callers may also call it directly.
registerCrudeWorkforce();

/**
 * Route an action through the workforce core's logAction when available.
 * The local activity log below is always written too.
 */
function coreLogAction(agentId, action) {
  try {
    const summary =
      action && typeof action === 'object'
        ? `${action.kind || 'action'}${action.cargoId ? ` cargo:${action.cargoId}` : ''}`
        : String(action ?? '');
    workforceCore?.logAction?.('crude', agentId, summary);
  } catch {
    /* core logging is best-effort */
  }
}

/**
 * Build a core-shaped escalation record:
 * { ts, module, reason, payload, status: 'awaiting-juan' }.
 */
export function buildCrudeEscalation(reason, payload) {
  return {
    ts: Date.now(),
    module: 'crude',
    reason: typeof reason === 'string' ? reason : 'unknown',
    payload: payload && typeof payload === 'object' ? payload : {},
    status: 'awaiting-juan',
  };
}

/**
 * Escalate through the workforce core when available; always returns the
 * local escalation record (status 'awaiting-juan'). Nothing is ever sent,
 * posted, or acted on — the escalation waits for Juan.
 */
export function escalateCrude(reason, payload) {
  const escalation = buildCrudeEscalation(reason, payload);
  try {
    workforceCore?.escalate?.('crude', reason, escalation.payload);
  } catch {
    /* core escalation is best-effort */
  }
  return escalation;
}

export const WORKFORCE_LOG_KEY = 'sahjony.crude.workforce.log.v1';
const LOG_CAP = 300;

/** Honest framing — the workforce is active only while the app is open. */
export const WORKFORCE_NOTE = {
  es: 'La fuerza trabaja mientras la app está abierta.',
  en: 'The workforce runs while the app is open.',
};

const ROLE_DEFS = [
  { id: 'scout', name: { es: 'Explorador', en: 'Scout' }, role: 'triage' },
  {
    id: 'researcher',
    name: { es: 'Investigador', en: 'Researcher' },
    role: 'diligence',
  },
  { id: 'analyst', name: { es: 'Analista', en: 'Analyst' }, role: 'analysis' },
  {
    id: 'dispositions',
    name: { es: 'Disposiciones', en: 'Dispositions' },
    role: 'dispositions',
  },
];

const QUEUE_STATUSES = ['prospect', 'diligence', 'negotiating'];

const VERDICT_TIERS = new Set(['green', 'yellow', 'red']);

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

function hasValidTriage(cargo) {
  return (
    cargo &&
    typeof cargo.ref === 'string' &&
    cargo.ref.trim().length > 0 &&
    typeof cargo.volumeBbl === 'number' &&
    cargo.volumeBbl > 0 &&
    typeof cargo.loadPort === 'string' &&
    cargo.loadPort.trim().length > 0 &&
    typeof cargo.dischargePort === 'string' &&
    cargo.dischargePort.trim().length > 0
  );
}

function missingTriageFields(cargo) {
  const missing = [];
  if (!(typeof cargo.ref === 'string' && cargo.ref.trim().length > 0)) {
    missing.push({ es: 'referencia', en: 'reference' });
  }
  if (!(typeof cargo.volumeBbl === 'number' && cargo.volumeBbl > 0)) {
    missing.push({
      es: 'volumen en barriles (> 0)',
      en: 'volume in barrels (> 0)',
    });
  }
  if (!(
    typeof cargo.loadPort === 'string' && cargo.loadPort.trim().length > 0
  )) {
    missing.push({ es: 'puerto de carga', en: 'load port' });
  }
  if (!(
    typeof cargo.dischargePort === 'string' &&
    cargo.dischargePort.trim().length > 0
  )) {
    missing.push({ es: 'puerto de descarga', en: 'discharge port' });
  }
  return missing;
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
 * createWorkforce({ cargoStore, cargoEngine, signal, tickMs, staggerMs })
 * Returns the orchestrator handle.
 */
export function createWorkforce(opts = {}) {
  const {
    cargoStore,
    cargoEngine,
    signal,
    tickMs = 20000,
    staggerMs = 5000,
  } = opts;
  if (
    !cargoStore ||
    typeof cargoStore.getAll !== 'function' ||
    typeof cargoStore.update !== 'function'
  ) {
    throw new Error(
      'createWorkforce requires a cargoStore with getAll()/update().',
    );
  }
  if (!cargoEngine) {
    throw new Error('createWorkforce requires a cargoEngine.');
  }

  let running = false;
  let destroyed = false;
  let buyers = [];
  const listeners = new Set();
  let log = readStoredLog();

  // Sanctions hold: cargo ids the researcher escalated under SANCTIONS_HARD_STOP.
  // The analyst NEVER writes a memo or advances a held cargo — only Juan can
  // release it (releaseSanctionsHold). Rehydrated from the stored log so the
  // hold survives a page reload.
  const sanctionsHold = new Set();
  for (const e of log) {
    if (e && e.kind === 'sanctions-escalation' && e.cargoId) {
      sanctionsHold.add(e.cargoId);
    }
  }

  const agents = ROLE_DEFS.map((def) => ({
    id: def.id,
    name: { ...def.name },
    role: def.role,
    status: 'idle', // idle | working | paused
    lastAction: null,
    _timers: [],
  }));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  function addNote(cargo, agentId, es, en) {
    const note = { t: Date.now(), agent: agentId, es, en };
    const existing = cargoStore.get ? cargoStore.get(cargo.id) : null;
    const current = existing || cargo;
    const notes = [...(current.notes || []), note];
    cargoStore.update(cargo.id, { ...current, notes });
    return note;
  }

  function setStatus(cargo, status) {
    cargoStore.update(cargo.id, { status });
  }

  function emit(agentId, kind, es, en, cargoId, extra) {
    const agent = byId[agentId];
    const event = { t: Date.now(), agent: agentId, kind, es, en };
    if (cargoId !== undefined && cargoId !== null) event.cargoId = cargoId;
    if (extra && typeof extra === 'object') Object.assign(event, extra);
    agent.lastAction = event;
    log.push(event);
    if (log.length > LOG_CAP) log = log.slice(-LOG_CAP);
    writeStoredLog(log);
    coreLogAction(agentId, { kind, cargoId: event.cargoId ?? null });
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        // A listener must never break the workforce.
      }
    }
  }

  function allCargoes() {
    try {
      const cargoes = cargoStore.getAll();
      return Array.isArray(cargoes) ? cargoes : [];
    } catch {
      return [];
    }
  }

  // -- defensive cargoEngine wrappers ---------------------------------------
  function safeVerdict(cargo) {
    try {
      const v = cargoEngine.cargoVerdict(cargo);
      if (v && VERDICT_TIERS.has(v.tier)) return v;
    } catch {
      // fall through to default
    }
    return {
      tier: 'yellow',
      es: 'Veredicto no disponible (motor defensivo): se usa amarillo por defecto.',
      en: 'Verdict unavailable (defensive engine): defaulting to yellow.',
    };
  }

  function safeNet(cargo) {
    try {
      const n = Number(cargoEngine.netPerBbl(cargo));
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  function safeCommission(cargo) {
    try {
      const c = Number(
        cargoEngine.brokerCommission({
          volumeBbl: cargo.volumeBbl,
          commissionPerBbl: cargo.commissionPerBbl,
        }),
      );
      return Number.isFinite(c) ? c : 0;
    } catch {
      return 0;
    }
  }

  function safeMissingFields(cargo) {
    try {
      const m = cargoEngine.missingFields(cargo);
      return Array.isArray(m) ? m : [];
    } catch {
      return [];
    }
  }

  function safeScore(cargo) {
    try {
      const s = Number(cargoEngine.scoreCargo(cargo));
      return Number.isFinite(s) ? s : 0;
    } catch {
      return 0;
    }
  }

  // -- scout: prospect → diligence after triage-data validation ---------------
  function runScout() {
    for (const cargo of allCargoes()) {
      if (cargo.status !== 'prospect') continue;
      if (hasValidTriage(cargo)) {
        setStatus(cargo, 'diligence');
        addNote(
          cargo,
          'scout',
          `Datos de triaje validados (${cargo.ref}: ${fmtInt(cargo.volumeBbl)} bbl, ${cargo.loadPort} → ${cargo.dischargePort}). Pasando a diligencia.`,
          `Triage data validated (${cargo.ref}: ${fmtInt(cargo.volumeBbl)} bbl, ${cargo.loadPort} → ${cargo.dischargePort}). Moving to diligence.`,
        );
        emit(
          'scout',
          'triaged',
          `Cargamento validado: ${cargo.ref}`,
          `Cargo validated: ${cargo.ref}`,
          cargo.id,
        );
      } else {
        const missing = missingTriageFields(cargo);
        const missingEs = missing.map((m) => m.es).join(', ');
        const missingEn = missing.map((m) => m.en).join(', ');
        addNote(
          cargo,
          'scout',
          `Faltan datos para el triaje: ${missingEs}. Nada se inventa — agrega estos valores antes de continuar.`,
          `Missing triage data: ${missingEn}. Nothing is invented — add these values before continuing.`,
        );
        emit(
          'scout',
          'flagged',
          `Cargamento sin datos suficientes: ${cargo.id}`,
          `Cargo missing data: ${cargo.id}`,
          cargo.id,
        );
      }
    }
  }

  // -- researcher: diligence — counterparty-diligence checklist, never advances
  function findCounterparty(cargo) {
    const want = [cargo.supplierId, cargo.buyerId].filter(
      (s) => typeof s === 'string' && s.trim().length > 0,
    );
    for (const w of want) {
      const hit = buyers.find(
        (b) =>
          b &&
          typeof b.name === 'string' &&
          b.name.trim().toLowerCase() === w.trim().toLowerCase(),
      );
      if (hit) return hit;
    }
    return null;
  }

  function diligenceChecklist(cargo) {
    const ref = cargo.ref || '(sin referencia)';
    return {
      es:
        `Lista de diligencia de contraparte — ${ref}:\n` +
        '1. Verificar la identidad de la contraparte por contacto directo (esto lo hace Juan, no la fuerza).\n' +
        '2. Solicitar documentos de la empresa: registro mercantil, identificación fiscal, certificado de vigencia.\n' +
        '3. No hay fuente automática de verificación de sanciones o listas: la verificación es manual.\n' +
        '4. Todo queda como nota en el registro del cargamento — nadie es contactado ni evaluado automáticamente.',
      en:
        `Counterparty diligence checklist — ${ref}:\n` +
        "1. Verify the counterparty's identity by direct contact (this is Juan's job, not the workforce's).\n" +
        '2. Request company documents: business registration, tax ID, certificate of good standing.\n' +
        '3. There is no automatic sanctions-screening data source: verification is manual.\n' +
        '4. Everything stays as a note in the cargo record — nobody is contacted or screened automatically.',
    };
  }

  function runResearcher() {
    for (const cargo of allCargoes()) {
      if (cargo.status !== 'diligence') continue;
      const checklist = diligenceChecklist(cargo);
      addNote(cargo, 'researcher', checklist.es, checklist.en);

      const cp = findCounterparty(cargo);
      if (cp && cp.verification === 'flagged') {
        const name = cp.name || '(sin nombre)';
        addNote(
          cargo,
          'researcher',
          `BANDERA: la contraparte «${name}» está marcada como "flagged". No avanzar — requiere revisión de Juan. Ninguna evaluación automática sustituye su revisión.`,
          `FLAG: counterparty "${name}" is marked "flagged". Do not advance — requires Juan's review. No automatic screening replaces his review.`,
        );
        emit(
          'researcher',
          'flagged',
          `Contraparte marcada: ${name} (${cargo.ref})`,
          `Flagged counterparty: ${name} (${cargo.ref})`,
          cargo.id,
        );
      } else if (cp && hasSanctionsFlag(cp.diligence)) {
        // SANCTIONS HARD STOP: any sanctions red flag → escalate-always.
        // The workforce never advises on sanctions, never screens around
        // them, and never advances the cargo. It escalates and waits.
        const escalation = buildSanctionsEscalation(cp, cp.diligence);
        const recorded = escalateCrude('sanctions', escalation.payload);
        sanctionsHold.add(cargo.id);
        const name = cp.name || '(sin nombre)';
        addNote(
          cargo,
          'researcher',
          `${SANCTIONS_BANNER.es}\nContraparte: «${name}». Banderas: ${recorded.payload.flaggedItems.join(', ') || '—'}. Escalado a Juan — el cargamento se queda en diligencia.`,
          `${SANCTIONS_BANNER.en}\nCounterparty: "${name}". Flags: ${recorded.payload.flaggedItems.join(', ') || '—'}. Escalated to Juan — the cargo stays in diligence.`,
        );
        emit(
          'researcher',
          'sanctions-escalation',
          `PARADA DE SANCIONES — escalado a Juan: ${name} (${cargo.ref})`,
          `SANCTIONS HARD STOP — escalated to Juan: ${name} (${cargo.ref})`,
          cargo.id,
          { escalation: recorded },
        );
      } else {
        emit(
          'researcher',
          'diligence',
          `Diligencia registrada: ${cargo.ref} (se queda en diligencia — Juan decide)`,
          `Diligence logged: ${cargo.ref} (stays in diligence — Juan decides)`,
          cargo.id,
        );
      }
    }
  }

  // -- analyst: diligence → negotiating on green verdict ----------------------
  // Never touches a cargo under sanctions hold (hard stop).
  function runAnalyst() {
    for (const cargo of allCargoes()) {
      if (cargo.status !== 'diligence') continue;
      if (sanctionsHold.has(cargo.id)) {
        emit(
          'analyst',
          'hold',
          `Parada de sanciones vigente: ${cargo.ref || cargo.id} — sin memorando hasta que Juan la libere.`,
          `Sanctions hold active: ${cargo.ref || cargo.id} — no memo until Juan releases it.`,
          cargo.id,
        );
        continue;
      }
      const hasEconomics =
        typeof cargo.buyPrice === 'number' &&
        cargo.buyPrice > 0 &&
        typeof cargo.sellPrice === 'number' &&
        cargo.sellPrice > 0 &&
        typeof cargo.volumeBbl === 'number' &&
        cargo.volumeBbl > 0;
      if (!hasEconomics) {
        const missing = safeMissingFields(cargo);
        const lines =
          missing.length > 0
            ? missing
                .map((m) => `• ${m.es || m.field || ''} / ${m.en || ''}`)
                .join('\n')
            : '• (motor de verificación no disponible / verification engine unavailable)';
        addNote(
          cargo,
          'analyst',
          `Faltan campos para el análisis económico:\n${lines}\nAgrega precio de compra, precio de venta y volumen (> 0) para calcular el memorando.`,
          `Missing fields for the economic analysis:\n${lines}\nAdd buy price, sell price, and volume (> 0) to compute the memo.`,
        );
        emit(
          'analyst',
          'flagged',
          `Faltan precios/volumen: ${cargo.ref}`,
          `Missing prices/volume: ${cargo.ref}`,
          cargo.id,
        );
        continue;
      }
      const verdict = safeVerdict(cargo);
      const spread = cargo.sellPrice - cargo.buyPrice;
      const net = safeNet(cargo);
      const commission = safeCommission(cargo);
      const score = safeScore(cargo);
      const tierEs =
        verdict.tier === 'green'
          ? 'VERDE'
          : verdict.tier === 'red'
            ? 'ROJO'
            : 'AMARILLO';
      const tierEn = verdict.tier.toUpperCase();
      const grade = cargo.grade || 'grado sin especificar / unspecified grade';
      const memoEs =
        `Memorando de trato — ${cargo.ref} (${grade}):\n` +
        `Volumen: ${fmtInt(cargo.volumeBbl)} bbl. Diferencial: $${spread.toFixed(2)}/bbl. Neto: $${net.toFixed(2)}/bbl.\n` +
        `Comisión total del bróker: $${fmtInt(commission)}. Puntaje: ${score}/100.\n` +
        `Veredicto: ${tierEs}.${verdict.es ? ' ' + verdict.es : ''}\n` +
        (verdict.tier === 'green'
          ? 'Veredicto verde: listo para negociar. Ningún compromiso sin aprobación de Juan.'
          : 'Veredicto no verde: se guarda el memorando y el cargamento se queda en diligencia.');
      const memoEn =
        `Deal memo — ${cargo.ref} (${grade}):\n` +
        `Volume: ${fmtInt(cargo.volumeBbl)} bbl. Spread: $${spread.toFixed(2)}/bbl. Net: $${net.toFixed(2)}/bbl.\n` +
        `Total broker commission: $${fmtInt(commission)}. Score: ${score}/100.\n` +
        `Verdict: ${tierEn}.${verdict.en ? ' ' + verdict.en : ''}\n` +
        (verdict.tier === 'green'
          ? "Green verdict: ready to negotiate. No commitment without Juan's approval."
          : 'Non-green verdict: memo saved and the cargo stays in diligence.');
      addNote(cargo, 'analyst', memoEs, memoEn);
      if (verdict.tier === 'green') {
        setStatus(cargo, 'negotiating');
        emit(
          'analyst',
          'memo',
          `Memorando escrito (${tierEs}): ${cargo.ref}`,
          `Deal memo written (${tierEn}): ${cargo.ref}`,
          cargo.id,
        );
      } else {
        emit(
          'analyst',
          'flagged',
          `Veredicto ${tierEs}: ${cargo.ref}`,
          `${tierEn} verdict: ${cargo.ref}`,
          cargo.id,
        );
      }
    }
  }

  // -- dispositions: rank buyers for negotiating cargoes; contacts nobody -----
  function buyerFit(buyer) {
    const v = buyer && buyer.verification;
    if (v === 'verified') return 'green';
    if (v === 'flagged') return 'red';
    return 'yellow';
  }

  function runDispositions() {
    for (const cargo of allCargoes()) {
      if (cargo.status !== 'negotiating') continue;
      const targets = buyers.filter(
        (b) => b && (b.role === 'buyer' || b.role === 'both'),
      );
      if (targets.length === 0) {
        emit(
          'dispositions',
          'flagged',
          `Sin compradores cargados para: ${cargo.ref}. Agrega compradores para comparar.`,
          `No buyers loaded for: ${cargo.ref}. Add buyers to compare.`,
          cargo.id,
        );
        continue;
      }
      const ranked = targets.map((buyer) => ({ buyer, fit: buyerFit(buyer) }));
      const order = { green: 0, yellow: 1, red: 2 };
      ranked.sort((a, b) => (order[a.fit] ?? 1) - (order[b.fit] ?? 1));
      const fitEs = (f) =>
        f === 'green'
          ? 'verde (verificado)'
          : f === 'red'
            ? 'rojo (marcado)'
            : 'amarillo (revisar)';
      const fitEn = (f) =>
        f === 'green'
          ? 'green (verified)'
          : f === 'red'
            ? 'red (flagged)'
            : 'yellow (review)';
      const lines = ranked.map(({ buyer, fit }) => {
        const label = buyer && buyer.name ? buyer.name : 'Comprador / Buyer';
        return { label, fit };
      });
      const es =
        `Coincidencia de compradores — ${cargo.ref}:\n` +
        lines.map((l) => `• ${l.label}: ${fitEs(l.fit)}`).join('\n') +
        '\nNadie ha sido contactado — esto es solo un borrador para revisión.';
      const en =
        `Buyer match — ${cargo.ref}:\n` +
        lines.map((l) => `• ${l.label}: ${fitEn(l.fit)}`).join('\n') +
        '\nNobody has been contacted — this is a draft for review only.';
      addNote(cargo, 'dispositions', es, en);
      emit(
        'dispositions',
        'buyer-match',
        `Compradores evaluados para ${cargo.ref} (${ranked.filter((r) => r.fit === 'green').length} en verde)`,
        `Buyers ranked for ${cargo.ref} (${ranked.filter((r) => r.fit === 'green').length} green)`,
        cargo.id,
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
    return allCargoes().filter((c) => QUEUE_STATUSES.includes(c.status)).length;
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
    /** Cargo ids currently under sanctions hold (hard stop). */
    getSanctionsHold() {
      return [...sanctionsHold];
    },
    isSanctionsHeld(cargoId) {
      return sanctionsHold.has(cargoId);
    },
    /**
     * Release a sanctions hold — Juan's decision only. The UI calls this
     * after his review; the workforce never calls it by itself.
     */
    releaseSanctionsHold(cargoId) {
      return sanctionsHold.delete(cargoId);
    },
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
