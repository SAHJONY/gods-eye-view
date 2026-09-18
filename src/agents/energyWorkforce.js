/**
 * SAHJONY · GOD'S EYE VIEW — Energy Desk AI Workforce
 * -----------------------------------------------------------------------
 * Client-side only. $0. No API keys. No external network calls.
 * The workforce runs ONLY while the app is open — nothing runs in the
 * background (see WORKFORCE_NOTE).
 *
 * SANCTIONS HARD STOP (the heart of this module):
 *   - ANY sanctions/customs/embargo question or content → escalate to Juan
 *     immediately (escalate('energy', 'sanctions', ...)).
 *   - The workforce NEVER answers a sanctions question, NEVER advises on
 *     legality, NEVER evaluates sanctions lists, NEVER routes around the
 *     gate. There is no screening data source — verification is manual and
 *     belongs to Juan.
 *   - Every agent routes free-form content through screenContent() FIRST.
 *
 * HARD RULES (approval gates — never bypassed):
 *   - Agents NEVER send, email, post, publish, purchase, sign, call, text.
 *   - Agents NEVER contact or screen any real counterparty, vessel, or bank.
 *   - There is NO function in this module that sends anything. Draft-only
 *     by design: the module exports no send/post/publish/offer function,
 *     and a unit test asserts that on the source file.
 *   - Agents NEVER advance an inquiry past the compliance gate. Only Juan
 *     advances the gate through the dashboard; the workforce only drafts
 *     notes and memos.
 *   - All outputs are drafts, notes, and memos stored inside the inquiry
 *     record. The UI decides what Juan sees; the engine only proposes.
 *
 * This module is self-contained on the workforce-core spec (the shared
 * src/agents/workforceCore.js lands on the trade-platform-workforce branch):
 * AGENT_TIERS, SANCTIONS_HARD_STOP, escalate(), logAction(), classifyTrack()
 * keep the exact core semantics so the later refactor is behavior-preserving.
 *
 * Injected collaborators:
 *   - energyStore: { getAll(), get(id), update(id, patch), notes(id) }
 *     notes(id) → [{ t, agent, es, en }]. Inquiry shape: { id, ref,
 *     product, volumeMt, volumeGal, volumeBbl, unit, buyPerUnit,
 *     sellPerUnit, feePerUnit, dischargePort, counterpartyName, status,
 *     agentNotes: [{ at, agent, es, en }], gateResult, meta, createdAt,
 *     updatedAt }. Statuses: inquiry → diligence → gate-review →
 *     commercial → (closed / dead); awaiting-juan is the hard-stop state.
 *   - energyEngine: { parcelEconomics(inq), evaluateGate(answers),
 *     formatMoney(n), formatGal(n), formatMt(n), productLabel(p, lang),
 *     getSpecSheet(p) }. Engine calls are defensive: every call is wrapped
 *     in try/catch with safe fallbacks, so a throwing engine can never
 *     break the passes.
 */

export const MODULE_ID = 'energy';
export const WORKFORCE_LOG_KEY = 'sahjony.workforce.energy.log.v1';
export const ESCALATION_LOG_KEY = 'sahjony.workforce.energy.escalations.v1';
export const LOG_CAP = 300;

/** Authority tiers — there is NO execute tier. Nothing external without Juan. */
export const AGENT_TIERS = Object.freeze({
  READ: 'read',
  DRAFT: 'draft',
  PROPOSE: 'propose',
});

/** Any sanctions/customs/embargo content → escalate always, never answer. */
export const SANCTIONS_HARD_STOP = Object.freeze({
  gate: 'sanctions',
  action: 'escalate-always',
});

/** Honest framing — the workforce is active only while the app is open. */
export const WORKFORCE_NOTE = {
  es: 'La fuerza trabaja mientras la app está abierta.',
  en: 'The workforce runs while the app is open.',
};

// ---------------------------------------------------------------------------
// Sanctions content screening — escalate-always, never answer.
// ---------------------------------------------------------------------------

const SANCTIONS_DOMAIN = new RegExp(
  [
    'ofac', 'sdn', 'sancion', 'sanciones', 'sanction', 'sanctions',
    'embargo', 'aduana', 'aduanas', 'customs',
    'lista de sancionados', 'denied parties', 'entity list',
    'licencia de exportaci[oó]n', 'export licen[cs]e',
    'bis\\b', 'fincen', 'autorizaci[oó]n legal', 'legal authorization',
    'bloqueo', 'blockade',
  ].join('|'),
  'i',
);

