/**
 * New850 — AI workforce oversight (GOD'S EYE VIEW plugin).
 * ---------------------------------------------------------------------------
 * Status board for the New850 AI workforce. Pattern follows
 * src/agents/workforce.js: agents NEVER send, email, post, purchase, sign,
 * call, or text — they compute readouts and propose drafts; Juan taps every
 * decision.
 *
 * SINGLE-OPERATOR: Juan runs everything alone. These are AI agents, not
 * staff — there are no human team roles, no shared inboxes, no delegation.
 * "Needs Juan" means: items waiting for his tap (approvals, notes, review).
 *
 * Honest framing: the workforce runs ON DEMAND while the station is open
 * (runChecks) — nothing runs in the background. Statuses reflect the last
 * check, never fake activity.
 *
 * Roster:
 *   intake   — watches intake-draft cases + new triage inquiries.
 *   drafter  — finds disputes that still need a draft for Juan's queue.
 *   tracker  — watches R1/R2/R3 FCRA windows (due-soon / overdue).
 *   nudges   — surfaces dormant cases + pending approvals awaiting his word.
 *
 * Client-side only. $0. No API keys. No external network calls.
 */

import { dormantCases, DORMANT_AFTER_DAYS } from './new850Engine.js';

export const WORKFORCE_LOG_KEY = 'sahjony.new850.workforce.v1';
const LOG_CAP = 300;

export const WORKFORCE_NOTE = {
  es: 'La fuerza de IA trabaja cuando la estación está abierta. Nada se ejecuta en segundo plano.',
  en: 'The AI workforce runs while the station is open. Nothing runs in the background.',
};

export const AGENT_DEFS = Object.freeze([
  {
    id: 'intake',
    name: { es: 'Recepción (IA)', en: 'Intake (AI)' },
    desc: {
      es: 'Detecta casos nuevos y consultas entrantes que necesitan tu atención.',
      en: 'Spots new cases and inbound inquiries needing your attention.',
    },
  },
  {
    id: 'drafter',
    name: { es: 'Redactor (IA)', en: 'Drafter (AI)' },
    desc: {
      es: 'Prepara borradores de disputas y cartas para tu cola de aprobación.',
      en: 'Prepares dispute and letter drafts for your approval queue.',
    },
  },
  {
    id: 'tracker',
    name: { es: 'Rastreador (IA)', en: 'Tracker (AI)' },
    desc: {
      es: 'Vigila las ventanas FCRA de 30/45 días por ronda.',
      en: 'Watches the 30/45-day FCRA windows per round.',
    },
  },
  {
    id: 'nudges',
    name: { es: 'Recordatorios (IA)', en: 'Nudges (AI)' },
    desc: {
      es: 'Señala casos inactivos y aprobaciones pendientes de tu palabra.',
      en: 'Flags dormant cases and approvals awaiting your word.',
    },
  },
]);

function readStoredLog() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(WORKFORCE_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredLog(events) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      WORKFORCE_LOG_KEY,
      JSON.stringify(events.slice(-LOG_CAP)),
    );
  } catch {
    /* memory-only */
  }
}

function chicagoIso(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  } catch {
    return date.toISOString();
  }
}

function windowStatusOf(deadlineAt, now = new Date()) {
  if (!deadlineAt) return 'unknown';
  const d = new Date(deadlineAt);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const days = (d.getTime() - now.getTime()) / 86400000;
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due-soon';
  return 'ok';
}

/**
 * createNew850Workforce({ caseStore, approvalStore, triageStore })
 * All stores are optional; missing data simply yields empty readouts.
 */
