/**
 * SAHJONY · GOD'S EYE VIEW — Shared management console
 * ---------------------------------------------------------------------------
 * One tabbed management overlay per business station, phone-first:
 *
 *   1. Aprobaciones / Approvals — one-tap Approve / Reject per draft with an
 *      append-only audit log. SAFETY: a tap records Juan's decision ONLY;
 *      the app NEVER auto-executes external acts (no send/post/purchase/
 *      sign/call). Approval and execution stay separate steps.
 *   2. Tubería / Pipeline — advance stages + Juan's own notes. SINGLE-
 *      OPERATOR: no assignment, no delegation, no team workflow.
 *   3. Entrada / Inbox — inbound triage (WhatsApp inquiries needing
 *      attention) with JSON import. Starts empty; nothing is ever invented.
 *   4. Equipo / Workforce — agent roster: status, last action, what needs
 *      Juan. The AI workforce does the work; Juan taps the decisions.
 *
 * Framework-free DOM, ES/EN via getLang(), all touch targets ≥ 44px.
 *
 * initManagementConsole({
 *   businessId, businessName: { es, en }, getLang: () => 'es'|'en',
 *   approvals: { kinds: [{id,es,en}], create(draft),
 *                mountPanel(container, lang) -> { refresh() } (shared queue UI),
 *                audit(), countPending() },
 *   pipeline:  { stages: [{id,es,en}], items(), setStage(id, stageId),
 *                addNote(id, text),
 *                focus: {es,en} (optional revenue-first banner) },
 *   triage:    { list(status), add(data), update(id, patch),
 *                importJson(text) -> {imported, skipped, errors[]} },
 *   workforce: { snapshot() -> { running, agents: [{id,name:{es,en},role,
 *                status,lastAction}], note:{es,en} } | null },
 *   onClose: () => {},
 * }) -> { el, open(tab), refresh(), destroy() }
 */

const TABS = [
  { id: 'approvals', es: 'Aprobaciones', en: 'Approvals', icon: '✅' },
  { id: 'pipeline', es: 'Tubería', en: 'Pipeline', icon: '📊' },
  { id: 'inbox', es: 'Entrada', en: 'Inbox', icon: '📥' },
  { id: 'workforce', es: 'Equipo', en: 'Workforce', icon: '🤖' },
];

const STR = {
  manage: { es: 'Gestionar', en: 'Manage' },
  close: { es: 'Cerrar', en: 'Close' },
  pending: { es: 'pendientes', en: 'pending' },
  safety: {
    es: 'Tu tap solo registra la decisión. Nada se envía, publica, compra, firma ni ejecuta automáticamente.',
    en: 'Your tap records the decision only. Nothing is sent, posted, bought, signed, or executed automatically.',
  },
  newDraft: { es: 'Nuevo borrador', en: 'New draft' },
  kind: { es: 'Tipo', en: 'Type' },
  title: { es: 'Título', en: 'Title' },
  summary: { es: 'Resumen', en: 'Summary' },
  create: { es: 'Crear borrador', en: 'Create draft' },
  approve: { es: 'Aprobar', en: 'Approve' },
  reject: { es: 'Rechazar', en: 'Reject' },
  noPending: {
    es: 'Sin borradores pendientes. Nada inventado.',
    en: 'No pending drafts. Nothing invented.',
  },
  decided: { es: 'Decididos', en: 'Decided' },
  history: { es: 'Historial de decisiones', en: 'Decision history' },
  created: { es: 'creado', en: 'created' },
  approved: { es: 'aprobado', en: 'approved' },
  rejected: { es: 'rechazado', en: 'rejected' },
  advance: { es: 'Avanzar →', en: 'Advance →' },
  stage: { es: 'Etapa', en: 'Stage' },
  addNote: { es: 'Añadir nota', en: 'Add note' },
  notePh: { es: 'Tu nota…', en: 'Your note…' },
  noItems: {
    es: 'Sin elementos en la tubería.',
    en: 'No pipeline items.',
  },
  inboxEmpty: {
    es: 'Sin mensajes por atender. Nada inventado — importa JSON o añade uno.',
    en: 'No messages needing attention. Nothing invented — import JSON or add one.',
  },
  importJson: { es: 'Importar JSON', en: 'Import JSON' },
  jsonPh: {
    es: '[{"from":"…","text":"…"}]',
    en: '[{"from":"…","text":"…"}]',
  },
  addMsg: { es: 'Añadir mensaje', en: 'Add message' },
  fromPh: { es: 'Remitente (ej. +53 …)', en: 'Sender (e.g. +53 …)' },
  markDone: { es: 'Marcar listo', en: 'Mark done' },
  markProgress: { es: 'En curso', en: 'In progress' },
  reopen: { es: 'Reabrir', en: 'Reopen' },
  wfRunning: { es: 'Fuerza activa', en: 'Workforce running' },
  wfPaused: { es: 'Fuerza en pausa', en: 'Workforce paused' },
  wfNone: {
    es: 'Sin datos de la fuerza aquí — trabaja en la app principal.',
    en: 'No workforce data here — it runs in the main app.',
  },
  lastAction: { es: 'Última acción', en: 'Last action' },
  noAction: { es: 'sin acciones aún', en: 'no actions yet' },
  needsJuan: { es: 'Necesita a Juan', en: 'Needs Juan' },
  needsNone: {
    es: 'Nada urgente. La fuerza trabaja; tú decides.',
    en: 'Nothing urgent. The workforce works; you decide.',
  },
  idle: { es: 'en espera', en: 'idle' },
  working: { es: 'trabajando', en: 'working' },
  paused: { es: 'en pausa', en: 'paused' },
  ok: { es: 'Listo', en: 'Done' },
};

