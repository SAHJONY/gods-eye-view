/**
 * SAHJONY · GOD'S EYE VIEW — Cuba Desk (MIPYME) Workforce
 * -----------------------------------------------------------------------
 * Client-side only. $0. No API keys. No external network calls.
 * The workforce runs ONLY while the app is open — nothing runs in the
 * background (see WORKFORCE_NOTE).
 *
 * WORKFORCE CORE CONTRACT (mirrors the pending src/agents/workforceCore.js
 * spec — swap these local implementations for the shared import when
 * module 6 lands; the signatures below match the architecture doc exactly):
 *   - AGENT_TIERS: { READ, DRAFT, PROPOSE } — there is NO execute tier.
 *     Nothing external without Juan.
 *   - registerWorkforce(moduleId, agents)
 *   - logAction(moduleId, agentId, action)
 *   - escalate(moduleId, reason, payload)
 *   - classifyTrack(text) → 'trade'|'cuba'|'cars'|'crude'|'energy'|
 *     'mycubacash'|'unknown' — exactly one track per conversation.
 *   - SANCTIONS_HARD_STOP — any sanctions/customs/embargo question
 *     escalates ALWAYS. The agent never answers, advises, or routes around.
 *   - LANG_POLICY — cuba is 'es-first'.
 *
 * HARD RULES (approval gates — never bypassed):
 *   - Agents NEVER send, email, post, purchase, sign, call, or text.
 *   - Agents NEVER contact or screen any real counterparty.
 *   - There is NO automatic sanctions-screening data source: screening is
 *     manual only and stays as notes.
 *   - Agents NEVER delete sourcing requests or buyers.
 *   - All outputs are drafts, notes, and memos stored inside the record.
 *   - The UI decides what Juan sees; the engine only proposes.
 *   - Cuba-desk business NEVER files into the worldwide global desk
 *     pipeline and vice versa (separate store keys, separate tracks).
 *
 * Injected collaborators:
 *   - requestStore: { getAll(), get(id), update(id, patch), notes(id) }
 *     notes(id) → [{ t, agent, es, en }]. Notes are written back through
 *     update() as agentNotes [{ at, agent, es, en }].
 *     Request shape: { id, ref, buyerId, product, quantity, targetPrice,
 *                      currency, incoterms, destinationPort, timeline,
 *                      status, agentNotes, createdAt, updatedAt }
 *     Request statuses: intake → triage → quoted → negotiating →
 *     (won / lost, set only by Juan — never by the workforce)
 *   - cubaEngine: { scoreSourcingRequest(req), requestValue(req),
 *                   requestVerdict(req) -> { tier, es, en },
 *                   missingFields(req) -> [{ field, es, en }],
 *                   formatMoney(n), formatQty(n) }
 *     Engine calls are defensive: every call is wrapped in try/catch with
 *     'yellow'/0 fallbacks, so a throwing engine can never break the passes.
 *   - buyers are injected via setBuyers([...]) for matching/diligence.
 */

// ---------------------------------------------------------------------------
// Workforce core contract (local spec-compliant implementation)
// ---------------------------------------------------------------------------

/** Authority tiers — there is NO execute tier. Nothing external without Juan. */
export const AGENT_TIERS = Object.freeze({
  READ: 'read',
  DRAFT: 'draft',
  PROPOSE: 'propose',
});

export const LANG_POLICY = Object.freeze({
  cuba: 'es-first',
  cars: 'es-first',
  energy: 'es-first',
  trade: 'bilingual',
  crude: 'bilingual',
});

export const SANCTIONS_HARD_STOP = Object.freeze({
  gate: 'sanctions',
  action: 'escalate-always',
});

export const WORKFORCE_LOG_KEY = 'sahjony.workforce.cuba.log.v1';
export const ESCALATION_QUEUE_KEY = 'sahjony.workforce.cuba.escalations.v1';
export const LOG_CAP = 300;

/** Honest framing — the workforce is active only while the app is open. */
export const WORKFORCE_NOTE = {
  es: 'La fuerza de la Mesa Cuba trabaja mientras la app está abierta.',
  en: 'The Cuba Desk workforce runs while the app is open.',
};

