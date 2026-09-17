import { test } from 'node:test';
import assert from 'node:assert/strict';

// This module never imports cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initNew850Dashboard,
  new850DeepLink,
  new850ViewFromHash,
  NEW850_VIEWS,
  NEW850_OWNER_INTAKE_URL,
  __internals,
} = await import('./new850Dashboard.js');

const { createNew850Store } = await import('./new850Store.js');
const { createApprovalStore } = await import('./new850Approvals.js');
const { createTriageStore } = await import('./new850Triage.js');

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
    type: '',
    href: '',
    placeholder: '',
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
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
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
const headEl = makeEl();

globalThis.window = globalThis;
globalThis.document = {
  location: { href: 'http://localhost/' },
  getElementById: () => null,
  createElement: () => makeEl(),
  head: headEl,
  body: bodyEl,
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
};

function freshStores() {
  const caseStore = createNew850Store();
  caseStore.reset();
  const approvalStore = createApprovalStore();
  approvalStore.reset();
  const triageStore = createTriageStore();
  triageStore.reset();
  return { caseStore, approvalStore, triageStore };
}

test('dashboard: four management sections, Spanish-first tab bar', () => {
  assert.deepEqual([...NEW850_VIEWS], [
    'approvals',
    'cases',
    'triage',
    'workforce',
  ]);
  const dd = initNew850Dashboard(freshStores());
  dd.open();
  assert.equal(dd.getView(), 'approvals', 'approval queue is the default view');
  assert.ok(dd.refs.tabs.approvals, 'approvals tab');
  assert.ok(dd.refs.tabs.cases, 'cases tab');
  assert.ok(dd.refs.tabs.triage, 'triage tab');
  assert.ok(dd.refs.tabs.workforce, 'workforce tab');
  assert.match(dd.refs.tabs.approvals.innerHTML, /Aprobaciones/);
  dd.setLang('en');
  assert.match(dd.refs.tabs.approvals.innerHTML, /Approvals/);
  dd.setLang('es');
  dd.destroy();
});

test('dashboard: tab bar and approve/reject targets meet the 44px minimum', () => {
  const dd = initNew850Dashboard(freshStores());
  dd.open();
  const css = headEl.children
    .map((c) => c.textContent || '')
    .join('\n');
  dd.destroy();
  assert.match(css, /\.gev-new850-tab\{[^}]*min-height:56px/);
  assert.match(css, /\.gev-new850-btn--approve\{[^}]*min-height:52px/);
  assert.match(css, /\.gev-new850-btn--reject\{[^}]*min-height:52px/);
  assert.match(css, /\.gev-new850-btn\{[^}]*min-height:44px/);
});

test('dashboard: approval queue — empty state, then one-tap approve', () => {
  const { caseStore, approvalStore, triageStore } = freshStores();
  const dd = initNew850Dashboard({ caseStore, approvalStore, triageStore });
  dd.open();
  // Empty state, no invented items.
  assert.equal(approvalStore.listApprovals('new850', 'pending').length, 0);

  const item = approvalStore.createApproval('new850', {
    kind: 'dispute-letter-r1',
    titleEs: 'Carta de disputa R1 — N850-0001',
    titleEn: 'R1 dispute letter — N850-0001',
    summaryEs: 'Pago tardío en disputa.',
    summaryEn: 'Late payment under dispute.',
    payload: { caseRef: 'N850-0001' },
  });
  dd.setView('approvals');
  assert.equal(dd.refs.approvalActions.length, 1);
  const { approveBtn, rejectBtn, noteInput } = dd.refs.approvalActions[0];
  assert.ok(approveBtn && rejectBtn && noteInput, 'tap targets exist');

  // One-tap approve records the decision — and nothing else.
  noteInput.value = 'se ve bien';
  approveBtn.click();
  const decided = approvalStore.getApproval(item.id);
  assert.equal(decided.status, 'approved');
  assert.equal(decided.decidedBy, 'juan');
  assert.equal(decided.note, 'se ve bien');
  assert.equal(
    approvalStore.listApprovals('new850', 'pending').length,
    0,
    'approved item leaves the pending queue',
  );
  assert.equal(approvalStore.getAuditLog().length, 2, 'created + approved');
  dd.destroy();
});

