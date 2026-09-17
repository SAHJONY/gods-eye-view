/**
 * Approval queue engine — validation, ordering, and stats for the shared
 * God's Eye View approval queue (management-console scope).
 *
 * This module knows the queue CONTRACT (business ids, item shape, ordering
 * rules). It never touches storage, never touches the DOM, and never
 * executes a draft payload.
 *
 * CRITICAL SAFETY SEMANTIC: approving an item records the approval decision
 * and an audit entry ONLY. It must not send, post, publish, or trigger any
 * external act. Execution of approved items happens exclusively through
 * Juan's existing gated paths outside this app.
 */

export const BUSINESS_IDS = Object.freeze([
  'wholesale',
  'crude',
  'trade',
  'cubacash',
  'carsales',
  'new850',
  'insurance',
]);

export const BUSINESS_NAMES = Object.freeze({
  wholesale: { es: 'Wholesale', en: 'Wholesale' },
  crude: { es: 'Crudo', en: 'Crude oil' },
  trade: { es: 'Import/Export', en: 'Import/Export' },
  cubacash: { es: 'MY CUBA CASH', en: 'MY CUBA CASH' },
  carsales: { es: 'Venta de autos', en: 'Car sales' },
  new850: { es: 'New850', en: 'New850' },
  insurance: { es: 'Seguros', en: 'Insurance' },
});

export const APPROVAL_STATUSES = Object.freeze([
  'pending',
  'approved',
  'rejected',
]);

/**
 * Suggested draft kinds (dispute letters, customer replies, listings, posts,
 * outreach, offers, documents, generic drafts). `kind` validation accepts any
 * non-empty string; this list keeps producers consistent.
 */
export const APPROVAL_KINDS = Object.freeze([
  'dispute',
  'reply',
  'listing',
  'post',
  'outreach',
  'offer',
  'document',
  'draft',
]);

export class ApprovalError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
    this.details = details;
  }
}

/** Throw unless `businessId` is one of the known business namespaces. */
export function validateBusinessId(businessId) {
  if (!BUSINESS_IDS.includes(businessId)) {
    throw new ApprovalError(
      'UNKNOWN_BUSINESS',
      `Unknown businessId: ${String(businessId)}. Expected one of: ${BUSINESS_IDS.join(', ')}`,
      { businessId },
    );
  }
  return businessId;
}

export function isKnownBusinessId(businessId) {
  return BUSINESS_IDS.includes(businessId);
}

function requiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new ApprovalError(
      'MISSING_FIELD',
      `Approval draft is missing required field: ${field}`,
      { field },
    );
  }
  return text;
}

/**
 * Validate a draft for createApproval(businessId, draft).
 * Required: kind, titleEs, titleEn, summaryEs, summaryEn. Payload is opaque —
 * any value (object, string, null) and is NEVER executed by this module.
 * Returns a normalized copy.
 */
export function validateApprovalDraft(businessId, draft) {
  validateBusinessId(businessId);
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new ApprovalError(
      'INVALID_DRAFT',
      'Approval draft must be an object',
      {
        draft,
      },
    );
  }
  return {
    kind: requiredText(draft.kind, 'kind'),
    titleEs: requiredText(draft.titleEs, 'titleEs'),
    titleEn: requiredText(draft.titleEn, 'titleEn'),
    summaryEs: requiredText(draft.summaryEs, 'summaryEs'),
    summaryEn: requiredText(draft.summaryEn, 'summaryEn'),
    payload: 'payload' in draft ? draft.payload : null,
  };
}

/** Pending queues are FIFO (oldest first); decided items newest-decision first. */
export function orderQueue(items, status = 'pending') {
  const list = [...items];
  if (status === 'pending') {
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  } else {
    list.sort((a, b) =>
      String(b.decidedAt || '').localeCompare(String(a.decidedAt || '')),
    );
  }
  return list;
}

/** { pending, approved, rejected, total } for one business's items. */
export function computeStats(items) {
  const stats = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const item of items) {
    stats.total += 1;
    if (item.status === 'pending') stats.pending += 1;
    else if (item.status === 'approved') stats.approved += 1;
    else if (item.status === 'rejected') stats.rejected += 1;
  }
  return stats;
}

/**
 * Spoken summary for the voice "list pending approvals" intent.
 * Returns { es, en } — never includes payload data.
 */
export function summarizeForVoice(businessId, pendingItems) {
  const count = pendingItems.length;
  if (businessId == null) {
    return {
      es:
        count === 0
          ? 'No tienes nada pendiente de aprobar'
          : `Tienes ${count} ${count === 1 ? 'borrador pendiente' : 'borradores pendientes'} de aprobar`,
      en:
        count === 0
          ? 'You have nothing pending approval'
          : `You have ${count} ${count === 1 ? 'draft pending' : 'drafts pending'} approval`,
    };
  }
  validateBusinessId(businessId);
  const name = BUSINESS_NAMES[businessId];
  return {
    es:
      count === 0
        ? `Nada pendiente de aprobar en ${name.es}`
        : `Tienes ${count} ${count === 1 ? 'pendiente' : 'pendientes'} de aprobar en ${name.es}`,
    en:
      count === 0
        ? `Nothing pending approval in ${name.en}`
        : `You have ${count} pending approval in ${name.en}`,
  };
}
