/**
 * SAHJONY · GOD'S EYE VIEW — Workforce Core (cross-cutting AI agent framework)
 * -----------------------------------------------------------------------
 * Client-side only. $0. No API keys. No external network calls.
 * The workforce runs ONLY while the app is open — nothing runs in the
 * background.
 *
 * This is the shared authority model every module workforce imports.
 * No module invents its own tiers, log keys, or escalation paths.
 *
 * HARD RULES (approval gates — never bypassed):
 *   - There is NO execute tier. Agents NEVER send, email, post, purchase,
 *     pay, sign, call, or text. Nothing external happens without Juan.
 *   - Agents NEVER contact or screen any real counterparty.
 *   - Sanctions/customs/embargo questions ALWAYS escalate
 *     (SANCTIONS_HARD_STOP) — the agent NEVER answers, advises, or routes
 *     around them.
 *   - All outputs are drafts, notes, and memos. Drafts are NEVER sent.
 *   - SAHJONY is a fee/spread BROKER — never the end buyer, zero capital
 *     at risk. Agent language always uses broker/intermediary positioning.
 *   - Real 2026 data only. Never invent suppliers, buyers, cargoes,
 *     prices, vessels, or transactions.
 *   - The UI decides what Juan sees; agents only propose.
 */

/**
 * Authority tiers.
 *
 * READ    — observe, summarize, flag. No writing beyond internal notes.
 * DRAFT   — write internal drafts (outreach copy, follow-ups, shortlists).
 *           Drafts are NEVER sent; they wait in Juan's review queue.
 * PROPOSE — stage an item in Juan's approval queue (e.g. a diligence
 *           finding, a deal memo). Juan decides; the agent only proposes.
 *
 * WHY THERE IS NO EXECUTE TIER:
 * Every external act — send, post, publish, submit, purchase, pay, sign,
 * call, text, merge to main, deploy — requires Juan's explicit approval.
 * An "execute" tier would let code spend his money, sign his name, or speak
 * for his business without his word. The ceiling of agent authority is
 * PROPOSE: put it in front of Juan, fully drafted, one tap from done.
 */
export const AGENT_TIERS = Object.freeze({
  READ: 'read',
  DRAFT: 'draft',
  PROPOSE: 'propose',
});

const TIER_VALUES = new Set(Object.values(AGENT_TIERS));

/** Cap for per-module workforce action logs (newest entries kept). */
export const LOG_CAP = 500;

/** Escalation queue key — items here wait on Juan, and are NEVER dropped. */
export const ESCALATION_QUEUE_KEY = 'sahjony.workforce.escalations.v1';

/** Build the per-module workforce log key (tenant isolation per module). */
function workforceLogKey(moduleId) {
  return `sahjony.workforce.${moduleId}.log.v1`;
}

/** In-memory registry: moduleId → { moduleId, agents, registeredAt }. */
const registry = new Map();

function hasStorage() {
  return typeof localStorage !== 'undefined';
}

function readJson(key, fallback) {
  try {
    if (!hasStorage()) return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    if (!hasStorage()) return false;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Storage may be unavailable/private — callers keep working in-memory.
    return false;
  }
}

function nowTs() {
  return Date.now();
}

function requireModuleId(moduleId) {
  if (typeof moduleId !== 'string' || moduleId.trim().length === 0) {
    throw new Error('workforceCore: moduleId must be a non-empty string.');
  }
  return moduleId.trim();
}

/**
 * registerWorkforce(moduleId, agents)
 * agents: [{ id, role, tier, lang }] — tier must be a known AGENT_TIERS
 * value, id must be a non-empty string.
 * Throws on: missing/empty moduleId, missing/empty agents array, missing
 * agent id, unknown tier. Re-registering a module replaces its roster.
 * Returns the registered record { moduleId, agents, registeredAt }.
 */