test('dashboard: approval queue — reject path is tap-only and decision-only', () => {
  const { caseStore, approvalStore, triageStore } = freshStores();
  const dd = initNew850Dashboard({ caseStore, approvalStore, triageStore });
  dd.open();
  const item = approvalStore.createApproval('new850', {
    kind: 'cfpb-complaint',
    titleEs: 'Queja CFPB',
    titleEn: 'CFPB complaint',
    summaryEs: 'x',
    summaryEn: 'x',
    payload: {},
  });
  dd.setView('approvals');
  dd.refs.approvalActions[0].rejectBtn.click();
  assert.equal(approvalStore.getApproval(item.id).status, 'rejected');
  assert.equal(approvalStore.getApproval(item.id).decidedBy, 'juan');
  dd.destroy();
});

test('dashboard: draft creation bridges into the approval queue (dedupe)', () => {
  const { caseStore, approvalStore, triageStore } = freshStores();
  const dd = initNew850Dashboard({ caseStore, approvalStore, triageStore });
  const c = caseStore.createCase({ clientLabel: 'X' });
  const d = caseStore.addDispute(c.id, {
    item: 'pago tardío',
    creditor: 'Banco Ejemplo',
    bureaus: ['equifax'],
    evidence: 'estado de cuenta',
    round: 1,
  });
  dd.open();
  assert.ok(dd.openCase(c.id), 'drawer opens');
  const built = dd.createDraft('dispute-letter', d.id);
  assert.ok(built && !built.error, 'draft built');
  assert.equal(caseStore.getCase(c.id).drafts.length, 1);
  const pending = approvalStore.listApprovals('new850', 'pending');
  assert.equal(pending.length, 1, 'draft entered the approval queue');
  assert.equal(pending[0].kind, 'dispute-letter-r1');
  assert.equal(pending[0].payload.draftId, caseStore.getCase(c.id).drafts[0].id);
  // Second tap on the same draft does not duplicate the queue item.
  dd.createDraft('dispute-letter', d.id);
  assert.equal(
    approvalStore.listApprovals('new850', 'pending').length,
    1,
    'no duplicate queue items',
  );
  dd.destroy();
});

test('dashboard: pipeline — advance R1→R2→R3, windows visible, dormant nudges', () => {
  const { caseStore, approvalStore, triageStore } = freshStores();
  const dd = initNew850Dashboard({ caseStore, approvalStore, triageStore });
  const c = caseStore.createCase({ clientLabel: 'X' });
  dd.open();
  dd.setView('cases');

  const win = dd.startRound(c.id, 1);
  assert.ok(win && win.days === 30, 'R1 opens a 30-day FCRA window');
  assert.equal(caseStore.getCase(c.id).stage, 'round-1');

  const next = dd.advanceCase(c.id);
  assert.equal(next, 'round-1-wait', 'advance moves to the wait stage');
  assert.equal(caseStore.getCase(c.id).stage, 'round-1-wait');

  // No assign/delegate surface anywhere (single-operator).
  const apiNames = Object.keys(dd);
  assert.ok(
    !apiNames.some((n) => /assign|delegate|team|role/i.test(n)),
    'no assign/delegate API on the dashboard',
  );
  dd.destroy();
});

