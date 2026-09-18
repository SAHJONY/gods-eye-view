/**
 * SAHJONY · GOD'S EYE VIEW — Trade follow-up draft queue
 * -----------------------------------------------------------------------
 * localStorage-backed draft queue for deal follow-ups. Key:
 * 'sahjony.trade.followups.v1'. Falls back to in-memory outside a browser.
 *
 * DRAFT-ONLY BY DESIGN: this module has NO send function. There is no
 * `send`, `post`, `publish`, or `dispatch` export — drafts wait in Juan's
 * review queue until HE sends them himself from his own phone. The
 * 'sent' status exists only so Juan can mark (by hand, in the UI) a draft
 * he already sent himself; nothing in code ever transmits anything.
 *
 * Draft shape:
 *   { id, rfqId, rfqRef, kind, channel, es, en, status, flags,
 *     createdAt, updatedAt, approvedAt, sentAt }
 * kinds: 'followup' | 'outreach' | 'pricing' | 'logistics' | 'other'
 * statuses: 'draft' → 'approved' → 'sent' (forward only; Juan may also
 *           archive: 'archived').
 */

export const DRAFTS_KEY = 'sahjony.trade.followups.v1';

export const DRAFT_KINDS = Object.freeze([
  'followup',
  'outreach',
  'pricing',
  'logistics',
  'other',
]);

export const DRAFT_KIND_LABELS = Object.freeze({
  followup: { es: 'Seguimiento', en: 'Follow-up' },
  outreach: { es: 'Contacto', en: 'Outreach' },
  pricing: { es: 'Precios', en: 'Pricing' },
  logistics: { es: 'Logística', en: 'Logistics' },
  other: { es: 'Otro', en: 'Other' },
});

export const DRAFT_STATUSES = Object.freeze([
  'draft',
  'approved',
  'sent',
  'archived',
]);

export const DRAFT_STATUS_LABELS = Object.freeze({
  draft: { es: 'Borrador', en: 'Draft' },
  approved: { es: 'Aprobado', en: 'Approved' },
  sent: { es: 'Enviado (por Juan)', en: 'Sent (by Juan)' },
  archived: { es: 'Archivado', en: 'Archived' },
});

const memoryStorage = (() => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
})();

function storageBackend() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = '__sahjony_followups_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStorage;
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return '';
  }
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const asText = (v) => (typeof v === 'string' ? v.trim() : '');

function coerceKind(kind) {
  return DRAFT_KINDS.includes(kind) ? kind : 'other';
}

function coerceStatus(status) {
  if (typeof status === 'string' && DRAFT_STATUSES.includes(status))
    return status;
  throw new Error(`Unknown follow-up draft status: ${String(status)}`);
}

function normalizeDraft(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    rfqId: asText(data.rfqId),
    rfqRef: asText(data.rfqRef),
    // Missing kind defaults to 'followup' (this module's purpose);
    // an explicitly unknown kind still lands in 'other'.
    kind: data.kind === undefined ? 'followup' : coerceKind(data.kind),
    channel: asText(data.channel) || 'whatsapp',
    es: typeof data.es === 'string' ? data.es : '',
    en: typeof data.en === 'string' ? data.en : '',
    status: data.status ? coerceStatus(data.status) : 'draft',
    flags: Array.isArray(data.flags)
      ? data.flags.filter((f) => f && typeof f === 'object')
      : [],
    createdAt: asText(data.createdAt) || nowIso(),
    updatedAt: asText(data.updatedAt) || nowIso(),
    approvedAt: asText(data.approvedAt),
    sentAt: asText(data.sentAt),
  };
}

const STATUS_FLOW = Object.freeze({
  draft: ['approved', 'archived'],
  approved: ['sent', 'archived'],
  sent: ['archived'],
  archived: [],
});

class FollowupDraftStore {
  constructor() {
    this.backend = storageBackend();
    this.db = this.load();
  }

  load() {
    try {
      const raw = this.backend.getItem(DRAFTS_KEY);
      if (!raw) return { drafts: [] };
      const parsed = JSON.parse(raw);
      return { drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [] };
    } catch {
      return { drafts: [] };
    }
  }

  save() {
    try {
      this.backend.setItem(DRAFTS_KEY, JSON.stringify(this.db));
    } catch {
      /* persistence is best-effort */
    }
  }

