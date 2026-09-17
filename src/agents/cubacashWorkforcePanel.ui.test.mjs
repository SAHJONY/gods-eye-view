import { test } from 'node:test';
import assert from 'node:assert/strict';

// This module never imports cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initCubacashWorkforcePanel,
  AGENT_DEFS,
  WORKFORCE_NOTE,
  statusLabel,
  normalizeAgents,
  sortFeedNewest,
  adaptWorkforce,
} = await import('./cubacashWorkforcePanel.js');

function makeEl() {
  const el = {
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    _html: '',
    textContent: '',
    id: '',
    removed: false,
    _handlers: {},
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    remove() {
      this.removed = true;
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    addEventListener(type, fn) {
      this._handlers[type] = fn;
    },
    removeEventListener() {},
    click() {
      if (typeof this._handlers.click === 'function') this._handlers.click();
    },
    querySelector() {
      return makeEl();
    },
    querySelectorAll() {
      return [];
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return this._html;
    },
    set(v) {
      this._html = String(v);
    },
  });
  return el;
}

globalThis.window = globalThis;
globalThis.document = {
  location: { href: 'http://localhost/' },
  getElementById: () => null,
  createElement: () => makeEl(),
  head: makeEl(),
  body: makeEl(),
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
};

function fakeWorkforce() {
  const listeners = new Set();
  const state = {
    running: false,
    queue: 3,
    agents: [
      {
        id: 'provider-verifier',
        status: 'idle',
        lastAction: 'Verificó 2 proveedores',
      },
      { id: 'fee-watcher', status: 'idle', lastAction: null },
      { id: 'corridor-analyst', status: 'idle', lastAction: null },
      { id: 'intake-helper', status: 'idle', lastAction: null },
    ],
    feed: [
      {
        ts: 1000,
        agentId: 'provider-verifier',
        es: 'Verificó 2 proveedores',
        en: 'Verified 2 providers',
      },
      {
        ts: 2000,
        agentId: 'corridor-analyst',
        es: 'Memorando listo',
        en: 'Memo ready',
      },
    ],
    calls: [],
  };
  return {
    state,
    agents: () => state.agents,
    running: () => state.running,
    start: () => {
      state.calls.push('start');
      state.running = true;
    },
    pause: () => {
      state.calls.push('pause');
      state.running = false;
    },
    resume: () => {
      state.calls.push('resume');
      state.running = true;
    },
    onActivity: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getActivityLog: () => state.feed,
    getSummary: () => ({ queueDepth: state.queue }),
    emit: () => {
      for (const fn of listeners) fn();
    },
  };
}

test('cubacashWorkforcePanel: AGENT_DEFS cover the cubacash roster', () => {
  assert.deepEqual(
    AGENT_DEFS.map((a) => a.id),
    ['provider-verifier', 'fee-watcher', 'corridor-analyst', 'intake-helper'],
  );
  for (const def of AGENT_DEFS) {
    assert.ok(def.name.es && def.name.en, `agent ${def.id} bilingual name`);
    assert.ok(def.desc.es && def.desc.en, `agent ${def.id} bilingual desc`);
  }
  assert.equal(AGENT_DEFS[0].name.es, 'Verificador de proveedores');
  assert.equal(AGENT_DEFS[1].name.en, 'Fee Watcher');
  assert.ok(AGENT_DEFS[2].desc.es.includes('Memos de corredor'));
  assert.ok(AGENT_DEFS[3].desc.en.includes('Internal outreach drafts'));
});

test('cubacashWorkforcePanel: honest note uses the engine text verbatim', () => {
  assert.equal(
    WORKFORCE_NOTE.es,
    'La fuerza trabaja mientras la app está abierta.',
  );
  assert.equal(WORKFORCE_NOTE.en, 'The workforce runs while the app is open.');
});

test('cubacashWorkforcePanel: shows 4 cubacash agents with descriptions', () => {
  const wf = fakeWorkforce();
  const panel = initCubacashWorkforcePanel({ workforce: wf });
  panel.open();
  try {
    assert.equal(panel.refs.agentRows.length, 4);
    const agents = panel.getAgents();
    assert.deepEqual(
      agents.map((a) => a.id),
      ['provider-verifier', 'fee-watcher', 'corridor-analyst', 'intake-helper'],
    );
    assert.ok(agents.every((a) => a.desc.es && a.desc.en));
  } finally {
    panel.destroy();
  }
});

