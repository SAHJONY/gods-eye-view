import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  CARGO_STATUSES,
  STATUS_LABELS,
  COUNTERPARTY_TYPES,
  COUNTERPARTY_ROLES,
  VERIFICATION,
  VERIFICATION_LABELS,
  chicagoIso,
  createCounterparty,
  getCounterparty,
  updateCounterparty,
  deleteCounterparty,
  listCounterparties,
  addCounterpartyNote,
  createCargo,
  getCargo,
  updateCargo,
  moveCargo,
  deleteCargo,
  listCargoes,
  addCargoNote,
  stats,
  asWorkforceStore,
  resetCrudeStore,
  reloadCrudeStore,
} from './counterpartyStore.js';

const FIXTURE_CP = {
  name: 'ACME TRADING (fixture)',
  type: 'trader',
  role: 'both',
  country: 'FICTITIA',
};

const FIXTURE_CARGO = {
  ref: 'FIXTURE-001',
  grade: 'WTI',
  volumeBbl: 100000,
  buyPrice: 50,
  sellPrice: 60,
  commissionPerBbl: 0.5,
  incoterms: 'FOB',
  laycanStart: '2026-10-01',
  laycanEnd: '2026-10-10',
  loadPort: 'PORT ALPHA (fixture)',
  dischargePort: 'PORT BETA (fixture)',
  supplierId: 'cp-fixture-1',
  costs: { freight: 100000, insurance: 50000, inspection: 25000, other: 25000 },
};

beforeEach(() => {
  resetCrudeStore();
});

test('chicagoIso: matches America/Chicago offset format', () => {
  const iso = chicagoIso(new Date('2026-09-17T05:00:00Z'));
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  // 05:00 UTC = 00:00 CDT on 2026-09-17
  assert.ok(iso.startsWith('2026-09-17T00:00:00-05:00'), iso);
});

test('constants: frozen and bilingual', () => {
  assert.ok(Object.isFrozen(CARGO_STATUSES));
  assert.ok(Object.isFrozen(COUNTERPARTY_TYPES));
  assert.ok(Object.isFrozen(COUNTERPARTY_ROLES));
  assert.ok(Object.isFrozen(VERIFICATION));
  assert.equal(STORAGE_KEY, 'sahjony.crude.v1');
  assert.equal(STATUS_LABELS.prospect.es, 'Prospecto');
  assert.equal(STATUS_LABELS.prospect.en, 'Prospect');
  assert.equal(STATUS_LABELS['in-transit'].es, 'En tránsito');
  assert.equal(STATUS_LABELS['in-transit'].en, 'In transit');
  assert.equal(STATUS_LABELS.dead.es, 'Descartado');
  assert.equal(STATUS_LABELS.dead.en, 'Dead');
  assert.equal(VERIFICATION_LABELS.verified.es, 'Verificado');
  assert.equal(VERIFICATION_LABELS['in-review'].en, 'In review');
  assert.equal(VERIFICATION_LABELS.flagged.en, 'Flagged');
  assert.ok(CARGO_STATUSES.includes('closed'));
  assert.ok(COUNTERPARTY_TYPES.includes('end-user'));
});

test('createCounterparty: normalized shape with empty contact until added', () => {
  const cp = createCounterparty(FIXTURE_CP);
  assert.ok(cp.id);
  assert.equal(cp.name, 'ACME TRADING (fixture)');
  assert.equal(cp.country, 'FICTITIA');
  assert.equal(cp.verification, 'unverified');
  assert.deepEqual(cp.contact, { name: '', phone: '', email: '' });
  assert.deepEqual(cp.agentNotes, []);
  assert.ok(cp.createdAt && cp.updatedAt);
});

test('createCounterparty: unknown type/role/verification coerce to defaults', () => {
  const cp = createCounterparty({
    name: 'WEIRD (fixture)',
    country: 'FICTITIA',
    type: 'bogus',
    role: 'bogus',
    verification: 'bogus',
  });
  assert.equal(cp.type, 'trader');
  assert.equal(cp.role, 'both');
  assert.equal(cp.verification, 'unverified');
});