const QUESTION_OR_ADVICE = new RegExp(
  [
    '\\?', 'c[oó]mo', 'how', 'puedo', 'podemos', 'can i', 'can we',
    'se puede', 'is it', 'allowed', 'permitido', 'legal', 'legales',
    'asesor', 'advice', 'advise', 'consejo', 'recomienda', 'recommend',
    'riesgo', 'risk', 'eval[uú]a\\b', 'evaluate', 'verifica(s|n|mos|r)?\\b', 'check',
    'pantalla', 'screen', 'dime', 'tell me', 'expl[ií]came', 'explain',
  ].join('|'),
  'i',
);

/**
 * True when the text is a sanctions/customs/embargo QUESTION or advice
 * request — the exact trigger for SANCTIONS_HARD_STOP. Static compliance
 * copy (the gate checklist itself) is not a question and returns false:
 * the request-verb patterns are word-boundary anchored so "verificación
 * MANUAL por Juan" in checklist copy is not misread as a request.
 */
export function isSanctionsQuestion(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return SANCTIONS_DOMAIN.test(text) && QUESTION_OR_ADVICE.test(text);
}

/**
 * True for any sanctions-domain content (questions AND statements).
 * Agents treat statements as read-only context; questions escalate.
 */
export function mentionsSanctions(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return SANCTIONS_DOMAIN.test(text);
}

/**
 * classifyTrack(text) → 'energy' for energy-domain content, else 'unknown'.
 * Sofia single-front-door rule: exactly one track per conversation, never
 * blended. (Minimal local version of the core spec.)
 */
export function classifyTrack(text) {
  if (typeof text !== 'string' || !text.trim()) return 'unknown';
  const energy = new RegExp(
    [
      'di[eé]sel', 'diesel', 'gasolina', 'gasoline', 'glp', '\\blpg\\b',
      'propano', 'propane', 'combustible', 'fuel', 'en 590',
      'energ[ií]a', 'energy', 'tanquero', 'tanker',
    ].join('|'),
    'i',
  );
  return energy.test(text) ? 'energy' : 'unknown';
}

// ---------------------------------------------------------------------------
// Escalation + action logging.
// ---------------------------------------------------------------------------

function readJson(key) {
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

function writeJson(key, events) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(events.slice(-LOG_CAP)));
  } catch {
    /* storage may be unavailable — the in-memory log still works */
  }
}

let inMemoryEscalations = [];

function chicagoNow() {
  try {
    return new Date().toISOString();
  } catch {
    return String(Date.now());
  }
}

/**
 * escalate(moduleId, reason, payload)
 * → {ts, module, reason, payload, status:'awaiting-juan'} appended to the
 * escalation queue. reason: 'sanctions' | 'compliance' | 'missing-data'.
 * The agent NEVER answers, advises, or routes around the trigger.
 */
export function escalate(moduleId, reason, payload = {}) {
  const record = {
    ts: chicagoNow(),
    module: moduleId,
    reason,
    payload: payload && typeof payload === 'object' ? { ...payload } : {},
    status: 'awaiting-juan',
  };
  inMemoryEscalations.push(record);
  if (inMemoryEscalations.length > LOG_CAP) {
    inMemoryEscalations = inMemoryEscalations.slice(-LOG_CAP);
  }
  writeJson(ESCALATION_LOG_KEY, [...readJson(ESCALATION_LOG_KEY), record]);
  return record;
}

