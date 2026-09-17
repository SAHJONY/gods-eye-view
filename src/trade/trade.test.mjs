// Unit tests for the import/export trade data layer: supplierStore, rfqEngine,
// supplierImporter. Mirrors the crude test style. All fixture names/values are
// deliberately fictional.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------- supplierStore.js ----------
import {
  STORAGE_KEY,
  RFQ_STATUSES,
  STATUS_LABELS,
  OPEN_STATUSES,
  SUPPLIER_TYPES,
  SUPPLIER_TYPE_LABELS,
  SUPPLIER_ROLES,
  SUPPLIER_ROLE_LABELS,
  VERIFICATION,
  VERIFICATION_LABELS,
  chicagoIso,
  createSupplier,
  getSupplier,
  updateSupplier,
  deleteSupplier,
  listSuppliers,
  addSupplierNote,
  createRfq,
  getRfq,
  updateRfq,
  moveRfq,
  deleteRfq,
  listRfqs,
  addRfqNote,
  stats,
  asWorkforceStore,
  resetTradeStore,
  reloadTradeStore,
} from './supplierStore.js';

beforeEach(() => {
  resetTradeStore();
});

test('STORAGE_KEY namespaced for trade', () => {
  assert.equal(STORAGE_KEY, 'sahjony.trade.v1');
});

test('constants: statuses, types, roles, verification with bilingual labels', () => {
  assert.deepEqual(RFQ_STATUSES, [
    'prospect',
    'contacted',
    'quoting',
    'negotiating',
    'won',
    'lost',
  ]);
  assert.deepEqual(STATUS_LABELS.won, { es: 'Ganado', en: 'Won' });
  assert.deepEqual(STATUS_LABELS.quoting, { es: 'Cotizando', en: 'Quoting' });
  assert.deepEqual(OPEN_STATUSES.includes('won'), false);
  assert.deepEqual(OPEN_STATUSES.includes('lost'), false);
  assert.ok(OPEN_STATUSES.includes('quoting'));
  assert.deepEqual(SUPPLIER_TYPES, [
    'manufacturer',
    'distributor',
    'trader',
    'logistics',
  ]);
  assert.deepEqual(SUPPLIER_TYPE_LABELS.manufacturer, {
    es: 'Fabricante',
    en: 'Manufacturer',
  });
  assert.deepEqual(SUPPLIER_ROLES, ['supplier', 'buyer', 'both']);
  assert.deepEqual(SUPPLIER_ROLE_LABELS.both, { es: 'Ambos', en: 'Both' });
  assert.deepEqual(VERIFICATION, [
    'unverified',
    'in-review',
    'verified',
    'flagged',
  ]);
  assert.deepEqual(VERIFICATION_LABELS['in-review'], {
    es: 'En revisión',
    en: 'In review',
  });
});