test('createCounterparty: dedupes on normalized name+country, returns existing', () => {
  const a = createCounterparty(FIXTURE_CP);
  const b = createCounterparty({
    name: '  acme trading (fixture)  ',
    country: 'fictitia',
    type: 'producer',
  });
  assert.equal(b.id, a.id);
  assert.equal(listCounterparties().length, 1);
});

test('createCounterparty: same name, different country is a different record', () => {
  createCounterparty(FIXTURE_CP);
  const other = createCounterparty({ ...FIXTURE_CP, country: 'OTHERLAND' });
  assert.equal(listCounterparties().length, 2);
  assert.ok(other.id);
});

test('counterparty CRUD: get/update/delete', () => {
  const cp = createCounterparty(FIXTURE_CP);
  assert.equal(getCounterparty(cp.id).name, 'ACME TRADING (fixture)');
  const updated = updateCounterparty(cp.id, {
    verification: 'verified',
    contact: { name: 'J. Doe (fixture)', phone: '', email: '' },
  });
  assert.equal(updated.verification, 'verified');
  assert.equal(updated.contact.name, 'J. Doe (fixture)');
  assert.equal(getCounterparty('nope'), null);
  assert.equal(updateCounterparty('nope', {}), null);
  assert.equal(deleteCounterparty(cp.id), true);
  assert.equal(deleteCounterparty(cp.id), false);
  assert.equal(listCounterparties().length, 0);
});

test('addCounterpartyNote: bilingual note with at/agent/es/en', () => {
  const cp = createCounterparty(FIXTURE_CP);
  const note = addCounterpartyNote(
    cp.id,
    'researcher',
    'Nota (fixture)',
    'Note (fixture)',
  );
  assert.equal(note.agent, 'researcher');
  assert.equal(note.es, 'Nota (fixture)');
  assert.equal(note.en, 'Note (fixture)');
  assert.ok(note.at);
  assert.equal(getCounterparty(cp.id).agentNotes.length, 1);
  assert.equal(addCounterpartyNote('nope', 'a', 'b', 'c'), null);
});

test('createCargo: normalized shape, auto-score, lat/lng null when blank', () => {
  const cargo = createCargo(FIXTURE_CARGO);
  assert.ok(cargo.id);
  assert.equal(cargo.ref, 'FIXTURE-001');
  assert.equal(cargo.status, 'prospect');
  assert.equal(cargo.score, 100);
  assert.equal(cargo.loadLat, null);
  assert.equal(cargo.loadLng, null);
  assert.equal(cargo.dischargeLat, null);
  assert.equal(cargo.dischargeLng, null);
  assert.deepEqual(cargo.costs, {
    freight: 100000,
    insurance: 50000,
    inspection: 25000,
    other: 25000,
  });
});

test('createCargo: keeps real coordinates, never (0,0) from blanks', () => {
  const cargo = createCargo({
    ...FIXTURE_CARGO,
    ref: 'FIXTURE-002',
    loadLat: 29.75,
    loadLng: -95.08,
    dischargeLat: '',
    dischargeLng: undefined,
  });
  assert.equal(cargo.loadLat, 29.75);
  assert.equal(cargo.loadLng, -95.08);
  assert.equal(cargo.dischargeLat, null);
  assert.equal(cargo.dischargeLng, null);
});

test('createCargo: dedupes on normalized ref, returns existing', () => {
  const a = createCargo(FIXTURE_CARGO);
  const b = createCargo({ ref: '  fixture-001 ', volumeBbl: 1 });
  assert.equal(b.id, a.id);
  assert.equal(b.volumeBbl, 100000);
  assert.equal(listCargoes().length, 1);
});