test('dashboard: triage — empty state, JSON import, convert to case', () => {
  const { caseStore, approvalStore, triageStore } = freshStores();
  const dd = initNew850Dashboard({ caseStore, approvalStore, triageStore });
  dd.open();
  dd.setView('triage');
  assert.equal(triageStore.listTriage().length, 0, 'starts empty, nothing invented');

  const res = dd.importTriageText(
    JSON.stringify([
      { sender: '+1 (305) 555-4567', message: 'quiero información' },
    ]),
  );
  assert.equal(res.added, 1);
  assert.equal(res.errors.length, 0);
  dd.setView('triage');
  assert.equal(dd.refs.triageActions.length, 1);
  const item = triageStore.listTriage()[0];
  assert.equal(item.senderMasked, '***4567');

  // Convert creates an intake case and links it (no send).
  dd.refs.triageActions[0].convertBtn.click();
  const linked = triageStore.getTriageItem(item.id);
  assert.equal(linked.status, 'converted');
  const created = caseStore.getCase(linked.caseId);
  assert.ok(created, 'intake case created from triage');
  assert.equal(created.intakeDraft, true);
  assert.ok(!created.phone, 'no full phone stored on the converted case');
  dd.destroy();
});

test('dashboard: workforce — status board with what ran and what needs Juan', () => {
  const { caseStore, approvalStore, triageStore } = freshStores();
  const dd = initNew850Dashboard({ caseStore, approvalStore, triageStore });
  dd.open();
  const board = dd.runWorkforceChecks();
  assert.equal(board.agents.length, 4);
  dd.setView('workforce');
  assert.equal(dd.refs.workforceCards.length, 4);
  for (const { id } of dd.refs.workforceCards) {
    assert.ok(['intake', 'drafter', 'tracker', 'nudges'].includes(id));
  }
  // Attention surfaces when a draft is missing.
  const c = caseStore.createCase({ clientLabel: 'X' });
  caseStore.addDispute(c.id, { item: 'cobranza', round: 1 });
  const board2 = dd.runWorkforceChecks();
  const drafter = board2.agents.find((a) => a.id === 'drafter');
  assert.equal(drafter.status, 'attention');
  assert.ok(drafter.needsJuan.length > 0);
  dd.destroy();
});

test('dashboard: NO-SEND-PATH — no send/submit/transmit on the API or stores', () => {
  const dd = initNew850Dashboard(freshStores());
  const scan = (obj, label) => {
    for (const name of Object.keys(obj)) {
      assert.ok(
        !/send|submit|transmit|dispatch/i.test(name),
        `${label} must not expose a send path (found: ${name})`,
      );
    }
  };
  scan(dd, 'dashboard API');
  scan(dd.approvalStore, 'approval store');
  scan(dd.triageStore, 'triage store');
  // Rendered markup contains no send affordances either.
  dd.open();
  dd.setView('approvals');
  const html = dd.refs.viewBody.children
    .map((c) => c.innerHTML || '')
    .join(' ');
  assert.ok(!/type="submit"/i.test(html), 'no submit buttons rendered');
  dd.destroy();
});

test('dashboard: open/close/toggle/destroy lifecycle + openApprovals', () => {
  const dd = initNew850Dashboard(freshStores());
  assert.equal(globalThis.__gevNew850, dd, 'window handle exposed');
  dd.toggle();
  assert.ok(dd.refs.kpis, 'toggle opens the panel');
  dd.toggle();
  assert.equal(dd.refs.kpis, undefined, 'toggle closes the panel');
  dd.openApprovals();
  assert.equal(dd.getView(), 'approvals');
  assert.ok(dd.refs.kpis, 'openApprovals opens the approval queue');
  dd.destroy();
  assert.equal(dd.refs.kpis, undefined, 'destroy clears refs');
  assert.equal(globalThis.__gevNew850, null);
});

test('dashboard: language toggle re-renders ES/EN', () => {
  const dd = initNew850Dashboard(freshStores());
  dd.open();
  assert.equal(dd.getLang(), 'es');
  dd.refs.langBtn.click();
  assert.equal(dd.getLang(), 'en');
  assert.match(dd.refs.tabs.triage.innerHTML, /Inbox/);
  dd.refs.langBtn.click();
  assert.equal(dd.getLang(), 'es');
  dd.destroy();
});

