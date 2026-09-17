import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  BUSINESS_IDS,
  BUSINESS_NAMES,
  APPROVAL_STATUSES,
  APPROVAL_KINDS,
  ApprovalError,
  validateBusinessId,
  isKnownBusinessId,
  validateApprovalDraft,
  orderQueue,
  computeStats,
  summarizeForVoice,
} = await import('./approvalEngine.js');

test('BUSINESS_IDS contract: exactly the seven business namespaces', () => {
  assert.deepEqual([...BUSINESS_IDS], [
    'wholesale',
    'crude',
    'trade',
    'cubacash',
    'carsales',
    'new850',
    'insurance',
  ]);
  for (const id of BUSINESS_IDS) {
    assert.ok(BUSINESS_NAMES[id]?.es, `missing ES name for ${id}`);
    assert.ok(BUSINESS_NAMES[id]?.en, `missing EN name for ${id}`);
  }
  assert.deepEqual([...APPROVAL_STATUSES], ['pending', 'approved', 'rejected']);
  assert.ok(APPROVAL_KINDS.length > 0);
});

test('validateBusinessId / isKnownBusinessId', () => {
  assert.equal(validateBusinessId('trade'), 'trade');
  assert.ok(isKnownBusinessId('new850'));
  assert.ok(!isKnownBusinessId('Nope'));
  assert.throws(() => validateBusinessId(''), (e) => e instanceof ApprovalError && e.code === 'UNKNOWN_BUSINESS');
  assert.throws(() => validateBusinessId('TRADE'), (e) => e.code === 'UNKNOWN_BUSINESS');
});

test('validateApprovalDraft requires fields and trims', () => {
  const good = {
    kind: '  post  ',
    titleEs: ' Publicación ',
    titleEn: 'Post',
    summaryEs: 'Resumen',
    summaryEn: 'Summary',
    payload: { channel: 'facebook' },
  };
  const out = validateApprovalDraft('wholesale', good);
  assert.equal(out.kind, 'post');
  assert.equal(out.titleEs, 'Publicación');
  assert.deepEqual(out.payload, { channel: 'facebook' });

  const noPayload = validateApprovalDraft('crude', {
    kind: 'offer',
    titleEs: 'Oferta',
    titleEn: 'Offer',
    summaryEs: 'r',
    summaryEn: 's',
  });
  assert.equal(noPayload.payload, null, 'payload defaults to null when absent');

  assert.throws(() => validateApprovalDraft('bogus', good), (e) => e.code === 'UNKNOWN_BUSINESS');
  assert.throws(() => validateApprovalDraft('trade', null), (e) => e.code === 'INVALID_DRAFT');
  assert.throws(() => validateApprovalDraft('trade', []), (e) => e.code === 'INVALID_DRAFT');
  assert.throws(
    () => validateApprovalDraft('trade', { ...good, titleEn: '' }),
    (e) => e.code === 'MISSING_FIELD' && e.details.field === 'titleEn',
  );
});

test('orderQueue: pending FIFO, decided newest-first', () => {
  const mk = (id, createdAt, decidedAt) => ({ id, createdAt, decidedAt });
  const pending = [
    mk('c', '2026-09-17T10:00:00Z'),
    mk('a', '2026-09-17T08:00:00Z'),
    mk('b', '2026-09-17T09:00:00Z'),
  ];
  assert.deepEqual(orderQueue(pending, 'pending').map((i) => i.id), ['a', 'b', 'c']);
  const decided = [
    mk('x', '2026-09-17T08:00:00Z', '2026-09-17T10:00:00Z'),
    mk('y', '2026-09-17T08:00:00Z', '2026-09-17T12:00:00Z'),
  ];
  assert.deepEqual(orderQueue(decided, 'approved').map((i) => i.id), ['y', 'x']);
  assert.deepEqual(orderQueue([], 'pending'), []);
});

test('computeStats', () => {
  assert.deepEqual(
    computeStats([
      { status: 'pending' },
      { status: 'pending' },
      { status: 'approved' },
      { status: 'rejected' },
      { status: 'weird' },
    ]),
    { pending: 2, approved: 1, rejected: 1, total: 5 },
  );
  assert.deepEqual(computeStats([]), { pending: 0, approved: 0, rejected: 0, total: 0 });
});

test('summarizeForVoice is ES/EN complete', () => {
  const zero = summarizeForVoice(null, []);
  assert.match(zero.es, /nada pendiente/i);
  assert.match(zero.en, /nothing pending/i);
  const two = summarizeForVoice(null, [{}, {}]);
  assert.match(two.es, /2/);
  assert.match(two.en, /2/);
  const one = summarizeForVoice('crude', [{}]);
  assert.match(one.es, /Crudo/);
  assert.match(one.en, /Crude/);
  const none = summarizeForVoice('insurance', []);
  assert.match(none.es, /Seguros/);
  assert.match(none.en, /Insurance/);
  assert.throws(() => summarizeForVoice('bogus', []), (e) => e.code === 'UNKNOWN_BUSINESS');
});
