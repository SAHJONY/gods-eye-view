import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  STAGES,
  STAGE_LABELS,
  BUREAUS,
  DISPUTE_STATUSES,
  DRAFT_KINDS,
  AWAITING_APPROVAL,
  STORAGE_KEY,
  createNew850Store,
  maskPhone,
  redactSsn,
  containsSsnLike,
  chicagoIso,
} = await import('./new850Store.js');

const fresh = () => {
  const store = createNew850Store();
  store.reset();
  return store;
};

test('maskPhone keeps only the last 4 digits as ***4567', () => {
  assert.equal(maskPhone('(305) 555-4567'), '***4567');
  assert.equal(maskPhone('+1-281-662-8581'), '***8581');
  assert.equal(maskPhone('123'), '***');
  assert.equal(maskPhone(''), '***');
  assert.equal(maskPhone(null), '***');
});

test('redactSsn removes SSN-like sequences from free text', () => {
  assert.equal(redactSsn('my ssn 123-45-6789 here'), 'my ssn [REDACTED] here');
  assert.equal(redactSsn('123456789'), '[REDACTED]');
  assert.equal(redactSsn('no sensitive data'), 'no sensitive data');
  assert.ok(containsSsnLike('123-45-6789'));
  assert.ok(!containsSsnLike('555-4567'));
});

test('STAGES cover the full pipeline surface', () => {
  assert.deepEqual(STAGES, [
    'intake',
    'round-1',
    'round-1-wait',
    'round-2',
    'round-2-wait',
    'round-3',
    'round-3-wait',
    'escalation-draft',
    'complete',
    'dormant',
    'closed',
  ]);
  for (const s of STAGES) {
    assert.ok(STAGE_LABELS[s]?.es && STAGE_LABELS[s]?.en, `${s} bilingual`);
  }
  assert.deepEqual(BUREAUS, ['equifax', 'experian', 'transunion']);
});

test('STORAGE_KEY is namespaced for new850', () => {
  assert.equal(STORAGE_KEY, 'sahjony.new850.v1');
});

test('createCase generates a ref, masks the phone, and redacts SSNs', () => {
  const store = fresh();
  const c = store.createCase({
    clientLabel: 'Cliente de prueba',
    phone: '+1 (305) 555-4567',
    notes: 'ssn 123-45-6789 no guardar',
    bureaus: ['equifax', 'EXPERIAN', 'bogus'],
  });
  assert.match(c.ref, /^N850-\d{4}$/);
  assert.equal(c.phoneMasked, '***4567');
  assert.ok(!c.phone, 'full phone is never stored');
  assert.ok(!containsSsnLike(c.notes), 'SSN redacted in notes');
  assert.ok(!('ssn' in c), 'no ssn field exists on the case');
  assert.deepEqual(c.bureaus, ['equifax', 'experian']);
  assert.equal(c.stage, 'intake');
  assert.equal(store.getCase(c.id).id, c.id);
  assert.equal(store.getCaseByRef(c.ref).id, c.id);
});

test('moveCase enforces known stages', () => {
  const store = fresh();
  const c = store.createCase({ clientLabel: 'X' });
  store.moveCase(c.id, 'round-1');
  assert.equal(store.getCase(c.id).stage, 'round-1');
  assert.throws(() => store.moveCase(c.id, 'banana'));
});

test('disputes: add/get/update/delete with SSN redaction', () => {
  const store = fresh();
  const c = store.createCase({ clientLabel: 'X' });
  const d = store.addDispute(c.id, {
    item: 'late payment 123-45-6789',
    creditor: 'Banco Ejemplo',
    evidence: 'estado de cuenta',
    round: 1,
  });
  assert.equal(d.status, 'draft');
  assert.ok(!containsSsnLike(d.item));
  store.updateDispute(c.id, d.id, { status: 'under-investigation' });
  assert.equal(store.getDispute(c.id, d.id).status, 'under-investigation');
  assert.ok(store.deleteDispute(c.id, d.id));
  assert.equal(store.getCase(c.id).disputes.length, 0);
});

test('rounds: setRound stores 30/45-day windows', () => {
  const store = fresh();
  const c = store.createCase({ clientLabel: 'X' });
  const r = store.setRound(c.id, {
    round: 1,
    startedAt: '2026-09-17T10:00:00-05:00',
    deadlineAt: '2026-10-17T10:00:00-05:00',
    windowDays: 30,
    status: 'active',
  });
  assert.equal(r.round, 1);
  assert.equal(r.windowDays, 30);
  assert.equal(store.getRound(c.id, 1).status, 'active');
  const r2 = store.setRound(c.id, { round: 2, windowDays: 45 });
  assert.equal(r2.windowDays, 45);
});

test('DRAFT-ONLY: addDraft always lands as awaiting-approval, and the store exposes no send path', () => {
  const store = fresh();
  const c = store.createCase({ clientLabel: 'X' });
  const d = store.addDraft(c.id, {
    kind: 'dispute-letter',
    target: 'Equifax',
    text: 'BORRADOR …',
  });
  assert.equal(d.status, AWAITING_APPROVAL);
  assert.equal(AWAITING_APPROVAL, 'awaiting-approval');
  // No send/submit/transmit function may exist on the store.
  for (const name of Object.getOwnPropertyNames(store)) {
    assert.ok(
      !/send|submit|transmit|dispatch/i.test(name),
      `store must not expose a send path (found: ${name})`,
    );
  }
  const pending = store.listPendingDrafts();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].draft.id, d.id);
  assert.equal(pending[0].caseRef, c.ref);
  store.deleteDraft(c.id, d.id);
  assert.equal(store.listPendingDrafts().length, 0);
});

test('addNote redacts SSN-like text; stats count open cases and pending drafts', () => {
  const store = fresh();
  const c1 = store.createCase({ clientLabel: 'A' });
  const c2 = store.createCase({ clientLabel: 'B', demo: true });
  store.addDraft(c1.id, { kind: 'cfpb-complaint', text: 'x' });
  const note = store.addNote(c1.id, 'sahjony', 'llamar 123-45-6789', 'call');
  assert.ok(!containsSsnLike(note.es));
  store.moveCase(c2.id, 'closed');
  const s = store.stats();
  assert.equal(s.totalCases, 2);
  assert.equal(s.openCases, 1);
  assert.equal(s.pendingDrafts, 1);
  assert.equal(s.demoCases, 1);
  assert.equal(s.byStage.intake, 1);
  assert.equal(s.byStage.closed, 1);
});

test('chicagoIso stamps America/Chicago offset', () => {
  const iso = chicagoIso(new Date('2026-09-17T12:00:00Z'));
  assert.match(iso, /-05:00$/);
  assert.ok(iso.startsWith('2026-09-17T07:00:00'));
});

test('listCases supports stage filtering', () => {
  const store = fresh();
  const a = store.createCase({ clientLabel: 'A' });
  store.createCase({ clientLabel: 'B' });
  store.moveCase(a.id, 'round-2');
  assert.equal(store.listCases({ stage: 'round-2' }).length, 1);
  assert.equal(store.listCases({ stage: 'intake' }).length, 1);
  assert.ok(store.deleteCase(a.id));
  assert.equal(store.listCases().length, 1);
});
