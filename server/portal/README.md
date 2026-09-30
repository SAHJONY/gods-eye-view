# SAHJONY Client Portal — operator notes

Free client-facing add-on for active brokerage clients: login → "Mis embarques" →
per-shipment view with LIVE vessel position (AIS), route and weather/cyclone overlays.

## Setup (server only, never in git)

1. Set the owner key for the admin API (required — admin is fail-closed without it):
   `PORTAL_OWNER_KEY` env var on the VPS (systemd drop-in, like the AIS key).
2. Data lives in `server/portal/data/` (`clients.json`, `shipments.json`,
   `sessions.json`) — gitignored. Back this directory up; it IS the client DB.

## Admin API (Authorization: Bearer $PORTAL_OWNER_KEY)

```bash
K="Authorization: Bearer $PORTAL_OWNER_KEY"; B=http://127.0.0.1:8200/api/portal/admin
curl -s -H "$K" $B/clients
curl -s -H "$K" -X POST $B/clients -d '{"companyName":"Acme Foods","contactName":"Ana","email":"ana@acme.com","password":"cámbiala-123"}'
curl -s -H "$K" -X POST $B/shipments -d '{"clientId":"cli_...","vesselMmsi":"244780354","vesselName":"MICHIEL DE RUYTER","origin":"Rotterdam","destination":"Mariel","cargoLabel":"Contenedor 40ft — alimentos","status":"en_transito","eta":"2026-10-12"}'
curl -s -H "$K" -X PATCH $B/shipments/shp_... -d '{"status":"en_puerto"}'
curl -s -H "$K" -X PATCH $B/shipments/shp_... -d '{"containerNumber":"MSKU 1234567","serviceTier":"Enviar contenedor completo"}'
```

## Container-first shipments

- Shipments carry two optional fields: `containerNumber` (validated LOOSELY —
  typical BIC is 4 letters + 7 digits, but any non-empty value ≤ 32 chars is
  accepted so a non-standard carrier reference never blocks registration)
  and `serviceTier` (one of the 5 service values; drives the tier label and
  tier filter on "Mis envíos"). Both are editable in the admin console and
  shown on the shipment card + detail view when present (absent cleanly when
  not — older records without them render unchanged).
- Tier short labels on cards/filters: Compra / Contenedor / Pallet /
  Paquetería / Varios.

Pages: `/portal/` (login), `/portal/panel.html` (client), `/portal/registro`
(self-registration), `/portal/demo` (shareable prospect demo, no login),
`/portal/admin.html` (owner console — prompts for the owner key, kept in
sessionStorage only).

## Customer navigation (5 tabs)

The client panel (`panel.html`) is a tabbed app — exactly 5 tabs:
**Inicio** (dashboard: active shipments at a glance, notices, quick actions),
**Mis envíos** (shipment list → live-tracking detail), **Cotizar** (quote
request form), **Paquetes** ("Próximamente" placeholder until Phase 2b builds
it), **Cuenta** (profile, change password, logout). Mobile-first bottom tab
bar (top nav on desktop ≥ 760 px); header carries the SAHJONY LLC brand and
an always-visible back button. Every shipment card has a **📍 Rastrear**
button → one tap to live tracking from anywhere; every screen is ≤ 3 taps
from Inicio; empty states explain the next step ("Aún no tienes envíos
activos — cotiza aquí"). The prospect demo mirrors the same tab structure
with demo data (view-only: quotes and password changes are 403 for demo).

## Quote requests (Cotizar tab)

- Client: `POST /api/portal/quotes` (session; rate-limited 10/10 min per
  client) with `serviceTier` (one of the 5 service values), `cargoDescription`,
  `contactName`, `contactPhone` (+ optional `contactEmail`). When
  `serviceTier` is **Enviar contenedor completo**, the form shows a
  container-size selector (**20ft** / **40ft**, required) plus origin /
  destination; `containerSize` is required server-side for that tier and
  ignored for the others. Client reads their own via `GET /api/portal/quotes`.
- Owner: `GET /api/portal/admin/quotes` (pending first) and
  `PATCH /api/portal/admin/quotes/<id>` with `{"status":"done"|"rejected"}` —
  triaged in the admin "Cotizaciones" tab. Persisted in `quotes.json`.
- Account: `POST /api/portal/account/password`
  (`currentPassword`, `newPassword` ≥ 8 chars) — verifies the current password,
  then rotates the session (all sessions revoked, fresh cookie issued).

## Self-registration with owner approval

- Prospects register at `/portal/registro` (company, contact name, email,
  phone, password, and the required "¿Qué servicio le interesa?" —
  `Comprar mercancía` / `Enviar contenedor completo` / `Enviar carga por pallet` /
  `Enviar paquetería` / `Varios servicios`, stored on the client
  record and shown in the admin client list). Accounts are created as
  `pending` — they CANNOT log in or see any data until approved.
  Registrations are rate-limited (per IP) and every field is validated
  server-side (the service interest accepts only the 5 allowed values).
- Owner approves/rejects in the admin panel (clients tab) or via API:
  `POST /api/portal/admin/clients/<id>/approve`,
  `POST /api/portal/admin/clients/<id>/reject` (also kills sessions).
- Accounts the owner creates via `POST /admin/clients` are `active`
  immediately.
- The demo view (`/portal/demo`) ends with the registration CTA
  "¿Quiere este seguimiento para su carga?" → REGÍSTRESE AQUÍ →
  `/portal/registro`; after registering the prospect sees the 3 steps
  (activamos su acceso → mueva su carga → el seguimiento se activa solo
  a bordo).

## Autonomous activation (AIS watcher)

Lifecycle: `pendiente` → `en tránsito` → `en puerto` → `entregado`.

- The owner pre-registers the shipment WITH port coords (originLat/originLon,
  destLat/destLon). Without coords the shipment stays manual-only.
- Every 60 s the server-side watcher evaluates `pendiente`/`en_transito`
  shipments against live AIS positions:
  - vessel exits the origin geofence (~15 km) → `en_transito`
  - sustained speed > 3 kn over 2 consecutive ticks → `en_transito`
    (one noisy tick never flips anything)
  - vessel enters the destination geofence → `en puerto`
- `entregado` is MANUAL ONLY (owner PATCH) — the system cannot see the
  container leave the ship.
- No AIS data → no transition, ever. The watcher never regresses a status.
- Manual tick / status: `POST /api/portal/admin/watcher/tick`,
  `GET /api/portal/admin/watcher/status` (owner-guarded).

## Hard rules

- Clients see ONLY their own shipments (server-side scoping, 404 on cross-client ids).
- NEVER store supplier identity, acquisition cost, margin or spread in the portal
  stores — client-safe fields only.
- Self-registration creates `pending` accounts only; login requires owner
  approval (`active`). Sessions are 7-day httpOnly cookies. Login and
  registration are rate-limited.
- The AISStream key stays server-side; `/shipments/:id/vessel` returns ONE vessel.
