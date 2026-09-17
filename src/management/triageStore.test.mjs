import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  TRIAGE_KEY,
  addTriageItem,
  listTriage,
  getTriageItem,
  updateTriage,
  importTriageJson,
  countOpenTriage,
  _resetTriageForTests,
} = await import('./triageStore.js');

test('triage starts empty — never invents conversations', () => {
  _resetTriageForTests();
  assert.equal(TRIAGE_KEY, 'sahjony.gev.triage.v1');
  for (const biz of ['wholesale', 'crude', 'trade', 'cubacash']) {
    assert.equal(listTriage(biz).length, 0);
    assert.equal(countOpenTriage(biz), 0);
  }
});

test('add/list/update triage items per business', () => {
  _resetTriageForTests();
  const item = addTriageItem('trade', {
    from: '+53 5 123 4567',
    text: 'Hola, me interesa el arroz',
  });
  assert.equal(item.businessId, 'trade');
  assert.equal(item.channel, 'whatsapp');
  assert.equal(item.status, 'new');
  assert.ok(item.id);

  assert.equal(listTriage('trade').length, 1);
  assert.equal(listTriage('trade', 'new').length, 1);
  assert.equal(listTriage('crude').length, 0); // business separation
  assert.equal(getTriageItem(item.id).text, 'Hola, me interesa el arroz');

  const updated = updateTriage(item.id, { status: 'in-progress', note: 'Juan: llamar' });
  assert.equal(updated.status, 'in-progress');
  assert.equal(updated.note, 'Juan: llamar');
  assert.equal(countOpenTriage('trade'), 1);
  updateTriage(item.id, { status: 'done' });
  assert.equal(countOpenTriage('trade'), 0);

  assert.throws(() => addTriageItem('nope', {}), /Unknown businessId/);
  assert.throws(() => updateTriage('missing', {}), /not found/);
});

test('importTriageJson imports only what is given, reports the rest', () => {
  _resetTriageForTests();
  const bad = importTriageJson('cubacash', '{no json');
  assert.equal(bad.imported, 0);
  assert.ok(bad.errors.length > 0);

  const res = importTriageJson(
    'cubacash',
    JSON.stringify([
      { from: 'María', text: '¿Cuánto cuesta enviar $100?' },
      { from: '', text: '' },
      'not-an-object',
      { from: 'Pedro', text: 'Gracias', status: 'done' },
    ]),
  );
  assert.equal(res.imported, 2);
  assert.equal(res.skipped, 2);
  assert.equal(res.errors.length, 2);
  assert.equal(listTriage('cubacash').length, 2);
  assert.equal(countOpenTriage('cubacash'), 1);
});
