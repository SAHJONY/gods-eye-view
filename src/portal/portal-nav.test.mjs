import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createPortalApi } from '../../server/portal/routes.js';
import {
  createShipmentStore, TIER_SHORT_LABELS, tierShortLabel,
} from '../../server/portal/shipments.js';

/**
 * Customer navigation (5 tabs) + container-first shipments:
 * - panel.html renders exactly 5 tabs with Spanish labels, mobile-first
 *   bottom tab bar (top nav on desktop), always-visible back, one-tap
 *   "Rastrear" tracking, helpful empty states, and the demo mirroring the
 *   same tab structure
 * - Cotizar form: container-size selector shown ONLY for the container tier
 * - Mis envíos: tier labels + tier filter; container number renders when
 *   present and is absent cleanly when not
 * - shipments store: containerNumber (loose validation) + serviceTier
 *   round-trip; admin can set them on create/update
 */
const PANEL = readFileSync(
  new URL('../../public/portal/panel.html', import.meta.url), 'utf8',
);
const ADMIN = readFileSync(
  new URL('../../public/portal/admin.html', import.meta.url), 'utf8',
);

describe('portal navigation markup', () => {
  it('renders exactly 5 tabs with Spanish labels', () => {
    const buttons = [...PANEL.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(buttons, ['inicio', 'envios', 'cotizar', 'paquetes', 'cuenta']);
    for (const tab of buttons) {
      assert.ok(PANEL.includes(`id="tab-${tab}"`), `section tab-${tab} exists`);
    }
    for (const label of ['Inicio', 'Mis envíos', 'Cotizar', 'Paquetes', 'Cuenta']) {
      assert.ok(PANEL.includes(`>${label}<`) || PANEL.includes(`>${label}</button>`), `label ${label}`);
    }
  });

  it('tab bar is mobile-first bottom, top nav on desktop', () => {
    assert.match(PANEL, /#tabbar\s*{[^}]*position:\s*fixed[^}]*bottom:\s*0/);
    assert.match(PANEL, /@media\s*\(min-width:\s*760px\)[\s\S]*#tabbar\s*{[^}]*position:\s*static/);
  });

  it('header carries the SAHJONY brand and an always-visible back button', () => {
    assert.ok(PANEL.includes('SAHJONY LLC'));
    assert.ok(PANEL.includes('id="backBtn"'));
    assert.match(PANEL, /id="backBtn"[^>]*>/);
  });

  it('live tracking is one tap from anywhere: Rastrear buttons + tracker', () => {
    // every shipment card template carries a Rastrear action
    assert.ok(PANEL.includes('data-track="${esc(s.id)}"'));
    assert.ok(PANEL.includes('📍 Rastrear'));
    // delegated one-tap handler jumps straight to the detail view
    assert.ok(PANEL.includes('function trackShipment(id)'));
    assert.match(PANEL, /closest\('\[data-track\]'\)/);
  });

  it('helpful empty states are present', () => {
    assert.ok(PANEL.includes('Aún no tienes envíos activos — cotiza aquí'));
    assert.ok(PANEL.includes('No tienes envíos de este tipo'));
    assert.ok(PANEL.includes('Próximamente')); // Paquetes placeholder
    assert.ok(PANEL.includes('fase 2b'));
  });

  it('demo mirrors the same tab structure (view-only)', () => {
    assert.ok(PANEL.includes('id="demoQuoteNote"'));
    assert.ok(PANEL.includes('id="cta"'));
    assert.match(PANEL, /me\.demo === true[\s\S]*demoQuoteNote/);
  });
});

describe('portal cotizar form markup', () => {
  it('tier select offers the 5 service values', () => {
    for (const tier of ['Comprar mercancía', 'Enviar contenedor completo', 'Enviar carga por pallet', 'Enviar paquetería', 'Varios servicios']) {
      assert.ok(PANEL.includes(`<option>${tier}</option>`), tier);
    }
  });

  it('container-size selector exists with 20ft/40ft and is shown ONLY for the container tier', () => {
    assert.ok(PANEL.includes('id="containerFields"'));
    assert.ok(PANEL.includes('value="20ft"'));
    assert.ok(PANEL.includes('value="40ft"'));
    assert.ok(PANEL.includes('Tamaño del contenedor'));
    // visibility is gated on the exact container-tier value
    assert.match(
      PANEL,
      /getElementById\('qTier'\)\.value === CONTAINER_TIER/,
    );
    assert.ok(PANEL.includes(`const CONTAINER_TIER = 'Enviar contenedor completo';`));
    // block starts hidden
    assert.match(PANEL, /id="containerFields" hidden/);
  });

  it('form collects cargo description + contact and posts to /quotes', () => {
    assert.ok(PANEL.includes('id="qDesc"'));
    assert.ok(PANEL.includes('id="qName"'));
    assert.ok(PANEL.includes('id="qPhone"'));
    assert.ok(PANEL.includes(`post('/quotes'`));
  });
});

describe('portal mis envíos: tier labels, filter, container number', () => {
  it('tier filter chips cover the service tiers', () => {
    assert.ok(PANEL.includes('id="tierChips"'));
    assert.match(PANEL, /TIER_FILTERS = \['Todos','Contenedor','Pallet','Paquetería','Compra','Varios'\]/);
    assert.match(PANEL, /TIER_SHORT\[s\.serviceTier\] === tierFilter/);
  });

  it('cards label each shipment by tier and render the container number only when present', () => {
    assert.ok(PANEL.includes('function tierPill(s)'));
    // conditional render: absent cleanly when the shipment has no number
    assert.match(PANEL, /\$\{s\.containerNumber \? `[^`]*Contenedor Nº/);
    // absent-cleanly: no unconditional container markup in the card template
  });

  it('detail view shows container number + tier rows only when present', () => {
    assert.match(PANEL, /s\.containerNumber\s*\n?\s*\? `[^`]*Contenedor Nº/);
    assert.match(PANEL, /s\.serviceTier\s*\n?\s*\? `[^`]*Nivel de servicio/);
  });
});

describe('portal shipments: containerNumber + serviceTier store', () => {
  const store = () => createShipmentStore();
  const base = (over = {}) => ({
    clientId: 'cli_1', vesselMmsi: '244780354', vesselName: 'MSK ROY',
    origin: 'Miami', destination: 'Mariel', cargoLabel: 'Contenedor 40ft — pollo',
    ...over,
  });

  it('stores containerNumber and serviceTier on create', () => {
    const s = store().create(base({ containerNumber: 'MSKU 1234567', serviceTier: 'Enviar contenedor completo' }));
    assert.equal(s.containerNumber, 'MSKU 1234567');
    assert.equal(s.serviceTier, 'Enviar contenedor completo');
  });

  it('omits both fields cleanly when not provided', () => {
    const s = store().create(base());
    assert.equal(s.containerNumber, undefined);
    assert.equal(s.serviceTier, undefined);
    assert.ok(!('containerNumber' in JSON.parse(JSON.stringify(s))));
  });

  it('containerNumber validation is loose: non-standard values are accepted', () => {
    const s = store().create(base({ containerNumber: 'REF-INTERNA-99' }));
    assert.equal(s.containerNumber, 'REF-INTERNA-99');
    const s2 = store().create(base({ containerNumber: '  msku 1234567  ' }));
    assert.equal(s2.containerNumber, 'msku 1234567');
  });

  it('rejects unknown service tiers and over-long container numbers', () => {
    assert.throws(() => store().create(base({ serviceTier: 'Enviar mi nave' })), /serviceTier must be one of/);
    assert.throws(() => store().create(base({ containerNumber: 'x'.repeat(33) })), /containerNumber is too long/);
  });

  it('owner update sets/clears both fields', () => {
    const st = store();
    const s = st.create(base());
    st.update(s.id, { containerNumber: 'TCLU 7654321', serviceTier: 'Enviar carga por pallet' });
    const got = st.get(s.id);
    assert.equal(got.containerNumber, 'TCLU 7654321');
    assert.equal(got.serviceTier, 'Enviar carga por pallet');
    st.update(s.id, { containerNumber: '' });
    assert.equal(st.get(s.id).containerNumber, undefined);
  });

  it('tier short labels map every service value', () => {
    assert.equal(tierShortLabel('Enviar contenedor completo'), 'Contenedor');
    assert.equal(tierShortLabel('Enviar carga por pallet'), 'Pallet');
    assert.equal(tierShortLabel('Enviar paquetería'), 'Paquetería');
    assert.equal(tierShortLabel('Comprar mercancía'), 'Compra');
    assert.equal(tierShortLabel('Varios servicios'), 'Varios');
    assert.equal(tierShortLabel(undefined), '');
    assert.equal(Object.keys(TIER_SHORT_LABELS).length, 5);
  });
});

describe('portal containers http', () => {
  const OWNER_KEY = 'test-owner-key';
  const stubVesselLookup = () => ({ vessel: null, track: [] });
  const servers = [];

  async function startApi() {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'portal-nav-test-'));
    const api = createPortalApi({
      dataDir,
      vesselLookup: stubVesselLookup,
      resolveOwnerKey: () => OWNER_KEY,
    });
    const srv = http.createServer((req, res) =>
      api.handler(req, res, () => {
        res.statusCode = 404;
        res.end('nope');
      }),
    );
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const started = { srv, base: `http://127.0.0.1:${srv.address().port}` };
    servers.push(started);
    return started;
  }

  after(() => {
    for (const s of servers) s.srv.close();
  });

  async function call(base, pathname, { method = 'GET', body, cookie, owner = false } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (owner) headers.Authorization = `Bearer ${OWNER_KEY}`;
    const res = await fetch(base + pathname, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch { /* leave null */ }
    return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
  }
  const jar = (res) => (res.setCookie ? res.setCookie.split(';')[0] : '');

  it('admin creates a shipment with containerNumber + tier; client sees both', async () => {
    const { base } = await startApi();
    const created = await call(base, '/admin/clients', {
      method: 'POST', owner: true,
      body: { companyName: 'Acme', contactName: 'Ana', email: 'ana@nav-test.com', password: 'clave-secreta-1' },
    });
    assert.equal(created.status, 201);
    const clientId = created.data.client.id;
    const ship = await call(base, '/admin/shipments', {
      method: 'POST', owner: true,
      body: {
        clientId, vesselMmsi: '244780354', vesselName: 'MSK ROY',
        origin: 'Miami', destination: 'Mariel', cargoLabel: 'Contenedor 40ft — pollo',
        status: 'en_transito', containerNumber: 'MSKU 1234567',
        serviceTier: 'Enviar contenedor completo',
      },
    });
    assert.equal(ship.status, 201);
    assert.equal(ship.data.shipment.containerNumber, 'MSKU 1234567');
    assert.equal(ship.data.shipment.serviceTier, 'Enviar contenedor completo');

    const login = await call(base, '/login', { method: 'POST', body: { email: 'ana@nav-test.com', password: 'clave-secreta-1' } });
    const mine = await call(base, '/shipments', { cookie: jar(login) });
    assert.equal(mine.data.shipments[0].containerNumber, 'MSKU 1234567');
    assert.equal(mine.data.shipments[0].serviceTier, 'Enviar contenedor completo');

    const patched = await call(base, `/admin/shipments/${ship.data.shipment.id}`, {
      method: 'PATCH', owner: true, body: { containerNumber: 'TCLU 9999999' },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.data.shipment.containerNumber, 'TCLU 9999999');
  });

  it('admin console exposes the Cotizaciones pane and container fields', () => {
    assert.ok(ADMIN.includes('data-pane="pQuotes"'));
    assert.ok(ADMIN.includes('id="pQuotes"'));
    assert.ok(ADMIN.includes('id="sCnum"'));
    assert.ok(ADMIN.includes('id="sTier"'));
    assert.ok(ADMIN.includes(`admin('/quotes')`));
    assert.ok(ADMIN.includes('`/quotes/${b.dataset.id}`'));
  });
});
