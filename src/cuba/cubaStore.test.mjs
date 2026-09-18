// Unit tests for the Cuba desk data layer: cubaStore.
// All fixture names/values are deliberately fictional. No real buyers,
// partners, or requests appear anywhere in these fixtures.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_KEY,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  OPEN_REQUEST_STATUSES,
  BUYER_TYPES,
  BUYER_TYPE_LABELS,
  PARTNER_TYPES,
  VERIFICATION,
  VERIFICATION_LABELS,
  CUBA_PORTS,
  INCOTERMS,
  chicagoIso,
  createBuyer,
  getBuyer,
  updateBuyer,
  deleteBuyer,
  listBuyers,
  addBuyerNote,
  createRequest,
  getRequest,
  updateRequest,
  moveRequest,
  deleteRequest,
  listRequests,
  addRequestNote,
  createPartner,
  getPartner,
  updatePartner,
  deletePartner,
  listPartners,
  addPartnerNote,
  stats,
  onMutate,
  asWorkforceStore,
  resetCubaStore,
} from './cubaStore.js';

beforeEach(() => {
  resetCubaStore();
});

test('STORAGE_KEY namespaced for the cuba desk', () => {
  assert.equal(STORAGE_KEY, 'sahjony.cuba.v1');
});

test('constants: request statuses, buyer/partner types, verification', () => {
  assert.deepEqual(REQUEST_STATUSES, [
    'intake',
    'triage',
    'quoted',
    'negotiating',
    'won',
    'lost',
  ]);
  assert.equal(REQUEST_STATUS_LABELS.intake.es, 'Nueva solicitud');
  assert.ok(OPEN_REQUEST_STATUSES.includes('intake'));
  assert.ok(!OPEN_REQUEST_STATUSES.includes('won'));
  assert.ok(BUYER_TYPES.includes('mipyme-privada'));
  assert.equal(BUYER_TYPE_LABELS.tcp.es, 'Trabajador por cuenta propia');
  assert.ok(PARTNER_TYPES.includes('commercial'));
  assert.deepEqual(VERIFICATION, [
    'unverified',
    'in-review',
    'verified',
    'flagged',
  ]);
  assert.equal(VERIFICATION_LABELS.verified.es, 'Verificado');
});

test('CUBA_PORTS carries the four real receiving ports', () => {
  const ids = CUBA_PORTS.map((p) => p.id).sort();
  assert.deepEqual(ids, [
    'cienfuegos',
    'la-habana',
    'mariel',
    'santiago',
  ]);
  for (const p of CUBA_PORTS) {
    assert.ok(Number.isFinite(p.lat), `port ${p.id} lat finite`);
    assert.ok(Number.isFinite(p.lng), `port ${p.id} lng finite`);
  }
});

test('chicagoIso stamps America/Chicago offset', () => {
  const iso = chicagoIso(new Date('2026-09-17T18:00:00Z'));
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.ok(iso.endsWith('-05:00') || iso.endsWith('-06:00'));
});

test('buyer CRUD: create/get/update/delete', () => {
  const b = createBuyer({
    name: 'MIPYME Ficticia SRL',
    type: 'mipyme-privada',
    province: 'La Habana',
    municipality: 'Playa',
    contact: { whatsapp: '+53-555-0101' },
    interestedProducts: ['arroz'],
  });
  assert.ok(b.id);
  assert.equal(b.verification, 'unverified');
  assert.deepEqual(b.interestedProducts, ['arroz']);
  assert.equal(getBuyer(b.id).name, 'MIPYME Ficticia SRL');

  const upd = updateBuyer(b.id, { verification: 'verified' });
  assert.equal(upd.verification, 'verified');

  assert.equal(listBuyers().length, 1);
  assert.equal(listBuyers({ verification: 'verified' }).length, 1);
  assert.ok(deleteBuyer(b.id));
  assert.equal(listBuyers().length, 0);
});

test('buyer dedupe by name+province', () => {
  const a = createBuyer({ name: 'Ficticio Duplicado', province: 'Camagüey' });
  const b = createBuyer({ name: '  FICTICIO duplicado ', province: ' camagüey' });
  assert.equal(a.id, b.id);
  assert.equal(listBuyers().length, 1);
});

test('buyer records carry NO address/registration fields (Blocker #4)', () => {
  const b = createBuyer({
    name: 'Sin Datos Sensibles',
    province: 'Holguín',
    streetAddress: 'Calle Ficticia 123', // must be dropped
    registrationNumber: 'REG-999', // must be dropped
  });
  assert.equal(b.streetAddress, undefined);
  assert.equal(b.registrationNumber, undefined);
  assert.ok(!('streetAddress' in b));
  assert.ok(!('registrationNumber' in b));
});

test('addBuyerNote appends a bilingual note', () => {
  const b = createBuyer({ name: 'Nota Ficticia', province: 'Pinar del Río' });
  const note = addBuyerNote(b.id, 'sourcing-scout', 'Hola', 'Hello');
  assert.ok(note.at);
  assert.equal(note.agent, 'sourcing-scout');
  assert.equal(getBuyer(b.id).agentNotes.length, 1);
});

