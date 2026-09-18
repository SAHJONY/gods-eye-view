import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  INQUIRY_STATUSES,
  INQUIRY_STATUS_LABELS,
  CUBAN_FUEL_PORTS,
  SEED_BENCHMARKS,
  getPorts,
  createInquiry,
  getInquiry,
  updateInquiry,
  moveInquiry,
  deleteInquiry,
  listInquiries,
  addInquiryNote,
  advanceGate,
  addBenchmark,
  listBenchmarks,
  deleteBenchmark,
  createEscalation,
  listEscalations,
  resolveEscalation,
  stats,
  asWorkforceStore,
  resetEnergyStore,
  reloadEnergyStore,
} from './energyStore.js';
import { GATE_CHECKLIST_TEMPLATE } from './energyEngine.js';

function clean() {
  resetEnergyStore();
}

function allYes() {
  const answers = {};
  for (const item of GATE_CHECKLIST_TEMPLATE) answers[item.id] = 'yes';
  return answers;
}

test('store key is the tenant-isolated energy key', () => {
  assert.equal(STORAGE_KEY, 'sahjony.energy.v1');
});

test('seeds the benchmark log with dated, sourced entries on empty store', () => {
  clean();
  reloadEnergyStore();
  const rows = listBenchmarks();
  assert.ok(rows.length >= SEED_BENCHMARKS.length);
  for (const row of rows) {
    assert.ok(row.date, 'dated entry');
    assert.ok(row.source, 'sourced entry');
    assert.ok(row.value > 0, 'positive value');
  }
  const diesel = rows.find((r) => r.product === 'diesel' && r.date === '2026-09-14' && r.value === 6.027);
  assert.ok(diesel, 'verified 2026-09-14 Gulf Coast diesel entry present');
  const lpg = rows.find((r) => r.product === 'lpg' && r.value === 0.85);
  assert.ok(lpg, 'verified 2026-09-14 Mont Belvieu propane entry present');
});

test('status labels are bilingual for every status', () => {
  for (const s of INQUIRY_STATUSES) {
    assert.ok(INQUIRY_STATUS_LABELS[s]?.es && INQUIRY_STATUS_LABELS[s]?.en, s);
  }
});

test('Cuban fuel ports: exactly Mariel, Havana, Santiago, Cienfuegos with coords', () => {
  clean();
  const ports = getPorts();
  assert.equal(ports.length, 4);
  const ids = ports.map((p) => p.id).sort();
  assert.deepEqual(ids, ['cienfuegos', 'havana', 'mariel', 'santiago']);
  for (const p of ports) {
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng), p.id);
    assert.ok(p.lat >= 18 && p.lat <= 24, `${p.id} lat in Cuba`);
    assert.ok(p.lng >= -86 && p.lng <= -74, `${p.id} lng in Cuba`);
    assert.ok(p.name.es && p.name.en, 'bilingual name');
  }
});

test('inquiry CRUD with broker status pipeline', () => {
  clean();
  const inq = createInquiry({
    ref: 'ENQ-TEST-1',
    product: 'diesel',
    volumeMt: 500,
    dischargePort: 'Mariel',
  });
  assert.equal(inq.status, 'inquiry');
  assert.ok(getInquiry(inq.id));
  moveInquiry(inq.id, 'diligence');
  assert.equal(getInquiry(inq.id).status, 'diligence');
  assert.equal(listInquiries({ status: 'diligence' }).length, 1);
  updateInquiry(inq.id, { counterpartyName: '' });
  assert.equal(getInquiry(inq.id).counterpartyName, '');
  assert.ok(deleteInquiry(inq.id));
  assert.equal(getInquiry(inq.id), null);
});

test('moveInquiry REJECTS the commercial bypass — only advanceGate() advances', () => {
  clean();
  const inq = createInquiry({ ref: 'ENQ-BYPASS', product: 'gasoline' });
  assert.throws(() => moveInquiry(inq.id, 'commercial'), /advanceGate/);
  assert.equal(getInquiry(inq.id).status, 'inquiry');
});

test('updateInquiry REJECTS the direct commercial bypass too — status cannot be patched past the gate', () => {
  clean();
  const inq = createInquiry({ ref: 'ENQ-BYPASS2', product: 'diesel' });
  assert.throws(() => updateInquiry(inq.id, { status: 'commercial' }), /advanceGate/);
  assert.equal(getInquiry(inq.id).status, 'inquiry');
});

test('advanceGate: clean checklist passes the gate → commercial', () => {
  clean();
  const inq = createInquiry({ ref: 'ENQ-GATE-OK', product: 'lpg', volumeMt: 200 });
  const out = advanceGate(inq.id, allYes());
  assert.equal(out.advanced, true);
  assert.equal(out.escalated, false);
  assert.equal(getInquiry(inq.id).status, 'commercial');
  assert.equal(getInquiry(inq.id).gateResult.passed, true);
  assert.equal(listEscalations().length, 0, 'no escalation on a clean pass');
});

