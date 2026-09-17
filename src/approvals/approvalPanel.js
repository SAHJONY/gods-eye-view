/**
 * Approval queue panel — reusable dashboard-panel component for the main
 * God's Eye View globe app.
 *
 * Sibling station agents mount it inside their business panels:
 *   import { mountApprovalPanel } from '../approvals/approvalPanel.js';
 *   mountApprovalPanel(containerEl, { businessId: 'wholesale', lang: 'es' });
 *
 * Or open the floating overlay (used by the voice "list approvals" intent):
 *   import { openApprovalPanel } from '../approvals/approvalPanel.js';
 *   openApprovalPanel('crude');        // one business
 *   openApprovalPanel(null);           // all businesses
 *
 * Design constraints (Juan's standing readability rule): big readable cards,
 * Approve/Reject buttons ≥44px tall, ES/EN, nothing hover-only — every action
 * is a real tap/click target.
 *
 * CRITICAL SAFETY SEMANTIC: tapping Approve records the decision and an
 * audit entry ONLY. This module contains no send / post / publish / fetch /
 * beacon path. Execution of approved items happens exclusively through
 * Juan's existing gated paths outside this app.
 */

import {
  approveApproval,
  listApprovals,
  rejectApproval,
  approvalStats,
} from './approvalStore.js';
import { BUSINESS_IDS, BUSINESS_NAMES } from './approvalEngine.js';

