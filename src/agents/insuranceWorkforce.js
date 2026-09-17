/**
 * Insurance workforce for GOD'S EYE VIEW — $0, no API keys, no external calls.
 *
 * Mirrors the existing workforce conventions (src/agents/workforce.js):
 *   - agents produce MEMOS/NOTES ONLY — they NEVER send, email, post,
 *     purchase, file, sign, call, or text. Nothing here reaches the outside
 *     world; there is no outreach capability to misuse.
 *   - activity log in localStorage under a dedicated key, capped at 300.
 *   - honest WORKFORCE_NOTE: the workforce runs only while the app is open.
 *
 * Roles:
 *   - gap-analyst:     scans coverages for gaps (status === 'gap').
 *   - renewal-watcher: flags coverages expiring within 30 days.
 *   - claim-prep:      open claims missing documents → prep checklist memo.
 *
 * createInsuranceWorkforce({ insuranceStore, insuranceEngine, signal,
 *                            tickMs, staggerMs })
 */

export const INSURANCE_WORKFORCE_LOG_KEY = 'sahjony.workforce.insurance.log.v1';
export const INSURANCE_LOG_CAP = 300;

export const INSURANCE_WORKFORCE_NOTE = {
  es: 'La fuerza trabaja mientras la app está abierta.',
  en: 'The workforce runs while the app is open.',
};

/** Hard rules — agents can only write memos/notes. */
export const INSURANCE_AGENT_HARD_RULES = Object.freeze({
  es: 'Los agentes NUNCA envían, escriben correos, publican, compran, presentan, firman, llaman ni envían mensajes. Solo producen memos y notas.',
  en: 'Agents NEVER send, email, post, purchase, file, sign, call, or text. They only produce memos and notes.',
});

const INSURANCE_ROLE_DEFS = [
  {
    id: 'gap-analyst',
    name: { es: 'Analista de brechas', en: 'Gap analyst' },
    role: 'gap-analysis',
  },
  {
    id: 'renewal-watcher',
    name: { es: 'Vigilante de renovaciones', en: 'Renewal watcher' },
    role: 'renewals',
  },
  {
    id: 'claim-prep',
    name: { es: 'Asistente de reclamos', en: 'Claim-prep assistant' },
    role: 'claim-prep',
  },
];

export const RENEWAL_WATCH_DAYS = 30;

/**
 * Document checklists per claim type (duplicate of the standalone app's
 * checklist mapping, kept here so workforce memos are self-contained).
 * Keys: prop, cargo, liab, theft, bi, auto, health.
 */