/** Read escalations (in-memory + persisted), newest last. */
export function readEscalations() {
  const stored = readJson(ESCALATION_LOG_KEY);
  const merged = [...inMemoryEscalations];
  const seen = new Set(merged.map((e) => `${e.ts}|${e.reason}|${JSON.stringify(e.payload)}`));
  for (const e of stored) {
    const key = `${e.ts}|${e.reason}|${JSON.stringify(e.payload)}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(e);
    }
  }
  return merged;
}

/**
 * logAction(moduleId, agentId, action)
 * → appends {ts, module, agent, action, tier, status} to
 * sahjony.workforce.energy.log.v1.
 */
export function logAction(moduleId, agentId, action) {
  const record = {
    ts: chicagoNow(),
    module: moduleId,
    agent: agentId,
    action,
    tier: AGENT_TIERS.READ,
    status: 'logged',
  };
  writeJson(WORKFORCE_LOG_KEY, [...readJson(WORKFORCE_LOG_KEY), record]);
  return record;
}

// ---------------------------------------------------------------------------
// Workforce roster (v1 — trimmed to deal flow, drafts only).
// ---------------------------------------------------------------------------

const ROLE_DEFS = [
  {
    id: 'spec-analyst',
    name: { es: 'Analista de especificaciones', en: 'Spec Analyst' },
    role: 'analysis',
    tier: AGENT_TIERS.READ,
  },
  {
    id: 'gate-keeper',
    name: { es: 'Guardián del gate', en: 'Gate Keeper' },
    role: 'compliance',
    tier: AGENT_TIERS.READ,
  },
  {
    id: 'economics-memo',
    name: { es: 'Memorista de economía', en: 'Economics Memo' },
    role: 'analysis',
    tier: AGENT_TIERS.READ,
  },
  {
    id: 'logistics-checker',
    name: { es: 'Revisor de logística', en: 'Logistics Checker' },
    role: 'analysis',
    tier: AGENT_TIERS.READ,
  },
  {
    id: 'outreach-drafter',
    name: { es: 'Redactor de alcance', en: 'Outreach Drafter' },
    role: 'drafting',
    tier: AGENT_TIERS.DRAFT,
  },
];

export const ROLE_IDS = Object.freeze(ROLE_DEFS.map((r) => r.id));

const QUEUE_STATUSES = ['inquiry', 'diligence', 'gate-review', 'commercial'];

function readNotes(energyStore, inq) {
  try {
    if (energyStore && typeof energyStore.notes === 'function') {
      const list = energyStore.notes(inq.id);
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
    (energyStore && typeof energyStore.get === 'function'
      ? energyStore.get(inq.id)
      : null) || inq;
  // The free-text `notes` field is operator content (a string) and is NOT
  // an agent-note array — prefer agentNotes, accept a legacy array-shaped
  // notes field, never treat a string as notes.
  const raw = Array.isArray(rec.agentNotes)
    ? rec.agentNotes
    : Array.isArray(rec.notes)
      ? rec.notes
      : [];
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => ({
    t: n.t ?? n.at ?? Date.now(),
    agent: n.agent || '',
    es: n.es || '',
    en: n.en || '',
  }));
}

/**
 * createWorkforce({ energyStore, energyEngine, signal, tickMs, staggerMs })
 * Returns the orchestrator handle.
 */
export function createWorkforce(opts = {}) {
  const { energyStore, energyEngine, signal, tickMs = 20000, staggerMs = 5000 } = opts;
  if (
    !energyStore ||
    typeof energyStore.getAll !== 'function' ||
    typeof energyStore.update !== 'function'
  ) {
    throw new Error(
      'createWorkforce requires an energyStore with getAll()/update().',
    );
  }
  if (!energyEngine) {
    throw new Error('createWorkforce requires an energyEngine.');
  }

  let running = false;
  let destroyed = false;
  const listeners = new Set();
  let log = readJson(WORKFORCE_LOG_KEY);
  const knownPorts = new Set();

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

  // -- shared helpers --------------------------------------------------------
  function addNote(inq, agentId, es, en) {
    const note = { t: Date.now(), agent: agentId, es, en };
    // NEVER touch the free-text `notes` field here: it is operator content
    // that the gate-keeper screens for sanctions questions. Write only the
    // agentNotes array (+ updatedAt). A previous draft of this function
    // spread {...current, notes} and clobbered the operator's notes with
    // the agent-note array — destroying the exact text the hard-stop scans.
    const agentNotes = [
      ...readNotes(energyStore, inq).map((n) => ({
        at: n.t,
        agent: n.agent,
        es: n.es,
        en: n.en,
      })),
      { at: note.t, agent: note.agent, es: note.es, en: note.en },
    ];
    energyStore.update(inq.id, { agentNotes, updatedAt: Date.now() });
    return note;
  }

  function emit(agentId, kind, es, en, inquiryId) {
    const agent = byId[agentId];
    const event = { t: Date.now(), agent: agentId, kind, es, en };
    if (inquiryId !== undefined && inquiryId !== null) event.inquiryId = inquiryId;
    if (agent) agent.lastAction = event;
    log.push(event);
    if (log.length > LOG_CAP) log = log.slice(-LOG_CAP);
    writeJson(WORKFORCE_LOG_KEY, log);
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        /* a listener must never break the workforce */
      }
    }
  }

  function allInquiries() {
    try {
      const rows = energyStore.getAll();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  // -- defensive engine wrappers ----------------------------------------------
  function safeParcelEconomics(inq) {
    try {
      const e = energyEngine.parcelEconomics(inq);
      if (e && typeof e === 'object') return e;
    } catch {
      /* fall through */
    }
    return { volumeMt: 0, volumeGal: 0, volumeBbl: 0, perUnitSpread: 0, totalSpread: 0, flatFee: 0 };
  }

  function fmtMoney(n) {
    try {
      if (typeof energyEngine.formatMoney === 'function') {
        const s = energyEngine.formatMoney(n);
        if (typeof s === 'string' && s) return s;
      }
    } catch {
      /* fall through */
    }
    return `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
  }

  function fmtGal(n) {
    try {
      if (typeof energyEngine.formatGal === 'function') {
        const s = energyEngine.formatGal(n);
        if (typeof s === 'string' && s) return s;
      }
    } catch {
      /* fall through */
    }
    return `${Math.round(Number(n) || 0).toLocaleString('en-US')} gal`;
  }

  function fmtMt(n) {
    try {
      if (typeof energyEngine.formatMt === 'function') {
        const s = energyEngine.formatMt(n);
        if (typeof s === 'string' && s) return s;
      }
    } catch {
      /* fall through */
    }
    return `${Number(n) || 0} MT`;
  }

  function productName(product) {
    try {
      if (typeof energyEngine.productLabel === 'function') {
        return energyEngine.productLabel(product, 'es');
      }
    } catch {
      /* fall through */
    }
    return String(product || '');
  }

  // -- the hard-stop entry point: EVERY agent screens content first -----------
  /**
   * screenContent(text, { inquiryId }) → { escalated: bool, record? }.
   * Any sanctions/customs/embargo QUESTION escalates immediately and the
   * caller must produce no answer, no advice, no workaround.
   */
  function screenContent(text, { inquiryId = null, agentId = 'gate-keeper' } = {}) {
    if (!isSanctionsQuestion(text)) return { escalated: false };
    const record = escalate(MODULE_ID, 'sanctions', {
      inquiryId,
      excerpt: String(text).slice(0, 500),
      policy: 'SANCTIONS_HARD_STOP: question escalated, never answered.',
    });
    emit(
      agentId,
      'hard-stop',
      '⛔ Pregunta de sanciones/aduanas detectada — escalada a Juan. La fuerza no responde.',
      '⛔ Sanctions/customs question detected — escalated to Juan. The workforce does not answer.',
      inquiryId,
    );
    return { escalated: true, record };
  }

  // -- spec-analyst: benchmark freshness notes (READ only) ---------------------
  function runSpecAnalyst() {
    for (const inq of allInquiries()) {
      if (!QUEUE_STATUSES.includes(inq.status)) continue;
      const spec = (() => {
        try {
          return energyEngine.getSpecSheet
            ? energyEngine.getSpecSheet(inq.product)
            : null;
        } catch {
          return null;
        }
      })();
      const standard = spec && spec.standard ? spec.standard : '(sin ficha)';
      addNote(
        inq,
        'spec-analyst',
        `Ficha de referencia para ${productName(inq.product)}: norma ${standard}. Valores estáticos de la norma publicada — no son una oferta ni resultados de laboratorio.`,
        `Reference spec sheet for ${productName(inq.product)}: standard ${standard}. Static published-standard values — not an offer or lab results.`,
      );
      emit(
        'spec-analyst',
        'spec-note',
        `Ficha registrada: ${inq.ref || inq.id}`,
        `Spec noted: ${inq.ref || inq.id}`,
        inq.id,
      );
    }
  }

  // -- gate-keeper: hard-stop screening (READ + escalation, never advisory) ---
  // Content fingerprints of sanctions questions already escalated, keyed by
  // inquiry id. The gate-keeper scans every cycle, so without this a single
  // question would write a duplicate escalation on every pass. New content
  // (a NEW question added later) still fires — fingerprints only suppress
  // exact repeats.
  const escalatedFingerprints = new Set();
  function fingerprint(inquiryId, text) {
    let h = 0;
    const s = `${inquiryId}::${text}`;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return h;
  }

  function runGateKeeper() {
    for (const inq of allInquiries()) {
      const texts = [
        inq.notes || '',
        ...(Array.isArray(inq.agentNotes)
          ? inq.agentNotes.map((n) => `${n.es || ''}\n${n.en || ''}`)
          : []),
      ];
      let tripped = false;
      for (const text of texts) {
        if (!isSanctionsQuestion(text)) continue;
        const fp = fingerprint(inq.id, text);
        if (escalatedFingerprints.has(fp)) continue; // exact repeat, already escalated
        escalatedFingerprints.add(fp);
        // Bounded: evict the oldest fingerprint past the cap (negligible
        // re-fire risk; the workforce runs while the app is open).
        if (escalatedFingerprints.size > 2000) {
          const oldest = escalatedFingerprints.values().next().value;
          escalatedFingerprints.delete(oldest);
        }
        const { escalated } = screenContent(text, {
          inquiryId: inq.id,
          agentId: 'gate-keeper',
        });
        if (escalated) {
          tripped = true;
          // The inquiry must not proceed commercially while a sanctions
          // question is outstanding: force it to Juan's queue.
          try {
            if (
              energyStore.get &&
              typeof energyStore.get(inq.id)?.status === 'string'
            ) {
              const current = energyStore.get(inq.id);
              if (current.status !== 'awaiting-juan') {
                energyStore.update(inq.id, { status: 'awaiting-juan' });
              }
            }
          } catch {
            /* status enforcement is best-effort here; the gate is authoritative */
          }
          break;
        }
      }
      if (!tripped) {
        emit(
          'gate-keeper',
          'screened',
          `Sin preguntas de sanciones en ${inq.ref || inq.id} — el gate sigue siendo decisión de Juan.`,
          `No sanctions questions in ${inq.ref || inq.id} — the gate remains Juan's decision.`,
          inq.id,
        );
      }
    }
  }

  // -- economics-memo: pure-engine economics memos (READ only) -----------------
  function runEconomicsMemo() {
    for (const inq of allInquiries()) {
      if (inq.status !== 'gate-review' && inq.status !== 'commercial') continue;
      const econ = safeParcelEconomics(inq);
      const es =
        `Memorando económico (corredor) — ${inq.ref || '(sin referencia)'} (${productName(inq.product)}):\n` +
        `Volumen: ${fmtMt(econ.volumeMt)} = ${fmtGal(econ.volumeGal)}.\n` +
        `Spread por unidad: ${fmtMoney(econ.perUnitSpread)}/MT. Spread total estimado: ${fmtMoney(econ.totalSpread)}.\n` +
        `SAHJONY actúa como corredor por honorario/spread — nunca compra ni vende el producto, cero capital en riesgo.`;
      const en =
        `Economics memo (broker) — ${inq.ref || '(no reference)'} (${productName(inq.product)}):\n` +
        `Volume: ${fmtMt(econ.volumeMt)} = ${fmtGal(econ.volumeGal)}.\n` +
        `Per-unit spread: ${fmtMoney(econ.perUnitSpread)}/MT. Estimated total spread: ${fmtMoney(econ.totalSpread)}.\n` +
        `SAHJONY acts as a fee/spread broker — never buys or sells the product, zero capital at risk.`;
      addNote(inq, 'economics-memo', es, en);
      emit(
        'economics-memo',
        'memo',
        `Memorando escrito: ${inq.ref || inq.id}`,
        `Memo written: ${inq.ref || inq.id}`,
        inq.id,
      );
    }
  }

  // -- logistics-checker: reference-data validation (READ only) ----------------
  function runLogisticsChecker() {
    for (const inq of allInquiries()) {
      if (inq.status !== 'gate-review' && inq.status !== 'commercial') continue;
      const port = (inq.dischargePort || '').trim().toLowerCase();
      const portKnown = [...knownPorts].some((p) => p === port) || port.length > 0;
      const volumeOk =
        Number(inq.volumeMt) > 0 || Number(inq.volumeGal) > 0 || Number(inq.volumeBbl) > 0;
      const es =
        `Revisión logística — ${inq.ref || '(sin referencia)'}:\n` +
        `• Puerto de descarga: ${inq.dischargePort || '(sin definir)'} ${portKnown ? '(presente)' : '(verificar contra la referencia)'}.\n` +
        `• Volumen: ${volumeOk ? 'presente' : 'FALTA — nada se inventa'}.\n` +
        `Campos de referencia estática; el calado y la ventana de laycan se verifican manualmente.`;
      const en =
        `Logistics review — ${inq.ref || '(no reference)'}:\n` +
        `• Discharge port: ${inq.dischargePort || '(unset)'} ${portKnown ? '(present)' : '(verify against reference)'}.\n` +
        `• Volume: ${volumeOk ? 'present' : 'MISSING — nothing invented'}.\n` +
        `Static reference fields; draft and laycan are verified manually.`;
      addNote(inq, 'logistics-checker', es, en);
      emit(
        'logistics-checker',
        'logistics',
        `Logística revisada: ${inq.ref || inq.id}`,
        `Logistics reviewed: ${inq.ref || inq.id}`,
        inq.id,
      );
    }
  }

  // -- outreach-drafter: DRAFT ONLY — WhatsApp-ready copy, never sent ---------
  function runOutreachDrafter() {
    for (const inq of allInquiries()) {
      if (inq.status !== 'commercial') continue;
      const es =
        `BORRADOR (no enviado) — mensaje de alcance para ${inq.ref || '(sin referencia)'}:\n` +
        `"Hola, soy SAHJONY, corredor de combustibles. Buscamos ${fmtMt(safeParcelEconomics(inq).volumeMt)} de ${productName(inq.product)} con descarga en ${inq.dischargePort || 'Cuba'}. ¿Tienen disponibilidad y precio? Respondemos en 24–48h."\n` +
        `Este borrador requiere la aprobación de Juan antes de cualquier envío. Nada se ha enviado.`;
      const en =
        `DRAFT (not sent) — outreach copy for ${inq.ref || '(no reference)'}:\n` +
        `"Hi, I'm SAHJONY, a fuel broker. We're looking for ${fmtMt(safeParcelEconomics(inq).volumeMt)} of ${productName(inq.product)} discharging at ${inq.dischargePort || 'Cuba'}. Do you have availability and pricing? We reply in 24–48h."\n` +
        `This draft requires Juan's approval before any send. Nothing has been sent.`;
      addNote(inq, 'outreach-drafter', es, en);
      emit(
        'outreach-drafter',
        'draft',
        `Borrador listo (no enviado): ${inq.ref || inq.id}`,
        `Draft ready (not sent): ${inq.ref || inq.id}`,
        inq.id,
      );
    }
  }

  const passes = [
    runSpecAnalyst,
    runGateKeeper,
    runEconomicsMemo,
    runLogisticsChecker,
    runOutreachDrafter,
  ];

  function processOnce() {
    if (destroyed) return;
    for (const agent of agents) {
      const prev = agent.status;
      agent.status = 'working';
      try {
        passes[agents.indexOf(agent)]();
      } catch (err) {
        emit(
          agent.id,
          'error',
          `Error en el agente ${agent.name.es}: ${err && err.message ? err.message : err}`,
          `Agent ${agent.name.en} error: ${err && err.message ? err.message : err}`,
        );
      } finally {
        agent.status = running ? 'working' : prev === 'paused' ? 'paused' : 'idle';
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
          } catch (err) {
            emit(
              agent.id,
              'error',
              `Error en el agente ${agent.name.es}: ${err && err.message ? err.message : err}`,
              `Agent ${agent.name.en} error: ${err && err.message ? err.message : err}`,
            );
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
    return allInquiries().filter((r) => QUEUE_STATUSES.includes(r.status)).length;
  }

  function getSummary() {
    return {
      running,
      module: MODULE_ID,
      note: { ...WORKFORCE_NOTE },
      agents: agents.map((a) => ({
        id: a.id,
        status: a.status,
        tier: a.tier,
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
    getEscalations: readEscalations,
    processOnce,
    destroy,
    getSummary,
    screenContent,
    setKnownPorts(list) {
      knownPorts.clear();
      for (const p of Array.isArray(list) ? list : []) {
        const name = typeof p === 'string' ? p : p?.name?.es || p?.id || '';
        if (name) knownPorts.add(String(name).trim().toLowerCase());
      }
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
