import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createPortalApi } from '../../server/portal/routes.js';
import { createQuoteStore, QUOTE_STATUSES, CONTAINER_SIZES, CONTAINER_TIER } from '../../server/portal/quotes.js';

/**
 * Quote requests (Cotizar tab):
 * - store: create validates tier, requires containerSize for the container
 *   tier, ignores it for other tiers; listAll is pending-first; status
 *   transitions validated
 * - http: client submits (201, lands as pending), validation 400s,
 *   demo session is 403, owner triages via admin
 * - account: password change verifies current, enforces min length, rotates
 *   the session
 */
describe('portal quote store', () => {
  const store = () => createQuoteStore();

  it('creates a pending quote with the container tier + size', () => {
    const q = store().create({
      clientId: 'cli_1', companyName: 'Acme', serviceTier: 'Enviar contenedor completo',
      containerSize: '40ft', cargoDescription: '500 cajas de pollo', origin: 'Miami',
      destination: 'Mariel', contactName: 'Ana', contactPhone: '+1 305 555 0100',
      contactEmail: 'ana@acme.com',
    });
    assert.equal(q.status, 'pending');
    assert.equal(q.containerSize, '40ft');
    assert.equal(q.origin, 'Miami');
    assert.ok(q.id.startsWith('quo_'));
  });

  it('requires containerSize for the container tier', () => {
    assert.throws(
      () => store().create({
        clientId: 'cli_1', serviceTier: 'Enviar contenedor completo',
        cargoDescription: 'carga', contactName: 'Ana', contactPhone: '+13055550100',
      }),
      /containerSize is required/,
    );
    assert.throws(
      () => store().create({
        clientId: 'cli_1', serviceTier: 'Enviar contenedor completo', containerSize: '10ft',
        cargoDescription: 'carga', contactName: 'Ana', contactPhone: '+13055550100',
      }),
      /containerSize is required/,
    );
  });

  it('accepts both container sizes: ' + CONTAINER_SIZES.join('/'), () => {
    for (const size of CONTAINER_SIZES) {
      const q = store().create({
        clientId: 'cli_1', serviceTier: CONTAINER_TIER, containerSize: size,
        cargoDescription: 'carga', contactName: 'Ana', contactPhone: '+13055550100',
      });
      assert.equal(q.containerSize, size);
    }
  });

  it('ignores containerSize for non-container tiers', () => {
    const q = store().create({
      clientId: 'cli_1', serviceTier: 'Enviar paquetería', containerSize: '40ft',
      cargoDescription: '3 cajas', contactName: 'Ana', contactPhone: '+13055550100',
    });
    assert.equal(q.containerSize, undefined);
  });

  it('rejects unknown tiers and missing contact fields', () => {
    const base = {
      clientId: 'cli_1', serviceTier: 'Enviar mi nave', cargoDescription: 'carga',
      contactName: 'Ana', contactPhone: '+13055550100',
    };
    assert.throws(() => store().create(base), /serviceTier must be one of/);
    assert.throws(() => store().create({ ...base, serviceTier: 'Enviar paquetería', cargoDescription: '' }), /cargoDescription is required/);
    assert.throws(() => store().create({ ...base, serviceTier: 'Enviar paquetería', contactName: '' }), /contactName is required/);
    assert.throws(() => store().create({ ...base, serviceTier: 'Enviar paquetería', contactPhone: '123' }), /contactPhone is invalid/);
  });

  it('listAll is pending-first, then newest; updateStatus validates', () => {
    const s = store();
    const a = s.create({ clientId: 'c1', serviceTier: 'Enviar paquetería', cargoDescription: 'a', contactName: 'A', contactPhone: '+13050000001' });
    const b = s.create({ clientId: 'c1', serviceTier: 'Enviar paquetería', cargoDescription: 'b', contactName: 'B', contactPhone: '+13050000002' });
    s.updateStatus(a.id, 'done');
    const all = s.listAll();
    assert.equal(all[0].id, b.id); // pending first
    assert.equal(all[1].id, a.id);
    assert.throws(() => s.updateStatus(b.id, 'archived'), /status must be one of/);
    assert.ok(QUOTE_STATUSES.includes('pending'));
  });

  it('listForClient scopes to the owning client', () => {
    const s = store();
    s.create({ clientId: 'c1', serviceTier: 'Enviar paquetería', cargoDescription: 'a', contactName: 'A', contactPhone: '+13050000001' });
    s.create({ clientId: 'c2', serviceTier: 'Enviar paquetería', cargoDescription: 'b', contactName: 'B', contactPhone: '+13050000002' });
    assert.equal(s.listForClient('c1').length, 1);
    assert.equal(s.listForClient('c2').length, 1);
    assert.equal(s.listForClient('nobody').length, 0);
  });
});

