/**
 * Insurance Command Center store for GOD'S EYE VIEW — $0, no API keys, no network.
 *
 * Read-through localStorage wrapper over the SAME key the standalone app
 * (public/insurance/index.html) uses, so GEV and the standalone app share one
 * dataset: `sahjony_insurance_v1`. Never invents data — every getter returns
 * [] (or null) when the stored state is missing or corrupt.
 *
 * Coverage shape: { id, type, priority, status ('gap'|'expsoon'|'active'),
 *   carrier, policy, eff, exp, prem, notes, state }
 * Claim shape:    { id, type, date, desc, stage (0-5, 5=Closed), state,
 *   created, log:[], docs:{} }
 * Attorney shape: { id, for, title, attorney, firm, contact, case, filed,
 *   venue, status (0-6, 6=Closed), next, nextdate, notes, state }
 * Quote shape:    { id, type, carrier, premium, deductible, limits, contact,
 *   date, exp, notes }
 */

export const INSURANCE_STORE_KEY = 'sahjony_insurance_v1';

/** Claim stages 0-4 are open; stage 5 is Closed. */
export const OPEN_CLAIM_MAX_STAGE = 4;

/** Attorney stages 0-5 are open; stage 6 is Closed. */
export const OPEN_ATTORNEY_MAX_STATUS = 5;

export const BUILT_IN_BIZ = [
  'personal',
  'wholesale',
  'import',
  'crude',
  'cuba',
];

function readState() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(INSURANCE_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (
      !parsed.businesses ||
      typeof parsed.businesses !== 'object' ||
      Array.isArray(parsed.businesses)
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(state) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(INSURANCE_STORE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function businessIdsOf(state) {
  const ids = [...BUILT_IN_BIZ];
  const custom = Array.isArray(state?.custom) ? state.custom : [];
  for (const c of custom) {
    if (c && typeof c.id === 'string' && c.id && !ids.includes(c.id)) {
      ids.push(c.id);
    }
  }
  for (const id of Object.keys(state?.businesses || {})) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function daysUntil(dateStr) {
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

export function createInsuranceStore() {
  return {
    /** Full stored state, or null when missing/corrupt. */
    getState() {
      return readState();
    },
    /** Persist a full state object (passthrough; returns boolean). */
    saveState(state) {
      return writeState(state);
    },
    /** Business ids: 5 built-ins + custom businesses, or [] on no data. */
    getBusinessIds() {
      const s = readState();
      return s ? businessIdsOf(s) : [];
    },
    /** Custom businesses [{ id, name, industry }], or []. */
    getCustomBiz() {
      const s = readState();
      const out = [];
      for (const c of asArray(s?.custom)) {
        if (c && typeof c.id === 'string') out.push(c);
      }
      return out;
    },
    /** Coverage lines for one business, or []. */
    getCoverages(biz) {
      const s = readState();
      return asArray(s?.businesses?.[biz]?.coverages);
    },
    /** All coverage gaps: [{ biz, coverage }], or []. */
    getGaps() {
      const s = readState();
      if (!s) return [];
      const out = [];
      for (const biz of businessIdsOf(s)) {
        for (const coverage of asArray(s.businesses[biz]?.coverages)) {
          if (coverage && coverage.status === 'gap')
            out.push({ biz, coverage });
        }
      }
      return out;
    },
    /**
     * Coverages expiring within `days` (default 30):
     * [{ biz, coverage, daysLeft }], or [].
     */
    getRenewals(days = 30) {
      const s = readState();
      if (!s) return [];
      const out = [];
      for (const biz of businessIdsOf(s)) {
        for (const coverage of asArray(s.businesses[biz]?.coverages)) {
          if (!coverage || coverage.status === 'gap') continue;
          const left = daysUntil(coverage.exp);
          if (left !== null && left <= days)
            out.push({ biz, coverage, daysLeft: left });
        }
      }
      return out.sort((a, b) => a.daysLeft - b.daysLeft);
    },
    /** Claims for one business, or []. */
    getClaims(biz) {
      const s = readState();
      return asArray(s?.businesses?.[biz]?.claims);
    },
    /** Open claims across all businesses: [{ biz, claim }], stage < 5. */
    getOpenClaims() {
      const s = readState();
      if (!s) return [];
      const out = [];
      for (const biz of businessIdsOf(s)) {
        for (const claim of asArray(s.businesses[biz]?.claims)) {
          const st = Number(claim?.stage);
          if (Number.isFinite(st) && st <= OPEN_CLAIM_MAX_STAGE)
            out.push({ biz, claim });
        }
      }
      return out;
    },
    /** Attorney-filed matters, or []. */
    getAttorney() {
      const s = readState();
      return asArray(s?.attorney);
    },
    /** Saved insurance quotes, or []. */
    getQuotes() {
      const s = readState();
      return asArray(s?.quotes);
    },
    /** Open attorney matters: [{ matter }], status <= 5. */
    getOpenAttorney() {
      const s = readState();
      const out = [];
      for (const matter of asArray(s?.attorney)) {
        const st = Number(matter?.status);
        if (Number.isFinite(st) && st <= OPEN_ATTORNEY_MAX_STATUS)
          out.push({ matter });
      }
      return out;
    },
  };
}
