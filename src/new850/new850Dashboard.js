// New850 — Credit Repair MANAGEMENT console (GOD'S EYE VIEW plugin).
//
// Phone-first management station with four sections (big tab bar, ≥44px,
// ES/EN Spanish-first):
//   1. Aprobaciones — THE CORE: every draft awaiting Juan's word. One-tap
//      Approve / Reject per item + append-only audit log. Approving records
//      the DECISION ONLY — the app never auto-executes external acts.
//   2. Casos — pipeline management: advance R1→R2→R3, Juan's own notes,
//      30/45-day FCRA windows per case, dormant nudges surfaced.
//   3. Entrada — inbound WhatsApp triage: empty state + JSON import. Never
//      invents conversations or customers.
//   4. Equipo — AI workforce oversight: roster status, what ran, what needs
//      Juan. Clearly labeled AI agents (no human team roles — single operator).
//
// DRAFT-ONLY posture: this module exposes NO send/submit path by design.
// Approval/rejection is TAP-ONLY (never by voice).
//
// Deep links: new850DeepLink(hash) -> '/new850/index.html#<hash>' with hashes
//   aprobaciones | casos | entrada | equipo.

import {
  STAGES,
  STAGE_LABELS,
  BUREAUS,
  DISPUTE_STATUSES,
  DRAFT_KINDS,
  DRAFT_KIND_LABELS,
  AWAITING_APPROVAL,
  createNew850Store,
  maskPhone,
  redactSsn,
} from './new850Store.js';

import {
  windowStatus,
  windowStatusLabel,
  dormantCases,
  nextRoundRecommendation,
  roundSequence,
  complianceIssues,
  draftDisputeLetter,
  draftFurnisherLetter,
  draftCfpbComplaint,
  draftCustomerMessage,
  investigationWindow,
  DORMANT_AFTER_DAYS,
} from './new850Engine.js';

import { parseCaseCsv, sampleCsvTemplate } from './new850Importer.js';

import {
  createApprovalStore,
  NEW850_APPROVAL_KIND_LABELS,
} from './new850Approvals.js';

import {
  createTriageStore,
  importTriageJson,
  exportTriageJson,
  sampleTriageTemplate,
  TRIAGE_STATUS_LABELS,
} from './new850Triage.js';

import { createNew850Workforce, WORKFORCE_NOTE } from './new850Workforce.js';

export const NEW850_SCREEN_PATH = '/new850/index.html';
export const NEW850_ROOT_ID = 'gev-new850-root';
export const NEW850_FLOAT_ID = 'gev-new850-float';

// TODO(Juan): set the production owner intake URL here when the intake
// endpoint is ready. Leave EMPTY until then — never invent a URL.
export const NEW850_OWNER_INTAKE_URL = '';

export const NEW850_VIEWS = Object.freeze([
  'approvals',
  'cases',
  'triage',
  'workforce',
]);

const VIEW_HASHES = Object.freeze({
  approvals: 'aprobaciones',
  cases: 'casos',
  triage: 'entrada',
  workforce: 'equipo',
});

const HASH_VIEWS = Object.freeze(
  Object.fromEntries(Object.entries(VIEW_HASHES).map(([v, h]) => [h, v])),
);

export const new850DeepLink = (hash = 'aprobaciones') =>
  `${NEW850_SCREEN_PATH}#${hash}`;

