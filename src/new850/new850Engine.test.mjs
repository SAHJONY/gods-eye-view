import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  investigationWindow,
  windowStatus,
  windowStatusLabel,
  dormantCases,
  unresolvedDisputes,
  disputesEligibleForRound,
  nextRoundRecommendation,
  roundSequence,
  complianceIssues,
  draftDisputeLetter,
  draftFurnisherLetter,
  draftCfpbComplaint,
  draftCustomerMessage,
  addDaysIso,
  daysBetween,
  FCRA_WINDOW_DAYS,
  FCRA_EXTENDED_WINDOW_DAYS,
  DORMANT_AFTER_DAYS,
} = await import('./new850Engine.js');

const baseCase = (over = {}) => ({
  id: 'c1',
  ref: 'N850-0001',
  clientLabel: 'Cliente ***4567',
  phoneMasked: '***4567',
  stage: 'round-1-wait',
  bureaus: ['equifax', 'experian'],
  disputes: [],
  rounds: [],
  drafts: [],
  agentNotes: [],
  updatedAt: '2026-09-17T10:00:00-05:00',
  ...over,
});

const baseDispute = (over = {}) => ({
  id: 'd1',
  item: 'pago tardío',
  creditor: 'Banco Ejemplo',
  bureaus: ['equifax'],
  status: 'verified',
  round: 1,
  evidence: 'estado de cuenta de enero',
  identityTheftAttested: false,
  isAccurate: false,
  ...over,
});

test('investigationWindow: 30 days standard, 45 extended', () => {
  const w = investigationWindow('2026-09-17T10:00:00-05:00');
  assert.equal(w.days, FCRA_WINDOW_DAYS);
  assert.equal(w.deadlineAt.slice(0, 10), '2026-10-17');
  const w45 = investigationWindow('2026-09-17T10:00:00-05:00', true);
  assert.equal(w45.days, FCRA_EXTENDED_WINDOW_DAYS);
  assert.equal(w45.deadlineAt.slice(0, 10), '2026-11-01');
  assert.equal(investigationWindow('not-a-date'), null);
});

test('windowStatus: ok / due-soon / overdue', () => {
  const now = new Date('2026-09-17T12:00:00-05:00');
  assert.equal(
    windowStatus(new Date(now.getTime() + 20 * 86400000).toISOString(), now),
    'ok',
  );
  assert.equal(
    windowStatus(new Date(now.getTime() + 3 * 86400000).toISOString(), now),
    'due-soon',
  );
  assert.equal(
    windowStatus(new Date(now.getTime() - 86400000).toISOString(), now),
    'overdue',
  );
  assert.equal(windowStatus(null, now), 'unknown');
  assert.ok(windowStatusLabel('overdue', 'es').length > 0);
  assert.ok(windowStatusLabel('overdue', 'en').length > 0);
});

test('dormantCases flags open cases past the inactivity threshold', () => {
  const now = new Date('2026-09-17T12:00:00-05:00');
  const stale = baseCase({
    id: 'stale',
    ref: 'N850-0002',
    updatedAt: '2026-08-20T10:00:00-05:00',
  });
  const fresh = baseCase({
    id: 'fresh',
    ref: 'N850-0003',
    updatedAt: '2026-09-16T10:00:00-05:00',
  });
  const closed = baseCase({
    id: 'closed',
    ref: 'N850-0004',
    stage: 'closed',
    updatedAt: '2026-08-01T10:00:00-05:00',
  });
  const found = dormantCases([stale, fresh, closed], {
    inactivityDays: DORMANT_AFTER_DAYS,
    now,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].caseRef, 'N850-0002');
  assert.ok(found[0].daysInactive >= DORMANT_AFTER_DAYS);
  assert.ok(found[0].label.es && found[0].label.en);
});

test('round sequencing: unresolved disputes move to R2/R3; deleted never continue', () => {
  const c = baseCase({
    disputes: [
      baseDispute({ id: 'd1', status: 'verified', round: 1 }),
      baseDispute({ id: 'd2', status: 'deleted', round: 1 }),
      baseDispute({ id: 'd3', status: 'no-response', round: 1 }),
    ],
  });
  assert.equal(unresolvedDisputes(c).length, 2);
  const eligible = disputesEligibleForRound(c, 2);
  assert.deepEqual(
    eligible.map((d) => d.id).sort(),
    ['d1', 'd3'],
  );
  assert.deepEqual(disputesEligibleForRound(c, 4), []);
  const rec = nextRoundRecommendation(c);
  assert.equal(rec.recommendedRound, 2);
  assert.equal(rec.eligibleCount, 2);
  assert.ok(rec.reason.es && rec.reason.en);
});

test('nextRoundRecommendation: nothing to escalate when all resolved', () => {
  const c = baseCase({
    disputes: [baseDispute({ status: 'deleted', round: 1 })],
  });
  const rec = nextRoundRecommendation(c);
  assert.equal(rec.recommendedRound, null);
  assert.equal(rec.eligibleCount, 0);
});