const MODULE_REGISTRY = new Map();

/**
 * registerWorkforce(moduleId, agents) — agents: [{id, role, tier, lang}].
 * Registers a module's roster against the authority model. Returns the
 * registered roster.
 */
export function registerWorkforce(moduleId, agents = []) {
  if (!moduleId || typeof moduleId !== 'string') {
    throw new Error('registerWorkforce requires a moduleId string.');
  }
  const roster = (Array.isArray(agents) ? agents : []).map((a) => ({
    id: a.id,
    role: a.role || '',
    tier: Object.values(AGENT_TIERS).includes(a.tier)
      ? a.tier
      : AGENT_TIERS.READ,
    lang: a.lang || LANG_POLICY[moduleId] || 'bilingual',
  }));
  MODULE_REGISTRY.set(moduleId, roster);
  return roster;
}

function readStoredJson(key) {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredJson(key, events) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(events.slice(-LOG_CAP)));
  } catch {
    // Storage may be unavailable/private — the in-memory state still works.
  }
}

/**
 * logAction(moduleId, agentId, action) — appends
 * {ts, module, agent, action, tier, status} to the module's workforce log.
 * action: { kind, es, en, tier?, refId? } (strings, never sends anything).
 */
export function logAction(moduleId, agentId, action = {}) {
  const roster = MODULE_REGISTRY.get(moduleId) || [];
  const def = roster.find((a) => a.id === agentId);
  const entry = {
    ts: Date.now(),
    module: moduleId,
    agent: agentId,
    action: action.kind || 'note',
    tier: action.tier || def?.tier || AGENT_TIERS.READ,
    status: 'logged',
    es: action.es || '',
    en: action.en || '',
  };
  if (action.refId !== undefined && action.refId !== null) {
    entry.refId = action.refId;
  }
  const key =
    moduleId === 'cuba'
      ? WORKFORCE_LOG_KEY
      : `sahjony.workforce.${moduleId}.log.v1`;
  const log = [...readStoredJson(key), entry];
  writeStoredJson(key, log);
  return entry;
}

/**
 * escalate(moduleId, reason, payload) — stages
 * {ts, module, reason, payload, status:'awaiting-juan'} in the escalation
 * queue. Escalations are NEVER auto-resolved.
 */
export function escalate(moduleId, reason, payload = {}) {
  const entry = {
    ts: Date.now(),
    module: moduleId,
    reason,
    payload: payload && typeof payload === 'object' ? payload : {},
    status: 'awaiting-juan',
  };
  const key =
    moduleId === 'cuba'
      ? ESCALATION_QUEUE_KEY
      : `sahjony.workforce.${moduleId}.escalations.v1`;
  const queue = [...readStoredJson(key), entry];
  writeStoredJson(key, queue);
  return entry;
}

const TRACK_KEYWORDS = [
  { track: 'mycubacash', words: ['mycubacash', 'remesa', 'remittance', 'envío de dinero', 'cash app'] },
  { track: 'cars', words: ['auto', 'carro', 'coche', 'vehicle', 'vin', 'rosmel', 'gestor'] },
  { track: 'crude', words: ['crude', 'petróleo', 'petroleo', 'oil', 'barril', 'barrel', 'tanker', 'wti', 'brent'] },
  { track: 'energy', words: ['diesel', 'diésel', 'gasolina', 'gasoline', 'glp', 'lpg', 'combustible', 'fuel'] },
  {
    track: 'cuba',
    words: ['cuba', 'mipyme', 'habana', 'havana', 'mariel', 'santiago de cuba', 'cienfuegos', 'tcp', 'cooperativa no agropecuaria'],
  },
  {
    track: 'trade',
    words: ['rfq', 'import', 'export', 'importación', 'exportación', 'proveedor', 'supplier', 'sourcing', 'fob', 'cif'],
  },
];

/**
 * classifyTrack(text) — exactly one track per conversation, never blended.
 * The Cuba desk claims Cuba-market content; everything else falls through
 * to the other desks or 'unknown'.
 */
