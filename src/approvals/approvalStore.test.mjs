import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  createApproval,
  listApprovals,
  getApproval,
  approveApproval,
  rejectApproval,
  approvalStats,
  allApprovalStats,
  listAuditLog,
  resetApprovalStore,
  APPROVALS_KEY,
  ApprovalError,
} = await import('./approvalStore.js');
const { BUSINESS_IDS } = await import('./approvalEngine.js');

const here = path.dirname(fileURLToPath(import.meta.url));

function draft(overrides = {}) {
  return {
    kind: 'dispute',
    titleEs: 'Carta de disputa',
    titleEn: 'Dispute letter',
    summaryEs: 'Borrador listo para tu revisión.',
    summaryEn: 'Draft ready for your review.',
    payload: { text: 'hola' },
    ...overrides,
  };
}

test('createApproval validates businessId and required fields', () => {
  resetApprovalStore();
  assert.throws(() => createApproval('nope', draft()), (e) => e instanceof ApprovalError && e.code === 'UNKNOWN_BUSINESS');
  for (const field of ['kind', 'titleEs', 'titleEn', 'summaryEs', 'summaryEn']) {
    const bad = draft();
    bad[field] = '   ';
    assert.throws(() => createApproval('wholesale', bad), (e) => e.code === 'MISSING_FIELD', field);
  }
  assert.throws(() => createApproval('wholesale', null), (e) => e.code === 'INVALID_DRAFT');
});

test('createApproval stores namespaced items, pending by default', () => {
  resetApprovalStore();
  const a = createApproval('wholesale', draft());
  const b = createApproval('crude', draft({ kind: 'offer' }));
  assert.equal(a.businessId, 'wholesale');
  assert.equal(a.status, 'pending');
  assert.ok(a.id.startsWith('appr-'));
  assert.ok(a.createdAt);
  assert.equal(a.decidedAt, null);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(
    listApprovals('wholesale').map((i) => i.id),
    [a.id],
  );
  assert.deepEqual(
    listApprovals('crude').map((i) => i.id),
    [b.id],
  );
});

test('listApprovals filters by status and orders pending FIFO', () => {
  resetApprovalStore();
  const first = createApproval('trade', draft({ titleEn: 'First' }));
  const second = createApproval('trade', draft({ titleEn: 'Second' }));
  approveApproval(first.id);
  assert.deepEqual(
    listApprovals('trade', 'pending').map((i) => i.id),
    [second.id],
  );
  assert.deepEqual(
    listApprovals('trade', 'approved').map((i) => i.id),
    [first.id],
  );
  assert.deepEqual(listApprovals('trade', 'rejected'), []);
  assert.throws(() => listApprovals('trade', 'bogus'), (e) => e.code === 'UNKNOWN_STATUS');
  assert.throws(() => listApprovals('bogus'), (e) => e.code === 'UNKNOWN_BUSINESS');
});

test('getApproval returns a copy or null', () => {
  resetApprovalStore();
  const a = createApproval('cubacash', draft());
  const got = getApproval(a.id);
  assert.equal(got.id, a.id);
  got.titleEn = 'MUTATED';
  assert.notEqual(getApproval(a.id).titleEn, 'MUTATED');
  assert.equal(getApproval('appr-does-not-exist'), null);
});

test('approveApproval records decision, note, and audit entry — nothing else', () => {
  resetApprovalStore();
  let executed = 0;
  const a = createApproval('new850', draft({
    payload: {
      send: () => { executed += 1; },
      publish: () => { executed += 1; },
    },
  }));
  const decided = approveApproval(a.id, 'Se ve bien');
  assert.equal(decided.status, 'approved');
  assert.equal(decided.note, 'Se ve bien');
  assert.ok(decided.decidedAt);
  assert.equal(executed, 0, 'payload functions must never run on approve');
  const audit = listAuditLog('new850');
  assert.equal(audit.length, 2); // created + approved
  assert.equal(audit[0].action, 'approved');
  assert.equal(audit[0].approvalId, a.id);
  assert.equal(audit[0].note, 'Se ve bien');
});