export const new850ViewFromHash = (hash = '') =>
  HASH_VIEWS[String(hash).replace(/^#/, '').toLowerCase()] || 'approvals';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
};

const deadlineChip = (deadlineAt, lang) => {
  const st = windowStatus(deadlineAt);
  const cls =
    st === 'overdue'
      ? 'gev-n850-chip--over'
      : st === 'due-soon'
        ? 'gev-n850-chip--soon'
        : 'gev-n850-chip--ok';
  return `<span class="gev-n850-chip ${cls}">${esc(windowStatusLabel(st, lang))}</span>`;
};

const stageChip = (stage, lang) => {
  const label = STAGE_LABELS[stage]?.[lang] || stage;
  return `<span class="gev-n850-chip gev-n850-chip--stage">${esc(label)}</span>`;
};

const disputeChip = (status, lang) => {
  const label = DISPUTE_STATUSES[status]?.[lang] || status;
  const cls =
    status === 'deleted' || status === 'corrected'
      ? 'gev-n850-chip--ok'
      : status === 'under-investigation'
        ? 'gev-n850-chip--soon'
        : 'gev-n850-chip--stage';
  return `<span class="gev-n850-chip ${cls}">${esc(label)}</span>`;
};

// Revenue-first: the shortest path to the first paying client.
//   intake → report review → dispute drafts → approval → results tracking.
// Pure function of the case + approval store; no side effects.
const revenuePathFor = (caseObj, approvalStore) => {
  const disputes = caseObj?.disputes || [];
  const drafts = caseObj?.drafts || [];
  const rounds = caseObj?.rounds || [];
  const approved = approvalStore
    ? approvalStore
        .listApprovals('new850', 'approved')
        .some((a) => a.payload?.caseId === caseObj?.id)
    : false;
  const steps = [
    { id: 'intake', done: true },
    { id: 'review', done: disputes.length > 0 },
    { id: 'drafts', done: drafts.length > 0 },
    { id: 'approval', done: approved },
    { id: 'results', done: rounds.some((r) => r.status === 'active') },
  ];
  return {
    steps,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
  };
};

const approvalStatusChip = (status, lang) => {  const label =
    status === 'approved'
      ? lang === 'es'
        ? 'Aprobado'
        : 'Approved'
      : status === 'rejected'
        ? lang === 'es'
          ? 'Rechazado'
          : 'Rejected'
        : lang === 'es'
          ? 'Pendiente'
          : 'Pending';
  const cls =
    status === 'approved'
      ? 'gev-n850-chip--ok'
      : status === 'rejected'
        ? 'gev-n850-chip--over'
        : 'gev-n850-chip--soon';
  return `<span class="gev-n850-chip ${cls}">${esc(label)}</span>`;
};

const STRINGS = {
  es: {
    title: 'New850 — Reparación de crédito',
    subtitle: 'Consola de gestión · nada se envía solo',
    float: 'New850',
    tabApprovals: 'Aprobaciones',
    tabCases: 'Casos',
    tabTriage: 'Entrada',
    tabWorkforce: 'Equipo IA',
    kpiApprovals: 'Por aprobar',
    kpiOpen: 'Casos abiertos',
    kpiDeadlines: 'Plazos activos',
    kpiDormant: 'Casos inactivos',
    safetyBanner:
      'Aprobar solo registra tu decisión — la app nunca envía nada automáticamente.',
    approve: 'Aprobar',
    reject: 'Rechazar',
    noteOptional: 'Nota (opcional)',
    decidedByJuan: 'Decidido por Juan',
    auditTitle: 'Registro de decisiones',
    emptyApprovals: 'Sin borradores pendientes. Todo está al día.',
    filterPending: 'Pendientes',
    filterApproved: 'Aprobados',
    filterRejected: 'Rechazados',
    filterAudit: 'Registro',
    newCase: 'Nuevo caso (borrador)',
    import: 'Importar CSV',
    export: 'Exportar CSV',
    template: 'Plantilla CSV',
    openScreen: 'Abrir pantalla completa',
    emptyCases: 'Sin casos todavía. Crea un caso de borrador o importa un CSV.',
    advance: 'Avanzar etapa',
    startRound: (r) => `Iniciar R${r} (30 días)`,
    moveTo: 'Mover a',
    dormantTitle: 'Casos inactivos — necesitan tu revisión',
    markReviewed: 'Marcar revisado',
    notePlaceholder: 'Tu nota… (sin SSN)',
    addNote: 'Agregar nota',
    back: 'Atrás',
    close: 'Cerrar',
    draftFor: (kind) => `Generar borrador: ${kind}`,
    cfpbDraft: 'Borrador CFPB',
    msgDraft: 'Mensaje al cliente (borrador)',
    msgPlaceholder: 'Texto del mensaje al cliente…',
    sendMsgDraft: 'Guardar mensaje como borrador',
    complianceTitle: 'Revisión de cumplimiento',
    emptyTriage:
      'Sin consultas entrantes. Importa un JSON para empezar — nunca inventamos conversaciones ni clientes.',
    importJson: 'Importar JSON',
    pasteJson: 'Pega aquí el JSON de consultas de WhatsApp…',
    templateJson: 'Plantilla JSON',
    exportJson: 'Exportar JSON',
    triageReview: 'Revisar',
    triageConvert: 'Convertir a caso',
    triageDismiss: 'Descartar',
    triageConverted: 'Convertido',
    runChecks: 'Ejecutar revisión',
    needsJuan: 'Necesita a Juan',
    lastCheck: 'Última revisión',
    workforceIdle: 'En espera',
    workforceAttention: 'Requiere atención',
    lang: 'EN',
    draftBanner: 'BORRADOR — NADA ENVIADO · Awaiting owner approval',
    demoBadge: 'DEMO',
    intakeDraftBadge: 'Borrador de CSV',
    importStatus: (a, s, e) =>
      `Importados: ${a} · omitidos: ${s} · errores: ${e}`,
    triageImportStatus: (a, e) => `Importadas: ${a} · errores: ${e}`,
    viewCase: 'Ver',
    // Revenue-first: shortest path to the first paying client. Fee model is
    // UNDECIDED — shown as a pending state, never as payment collection.
    feeBanner:
      '💰 Modelo de tarifa: pendiente de tu decisión — sin cobros hasta que lo definas.',
    revenuePath: 'Camino al primer cliente',
    revenueSteps: [
      'Caso (intake)',
      'Reporte revisado',
      'Borradores',
      'Aprobación',
      'Resultados',
    ],
  },
  en: {
    title: 'New850 — Credit Repair',
    subtitle: 'Management console · nothing sends itself',
    float: 'New850',
    tabApprovals: 'Approvals',
    tabCases: 'Cases',
    tabTriage: 'Inbox',
    tabWorkforce: 'AI Team',
    kpiApprovals: 'Awaiting approval',
    kpiOpen: 'Open cases',
    kpiDeadlines: 'Active deadlines',
    kpiDormant: 'Dormant cases',
    safetyBanner:
      'Approving only records your decision — the app never sends anything automatically.',
    approve: 'Approve',
    reject: 'Reject',
    noteOptional: 'Note (optional)',
    decidedByJuan: 'Decided by Juan',
    auditTitle: 'Decision log',
    emptyApprovals: 'No drafts pending. All caught up.',
    filterPending: 'Pending',
    filterApproved: 'Approved',
    filterRejected: 'Rejected',
    filterAudit: 'Log',
    newCase: 'New case (draft)',
    import: 'Import CSV',
    export: 'Export CSV',
    template: 'CSV template',
    openScreen: 'Open full screen',
    emptyCases: 'No cases yet. Create a draft case or import a CSV.',
    advance: 'Advance stage',
    startRound: (r) => `Start R${r} (30 days)`,
    moveTo: 'Move to',
    dormantTitle: 'Dormant cases — need your review',
    markReviewed: 'Mark reviewed',
    notePlaceholder: 'Your note… (no SSN)',
    addNote: 'Add note',
    back: 'Back',
    close: 'Close',
    draftFor: (kind) => `Build draft: ${kind}`,
    cfpbDraft: 'CFPB draft',
    msgDraft: 'Customer message (draft)',
    msgPlaceholder: 'Customer message text…',
    sendMsgDraft: 'Save message as draft',
    complianceTitle: 'Compliance review',
    emptyTriage:
      'No inbound inquiries. Import JSON to start — we never invent conversations or customers.',
    importJson: 'Import JSON',
    pasteJson: 'Paste WhatsApp inquiries JSON here…',
    templateJson: 'JSON template',
    exportJson: 'Export JSON',
    triageReview: 'Review',
    triageConvert: 'Convert to case',
    triageDismiss: 'Dismiss',
    triageConverted: 'Converted',
    runChecks: 'Run checks',
    needsJuan: 'Needs Juan',
    lastCheck: 'Last check',
    workforceIdle: 'Idle',
    workforceAttention: 'Needs attention',
    lang: 'ES',
    draftBanner: 'DRAFT — NOTHING SENT · Awaiting owner approval',
    demoBadge: 'DEMO',
    intakeDraftBadge: 'CSV draft',
    importStatus: (a, s, e) => `Imported: ${a} · skipped: ${s} · errors: ${e}`,
    triageImportStatus: (a, e) => `Imported: ${a} · errors: ${e}`,
    viewCase: 'View',
    // Revenue-first: shortest path to the first paying client. Fee model is
    // UNDECIDED — shown as a pending state, never as payment collection.
    feeBanner:
      '💰 Fee model: pending your decision — no charges until you define it.',
    revenuePath: 'Path to first client',
    revenueSteps: [
      'Case (intake)',
      'Report reviewed',
      'Drafts',
      'Approval',
      'Results',
    ],
  },
};

const downloadText = (filename, text, mime = 'text/plain;charset=utf-8') => {
  try {
    if (
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function' ||
      typeof Blob === 'undefined' ||
      !document?.createElement
    ) {
      return false;
    }
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    if (typeof a.click === 'function') a.click();
    if (typeof a.remove === 'function') a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
};

const injectStyles = () => {
  if (typeof document === 'undefined' || !document.createElement) return;
  if (document.getElementById?.('gev-new850-styles')) return;
  const style = document.createElement('style');
  style.id = 'gev-new850-styles';
  style.textContent = `
    .gev-new850-float{position:fixed;right:14px;bottom:86px;z-index:60;min-width:64px;min-height:48px;padding:12px 18px;border-radius:999px;border:0;background:#0f766e;color:#fff;font-size:16px;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,.35);cursor:pointer}
    .gev-new850-root{position:fixed;inset:0;z-index:70;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.45);padding:0}
    .gev-new850-panel{background:#0b1220;color:#e5e7eb;width:100%;max-width:560px;max-height:92vh;display:flex;flex-direction:column;border-radius:16px 16px 0 0;overflow:hidden}
    .gev-new850-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #1f2937}
    .gev-new850-head strong{font-size:17px;flex:1}
    .gev-new850-head .sub{font-size:12px;color:#9ca3af;flex-basis:100%}
    .gev-new850-iconbtn{min-width:44px;min-height:44px;border-radius:10px;border:1px solid #374151;background:#111827;color:#e5e7eb;font-size:15px;cursor:pointer}
    .gev-new850-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px 16px}
    .gev-new850-kpi{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:10px 12px}
    .gev-new850-kpi .v{font-size:22px;font-weight:800}
    .gev-new850-kpi .l{font-size:12px;color:#9ca3af}
    .gev-new850-tabs{display:flex;gap:8px;padding:4px 16px;overflow-x:auto}
    .gev-new850-tab{flex:1 0 auto;min-height:56px;min-width:76px;padding:10px 12px;border-radius:14px;border:2px solid #1f2937;background:#111827;color:#d1d5db;font-size:15px;font-weight:700;white-space:nowrap;cursor:pointer}
    .gev-new850-tab--active{background:#0f766e;border-color:#0f766e;color:#fff}
    .gev-new850-body{flex:1;overflow-y:auto;padding:12px 16px 20px;border-top:1px solid #1f2937;min-height:200px}
    .gev-new850-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
    .gev-new850-btn{min-height:44px;padding:10px 14px;border-radius:10px;border:1px solid #0f766e;background:#0f766e;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
    .gev-new850-btn--ghost{background:#111827;border-color:#374151}
    .gev-new850-btn--approve{background:#065f46;border-color:#065f46;flex:1;font-size:16px;min-height:52px}
    .gev-new850-btn--reject{background:#7f1d1d;border-color:#7f1d1d;flex:1;font-size:16px;min-height:52px}
    .gev-new850-card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px;margin-bottom:10px}
    .gev-new850-card .row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .gev-new850-card .t{font-size:15px;font-weight:700}
    .gev-n850-chip{display:inline-block;min-height:24px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;margin:2px 4px 2px 0}
    .gev-n850-chip--ok{background:#064e3b;color:#a7f3d0}
    .gev-n850-chip--soon{background:#78350f;color:#fde68a}
    .gev-n850-chip--over{background:#7f1d1d;color:#fecaca}
    .gev-n850-chip--stage{background:#1e3a8a;color:#bfdbfe}
    .gev-new850-safety{background:#052e16;border:1px solid #10b981;color:#a7f3d0;font-size:13px;font-weight:700;padding:10px 12px;border-radius:10px;margin-bottom:10px}
    .gev-new850-draftbanner{background:#78350f;color:#fde68a;font-size:13px;font-weight:700;padding:10px 12px;border-radius:10px;margin-bottom:10px}
    .gev-new850-status{font-size:13px;color:#9ca3af;padding:8px 16px}
    .gev-new850-backdrop{position:fixed;inset:0;z-index:71;background:rgba(0,0,0,.5)}
    .gev-new850-drawer{position:fixed;left:0;right:0;bottom:0;z-index:72;background:#0b1220;color:#e5e7eb;max-width:560px;margin:0 auto;max-height:88vh;overflow-y:auto;border-radius:16px 16px 0 0;padding:16px}
    .gev-new850-drawer pre{white-space:pre-wrap;font-size:13px;background:#111827;border:1px solid #1f2937;border-radius:10px;padding:12px;max-height:40vh;overflow-y:auto}
    .gev-new850-input,.gev-new850-textarea,.gev-new850-select{width:100%;min-height:44px;border-radius:10px;border:1px solid #374151;background:#111827;color:#e5e7eb;padding:10px 12px;font-size:15px;margin:6px 0}
    .gev-new850-note{font-size:13px;color:#d1d5db;border-top:1px solid #1f2937;padding:8px 0}
    .gev-new850-note .meta{font-size:11px;color:#9ca3af}
    .gev-new850-filterrow{display:flex;gap:6px;overflow-x:auto;margin-bottom:10px}
    .gev-new850-filter{flex:1 0 auto;min-height:44px;padding:8px 12px;border-radius:999px;border:1px solid #374151;background:#111827;color:#d1d5db;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
    .gev-new850-filter--active{background:#0f766e;border-color:#0f766e;color:#fff}
    .gev-new850-feebanner{background:#3b2f0b;border:1px solid #d97706;color:#fef3c7;font-size:13px;font-weight:700;padding:10px 12px;border-radius:10px;margin:0 16px 10px}
    .gev-new850-revenue{display:flex;align-items:center;gap:6px;margin:6px 0;font-size:13px}
    .gev-new850-revenue .dots{display:flex;gap:4px}
    .gev-new850-revenue .dot{width:12px;height:12px;border-radius:50%;background:#374151}
    .gev-new850-revenue .dot--done{background:#10b981}
  `;
  (document.head || document.body).appendChild(style);
};

// Default stores bound to localStorage in browsers; in Node (tests) the
// memory backend of each store is used automatically.
const defaultCaseStore = createNew850Store();
const defaultApprovalStore = createApprovalStore();
const defaultTriageStore = createTriageStore();

/** Map a case-store draft kind + round to an approval kind. */
const approvalKindFor = (draftKind, round) => {
  if (draftKind === 'dispute-letter') {
    const r = [1, 2, 3].includes(Number(round)) ? Number(round) : 1;
    return `dispute-letter-r${r}`;
  }
  if (draftKind === 'furnisher-letter') return 'furnisher-letter';
  if (draftKind === 'cfpb-complaint') return 'cfpb-complaint';
  return 'customer-message';
};

export function initNew850Dashboard(options = {}) {
  const store = options.caseStore || defaultCaseStore;
  const approvals = options.approvalStore || defaultApprovalStore;
  const triage = options.triageStore || defaultTriageStore;
  const parseCsv = options.parseCsv || parseCaseCsv;
  const workforce = createNew850Workforce({
    caseStore: store,
    approvalStore: approvals,
    triageStore: triage,
  });
  const refs = {};
  const state = {
    view: 'approvals',
    lang: options.lang || 'es',
    drawerCaseId: null,
    approvalFilter: 'pending',
    workforceBoard: null,
  };

  const t = (key, ...args) => {
    const v = STRINGS[state.lang]?.[key] ?? STRINGS.es[key];
    return typeof v === 'function' ? v(...args) : v;
  };

  const mk = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  const approvalKindLabel = (kind) =>
    NEW850_APPROVAL_KIND_LABELS[kind]?.[state.lang] || kind;

  // ---------- KPIs ----------

  const renderKpis = () => {
    if (!refs.kpis) return;
    const stats = store.stats();
    const approvalStats = approvals.stats('new850');
    const cases = store.listCases();
    const activeDeadlines = cases.filter((c) =>
      (c.rounds || []).some((r) => windowStatus(r.deadlineAt) !== 'unknown'),
    ).length;
    const dormant = dormantCases(cases, {
      inactivityDays: DORMANT_AFTER_DAYS,
    }).length;
    refs.kpis.innerHTML = `
      <div class="gev-new850-kpi"><div class="v">${approvalStats.pending}</div><div class="l">${esc(t('kpiApprovals'))}</div></div>
      <div class="gev-new850-kpi"><div class="v">${stats.openCases}</div><div class="l">${esc(t('kpiOpen'))}</div></div>
      <div class="gev-new850-kpi"><div class="v">${activeDeadlines}</div><div class="l">${esc(t('kpiDeadlines'))}</div></div>
      <div class="gev-new850-kpi"><div class="v">${dormant}</div><div class="l">${esc(t('kpiDormant'))}</div></div>`;
  };

  // ---------- 1. APPROVAL QUEUE (the core) ----------

  const decideApproval = (id, decision, note) => {
    // TAP-ONLY decision: records the decision, never executes anything.
    const item =
      decision === 'approved'
        ? approvals.approveApproval(id, note)
        : approvals.rejectApproval(id, note);
    renderPanel();
    return item;
  };

  const renderApprovalQueue = () => {
    const filter = state.approvalFilter;
    const filters = ['pending', 'approved', 'rejected', 'audit'];
    const filterRow = mk('div', 'gev-new850-filterrow');
    refs.approvalFilterBtns = {};
    for (const f of filters) {
      const key =
        f === 'pending'
          ? 'filterPending'
          : f === 'approved'
            ? 'filterApproved'
            : f === 'rejected'
              ? 'filterRejected'
              : 'filterAudit';
      const btn = mk(
        'button',
        `gev-new850-filter${f === filter ? ' gev-new850-filter--active' : ''}`,
        esc(t(key)),
      );
      btn.addEventListener('click', () => {
        state.approvalFilter = f;
        renderView();
      });
      filterRow.appendChild(btn);
      refs.approvalFilterBtns[f] = btn;
    }

    const wrap = mk('div', '');
    wrap.appendChild(filterRow);
    const safety = mk(
      'div',
      'gev-new850-safety',
      `⚠️ ${esc(t('safetyBanner'))}`,
    );
    wrap.appendChild(safety);

    if (filter === 'audit') {
      const log = approvals.getAuditLog().slice().reverse();
      if (!log.length) {
        const p = mk('p', 'gev-new850-status', esc(t('emptyApprovals')));
        wrap.appendChild(p);
      } else {
        for (const e of log) {
          const card = mk('div', 'gev-new850-card');
          card.innerHTML = `
            <div class="row"><span class="t">${esc(approvalKindLabel(e.kind))}</span>${approvalStatusChip(e.action === 'created' ? 'pending' : e.action, state.lang)}</div>
            <div class="gev-new850-note"><div class="meta">${esc(fmtDate(e.t))} · ${esc(t('decidedByJuan'))}</div>${e.note ? esc(e.note) : ''}</div>`;
          wrap.appendChild(card);
        }
      }
      refs.viewBody.innerHTML = '';
      refs.viewBody.appendChild(wrap);
      return;
    }

    const items = approvals.listApprovals('new850', filter);
    if (!items.length) {
      wrap.appendChild(mk('p', 'gev-new850-status', esc(t('emptyApprovals'))));
    }
    refs.approvalActions = [];
    for (const item of items) {
      const card = mk('div', 'gev-new850-card');
      const payload = item.payload || {};
      card.innerHTML = `
        <div class="gev-new850-draftbanner">${esc(t('draftBanner'))}</div>
        <div class="row"><span class="t">${esc(approvalKindLabel(item.kind))}</span>${approvalStatusChip(item.status, state.lang)}</div>
        <div style="font-size:14px;font-weight:600;margin:4px 0">${esc(item[state.lang === 'es' ? 'titleEs' : 'titleEn'] || item.titleEs)}</div>
        <div style="font-size:13px;color:#9ca3af">${esc(item[state.lang === 'es' ? 'summaryEs' : 'summaryEn'] || '')}</div>
        <div class="gev-new850-note"><div class="meta">${payload.caseRef ? esc(payload.caseRef) + ' · ' : ''}${esc(fmtDate(item.createdAt))}${item.decidedAt ? ` · ${esc(t('decidedByJuan'))} ${esc(fmtDate(item.decidedAt))}` : ''}</div>${item.note ? esc(item.note) : ''}</div>`;
      if (item.status === 'pending') {
        const noteInput = mk('input', 'gev-new850-input', '');
        noteInput.placeholder = t('noteOptional');
        noteInput.setAttribute('aria-label', t('noteOptional'));
        const row = mk('div', 'row');
        row.style.display = 'flex';
        row.style.gap = '8px';
        const approveBtn = mk(
          'button',
          'gev-new850-btn gev-new850-btn--approve',
          `✓ ${esc(t('approve'))}`,
        );
        const rejectBtn = mk(
          'button',
          'gev-new850-btn gev-new850-btn--reject',
          `✕ ${esc(t('reject'))}`,
        );
        approveBtn.addEventListener('click', () =>
          decideApproval(item.id, 'approved', noteInput.value),
        );
        rejectBtn.addEventListener('click', () =>
          decideApproval(item.id, 'rejected', noteInput.value),
        );
        row.appendChild(approveBtn);
        row.appendChild(rejectBtn);
        card.appendChild(noteInput);
        card.appendChild(row);
        refs.approvalActions.push({
          id: item.id,
          noteInput,
          approveBtn,
          rejectBtn,
        });
      }
      wrap.appendChild(card);
    }
    refs.viewBody.innerHTML = '';
    refs.viewBody.appendChild(wrap);
  };

  // ---------- 2. PIPELINE MANAGEMENT ----------

  const startRound = (caseId, round) => {
    const c = store.getCase(caseId);
    if (!c) return null;
    const win = investigationWindow(new Date().toISOString());
    if (!win) return null;
    store.setRound(caseId, {
      round,
      startedAt: win.startedAt,
      deadlineAt: win.deadlineAt,
      windowDays: win.days,
      status: 'active',
    });
    store.moveCase(caseId, `round-${round}`);
    renderPanel();
    if (state.drawerCaseId === caseId) renderDrawer();
    return win;
  };

  const advanceCase = (caseId) => {
    const c = store.getCase(caseId);
    if (!c) return null;
    const rec = nextRoundRecommendation(c);
    if (rec.recommendedRound) {
      return startRound(caseId, rec.recommendedRound);
    }
    // No round to advance: move forward in the wait/escalation flow.
    const flow = {
      'round-1': 'round-1-wait',
      'round-1-wait': 'round-2',
      'round-2': 'round-2-wait',
      'round-2-wait': 'round-3',
      'round-3': 'round-3-wait',
      'round-3-wait': 'escalation-draft',
    };
    const next = flow[c.stage];
    if (next) {
      store.moveCase(caseId, next);
      renderPanel();
      if (state.drawerCaseId === caseId) renderDrawer();
      return next;
    }
    return null;
  };

  // Revenue-first: per-case progress on the shortest path to the first
  // paying client: intake → report review → dispute drafts → approval →
  // results tracking.
  const revenueRowHtml = (caseObj) => {
    const path = revenuePathFor(caseObj, approvals);
    const labels = t('revenueSteps');
    const dots = path.steps
      .map((s, i) => {
        const tip = esc(labels[i] || s.id);
        return `<span class="dot${s.done ? ' dot--done' : ''}" title="${tip}"></span>`;
      })
      .join('');
    return `<div class="gev-new850-revenue"><span class="dots">${dots}</span><span>${esc(t('revenuePath'))}: ${path.done}/${path.total}</span></div>`;
  };

  const renderCaseList = () => {
    const cases = store.listCases();
    const wrap = mk('div', '');

    // Dormant nudges surfaced at the top.
    const dormant = dormantCases(cases, { inactivityDays: DORMANT_AFTER_DAYS });
    refs.dormantActions = [];
    if (dormant.length) {
      const dTitle = mk(
        'div',
        't',
        `<strong>${esc(t('dormantTitle'))}</strong>`,
      );
      dTitle.style.margin = '4px 0 8px';
      wrap.appendChild(dTitle);
      for (const d of dormant) {
        const card = mk('div', 'gev-new850-card');
        card.innerHTML = `
          <div class="row"><span class="t">${esc(d.caseRef)}</span>
          <span class="gev-n850-chip gev-n850-chip--over">${esc(d.label[state.lang])}</span></div>
          <div class="row"><span>${esc(d.clientLabel || '')}</span></div>`;
        const btn = mk(
          'button',
          'gev-new850-btn gev-new850-btn--ghost',
          esc(t('markReviewed')),
        );
        btn.addEventListener('click', () => {
          // Nudge = Juan reviews; records a note (no external send).
          store.addNote(d.caseId, 'juan', 'Revisado por Juan.', 'Reviewed by Juan.');
          renderPanel();
        });
        card.appendChild(btn);
        wrap.appendChild(card);
        refs.dormantActions.push({ caseId: d.caseId, btn });
      }
    }

    if (!cases.length) {
      wrap.appendChild(mk('p', 'gev-new850-status', esc(t('emptyCases'))));
    }
    for (const c of cases) {
      const rec = nextRoundRecommendation(c);
      const seq = roundSequence(c);
      const card = mk('div', 'gev-new850-card');
      card.innerHTML = `
        <div class="row"><span class="t">${esc(c.ref)} · ${esc(c.clientLabel || '—')}</span>${stageChip(c.stage, state.lang)}</div>
        <div class="row"><span>${esc(c.phoneMasked || '***')}</span>
          ${c.demo ? `<span class="gev-n850-chip gev-n850-chip--stage">${esc(t('demoBadge'))}</span>` : ''}
          ${c.intakeDraft ? `<span class="gev-n850-chip gev-n850-chip--soon">${esc(t('intakeDraftBadge'))}</span>` : ''}
        </div>
        ${revenueRowHtml(c)}
        <div style="margin:6px 0">${seq
          .map((r) =>
            r.started
              ? `<div style="font-size:13px;margin:2px 0">R${r.round}: ${esc(fmtDate(r.window.startedAt))} → ${esc(fmtDate(r.window.deadlineAt))} ${deadlineChip(r.window.deadlineAt, state.lang)}</div>`
              : '',
          )
          .join('')}</div>
        <div class="row"><span>${esc((c.disputes || []).length)} disputes${rec.recommendedRound ? ` · → R${rec.recommendedRound}` : ''}</span></div>`;
      const row = mk('div', 'row');
      row.style.display = 'flex';
      row.style.gap = '8px';
      const advBtn = mk(
        'button',
        'gev-new850-btn',
        `⏩ ${esc(t('advance'))}`,
      );
      advBtn.addEventListener('click', () => advanceCase(c.id));
      const viewBtn = mk(
        'button',
        'gev-new850-btn gev-new850-btn--ghost',
        esc(t('viewCase')),
      );
      viewBtn.addEventListener('click', () => openCase(c.id));
      row.appendChild(advBtn);
      row.appendChild(viewBtn);
      card.appendChild(row);
      wrap.appendChild(card);
    }

    // Toolbar: new case + CSV import/export.
    const toolbar = mk('div', 'gev-new850-toolbar');
    refs.newCaseBtn = mk('button', 'gev-new850-btn', `＋ ${esc(t('newCase'))}`);
    refs.newCaseBtn.addEventListener('click', () => {
      store.createCase({ clientLabel: '—', intakeDraft: true });
      renderPanel();
    });
    refs.importBtn = mk(
      'button',
      'gev-new850-btn gev-new850-btn--ghost',
      esc(t('import')),
    );
    refs.importBtn.addEventListener('click', () => {
      if (refs.fileInput?.click) refs.fileInput.click();
    });
    refs.exportBtn = mk(
      'button',
      'gev-new850-btn gev-new850-btn--ghost',
      esc(t('export')),
    );
    refs.exportBtn.addEventListener('click', () =>
      downloadText('new850-cases.csv', exportCsvText(), 'text/csv;charset=utf-8'),
    );
    refs.templateBtn = mk(
      'button',
      'gev-new850-btn gev-new850-btn--ghost',
      esc(t('template')),
    );
    refs.templateBtn.addEventListener('click', () =>
      downloadText('new850-template.csv', sampleCsvTemplate(), 'text/csv;charset=utf-8'),
    );
    refs.screenBtn = mk(
      'a',
      'gev-new850-btn gev-new850-btn--ghost',
      esc(t('openScreen')),
    );
    refs.screenBtn.href = new850DeepLink('casos');
    refs.screenBtn.style.textDecoration = 'none';
    refs.screenBtn.style.display = 'inline-flex';
    refs.screenBtn.style.alignItems = 'center';
    for (const b of [
      refs.newCaseBtn,
      refs.importBtn,
      refs.exportBtn,
      refs.templateBtn,
      refs.screenBtn,
    ]) {
      toolbar.appendChild(b);
    }
    wrap.appendChild(toolbar);
    refs.importStatus = mk('div', 'gev-new850-status', '');
    refs.importStatus.setAttribute('role', 'status');
    wrap.appendChild(refs.importStatus);

    refs.viewBody.innerHTML = '';
    refs.viewBody.appendChild(wrap);
  };

  // ---------- 3. INBOUND TRIAGE ----------

  const importTriageText = (text) => {
    const res = triage.importJson(text);
    if (refs.triageStatus) {
      refs.triageStatus.textContent = t(
        'triageImportStatus',
        res.added,
        res.errors.length,
      );
    }
    renderPanel();
    return res;
  };

  const renderTriage = () => {
    const wrap = mk('div', '');
    const items = triage.listTriage();
    refs.triageActions = [];

    if (!items.length) {
      const empty = mk('div', 'gev-new850-card');
      empty.innerHTML = `<p style="font-size:14px">${esc(t('emptyTriage'))}</p>`;
      wrap.appendChild(empty);
    }
    for (const item of items) {
      const card = mk('div', 'gev-new850-card');
      card.innerHTML = `
        <div class="row"><span class="t">WhatsApp · ${esc(item.senderMasked || '***')}</span>
        <span class="gev-n850-chip ${item.status === 'new' ? 'gev-n850-chip--soon' : 'gev-n850-chip--stage'}">${esc(TRIAGE_STATUS_LABELS[item.status]?.[state.lang] || item.status)}</span></div>
        <div style="font-size:14px;margin:6px 0">${esc(item.message || '')}</div>
        <div class="gev-new850-note"><div class="meta">${esc(fmtDate(item.receivedAt))}${item.caseId ? ` · → ${esc(item.caseId)}` : ''}</div>${item.notes ? esc(item.notes) : ''}</div>`;
      const row = mk('div', 'row');
      row.style.display = 'flex';
      row.style.gap = '8px';
      const reviewBtn = mk(
        'button',
        'gev-new850-btn gev-new850-btn--ghost',
        esc(t('triageReview')),
      );
      reviewBtn.addEventListener('click', () => {
        triage.setStatus(item.id, 'reviewed');
        renderPanel();
      });
      const convertBtn = mk(
        'button',
        'gev-new850-btn',
        esc(t('triageConvert')),
      );
      convertBtn.addEventListener('click', () => {
        // Convert: create an intake-draft case from the inquiry (no send).
        const created = store.createCase({
          clientLabel: item.senderMasked || '—',
          phoneMasked: item.senderMasked,
          notes: item.message,
          intakeDraft: true,
        });
        triage.linkCase(item.id, created.id);
        renderPanel();
      });
      const dismissBtn = mk(
        'button',
        'gev-new850-btn gev-new850-btn--ghost',
        esc(t('triageDismiss')),
      );
      dismissBtn.addEventListener('click', () => {
        triage.setStatus(item.id, 'dismissed');
        renderPanel();
      });
      row.appendChild(reviewBtn);
      row.appendChild(convertBtn);
      row.appendChild(dismissBtn);
      card.appendChild(row);
      wrap.appendChild(card);
      refs.triageActions.push({ id: item.id, reviewBtn, convertBtn, dismissBtn });
    }

    // Import tools.
    const impTitle = mk('div', 't', `<strong>${esc(t('importJson'))}</strong>`);
    impTitle.style.margin = '8px 0';
    wrap.appendChild(impTitle);
    refs.triageTextarea = mk('textarea', 'gev-new850-textarea', '');
    refs.triageTextarea.placeholder = t('pasteJson');
    refs.triageTextarea.setAttribute('aria-label', t('importJson'));
    wrap.appendChild(refs.triageTextarea);
    const row = mk('div', 'gev-new850-toolbar');
    refs.triageImportBtn = mk('button', 'gev-new850-btn', esc(t('importJson')));
    refs.triageImportBtn.addEventListener('click', () =>
      importTriageText(refs.triageTextarea.value),
    );
    refs.triageTemplateBtn = mk(
      'button',
      'gev-new850-btn gev-new850-btn--ghost',
      esc(t('templateJson')),
    );
    refs.triageTemplateBtn.addEventListener('click', () => {
      refs.triageTextarea.value = sampleTriageTemplate();
    });
    refs.triageExportBtn = mk(
      'button',
      'gev-new850-btn gev-new850-btn--ghost',
      esc(t('exportJson')),
    );
    refs.triageExportBtn.addEventListener('click', () =>
      downloadText(
        'new850-triage.json',
        exportTriageJson(triage.listTriage()),
        'application/json;charset=utf-8',
      ),
    );
    for (const b of [
      refs.triageImportBtn,
      refs.triageTemplateBtn,
      refs.triageExportBtn,
    ]) {
      row.appendChild(b);
    }
    wrap.appendChild(row);
    refs.triageStatus = mk('div', 'gev-new850-status', '');
    refs.triageStatus.setAttribute('role', 'status');
    wrap.appendChild(refs.triageStatus);

    refs.viewBody.innerHTML = '';
    refs.viewBody.appendChild(wrap);
  };

  // ---------- 4. WORKFORCE OVERSIGHT ----------

  const renderWorkforce = (autoRun = true) => {
    if (autoRun || !state.workforceBoard) {
      state.workforceBoard = workforce.runChecks();
    }
    const board = state.workforceBoard;
    const wrap = mk('div', '');
    const note = mk(
      'div',
      'gev-new850-status',
      esc(WORKFORCE_NOTE[state.lang] || WORKFORCE_NOTE.es),
    );
    wrap.appendChild(note);
    const row = mk('div', 'gev-new850-toolbar');
    refs.workforceRunBtn = mk('button', 'gev-new850-btn', `▶ ${esc(t('runChecks'))}`);
    refs.workforceRunBtn.addEventListener('click', () => {
      state.workforceBoard = workforce.runChecks();
      renderView();
    });
    row.appendChild(refs.workforceRunBtn);
    wrap.appendChild(row);
    refs.workforceCards = [];
    for (const a of board.agents) {
      const card = mk('div', 'gev-new850-card');
      const statusChip =
        a.status === 'attention'
          ? `<span class="gev-n850-chip gev-n850-chip--soon">${esc(t('workforceAttention'))}</span>`
          : `<span class="gev-n850-chip gev-n850-chip--ok">${esc(t('workforceIdle'))}</span>`;
      card.innerHTML = `
        <div class="row"><span class="t">${esc(a.name[state.lang] || a.name.es)}</span>${statusChip}</div>
        <div style="font-size:13px;color:#9ca3af;margin:4px 0">${esc(a.desc[state.lang] || a.desc.es)}</div>
        <div style="font-size:13px"><strong>${esc(t('lastCheck'))}:</strong> ${esc(a.lastSummary[state.lang] || '')}${a.lastRun ? ` · ${esc(fmtDate(a.lastRun))}` : ''}</div>
        ${
          a.needsJuan.length
            ? `<div style="margin-top:6px"><strong>${esc(t('needsJuan'))}:</strong><ul style="margin:4px 0;padding-left:18px;font-size:13px">${a.needsJuan
                .map((n) => `<li>${esc(n[state.lang] || n.es)}</li>`)
                .join('')}</ul></div>`
            : ''
        }`;
      wrap.appendChild(card);
      refs.workforceCards.push({ id: a.id, card });
    }
    refs.viewBody.innerHTML = '';
    refs.viewBody.appendChild(wrap);
  };

  // ---------- view switching ----------

  const renderView = () => {
    if (!refs.viewBody) return;
    if (state.view === 'approvals') renderApprovalQueue();
    else if (state.view === 'cases') renderCaseList();
    else if (state.view === 'triage') renderTriage();
    else if (state.view === 'workforce') renderWorkforce();
    for (const [id, btn] of Object.entries(refs.tabs || {})) {
      if (btn?.classList?.toggle) {
        btn.classList.toggle('gev-new850-tab--active', id === state.view);
      }
    }
  };

  const setView = (view) => {
    if (!NEW850_VIEWS.includes(view)) return state.view;
    state.view = view;
    if (refs.root) renderView();
    return state.view;
  };

  const renderPanel = () => {
    renderKpis();
    renderView();
  };

  // ---------- case drawer ----------

  const renderDrawer = () => {
    const c = state.drawerCaseId ? store.getCase(state.drawerCaseId) : null;
    if (!c || !refs.drawer) return;
    refs.drawerTitle.textContent = `${c.ref} · ${c.clientLabel || '—'}`;
    const rec = nextRoundRecommendation(c);
    const seq = roundSequence(c);

    const stageOptions = STAGES.map(
      (s) =>
        `<option value="${esc(s)}"${s === c.stage ? ' selected' : ''}>${esc(STAGE_LABELS[s][state.lang] || s)}</option>`,
    ).join('');

    const disputesHtml = (c.disputes || [])
      .map(
        (d) => `<div class="gev-new850-card">
        <div class="row"><span class="t">${esc(d.item || '—')}</span>${disputeChip(d.status, state.lang)}</div>
        <div>${esc(d.creditor || '')} · R${d.round || 1}</div>
        <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button class="gev-new850-btn gev-new850-btn--ghost" data-draft="dispute-letter" data-dispute="${esc(d.id)}">${esc(t('draftFor', DRAFT_KIND_LABELS['dispute-letter'][state.lang]))}</button>
          <button class="gev-new850-btn gev-new850-btn--ghost" data-draft="furnisher-letter" data-dispute="${esc(d.id)}">${esc(t('draftFor', DRAFT_KIND_LABELS['furnisher-letter'][state.lang]))}</button>
        </div>
      </div>`,
      )
      .join('');

    const roundsHtml = seq
      .map((r) =>
        r.started
          ? `<div style="font-size:13px;margin:4px 0">R${r.round}: ${esc(fmtDate(r.window.startedAt))} → ${esc(fmtDate(r.window.deadlineAt))} · ${r.window.days}d ${deadlineChip(r.window.deadlineAt, state.lang)}</div>`
          : `<div style="font-size:13px;color:#9ca3af;margin:4px 0">R${r.round}: —</div>`,
      )
      .join('');

    const draftsHtml = (c.drafts || [])
      .map((dr) => {
        const issues = complianceIssues({
          text: dr.text,
          disputes: c.disputes || [],
          kind: dr.kind,
        });
        return `<div class="gev-new850-card">
        <div class="gev-new850-draftbanner">${esc(t('draftBanner'))}</div>
        <div class="row"><span class="t">${esc(DRAFT_KIND_LABELS[dr.kind]?.[state.lang] || dr.kind)}</span><span>${esc(dr.target || '')}</span></div>
        <pre>${esc(dr.text || '')}</pre>
        ${issues.length ? `<div class="gev-new850-note"><strong>${esc(t('complianceTitle'))}:</strong> ${issues.map((i) => esc(i[state.lang] || i.es)).join(' · ')}</div>` : ''}
      </div>`;
      })
      .join('');

    const notesHtml = (c.agentNotes || [])
      .map(
        (n) => `<div class="gev-new850-note"><div class="meta">${esc(n.agent || '')} · ${esc(fmtDate(n.at))}</div>${esc(n.es || n.en || '')}</div>`,
      )
      .join('');

    refs.drawerBody.innerHTML = `
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <span>${stageChip(c.stage, state.lang)}</span>
        <span>${esc(c.phoneMasked || '***')}</span>
      </div>
      <div style="margin:8px 0">
        <label style="font-size:13px;color:#9ca3af">${esc(t('moveTo'))}</label>
        <select class="gev-new850-select" data-stage-select="1">${stageOptions}</select>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button class="gev-new850-btn" data-advance="1">⏩ ${esc(t('advance'))}</button>
          ${[1, 2, 3]
            .map(
              (r) =>
                `<button class="gev-new850-btn gev-new850-btn--ghost" data-start-round="${r}">${esc(t('startRound', r))}</button>`,
            )
            .join('')}
        </div>
      </div>
      <div style="margin:8px 0"><strong style="font-size:14px">FCRA</strong>${roundsHtml}</div>
      <p style="font-size:13px;color:#9ca3af">${esc(rec.reason[state.lang] || '')}</p>
      ${disputesHtml}
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
        <button class="gev-new850-btn gev-new850-btn--ghost" data-draft="cfpb-complaint">${esc(t('cfpbDraft'))}</button>
      </div>
      <div>
        <div class="t" style="font-weight:700;margin:8px 0">${esc(t('msgDraft'))}</div>
        <textarea class="gev-new850-textarea" placeholder="${esc(t('msgPlaceholder'))}"></textarea>
        <button class="gev-new850-btn" data-draft="customer-message">${esc(t('sendMsgDraft'))}</button>
      </div>
      ${draftsHtml}
      <div class="t" style="font-weight:700;margin:12px 0 4px">Notes</div>
      <div>${notesHtml}</div>
      <textarea class="gev-new850-textarea" placeholder="${esc(t('notePlaceholder'))}"></textarea>
      <button class="gev-new850-btn" data-note-add="1">${esc(t('addNote'))}</button>`;

    // Wire drawer controls (event delegation for draft/note buttons).
    const body = refs.drawerBody;
    if (body._n850wired !== true) {
      body._n850wired = true;
      body.addEventListener('click', (ev) => {
        const btn =
          ev?.target?.closest?.(
            '[data-draft],[data-note-add],[data-advance],[data-start-round]',
          ) || null;
        if (!btn || !state.drawerCaseId) return;
        if (btn.getAttribute('data-note-add')) {
          handleAddNote();
          return;
        }
        if (btn.getAttribute('data-advance')) {
          advanceCase(state.drawerCaseId);
          return;
        }
        const sr = btn.getAttribute('data-start-round');
        if (sr) {
          startRound(state.drawerCaseId, Number(sr));
          return;
        }
        const kind = btn.getAttribute('data-draft');
        if (kind) handleDraft(kind, btn.getAttribute('data-dispute'));
      });
      body.addEventListener('change', (ev) => {
        const sel = ev?.target?.closest?.('[data-stage-select]') || null;
        if (!sel || !state.drawerCaseId) return;
        store.moveCase(state.drawerCaseId, sel.value);
        renderPanel();
        renderDrawer();
      });
    }
  };

  const openCase = (caseId) => {
    if (!store.getCase(caseId)) return false;
    state.drawerCaseId = caseId;
    if (!refs.backdrop) {
      refs.backdrop = mk('div', 'gev-new850-backdrop');
      refs.backdrop.addEventListener('click', closeDrawer);
      document.body.appendChild(refs.backdrop);
      refs.drawer = mk('div', 'gev-new850-drawer');
      const head = mk('div', 'gev-new850-head');
      refs.drawerTitle = mk('strong', '', '');
      refs.backBtn = mk(
        'button',
        'gev-new850-iconbtn',
        `‹ ${esc(t('back'))}`,
      );
      refs.backBtn.addEventListener('click', closeDrawer);
      head.appendChild(refs.drawerTitle);
      head.appendChild(refs.backBtn);
      refs.drawer.appendChild(head);
      refs.drawerBody = mk('div', 'gev-new850-body');
      refs.drawer.appendChild(refs.drawerBody);
      document.body.appendChild(refs.drawer);
    }
    renderDrawer();
    return true;
  };

  const closeDrawer = () => {
    state.drawerCaseId = null;
    for (const k of ['backdrop', 'drawer']) {
      if (refs[k]?.remove) refs[k].remove();
      refs[k] = null;
    }
    refs.drawerTitle = refs.drawerBody = refs.backBtn = null;
  };

  const queueApprovalForDraft = (caseObj, draft, draftKind, dispute) => {
    // Bridge every new draft into the approval queue.
    // Dedupe: one pending approval per (kind, case, dispute).
    const kind = approvalKindFor(draftKind, dispute?.round);
    const already = approvals
      .listApprovals('new850', 'pending')
      .some(
        (a) =>
          a.kind === kind &&
          a.payload?.caseId === caseObj.id &&
          (a.payload?.disputeId || null) === (dispute?.id || null),
      );
    if (already) return null;
    const kindLabel = NEW850_APPROVAL_KIND_LABELS[kind] || {};
    return approvals.createApproval('new850', {
      kind,
      titleEs: `${kindLabel.es || kind} — ${caseObj.ref}`,
      titleEn: `${kindLabel.en || kind} — ${caseObj.ref}`,
      summaryEs: dispute
        ? `${dispute.item || ''} · ${dispute.creditor || ''}`.trim()
        : draft.target || '',
      summaryEn: dispute
        ? `${dispute.item || ''} · ${dispute.creditor || ''}`.trim()
        : draft.target || '',
      payload: {
        caseId: caseObj.id,
        caseRef: caseObj.ref,
        draftId: draft.id,
        disputeId: dispute?.id || null,
        bureau: draftKind === 'dispute-letter' ? draft.target : undefined,
      },
    });
  };

  const handleDraft = (kind, disputeId) => {
    const c = state.drawerCaseId ? store.getCase(state.drawerCaseId) : null;
    if (!c) return null;
    const dispute = disputeId ? store.getDispute(c.id, disputeId) : null;
    let built;
    let target;
    if (kind === 'dispute-letter' && dispute) {
      for (const bureau of dispute.bureaus?.length
        ? dispute.bureaus
        : c.bureaus) {
        const attempt = draftDisputeLetter({
          caseObj: c,
          dispute,
          bureau,
          lang: state.lang,
        });
        if (!attempt.error) {
          built = attempt;
          target = bureau;
          break;
        }
        built = attempt;
      }
    } else if (kind === 'furnisher-letter' && dispute) {
      built = draftFurnisherLetter({ caseObj: c, dispute, lang: state.lang });
      target = dispute.creditor;
    } else if (kind === 'cfpb-complaint') {
      built = draftCfpbComplaint({
        caseObj: c,
        reason:
          state.lang === 'es'
            ? 'Ventana de investigación vencida / sin respuesta.'
            : 'Investigation window expired / no response.',
        lang: state.lang,
      });
      target = 'CFPB';
    } else if (kind === 'customer-message') {
      const ta = refs.drawerBody?.querySelector?.('textarea') || null;
      const body = ta?.value?.trim() || '';
      built = draftCustomerMessage({ caseObj: c, body, lang: state.lang });
      target = c.clientLabel;
    }
    if (!built || built.error) {
      return built || null;
    }
    const draft = store.addDraft(c.id, {
      kind,
      target: target || c.clientLabel,
      text: built.text,
      relatedDisputeId: dispute?.id || '',
    });
    // Every draft enters the approval queue — Juan's tap decides.
    queueApprovalForDraft(c, draft, kind, dispute);
    renderPanel();
    renderDrawer();
    return built;
  };

  const handleAddNote = () => {
    const c = state.drawerCaseId ? store.getCase(state.drawerCaseId) : null;
    if (!c) return;
    const ta = refs.drawerBody?.querySelectorAll?.('textarea')?.[1] || null;
    const body = ta?.value?.trim();
    if (!body) return;
    store.addNote(c.id, 'juan', body, body);
    renderDrawer();
  };

  // ---------- CSV import / export ----------

  const importCsvText = (text) => {
    const { cases, errors } = parseCsv(text);
    let added = 0;
    let skipped = 0;
    for (const row of cases) {
      const ref = String(row.ref || '').trim();
      if (ref && store.getCaseByRef(ref)) {
        skipped += 1;
        continue;
      }
      const created = store.createCase({
        clientLabel: row.clientLabel || row.ref || '—',
        phone: row.phone || '',
        bureaus: row.bureaus,
        notes: row.notes,
        demo: row.demo,
        intakeDraft: true,
      });
      for (const d of row.disputes || []) {
        store.addDispute(created.id, d);
      }
      added += 1;
    }
    if (refs.importStatus) {
      refs.importStatus.textContent = t(
        'importStatus',
        added,
        skipped,
        errors.length,
      );
    }
    renderPanel();
    return { added, skipped, errors };
  };

  const exportCsvText = () => {
    const header = ['ref', 'clientLabel', 'phoneMasked', 'stage', 'disputes'];
    const rows = store.listCases().map((c) =>
      [
        c.ref,
        c.clientLabel,
        c.phoneMasked,
        c.stage,
        (c.disputes || []).length,
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );
    return [header.join(','), ...rows].join('\n');
  };

  // ---------- panel shell ----------

  const buildPanelShell = () => {
    injectStyles();
    const root = mk('div', 'gev-new850-root');
    root.id = NEW850_ROOT_ID;
    const panel = mk('div', 'gev-new850-panel');

    const head = mk('div', 'gev-new850-head');
    const titleWrap = mk('div', '', '');
    titleWrap.style.flex = '1';
    const strong = mk('strong', '', esc(t('title')));
    const sub = mk('div', 'sub', esc(t('subtitle')));
    titleWrap.appendChild(strong);
    titleWrap.appendChild(sub);
    refs.langBtn = mk('button', 'gev-new850-iconbtn', esc(t('lang')));
    refs.langBtn.setAttribute('aria-label', 'Idioma / Language');
    refs.langBtn.addEventListener('click', () =>
      setLang(state.lang === 'es' ? 'en' : 'es'),
    );
    refs.closeBtn = mk('button', 'gev-new850-iconbtn', '✕');
    refs.closeBtn.setAttribute('aria-label', t('close'));
    refs.closeBtn.addEventListener('click', closePanel);
    head.appendChild(titleWrap);
    head.appendChild(refs.langBtn);
    head.appendChild(refs.closeBtn);
    panel.appendChild(head);

    refs.kpis = mk('div', 'gev-new850-kpis');
    panel.appendChild(refs.kpis);

    const tabsWrap = mk('div', 'gev-new850-tabs');
    tabsWrap.setAttribute('role', 'tablist');
    refs.tabs = {};
    for (const [id, key] of [
      ['approvals', 'tabApprovals'],
      ['cases', 'tabCases'],
      ['triage', 'tabTriage'],
      ['workforce', 'tabWorkforce'],
    ]) {
      const btn = mk('button', 'gev-new850-tab', esc(t(key)));
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => setView(id));
      tabsWrap.appendChild(btn);
      refs.tabs[id] = btn;
    }
    panel.appendChild(tabsWrap);

    // Revenue-first gate: the fee model is UNDECIDED. Show a prominent
    // pending state on every view; never build payment collection.
    refs.feeBanner = mk('div', 'gev-new850-feebanner', t('feeBanner'));
    panel.appendChild(refs.feeBanner);

    refs.viewBody = mk('div', 'gev-new850-body');
    panel.appendChild(refs.viewBody);

    refs.fileInput = mk('input', '', '');
    refs.fileInput.type = 'file';
    refs.fileInput.accept = '.csv,text/csv';
    refs.fileInput.style.display = 'none';
    refs.fileInput.addEventListener('change', () => {
      const file = refs.fileInput.files?.[0];
      if (!file?.text) return;
      file
        .text()
        .then((txt) => importCsvText(txt))
        .catch(() => {});
    });
    panel.appendChild(refs.fileInput);

    root.appendChild(panel);
    document.body.appendChild(root);
    refs.root = root;
  };

  // ---------- open / close / lifecycle ----------

  const open = () => {
    if (refs.root) {
      renderPanel();
      return;
    }
    buildPanelShell();
    for (const card of document.querySelectorAll?.(
      '.gev-business-card',
    ) || []) {
      if (card?.dataset?.business === 'new850' && !card.dataset.wired) {
        card.dataset.wired = '1';
        card.addEventListener('click', () => {
          window.location.href = new850DeepLink('aprobaciones');
        });
      }
    }
    renderPanel();
  };

  const openApprovals = () => {
    open();
    setView('approvals');
  };

  const closePanel = () => {
    closeDrawer();
    if (refs.root?.remove) refs.root.remove();
    const floatBtn = refs.floatBtn;
    for (const k of Object.keys(refs)) delete refs[k];
    if (floatBtn) refs.floatBtn = floatBtn;
  };

  const toggle = () => {
    if (refs.root) closePanel();
    else open();
  };

  const setLang = (lang) => {
    state.lang = lang === 'en' ? 'en' : 'es';
    try {
      localStorage.setItem('sahjony.gev.lang', state.lang);
    } catch {
      /* memory-only */
    }
    if (refs.root) {
      closePanel();
      open();
    }
    return state.lang;
  };

  const destroy = () => {
    closeDrawer();
    if (refs.floatBtn?.remove) refs.floatBtn.remove();
    if (refs.root?.remove) refs.root.remove();
    for (const k of Object.keys(refs)) delete refs[k];
    if (globalThis.__gevNew850 === api) globalThis.__gevNew850 = null;
  };

  const ensureFloat = () => {
    if (refs.floatBtn || document.getElementById?.(NEW850_FLOAT_ID)) return;
    const btn = mk('button', 'gev-new850-float', `📄 ${esc(t('float'))}`);
    btn.id = NEW850_FLOAT_ID;
    btn.type = 'button';
    btn.setAttribute(
      'aria-label',
      state.lang === 'es'
        ? 'Abrir New850 — Reparación de crédito'
        : 'Open New850 — Credit Repair',
    );
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
    refs.floatBtn = btn;
  };

  const api = {
    refs,
    open,
    openApprovals,
    toggle,
    destroy,
    closePanel,
    setLang,
    getLang: () => state.lang,
    setView,
    getView: () => state.view,
    openCase,
    closeDrawer,
    advanceCase,
    startRound,
    createDraft: (kind, disputeId) => handleDraft(kind, disputeId),
    decideApproval,
    importCsvText,
    exportCsvText,
    importTriageText,
    runWorkforceChecks: () => {
      state.workforceBoard = workforce.runChecks();
      if (state.view === 'workforce') renderView();
      return state.workforceBoard;
    },
    stats: () => store.stats(),
    listCases: () => store.listCases(),
    // Stores (single-operator: Juan is the only human; the AI workforce
    // only computes readouts and proposes drafts).
    caseStore: store,
    approvalStore: approvals,
    triageStore: triage,
    // DRAFT-ONLY: the console creates and reviews drafts and records
    // approval decisions; sending stays with Juan. No send/submit/transmit
    // function exists here by design.
  };

  ensureFloat();
  globalThis.__gevNew850 = api;
  return api;
}

export const __internals = {
  deadlineChip,
  stageChip,
  disputeChip,
  approvalStatusChip,
  downloadText,
  approvalKindFor,
  new850ViewFromHash,
  revenuePathFor,
  STRINGS,
};