export function registerWorkforce(moduleId, agents) {
  const mod = requireModuleId(moduleId);
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error(
      `workforceCore: registerWorkforce('${mod}') requires a non-empty agents array.`,
    );
  }
  const normalized = agents.map((agent, i) => {
    if (!agent || typeof agent !== 'object') {
      throw new Error(
        `workforceCore: agent at index ${i} for '${mod}' must be an object.`,
      );
    }
    if (typeof agent.id !== 'string' || agent.id.trim().length === 0) {
      throw new Error(
        `workforceCore: agent at index ${i} for '${mod}' is missing id.`,
      );
    }
    if (!TIER_VALUES.has(agent.tier)) {
      throw new Error(
        `workforceCore: agent '${agent.id}' for '${mod}' has unknown tier ` +
          `'${agent.tier}' — must be one of: ${[...TIER_VALUES].join(', ')}.`,
      );
    }
    return {
      id: agent.id.trim(),
      role: typeof agent.role === 'string' ? agent.role : '',
      tier: agent.tier,
      lang: typeof agent.lang === 'string' ? agent.lang : '',
    };
  });
  const record = {
    moduleId: mod,
    agents: normalized,
    registeredAt: nowTs(),
  };
  registry.set(mod, record);
  return record;
}

/** Look up the registered tier for an agent (undefined when unknown). */
function agentTier(moduleId, agentId) {
  const record = registry.get(moduleId);
  if (!record) return undefined;
  const agent = record.agents.find((a) => a.id === agentId);
  return agent ? agent.tier : undefined;
}

/**
 * logAction(moduleId, agentId, action)
 * Appends { ts, module, agent, action, tier, status } to
 * `sahjony.workforce.<module>.log.v1`, keeping the newest LOG_CAP entries.
 * tier is resolved from the registry when the module/agent is registered.
 * status is always 'logged' — this log is an audit trail, not a workflow.
 */
export function logAction(moduleId, agentId, action) {
  const mod = requireModuleId(moduleId);
  if (typeof agentId !== 'string' || agentId.trim().length === 0) {
    throw new Error('workforceCore: logAction requires a non-empty agentId.');
  }
  const entry = {
    ts: nowTs(),
    module: mod,
    agent: agentId.trim(),
    action: action === undefined || action === null ? '' : String(action),
    tier: agentTier(mod, agentId.trim()) || 'unknown',
    status: 'logged',
  };
  const key = workforceLogKey(mod);
  const existing = readJson(key, []);
  const events = Array.isArray(existing) ? existing : [];
  events.push(entry);
  writeJson(key, events.slice(-LOG_CAP));
  return entry;
}

/**
 * escalate(moduleId, reason, payload)
 * Writes { ts, module, reason, payload, status: 'awaiting-juan' } to the
 * escalation queue `sahjony.workforce.escalations.v1`.
 * The queue is NEVER capped: items awaiting Juan must never be dropped
 * silently. Callers use reason 'sanctions' for SANCTIONS_HARD_STOP.
 * Returns the queued item.
 */
export function escalate(moduleId, reason, payload) {
  const mod = requireModuleId(moduleId);
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('workforceCore: escalate requires a non-empty reason.');
  }
  const item = {
    ts: nowTs(),
    module: mod,
    reason: reason.trim(),
    payload: payload === undefined ? null : payload,
    status: 'awaiting-juan',
  };
  const existing = readJson(ESCALATION_QUEUE_KEY, []);
  const queue = Array.isArray(existing) ? existing : [];
  queue.push(item);
  writeJson(ESCALATION_QUEUE_KEY, queue);
  return item;
}

// ---------------------------------------------------------------------------
// classifyTrack — Sofia single-front-door routing
// ---------------------------------------------------------------------------

/**
 * Normalize text for keyword matching: lowercase + strip diacritics.
 * ('diésel' → 'diesel', 'cotización' → 'cotizacion')
 */
function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Track keywords: [keyword, baseWeight, lang].
 * lang 'es' marks a Spanish keyword, 'en' an English one.
 * Word boundaries are applied to single-word keywords so short tokens
 * ('fob', 'oil', 'wti', 'car') don't match inside longer words.
 */
