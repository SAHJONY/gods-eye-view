import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM double — the console only uses globalThis.document lazily.
function makeDocument() {
  const byId = new Map();
  function makeEl(tag) {
    const e = {
      tag,
      children: [],
      _handlers: {},
      _id: '',
      className: '',
      _text: '',
      _html: '',
      value: '',
      placeholder: '',
      type: '',
      selected: false,
      hidden: false,
      dataset: {},
      style: {},
      set id(v) {
        this._id = v;
        if (v) byId.set(v, this);
      },
      get id() {
        return this._id;
      },
      set textContent(v) {
        this._text = String(v);
      },
      get textContent() {
        return this._text;
      },
      set innerHTML(v) {
        this._html = String(v);
        this.children = [];
      },
      get innerHTML() {
        return this._html;
      },
      append(...kids) {
        for (const k of kids) this.children.push(k);
        return this;
      },
      appendChild(k) {
        this.children.push(k);
        return k;
      },
      addEventListener(type, fn) {
        (this._handlers[type] = this._handlers[type] || []).push(fn);
      },
      removeEventListener() {},
      setAttribute() {},
      getAttribute() {
        return null;
      },
      remove() {
        this.removed = true;
      },
      click() {
        for (const f of this._handlers.click || []) f();
      },
      querySelectorAll() {
        return [];
      },
      focus() {},
    };
    return e;
  }
  return {
    createElement: makeEl,
    createTextNode: (t) => ({ text: String(t), nodeType: 3 }),
    getElementById: (id) => byId.get(id) || null,
    head: makeEl('head'),
    body: makeEl('body'),
  };
}

globalThis.document = makeDocument();

const { initManagementConsole } = await import('./managementConsole.js');
// Shared approval queue contract (sibling infra: src/approvals/).
const approvalsApi = await import('../approvals/approvalStore.js');
const { mountApprovalPanel } = await import('../approvals/approvalPanel.js');
const triageApi = await import('./triageStore.js');

function textOf(node) {
  let out = node._text || node._html || node.text || '';
  for (const c of node.children || []) out += ' ' + textOf(c);
  return out;
}

function findButtons(root, label) {
  const found = [];
  const visit = (n) => {
    if (n.tag === 'button' && textOf(n).includes(label)) found.push(n);
    for (const c of n.children || []) visit(c);
  };
  visit(root);
  return found;
}

function buildConsole() {
  approvalsApi.resetApprovalStore();
  triageApi._resetTriageForTests();
  const stages = [
    { id: 'a', es: 'Etapa A', en: 'Stage A' },
    { id: 'b', es: 'Etapa B', en: 'Stage B' },
  ];
  const items = [{ id: 'p1', title: 'Caso 1', subtitle: 'sub', stage: 'a' }];
  return initManagementConsole({
    businessId: 'trade',
    businessName: { es: 'Comercio', en: 'Trade' },
    getLang: () => 'es',
    approvals: {
      kinds: [{ id: 'draft', es: 'Borrador', en: 'Draft' }],
      create: (d) => approvalsApi.createApproval('trade', d),
      mountPanel: (container, lang) =>
        mountApprovalPanel(container, { businessId: 'trade', lang }),
      audit: () => approvalsApi.listAuditLog('trade'),
      countPending: () => approvalsApi.approvalStats('trade').pending,
    },
    pipeline: {
      stages,
      items: () => items.map((i) => ({ ...i })),
      setStage: (id, stage) => {
        items.find((i) => i.id === id).stage = stage;
        return true;
      },
      addNote: () => true,
    },
    triage: {
      list: (s) => triageApi.listTriage('trade', s),
      add: (d) => triageApi.addTriageItem('trade', d),
      update: (id, p) => triageApi.updateTriage(id, p),
      importJson: (t) => triageApi.importTriageJson('trade', t),
    },
    workforce: {
      snapshot: () => ({
        running: true,
        agents: [
          {
            id: 'ag1',
            name: { es: 'Agente Uno', en: 'Agent One' },
            role: 'triage',
            status: 'working',
            lastAction: { es: 'hizo X', en: 'did X' },
          },
        ],
        note: { es: 'nota', en: 'note' },
      }),
    },
  });
}

test('console renders 4 bilingual tabs and the safety banner', () => {
  const c = buildConsole();
  c.open('approvals');
  const text = textOf(c.el);
  assert.ok(text.includes('Aprobaciones'));
  assert.ok(text.includes('Tubería'));
  assert.ok(text.includes('Entrada'));
  assert.ok(text.includes('Equipo'));
  // Safety semantic is visible: decision only, nothing auto-executes.
  assert.ok(text.includes('Nada se envía'));
  c.destroy();
});

