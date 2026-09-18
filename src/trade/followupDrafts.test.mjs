/**
 * Tests for the follow-up draft queue.
 * DRAFT-ONLY BY DESIGN: asserts no send/post/publish/dispatch export exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDraft,
  getDraft,
  listDrafts,
  pendingDrafts,
  openDraftForRfq,
  updateDraft,
  moveDraft,
  deleteDraft,
  draftStats,
  resetFollowupDrafts,
  assertDraftOnly,
  DRAFTS_KEY,
  DRAFT_KIND_LABELS,
  DRAFT_STATUS_LABELS,
} from './followupDrafts.js';

test('DRAFTS_KEY is namespaced for trade', () => {
  assert.equal(DRAFTS_KEY, 'sahjony.trade.followups.v1');
});

test('assertDraftOnly: no send/post/publish/dispatch export may exist', async () => {
  assert.equal(assertDraftOnly(), true);
  const mod = await import('./followupDrafts.js');
  for (const forbidden of [
    'send',
    'sendDraft',
    'post',
    'publish',
    'dispatch',
    'transmit',
  ]) {
    assert.ok(!(forbidden in mod), `forbidden export present: ${forbidden}`);
  }
});

test('createDraft: defaults, bilingual labels', () => {
  resetFollowupDrafts();
  const d = createDraft({
    rfqId: 'r1',
    rfqRef: 'FIX-001',
    es: 'Hola',
    en: 'Hi',
  });
  assert.ok(d.id);
  assert.equal(d.status, 'draft');
  assert.equal(d.kind, 'followup');
  assert.equal(d.channel, 'whatsapp');
  assert.deepEqual(d.flags, []);
  assert.ok(d.createdAt);
  assert.equal(DRAFT_KIND_LABELS.followup.es, 'Seguimiento');
  assert.equal(DRAFT_STATUS_LABELS.draft.en, 'Draft');
});

test('status flow: draft → approved → sent, forward only', () => {
  resetFollowupDrafts();
  const d = createDraft({ rfqId: 'r1', es: 'a', en: 'b' });
  assert.throws(() => moveDraft(d.id, 'sent'), /Invalid draft transition/);
  const approved = moveDraft(d.id, 'approved');
  assert.equal(approved.status, 'approved');
  assert.ok(approved.approvedAt);
  const sent = moveDraft(d.id, 'sent');
  assert.equal(sent.status, 'sent');
  assert.ok(sent.sentAt);
  assert.throws(() => moveDraft(d.id, 'draft'), /Invalid draft transition/);
  assert.throws(() => moveDraft(d.id, 'bogus'), /Unknown follow-up draft status/);
});

test('openDraftForRfq: one open draft per RFQ; sent/archived do not block', () => {
  resetFollowupDrafts();
  assert.equal(openDraftForRfq('rx'), null);
  const d = createDraft({ rfqId: 'rx', es: 'a', en: 'b' });
  assert.equal(openDraftForRfq('rx').id, d.id);
  moveDraft(d.id, 'approved');
  assert.equal(openDraftForRfq('rx').id, d.id, 'approved still open');
  moveDraft(d.id, 'sent');
  assert.equal(openDraftForRfq('rx'), null, 'sent no longer blocks');
});

test('pendingDrafts / stats / deleteDraft', () => {
  resetFollowupDrafts();
  const a = createDraft({ rfqId: 'r1', es: 'a', en: 'b' });
  const b = createDraft({ rfqId: 'r2', es: 'a', en: 'b' });
  moveDraft(b.id, 'approved');
  assert.equal(pendingDrafts().length, 1);
  assert.equal(pendingDrafts()[0].id, a.id);
  const stats = draftStats();
  assert.equal(stats.total, 2);
  assert.equal(stats.byStatus.draft, 1);
  assert.equal(stats.byStatus.approved, 1);
  assert.equal(deleteDraft(a.id), true);
  assert.equal(getDraft(a.id), null);
  assert.equal(deleteDraft('missing'), false);
});

test('updateDraft preserves id and createdAt', () => {
  resetFollowupDrafts();
  const d = createDraft({ rfqId: 'r1', es: 'a', en: 'b' });
  const updated = updateDraft(d.id, { es: 'changed', id: 'hacked' });
  assert.equal(updated.id, d.id);
  assert.equal(updated.es, 'changed');
  assert.equal(updated.createdAt, d.createdAt);
  assert.equal(updateDraft('missing', { es: 'x' }), null);
});

test('listDrafts supports object and function filters', () => {
  resetFollowupDrafts();
  createDraft({ rfqId: 'r1', kind: 'followup', es: 'a', en: 'b' });
  createDraft({ rfqId: 'r2', kind: 'pricing', es: 'a', en: 'b' });
  assert.equal(listDrafts({ kind: 'pricing' }).length, 1);
  assert.equal(listDrafts((d) => d.rfqId === 'r1').length, 1);
  assert.equal(listDrafts().length, 2);
});
