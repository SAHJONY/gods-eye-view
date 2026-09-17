// New850 credit-repair engine — pure, unit-testable, zero dependencies.
// Bilingual (Spanish/English). No cesium, no network, no API keys.
// Encodes the real business rules:
//
// - Dispute rounds R1 → R2 → R3 with FCRA 30/45-day investigation windows.
// - Dormant-case nudge detection (no activity beyond a threshold).
// - Compliance guardrails: no guaranteed score gains, no invented disputes,
//   no fabricated evidence, no false identity-theft claims, no disputes of
//   accurate negative information.
// - DRAFT-ONLY: every letter/message builder returns draft text stamped
//   "DRAFT — awaiting owner approval — nothing sent". This module exposes
//   NO send/submit path.

import { UNRESOLVED_DISPUTE_STATUSES } from './new850Store.js';

export const FCRA_WINDOW_DAYS = 30;
export const FCRA_EXTENDED_WINDOW_DAYS = 45;
export const DUE_SOON_DAYS = 5;
export const DORMANT_AFTER_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse an ISO-ish datetime; null when unparseable. */
export function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Add whole days to an ISO datetime, returned as ISO string. */
export function addDaysIso(iso, days) {
  const d = asDate(iso);
  if (!d) return null;
  return new Date(d.getTime() + Number(days) * DAY_MS).toISOString();
}

/** Whole days between a and b (b - a). Null when either is unparseable. */
export function daysBetween(a, b) {
  const da = asDate(a);
  const db = asDate(b);
  if (!da || !db) return null;
  return Math.floor((db.getTime() - da.getTime()) / DAY_MS);
}

/**
 * FCRA investigation window for a dispute round.
 * 30 days standard; 45 when the dispute was based on the consumer's free
 * annual report or new material information was supplied mid-investigation.
 * Returns { startedAt, deadlineAt, days } or null when startedAt is invalid.
 */
export function investigationWindow(startedAt, extended45 = false) {
  const start = asDate(startedAt);
  if (!start) return null;
  const days = extended45 ? FCRA_EXTENDED_WINDOW_DAYS : FCRA_WINDOW_DAYS;
  return {
    startedAt: start.toISOString(),
    deadlineAt: new Date(start.getTime() + days * DAY_MS).toISOString(),
    days,
  };
}

/**
 * Window status against a deadline: 'ok' | 'due-soon' (<=5 days left) |
 * 'overdue' | 'unknown'. A closed/void deadline is reported, never invented.
 */
export function windowStatus(deadlineAt, now = new Date()) {
  const deadline = asDate(deadlineAt);
  if (!deadline) return 'unknown';
  const nowDate = asDate(now) || new Date();
  const remaining = Math.floor(
    (deadline.getTime() - nowDate.getTime()) / DAY_MS,
  );
  if (remaining < 0) return 'overdue';
  if (remaining <= DUE_SOON_DAYS) return 'due-soon';
  return 'ok';
}

export const WINDOW_STATUS_LABELS = Object.freeze({
  ok: { es: 'En plazo', en: 'On track' },
  'due-soon': { es: 'Vence pronto', en: 'Due soon' },
  overdue: { es: 'Vencida', en: 'Overdue' },
  unknown: { es: 'Sin fecha', en: 'No date' },
});

export function windowStatusLabel(status, lang = 'es') {
  const entry = WINDOW_STATUS_LABELS[status] || WINDOW_STATUS_LABELS.unknown;
  return lang === 'es' ? entry.es : entry.en;
}