test('chicagoIso produces an offset timestamp', () => {
  assert.match(chicagoIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('supplier CRUD: create, get, update, delete, list', () => {
  const s = createSupplier({
    name: 'ACME EXPORTS (fixture)',
    type: 'manufacturer',
    role: 'supplier',
    country: 'FICTITIA',
    contact: { name: 'Jane Doe', phone: '+1000', email: 'jane@example.invalid' },
  });
  assert.ok(s.id);
  assert.equal(s.type, 'manufacturer');
  assert.equal(s.verification, 'unverified');
  assert.equal(s.contact.phone, '+1000');
  assert.deepEqual(getSupplier(s.id).name, 'ACME EXPORTS (fixture)');

  const updated = updateSupplier(s.id, { verification: 'verified' });
  assert.equal(updated.verification, 'verified');
  assert.equal(updated.createdAt, s.createdAt);

  assert.equal(listSuppliers().length, 1);
  assert.equal(listSuppliers({ verification: 'verified' }).length, 1);
  assert.equal(listSuppliers((x) => x.role === 'supplier').length, 1);

  assert.equal(deleteSupplier(s.id), true);
  assert.equal(getSupplier(s.id), null);
  assert.equal(deleteSupplier('missing'), false);
  assert.equal(updateSupplier('missing', {}), null);
});

test('supplier unknown type/role/verification coerce to defaults', () => {
  const s = createSupplier({
    name: 'ACME EXPORTS (fixture)',
    country: 'FICTITIA',
    type: 'bogus',
    role: 'bogus',
    verification: 'bogus',
  });
  assert.equal(s.type, 'trader');
  assert.equal(s.role, 'both');
  assert.equal(s.verification, 'unverified');
});

test('findDuplicateSupplier: same name+country returns existing', () => {
  const a = createSupplier({ name: 'ACME EXPORTS (fixture)', country: 'Fictitia' });
  const b = createSupplier({ name: '  acme  EXPORTS (fixture) ', country: 'FICTITIA' });
  assert.equal(a.id, b.id);
  assert.equal(listSuppliers().length, 1);
  // Same name, different country → distinct.
  const c = createSupplier({ name: 'ACME EXPORTS (fixture)', country: 'OTHERLAND' });
  assert.notEqual(c.id, a.id);
});

test('rfq CRUD: create with defaults, coords null when blank, money 0 when bad', () => {
  const r = createRfq({ ref: 'RFQ-FIX-001', product: 'Sample widgets (fixture)' });
  assert.equal(r.status, 'prospect');
  assert.equal(r.quantity, 0);
  assert.equal(r.originLat, null);
  assert.equal(r.originLng, null);
  assert.equal(r.destLat, null);
  assert.equal(r.destLng, null);
  assert.equal(typeof r.score, 'number');

  const full = createRfq({
    ref: 'RFQ-FIX-002',
    quantity: '5000',
    unitCost: '12.50',
    sellUnitPrice: '15.75',
    freight: '2500',
    duties: '800',
    otherCosts: '300',
    commissionPct: '5',
    originLat: '25.7',
    originLng: '-80.2',
    originPort: 'PORT ALPHA (fixture)',
    destinationPort: 'PORT BETA (fixture)',
    supplierId: 'sup-1',
    status: 'quoting',
  });
  assert.equal(full.quantity, 5000);
  assert.equal(full.unitCost, 12.5);
  assert.equal(full.originLat, 25.7);
  assert.equal(full.originLng, -80.2);
  assert.equal(full.status, 'quoting');
  assert.ok(full.score > 0);

  assert.equal(getRfq(r.id).ref, 'RFQ-FIX-001');
  assert.equal(getRfq('missing'), null);
  const updated = updateRfq(r.id, { quantity: 100 });
  assert.equal(updated.quantity, 100);
  assert.ok(updated.score >= r.score);
  assert.equal(updateRfq('missing', {}), null);
  assert.equal(deleteRfq(r.id), true);
  assert.equal(deleteRfq('missing'), false);
});

test('rfq: unknown status throws on create and move', () => {
  assert.throws(() => createRfq({ ref: 'X', status: 'bogus' }), /Unknown trade RFQ status/);
  const r = createRfq({ ref: 'RFQ-FIX-003' });
  assert.throws(() => moveRfq(r.id, 'bogus'), /Unknown trade RFQ status/);
});

test('moveRfq advances status', () => {
  const r = createRfq({ ref: 'RFQ-FIX-004' });
  const moved = moveRfq(r.id, 'contacted');
  assert.equal(moved.status, 'contacted');
  assert.equal(moveRfq('missing', 'contacted'), null);
});

test('duplicate RFQ ref returns existing record', () => {
  const a = createRfq({ ref: 'RFQ-FIX-005', quantity: 10 });
  const b = createRfq({ ref: ' rfq-fix-005 ', quantity: 999 });
  assert.equal(a.id, b.id);
  assert.equal(b.quantity, 10); // original kept
  assert.equal(listRfqs().length, 1);
});

test('addSupplierNote / addRfqNote store bilingual {at, agent, es, en} notes', () => {
  const s = createSupplier({ name: 'ACME (fixture)', country: 'FICTITIA' });
  const sn = addSupplierNote(s.id, 'workforce-agent', 'Nota de prueba', 'Test note');
  assert.ok(sn.at);
  assert.equal(sn.agent, 'workforce-agent');
  assert.equal(sn.es, 'Nota de prueba');
  assert.equal(sn.en, 'Test note');

  const r = createRfq({ ref: 'RFQ-FIX-006' });
  const rn = addRfqNote(r.id, 'workforce-agent', 'Llamar al proveedor', 'Call the supplier');
  assert.ok(rn.at);
  assert.equal(rn.es, 'Llamar al proveedor');
  assert.equal(addRfqNote('missing', 'a', 'b', 'c'), null);
  assert.equal(addSupplierNote('missing', 'a', 'b', 'c'), null);
});

test('listRfqs supports object, function, and minScore filters', () => {
  createRfq({ ref: 'RFQ-FIX-010', status: 'quoting', quantity: 100, unitCost: 10, sellUnitPrice: 12, product: 'P', originPort: 'A', destinationPort: 'B' });
  createRfq({ ref: 'RFQ-FIX-011', status: 'won', quantity: 1 });
  assert.equal(listRfqs({ status: 'won' }).length, 1);
  assert.equal(listRfqs((r) => r.ref === 'RFQ-FIX-010').length, 1);
  assert.equal(listRfqs({ minScore: 50 }).length, 1);
  assert.equal(listRfqs({ minScore: 0 }).length, 2);
});

test('stats: totals, open counts, byStatus, quantity, commission', () => {
  createSupplier({ name: 'A (fixture)', country: 'FICTITIA', verification: 'verified' });
  createSupplier({ name: 'B (fixture)', country: 'FICTITIA' });
  // Open RFQ with commission: 15.75 * 5000 * 0.05 = 3937.5 → rounds to 3938
  createRfq({ ref: 'RFQ-FIX-020', status: 'quoting', quantity: 5000, unitCost: 12.5, sellUnitPrice: 15.75, commissionPct: 5 });
  // Won RFQ — closed, excluded from open totals.
  createRfq({ ref: 'RFQ-FIX-021', status: 'won', quantity: 100, unitCost: 1, sellUnitPrice: 2, commissionPct: 10 });
  const st = stats();
  assert.equal(st.totalRfqs, 2);
  assert.equal(st.openRfqs, 1);
  assert.equal(st.byStatus.quoting, 1);
  assert.equal(st.byStatus.won, 1);
  assert.equal(st.totalQuantity, 5000);
  assert.equal(st.potentialCommission, 3938);
  assert.equal(st.totalSuppliers, 2);
  assert.equal(st.verifiedSuppliers, 1);
});

test('asWorkforceStore: getAll/get/update/notes, {t} notes normalized to {at} with dedupe', () => {
  const r = createRfq({ ref: 'RFQ-FIX-030' });
  const wf = asWorkforceStore();
  assert.equal(wf.getAll().length, 1);
  assert.equal(wf.get(r.id).ref, 'RFQ-FIX-030');

  const note = { t: '2026-09-17T10:00:00-05:00', agent: 'field-agent', es: 'Visita programada', en: 'Visit scheduled' };
  wf.update(r.id, { agentNotes: [note] });
  // Same note again — must not duplicate.
  wf.update(r.id, { agentNotes: [note, note] });
  const stored = getRfq(r.id);
  assert.equal(stored.agentNotes.length, 1);
  assert.equal(stored.agentNotes[0].at, '2026-09-17T10:00:00-05:00');
  assert.equal(stored.agentNotes[0].agent, 'field-agent');

  // notes() maps {at} → {t}.
  assert.deepEqual(wf.notes(r.id), [
    {
      t: '2026-09-17T10:00:00-05:00',
      agent: 'field-agent',
      es: 'Visita programada',
      en: 'Visit scheduled',
    },
  ]);

  // Rest of patch still applies.
  const updated = wf.update(r.id, { status: 'contacted' });
  assert.equal(updated.status, 'contacted');

  assert.equal(wf.get('missing'), null);
  assert.equal(wf.update('missing', {}), null);
  assert.deepEqual(wf.notes('missing'), []);
});

test('updateRfq preserves explicit score, recomputes otherwise', () => {
  const r = createRfq({ ref: 'RFQ-FIX-031' });
  const explicit = updateRfq(r.id, { score: 42 });
  assert.equal(explicit.score, 42);
  const recomputed = updateRfq(r.id, {
    quantity: 100,
    unitCost: 10,
    sellUnitPrice: 12,
    product: 'P',
    originPort: 'A',
    destinationPort: 'B',
    incoterms: 'FOB',
  });
  assert.ok(recomputed.score > 42);
});

test('reset + reloadTradeStore: persistence round-trip', () => {
  createSupplier({ name: 'ACME (fixture)', country: 'FICTITIA' });
  createRfq({ ref: 'RFQ-FIX-040' });
  const db = reloadTradeStore();
  assert.equal(db.suppliers.length, 1);
  assert.equal(db.rfqs.length, 1);
  resetTradeStore();
  assert.equal(listSuppliers().length, 0);
  assert.equal(listRfqs().length, 0);
  assert.deepEqual(stats().totalRfqs, 0);
});

// ---------- rfqEngine.js ----------
import {
  safeNum,
  formatMoney,
  formatQty,
  landedCostTotal,
  landedCostUnit,
  targetSellPrice,
  netMarginTotal,
  netMarginPct,
  commissionAmount,
  missingFields,
  rfqVerdict,
  scoreRfq,
  INCOTERMS,
  VERDICT_TIERS,
} from './rfqEngine.js';

test('safeNum: finite non-negative values pass through', () => {
  assert.equal(safeNum(12), 12);
  assert.equal(safeNum('12.5'), 12.5);
  assert.equal(safeNum(0), 0);
});

test('safeNum: bad input falls back', () => {
  assert.equal(safeNum(), 0);
  assert.equal(safeNum('abc'), 0);
  assert.equal(safeNum(NaN), 0);
  assert.equal(safeNum(Infinity), 0);
  assert.equal(safeNum(-5), 0);
  assert.equal(safeNum('abc', 42), 42);
});

test('formatMoney / formatQty', () => {
  assert.equal(formatMoney(1250000), '$1,250,000');
  assert.equal(formatMoney(99.9), '$100');
  assert.equal(formatMoney('abc'), '$0');
  assert.equal(formatQty(1250000), '1,250,000');
  assert.equal(formatQty('abc'), '0');
});

test('landedCostTotal: unitCost*quantity + freight + duties + otherCosts', () => {
  assert.equal(
    landedCostTotal({ unitCost: 10, quantity: 100, freight: 200, duties: 50, otherCosts: 25 }),
    1275,
  );
  assert.equal(landedCostTotal({}), 0);
  assert.equal(landedCostTotal(), 0);
});

test('landedCostUnit: total/quantity, 0 when quantity missing', () => {
  assert.equal(landedCostUnit({ unitCost: 10, quantity: 100, freight: 200 }), 12);
  assert.equal(landedCostUnit({ quantity: 0 }), 0);
  assert.equal(landedCostUnit({}), 0);
  assert.equal(landedCostUnit(), 0);
});

test('targetSellPrice: landed/(1-margin), percent or fraction accepted', () => {
  // landed = 12.5*5000 + 2500 + 800 + 300 = 66100; per unit 13.22; 20% margin → 16.525
  const base = { unitCost: 12.5, quantity: 5000, freight: 2500, duties: 800, otherCosts: 300 };
  assert.equal(targetSellPrice({ ...base, targetMarginPct: 20 }), 16.525);
  assert.equal(targetSellPrice({ ...base, targetMarginPct: 0.2 }), 16.525);
  assert.equal(targetSellPrice({ ...base, targetMarginPct: 0 }), 13.22);
});

test('targetSellPrice: invalid margin or missing data → 0, never throws', () => {
  const base = { unitCost: 10, quantity: 100, freight: 200 };
  assert.equal(targetSellPrice({ ...base, targetMarginPct: 100 }), 0); // 100% margin impossible
  assert.equal(targetSellPrice({ ...base, targetMarginPct: 150 }), 0);
  assert.equal(targetSellPrice({ ...base, targetMarginPct: -5 }), 0);
  assert.equal(targetSellPrice({ ...base, targetMarginPct: 'abc' }), 0);
  assert.equal(targetSellPrice({ unitCost: 10, quantity: 0, targetMarginPct: 20 }), 0);
  assert.equal(targetSellPrice({ quantity: 100, targetMarginPct: 20 }), 0); // no unitCost
  assert.equal(targetSellPrice(), 0);
  assert.equal(targetSellPrice({ unitCost: 0, quantity: 100, targetMarginPct: 20 }), 0);
});

test('netMarginTotal / netMarginPct', () => {
  const rfq = { unitCost: 10, quantity: 100, sellUnitPrice: 12, freight: 200 };
  // revenue 1200, landed 1200 → margin 0
  assert.equal(netMarginTotal(rfq), 0);
  assert.equal(netMarginPct(rfq), 0);
  const winner = { unitCost: 10, quantity: 100, sellUnitPrice: 14, freight: 100 };
  // revenue 1400, landed 1100 → margin 300 → 300/1400
  assert.equal(netMarginTotal(winner), 300);
  assert.ok(Math.abs(netMarginPct(winner) - 300 / 1400) < 1e-9);
  // missing price/quantity → 0
  assert.equal(netMarginTotal({}), 0);
  assert.equal(netMarginTotal({ sellUnitPrice: 12 }), 0);
  assert.equal(netMarginPct({ sellUnitPrice: 12, quantity: 0 }), 0);
  assert.equal(netMarginTotal(), 0);
});

test('commissionAmount: revenue * commissionPct/100', () => {
  assert.equal(commissionAmount({ sellUnitPrice: 15.75, quantity: 5000, commissionPct: 5 }), 3937.5);
  assert.equal(commissionAmount({ sellUnitPrice: 10, quantity: 100 }), 0);
  assert.equal(commissionAmount({}), 0);
  assert.equal(commissionAmount(), 0);
});

test('missingFields reports bilingual entries for absent core fields', () => {
  const missing = missingFields({});
  assert.deepEqual(
    missing.map((m) => m.field),
    ['unitCost', 'sellUnitPrice', 'quantity', 'product', 'originPort', 'destinationPort'],
  );
  assert.deepEqual(missing[0], { field: 'unitCost', es: 'Costo unitario', en: 'Unit cost' });
  assert.equal(
    missingFields({ unitCost: 1, sellUnitPrice: 2, quantity: 3, product: 'P', originPort: 'A', destinationPort: 'B' }).length,
    0,
  );
  assert.equal(missingFields().length, 6);
});

test('rfqVerdict: gray when price data missing', () => {
  const v = rfqVerdict({ product: 'P' });
  assert.equal(v.tier, 'gray');
  assert.equal(v.es, 'Faltan datos');
  assert.equal(v.en, 'Missing data');
  assert.ok(v.reasons.some((r) => r.es.startsWith('Falta:')));
  assert.ok(v.reasons.some((r) => r.es.startsWith('Costo landed por unidad')));
  assert.ok(v.reasons.some((r) => r.es.startsWith('Margen neto total')));
  assert.ok(v.reasons.some((r) => r.es.startsWith('Comisión total')));
  assert.equal(rfqVerdict().tier, 'gray');
});

test('rfqVerdict: green >= 10%, yellow >= 3% boundary, red below', () => {
  const at = (unitCost) => ({ unitCost, quantity: 100, sellUnitPrice: 10 });
  // margin 10% exactly → green
  const green = rfqVerdict(at(9));
  assert.equal(green.tier, 'green');
  assert.equal(green.es, 'Viable');
  // margin 3% exactly → yellow
  const yellow = rfqVerdict(at(9.7));
  assert.equal(yellow.tier, 'yellow');
  assert.equal(yellow.es, 'Marginal');
  // margin 1% → red
  const red = rfqVerdict(at(9.9));
  assert.equal(red.tier, 'red');
  assert.equal(red.es, 'No viable');
  assert.equal(red.en, 'No deal');
  // negative margin → red
  assert.equal(rfqVerdict(at(11)).tier, 'red');
});

test('scoreRfq: full RFQ scores 100, components sum, missing scores 0', () => {
  const full = {
    unitCost: 10,
    sellUnitPrice: 12,
    quantity: 100,
    supplierId: 'sup-1',
    incoterms: 'FOB',
    freight: 200,
    duties: 50,
    otherCosts: 25,
    product: 'Sample widgets (fixture)',
    originPort: 'PORT ALPHA (fixture)',
    destinationPort: 'PORT BETA (fixture)',
    originLat: 25.7,
    originLng: -80.2,
    destLat: 23.1,
    destLng: -82.4,
  };
  assert.equal(scoreRfq(full), 100);

  assert.equal(scoreRfq({ product: 'P' }), 5);
  assert.equal(scoreRfq({ unitCost: 10, sellUnitPrice: 12 }), 30);
  assert.equal(scoreRfq({ quantity: 100 }), 15);
  assert.equal(scoreRfq({ buyerId: 'b-1' }), 10);
  assert.equal(scoreRfq({ incoterms: 'CIF' }), 5);
  assert.equal(scoreRfq({ freight: 1, duties: 2, otherCosts: 3 }), 15);
  assert.equal(scoreRfq({ freight: 1, duties: 2 }), 0); // incomplete costs
  assert.equal(scoreRfq({ originPort: 'A', destinationPort: 'B' }), 10);
  assert.equal(scoreRfq({ originLat: 1, originLng: 2, destLat: 3, destLng: 4 }), 10);
  assert.equal(scoreRfq({}), 0);
  assert.equal(scoreRfq(), 0);
  assert.equal(scoreRfq('garbage'), 0);
});

test('INCOTERMS and VERDICT_TIERS constants', () => {
  assert.deepEqual(INCOTERMS, ['FOB', 'CIF', 'EXW', 'DAP']);
  assert.deepEqual(VERDICT_TIERS, ['green', 'yellow', 'red', 'gray']);
});

// ---------- supplierImporter.js ----------
import {
  parseTradeCsv,
  parseCsvRows,
  parseNumberLoose,
  CSV_TEMPLATE_HEADERS,
  sampleCsvTemplate,
  MAX_TRADE_ROWS,
} from './supplierImporter.js';

test('MAX_TRADE_ROWS is 5000', () => {
  assert.equal(MAX_TRADE_ROWS, 5000);
});

test('CSV_TEMPLATE_HEADERS lists canonical trade fields', () => {
  for (const h of [
    'ref', 'product', 'quantity', 'unitCost', 'sellUnitPrice', 'commissionPct',
    'targetMarginPct', 'incoterms', 'originPort', 'destinationPort',
    'originLat', 'originLng', 'destLat', 'destLng', 'supplier', 'buyer',
    'status', 'freight', 'duties', 'otherCosts', 'notes',
    'name', 'type', 'role', 'country', 'contactName', 'contactPhone',
    'contactEmail', 'verification',
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
  assert.match(byHeader.product, /fictional/i);
  assert.match(byHeader.supplier, /fictional/i);
  assert.match(byHeader.notes, /sample|ejemplo/i);
});

test('parseCsvRows handles quoted fields with commas and embedded quotes', () => {
  const rows = parseCsvRows('a,b\n"hello, world","say ""hi"""\n');
  assert.deepEqual(rows[0], ['a', 'b']);
  assert.deepEqual(rows[1], ['hello, world', 'say "hi"']);
  const multi = parseCsvRows('"line1\nline2",x\n');
  assert.deepEqual(multi[0], ['line1\nline2', 'x']);
});

test('parseTradeCsv: English headers, RFQ row parses all fields', () => {
  const csv = [
    'ref,product,quantity,unitCost,sellUnitPrice,commissionPct,targetMarginPct,incoterms,originPort,destinationPort,originLat,originLng,destLat,destLng,supplier,buyer,status,freight,duties,otherCosts,notes',
    'RFQ-001,"Sample Widget (fictional)",5000,12.50,15.75,5,20,FOB,"Sample Origin Port","Sample Destination Port",25.7,-80.2,23.1,-82.4,"Sample Supplier (fictional)","Sample Buyer (fictional)",quoting,2500,800,300,"Sample note"',
  ].join('\n');
  const { rfqs, suppliers, errors } = parseTradeCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(suppliers.length, 0);
  assert.equal(rfqs.length, 1);
  const r = rfqs[0];
  assert.equal(r.ref, 'RFQ-001');
  assert.equal(r.product, 'Sample Widget (fictional)');
  assert.equal(r.quantity, 5000);
  assert.equal(r.unitCost, 12.5);
  assert.equal(r.sellUnitPrice, 15.75);
  assert.equal(r.commissionPct, 5);
  assert.equal(r.targetMarginPct, 20);
  assert.equal(r.incoterms, 'FOB');
  assert.equal(r.originLat, 25.7);
  assert.equal(r.destLng, -82.4);
  assert.equal(r.status, 'quoting');
  assert.equal(r.freight, 2500);
  assert.equal(r.duties, 800);
  assert.equal(r.otherCosts, 300);
  assert.equal(r.notes, 'Sample note');
});

test('parseTradeCsv: Spanish headers with accents map correctly', () => {
  const csv = [
    'referencia,producto,cantidad,costoUnitario,precioVenta,comisión,incoterms,puertoOrigen,puertoDestino,latOrigen,lngOrigen,latDestino,lngDestino,proveedor,comprador,estado,flete,aranceles,otrosCostos,notas',
    'RFQ-002,"Widget de muestra (ficticio)",1000,"1.250,50",70.25,3,CIF,"Puerto Origen (ficticio)","Puerto Destino (ficticio)",25.7,-80.2,23.1,-82.4,"Proveedor Muestra (ficticio)","Comprador Muestra (ficticio)",cotizando,500,100,50,"Nota de muestra"',
  ].join('\n');
  const { rfqs, errors } = parseTradeCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rfqs.length, 1);
  const r = rfqs[0];
  assert.equal(r.ref, 'RFQ-002');
  assert.equal(r.product, 'Widget de muestra (ficticio)');
  assert.equal(r.quantity, 1000);
  assert.equal(r.unitCost, 1250.5); // ES decimal comma
  assert.equal(r.sellUnitPrice, 70.25);
  assert.equal(r.commissionPct, 3);
  assert.equal(r.status, 'quoting'); // cotizando → quoting
  assert.equal(r.freight, 500);
  assert.equal(r.duties, 100);
  assert.equal(r.otherCosts, 50);
});

test('parseTradeCsv: supplier row (name, no ref) parses supplier fields', () => {
  const csv = [
    'name,type,role,country,contactName,contactPhone,contactEmail,verification,notes',
    '"Sample Exporter (fictional)",fabricante,proveedor,Fictitia,"Jane Doe",+1000,jane@example.invalid,verificado,"Sample supplier note"',
  ].join('\n');
  const { rfqs, suppliers, errors } = parseTradeCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rfqs.length, 0);
  assert.equal(suppliers.length, 1);
  const s = suppliers[0];
  assert.equal(s.name, 'Sample Exporter (fictional)');
  assert.equal(s.type, 'manufacturer');
  assert.equal(s.role, 'supplier');
  assert.equal(s.country, 'Fictitia');
  assert.equal(s.contactName, 'Jane Doe');
  assert.equal(s.contactEmail, 'jane@example.invalid');
  assert.equal(s.verification, 'verified');
});

test('parseTradeCsv: one file mixes RFQ and supplier rows', () => {
  const csv = [
    'ref,name,quantity,unitCost,sellUnitPrice,status,type',
    'RFQ-003,,100,10,12,negociando,',
    ',"Sample Trader (fictional)",,,,,comercializadora',
  ].join('\n');
  const { rfqs, suppliers, errors } = parseTradeCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rfqs.length, 1);
  assert.equal(suppliers.length, 1);
  assert.equal(rfqs[0].status, 'negotiating');
  assert.equal(suppliers[0].type, 'trader');
});

test('parseTradeCsv: row with neither ref nor name is an error, row skipped', () => {
  const csv = [
    'ref,name,quantity,unitCost,sellUnitPrice',
    ',,100,,',
    'RFQ-004,,200,,', // warning: missing prices, but row still accepted
  ].join('\n');
  const { rfqs, suppliers, errors } = parseTradeCsv(csv);
  assert.equal(rfqs.length, 1);
  assert.equal(suppliers.length, 0);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].row, 1);
  assert.match(errors[0].message, /missing ref and name/i);
  assert.match(errors[1].message, /Aviso \(warning\)/);
});

