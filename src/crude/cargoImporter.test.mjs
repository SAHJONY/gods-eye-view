import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCargoCsv,
  parseCsvRows,
  parseNumberLoose,
  CSV_TEMPLATE_HEADERS,
  sampleCsvTemplate,
  MAX_CARGO_ROWS,
} from './cargoImporter.js';

test('CSV_TEMPLATE_HEADERS lists canonical cargo fields', () => {
  for (const h of [
    'ref',
    'grade',
    'volumeBbl',
    'buyPrice',
    'sellPrice',
    'commissionPerBbl',
    'incoterms',
    'laycanStart',
    'laycanEnd',
    'loadPort',
    'dischargePort',
    'loadLat',
    'loadLng',
    'dischargeLat',
    'dischargeLng',
    'supplier',
    'buyer',
    'status',
    'freight',
    'insurance',
    'inspection',
    'otherCost',
    'notes',
  ]) {
    assert.ok(CSV_TEMPLATE_HEADERS.includes(h), `missing ${h}`);
  }
});

test('sampleCsvTemplate returns header + obviously fictional sample row', () => {
  const t = sampleCsvTemplate();
  const rows = parseCsvRows(t.trim());
  assert.equal(rows[0].join(','), CSV_TEMPLATE_HEADERS.join(','));
  assert.equal(rows[1].length, CSV_TEMPLATE_HEADERS.length);
  const byHeader = {};
  rows[0].forEach((h, i) => {
    byHeader[h] = rows[1][i];
  });
  assert.equal(byHeader.ref, 'SAMPLE-001');
  assert.equal(byHeader.grade, 'Brent (sample)');
  assert.equal(byHeader.loadPort, 'Sample Load Port');
  assert.equal(byHeader.dischargePort, 'Sample Discharge Port');
  assert.match(byHeader.supplier, /sample/i);
  assert.match(byHeader.buyer, /sample/i);
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

test('parses English headers cargo', () => {
  const csv = [
    'ref,grade,volumeBbl,buyPrice,sellPrice,commissionPerBbl,incoterms,loadPort,dischargePort,status',
    'SAMPLE-100,Brent (sample),1000000,70.50,71.25,0.10,FOB,"Sample Load Port","Sample Discharge Port",offered',
  ].join('\n');
  const { cargoes, counterparties, errors } = parseCargoCsv(csv);
  assert.equal(counterparties.length, 0);
  assert.equal(cargoes.length, 1);
  const c = cargoes[0];
  assert.equal(c.ref, 'SAMPLE-100');
  assert.equal(c.grade, 'Brent (sample)');
  assert.equal(c.volumeBbl, 1000000);
  assert.equal(c.buyPrice, 70.5);
  assert.equal(c.sellPrice, 71.25);
  assert.equal(c.commissionPerBbl, 0.1);
  assert.equal(c.incoterms, 'FOB');
  assert.equal(c.loadPort, 'Sample Load Port');
  assert.equal(c.dischargePort, 'Sample Discharge Port');
  assert.equal(c.status, 'offered');
  assert.equal(errors.length, 0);
});

test('parses Spanish headers cargo (referencia, precioCompra, puertoCarga…)', () => {
  const csv = [
    'Referencia,Calidad,Volumen,Precio compra,Precio venta,Comisión,Incoterms,Puerto carga,Puerto descarga,Estado,Flete,Seguro,Inspección,Notas',
    'SAMPLE-101,"WSF Blend (sample)","1.250,50","$70,25","$71,00","0,05",cif,"Sample Load Port","Sample Discharge Port",negociando,"$150,000","$20,000","$5,000","sample, con coma"',
  ].join('\n');
  const { cargoes, errors } = parseCargoCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(cargoes.length, 1);
  const c = cargoes[0];
  assert.equal(c.ref, 'SAMPLE-101');
  assert.equal(c.grade, 'WSF Blend (sample)');
  assert.equal(c.volumeBbl, 1250.5); // European decimal
  assert.equal(c.buyPrice, 70.25); // "$70,25" → US thousands? no: tail "25" not 3 digits → decimal comma
  assert.equal(c.sellPrice, 71.0);
  assert.equal(c.commissionPerBbl, 0.05);
  assert.equal(c.incoterms, 'CIF');
  assert.equal(c.loadPort, 'Sample Load Port');
  assert.equal(c.dischargePort, 'Sample Discharge Port');
  assert.equal(c.status, 'negotiating'); // ES alias
  assert.equal(c.freight, 150000); // "$150.000" → ES thousands
  assert.equal(c.insurance, 20000);
  assert.equal(c.inspection, 5000);
  assert.equal(c.notes, 'sample, con coma'); // quoted comma survives
});

test('cargo accepted with missing volume/prices — warning, fields stay null', () => {
  const csv = ['ref,grade', 'SAMPLE-102,"Sahara (sample)"'].join('\n');
  const { cargoes, errors } = parseCargoCsv(csv);
  assert.equal(cargoes.length, 1);
  assert.equal(cargoes[0].volumeBbl, null);
  assert.equal(cargoes[0].buyPrice, null);
  assert.equal(cargoes[0].sellPrice, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /warning|Aviso/);
  assert.equal(errors[0].row, 1);
});

test('mixed cargo + counterparty file', () => {
  const csv = [
    'referencia,volumenBbl,precioCompra,precioVenta,puertoCarga,nombre,tipo,rol,pais,contacto,telefono,correo',
    'SAMPLE-103,750000,69.75,70.40,"Sample Load Port",,,,,,,',
    ',,,,,"Sample Trading Co",trader,ambos,"Sample Country","Sample Contact",+1-555-0100,sample@example.invalid',
  ].join('\n');
  const { cargoes, counterparties, errors } = parseCargoCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(cargoes.length, 1);
  assert.equal(cargoes[0].ref, 'SAMPLE-103');
  assert.equal(cargoes[0].volumeBbl, 750000);
  assert.equal(counterparties.length, 1);
  const p = counterparties[0];
  assert.equal(p.name, 'Sample Trading Co');
  assert.equal(p.type, 'trader');
  assert.equal(p.role, 'both');
  assert.equal(p.country, 'Sample Country');
  assert.equal(p.contactName, 'Sample Contact');
  assert.equal(p.contactPhone, '+1-555-0100');
  assert.equal(p.contactEmail, 'sample@example.invalid');
  assert.equal(p.verification, 'unverified');
});

test('counterparty defaults: type trader, role both, verification unverified', () => {
  const csv = ['nombre', '"Sample Brokerage Co"'].join('\n');
  const { cargoes, counterparties, errors } = parseCargoCsv(csv);
  assert.equal(cargoes.length, 0);
  assert.equal(errors.length, 0);
  assert.equal(counterparties.length, 1);
  const p = counterparties[0];
  assert.equal(p.type, 'trader');
  assert.equal(p.role, 'both');
  assert.equal(p.verification, 'unverified');
});

test('counterparty normalization: tipo/rol/verificacion in Spanish', () => {
  const csv = [
    'nombre,tipo,rol,verificacion',
    '"Sample Refining Co",refineria,comprador,verificado',
  ].join('\n');
  const { counterparties } = parseCargoCsv(csv);
  assert.equal(counterparties.length, 1);
  assert.equal(counterparties[0].type, 'refiner');
  assert.equal(counterparties[0].role, 'buyer');
  assert.equal(counterparties[0].verification, 'verified');
});

test('row with neither ref nor name → error', () => {
  const csv = [
    'referencia,volumenBbl,precioCompra,precioVenta,nombre',
    'SAMPLE-104,500000,70.00,71.00,',
    ',0,,,', // non-blank (has a volume) but no ref and no name
    ',,,,', // blank → silently skipped
  ].join('\n');
  const { cargoes, counterparties, errors } = parseCargoCsv(csv);
  assert.equal(cargoes.length, 1);
  assert.equal(counterparties.length, 0);
  assert.equal(errors.length, 1);
  assert.match(
    errors[0].message,
    /falta la referencia y el nombre \(missing ref and name\)/i,
  );
  assert.equal(errors[0].row, 2);
});

test('out-of-range coords → error, row skipped', () => {
  const csv = [
    'ref,volumeBbl,buyPrice,sellPrice,latCarga,lngCarga,latDescarga,lngDescarga',
    'SAMPLE-105,500000,70.00,71.00,95.0,-20.0,10.0,30.0',
    'SAMPLE-106,500000,70.00,71.00,10.0,-20.0,10.0,30.0',
  ].join('\n');
  const { cargoes, errors } = parseCargoCsv(csv);
  assert.equal(cargoes.length, 1);
  assert.equal(cargoes[0].ref, 'SAMPLE-106');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 1);
  assert.match(errors[0].message, /out of range|fuera de rango/i);
});

test('non-numeric coords → error, row skipped', () => {
  const csv = [
    'ref,volumeBbl,buyPrice,sellPrice,latCarga,lngCarga',
    'SAMPLE-107,500000,70.00,71.00,not-a-number,-20.0',
    'SAMPLE-108,500000,70.00,71.00,12.5,-45.75',
  ].join('\n');
  const { cargoes, errors } = parseCargoCsv(csv);
  assert.equal(cargoes.length, 1);
  assert.equal(cargoes[0].ref, 'SAMPLE-108');
  assert.equal(cargoes[0].loadLat, 12.5);
  assert.equal(cargoes[0].loadLng, -45.75);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 1);
  assert.match(errors[0].message, /non-numeric|no num/i);
});

