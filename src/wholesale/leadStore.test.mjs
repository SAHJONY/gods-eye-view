import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLead,
  getLead,
  updateLead,
  listLeads,
  moveLead,
  deleteLead,
  addAgentNote,
  addBuyer,
  getBuyer,
  updateBuyer,
  deleteBuyer,
  listBuyers,
  stats,
  resetWholesaleStore,
  reloadWholesaleStore,
  STATUSES,
  STATUS_LABELS,
  STORAGE_KEY,
  chicagoIso,
  normalizeAddress,
} from './leadStore.js';

beforeEach(() => {
  resetWholesaleStore();
});

const fakeLead = (overrides = {}) => ({
  address: '123 Test St',
  city: 'Houston',
  state: 'TX',
  zip: '77001',
  lat: 29.7604,
  lng: -95.3698,
  owner: 'Test Owner',
  ownerType: 'individual',
  source: 'driving',
  condition: 'vacant',
  distress: ['taxDelinquent'],
  ...overrides,
});

test('createLead: stores a lead with Chicago ISO timestamps', () => {
  const lead = createLead(fakeLead());
  assert.ok(lead.id);
  assert.equal(lead.address, '123 Test St');
  assert.match(lead.createdAt, /-\d{2}:\d{2}$/); // tz offset present
  assert.equal(lead.updatedAt, lead.createdAt);
  assert.equal(lead.status, 'new');
});

test('createLead: auto-scores the lead', () => {
  const lead = createLead(fakeLead());
  // vacant 25 + taxDelinquent 20 + owner 15 + lat/lng 10 = 70
  assert.equal(lead.score, 70);
});

test('createLead: dedupes on same normalized address', () => {
  const first = createLead(fakeLead());
  const dup = createLead(fakeLead({ address: '  123 TEST st.  ' }));
  assert.equal(dup.id, first.id);
  assert.equal(listLeads().length, 1);
});

test('createLead: dedupes on coordinates within ~15 m', () => {
  const first = createLead(fakeLead({ address: '100 Alpha St' }));
  // ~11 m north of the first lead
  const near = createLead({
    address: '200 Beta St',
    city: 'Houston',
    state: 'TX',
    lat: 29.7605,
    lng: -95.3698,
  });
  assert.equal(near.id, first.id);
  assert.equal(listLeads().length, 1);
});

test('createLead: keeps leads farther than ~15 m apart', () => {
  createLead(fakeLead({ address: '100 Alpha St' }));
  createLead({
    address: '300 Gamma St',
    city: 'Houston',
    state: 'TX',
    lat: 29.77,
    lng: -95.3698,
  });
  assert.equal(listLeads().length, 2);
});

test('getLead/updateLead: round trip', () => {
  const lead = createLead(fakeLead());
  const updated = updateLead(lead.id, { arv: 200000, repairs: 40000, targetFee: 15000 });
  assert.equal(updated.arv, 200000);
  assert.equal(getLead(lead.id).arv, 200000);
  assert.ok(updated.updatedAt);
});

test('updateLead: null for unknown id', () => {
  assert.equal(updateLead('nope', { arv: 1 }), null);
  assert.equal(getLead('nope'), null);
});

test('listLeads: filter by status and minScore', () => {
  const a = createLead(fakeLead({ address: '10 A St' }));
  createLead(fakeLead({ address: '20 B St', lat: 29.78, lng: -95.3698 }));
  moveLead(a.id, 'offer');
  assert.equal(listLeads({ status: 'offer' }).length, 1);
  assert.equal(listLeads({ status: 'new' }).length, 1);
  assert.equal(listLeads({ minScore: 70 }).length, 2);
  assert.equal(listLeads({ minScore: 71 }).length, 0);
});

test('listLeads: accepts a predicate function', () => {
  createLead(fakeLead({ address: '10 A St' }));
  const hits = listLeads((l) => l.city === 'Houston');
  assert.equal(hits.length, 1);
});

test('moveLead: walks the pipeline statuses', () => {
  const lead = createLead(fakeLead());
  for (const status of ['researching', 'analyzed', 'offer', 'contract', 'assigned', 'closed']) {
    const moved = moveLead(lead.id, status);
    assert.equal(moved.status, status);
  }
  assert.equal(getLead(lead.id).status, 'closed');
});

