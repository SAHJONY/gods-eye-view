import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PRICE_ROWS,
  CSV_TEMPLATE_HEADERS,
  sampleCsvTemplate,
  normalizeFieldName,
  parseCompetitionCsv,
  snapshotsToCsv,
} from './carImporter.js';

test('template headers are canonical', () => {
  assert.deepEqual(CSV_TEMPLATE_HEADERS, [
    'competitor',
    'model',
    'price',
    'date',
    'sourceUrl',
  ]);
  const tpl = sampleCsvTemplate();
  assert.ok(tpl.startsWith('competitor,model,price,date,sourceUrl'));
  assert.ok(tpl.includes('99999'));
  assert.ok(tpl.toLowerCase().includes('sample'));
});

test('header aliases map ES and EN to canonical fields', () => {
  assert.equal(normalizeFieldName('Competidor'), 'competitor');
  assert.equal(normalizeFieldName('Vendedor'), 'competitor');
  assert.equal(normalizeFieldName('Modelo'), 'model');
  assert.equal(normalizeFieldName('Carro'), 'model');
  assert.equal(normalizeFieldName('Precio'), 'price');
  assert.equal(normalizeFieldName('Fecha'), 'date');
  assert.equal(normalizeFieldName('URL'), 'sourceUrl');
  assert.equal(normalizeFieldName('fuente'), 'sourceUrl');
  assert.equal(normalizeFieldName('nonexistent'), null);
});

test('parse ES header CSV with quoted commas', () => {
  const csv = `Competidor,Modelo,Precio,Fecha,URL
"Sample Competitor, S.A.",Sample Model (fictional),99999,2026-09-17,https://example.com/a
Sample Competitor 2,Sample Model (fictional),88888,,`;
  const { rows, errors, skipped } = parseCompetitionCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(skipped, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].competitor, 'Sample Competitor, S.A.');
  assert.equal(rows[0].price, 99999);
  assert.equal(rows[0].date, '2026-09-17');
  assert.equal(rows[0].sourceUrl, 'https://example.com/a');
  assert.equal(rows[1].price, 88888);
  assert.equal(rows[1].date, '');
});

test('invalid price rows are skipped with an error (never invented)', () => {
  const csv = `competitor,model,price,date,sourceUrl
Sample Competitor,Sample Model,not-a-price,2026-09-17,https://example.com/a`;
  const { rows, errors, skipped } = parseCompetitionCsv(csv);
  assert.equal(rows.length, 0);
  assert.equal(skipped, 1);
  assert.equal(errors.length, 1);
});

test('missing required columns produce a bilingual error', () => {
  const { rows, errors } = parseCompetitionCsv('foo,bar\n1,2');
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('Missing required columns'));
});

test('empty rows are skipped; empty price becomes null', () => {
  const csv = `competitor,model,price,date,sourceUrl
Sample Competitor,Sample Model,,2026-09-17,https://example.com/a

`;
  const { rows, skipped } = parseCompetitionCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, null);
  assert.ok(skipped >= 0);
});

test('round trip snapshotsToCsv', () => {
  const rows = [
    {
      competitor: 'Sample Competitor',
      model: 'Sample Model',
      price: 99999,
      date: '2026-09-17',
      sourceUrl: 'https://example.com/a',
    },
    {
      competitor: 'Sample Competitor 2',
      model: 'Sample Model, Plus',
      price: null,
      date: '',
      sourceUrl: '',
    },
  ];
  const csv = snapshotsToCsv(rows);
  const parsed = parseCompetitionCsv(csv);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].price, 99999);
  assert.equal(parsed.rows[1].model, 'Sample Model, Plus');
  assert.equal(parsed.rows[1].price, null);
});

test('max rows cap is defined', () => {
  assert.equal(MAX_PRICE_ROWS, 5000);
});
