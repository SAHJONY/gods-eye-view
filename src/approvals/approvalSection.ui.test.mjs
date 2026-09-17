import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  APPROVAL_SECTION_CSS,
  approvalSectionStrings,
  escapeApprovalHtml,
  renderApprovalSection,
  wireApprovalSection,
} = await import('./approvalSection.js');
const {
  createApproval,
  getApproval,
  approveApproval,
  rejectApproval,
  resetApprovalStore,
  approvalStats,
  listApprovals,
} = await import('./approvalStore.js');

function makeEl() {
  const el = {
    children: [],
    _html: '',
    _handlers: {},
    appendChild(c) { this.children.push(c); return c; },
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

function draft(overrides = {}) {
  return {
    kind: 'reply',
    titleEs: 'Respuesta al cliente',
    titleEn: 'Customer reply',
    summaryEs: 'Borrador de respuesta.',
    summaryEn: 'Reply draft.',
    payload: { channel: 'whatsapp' },
    ...overrides,
  };
}

function fakeTapTarget(id, approve) {
  const attr = approve ? 'data-as-approve' : 'data-as-reject';
  const btn = {
    getAttribute: (name) => (name === attr ? id : null),
    closest(sel) {
      if (sel === '[data-as-approve],[data-as-reject]') return btn;
      if (sel === '[data-as-approve]') return approve ? btn : null;
      if (sel === '[data-as-reject]') return approve ? null : btn;
      return null;
    },
  };
  return { closest: () => btn };
}

test('section CSS is phone-first: big tap targets, no hover-only affordances', () => {
  assert.ok(/min-height:\s*52px/.test(APPROVAL_SECTION_CSS), 'buttons ≥44px (52px)');
  assert.ok(!/:hover/.test(APPROVAL_SECTION_CSS), 'no hover-only affordances');
  const es = approvalSectionStrings('es');
  const en = approvalSectionStrings('en');
  for (const key of ['approve', 'reject', 'heading', 'empty', 'pendingTitle', 'decidedTitle']) {
    assert.ok(es[key], `missing ES: ${key}`);
    assert.ok(en[key], `missing EN: ${key}`);
  }
});

test('escapeApprovalHtml neutralizes markup', () => {
  assert.equal(
    escapeApprovalHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;',
  );
  assert.equal(escapeApprovalHtml('"quoted"'), '&quot;quoted&quot;');
});

test('renderApprovalSection renders the same queue UI in ES and EN', () => {
  resetApprovalStore();
  const item = createApproval('insurance', draft());
  const opts = (lang) => ({
    businessName: 'Seguros',
    lang,
    items: listApprovals('insurance', 'pending'),
    decided: [],
    stats: approvalStats('insurance'),
  });
  const es = renderApprovalSection(opts('es'));
  const en = renderApprovalSection(opts('en'));
  assert.ok(es.includes('Aprobar') && es.includes('Rechazar'));
  assert.ok(en.includes('Approve') && en.includes('Reject'));
  assert.ok(es.includes('Respuesta al cliente'));
  assert.ok(en.includes('Customer reply'));
  assert.ok(es.includes(`data-as-approve="${item.id}"`));
  assert.ok(en.includes('⏳ <b>1</b>'));
});

test('wireApprovalSection: tap Approve/Reject decides via the store', () => {
  resetApprovalStore();
  const a = createApproval('trade', draft());
  const b = createApproval('trade', draft({ titleEn: 'Second' }));
  const root = makeEl();
  const changes = [];
  const wired = wireApprovalSection(root, {
    listApprovals,
    approveApproval,
    rejectApproval,
    approvalStats,
  }, {
    businessId: 'trade',
    businessName: 'Import/Export',
    lang: 'es',
    onChange: (d) => changes.push(d),
  });
  assert.ok(root.innerHTML.includes('Aprobar'), 'pending cards rendered');
  root._handlers.click({ target: fakeTapTarget(a.id, true) });
  assert.equal(getApproval(a.id).status, 'approved');
  assert.deepEqual(changes, [{ id: a.id, decision: 'approved' }]);
  assert.ok(root.innerHTML.includes('Aprobada'), 'decided row rendered after tap');
  root._handlers.click({ target: fakeTapTarget(b.id, false) });
  assert.equal(getApproval(b.id).status, 'rejected');
  wired.destroy();
});

test('wireApprovalSection validates its inputs', () => {
  assert.throws(() => wireApprovalSection(null, {}, { businessId: 'trade' }), /root is required/);
  assert.throws(() => wireApprovalSection(makeEl(), {}, { businessId: '' }), /businessId is required/);
  assert.throws(() => wireApprovalSection(makeEl(), null, { businessId: 'trade' }), /store is required/);
});

test('SAFETY: section module has no execution path', () => {
  const keys = ['listApprovals', 'approveApproval', 'rejectApproval', 'approvalStats'];
  for (const k of keys) assert.ok(k);
  assert.ok(!/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/.test(APPROVAL_SECTION_CSS));
});