test('parseTradeCsv: non-numeric coordinates skip the row with an error', () => {
  const csv = [
    'ref,quantity,originLat,originLng',
    'RFQ-005,100,abc,-80.2',
  ].join('\n');
  const { rfqs, errors } = parseTradeCsv(csv);
  assert.equal(rfqs.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /non-numeric coordinates/i);
});

test('parseTradeCsv: out-of-range coordinates skip the row with an error', () => {
  const csv = [
    'ref,quantity,originLat,originLng',
    'RFQ-006,100,95.0,-80.2',
  ].join('\n');
  const { rfqs, errors } = parseTradeCsv(csv);
  assert.equal(rfqs.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /out of range/i);
});

test('parseTradeCsv: missing quantity/prices → warning error, fields stay null', () => {
  const csv = [
    'ref,product,quantity,unitCost,sellUnitPrice',
    'RFQ-007,"Sample Widget (fictional)",,,',
  ].join('\n');
  const { rfqs, errors } = parseTradeCsv(csv);
  assert.equal(rfqs.length, 1);
  assert.equal(rfqs[0].quantity, null);
  assert.equal(rfqs[0].unitCost, null);
  assert.equal(rfqs[0].sellUnitPrice, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Aviso \(warning\)/);
  assert.match(errors[0].message, /quantity\/unitCost\/sellUnitPrice/);
});

