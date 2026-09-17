import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  WORKFORCE_LOG_KEY,
  WORKFORCE_NOTE,
  AGENT_DEFS,
  createNew850Workforce,
} = await import('./new850Workforce.js');

const { createNew850Store } = await import('./new850Store.js');
const { createApprovalStore } = await import('./new850Approvals.js');
const { createTriageStore } = await import('./new850Triage.js');

test('WORKFORCE_LOG_KEY is namespaced for new850', () => {
  assert.equal(WORKFORCE_LOG_KEY, 'sahjony.new850.workforce.v1');
});

test('roster has the four AI agents, bilingual, no human team roles', () => {
  assert.deepEqual(
    AGENT_DEFS.map((a) => a.id),
    ['intake', 'drafter', 'tracker', 'nudges'],
  );
  for (const a of AGENT_DEFS) {
    assert.ok(a.name.es && a.name.en, `${a.id} bilingual name`);
    assert.ok(a.desc.es && a.desc.en, `${a.id} bilingual desc`);
    assert.match(a.name.es, /\(IA\)/, `${a.id} labeled as AI`);
  }
  assert.ok(WORKFORCE_NOTE.es && WORKFORCE_NOTE.en);
});

test('runChecks on empty stores: all idle, honest empty summaries', () => {
  const wf = createNew850Workforce({
    caseStore: createNew850Store(),
    approvalStore: createApprovalStore(),
    triageStore: createTriageStore(),
  });
  const board = wf.runChecks(new Date('2026-09-17T12:00:00-05:00'));
  assert.equal(board.agents.length, 4);
  assert.equal(board.attentionCount, 0);
  for (const a of board.agents) {
    assert.equal(a.status, 'idle');
    assert.equal(a.needsJuan.length, 0);
    assert.ok(a.lastRun, `${a.id} recorded a run`);
  }
  assert.ok(board.generatedAt);
});

test('tracker flags overdue and due-soon FCRA windows', () => {
  const cases = createNew850Store();
  cases.reset();
  const c = cases.createCase({ clientLabel: 'X' });
  cases.setRound(c.id, {
    round: 1,
    startedAt: '2026-08-01T10:00:00-05:00',
    deadlineAt: '2026-08-31T10:00:00-05:00', // overdue
    windowDays: 30,
    status: 'active',
  });
  const wf = createNew850Workforce({ caseStore: cases });
  const board = wf.runChecks(new Date('2026-09-17T12:00:00-05:00'));
  const tracker = board.agents.find((a) => a.id === 'tracker');
  assert.equal(tracker.status, 'attention');
  assert.ok(tracker.needsJuan.some((n) => /vencida/i.test(n.es)));
  assert.match(tracker.lastSummary.es, /Vencidas: 1/);
});

test('drafter counts disputes without drafts; nudges flag dormant + pending approvals', () => {
  const cases = createNew850Store();
  cases.reset();
  const c = cases.createCase({ clientLabel: 'X' });
  const d = cases.addDispute(c.id, { item: 'pago tardío', round: 1 });

  const approvals = createApprovalStore();
  approvals.reset();
  approvals.createApproval('new850', {
    kind: 'dispute-letter-r1',
    titleEs: 'x',
    titleEn: 'x',
    summaryEs: 'x',
    summaryEn: 'x',
    payload: {},
  });

  const wf = createNew850Workforce({
    caseStore: cases,
    approvalStore: approvals,
  });
  const board = wf.runChecks(new Date('2026-09-17T12:00:00-05:00'));

  const drafter = board.agents.find((a) => a.id === 'drafter');
  assert.equal(drafter.status, 'attention');
  assert.match(drafter.lastSummary.es, /sin borrador: 1/);

  // After drafting, the drafter goes quiet.
  cases.addDraft(c.id, {
    kind: 'dispute-letter',
    relatedDisputeId: d.id,
    text: 'BORRADOR',
  });
  // Backdate ALL activity (case + draft) to simulate dormancy.
  const stored = cases.getCase(c.id);
  stored.createdAt = '2026-07-01T09:00:00-05:00';
  stored.updatedAt = '2026-07-01T10:00:00-05:00';
  for (const dr of stored.drafts || []) {
    dr.createdAt = '2026-07-01T10:00:00-05:00';
    dr.updatedAt = '2026-07-01T10:00:00-05:00';
  }
  cases.save();
  const board2 = wf.runChecks(new Date('2026-09-17T12:00:00-05:00'));
  assert.equal(
    board2.agents.find((a) => a.id === 'drafter').status,
    'idle',
  );

  const nudges = board2.agents.find((a) => a.id === 'nudges');
  assert.equal(nudges.status, 'attention');
  assert.ok(nudges.needsJuan.some((n) => /inactivo/i.test(n.es)));
  assert.ok(nudges.needsJuan.some((n) => /aprobación/i.test(n.es)));
});

test('intake flags new triage inquiries', () => {
  const triage = createTriageStore();
  triage.reset();
  triage.addTriageItem({ sender: '3055554567', message: 'hola' });
  const wf = createNew850Workforce({ triageStore: triage });
  const board = wf.runChecks(new Date('2026-09-17T12:00:00-05:00'));
  const intake = board.agents.find((a) => a.id === 'intake');
  assert.equal(intake.status, 'attention');
  assert.ok(intake.needsJuan.some((n) => /WhatsApp/i.test(n.es)));
});

test('event log is append-only and honest (one event per agent per check)', () => {
  const wf = createNew850Workforce({});
  wf.resetLog();
  wf.runChecks(new Date('2026-09-17T12:00:00-05:00'));
  const log = wf.getLog();
  assert.equal(log.length, 4);
  assert.deepEqual(
    log.map((e) => e.agent).sort(),
    ['drafter', 'intake', 'nudges', 'tracker'],
  );
  for (const e of log) {
    assert.ok(e.t && e.kind === 'check' && e.es && e.en);
  }
});

test('NO-SEND-PATH: workforce exposes no send/submit/transmit API', async () => {
  const mod = await import('./new850Workforce.js');
  for (const name of Object.keys(mod)) {
    assert.ok(
      !/send|submit|transmit|dispatch|execute|deliver/i.test(name),
      `workforce module must not expose an external-act path (found: ${name})`,
    );
  }
});
