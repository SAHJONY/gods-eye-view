import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  initEnergyWorkforcePanel,
  AGENT_DEFS,
  WORKFORCE_NOTE,
  statusLabel,
  tierLabel,
  normalizeAgents,
  sortFeedNewest,
  isHardStopEvent,
  adaptWorkforce,
} = await import('./energyWorkforcePanel.js');

function makeEl() {
  const el = {
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    _html: '',
    textContent: '',
    value: '',
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

const bodyEl = makeEl();

globalThis.window = globalThis;
globalThis.document = {
  location: { href: 'http://localhost/' },
  getElementById: () => null,
  createElement: () => makeEl(),
  head: makeEl(),
  body: bodyEl,
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
};

function makeWorkforceDouble() {
  return {
    agents: [
      { id: 'spec-analyst', status: 'idle', tier: 'read', lastAction: null },
      { id: 'gate-keeper', status: 'working', tier: 'read', lastAction: { es: 'vigilando', en: 'watching' } },
      { id: 'economics-memo', status: 'idle', tier: 'read', lastAction: null },
      { id: 'logistics-checker', status: 'idle', tier: 'read', lastAction: null },
      { id: 'outreach-drafter', status: 'paused', tier: 'draft', lastAction: null },
    ],
    running: false,
    _feed: [],
    _esc: [],
    onActivity() { return () => {}; },
    getActivityLog: () => [],
    getEscalations() { return this._esc; },
    getSummary: () => ({ queueDepth: 2 }),
    start() { this.running = true; },
    pause() { this.running = false; },
    resume() { this.running = true; },
  };
}

test('AGENT_DEFS: 5 energy agents, bilingual, gate-keeper present', () => {
  assert.equal(AGENT_DEFS.length, 5);
  const ids = AGENT_DEFS.map((a) => a.id);
  assert.ok(ids.includes('gate-keeper'), 'gate-keeper on the roster');
  for (const a of AGENT_DEFS) {
    assert.ok(a.name.es && a.name.en && a.desc.es && a.desc.en, a.id);
  }
  assert.ok(WORKFORCE_NOTE.es && WORKFORCE_NOTE.en);
});

test('statusLabel / tierLabel: bilingual', () => {
  assert.equal(statusLabel('working', 'es'), 'Trabajando');
  assert.equal(statusLabel('paused', 'en'), 'Paused');
  assert.equal(statusLabel('bogus', 'es'), 'Inactivo');
  assert.equal(tierLabel('draft', 'es'), 'Borrador');
  assert.equal(tierLabel('draft', 'en'), 'Draft');
  assert.equal(tierLabel('read', 'es'), 'Lectura');
});

test('normalizeAgents: roster-normalized with valid statuses and tiers', () => {
  const raw = [
    { id: 'gate-keeper', status: 'working', tier: 'draft' },
    { id: 'nope', status: 'flying', tier: 'execute' },
  ];
  const out = normalizeAgents(raw);
  assert.equal(out.length, 5);
  const gk = out.find((a) => a.id === 'gate-keeper');
  assert.equal(gk.status, 'working');
  const spec = out.find((a) => a.id === 'spec-analyst');
  assert.equal(spec.status, 'idle');
  assert.equal(spec.tier, 'read');
  assert.ok(!out.some((a) => a.id === 'nope'), 'unknown agents dropped');
});

test('isHardStopEvent: pins sanctions hard-stop events', () => {
  assert.equal(isHardStopEvent({ kind: 'hard-stop', es: 'x', t: 1 }), true);
  assert.equal(isHardStopEvent({ agent: 'gate-keeper', es: '⛔ escalado', t: 1 }), true);
  assert.equal(isHardStopEvent({ agent: 'spec-analyst', es: 'nota', t: 1 }), false);
  assert.equal(isHardStopEvent({}), false);
});

test('sortFeedNewest: hard-stop events pin above newest-first rest', () => {
  const feed = [
    { t: 300, agent: 'spec-analyst', es: 'nota 3' },
    { t: 100, kind: 'hard-stop', agent: 'gate-keeper', es: '⛔ hard stop' },
    { t: 200, agent: 'economics-memo', es: 'nota 2' },
  ];
  const sorted = sortFeedNewest(feed);
  assert.equal(sorted[0].kind, 'hard-stop', 'hard stop pinned first');
  assert.equal(sorted[1].t, 300, 'rest newest first');
  assert.equal(sorted[2].t, 200);
});

test('adaptWorkforce: normalizes a workforce double', () => {
  const w = adaptWorkforce(makeWorkforceDouble());
  const agents = w.agents();
  assert.equal(agents.length, 5);
  assert.equal(agents.find((a) => a.id === 'gate-keeper').status, 'working');
  assert.equal(w.queueDepth(), 2);
  assert.equal(w.running(), false);
  assert.deepEqual(w.feed(), []);
  w.start();
  assert.equal(w.running(), true);
});

test('open/close/toggle/destroy lifecycle with DOM double', () => {
  const panel = initEnergyWorkforcePanel({ workforce: makeWorkforceDouble() });
  assert.equal(panel._rendered(), false);
  assert.equal(panel.open(), true);
  assert.equal(panel._rendered(), true);
  panel.toggle();
  assert.equal(panel._rendered(), false);
  panel.toggle();
  assert.equal(panel._rendered(), true);
  panel.destroy();
  assert.equal(panel._rendered(), false);
});

test('setLang switches ES/EN', () => {
  const panel = initEnergyWorkforcePanel({ workforce: makeWorkforceDouble() });
  assert.equal(panel.getLang(), 'es');
  panel.setLang('en');
  assert.equal(panel.getLang(), 'en');
  panel.destroy();
});
