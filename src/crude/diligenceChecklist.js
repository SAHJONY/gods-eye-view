// Crude counterparty diligence checklist — pure, unit-testable, zero dependencies.
// Bilingual (Spanish/English). No I/O, no DOM, no network.
//
// The desk runs on information, not capital: SAHJONY is a fee-only BROKER and
// never takes title to a cargo. Diligence is how the FIRST cargo gets done
// safely. Nothing here contacts or screens any real counterparty — every
// item is a manual checkbox for Juan.
//
// Sanctions rule (from the workforce core spec): any sanctions red flag →
// auto-escalate. The module NEVER advises on sanctions; it builds an
// escalation payload shaped for the workforce core's escalate() and stops.

/**
 * Workforce-core sanctions gate constant (mirrors the core spec shape):
 * any sanctions/customs/embargo question → escalate-always.
 */
export const SANCTIONS_HARD_STOP = Object.freeze({
  gate: 'sanctions',
  action: 'escalate-always',
});

/** Diligence categories. */
export const DILIGENCE_CATEGORIES = Object.freeze([
  'identity',
  'registry',
  'references',
  'sanctions',
]);

export const CATEGORY_LABELS = Object.freeze({
  identity: { es: 'Identidad', en: 'Identity' },
  registry: { es: 'Registro mercantil', en: 'Corporate registry' },
  references: { es: 'Referencias comerciales', en: 'Trade references' },
  sanctions: { es: 'Sanciones', en: 'Sanctions' },
});

/**
 * Checklist items. kind:
 *  - 'check': manual verification checkbox (done = verified)
 *  - 'ref': free-text registry reference (done = non-empty ref)
 *  - 'redflag': red-flag observation — flagged = OBSERVED → auto-escalate
 */
export const DILIGENCE_ITEMS = Object.freeze([
  {
    id: 'identity-direct-contact',
    category: 'identity',
    kind: 'check',
    es: 'Identidad confirmada por contacto directo (teléfono/videollamada)',
    en: 'Identity confirmed by direct contact (phone/video call)',
  },
  {
    id: 'identity-contact-record',
    category: 'identity',
    kind: 'check',
    es: 'Nombre, teléfono y correo del contacto registrados',
    en: 'Contact name, phone and email recorded',
  },
  {
    id: 'registry-document',
    category: 'registry',
    kind: 'check',
    es: 'Documento de registro mercantil recibido',
    en: 'Business registration document received',
  },
  {
    id: 'registry-number',
    category: 'registry',
    kind: 'ref',
    es: 'Número/referencia de registro mercantil registrada',
    en: 'Registry number/reference recorded',
  },
  {
    id: 'registry-tax-id',
    category: 'registry',
    kind: 'check',
    es: 'Identificación fiscal de la empresa recibida',
    en: 'Company tax ID received',
  },
  {
    id: 'ref-trade-1',
    category: 'references',
    kind: 'check',
    es: 'Referencia comercial verificable #1 contactada',
    en: 'Verifiable trade reference #1 contacted',
  },
  {
    id: 'ref-trade-2',
    category: 'references',
    kind: 'check',
    es: 'Referencia comercial verificable #2 contactada',
    en: 'Verifiable trade reference #2 contacted',
  },
  {
    id: 'sanctions-self-declare',
    category: 'sanctions',
    kind: 'check',
    es: 'La contraparte declaró por escrito que no está sujeta a sanciones',
    en: 'Counterparty declared in writing it is not subject to sanctions',
  },
  {
    id: 'sanctions-redflag',
    category: 'sanctions',
    kind: 'redflag',
    es: 'BANDERA ROJA: indicios de riesgo de sanciones (origen, destino, entidad, intermediarios)',
    en: 'RED FLAG: sanctions-risk indicators (origin, destination, entity, intermediaries)',
  },
]);

export const DILIGENCE_STATUS = Object.freeze(['clear', 'pending', 'escalate']);

export const DILIGENCE_STATUS_LABELS = Object.freeze({
  clear: { es: 'Diligencia completa', en: 'Diligence clear' },
  pending: { es: 'Diligencia pendiente', en: 'Diligence pending' },
  escalate: { es: 'ESCALADO — revisar sanciones', en: 'ESCALATED — review sanctions' },
});

/**
 * Fresh checklist state: { [itemId]: { status: 'open'|'done'|'flagged', ref, note } }
 * 'flagged' only applies to redflag items. Serializable for store persistence.
 */
