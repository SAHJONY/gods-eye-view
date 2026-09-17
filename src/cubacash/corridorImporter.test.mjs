import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCubacashCsv,
  parseCsvRows,
  parseNumberLoose,
  providersToCsv,
  corridorsToCsv,
  providerCsvTemplate,
  corridorCsvTemplate,
  PROVIDER_CSV_HEADERS,
  CORRIDOR_CSV_HEADERS,
  MAX_ROWS,
} from './corridorImporter.js';
import { CHANNELS, PROVIDER_STATUSES } from './providerStore.js';

test('MAX_ROWS is 5000', () => {
  assert.equal(MAX_ROWS, 5000);
});

test('PROVIDER_CSV_HEADERS lists canonical provider fields', () => {
  for (const h of [
    'name',
    'channels',
    'coverageCountries',
    'feeModelType',
    'feePct',
    'feeFlat',
    'feeMin',
    'feeMax',
    'status',
    'website',
    'lat',
    'lng',
    'notes',
  ]) {
    assert.ok(PROVIDER_CSV_HEADERS.includes(h), `missing ${h}`);
  }
});

test('CORRIDOR_CSV_HEADERS lists canonical corridor fields', () => {
  for (const h of [
    'fromCountry',
    'toCountry',
    'providerName',
    'sendAmount',
    'fxRate',
    'fxRateAsOf',
    'fromLat',
    'fromLng',
    'toLat',
    'toLng',
    'notes',
  ]) {
    assert.ok(CORRIDOR_CSV_HEADERS.includes(h), `missing ${h}`);
  }
});

test('providerCsvTemplate: header + obviously fictional sample row', () => {
  const t = providerCsvTemplate();
  const rows = parseCsvRows(t.trim());
  assert.equal(rows[0].join(','), PROVIDER_CSV_HEADERS.join(','));
  assert.equal(rows[1].length, PROVIDER_CSV_HEADERS.length);
  const byHeader = {};
  rows[0].forEach((h, i) => {
    byHeader[h] = rows[1][i];
  });
  assert.match(byHeader.name, /fictional/i);
  assert.match(byHeader.notes, /sample|ejemplo/i);
  assert.match(byHeader.website, /fictional/i);
});

test('corridorCsvTemplate: header + obviously fictional sample row', () => {
  const t = corridorCsvTemplate();
  const rows = parseCsvRows(t.trim());
  assert.equal(rows[0].join(','), CORRIDOR_CSV_HEADERS.join(','));
  assert.equal(rows[1].length, CORRIDOR_CSV_HEADERS.length);
  const byHeader = {};
  rows[0].forEach((h, i) => {
    byHeader[h] = rows[1][i];
  });
  assert.match(byHeader.providerName, /fictional/i);
  assert.match(byHeader.fromCountry, /sample/i);
  assert.match(byHeader.notes, /sample|ejemplo/i);
});

test('parseCsvRows handles quoted fields with commas and embedded quotes', () => {
  const rows = parseCsvRows('a,b,c\n"x, y","she said ""hi""",z\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'she said "hi"', 'z'],
  ]);
});

test('parseNumberLoose parses "$1,250,000.50"', () => {
  assert.equal(parseNumberLoose('$1,250,000.50'), 1250000.5);
});

test('parseNumberLoose parses European decimal "1.250,50"', () => {
  assert.equal(parseNumberLoose('1.250,50'), 1250.5);
});

test('parseNumberLoose: blanks and garbage → null', () => {
  assert.equal(parseNumberLoose(''), null);
  assert.equal(parseNumberLoose('   '), null);
  assert.equal(parseNumberLoose(null), null);
  assert.equal(parseNumberLoose(undefined), null);
  assert.equal(parseNumberLoose('abc'), null);
});

