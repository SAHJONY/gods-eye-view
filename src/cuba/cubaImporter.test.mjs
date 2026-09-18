// Unit tests for the Cuba CRM CSV importer: cubaImporter.js.
// All fixture values are deliberately fictional. No real buyers or requests
// appear anywhere in these fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUYER_CSV_HEADERS,
  REQUEST_CSV_HEADERS,
  CSV_IMPORT_INSTRUCTIONS,
  buyerCsvTemplate,
  parseCubaCsv,
  buyersToCsv,
} from './cubaImporter.js';

test('buyer CSV headers — no address/registration columns (Blocker #4)', () => {
  const headerStr = BUYER_CSV_HEADERS.join(',').toLowerCase();
  assert.ok(!headerStr.includes('address'));
  assert.ok(!headerStr.includes('registration'));
  assert.ok(BUYER_CSV_HEADERS.includes('name'));
  assert.ok(BUYER_CSV_HEADERS.includes('province'));
});

test('buyerCsvTemplate: header-only, zero invented people/companies', () => {
  const tpl = buyerCsvTemplate();
  const lines = tpl
    .split('\n')
    .filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1, 'template must be header-only');
  assert.equal(lines[0], BUYER_CSV_HEADERS.join(','));
  const low = tpl.toLowerCase();
  assert.ok(!low.includes('ejemplo'));
});

test('CSV_IMPORT_INSTRUCTIONS: real-data-only, bilingual', () => {
  assert.ok(CSV_IMPORT_INSTRUCTIONS.es.length > 0);
  assert.ok(CSV_IMPORT_INSTRUCTIONS.en.length > 0);
  assert.match(CSV_IMPORT_INSTRUCTIONS.es, /REAL/i);
});

test('parseCubaCsv: parses buyer rows, drops address/registration columns', () => {
  const csv = [
    'name,type,province,street_address,registration_number,contactWhatsapp',
    '"MIPYME Ficticia SRL",mipyme-privada,La Habana,"Calle Falsa 123","REG-1","+53-555-0101"',
  ].join('\n');
  const out = parseCubaCsv(csv);
  assert.equal(out.errors, 0);
  assert.equal(out.buyers.length, 1);
  const b = out.buyers[0];
  assert.equal(b.name, 'MIPYME Ficticia SRL');
  assert.equal(b.province, 'La Habana');
  assert.equal(b.contact.whatsapp, '+53-555-0101');
  assert.ok(!('street_address' in b));
  assert.ok(!('registration_number' in b));
});

test('parseCubaCsv: quotes and commas inside fields', () => {
  const csv = [
    'name,province,activity',
    '"Ficticio, Compañía SRL",Camagüey,"comercio, venta"',
  ].join('\n');
  const out = parseCubaCsv(csv);
  assert.equal(out.buyers[0].name, 'Ficticio, Compañía SRL');
  assert.equal(out.buyers[0].activity, 'comercio, venta');
});

test('parseCubaCsv: #REQUESTS section with request headers', () => {
  const csv = [
    'name,province',
    '"Solicitante Ficticio",Holguín',
    '#REQUESTS',
    'ref,product,quantity,targetPrice',
    'CUBA-700,"Arroz pilado",5000,0.65',
  ].join('\n');
  const out = parseCubaCsv(csv);
  assert.equal(out.buyers.length, 1);
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0].ref, 'CUBA-700');
  assert.equal(out.requests[0].quantity, 5000);
  assert.equal(out.requests[0].targetPrice, 0.65);
});

test('parseCubaCsv: unknown request status normalizes to intake', () => {
  const csv = [
    '#REQUESTS',
    'ref,product,status',
    'CUBA-701,Aceite,banana',
  ].join('\n');
  const out = parseCubaCsv(csv);
  assert.equal(out.requests[0].status, 'intake');
});

test('parseCubaCsv: row without a name counts as error, not a buyer', () => {
  const csv = ['name,province', ',Granma'].join('\n');
  const out = parseCubaCsv(csv);
  assert.equal(out.buyers.length, 0);
  assert.equal(out.errors, 1);
});

test('parseCubaCsv: invalid input returns empty result (not null)', () => {
  for (const bad of ['', '   ', null, undefined, 123]) {
    const out = parseCubaCsv(bad);
    assert.deepEqual(out.buyers, []);
    assert.deepEqual(out.requests, []);
    assert.equal(out.errors, 0);
  }
});

test('buyersToCsv: escapes quotes, round-trips', () => {
  const csv = buyersToCsv([
    {
      name: 'Ficticio "Especial" SRL',
      province: 'Matanzas',
      contact: { whatsapp: '+53-555-0202' },
      interestedProducts: ['arroz', 'azúcar'],
    },
  ]);
  const out = parseCubaCsv(csv);
  assert.equal(out.errors, 0);
  assert.equal(out.buyers[0].name, 'Ficticio "Especial" SRL');
  assert.equal(out.buyers[0].province, 'Matanzas');
});

test('buyersToCsv: no address/registration columns in output', () => {
  const csv = buyersToCsv([{ name: 'X', province: 'Y' }]);
  const header = csv.split('\n')[0].toLowerCase();
  assert.ok(!header.includes('address'));
  assert.ok(!header.includes('registration'));
});
