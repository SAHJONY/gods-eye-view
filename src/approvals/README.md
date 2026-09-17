# Approval queue infrastructure — shared contract (management-console scope)

**Branch:** `sahjony/approvals-infra` — **this infra merges to main BEFORE the
per-business station branches.** Stations build on top of this contract; do
not re-implement the queue.

Single localStorage key for all businesses: `sahjony.gev.approvals.v1`.
Items are namespaced by `businessId`:
`'wholesale' | 'crude' | 'trade' | 'cubacash' | 'carsales' | 'new850' | 'insurance'`

## Files

| File | Role |
|---|---|
| `approvalEngine.js` | Validation (`validateApprovalDraft`, `validateBusinessId`), queue ordering, stats, voice summaries, `BUSINESS_IDS` / `BUSINESS_NAMES` / `APPROVAL_KINDS`. No storage, no DOM, no payload execution. |
| `approvalStore.js` | The single store. `createApproval(businessId, draft)`, `listApprovals(businessId, status='pending')`, `getApproval(id)`, `approveApproval(id, note)`, `rejectApproval(id, note)`, `approvalStats(businessId)`, plus `allApprovalStats()`, `listAuditLog(businessId?)`, `resetApprovalStore()` (tests/fixtures only). Append-only audit log lives in the same key. |
| `approvalPanel.js` | Dashboard-panel component for the main globe app: `mountApprovalPanel(container, { businessId, lang, onDecision })`, `renderApprovalPanelHtml(businessId, lang)`, `openApprovalPanel(businessId | null)` (floating overlay, used by the voice intent), `approvalPanelStrings(lang)`, `APPROVAL_PANEL_CSS`. |
| `approvalSection.js` | Renderer for the standalone screens (`public/*/index.html`): **zero imports** — safe to import as an ES module or inline into a classic `<script>`. `renderApprovalSection(opts)`, `wireApprovalSection(root, store, opts)`, `approvalSectionStrings(lang)`, `escapeApprovalHtml`, `APPROVAL_SECTION_CSS`. |

## Item shape (FIXED)

```js
{
  id,            // 'appr-<base36time>-<rand>'
  businessId,    // one of BUSINESS_IDS
  kind,          // e.g. 'dispute' | 'reply' | 'listing' | 'post' | 'outreach' | 'offer' | 'document' | 'draft'
  titleEs, titleEn,
  summaryEs, summaryEn,
  payload,       // OPAQUE draft data — never executed, never rendered raw
  createdAt,     // ISO
  status,        // 'pending' | 'approved' | 'rejected'
  decidedAt,     // ISO | null
  note,          // decision note ('' default)
}
```

Required on create: `kind`, `titleEs`, `titleEn`, `summaryEs`, `summaryEn`.
`payload` is optional (defaults to `null`).

## Semantics (FIXED)

- **Decisions are idempotent.** Re-approving/rejecting an already-decided
  item is a no-op: no state change, no duplicate audit entry.
- **Audit log is append-only** (`created` / `approved` / `rejected` entries,
  newest-first via `listAuditLog`).
- **Pending queues are FIFO** (oldest first); decided lists are newest-decision first.
- **CRITICAL SAFETY SEMANTIC:** `approveApproval` / `rejectApproval` record
  the decision and an audit entry **ONLY**. This module contains **no**
  send / post / publish / fetch / beacon / WebSocket path. Execution of
  approved items happens **exclusively** through Juan's existing gated paths
  outside this app. Tested: payload functions are never invoked; the module
  source contains no network/execution primitives.

## Voice

`src/voice/sahjonyVoice.js` — **LIST intents only**, ES/EN:

- All businesses: *"qué tengo pendiente de aprobar"*, *"muéstrame mis
  aprobaciones"*, *"cola de aprobaciones"*, *"show me my approvals"*,
  *"approval queue"* → `__approvals_list` with `args.businessId = null`
- Per business: *"muéstrame las aprobaciones de New850"*, *"qué tengo
  pendiente en crudo"*, *"show trade approvals"*, *"pending approvals for
  insurance"* → `__approvals_list` with `args.businessId`

Dispatched in `src/app/tools.js` → `openApprovalPanel(businessId)` overlay.

**Approval/rejection is TAP-ONLY by design.** There is deliberately NO voice
approve/reject intent (a voice command can be triggered by anyone within
earshot; approving authorizes real external acts). Voice opens the queue;
**Juan's tap is the explicit approval.** Documented in the intent block,
enforced by tests (`sahjonyVoice.approvals.test.mjs`).

## Station integration (for sibling agents)

Globe app: `mountApprovalPanel(el, { businessId: 'wholesale', lang })`.
Standalone screen: render `renderApprovalSection(...)` + `wireApprovalSection(...)`
passing the `approvalStore` module as `store` (localStorage is shared, so both
surfaces see the same queue). Buttons ≥52px, ES/EN, nothing hover-only.
