// Wholesale deal math engine — pure, unit-testable, zero dependencies.
// Bilingual (Spanish/English). No cesium, no network, no API keys.
// Guard rails: non-finite / negative / missing inputs produce safe defaults (0),
// never throw.

/** Coerce to a finite non-negative number, else `fallback` (default 0). */
export function safeNum(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * Maximum Allowable Offer.
 * MAO = arv * pct - repairs - targetFee
 */
export function maxAllowableOffer({ arv, repairs, targetFee, pct = 0.7 } = {}) {
  const a = safeNum(arv);
  const r = safeNum(repairs);
  const f = safeNum(targetFee);
  let p = Number(pct);
  if (!Number.isFinite(p) || p < 0 || p > 1) p = 0.7;
  const mao = a * p - r - f;
  return mao > 0 ? Math.round(mao) : 0;
}

/** Assignment fee = buyer's max offer - contract price. */
export function assignmentFee({ buyerMaxOffer, contractPrice } = {}) {
  return Math.round(safeNum(buyerMaxOffer) - safeNum(contractPrice));
}

/**
 * Rank a buyer by how their max offer compares to the contract price.
 * - green:  fee >= targetFee
 * - yellow: 0 < fee < targetFee (show the reduced fee)
 * - red:    fee <= 0 (show the contract price needed: buyerMaxOffer - targetFee)
 */
export function rankBuyer({ buyerMaxOffer, contractPrice, targetFee } = {}) {
  const buyMax = safeNum(buyerMaxOffer);
  const price = safeNum(contractPrice);
  const target = safeNum(targetFee);
  const fee = Math.round(buyMax - price);

  if (fee >= target) {
    return {
      tier: 'green',
      fee,
      note: {
        es: `Comisión objetivo alcanzada: ${formatMoney(fee)}`,
        en: `Target fee met: ${formatMoney(fee)}`,
      },
    };
  }
  if (fee > 0) {
    return {
      tier: 'yellow',
      fee,
      note: {
        es: `Comisión reducida: ${formatMoney(fee)} (objetivo ${formatMoney(target)})`,
        en: `Reduced fee: ${formatMoney(fee)} (target ${formatMoney(target)})`,
      },
    };
  }
  const needed = Math.round(buyMax - target);
  return {
    tier: 'red',
    fee,
    note: {
      es: `Sin comisión. Precio de contrato necesario: ${formatMoney(needed)}`,
      en: `No fee. Contract price needed: ${formatMoney(needed)}`,
    },
  };
}

const CONDITION_POINTS = {
  vacant: 25,
  boarded: 20,
  fire: 20,
  roof: 15,
  overgrown: 10,
  fsbo: 5,
  other: 5,
};

const DISTRESS_POINTS = {
  taxdelinquent: 20,
  tax_delinquent: 20,
  absenteeowner: 10,
  absentee_owner: 10,
  vacantland: 5,
  vacant_land: 5,
};

const normalizeKey = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const asList = (value) => (Array.isArray(value) ? value : [value]);

/**
 * Score a lead 0..100 using only free, knowable signals present on the lead.
 * - Condition severity: max of matching points (not a sum)
 * - Distress flags: tax delinquent 20, absentee owner 10, vacant land 5
 * - Data completeness: has owner +15, has lat/lng +10
 * Capped at 100. Never invents data — missing fields simply score 0.
 */
export function scoreLead(lead) {
  if (!lead || typeof lead !== 'object') return 0;
  let score = 0;

  // Condition: take the max severity, not the sum.
  let bestCondition = 0;
  for (const raw of asList(lead.condition)) {
    const key = normalizeKey(raw);
    const pts = CONDITION_POINTS[key] ?? (raw ? CONDITION_POINTS.other : 0);
    if (pts > bestCondition) bestCondition = pts;
  }
  score += bestCondition;

  // Distress flags.
  const distress = Array.isArray(lead.distress) ? lead.distress : [];
  const seen = new Set();
  for (const raw of distress) {
    const key = normalizeKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    score += DISTRESS_POINTS[key] ?? 0;
  }

  // Data completeness.
  if (lead.owner && String(lead.owner).trim()) score += 15;
  const lat = Number(lead.lat);
  const lng = Number(lead.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) score += 10;

  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Deal verdict from a lead score, with bilingual labels.
 * - green >= 70: "Oferta fuerte" / "Strong offer"
 * - yellow 40-69: "Analizar" / "Analyze"
 * - red < 40: "Descartar" / "Pass"
 */
export function dealVerdict(score) {
  const s = Number(score);
  const value = Number.isFinite(s) ? Math.round(s) : 0;
  if (value >= 70) {
    return { tier: 'green', es: 'Oferta fuerte', en: 'Strong offer' };
  }
  if (value >= 40) {
    return { tier: 'yellow', es: 'Analizar', en: 'Analyze' };
  }
  return { tier: 'red', es: 'Descartar', en: 'Pass' };
}

/** Format as dollars with commas, no decimals. Bad input -> "$0". */
export function formatMoney(n) {
  const value = safeNum(n);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export const VERDICT_TIERS = Object.freeze(['green', 'yellow', 'red']);
