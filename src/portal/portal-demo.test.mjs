import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createPortalApi, demoPageHtml } from '../../server/portal/routes.js';

/**
 * Prospect demo mode:
 * - "Ver demostración" logs into a view-only demo account (no password),
 *   rate-limited, labeled DEMOSTRACIÓN
 * - exactly ONE demo shipment (demo:true, permanently en tránsito), never
 *   mixed with real shipments and ignored by the AIS watcher
 * - demo sessions cannot reach real shipments or admin routes
 * - GET /portal/demo drops the prospect straight into the demo view
 * - the demo view ends with the REGÍSTRESE AQUÍ registration CTA
 */
describe('portal demo mode', () => {
  const OWNER_KEY = 'test-owner-key';
  let server;
  let base;
  let api;

  // The demo vessel "sits" at the destination port: a real en_transito
  // shipment WOULD flip to en_puerto — the demo must never flip.
  const stubVesselLookup = (mmsi) => ({
    mmsi: String(mmsi),
    vessel: { mmsi: String(mmsi), name: 'DEMO VESSEL', lat: 23.01, lon: -82.75, speed: 0 },
    track: [],
  });

  before(async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'portal-demo-test-'));
    api = createPortalApi({
      dataDir,
      vesselLookup: stubVesselLookup,
      resolveOwnerKey: () => OWNER_KEY,
    });
    server = http.createServer((req, res) =>
      api.handler(req, res, () => {
        res.statusCode = 404;
        res.end('nope');
      }),
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server?.close();
  });

  async function call(pathname, { method = 'GET', body, cookie, owner = false } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (owner) headers.Authorization = `Bearer ${OWNER_KEY}`;
    const res = await fetch(base + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // leave null
    }
    return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
  }
  const jar = (res) => (res.setCookie ? res.setCookie.split(';')[0] : '');

  let demoCookie;
  let demoShipmentId;
  let realShipmentId;
  let realCookie;

  it('demo login works with no password and sets a session', async () => {
    const res = await call('/demo', { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.demo, true);
    assert.equal(res.data.client.id, 'demo');
    assert.equal(res.data.client.demo, true);
    assert.ok(res.data.shipmentId);
    assert.ok(jar(res).length > 0, 'demo session cookie is set');
    demoCookie = jar(res);
    demoShipmentId = res.data.shipmentId;
  });

  it('the demo sees exactly the demo client profile', async () => {
    const res = await call('/me', { cookie: demoCookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.client.id, 'demo');
    assert.equal(res.data.client.demo, true);
  });

  it('the demo sees exactly ONE demo shipment, permanently en tránsito', async () => {
    const res = await call('/shipments', { cookie: demoCookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.shipments.length, 1);
    const s = res.data.shipments[0];
    assert.equal(s.demo, true);
    assert.equal(s.status, 'en_transito');
    assert.equal(s.id, demoShipmentId);
  });

  it('the demo can read the demo vessel position (single-vessel slice)', async () => {
    const res = await call(`/shipments/${demoShipmentId}/vessel`, { cookie: demoCookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.vessel.mmsi, res.data.shipment.vesselMmsi);
    assert.ok(Array.isArray(res.data.track));
  });

  it('the demo cannot reach real shipments (404, existence not leaked)', async () => {
    const created = await call('/admin/clients', {
      method: 'POST',
      owner: true,
      body: { companyName: 'Real SA', email: 'real@x.com', password: 'clave-secreta-9' },
    });
    const ship = await call('/admin/shipments', {
      method: 'POST',
      owner: true,
      body: {
        clientId: created.data.client.id,
        vesselMmsi: '999999999',
        vesselName: 'REAL VESSEL',
        origin: 'Houston',
        destination: 'Mariel',
        cargoLabel: 'Contenedor 40ft — real',
        status: 'en_transito',
        originLat: 29.72,
        originLon: -95.08,
        destLat: 23.01,
        destLon: -82.75,
      },
    });
    assert.equal(ship.status, 201);
    realShipmentId = ship.data.shipment.id;

    const demoSees = await call('/shipments', { cookie: demoCookie });
    assert.equal(demoSees.data.shipments.length, 1, 'still exactly one demo shipment');

    const byId = await call(`/shipments/${realShipmentId}`, { cookie: demoCookie });
    assert.equal(byId.status, 404);
    const vessel = await call(`/shipments/${realShipmentId}/vessel`, { cookie: demoCookie });
    assert.equal(vessel.status, 404);
  });

  it('a real client never sees the demo shipment', async () => {
    const login = await call('/login', {
      method: 'POST',
      body: { email: 'real@x.com', password: 'clave-secreta-9' },
    });
    assert.equal(login.status, 200);
    realCookie = jar(login);

    const list = await call('/shipments', { cookie: realCookie });
    assert.equal(list.status, 200);
    assert.ok(list.data.shipments.every((s) => s.demo !== true));
    assert.ok(list.data.shipments.some((s) => s.id === realShipmentId));

    const cross = await call(`/shipments/${demoShipmentId}`, { cookie: realCookie });
    assert.equal(cross.status, 404);
  });

  it('the demo cannot reach admin routes', async () => {
    const clients = await call('/admin/clients', { cookie: demoCookie });
    assert.equal(clients.status, 401);
    const tick = await call('/admin/watcher/tick', { method: 'POST', cookie: demoCookie });
    assert.equal(tick.status, 401);
    const demoCfg = await call('/admin/demo', { cookie: demoCookie });
    assert.equal(demoCfg.status, 401, 'owner guard rejects before any admin routing');
  });

  it('the owner lists never include the demo shipment', async () => {
    const res = await call('/admin/shipments', { owner: true });
    assert.equal(res.status, 200);
    assert.ok(res.data.shipments.every((s) => s.demo !== true));
    assert.ok(!res.data.shipments.some((s) => s.id === demoShipmentId));
  });

  it('the AIS watcher never touches the demo shipment', async () => {
    // The stub places every vessel at the destination port: the real
    // en_transito shipment flips to en_puerto, the demo must not.
    const transitions = api.watcher.tick().filter(Boolean);
    assert.ok(
      transitions.every((t) => t.shipmentId !== demoShipmentId),
      'no transition may target the demo shipment',
    );
    const demo = api.stores.shipmentStore.get(demoShipmentId);
    assert.equal(demo.status, 'en_transito', 'demo stays en tránsito for show');
    const real = api.stores.shipmentStore.get(realShipmentId);
    assert.equal(real.status, 'en_puerto', 'sanity: a real shipment DID flip');
  });

  it('demo login is rate-limited', async () => {
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const res = await call('/demo', { method: 'POST' });
      if (res.status === 429) {
        limited = true;
        assert.equal(res.data.error, 'too_many_attempts');
        break;
      }
      assert.equal(res.status, 200);
    }
    assert.ok(limited, 'expected a 429 within 12 attempts');
  });

  it('GET /portal/demo returns the demo view with no auth, ending in the registration CTA', () => {
    const sourceRoot = path.resolve(import.meta.dirname, '..', '..');
    const html = demoPageHtml(sourceRoot);
    // Auto-demo bootstrap: the page starts the demo session itself.
    assert.ok(html.includes('window.__PORTAL_AUTODEMO=true'));
    assert.ok(html.includes('/api/portal/demo'));
    // Labeled DEMOSTRACIÓN.
    assert.ok(html.includes('DEMOSTRACIÓN'));
    // Registration CTA with the exact copy.
    assert.ok(html.includes('¿Quiere este seguimiento para su carga?'));
    assert.ok(html.includes('REGÍSTRESE AQUÍ'));
    assert.ok(html.includes('href="/portal/registro"'));
    assert.ok(html.includes('Le activamos su acceso de cliente.'));
    assert.ok(html.includes('Mueva su carga con nosotros.'));
    assert.ok(html.includes('El seguimiento se activa solo cuando su contenedor esté a bordo.'));
    // No real data is embedded in the page: everything loads via the
    // session-scoped demo API.
    assert.ok(!html.includes('Real SA'));
    assert.ok(!html.includes('passwordHash'));
  });
});