test('cubacashWorkforcePanel: adapts the real workforce shape (agents array + getActivityLog + getSummary)', () => {
  const real = {
    agents: [
      {
        id: 'provider-verifier',
        name: { es: 'Verificador de proveedores', en: 'Provider Verifier' },
        status: 'working',
        lastAction: {
          es: 'Verificó 3 proveedores',
          en: 'Verified 3 providers',
        },
      },
      {
        id: 'fee-watcher',
        name: { es: 'Vigilante de tarifas', en: 'Fee Watcher' },
        status: 'idle',
        lastAction: null,
      },
      {
        id: 'corridor-analyst',
        name: { es: 'Analista de corredores', en: 'Corridor Analyst' },
        status: 'paused',
        lastAction: null,
      },
      {
        id: 'intake-helper',
        name: { es: 'Ayudante de captación', en: 'Intake Helper' },
        status: 'idle',
        lastAction: null,
      },
    ],
    running: true, // getter-style boolean, not a function
    onActivity: () => () => {},
    getActivityLog: () => [
      {
        t: 3000,
        agent: 'provider-verifier',
        es: 'Proveedor verificado',
        en: 'Provider verified',
      },
      {
        t: 1000,
        agent: 'fee-watcher',
        es: 'Tarifa lista',
        en: 'Fee ready',
      },
    ],
    getSummary: () => ({ queueDepth: 5 }),
    start() {},
    pause() {},
    resume() {},
  };
  const panel = initCubacashWorkforcePanel({ workforce: real });
  panel.open();
  try {
    assert.equal(panel.refs.agentRows.length, 4);
    assert.equal(panel.refs.feedItems.length, 2);
    // Newest first.
    assert.ok(
      panel.refs.feedItems[0].children[0].textContent.includes('verificado'),
    );
    // Running getter → button offers pause.
    assert.ok(panel.refs.toggleBtn.textContent.includes('Pausar'));
    // Queue depth read via getSummary().
    assert.ok(panel.refs.queueEl.textContent.includes('5'));
    assert.equal(panel.getQueueDepth(), 5);
    const agents = panel.getAgents();
    assert.ok(agents.every((a) => a.desc.es && a.desc.en));
  } finally {
    panel.destroy();
  }
});

test('cubacashWorkforcePanel: toggleRun start/pause calls', () => {
  const wf = fakeWorkforce();
  const panel = initCubacashWorkforcePanel({ workforce: wf });
  panel.open();
  try {
    assert.ok(
      panel.refs.toggleBtn.textContent.includes('Iniciar'),
      'starts in ES start state',
    );
    panel.toggleRun();
    assert.deepEqual(wf.state.calls, ['start']);
    assert.equal(wf.state.running, true);
    assert.ok(
      panel.refs.toggleBtn.textContent.includes('Pausar'),
      'button now offers pause',
    );
    panel.toggleRun();
    assert.deepEqual(wf.state.calls, ['start', 'pause']);
    assert.equal(wf.state.running, false);
    // Paused agent resumes instead of restarting.
    wf.state.agents[1].status = 'paused';
    panel.toggleRun();
    assert.deepEqual(wf.state.calls, ['start', 'pause', 'resume']);
  } finally {
    panel.destroy();
  }
});

test('cubacashWorkforcePanel: feed renders newest first and live activity refreshes', () => {
  const wf = fakeWorkforce();
  const panel = initCubacashWorkforcePanel({ workforce: wf });
  panel.open();
  try {
    const items = panel.refs.feedItems;
    assert.equal(items.length, 2);
    const firstText = items[0].children[0].textContent;
    assert.ok(
      firstText.includes('Memorando'),
      `newest entry first, got: ${firstText}`,
    );
    // Live update: new activity arrives, panel refreshes via onActivity.
    wf.state.feed.push({
      ts: 3000,
      agentId: 'intake-helper',
      es: 'Nuevo borrador',
      en: 'New draft',
    });
    wf.emit();
    assert.equal(panel.refs.feedItems.length, 3);
    assert.ok(
      panel.refs.feedItems[0].children[0].textContent.includes(
        'Nuevo borrador',
      ),
      'live entry on top',
    );
    assert.equal(panel.getFeed()[0].ts, 3000, 'getFeed newest-first');
  } finally {
    panel.destroy();
  }
});

test('cubacashWorkforcePanel: queue depth via double shape', () => {
  const wf = fakeWorkforce();
  const panel = initCubacashWorkforcePanel({ workforce: wf });
  panel.open();
  try {
    assert.ok(
      panel.refs.queueEl.textContent.includes('3'),
      'queue depth 3 shown',
    );
    assert.equal(panel.getQueueDepth(), 3);
  } finally {
    panel.destroy();
  }
});

test('cubacashWorkforcePanel: no workforce → honest idle roster', () => {
  const panel = initCubacashWorkforcePanel({});
  panel.open();
  assert.equal(panel.refs.agentRows.length, 4);
  assert.ok(
    panel.refs.agentRows.every((r) => r.children[0].className.includes('idle')),
  );
  assert.ok(panel.getQueueDepth() === 0);
  panel.setLang('en');
  panel.destroy();
});

test('cubacashWorkforcePanel: honest note rendered, ES/EN toggle', () => {
  const panel = initCubacashWorkforcePanel({});
  panel.open();
  try {
    assert.equal(panel.getLang(), 'es');
    panel.setLang('en');
    assert.equal(panel.getLang(), 'en');
    assert.ok(
      panel.refs.toggleBtn.textContent.includes('Start'),
      'EN toggle label',
    );
  } finally {
    panel.destroy();
  }
});