test('parses English provider headers, semicolon lists, fee fields', () => {
  const csv = [
    'name,channels,coverageCountries,feeModelType,feePct,feeMin,feeMax,status,website,lat,lng,notes',
    '"Sample Remit (fictional)",app;whatsapp,"Spain;Cuba",percentage,1.25,1,12,verifying,https://example.com (fictional),23.1136,-82.3666,"sample, con coma"',
  ].join('\n');
  const { providers, corridors, errors } = parseCubacashCsv(csv);
  assert.equal(corridors.length, 0);
  assert.equal(errors.length, 0);
  assert.equal(providers.length, 1);
  const p = providers[0];
  assert.equal(p.name, 'Sample Remit (fictional)');
  assert.deepEqual(p.channels, ['app', 'whatsapp']);
  assert.deepEqual(p.coverageCountries, ['Spain', 'Cuba']);
  assert.equal(p.feeModelType, 'percentage');
  assert.equal(p.feePct, 1.25);
  assert.equal(p.feeFlat, null); // missing → null, never 0
  assert.equal(p.feeMin, 1);
  assert.equal(p.feeMax, 12);
  assert.equal(p.status, 'verifying');
  assert.equal(p.website, 'https://example.com (fictional)');
  assert.equal(p.lat, 23.1136);
  assert.equal(p.lng, -82.3666);
  assert.equal(p.notes, 'sample, con coma');
});

test('parses Spanish provider headers (nombre, canales, países, comisión…)', () => {
  const csv = [
    'Proveedor,Canales,Países,Tipo comisión,Porcentaje,Estado,Sitio web,Notas',
    '"Envíos Demo (ficticio)",app;web;agente,"España;Cuba",porcentual,"2,50",activo,https://ejemplo.com (ficticio),"fila de ejemplo"',
  ].join('\n');
  const { providers, errors } = parseCubacashCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(providers.length, 1);
  const p = providers[0];
  assert.equal(p.name, 'Envíos Demo (ficticio)');
  assert.deepEqual(p.channels, ['app', 'web', 'agent']);
  assert.deepEqual(p.coverageCountries, ['España', 'Cuba']);
  assert.equal(p.feeModelType, 'percentage');
  assert.equal(p.feePct, 2.5);
  assert.equal(p.status, 'live'); // 'activo' → live
  assert.equal(p.website, 'https://ejemplo.com (ficticio)');
  assert.equal(p.notes, 'fila de ejemplo');
});

test('provider channels: unrecognized channels dropped with warning, row kept', () => {
  const csv = [
    'name,channels,coverageCountries',
    '"Sample (fictional)",app;telegram;web,"Cuba (fictional)"',
  ].join('\n');
  const { providers, errors } = parseCubacashCsv(csv);
  assert.equal(providers.length, 1);
  assert.deepEqual(providers[0].channels, ['app', 'web']);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].es.includes('canales no reconocidos'));
  assert.ok(errors[0].en.includes('unrecognized channels'));
  assert.equal(errors[0].row, 1);
});

test('provider: missing name → error row, skipped', () => {
  const csv = ['name,channels', ',app'].join('\n');
  const { providers, errors } = parseCubacashCsv(csv);
  assert.equal(providers.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].es.includes('nombre'));
  assert.ok(errors[0].en.includes('name'));
});

test('provider: unknown status defaults to candidate (never throws)', () => {
  const csv = ['name,status', '"Sample (fictional)",bogus'].join('\n');
  const { providers, errors } = parseCubacashCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(providers[0].status, 'candidate');
});

test('provider: negative or garbage fee numbers → error row, skipped', () => {
  const csv = ['name,feeModelType,feePct', '"Sample (fictional)",percentage,-1']
    .join('\n');
  const { providers, errors } = parseCubacashCsv(csv);
  assert.equal(providers.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].es.includes('Comisión inválida'));
});

test('provider: percentage fee requires feePct > 0 → error otherwise', () => {
  const csv = ['name,feeModelType,feePct', '"Sample (fictional)",percentage,'].join(
    '\n',
  );
  const { providers, errors } = parseCubacashCsv(csv);
  assert.equal(providers.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].en.includes('feePct > 0'));
  // undisclosed fee with no numbers is fine
  const ok = parseCubacashCsv(['name,feeModelType', '"Sample B (fictional)",'].join('\n'));
  assert.equal(ok.providers.length, 1);
  assert.equal(ok.providers[0].feeModelType, 'undisclosed');
  assert.equal(ok.providers[0].feePct, null);
});

test('provider: non-numeric coords → error row, skipped', () => {
  const csv = ['name,lat,lng', '"Sample (fictional)",abc,10'].join('\n');
  const { providers, errors } = parseCubacashCsv(csv);
  assert.equal(providers.length, 0);
  assert.equal(errors.length, 1);
});