test('moveLead: rejects unknown status', () => {
  const lead = createLead(fakeLead());
  assert.throws(() => moveLead(lead.id, 'sold'), /Unknown wholesale status/);
});

test('deleteLead: removes and returns true; false for unknown', () => {
  const lead = createLead(fakeLead());
  assert.equal(deleteLead(lead.id), true);
  assert.equal(getLead(lead.id), null);
  assert.equal(deleteLead(lead.id), false);
});

test('addAgentNote: appends bilingual note with timestamp', () => {
  const lead = createLead(fakeLead());
  const note = addAgentNote(lead.id, 'acquisitions-agent', 'Llamar al dueño', 'Call the owner');
  assert.equal(note.agent, 'acquisitions-agent');
  assert.equal(note.es, 'Llamar al dueño');
  assert.equal(note.en, 'Call the owner');
  assert.match(note.at, /-\d{2}:\d{2}$/);
  assert.equal(getLead(lead.id).agentNotes.length, 1);
  assert.equal(addAgentNote('nope', 'agent', 'x', 'y'), null);
});

test('buyers: full CRUD', () => {
  const buyer = addBuyer({
    name: 'Test Buyer LLC',
    contact: 'buyer@example.com',
    buyBox: { maxPrice: 250000, areas: ['77001'], minDiscountPct: 30 },
  });
  assert.ok(buyer.id);
  assert.equal(getBuyer(buyer.id).name, 'Test Buyer LLC');
  const updated = updateBuyer(buyer.id, { contact: 'new@example.com' });
  assert.equal(updated.contact, 'new@example.com');
  assert.equal(listBuyers().length, 1);
  assert.equal(listBuyers({ name: 'Test Buyer LLC' }).length, 1);
  assert.equal(deleteBuyer(buyer.id), true);
  assert.equal(listBuyers().length, 0);
  assert.equal(deleteBuyer('nope'), false);
});

test('stats: totals, byStatus, avgScore, pipelineValue, potentialFees', () => {
  const a = createLead(fakeLead({ address: '10 A St', arv: 200000, targetFee: 15000 }));
  const b = createLead(
    fakeLead({
      address: '20 B St',
      lat: 29.78,
      lng: -95.3698,
      arv: 150000,
      targetFee: 10000,
      condition: 'overgrown', // overgrown 10 + taxDelinquent 20 + owner 15 + lat/lng 10 = 55
    }),
  );
  const c = createLead(
    fakeLead({
      address: '30 C St',
      lat: 29.79,
      lng: -95.3698,
      arv: 999999,
      targetFee: 50000,
    }),
  );
  moveLead(a.id, 'offer');
  moveLead(b.id, 'analyzed');
  moveLead(c.id, 'dead');

  const s = stats();
  assert.equal(s.total, 3);
  assert.equal(s.byStatus.offer, 1);
  assert.equal(s.byStatus.analyzed, 1);
  assert.equal(s.byStatus.dead, 1);
  assert.equal(s.byStatus.new, 0);
  // avg of 70, 55, 70 = 65
  assert.equal(s.avgScore, 65);
  // dead lead's arv excluded: 200k + 150k
  assert.equal(s.pipelineValue, 350000);
  // only offer/contract/assigned targetFee counts: 15k
  assert.equal(s.potentialFees, 15000);
});

test('stats: empty store', () => {
  const s = stats();
  assert.equal(s.total, 0);
  assert.equal(s.avgScore, 0);
  assert.equal(s.pipelineValue, 0);
  assert.equal(s.potentialFees, 0);
  assert.equal(STATUSES.length, 8);
});

test('STATUS_LABELS: bilingual for every status', () => {
  for (const status of STATUSES) {
    assert.ok(STATUS_LABELS[status]?.es, status);
    assert.ok(STATUS_LABELS[status]?.en, status);
  }
});

test('chicagoIso: carries America/Chicago offset', () => {
  const iso = chicagoIso(new Date('2026-09-17T05:51:21Z'));
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('normalizeAddress: case/punctuation insensitive', () => {
  assert.equal(normalizeAddress('123 Test St.'), normalizeAddress('  123 TEST st  '));
});

test('persistence: reload recovers leads from the backend', () => {
  createLead(fakeLead());
  const raw = reloadWholesaleStore();
  assert.equal(raw.leads.length, 1);
});

test('STORAGE_KEY is the expected namespace', () => {
  assert.equal(STORAGE_KEY, 'sahjony.wholesale.v1');
});
