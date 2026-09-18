// Cuba car market deal math engine — pure, unit-testable, zero dependencies.
// Bilingual (Spanish/English). No I/O, no DOM, no network.
//
// CONFIDENTIAL BOUNDARY: these functions compute internal economics from
// values Juan enters at runtime (buyer price, internal all-in cost). They
// return numbers for INTERNAL decision support only. Nothing here is ever
// rendered to a buyer-facing surface: no public inventory, no flyers, no
// WhatsApp copy may carry margins, floors, or supplier names. The dashboard
// renders buyer prices and pipeline stages only.
//
// Never throws on bad input: bad input -> 0 / 'gray' / [].

/** Coerce to a finite non-negative number, else `fallback` (default 0). */
export function safeNum(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
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

// ---------------------------------------------------------------------------
// Internal economics (dashboard never renders these)
// ---------------------------------------------------------------------------

/**
 * Internal spread for one car deal: buyerPrice - internalAllInCost.
 * INTERNAL ONLY — never render to buyer-facing surfaces.
 */
export function dealSpread({ buyerPrice, internalAllInCost } = {}) {
  return safeNum(buyerPrice) - safeNum(internalAllInCost);
}

/** Commission fee for a brokered deal: buyerPrice * commissionPct (0..1). */
export function brokerFee({ buyerPrice, commissionPct } = {}) {
  const pct = safeNum(commissionPct);
  return safeNum(buyerPrice) * Math.min(1, pct);
}

/** Spread margin percent: spread / buyerPrice. 0 when no buyer price. */
export function spreadPct({ buyerPrice, internalAllInCost } = {}) {
  const price = safeNum(buyerPrice);
  if (price <= 0) return 0;
  return dealSpread({ buyerPrice, internalAllInCost }) / price;
}

/**
 * Verdict on whether a deal clears a target spread (INTERNAL). targetSpread
 * is supplied at call time by Juan — never hardcoded here, never logged.
 * Tiers: green (meets target), yellow (>= 50% of target), red (below),
 * gray (missing price or cost data).
 */
export function spreadVerdict({ buyerPrice, internalAllInCost, targetSpread } = {}) {
  const price = safeNum(buyerPrice);
  const cost = safeNum(internalAllInCost);
  const target = safeNum(targetSpread);
  const reasons = [];
  if (price <= 0 || cost <= 0) {
    reasons.push({
      es: 'Faltan datos: precio al comprador y costo total interno',
      en: 'Missing data: buyer price and internal all-in cost',
    });
    return { tier: 'gray', es: 'Sin datos', en: 'No data', reasons };
  }
  const spread = price - cost;
  const pct = price > 0 ? spread / price : 0;
  reasons.push({
    es: `Diferencial: ${formatMoney(spread)} (${(pct * 100).toFixed(1)}%)`,
    en: `Spread: ${formatMoney(spread)} (${(pct * 100).toFixed(1)}%)`,
  });
  if (target <= 0) return { tier: 'gray', es: 'Sin objetivo', en: 'No target', reasons };
  if (spread >= target) return { tier: 'green', es: 'Cumple objetivo', en: 'Meets target', reasons };
  if (spread >= target / 2) return { tier: 'yellow', es: 'Parcial', en: 'Partial', reasons };
  return { tier: 'red', es: 'Bajo objetivo', en: 'Below target', reasons };
}

// ---------------------------------------------------------------------------
// Buyer qualification scoring (pure, from lead data only)
// ---------------------------------------------------------------------------

const QUALIFY_CHECKS = [
  {
    field: 'contact',
    weight: 20,
    es: 'Contacto directo (WhatsApp o teléfono)',
    en: 'Direct contact (WhatsApp or phone)',
    test: (lead) => hasText(lead?.whatsapp) || hasText(lead?.phone),
  },
  {
    field: 'model',
    weight: 20,
    es: 'Modelo de interés definido',
    en: 'Defined model of interest',
    test: (lead) => hasText(lead?.interest),
  },
  {
    field: 'budget',
    weight: 25,
    es: 'Presupuesto declarado',
    en: 'Stated budget',
    test: (lead) => hasMoney(lead?.budgetUsd),
  },
  {
    field: 'budgetFit',
    weight: 15,
    es: 'Presupuesto alinea con precio del modelo',
    en: 'Budget aligns with model price',
    test: (lead, price) => hasMoney(lead?.budgetUsd) && hasMoney(price) && Number(lead.budgetUsd) >= Number(price),
  },
  {
    field: 'notes',
    weight: 10,
    es: 'Notas de seguimiento',
    en: 'Follow-up notes',
    test: (lead) => Array.isArray(lead?.notes) && lead.notes.length > 0,
  },
  {
    field: 'engaged',
    weight: 10,
    es: 'Contacto avanzado (contactado o más)',
    en: 'Contact advanced (contacted or further)',
    test: (lead) => ['contactado', 'calificado', 'oferta', 'cierre'].includes(lead?.stage),
  },
];

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/**
 * Score a buyer lead 0..100 from its own data only. Optional `modelPrice`
 * (the buyer-facing price of the model of interest) powers the budget-fit
 * check. Missing data scores 0 — never invents. Returns
 * { score, missing: [{field, es, en}] }.
 */
export function scoreLead(lead, modelPrice = null) {
  const checks = QUALIFY_CHECKS.map((check) => {
    const passed = safeTest(() => check.test(lead || {}, modelPrice));
    return { check, passed };
  });
  let score = 0;
  const missing = [];
  for (const { check, passed } of checks) {
    if (passed) score += check.weight;
    else missing.push({ field: check.field, es: check.es, en: check.en });
  }
  return { score: Math.min(100, Math.max(0, score)), missing };
}

function safeTest(fn) {
  try {
    return !!fn();
  } catch {
    return false;
  }
}

/**
 * Qualification verdict from a scoreLead result:
 * - green: score >= 70 → 'Calificable' / 'Qualifiable'
 * - yellow: score >= 40 → 'Seguimiento' / 'Follow up'
 * - red: otherwise → 'Descartable' / 'Drop'
 * Reasons list the missing checks (Spanish/English) — never buyer PII.
 */
export function qualificationVerdict(scored = {}) {
  const score = safeNum(scored.score);
  const missing = Array.isArray(scored.missing) ? scored.missing : [];
  const reasons = missing.map(({ es, en }) => ({
    es: `Falta: ${es}`,
    en: `Missing: ${en}`,
  }));
  if (score >= 70)
    return { tier: 'green', es: 'Calificable', en: 'Qualifiable', reasons };
  if (score >= 40)
    return { tier: 'yellow', es: 'Seguimiento', en: 'Follow up', reasons };
  return { tier: 'red', es: 'Descartable', en: 'Drop', reasons };
}

// ---------------------------------------------------------------------------
// Competition price position (our asking price vs scan rows)
// ---------------------------------------------------------------------------

/**
 * Price position of OUR asking price vs a competitor snapshot:
 * - 'under': we are cheaper (by `diff` USD or more)
 * - 'over': we are more expensive
 * - 'equal': within $50
 * - 'unknown': either price missing
 * Returns { position, diff } where diff = theirPrice - ourPrice.
 * Our price comes from Juan's settings; default empty → 'unknown'.
 */
export function pricePosition(ourPrice, theirPrice) {
  if (!hasMoney(ourPrice) || !hasMoney(theirPrice))
    return { position: 'unknown', diff: 0 };
  const ours = Number(ourPrice);
  const theirs = Number(theirPrice);
  const diff = Math.round(theirs - ours);
  if (Math.abs(diff) <= 50) return { position: 'equal', diff };
  if (diff > 0) return { position: 'under', diff };
  return { position: 'over', diff };
}

export const PRICE_POSITION_LABELS = Object.freeze({
  under: { es: 'Por debajo', en: 'Under' },
  over: { es: 'Por encima', en: 'Over' },
  equal: { es: 'Igual', en: 'Equal' },
  unknown: { es: 'Sin dato', en: 'No data' },
});

/**
 * Summarize all snapshots for one model vs our asking price:
 * { model, ourPrice, count, min, max, under: n, over: n, equal: n, unknown: n }.
 * Buyer-facing prices only — nothing internal is involved here.
 */
export function summarizeModelPricing(model, snapshots = [], ourPrice = null) {
  const rows = snapshots.filter(
    (s) => normalizeKey(s?.model) === normalizeKey(model),
  );
  const summary = {
    model: typeof model === 'string' ? model : '',
    ourPrice: hasMoney(ourPrice) ? Number(ourPrice) : null,
    count: rows.length,
    min: null,
    max: null,
    under: 0,
    over: 0,
    equal: 0,
    unknown: 0,
  };
  const prices = rows.map((s) => Number(s.price)).filter(hasMoney);
  if (prices.length) {
    summary.min = Math.min(...prices);
    summary.max = Math.max(...prices);
  }
  for (const row of rows) {
    summary[pricePosition(ourPrice, row.price).position] += 1;
  }
  return summary;
}

const normalizeKey = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