test('statusLabel: bilingual statuses', () => {
  assert.equal(statusLabel('working', 'es'), 'Trabajando');
  assert.equal(statusLabel('working', 'en'), 'Working');
  assert.equal(statusLabel('paused', 'es'), 'Pausado');
  assert.equal(statusLabel('idle', 'en'), 'Idle');
  assert.equal(statusLabel('weird'), 'Inactivo');
});

test('normalizeAgents: unknown ids ignored, bad status -> idle', () => {
  const agents = normalizeAgents([
    { id: 'provider-verifier', status: 'working', lastAction: 'x' },
    { id: 'ghost', status: 'working' },
    { id: 'fee-watcher', status: 'dancing' },
  ]);
  assert.equal(agents.length, AGENT_DEFS.length);
  assert.equal(agents[0].status, 'working');
  assert.equal(agents[0].id, 'provider-verifier');
  assert.equal(agents[1].status, 'idle');
  assert.ok(agents.every((a) => AGENT_DEFS.some((d) => d.id === a.id)));
});

test('sortFeedNewest: newest first, null-safe', () => {
  const sorted = sortFeedNewest([
    { ts: 5, es: 'a' },
    { ts: 50, es: 'b' },
    { ts: 10, es: 'c' },
  ]);
  assert.deepEqual(
    sorted.map((e) => e.ts),
    [50, 10, 5],
  );
  assert.deepEqual(sortFeedNewest(null), []);
});

test('adaptWorkforce: real shape (agents array + getActivityLog + getSummary)', () => {
  const real = {
    agents: [
      {
        id: 'provider-verifier',
        name: { es: 'Verificador de proveedores', en: 'Provider Verifier' },
        status: 'working',
        lastAction: {
          es: 'Verificó 3 proveedores',
          en: 'Verified 3 providers',
        },
      },
    ],
    running: true,
    getActivityLog: () => [
      { t: 42, agent: 'fee-watcher', es: 'Tasa marcada', en: 'Fee flagged' },
    ],
    getSummary: () => ({ queueDepth: 7 }),
    start() {},
    pause() {},
    resume() {},
    onActivity: () => () => {},
  };
  const w = adaptWorkforce(real);
  const agents = w.agents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, 'provider-verifier');
  assert.equal(agents[0].status, 'working');
  assert.equal(agents[0].lastActionEs, 'Verificó 3 proveedores');
  assert.equal(agents[0].lastActionEn, 'Verified 3 providers');
  assert.ok(agents[0].desc.es && agents[0].desc.en);
  const feed = w.feed();
  assert.equal(feed.length, 1);
  assert.equal(feed[0].ts, 42);
  assert.equal(feed[0].agentId, 'fee-watcher');
  assert.equal(w.queueDepth(), 7);
  assert.equal(w.running(), true);
});

test('adaptWorkforce: minimal double shape (agents()/feed()/queueDepth()/running())', () => {
  const calls = [];
  const dbl = {
    agents: () => [{ id: 'fee-watcher', status: 'paused' }],
    feed: () => [{ ts: 9, agentId: 'fee-watcher', es: 'x', en: 'y' }],
    queueDepth: () => 2,
    running: () => false,
    start: () => calls.push('start'),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    onActivity: () => () => calls.push('unsub'),
  };
  const w = adaptWorkforce(dbl);
  assert.equal(w.agents().length, 1);
  assert.equal(w.agents()[0].status, 'paused');
  assert.equal(w.feed()[0].agentId, 'fee-watcher');
  assert.equal(w.queueDepth(), 2);
  assert.equal(w.running(), false);
  w.start();
  w.pause();
  w.resume();
  assert.deepEqual(calls, ['start', 'pause', 'resume']);
});

test('adaptWorkforce: empty or throwing sources stay honest', () => {
  const empty = adaptWorkforce(null);
  assert.equal(empty.agents().length, 4);
  assert.ok(empty.agents().every((a) => a.status === 'idle'));
  assert.deepEqual(empty.feed(), []);
  assert.equal(empty.queueDepth(), 0);
  assert.equal(empty.running(), false);
  assert.equal(
    empty.onActivity(() => {}),
    null,
  );

  const throwing = adaptWorkforce({
    agents: () => {
      throw new Error('boom');
    },
    feed: () => {
      throw new Error('boom');
    },
    queueDepth: () => {
      throw new Error('boom');
    },
    running: () => {
      throw new Error('boom');
    },
  });
  assert.equal(throwing.agents().length, 4, 'falls back to idle roster');
  assert.deepEqual(throwing.feed(), []);
  assert.equal(throwing.queueDepth(), 0);
  assert.equal(throwing.running(), false);
});

test('cubacashWorkforcePanel: window handle + open/close/toggle/destroy', () => {
  const panel = initCubacashWorkforcePanel({});
  assert.equal(globalThis.__gevCubacashWorkforceUI, panel);
  panel.toggle();
  assert.ok(panel.refs.roster, 'toggle opens');
  panel.toggle();
  assert.equal(panel.refs.roster, null, 'toggle closes');
  panel.open();
  panel.destroy();
  assert.equal(panel.refs.roster, null, 'destroy clears refs');
});
