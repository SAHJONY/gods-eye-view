import { test } from 'node:test';
import assert from 'node:assert/strict';

// This module never imports cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initTradeWorkforcePanel,
  AGENT_DEFS,
  WORKFORCE_NOTE,
  statusLabel,
  normalizeAgents,
  sortFeedNewest,
} = await import('./tradeWorkforcePanel.js');

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
        id: 'supplier-scout',
        status: 'idle',
        lastAction: 'Triageó 4 RFQs',
      },
      { id: 'rfq-researcher', status: 'idle', lastAction: null },
      { id: 'logistics-analyst', status: 'idle', lastAction: null },
      { id: 'deal-coordinator', status: 'idle', lastAction: null },
    ],
    feed: [
      {
        ts: 1000,
        agentId: 'supplier-scout',
        es: 'Triageó 4 RFQs',
        en: 'Triaged 4 RFQs',
      },
      {
        ts: 2000,
        agentId: 'logistics-analyst',
        es: 'Calculó el margen',
        en: 'Computed the margin',
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
    feed: () => state.feed,
    queueDepth: () => state.queue,
    getActivityLog: () => state.feed,
    getSummary: () => ({ queueDepth: state.queue }),
    emit: () => {
      for (const fn of listeners) fn();
    },
  };
}

test('tradeWorkforcePanel: AGENT_DEFS cover the trade roster', () => {
  assert.deepEqual(
    AGENT_DEFS.map((a) => a.id),
    [
      'supplier-scout',
      'rfq-researcher',
      'logistics-analyst',
      'deal-coordinator',
    ],
  );
  for (const def of AGENT_DEFS) {
    assert.ok(def.name.es && def.name.en, `agent ${def.id} bilingual name`);
    assert.ok(def.desc.es && def.desc.en, `agent ${def.id} bilingual desc`);
  }
  assert.equal(
    AGENT_DEFS[0].name.es,
    'Explorador de proveedores',
  );
  assert.equal(AGENT_DEFS[0].name.en, 'Supplier Scout');
  assert.ok(AGENT_DEFS[1].desc.es.includes('diligencia de contrapartes'));
  assert.ok(AGENT_DEFS[2].desc.en.includes('Landed cost'));
  assert.ok(AGENT_DEFS[3].desc.es.includes('proveedores'));
});

test('tradeWorkforcePanel: honest note uses the engine text verbatim', () => {
  assert.equal(
    WORKFORCE_NOTE.es,
    'La fuerza trabaja mientras la app está abierta.',
  );
  assert.equal(WORKFORCE_NOTE.en, 'The workforce runs while the app is open.');
});

test('tradeWorkforcePanel: shows 4 trade agents with descriptions', () => {
  const wf = fakeWorkforce();
  const panel = initTradeWorkforcePanel({ workforce: wf });
  panel.open();
  try {
    assert.equal(panel.refs.agentRows.length, 4);
    const agents = panel.getAgents();
    assert.deepEqual(
      agents.map((a) => a.id),
      [
        'supplier-scout',
        'rfq-researcher',
        'logistics-analyst',
        'deal-coordinator',
      ],
    );
    assert.ok(agents.every((a) => a.desc.es && a.desc.en));
  } finally {
    panel.destroy();
  }
});

test('tradeWorkforcePanel: adapts the real workforce shape (agents array + getActivityLog + getSummary)', () => {
  const real = {
    agents: [
      {
        id: 'supplier-scout',
        name: { es: 'Explorador de proveedores', en: 'Supplier Scout' },
        status: 'working',
        lastAction: { es: 'Validó 3 RFQs', en: 'Validated 3 RFQs' },
      },
      {
        id: 'rfq-researcher',
        name: { es: 'Investigador RFQ', en: 'RFQ Researcher' },
        status: 'idle',
        lastAction: null,
      },
      {
        id: 'logistics-analyst',
        name: { es: 'Analista de logística', en: 'Logistics Analyst' },
        status: 'paused',
        lastAction: null,
      },
      {
        id: 'deal-coordinator',
        name: { es: 'Coordinador de trato', en: 'Deal Coordinator' },
        status: 'idle',
        lastAction: null,
      },
    ],
    running: true, // getter-style boolean, not a function
    onActivity: () => () => {},
    getActivityLog: () => [
      {
        t: 3000,
        agent: 'supplier-scout',
        es: 'RFQ validado',
        en: 'RFQ validated',
      },
      {
        t: 1000,
        agent: 'logistics-analyst',
        es: 'Margen listo',
        en: 'Margin ready',
      },
    ],
    getSummary: () => ({ queueDepth: 5 }),
    start() {},
    pause() {},
    resume() {},
  };
  const panel = initTradeWorkforcePanel({ workforce: real });
  panel.open();
  try {
    assert.equal(panel.refs.agentRows.length, 4);
    assert.equal(panel.refs.feedItems.length, 2);
    // Newest first.
    assert.ok(
      panel.refs.feedItems[0].children[0].textContent.includes('validado'),
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

test('tradeWorkforcePanel: toggleRun start/pause calls', () => {
  const wf = fakeWorkforce();
  const panel = initTradeWorkforcePanel({ workforce: wf });
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

test('tradeWorkforcePanel: feed renders newest first and live activity refreshes', () => {
  const wf = fakeWorkforce();
  const panel = initTradeWorkforcePanel({ workforce: wf });
  panel.open();
  try {
    const items = panel.refs.feedItems;
    assert.equal(items.length, 2);
    const firstText = items[0].children[0].textContent;
    assert.ok(
      firstText.includes('margen'),
      `newest entry first, got: ${firstText}`,
    );
    // Live update: new activity arrives, panel refreshes via onActivity.
    wf.state.feed.push({
      ts: 3000,
      agentId: 'supplier-scout',
      es: 'Nuevo RFQ',
      en: 'New RFQ',
    });
    wf.emit();
    assert.equal(panel.refs.feedItems.length, 3);
    assert.ok(
      panel.refs.feedItems[0].children[0].textContent.includes('Nuevo RFQ'),
      'live entry on top',
    );
    assert.equal(panel.getFeed()[0].ts, 3000, 'getFeed newest-first');
  } finally {
    panel.destroy();
  }
});

test('tradeWorkforcePanel: queue depth via double shape', () => {
  const wf = fakeWorkforce();
  const panel = initTradeWorkforcePanel({ workforce: wf });
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

test('tradeWorkforcePanel: no workforce → honest idle roster', () => {
  const panel = initTradeWorkforcePanel({});
  panel.open();
  assert.equal(panel.refs.agentRows.length, 4);
  assert.ok(
    panel.refs.agentRows.every((r) => r.children[0].className.includes('idle')),
  );
  assert.ok(panel.getQueueDepth() === 0);
  panel.setLang('en');
  panel.destroy();
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
    { id: 'supplier-scout', status: 'working', lastAction: 'x' },
    { id: 'ghost', status: 'working' },
    { id: 'logistics-analyst', status: 'dancing' },
  ]);
  assert.equal(agents.length, AGENT_DEFS.length);
  assert.equal(agents[0].status, 'working');
  assert.equal(agents[2].status, 'idle');
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

test('tradeWorkforcePanel: window handle + open/close/toggle/destroy', () => {
  const panel = initTradeWorkforcePanel({});
  assert.equal(globalThis.__gevTradeWorkforceUI, panel);
  panel.toggle();
  assert.ok(panel.refs.roster, 'toggle opens');
  panel.toggle();
  assert.equal(panel.refs.roster, null, 'toggle closes');
  panel.open();
  panel.destroy();
  assert.equal(panel.refs.roster, null, 'destroy clears refs');
});