export function createNew850Workforce(stores = {}) {
  const { caseStore = null, approvalStore = null, triageStore = null } = stores;

  const agents = AGENT_DEFS.map((def) => ({
    id: def.id,
    name: { ...def.name },
    desc: { ...def.desc },
    status: 'idle', // idle | attention — never fake "working"
    lastRun: null,
    lastSummary: { es: '', en: '' },
    needsJuan: [],
  }));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  let log = readStoredLog();

  function emit(agentId, kind, es, en) {
    const event = { t: chicagoIso(), agent: agentId, kind, es, en };
    const agent = byId[agentId];
    if (agent) agent.lastRun = event.t;
    log.push(event);
    if (log.length > LOG_CAP) log = log.slice(-LOG_CAP);
    writeStoredLog(log);
    return event;
  }

  function need(agentId, es, en, ref = null) {
    const item = { es, en, ref };
    byId[agentId].needsJuan.push(item);
    return item;
  }

  /**
   * runChecks() — honest on-demand pass over the stores. Returns the status
   * board. Computes readouts only; changes nothing; sends nothing.
   */
  function runChecks(now = new Date()) {
    for (const a of agents) {
      a.needsJuan = [];
      a.status = 'idle';
    }
    const cases = caseStore?.listCases ? caseStore.listCases() : [];

    // intake: new intake-draft cases + new triage items
    const intakeCases = cases.filter((c) => c.intakeDraft && c.stage === 'intake');
    const newTriage = triageStore?.listTriage
      ? triageStore.listTriage({ status: 'new' })
      : [];
    if (intakeCases.length) {
      need(
        'intake',
        `${intakeCases.length} caso(s) nuevo(s) en recepción por revisar.`,
        `${intakeCases.length} new intake case(s) to review.`,
      );
      byId.intake.status = 'attention';
    }
    if (newTriage.length) {
      need(
        'intake',
        `${newTriage.length} consulta(s) de WhatsApp sin clasificar.`,
        `${newTriage.length} unclassified WhatsApp inquirie(s).`,
      );
      byId.intake.status = 'attention';
    }
    byId.intake.lastSummary = {
      es: `Casos en recepción: ${intakeCases.length} · Consultas nuevas: ${newTriage.length}`,
      en: `Intake cases: ${intakeCases.length} · New inquiries: ${newTriage.length}`,
    };
    emit(
      'intake',
      'check',
      `Revisión: ${intakeCases.length} casos en recepción, ${newTriage.length} consultas nuevas.`,
      `Check: ${intakeCases.length} intake cases, ${newTriage.length} new inquiries.`,
    );

    // drafter: disputes without any draft yet
    let draftsNeeded = 0;
    for (const c of cases) {
      const draftedDisputeIds = new Set(
        (c.drafts || []).map((d) => d.relatedDisputeId).filter(Boolean),
      );
      for (const d of c.disputes || []) {
        if (!draftedDisputeIds.has(d.id)) draftsNeeded += 1;
      }
    }
    if (draftsNeeded) {
      need(
        'drafter',
        `${draftsNeeded} disputa(s) aún sin borrador para tu cola.`,
        `${draftsNeeded} dispute(s) still need a draft for your queue.`,
      );
      byId.drafter.status = 'attention';
    }
    byId.drafter.lastSummary = {
      es: `Disputas sin borrador: ${draftsNeeded}`,
      en: `Disputes without a draft: ${draftsNeeded}`,
    };
    emit(
      'drafter',
      'check',
      `Revisión: ${draftsNeeded} disputa(s) sin borrador.`,
      `Check: ${draftsNeeded} dispute(s) without a draft.`,
    );

    // tracker: FCRA windows due-soon / overdue
    let dueSoon = 0;
    let overdue = 0;
    const windowRefs = [];
    for (const c of cases) {
      for (const r of c.rounds || []) {
        const st = windowStatusOf(r.deadlineAt, now);
        if (st === 'due-soon') {
          dueSoon += 1;
          windowRefs.push({ caseRef: c.ref, round: r.round, st });
        } else if (st === 'overdue') {
          overdue += 1;
          windowRefs.push({ caseRef: c.ref, round: r.round, st });
        }
      }
    }
    if (overdue) {
      need(
        'tracker',
        `${overdue} ventana(s) FCRA vencida(s) — decide el siguiente paso.`,
        `${overdue} FCRA window(s) overdue — decide the next step.`,
      );
      byId.tracker.status = 'attention';
    }
    if (dueSoon) {
      need(
        'tracker',
        `${dueSoon} ventana(s) FCRA por vencer en ≤7 días.`,
        `${dueSoon} FCRA window(s) due within 7 days.`,
      );
      if (byId.tracker.status !== 'attention') byId.tracker.status = 'attention';
    }
    byId.tracker.lastSummary = {
      es: `Ventanas por vencer: ${dueSoon} · Vencidas: ${overdue}`,
      en: `Windows due soon: ${dueSoon} · Overdue: ${overdue}`,
    };
    emit(
      'tracker',
      'check',
      `Revisión: ${dueSoon} por vencer, ${overdue} vencidas.`,
      `Check: ${dueSoon} due soon, ${overdue} overdue.`,
    );

    // nudges: dormant cases + pending approvals
    const dormant = dormantCases(cases, { now });
    const pendingApprovals = approvalStore?.listApprovals
      ? approvalStore.listApprovals('new850', 'pending')
      : [];
    if (dormant.length) {
      need(
        'nudges',
        `${dormant.length} caso(s) inactivo(s) por más de ${DORMANT_AFTER_DAYS} días.`,
        `${dormant.length} dormant case(s) over ${DORMANT_AFTER_DAYS} days.`,
      );
      byId.nudges.status = 'attention';
    }
    if (pendingApprovals.length) {
      need(
        'nudges',
        `${pendingApprovals.length} borrador(es) esperando tu aprobación.`,
        `${pendingApprovals.length} draft(s) awaiting your approval.`,
      );
      byId.nudges.status = 'attention';
    }
    byId.nudges.lastSummary = {
      es: `Casos inactivos: ${dormant.length} · Aprobaciones pendientes: ${pendingApprovals.length}`,
      en: `Dormant cases: ${dormant.length} · Pending approvals: ${pendingApprovals.length}`,
    };
    emit(
      'nudges',
      'check',
      `Revisión: ${dormant.length} inactivos, ${pendingApprovals.length} aprobaciones pendientes.`,
      `Check: ${dormant.length} dormant, ${pendingApprovals.length} pending approvals.`,
    );

    return getStatusBoard();
  }

  function getStatusBoard() {
    return {
      generatedAt: chicagoIso(),
      note: { ...WORKFORCE_NOTE },
      agents: agents.map((a) => ({
        id: a.id,
        name: { ...a.name },
        desc: { ...a.desc },
        status: a.status,
        lastRun: a.lastRun,
        lastSummary: { ...a.lastSummary },
        needsJuan: a.needsJuan.map((n) => ({ ...n })),
      })),
      attentionCount: agents.filter((a) => a.status === 'attention').length,
    };
  }

  function getLog() {
    return log.slice();
  }

  function resetLog() {
    log = [];
    writeStoredLog(log);
  }

  return { runChecks, getStatusBoard, getLog, resetLog, agents };
}
