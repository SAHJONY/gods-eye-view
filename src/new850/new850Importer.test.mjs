import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCaseCsv,
  parseCsvRows,
  CSV_TEMPLATE_HEADERS,
  sampleCsvTemplate,
  MAX_CASE_ROWS,
} from './new850Importer.js';

test('CSV_TEMPLATE_HEADERS lists canonical intake fields (no SSN column)', () => {
  for (const h of [
    'ref',
    'clientLabel',
    'phone',
    'bureaus',
    'item',
    'creditor',
    'evidence',
    'notes',
  ]) {
    assert.ok(CSV_TEMPLATE_HEADERS.includes(h), `missing ${h}`);
  }
  assert.ok(
    !CSV_TEMPLATE_HEADERS.some((h) => /ssn|social/i.test(h)),
    'template must never include an SSN column',
  );
});

test('sampleCsvTemplate returns header + obviously-fictional DEMO row', () => {
  const t = sampleCsvTemplate();
  const rows = parseCsvRows(t.trim());
  assert.equal(rows[0].join(','), CSV_TEMPLATE_HEADERS.join(','));
  assert.equal(rows[1].length, CSV_TEMPLATE_HEADERS.length);
  const byHeader = {};
  rows[0].forEach((h, i) => {
    byHeader[h] = rows[1][i];
  });
  assert.equal(byHeader.ref, 'DEMO-001');
  assert.match(byHeader.clientLabel, /DEMO/i);
  assert.match(byHeader.creditor, /ficticio/i);
  assert.match(byHeader.notes, /DEMO/i);
});

test('parseCsvRows handles quoted fields with commas and embedded quotes', () => {
  const rows = parseCsvRows('a,b,c\n"x, y","she said ""hi""",z\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'she said "hi"', 'z'],
  ]);
});

test('parseCaseCsv: rows become intake drafts with masked phones', () => {
  const { cases, errors } = parseCaseCsv(
    'ref,clientLabel,phone,bureaus,item,creditor,evidence,notes\n' +
      'N850-100,Cliente A,(305) 555-4567,"equifax,experian",pago tardío,Banco X,estado de cuenta,nota\n',
  );
  assert.equal(errors.length, 0);
  assert.equal(cases.length, 1);
  const c = cases[0];
  assert.equal(c.stage, 'intake');
  assert.equal(c.intakeDraft, true);
  assert.equal(c.phoneMasked, '***4567');
  assert.ok(!('phone' in c) || c.phone === undefined);
  assert.deepEqual(c.bureaus, ['equifax', 'experian']);
  assert.equal(c.disputes.length, 1);
  assert.equal(c.disputes[0].status, 'draft');
  assert.equal(c.disputes[0].round, 1);
});

test('parseCaseCsv: Spanish headers map to canonical fields', () => {
  const { cases } = parseCaseCsv(
    'referencia,cliente,telefono,buros,disputa,acreedor,evidencia,notas\n' +
      'N850-101,Cliente B,2815551234,transunion,cobranza,Agencia Y,carta,\n',
  );
  assert.equal(cases.length, 1);
  assert.equal(cases[0].ref, 'N850-101');
  assert.equal(cases[0].phoneMasked, '***1234');
  assert.deepEqual(cases[0].bureaus, ['transunion']);
  assert.equal(cases[0].disputes[0].creditor, 'Agencia Y');
});

test('parseCaseCsv: SSN columns are dropped with a warning, SSN-like text redacted', () => {
  const { cases, errors } = parseCaseCsv(
    'ref,clientLabel,ssn,notes\nN850-102,Cliente C,123-45-6789,"nota 987-65-4321"\n',
  );
  assert.equal(cases.length, 1);
  assert.ok(!cases[0].ssn, 'no ssn field stored');
  assert.ok(
    errors.some((e) => /SSN/i.test(e.message)),
    'SSN drop warning present',
  );
  assert.ok(!/\d{3}-\d{2}-\d{4}/.test(cases[0].notes), 'SSN redacted in notes');
});

test('parseCaseCsv: rows with neither ref nor client label are errors', () => {
  const { cases, errors } = parseCaseCsv('ref,clientLabel,notes\n,,solo nota\n');
  assert.equal(cases.length, 0);
  assert.ok(errors.some((e) => e.row === 1));
});

test('parseCaseCsv: empty file and unknown columns', () => {
  const empty = parseCaseCsv('   ');
  assert.equal(empty.cases.length, 0);
  assert.ok(empty.errors.length > 0);
  const unknown = parseCaseCsv('zzz,yyy\na,b\n');
  assert.equal(unknown.cases.length, 0);
  assert.ok(unknown.errors.some((e) => /reconocieron/i.test(e.message)));
});

test('parseCaseCsv: MAX_CASE_ROWS cap', () => {
  assert.equal(MAX_CASE_ROWS, 5000);
});
