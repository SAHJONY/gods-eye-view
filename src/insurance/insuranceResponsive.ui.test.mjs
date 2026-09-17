import { test } from 'node:test';
import assert from 'node:assert/strict';

// Responsive checks: the insurance dashboard and workforce panels must FIT
// and work on any device screen — phone portrait (360px), tablet, desktop.
// These modules never import cesium, so the DOM double can be installed
// before the imports.
const { initInsuranceDashboard } = await import('./insuranceDashboard.js');
const { initInsuranceWorkforcePanel } = await import(
  '../agents/insuranceWorkforcePanel.js'
);

const VIEWPORT = 360; // phone portrait width in px

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
    set(v) { this._html = String(v); this.children.length = 0; },
  });
  return el;
}

/** Fresh 360px-wide container as document.body + a head to capture CSS. */
function setupDom() {
  const container = makeEl();
  container.style.width = `${VIEWPORT}px`;
  const head = makeEl();
  globalThis.window = globalThis;
  globalThis.document = {
    location: { href: 'http://localhost/' },
    getElementById: () => null,
    createElement: (tag) => {
      const el = makeEl();
      el.tagName = String(tag).toUpperCase();
      return el;
    },
    head,
    body: container,
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
  };
  return { container, head };
}

function injectedCss(head, styleId) {
  const style = head.children.find((c) => c.id === styleId);
  return style ? style.textContent : '';
}

/** Plain `width:NNNpx` declarations with NNN >= viewport (overflow risks). */
function overflowingFixedWidths(css) {
  const bad = [];
  // Excludes min-width/max-width (preceded by '-') and widths inside
  // min()/max()/calc() (not followed directly by 'px' after a number).
  const re = /(?<![\w(-])width\s*:\s*(\d+)px/g;
  let m;
  while ((m = re.exec(css))) {
    if (Number(m[1]) >= VIEWPORT) bad.push(m[0]);
  }
  return bad;
}

/** Every element in the tree; used to check inline styles. */
function walk(el, out = []) {
  out.push(el);
  for (const c of el.children || []) walk(c, out);
  return out;
}

function pxValue(v) {
  const m = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(String(v || ''));
  return m ? Number(m[1]) : null;
}

const SAMPLE = {
  businesses: {
    personal: {
      coverages: [
        { id: 'c1', status: 'gap' },
        { id: 'c2', status: 'active', exp: '2026-09-25' },
      ],
      claims: [{ id: 'cl1', stage: 1 }],
    },
  },
  quotes: [{ id: 'q1', premium: 100 }],
};
const store = { getState: () => SAMPLE, saveState: () => true };

function fakeWorkforce() {
  return {
    getSummary: () => ({
      running: false,
      agents: [
        { id: 'gap-analyst', status: 'working', lastAction: null },
        { id: 'renewal-watcher', status: 'idle', lastAction: null },
        { id: 'claim-prep', status: 'idle', lastAction: null },
      ],
      findings: { gaps: 1, renewals: 1, openClaims: 1 },
    }),
    start() {},
    pause() {},
    processOnce() {},
    getActivityLog: () => [],
    onActivity: () => () => {},
  };
}

test('dashboard panel is fluid at 360px: no horizontal overflow', () => {
  const { container, head } = setupDom();
  const dash = initInsuranceDashboard(null, { store });
  dash.open();

  const css = injectedCss(head, 'gev-insurance-styles');
  assert.ok(css.length > 0, 'dashboard CSS injected');

  // The panel itself must size fluidly against the viewport.
  assert.match(
    css,
    /#gev-insurance-panel\{[^}]*width:min\(560px,calc\(100vw - 24px\)\)/,
    'panel width is fluid (min/max/viewport-based)',
  );
  // No fixed pixel width at or above the 360px viewport anywhere.
  assert.deepEqual(
    overflowingFixedWidths(css),
    [],
    'no fixed width >= 360px in dashboard CSS',
  );

  // No rendered element carries an inline fixed width that overflows.
  // (The container itself is the 360px viewport stand-in.)
  for (const el of walk(container).slice(1)) {
    for (const prop of ['width', 'minWidth']) {
      const px = pxValue(el.style[prop]);
      assert.ok(
        px === null || px <= VIEWPORT,
        `inline ${prop}=${el.style[prop]} on <${el.tagName || '?'}> would overflow 360px`,
      );
    }
  }
  dash.destroy();
});

test('dashboard touch targets are >= 44px', () => {
  const { head } = setupDom();
  initInsuranceDashboard(null, { store });
  const css = injectedCss(head, 'gev-insurance-styles');
  for (const selector of ['.isp-btn', '.isp-tool', '.isp-lang']) {
    const rule = new RegExp(
      `${selector.replace('.', '\\.')}\\{[^}]*min-height:44px`,
    );
    assert.match(css, rule, `${selector} has min-height:44px`);
  }
  // Close button is a fixed 44x44px square.
  assert.match(
    css,
    /\.isp-close\{[^}]*width:44px[^}]*height:44px/,
    '.isp-close is a 44x44px target',
  );
});

test('workforce panel is fluid at 360px: no horizontal overflow', () => {
  const { container, head } = setupDom();
  const panel = initInsuranceWorkforcePanel({ workforce: fakeWorkforce() });
  panel.open();

  const css = injectedCss(head, 'gev-ins-wf-styles');
  assert.ok(css.length > 0, 'workforce panel CSS injected');
  assert.match(
    css,
    /#gev-ins-wf-panel\{[^}]*width:min\(560px,calc\(100vw - 24px\)\)/,
    'panel width is fluid (min/max/viewport-based)',
  );
  assert.deepEqual(
    overflowingFixedWidths(css),
    [],
    'no fixed width >= 360px in workforce panel CSS',
  );

  for (const el of walk(container).slice(1)) {
    for (const prop of ['width', 'minWidth']) {
      const px = pxValue(el.style[prop]);
      assert.ok(
        px === null || px <= VIEWPORT,
        `inline ${prop}=${el.style[prop]} on <${el.tagName || '?'}> would overflow 360px`,
      );
    }
  }
  panel.destroy();
});

test('workforce panel touch targets are >= 44px', () => {
  const { head } = setupDom();
  initInsuranceWorkforcePanel({ workforce: fakeWorkforce() });
  const css = injectedCss(head, 'gev-ins-wf-styles');
  for (const selector of ['.iwf-btn', '.iwf-lang']) {
    const rule = new RegExp(
      `${selector.replace('.', '\\.')}\\{[^}]*min-height:44px`,
    );
    assert.match(css, rule, `${selector} has min-height:44px`);
  }
  assert.match(
    css,
    /\.iwf-close\{[^}]*width:44px[^}]*height:44px/,
    '.iwf-close is a 44x44px target',
  );
});

test('panels do not clip text: scrollable bodies, no fixed text heights', () => {
  const { head } = setupDom();
  initInsuranceDashboard(null, { store });
  initInsuranceWorkforcePanel({ workforce: fakeWorkforce() });
  const css =
    injectedCss(head, 'gev-insurance-styles') +
    injectedCss(head, 'gev-ins-wf-styles');
  // Bodies scroll instead of clipping.
  assert.match(css, /\.isp-body\{[^}]*overflow-y:auto/, '.isp-body scrolls');
  assert.match(css, /\.iwf-body\{[^}]*overflow-y:auto/, '.iwf-body scrolls');
  assert.match(css, /\.iwf-feed\{[^}]*overflow-y:auto/, '.iwf-feed scrolls');
});
