/**
 * SAHJONY · GOD'S EYE VIEW — Trade (Import/Export) RFQ Workforce
 * -----------------------------------------------------------------------
 * Client-side only. $0. No API keys. No external network calls.
 * The workforce runs ONLY while the app is open — nothing runs in the
 * background (see WORKFORCE_NOTE).
 *
 * HARD RULES (approval gates — never bypassed):
 *   - Agents NEVER send, email, post, purchase, sign, call, or text.
 *   - Agents NEVER contact or screen any real counterparty.
 *   - There is NO automatic sanctions-screening data source: screening is
 *     manual only and stays as notes.
 *   - Agents NEVER delete RFQs.
 *   - All outputs are drafts, notes, and memos stored inside the RFQ record.
 *   - The UI decides what Juan sees; the engine only proposes.
 *
 * Injected collaborators:
 *   - rfqStore: { getAll(), get(id), update(id, patch), notes(id) }
 *     notes(id) → [{ t, agent, es, en }] (notes key `t`, like the crude
 *     workforce). Notes are written back through update() under both
 *     `notes` (key `t`) and `agentNotes` (key `at`) so either store view
 *     keeps seeing them.
 *     RFQ shape: { id, ref, product, quantity, unitCost, sellUnitPrice,
 *                  freight, duties, otherCosts, commissionPct, incoterms,
 *                  originPort, destinationPort, originLat, originLng,
 *                  destLat, destLng, supplierId, buyerId, status,
 *                  agentNotes: [{ at, agent, es, en }],
 *                  createdAt, updatedAt }
 *     RFQ statuses: prospect → contacted → quoting → negotiating →
 *     (won / lost, set only by Juan — never by the workforce)
 *   - rfqEngine: { landedCostUnit(rfq) -> number,
 *                  netMarginTotal(rfq) -> number,
 *                  netMarginPct(rfq) -> number,
 *                  commissionAmount(rfq) -> number,
 *                  missingFields(rfq) -> [{ field, es, en }],
 *                  rfqVerdict(rfq) -> { tier, es, en, reasons },
 *                  scoreRfq(rfq) -> number,
 *                  formatMoney(n) -> string, formatQty(n) -> string }
 *     Engine calls are defensive: every call is wrapped in try/catch with
 *     'yellow'/0 fallbacks, so a throwing engine can never break the passes.
 *   - suppliers are injected via setSuppliers([...]) and ranked by the
 *     coordinator. Supplier shape: { id, name, verification, country, role }
 *     verification: 'verified' | 'pending' | 'unverified' | 'flagged'.
 */

export const WORKFORCE_LOG_KEY = 'sahjony.workforce.trade.log.v1';
export const LOG_CAP = 300;

/** Honest framing — the workforce is active only while the app is open. */
export const WORKFORCE_NOTE = {
  es: 'La fuerza trabaja mientras la app está abierta.',
  en: 'The workforce runs while the app is open.',
};

const ROLE_DEFS = [
  {
    id: 'supplier-scout',
    name: { es: 'Explorador de proveedores', en: 'Supplier Scout' },
    role: 'triage',
  },
  {
    id: 'rfq-researcher',
    name: { es: 'Investigador RFQ', en: 'RFQ Researcher' },
    role: 'diligence',
  },
  {
    id: 'logistics-analyst',
    name: { es: 'Analista de logística', en: 'Logistics Analyst' },
    role: 'analysis',
  },
  {
    id: 'deal-coordinator',
    name: { es: 'Coordinador de trato', en: 'Deal Coordinator' },
    role: 'dispositions',
  },
];

const QUEUE_STATUSES = ['prospect', 'contacted', 'quoting', 'negotiating'];

const VERDICT_TIERS = new Set(['green', 'yellow', 'red']);

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

function fmtMoney(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US')}`;
}

function hasValidTriage(rfq) {
  return (
    rfq &&
    typeof rfq.ref === 'string' &&
    rfq.ref.trim().length > 0 &&
    typeof rfq.product === 'string' &&
    rfq.product.trim().length > 0 &&
    typeof rfq.quantity === 'number' &&
    rfq.quantity > 0 &&
    typeof rfq.originPort === 'string' &&
    rfq.originPort.trim().length > 0 &&
    typeof rfq.destinationPort === 'string' &&
    rfq.destinationPort.trim().length > 0
  );
}

