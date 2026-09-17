/**
 * SAHJONY · GOD'S EYE VIEW — MY CUBA CASH Workforce
 * -----------------------------------------------------------------------
 * Client-side only. $0. No API keys. No external network calls.
 * The workforce runs ONLY while the app is open — nothing runs in the
 * background (see WORKFORCE_NOTE).
 *
 * HARD RULES (approval gates — never bypassed):
 *   - Agents NEVER send, email, post, purchase, sign, call, or text.
 *   - Agents NEVER contact or screen any real person.
 *   - Agents NEVER delete providers.
 *   - All outputs are drafts, notes, and memos stored inside the provider
 *     record (or the corridor it belongs to).
 *   - The UI decides what Juan sees; the engine only proposes.
 *
 * Injected collaborators:
 *   - providerStore: { getAll(), get(id), update(id, patch) }
 *     Provider shape: { id, name, channels: [], coverageCountries: [],
 *                       feeModel: { type, pct, flat, min, max }, status,
 *                       notes: [{ t, agent, es, en }] }
 *     Provider statuses: candidate → verifying → live (beyond agent scope)
 *     feeModel.type: 'percentage' | 'flat' | 'mixed' | 'undisclosed'
 *     Optionally: listCorridors(), getCorridor(id), updateCorridor(id, patch)
 *     Corridor shape: { id, providerId, label, sendAmount, fxRate,
 *                       notes: [{ t, agent, es, en }] }
 *   - corridorEngine: { corridorMath({ sendAmount, fee, fxRate }) -> object,
 *                       compareProviders?... }
 *     Engine calls are defensive: every call is wrapped in try/catch with
 *     neutral fallbacks, so a throwing engine can never break the passes.
 *
 * Note-dedup rule: every pass only writes notes tagged with its own agentId
 * and skips a provider/corridor that already carries one of its notes, so
 * repeated passes can never grow the notes array unboundedly.
 */

export const WORKFORCE_LOG_KEY = 'sahjony.workforce.cubacash.log.v1';
const LOG_CAP = 300;

/** Honest framing — the workforce is active only while the app is open. */
export const WORKFORCE_NOTE = {
  es: 'La fuerza trabaja mientras la app está abierta.',
  en: 'The workforce runs while the app is open.',
};

const ROLE_DEFS = [
  {
    id: 'provider-verifier',
    name: { es: 'Verificador de proveedores', en: 'Provider Verifier' },
    role: 'verification',
  },
  {
    id: 'fee-watcher',
    name: { es: 'Vigilante de tarifas', en: 'Fee Watcher' },
    role: 'fees',
  },
  {
    id: 'corridor-analyst',
    name: { es: 'Analista de corredores', en: 'Corridor Analyst' },
    role: 'analysis',
  },
  {
    id: 'intake-helper',
    name: { es: 'Ayudante de captación', en: 'Intake Helper' },
    role: 'outreach',
  },
];

const QUEUE_STATUSES = ['candidate', 'verifying'];

/**
 * hasAgentNote(item, agentId) → boolean
 * True when the item's notes array already carries a note from agentId.
 * Used for the dedup rule: each pass only writes its own notes once.
 */
export function hasAgentNote(item, agentId) {
  if (!item || !agentId) return false;
  const notes = item.notes;
  if (!Array.isArray(notes)) return false;
  return notes.some((n) => n && n.agent === agentId);
}

function fmtMoney(n) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
 * createWorkforce({ providerStore, corridorEngine, signal, tickMs, staggerMs })
 * Returns the orchestrator handle.
 */
