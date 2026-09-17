# Tenant Isolation — Phase 2 Build Plan (QUEUED)

Status: design approved for queuing by Juan 2026-09-17. Build starts AFTER Phase 1
(six business stations as management consoles) lands on `sahjony/main`.
Branch: `sahjony/tenant-isolation`.

## Approvals (recorded 2026-09-17)

- Juan: **"merge and proceed"** — ADVANCE APPROVAL: when this branch is built
  and its tests are green, merge it to `sahjony/main` WITHOUT asking again.
  Then STOP. (Juan 2026-09-17: "let me test the business first.")
- After the merge: NO pilot outreach, NO public tiers, NO selling motion.
  Phase 1 is Juan running his six businesses on the app and testing everything
  himself. The tenant-isolation merge approval stands — it is plumbing only,
  not a go-to-market signal.
- **EXPANSION GATE (Juan 2026-09-17, replaces all softer Phase 1 exit language):**
  NO expansion of GEV as a product — no pilots, no tiers, no selling — until
  Juan sees the FIRST REAL PROFITS in EVERY one of the six businesses. That is
  the named exit criterion. Build implication: every station serves revenue
  first — pipelines, approvals, and workforce features are optimized to get
  each business to its first real profit, not just to look complete.
- Merging to main does NOT deploy to the VPS. The VPS deploy (which affects
  the live app at 69.62.68.67) still needs Juan's explicit word when the time
  comes — that gate is unchanged.
- The six business stations (Phase 1) still need Juan's merge+deploy approval
  once verified — that gate is also unchanged. Phase 1 merges happen first;
  this branch rebases onto the new main before building.

## Goal

Multi-tenant God's Eye View: each tenant gets a fully walled workspace.
This is the technical gate before any pilot dollar changes hands.

## What's walled per tenant (nothing leaks between tenants)

- Pipelines — deals, cases, leads, RFQs, per business
- Contacts
- Cases (incl. New850 credit-repair cases)
- Approval queues (pending / approved / rejected + audit log)
- WhatsApp number — per-tenant config, resolved from the active tenant, never a global
- Workforce config — per-tenant agent enablement and config refs
- Inbox triage items

Rule: every read/write is scoped by `tenantId`. No cross-tenant queries, ever.
Tests must prove it: data created in tenant A is invisible in tenant B.

## Architecture

- **Tenant registry** — localStorage key `sahjony.gev.tenants.v1`: tenant list
  `{id, name, createdAt, plan, whatsappNumber, lang}` + active-tenant pointer.
- **Tenant-scoped keys** — all existing store keys gain a tenant segment:
  `sahjony.gev.<tenantId>.approvals.v1`, `sahjony.gev.<tenantId>.carsales.*`, etc.
- **Context module** `src/tenants/`:
  `getActiveTenant()`, `setActiveTenant(id)`, `createTenant(input)`,
  `tenantKey(base)` helper. ALL stores must route through `tenantKey` —
  direct unscoped key access becomes a check-boundaries violation.
- **Migration** — Juan's existing single-operator data becomes tenant `sahjony`
  (tenant #1, the operator). Migration runs once, preserves every record,
  and is tested.
- **WhatsApp** — number lives in the tenant record. Triage, approvals, and
  workforce flows resolve it from the active tenant.

## What stays OUT of the public repo (hard boundary)

All money-making logic lives outside this repo, always:

- Playbooks, Sofia prompts, datasets, pricing/scoring logic, message templates
- These ship as a PRIVATE provisioning bundle applied at deploy/provisioning
  time — never committed, never in CI logs.
- The public repo holds ONLY: isolation plumbing, onboarding scaffolding,
  generic UI, and tests.
- CI gate: extend the repo-scan check pattern so the build FAILS if
  prompt/playbook-like content (private bundle markers) appears in the tree.

## Self-serve onboarding scaffolding

Phone-first, ES/EN, big touch targets, single-operator-per-tenant:

1. Signup → tenant provisioning: creates the walled workspace, default
   pipelines per business, language default, empty WhatsApp slot.
2. Onboarding checklist UI: connect WhatsApp number → review workspace →
   first pipeline tour → done. Each step one tap.
3. Pilot gating: per-tenant feature flags + `pilot` plan marker; usage-metering
   hooks (no payment processing in this repo — ever).
4. Multi-user teams are OUT OF SCOPE for Phase 2 (Juan's single-operator
   standard applies per tenant).

## Phase 1 → Phase 2 sequencing

1. Phase 1 lands: `sahjony/approvals-infra` merges first, then the station
   branches (`sahjony/carsales-plugin`, `sahjony/new850-plugin`,
   `sahjony/gev-audit-fixes`) → `sahjony/main`.
2. Rebase `sahjony/tenant-isolation` onto the new `sahjony/main`.
3. Build per this plan. No merge, no deploy without Juan's word.

## Acceptance criteria

- [ ] Two test tenants: records in one are invisible in the other (automated test)
- [ ] Juan's workspace migrates intact as tenant `sahjony`
- [ ] Repo-scan CI gate passes (no money-making logic in the public tree)
- [ ] Onboarding flow completes on a 360px viewport, ES/EN, ≥44px targets
- [ ] Per-tenant WhatsApp number resolution tested (no global fallback)
- [ ] `npm test` green; `npm run build` green
