// UI test for the Cuba desk workforce panel: cubaWorkforcePanel.js.
// The module under test is imported BEFORE the DOM double is installed.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_DEFS,
  WORKFORCE_NOTE,
  statusLabel,
  tierLabel,
  normalizeAgents,
  sortFeedNewest,
  adaptWorkforce,
  initCubaWorkforcePanel,
  CUBA_WORKFORCE_PANEL_CSS,
} from './cubaWorkforcePanel.js';

let realDocument;
let realWindow;
let realHTMLElement;

function makeEl(tag) {
  const el = {
    tag,
    id: '',
    className: '',
    style: {},
    dataset: {},
    children: [],
    textContent: '',
    _html: '',
    parent: null,
    _listeners: {},
    appendChild(child) {
      child.parent = el;
      el.children.push(child);
      return child;
    },
    remove() {
      if (el.parent) {
        const i = el.parent.children.indexOf(el);
        if (i >= 0) el.parent.children.splice(i, 1);
        el.parent = null;
      }
    },
    addEventListener(type, fn) {
      el._listeners[type] = el._listeners[type] || [];
      el._listeners[type].push(fn);
    },
    removeEventListener() {},
    setAttribute() {},
    getAttribute() {
      return null;
    },
    querySelector(sel) {
      const q = sel.startsWith('#') ? sel.slice(1) : sel;
      return flatten(el).find(
        (e) => e.id === q || hasClass(e, q) || e.tag === sel,
      ) || null;
    },
    querySelectorAll(sel) {
      const q = sel.startsWith('#') ? sel.slice(1) : sel;
      return flatten(el).filter(
        (e) => e.id === q || hasClass(e, q) || e.tag === sel,
      );
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

function hasClass(el, q) {
  return String(el.className || '')
    .split(' ')
    .includes(q.replace(/^\./, ''));
}

function flatten(el) {
  const out = [el];
  for (const c of el.children) out.push(...flatten(c));
  return out;
}

function installDomDouble() {
  realDocument = globalThis.document;
  realWindow = globalThis.window;
  realHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = class {};
  const body = makeEl('body');
  const head = makeEl('head');
  globalThis.document = {
    createElement: (t) => makeEl(t),
    body,
    head,
    getElementById: (id) => flatten(body).find((e) => e.id === id) || null,
  };
  globalThis.window = {};
}

function removeDomDouble() {
  globalThis.document = realDocument;
  globalThis.window = realWindow;
  globalThis.HTMLElement = realHTMLElement;
}

beforeEach(() => {
  installDomDouble();
});

afterEach(() => {
  removeDomDouble();
});

test('AGENT_DEFS: 6 agents, bilingual names/descs, read/draft/propose tiers', () => {
  assert.equal(AGENT_DEFS.length, 6);
  for (const a of AGENT_DEFS) {
    assert.ok(a.name.es.length > 0 && a.name.en.length > 0);
    assert.ok(a.desc.es.length > 0 && a.desc.en.length > 0);
    assert.ok(['read', 'draft', 'propose'].includes(a.tier));
  }
  assert.ok(!AGENT_DEFS.some((a) => a.tier === 'execute'));
});

test('statusLabel / tierLabel: bilingual', () => {
  assert.equal(statusLabel('working', 'es'), 'Trabajando');
  assert.equal(statusLabel('paused', 'en'), 'Paused');
  assert.equal(statusLabel('bogus', 'es'), 'Inactivo');
  assert.equal(tierLabel('draft', 'es'), 'BORRADOR');
  assert.equal(tierLabel('propose', 'en'), 'PROPOSE');
  assert.equal(tierLabel('read', 'es'), 'LECTURA');
});

test('normalizeAgents: canonical roster, statuses validated', () => {
  const rows = normalizeAgents([
    { id: 'outreach-drafting', status: 'working' },
    { id: 'compliance', status: 'flying' },
  ]);
  assert.equal(rows.length, 6);
  assert.equal(rows.find((r) => r.id === 'outreach-drafting').status, 'working');
  assert.equal(rows.find((r) => r.id === 'compliance').status, 'idle');
});

test('sortFeedNewest: newest first', () => {
  const sorted = sortFeedNewest([
    { ts: 1, es: 'a' },
    { ts: 3, es: 'c' },
    { ts: 2, es: 'b' },
  ]);
  assert.deepEqual(sorted.map((e) => e.ts), [3, 2, 1]);
});

test('adaptWorkforce: real-handle shape normalized', () => {
  const wf = adaptWorkforce({
    agents: [
      { id: 'oversight', status: 'paused', tier: 'read' },
    ],
    running: true,
    getActivityLog: () => [{ t: 5, agent: 'oversight', es: 'hola', en: 'hi' }],
    getSummary: () => ({ queueDepth: 3, pendingProposals: 1 }),
  });
  const agents = wf.agents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].status, 'paused');
  assert.equal(wf.running(), true);
  assert.equal(wf.feed()[0].es, 'hola');
  assert.equal(wf.queueDepth(), 3);
});

test('adaptWorkforce: minimal double shape works', () => {
  const wf = adaptWorkforce({
    agents: () => [{ id: 'compliance', status: 'idle', tier: 'read' }],
    feed: () => [],
    queueDepth: () => 0,
    running: () => false,
    start() {},
    pause() {},
    resume() {},
  });
  assert.equal(wf.agents()[0].id, 'compliance');
  assert.equal(wf.running(), false);
});

test('adaptWorkforce: no workforce → canonical 6-agent idle roster', () => {
  const wf = adaptWorkforce(null);
  const agents = wf.agents();
  assert.equal(agents.length, 6);
  assert.ok(agents.every((a) => a.status === 'idle'));
  assert.equal(wf.queueDepth(), 0);
  assert.deepEqual(wf.feed(), []);
});

test('CUBA_WORKFORCE_PANEL_CSS: 44px touch targets', () => {
  assert.ok(/min-height:\s*44px/.test(CUBA_WORKFORCE_PANEL_CSS));
});

test('initCubaWorkforcePanel: opens panel with roster, feed, note', () => {
  const api = initCubaWorkforcePanel({ workforce: null });
  assert.ok(api);
  const panel = api.open();
  assert.ok(panel);
  assert.equal(panel.id, 'gev-cuba-workforce-panel');
  api.refresh();
  const agents = api.getAgents();
  assert.equal(agents.length, 6);
  assert.equal(api.getQueueDepth(), 0);
  // The honesty note is part of the panel copy contract.
  assert.ok(WORKFORCE_NOTE.es.includes('mientras la app está abierta'));
  api.close();
  api.destroy();
});

test('initCubaWorkforcePanel: lang toggle ES/EN', () => {
  const api = initCubaWorkforcePanel({ workforce: null });
  api.open();
  assert.equal(api.getLang(), 'es');
  api.setLang('en');
  assert.equal(api.getLang(), 'en');
  api.destroy();
});

test('initCubaWorkforcePanel: start/pause toggles through the workforce', () => {
  let started = 0;
  let paused = 0;
  const api = initCubaWorkforcePanel({
    workforce: {
      agents: [],
      running: false,
      start: () => {
        started += 1;
      },
      pause: () => {
        paused += 1;
      },
      resume: () => {},
    },
  });
  api.open();
  api.toggleRun();
  assert.equal(started, 1);
  api.destroy();
});
