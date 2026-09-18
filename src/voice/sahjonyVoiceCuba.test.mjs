// Voice intent tests for the dedicated Cuba desk (Module 2): the
// __cuba_* actions registered in src/app/tools.js, reached through the
// bilingual parseSahjonyCommand() in src/voice/sahjonyVoice.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSahjonyCommand } from './sahjonyVoice.js';

test('parse: cuba desk intents are bilingual', () => {
  assert.equal(parseSahjonyCommand('abre la mesa Cuba').action, '__cuba_open');
  assert.equal(parseSahjonyCommand('open the Cuba desk').action, '__cuba_open');
  assert.equal(parseSahjonyCommand('modo cuba').action, '__cuba_open');
});

test('parse: cuba analyze intent is bilingual', () => {
  assert.equal(
    parseSahjonyCommand('analiza la mesa Cuba').action,
    '__cuba_analyze',
  );
  assert.equal(
    parseSahjonyCommand('analyze the Cuba desk').action,
    '__cuba_analyze',
  );
  assert.equal(
    parseSahjonyCommand('mejores solicitudes cuba').action,
    '__cuba_analyze',
  );
});

test('parse: cuba workforce start/pause intents are bilingual', () => {
  assert.equal(
    parseSahjonyCommand('inicia los agentes de Cuba').action,
    '__cuba_workforce_start',
  );
  assert.equal(
    parseSahjonyCommand('start the Cuba workforce').action,
    '__cuba_workforce_start',
  );
  assert.equal(
    parseSahjonyCommand('pausa los agentes de Cuba').action,
    '__cuba_workforce_pause',
  );
  assert.equal(
    parseSahjonyCommand('pause the Cuba workforce').action,
    '__cuba_workforce_pause',
  );
});

test('parse: cuba desk intents do not collide with the global trade desk', () => {
  // "mesa Cuba" must not open the worldwide trade panel.
  assert.notEqual(
    parseSahjonyCommand('abre la mesa Cuba').action,
    '__trade_open',
  );
  assert.equal(parseSahjonyCommand('abre comercio').action, '__trade_open');
});