export const APPROVAL_PANEL_CSS = `
.gev-approvals{font-family:inherit;color:#f2f4f8;max-width:100%}
.gev-approvals *{box-sizing:border-box}
.gev-approvals .ap-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.gev-approvals .ap-title{font-size:18px;font-weight:800;letter-spacing:.02em}
.gev-approvals .ap-stats{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.gev-approvals .ap-chip{font-size:13px;font-weight:700;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)}
.gev-approvals .ap-chip b{font-size:15px}
.gev-approvals .ap-card{background:rgba(16,22,34,.9);border:1px solid rgba(255,209,102,.25);border-radius:16px;padding:14px;margin:10px 0}
.gev-approvals .ap-kind{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#ffd166;border:1px solid rgba(255,209,102,.4);border-radius:999px;padding:4px 10px;margin-bottom:8px}
.gev-approvals .ap-card h3{margin:0 0 6px;font-size:18px;line-height:1.3;word-break:break-word}
.gev-approvals .ap-card p{margin:0 0 8px;font-size:15px;line-height:1.45;color:#d7dee9}
.gev-approvals .ap-meta{font-size:12px;color:#9fb0c9;margin-bottom:10px}
.gev-approvals .ap-actions{display:flex;gap:10px}
.gev-approvals .ap-btn{flex:1;min-height:52px;border-radius:14px;border:none;font-size:17px;font-weight:800;cursor:pointer;padding:10px 14px}
.gev-approvals .ap-btn.approve{background:#0d2b1a;color:#4ade80;border:2px solid #4ade80}
.gev-approvals .ap-btn.reject{background:#3b1114;color:#f87171;border:2px solid #f87171}
.gev-approvals .ap-btn:active{transform:scale(.97)}
.gev-approvals .ap-empty{color:#9fb0c9;text-align:center;padding:24px 12px;font-size:15px}
.gev-approvals .ap-sect{margin-top:14px;font-size:14px;font-weight:800;letter-spacing:.06em;color:#ffd166;text-transform:uppercase}
.gev-approvals .ap-decided{border-left:4px solid rgba(255,255,255,.2);padding:10px 12px;margin:8px 0;background:rgba(255,255,255,.04);border-radius:0 12px 12px 0}
.gev-approvals .ap-decided.approved{border-left-color:#4ade80}
.gev-approvals .ap-decided.rejected{border-left-color:#f87171}
.gev-approvals .ap-decided .t{font-size:15px;font-weight:700}
.gev-approvals .ap-decided .m{font-size:12px;color:#9fb0c9}
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  if (typeof document === 'undefined') return;
  if (document.getElementById('gev-approvals-panel-css')) return;
  const style = document.createElement('style');
  style.id = 'gev-approvals-panel-css';
  style.textContent = APPROVAL_PANEL_CSS;
  document.head.appendChild(style);
}

export function approvalPanelStrings(lang) {
  const es = lang === 'es';
  return {
    title: es ? 'Aprobaciones' : 'Approvals',
    pendingCount: es ? 'pendientes' : 'pending',
    approvedCount: es ? 'aprobadas' : 'approved',
    rejectedCount: es ? 'rechazadas' : 'rejected',
    approve: es ? 'Aprobar' : 'Approve',
    reject: es ? 'Rechazar' : 'Reject',
    pendingSection: es
      ? 'Pendientes de tu aprobación'
      : 'Awaiting your approval',
    decidedSection: es ? 'Decididas' : 'Decided',
    empty: es
      ? 'Nada pendiente — estás al día.'
      : 'Nothing pending — you are all caught up.',
    noDecided: es ? 'Sin decisiones todavía.' : 'No decisions yet.',
    approvedTag: es ? 'Aprobada' : 'Approved',
    rejectedTag: es ? 'Rechazada' : 'Rejected',
    created: es ? 'Creada' : 'Created',
    decided: es ? 'Decidida' : 'Decided',
    note: es ? 'Nota' : 'Note',
    close: es ? 'Cerrar' : 'Close',
    allBusinesses: es ? 'Todos los negocios' : 'All businesses',
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso, lang) {
  try {
    return new Date(iso).toLocaleString(lang === 'es' ? 'es-US' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return String(iso ?? '');
  }
}

function businessName(businessId, lang) {
  return BUSINESS_NAMES[businessId]?.[lang] ?? businessId;
}

function pendingCardHtml(item, lang, s) {
  const title = lang === 'es' ? item.titleEs : item.titleEn;
  const summary = lang === 'es' ? item.summaryEs : item.summaryEn;
  return `
  <article class="ap-card" data-approval-card="${escapeHtml(item.id)}">
    <span class="ap-kind">${escapeHtml(item.kind)}</span>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(summary)}</p>
    <div class="ap-meta">${escapeHtml(s.created)}: ${escapeHtml(fmtDate(item.createdAt, lang))}</div>
    <div class="ap-actions">
      <button type="button" class="ap-btn approve" data-approval-approve="${escapeHtml(item.id)}">${escapeHtml(s.approve)} ✓</button>
      <button type="button" class="ap-btn reject" data-approval-reject="${escapeHtml(item.id)}">${escapeHtml(s.reject)} ✕</button>
    </div>
  </article>`;
}

function decidedRowHtml(item, lang, s) {
  const title = lang === 'es' ? item.titleEs : item.titleEn;
  const tag = item.status === 'approved' ? s.approvedTag : s.rejectedTag;
  const note = item.note
    ? `<div class="m">${escapeHtml(s.note)}: ${escapeHtml(item.note)}</div>`
    : '';
  return `
  <div class="ap-decided ${escapeHtml(item.status)}">
    <div class="t">${escapeHtml(title)} — ${escapeHtml(tag)}</div>
    <div class="m">${escapeHtml(s.decided)}: ${escapeHtml(fmtDate(item.decidedAt, lang))}</div>
    ${note}
  </div>`;
}

/**
 * Render one business's queue into an HTML string. Pure — handy for tests
 * and for hosts that pre-render before mounting.
 */
export function renderApprovalPanelHtml(businessId, lang = 'es') {
  const s = approvalPanelStrings(lang);
  const stats = approvalStats(businessId);
  const pending = listApprovals(businessId, 'pending');
  const approved = listApprovals(businessId, 'approved');
  const rejected = listApprovals(businessId, 'rejected');
  const decided = [...approved, ...rejected].sort((a, b) =>
    String(b.decidedAt || '').localeCompare(String(a.decidedAt || '')),
  );
  return `
  <section class="gev-approvals" data-business="${escapeHtml(businessId)}" aria-label="${escapeHtml(s.title)} — ${escapeHtml(businessName(businessId, lang))}">
    <div class="ap-head">
      <div class="ap-title">✅ ${escapeHtml(s.title)} — ${escapeHtml(businessName(businessId, lang))}</div>
    </div>
    <div class="ap-stats">
      <span class="ap-chip">⏳ <b>${stats.pending}</b> ${escapeHtml(s.pendingCount)}</span>
      <span class="ap-chip">✓ <b>${stats.approved}</b> ${escapeHtml(s.approvedCount)}</span>
      <span class="ap-chip">✕ <b>${stats.rejected}</b> ${escapeHtml(s.rejectedCount)}</span>
    </div>
    <div class="ap-sect">${escapeHtml(s.pendingSection)}</div>
    ${pending.length ? pending.map((it) => pendingCardHtml(it, lang, s)).join('') : `<div class="ap-empty">${escapeHtml(s.empty)}</div>`}
    <div class="ap-sect">${escapeHtml(s.decidedSection)}</div>
    ${decided.length ? decided.map((it) => decidedRowHtml(it, lang, s)).join('') : `<div class="ap-empty">${escapeHtml(s.noDecided)}</div>`}
  </section>`;
}

function renderAllBusinessesHtml(lang) {
  const s = approvalPanelStrings(lang);
  const sections = BUSINESS_IDS.map((id) =>
    renderApprovalPanelHtml(id, lang),
  ).join('');
  return `<div class="gev-approvals-all" aria-label="${escapeHtml(s.allBusinesses)}">${sections}</div>`;
}

/** Returns { id, decision } when a decision button was tapped, else null. */
function handleDecisionClick(root, event) {
  const target = event.target?.closest?.(
    '[data-approval-approve],[data-approval-reject]',
  );
  if (!target || !root.contains(target)) return null;
  const approveBtn = target.closest('[data-approval-approve]');
  const id =
    approveBtn?.getAttribute('data-approval-approve') ??
    target
      .closest('[data-approval-reject]')
      ?.getAttribute('data-approval-reject');
  if (!id) return null;
  const decision = approveBtn ? 'approved' : 'rejected';
  try {
    if (approveBtn) approveApproval(id);
    else rejectApproval(id);
  } catch {
    return null; /* unknown id — ignore */
  }
  return { id, decision };
}

/**
 * Mount a live approval panel into `container`.
 * Options: { businessId (required, or null for all businesses), lang: 'es'|'en',
 *            onDecision?: (item) => void }
 * Returns { el, refresh, destroy, setBusinessId, setLang }.
 */
export function mountApprovalPanel(container, options = {}) {
  if (!container) throw new Error('mountApprovalPanel: container is required');
  injectStyles();
  let { businessId = null, lang = 'es', onDecision = null } = options;

  const root =
    typeof document !== 'undefined' ? document.createElement('div') : null;
  if (root) root.className = 'gev-approvals-host';
  const el = root ?? { innerHTML: '' };

  function render() {
    el.innerHTML =
      businessId === null
        ? renderAllBusinessesHtml(lang)
        : renderApprovalPanelHtml(businessId, lang);
  }

  function onClick(event) {
    const result = handleDecisionClick(el, event);
    if (!result) return;
    render();
    if (typeof onDecision === 'function') {
      // A decision was recorded — the store is the source of truth.
      try {
        onDecision(result);
      } catch {
        /* host callback must not break the queue */
      }
    }
  }

  if (root && typeof root.addEventListener === 'function') {
    root.addEventListener('click', onClick);
  }
  render();
  if (root && typeof container.appendChild === 'function') {
    container.appendChild(root);
  }

  return {
    el,
    refresh: render,
    destroy() {
      if (root && typeof root.removeEventListener === 'function') {
        root.removeEventListener('click', onClick);
      }
      if (root && typeof root.remove === 'function') root.remove();
    },
    setBusinessId(id) {
      businessId = id;
      render();
    },
    setLang(next) {
      lang = next;
      render();
    },
  };
}

/**
 * Floating overlay used by the voice "__approvals_list" intent and any host
 * that wants a one-call queue view. Safe to call outside a browser (no-op).
 * Returns a close() function.
 */
export function openApprovalPanel(businessId = null) {
  if (typeof document === 'undefined' || !document.body) return () => {};
  injectStyles();
  const s = approvalPanelStrings('es');
  const overlay = document.createElement('div');
  overlay.className = 'gev-approvals-overlay';
  overlay.setAttribute(
    'style',
    'position:fixed;inset:0;z-index:99999;background:rgba(4,8,14,.78);' +
      'display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px;',
  );
  const sheet = document.createElement('div');
  sheet.setAttribute(
    'style',
    'width:100%;max-width:640px;background:#0b1220;border:1px solid rgba(255,209,102,.35);' +
      'border-radius:18px;padding:16px;margin:24px 0;',
  );
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = `✕ ${s.close}`;
  closeBtn.setAttribute(
    'style',
    'min-height:48px;min-width:48px;border-radius:12px;border:2px solid #334155;' +
      'background:#1e293b;color:#f1f5f9;font-size:16px;font-weight:800;float:right;cursor:pointer;',
  );
  sheet.appendChild(closeBtn);
  const host = document.createElement('div');
  host.setAttribute('style', 'clear:both;');
  sheet.appendChild(host);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  const panel = mountApprovalPanel(host, { businessId });
  let lang = 'es';
  function close() {
    try {
      panel.destroy();
    } catch {
      /* noop */
    }
    try {
      overlay.remove();
    } catch {
      /* noop */
    }
  }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  return Object.assign(close, {
    setLang(next) {
      lang = next;
      panel.setLang(next);
    },
    getLang: () => lang,
  });
}
