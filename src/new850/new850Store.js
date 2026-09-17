// New850 credit-repair case pipeline store — localStorage persistence,
// guarded for non-browser.
// Key: 'sahjony.new850.v1'. Falls back to in-memory storage outside a browser.
//
// DRAFT-ONLY BY DESIGN: every dispute letter, furnisher letter, CFPB
// complaint and customer message stays in `drafts[]` with
// status 'awaiting-approval'. This module exposes NO send/submit/transmit
// path — there is deliberately no way to send anything from here. Juan
// approves the exact item; the actual sending happens outside this module.
//
// PII RULES: masked PII only. Phones are stored/shown as ***4567. No real
// names, no SSNs — SSN-like values are redacted from free text and SSN
// columns are dropped on import. No cesium, no network, no API keys.

export const STORAGE_KEY = 'sahjony.new850.v1';
export const LANG_KEY = 'sahjony.gev.lang';

export const STAGES = Object.freeze([
  'intake',
  'round-1',
  'round-1-wait',
  'round-2',
  'round-2-wait',
  'round-3',
  'round-3-wait',
  'escalation-draft',
  'complete',
  'dormant',
  'closed',
]);

export const STAGE_LABELS = Object.freeze({
  intake: { es: 'Ingreso', en: 'Intake' },
  'round-1': { es: 'Ronda 1', en: 'Round 1' },
  'round-1-wait': { es: 'R1 · En espera', en: 'R1 · Waiting' },
  'round-2': { es: 'Ronda 2', en: 'Round 2' },
  'round-2-wait': { es: 'R2 · En espera', en: 'R2 · Waiting' },
  'round-3': { es: 'Ronda 3', en: 'Round 3' },
  'round-3-wait': { es: 'R3 · En espera', en: 'R3 · Waiting' },
  'escalation-draft': { es: 'Borrador CFPB', en: 'CFPB draft' },
  complete: { es: 'Completado', en: 'Complete' },
  dormant: { es: 'Inactivo', en: 'Dormant' },
  closed: { es: 'Cerrado', en: 'Closed' },
});

export const BUREAUS = Object.freeze(['equifax', 'experian', 'transunion']);

export const BUREAU_LABELS = Object.freeze({
  equifax: 'Equifax',
  experian: 'Experian',
  transunion: 'TransUnion',
});

export const DISPUTE_STATUSES = Object.freeze([
  'draft',
  'awaiting-approval',
  'sent',
  'under-investigation',
  'verified',
  'updated',
  'deleted',
  'no-response',
]);

export const DISPUTE_STATUS_LABELS = Object.freeze({
  draft: { es: 'Borrador', en: 'Draft' },
  'awaiting-approval': { es: 'Esperando aprobación', en: 'Awaiting approval' },
  sent: { es: 'Enviado', en: 'Sent' },
  'under-investigation': { es: 'En investigación', en: 'Under investigation' },
  verified: { es: 'Verificado', en: 'Verified' },
  updated: { es: 'Actualizado', en: 'Updated' },
  deleted: { es: 'Eliminado', en: 'Deleted' },
  'no-response': { es: 'Sin respuesta', en: 'No response' },
});

export const DRAFT_KINDS = Object.freeze([
  'dispute-letter',
  'furnisher-letter',
  'cfpb-complaint',
  'customer-message',
]);

export const DRAFT_KIND_LABELS = Object.freeze({
  'dispute-letter': { es: 'Carta de disputa', en: 'Dispute letter' },
  'furnisher-letter': { es: 'Carta al acreedor', en: 'Furnisher letter' },
  'cfpb-complaint': { es: 'Queja CFPB', en: 'CFPB complaint' },
  'customer-message': { es: 'Mensaje al cliente', en: 'Customer message' },
});

/** Drafts that still need Juan's explicit approval on the exact item. */
export const AWAITING_APPROVAL = 'awaiting-approval';

// Dispute outcomes that count as "unresolved" and may continue to a next round.
export const UNRESOLVED_DISPUTE_STATUSES = Object.freeze([
  'verified',
  'updated',
  'no-response',
  'under-investigation',
]);

const memoryStorage = (() => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.setItem(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
})();

function storageBackend() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = '__sahjony_new850_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStorage;
}