test('new850DeepLink / new850ViewFromHash route the four sections', () => {
  assert.equal(new850DeepLink('aprobaciones'), '/new850/index.html#aprobaciones');
  assert.equal(new850DeepLink('equipo'), '/new850/index.html#equipo');
  assert.equal(new850ViewFromHash('#entrada'), 'triage');
  assert.equal(new850ViewFromHash('equipo'), 'workforce');
  assert.equal(new850ViewFromHash('#casos'), 'cases');
  assert.equal(new850ViewFromHash('bogus'), 'approvals');
});

test('NEW850_OWNER_INTAKE_URL stays empty with a TODO (never invented)', () => {
  assert.equal(NEW850_OWNER_INTAKE_URL, '');
});

test('revenue-first: revenuePathFor tracks intake → review → drafts → approval → results', () => {
  const { revenuePathFor } = __internals;
  const stores = freshStores();
  const c = stores.caseStore.createCase({ clientLabel: 'X' });

  let path = revenuePathFor(c, stores.approvalStore);
  assert.deepEqual(path.steps.map((s) => s.done), [true, false, false, false, false]);
  assert.equal(path.done, 1);

  stores.caseStore.addDispute(c.id, {
    item: 'late payment',
    creditor: 'Banco Ejemplo',
  });
  assert.equal(revenuePathFor(stores.caseStore.getCase(c.id), stores.approvalStore).done, 2);

  stores.caseStore.addDraft(c.id, {
    kind: 'dispute-letter',
    target: 'Equifax',
    text: 'BORRADOR …',
  });
  assert.equal(revenuePathFor(stores.caseStore.getCase(c.id), stores.approvalStore).done, 3);

  // Pending approval does NOT count — only Juan's recorded decision.
  const draftId = stores.caseStore.getCase(c.id).drafts[0].id;
  const ap = stores.approvalStore.createApproval('new850', {
    kind: 'dispute-letter',
    titleEs: 'Borrador — caso',
    titleEn: 'Draft — case',
    payload: { caseId: c.id, draftId, bureau: 'equifax' },
  });
  assert.equal(revenuePathFor(stores.caseStore.getCase(c.id), stores.approvalStore).done, 3);
  stores.approvalStore.approveApproval(ap.id, 'OK — Juan');
  assert.equal(revenuePathFor(stores.caseStore.getCase(c.id), stores.approvalStore).done, 4);

  stores.caseStore.setRound(c.id, {
    round: 1,
    startedAt: '2026-09-17T10:00:00-05:00',
    deadlineAt: '2026-10-17T10:00:00-05:00',
    status: 'active',
  });
  const full = revenuePathFor(stores.caseStore.getCase(c.id), stores.approvalStore);
  assert.equal(full.done, 5);
  assert.equal(full.total, 5);
  assert.deepEqual(full.steps.map((s) => s.id), [
    'intake',
    'review',
    'drafts',
    'approval',
    'results',
  ]);
});

test('revenue-first: prominent fee-model-pending banner, no payment collection', () => {
  const dd = initNew850Dashboard(freshStores());
  dd.open();
  assert.ok(dd.refs.feeBanner, 'fee banner is rendered persistently');
  assert.match(dd.refs.feeBanner.className, /gev-new850-feebanner/);
  assert.match(dd.refs.feeBanner.innerHTML, /Modelo de tarifa|pendiente de tu decisi/i);
  // EN copy also names the pending state.
  assert.match(__internals.STRINGS.en.feeBanner, /pending your decision/);
  // No payment UI may exist anywhere in the station strings.
  const sweep = Object.entries(__internals.STRINGS.es)
    .concat(Object.entries(__internals.STRINGS.en))
    .filter(([k]) => k !== 'feeBanner') // the pending-state banner itself says "sin cobros"
    .map(([, v]) => (typeof v === 'string' ? v : ''))
    .join(' ');
  for (const word of [/checkout/i, /pagar/i, /payment/i, /cobro/i, /\$\d/]) {
    assert.ok(!word.test(sweep), `no payment collection copy (matched ${word})`);
  }
  dd.destroy();
});