export function blankChecklist() {
  const state = {};
  for (const item of DILIGENCE_ITEMS) {
    state[item.id] = { status: 'open', ref: '', note: '' };
  }
  return state;
}

/** Defensive accessor: returns a normalized {status, ref, note} for an item. */
export function itemState(checklist, itemId) {
  const raw =
    checklist && typeof checklist === 'object' ? checklist[itemId] : null;
  const status =
    raw && ['open', 'done', 'flagged'].includes(raw.status)
      ? raw.status
      : 'open';
  return {
    status,
    ref: typeof raw?.ref === 'string' ? raw.ref : '',
    note: typeof raw?.note === 'string' ? raw.note : '',
  };
}

/** Which items count toward the diligence score (all but redflag kind). */
export function scorableItems() {
  return DILIGENCE_ITEMS.filter((item) => item.kind !== 'redflag');
}

/**
 * Score the checklist 0..100: done scorable items / total scorable items.
 * A 'ref'-kind item counts as done when its ref text is non-empty.
 * Never throws on bad input — missing data scores 0.
 */
export function scoreDiligence(checklist) {
  const items = scorableItems();
  if (!items.length) return 0;
  let done = 0;
  for (const item of items) {
    const st = itemState(checklist, item.id);
    if (st.status === 'done') done += 1;
    else if (
      item.kind === 'ref' &&
      st.status !== 'flagged' &&
      st.ref.trim().length > 0
    ) {
      done += 1;
    }
  }
  return Math.round((done / items.length) * 100);
}

/** Items currently flagged (red-flag observations). */
export function flaggedItems(checklist) {
  return DILIGENCE_ITEMS.filter(
    (item) => itemState(checklist, item.id).status === 'flagged',
  ).map((item) => item.id);
}

/** True when any sanctions-category item is flagged → hard stop. */
export function hasSanctionsFlag(checklist) {
  return DILIGENCE_ITEMS.some(
    (item) =>
      item.category === 'sanctions' &&
      itemState(checklist, item.id).status === 'flagged',
  );
}

/**
 * Diligence status for a counterparty:
 * - 'escalate': any sanctions red flag (auto-escalate, never advisory)
 * - 'clear': score is 100
 * - 'pending': otherwise
 */
export function diligenceStatus(checklist) {
  if (hasSanctionsFlag(checklist)) return 'escalate';
  return scoreDiligence(checklist) >= 100 ? 'clear' : 'pending';
}

/**
 * Full evaluation: { score, status, sanctionsStop, flagged }.
 * sanctionsStop mirrors SANCTIONS_HARD_STOP with context attached.
 */
export function evaluateDiligence(checklist) {
  const sanctionsStop = hasSanctionsFlag(checklist);
  return {
    score: scoreDiligence(checklist),
    status: diligenceStatus(checklist),
    flagged: flaggedItems(checklist),
    sanctionsStop,
    gate: sanctionsStop ? { ...SANCTIONS_HARD_STOP } : null,
  };
}

/** ISO timestamp with America/Chicago offset. */
function chicagoIso(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Build the sanctions escalation payload in the workforce-core shape:
 * { ts, module, reason, payload, status: 'awaiting-juan' }.
 * The module never advises — it escalates and waits for Juan.
 */
export function buildSanctionsEscalation(counterparty = {}, checklist = {}) {
  const flagged = flaggedItems(checklist);
  return {
    ts: chicagoIso(),
    module: 'crude',
    reason: 'sanctions',
    gate: { ...SANCTIONS_HARD_STOP },
    payload: {
      counterpartyId: counterparty.id ?? null,
      counterpartyName: counterparty.name ?? '',
      counterpartyCountry: counterparty.country ?? '',
      flaggedItems: flagged,
      diligenceScore: scoreDiligence(checklist),
    },
    status: 'awaiting-juan',
  };
}

/** Bilingual hard-stop banner copy (never advisory, always escalate). */
export const SANCTIONS_BANNER = Object.freeze({
  es: 'PARADA DE SANCIONES: se detectó una bandera roja. Nada se negocia, nada se firma, nada se envía — esto va directo a Juan.',
  en: 'SANCTIONS HARD STOP: a red flag was observed. Nothing negotiated, nothing signed, nothing sent — this goes straight to Juan.',
});