test('roundSequence reports rounds as not-started without inventing', () => {
  const c = baseCase({
    rounds: [
      {
        round: 1,
        startedAt: '2026-09-17T10:00:00-05:00',
        deadlineAt: '2026-10-17T10:00:00-05:00',
        windowDays: 30,
        status: 'active',
      },
    ],
  });
  const seq = roundSequence(c, new Date('2026-09-20T12:00:00-05:00'));
  assert.equal(seq.length, 3);
  assert.ok(seq[0].started);
  assert.equal(seq[0].window.status, 'ok');
  assert.ok(!seq[1].started);
  assert.equal(seq[1].window, null);
});

test('complianceIssues: flags guarantee language', () => {
  const issues = complianceIssues({
    text: 'Te garantizamos que tu puntaje subirá 100 puntos.',
    disputes: [],
    kind: 'customer-message',
  });
  assert.ok(issues.some((i) => i.code === 'GUARANTEE_LANGUAGE'));
});

test('complianceIssues: flags false identity-theft claims and accurate-item disputes', () => {
  const issues = complianceIssues({
    text: 'Fui víctima de robo de identidad.',
    disputes: [
      baseDispute({ identityTheftAttested: false }),
      baseDispute({ id: 'd9', isAccurate: true }),
    ],
    kind: 'dispute-letter',
  });
  assert.ok(issues.some((i) => i.code === 'FALSE_ID_THEFT'));
  assert.ok(issues.some((i) => i.code === 'DISPUTES_ACCURATE_ITEM'));
  const ok = complianceIssues({
    text: 'No hay garantía de resultados.',
    disputes: [baseDispute({ identityTheftAttested: true })],
    kind: 'dispute-letter',
  });
  assert.deepEqual(ok, []);
});

test('complianceIssues: requires evidence on dispute letters', () => {
  const issues = complianceIssues({
    text: 'No hay garantía de resultados.',
    disputes: [baseDispute({ evidence: '' })],
    kind: 'dispute-letter',
  });
  assert.ok(issues.some((i) => i.code === 'MISSING_EVIDENCE'));
});

test('draftDisputeLetter: DRAFT stamp, masked PII, no invented evidence', () => {
  const c = baseCase();
  const d = baseDispute();
  const { text, error } = draftDisputeLetter({
    caseObj: c,
    dispute: d,
    bureau: 'equifax',
    lang: 'es',
  });
  assert.ok(!error);
  assert.match(text, /BORRADOR/);
  assert.match(text, /NADA ENVIADO/);
  assert.match(text, /\*\*\*4567/);
  assert.match(text, /estado de cuenta de enero/);
  assert.match(text, /Equifax/);
  assert.match(text, /No hay garant[ií]a/);
  const en = draftDisputeLetter({
    caseObj: c,
    dispute: d,
    bureau: 'transunion',
    lang: 'en',
  });
  assert.match(en.text, /AWAITING OWNER APPROVAL/);
  assert.match(en.text, /no guarantee/i);
});

test('draftDisputeLetter: refuses accurate items and missing evidence', () => {
  const c = baseCase();
  const accurate = draftDisputeLetter({
    caseObj: c,
    dispute: baseDispute({ isAccurate: true }),
    bureau: 'equifax',
  });
  assert.ok(accurate.error);
  const noEvidence = draftDisputeLetter({
    caseObj: c,
    dispute: baseDispute({ evidence: '' }),
    bureau: 'equifax',
  });
  assert.ok(noEvidence.error);
});

test('draftFurnisherLetter / draftCfpbComplaint / draftCustomerMessage are DRAFT-only', () => {
  const c = baseCase();
  const d = baseDispute();
  for (const built of [
    draftFurnisherLetter({ caseObj: c, dispute: d, lang: 'es' }),
    draftCfpbComplaint({
      caseObj: c,
      reason: 'Ventana vencida sin respuesta',
      lang: 'es',
    }),
    draftCustomerMessage({ caseObj: c, body: 'Actualización.', lang: 'en' }),
  ]) {
    assert.ok(!built.error, JSON.stringify(built.error));
    assert.match(built.text, /NADA ENVIADO|NOTHING SENT/);
    assert.match(built.text, /BORRADOR|DRAFT/);
  }
  assert.match(
    draftCustomerMessage({ caseObj: c, body: 'x', lang: 'es' }).text,
    /No hay garant[ií]a/,
  );
});

test('engine exposes no send path', async () => {
  const engine = await import('./new850Engine.js');
  for (const name of Object.keys(engine)) {
    assert.ok(
      !/send|submit|transmit|dispatch/i.test(name),
      `engine must not expose a send path (found: ${name})`,
    );
  }
});

test('addDaysIso / daysBetween date helpers', () => {
  assert.equal(
    addDaysIso('2026-09-17T10:00:00-05:00', 30).slice(0, 10),
    '2026-10-17',
  );
  assert.equal(
    daysBetween('2026-09-17T10:00:00-05:00', '2026-10-17T10:00:00-05:00'),
    30,
  );
  assert.equal(daysBetween('junk', '2026-10-17'), null);
});