test('moveCargo: status transitions and coercion', () => {
  const cargo = createCargo(FIXTURE_CARGO);
  assert.equal(moveCargo(cargo.id, 'negotiating').status, 'negotiating');
  assert.throws(
    () => moveCargo(cargo.id, 'bogus-status'),
    /Unknown crude cargo status/,
  );
  assert.equal(moveCargo('nope', 'negotiating'), null);
  assert.equal(
    createCargo({ ref: 'FIXTURE-003', status: 'diligence' }).status,
    'diligence',
  );
  assert.throws(
    () => createCargo({ ref: 'FIXTURE-004', status: 'bogus' }),
    /Unknown crude cargo status/,
  );
});

test('updateCargo: merges patch, recomputes score, keeps createdAt', () => {
  const cargo = createCargo({ ref: 'FIXTURE-005', grade: 'WTI' });
  const createdAt = cargo.createdAt;
  const updated = updateCargo(cargo.id, {
    volumeBbl: 500000,
    buyPrice: 50,
    sellPrice: 55,
  });
  assert.equal(updated.createdAt, createdAt);
  assert.ok(updated.score > 0);
  assert.equal(updateCargo('nope', {}), null);
});

test('updateCargo: explicit score patch is respected', () => {
  const cargo = createCargo({ ref: 'FIXTURE-006' });
  assert.equal(updateCargo(cargo.id, { score: 42 }).score, 42);
});

test('listCargoes: filter object and minScore', () => {
  createCargo(FIXTURE_CARGO);
  createCargo({ ref: 'FIXTURE-007', grade: 'Brent' });
  assert.equal(listCargoes().length, 2);
  assert.equal(listCargoes({ grade: 'WTI' }).length, 1);
  assert.equal(listCargoes({ minScore: 100 }).length, 1);
  assert.equal(listCargoes((c) => c.ref === 'FIXTURE-007').length, 1);
});

test('deleteCargo: removes the record', () => {
  const cargo = createCargo(FIXTURE_CARGO);
  assert.equal(deleteCargo(cargo.id), true);
  assert.equal(deleteCargo(cargo.id), false);
  assert.equal(getCargo(cargo.id), null);
});

test('addCargoNote: bilingual note with at/agent/es/en', () => {
  const cargo = createCargo(FIXTURE_CARGO);
  const note = addCargoNote(
    cargo.id,
    'analyst',
    'Análisis (fixture)',
    'Analysis (fixture)',
  );
  assert.equal(note.agent, 'analyst');
  assert.equal(note.es, 'Análisis (fixture)');
  assert.equal(note.en, 'Analysis (fixture)');
  assert.ok(note.at);
  assert.equal(addCargoNote('nope', 'a', 'b', 'c'), null);
});

test('stats: totals, open-only volume and commission', () => {
  const supplier = createCounterparty(FIXTURE_CP);
  const buyer = createCounterparty({
    name: 'BUYER CO (fixture)',
    country: 'FICTITIA',
    role: 'buyer',
  });
  updateCounterparty(supplier.id, { verification: 'verified' });

  const open = createCargo({
    ...FIXTURE_CARGO,
    supplierId: supplier.id,
    buyerId: buyer.id,
  });
  const closedCargo = createCargo({ ref: 'FIXTURE-008', volumeBbl: 200000 });
  moveCargo(closedCargo.id, 'closed');
  const deadCargo = createCargo({ ref: 'FIXTURE-009', volumeBbl: 300000 });
  moveCargo(deadCargo.id, 'dead');

  const s = stats();
  assert.equal(s.totalCargoes, 3);
  assert.equal(s.openCargoes, 1);
  assert.equal(s.byStatus.prospect, 1);
  assert.equal(s.byStatus.closed, 1);
  assert.equal(s.byStatus.dead, 1);
  // Open only: FIXTURE-001 volume 100000; closed/dead excluded.
  assert.equal(s.totalVolumeBbl, 100000);
  // 100000 bbl * $0.50 commission = $50,000
  assert.equal(s.potentialCommission, 50000);
  assert.equal(s.totalCounterparties, 2);
  assert.equal(s.verifiedCounterparties, 1);
  assert.equal(getCargo(open.id).id, open.id);
});