test('advanceGate: ANY red flag → hard stop, awaiting-juan, escalation written', () => {
  clean();
  const inq = createInquiry({ ref: 'ENQ-GATE-RED', product: 'diesel' });
  const answers = allYes();
  answers['restricted-party-screen'] = 'no';
  const out = advanceGate(inq.id, answers);
  assert.equal(out.advanced, false);
  assert.equal(out.escalated, true);
  assert.equal(getInquiry(inq.id).status, 'awaiting-juan');
  assert.ok(out.escalation, 'escalation record returned');
  assert.equal(out.escalation.reason, 'sanctions');
  assert.equal(out.escalation.status, 'awaiting-juan');
  const stored = listEscalations();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].reason, 'sanctions');
});

test('advanceGate: ANY unknown → also blocked, escalated as compliance', () => {
  clean();
  const inq = createInquiry({ ref: 'ENQ-GATE-UNK', product: 'diesel' });
  const answers = allYes();
  answers['legal-authorization-basis'] = 'unknown';
  const out = advanceGate(inq.id, answers);
  assert.equal(out.advanced, false);
  assert.equal(out.escalated, true);
  assert.equal(getInquiry(inq.id).status, 'awaiting-juan');
  assert.equal(out.escalation.reason, 'compliance');
});

test('advanceGate: missing answers count as unknown — never assumed yes', () => {
  clean();
  const inq = createInquiry({ ref: 'ENQ-GATE-MISS', product: 'lpg' });
  const out = advanceGate(inq.id, {});
  assert.equal(out.advanced, false);
  assert.equal(out.escalated, true);
});

test('advanceGate: unknown inquiry id returns not-found, touches nothing', () => {
  clean();
  const out = advanceGate('does-not-exist', allYes());
  assert.equal(out.advanced, false);
  assert.equal(out.escalated, false);
  assert.equal(out.error, 'not-found');
  assert.equal(listEscalations().length, 0);
});

test('escalations resolve only through resolveEscalation (Juan)', () => {
  clean();
  const esc = createEscalation({ reason: 'compliance', summary: 'prueba' });
  assert.equal(esc.status, 'awaiting-juan');
  assert.equal(esc.module, 'energy');
  resolveEscalation(esc.id);
  assert.equal(listEscalations()[0].status, 'resolved-by-juan');
});

test('benchmark CRUD + newest-first ordering', () => {
  clean();
  const b = addBenchmark({
    date: '2026-09-17',
    product: 'diesel',
    value: 6.1,
    unit: '$/gal',
    market: 'prueba',
    source: 'prueba manual',
  });
  assert.ok(b.id);
  const rows = listBenchmarks();
  assert.equal(rows[0].id, b.id, 'newest first');
  assert.ok(deleteBenchmark(b.id));
});

test('inquiry notes are stored bilingual', () => {
  clean();
  const inq = createInquiry({ ref: 'ENQ-NOTE', product: 'gasoline' });
  const note = addInquiryNote(inq.id, 'gate-keeper', 'nota es', 'note en');
  assert.equal(note.es, 'nota es');
  assert.equal(note.en, 'note en');
  assert.equal(getInquiry(inq.id).agentNotes.length, 1);
});

test('stats: pipeline counts, pending escalations, potential spread', () => {
  clean();
  const inq = createInquiry({
    product: 'diesel',
    volumeMt: 100,
    // SAMPLE TEST FIGURES — not live prices.
    buyPerUnit: 900,
    sellPerUnit: 950,
  });
  moveInquiry(inq.id, 'gate-review');
  createEscalation({ reason: 'sanctions', summary: 'pendiente' });
  const s = stats();
  assert.equal(s.totalInquiries, 1);
  assert.equal(s.openInquiries, 1);
  assert.equal(s.byStatus['gate-review'], 1);
  assert.equal(s.pendingEscalations, 1);
  assert.ok(s.potentialSpread >= 0);
  assert.ok(s.benchmarkCount >= SEED_BENCHMARKS.length);
});

test('asWorkforceStore: notes shaped {t, agent, es, en}', () => {
  clean();
  const inq = createInquiry({ ref: 'ENQ-WF', product: 'lpg' });
  const ws = asWorkforceStore();
  addInquiryNote(inq.id, 'economics-memo', 'memo es', 'memo en');
  const notes = ws.notes(inq.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].agent, 'economics-memo');
  assert.ok(notes[0].t, 'note has t timestamp');
});