test('parseTradeCsv: status aliases ES/EN, unknown → prospect', () => {
  const csv = [
    'ref,status',
    'R1,prospecto',
    'R2,contactado',
    'R3,ganado',
    'R4,perdido',
    'R5,descartado',
    'R6,closed-ish',
  ].join('\n');
  const { rfqs } = parseTradeCsv(csv);
  assert.deepEqual(
    rfqs.map((r) => r.status),
    ['prospect', 'contacted', 'won', 'lost', 'lost', 'prospect'],
  );
});

test('parseTradeCsv: supplier type/role/verification aliases, unknown → defaults', () => {
  const csv = [
    'name,type,role,verification',
    '"S1 (fictional)",distribuidor,ambos,marcado',
    '"S2 (fictional)",logística,comprador,enrevision',
    '"S3 (fictional)",weird,odd,strange',
  ].join('\n');
  const { suppliers } = parseTradeCsv(csv);
  assert.deepEqual(
    suppliers.map((s) => [s.type, s.role, s.verification]),
    [
      ['distributor', 'both', 'flagged'],
      ['logistics', 'buyer', 'in-review'],
      ['trader', 'both', 'unverified'],
    ],
  );
});

test('parseTradeCsv: incoterms normalized, EXW allowed', () => {
  const csv = [
    'ref,incoterms',
    'R1,EXW',
    'R2,DAP',
    'R3,CIF extra',
  ].join('\n');
  const { rfqs } = parseTradeCsv(csv);
  assert.deepEqual(
    rfqs.map((r) => r.incoterms),
    ['EXW', 'DAP', ''],
  );
});