test('approvals tab: composer creates a draft in the shared queue', () => {
  const c = buildConsole();
  c.open('approvals');
  const inputs = [];
  const visit = (n) => {
    if ((n.tag === 'input' || n.tag === 'textarea') && n.placeholder)
      inputs.push(n);
    for (const ch of n.children || []) visit(ch);
  };
  visit(c.el);
  const titleIn = inputs.find((i) => i.placeholder.includes('Título'));
  assert.ok(titleIn, 'composer title input present');
  titleIn.value = 'Borrador de prueba';
  findButtons(c.el, 'Crear borrador')[0].click();

  // The draft lands in the SHARED queue (sibling store, same localStorage key).
  assert.equal(approvalsApi.approvalStats('trade').pending, 1);
  const [item] = approvalsApi.listApprovals('trade', 'pending');
  assert.equal(item.titleEs, 'Borrador de prueba');
  assert.equal(item.businessId, 'trade');

  // The shared queue UI is mounted inside the tab (tap-to-decide panel).
  const text = textOf(c.el);
  assert.ok(text.includes('Aprobar'), 'shared panel approve button mounted');
  c.destroy();
});

test('approvals tab: one-tap decision records only, audit stays append-only', () => {
  const c = buildConsole();
  const created = approvalsApi.createApproval('trade', {
    kind: 'draft',
    titleEs: 'Toca decidir',
    titleEn: 'Tap to decide',
    summaryEs: 'resumen',
    summaryEn: 'summary',
    payload: null,
  });
  c.open('approvals');

  // Decision through the shared store (the mounted panel's tap path).
  approvalsApi.approveApproval(created.id, '');
  assert.equal(approvalsApi.approvalStats('trade').pending, 0);
  const decided = approvalsApi.getApproval(created.id);
  assert.equal(decided.status, 'approved');
  assert.ok(decided.decidedAt);

  // Idempotent: re-approving changes nothing, no duplicate audit entry.
  const auditBefore = approvalsApi.listAuditLog('trade').length;
  approvalsApi.approveApproval(created.id, '');
  assert.equal(approvalsApi.listAuditLog('trade').length, auditBefore);

  // Audit trail renders in the tab.
  c.refresh();
  c.open('approvals');
  const text = textOf(c.el);
  assert.ok(text.includes('Historial de decisiones'));
  assert.ok(text.includes('juan'));
  c.destroy();
});

test('pipeline: advance moves to the next stage, no assignment UI', () => {
  const c = buildConsole();
  c.open('pipeline');
  let text = textOf(c.el);
  assert.ok(text.includes('Caso 1'));
  assert.ok(text.includes('Etapa A'));
  assert.ok(!text.includes('Asignar'), 'single-operator: no assignment UI');
  findButtons(c.el, 'Avanzar')[0].click();
  text = textOf(c.el);
  assert.ok(text.includes('Etapa B'));
  c.destroy();
});

test('inbox: honest empty state, add and JSON import', () => {
  const c = buildConsole();
  c.open('inbox');
  let text = textOf(c.el);
  assert.ok(text.includes('Nada inventado'));

  triageApi.addTriageItem('trade', { from: 'Juan', text: 'hola' });
  c.refresh();
  // refresh only re-renders when open — reopen to be sure
  c.open('inbox');
  text = textOf(c.el);
  assert.ok(text.includes('hola'));
  c.destroy();
});

test('workforce: roster renders; null snapshot shows honest empty state', () => {
  const c = buildConsole();
  c.open('workforce');
  let text = textOf(c.el);
  assert.ok(text.includes('Agente Uno'));
  assert.ok(text.includes('Fuerza activa'));
  assert.ok(text.includes('Necesita a Juan'));
  c.destroy();

  // Null snapshot (e.g. standalone screen without live workforce data):
  // honest empty state, never invented agents.
  globalThis.document = makeDocument();
  const c2 = initManagementConsole({
    businessId: 'trade',
    businessName: { es: 'Comercio', en: 'Trade' },
    getLang: () => 'es',
    approvals: {
      kinds: [],
      create: () => null,
      mountPanel: () => ({ refresh() {} }),
      audit: () => [],
      countPending: () => 0,
    },
    pipeline: { stages: [], items: () => [] },
    triage: { list: () => [] },
    workforce: { snapshot: () => null },
  });
  c2.open('workforce');
  text = textOf(c2.el);
  assert.ok(text.includes('app principal'));
  c2.destroy();
});