const TRACK_KEYWORDS = {
  mycubacash: [
    ['remesa', 4, 'es'],
    ['remesas', 4, 'es'],
    ['remittance', 4, 'en'],
    ['send money', 4, 'en'],
    ['envio de dinero', 4, 'es'],
    ['cuba cash', 4, 'en'],
    ['mycubacash', 4, 'en'],
    ['recarga', 3, 'es'],
    ['top up', 3, 'en'],
    ['cash app', 2, 'en'],
    ['envio', 1, 'es'],
  ],
  cars: [
    ['carro', 3, 'es'],
    ['coche', 3, 'es'],
    ['automovil', 3, 'es'],
    ['vehiculo', 3, 'es'],
    ['vehicle', 3, 'en'],
    ['gestoria', 3, 'es'],
    ['auto', 2, 'es'],
    ['car', 2, 'en'],
    ['sedan', 2, 'en'],
  ],
  crude: [
    ['crude', 3, 'en'],
    ['crudo', 3, 'es'],
    ['petroleo', 3, 'es'],
    ['barril', 3, 'es'],
    ['barrel', 3, 'en'],
    ['wti', 3, 'en'],
    ['brent', 3, 'en'],
    ['tanker', 3, 'en'],
    ['buque tanque', 3, 'es'],
    ['laycan', 3, 'en'],
    ['sts', 3, 'en'],
    ['refineria', 2, 'es'],
    ['refinery', 2, 'en'],
    ['cargo', 2, 'en'],
    ['oil', 2, 'en'],
  ],
  energy: [
    ['diesel', 3, 'en'],
    ['gasolina', 3, 'es'],
    ['gasoline', 3, 'en'],
    ['combustible', 3, 'es'],
    ['glp', 3, 'es'],
    ['lpg', 3, 'en'],
    ['en 590', 3, 'en'],
    ['planta electrica', 2, 'es'],
    ['generador', 2, 'es'],
    ['fuel', 2, 'en'],
  ],
  trade: [
    ['arroz', 3, 'es'],
    ['rice', 3, 'en'],
    ['soda ash', 3, 'en'],
    ['sosa', 3, 'es'],
    ['rfq', 3, 'en'],
    ['cotizacion', 3, 'es'],
    ['quotation', 3, 'en'],
    ['proveedor', 2, 'es'],
    ['supplier', 2, 'en'],
    ['importador', 2, 'es'],
    ['importer', 2, 'en'],
    ['importacion', 2, 'es'],
    ['exportacion', 2, 'es'],
    ['mercancia', 2, 'es'],
    ['flete', 2, 'es'],
    ['freight', 2, 'en'],
    ['contenedor', 2, 'es'],
    ['container', 2, 'en'],
    ['embarque', 2, 'es'],
    ['shipment', 2, 'en'],
    ['incoterm', 2, 'en'],
    ['fob', 2, 'en'],
    ['cif', 2, 'en'],
  ],
  cuba: [
    ['mipyme', 4, 'es'],
    ['mipymes', 4, 'es'],
    ['emprendedor', 3, 'es'],
    ['habana', 2, 'es'],
    ['havana', 2, 'en'],
    ['mariel', 2, 'es'],
    ['santiago de cuba', 2, 'es'],
    ['cuba', 2, 'es'],
  ],
};

/**
 * Tracks whose language policy is Spanish-first. Spanish keywords score
 * 1.5× on these tracks (Spanish-first weighting for Cuba tracks).
 * mycubacash is Cuba-facing (WhatsApp-first, Spanish-first) by convention.
 */
const ES_FIRST_TRACKS = new Set(['cuba', 'cars', 'energy', 'mycubacash']);
const ES_FIRST_BOOST = 1.5;

/** Tie-break priority: highest-stakes, most-distinctive tracks first. */
const TRACK_PRIORITY = [
  'mycubacash',
  'cars',
  'crude',
  'energy',
  'trade',
  'cuba',
];

function keywordPattern(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Single words get word boundaries; phrases match as substrings.
  return keyword.includes(' ')
    ? new RegExp(escaped)
    : new RegExp(`\\b${escaped}\\b`);
}

function trackScore(text, track) {
  let score = 0;
  for (const [keyword, weight, lang] of TRACK_KEYWORDS[track]) {
    if (!keywordPattern(keyword).test(text)) continue;
    const boost =
      ES_FIRST_TRACKS.has(track) && lang === 'es' ? ES_FIRST_BOOST : 1;
    score += weight * boost;
  }
  return score;
}

/**
 * classifyTrack(text) → 'trade' | 'cuba' | 'cars' | 'crude' | 'energy' |
 * 'mycubacash' | 'unknown'
 *
 * Keyword-based, ES/EN, pure. Exactly one track per conversation —
 * Sofia's single-front-door rule: businesses never blend behind her.
 * 'trade' is the worldwide global desk; 'cuba' is its dedicated Cuba desk.
 * Same department, strictly separate pipelines/ledgers/tracks — a message
 * is one or the other, never blended. Commodity words alone (arroz, rice)
 * do NOT pull a Cuba-desk message into 'trade'; MIPYME/Cuba-buyer signals
 * keep it on the Cuba desk, and worldwide sourcing without Cuba signals
 * stays on 'trade'.
 * Spanish-first weighting: Spanish keywords score 1.5× on Cuba tracks
 * (cuba, cars, energy, mycubacash). Ties break by TRACK_PRIORITY
 * (money-movement first). No keyword hits → 'unknown'.
 */