test('parseTradeCsv: blank rows ignored, empty file and bad headers error', () => {
  const csv = 'ref,quantity,unitCost,sellUnitPrice\n\nRFQ-008,100,10,12\n\n';
  const ok = parseTradeCsv(csv);
  assert.equal(ok.rfqs.length, 1);
  assert.equal(ok.errors.length, 0);

  assert.deepEqual(parseTradeCsv('').errors[0].message, 'Archivo vacío (empty file)');
  assert.deepEqual(parseTradeCsv('   \n  \n').errors[0].message, 'Archivo vacío (empty file)');

  const badHeaders = parseTradeCsv('foo,bar\n1,2\n');
  assert.match(badHeaders.errors[0].message, /no recognized columns/i);
});

test('parseTradeCsv: enforces the 5000-row cap with an error', () => {
  const lines = ['ref,quantity,unitCost,sellUnitPrice'];
  for (let i = 1; i <= MAX_TRADE_ROWS + 1; i += 1) {
    lines.push(`R${i},100,10,12`);
  }
  const { rfqs, errors } = parseTradeCsv(lines.join('\n'));
  assert.equal(rfqs.length, MAX_TRADE_ROWS);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, MAX_TRADE_ROWS + 1);
  assert.match(errors[0].message, /límite|limit/i);
});

