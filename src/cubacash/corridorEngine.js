// MY CUBA CASH corridor math engine — pure, unit-testable, zero dependencies.
// Bilingual (Spanish/English). No cesium, no network, no API keys.
// Mirrors the crude cargoEngine.js pattern and honesty conventions:
// missing data is reported, never invented. FX rates are always
// user-entered and stamped as-of — the engine never fabricates a rate.

/** Coerce to a finite non-negative number, else `fallback` (default 0). */
export function safeNum(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/** Format as dollars with cents, e.g. "$1,234.56". Bad input -> "$0.00". */
export function formatMoney(n) {
  const value = safeNum(n);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Format as a percentage with two decimals, e.g. "1.25%". */
export function formatPct(n) {
  const value = Number(n);
  const shown = Number.isFinite(value) ? value : 0;
  return `${shown.toFixed(2)}%`;
}

/**
 * MY CUBA CASH public platform fee schedule (concierge/beta, v0.9):
 *   family      1.25% (min $1, max $12)
 *   business    1.75% (no min/max cap)
 *   marketplace 2.50% on the seller (no min/max cap)
 * Infinity = no cap. Kept frozen: the platform fee is a public fact,
 * never negotiated per send.
 */
export const MY_CUBA_CASH_FEES = Object.freeze({
  family: Object.freeze({ pct: 1.25, min: 1, max: 12 }),
  business: Object.freeze({ pct: 1.75, min: 0, max: Infinity }),
  marketplace: Object.freeze({ pct: 2.5, min: 0, max: Infinity }),
});

export const FEE_TIERS = Object.freeze(['family', 'business', 'marketplace']);

export const FEE_TIER_LABELS = Object.freeze({
  family: { es: 'Familiar', en: 'Family' },
  business: { es: 'Negocios', en: 'Business' },
  marketplace: { es: 'Mercado', en: 'Marketplace' },
});

/**
 * MY CUBA CASH platform fee for a send amount and tier.
 * Returns null for an unknown tier or a non-positive amount.
 */
export function platformFee(amount, tier = 'family') {
  const schedule = MY_CUBA_CASH_FEES[tier];
  if (!schedule) return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  const raw = (value * schedule.pct) / 100;
  const capped = Math.min(Math.max(raw, schedule.min), schedule.max);
  return Math.round(capped * 100) / 100;
}

/**
 * Provider fee for a send amount.
 * provider.feeModel: { type: 'percentage' | 'flat' | 'mixed' | 'undisclosed',
 *   pct, flat, min, max }
 * Returns { fee, basis } with a bilingual explanation, or null when the
 * provider has not disclosed a fee model (or the amount is invalid).
 * Never guesses a fee — undisclosed means undisclosed.
 */
export function providerFee(amount, provider = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  const model = provider && provider.feeModel ? provider.feeModel : null;
  const type = model ? model.type : 'undisclosed';
  if (type === 'percentage') {
    const pct = Number(model.pct);
    if (!Number.isFinite(pct) || pct < 0) return null;
    const raw = (value * pct) / 100;
    const min = Number.isFinite(Number(model.min)) ? Number(model.min) : 0;
    const max = Number.isFinite(Number(model.max))
      ? Number(model.max)
      : Infinity;
    const fee = Math.round(Math.min(Math.max(raw, min), max) * 100) / 100;
    return {
      fee,
      basis: {
        es: `Tarifa del proveedor: ${pct}% del monto`,
        en: `Provider fee: ${pct}% of the amount`,
      },
    };
  }
  if (type === 'flat') {
    const flat = Number(model.flat);
    if (!Number.isFinite(flat) || flat < 0) return null;
    return {
      fee: Math.round(flat * 100) / 100,
      basis: {
        es: `Tarifa fija del proveedor: ${formatMoney(flat)}`,
        en: `Provider flat fee: ${formatMoney(flat)}`,
      },
    };
  }
  if (type === 'mixed') {
    const pct = Number(model.pct);
    const flat = Number(model.flat);
    if (!Number.isFinite(pct) || pct < 0) return null;
    if (!Number.isFinite(flat) || flat < 0) return null;
    const min = Number.isFinite(Number(model.min)) ? Number(model.min) : 0;
    const max = Number.isFinite(Number(model.max))
      ? Number(model.max)
      : Infinity;
    const raw = flat + (value * pct) / 100;
    const fee = Math.round(Math.min(Math.max(raw, min), max) * 100) / 100;
    return {
      fee,
      basis: {
        es: `Tarifa mixta: ${formatMoney(flat)} + ${pct}%`,
        en: `Mixed fee: ${formatMoney(flat)} + ${pct}%`,
      },
    };
  }
  // 'undisclosed' or anything else: no fee is ever invented.
  return null;
}

/**
 * Corridor math for one send.
 *   { sendAmount, fee, fxRate } -> {
 *     sendAmount, fee, netSend, fxRate, receivedAmount, effectiveFeePct }
 * fxRate = units of destination currency per 1 USD sent (user-entered).
 * receivedAmount = (sendAmount - fee) * fxRate.
 * Any missing/invalid input yields null fields — never a made-up number.
 */
export function corridorMath({ sendAmount, fee, fxRate } = {}) {
  const amount = Number(sendAmount);
  const amountOk = Number.isFinite(amount) && amount > 0;
  // null/undefined/'' mean "no fee entered" — never Number(null) → 0.
  const feeNum =
    fee === null || fee === undefined || fee === '' ? NaN : Number(fee);
  const feeOk = Number.isFinite(feeNum) && feeNum >= 0;
  const rate = Number(fxRate);
  const rateOk = Number.isFinite(rate) && rate > 0;
  if (!amountOk) {
    return {
      sendAmount: null,
      fee: feeOk ? Math.round(feeNum * 100) / 100 : null,
      netSend: null,
      fxRate: rateOk ? rate : null,
      receivedAmount: null,
      effectiveFeePct: null,
    };
  }
  const feeValue = feeOk ? Math.round(feeNum * 100) / 100 : null;
  const netSend =
    feeValue === null ? null : Math.round((amount - feeValue) * 100) / 100;
  return {
    sendAmount: Math.round(amount * 100) / 100,
    fee: feeValue,
    netSend,
    fxRate: rateOk ? rate : null,
    receivedAmount:
      netSend === null || !rateOk
        ? null
        : Math.round(netSend * rate * 100) / 100,
    effectiveFeePct:
      feeValue === null ? null : Math.round((feeValue / amount) * 10000) / 100,
  };
}

const MISSING_FIELD_LABELS = [
  { field: 'sendAmount', es: 'Monto a enviar', en: 'Send amount' },
  {
    field: 'fxRate',
    es: 'Tasa de cambio (con fecha)',
    en: 'FX rate (with as-of date)',
  },
  { field: 'providerId', es: 'Proveedor', en: 'Provider' },
  { field: 'fromCountry', es: 'País de origen', en: 'From country' },
  { field: 'toCountry', es: 'País destino', en: 'To country' },
];

function hasMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Report which core corridor fields are missing, as bilingual entries.
 * Never invents data — just reports what's absent.
 */
export function missingFields(corridor = {}) {
  if (!corridor || typeof corridor !== 'object')
    return [...MISSING_FIELD_LABELS];
  const missing = [];
  for (const { field, es, en } of MISSING_FIELD_LABELS) {
    const present =
      field === 'sendAmount' || field === 'fxRate'
        ? hasMoney(corridor[field])
        : hasText(corridor[field]);
    if (!present) missing.push({ field, es, en });
  }
  return missing;
}

/**
 * Corridor verdict with bilingual labels.
 * - gray: sendAmount or fxRate missing → "Faltan datos" / "Missing data"
 * - green: effectiveFeePct <= 2 → "Buena tarifa" / "Good rate"
 * - yellow: effectiveFeePct <= 5 → "Aceptable" / "Acceptable"
 * - red: otherwise → "Tarifa alta" / "High fee"
 * effectiveFeePct needs a known fee; without a fee model the verdict is gray.
 */
export function corridorVerdict(corridor = {}) {
  const data = corridor && typeof corridor === 'object' ? corridor : {};
  const math = corridorMath({
    sendAmount: data.sendAmount,
    fee: data.fee,
    fxRate: data.fxRate,
  });
  const reasons = [];
  if (math.sendAmount === null || math.fxRate === null) {
    const missing = missingFields(data);
    return {
      tier: 'gray',
      es: 'Faltan datos',
      en: 'Missing data',
      reasons: [
        ...missing.map(({ es, en }) => ({
          es: `Falta: ${es}`,
          en: `Missing: ${en}`,
        })),
      ],
    };
  }
  reasons.push({
    es: `Monto: ${formatMoney(math.sendAmount)}`,
    en: `Amount: ${formatMoney(math.sendAmount)}`,
  });
  reasons.push({
    es: `Tasa: ${math.fxRate} (ingresada manualmente)`,
    en: `Rate: ${math.fxRate} (entered manually)`,
  });
  if (math.fee !== null) {
    reasons.push({
      es: `Tarifa: ${formatMoney(math.fee)} (${formatPct(math.effectiveFeePct)})`,
      en: `Fee: ${formatMoney(math.fee)} (${formatPct(math.effectiveFeePct)})`,
    });
    reasons.push({
      es: `Recibe: ${formatMoney(math.receivedAmount)}`,
      en: `Receives: ${formatMoney(math.receivedAmount)}`,
    });
    const pct = math.effectiveFeePct;
    if (pct <= 2)
      return { tier: 'green', es: 'Buena tarifa', en: 'Good rate', reasons };
    if (pct <= 5)
      return { tier: 'yellow', es: 'Aceptable', en: 'Acceptable', reasons };
    return { tier: 'red', es: 'Tarifa alta', en: 'High fee', reasons };
  }
  reasons.push({
    es: 'Tarifa del proveedor sin declarar — no se calcula el veredicto',
    en: 'Provider fee undisclosed — no verdict computed',
  });
  return { tier: 'gray', es: 'Faltan datos', en: 'Missing data', reasons };
}

/**
 * Compare providers for one send amount.
 * compareProviders({ amount, providers, fxByProvider })
 *   fxByProvider: { [providerId]: { rate, asOf } } — all rates user-entered.
 * Returns rows sorted by receivedAmount (desc); rows without a fee or a
 * rate carry the missing fields and sort last. Never invents a fee or rate.
 */
export function compareProviders({ amount, providers, fxByProvider } = {}) {
  const value = Number(amount);
  const amountOk = Number.isFinite(value) && value > 0;
  const list = Array.isArray(providers) ? providers : [];
  const fx =
    fxByProvider && typeof fxByProvider === 'object' ? fxByProvider : {};
  const rows = list.map((provider) => {
    const id = provider && provider.id !== undefined ? provider.id : null;
    const name = provider && provider.name ? String(provider.name) : '';
    const feeInfo = amountOk ? providerFee(value, provider || {}) : null;
    const rateEntry = id !== null ? fx[id] : null;
    const rate = rateEntry ? Number(rateEntry.rate) : NaN;
    const rateOk = Number.isFinite(rate) && rate > 0;
    const math = corridorMath({
      sendAmount: amountOk ? value : null,
      fee: feeInfo ? feeInfo.fee : null,
      fxRate: rateOk ? rate : null,
    });
    const missing = [];
    if (!amountOk) missing.push({ es: 'monto', en: 'amount' });
    if (!feeInfo)
      missing.push({ es: 'tarifa del proveedor', en: 'provider fee' });
    if (!rateOk) missing.push({ es: 'tasa de cambio', en: 'FX rate' });
    return {
      providerId: id,
      name,
      fee: feeInfo ? feeInfo.fee : null,
      feeBasis: feeInfo ? feeInfo.basis : null,
      fxRate: rateOk ? rate : null,
      fxAsOf: rateEntry && rateEntry.asOf ? String(rateEntry.asOf) : '',
      receivedAmount: math.receivedAmount,
      effectiveFeePct: math.effectiveFeePct,
      missing,
      complete: missing.length === 0,
    };
  });
  rows.sort((a, b) => {
    if (a.receivedAmount === null && b.receivedAmount === null) return 0;
    if (a.receivedAmount === null) return 1;
    if (b.receivedAmount === null) return -1;
    return b.receivedAmount - a.receivedAmount;
  });
  return rows;
}

/**
 * Score a provider record 0..100 using only data present on the provider.
 * - name: 25
 * - channels: 15
 * - coverageCountries: 10
 * - disclosed fee model (not 'undisclosed'): 25
 * - website: 10
 * - coordinates (lat+lng): 15
 * Capped at 100. Missing fields score 0 — never invents data.
 */
export function scoreProvider(provider) {
  if (!provider || typeof provider !== 'object') return 0;
  let score = 0;
  if (hasText(provider.name)) score += 25;
  if (Array.isArray(provider.channels) && provider.channels.length > 0)
    score += 15;
  if (
    Array.isArray(provider.coverageCountries) &&
    provider.coverageCountries.length > 0
  )
    score += 10;
  if (
    provider.feeModel &&
    provider.feeModel.type &&
    provider.feeModel.type !== 'undisclosed'
  )
    score += 25;
  if (hasText(provider.website)) score += 10;
  if (
    Number.isFinite(Number(provider.lat)) &&
    Number.isFinite(Number(provider.lng))
  )
    score += 15;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export const VERDICT_TIERS = Object.freeze(['green', 'yellow', 'red', 'gray']);
