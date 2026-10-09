import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createLeadStore,
  LEAD_STATUSES,
  BUSINESS_UNITS,
  BUSINESS_UNIT_IDS,
  assertBusinessUnit,
  assertLeadStatus,
  leadKey,
} from '../../server/portal/leads.js';
import { createPortalApi } from '../../server/portal/routes.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('leads store', () => {
  it('tags new leads with the cell-phones business unit and nuevo status', () => {
    const store = createLeadStore();
    const { lead, created } = store.upsert({ name: 'Tienda X', country: 'Panamá' });
    assert.equal(created, true);
    assert.equal(lead.business, 'cell-phones');
    assert.equal(lead.status, 'nuevo');
    assert.ok(lead.id.startsWith('lead_'));
  });

  it('dedupes on (name, country), accent-insensitive', () => {
    const store = createLeadStore();
    store.upsert({ name: 'CronoX Móvil', country: 'República Dominicana', phone: '809-0000' });
    const { lead, created } = store.upsert({
      name: 'cronox movil',
      country: 'republica dominicana',
      phone: '809-1111',
    });
    assert.equal(created, false);
    assert.equal(lead.phone, '809-1111'); // newer non-empty value wins
    assert.equal(store._size(), 1);
  });

  it('merges email without resetting status or notes', () => {
    const store = createLeadStore();
    const { lead } = store.upsert({ name: 'Tienda X', country: 'Panamá' });
    store.update(lead.id, { status: 'contactado', notes: 'llamé el lunes' });
    const merged = store.upsert({ name: 'Tienda X', country: 'Panamá', email: 'a@x.com' });
    assert.equal(merged.created, false);
    assert.equal(merged.lead.email, 'a@x.com');
    assert.equal(merged.lead.status, 'contactado');
    assert.equal(merged.lead.notes, 'llamé el lunes');
  });

  it('rejects unknown status and business unit', () => {
    assert.throws(() => assertLeadStatus('vendido'), /status must be one of/);
    assert.throws(() => assertBusinessUnit('import-export'), /business must be one of/);
    assert.equal(assertBusinessUnit('cell-phones'), 'cell-phones');
  });

  it('filters by business, status, country and free text', () => {
    const store = createLeadStore();
    store.upsert({ name: 'Tienda A', country: 'Chile', business: 'cell-phones', phone: '555-1' });
    store.upsert({ name: 'Tienda B', country: 'Chile', business: 'cell-phones', status: 'contactado' });
    store.upsert({ name: 'Agro SA', country: 'Chile', business: 'trade' });
    assert.equal(store.list({ business: 'cell-phones' }).total, 2);
    assert.equal(store.list({ status: 'contactado' }).total, 1);
    assert.equal(store.list({ q: '555-1' }).total, 1);
    assert.equal(store.list({ country: 'chile' }).total, 3);
    assert.equal(store.list({ business: 'cell-phones', status: 'nuevo' }).total, 1);
  });

  it('reports distinct values and counts', () => {
    const store = createLeadStore();
    store.upsert({ name: 'A', country: 'Chile', region: 'sudamerica', type: 'wholesaler' });
    store.upsert({ name: 'B', country: 'Chile', region: 'sudamerica', type: 'retail store', status: 'cliente' });
    assert.deepEqual(store.distinct('country'), ['Chile']);
    assert.deepEqual(store.countByBusiness(), { 'cell-phones': 2 });
    assert.equal(store.countByStatus('cell-phones').cliente, 1);
    assert.equal(store.countByStatus('cell-phones').nuevo, 1);
  });

  it('leadKey is diacritic-insensitive', () => {
    assert.equal(leadKey('CronoX Móvil', 'República Dominicana'), leadKey('cronox movil', 'republica dominicana'));
  });

  it('exposes the six business units including cell-phones', () => {
    assert.ok(BUSINESS_UNIT_IDS.includes('cell-phones'));
    assert.ok(BUSINESS_UNITS.find((u) => u.id === 'cell-phones'));
    assert.ok(LEAD_STATUSES.includes('nuevo'));
  });
});