function missingTriageFields(rfq) {
  const missing = [];
  if (!(typeof rfq.ref === 'string' && rfq.ref.trim().length > 0)) {
    missing.push({ es: 'referencia', en: 'reference' });
  }
  if (!(typeof rfq.product === 'string' && rfq.product.trim().length > 0)) {
    missing.push({ es: 'producto', en: 'product' });
  }
  if (!(typeof rfq.quantity === 'number' && rfq.quantity > 0)) {
    missing.push({ es: 'cantidad (> 0)', en: 'quantity (> 0)' });
  }
  if (!(
    typeof rfq.originPort === 'string' && rfq.originPort.trim().length > 0
  )) {
    missing.push({ es: 'puerto de origen', en: 'origin port' });
  }
  if (!(
    typeof rfq.destinationPort === 'string' &&
    rfq.destinationPort.trim().length > 0
  )) {
    missing.push({ es: 'puerto de destino', en: 'destination port' });
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

/** Read the workforce-store notes view, normalized to [{t, agent, es, en}]. */
function readNotes(rfqStore, rfq) {
  try {
    if (rfqStore && typeof rfqStore.notes === 'function') {
      const list = rfqStore.notes(rfq.id);
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
    (rfqStore && typeof rfqStore.get === 'function'
      ? rfqStore.get(rfq.id)
      : null) || rfq;
  const raw = rec.notes || rec.agentNotes || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => ({
    t: n.t ?? n.at ?? Date.now(),
    agent: n.agent || '',
    es: n.es || '',
    en: n.en || '',
  }));
}

/**
 * createWorkforce({ rfqStore, rfqEngine, signal, tickMs, staggerMs })
 * Returns the orchestrator handle.
 */
export function createWorkforce(opts = {}) {
  const {
    rfqStore,
    rfqEngine,
    signal,
    tickMs = 20000,
    staggerMs = 5000,
  } = opts;
  if (
    !rfqStore ||
    typeof rfqStore.getAll !== 'function' ||
    typeof rfqStore.update !== 'function'
  ) {
    throw new Error(
      'createWorkforce requires an rfqStore with getAll()/update().',
    );
  }
  if (!rfqEngine) {
    throw new Error('createWorkforce requires an rfqEngine.');
  }

  let running = false;
  let destroyed = false;
  let suppliers = [];
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

  function addNote(rfq, agentId, es, en) {
    const note = { t: Date.now(), agent: agentId, es, en };
    const existing = rfqStore.get ? rfqStore.get(rfq.id) : null;
    const current = existing || rfq;
    const notes = [...readNotes(rfqStore, rfq), note];
    // Write both key shapes so either store view (notes/`t` or
    // agentNotes/`at`) keeps seeing workforce notes.
    const agentNotes = notes.map((n) => ({
      at: n.t,
      agent: n.agent,
      es: n.es,
      en: n.en,
    }));
    rfqStore.update(rfq.id, {
      ...current,
      notes,
      agentNotes,
      updatedAt: Date.now(),
    });
    return note;
  }

  function setStatus(rfq, status) {
    rfqStore.update(rfq.id, { status, updatedAt: Date.now() });
  }

  function emit(agentId, kind, es, en, rfqId) {
    const agent = byId[agentId];
    const event = { t: Date.now(), agent: agentId, kind, es, en };
    if (rfqId !== undefined && rfqId !== null) event.rfqId = rfqId;
    if (agent) agent.lastAction = event;
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

  function allRfqs() {
    try {
      const rfqs = rfqStore.getAll();
      return Array.isArray(rfqs) ? rfqs : [];
    } catch {
      return [];
    }
  }

  // -- defensive rfqEngine wrappers ------------------------------------------
  function safeVerdict(rfq) {
    try {
      const v = rfqEngine.rfqVerdict(rfq);
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

  function safeNum(fn, rfq) {
    try {
      const n = Number(fn(rfq));
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  function safeLanded(rfq) {
    return safeNum((r) => rfqEngine.landedCostUnit(r), rfq);
  }

  function safeMarginTotal(rfq) {
    return safeNum((r) => rfqEngine.netMarginTotal(r), rfq);
  }

  function safeMarginPct(rfq) {
    return safeNum((r) => rfqEngine.netMarginPct(r), rfq);
  }

  function safeCommission(rfq) {
    return safeNum((r) => rfqEngine.commissionAmount(r), rfq);
  }

  function safeMissingFields(rfq) {
    try {
      const m = rfqEngine.missingFields(rfq);
      return Array.isArray(m) ? m : [];
    } catch {
      return [];
    }
  }

  function safeScore(rfq) {
    return safeNum((r) => rfqEngine.scoreRfq(r), rfq);
  }

  function safeFormatMoney(n) {
    try {
      if (typeof rfqEngine.formatMoney === 'function') {
        const s = rfqEngine.formatMoney(n);
        if (typeof s === 'string' && s) return s;
      }
    } catch {
      /* fall through */
    }
    return fmtMoney(n);
  }

  function safeFormatQty(n) {
    try {
      if (typeof rfqEngine.formatQty === 'function') {
        const s = rfqEngine.formatQty(n);
        if (typeof s === 'string' && s) return s;
      }
    } catch {
      /* fall through */
    }
    return fmtInt(n);
  }

  // -- supplier-scout: prospect → contacted after triage-data validation ------
  function runScout() {
    for (const rfq of allRfqs()) {
      if (rfq.status !== 'prospect') continue;
      if (hasValidTriage(rfq)) {
        setStatus(rfq, 'contacted');
        addNote(
          rfq,
          'supplier-scout',
          `Datos de triaje validados (${rfq.ref}: ${safeFormatQty(rfq.quantity)} × ${rfq.product}, ${rfq.originPort} → ${rfq.destinationPort}). Pasando a contacto.`,
          `Triage data validated (${rfq.ref}: ${safeFormatQty(rfq.quantity)} × ${rfq.product}, ${rfq.originPort} → ${rfq.destinationPort}). Moving to contacted.`,
        );
        emit(
          'supplier-scout',
          'triaged',
          `RFQ validado: ${rfq.ref}`,
          `RFQ validated: ${rfq.ref}`,
          rfq.id,
        );
      } else {
        const missing = missingTriageFields(rfq);
        const missingEs = missing.map((m) => m.es).join(', ');
        const missingEn = missing.map((m) => m.en).join(', ');
        addNote(
          rfq,
          'supplier-scout',
          `Faltan datos para el triaje: ${missingEs}. Nada se inventa — agrega estos valores antes de continuar.`,
          `Missing triage data: ${missingEn}. Nothing is invented — add these values before continuing.`,
        );
        emit(
          'supplier-scout',
          'flagged',
          `RFQ sin datos suficientes: ${rfq.id}`,
          `RFQ missing data: ${rfq.id}`,
          rfq.id,
        );
      }
    }
  }

  // -- rfq-researcher: contacted — diligence checklist, never advances --------
  function findLinkedSupplier(rfq) {
    const want = [rfq.supplierId].filter(
      (s) => typeof s === 'string' && s.trim().length > 0,
    );
    if (!want.length) return null;
    const needle = want[0].trim().toLowerCase();
    for (const s of suppliers) {
      if (!s) continue;
      if (typeof s.id === 'string' && s.id.trim().toLowerCase() === needle) {
        return s;
      }
    }
    for (const s of suppliers) {
      if (
        s &&
        typeof s.name === 'string' &&
        s.name.trim().toLowerCase() === needle
      ) {
        return s;
      }
    }
    return null;
  }

  function diligenceChecklist(rfq) {
    const ref = rfq.ref || '(sin referencia)';
    return {
      es:
        `Lista de diligencia de contraparte — ${ref}:\n` +
        '1. Verificar la identidad de la contraparte por contacto directo (esto lo hace Juan, no la fuerza).\n' +
        '2. Solicitar documentos de la empresa: registro mercantil, identificación fiscal, certificado de vigencia.\n' +
        '3. No existe ninguna fuente automática de verificación de sanciones o listas: la verificación es manual.\n' +
        '4. Todo queda como nota en el registro del RFQ — nadie es contactado ni evaluado automáticamente.',
      en:
        `Counterparty diligence checklist — ${ref}:\n` +
        "1. Verify the counterparty's identity by direct contact (this is Juan's job, not the workforce's).\n" +
        '2. Request company documents: business registration, tax ID, certificate of good standing.\n' +
        '3. There is no automatic sanctions-screening data source: verification is manual.\n' +
        '4. Everything stays as a note in the RFQ record — nobody is contacted or screened automatically.',
    };
  }

  function runResearcher() {
    for (const rfq of allRfqs()) {
      if (rfq.status !== 'contacted') continue;
      const checklist = diligenceChecklist(rfq);
      addNote(rfq, 'rfq-researcher', checklist.es, checklist.en);

      const sup = findLinkedSupplier(rfq);
      if (sup && sup.verification === 'flagged') {
        const name = sup.name || '(sin nombre)';
        addNote(
          rfq,
          'rfq-researcher',
          `BANDERA: el proveedor «${name}» está marcado como "flagged". No avanzar — requiere revisión de Juan. Ninguna evaluación automática sustituye su revisión.`,
          `FLAG: supplier "${name}" is marked "flagged". Do not advance — requires Juan's review. No automatic screening replaces his review.`,
        );
        emit(
          'rfq-researcher',
          'flagged',
          `Proveedor marcado: ${name} (${rfq.ref})`,
          `Flagged supplier: ${name} (${rfq.ref})`,
          rfq.id,
        );
      } else {
        emit(
          'rfq-researcher',
          'diligence',
          `Diligencia registrada: ${rfq.ref} (se queda en contactado — Juan decide)`,
          `Diligence logged: ${rfq.ref} (stays in contacted — Juan decides)`,
          rfq.id,
        );
      }
    }
  }

  // -- logistics-analyst: quoting → negotiating on green verdict --------------
  function runAnalyst() {
    for (const rfq of allRfqs()) {
      if (rfq.status !== 'quoting') continue;
      const hasEconomics =
        typeof rfq.quantity === 'number' &&
        rfq.quantity > 0 &&
        typeof rfq.unitCost === 'number' &&
        rfq.unitCost > 0 &&
        typeof rfq.sellUnitPrice === 'number' &&
        rfq.sellUnitPrice > 0;
      if (!hasEconomics) {
        const missing = safeMissingFields(rfq);
        const lines =
          missing.length > 0
            ? missing
                .map((m) => `• ${m.es || m.field || ''} / ${m.en || ''}`)
                .join('\n')
            : '• (motor de verificación no disponible / verification engine unavailable)';
        addNote(
          rfq,
          'logistics-analyst',
          `Faltan campos para el análisis económico:\n${lines}\nAgrega costo unitario, precio de venta y cantidad (> 0) para calcular el memorando.`,
          `Missing fields for the economic analysis:\n${lines}\nAdd unit cost, sell price, and quantity (> 0) to compute the memo.`,
        );
        emit(
          'logistics-analyst',
          'flagged',
          `Faltan precios/cantidad: ${rfq.ref}`,
          `Missing prices/quantity: ${rfq.ref}`,
          rfq.id,
        );
        continue;
      }
      const verdict = safeVerdict(rfq);
      const landed = safeLanded(rfq);
      const marginTotal = safeMarginTotal(rfq);
      const marginPct = safeMarginPct(rfq);
      const commission = safeCommission(rfq);
      const score = safeScore(rfq);
      const tierEs =
        verdict.tier === 'green'
          ? 'VERDE'
          : verdict.tier === 'red'
            ? 'ROJO'
            : 'AMARILLO';
      const tierEn = verdict.tier.toUpperCase();
      const product =
        rfq.product || 'producto sin especificar / unspecified product';
      const memoEs =
        `Memorando de trato — ${rfq.ref} (${product}):\n` +
        `Cantidad: ${safeFormatQty(rfq.quantity)}. Costo landed por unidad: ${safeFormatMoney(landed)}. Precio de venta: ${safeFormatMoney(rfq.sellUnitPrice)}/u.\n` +
        `Margen neto: ${safeFormatMoney(marginTotal)} (${marginPct.toFixed(1)}%). Comisión estimada: ${safeFormatMoney(commission)}. Puntaje: ${score}/100.\n` +
        `Veredicto: ${tierEs}.${verdict.es ? ' ' + verdict.es : ''}\n` +
        (verdict.tier === 'green'
          ? 'Veredicto verde: listo para negociar. Ningún compromiso sin aprobación de Juan.'
          : 'Veredicto no verde: se guarda el memorando y el RFQ se queda en cotización.');
      const memoEn =
        `Deal memo — ${rfq.ref} (${product}):\n` +
        `Quantity: ${safeFormatQty(rfq.quantity)}. Landed cost per unit: ${safeFormatMoney(landed)}. Sell price: ${safeFormatMoney(rfq.sellUnitPrice)}/unit.\n` +
        `Net margin: ${safeFormatMoney(marginTotal)} (${marginPct.toFixed(1)}%). Estimated commission: ${safeFormatMoney(commission)}. Score: ${score}/100.\n` +
        `Verdict: ${tierEn}.${verdict.en ? ' ' + verdict.en : ''}\n` +
        (verdict.tier === 'green'
          ? "Green verdict: ready to negotiate. No commitment without Juan's approval."
          : 'Non-green verdict: memo saved and the RFQ stays in quoting.');
      addNote(rfq, 'logistics-analyst', memoEs, memoEn);
      if (verdict.tier === 'green') {
        setStatus(rfq, 'negotiating');
        emit(
          'logistics-analyst',
          'memo',
          `Memorando escrito (${tierEs}): ${rfq.ref}`,
          `Deal memo written (${tierEn}): ${rfq.ref}`,
          rfq.id,
        );
      } else {
        emit(
          'logistics-analyst',
          'flagged',
          `Veredicto ${tierEs}: ${rfq.ref}`,
          `${tierEn} verdict: ${rfq.ref}`,
          rfq.id,
        );
      }
    }
  }

  // -- deal-coordinator: rank suppliers for negotiating RFQs; contacts nobody
  function supplierFit(supplier) {
    const v = supplier && supplier.verification;
    if (v === 'verified') return 'green';
    if (v === 'flagged') return 'red';
    return 'yellow';
  }

  function runCoordinator() {
    for (const rfq of allRfqs()) {
      if (rfq.status !== 'negotiating') continue;
      const targets = suppliers.filter(
        (s) =>
          s &&
          (s.role === undefined ||
            s.role === null ||
            s.role === '' ||
            s.role === 'supplier' ||
            s.role === 'both'),
      );
      if (targets.length === 0) {
        emit(
          'deal-coordinator',
          'flagged',
          `Sin proveedores cargados para: ${rfq.ref}. Agrega proveedores para comparar.`,
          `No suppliers loaded for: ${rfq.ref}. Add suppliers to compare.`,
          rfq.id,
        );
        continue;
      }
      const ranked = targets.map((supplier) => ({
        supplier,
        fit: supplierFit(supplier),
      }));
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
      const lines = ranked.map(({ supplier, fit }) => {
        const label =
          supplier && supplier.name ? supplier.name : 'Proveedor / Supplier';
        return { label, fit };
      });
      const es =
        `Coincidencia de proveedores — ${rfq.ref}:\n` +
        lines.map((l) => `• ${l.label}: ${fitEs(l.fit)}`).join('\n') +
        '\nNadie ha sido contactado — esto es solo un borrador para revisión.';
      const en =
        `Supplier match — ${rfq.ref}:\n` +
        lines.map((l) => `• ${l.label}: ${fitEn(l.fit)}`).join('\n') +
        '\nNobody has been contacted — this is a draft for review only.';
      addNote(rfq, 'deal-coordinator', es, en);
      emit(
        'deal-coordinator',
        'supplier-match',
        `Proveedores evaluados para ${rfq.ref} (${ranked.filter((r) => r.fit === 'green').length} en verde)`,
        `Suppliers ranked for ${rfq.ref} (${ranked.filter((r) => r.fit === 'green').length} green)`,
        rfq.id,
      );
    }
  }

  const passes = [runScout, runResearcher, runAnalyst, runCoordinator];

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
    return allRfqs().filter((r) => QUEUE_STATUSES.includes(r.status)).length;
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
    setSuppliers(list) {
      suppliers = Array.isArray(list) ? list : [];
    },
    getSuppliers() {
      return [...suppliers];
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
