# GEV Business Module Standard

**Standing rule (Juan, 2026-09-17, permanent): EVERY business goes on the
GOD'S EYE VIEW platform as a module — current and future.** Whenever a new
business enters Juan's portfolio, it automatically gets a GEV module built to
this standard. This is the default unless Juan says otherwise.

Current modules: wholesale, crude, insurance, trade (import/export), cubacash
(MY CUBA CASH), carsales, new850 (credit repair).

## The per-business pattern (all required)

1. **Pipeline store** — `src/<module>/` with store + engine + importer
   (`<name>Store.js`, `<name>Engine.js`, `<name>Importer.js` + tests).
   localStorage-backed, keys namespaced: `sahjony.gev.<module>.*`.
2. **Dashboard panel** — `<name>Dashboard.js` + UI tests for the main globe app.
3. **AI workforce** — `<name>Workforce.js` (or equivalent): agent roster,
   what ran, what needs Juan. Drafts only — never sends, posts, or executes.
4. **Voice intents** — ES/EN in `src/voice/sahjonyVoice.js` + tests.
   List/status intents only; decisions (approve/reject) are TAP-ONLY, never voice.
5. **Standalone screen** — `public/<module>/index.html`: phone-first,
   360px-safe, touch targets ≥44px, ES/EN toggle persisted in
   `sahjony.gev.lang`, hash deep-link views, cross-links to other business
   screens, no Cesium, no external calls, nothing hover-only.
   **Hub architecture (standing rule, Juan 2026-09-17): EVERY business gets its
   OWN SEPARATE FULL SCREEN — never crammed into the main screen.** Each
   business screen contains that business's pipeline, dashboard panel, map
   layers, AI workforce panel, and voice controls. Every business screen has
   an easy visible back-to-hub button: persistent sticky header, element id
   `gev-back-hub`, `href="/"`, ES "‹ Volver" / EN "‹ Back", min-height 52px.
   The main screen is the hub/launcher: one-tap business cards (big targets,
   ES/EN) as the default entry view; the globe stays accessible from the hub.
   Nothing business-specific lives on the main screen except the launcher cards.
6. **Launcher registration** — entry in `src/businessLauncher.js` BUSINESSES
   (+ test): one-tap access from the main screen.
7. **Map layer** — `<name>MapLayer.js` + UI tests, where the business has a
   real geographic dimension. Omit with a documented reason if it doesn't
   (never invent geography).

## Management console sections (every station)

Each station is a management console, not a dashboard: **approval queue**
(one-tap approve/reject via the shared `src/approvals/` contract — the tap
records Juan's decision ONLY, the app never auto-executes external acts),
**pipeline management** (advance stages + his notes), **inbound triage**
(per-business, import-backed, never invented), **workforce oversight**.

## Non-negotiable standards

- **Single-operator**: Juan runs everything alone. No team roles, no delegation,
  no multi-user workflows. AI workforce does the work; he taps the decisions.
- **Revenue-first**: optimize every station for the business's FIRST REAL PROFIT.
- **ES/EN bilingual**, Spanish-first where the business is Cuba-facing.
- **Business separation**: separate stores/keys/layers/pipelines per business
  (Phase 2 adds tenant isolation). Leads, contacts, cases never cross-filed.
- **PII**: masked only on panels/screens; never expose full phones/SSNs.
- **No invented data**: every provider, rate, vehicle, score, or deal must be
  real or clearly labeled DEMO/estimate. No fake customers, ever.
- **Car track secrecy (standing)**: the public never sees supplier prices —
  no Ronny floors, margins, or cost stacks on any customer-facing surface.

## Unified ecosystem (standing rule, Juan 2026-09-17)

ALL APPS AND SYSTEMS WORK TOGETHER AS ONE. GOD'S EYE VIEW is the unified
command hub:
- The launcher hub deep-links out to every app: sahjony.com, mycubacash.com,
  new850.com, the car sales machine page. Every business screen keeps
  one-tap access to the other business screens.
- Single front door everywhere: Sofia on WhatsApp +1 281-662-8581
  (`https://wa.me/12816628581`), same position/label convention on all
  surfaces.
- Consistent SAHJONY branding across all surfaces (same brand mark, language
  toggle, back-to-hub bar).
- The businesses stay operationally separate behind the scenes (separate
  stores/keys/pipelines per the tenant rule); what unifies is the experience —
  one system, one hub, one front door.
- Applies to all six modules and every future one.

## Standing gates

- Merge to main: Juan approves every merge (exception: tenant-isolation has
  advance approval when built + tests green).
- VPS deploy (live app): Juan's explicit word, always. Merge ≠ deploy.
- Expansion gate: NO GEV product expansion (pilots, tiers, selling) until Juan
  sees first real profits in ALL six businesses.
