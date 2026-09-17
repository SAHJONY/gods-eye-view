/**
 * New850 — Approval queue store (GOD'S EYE VIEW plugin).
 * ---------------------------------------------------------------------------
 * VENDORED STAND-IN for the shared `src/approvals/` module (built by a
 * sibling agent). This file implements the shared contract EXACTLY so the
 * New850 station UI can build against it now:
 *
 *   localStorage key: 'sahjony.gev.approvals.v1'
 *   item: { id, businessId, kind, titleEs, titleEn, summaryEs, summaryEn,
 *           payload, createdAt, status: 'pending'|'approved'|'rejected',
 *           decidedAt, note }
 *   (+ additive single-operator field `decidedBy: 'juan'` on decided items;
 *     the shared contract is unchanged)
 *   API: createApproval(businessId, draft), listApprovals(businessId, status),
 *        getApproval(id), approveApproval(id, note), rejectApproval(id, note),
 *        append-only audit log.
 *
 * When `src/approvals/` merges, this file should delegate to (or be replaced
 * by) the shared module. The storage key and item shape are identical, so the
 * data migrates with zero changes.
 *
 * CRITICAL SAFETY SEMANTIC (never change without Juan's explicit approval):
 *   approveApproval() / rejectApproval() record the approval DECISION only.
 *   They NEVER execute any external act — no sending of disputes, letters, or
 *   messages. There is no send/submit/transmit path in this module by design.
 *   Approval/rejection is TAP-ONLY in the UI (never by voice).
 *
 * SINGLE-OPERATOR DESIGN: Juan runs everything alone — no staff, no team
 * roles, no delegation. The audit log records him ('juan', owner) as the
 * single decider on every decision.
 *
 * Client-side only. $0. No API keys. No external network calls.
 * No invented data: the queue starts empty.
 */

export const APPROVALS_KEY = 'sahjony.gev.approvals.v1';
export const APPROVAL_STATUSES = Object.freeze([
  'pending',
  'approved',
  'rejected',
]);

// Approval kinds used by the New850 station.
export const NEW850_APPROVAL_KINDS = Object.freeze([
  'dispute-letter-r1',
  'dispute-letter-r2',
  'dispute-letter-r3',
  'furnisher-letter',
  'cfpb-complaint',
  'customer-message',
]);

export const NEW850_APPROVAL_KIND_LABELS = Object.freeze({
  'dispute-letter-r1': { es: 'Carta de disputa — R1', en: 'Dispute letter — R1' },
  'dispute-letter-r2': { es: 'Carta de disputa — R2', en: 'Dispute letter — R2' },
  'dispute-letter-r3': { es: 'Carta de disputa — R3', en: 'Dispute letter — R3' },
  'furnisher-letter': { es: 'Carta al acreedor', en: 'Furnisher letter' },
  'cfpb-complaint': { es: 'Queja CFPB (borrador)', en: 'CFPB complaint (draft)' },
  'customer-message': { es: 'Mensaje al cliente', en: 'Customer message' },
});

const AUDIT_CAP = 500;

