// Import/Export RFQ deal math engine — pure, unit-testable, zero dependencies.
// Bilingual (Spanish/English). No cesium, no network, no API keys.
// Mirrors the crude cargoEngine.js pattern and honesty conventions:
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

/** Format a quantity with commas (units live on the RFQ). Bad input -> "0". */
export function formatQty(n) {
  const value = Math.round(safeNum(n));
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Landed cost total: unitCost*quantity + freight + duties + otherCosts.
 * Costs are flattened on the RFQ (no nested cost object).
 */
export function landedCostTotal({
  unitCost,
  quantity,
  freight,
  duties,
  otherCosts,
} = {}) {
  return (
    safeNum(unitCost) * safeNum(quantity) +
    safeNum(freight) +
    safeNum(duties) +
    safeNum(otherCosts)
  );
}

/** Landed cost per unit. 0 when quantity is missing/zero. */
export function landedCostUnit(rfq = {}) {
  if (!rfq || typeof rfq !== 'object') return 0;
  const quantity = safeNum(rfq.quantity);
  if (quantity <= 0) return 0;
  return landedCostTotal(rfq) / quantity;
}

function hasNumber(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

/**
 * Unit sell price needed to hit a target margin.
 *
 * targetMarginPct is a percent (20 = 20%); a value <= 1 is also accepted as a
 * fraction (0.2 = 20%). target = landedCostUnit / (1 - margin).
 * Returns 0 (invalid) when the margin is negative or >= 1, or when the
 * landed cost per unit cannot be computed from the data present.
 */
export function targetSellPrice({
  unitCost,
  freight,
  duties,
  otherCosts,
  quantity,
  targetMarginPct,
} = {}) {
  if (!hasNumber(quantity) || safeNum(quantity) <= 0) return 0;
  if (!hasNumber(unitCost)) return 0;
  let margin = Number(targetMarginPct);
  if (!Number.isFinite(margin) || margin < 0) return 0;
  if (margin > 1) margin = margin / 100; // percent -> fraction
  if (margin >= 1) return 0;
  const landed = landedCostUnit({
    unitCost,
    quantity,
    freight,
    duties,
    otherCosts,
  });
  if (landed <= 0) return 0;
  return landed / (1 - margin);
}

/** Net margin total: sellUnitPrice*quantity - landedCostTotal. */
export function netMarginTotal(rfq = {}) {
  if (!rfq || typeof rfq !== 'object') return 0;
  if (!hasMoney(rfq.sellUnitPrice) || !hasNumber(rfq.quantity)) return 0;
  const revenue = safeNum(rfq.sellUnitPrice) * safeNum(rfq.quantity);
  return revenue - landedCostTotal(rfq);
}

/** Net margin as a fraction of revenue. 0 when revenue is missing/invalid. */
export function netMarginPct(rfq = {}) {
  if (!rfq || typeof rfq !== 'object') return 0;
  if (!hasMoney(rfq.sellUnitPrice) || !hasNumber(rfq.quantity)) return 0;
  const revenue = safeNum(rfq.sellUnitPrice) * safeNum(rfq.quantity);
  if (revenue <= 0) return 0;
  return netMarginTotal(rfq) / revenue;
}

/** Broker commission total: sellUnitPrice*quantity*(commissionPct/100). */
export function commissionAmount(rfq = {}) {
  if (!rfq || typeof rfq !== 'object') return 0;
  if (!hasMoney(rfq.sellUnitPrice) || !hasNumber(rfq.quantity)) return 0;
  const revenue = safeNum(rfq.sellUnitPrice) * safeNum(rfq.quantity);
  return revenue * (safeNum(rfq.commissionPct) / 100);
}

const MISSING_FIELD_LABELS = [
  { field: 'unitCost', es: 'Costo unitario', en: 'Unit cost' },
  { field: 'sellUnitPrice', es: 'Precio de venta', en: 'Sell price' },
  { field: 'quantity', es: 'Cantidad', en: 'Quantity' },
  { field: 'product', es: 'Producto', en: 'Product' },
  { field: 'originPort', es: 'Puerto de origen', en: 'Origin port' },
  { field: 'destinationPort', es: 'Puerto destino', en: 'Destination port' },
];

function hasMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Report which core RFQ fields are missing, as bilingual entries.
 * Never invents data — just reports what's absent.
 */
export function missingFields(rfq = {}) {
  if (!rfq || typeof rfq !== 'object') return [...MISSING_FIELD_LABELS];
  const missing = [];
  for (const { field, es, en } of MISSING_FIELD_LABELS) {
    const present =
      field === 'product' ||
      field === 'originPort' ||
      field === 'destinationPort'
        ? hasText(rfq[field])
        : hasMoney(rfq[field]);
    if (!present) missing.push({ field, es, en });
  }
  return missing;
}

function fmtMoney2(n) {
  const value = Number(n);
  const shown = Number.isFinite(value) ? value : 0;
  const sign = shown < 0 ? '-' : '';
  return `${sign}$${Math.abs(shown).toFixed(2)}`;
}

function fmtPct(n) {
  const value = Number(n);
  const shown = Number.isFinite(value) ? value * 100 : 0;
  return `${shown.toFixed(1)}%`;
}

function reasonLines(rfq) {
  const landed = landedCostUnit(rfq || {});
  const net = netMarginTotal(rfq || {});
  const commission = commissionAmount(rfq || {});
  return [
    {
      es: `Costo landed por unidad: ${fmtMoney2(landed)}`,
      en: `Landed cost per unit: ${fmtMoney2(landed)}`,
    },
    {
      es: `Margen neto total: ${fmtMoney2(net)}`,
      en: `Net margin total: ${fmtMoney2(net)}`,
    },
    {
      es: `Comisión total: ${formatMoney(commission)}`,
      en: `Total commission: ${formatMoney(commission)}`,
    },
  ];
}

/**
 * RFQ verdict with bilingual labels.
 * - gray: unitCost/sellUnitPrice/quantity missing → "Faltan datos" / "Missing data"
 * - green: netMarginPct >= 0.10 → "Viable"
 * - yellow: netMarginPct >= 0.03 → "Marginal"
 * - red: otherwise → "No viable" / "No deal"
 * Reasons always include landed cost/unit, net margin total, and commission
 * total lines.
 */
export function rfqVerdict(rfq = {}) {
  const data = rfq && typeof rfq === 'object' ? rfq : {};
  const missing = missingFields(data);
  const priceMissing = missing.some((m) =>
    ['unitCost', 'sellUnitPrice', 'quantity'].includes(m.field),
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
  const marginPct = netMarginPct(data);
  const reasons = reasonLines(data);
  if (marginPct >= 0.1)
    return { tier: 'green', es: 'Viable', en: 'Viable', reasons };
  if (marginPct >= 0.03)
    return { tier: 'yellow', es: 'Marginal', en: 'Marginal', reasons };
  return { tier: 'red', es: 'No viable', en: 'No deal', reasons };
}

function hasCostValue(rfq, key) {
  const value = rfq?.[key];
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Score an RFQ 0..100 using only data present on the RFQ.
 * - unitCost + sellUnitPrice: 30
 * - quantity: 15
 * - supplierId or buyerId: 10
 * - incoterms: 5
 * - freight + duties + otherCosts all present: 15
 * - product: 5
 * - origin + destination ports: 10
 * - origin + destination coordinates: 10
 * Capped at 100. Missing fields score 0 — never invents data.
 */
export function scoreRfq(rfq) {
  if (!rfq || typeof rfq !== 'object') return 0;
  let score = 0;
  if (hasMoney(rfq.unitCost) && hasMoney(rfq.sellUnitPrice)) score += 30;
  if (hasMoney(rfq.quantity)) score += 15;
  if (hasText(rfq.supplierId) || hasText(rfq.buyerId)) score += 10;
  if (hasText(rfq.incoterms)) score += 5;
  if (['freight', 'duties', 'otherCosts'].every((k) => hasCostValue(rfq, k)))
    score += 15;
  if (hasText(rfq.product)) score += 5;
  if (hasText(rfq.originPort) && hasText(rfq.destinationPort)) score += 10;
  const hasOriginCoords =
    rfq.originLat !== null &&
    rfq.originLat !== undefined &&
    rfq.originLng !== null &&
    rfq.originLng !== undefined;
  const hasDestCoords =
    rfq.destLat !== null &&
    rfq.destLat !== undefined &&
    rfq.destLng !== null &&
    rfq.destLng !== undefined;
  if (hasOriginCoords && hasDestCoords) score += 10;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** Common incoterms; free-text incoterms are also allowed. */
export const INCOTERMS = Object.freeze(['FOB', 'CIF', 'EXW', 'DAP']);

export const VERDICT_TIERS = Object.freeze(['green', 'yellow', 'red', 'gray']);