test('parseNumberLoose: US/ES decimals, $, blanks, garbage', () => {
  assert.equal(parseNumberLoose('$1,250,000.50'), 1250000.5);
  assert.equal(parseNumberLoose('1.250,50'), 1250.5);
  assert.equal(parseNumberLoose('185,000'), 185000);
  assert.equal(parseNumberLoose('1,25'), 1.25);
  assert.equal(parseNumberLoose('  '), null);
  assert.equal(parseNumberLoose(''), null);
  assert.equal(parseNumberLoose(null), null);
  assert.equal(parseNumberLoose('garbage'), null);
  assert.equal(parseNumberLoose('-50'), -50);
});

test('imported RFQ flows into the store and engine honestly', () => {
  const csv = [
    'ref,product,quantity,unitCost,sellUnitPrice,commissionPct,originPort,destinationPort',
    'RFQ-IMP-001,"Sample Widget (fictional)",5000,12.50,15.75,5,"Sample Origin Port","Sample Destination Port"',
  ].join('\n');
  const { rfqs, errors } = parseTradeCsv(csv);
  assert.equal(errors.length, 0);
  const created = createRfq(rfqs[0]);
  assert.equal(created.ref, 'RFQ-IMP-001');
  const verdict = rfqVerdict(created);
  // landed 62500, revenue 78750 → margin 16250/78750 ≈ 20.6% → green
  assert.equal(verdict.tier, 'green');
  // commission 5% of 78750 = 3937.5
  assert.equal(commissionAmount(created), 3937.5);
});