export function classifyTrack(text) {
  const normalized = normalizeText(text || '');
  let best = 'unknown';
  let bestScore = 0;
  for (const track of TRACK_PRIORITY) {
    const score = trackScore(normalized, track);
    if (score > bestScore) {
      bestScore = score;
      best = track;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Sanctions hard stop
// ---------------------------------------------------------------------------

/**
 * SANCTIONS_HARD_STOP — any sanctions/customs/embargo question escalates
 * to Juan, ALWAYS. The agent NEVER answers, advises, or routes around it.
 * Module code calls checkSanctions(text) before any other processing and
 * calls escalate(moduleId, 'sanctions', { text }) on a hit.
 */
export const SANCTIONS_HARD_STOP = Object.freeze({
  gate: 'sanctions',
  action: 'escalate-always',
});

const SANCTIONS_PATTERNS = [
  /\bsancion(es)?\b/,
  /\bsanction(s|ed)?\b/,
  /\bembargo(s)?\b/,
  /\bofac\b/,
  /\bsdn\b/,
  /lista negra/,
  /\bblacklist(ed|ing)?\b/,
  /denied part/,
  /restricted part/,
  /entity list/,
  /lista de sanciones/,
];

/**
 * Customs terms only hard-stop when asked as a QUESTION ("¿cuánto tarda la
 * aduana?"), so routine logistics mentions ("aduana de Mariel") don't flood
 * Juan's escalation queue. Sanctions/embargo/OFAC terms always hard-stop.
 */
const CUSTOMS_PATTERNS = [/\baduan\w*\b/, /\bcustoms?\b/];

function looksLikeQuestion(normalized) {
  if (/[?¿]/.test(normalized)) return true;
  return /^\s*(que|cual|cuanto|como|donde|por que|what|how|which|when|why|is|are|do|does|can)\b/.test(
    normalized,
  );
}

/**
 * checkSanctions(text) → boolean. Pure.
 * True when the text touches sanctions/embargo/OFAC/blacklist topics
 * (always), or asks a customs/aduana question. Modules call this FIRST,
 * before any other processing, then escalate(moduleId, 'sanctions', …).
 */
export function checkSanctions(text) {
  const normalized = normalizeText(text || '');
  if (!normalized) return false;
  if (SANCTIONS_PATTERNS.some((re) => re.test(normalized))) return true;
  return (
    looksLikeQuestion(normalized) &&
    CUSTOMS_PATTERNS.some((re) => re.test(normalized))
  );
}

// ---------------------------------------------------------------------------
// Language policy
// ---------------------------------------------------------------------------

/**
 * LANG_POLICY — per-track language policy for all agent copy and drafts.
 * 'es-first': Spanish leads, English follows (Cuba-facing, WhatsApp-first).
 * 'bilingual': both languages, matched to the audience.
 * (mycubacash follows the Cuba-facing convention: es-first.)
 */
export const LANG_POLICY = Object.freeze({
  cuba: 'es-first',
  cars: 'es-first',
  energy: 'es-first',
  trade: 'bilingual',
  crude: 'bilingual',
});

// ---------------------------------------------------------------------------
// Default per-module agent roster
// ---------------------------------------------------------------------------

const ROSTER_DEFS = [
  {
    id: 'sourcing',
    name: { es: 'Búsqueda de fuentes', en: 'Sourcing' },
    role: 'sourcing',
    tier: AGENT_TIERS.DRAFT,
    note: {
      es: 'Investiga el mercado y redacta listas de fuentes candidatas. Nunca contacta.',
      en: 'Researches the market and drafts candidate source shortlists. Never contacts.',
    },
  },
  {
    id: 'counterparty-diligence',
    name: { es: 'Diligencia de contraparte', en: 'Counterparty Diligence' },
    role: 'diligence',
    tier: AGENT_TIERS.PROPOSE,
    note: {
      es: 'Arma la lista de verificación de diligencia y propone hallazgos a la cola de Juan.',
      en: 'Builds the diligence checklist and proposes findings to Juan’s queue.',
    },
  },
  {
    id: 'pricing-economics',
    name: { es: 'Precios y economía', en: 'Pricing & Economics' },
    role: 'economics',
    tier: AGENT_TIERS.READ,
    note: {
      es: 'Solo funciones puras: calcula, nunca inventa precios ni publica cifras.',
      en: 'Pure functions only: computes, never invents prices or publishes figures.',
    },
  },
  {
    id: 'logistics',
    name: { es: 'Logística', en: 'Logistics' },
    role: 'logistics',
    tier: AGENT_TIERS.READ,
    note: {
      es: 'Resume rutas, puertos y requisitos logísticos. Solo lectura.',
      en: 'Summarizes routes, ports, and logistics requirements. Read-only.',
    },
  },
  {
    id: 'compliance',
    name: { es: 'Cumplimiento', en: 'Compliance' },
    role: 'compliance',
    tier: AGENT_TIERS.READ,
    note: {
      es: 'Solo lectura + escalamiento: cualquier riesgo de sanciones dispara escalate() inmediato.',
      en: 'Read-only + escalation: any sanctions risk triggers immediate escalate().',
    },
  },
  {
    id: 'outreach-drafting',
    name: { es: 'Redacción de mensajes', en: 'Outreach Drafting' },
    role: 'outreach',
    tier: AGENT_TIERS.DRAFT,
    note: {
      es: 'Redacta mensajes para revisión de Juan. DRAFT: nunca envía.',
      en: 'Drafts messages for Juan’s review. DRAFT: never sends.',
    },
  },
  {
    id: 'follow-up',
    name: { es: 'Seguimiento', en: 'Follow-up' },
    role: 'follow-up',
    tier: AGENT_TIERS.DRAFT,
    note: {
      es: 'Redacta seguimientos pendientes de aprobación. Nunca programa envíos automáticos.',
      en: 'Drafts follow-ups pending approval. Never schedules automatic sends.',
    },
  },
  {
    id: 'oversight',
    name: { es: 'Supervisión', en: 'Oversight' },
    role: 'oversight',
    tier: AGENT_TIERS.READ,
    note: {
      es: 'Revisa borradores con reviewDraft(): marca hechos inventados o compromisos y escala problemas.',
      en: 'Reviews drafts with reviewDraft(): flags invented facts or commitments and escalates problems.',
    },
  },
];

/**
 * defaultRoster(moduleId) → [{ id, module, role, tier, lang, name:{es,en} }]
 * Pure factory. Tiers: outreach-drafting and follow-up are DRAFT only;
 * compliance is READ + hard-stop escalation; nothing is above PROPOSE.
 * lang follows LANG_POLICY (mycubacash defaults to es-first).
 */
export function defaultRoster(moduleId) {
  const mod = requireModuleId(moduleId);
  const lang =
    LANG_POLICY[mod] === 'bilingual' ? 'bilingual' : 'es-first';
  return ROSTER_DEFS.map((def) => ({
    id: def.id,
    module: mod,
    role: def.role,
    tier: def.tier,
    lang,
    name: { ...def.name },
    note: { ...def.note },
  }));
}

// ---------------------------------------------------------------------------
// Oversight: draft review
// ---------------------------------------------------------------------------

/**
 * reviewDraft(draft) → { ok, flags: [{ code, match, es, en }] }. Pure.
 * The oversight agent runs this on every draft before it reaches Juan.
 * Flags invented facts / commitment patterns:
 *   - GUARANTEE: promise/commitment verbs (garantizar, comprometerse…)
 *   - PRICE_COMMIT: price stated as final/fixed/guaranteed
 *   - AVAILABILITY: availability stated as fact (en stock, inmediata…)
 *   - TIMELINE: delivery/timing promised as fact
 *   - COUNTERPARTY: invented supplier/partner relationships claimed
 *   - TRACK_RECORD: invented sales history or client claims
 *   - PRICE_AS_FACT: a specific $ amount stated without a quote/estimate
 *     qualifier nearby (heuristic — the qualifier may just be farther away,
 *     so Juan still sees the flag and decides).
 */
const DRAFT_FLAG_PATTERNS = [
  {
    code: 'GUARANTEE',
    re: /\b(garantiz\w*|te garantizo|nos compromet\w*|we guarantee|we commit|i promise|te lo prometo)\b/,
    es: 'Promesa o compromiso: ningún agente puede garantizar resultados.',
    en: 'Promise or commitment: no agent may guarantee outcomes.',
  },
  {
    code: 'AVAILABILITY',
    re: /\b(en stock|in stock|disponibilidad garantizada|disponible inmediatamente|immediate availability|entrega inmediata)\b/,
    es: 'Disponibilidad afirmada como hecho: verificar con la fuente real antes de prometer.',
    en: 'Availability stated as fact: verify with the real source before promising.',
  },
  {
    code: 'TIMELINE',
    re: /\b(entrega garantizada|guaranteed delivery|llega el \d|llegara el \d|delivery in \d+ days?|entrega en \d+ dias?)\b/,
    es: 'Fecha o plazo de entrega prometido: los tiempos los confirma Juan, no el borrador.',
    en: 'Delivery date or timeline promised: Juan confirms timing, not the draft.',
  },
  {
    code: 'COUNTERPARTY',
    re: /\b(nuestro proveedor|nuestra proveedora|nuestro socio|our supplier|our partner|proveedor confirmado|confirmed supplier)\b/,
    es: 'Relación con contraparte afirmada: no inventar proveedores ni socios.',
    en: 'Counterparty relationship claimed: never invent suppliers or partners.',
  },
  {
    code: 'PRICE_COMMIT',
    re: /\b(precio final|precio fijo|precio garantizado|precio confirmado|final price|fixed price|guaranteed price|locked[ -]in price)\b/,
    es: 'Precio comprometido como definitivo: los precios finales los aprueba Juan.',
    en: 'Price committed as final: Juan approves final prices.',
  },
  {
    code: 'TRACK_RECORD',
    re: /\b(hemos vendido|vendimos|we have sold|nuestros clientes|our clients|ya hemos entregado|we already delivered)\b/,
    es: 'Historial de ventas/clientes afirmado: no inventar trayectoria.',
    en: 'Sales history/clients claimed: never invent a track record.',
  },
];

const PRICE_RE = /\$\s?\d[\d.,]*/;
const PRICE_QUALIFIER_RE =
  /\b(cotiz\w*|quote|quot\w*|aprox\w*|estim\w*|estimate|referencia|reference|~)\b/;

function draftText(draft) {
  if (typeof draft === 'string') return draft;
  if (draft && typeof draft === 'object') {
    const parts = [];
    if (typeof draft.es === 'string') parts.push(draft.es);
    if (typeof draft.en === 'string') parts.push(draft.en);
    if (typeof draft.text === 'string') parts.push(draft.text);
    if (parts.length) return parts.join('\n');
  }
  return '';
}

function snippetAround(text, index, radius = 60) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return snippet.length > 140 ? `${snippet.slice(0, 137)}…` : snippet;
}

export function reviewDraft(draft) {
  const text = draftText(draft);
  const normalized = normalizeText(text);
  const flags = [];
  const seen = new Set();

  function pushFlag(code, es, en, matchIndex) {
    const key = `${code}@${matchIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    flags.push({
      code,
      match: snippetAround(text, matchIndex),
      es,
      en,
    });
  }

  for (const pattern of DRAFT_FLAG_PATTERNS) {
    const re = new RegExp(pattern.re.source, 'gi');
    let m;
    while ((m = re.exec(normalized)) !== null) {
      pushFlag(pattern.code, pattern.es, pattern.en, m.index);
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }

  // PRICE_AS_FACT: a $ amount with no quote/estimate qualifier nearby.
  const priceRe = new RegExp(PRICE_RE.source, 'g');
  let pm;
  while ((pm = priceRe.exec(text)) !== null) {
    const windowStart = Math.max(0, pm.index - 80);
    const windowEnd = Math.min(text.length, pm.index + pm[0].length + 80);
    const windowText = normalizeText(text.slice(windowStart, windowEnd));
    if (!PRICE_QUALIFIER_RE.test(windowText)) {
      pushFlag(
        'PRICE_AS_FACT',
        'Precio específico sin calificador de cotización/estimado: podría ser un precio inventado.',
        'Specific price without a quote/estimate qualifier: could be an invented price.',
        pm.index,
      );
    }
    if (pm[0].length === 0) priceRe.lastIndex += 1;
  }

  return { ok: flags.length === 0, flags };
}