function chicagoIso(date = new Date()) {
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
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const offsetMin = -new Date(
    date.toLocaleString('en-US', { timeZone: 'America/Chicago' }),
  ).getTimezoneOffset();
  // Chicago is UTC-6 (CST) or UTC-5 (CDT).
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

function storageBackend() {
  try {
    if (typeof localStorage !== 'undefined') {
      return {
        getItem: (k) => localStorage.getItem(k),
        setItem: (k, v) => localStorage.setItem(k, String(v)),
      };
    }
  } catch {
    /* fall through to memory */
  }
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

const asText = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function makeId() {
  return `appr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDraft(draft = {}) {
  return {
    kind: asText(draft.kind) || 'customer-message',
    titleEs: asText(draft.titleEs),
    titleEn: asText(draft.titleEn),
    summaryEs: asText(draft.summaryEs),
    summaryEn: asText(draft.summaryEn),
    payload:
      draft.payload && typeof draft.payload === 'object'
        ? draft.payload
        : {},
  };
}

export class ApprovalStore {
  constructor(key = APPROVALS_KEY) {
    this.key = key;
    this.backend = storageBackend();
    this.db = this.load();
  }

  load() {
    try {
      const raw = this.backend.getItem(this.key);
      if (!raw) return { items: [], audit: [] };
      const parsed = JSON.parse(raw);
      return {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      };
    } catch {
      return { items: [], audit: [] };
    }
  }

  save() {
    try {
      this.backend.setItem(this.key, JSON.stringify(this.db));
    } catch {
      /* memory-only */
    }
  }

  reset() {
    this.db = { items: [], audit: [] };
    this.save();
  }

  _audit(action, item, note = '') {
    const event = {
      t: chicagoIso(),
      action, // 'created' | 'approved' | 'rejected'
      approvalId: item.id,
      businessId: item.businessId,
      kind: item.kind,
      note: asText(note),
      // Single-operator: Juan (owner) is the only decider, always.
      decidedBy: 'juan',
    };
    this.db.audit.push(event);
    if (this.db.audit.length > AUDIT_CAP) {
      this.db.audit = this.db.audit.slice(-AUDIT_CAP);
    }
    return event;
  }

  /**
   * createApproval(businessId, draft) — queues a draft for Juan's decision.
   * draft: { kind, titleEs, titleEn, summaryEs, summaryEn, payload }.
   * Status starts as 'pending'. This never executes anything.
   */
  createApproval(businessId, draft = {}) {
    const d = normalizeDraft(draft);
    const item = {
      id: makeId(),
      businessId: asText(businessId),
      kind: d.kind,
      titleEs: d.titleEs,
      titleEn: d.titleEn,
      summaryEs: d.summaryEs,
      summaryEn: d.summaryEn,
      payload: d.payload,
      createdAt: chicagoIso(),
      status: 'pending',
      decidedAt: null,
      note: '',
      decidedBy: null, // set to 'juan' (owner, single decider) on decision
    };
    this.db.items.push(item);
    this._audit('created', item);
    this.save();
    return item;
  }

  /** listApprovals(businessId, status?) — status optional; newest first. */
  listApprovals(businessId, status) {
    const bid = asText(businessId);
    return this.db.items
      .filter(
        (i) =>
          i.businessId === bid &&
          (status == null || status === '' || i.status === status),
      )
      .slice()
      .reverse();
  }

  getApproval(id) {
    return this.db.items.find((i) => i.id === id) ?? null;
  }

  _decide(id, decision, note) {
    const item = this.getApproval(id);
    if (!item) return null;
    if (item.status !== 'pending') return item; // idempotent: decided stays decided
    item.status = decision;
    item.decidedAt = chicagoIso();
    item.note = asText(note);
    item.decidedBy = 'juan'; // single-operator: Juan (owner) is the only decider
    this._audit(decision, item, note);
    this.save();
    // SAFETY: the decision is recorded here and NOTHING ELSE happens.
    // No external act is triggered — there is no send path in this module.
    return item;
  }

  /**
   * approveApproval(id, note) — records Juan's approval decision ONLY.
   * Does not send, submit, or execute anything. TAP-ONLY in the UI.
   */
  approveApproval(id, note = '') {
    return this._decide(id, 'approved', note);
  }

  /**
   * rejectApproval(id, note) — records Juan's rejection decision ONLY.
   * Does not send, submit, or execute anything. TAP-ONLY in the UI.
   */
  rejectApproval(id, note = '') {
    return this._decide(id, 'rejected', note);
  }

  /** Append-only audit log (newest last). */
  getAuditLog() {
    return this.db.audit.slice();
  }

  stats(businessId) {
    const all = this.listApprovals(businessId);
    return {
      total: all.length,
      pending: all.filter((i) => i.status === 'pending').length,
      approved: all.filter((i) => i.status === 'approved').length,
      rejected: all.filter((i) => i.status === 'rejected').length,
    };
  }
}

export const createApprovalStore = (key) => new ApprovalStore(key);