test('parses English corridor headers with rate and as-of date', () => {
  const csv = [
    'fromCountry,toCountry,providerName,sendAmount,fxRate,fxRateAsOf,fromLat,fromLng,toLat,toLng,notes',
    '"Spain (sample)","Cuba (sample)","Sample Provider (fictional)",100,120.5,2026-09-17,40.4168,-3.7038,23.1136,-82.3666,"sample"',
  ].join('\n');
  const { providers, corridors, errors } = parseCubacashCsv(csv);
  assert.equal(providers.length, 0);
  assert.equal(errors.length, 0);
  assert.equal(corridors.length, 1);
  const c = corridors[0];
  assert.equal(c.fromCountry, 'Spain (sample)');
  assert.equal(c.toCountry, 'Cuba (sample)');
  assert.equal(c.providerName, 'Sample Provider (fictional)');
  assert.equal(c.sendAmount, 100);
  assert.equal(c.fxRate, 120.5);
  assert.equal(c.fxRateAsOf, '2026-09-17');
  assert.equal(c.fromLat, 40.4168);
  assert.equal(c.toLat, 23.1136);
});

test('parses Spanish corridor headers (país origen, tasa, fecha…)', () => {
  const csv = [
    'País origen,País destino,Proveedor,Monto,Tasa,Fecha tasa,Notas',
    '"España (ejemplo)","Cuba (ejemplo)","Proveedor Ejemplo (ficticio)",250,118.25,2026-09-17,"ejemplo"',
  ].join('\n');
  const { corridors, errors } = parseCubacashCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(corridors.length, 1);
  const c = corridors[0];
  assert.equal(c.fromCountry, 'España (ejemplo)');
  assert.equal(c.toCountry, 'Cuba (ejemplo)');
  assert.equal(c.providerName, 'Proveedor Ejemplo (ficticio)');
  assert.equal(c.sendAmount, 250);
  assert.equal(c.fxRate, 118.25);
  assert.equal(c.fxRateAsOf, '2026-09-17');
});

test('corridor: missing fxRate stays null with as-of text; missing text → empty', () => {
  const csv = [
    'fromCountry,toCountry,sendAmount,notes',
    '"Spain (sample)","Cuba (sample)",250,',
  ].join('\n');
  const { corridors, errors } = parseCubacashCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(corridors[0].fxRate, null);
  assert.equal(corridors[0].fxRateAsOf, '');
  assert.equal(corridors[0].notes, '');
  assert.equal(corridors[0].fromLat, null);
});

test('corridor: fxRate without fxRateAsOf → ERROR, row skipped (honesty rule)', () => {
  const csv = [
    'fromCountry,toCountry,fxRate,fxRateAsOf',
    '"Spain (sample)","Cuba (sample)",120,',
  ].join('\n');
  const { corridors, errors } = parseCubacashCsv(csv);
  assert.equal(corridors.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].es.includes('fxRateAsOf'));
  assert.ok(errors[0].en.includes('as-of date'));
  assert.equal(errors[0].row, 1);
});

test('corridor: fxRate ≤ 0 → error row, skipped', () => {
  const csv = [
    'fromCountry,toCountry,fxRate,fxRateAsOf',
    '"Spain (sample)","Cuba (sample)",0,2026-09-17',
  ].join('\n');
  const { corridors, errors } = parseCubacashCsv(csv);
  assert.equal(corridors.length, 0);
  assert.equal(errors.length, 1);
});

test('corridor: missing fromCountry or toCountry → error row, skipped', () => {
  const csv = ['fromCountry,toCountry', '"Spain (sample)",'].join('\n');
  const { corridors, errors } = parseCubacashCsv(csv);
  assert.equal(corridors.length, 0);
  assert.equal(errors.length, 1);
});

test('corridor: negative sendAmount → error row, skipped', () => {
  const csv = ['fromCountry,toCountry,sendAmount', '"Spain (sample)","Cuba (sample)",-10'].join(
    '\n',
  );
  const { corridors, errors } = parseCubacashCsv(csv);
  assert.equal(corridors.length, 0);
  assert.equal(errors.length, 1);
});