/** ISO timestamp with America/Chicago offset. */
export function chicagoIso(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  const local = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  const utcMs = d.getTime();
  const chicagoWall = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  );
  const offsetMin = Math.round((chicagoWall - utcMs) / 60000);
  const sign = offsetMin <= 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local}${sign}${hh}:${mm}`;
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mask a phone number to ***4567. Only the last 4 digits survive.
 * Anything with fewer than 4 digits → '***'.
 */
export function maskPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

/**
 * Redact SSN-like sequences from free text: 123-45-6789, 123 45 6789,
 * 123456789. Returns the text with matches replaced by '[REDACTED]'.
 * SSNs are NEVER stored or displayed by this module.
 */
export function redactSsn(text) {
  return String(text ?? '').replace(
    /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    '[REDACTED]',
  );
}

/** True when the text contains something shaped like a US SSN. */
export function containsSsnLike(text) {
  return /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/.test(String(text ?? ''));
}

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

function coerceStage(stage) {
  if (typeof stage === 'string' && STAGES.includes(stage)) return stage;
  throw new Error(`Unknown New850 case stage: ${String(stage)}`);
}

function coerceBureaus(bureaus) {
  if (!Array.isArray(bureaus)) return [];
  const out = [];
  for (const b of bureaus) {
    const s = String(b ?? '').toLowerCase().trim();
    if (BUREAUS.includes(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

function coerceDisputeStatus(status) {
  return DISPUTE_STATUSES.includes(status) ? status : 'draft';
}

function coerceDraftKind(kind) {
  return DRAFT_KINDS.includes(kind) ? kind : 'dispute-letter';
}

function normalizeDispute(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    item: redactSsn(asText(data.item)),
    creditor: redactSsn(asText(data.creditor)),
    bureaus: coerceBureaus(data.bureaus),
    status: coerceDisputeStatus(data.status),
    round: [1, 2, 3].includes(Number(data.round)) ? Number(data.round) : 1,
    evidence: redactSsn(asText(data.evidence)),
    identityTheftAttested: data.identityTheftAttested === true,
    isAccurate: data.isAccurate === true,
    notes: redactSsn(typeof data.notes === 'string' ? data.notes : ''),
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

function normalizeDraft(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    kind: coerceDraftKind(data.kind),
    target: asText(data.target),
    text: typeof data.text === 'string' ? data.text : '',
    status: data.status === AWAITING_APPROVAL ? AWAITING_APPROVAL : 'draft',
    relatedDisputeId: asText(data.relatedDisputeId),
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

function normalizeRound(data = {}) {
  const round = [1, 2, 3].includes(Number(data.round))
    ? Number(data.round)
    : 1;
  return {
    round,
    startedAt: asText(data.startedAt),
    deadlineAt: asText(data.deadlineAt),
    windowDays: data.windowDays === 45 ? 45 : 30,
    status: ['draft', AWAITING_APPROVAL, 'active', 'closed'].includes(
      data.status,
    )
      ? data.status
      : 'draft',
  };
}

function normalizeCase(data = {}, seq) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    ref: asText(data.ref) || (seq != null ? `N850-${String(seq).padStart(4, '0')}` : ''),
    // Opaque owner-chosen label (e.g. "Cliente ***4567") — never a real name.
    clientLabel: redactSsn(asText(data.clientLabel)),
    // Masked only: "***4567". The full number is never stored.
    phoneMasked: maskPhone(data.phone ?? data.phoneMasked ?? ''),
    stage: data.stage ? coerceStage(data.stage) : 'intake',
    bureaus: coerceBureaus(data.bureaus),
    disputes: Array.isArray(data.disputes)
      ? data.disputes.map((d) => normalizeDispute(d))
      : [],
    rounds: Array.isArray(data.rounds)
      ? data.rounds.map((r) => normalizeRound(r))
      : [],
    drafts: Array.isArray(data.drafts)
      ? data.drafts.map((d) => normalizeDraft(d))
      : [],
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...n }))
      : [],
    demo: data.demo === true,
    intakeDraft: data.intakeDraft !== false,
    notes: redactSsn(typeof data.notes === 'string' ? data.notes : ''),
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

export class New850CaseStore {
  constructor() {
    this.backend = storageBackend();
    this.db = this.load();
  }

  load() {
    try {
      const raw = this.backend.getItem(STORAGE_KEY);
      if (!raw) return { cases: [], seq: 0 };
      const parsed = JSON.parse(raw);
      return {
        cases: Array.isArray(parsed.cases) ? parsed.cases : [],
        seq: Number.isFinite(Number(parsed.seq)) ? Number(parsed.seq) : 0,
      };
    } catch {
      return { cases: [], seq: 0 };
    }
  }

  save() {
    try {
      this.backend.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* persistence is best-effort */
    }
  }

  /** Clear all cases (used by tests). */
  reset() {
    this.db = { cases: [], seq: 0 };
    this.save();
  }

  createCase(data = {}) {
    this.db.seq += 1;
    const c = normalizeCase(data, this.db.seq);
    if (!c.ref) c.ref = `N850-${String(this.db.seq).padStart(4, '0')}`;
    if (!c.clientLabel) c.clientLabel = `${c.ref}`;
    this.db.cases.push(c);
    this.save();
    return c;
  }

  getCase(id) {
    return this.db.cases.find((c) => c.id === id) ?? null;
  }

  getCaseByRef(ref) {
    const r = asText(ref).toLowerCase();
    return this.db.cases.find((c) => c.ref.toLowerCase() === r) ?? null;
  }

  updateCase(id, patch = {}) {
    const c = this.getCase(id);
    if (!c) return null;
    const merged = normalizeCase({ ...c, ...patch, id: c.id }, this.db.seq);
    merged.ref = c.ref;
    merged.createdAt = c.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(c, merged);
    this.save();
    return c;
  }

  moveCase(id, stage) {
    const c = this.getCase(id);
    if (!c) return null;
    c.stage = coerceStage(stage);
    c.updatedAt = chicagoIso();
    this.save();
    return c;
  }

  deleteCase(id) {
    const index = this.db.cases.findIndex((c) => c.id === id);
    if (index < 0) return false;
    this.db.cases.splice(index, 1);
    this.save();
    return true;
  }

  listCases(filter) {
    const cases = [...this.db.cases];
    if (!filter) return cases;
    if (typeof filter === 'function') return cases.filter(filter);
    return cases.filter((c) =>
      Object.entries(filter).every(([key, value]) => c[key] === value),
    );
  }

  // ---- Disputes ----
  addDispute(caseId, data = {}) {
    const c = this.getCase(caseId);
    if (!c) return null;
    const dispute = normalizeDispute(data);
    c.disputes.push(dispute);
    c.updatedAt = chicagoIso();
    this.save();
    return dispute;
  }

  getDispute(caseId, disputeId) {
    const c = this.getCase(caseId);
    if (!c) return null;
    return c.disputes.find((d) => d.id === disputeId) ?? null;
  }

  updateDispute(caseId, disputeId, patch = {}) {
    const c = this.getCase(caseId);
    if (!c) return null;
    const d = this.getDispute(caseId, disputeId);
    if (!d) return null;
    const merged = normalizeDispute({ ...d, ...patch, id: d.id });
    merged.createdAt = d.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(d, merged);
    c.updatedAt = chicagoIso();
    this.save();
    return d;
  }

  deleteDispute(caseId, disputeId) {
    const c = this.getCase(caseId);
    if (!c) return false;
    const index = c.disputes.findIndex((d) => d.id === disputeId);
    if (index < 0) return false;
    c.disputes.splice(index, 1);
    c.updatedAt = chicagoIso();
    this.save();
    return true;
  }

  // ---- Rounds ----
  setRound(caseId, data = {}) {
    const c = this.getCase(caseId);
    if (!c) return null;
    const round = normalizeRound(data);
    const index = c.rounds.findIndex((r) => r.round === round.round);
    if (index >= 0) c.rounds[index] = round;
    else c.rounds.push(round);
    c.updatedAt = chicagoIso();
    this.save();
    return round;
  }

  getRound(caseId, round) {
    const c = this.getCase(caseId);
    if (!c) return null;
    return c.rounds.find((r) => r.round === round) ?? null;
  }

  // ---- Drafts (awaiting owner approval — never sent) ----
  addDraft(caseId, data = {}) {
    const c = this.getCase(caseId);
    if (!c) return null;
    const draft = normalizeDraft({ ...data, status: AWAITING_APPROVAL });
    c.drafts.push(draft);
    c.updatedAt = chicagoIso();
    this.save();
    return draft;
  }

  getDraft(caseId, draftId) {
    const c = this.getCase(caseId);
    if (!c) return null;
    return c.drafts.find((d) => d.id === draftId) ?? null;
  }

  updateDraft(caseId, draftId, patch = {}) {
    const c = this.getCase(caseId);
    if (!c) return null;
    const d = this.getDraft(caseId, draftId);
    if (!d) return null;
    const merged = normalizeDraft({ ...d, ...patch, id: d.id });
    merged.createdAt = d.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(d, merged);
    c.updatedAt = chicagoIso();
    this.save();
    return d;
  }

  deleteDraft(caseId, draftId) {
    const c = this.getCase(caseId);
    if (!c) return false;
    const index = c.drafts.findIndex((d) => d.id === draftId);
    if (index < 0) return false;
    c.drafts.splice(index, 1);
    c.updatedAt = chicagoIso();
    this.save();
    return true;
  }

  /** Every draft across cases that is still awaiting Juan's approval. */
  listPendingDrafts() {
    const out = [];
    for (const c of this.db.cases) {
      for (const d of c.drafts || []) {
        if (d.status === AWAITING_APPROVAL) {
          out.push({ caseId: c.id, caseRef: c.ref, draft: d });
        }
      }
    }
    return out;
  }

  // ---- Notes ----
  addNote(caseId, agent, es, en) {
    const c = this.getCase(caseId);
    if (!c) return null;
    const note = {
      agent: typeof agent === 'string' ? agent : '',
      es: redactSsn(typeof es === 'string' ? es : ''),
      en: redactSsn(typeof en === 'string' ? en : ''),
      at: chicagoIso(),
    };
    c.agentNotes.push(note);
    c.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  stats() {
    const cases = this.db.cases;
    const byStage = {};
    for (const stage of STAGES) byStage[stage] = 0;
    let openCases = 0;
    let pendingDrafts = 0;
    for (const c of cases) {
      const stage = STAGES.includes(c.stage) ? c.stage : 'intake';
      byStage[stage] += 1;
      if (stage !== 'complete' && stage !== 'closed') openCases += 1;
      for (const d of c.drafts || []) {
        if (d.status === AWAITING_APPROVAL) pendingDrafts += 1;
      }
    }
    return {
      totalCases: cases.length,
      openCases,
      byStage,
      pendingDrafts,
      demoCases: cases.filter((c) => c.demo).length,
    };
  }
}

const store = new New850CaseStore();

/** Factory for tests and host apps that want their own instance. */
export const createNew850Store = () => new New850CaseStore();

export const createCase = (data) => store.createCase(data);
export const getCase = (id) => store.getCase(id);
export const getCaseByRef = (ref) => store.getCaseByRef(ref);
export const updateCase = (id, patch) => store.updateCase(id, patch);
export const moveCase = (id, stage) => store.moveCase(id, stage);
export const deleteCase = (id) => store.deleteCase(id);
export const listCases = (filter) => store.listCases(filter);
export const addDispute = (caseId, data) => store.addDispute(caseId, data);
export const getDispute = (caseId, disputeId) =>
  store.getDispute(caseId, disputeId);
export const updateDispute = (caseId, disputeId, patch) =>
  store.updateDispute(caseId, disputeId, patch);
export const deleteDispute = (caseId, disputeId) =>
  store.deleteDispute(caseId, disputeId);
export const setRound = (caseId, data) => store.setRound(caseId, data);
export const getRound = (caseId, round) => store.getRound(caseId, round);
export const addDraft = (caseId, data) => store.addDraft(caseId, data);
export const getDraft = (caseId, draftId) => store.getDraft(caseId, draftId);
export const updateDraft = (caseId, draftId, patch) =>
  store.updateDraft(caseId, draftId, patch);
export const deleteDraft = (caseId, draftId) =>
  store.deleteDraft(caseId, draftId);
export const listPendingDrafts = () => store.listPendingDrafts();
export const addNote = (caseId, agent, es, en) =>
  store.addNote(caseId, agent, es, en);
export const caseStats = () => store.stats();

/** Testing / maintenance helper: wipe the store. */
export const resetNew850Store = () => store.reset();

/** Exposed for tests: force reload from the storage backend. */
export const reloadNew850Store = () => {
  store.db = store.load();
  return store.db;
};