const CSS = `
.mgmt{position:fixed;inset:0;z-index:80;display:flex;flex-direction:column;background:rgba(5,8,14,.98);color:#eef2f7;font-family:inherit;font-size:15px}
.mgmt[hidden]{display:none}
.mgmt-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(56,189,248,.25)}
.mgmt-title{font-size:16px;font-weight:800;flex:1}
.mgmt-badge{background:#f59e0b;color:#111;border-radius:999px;padding:4px 12px;font-weight:800;font-size:14px}
.mgmt-close{background:none;border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:10px;min-width:48px;min-height:48px;font-size:18px;cursor:pointer}
.mgmt-tabs{display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(56,189,248,.18);overflow-x:auto}
.mgmt-tab{flex:1;min-width:76px;min-height:56px;border-radius:12px;border:1px solid rgba(56,189,248,.35);background:rgba(56,189,248,.08);color:#e0f2fe;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.mgmt-tab .ic{font-size:20px}
.mgmt-tab[aria-selected="true"]{background:rgba(56,189,248,.28);color:#fff}
.mgmt-body{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px;min-height:0}
.mgmt-safety{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.5);border-radius:12px;padding:12px;font-size:13px;line-height:1.45;color:#fde68a}
.mgmt-card{background:rgba(255,255,255,.04);border:1px solid rgba(56,189,248,.25);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px}
.mgmt-card h4{margin:0;font-size:15px}
.mgmt-card p{margin:0;font-size:13px;color:#c3d0e4;line-height:1.45;white-space:pre-wrap}
.mgmt-meta{font-size:12px;color:#8fa0b8}
.mgmt-row{display:flex;gap:8px;flex-wrap:wrap}
.mgmt-btn{min-height:52px;padding:12px 18px;border-radius:12px;border:1px solid rgba(56,189,248,.45);background:rgba(56,189,248,.14);color:#fff;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;flex:1}
.mgmt-btn.ok{background:rgba(34,197,94,.25);border-color:rgba(34,197,94,.6)}
.mgmt-btn.no{background:rgba(239,68,68,.18);border-color:rgba(239,68,68,.55)}
.mgmt-btn.ghost{background:transparent}
.mgmt-input,.mgmt-select,.mgmt-area{width:100%;box-sizing:border-box;min-height:52px;border-radius:10px;border:1px solid rgba(56,189,248,.35);background:rgba(10,14,22,.9);color:#fff;font-size:15px;padding:12px;font-family:inherit}
.mgmt-area{min-height:88px;resize:vertical}
.mgmt-label{font-size:13px;font-weight:700;color:#c3d0e4}
.mgmt-pill{display:inline-block;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:800;background:rgba(56,189,248,.18);color:#7dd3fc}
.mgmt-pill.warn{background:rgba(245,158,11,.2);color:#fbbf24}
.mgmt-pill.bad{background:rgba(239,68,68,.2);color:#fca5a5}
.mgmt-pill.good{background:rgba(34,197,94,.2);color:#86efac}
.mgmt-empty{border:1px dashed rgba(56,189,248,.4);border-radius:12px;padding:20px;text-align:center;color:#c3d0e4;font-size:14px;line-height:1.5}
.mgmt-h{font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#7dd3fc;margin:4px 0 0}
.mgmt-audit{font-size:12px;color:#8fa0b8;line-height:1.6}
.mgmt-audit b{color:#c3d0e4}
`;

