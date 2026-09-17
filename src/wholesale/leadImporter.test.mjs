import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLeadsCsv,
  parseCsvRows,
  parseNumberLoose,
  CSV_TEMPLATE_HEADERS,
  sampleCsvTemplate,
  MAX_LEAD_ROWS,
} from './leadImporter.js';

test('CSV_TEMPLATE_HEADERS lists canonical fields', () => {
  for (const h of ['address', 'city', 'state', 'zip', 'lat', 'lng', 'owner', 'ownerType', 'arv', 'repairs', 'taxDelinquent']) {
    assert.ok(CSV_TEMPLATE_HEADERS.includes(h), `missing ${h}`);
  }
});

test('sampleCsvTemplate returns header + sample row', () => {
  const t = sampleCsvTemplate();
  const rows = parseCsvRows(t.trim());
  assert.equal(rows[0].join(','), CSV_TEMPLATE_HEADERS.join(','));
  assert.equal(rows[1].length, CSV_TEMPLATE_HEADERS.length);
});

test('parses English headers', () => {
  const csv = [
    'address,city,state,zip,lat,lng,owner,ownerType,source,condition,notes,arv,repairs,taxDelinquent',
    '1234 Canal St,Houston,TX,77003,29.7545,-95.3621,John Doe,individual,county,"vacant","Boarded up",185000,45000,yes',
  ].join('\n');
  const { leads, errors } = parseLeadsCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(leads.length, 1);
  const l = leads[0];
  assert.equal(l.address, '1234 Canal St');
  assert.equal(l.city, 'Houston');
  assert.equal(l.lat, 29.7545);
  assert.equal(l.lng, -95.3621);
  assert.equal(l.owner, 'John Doe');
  assert.equal(l.ownerType, 'individual');
  assert.equal(l.arv, 185000);
  assert.equal(l.taxDelinquent, true);
  assert.equal(l.status, 'new');
  assert.equal(l.score, null);
});

test('parses Spanish headers', () => {
  const csv = [
    'Dirección,Ciudad,Estado,Código postal,Lat,Lng,Propietario,Tipo de propietario,Fuente,Condición,Notas',
    '"456 Oak Ave, Suite 2",Miami,FL,33130,25.768,-80.192,María López,Empresa,condado,vacía,"tapiada, monte alto"',
  ].join('\n');
  const { leads, errors } = parseLeadsCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(leads.length, 1);
  const l = leads[0];
  assert.equal(l.address, '456 Oak Ave, Suite 2'); // quoted comma survives
  assert.equal(l.city, 'Miami');
  assert.equal(l.zip, '33130');
  assert.equal(l.lat, 25.768);
  assert.equal(l.lng, -80.192);
  assert.equal(l.owner, 'María López');
  assert.equal(l.ownerType, 'entity');
  assert.equal(l.condition, 'vacía');
  assert.equal(l.notes, 'tapiada, monte alto');
});

test('normalizes ownerType variants', () => {
  const csv = [
    'address,ownerType,lat,lng',
    'A,Persona física,29,-95',
    'B,EMPRESA,29,-95',
    'C,sociedad,29,-95',
    'D,,29,-95',
  ].join('\n');
  const { leads } = parseLeadsCsv(csv);
  assert.deepEqual(leads.map((l) => l.ownerType), ['individual', 'entity', 'entity', 'unknown']);
});

test('accepts address-only rows (no coords)', () => {
  const { leads, errors } = parseLeadsCsv('address,city\n789 Pine Rd,Houston\n');
  assert.equal(errors.length, 0);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].lat, null);
  assert.equal(leads[0].lng, null);
});

test('accepts coords-only rows (no address)', () => {
  const { leads, errors } = parseLeadsCsv('lat,lng\n29.7,-95.3\n');
  assert.equal(errors.length, 0);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].address, '');
});

test('missing address AND coords produces an error row', () => {
  const csv = 'address,city,lat,lng\n,Miami,,\n';
  const { leads, errors } = parseLeadsCsv(csv);
  assert.equal(leads.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 1);
  assert.match(errors[0].message, /address/i);
});

test('non-numeric coordinates produce errors', () => {
  const csv = 'address,lat,lng\n123 Main,abc,-95.3\n456 Elm,29.7,xyz\n';
  const { leads, errors } = parseLeadsCsv(csv);
  assert.equal(leads.length, 0);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].row, 1);
  assert.equal(errors[1].row, 2);
});

test('out-of-range coordinates produce errors', () => {
  const { leads, errors } = parseLeadsCsv('address,lat,lng\n123 Main,95.5,-95.3\n');
  assert.equal(leads.length, 0);
  assert.equal(errors.length, 1);
});

test('blank rows are skipped silently', () => {
  const csv = 'address,lat,lng\n\n   \n123 Main,29.7,-95.3\n\n';
  const { leads, errors } = parseLeadsCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(leads.length, 1);
});

test('empty file reports an error', () => {
  const { leads, errors } = parseLeadsCsv('   \n');
  assert.equal(leads.length, 0);
  assert.equal(errors.length, 1);
});

test('unrecognized headers report an error', () => {
  const { leads, errors } = parseLeadsCsv('foo,bar,baz\n1,2,3\n');
  assert.equal(leads.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /reconoci/i);
});

test('caps at 5000 rows', () => {
  const lines = ['address,lat,lng'];
  for (let i = 0; i < MAX_LEAD_ROWS + 5; i += 1) {
    lines.push(`Prop ${i},29.7,-95.3`);
  }
  const { leads, errors } = parseLeadsCsv(lines.join('\n'));
  assert.equal(leads.length, MAX_LEAD_ROWS);
  assert.ok(errors.some((e) => /5000/i.test(e.message) || /5,000/.test(e.message)));
});

test('lenient number parsing', () => {
  assert.equal(parseNumberLoose('$185,000'), 185000);
  assert.equal(parseNumberLoose('1.250,50'), 1250.5); // Spanish decimal comma
  assert.equal(parseNumberLoose(' 45000 '), 45000);
  assert.equal(parseNumberLoose(''), null);
  assert.equal(parseNumberLoose('abc'), null);
  assert.equal(parseNumberLoose('185000.75'), 185000.75);
});

test('parseCsvRows handles quotes, commas, embedded newlines', () => {
  const rows = parseCsvRows('a,b\n"x, y",z\n"line1\nline2",w\n');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['x, y', 'z']);
  assert.deepEqual(rows[2], ['line1\nline2', 'w']);
});