test('incoterms normalized to FOB/CIF/DAP else empty', () => {
  const csv = ['ref,incoterms', 'SAMPLE-109,exw', 'SAMPLE-110,DAP'].join('\n');
  const { cargoes, errors } = parseCargoCsv(csv);
  assert.equal(cargoes.length, 2);
  assert.equal(cargoes[0].incoterms, '');
  assert.equal(cargoes[1].incoterms, 'DAP');
  // warnings only, no errors
  assert.ok(errors.every((e) => /warning/i.test(e.message)));
});

test('status defaults to prospect when unknown', () => {
  const csv = ['ref,status', 'SAMPLE-111,whimsical'].join('\n');
  const { cargoes } = parseCargoCsv(csv);
  assert.equal(cargoes[0].status, 'prospect');
});

test('blank rows are skipped and not counted', () => {
  const csv = [
    'ref,grade',
    '',
    '   ',
    'SAMPLE-112,"Merey (sample)"',
    '',
    'SAMPLE-113,"Basra (sample)"',
  ].join('\n');
  const { cargoes, errors } = parseCargoCsv(csv);
  assert.equal(cargoes.length, 2);
  assert.equal(cargoes[0].ref, 'SAMPLE-112');
  assert.equal(cargoes[1].ref, 'SAMPLE-113');
  assert.ok(errors.every((e) => /warning/i.test(e.message)));
});

test('5000-row cap with bilingual limit error', () => {
  assert.equal(MAX_CARGO_ROWS, 5000);
  const lines = ['ref,grade'];
  for (let i = 1; i <= MAX_CARGO_ROWS + 1; i += 1) {
    lines.push(`SAMPLE-CAP-${i},"Grade (sample)"`);
  }
  const { cargoes, errors } = parseCargoCsv(lines.join('\n'));
  assert.equal(cargoes.length, MAX_CARGO_ROWS);
  const limitErrors = errors.filter((e) =>
    /Límite.*row limit reached/.test(e.message),
  );
  assert.equal(limitErrors.length, 1);
  assert.equal(limitErrors[0].row, MAX_CARGO_ROWS + 1);
});

test('empty file → row 0 bilingual error', () => {
  const { cargoes, counterparties, errors } = parseCargoCsv('');
  assert.equal(cargoes.length, 0);
  assert.equal(counterparties.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 0);
  assert.match(errors[0].message, /Archivo vacío/);
});

test('unrecognized headers → row 0 bilingual error', () => {
  const { errors } = parseCargoCsv('zzz,qqq\n1,2');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 0);
  assert.match(errors[0].message, /No se reconocieron columnas/);
});