function doc() {
  return globalThis.document;
}

function ensureCss() {
  const d = doc();
  if (!d || d.getElementById('mgmt-console-css')) return;
  const style = d.createElement('style');
  style.id = 'mgmt-console-css';
  style.textContent = CSS;
  (d.head || d.body || d).appendChild(style);
}

function el(tag, cls, text) {
  const e = doc().createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function btn(label, cls, onClick) {
  const b = el('button', `mgmt-btn ${cls || ''}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Per-business management overlay. See module header for the full contract. */
export function initManagementConsole(opts = {}) {
  const {
    businessId,
    businessName = { es: '', en: '' },
    getLang = () => 'es',
    approvals = {},
    pipeline = {},
    triage = {},
    workforce = {},
    onClose = () => {},
  } = opts;
  const lang = () => (getLang() === 'en' ? 'en' : 'es');
  const t = (key) => STR[key]?.[lang()] ?? key;
  const pick = (obj) => (lang() === 'en' ? obj?.en : obj?.es) ?? '';

  ensureCss();
  const root = el('div', 'mgmt');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `${t('manage')}: ${pick(businessName)}`);

  const head = el('div', 'mgmt-head');
  const title = el('div', 'mgmt-title', `${t('manage')} · ${pick(businessName)}`);
  const badge = el('span', 'mgmt-badge', '');
  badge.hidden = true;
  const closeBtn = el('button', 'mgmt-close', '✕');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', t('close'));
  closeBtn.addEventListener('click', () => {
    root.hidden = true;
    onClose();
  });
  head.append(title, badge, closeBtn);

  const tabsEl = el('div', 'mgmt-tabs');
  tabsEl.setAttribute('role', 'tablist');
  const body = el('div', 'mgmt-body');
  root.append(head, tabsEl, body);

  let currentTab = 'approvals';
  const tabBtns = {};

  function pendingCount() {
    try {
      return approvals.countPending ? approvals.countPending() : 0;
    } catch {
      return 0;
    }
  }

  function refreshBadge() {
    const n = pendingCount();
    badge.hidden = n === 0;
    badge.textContent = n > 0 ? `${n} ${t('pending')}` : '';
  }

  // ---- Approvals ---------------------------------------------------------
  function renderApprovals() {
    body.innerHTML = '';
    const safety = el('div', 'mgmt-safety', t('safety'));
    body.append(safety);

    // Composer: Juan creates a draft (data only — creates nothing external).
    // Backed by the shared approval queue contract (src/approvals/):
    // createApproval records the draft; approve/reject taps below only
    // record decisions, never execute.
    const comp = el('div', 'mgmt-card');
    comp.append(el('div', 'mgmt-h', t('newDraft')));
    const kindSel = el('select', 'mgmt-select');
    (approvals.kinds || []).forEach((k) => {
      const o = doc().createElement('option');
      o.value = k.id;
      o.textContent = pick(k);
      kindSel.append(o);
    });
    const titleIn = el('input', 'mgmt-input');
    titleIn.placeholder = t('title');
    titleIn.setAttribute('aria-label', t('title'));
    const sumIn = el('textarea', 'mgmt-area');
    sumIn.placeholder = t('summary');
    sumIn.setAttribute('aria-label', t('summary'));
    let panelHandle = null;
    const createBtn = btn(t('create'), '', () => {
      const titleText = titleIn.value.trim();
      // Summary falls back to the title (Juan's own words) — the shared
      // contract requires both fields non-empty.
      const sumText = sumIn.value.trim() || titleText;
      if (!titleText) {
        titleIn.focus();
        return;
      }
      try {
        // The shared contract requires both languages; a single input
        // fills both until Juan edits them separately.
        approvals.create({
          kind: kindSel.value || ((approvals.kinds || [])[0] || {}).id || 'draft',
          titleEs: titleText,
          titleEn: titleText,
          summaryEs: sumText,
          summaryEn: sumText,
          payload: null,
        });
      } catch {
        /* invalid draft — leave the form up */
        return;
      }
      titleIn.value = '';
      sumIn.value = '';
      try {
        panelHandle && panelHandle.refresh();
      } catch {
        /* noop */
      }
      refreshBadge();
    });
    comp.append(
      el('div', 'mgmt-label', t('kind')),
      kindSel,
      titleIn,
      sumIn,
      createBtn,
    );
    body.append(comp);

    // Shared queue UI (one-tap approve/reject, decision-only).
    const host = el('div', 'mgmt-appr-host');
    body.append(host);
    try {
      panelHandle = approvals.mountPanel
        ? approvals.mountPanel(host, lang())
        : null;
    } catch {
      panelHandle = null;
    }

    // Append-only audit trail (actor: juan).
    let audit = [];
    try {
      audit = approvals.audit ? approvals.audit() : [];
    } catch {
      audit = [];
    }
    if (audit.length) {
      body.append(el('div', 'mgmt-h', `${t('history')} (${audit.length})`));
      const log = el('div', 'mgmt-audit');
      for (const e of audit.slice(0, 30)) {
        const line = el('div', '');
        const b = el('b', '', t(e.action) || e.action);
        line.append(
          b,
          doc().createTextNode(` · ${e.at || ''} · ${e.actor || ''}`),
        );
        log.append(line);
      }
      body.append(log);
    }
  }

  // ---- Pipeline ----------------------------------------------------------
  function stageLabel(id) {
    return (pipeline.stages || []).find((s) => s.id === id)?.[lang()] || id;
  }

  function renderPipeline() {
    body.innerHTML = '';
    // Revenue-first: each station surfaces its shortest path to first real
    // profit at the top of the pipeline tab.
    if (pipeline.focus && (pipeline.focus.es || pipeline.focus.en)) {
      body.append(el('div', 'mgmt-safety', `🎯 ${pick(pipeline.focus)}`));
    }
    let items = [];
    try {
      items = pipeline.items ? pipeline.items() : [];
    } catch {
      items = [];
    }
    if (!items.length) body.append(el('div', 'mgmt-empty', t('noItems')));
    for (const item of items) {
      const card = el('div', 'mgmt-card');
      card.append(
        el('h4', '', item.title),
        el('div', 'mgmt-row', el('span', 'mgmt-pill', stageLabel(item.stage))),
      );
      if (item.subtitle) card.append(el('div', 'mgmt-meta', item.subtitle));
      // Advance to the next stage in the ordered list.
      const stages = pipeline.stages || [];
      const idx = stages.findIndex((s) => s.id === item.stage);
      const next = idx >= 0 && idx + 1 < stages.length ? stages[idx + 1] : null;
      const row = el('div', 'mgmt-row');
      if (next) {
        row.append(
          btn(`${t('advance')} ${next[lang()]}`, '', () => {
            try {
              pipeline.setStage(item.id, next.id);
            } catch {
              /* noop */
            }
            renderPipeline();
          }),
        );
      }
      // Jump to any stage (Juan may move back).
      const sel = el('select', 'mgmt-select');
      sel.setAttribute('aria-label', t('stage'));
      for (const s of stages) {
        const o = doc().createElement('option');
        o.value = s.id;
        o.textContent = s[lang()];
        if (s.id === item.stage) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        try {
          pipeline.setStage(item.id, sel.value);
        } catch {
          /* noop */
        }
        renderPipeline();
      });
      const noteIn = el('input', 'mgmt-input');
      noteIn.placeholder = t('notePh');
      noteIn.setAttribute('aria-label', t('addNote'));
      const noteBtn = btn(t('addNote'), 'ghost', () => {
        const text = noteIn.value.trim();
        if (!text) return;
        try {
          pipeline.addNote(item.id, text);
        } catch {
          /* noop */
        }
        renderPipeline();
      });
      card.append(row, sel, noteIn, noteBtn);
      body.append(card);
    }
  }

  // ---- Inbox (triage) ----------------------------------------------------
  function renderInbox() {
    body.innerHTML = '';
    let items = [];
    try {
      items = triage.list ? triage.list() : [];
    } catch {
      items = [];
    }
    const open = items.filter((i) => i.status !== 'done');
    if (!items.length) body.append(el('div', 'mgmt-empty', t('inboxEmpty')));

    // JSON import — the only bulk entry path; never invents.
    const imp = el('div', 'mgmt-card');
    imp.append(el('div', 'mgmt-h', t('importJson')));
    const area = el('textarea', 'mgmt-area');
    area.placeholder = t('jsonPh');
    area.setAttribute('aria-label', t('importJson'));
    const impBtn = btn(t('importJson'), '', () => {
      let res = null;
      try {
        res = triage.importJson(area.value);
      } catch {
        res = { imported: 0, skipped: 0, errors: ['error'] };
      }
      const msg = `${t('ok')}: ${res.imported} ✓`;
      area.value = '';
      area.placeholder = res.errors?.length
        ? `${msg} · ${res.errors.slice(0, 2).join(' | ')}`
        : msg;
      renderInbox();
    });
    imp.append(area, impBtn);
    body.append(imp);

    // Manual add.
    const add = el('div', 'mgmt-card');
    add.append(el('div', 'mgmt-h', t('addMsg')));
    const fromIn = el('input', 'mgmt-input');
    fromIn.placeholder = t('fromPh');
    const textIn = el('textarea', 'mgmt-area');
    textIn.placeholder = t('summary');
    const addBtn = btn(t('addMsg'), '', () => {
      if (!textIn.value.trim() && !fromIn.value.trim()) return;
      try {
        triage.add({ from: fromIn.value.trim(), text: textIn.value.trim() });
      } catch {
        /* noop */
      }
      renderInbox();
    });
    add.append(fromIn, textIn, addBtn);
    body.append(add);

    for (const item of open.slice(0, 50)) {
      const card = el('div', 'mgmt-card');
      const pillCls =
        item.status === 'new' ? 'warn' : item.status === 'done' ? 'good' : '';
      card.append(
        el('div', 'mgmt-row', el('span', `mgmt-pill ${pillCls}`, item.status)),
        item.from ? el('h4', '', item.from) : el('h4', '', '—'),
        el('p', '', item.text || ''),
      );
      if (item.note) card.append(el('div', 'mgmt-meta', `📝 ${item.note}`));
      const row = el('div', 'mgmt-row');
      const nextStatus =
        item.status === 'new' ? 'in-progress' : item.status === 'in-progress' ? 'done' : 'new';
      const nextLabel =
        item.status === 'new'
          ? t('markProgress')
          : item.status === 'in-progress'
            ? t('markDone')
            : t('reopen');
      row.append(
        btn(nextLabel, '', () => {
          try {
            triage.update(item.id, { status: nextStatus });
          } catch {
            /* noop */
          }
          renderInbox();
        }),
      );
      const noteIn = el('input', 'mgmt-input');
      noteIn.placeholder = t('notePh');
      noteIn.value = item.note || '';
      const noteBtn = btn(t('addNote'), 'ghost', () => {
        try {
          triage.update(item.id, { note: noteIn.value.trim() });
        } catch {
          /* noop */
        }
        renderInbox();
      });
      card.append(row, noteIn, noteBtn);
      body.append(card);
    }
  }

  // ---- Workforce ---------------------------------------------------------
  function renderWorkforce() {
    body.innerHTML = '';
    let snap = null;
    try {
      snap = workforce.snapshot ? workforce.snapshot() : null;
    } catch {
      snap = null;
    }
    if (!snap || !Array.isArray(snap.agents)) {
      body.append(el('div', 'mgmt-empty', t('wfNone')));
      return;
    }
    const banner = el(
      'div',
      'mgmt-safety',
      snap.running ? `🟢 ${t('wfRunning')}` : `⏸️ ${t('wfPaused')}`,
    );
    body.append(banner);
    if (snap.note) body.append(el('div', 'mgmt-meta', pick(snap.note)));

    for (const a of snap.agents) {
      const card = el('div', 'mgmt-card');
      const st = a.status === 'working' ? 'good' : a.status === 'paused' ? 'warn' : '';
      card.append(
        el('div', 'mgmt-row', el('span', `mgmt-pill ${st}`, t(a.status) || a.status)),
        el('h4', '', pick(a.name) || a.id),
      );
      const last = a.lastAction;
      const lastText = last
        ? `${t('lastAction')}: ${lang() === 'en' ? last.en || last.es : last.es || last.en || ''}`
        : t('noAction');
      card.append(el('div', 'mgmt-meta', lastText));
      body.append(card);
    }

    // What needs Juan: pending approvals + open triage + paused agents.
    const needs = [];
    const nPend = pendingCount();
    if (nPend > 0)
      needs.push(
        lang() === 'es'
          ? `${nPend} ${nPend === 1 ? 'aprobación pendiente' : 'aprobaciones pendientes'}`
          : `${nPend} pending ${nPend === 1 ? 'approval' : 'approvals'}`,
      );
    let nOpen = 0;
    try {
      nOpen = (triage.list ? triage.list() : []).filter((i) => i.status !== 'done').length;
    } catch {
      nOpen = 0;
    }
    if (nOpen > 0)
      needs.push(
        lang() === 'es'
          ? `${nOpen} ${nOpen === 1 ? 'mensaje por atender' : 'mensajes por atender'}`
          : `${nOpen} ${nOpen === 1 ? 'message' : 'messages'} needing attention`,
      );
    const pausedAgents = snap.agents.filter((a) => a.status === 'paused');
    if (pausedAgents.length > 0)
      needs.push(
        lang() === 'es'
          ? `${pausedAgents.length} ${pausedAgents.length === 1 ? 'agente en pausa' : 'agentes en pausa'}`
          : `${pausedAgents.length} paused ${pausedAgents.length === 1 ? 'agent' : 'agents'}`,
      );
    body.append(el('div', 'mgmt-h', t('needsJuan')));
    body.append(
      el(
        'div',
        needs.length ? 'mgmt-safety' : 'mgmt-empty',
        needs.length ? needs.join(' · ') : t('needsNone'),
      ),
    );
  }

  const renderers = {
    approvals: renderApprovals,
    pipeline: renderPipeline,
    inbox: renderInbox,
    workforce: renderWorkforce,
  };

  function render() {
    title.textContent = `${t('manage')} · ${pick(businessName)}`;
    refreshBadge();
    for (const tab of TABS) {
      const b = tabBtns[tab.id];
      if (b) {
        b.setAttribute('aria-selected', String(tab.id === currentTab));
        b.innerHTML = '';
        const ic = el('span', 'ic', tab.icon);
        const lb = el('span', '', tab[lang()]);
        b.append(ic, lb);
      }
    }
    (renderers[currentTab] || renderApprovals)();
  }

  for (const tab of TABS) {
    const b = el('button', 'mgmt-tab', '');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    tabBtns[tab.id] = b;
    b.addEventListener('click', () => {
      currentTab = tab.id;
      render();
    });
    tabsEl.append(b);
  }

  function open(tab) {
    if (renderers[tab]) currentTab = tab;
    root.hidden = false;
    render();
  }

  function refresh() {
    if (!root.hidden) render();
    else refreshBadge();
  }

  function destroy() {
    root.remove();
  }

  render();
  return { el: root, open, refresh, destroy, businessId };
}
