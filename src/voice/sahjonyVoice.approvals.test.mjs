import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseSahjonyCommand } = await import('./sahjonyVoice.js');

test('voice lists pending approvals (all businesses), ES/EN', () => {
  for (const phrase of [
    'qué tengo pendiente de aprobar',
    'que tengo para aprobar',
    'muéstrame mis aprobaciones',
    'muéstrame las aprobaciones',
    'cola de aprobaciones',
    'lista de aprobaciones',
    'aprobaciones pendientes',
    'show me my approvals',
    'show pending approvals',
    'approval queue',
    'what do i have pending approval',
  ]) {
    const r = parseSahjonyCommand(phrase);
    assert.ok(r, `no intent for: ${phrase}`);
    assert.equal(r.action, '__approvals_list', phrase);
    assert.equal(r.args.businessId, null, phrase);
    assert.ok(r.say.es, `missing ES say: ${phrase}`);
    assert.ok(r.say.en, `missing EN say: ${phrase}`);
  }
});

test('voice lists approvals per business (all seven namespaces)', () => {
  const cases = [
    ['muéstrame las aprobaciones de wholesale', 'wholesale'],
    ['qué tengo pendiente en mayorista', 'wholesale'],
    ['muéstrame las aprobaciones de crudo', 'crude'],
    ['pending approvals for crude', 'crude'],
    ['qué tengo pendiente en comercio', 'trade'],
    ['show trade approvals', 'trade'],
    ['muéstrame las aprobaciones de cuba cash', 'cubacash'],
    ['qué tengo pendiente en remesas', 'cubacash'],
    ['muéstrame las aprobaciones de venta de autos', 'carsales'],
    ['car sales approvals', 'carsales'],
    ['muéstrame las aprobaciones de New850', 'new850'],
    ['new850 approvals', 'new850'],
    ['muéstrame las aprobaciones de seguros', 'insurance'],
    ['pending approvals for insurance', 'insurance'],
  ];
  for (const [phrase, businessId] of cases) {
    const r = parseSahjonyCommand(phrase);
    assert.ok(r, `no intent for: ${phrase}`);
    assert.equal(r.action, '__approvals_list', phrase);
    assert.equal(r.args.businessId, businessId, phrase);
    assert.ok(r.say.es && r.say.en, `say missing: ${phrase}`);
  }
});

test('SAFETY: approval is TAP-ONLY — no voice approve/reject intent exists', () => {
  const dangerous = [
    'aprueba la carta de disputa',
    'aprueba el borrador',
    'apruebala',
    'rechaza la publicación',
    'rechaza el borrador',
    'approve the draft listing',
    'approve the dispute letter',
    'approve it',
    'reject the outreach post',
    'sí, apruébalo',
    'yes approve',
  ];
  for (const phrase of dangerous) {
    const r = parseSahjonyCommand(phrase);
    if (r) {
      assert.ok(
        !/approv/i.test(r.action),
        `voice must never decide approvals (got ${r.action} for: ${phrase})`,
      );
    }
  }
  // Static guarantee: the intent engine assigns no approve/reject approval action.
  const src = parseSahjonyCommand.toString();
  assert.ok(!/'__approvals_approve'/.test(src), 'no voice approve intent');
  assert.ok(!/'__approvals_reject'/.test(src), 'no voice reject intent');
  assert.ok(!/"__approvals_approve"/.test(src), 'no voice approve intent');
  assert.ok(!/"__approvals_reject"/.test(src), 'no voice reject intent');
});

test('approval list intents do not swallow neighboring business intents', () => {
  assert.equal(parseSahjonyCommand('modo seguros')?.action, '__insurance_open');
  assert.equal(parseSahjonyCommand('cuántos cargamentos')?.action, '__crude_status');
  assert.equal(parseSahjonyCommand('abre wholesale')?.action, '__wholesale_open');
  assert.equal(parseSahjonyCommand('trade panel')?.action, '__trade_open');
});
