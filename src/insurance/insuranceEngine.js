/**
 * Insurance engine for GOD'S EYE VIEW — pure logic, $0, no I/O.
 *
 * Operates on plain data shapes shared with the standalone Insurance
 * Command Center (same localStorage key, same schema). Every function is a
 * pure function and fully unit-tested. Nothing here is invented: all output
 * is derived from the input data only.
 *
 * businesses: { [bizId]: { coverages: [...], claims: [...] } }
 * Coverage:   { status: 'gap'|'expsoon'|'active', exp, state, ... }
 * Claim:      { stage: 0..5 (5=Closed) }
 * Quote:      { type, premium }
 */

export const CLAIM_STAGES = [
  'Incident',
  'Docs gathering',
  'Packet ready',
  'Filed',
  'Follow-up',
  'Closed',
];
export const OPEN_CLAIM_MAX_STAGE = 4;
export const DEFAULT_RENEWAL_DAYS = 30;
export const NO_STATE_CODE = 'US';

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function daysUntil(dateStr, now) {
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - now) / 86400000);
}

/** Total coverage gaps across all businesses. */
export function gapCount(businesses = {}) {
  let n = 0;
  for (const biz of Object.values(businesses || {})) {
    for (const c of asArray(biz?.coverages)) {
      if (c && c.status === 'gap') n++;
    }
  }
  return n;
}

/**
 * Coverages expiring within `days` (gaps excluded):
 * [{ biz, coverage, daysLeft }], soonest first.
 */
export function renewalsWithin(
  businesses = {},
  days = DEFAULT_RENEWAL_DAYS,
  now = Date.now(),
) {
  const out = [];
  for (const [biz, b] of Object.entries(businesses || {})) {
    for (const coverage of asArray(b?.coverages)) {
      if (!coverage || coverage.status === 'gap') continue;
      const left = daysUntil(coverage.exp, now);
      if (left !== null && left <= days)
        out.push({ biz, coverage, daysLeft: left });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Count claims by stage id: { '0': n, '1': n, ... }. */
export function claimStageCounts(claims = []) {
  const counts = {};
  for (let i = 0; i <= 5; i++) counts[String(i)] = 0;
  for (const c of asArray(claims)) {
    const st = Number(c?.stage);
    if (Number.isFinite(st) && st >= 0 && st <= 5) counts[String(st)]++;
  }
  return counts;
}

/**
 * Cheapest quote per coverage type: { [typeKey]: quote }.
 * Quotes without a numeric premium > 0 never win.
 */
export function bestQuotes(quotes = []) {
  const best = {};
  for (const q of asArray(quotes)) {
    if (!q) continue;
    const key = String(q.type ?? 'other');
    const p = Number(q.premium);
    if (!Number.isFinite(p) || p <= 0) continue;
    if (!(key in best) || p < Number(best[key].premium)) best[key] = q;
  }
  return best;
}

/**
 * Per-state coverage rollup from each coverage's own `state` field
 * (missing/blank → 'US'):
 * { [state]: { gaps, active, expiring } }
 * A coverage can count as both active and expiring; gaps are separate.
 */
export function stateRollup(
  businesses = {},
  days = DEFAULT_RENEWAL_DAYS,
  now = Date.now(),
) {
  const roll = {};
  const bucket = (st) => {
    const key =
      String(st || '')
        .trim()
        .toUpperCase() || NO_STATE_CODE;
    if (!roll[key]) roll[key] = { gaps: 0, active: 0, expiring: 0 };
    return roll[key];
  };
  for (const b of Object.values(businesses || {})) {
    for (const c of asArray(b?.coverages)) {
      if (!c) continue;
      const s = bucket(c.state);
      if (c.status === 'gap') {
        s.gaps++;
        continue;
      }
      if (c.status === 'active') s.active++;
      const left = daysUntil(c.exp, now);
      if (left !== null && left <= days) s.expiring++;
    }
  }
  return roll;
}

/** State health for the map layer: red=gaps, amber=renewal≤30d, green=all active, gray=no data. */
export function stateHealth({ gaps = 0, active = 0, expiring = 0 } = {}) {
  if (gaps > 0) return 'red';
  if (expiring > 0) return 'amber';
  if (active > 0) return 'green';
  return 'gray';
}