export function createWorkforce(opts = {}) {
  const {
    providerStore,
    corridorEngine,
    signal,
    tickMs = 20000,
    staggerMs = 5000,
  } = opts;
  if (
    !providerStore ||
    typeof providerStore.getAll !== 'function' ||
    typeof providerStore.update !== 'function'
  ) {
    throw new Error(
      'createWorkforce requires a providerStore with getAll()/update().',
    );
  }
  if (!corridorEngine) {
    throw new Error('createWorkforce requires a corridorEngine.');
  }

  let running = false;
  let destroyed = false;
  let providers = [];
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

  function addProviderNote(provider, agentId, es, en) {
    const note = { t: Date.now(), agent: agentId, es, en };
    const existing = providerStore.get ? providerStore.get(provider.id) : null;
    const current = existing || provider;
    const notes = [...(current.notes || []), note];
    providerStore.update(provider.id, { ...current, notes });
    return note;
  }

  function allProviders() {
    try {
      const list = providerStore.getAll();
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function allCorridors() {
    try {
      if (typeof providerStore.listCorridors === 'function') {
        const list = providerStore.listCorridors();
        return Array.isArray(list) ? list : [];
      }
    } catch {
      // no corridor source — the analyst pass simply has nothing to do.
    }
    return [];
  }

  /** Defensive read of a corridor's current notes, whatever the store shape. */
  function readCorridorNotes(corridor) {
    try {
      if (typeof providerStore.getCorridor === 'function') {
        const c = providerStore.getCorridor(corridor.id);
        if (c) return c.notes || [];
      }
    } catch {
      // fall through
    }
    try {
      if (typeof providerStore.get === 'function') {
        const rec = providerStore.get(corridor.id);
        if (rec) return rec.notes || [];
      }
    } catch {
      // fall through
    }
    if (corridor.providerId) {
      const p = allProviders().find((x) => x.id === corridor.providerId);
      if (p) return p.notes || [];
    }
    return corridor.notes || [];
  }

  /**
   * Store a note for a corridor: use the corridor-aware updater when the
   * store exposes one, else the plain update() when it knows the corridor
   * id, else attach the note to the corridor's provider record when set.
   */
  function addCorridorNote(corridor, agentId, es, en) {
    const note = { t: Date.now(), agent: agentId, es, en };
    if (typeof providerStore.updateCorridor === 'function') {
      try {
        const current =
          typeof providerStore.getCorridor === 'function'
            ? providerStore.getCorridor(corridor.id)
            : corridor;
        providerStore.updateCorridor(corridor.id, {
          notes: [...((current && current.notes) || []), note],
        });
        return note;
      } catch {
        // fall through to the plain-update path
      }
    }
    try {
      const rec =
        typeof providerStore.get === 'function'
          ? providerStore.get(corridor.id)
          : null;
      if (rec) {
        providerStore.update(corridor.id, {
          notes: [...(rec.notes || []), note],
        });
        return note;
      }
    } catch {
      // fall through to the provider fallback
    }
    if (corridor.providerId) {
      const p = allProviders().find((x) => x.id === corridor.providerId);
      if (p) {
        addProviderNote(p, agentId, es, en);
        return note;
      }
    }
    return null;
  }

  function emit(agentId, kind, es, en, providerId) {
    const agent = byId[agentId];
    const event = { t: Date.now(), agent: agentId, kind, es, en };
    if (providerId !== undefined && providerId !== null) {
      event.providerId = providerId;
    }
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

  // -- defensive corridorEngine wrapper --------------------------------------
  function safeCorridorMath({ sendAmount, fee, fxRate }) {
    let r = null;
    try {
      r = corridorEngine.corridorMath({ sendAmount, fee, fxRate });
    } catch {
      // fall through to the local fallback
    }
    const num = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const fallback = {
      fee,
      netBeforeFx: sendAmount - fee,
      received: (sendAmount - fee) * fxRate,
      effectiveFeePct: sendAmount > 0 ? (fee / sendAmount) * 100 : 0,
    };
    if (!r || typeof r !== 'object') return fallback;
    // Real engine shape: { fee, netSend, receivedAmount, effectiveFeePct };
    // accept the local fallback names too.
    return {
      fee: num(r.fee, fallback.fee),
      netBeforeFx: num(r.netSend ?? r.netBeforeFx, fallback.netBeforeFx),
      received: num(r.receivedAmount ?? r.received, fallback.received),
      effectiveFeePct: num(r.effectiveFeePct, fallback.effectiveFeePct),
    };
  }

  // -- provider-verifier: candidate → verifying after data check --------------
  function verificationChecklist(provider) {
    const name = provider.name || '(sin nombre)';
    return {
      es:
        `Lista de verificación manual — ${name}:\n` +
        '1. Confirmar la identidad del proveedor por contacto directo (esto lo hace Juan, no la fuerza).\n' +
        '2. Solicitar documentos: registro mercantil, identificación fiscal, certificado de vigencia.\n' +
        '3. No hay verificación automática: aquí no se realiza ningún chequeo externo ni automático.\n' +
        '4. Solo Juan decide si este proveedor pasa a "live" — la fuerza solo deja la lista preparada.',
      en:
        `Manual verification checklist — ${name}:\n` +
        "1. Confirm the provider's identity by direct contact (this is Juan's job, not the workforce's).\n" +
        '2. Request documents: business registration, tax ID, certificate of good standing.\n' +
        '3. No automatic verification: no external or automatic check is performed here.\n' +
        '4. Only Juan decides whether this provider goes "live" — the workforce only prepares the checklist.',
    };
  }

  function runProviderVerifier() {
    for (const provider of allProviders()) {
      if (provider.status !== 'candidate') continue;
      if (hasAgentNote(provider, 'provider-verifier')) continue;
      const hasName =
        typeof provider.name === 'string' && provider.name.trim().length > 0;
      const hasChannel =
        Array.isArray(provider.channels) && provider.channels.length > 0;
      if (hasName && hasChannel) {
        providerStore.update(provider.id, { status: 'verifying' });
        const checklist = verificationChecklist(provider);
        addProviderNote(
          provider,
          'provider-verifier',
          checklist.es,
          checklist.en,
        );
        emit(
          'provider-verifier',
          'verifying',
          `Proveedor a verificación: ${provider.name}`,
          `Provider to verification: ${provider.name}`,
          provider.id,
        );
      } else {
        const missing = [];
        if (!hasName) missing.push({ es: 'nombre', en: 'name' });
        if (!hasChannel)
          missing.push({ es: 'al menos un canal', en: 'at least one channel' });
        const missingEs = missing.map((m) => m.es).join(', ');
        const missingEn = missing.map((m) => m.en).join(', ');
        addProviderNote(
          provider,
          'provider-verifier',
          `Faltan datos para verificar al proveedor: ${missingEs}. Nada se inventa — agrega estos valores antes de continuar.`,
          `Missing data to verify the provider: ${missingEn}. Nothing is invented — add these values before continuing.`,
        );
        emit(
          'provider-verifier',
          'flagged',
          `Proveedor sin datos suficientes: ${provider.id}`,
          `Provider missing data: ${provider.id}`,
          provider.id,
        );
      }
    }
  }

  // -- fee-watcher: flag live providers with undisclosed fees -----------------
  function runFeeWatcher() {
    for (const provider of allProviders()) {
      if (provider.status !== 'live') continue;
      if (hasAgentNote(provider, 'fee-watcher')) continue;
      const type = provider.feeModel && provider.feeModel.type;
      if (type === 'undisclosed') {
        const name = provider.name || provider.id;
        addProviderNote(
          provider,
          'fee-watcher',
          `Modelo de tarifa sin declarar para «${name}»: las tarifas nunca se inventan. Juan debe agregar el modelo de tarifa (tipo, porcentaje, fijo, mínimo, máximo) manualmente para que el analizador pueda calcular.`,
          `Undisclosed fee model for "${name}": fees are never invented. Juan must add the fee model (type, percent, flat, min, max) manually so the analyst can compute.`,
        );
        emit(
          'fee-watcher',
          'flagged',
          `Tarifa sin declarar: ${name}`,
          `Undisclosed fee model: ${name}`,
          provider.id,
        );
      }
    }
  }

  // -- corridor-analyst: write bilingual receive memos for corridors ----------
  function corridorLabel(corridor) {
    return corridor.label || corridor.id || '(sin corredor)';
  }

  function providerFor(corridor) {
    if (!corridor.providerId) return null;
    return allProviders().find((p) => p.id === corridor.providerId) || null;
  }

  function feeFor(corridor) {
    try {
      const direct = Number(corridor.fee);
      if (Number.isFinite(direct) && direct >= 0) return direct;
      const provider = providerFor(corridor);
      const model = provider && provider.feeModel;
      const send = Number(corridor.sendAmount);
      if (model && send > 0) {
        const pct = Number(model.pct);
        const flat = Number(model.flat);
        const applyMinMax = (raw) => {
          let fee = raw;
          if (Number.isFinite(Number(model.min)) && fee < Number(model.min)) {
            fee = Number(model.min);
          }
          if (Number.isFinite(Number(model.max)) && fee > Number(model.max)) {
            fee = Number(model.max);
          }
          return Math.round(fee * 100) / 100;
        };
        if (model.type === 'percentage' && pct > 0) {
          return applyMinMax((send * pct) / 100);
        }
        if (model.type === 'flat' && flat > 0) {
          return Math.round(flat * 100) / 100;
        }
        if (
          model.type === 'mixed' &&
          Number.isFinite(pct) &&
          pct >= 0 &&
          Number.isFinite(flat) &&
          flat >= 0
        ) {
          return applyMinMax(flat + (send * pct) / 100);
        }
      }
    } catch {
      // defensive: unknown fee → 0, and the memo says the fee is unknown
    }
    return 0;
  }

  function runCorridorAnalyst() {
    for (const corridor of allCorridors()) {
      const sendAmount = Number(corridor.sendAmount);
      if (!(sendAmount > 0)) continue;
      if (
        hasAgentNote({ notes: readCorridorNotes(corridor) }, 'corridor-analyst')
      ) {
        continue;
      }
      const label = corridorLabel(corridor);
      const fxRate = Number(corridor.fxRate);
      if (!(fxRate > 0)) {
        addCorridorNote(
          corridor,
          'corridor-analyst',
          `Corredor ${label}: monto $${fmtMoney(sendAmount)} sin tasa de cambio (fxRate). Nada se inventa — agrega la tasa manualmente antes de calcular el recibido.`,
          `Corridor ${label}: $${fmtMoney(sendAmount)} send with no FX rate. Nothing is invented — add the rate manually before computing the received amount.`,
        );
        emit(
          'corridor-analyst',
          'flagged',
          `Sin tasa para el corredor: ${label}`,
          `Missing FX rate for corridor: ${label}`,
          corridor.id,
        );
        continue;
      }
      const fee = feeFor(corridor);
      const r = safeCorridorMath({ sendAmount, fee, fxRate });
      const feeLine =
        fee === 0
          ? 'Comisión: desconocida (no inventada)'
          : `Comisión: $${fmtMoney(r.fee)}`;
      const feeLineEn =
        fee === 0 ? 'Fee: unknown (not invented)' : `Fee: $${fmtMoney(r.fee)}`;
      const es =
        `Memorando de corredor — ${label}:\n` +
        `Monto: $${fmtMoney(sendAmount)}. ${feeLine}. Neto antes de FX: $${fmtMoney(r.netBeforeFx)}.\n` +
        `Recibido (tasa ${fxRate}): $${fmtMoney(r.received)}. Comisión efectiva: ${r.effectiveFeePct.toFixed(2)}%.\n` +
        'Memorando interno: las tarifas y tasas deben ser verificadas manualmente por Juan — nada se envía ni se promete a nadie.';
      const en =
        `Corridor memo — ${label}:\n` +
        `Send: $${fmtMoney(sendAmount)}. ${feeLineEn}. Net before FX: $${fmtMoney(r.netBeforeFx)}.\n` +
        `Received (rate ${fxRate}): $${fmtMoney(r.received)}. Effective fee: ${r.effectiveFeePct.toFixed(2)}%.\n` +
        'Internal memo: fees and rates must be verified manually by Juan — nothing is sent or promised to anyone.';
      addCorridorNote(corridor, 'corridor-analyst', es, en);
      emit(
        'corridor-analyst',
        'memo',
        `Memorando de corredor: ${label}`,
        `Corridor memo: ${label}`,
        corridor.id,
      );
    }
  }

  // -- intake-helper: internal draft outreach for live providers --------------
  function intakeDraft(provider) {
    const name = provider.name || '(sin nombre)';
    return {
      es:
        'Borrador interno — NO enviado:\n' +
        `Hola ${name}. Somos SAHJONY. Estamos en beta (v0.9) de MY CUBA CASH y todavía no tenemos clientes ni transacciones — cero hasta ahora, y así lo decimos abiertamente. ` +
        'Publicamos solo proveedores verificables, sin inventar nada. ' +
        'Este mensaje NO se envió automáticamente: es un borrador para que Juan lo revise y decida si vale la pena contactar.',
      en:
        'Internal draft — NOT sent:\n' +
        `Hello ${name}. We are SAHJONY. We are in beta (v0.9) of MY CUBA CASH with zero customers and zero transactions so far — and we say so openly. ` +
        'We list only verifiable providers and invent nothing. ' +
        'This message was NOT sent automatically: it is a draft for Juan to review and decide whether contact is worthwhile.',
    };
  }

  function runIntakeHelper() {
    for (const provider of allProviders()) {
      if (provider.status !== 'live') continue;
      if (hasAgentNote(provider, 'intake-helper')) continue;
      const name = provider.name || provider.id;
      const draft = intakeDraft(provider);
      addProviderNote(provider, 'intake-helper', draft.es, draft.en);
      emit(
        'intake-helper',
        'draft',
        `Borrador interno para ${name} — NO enviado`,
        `Internal draft for ${name} — NOT sent`,
        provider.id,
      );
    }
  }

  const passes = [
    runProviderVerifier,
    runFeeWatcher,
    runCorridorAnalyst,
    runIntakeHelper,
  ];

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
    return allProviders().filter((p) => QUEUE_STATUSES.includes(p.status))
      .length;
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
    setProviders(list) {
      providers = Array.isArray(list) ? list : [];
    },
    getProviders() {
      return [...providers];
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