test('mixed file: provider rows and corridor rows in one CSV', () => {
  const csv = [
    'name,fromCountry,toCountry,feeModelType,status',
    '"Sample Remit (fictional)",,,,candidate',
    ',"Spain (sample)","Cuba (sample)",,',
  ].join('\n');
  const { providers, corridors, errors } = parseCubacashCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, 'Sample Remit (fictional)');
  assert.equal(corridors.length, 1);
  assert.equal(corridors[0].fromCountry, 'Spain (sample)');
});

test('kind column: explicit provider/corridor markers win over detection', () => {
  const csv = [
    'kind,name,fromCountry,toCountry',
    'corridor,,"Spain (sample)","Cuba (sample)"',
    'provider,"Sample Remit (fictional)",,',
  ].join('\n');
  const { providers, corridors, errors } = parseCubacashCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(corridors.length, 1);
  assert.equal(providers.length, 1);
});

test('row with neither provider nor corridor fields → error row', () => {
  const csv = ['name,fromCountry,toCountry,notes', ',,,"solo notas"'].join('\n');
  const { providers, corridors, errors } = parseCubacashCsv(csv);
  assert.equal(providers.length, 0);
  assert.equal(corridors.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].es.includes('clasificar'));
  assert.ok(errors[0].en.includes('Unclassifiable'));
});

test('empty file and unrecognized columns → bilingual errors', () => {
  const empty = parseCubacashCsv('');
  assert.equal(empty.errors.length, 1);
  assert.equal(empty.errors[0].row, 0);
  const junk = parseCubacashCsv('foo,bar\n1,2\n');
  assert.equal(junk.errors.length, 1);
  assert.ok(junk.errors[0].es.includes('reconocieron'));
});

test('providersToCsv / corridorsToCsv round-trip through the parser', () => {
  const providerCsv = providersToCsv([
    {
      name: 'Sample Remit (fictional)',
      channels: ['app', 'web'],
      coverageCountries: ['Spain (fictional)', 'Cuba (fictional)'],
      feeModel: { type: 'percentage', pct: 1.25, flat: null, min: 1, max: 12 },
      status: 'live',
      website: 'https://example.com (fictional)',
      lat: null,
      lng: null,
      notes: 'sample "quoted"',
    },
  ]);
  const parsedP = parseCubacashCsv(providerCsv);
  assert.equal(parsedP.providers.length, 1);
  const p = parsedP.providers[0];
  assert.equal(p.name, 'Sample Remit (fictional)');
  assert.deepEqual(p.channels, ['app', 'web']);
  assert.equal(p.feePct, 1.25);
  assert.equal(p.feeFlat, null);
  assert.equal(p.notes, 'sample "quoted"');

  const corridorCsv = corridorsToCsv([
    {
      fromCountry: 'Spain (sample)',
      toCountry: 'Cuba (sample)',
      providerName: 'Sample Provider (fictional)',
      sendAmount: 100,
      fxRate: 120.5,
      fxRateAsOf: '2026-09-17',
      fromLat: null,
      fromLng: null,
      toLat: null,
      toLng: null,
      notes: '',
    },
  ]);
  const parsedC = parseCubacashCsv(corridorCsv);
  assert.equal(parsedC.corridors.length, 1);
  const c = parsedC.corridors[0];
  assert.equal(c.fxRate, 120.5);
  assert.equal(c.fxRateAsOf, '2026-09-17');
  assert.equal(c.providerName, 'Sample Provider (fictional)');
});

test('template CSVs parse back without errors', () => {
  const p = parseCubacashCsv(providerCsvTemplate());
  assert.equal(p.providers.length, 1);
  assert.equal(p.errors.length, 0);
  const c = parseCubacashCsv(corridorCsvTemplate());
  assert.equal(c.corridors.length, 1);
  assert.equal(c.errors.length, 0);
});

test('importer reads CHANNELS and PROVIDER_STATUSES from the store', () => {
  assert.ok(CHANNELS.includes('whatsapp'));
  assert.ok(PROVIDER_STATUSES.includes('live'));
  // fee model aliases normalize
  const { providers } = parseCubacashCsv(
    ['name,feeModelType', '"Sample (fictional)",mixto'].join('\n'),
  );
  assert.equal(providers[0].feeModelType, 'mixed');
});
