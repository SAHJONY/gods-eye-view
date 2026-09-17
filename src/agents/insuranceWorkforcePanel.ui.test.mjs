import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  initInsuranceWorkforcePanel,
  insStatusLabel,
  normalizeInsuranceAgents,
  sortInsuranceFeedNewest,
  formatInsuranceFeedEntry,
  INSURANCE_AGENT_DEFS,
} = await import('./insuranceWorkforcePanel.js');

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
    // Like a real DOM node, replacing innerHTML drops existing children.
    set(v) { this._html = String(v); this.children.length = 0; },
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

function makeWorkforce() {
  const calls = [];
  return {
    calls,
    getSummary: () => ({
      running: false,
      agents: [
        { id: 'gap-analyst', status: 'working', lastAction: null },
        { id: 'renewal-watcher', status: 'idle', lastAction: null },
        { id: 'claim-prep', status: 'paused', lastAction: null },
      ],
      findings: { gaps: 2, renewals: 1, openClaims: 0 },
    }),
    start: () => calls.push('start'),
    pause: () => calls.push('pause'),
    processOnce: () => calls.push('processOnce'),
    getActivityLog: () => [
      { t: 100, agent: 'gap-analyst', es: 'memo uno', en: 'memo one' },
      { t: 200, agent: 'renewal-watcher', es: 'memo dos', en: 'memo two' },
    ],
    onActivity: () => () => {},
  };
}

test('roster covers the 3 insurance roles', () => {
  assert.equal(INSURANCE_AGENT_DEFS.length, 3);
  assert.deepEqual(
    INSURANCE_AGENT_DEFS.map((d) => d.id),
    ['gap-analyst', 'renewal-watcher', 'claim-prep'],
  );
});

test('insStatusLabel is bilingual', () => {
  assert.equal(insStatusLabel('working', 'es'), 'Trabajando');
  assert.equal(insStatusLabel('paused', 'en'), 'Paused');
  assert.equal(insStatusLabel('idle', 'es'), 'Inactivo');
});

test('normalizeInsuranceAgents sanitizes statuses', () => {
  const agents = normalizeInsuranceAgents([{ id: 'gap-analyst', status: 'bogus' }]);
  assert.equal(agents.length, 3);
  assert.equal(agents[0].status, 'idle');
});

test('sortInsuranceFeedNewest and formatInsuranceFeedEntry', () => {
  const entries = [
    { t: 1, agent: 'gap-analyst', es: 'uno', en: 'one' },
    { t: 5, agent: 'gap-analyst', es: 'cinco', en: 'five' },
  ];
  assert.deepEqual(sortInsuranceFeedNewest(entries).map((e) => e.t), [5, 1]);
  assert.match(formatInsuranceFeedEntry(entries[0], 'es'), /uno/);
  assert.match(formatInsuranceFeedEntry(entries[0], 'en'), /one/);
});

test('panel opens with roster, findings, feed and run buttons', () => {
  bodyEl.children.length = 0;
  const wf = makeWorkforce();
  const panel = initInsuranceWorkforcePanel({ workforce: wf });
  panel.open();
  const el = bodyEl.children.find((c) => c.id === 'gev-ins-wf-panel');
  assert.ok(el, 'panel mounted');
  const body = el.children[1];
  const roster = body.children[0];
  assert.equal(roster.children.length, 3, 'three agent rows');
  const findings = body.children[1];
  assert.equal(findings.children.length, 3, 'three finding chips');
  const controls = body.children[2];
  assert.equal(controls.children.length, 3, 'start/pause/run-once buttons');
  controls.children[0].click(); // Start
  controls.children[1].click(); // Pause
  controls.children[2].click(); // Run once
  assert.deepEqual(wf.calls, ['start', 'pause', 'processOnce']);
  const feed = body.children[3];
  assert.equal(feed.children.length, 2, 'two feed entries');
  // newest first: t=200 before t=100
  assert.match(feed.children[0].textContent, /memo dos/);
  panel.destroy();
  assert.ok(el.removed, 'panel removed on destroy');
});

test('setLang switches ES/EN', () => {
  const panel = initInsuranceWorkforcePanel({ workforce: makeWorkforce() });
  assert.equal(panel.getLang(), 'es');
  assert.equal(panel.setLang('en'), 'en');
  panel.destroy();
});
