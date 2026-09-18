// Crude cargo deal math engine — pure, unit-testable, zero dependencies.
// Bilingual (Spanish/English). No cesium, no network, no API keys.
// Mirrors the wholesale dealEngine.js pattern and honesty conventions:
// missing data is reported, never invented. Never throws on bad input.

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

/** Format a barrel volume with commas. Bad input -> "0 bbl". */
export function formatBbl(n) {
  const value = Math.round(safeNum(n));
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} bbl`;
}

/** Price spread per barrel: sellPrice - buyPrice. Can be negative. */
export function spreadPerBbl({ buyPrice, sellPrice } = {}) {
  return safeNum(sellPrice) - safeNum(buyPrice);
}

/** Gross margin: volumeBbl * spreadPerBbl. */
export function grossMargin({ volumeBbl, buyPrice, sellPrice } = {}) {
  return safeNum(volumeBbl) * spreadPerBbl({ buyPrice, sellPrice });
}

/** Sum of the four cost buckets (freight, insurance, inspection, other). */
export function totalCosts({ freight, insurance, inspection, other } = {}) {
  return (
    safeNum(freight) + safeNum(insurance) + safeNum(inspection) + safeNum(other)
  );
}

/** Net margin: gross margin minus all costs. */
export function netMargin(cargo = {}) {
  if (!cargo || typeof cargo !== 'object') return 0;
  return grossMargin(cargo) - totalCosts(cargo.costs || {});
}

/** Broker commission total: volumeBbl * commissionPerBbl (USD). */
export function brokerCommission({ volumeBbl, commissionPerBbl } = {}) {
  return safeNum(volumeBbl) * safeNum(commissionPerBbl);
}

/** Net margin per barrel. 0 when volume is missing/zero. */
export function netPerBbl(cargo = {}) {
  if (!cargo || typeof cargo !== 'object') return 0;
  const volume = safeNum(cargo.volumeBbl);
  if (volume <= 0) return 0;
  return netMargin(cargo) / volume;
}

const MISSING_FIELD_LABELS = [
  { field: 'buyPrice', es: 'Precio de compra', en: 'Buy price' },
  { field: 'sellPrice', es: 'Precio de venta', en: 'Sell price' },
  { field: 'volumeBbl', es: 'Volumen (bbl)', en: 'Volume (bbl)' },
  { field: 'grade', es: 'Grado', en: 'Grade' },
  { field: 'loadPort', es: 'Puerto de carga', en: 'Load port' },
  { field: 'dischargePort', es: 'Puerto de descarga', en: 'Discharge port' },
];

function hasMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Report which core cargo fields are missing, as bilingual entries.
 * Never invents data — just reports what's absent.
 */
export function missingFields(cargo = {}) {
  if (!cargo || typeof cargo !== 'object') return [...MISSING_FIELD_LABELS];
  const missing = [];
  for (const { field, es, en } of MISSING_FIELD_LABELS) {
    const present =
      field === 'grade' || field === 'loadPort' || field === 'dischargePort'
        ? hasText(cargo[field])
        : hasMoney(cargo[field]);
    if (!present) missing.push({ field, es, en });
  }
  return missing;
}

function fmtPerBbl(n) {
  const value = Number(n);
  const shown = Number.isFinite(value) ? value : 0;
  const sign = shown < 0 ? '-' : '';
  return `${sign}$${Math.abs(shown).toFixed(2)}`;
}

function reasonLines(cargo) {
  const spread = spreadPerBbl(cargo || {});
  const net = netPerBbl(cargo || {});
  const commission = brokerCommission(cargo || {});
  return [
    {
      es: `Margen por barril: ${fmtPerBbl(spread)}`,
      en: `Spread per barrel: ${fmtPerBbl(spread)}`,
    },
    {
      es: `Neto por barril: ${fmtPerBbl(net)}`,
      en: `Net per barrel: ${fmtPerBbl(net)}`,
    },
    {
      es: `Comisión total: ${formatMoney(commission)}`,
      en: `Total commission: ${formatMoney(commission)}`,
    },
  ];
}

/**
 * Cargo verdict with bilingual labels.
 * - gray: buyPrice/sellPrice/volumeBbl missing → "Faltan datos" / "Missing data"
 * - green: netPerBbl >= 2 → "Viable"
 * - yellow: netPerBbl >= 0.5 → "Marginal"
 * - red: otherwise → "No viable" / "No deal"
 * Reasons always include spread/bbl, net/bbl, and commission total lines.
 */
export function cargoVerdict(cargo = {}) {
  const data = cargo && typeof cargo === 'object' ? cargo : {};
  const missing = missingFields(data);
  const priceMissing = missing.some((m) =>
    ['buyPrice', 'sellPrice', 'volumeBbl'].includes(m.field),
  );
  if (priceMissing) {
    return {
      tier: 'gray',
      es: 'Faltan datos',
      en: 'Missing data',
      reasons: [
        ...missing.map(({ es, en }) => ({
          es: `Falta: ${es}`,
          en: `Missing: ${en}`,
        })),
        ...reasonLines(data),
      ],
    };
  }
  const net = netPerBbl(data);
  const reasons = reasonLines(data);
  if (net >= 2) return { tier: 'green', es: 'Viable', en: 'Viable', reasons };
  if (net >= 0.5)
    return { tier: 'yellow', es: 'Marginal', en: 'Marginal', reasons };
  return { tier: 'red', es: 'No viable', en: 'No deal', reasons };
}

const COST_KEYS = ['freight', 'insurance', 'inspection', 'other'];

function hasCostValue(costs, key) {
  const value = costs?.[key];
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Score a cargo 0..100 using only data present on the cargo.
 * - buy+sell prices: 30
 * - volumeBbl: 20
 * - supplierId or buyerId: 15
 * - incoterms: 5
 * - laycanStart + laycanEnd: 5
 * - all four cost fields present: 15
 * - grade: 5
 * - load + discharge ports: 5
 * Capped at 100. Missing fields score 0 — never invents data.
 */
export function scoreCargo(cargo) {
  if (!cargo || typeof cargo !== 'object') return 0;
  let score = 0;
  if (hasMoney(cargo.buyPrice) && hasMoney(cargo.sellPrice)) score += 30;
  if (hasMoney(cargo.volumeBbl)) score += 20;
  if (hasText(cargo.supplierId) || hasText(cargo.buyerId)) score += 15;
  if (hasText(cargo.incoterms)) score += 5;
  if (hasText(cargo.laycanStart) && hasText(cargo.laycanEnd)) score += 5;
  if (COST_KEYS.every((key) => hasCostValue(cargo.costs, key))) score += 15;
  if (hasText(cargo.grade)) score += 5;
  if (hasText(cargo.loadPort) && hasText(cargo.dischargePort)) score += 5;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** Common grades; free-text grades are also allowed. */
export const GRADE_PRESETS = Object.freeze([
  'WTI',
  'Brent',
  'Maya',
  'Urals',
  'Dubai',
  'Bonny Light',
  'Arab Light',
]);

export const INCOTERMS = Object.freeze(['FOB', 'CIF', 'DAP']);

export const VERDICT_TIERS = Object.freeze(['green', 'yellow', 'red', 'gray']);

// ---------------------------------------------------------------------------
// Deal economics v1 — per-barrel commission math, netback, cargo P&L summary.
// All pure (no I/O, no DOM), defensive against junk input, bilingual labels.
// Broker positioning: SAHJONY is a fee-only broker — commission per barrel
// is SAHJONY's revenue; the deal P&L belongs to the counterparties.
// ---------------------------------------------------------------------------

/** Broker positioning copy — SAHJONY never takes title, zero capital at risk. */
export const BROKER_BASIS = Object.freeze({
  es: 'SAHJONY actúa como corredor por comisión: nunca toma título del cargamento ni arriesga capital. Ingreso = comisión por barril.',
  en: 'SAHJONY acts as a commission broker: never takes title to the cargo and puts zero capital at risk. Revenue = per-barrel commission.',
});

/**
 * Commission per barrel from a total commission: commissionTotal / volumeBbl.
 * 0 when volume is missing/zero. Never throws.
 */
export function commissionPerBblFromTotal({ volumeBbl, commissionTotal } = {}) {
  const volume = safeNum(volumeBbl);
  if (volume <= 0) return 0;
  return safeNum(commissionTotal) / volume;
}

/**
 * Commission per barrel as a share of the spread (0..1+ ratio).
 * 0 when the spread is missing/zero/negative. Never throws.
 */
export function commissionShareOfSpread({
  commissionPerBbl,
  buyPrice,
  sellPrice,
} = {}) {
  const spread = safeNum(sellPrice) - safeNum(buyPrice);
  if (spread <= 0) return 0;
  return safeNum(commissionPerBbl) / spread;
}

const NETBACK_DEDUCTION_LABELS = {
  freightPerBbl: { es: 'Flete', en: 'Freight' },
  insurancePerBbl: { es: 'Seguro', en: 'Insurance' },
  warRiskPerBbl: { es: 'Riesgo de guerra', en: 'War risk' },
};

/**
 * Netback per barrel: benchmark price minus explicit per-barrel deductions.
 * All deductions are explicit inputs — nothing is assumed.
 * adjustments: [{ es, en, amountPerBbl }] extra named deductions.
 * Returns { benchmarkPrice, deductions: [{es, en, amountPerBbl}],
 *           totalDeductionsPerBbl, netbackPerBbl }.
 */
export function netback({
  benchmarkPrice,
  freightPerBbl = 0,
  insurancePerBbl = 0,
  warRiskPerBbl = 0,
  adjustments = [],
} = {}) {
  const benchmark = safeNum(benchmarkPrice);
  const deductions = [];
  for (const key of ['freightPerBbl', 'insurancePerBbl', 'warRiskPerBbl']) {
    const amount = safeNum({ freightPerBbl, insurancePerBbl, warRiskPerBbl }[key]);
    if (amount > 0) {
      deductions.push({
        ...NETBACK_DEDUCTION_LABELS[key],
        amountPerBbl: amount,
      });
    }
  }
  if (Array.isArray(adjustments)) {
    for (const adj of adjustments) {
      if (!adj || typeof adj !== 'object') continue;
      const amount = safeNum(adj.amountPerBbl);
      if (amount <= 0) continue;
      deductions.push({
        es:
          typeof adj.es === 'string' && adj.es.trim()
            ? adj.es
            : typeof adj.label === 'string'
              ? adj.label
              : 'Ajuste',
        en:
          typeof adj.en === 'string' && adj.en.trim()
            ? adj.en
            : typeof adj.label === 'string'
              ? adj.label
              : 'Adjustment',
        amountPerBbl: amount,
      });
    }
  }
  const totalDeductionsPerBbl = deductions.reduce(
    (sum, d) => sum + d.amountPerBbl,
    0,
  );
  return {
    benchmarkPrice: benchmark,
    deductions,
    totalDeductionsPerBbl,
    netbackPerBbl: benchmark - totalDeductionsPerBbl,
  };
}

/**
 * Cargo P&L summary (pure).
 * - deal: the transaction economics (counterparties' side): gross spread,
 *   costs, net total/per-bbl.
 * - broker: SAHJONY's side — per-barrel commission only (basis note included).
 * - netback: netback() result when cargo.netback carries a benchmark price,
 *   else null.
 * - missing: bilingual missing-fields report (never invents data).
 */
export function cargoPnL(cargo = {}) {
  const c = cargo && typeof cargo === 'object' ? cargo : {};
  const volumeBbl = safeNum(c.volumeBbl);
  const buyPrice = safeNum(c.buyPrice);
  const sellPrice = safeNum(c.sellPrice);
  const spreadPerBbl = sellPrice - buyPrice;
  const grossSpread = volumeBbl * spreadPerBbl;
  const costsTotal = totalCosts(c.costs || {});
  const netTotal = grossSpread - costsTotal;
  const commissionPerBbl = safeNum(c.commissionPerBbl);
  const nb = c.netback && typeof c.netback === 'object' ? c.netback : null;
  return {
    volumeBbl,
    buyPrice,
    sellPrice,
    spreadPerBbl,
    deal: {
      grossSpread,
      costsTotal,
      netTotal,
      netPerBbl: volumeBbl > 0 ? netTotal / volumeBbl : 0,
    },
    broker: {
      commissionPerBbl,
      commissionTotal: volumeBbl * commissionPerBbl,
      basis: BROKER_BASIS,
    },
    netback: nb && safeNum(nb.benchmarkPrice) > 0 ? netback(nb) : null,
    missing: missingFields(c),
  };
}
