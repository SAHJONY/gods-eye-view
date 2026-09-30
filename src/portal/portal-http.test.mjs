import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createPortalApi } from '../../server/portal/routes.js';

/**
 * End-to-end through a real HTTP server: auth, per-client scoping,
 * single-vessel filtering, admin guard, rate limiting.
 */
describe('portal HTTP API', () => {
  const OWNER_KEY = 'test-owner-key';
  const vesselLookups = [];
  let server;
  let base;

  const stubVesselLookup = (mmsi) => {
    vesselLookups.push(String(mmsi));
    return {
      mmsi: String(mmsi),
      vessel: { mmsi: String(mmsi), name: 'STUB VESSEL', lat: 12.5, lon: -45.1 },
      track: [{ lat: 12.5, lon: -45.1 }],
    };
  };

  before(async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'portal-http-test-'));
    const api = createPortalApi({
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
    return {
      status: res.status,
      data,
      setCookie: res.headers.get('set-cookie'),
    };
  }
  const jar = (res) => (res.setCookie ? res.setCookie.split(';')[0] : '');

  let clientA;
  let clientB;
  let shipmentA;
  let shipmentB;
  let cookieA;

  it('admin guard: rejects without the owner key', async () => {
    const res = await call('/admin/clients');
    assert.equal(res.status, 401);
    const wrong = await fetch(base + '/admin/clients', {
      headers: { Authorization: 'Bearer wrong' },
    });
    assert.equal(wrong.status, 401);
  });

  it('admin creates two clients', async () => {
    const a = await call('/admin/clients', {
      method: 'POST',
      owner: true,
      body: {
        companyName: 'Cliente A',
        contactName: 'Ana',
        email: 'ana@cliente-a.com',
        password: 'clave-secreta-a1',
      },
    });
    assert.equal(a.status, 201);
    assert.ok(!JSON.stringify(a.data).includes('passwordHash'));
    clientA = a.data.client;

    const b = await call('/admin/clients', {
      method: 'POST',
      owner: true,
      body: {
        companyName: 'Cliente B',
        contactName: 'Beto',
        email: 'beto@cliente-b.com',
        password: 'clave-secreta-b2',
      },
    });
    assert.equal(b.status, 201);
    clientB = b.data.client;
  });

  it('admin creates one shipment per client', async () => {
    const a = await call('/admin/shipments', {
      method: 'POST',
      owner: true,
      body: {
        clientId: clientA.id,
        vesselMmsi: '11111',
        vesselName: 'BARCO A',
        origin: 'Houston',
        destination: 'Mariel',
        cargoLabel: 'Contenedor 40ft — alimentos',
        status: 'en_transito',
      },
    });
    assert.equal(a.status, 201);
    shipmentA = a.data.shipment;

    const b = await call('/admin/shipments', {
      method: 'POST',
      owner: true,
      body: {
        clientId: clientB.id,
        vesselMmsi: '22222',
        vesselName: 'BARCO B',
        origin: 'Rotterdam',
        destination: 'Mariel',
        cargoLabel: 'Contenedor 20ft — medicinas',
        status: 'pendiente',
      },
    });
    assert.equal(b.status, 201);
    shipmentB = b.data.shipment;
  });

  it('login rejects bad credentials without leaking email existence', async () => {
    const bad = await call('/login', {
      method: 'POST',
      body: { email: 'ana@cliente-a.com', password: 'incorrecta-1' },
    });
    assert.equal(bad.status, 401);
    assert.equal(bad.data.error, 'invalid_credentials');

    const unknown = await call('/login', {
      method: 'POST',
      body: { email: 'nadie@example.com', password: 'incorrecta-1' },
    });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.data.error, 'invalid_credentials');
  });

  it('client A logs in and sees only their shipment', async () => {
    const login = await call('/login', {
      method: 'POST',
      body: { email: 'ana@cliente-a.com', password: 'clave-secreta-a1' },
    });
    assert.equal(login.status, 200);
    assert.ok(login.setCookie?.includes('HttpOnly'));
    assert.ok(login.setCookie?.includes('SameSite=Lax'));
    cookieA = jar(login);

    const me = await call('/me', { cookie: cookieA });
    assert.equal(me.status, 200);
    assert.equal(me.data.client.email, 'ana@cliente-a.com');

    const list = await call('/shipments', { cookie: cookieA });
    assert.equal(list.status, 200);
    assert.equal(list.data.shipments.length, 1);
    assert.equal(list.data.shipments[0].id, shipmentA.id);
  });

  it('client A cannot read client B data (404, no leak)', async () => {
    const one = await call(`/shipments/${shipmentB.id}`, { cookie: cookieA });
    assert.equal(one.status, 404);
    const vessel = await call(`/shipments/${shipmentB.id}/vessel`, { cookie: cookieA });
    assert.equal(vessel.status, 404);
  });

  it('vessel endpoint returns ONLY the client vessel (filtered by MMSI)', async () => {
    vesselLookups.length = 0;
    const res = await call(`/shipments/${shipmentA.id}/vessel`, { cookie: cookieA });
    assert.equal(res.status, 200);
    assert.deepEqual(vesselLookups, ['11111']);
    assert.equal(res.data.vessel.mmsi, '11111');
    assert.equal(res.data.shipment.id, shipmentA.id);
    // The raw feed is never dumped: exactly one vessel object.
    assert.ok(!Array.isArray(res.data.vessel));
  });

  it('unauthenticated requests are rejected', async () => {
    assert.equal((await call('/me')).status, 401);
    assert.equal((await call('/shipments')).status, 401);
    assert.equal((await call(`/shipments/${shipmentA.id}`)).status, 401);
  });

  it('logout invalidates the session', async () => {
    const out = await call('/logout', { method: 'POST', cookie: cookieA });
    assert.equal(out.status, 200);
    assert.equal((await call('/me', { cookie: cookieA })).status, 401);
  });

  it('rate-limits repeated login attempts', async () => {
    const email = 'martillo@example.com';
    let last;
    for (let i = 0; i < 11; i++) {
      last = await call('/login', { method: 'POST', body: { email, password: 'x'.repeat(9) } });
    }
    assert.equal(last.status, 429);
    assert.equal(last.data.error, 'too_many_attempts');
  });

  it('deactivated clients lose access immediately', async () => {    const login = await call('/login', {
      method: 'POST',
      body: { email: 'beto@cliente-b.com', password: 'clave-secreta-b2' },
    });
    const cookieB = jar(login);
    assert.equal((await call('/me', { cookie: cookieB })).status, 200);

    const patched = await call(`/admin/clients/${clientB.id}`, {
      method: 'PATCH',
      owner: true,
      body: { active: false },
    });
    assert.equal(patched.status, 200);

    // Old session is dead and login is refused.
    assert.equal((await call('/me', { cookie: cookieB })).status, 401);
    const relogin = await call('/login', {
      method: 'POST',
      body: { email: 'beto@cliente-b.com', password: 'clave-secreta-b2' },
    });
    assert.equal(relogin.status, 401);
  });

  it('watcher admin endpoints are owner-guarded and report status', async () => {
    assert.equal((await call('/watcher/status', { owner: true })).status, 404);
    const denied = await call('/admin/watcher/status');
    assert.equal(denied.status, 401);
    const status = await call('/admin/watcher/status', { owner: true });
    assert.equal(status.status, 200);
    assert.equal(status.data.geofenceKm, 15);
    const tick = await call('/admin/watcher/tick', { method: 'POST', owner: true });
    assert.equal(tick.status, 200);
    assert.ok(Array.isArray(tick.data.transitions));
  });
});
