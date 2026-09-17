import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  TRIAGE_KEY,
  TRIAGE_STATUSES,
  TRIAGE_STATUS_LABELS,
  importTriageJson,
  exportTriageJson,
  sampleTriageTemplate,
  createTriageStore,
} = await import('./new850Triage.js');

const fresh = () => {
  const store = createTriageStore();
  store.reset();
  return store;
};

test('TRIAGE_KEY is namespaced for new850', () => {
  assert.equal(TRIAGE_KEY, 'sahjony.new850.triage.v1');
});

test('TRIAGE_STATUSES covers the triage pipeline', () => {
  assert.deepEqual([...TRIAGE_STATUSES], [
    'new',
    'reviewed',
    'converted',
    'dismissed',
  ]);
  for (const s of TRIAGE_STATUSES) {
    assert.ok(TRIAGE_STATUS_LABELS[s]?.es && TRIAGE_STATUS_LABELS[s]?.en);
  }
});

test('NEVER INVENT: the store starts empty — no seed conversations', () => {
  const store = fresh();
  assert.equal(store.listTriage().length, 0);
  assert.deepEqual(store.stats(), {
    total: 0,
    new: 0,
    reviewed: 0,
    converted: 0,
    dismissed: 0,
  });
});

test('importTriageJson: parses items, masks phones, redacts SSNs', () => {
  const { items, errors } = importTriageJson(
    JSON.stringify({
      items: [
        {
          sender: '+1 (305) 555-4567',
          message: 'Hola, mi número es 305-555-4567 y mi ssn 123-45-6789',
          receivedAt: '2026-09-17T09:00:00-05:00',
        },
      ],
    }),
  );
  assert.equal(errors.length, 0);
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.channel, 'whatsapp');
  assert.equal(it.senderMasked, '***4567');
  assert.ok(!/\d{3}-\d{2}-\d{4}/.test(it.message), 'SSN redacted');
  assert.ok(!/305-555-4567/.test(it.message), 'full phone masked in text');
  assert.equal(it.status, 'new');
});

test('importTriageJson: accepts a bare array; rejects invalid JSON and bad rows without inventing', () => {
  const ok = importTriageJson(
    JSON.stringify([{ sender: '5551234567', message: 'info por favor' }]),
  );
  assert.equal(ok.items.length, 1);
  assert.equal(ok.items[0].senderMasked, '***4567');

  const bad = importTriageJson('not json{{{');
  assert.equal(bad.items.length, 0);
  assert.ok(bad.errors.length > 0);

  const badRows = importTriageJson(
    JSON.stringify({ items: [{}, null, { message: 'solo mensaje' }] }),
  );
  assert.equal(badRows.items.length, 1, 'only the valid row is kept');
  assert.equal(badRows.errors.length, 2, 'bad rows reported, not invented');
});

test('sampleTriageTemplate is clearly labeled DEMO and fictional', () => {
  const t = sampleTriageTemplate();
  const { items, errors } = importTriageJson(t);
  assert.equal(errors.length, 0);
  assert.equal(items.length, 1);
  assert.match(items[0].message, /DEMO/);
  assert.match(items[0].notes, /DEMO/);
  assert.ok(items[0].senderMasked.endsWith('4567'));
});

test('store: importJson persists masked items; setStatus/linkCase/delete work', () => {
  const store = fresh();
  const res = store.importJson(
    JSON.stringify([{ sender: '2815551234', message: 'quiero info' }]),
  );
  assert.equal(res.added, 1);
  assert.equal(res.errors.length, 0);
  const item = store.listTriage()[0];
  assert.equal(item.senderMasked, '***1234');
  store.setStatus(item.id, 'reviewed');
  assert.equal(store.getTriageItem(item.id).status, 'reviewed');
  store.linkCase(item.id, 'case-1');
  const linked = store.getTriageItem(item.id);
  assert.equal(linked.caseId, 'case-1');
  assert.equal(linked.status, 'converted');
  assert.equal(store.listTriage({ status: 'converted' }).length, 1);
  assert.ok(store.deleteTriageItem(item.id));
  assert.equal(store.listTriage().length, 0);
});

test('exportTriageJson round-trips masked data', () => {
  const store = fresh();
  store.addTriageItem({ sender: '3055554567', message: 'hola' });
  const out = JSON.parse(exportTriageJson(store.listTriage()));
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].senderMasked, '***4567');
  assert.ok(!JSON.stringify(out).includes('3055554567'));
});

test('NO-SEND-PATH: the triage module exposes no send/submit/transmit API', async () => {
  const mod = await import('./new850Triage.js');
  for (const name of Object.keys(mod)) {
    assert.ok(
      !/send|submit|transmit|dispatch|reply|message.*send/i.test(name),
      `triage module must not expose a send path (found: ${name})`,
    );
  }
});