describe('import-leads script', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'leads-import-test-'));
  const script = path.join(REPO_ROOT, 'scripts', 'import-leads.mjs');
  const leadsFile = path.join(tmp, 'leads.md');
  const emailsFile = path.join(tmp, 'emails.md');
  const dataDir = path.join(tmp, 'data');

  it('imports a lead file and merges emails re-runnably', () => {
    fs.writeFileSync(
      leadsFile,
      `# CARIBE\n\n## Jamaica\nTienda A | retail store | Kingston | Jamaica | Main St 1 | +1 876-0000 | https://a.example\nTienda B | wholesaler | Kingston | Jamaica | Main St 2 | — | —\n\n# SUDAMÉRICA\n\n## Chile\nTienda C | retail store | Santiago | Chile | Alameda 1 | +56 2 0000 | —\n`,
      'utf8'
    );
    fs.writeFileSync(
      emailsFile,
      `Tienda A | Jamaica | hola@a.example | website contact page\nTienda C | Chile | none found | —\n`,
      'utf8'
    );
    const run = () =>
      execFileSync('node', [script, '--leads', leadsFile, '--emails', emailsFile, '--data', dataDir], {
        encoding: 'utf8',
      });
    const out1 = run();
    assert.match(out1, /import: 3 parsed, 3 created, 0 updated/);
    assert.match(out1, /email merge: 1 entries processed, 1 leads with email set/); // "none found" lines are skipped
    const out2 = run(); // re-run: no duplicates
    assert.match(out2, /import: 3 parsed, 0 created, 3 updated/);
    const snapshot = JSON.parse(fs.readFileSync(path.join(dataDir, 'leads.json'), 'utf8'));
    assert.equal(snapshot.leads.length, 3);
    const a = snapshot.leads.find((l) => l.name === 'Tienda A');
    assert.equal(a.email, 'hola@a.example');
    assert.equal(a.business, 'cell-phones');
    assert.equal(a.region, 'caribe');
    const c = snapshot.leads.find((l) => l.name === 'Tienda C');
    assert.equal(c.email, '');
    assert.equal(c.region, 'sudamerica');
  });
});

describe('portal leads admin API', () => {
  const OWNER_KEY = 'test-owner-key';
  let server;
  let base;

  before(async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'portal-leads-api-test-'));
    const api = createPortalApi({ dataDir, resolveOwnerKey: () => OWNER_KEY });
    // Seed two leads via the store behind the API.
    const { createLeadStore } = await import('../../server/portal/leads.js');
    const store = createLeadStore({
      load: () => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dataDir, 'leads.json'), 'utf8'));
        } catch {
          return null;
        }
      },
      save: (v) => fs.writeFileSync(path.join(dataDir, 'leads.json'), JSON.stringify(v)),
    });
    store.upsert({ name: 'Tienda Seed', country: 'Panamá', business: 'cell-phones', phone: '507-0000' });
    store.upsert({ name: 'Agro Seed', country: 'Panamá', business: 'trade' });
    server = http.createServer((req, res) =>
      api.handler(req, res, () => {
        res.statusCode = 404;
        res.end('nope');
      })
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server?.close();
  });

  async function call(pathname, { method = 'GET', body, owner = false } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (owner) headers.Authorization = `Bearer ${OWNER_KEY}`;
    const res = await fetch(base + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }

  it('rejects admin lead endpoints without the owner key', async () => {
    for (const p of ['/api/portal/admin/leads', '/api/portal/admin/leads/business-units']) {
      const { status } = await call(p);
      assert.equal(status, 401);
    }
  });

  it('lists leads with business filter and search', async () => {
    const { status, data } = await call('/api/portal/admin/leads?business=cell-phones', { owner: true });
    assert.equal(status, 200);
    assert.equal(data.total, 1);
    assert.equal(data.leads[0].name, 'Tienda Seed');
    const q = await call('/api/portal/admin/leads?q=507-0000', { owner: true });
    assert.equal(q.data.total, 1);
    const none = await call('/api/portal/admin/leads?business=cell-phones&q=zzz', { owner: true });
    assert.equal(none.data.total, 0);
  });

  it('exposes business units and filter metadata', async () => {
    const { data } = await call('/api/portal/admin/leads/business-units', { owner: true });
    assert.ok(data.units.some((u) => u.id === 'cell-phones'));
    const f = await call('/api/portal/admin/leads/filters?business=cell-phones', { owner: true });
    assert.ok(f.data.countries.includes('Panamá'));
    assert.equal(f.data.byBusiness['cell-phones'], 1);
  });

  it('updates status and notes, rejects bad status', async () => {
    const list = await call('/api/portal/admin/leads?business=cell-phones', { owner: true });
    const id = list.data.leads[0].id;
    const ok = await call(`/api/portal/admin/leads/${id}`, {
      owner: true,
      method: 'PATCH',
      body: { status: 'interesado', notes: 'pidió lista' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.lead.status, 'interesado');
    assert.equal(ok.data.lead.notes, 'pidió lista');
    const bad = await call(`/api/portal/admin/leads/${id}`, {
      owner: true,
      method: 'PATCH',
      body: { status: 'vendido' },
    });
    assert.equal(bad.status, 400);
    const missing = await call('/api/portal/admin/leads/lead_noexiste', {
      owner: true,
      method: 'PATCH',
      body: { status: 'nuevo' },
    });
    assert.equal(missing.status, 404);
  });
});