  reset() {
    this.db = { drafts: [] };
    this.save();
  }

  createDraft(data = {}) {
    const draft = normalizeDraft(data);
    this.db.drafts.push(draft);
    this.save();
    return draft;
  }

  getDraft(id) {
    return this.db.drafts.find((d) => d.id === id) ?? null;
  }

  listDrafts(filter) {
    const drafts = [...this.db.drafts];
    if (!filter) return drafts;
    if (typeof filter === 'function') return drafts.filter(filter);
    return drafts.filter((d) =>
      Object.entries(filter).every(([key, value]) => d[key] === value),
    );
  }

  /** Drafts still waiting on Juan's review (status 'draft'). */
  pendingDrafts() {
    return this.listDrafts({ status: 'draft' });
  }

  /** Open draft for an RFQ (any non-archived, non-sent draft). */
  openDraftForRfq(rfqId) {
    if (!rfqId) return null;
    return (
      this.db.drafts.find(
        (d) =>
          d.rfqId === rfqId && (d.status === 'draft' || d.status === 'approved'),
      ) ?? null
    );
  }

  updateDraft(id, patch = {}) {
    const draft = this.getDraft(id);
    if (!draft) return null;
    const merged = normalizeDraft({ ...draft, ...patch, id: draft.id });
    merged.createdAt = draft.createdAt;
    merged.updatedAt = nowIso();
    Object.assign(draft, merged);
    this.save();
    return draft;
  }

  /**
   * Move a draft forward in the review flow (draft → approved → sent).
   * 'sent' may ONLY be set by Juan, by hand, after he sends the message
   * himself from his own device — this function records his action, it
   * never transmits anything.
   */
  moveDraft(id, status) {
    const draft = this.getDraft(id);
    if (!draft) return null;
    const next = coerceStatus(status);
    const allowed = STATUS_FLOW[draft.status] || [];
    if (!allowed.includes(next)) {
      throw new Error(
        `Invalid draft transition: ${draft.status} → ${next}`,
      );
    }
    draft.status = next;
    draft.updatedAt = nowIso();
    if (next === 'approved') draft.approvedAt = nowIso();
    if (next === 'sent') draft.sentAt = nowIso();
    this.save();
    return draft;
  }

  deleteDraft(id) {
    const index = this.db.drafts.findIndex((d) => d.id === id);
    if (index < 0) return false;
    this.db.drafts.splice(index, 1);
    this.save();
    return true;
  }

  stats() {
    const counts = {};
    for (const s of DRAFT_STATUSES) counts[s] = 0;
    for (const d of this.db.drafts) {
      if (counts[d.status] !== undefined) counts[d.status] += 1;
    }
    return { total: this.db.drafts.length, byStatus: counts };
  }
}

const store = new FollowupDraftStore();

export const createDraft = (data) => store.createDraft(data);
export const getDraft = (id) => store.getDraft(id);
export const listDrafts = (filter) => store.listDrafts(filter);
export const pendingDrafts = () => store.pendingDrafts();
export const openDraftForRfq = (rfqId) => store.openDraftForRfq(rfqId);
export const updateDraft = (id, patch) => store.updateDraft(id, patch);
export const moveDraft = (id, status) => store.moveDraft(id, status);
export const deleteDraft = (id) => store.deleteDraft(id);
export const draftStats = () => store.stats();

/** Testing / maintenance helper: wipe the draft queue. */
export const resetFollowupDrafts = () => store.reset();

/**
 * Guard: this module must never grow a send/post/publish/dispatch export.
 * (The workforce tests also assert this at the agent level.)
 */
const FORBIDDEN_EXPORTS = Object.freeze([
  'send',
  'sendDraft',
  'post',
  'publish',
  'dispatch',
  'transmit',
]);
export function assertDraftOnly() {
  const leaked = FORBIDDEN_EXPORTS.filter((name) => name in moduleExports());
  if (leaked.length) {
    throw new Error(
      `followupDrafts leaked forbidden exports: ${leaked.join(', ')}`,
    );
  }
  return true;
}
function moduleExports() {
  return {
    createDraft,
    getDraft,
    listDrafts,
    pendingDrafts,
    openDraftForRfq,
    updateDraft,
    moveDraft,
    deleteDraft,
    draftStats,
    resetFollowupDrafts,
    assertDraftOnly,
  };
}