test('rejectApproval records rejection and is idempotent too', () => {
  resetApprovalStore();
  let executed = 0;
  const a = createApproval('insurance', draft({ payload: { post: () => { executed += 1; } } }));
  const decided = rejectApproval(a.id, 'No');
  assert.equal(decided.status, 'rejected');
  assert.equal(executed, 0, 'payload functions must never run on reject');
  const before = listAuditLog('insurance').length;
  const again = rejectApproval(a.id, 'No de nuevo');
  assert.equal(again.status, 'rejected');
  assert.equal(again.note, 'No', 'note must not change on idempotent re-decision');
  assert.equal(listAuditLog('insurance').length, before, 'no duplicate audit entry');
});

test('decisions are idempotent: re-approving a decided item is a no-op', () => {
  resetApprovalStore();
  const a = createApproval('carsales', draft());
  approveApproval(a.id, 'ok');
  const auditLen = listAuditLog('carsales').length;
  const again = approveApproval(a.id, 'ok again');
  assert.equal(again.status, 'approved');
  assert.equal(again.note, 'ok');
  assert.equal(listAuditLog('carsales').length, auditLen);
  // Cross-decision is also a no-op: a decided item cannot be re-decided.
  const cross = rejectApproval(a.id, 'cambio de idea');
  assert.equal(cross.status, 'approved');
});

test('approveApproval on unknown id throws', () => {
  resetApprovalStore();
  assert.throws(() => approveApproval('appr-missing'), (e) => e.code === 'NOT_FOUND');
  assert.throws(() => rejectApproval('appr-missing'), (e) => e.code === 'NOT_FOUND');
});

test('approvalStats and allApprovalStats', () => {
  resetApprovalStore();
  createApproval('wholesale', draft());
  createApproval('wholesale', draft());
  const w3 = createApproval('wholesale', draft());
  approveApproval(w3.id);
  const stats = approvalStats('wholesale');
  assert.deepEqual(stats, { businessId: 'wholesale', pending: 2, approved: 1, rejected: 0, total: 3 });
  const all = allApprovalStats();
  assert.deepEqual(all.map((s) => s.businessId), [...BUSINESS_IDS]);
  const wRow = all.find((s) => s.businessId === 'wholesale');
  assert.equal(wRow.total, 3);
  assert.equal(all.find((s) => s.businessId === 'crude').total, 0);
});

test('audit log is append-only and newest-first', () => {
  resetApprovalStore();
  const a = createApproval('trade', draft());
  approveApproval(a.id);
  const all = listAuditLog();
  assert.ok(all.length >= 2);
  assert.ok(new Date(all[0].at) >= new Date(all[1].at));
  assert.deepEqual(listAuditLog('trade'), all.filter((e) => e.businessId === 'trade'));
  assert.throws(() => listAuditLog('bogus'), (e) => e.code === 'UNKNOWN_BUSINESS');
});

test('resetApprovalStore clears everything', () => {
  resetApprovalStore();
  createApproval('wholesale', draft());
  assert.equal(approvalStats('wholesale').total, 1);
  resetApprovalStore();
  assert.equal(approvalStats('wholesale').total, 0);
  assert.deepEqual(listAuditLog(), []);
});

test('SAFETY: no send/post/publish execution path exists in this module', () => {
  const src = readFileSync(path.join(here, 'approvalStore.js'), 'utf8');
  for (const pattern of [
    /\bfetch\s*\(/,
    /new\s+XMLHttpRequest/,
    /sendBeacon/,
    /new\s+WebSocket/,
    /navigator\.share/,
    /window\.open\s*\(/,
  ]) {
    assert.ok(!pattern.test(src), `forbidden execution path pattern: ${pattern}`);
  }
  const exported = ['createApproval', 'listApprovals', 'getApproval', 'approveApproval', 'rejectApproval', 'approvalStats', 'allApprovalStats', 'listAuditLog', 'resetApprovalStore'];
  for (const name of exported) {
    assert.ok(!/send|post|publish|execute|trigger|dispatch/i.test(name), `suspicious export name: ${name}`);
  }
  assert.equal(APPROVALS_KEY, 'sahjony.gev.approvals.v1');
});
