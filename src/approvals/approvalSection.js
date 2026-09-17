/**
 * Approval queue section renderer for the standalone business screens
 * (public/wholesale/index.html, public/crude/index.html, public/import-export/index.html,
 *  public/cubacash/index.html, …).
 *
 * This file has ZERO imports on purpose: standalone screens run classic
 * (non-module) inline scripts, so sibling station agents can either import it
 * as an ES module OR inline this file's text into their page's <script>.
 * Pass the approvalStore module (or any adapter with the same four methods)
 * as `store`.
 *
 * Usage from a classic inline script:
 *   const store = { listApprovals, approveApproval, rejectApproval, approvalStats }; // imported or inlined
 *   document.getElementById('appr').innerHTML = renderApprovalSection({
 *     businessId: 'wholesale', businessName: 'Wholesale', lang: 'es',
 *     items: store.listApprovals('wholesale', 'pending'),
 *     decided: [...store.listApprovals('wholesale','approved'), ...store.listApprovals('wholesale','rejected')],
 *     stats: store.approvalStats('wholesale'),
 *   });
 *   wireApprovalSection(document.getElementById('appr'), store, { businessId: 'wholesale', lang: 'es' });
 *
 * Design: phone-first, big tap targets (≥52px Approve/Reject buttons),
 * ES/EN, no hover-only interactions.
 *
 * CRITICAL SAFETY SEMANTIC: approve/reject records the decision and an audit
 * entry ONLY. No send / post / publish / fetch / beacon path exists here.
 * Execution of approved items happens exclusively through Juan's existing
 * gated paths outside this app.
 */

export const APPROVAL_SECTION_CSS = `
.gev-appr{font-family:inherit;color:inherit;max-width:100%}
.gev-appr *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.gev-appr .as-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:18px 0 4px;padding:0 2px}
.gev-appr .as-head h2{margin:0;font-size:17px;color:#7dd3fc;letter-spacing:.04em}
.gev-appr .as-chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.gev-appr .as-chip{font-size:13px;font-weight:700;padding:6px 12px;border-radius:999px;background:#1b2434;color:#94a3b8;border:1px solid #334155}
.gev-appr .as-chip b{font-size:15px;color:#f1f5f9}
.gev-appr .as-card{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:16px;margin:12px 0}
.gev-appr .as-kind{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#ffd166;border:1px solid rgba(255,209,102,.4);border-radius:999px;padding:4px 10px;margin-bottom:8px}
.gev-appr .as-card h3{margin:0 0 6px;font-size:18px;word-break:break-word}
.gev-appr .as-card p{margin:0 0 8px;font-size:16px;line-height:1.45;color:#cbd5e1}
.gev-appr .as-meta{font-size:13px;color:#94a3b8;margin-bottom:10px}
.gev-appr .as-actions{display:flex;gap:10px}
.gev-appr .as-btn{flex:1;min-height:52px;border-radius:14px;font-size:17px;font-weight:800;cursor:pointer;padding:10px 14px}
.gev-appr .as-btn.approve{background:#0d2b1a;color:#4ade80;border:2px solid #4ade80}
.gev-appr .as-btn.reject{background:#3b1114;color:#f87171;border:2px solid #f87171}
.gev-appr .as-btn:active{transform:scale(.97)}
.gev-appr .as-empty{color:#94a3b8;text-align:center;padding:24px 12px;font-size:16px}
.gev-appr .as-decided{border-left:4px solid #334155;padding:10px 12px;margin:8px 0;background:#16202f;border-radius:0 12px 12px 0}
.gev-appr .as-decided.approved{border-left-color:#4ade80}
.gev-appr .as-decided.rejected{border-left-color:#f87171}
.gev-appr .as-decided .t{font-size:16px;font-weight:700}
.gev-appr .as-decided .m{font-size:13px;color:#94a3b8}
`;

export function approvalSectionStrings(lang) {
  const es = lang === 'es';
  return {
    heading: es ? '✅ Aprobaciones' : '✅ Approvals',
    pending: es ? 'pendientes' : 'pending',
    approved: es ? 'aprobadas' : 'approved',
    rejected: es ? 'rechazadas' : 'rejected',
    approve: es ? 'Aprobar' : 'Approve',
    reject: es ? 'Rechazar' : 'Reject',
    pendingTitle: es ? 'Pendientes de tu aprobación' : 'Awaiting your approval',
    decidedTitle: es ? 'Decididas' : 'Decided',
    empty: es
      ? 'Nada pendiente — estás al día.'
      : 'Nothing pending — you are all caught up.',
    noDecided: es ? 'Sin decisiones todavía.' : 'No decisions yet.',
    approvedTag: es ? 'Aprobada' : 'Approved',
    rejectedTag: es ? 'Rechazada' : 'Rejected',
    created: es ? 'Creada' : 'Created',
    decided: es ? 'Decidida' : 'Decided',
    note: es ? 'Nota' : 'Note',
  };
}

