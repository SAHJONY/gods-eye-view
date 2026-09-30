import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createPortalApi, registerPageHtml } from '../../server/portal/routes.js';

/**
 * Self-registration with owner approval:
 * - public form creates a `pending` account that CANNOT log in or see data
 * - owner approve → active (login works); owner reject → never logs in
 * - owner-created accounts are active immediately
 * - duplicate emails rejected, inputs validated, registrations rate-limited
 */
describe('portal self-registration', () => {
  const OWNER_KEY = 'test-owner-key';
  let server;
  let base;

  const stubVesselLookup = () => ({ vessel: null, track: [] });

  async function startApi() {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'portal-register-test-'));
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
    return { srv, base: `http://127.0.0.1:${srv.address().port}` };
  }

  before(async () => {
    const started = await startApi();
    server = started.srv;
    base = started.base;
  });

  after(() => {
    server?.close();
  });

  async function call(pathname, { method = 'GET', body, cookie, owner = false, baseUrl = base } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (owner) headers.Authorization = `Bearer ${OWNER_KEY}`;
    const res = await fetch(baseUrl + pathname, {
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

  const regBody = (over = {}) => ({
    companyName: 'Prospecto SA',
    contactName: 'Pedro Pérez',
    email: 'pedro@prospecto.com',
    phone: '+1 305 555 0100',
    serviceInterest: 'Varios servicios',
    password: 'clave-secreta-1',
    ...over,
  });

  let pendingClient;

  it('registers a pending account without creating a session', async () => {
    const res = await call('/register', { method: 'POST', body: regBody() });
    assert.equal(res.status, 201);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.pending, true);
    assert.equal(res.data.client.status, 'pending');
    assert.equal(res.data.client.email, 'pedro@prospecto.com');
    assert.ok(!('passwordHash' in res.data.client));
    assert.equal(res.setCookie, null, 'registration must not log anyone in');
    pendingClient = res.data.client;
  });

  it('a pending account cannot log in (401 pending_approval)', async () => {
    const res = await call('/login', {
      method: 'POST',
      body: { email: 'pedro@prospecto.com', password: 'clave-secreta-1' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'pending_approval');
  });

  it('a pending account cannot fetch shipments (no session possible)', async () => {
    const res = await call('/shipments');
    assert.equal(res.status, 401);
  });

  it('stores the service interest on the client record', async () => {
    const res = await call('/register', {
      method: 'POST',
      body: regBody({ email: 'interes@x.com', companyName: 'Interés SA', serviceInterest: 'Comprar mercancía' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.client.serviceInterest, 'Comprar mercancía');

    const listed = await call('/admin/clients', { owner: true });
    const found = listed.data.clients.find((c) => c.email === 'interes@x.com');
    assert.equal(found.serviceInterest, 'Comprar mercancía');
  });

  it('rejects a missing or invalid service interest (only the 3 allowed values)', async () => {
    const fresh = await startApi();
    try {
      for (const bad of ['', '  ', 'Quiero de todo', 'Enviar mi carga', 'Ambos', 'comprar mercancía', 'COMPRAR MERCANCÍA']) {
        const res = await call('/register', {
          method: 'POST',
          baseUrl: fresh.base,
          body: regBody({ email: `svc-${Date.now()}-${bad.length}@x.com`, serviceInterest: bad }),
        });
        assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
        assert.equal(res.data.error, 'serviceInterest_invalid');
      }
      const ok = await call('/register', {
        method: 'POST',
        baseUrl: fresh.base,
        body: regBody({ email: 'enviar@x.com', serviceInterest: 'Enviar carga por pallet' }),
      });
      assert.equal(ok.status, 201);
      assert.equal(ok.data.client.serviceInterest, 'Enviar carga por pallet');
    } finally {
      fresh.srv.close();
    }
  });

  it('rejects duplicate emails (against pending and active accounts)', async () => {
    const dupPending = await call('/register', { method: 'POST', body: regBody() });
    assert.equal(dupPending.status, 409);
    assert.equal(dupPending.data.error, 'email_taken');

    // Owner-created active account with the same email is also a conflict.
    const created = await call('/admin/clients', {
      method: 'POST',
      owner: true,
      body: { companyName: 'Activa SA', email: 'activa@x.com', password: 'clave-secreta-2' },
    });
    assert.equal(created.status, 201);
    const dupActive = await call('/register', {
      method: 'POST',
      body: regBody({ email: 'ACTIVA@x.com', companyName: 'Otra' }),
    });
    assert.equal(dupActive.status, 409);
  });

  it('validates every input server-side', async () => {
    const fresh = await startApi();
    try {
      const cases = [
        [{ ...regBody(), companyName: '' }, 400],
        [{ ...regBody(), contactName: '  ' }, 400],
        [{ ...regBody(), email: 'not-an-email' }, 400],
        [{ ...regBody(), phone: '123' }, 400],
        [{ ...regBody(), password: 'corta' }, 400],
      ];
      for (const [body, want] of cases) {
        const res = await call('/register', { method: 'POST', baseUrl: fresh.base, body });
        assert.equal(res.status, want, JSON.stringify(body));
      }
    } finally {
      fresh.srv.close();
    }
  });

  it('owner approve flips the account to active; login then works', async () => {
    const approved = await call(`/admin/clients/${pendingClient.id}/approve`, {
      method: 'POST',
      owner: true,
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.client.status, 'active');

    const login = await call('/login', {
      method: 'POST',
      body: { email: 'pedro@prospecto.com', password: 'clave-secreta-1' },
    });
    assert.equal(login.status, 200);
    assert.ok(jar(login).length > 0);

    const me = await call('/me', { cookie: jar(login) });
    assert.equal(me.status, 200);
    assert.equal(me.data.client.status, 'active');

    const ships = await call('/shipments', { cookie: jar(login) });
    assert.equal(ships.status, 200);
    assert.deepEqual(ships.data.shipments, []);
  });

  it('owner reject blocks the account forever (401)', async () => {
    const reg = await call('/register', {
      method: 'POST',
      body: regBody({ email: 'rechazado@x.com', companyName: 'Rechazado SA' }),
    });
    assert.equal(reg.status, 201);
    const rejected = await call(`/admin/clients/${reg.data.client.id}/reject`, {
      method: 'POST',
      owner: true,
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.data.client.status, 'rejected');

    const login = await call('/login', {
      method: 'POST',
      body: { email: 'rechazado@x.com', password: 'clave-secreta-1' },
    });
    assert.equal(login.status, 401);
    assert.equal(login.data.error, 'invalid_credentials');
  });

  it('approve/reject of an unknown client is 404, and both need the owner key', async () => {
    const noKey = await call('/admin/clients/cli_nope/approve', { method: 'POST' });
    assert.equal(noKey.status, 401);
    const missing = await call('/admin/clients/cli_nope/approve', { method: 'POST', owner: true });
    assert.equal(missing.status, 404);
  });

  it('owner-created accounts are active immediately and can log in', async () => {
    const created = await call('/admin/clients', {
      method: 'POST',
      owner: true,
      body: { companyName: 'Directa SA', email: 'directa@x.com', password: 'clave-secreta-3' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.client.status, 'active');
    const login = await call('/login', {
      method: 'POST',
      body: { email: 'directa@x.com', password: 'clave-secreta-3' },
    });
    assert.equal(login.status, 200);
  });

  it('rate-limits registrations per IP', async () => {
    // Fresh API instance: its own rate limiter, unaffected by the
    // registrations the other tests already made.
    const fresh = await startApi();
    try {
      let limited = false;
      for (let i = 0; i < 15; i++) {
        const res = await call('/register', {
          method: 'POST',
          baseUrl: fresh.base,
          body: regBody({ email: `rl${i}@x.com`, companyName: `RL ${i}` }),
        });
        if (res.status === 429) {
          limited = true;
          assert.equal(res.data.error, 'too_many_attempts');
          break;
        }
        assert.equal(res.status, 201);
      }
      assert.ok(limited, 'expected a 429 within 15 attempts');
    } finally {
      fresh.srv.close();
    }
  });

  it('serves the registration page with no auth, ending in the 3 steps', () => {
    const sourceRoot = path.resolve(import.meta.dirname, '..', '..');
    const html = registerPageHtml(sourceRoot);
    assert.ok(html.includes('<title>Registro'), 'has the registration title');
    assert.ok(html.includes('/api/portal/register'), 'form posts to the register endpoint');
    assert.ok(html.includes('Le activamos su acceso de cliente.'));
    assert.ok(html.includes('Mueva su carga con nosotros.'));
    assert.ok(html.includes('El seguimiento se activa solo cuando su contenedor esté a bordo.'));
    assert.ok(!html.toLowerCase().includes('passwordHash'), 'no secrets in the page');
  });
});