export function classifyTrack(text) {
  const hay = String(text ?? '').toLowerCase();
  if (!hay.trim()) return 'unknown';
  for (const { track, words } of TRACK_KEYWORDS) {
    if (words.some((w) => hay.includes(w))) return track;
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Cuba desk agent roster (v1 — trimmed to deal-flow, drafts-only by design)
// ---------------------------------------------------------------------------

const ROLE_DEFS = [
  {
    id: 'sourcing-scout',
    name: { es: 'Explorador de abastecimiento', en: 'Sourcing Scout' },
    role: 'triage',
    tier: AGENT_TIERS.READ,
    desc: {
      es: 'Triagea nuevas solicitudes y valida los datos de entrada.',
      en: 'Triages new sourcing requests and validates intake data.',
    },
  },
  {
    id: 'counterparty-diligence',
    name: { es: 'Diligencia de contraparte', en: 'Counterparty Diligence' },
    role: 'diligence',
    tier: AGENT_TIERS.PROPOSE,
    desc: {
      es: 'Listas de diligencia de compradores (notas; propone, no aplica).',
      en: 'Buyer diligence checklists (notes only; proposes, never applies).',
    },
  },
  {
    id: 'compliance',
    name: { es: 'Cumplimiento', en: 'Compliance' },
    role: 'compliance',
    tier: AGENT_TIERS.READ,
    desc: {
      es: 'Escalación dura ante sanciones/aduanas/embargo — nunca asesora.',
      en: 'Hard-stop escalation on sanctions/customs/embargo — never advises.',
    },
  },
  {
    id: 'outreach-drafting',
    name: { es: 'Redactor de alcance', en: 'Outreach Drafter' },
    role: 'outreach',
    tier: AGENT_TIERS.DRAFT,
    desc: {
      es: 'Borradores de WhatsApp en español (nunca enviados).',
      en: 'Spanish-first WhatsApp drafts (never sent).',
    },
  },
  {
    id: 'follow-up',
    name: { es: 'Seguimiento', en: 'Follow-up' },
    role: 'followup',
    tier: AGENT_TIERS.DRAFT,
    desc: {
      es: 'Borradores de seguimiento para solicitudes estancadas.',
      en: 'Draft follow-ups for stalled requests.',
    },
  },
  {
    id: 'oversight',
    name: { es: 'Supervisión', en: 'Oversight' },
    role: 'oversight',
    tier: AGENT_TIERS.READ,
    desc: {
      es: 'Revisa borradores: datos inventados o compromisos → escala.',
      en: 'Reviews drafts: invented facts or commitments → escalates.',
    },
  },
];

export const AGENT_DEFS = ROLE_DEFS.map(({ id, name, role, tier, desc }) => ({
  id,
  name,
  role,
  tier,
  desc,
}));

// Register the cuba roster against the authority model on module load.
registerWorkforce(
  'cuba',
  AGENT_DEFS.map((a) => ({
    id: a.id,
    role: a.role,
    tier: a.tier,
    lang: LANG_POLICY.cuba,
  })),
);

const QUEUE_STATUSES = ['intake', 'triage', 'quoted', 'negotiating'];
const VERDICT_TIERS = new Set(['green', 'yellow', 'red']);

/** Sanctions/customs/embargo signal — conservative: any mention escalates. */
const SANCTIONS_PATTERN =
  /sanci[oó]n|sanction|ofac|embargo|bloqueo|sdn\b|lista negra|blacklist|prohibid[oa] por (ee\.?uu\.?|estados unidos)/i;

function detectSanctionsSignal(...texts) {
  return texts.some(
    (text) => typeof text === 'string' && SANCTIONS_PATTERN.test(text),
  );
}

/** Commitment language a draft must never carry. */
const COMMITMENT_PATTERN =
  /garantiz|promet|aseguro|me comprometo|firmaremos|i guarantee|i promise|we guarantee|will be delivered/i;

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

function fmtMoney(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US')}`;
}

function hasValidTriage(req) {
  return (
    req &&
    typeof req.ref === 'string' &&
    req.ref.trim().length > 0 &&
    typeof req.product === 'string' &&
    req.product.trim().length > 0 &&
    typeof req.quantity === 'number' &&
    req.quantity > 0
  );
}

function missingTriageFields(req) {
  const missing = [];
  if (!(typeof req.ref === 'string' && req.ref.trim().length > 0)) {
    missing.push({ es: 'referencia', en: 'reference' });
  }
  if (!(typeof req.product === 'string' && req.product.trim().length > 0)) {
    missing.push({ es: 'producto', en: 'product' });
  }
  if (!(typeof req.quantity === 'number' && req.quantity > 0)) {
    missing.push({ es: 'cantidad (> 0)', en: 'quantity (> 0)' });
  }
  return missing;
}

/** Read the workforce-store notes view, normalized to [{t, agent, es, en}]. */
function readNotes(requestStore, req) {
  try {
    if (requestStore && typeof requestStore.notes === 'function') {
      const list = requestStore.notes(req.id);
      if (Array.isArray(list)) {
        return list.map((n) => ({
          t: n.t ?? n.at ?? Date.now(),
          agent: n.agent || '',
          es: n.es || '',
          en: n.en || '',
        }));
      }
    }
  } catch {
    /* fall through to record fields */
  }
  const rec =
    (requestStore && typeof requestStore.get === 'function'
      ? requestStore.get(req.id)
      : null) || req;
  const raw = rec.agentNotes || rec.notes || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => ({
    t: n.t ?? n.at ?? Date.now(),
    agent: n.agent || '',
    es: n.es || '',
    en: n.en || '',
  }));
}

function noteTexts(req) {
  return [
    req.ref,
    req.product,
    req.notes,
    ...(Array.isArray(req.agentNotes)
      ? req.agentNotes.map((n) => `${n.es || ''} ${n.en || ''}`)
      : []),
  ];
}

/**
 * createWorkforce({ requestStore, cubaEngine, signal, tickMs, staggerMs })
 * Returns the orchestrator handle. Drafts-only by design: there is NO send
 * function anywhere in this module.
 */
export function createWorkforce(opts = {}) {
  const {
    requestStore,
    cubaEngine,
    signal,
    tickMs = 20000,
    staggerMs = 5000,
  } = opts;
  if (
    !requestStore ||
    typeof requestStore.getAll !== 'function' ||
    typeof requestStore.update !== 'function'
  ) {
    throw new Error(
      'createWorkforce requires a requestStore with getAll()/update().',
    );
  }
  if (!cubaEngine) {
    throw new Error('createWorkforce requires a cubaEngine.');
  }

  let running = false;
  let destroyed = false;
  let buyers = [];
  const listeners = new Set();
  let log = readStoredJson(WORKFORCE_LOG_KEY);
  let escalations = readStoredJson(ESCALATION_QUEUE_KEY);
  let proposals = [];
  // Per-instance escalation memory: the same record must never be
  // escalated twice, and state never leaks between workforce instances.
  const escalatedReasons = new Set();

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

  function addNote(req, agentId, es, en) {
    const note = { t: Date.now(), agent: agentId, es, en };
    const existing = requestStore.get ? requestStore.get(req.id) : null;
    const current = existing || req;
    const notes = [...readNotes(requestStore, req), note];
    const agentNotes = notes.map((n) => ({
      at: n.t,
      agent: n.agent,
      es: n.es,
      en: n.en,
    }));
    requestStore.update(req.id, {
      ...current,
      agentNotes,
      updatedAt: Date.now(),
    });
    return note;
  }

  function setStatus(req, status) {
    requestStore.update(req.id, { status, updatedAt: Date.now() });
  }

  function emit(agentId, kind, es, en, refId) {
    const agent = byId[agentId];
    const tier = agent ? agent.tier : AGENT_TIERS.READ;
    const event = { t: Date.now(), agent: agentId, kind, es, en, tier };
    if (refId !== undefined && refId !== null) event.refId = refId;
    if (agent) agent.lastAction = event;
    log.push(event);
    if (log.length > LOG_CAP) log = log.slice(-LOG_CAP);
    writeStoredJson(WORKFORCE_LOG_KEY, log);
    logAction('cuba', agentId, { kind, es, en, tier, refId });
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        // A listener must never break the workforce.
      }
    }
  }

  function recordEscalation(reason, payload) {
    const entry = escalate('cuba', reason, payload);
    escalations.push(entry);
    if (escalations.length > LOG_CAP) escalations = escalations.slice(-LOG_CAP);
    return entry;
  }

  function allRequests() {
    try {
      const reqs = requestStore.getAll();
      return Array.isArray(reqs) ? reqs : [];
    } catch {
      return [];
    }
  }

  function findBuyer(req) {
    if (!req || !req.buyerId) return null;
    return buyers.find((b) => b && b.id === req.buyerId) || null;
  }

  // -- defensive cubaEngine wrappers -----------------------------------------
  function safeVerdict(req) {
    try {
      const v = cubaEngine.requestVerdict(req);
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

  function safeNum(fn, req) {
    try {
      const n = Number(fn(req));
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  function safeScore(req) {
    return safeNum((r) => cubaEngine.scoreSourcingRequest(r), req);
  }

  function safeValue(req) {
    return safeNum((r) => cubaEngine.requestValue(r), req);
  }

  function safeMissingFields(req) {
    try {
      const m = cubaEngine.missingFields(req);
      return Array.isArray(m) ? m : [];
    } catch {
      return [];
    }
  }

  function safeFormatMoney(n) {
    try {
      if (typeof cubaEngine.formatMoney === 'function') {
        const s = cubaEngine.formatMoney(n);
        if (typeof s === 'string' && s) return s;
      }
    } catch {
      /* fall through */
    }
    return fmtMoney(n);
  }

  function safeFormatQty(n) {
    try {
      if (typeof cubaEngine.formatQty === 'function') {
        const s = cubaEngine.formatQty(n);
        if (typeof s === 'string' && s) return s;
      }
    } catch {
      /* fall through */
    }
    return fmtInt(n);
  }

  // -- sourcing-scout: intake → triage after triage-data validation -----------
  function runScout() {
    for (const req of allRequests()) {
      if (req.status !== 'intake') continue;
      if (hasValidTriage(req)) {
        setStatus(req, 'triage');
        addNote(
          req,
          'sourcing-scout',
          `Datos de triaje validados (${req.ref}: ${safeFormatQty(req.quantity)} × ${req.product}). Pasando a triaje. SAHJONY actúa solo como intermediario.`,
          `Triage data validated (${req.ref}: ${safeFormatQty(req.quantity)} × ${req.product}). Moving to triage. SAHJONY acts as broker only.`,
        );
        emit(
          'sourcing-scout',
          'triaged',
          `Solicitud validada: ${req.ref}`,
          `Request validated: ${req.ref}`,
          req.id,
        );
      } else {
        const missing = missingTriageFields(req);
        const missingEs = missing.map((m) => m.es).join(', ');
        const missingEn = missing.map((m) => m.en).join(', ');
        addNote(
          req,
          'sourcing-scout',
          `Faltan datos para el triaje: ${missingEs}. Nada se inventa — agrega estos valores antes de continuar.`,
          `Missing triage data: ${missingEn}. Nothing is invented — add these values before continuing.`,
        );
        emit(
          'sourcing-scout',
          'flagged',
          `Solicitud sin datos suficientes: ${req.id}`,
          `Request missing data: ${req.id}`,
          req.id,
        );
      }
    }
  }

  // -- counterparty-diligence: triage — checklist, never advances itself ------
  function diligenceChecklist(req) {
    const ref = req.ref || '(sin referencia)';
    const buyer = findBuyer(req);
    const buyerName = buyer?.name || '(sin comprador vinculado)';
    return {
      es:
        `Lista de diligencia de contraparte — ${ref} / ${buyerName}:\n` +
        '1. Verificar la identidad del comprador por contacto directo (esto lo hace Juan, no la fuerza).\n' +
        '2. Solicitar documentos del actor económico: objeto social, identificación fiscal.\n' +
        '3. No existe ninguna fuente automática de verificación de sanciones: la verificación es manual.\n' +
        '4. Todo queda como nota en el registro de la solicitud — nadie es contactado ni evaluado automáticamente.\n' +
        '5. SAHJONY actúa solo como intermediario por honorario/comisión.',
      en:
        `Counterparty diligence checklist — ${ref} / ${buyerName}:\n` +
        "1. Verify the buyer's identity by direct contact (this is Juan's job, not the workforce's).\n" +
        '2. Request the economic actor documents: corporate purpose, tax ID.\n' +
        '3. There is no automatic sanctions-screening data source: verification is manual.\n' +
        '4. Everything stays as a note in the request record — nobody is contacted or screened automatically.\n' +
        '5. SAHJONY acts as a fee/commission broker only.',
    };
  }

  function runDiligence() {
    for (const req of allRequests()) {
      if (req.status !== 'triage') continue;
      const checklist = diligenceChecklist(req);
      addNote(req, 'counterparty-diligence', checklist.es, checklist.en);

      const buyer = findBuyer(req);
      if (buyer && buyer.verification === 'flagged') {
        const name = buyer.name || '(sin nombre)';
        addNote(
          req,
          'counterparty-diligence',
          `BANDERA: el comprador «${name}» está marcado como "flagged". No avanzar — requiere revisión de Juan.`,
          `FLAG: buyer "${name}" is marked "flagged". Do not advance — requires Juan's review.`,
        );
        recordEscalation('flagged-buyer', {
          requestId: req.id,
          ref: req.ref,
          buyerId: buyer.id,
          buyerName: name,
        });
        emit(
          'counterparty-diligence',
          'escalated',
          `Comprador marcado escalado a Juan: ${name} (${req.ref})`,
          `Flagged buyer escalated to Juan: ${name} (${req.ref})`,
          req.id,
        );
        continue;
      }
      // PROPOSE tier: stage the move to quoted in Juan's approval queue.
      // The workforce never applies the move itself.
      const verdict = safeVerdict(req);
      if (verdict.tier === 'green' && !proposals.some((p) => p.requestId === req.id && p.status === 'pending')) {
        const proposal = {
          id: `prop-${Date.now().toString(36)}-${proposals.length}`,
          requestId: req.id,
          ref: req.ref,
          proposedStatus: 'quoted',
          score: safeScore(req),
          status: 'pending',
          createdAt: Date.now(),
        };
        proposals.push(proposal);
        emit(
          'counterparty-diligence',
          'proposed',
          `Propuesta para Juan: mover ${req.ref} a cotizada (veredicto verde). Nada aplicado sin su aprobación.`,
          `Proposal for Juan: move ${req.ref} to quoted (green verdict). Nothing applied without his approval.`,
          req.id,
        );
      } else {
        emit(
          'counterparty-diligence',
          'diligence',
          `Diligencia registrada: ${req.ref} (se queda en triaje — Juan decide)`,
          `Diligence logged: ${req.ref} (stays in triage — Juan decides)`,
          req.id,
        );
      }
    }
  }

  // -- compliance: sanctions/customs/embargo → escalate ALWAYS ---------------
  function runCompliance() {
    for (const req of allRequests()) {
      const key = `sanctions:${req.id}`;
      if (escalatedReasons.has(key)) continue;
      if (detectSanctionsSignal(...noteTexts(req))) {
        escalatedReasons.add(key);
        recordEscalation('sanctions', {
          requestId: req.id,
          ref: req.ref,
          matched: 'sanctions/customs/embargo keyword in request text',
        });
        addNote(
          req,
          'compliance',
          'ESCALACIÓN DE CUMPLIMIENTO: el texto de la solicitud menciona sanciones/aduanas/embargo. La fuerza NO asesora ni busca alternativas — Juan revisa esto directamente.',
          'COMPLIANCE ESCALATION: the request text mentions sanctions/customs/embargo. The workforce does NOT advise or seek workarounds — Juan reviews this directly.',
        );
        emit(
          'compliance',
          'escalated',
          `Señal de sanciones escalada a Juan: ${req.ref}`,
          `Sanctions signal escalated to Juan: ${req.ref}`,
          req.id,
        );
      }
    }
    for (const buyer of buyers) {
      const key = `sanctions:buyer:${buyer?.id}`;
      if (!buyer || escalatedReasons.has(key)) continue;
      if (
        detectSanctionsSignal(
          buyer.name,
          buyer.activity,
          buyer.notes,
          ...(Array.isArray(buyer.agentNotes)
            ? buyer.agentNotes.map((n) => `${n.es || ''} ${n.en || ''}`)
            : []),
        )
      ) {
        escalatedReasons.add(key);
        recordEscalation('sanctions', {
          buyerId: buyer.id,
          buyerName: buyer.name,
          matched: 'sanctions/customs/embargo keyword in buyer text',
        });
        emit(
          'compliance',
          'escalated',
          `Señal de sanciones escalada a Juan (comprador): ${buyer.name}`,
          `Sanctions signal escalated to Juan (buyer): ${buyer.name}`,
        );
      }
    }
  }

  // -- outreach-drafting: WhatsApp-ready Spanish drafts, NEVER sent ----------
  function hasDraftFrom(req, agentId) {
    return readNotes(requestStore, req).some(
      (n) => n.agent === agentId && /BORRADOR|DRAFT/i.test(n.es),
    );
  }

  function runOutreach() {
    for (const req of allRequests()) {
      if (req.status !== 'quoted') continue;
      if (hasDraftFrom(req, 'outreach-drafting')) continue;
      if (escalatedReasons.has(`sanctions:${req.id}`)) continue;
      const verdict = safeVerdict(req);
      if (verdict.tier !== 'green') continue;
      const buyer = findBuyer(req);
      const buyerName = buyer?.name || '(comprador)';
      const es =
        `BORRADOR DE WHATSAPP — NADA ENVIADO\n` +
        `(borrador interno para revisión de Juan — nada enviado / draft — nothing sent)\n\n` +
        `Hola ${buyerName}, soy Juan Gonzalez de SAHJONY. Como intermediario, le comparto la solicitud ${req.ref || ''}: ` +
        `${safeFormatQty(req.quantity)} × ${req.product || 'producto'}` +
        `${req.targetPrice ? ` a precio objetivo ${safeFormatMoney(req.targetPrice)}/u` : ''}` +
        `${req.destinationPort ? `, destino ${req.destinationPort}` : ''}` +
        `${req.timeline ? `, plazo ${req.timeline}` : ''}. ` +
        `¿Le interesa que le busque opciones de suministro?`;
      const en =
        `WHATSAPP DRAFT — NOTHING SENT\n` +
        `(internal draft for Juan's review — nothing sent)\n\n` +
        `Hello ${buyerName}, this is Juan Gonzalez from SAHJONY. As a broker, I'm sharing request ${req.ref || ''}: ` +
        `${safeFormatQty(req.quantity)} × ${req.product || 'product'}` +
        `${req.targetPrice ? ` at a target price of ${safeFormatMoney(req.targetPrice)}/unit` : ''}` +
        `${req.destinationPort ? `, destination ${req.destinationPort}` : ''}` +
        `${req.timeline ? `, timeline ${req.timeline}` : ''}. ` +
        `Would you like me to source supply options for you?`;
      addNote(req, 'outreach-drafting', es, en);
      emit(
        'outreach-drafting',
        'draft',
        `Borrador de WhatsApp listo (no enviado): ${req.ref}`,
        `WhatsApp draft ready (not sent): ${req.ref}`,
        req.id,
      );
    }
  }

  // -- follow-up: drafts for stalled negotiating requests --------------------
  const STALE_MS = 7 * 24 * 60 * 60 * 1000;

  function runFollowUp() {
    const now = Date.now();
    for (const req of allRequests()) {
      if (req.status !== 'negotiating') continue;
      if (hasDraftFrom(req, 'follow-up')) continue;
      if (escalatedReasons.has(`sanctions:${req.id}`)) continue;
      const updatedAt = req.updatedAt ? new Date(req.updatedAt).getTime() : 0;
      if (Number.isFinite(updatedAt) && now - updatedAt < STALE_MS) continue;
      const buyer = findBuyer(req);
      const buyerName = buyer?.name || '(comprador)';
      const es =
        `BORRADOR DE SEGUIMIENTO — NADA ENVIADO\n` +
        `(borrador interno para revisión de Juan — nada enviado / draft — nothing sent)\n\n` +
        `Hola ${buyerName}, le escribe Juan Gonzalez de SAHJONY para dar seguimiento a la solicitud ${req.ref || ''} ` +
        `(${req.product || 'producto'}). Como intermediario, sigo atento a cualquier novedad de su parte.`;
      const en =
        `FOLLOW-UP DRAFT — NOTHING SENT\n` +
        `(internal draft for Juan's review — nothing sent)\n\n` +
        `Hello ${buyerName}, Juan Gonzalez from SAHJONY following up on request ${req.ref || ''} ` +
        `(${req.product || 'product'}). As a broker, I remain at your disposal for any updates.`;
      addNote(req, 'follow-up', es, en);
      emit(
        'follow-up',
        'draft',
        `Borrador de seguimiento listo (no enviado): ${req.ref}`,
        `Follow-up draft ready (not sent): ${req.ref}`,
        req.id,
      );
    }
  }

  // -- oversight: reviews drafts for invented facts or commitments -----------
  function runOversight() {
    for (const req of allRequests()) {
      const key = `oversight:${req.id}`;
      if (escalatedReasons.has(key)) continue;
      const drafts = readNotes(requestStore, req).filter((n) =>
        /BORRADOR|DRAFT/i.test(`${n.es} ${n.en}`),
      );
      if (!drafts.length) continue;
      const bad = drafts.filter((d) => COMMITMENT_PATTERN.test(`${d.es} ${d.en}`));
      escalatedReasons.add(key);
      if (bad.length) {
        recordEscalation('draft-commitment', {
          requestId: req.id,
          ref: req.ref,
          agents: [...new Set(bad.map((d) => d.agent))],
        });
        emit(
          'oversight',
          'escalated',
          `Borrador con lenguaje de compromiso escalado a Juan: ${req.ref}`,
          `Draft with commitment language escalated to Juan: ${req.ref}`,
          req.id,
        );
      } else {
        emit(
          'oversight',
          'reviewed',
          `Borradores revisados sin hallazgos: ${req.ref}`,
          `Drafts reviewed with no findings: ${req.ref}`,
          req.id,
        );
      }
    }
  }

  const passes = [
    runScout,
    runDiligence,
    runCompliance,
    runOutreach,
    runFollowUp,
    runOversight,
  ];

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
        const iv = setInterval(() => {
          if (!running || destroyed) return;
          try {
            passes[agents.indexOf(agent)]();
          } catch {
            /* pass errors stay local */
          }
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
    return allRequests().filter((r) => QUEUE_STATUSES.includes(r.status))
      .length;
  }

  function getProposals() {
    return proposals.map((p) => ({ ...p }));
  }

  function resolveProposal(id, approved) {
    const p = proposals.find((x) => x.id === id && x.status === 'pending');
    if (!p) return null;
    p.status = approved ? 'approved' : 'rejected';
    p.resolvedAt = Date.now();
    if (approved) {
      setStatus({ id: p.requestId }, 'quoted');
    }
    writeStoredJson(WORKFORCE_LOG_KEY, log);
    return { ...p };
  }

  function getEscalations() {
    return escalations.map((e) => ({ ...e }));
  }

  function getSummary() {
    return {
      running,
      note: { ...WORKFORCE_NOTE },
      agents: agents.map((a) => ({
        id: a.id,
        role: a.role,
        tier: a.tier,
        status: a.status,
        lastAction: a.lastAction,
      })),
      queueDepth: queueDepth(),
      pendingProposals: proposals.filter((p) => p.status === 'pending').length,
      awaitingEscalations: escalations.filter(
        (e) => e.status === 'awaiting-juan',
      ).length,
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
    getEscalations,
    getProposals,
    resolveProposal,
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
 * getWorkforceSummary(workforce) → { running, note, agents, queueDepth, … }
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
