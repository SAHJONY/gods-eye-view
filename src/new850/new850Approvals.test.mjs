import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  APPROVALS_KEY,
  APPROVAL_STATUSES,
  NEW850_APPROVAL_KINDS,
  NEW850_APPROVAL_KIND_LABELS,
  createApprovalStore,
} = await import('./new850Approvals.js');

const fresh = () => {
  const store = createApprovalStore();
  store.reset();
  return store;
};

const draft = (over = {}) => ({
  kind: 'dispute-letter-r1',
  titleEs: 'Carta de disputa R1 — Equifax',
  titleEn: 'R1 dispute letter — Equifax',
  summaryEs: 'Disputa de pago tardío para el caso N850-0001.',
  summaryEn: 'Late-payment dispute for case N850-0001.',
  payload: { caseRef: 'N850-0001', draftId: 'd1' },
  ...over,
});

test('APPROVALS_KEY matches the shared contract exactly', () => {
  assert.equal(APPROVALS_KEY, 'sahjony.gev.approvals.v1');
});

test('APPROVAL_STATUSES covers pending/approved/rejected', () => {
  assert.deepEqual([...APPROVAL_STATUSES], [
    'pending',
    'approved',
    'rejected',
  ]);
});

test('New850 approval kinds cover dispute R1/R2/R3, furnisher, CFPB, message', () => {
  assert.deepEqual([...NEW850_APPROVAL_KINDS], [
    'dispute-letter-r1',
    'dispute-letter-r2',
    'dispute-letter-r3',
    'furnisher-letter',
    'cfpb-complaint',
    'customer-message',
  ]);
  for (const k of NEW850_APPROVAL_KINDS) {
    assert.ok(
      NEW850_APPROVAL_KIND_LABELS[k]?.es && NEW850_APPROVAL_KIND_LABELS[k]?.en,
      `${k} bilingual`,
    );
  }
});

test('createApproval queues a pending item with the contract shape', () => {
  const store = fresh();
  const item = store.createApproval('new850', draft());
  assert.ok(item.id);
  assert.equal(item.businessId, 'new850');
  assert.equal(item.kind, 'dispute-letter-r1');
  assert.equal(item.status, 'pending');
  assert.equal(item.decidedAt, null);
  assert.equal(item.note, '');
  assert.equal(item.decidedBy, null);
  assert.deepEqual(item.payload, { caseRef: 'N850-0001', draftId: 'd1' });
  assert.ok(item.createdAt);
  assert.equal(store.getApproval(item.id).id, item.id);
});

test('listApprovals filters by business and status, newest first', () => {
  const store = fresh();
  const a = store.createApproval('new850', draft());
  store.createApproval('other-biz', draft({ kind: 'customer-message' }));
  const b = store.createApproval('new850', draft({ kind: 'cfpb-complaint' }));
  store.approveApproval(a.id, 'ok');
  assert.equal(store.listApprovals('new850').length, 2);
  assert.equal(store.listApprovals('new850')[0].id, b.id, 'newest first');
  assert.equal(store.listApprovals('new850', 'pending').length, 1);
  assert.equal(store.listApprovals('new850', 'approved').length, 1);
  assert.equal(store.listApprovals('new850', 'rejected').length, 0);
});

test('approveApproval records the decision and Juan as the single decider', () => {
  const store = fresh();
  const item = store.createApproval('new850', draft());
  const decided = store.approveApproval(item.id, 'se ve bien');
  assert.equal(decided.status, 'approved');
  assert.ok(decided.decidedAt);
  assert.equal(decided.note, 'se ve bien');
  assert.equal(decided.decidedBy, 'juan', 'single-operator decider recorded');
});

test('rejectApproval records the decision and Juan as the single decider', () => {
  const store = fresh();
  const item = store.createApproval('new850', draft());
  const decided = store.rejectApproval(item.id, 'falta evidencia');
  assert.equal(decided.status, 'rejected');
  assert.equal(decided.decidedBy, 'juan');
});

test('decisions are idempotent: decided items cannot be re-decided', () => {
  const store = fresh();
  const item = store.createApproval('new850', draft());
  store.approveApproval(item.id, 'first');
  const again = store.rejectApproval(item.id, 'second');
  assert.equal(again.status, 'approved');
  assert.equal(again.note, 'first');
});

test('approveApproval on unknown id returns null', () => {
  const store = fresh();
  assert.equal(store.approveApproval('nope'), null);
  assert.equal(store.rejectApproval('nope'), null);
});

test('audit log is append-only: created + decision events with decider', () => {
  const store = fresh();
  const item = store.createApproval('new850', draft());
  store.approveApproval(item.id, 'ok');
  const log = store.getAuditLog();
  assert.equal(log.length, 2);
  assert.equal(log[0].action, 'created');
  assert.equal(log[1].action, 'approved');
  assert.equal(log[1].approvalId, item.id);
  assert.equal(log[1].decidedBy, 'juan');
  assert.equal(log[1].note, 'ok');
  // Audit entries cannot be edited through the public API.
  assert.ok(!('editAudit' in store || 'deleteAudit' in store));
});

test('NO-SEND-PATH: the approval module exposes no send/submit/transmit API', async () => {
  const mod = await import('./new850Approvals.js');
  for (const name of Object.keys(mod)) {
    assert.ok(
      !/send|submit|transmit|dispatch|execute|deliver|post/i.test(name),
      `approval module must not expose an external-act path (found: ${name})`,
    );
  }
  const store = fresh();
  for (const name of Object.getOwnPropertyNames(
    Object.getPrototypeOf(store),
  )) {
    assert.ok(
      !/send|submit|transmit|dispatch|execute|deliver|post/i.test(name),
      `ApprovalStore must not expose an external-act path (found: ${name})`,
    );
  }
});

test('NO-SEND-PATH EXTENDED: approving executes nothing — even a hostile payload callback is never invoked', () => {
  const store = fresh();
  let calls = 0;
  const hostile = store.createApproval('new850', {
    ...draft(),
    payload: {
      caseRef: 'N850-0001',
      // A hostile/mistaken payload must never be executed by the decision.
      onApprove: () => {
        calls += 1;
      },
      sendNow: true,
      autoExecute: 'dispute-letter',
    },
  });
  const decided = store.approveApproval(hostile.id, 'tap recorded');
  assert.equal(decided.status, 'approved');
  assert.equal(calls, 0, 'payload callbacks are data only — never invoked');
  // The decision changed ONLY status/decidedAt/note/decidedBy + audit.
  const after = store.getApproval(hostile.id);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(hostile).sort());
  const auditActions = store.getAuditLog().map((e) => e.action);
  assert.deepEqual(auditActions, ['created', 'approved']);
});

test('stats counts pending/approved/rejected for the business', () => {
  const store = fresh();
  const a = store.createApproval('new850', draft());
  store.createApproval('new850', draft({ kind: 'furnisher-letter' }));
  store.approveApproval(a.id);
  const s = store.stats('new850');
  assert.deepEqual(s, { total: 2, pending: 1, approved: 1, rejected: 0 });
});