/** Latest activity timestamp across case fields, drafts and notes. */
export function caseActivityAt(caseObj) {
  if (!caseObj || typeof caseObj !== 'object') return null;
  const candidates = [caseObj.updatedAt, caseObj.createdAt];
  for (const draft of caseObj.drafts || []) {
    candidates.push(draft.updatedAt, draft.createdAt);
  }
  for (const note of caseObj.agentNotes || []) {
    candidates.push(note.at);
  }
  for (const round of caseObj.rounds || []) {
    candidates.push(round.startedAt);
  }
  let latest = null;
  for (const c of candidates) {
    const d = asDate(c);
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest ? latest.toISOString() : null;
}

const TERMINAL_STAGES = new Set(['complete', 'closed']);

/**
 * Dormant-case nudge detection: open cases whose latest activity is older
 * than `inactivityDays` (default 14). Returns [{ caseId, caseRef,
 * daysInactive, label: {es,en} }]. Demo cases are included but flagged.
 */
export function dormantCases(cases, { inactivityDays = DORMANT_AFTER_DAYS, now = new Date() } = {}) {
  const nowDate = asDate(now) || new Date();
  const out = [];
  for (const c of cases || []) {
    if (!c || TERMINAL_STAGES.has(c.stage)) continue;
    const last = asDate(caseActivityAt(c));
    if (!last) continue;
    const inactive = Math.floor((nowDate.getTime() - last.getTime()) / DAY_MS);
    if (inactive >= inactivityDays) {
      out.push({
        caseId: c.id,
        caseRef: c.ref,
        clientLabel: c.clientLabel,
        daysInactive: inactive,
        stage: c.stage,
        demo: c.demo === true,
        label: {
          es: `Sin actividad por ${inactive} días — revisar`,
          en: `No activity for ${inactive} days — review`,
        },
      });
    }
  }
  out.sort((a, b) => b.daysInactive - a.daysInactive);
  return out;
}

/** Disputes of a case that are still unresolved (not 'deleted'). */
export function unresolvedDisputes(caseObj) {
  if (!caseObj || !Array.isArray(caseObj.disputes)) return [];
  return caseObj.disputes.filter((d) =>
    UNRESOLVED_DISPUTE_STATUSES.includes(d.status),
  );
}

/**
 * Which disputes are eligible to continue into `round` (2 or 3):
 * unresolved disputes from an earlier round that have evidence on file.
 * Deleted items never continue — disputing an accurate item is forbidden.
 */
export function disputesEligibleForRound(caseObj, round) {
  const r = Number(round);
  if (![2, 3].includes(r)) return [];
  return unresolvedDisputes(caseObj).filter(
    (d) => Number(d.round) < r && d.isAccurate !== true,
  );
}

/**
 * Next-round recommendation for a case. Never invents disputes — only
 * existing unresolved disputes with evidence can continue.
 */
export function nextRoundRecommendation(caseObj) {
  if (!caseObj) return null;
  const currentMax = Math.max(
    0,
    ...(caseObj.disputes || []).map((d) => Number(d.round) || 0),
  );
  for (const round of [2, 3]) {
    if (round <= currentMax) continue;
    const eligible = disputesEligibleForRound(caseObj, round);
    if (eligible.length) {
      return {
        recommendedRound: round,
        eligibleDisputeIds: eligible.map((d) => d.id),
        eligibleCount: eligible.length,
        reason: {
          es: `Ronda ${round}: ${eligible.length} disputa(s) sin resolver con evidencia pueden continuar.`,
          en: `Round ${round}: ${eligible.length} unresolved dispute(s) with evidence may continue.`,
        },
      };
    }
  }
  return {
    recommendedRound: null,
    eligibleDisputeIds: [],
    eligibleCount: 0,
    reason: {
      es: 'Nada que escalar: sin disputas sin resolver con evidencia.',
      en: 'Nothing to escalate: no unresolved disputes with evidence.',
    },
  };
}

/**
 * Round sequencing summary for a case: for R1..R3, the round record plus
 * the window status. Missing rounds are reported as not-started — never
 * invented.
 */
export function roundSequence(caseObj, now = new Date()) {
  const out = [];
  for (const round of [1, 2, 3]) {
    const record = (caseObj?.rounds || []).find((r) => r.round === round) ?? null;
    const disputes = (caseObj?.disputes || []).filter(
      (d) => Number(d.round) === round,
    );
    out.push({
      round,
      record,
      disputeCount: disputes.length,
      started: Boolean(record?.startedAt),
      window:
        record?.startedAt != null
          ? {
              days: record.windowDays || FCRA_WINDOW_DAYS,
              deadlineAt: record.deadlineAt,
              status: windowStatus(record.deadlineAt, now),
            }
          : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compliance guardrails
// ---------------------------------------------------------------------------

const GUARANTEE_PATTERNS = [
  /guarantee[sd]?\b/i,
  /garantiz[ao]/i,
  /garant[ií]a\b/i,
  /\bsubir[áa]?\s+\d+\s*puntos/i,
  /increase (your|the) score/i,
  /\b\d+\s*points?\s*(guaranteed|increase)/i,
  /puntaje (garantizado|asegurado)/i,
  /prometemos/i,
  /\bwe promise\b/i,
];

const IDENTITY_THEFT_PATTERNS = [
  /identity theft/i,
  /robo de identidad/i,
  /fue v[íi]ctima/i,
];

/**
 * Compliance check over a draft's text + metadata.
 * Returns an array of issue objects { code, es, en }; empty = clean.
 * Codes: GUARANTEE_LANGUAGE, FALSE_ID_THEFT, DISPUTES_ACCURATE_ITEM,
 * MISSING_EVIDENCE, MISSING_NO_GUARANTEE_DISCLAIMER.
 */
export function complianceIssues({ text = '', disputes = [], kind = '' } = {}) {
  const issues = [];
  const body = String(text || '');
  // Scrub the mandatory no-guarantee disclaimer before scanning, so the
  // disclaimer itself does not trip the guarantee-language detector.
  const scrubbed = body
    .replace(/no hay garant[íi]a[^.\n]*[.!\n]/gi, ' ')
    .replace(/no existe garant[íi]a[^.\n]*[.!\n]/gi, ' ')
    .replace(/sin garant[íi]a[^.\n]*[.!\n]/gi, ' ')
    .replace(/no guarantee[^.\n]*[.!\n]/gi, ' ')
    .replace(/there is no guarantee[^.\n]*[.!\n]/gi, ' ');

  if (GUARANTEE_PATTERNS.some((re) => re.test(scrubbed))) {
    issues.push({
      code: 'GUARANTEE_LANGUAGE',
      es: 'Lenguaje de garantía detectado: nunca prometas subidas de puntaje.',
      en: 'Guarantee language detected: never promise score gains.',
    });
  }

  const claimsIdentityTheft = IDENTITY_THEFT_PATTERNS.some((re) =>
    re.test(body),
  );
  const attested = (disputes || []).some((d) => d.identityTheftAttested === true);
  if (claimsIdentityTheft && !attested) {
    issues.push({
      code: 'FALSE_ID_THEFT',
      es: 'Menciona robo de identidad sin declaración jurada del cliente — no enviar.',
      en: 'Mentions identity theft without a client affidavit — do not send.',
    });
  }

  if ((disputes || []).some((d) => d.isAccurate === true)) {
    issues.push({
      code: 'DISPUTES_ACCURATE_ITEM',
      es: 'Incluye un ítem marcado como información correcta — no se disputa lo correcto.',
      en: 'Includes an item flagged as accurate information — accurate items are never disputed.',
    });
  }

  if (kind === 'dispute-letter' || kind === 'furnisher-letter') {
    const missingEvidence = (disputes || []).filter(
      (d) => !d.evidence || !String(d.evidence).trim(),
    );
    if (missingEvidence.length) {
      issues.push({
        code: 'MISSING_EVIDENCE',
        es: `Falta evidencia en ${missingEvidence.length} disputa(s) — no inventes pruebas.`,
        en: `Missing evidence on ${missingEvidence.length} dispute(s) — never fabricate evidence.`,
      });
    }
  }

  if (
    !/no (hay|existe) garant[íi]a|no guarantee/i.test(body) &&
    (kind === 'dispute-letter' || kind === 'customer-message')
  ) {
    issues.push({
      code: 'MISSING_NO_GUARANTEE_DISCLAIMER',
      es: 'Falta la nota de "sin garantía de resultados".',
      en: 'Missing the "no guaranteed results" disclaimer.',
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Draft builders — DRAFT text only. No send path exists anywhere.
// ---------------------------------------------------------------------------

const DRAFT_HEADER = {
  es: 'BORRADOR — ESPERANDO APROBACIÓN DEL DUEÑO — NADA ENVIADO',
  en: 'DRAFT — AWAITING OWNER APPROVAL — NOTHING SENT',
};

const NO_GUARANTEE_LINE = {
  es: 'No hay garantía de resultados ni de subidas de puntaje. Los resultados dependen de cada buró y acreedor.',
  en: 'There is no guarantee of results or score increases. Outcomes depend on each bureau and creditor.',
};

function draftHeader(lang) {
  return lang === 'es' ? DRAFT_HEADER.es : DRAFT_HEADER.en;
}

function noGuaranteeLine(lang) {
  return lang === 'es' ? NO_GUARANTEE_LINE.es : NO_GUARANTEE_LINE.en;
}

/**
 * Build a bureau dispute-letter DRAFT. Requires evidence on the dispute —
 * never fabricates it. Returns { text } or { error: { es, en } }.
 */
export function draftDisputeLetter({ caseObj, dispute, bureau, lang = 'es' } = {}) {
  if (!caseObj || !dispute) {
    return {
      error: {
        es: 'Falta el caso o la disputa.',
        en: 'Missing case or dispute.',
      },
    };
  }
  if (dispute.isAccurate === true) {
    return {
      error: {
        es: 'No se disputa información correcta.',
        en: 'Accurate information is never disputed.',
      },
    };
  }
  if (!dispute.evidence || !String(dispute.evidence).trim()) {
    return {
      error: {
        es: 'Sin evidencia no hay carta — agrega la evidencia primero.',
        en: 'No letter without evidence — add the evidence first.',
      },
    };
  }
  const L = lang === 'es';
  const bureauName =
    { equifax: 'Equifax', experian: 'Experian', transunion: 'TransUnion' }[
      String(bureau || '').toLowerCase()
    ] || String(bureau || '—');
  const item = dispute.item || '—';
  const creditor = dispute.creditor || '—';
  return {
    text: [
      draftHeader(lang),
      L
        ? '(borrador — nada enviado / draft — nothing sent)'
        : '(draft — nothing sent / borrador — nada enviado)',
      '',
      L
        ? `Caso: ${caseObj.ref} · Cliente: ${caseObj.clientLabel || '—'} · Tel: ${caseObj.phoneMasked || '***'}`
        : `Case: ${caseObj.ref} · Client: ${caseObj.clientLabel || '—'} · Phone: ${caseObj.phoneMasked || '***'}`,
      L ? `Buró: ${bureauName}` : `Bureau: ${bureauName}`,
      '',
      L ? 'Asunto: Solicitud de investigación (FCRA)' : 'Re: Investigation request (FCRA)',
      '',
      L
        ? `Disputo el siguiente ítem en mi reporte: "${item}" (acreedor/informante: ${creditor}).`
        : `I dispute the following item on my report: "${item}" (creditor/furnisher: ${creditor}).`,
      L
        ? `Evidencia que acompaña: ${dispute.evidence}`
        : `Supporting evidence: ${dispute.evidence}`,
      '',
      L
        ? 'Solicito una investigación dentro del plazo de 30 días (45 si aplica) bajo la FCRA y que se corrija o elimine el ítem si no puede verificarse.'
        : 'I request an investigation within the 30-day window (45 if applicable) under the FCRA, and that the item be corrected or removed if it cannot be verified.',
      '',
      noGuaranteeLine(lang),
      '',
      L
        ? 'Este borrador es solo para revisión del dueño — nada se ha enviado.'
        : 'This draft is for owner review only — nothing has been sent.',
    ].join('\n'),
  };
}

/**
 * Build a furnisher (creditor) direct-dispute DRAFT. Same evidence rules.
 */
export function draftFurnisherLetter({ caseObj, dispute, lang = 'es' } = {}) {
  if (!caseObj || !dispute) {
    return {
      error: { es: 'Falta el caso o la disputa.', en: 'Missing case or dispute.' },
    };
  }
  if (dispute.isAccurate === true) {
    return {
      error: {
        es: 'No se disputa información correcta.',
        en: 'Accurate information is never disputed.',
      },
    };
  }
  if (!dispute.evidence || !String(dispute.evidence).trim()) {
    return {
      error: {
        es: 'Sin evidencia no hay carta — agrega la evidencia primero.',
        en: 'No letter without evidence — add the evidence first.',
      },
    };
  }
  const L = lang === 'es';
  return {
    text: [
      draftHeader(lang),
      L
        ? '(borrador — nada enviado / draft — nothing sent)'
        : '(draft — nothing sent / borrador — nada enviado)',
      '',
      L
        ? `Caso: ${caseObj.ref} · Cliente: ${caseObj.clientLabel || '—'} · Tel: ${caseObj.phoneMasked || '***'}`
        : `Case: ${caseObj.ref} · Client: ${caseObj.clientLabel || '—'} · Phone: ${caseObj.phoneMasked || '***'}`,
      L
        ? `Para: ${dispute.creditor || '—'} (informante directo)`
        : `To: ${dispute.creditor || '—'} (direct furnisher)`,
      '',
      L ? 'Asunto: Disputa directa (FCRA §623)' : 'Re: Direct dispute (FCRA §623)',
      '',
      L
        ? `Disputo directamente con ustedes el ítem: "${dispute.item || '—'}".`
        : `I dispute directly with you the item: "${dispute.item || '—'}".`,
      L
        ? `Evidencia que acompaña: ${dispute.evidence}`
        : `Supporting evidence: ${dispute.evidence}`,
      '',
      L
        ? 'Solicito que investiguen y corrijan o eliminen la información si no puede verificarse.'
        : 'Please investigate and correct or remove the information if it cannot be verified.',
      '',
      L
        ? 'Este borrador es solo para revisión del dueño — nada se ha enviado.'
        : 'This draft is for owner review only — nothing has been sent.',
    ].join('\n'),
  };
}

/**
 * Build a CFPB complaint DRAFT — escalates only after R1..R3 rounds ran or
 * a window went overdue with no bureau response.
 */
export function draftCfpbComplaint({ caseObj, reason, lang = 'es' } = {}) {
  if (!caseObj) {
    return { error: { es: 'Falta el caso.', en: 'Missing case.' } };
  }
  const L = lang === 'es';
  const unresolved = unresolvedDisputes(caseObj);
  return {
    text: [
      draftHeader(lang),
      L
        ? '(borrador — nada enviado / draft — nothing sent)'
        : '(draft — nothing sent / borrador — nada enviado)',
      '',
      L ? `Caso: ${caseObj.ref}` : `Case: ${caseObj.ref}`,
      L
        ? `Motivo de la escalada: ${reason || '—'}`
        : `Escalation reason: ${reason || '—'}`,
      L
        ? `Disputas sin resolver: ${unresolved.length}`
        : `Unresolved disputes: ${unresolved.length}`,
      ...unresolved.map(
        (d, i) =>
          `${i + 1}. ${d.item || '—'} — ${d.creditor || '—'} (ronda ${d.round}, ${d.status})`,
      ),
      '',
      L
        ? 'Se solicita la intervención del CFPB tras agotar las rondas de disputa o vencer el plazo de investigación sin respuesta.'
        : 'CFPB intervention is requested after dispute rounds were exhausted or the investigation window expired without response.',
      '',
      noGuaranteeLine(lang),
      '',
      L
        ? 'Este borrador es solo para revisión del dueño — nada se ha enviado.'
        : 'This draft is for owner review only — nothing has been sent.',
    ].join('\n'),
  };
}

/**
 * Build a customer update-message DRAFT (Spanish-first). Carries the
 * no-guarantee line by policy.
 */
export function draftCustomerMessage({ caseObj, body, lang = 'es' } = {}) {
  if (!caseObj) {
    return { error: { es: 'Falta el caso.', en: 'Missing case.' } };
  }
  const L = lang === 'es';
  return {
    text: [
      draftHeader(lang),
      L
        ? '(borrador — nada enviado / draft — nothing sent)'
        : '(draft — nothing sent / borrador — nada enviado)',
      '',
      L
        ? `Para: ${caseObj.clientLabel || '—'} (${caseObj.phoneMasked || '***'})`
        : `To: ${caseObj.clientLabel || '—'} (${caseObj.phoneMasked || '***'})`,
      '',
      String(body || '').trim() || (L ? '(mensaje vacío)' : '(empty message)'),
      '',
      noGuaranteeLine(lang),
      '',
      L
        ? 'Este borrador es solo para revisión del dueño — nada se ha enviado.'
        : 'This draft is for owner review only — nothing has been sent.',
    ].join('\n'),
  };
}
