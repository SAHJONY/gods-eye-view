import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_DEFS,
  WORKFORCE_NOTE,
  statusLabel,
  normalizeAgents,
  sortFeedNewest,
  adaptWorkforce,
} from './carsWorkforcePanel.js';

test('roster has the 4 cars agents, Spanish-first', () => {
  assert.equal(AGENT_DEFS.length, 4);
  assert.deepEqual(
    AGENT_DEFS.map((d) => d.id),
    ['lead-qualifier', 'price-watcher', 'rosmel-drafter', 'oversight'],
  );
  for (const def of AGENT_DEFS) {
    assert.ok(def.name.es && def.name.en);
    assert.ok(def.desc.es && def.desc.en);
  }
  assert.ok(WORKFORCE_NOTE.es.includes('mientras la app'));
});

test('statusLabel bilingual', () => {
  assert.equal(statusLabel('working', 'es'), 'Trabajando');
  assert.equal(statusLabel('working', 'en'), 'Working');
  assert.equal(statusLabel('paused'), 'Pausado');
  assert.equal(statusLabel('idle', 'en'), 'Idle');
  assert.equal(statusLabel('bogus'), 'Inactivo');
});

test('normalizeAgents coerces unknown statuses to idle', () => {
  const normalized = normalizeAgents([
    { id: 'lead-qualifier', status: 'working', lastAction: 'x' },
    { id: 'price-watcher', status: 'bogus' },
    { id: 'unknown-agent', status: 'working' },
  ]);
  assert.equal(normalized.length, 4);
  assert.equal(normalized[0].status, 'working');
  assert.equal(normalized[0].lastAction, 'x');
  assert.equal(normalized[1].status, 'idle');
  // Unknown agents never appear in the canonical roster.
  assert.ok(!normalized.some((a) => a.id === 'unknown-agent'));
});

test('sortFeedNewest orders by timestamp', () => {
  const sorted = sortFeedNewest([
    { ts: 1, es: 'a' },
    { ts: 3, es: 'c' },
    { ts: 2, es: 'b' },
  ]);
  assert.deepEqual(sorted.map((e) => e.es), ['c', 'b', 'a']);
});

test('adaptWorkforce normalizes a minimal double and stays honest without one', () => {
  const wf = adaptWorkforce(null);
  assert.equal(wf.agents().length, 4);
  assert.deepEqual(wf.feed(), []);
  assert.equal(wf.queueDepth(), 0);
  assert.equal(wf.running(), false);

  const listeners = new Set();
  const fake = {
    agents: [
      {
        id: 'lead-qualifier',
        name: { es: 'Calificador', en: 'Qualifier' },
        status: 'working',
        lastAction: { es: 'Calificó 2', en: 'Scored 2' },
      },
    ],
    get running() {
      return true;
    },
    getActivityLog: () => [{ t: 5, agent: 'lead-qualifier', es: 'a', en: 'b' }],
    getSummary: () => ({ queueDepth: 7 }),
    start: () => {},
    pause: () => {},
    onActivity: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const adapted = adaptWorkforce(fake);
  const agents = adapted.agents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].lastActionEs, 'Calificó 2');
  assert.equal(adapted.queueDepth(), 7);
  assert.equal(adapted.running(), true);
  assert.equal(adapted.feed().length, 1);
  assert.equal(typeof adapted.onActivity(() => {}), 'function');
});
