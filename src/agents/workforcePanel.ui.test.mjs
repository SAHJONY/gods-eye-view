import { test } from 'node:test';
import assert from 'node:assert/strict';

// This module never imports cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initWorkforcePanel,
  AGENT_DEFS,
  WORKFORCE_NOTE,
  statusLabel,
  normalizeAgents,
  sortFeedNewest,
} = await import('./workforcePanel.js');

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
    appendChild(c) { this.children.push(c); return c; },
    remove() { this.removed = true; },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener(type, fn) { this._handlers[type] = fn; },
    removeEventListener() {},
    click() { if (typeof this._handlers.click === 'function') this._handlers.click(); },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
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
  const state = {
    running: false,
    paused: false,
    queue: 3,
    agents: [
      { id: 'scout', status: 'idle', lastAction: 'Scored 12 leads' },
      { id: 'analyst', status: 'idle', lastAction: null },
      { id: 'followup', status: 'idle', lastAction: null },
      { id: 'contracts', status: 'idle', lastAction: null },
    ],
    feed: [
      { ts: 1000, agentId: 'scout', es: 'Puntuó 12 leads', en: 'Scored 12 leads' },
      { ts: 2000, agentId: 'analyzer', es: 'Calculó MAO', en: 'Computed MAO' },
    ],
    calls: [],
  };
  return {
    state,
    agents: () => state.agents,
    feed: () => state.feed,
    queueDepth: () => state.queue,
    running: () => state.running,
    start: () => { state.calls.push('start'); state.running = true; },
    pause: () => { state.calls.push('pause'); state.running = false; state.paused = true; },
    resume: () => { state.calls.push('resume'); state.running = true; state.paused = false; },
  };
}

test('workforcePanel: shows 4 agents with descriptions', () => {
  assert.ok(AGENT_DEFS.length >= 4, 'agent definitions cover the roster');
  const wf = fakeWorkforce();
  const panel = initWorkforcePanel({ workforce: wf });
  panel.open();
  try {
    assert.equal(panel.refs.agentRows.length, 4);
    for (const def of AGENT_DEFS) {
      assert.ok(def.desc.es && def.desc.en, `agent ${def.id} has ES/EN description`);
    }
  } finally {
    panel.destroy();
  }
});

test('workforcePanel: adapts the real workforce shape (agents array + getActivityLog)', () => {
  const real = {
    agents: [
      { id: 'scout', name: { es: 'Explorador', en: 'Scout' }, status: 'working', lastAction: { es: 'Validó 3 leads', en: 'Validated 3 leads' } },
      { id: 'researcher', name: { es: 'Investigador', en: 'Researcher' }, status: 'idle', lastAction: null },
      { id: 'analyst', name: { es: 'Analista', en: 'Analyst' }, status: 'paused', lastAction: null },
      { id: 'dispositions', name: { es: 'Disposiciones', en: 'Dispositions' }, status: 'idle', lastAction: null },
    ],
    running: true, // getter-style boolean, not a function
    getActivityLog: () => [
      { t: 3000, agent: 'scout', es: 'Lead validado', en: 'Lead validated' },
      { t: 1000, agent: 'analyst', es: 'MAO listo', en: 'MAO ready' },
    ],
    start() {}, pause() {}, resume() {},
  };
  const panel = initWorkforcePanel({ workforce: real });
  panel.open();
  try {
    assert.equal(panel.refs.agentRows.length, 4);
    assert.equal(panel.refs.feedItems.length, 2);
    // Newest first.
    assert.ok(panel.refs.feedItems[0].children[0].textContent.includes('validado'));
    // Running getter → button offers pause.
    assert.ok(panel.refs.toggleBtn.textContent.includes('Pausar'));
    // Agent descriptions present for the real roles.
    const agents = panel.getAgents();
    assert.ok(agents.every((a) => a.desc.es && a.desc.en));
  } finally {
    panel.destroy();
  }
});

test('workforcePanel: pause toggles running state', () => {
  const wf = fakeWorkforce();
  const panel = initWorkforcePanel({ workforce: wf });
  panel.open();
  try {
    assert.ok(panel.refs.toggleBtn.textContent.includes('Iniciar'), 'starts in ES start state');
    panel.refs.toggleBtn.click(); // start
    assert.deepEqual(wf.state.calls, ['start']);
    assert.equal(wf.state.running, true);
    assert.ok(panel.refs.toggleBtn.textContent.includes('Pausar'), 'button now offers pause');
    panel.refs.toggleBtn.click(); // pause
    assert.deepEqual(wf.state.calls, ['start', 'pause']);
    assert.equal(wf.state.running, false);
  } finally {
    panel.destroy();
  }
});

test('workforcePanel: feed renders newest first', () => {
  const wf = fakeWorkforce();
  const panel = initWorkforcePanel({ workforce: wf });
  panel.open();
  try {
    const items = panel.refs.feedItems;
    assert.equal(items.length, 2);
    // Newest first: ts 2000 entry before ts 1000.
    const firstText = items[0].children[0].textContent;
    assert.ok(firstText.includes('MAO'), `newest entry first, got: ${firstText}`);
  } finally {
    panel.destroy();
  }
});

test('workforcePanel: queue depth rendered', () => {
  const wf = fakeWorkforce();
  const panel = initWorkforcePanel({ workforce: wf });
  panel.open();
  try {
    assert.ok(panel.refs.queueEl.textContent.includes('3'), 'queue depth 3 shown');
    assert.equal(panel.getQueueDepth(), 3);
  } finally {
    panel.destroy();
  }
});

test('workforcePanel: honest note present in both languages', () => {
  assert.ok(WORKFORCE_NOTE.es.includes('no gastan dinero'));
  assert.ok(WORKFORCE_NOTE.en.includes('spend no money'));
  const panel = initWorkforcePanel({});
  panel.open(); // no workforce double: stays honest, all idle
  assert.equal(panel.refs.agentRows.length, 4);
  assert.ok(panel.refs.agentRows.every((r) => r.children[0].className.includes('idle')));
  panel.setLang('en');
  panel.destroy();
});

test('statusLabel: bilingual statuses', () => {
  assert.equal(statusLabel('working', 'es'), 'Trabajando');
  assert.equal(statusLabel('working', 'en'), 'Working');
  assert.equal(statusLabel('paused', 'es'), 'Pausado');
  assert.equal(statusLabel('idle', 'en'), 'Idle');
});

test('normalizeAgents: unknown ids ignored, bad status -> idle', () => {
  const agents = normalizeAgents([
    { id: 'scout', status: 'working', lastAction: 'x' },
    { id: 'ghost', status: 'working' },
    { id: 'analyst', status: 'dancing' },
  ]);
  assert.equal(agents.length, AGENT_DEFS.length);
  assert.equal(agents[0].status, 'working');
  assert.equal(agents[1].status, 'idle');
  assert.ok(agents.every((a) => AGENT_DEFS.some((d) => d.id === a.id)));
});

test('sortFeedNewest: newest first, null-safe', () => {
  const sorted = sortFeedNewest([
    { ts: 5, es: 'a' },
    { ts: 50, es: 'b' },
    { ts: 10, es: 'c' },
  ]);
  assert.deepEqual(sorted.map((e) => e.ts), [50, 10, 5]);
  assert.deepEqual(sortFeedNewest(null), []);
});

test('window.__gevWorkforceUI is exposed', () => {
  const panel = initWorkforcePanel({});
  assert.equal(globalThis.__gevWorkforceUI, panel);
  panel.destroy();
});