test('stats: empty store', () => {
  const s = stats();
  assert.equal(s.totalCargoes, 0);
  assert.equal(s.openCargoes, 0);
  assert.equal(s.totalVolumeBbl, 0);
  assert.equal(s.potentialCommission, 0);
  assert.equal(s.totalCounterparties, 0);
  assert.equal(s.verifiedCounterparties, 0);
  for (const status of CARGO_STATUSES) assert.equal(s.byStatus[status], 0);
});

test('persistence round-trip: reloadCrudeStore restores cargoes and counterparties', () => {
  const cp = createCounterparty(FIXTURE_CP);
  const cargo = createCargo({ ...FIXTURE_CARGO, supplierId: cp.id });
  addCargoNote(cargo.id, 'analyst', 'Nota (fixture)', 'Note (fixture)');
  const db = reloadCrudeStore();
  assert.equal(db.cargoes.length, 1);
  assert.equal(db.counterparties.length, 1);
  const reloaded = getCargo(cargo.id);
  assert.equal(reloaded.ref, 'FIXTURE-001');
  assert.equal(reloaded.score, 100);
  assert.equal(reloaded.agentNotes.length, 1);
});

test('asWorkforceStore: getAll/get over cargoes', () => {
  const cargo = createCargo(FIXTURE_CARGO);
  const wf = asWorkforceStore();
  assert.equal(wf.getAll().length, 1);
  assert.equal(wf.get(cargo.id).ref, 'FIXTURE-001');
  assert.equal(wf.get('nope'), null);
});

test('asWorkforceStore: notes maps at->t shape', () => {
  const cargo = createCargo(FIXTURE_CARGO);
  addCargoNote(cargo.id, 'analyst', 'Nota (fixture)', 'Note (fixture)');
  const notes = asWorkforceStore().notes(cargo.id);
  assert.equal(notes.length, 1);
  assert.deepEqual(Object.keys(notes[0]).sort(), ['agent', 'en', 'es', 't']);
  assert.equal(notes[0].agent, 'analyst');
  assert.equal(notes[0].es, 'Nota (fixture)');
  assert.equal(notes[0].en, 'Note (fixture)');
  assert.ok(notes[0].t);
  assert.deepEqual(asWorkforceStore().notes('nope'), []);
});

test('asWorkforceStore: update merges notes without duplicating', () => {
  const cargo = createCargo(FIXTURE_CARGO);
  const first = addCargoNote(
    cargo.id,
    'analyst',
    'Nota (fixture)',
    'Note (fixture)',
  );
  const wf = asWorkforceStore();
  const updated = wf.update(cargo.id, {
    agentNotes: [
      {
        at: first.at,
        agent: 'analyst',
        es: 'Nota (fixture)',
        en: 'Note (fixture)',
      },
      {
        at: '2026-09-17T01:00:00-05:00',
        agent: 'analyst',
        es: 'Otra (fixture)',
        en: 'Another (fixture)',
      },
    ],
  });
  assert.equal(updated.agentNotes.length, 2);
  // Second identical update must not duplicate.
  const again = wf.update(cargo.id, {
    agentNotes: [
      {
        at: first.at,
        agent: 'analyst',
        es: 'Nota (fixture)',
        en: 'Note (fixture)',
      },
    ],
  });
  assert.equal(again.agentNotes.length, 2);
  assert.equal(wf.notes(cargo.id).length, 2);
});

test('asWorkforceStore: update applies regular patch fields', () => {
  const cargo = createCargo(FIXTURE_CARGO);
  const updated = asWorkforceStore().update(cargo.id, {
    status: 'negotiating',
  });
  assert.equal(updated.status, 'negotiating');
  assert.equal(asWorkforceStore().update('nope', {}), null);
});

test('resetCrudeStore: wipes cargoes and counterparties', () => {
  createCargo(FIXTURE_CARGO);
  createCounterparty(FIXTURE_CP);
  resetCrudeStore();
  assert.equal(listCargoes().length, 0);
  assert.equal(listCounterparties().length, 0);
});
