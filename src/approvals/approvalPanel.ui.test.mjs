import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  mountApprovalPanel,
  renderApprovalPanelHtml,
  openApprovalPanel,
  approvalPanelStrings,
  APPROVAL_PANEL_CSS,
} = await import('./approvalPanel.js');
const {
  createApproval,
  getApproval,
  resetApprovalStore,
} = await import('./approvalStore.js');

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
    removeEventListener(type) { delete this._handlers[type]; },
    contains() { return true; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  return el;
}

function installDocument() {
  const body = makeEl();
  const head = makeEl();
  globalThis.document = {
    getElementById: () => null,
    createElement: () => makeEl(),
    head,
    body,
  };
}

function draft(overrides = {}) {
  return {
    kind: 'post',
    titleEs: 'Publicación',
    titleEn: 'Post',
    summaryEs: 'Resumen',
    summaryEn: 'Summary',
    payload: { channel: 'facebook' },
    ...overrides,
  };
}

/** Fake tap target: a button carrying the decision data attribute. */
function fakeTapTarget(id, approve) {
  const attr = approve ? 'data-approval-approve' : 'data-approval-reject';
  const btn = {
    getAttribute: (name) => (name === attr ? id : null),
    closest(sel) {
      if (sel === '[data-approval-approve],[data-approval-reject]') return btn;
      if (sel === '[data-approval-approve]') return approve ? btn : null;
      if (sel === '[data-approval-reject]') return approve ? null : btn;
      return null;
    },
  };
  return { closest: () => btn };
}

test('tap targets are ≥44px and ES/EN complete', () => {
  assert.ok(
    /min-height:\s*5\dpx/.test(APPROVAL_PANEL_CSS),
    'Approve/Reject buttons must be at least 44px tall (phone rule)',
  );
  const es = approvalPanelStrings('es');
  const en = approvalPanelStrings('en');
  for (const key of ['approve', 'reject', 'title', 'empty', 'pendingSection', 'decidedSection']) {
    assert.ok(es[key], `missing ES string: ${key}`);
    assert.ok(en[key], `missing EN string: ${key}`);
  }
  assert.equal(es.approve, 'Aprobar');
  assert.equal(en.approve, 'Approve');
});

test('renderApprovalPanelHtml renders pending queue and escapes user text', () => {
  resetApprovalStore();
  const item = createApproval('trade', draft({ titleEn: '<script>alert(1)</script>' }));
  const html = renderApprovalPanelHtml('trade', 'en');
  assert.ok(html.includes('data-approval-approve'), 'approve button present');
  assert.ok(html.includes('data-approval-reject'), 'reject button present');
  assert.ok(html.includes('&lt;script&gt;'), 'user text is escaped');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw user text never rendered');
  assert.ok(html.includes(item.id), 'item id carried on buttons');
});

test('mountApprovalPanel: tap Approve decides the item (decision only)', () => {
  resetApprovalStore();
  installDocument();
  const item = createApproval('cubacash', draft({ payload: { send: () => { throw new Error('must not run'); } } }));
  const container = makeEl();
  const decisions = [];
  const panel = mountApprovalPanel(container, {
    businessId: 'cubacash',
    lang: 'en',
    onDecision: (d) => decisions.push(d),
  });
  const host = container.children[0];
  assert.ok(host.innerHTML.includes('Approve'), 'panel rendered with Approve button');
  // Tap the Approve button.
  host._handlers.click({ target: fakeTapTarget(item.id, true) });
  assert.equal(getApproval(item.id).status, 'approved', 'item approved in store');
  assert.deepEqual(decisions, [{ id: item.id, decision: 'approved' }]);
  assert.ok(host.innerHTML.includes('Approved'), 'panel re-rendered with decided state');
  panel.destroy();
  assert.ok(host.removed, 'destroy removes the panel');
});

test('mountApprovalPanel: tap Reject decides the item', () => {
  resetApprovalStore();
  installDocument();
  const item = createApproval('wholesale', draft());
  const container = makeEl();
  const panel = mountApprovalPanel(container, { businessId: 'wholesale', lang: 'es' });
  const host = container.children[0];
  assert.ok(host.innerHTML.includes('Rechazar'), 'ES reject label rendered');
  host._handlers.click({ target: fakeTapTarget(item.id, false) });
  assert.equal(getApproval(item.id).status, 'rejected');
  panel.destroy();
});

test('mountApprovalPanel: setLang re-renders, unknown taps are ignored', () => {
  resetApprovalStore();
  installDocument();
  const container = makeEl();
  const panel = mountApprovalPanel(container, { businessId: 'crude', lang: 'en' });
  const host = container.children[0];
  assert.ok(host.innerHTML.includes('Approvals'));
  panel.setLang('es');
  assert.ok(host.innerHTML.includes('Aprobaciones'));
  // Tap on a button for an unknown id: no crash, no decision.
  host._handlers.click({ target: fakeTapTarget('appr-nope', true) });
  panel.destroy();
});

test('mountApprovalPanel requires a container', () => {
  assert.throws(() => mountApprovalPanel(null), /container is required/);
});

test('openApprovalPanel is a safe no-op outside a browser', () => {
  delete globalThis.document;
  const close = openApprovalPanel('trade');
  assert.equal(typeof close, 'function');
  close(); // must not throw
  const closeAll = openApprovalPanel(null);
  closeAll();
});