describe('portal quotes + account http', () => {
  const OWNER_KEY = 'test-owner-key';
  const stubVesselLookup = () => ({ vessel: null, track: [] });
  const servers = [];

  async function startApi() {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'portal-quotes-test-'));
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
    const started = { srv, base: `http://127.0.0.1:${srv.address().port}`, api };
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

  let n = 0;
  async function makeClient(base) {
    n += 1;
    const email = `quote-client-${n}@test.com`;
    const created = await call(base, '/admin/clients', {
      method: 'POST', owner: true,
      body: { companyName: 'Acme Foods', contactName: 'Ana', email, password: 'clave-secreta-1', serviceInterest: 'Varios servicios' },
    });
    assert.equal(created.status, 201);
    const login = await call(base, '/login', { method: 'POST', body: { email, password: 'clave-secreta-1' } });
    assert.equal(login.status, 200);
    return { cookie: jar(login), id: created.data.client.id };
  }

  const quoteBody = (over = {}) => ({
    serviceTier: 'Enviar contenedor completo',
    containerSize: '40ft',
    cargoDescription: '500 cajas de pollo congelado',
    origin: 'Miami',
    destination: 'Mariel',
    contactName: 'Ana',
    contactPhone: '+1 305 555 0100',
    contactEmail: 'ana@acme.com',
    ...over,
  });

  it('client submits a container quote → 201 pending, visible to owner', async () => {
    const { base } = await startApi();
    const { cookie, id } = await makeClient(base);
    const res = await call(base, '/quotes', { method: 'POST', cookie, body: quoteBody() });
    assert.equal(res.status, 201);
    assert.equal(res.data.quote.status, 'pending');
    assert.equal(res.data.quote.containerSize, '40ft');
    assert.equal(res.data.quote.clientId, id);

    const mine = await call(base, '/quotes', { cookie });
    assert.equal(mine.status, 200);
    assert.equal(mine.data.quotes.length, 1);

    const admin = await call(base, '/admin/quotes', { owner: true });
    assert.equal(admin.status, 200);
    assert.equal(admin.data.quotes.length, 1);
    assert.equal(admin.data.quotes[0].status, 'pending');

    const done = await call(base, `/admin/quotes/${res.data.quote.id}`, {
      method: 'PATCH', owner: true, body: { status: 'done' },
    });
    assert.equal(done.status, 200);
    assert.equal(done.data.quote.status, 'done');
  });

  it('quote validation: missing size for container tier, bad tier, missing fields', async () => {
    const { base } = await startApi();
    const { cookie } = await makeClient(base);
    // missing containerSize for the container tier
    let r = await call(base, '/quotes', { method: 'POST', cookie, body: quoteBody({ containerSize: '' }) });
    assert.equal(r.status, 400);
    // bad tier
    r = await call(base, '/quotes', { method: 'POST', cookie, body: quoteBody({ serviceTier: 'Enviar mi nave' }) });
    assert.equal(r.status, 400);
    // missing description
    r = await call(base, '/quotes', { method: 'POST', cookie, body: quoteBody({ cargoDescription: '' }) });
    assert.equal(r.status, 400);
    // missing contact name
    r = await call(base, '/quotes', { method: 'POST', cookie, body: quoteBody({ contactName: '' }) });
    assert.equal(r.status, 400);
  });

  it('non-container tiers submit without a size', async () => {
    const { base } = await startApi();
    const { cookie } = await makeClient(base);
    const r = await call(base, '/quotes', {
      method: 'POST', cookie,
      body: quoteBody({ serviceTier: 'Enviar paquetería', containerSize: '' }),
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.quote.containerSize, undefined);
  });

  it('demo session cannot submit quotes (view-only)', async () => {
    const { base } = await startApi();
    const demo = await call(base, '/demo', { method: 'POST' });
    assert.equal(demo.status, 200);
    const r = await call(base, '/quotes', { method: 'POST', cookie: jar(demo), body: quoteBody() });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'demo_readonly');
  });

  it('unauthenticated quote requests are rejected', async () => {
    const { base } = await startApi();
    const r = await call(base, '/quotes', { method: 'POST', body: quoteBody() });
    assert.equal(r.status, 401);
  });

  it('quotes are scoped: client B never sees client A quotes', async () => {
    const { base } = await startApi();
    const a = await makeClient(base);
    const b = await makeClient(base);
    await call(base, '/quotes', { method: 'POST', cookie: a.cookie, body: quoteBody() });
    const mineB = await call(base, '/quotes', { cookie: b.cookie });
    assert.equal(mineB.data.quotes.length, 0);
  });

  it('password change: wrong current rejected, short rejected, success rotates session', async () => {
    const { base } = await startApi();
    const { cookie } = await makeClient(base);
    let r = await call(base, '/account/password', {
      method: 'POST', cookie, body: { currentPassword: 'no-es-esta', newPassword: 'nueva-clave-22' },
    });
    assert.equal(r.status, 401);
    r = await call(base, '/account/password', {
      method: 'POST', cookie, body: { currentPassword: 'clave-secreta-1', newPassword: 'corta' },
    });
    assert.equal(r.status, 400);
    r = await call(base, '/account/password', {
      method: 'POST', cookie, body: { currentPassword: 'clave-secreta-1', newPassword: 'nueva-clave-22' },
    });
    assert.equal(r.status, 200);
    assert.ok(r.setCookie, 'fresh session cookie issued');
    // old session is dead
    const dead = await call(base, '/me', { cookie });
    assert.equal(dead.status, 401);
    // new password works with the rotated session
    const me = await call(base, '/me', { cookie: jar(r) });
    assert.equal(me.status, 200);
  });

  it('demo session cannot change the password', async () => {
    const { base } = await startApi();
    const demo = await call(base, '/demo', { method: 'POST' });
    const r = await call(base, '/account/password', {
      method: 'POST', cookie: jar(demo), body: { currentPassword: 'x', newPassword: 'nueva-clave-22' },
    });
    assert.equal(r.status, 403);
  });
});