test('request CRUD: create/get/move/update/delete', () => {
  const r = createRequest({
    ref: 'CUBA-101',
    product: 'Arroz pilado',
    quantity: 5000,
    targetPrice: 0.65,
    destinationPort: 'Mariel',
  });
  assert.ok(r.id);
  assert.equal(r.status, 'intake');
  assert.ok(Number.isFinite(r.score) && r.score > 0);
  assert.equal(getRequest(r.id).ref, 'CUBA-101');

  moveRequest(r.id, 'triage');
  assert.equal(getRequest(r.id).status, 'triage');
  assert.throws(() => moveRequest(r.id, 'bogus'), /Unknown cuba request status/);

  const upd = updateRequest(r.id, { quantity: 6000 });
  assert.equal(upd.quantity, 6000);
  assert.ok(deleteRequest(r.id));
  assert.equal(listRequests().length, 0);
});

test('request dedupe by ref', () => {
  const a = createRequest({ ref: 'CUBA-202', product: 'Aceite' });
  const b = createRequest({ ref: 'cuba-202', product: 'Aceite' });
  assert.equal(a.id, b.id);
});

test('addRequestNote appends a bilingual note', () => {
  const r = createRequest({ ref: 'CUBA-303', product: 'Frijoles' });
  const note = addRequestNote(r.id, 'compliance', 'Revisado', 'Reviewed');
  assert.ok(note.at);
  assert.equal(getRequest(r.id).agentNotes.length, 1);
});

test('partner CRUD: create/get/update/delete', () => {
  const p = createPartner({
    name: 'Socio Ficticio Ltd',
    type: 'logistics',
    country: 'Panamá',
  });
  assert.ok(p.id);
  assert.equal(getPartner(p.id).type, 'logistics');
  const upd = updatePartner(p.id, { verification: 'verified' });
  assert.equal(upd.verification, 'verified');
  assert.equal(listPartners().length, 1);
  assert.ok(deletePartner(p.id));
  assert.equal(listPartners().length, 0);
});

test('partner dedupe by name+country', () => {
  const a = createPartner({ name: 'Repetido SA', country: 'México' });
  const b = createPartner({ name: 'repetido sa', country: 'méxico' });
  assert.equal(a.id, b.id);
  assert.equal(listPartners().length, 1);
});

test('addPartnerNote appends a bilingual note', () => {
  const p = createPartner({ name: 'Nota Socio', country: 'España' });
  const note = addPartnerNote(p.id, 'oversight', 'OK', 'OK');
  assert.ok(note.at);
  assert.equal(getPartner(p.id).agentNotes.length, 1);
});

test('stats(): buyers, open requests, partners', () => {
  createBuyer({ name: 'B1', province: 'Granma', verification: 'verified' });
  createBuyer({ name: 'B2', province: 'Granma' });
  const r1 = createRequest({ ref: 'CUBA-401', product: 'Arroz', quantity: 10 });
  createRequest({ ref: 'CUBA-402', product: 'Azúcar', quantity: 5 });
  createPartner({ name: 'P1', country: 'Canadá', verification: 'verified' });
  moveRequest(r1.id, 'won');
  const s = stats();
  assert.equal(s.totalBuyers, 2);
  assert.equal(s.verifiedBuyers, 1);
  assert.equal(s.totalRequests, 2);
  assert.equal(s.openRequests, 1);
  assert.equal(s.byStatus.won, 1);
  assert.equal(s.totalPartners, 1);
  assert.equal(s.verifiedPartners, 1);
});

test('onMutate fires on mutation', () => {
  let calls = 0;
  const unsub = onMutate(() => {
    calls += 1;
  });
  createBuyer({ name: 'Listener', province: 'Matanzas' });
  createRequest({ ref: 'CUBA-501', product: 'Café' });
  unsub();
  assert.equal(calls, 2);
});

test('asWorkforceStore(): getAll/get/update/notes with dedupe', () => {
  const wf = asWorkforceStore();
  const r = createRequest({ ref: 'CUBA-601', product: 'Miel', quantity: 100 });
  assert.equal(wf.getAll().length, 1);
  assert.equal(wf.get(r.id).ref, 'CUBA-601');

  const upd = wf.update(r.id, {
    agentNotes: [{ t: 't1', agent: 'sourcing-scout', es: 'Hola', en: 'Hi' }],
  });
  assert.equal(upd.agentNotes.length, 1);
  // repeat update with the same note → deduped
  wf.update(r.id, {
    agentNotes: [{ t: 't1', agent: 'sourcing-scout', es: 'Hola', en: 'Hi' }],
  });
  assert.equal(getRequest(r.id).agentNotes.length, 1);

  const notes = wf.notes(r.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].agent, 'sourcing-scout');
  assert.equal(notes[0].es, 'Hola');
});

test('incoterms list is non-empty', () => {
  assert.ok(INCOTERMS.includes('CIF'));
  assert.ok(INCOTERMS.length >= 4);
});