export const CLAIM_DOC_CHECKLISTS = Object.freeze({
  prop: {
    es: [
      'Fotos del daño (antes y después de la limpieza)',
      'Estimados de reparación de contratistas',
      'Recibos de compra de los bienes dañados',
      'Página de declaraciones de la póliza',
      'Inventario de bienes afectados',
    ],
    en: [
      'Photos of damage (before and after cleanup)',
      'Contractor repair estimates',
      'Purchase receipts for damaged items',
      'Policy declarations page',
      'Inventory of affected items',
    ],
  },
  cargo: {
    es: [
      'Conocimiento de embarque (bill of lading)',
      'Lista de empaque y factura comercial',
      'Fotos de la mercancía dañada',
      'Número de reclamo con el transportista',
      'Registros de temperatura (si es perecedero)',
    ],
    en: [
      'Bill of lading',
      'Packing list and commercial invoice',
      'Photos of damaged goods',
      'Carrier claim number',
      'Temperature logs (if perishable)',
    ],
  },
  liab: {
    es: [
      'Reporte del incidente',
      'Declaraciones de testigos',
      'Fotos del lugar',
      'Datos de contacto del tercero',
      'Reporte policial (si existe)',
    ],
    en: [
      'Incident report',
      'Witness statements',
      'Scene photos',
      'Third-party contact info',
      'Police report (if any)',
    ],
  },
  theft: {
    es: [
      'Reporte policial',
      'Lista de bienes robados con números de serie',
      'Recibos de compra',
      'Fotos de los bienes',
      'Videos de cámaras de seguridad (si existen)',
    ],
    en: [
      'Police report',
      'List of stolen items with serial numbers',
      'Purchase receipts',
      'Photos of the items',
      'Security camera footage (if any)',
    ],
  },
  bi: {
    es: [
      'Estados financieros (pérdidas y ganancias)',
      'Declaraciones de impuestos',
      'Registros de nómina',
      'Prueba del cierre / interrupción',
      'Recibos de gastos extraordinarios',
    ],
    en: [
      'Financial statements (P&L)',
      'Tax returns',
      'Payroll records',
      'Proof of closure / interruption',
      'Extra expense receipts',
    ],
  },
  auto: {
    es: [
      'Reporte policial',
      'Fotos de los vehículos',
      'Licencia y registro del conductor',
      'Estimados de reparación',
      'Facturas médicas (si hay lesiones)',
    ],
    en: [
      'Police report',
      'Vehicle photos',
      'Driver license and registration',
      'Repair estimates',
      'Medical bills (if injuries)',
    ],
  },
  health: {
    es: [
      'Explicación de beneficios (EOB)',
      'Facturas médicas',
      'Cartas del proveedor',
      'Negaciones de autorización previa',
      'Carta de apelación y documentos de la póliza',
    ],
    en: [
      'Explanation of benefits (EOB)',
      'Medical bills',
      'Provider letters',
      'Prior authorization denials',
      'Appeal letter and policy documents',
    ],
  },
});

/** Checklist for a claim type; falls back to a generic list for unknown types. */
export function claimChecklist(type, lang = 'es') {
  const entry = CLAIM_DOC_CHECKLISTS[type];
  if (entry && entry[lang]) return [...entry[lang]];
  const L = lang === 'es' ? 'es' : 'en';
  const generic = {
    es: [
      'Descripción del incidente con fecha y lugar',
      'Fotos o evidencia disponible',
      'Documentos de la póliza',
      'Recibos o estimados de los daños',
    ],
    en: [
      'Incident description with date and place',
      'Photos or available evidence',
      'Policy documents',
      'Receipts or damage estimates',
    ],
  };
  return [...generic[L]];
}

function readStoredLog() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(INSURANCE_WORKFORCE_LOG_KEY);
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
      INSURANCE_WORKFORCE_LOG_KEY,
      JSON.stringify(events.slice(-INSURANCE_LOG_CAP)),
    );
  } catch {
    // Storage may be unavailable/private — the in-memory log still works.
  }
}

/** Open claim = stage < 5 (5 = Closed). */
function isOpenClaim(claim) {
  const st = Number(claim?.stage);
  return Number.isFinite(st) && st < 5;
}

function claimDocsMissing(claim) {
  const docs = claim?.docs && typeof claim.docs === 'object' ? claim.docs : {};
  const checklist = claimChecklist(claim?.type || 'other');
  return checklist.length > Object.keys(docs).length;
}

/**
 * createInsuranceWorkforce({ insuranceStore, insuranceEngine, signal, tickMs, staggerMs })
 */
