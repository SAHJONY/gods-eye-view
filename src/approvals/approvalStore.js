/**
 * Shared approval queue store — SAHJONY God's Eye View management-console scope.
 *
 * Single localStorage key holds EVERY business's queue plus the append-only
 * audit log. Items are namespaced by `businessId`:
 *   'wholesale' | 'crude' | 'trade' | 'cubacash' | 'carsales' | 'new850' | 'insurance'
 *
 * Item shape:
 *   { id, businessId, kind, titleEs, titleEn, summaryEs, summaryEn,
 *     payload (opaque draft data, NEVER executed),
 *     createdAt, status: 'pending'|'approved'|'rejected', decidedAt, note }
 *
 * CRITICAL SAFETY SEMANTIC: approveApproval()/rejectApproval() record the
 * decision and an audit entry ONLY. This module contains NO send / post /
 * publish / fetch / beacon path — the payload is data, never a command.
 * Execution of approved items happens exclusively through Juan's existing
 * gated paths outside this app.
 */

import {
  ApprovalError,
  BUSINESS_IDS,
  computeStats,
  orderQueue,
  validateApprovalDraft,
  validateBusinessId,
  APPROVAL_STATUSES,
} from './approvalEngine.js';

export const APPROVALS_KEY = 'sahjony.gev.approvals.v1';
export { ApprovalError, APPROVAL_STATUSES };

const memoryStorage = (() => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  };
})();

function storageBackend() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      // Probe — some contexts define localStorage but throw on access.
      const probe = '__sahjony_approvals_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStorage;
}

function freshState() {
  return { version: 1, items: {}, audit: [] };
}

function loadState() {
  const backend = storageBackend();
  let raw = null;
  try {
    raw = backend.getItem(APPROVALS_KEY);
  } catch {
    return freshState();
  }
  if (!raw) return freshState();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return freshState();
    return {
      version: 1,
      items:
        parsed.items && typeof parsed.items === 'object' ? parsed.items : {},
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    };
  } catch {
    return freshState();
  }
}

function saveState(state) {
  const backend = storageBackend();
  try {
    backend.setItem(APPROVALS_KEY, JSON.stringify(state));
  } catch {
    /* storage full or unavailable — in-memory state still returned to caller */
  }
}

/** Shallow copy: the payload stays opaque and is never cloned or invoked. */
function copyItem(item) {
  return { ...item };
}

function copyEntry(entry) {
  return { ...entry };
}

function makeId() {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `appr-${Date.now().toString(36)}-${rand}`;
}

/**
 * Enqueue a draft for Juan's approval. `draft` = { kind, titleEs, titleEn,
 * summaryEs, summaryEn, payload }. Returns the created item (copy).
 */
export function createApproval(businessId, draft) {
  const normalized = validateApprovalDraft(businessId, draft);
  const now = new Date().toISOString();
  const item = {
    id: makeId(),
    businessId,
    ...normalized,
    createdAt: now,
    status: 'pending',
    decidedAt: null,
    note: '',
  };
  const state = loadState();
  state.items[item.id] = item;
  state.audit.push({
    at: now,
    action: 'created',
    approvalId: item.id,
    businessId,
    kind: item.kind,
    actor: 'juan',
    note: '',
  });
  saveState(state);
  return copyItem(item);
}

/**
 * List one business's items for a status (default 'pending'), oldest first
 * for pending, newest-decision first for decided.
 */
export function listApprovals(businessId, status = 'pending') {
  validateBusinessId(businessId);
  if (!APPROVAL_STATUSES.includes(status)) {
    throw new ApprovalError(
      'UNKNOWN_STATUS',
      `Unknown status: ${String(status)}`,
      {
        status,
      },
    );
  }
  const state = loadState();
  const items = Object.values(state.items).filter(
    (item) => item.businessId === businessId && item.status === status,
  );
  return orderQueue(items, status).map(copyItem);
}

/** Get one item by id, or null. */
export function getApproval(id) {
  const state = loadState();
  const item = state.items[String(id)];
  return item ? copyItem(item) : null;
}

function decide(id, status, note) {
  const state = loadState();
  const item = state.items[String(id)];
  if (!item) {
    throw new ApprovalError('NOT_FOUND', `Approval not found: ${String(id)}`, {
      id,
    });
  }
  // Idempotent: re-deciding an already-decided item is a no-op — no state
  // change, no duplicate audit entry, and above all no payload execution.
  if (item.status !== 'pending') {
    return copyItem(item);
  }
  const now = new Date().toISOString();
  item.status = status;
  item.decidedAt = now;
  item.note = String(note ?? '');
  state.audit.push({
    at: now,
    action: status === 'approved' ? 'approved' : 'rejected',
    approvalId: item.id,
    businessId: item.businessId,
    kind: item.kind,
    actor: 'juan',
    note: item.note,
  });
  saveState(state);
  return copyItem(item);
}

/**
 * Record Juan's approval. DECISION ONLY — no send, post, publish, or any
 * external act is triggered. Idempotent on already-decided items.
 */
export function approveApproval(id, note = '') {
  return decide(id, 'approved', note);
}

/**
 * Record Juan's rejection. DECISION ONLY — idempotent on already-decided
 * items.
 */
export function rejectApproval(id, note = '') {
  return decide(id, 'rejected', note);
}

/** { businessId, pending, approved, rejected, total }. */
export function approvalStats(businessId) {
  validateBusinessId(businessId);
  const state = loadState();
  const items = Object.values(state.items).filter(
    (item) => item.businessId === businessId,
  );
  return { businessId, ...computeStats(items) };
}

/** Stats for every business (one row per BUSINESS_IDS entry). */
export function allApprovalStats() {
  const state = loadState();
  const byBusiness = {};
  for (const item of Object.values(state.items)) {
    (byBusiness[item.businessId] ??= []).push(item);
  }
  return BUSINESS_IDS.map((businessId) => ({
    businessId,
    ...computeStats(byBusiness[businessId] ?? []),
  }));
}

/** Append-only audit log, newest first. Optional businessId filter. */
export function listAuditLog(businessId = null) {
  if (businessId !== null) validateBusinessId(businessId);
  const state = loadState();
  const entries =
    businessId === null
      ? state.audit
      : state.audit.filter((e) => e.businessId === businessId);
  return [...entries].reverse().map(copyEntry);
}

/**
 * Reset the store (clears the localStorage key and the in-memory fallback).
 * Intended for tests and fixtures — never for production use.
 */
export function resetApprovalStore() {
  const backend = storageBackend();
  try {
    backend.removeItem(APPROVALS_KEY);
  } catch {
    /* noop */
  }
  memoryStorage.clear();
}
