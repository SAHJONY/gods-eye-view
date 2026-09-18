/**
 * SAHJONY · GOD'S EYE VIEW — Trade desk intake & triage queue
 * -----------------------------------------------------------------------
 * Pure, unit-testable, zero dependencies. No cesium, no network, no keys.
 *
 * This is the GLOBAL trade desk intake (worldwide supplier/buyer sourcing,
 * RFQs, logistics). The Cuba desk (Module 2) is a SEPARATE track with its
 * own store (`sahjony.cuba.v1`): anything Cuba-bound or Cuba-originated is
 * routed to the Cuba desk by `deskFor()` and is NEVER filed in this
 * pipeline. Grandfathered live deals carry an explicit `desk: 'trade'`
 * override (Juan's instruction: the rice/diesel, TNJ, and V94.2 seeds stay
 * on the worldwide desk).
 *
 * Triage: new RFQs land in the triage queue with a 24h SLA flag so the
 * desk never sits on a fresh inquiry.
 */

export const TRIAGE_SLA_HOURS = 24;
/** SLA "due soon" warning threshold: 6h or less remaining. */
export const TRIAGE_DUE_SOON_HOURS = 6;

/** RFQ statuses that count as "new, awaiting triage". */
export const TRIAGE_STATUSES = Object.freeze(['prospect']);

export const DESKS = Object.freeze(['trade', 'cuba']);

/**
 * Cuba port/country signals for desk routing. Ports are matched as
 * case-insensitive substrings against origin/destination port text.
 */
const CUBA_PORT_SIGNALS = Object.freeze([
  'cuba',
  'mariel',
  'habana',
  'havana',
  'santiago de cuba',
  'cienfuegos',
  'moa',
  'matanzas',
  'nuevitas',
  'guantanamo',
  'manzanillo',
  'caibarien',
]);

function normText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * deskFor(rfq) → 'trade' | 'cuba'
 * Routes an RFQ to the correct desk. An explicit `desk` field on the RFQ
 * always wins (grandfathered live deals). Otherwise any Cuba port signal
 * in origin/destination ports routes to the Cuba desk; everything else
 * stays on the worldwide trade desk.
 */
export function deskFor(rfq = {}) {
  if (rfq && typeof rfq === 'object') {
    const explicit = String(rfq.desk ?? '').toLowerCase().trim();
    if (explicit === 'trade' || explicit === 'cuba') return explicit;
  }
  const haystack = normText(
    `${rfq?.originPort ?? ''} ${rfq?.destinationPort ?? ''}`,
  );
  if (!haystack.trim()) return 'trade';
  for (const signal of CUBA_PORT_SIGNALS) {
    if (haystack.includes(signal)) return 'cuba';
  }
  return 'trade';
}

/** Parse an intake timestamp; fall back to createdAt; null when neither. */
function intakeMs(rfq = {}) {
  const raw = rfq.intakeAt || rfq.createdAt;
  if (raw === undefined || raw === null || raw === '') return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Stamp an RFQ intake record: sets `intakeAt` (ISO) when missing and routes
 * the desk. Pure: returns a new object, never mutates.
 */
export function stampIntake(rfq = {}, now = new Date()) {
  const record = { ...(rfq || {}) };
  if (!record.intakeAt) {
    const d = now instanceof Date ? now : new Date(now);
    record.intakeAt =
      Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
  }
  record.desk = deskFor(record);
  return record;
}

/**
 * slaStatus(rfq, nowMs, slaHours) → 'ok' | 'due' | 'breached' | 'unknown'
 * 'ok': more than 6h of SLA left. 'due': 6h or less left. 'breached': the
 * 24h SLA passed. 'unknown': no intake timestamp on record.
 */
export function slaStatus(rfq = {}, nowMs = Date.now(), slaHours = TRIAGE_SLA_HOURS) {
  const started = intakeMs(rfq);
  if (started === null) return 'unknown';
  const elapsedH = (nowMs - started) / 3_600_000;
  const remainingH = slaHours - elapsedH;
  if (remainingH <= 0) return 'breached';
  if (remainingH <= TRIAGE_DUE_SOON_HOURS) return 'due';
  return 'ok';
}

export const SLA_LABELS = Object.freeze({
  ok: { es: 'En plazo', en: 'On track' },
  due: { es: 'Por vencer', en: 'Due soon' },
  breached: { es: 'SLA vencido', en: 'SLA breached' },
  unknown: { es: 'Sin fecha', en: 'No date' },
});

export function slaLabel(status, lang = 'es') {
  const entry = SLA_LABELS[status] || SLA_LABELS.unknown;
  return lang === 'en' ? entry.en : entry.es;
}

/**
 * triageQueue(rfqs, nowMs, slaHours)
 * → { queue, rerouted, counts }
 * queue: prospect RFQs on the TRADE desk, oldest intake first, each with
 *   { rfq, desk, sla, slaLabelEs, slaLabelEn, ageHours }.
 * rerouted: RFQs routed to the Cuba desk (not filed here — the Cuba desk
 *   owns them).
 * counts: { total, ok, due, breached, unknown, rerouted }.
 * Pure. Never throws on bad input.
 */
export function triageQueue(
  rfqs = [],
  nowMs = Date.now(),
  slaHours = TRIAGE_SLA_HOURS,
) {
  const queue = [];
  const rerouted = [];
  const counts = {
    total: 0,
    ok: 0,
    due: 0,
    breached: 0,
    unknown: 0,
    rerouted: 0,
  };
  if (!Array.isArray(rfqs)) return { queue, rerouted, counts };
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const sla = Number.isFinite(Number(slaHours)) && Number(slaHours) > 0
    ? Number(slaHours)
    : TRIAGE_SLA_HOURS;

  for (const rfq of rfqs) {
    if (!rfq || typeof rfq !== 'object') continue;
    if (!TRIAGE_STATUSES.includes(rfq.status)) continue;
    const desk = deskFor(rfq);
    if (desk === 'cuba') {
      rerouted.push({ rfq, desk });
      counts.rerouted += 1;
      continue;
    }
    const status = slaStatus(rfq, now, sla);
    const started = intakeMs(rfq);
    queue.push({
      rfq,
      desk,
      sla: status,
      slaLabelEs: slaLabel(status, 'es'),
      slaLabelEn: slaLabel(status, 'en'),
      ageHours: started === null ? null : Math.max(0, (now - started) / 3_600_000),
    });
    counts.total += 1;
    if (counts[status] !== undefined) counts[status] += 1;
  }

  queue.sort((a, b) => {
    const rank = { breached: 0, due: 1, unknown: 2, ok: 3 };
    const ra = rank[a.sla] ?? 4;
    const rb = rank[b.sla] ?? 4;
    if (ra !== rb) return ra - rb;
    const aa = a.ageHours === null ? -1 : a.ageHours;
    const bb = b.ageHours === null ? -1 : b.ageHours;
    return bb - aa; // oldest first
  });
  return { queue, rerouted, counts };
}

export const TRIAGE_COPY = Object.freeze({
  title: { es: 'Cola de triaje — RFQs nuevos', en: 'Triage queue — new RFQs' },
  slaNote: {
    es: 'Los RFQs nuevos se trian en 24h. Nada se inventa: sin datos, se pide.',
    en: 'New RFQs are triaged within 24h. Nothing is invented: missing data gets asked for.',
  },
  reroutedNote: {
    es: 'Van al desk Cuba (no se archivan aquí).',
    en: 'Go to the Cuba desk (not filed here).',
  },
  empty: {
    es: 'Sin RFQs nuevos en triaje.',
    en: 'No new RFQs in triage.',
  },
});