export function createInsuranceWorkforce(opts = {}) {
  const {
    insuranceStore,
    insuranceEngine = null,
    signal,
    tickMs = 60000,
    staggerMs = 8000,
  } = opts;

  if (!insuranceStore || typeof insuranceStore.getState !== 'function') {
    throw new Error('createInsuranceWorkforce requires an insuranceStore.');
  }

  let running = false;
  let destroyed = false;
  const listeners = new Set();
  let log = readStoredLog();
  const lastFingerprint = {}; // agentId -> JSON fingerprint of last emitted findings

  const agents = INSURANCE_ROLE_DEFS.map((def) => ({
    id: def.id,
    name: { ...def.name },
    role: def.role,
    status: 'idle', // idle | working | paused
    lastAction: null,
    _timers: [],
  }));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  function emit(agentId, kind, es, en) {
    const agent = byId[agentId];
    const event = { t: Date.now(), agent: agentId, kind, es, en };
    agent.lastAction = event;
    log.push(event);
    if (log.length > INSURANCE_LOG_CAP) log = log.slice(-INSURANCE_LOG_CAP);
    writeStoredLog(log);
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        // A listener must never break the workforce.
      }
    }
    return event;
  }

  /** Emit only when the findings changed since this agent's last emit. */
  function emitOnce(agentId, fingerprint, kind, es, en) {
    if (lastFingerprint[agentId] === fingerprint) return null;
    lastFingerprint[agentId] = fingerprint;
    return emit(agentId, kind, es, en);
  }

  function readState() {
    try {
      return insuranceStore.getState() || null;
    } catch {
      return null;
    }
  }

  function gapsIn(state) {
    const out = [];
    const businesses = state?.businesses || {};
    for (const [biz, b] of Object.entries(businesses)) {
      for (const c of Array.isArray(b?.coverages) ? b.coverages : []) {
        if (c && c.status === 'gap') out.push({ biz, coverage: c });
      }
    }
    return out;
  }

  function renewalsIn(state) {
    const businesses = state?.businesses || {};
    if (insuranceEngine?.renewalsWithin) {
      return insuranceEngine.renewalsWithin(businesses, RENEWAL_WATCH_DAYS);
    }
    // Fallback when no engine is wired: same logic, no invented data.
    const out = [];
    for (const [biz, b] of Object.entries(businesses)) {
      for (const c of Array.isArray(b?.coverages) ? b.coverages : []) {
        if (!c || c.status === 'gap') continue;
        const t = Date.parse(c.exp);
        if (!Number.isFinite(t)) continue;
        const left = Math.ceil((t - Date.now()) / 86400000);
        if (left <= RENEWAL_WATCH_DAYS)
          out.push({ biz, coverage: c, daysLeft: left });
      }
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft);
  }

  function openClaimsIn(state) {
    const out = [];
    const businesses = state?.businesses || {};
    for (const [biz, b] of Object.entries(businesses)) {
      for (const c of Array.isArray(b?.claims) ? b.claims : []) {
        if (c && isOpenClaim(c)) out.push({ biz, claim: c });
      }
    }
    return out;
  }

  function bizLabel(biz) {
    return String(biz || '?');
  }

  // -- gap-analyst: memo every coverage gap found -------------------------
  function runGapAnalyst() {
    const gaps = gapsIn(readState());
    const fp = JSON.stringify(
      gaps.map((g) => `${g.biz}:${g.coverage?.id || g.coverage?.type}`),
    );
    if (gaps.length === 0) {
      emitOnce(
        'gap-analyst',
        fp,
        'gaps-clear',
        'Sin brechas de cobertura detectadas.',
        'No coverage gaps detected.',
      );
      return;
    }
    const byBiz = {};
    for (const g of gaps) {
      (byBiz[g.biz] = byBiz[g.biz] || []).push(g.coverage?.type || '?');
    }
    const es =
      `MEMO — Brechas de cobertura (${gaps.length}): ` +
      Object.entries(byBiz)
        .map(([b, t]) => `${bizLabel(b)}: ${t.join(', ')}`)
        .join(' | ');
    const en =
      `MEMO — Coverage gaps (${gaps.length}): ` +
      Object.entries(byBiz)
        .map(([b, t]) => `${bizLabel(b)}: ${t.join(', ')}`)
        .join(' | ');
    emitOnce('gap-analyst', fp, 'gaps-found', es, en);
  }

  // -- renewal-watcher: memo renewals due within 30 days -------------------
  function runRenewalWatcher() {
    const renewals = renewalsIn(readState());
    const fp = JSON.stringify(
      renewals.map((r) => `${r.biz}:${r.coverage?.id}:${r.daysLeft}`),
    );
    if (renewals.length === 0) {
      emitOnce(
        'renewal-watcher',
        fp,
        'renewals-clear',
        'Sin renovaciones en los próximos 30 días.',
        'No renewals due in the next 30 days.',
      );
      return;
    }
    const es =
      `MEMO — Renovaciones próximas (${renewals.length}): ` +
      renewals
        .map(
          (r) =>
            `${bizLabel(r.biz)}: ${r.coverage?.type || '?'} (${r.daysLeft}d)`,
        )
        .join(' | ');
    const en =
      `MEMO — Upcoming renewals (${renewals.length}): ` +
      renewals
        .map(
          (r) =>
            `${bizLabel(r.biz)}: ${r.coverage?.type || '?'} (${r.daysLeft}d)`,
        )
        .join(' | ');
    emitOnce('renewal-watcher', fp, 'renewals-due', es, en);
  }

  // -- claim-prep: checklist memo for open claims missing documents --------
  function runClaimPrep() {
    const open = openClaimsIn(readState());
    const needing = open.filter(({ claim }) => claimDocsMissing(claim));
    const fp = JSON.stringify(needing.map(({ claim }) => claim.id));
    if (needing.length === 0) {
      emitOnce(
        'claim-prep',
        fp,
        'claims-ready',
        'Reclamos abiertos con documentos completos o sin reclamos abiertos.',
        'Open claims have complete documents or no open claims.',
      );
      return;
    }
    const es =
      'MEMO — Reclamos con documentos faltantes: ' +
      needing
        .map(
          ({ biz, claim }) =>
            `${claim.id || '?'} (${bizLabel(biz)}, ${claim.type || '?'}): ${claimChecklist(claim.type).join('; ')}`,
        )
        .join(' | ');
    const en =
      'MEMO — Claims with missing documents: ' +
      needing
        .map(
          ({ biz, claim }) =>
            `${claim.id || '?'} (${bizLabel(biz)}, ${claim.type || '?'}): ${claimChecklist(claim.type, 'en').join('; ')}`,
        )
        .join(' | ');
    emitOnce('claim-prep', fp, 'claim-docs-needed', es, en);
  }

  function runAgentPass(agent) {
    try {
      if (agent.id === 'gap-analyst') runGapAnalyst();
      else if (agent.id === 'renewal-watcher') runRenewalWatcher();
      else if (agent.id === 'claim-prep') runClaimPrep();
    } catch {
      // A failing pass must never break the workforce.
    }
  }

  function clearTimers() {
    for (const agent of agents) {
      for (const t of agent._timers) {
        try {
          clearTimeout(t);
          clearInterval(t);
        } catch {
          /* ignore */
        }
      }
      agent._timers = [];
    }
  }

  /** Run every agent pass once, synchronously (tests + manual refresh). */
  function processOnce() {
    for (const agent of agents) runAgentPass(agent);
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

  function getSummary() {
    const state = readState();
    return {
      running,
      note: { ...INSURANCE_WORKFORCE_NOTE },
      rules: { ...INSURANCE_AGENT_HARD_RULES },
      agents: agents.map((a) => ({
        id: a.id,
        status: a.status,
        name: { ...a.name },
        lastAction: a.lastAction,
      })),
      findings: {
        gaps: gapsIn(state).length,
        renewals: renewalsIn(state).length,
        openClaims: openClaimsIn(state).length,
      },
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

/** Standalone summary form of workforce.getSummary(). */
export function getInsuranceWorkforceSummary(workforce) {
  try {
    return workforce.getSummary();
  } catch {
    return {
      running: false,
      note: { ...INSURANCE_WORKFORCE_NOTE },
      rules: { ...INSURANCE_AGENT_HARD_RULES },
      agents: [],
      findings: { gaps: 0, renewals: 0, openClaims: 0 },
    };
  }
}