export function escapeApprovalHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtSectionDate(iso, lang) {
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

/**
 * Render the full section HTML (without the <style>; include
 * APPROVAL_SECTION_CSS once per page). All user text is HTML-escaped.
 *
 * opts: { businessName, lang='es', items (pending), decided (approved+rejected),
 *         stats {pending,approved,rejected,total} }
 */
export function renderApprovalSection(opts = {}) {
  const {
    businessName = '',
    lang = 'es',
    items = [],
    decided = [],
    stats = { pending: 0, approved: 0, rejected: 0, total: 0 },
  } = opts;
  const s = approvalSectionStrings(lang);
  const esc = escapeApprovalHtml;
  const titleFor = (it) => (lang === 'es' ? it.titleEs : it.titleEn);
  const summaryFor = (it) => (lang === 'es' ? it.summaryEs : it.summaryEn);

  const cards = items.length
    ? items
        .map(
          (it) => `
  <article class="as-card" data-as-card="${esc(it.id)}">
    <span class="as-kind">${esc(it.kind)}</span>
    <h3>${esc(titleFor(it))}</h3>
    <p>${esc(summaryFor(it))}</p>
    <div class="as-meta">${esc(s.created)}: ${esc(fmtSectionDate(it.createdAt, lang))}</div>
    <div class="as-actions">
      <button type="button" class="as-btn approve" data-as-approve="${esc(it.id)}">${esc(s.approve)} ✓</button>
      <button type="button" class="as-btn reject" data-as-reject="${esc(it.id)}">${esc(s.reject)} ✕</button>
    </div>
  </article>`,
        )
        .join('')
    : `<div class="as-empty">${esc(s.empty)}</div>`;

  const decidedRows = decided.length
    ? decided
        .map((it) => {
          const tag = it.status === 'approved' ? s.approvedTag : s.rejectedTag;
          const note = it.note
            ? `<div class="m">${esc(s.note)}: ${esc(it.note)}</div>`
            : '';
          return `
  <div class="as-decided ${esc(it.status)}">
    <div class="t">${esc(titleFor(it))} — ${esc(tag)}</div>
    <div class="m">${esc(s.decided)}: ${esc(fmtSectionDate(it.decidedAt, lang))}</div>
    ${note}
  </div>`;
        })
        .join('')
    : `<div class="as-empty">${esc(s.noDecided)}</div>`;

  return `
<section class="gev-appr" aria-label="${esc(s.heading)} — ${esc(businessName)}">
  <div class="as-head"><h2>${esc(s.heading)} — ${esc(businessName)}</h2></div>
  <div class="as-chips">
    <span class="as-chip">⏳ <b>${Number(stats.pending) || 0}</b> ${esc(s.pending)}</span>
    <span class="as-chip">✓ <b>${Number(stats.approved) || 0}</b> ${esc(s.approved)}</span>
    <span class="as-chip">✕ <b>${Number(stats.rejected) || 0}</b> ${esc(s.rejected)}</span>
  </div>
  <div class="as-head"><h2>${esc(s.pendingTitle)}</h2></div>
  ${cards}
  <div class="as-head"><h2>${esc(s.decidedTitle)}</h2></div>
  ${decidedRows}
</section>`;
}

/**
 * Attach tap handlers to a rendered section. Re-renders the section after
 * each decision. `store` must implement listApprovals / approveApproval /
 * rejectApproval / approvalStats (the approvalStore module satisfies this).
 *
 * opts: { businessId (required), businessName='', lang='es',
 *         onChange?: ({id, decision}) => void }
 * Returns { refresh, destroy }.
 */
export function wireApprovalSection(root, store, opts = {}) {
  const { businessId, businessName = '', lang = 'es', onChange = null } = opts;
  if (!root) throw new Error('wireApprovalSection: root is required');
  if (!businessId)
    throw new Error('wireApprovalSection: businessId is required');
  if (!store) throw new Error('wireApprovalSection: store is required');

  function render() {
    const stats = store.approvalStats(businessId);
    const items = store.listApprovals(businessId, 'pending');
    const decided = [
      ...store.listApprovals(businessId, 'approved'),
      ...store.listApprovals(businessId, 'rejected'),
    ].sort((a, b) =>
      String(b.decidedAt || '').localeCompare(String(a.decidedAt || '')),
    );
    root.innerHTML = renderApprovalSection({
      businessName,
      lang,
      items,
      decided,
      stats,
    });
  }

  function onClick(event) {
    const target =
      event.target && event.target.closest
        ? event.target.closest('[data-as-approve],[data-as-reject]')
        : null;
    if (!target || !root.contains(target)) return;
    const approveBtn = target.closest('[data-as-approve]');
    const id =
      approveBtn?.getAttribute('data-as-approve') ??
      target.closest('[data-as-reject]')?.getAttribute('data-as-reject');
    if (!id) return;
    const decision = approveBtn ? 'approved' : 'rejected';
    try {
      if (approveBtn) store.approveApproval(id);
      else store.rejectApproval(id);
    } catch {
      return; /* unknown id — ignore */
    }
    render();
    if (typeof onChange === 'function') {
      try {
        onChange({ id, decision });
      } catch {
        /* host callback must not break the queue */
      }
    }
  }

  render();
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('click', onClick);
  }
  return {
    refresh: render,
    destroy() {
      if (typeof root.removeEventListener === 'function') {
        root.removeEventListener('click', onClick);
      }
    },
  };
}
