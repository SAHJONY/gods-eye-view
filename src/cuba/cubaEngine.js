// Cuba market deal math engine — pure, unit-testable, zero dependencies.
// Bilingual (Spanish-first/English). No cesium, no network, no API keys.
// Mirrors the trade rfqEngine.js honesty conventions: missing data is
// reported, never invented. Never throws on bad input.
//
// SAHJONY is a fee/spread BROKER — never the end buyer, zero capital at
// risk. Every function below treats the request as a brokered sourcing
// request, never as a purchase.

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

/** Format a quantity with commas. Bad input -> "0". */
export function formatQty(n) {
  const value = Math.round(safeNum(n));
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function hasMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const MISSING_FIELD_LABELS = [
  { field: 'ref', es: 'Referencia', en: 'Reference' },
  { field: 'product', es: 'Producto', en: 'Product' },
  { field: 'quantity', es: 'Cantidad', en: 'Quantity' },
  { field: 'targetPrice', es: 'Precio objetivo', en: 'Target price' },
  { field: 'buyerId', es: 'Comprador vinculado', en: 'Linked buyer' },
  { field: 'incoterms', es: 'Incoterms', en: 'Incoterms' },
  {
    field: 'destinationPort',
    es: 'Puerto de destino',
    en: 'Destination port',
  },
  { field: 'timeline', es: 'Plazo de entrega', en: 'Delivery timeline' },
];

function hasPriceablePrice(req) {
  return hasMoney(req?.targetPrice);
}

/**
 * Report which core sourcing-request fields are missing, as bilingual
 * entries. Never invents data — just reports what's absent.
 */
export function missingFields(req = {}) {
  if (!req || typeof req !== 'object') return [...MISSING_FIELD_LABELS];
  const missing = [];
  for (const { field, es, en } of MISSING_FIELD_LABELS) {
    const present =
      field === 'quantity' || field === 'targetPrice'
        ? hasMoney(req[field])
        : hasText(field === 'ref' ? req.ref : req[field]);
    if (!present) missing.push({ field, es, en });
  }
  return missing;
}

/**
 * Score a sourcing request 0..100 using only data present on the request.
 * - product: 15
 * - quantity (> 0): 15
 * - targetPrice (> 0): 10
 * - buyerId linked: 15
 * - incoterms: 5
 * - destinationPort: 10
 * - timeline: 10
 * - quantity + targetPrice both present (priceable): 10
 * - currency: 2
 * - ref: 3
 * - notes: 5
 * Capped at 100. Missing fields score 0 — never invents data.
 */
export function scoreSourcingRequest(req) {
  if (!req || typeof req !== 'object') return 0;
  let score = 0;
  if (hasText(req.product)) score += 15;
  if (hasMoney(req.quantity)) score += 15;
  if (hasPriceablePrice(req)) score += 10;
  if (hasText(req.buyerId)) score += 15;
  if (hasText(req.incoterms)) score += 5;
  if (hasText(req.destinationPort)) score += 10;
  if (hasText(req.timeline)) score += 10;
  if (hasMoney(req.quantity) && hasPriceablePrice(req)) score += 10;
  if (hasText(req.currency)) score += 2;
  if (hasText(req.ref)) score += 3;
  if (hasText(req.notes)) score += 5;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function fmtPct(n) {
  const value = Number(n);
  const shown = Number.isFinite(value) ? value * 100 : 0;
  return `${shown.toFixed(1)}%`;
}

/**
 * Sourcing-request verdict with bilingual labels.
 * - gray: ref/product/quantity missing → "Faltan datos" / "Missing data"
 * - green: score >= 70 → "Listo para cotizar" / "Ready to quote"
 * - yellow: score >= 40 → "Parcial" / "Partial"
 * - red: otherwise → "Débil" / "Weak"
 */
export function requestVerdict(req = {}) {
  const data = req && typeof req === 'object' ? req : {};
  const missing = missingFields(data);
  const coreMissing = missing.some((m) =>
    ['ref', 'product', 'quantity'].includes(m.field),
  );
  const score = scoreSourcingRequest(data);
  if (coreMissing) {
    return {
      tier: 'gray',
      es: 'Faltan datos',
      en: 'Missing data',
      score,
      missing,
      reasons: missing.map(({ es, en }) => ({
        es: `Falta: ${es}`,
        en: `Missing: ${en}`,
      })),
    };
  }
  if (score >= 70)
    return {
      tier: 'green',
      es: 'Listo para cotizar',
      en: 'Ready to quote',
      score,
      missing,
      reasons: [
        {
          es: `Puntaje de completitud: ${score}/100`,
          en: `Completeness score: ${score}/100`,
        },
      ],
    };
  if (score >= 40)
    return {
      tier: 'yellow',
      es: 'Parcial',
      en: 'Partial',
      score,
      missing,
      reasons: [
        ...missing.map(({ es, en }) => ({
          es: `Falta: ${es}`,
          en: `Missing: ${en}`,
        })),
        {
          es: `Puntaje de completitud: ${score}/100`,
          en: `Completeness score: ${score}/100`,
        },
      ],
    };
  return {
    tier: 'red',
    es: 'Débil',
    en: 'Weak',
    score,
    missing,
    reasons: [
      ...missing.map(({ es, en }) => ({
        es: `Falta: ${es}`,
        en: `Missing: ${en}`,
      })),
      {
        es: `Puntaje de completitud: ${score}/100`,
        en: `Completeness score: ${score}/100`,
      },
    ],
  };
}

/**
 * Potential broker spread on a sourcing request: targetPrice*quantity
 * (gross request value) — the spread/fee is negotiated per deal, so this
 * only sizes the opportunity. SAHJONY never buys: zero capital at risk.
 */
export function requestValue(req = {}) {
  if (!req || typeof req !== 'object') return 0;
  if (!hasMoney(req.targetPrice) || !hasMoney(req.quantity)) return 0;
  return safeNum(req.targetPrice) * safeNum(req.quantity);
}

const TIER_DEFS = [
  {
    id: 'gold',
    es: 'Oro',
    en: 'Gold',
    minVolume: 50000,
    desc: {
      es: 'Socio Oro: ≥ $50,000 en volumen cerrado.',
      en: 'Gold partner: ≥ $50,000 in closed volume.',
    },
  },
  {
    id: 'silver',
    es: 'Plata',
    en: 'Silver',
    minVolume: 10000,
    minReferrals: 10,
    desc: {
      es: 'Socio Plata: ≥ $10,000 en volumen cerrado o ≥ 10 referidos.',
      en: 'Silver partner: ≥ $10,000 in closed volume or ≥ 10 referrals.',
    },
  },
  {
    id: 'bronze',
    es: 'Bronce',
    en: 'Bronze',
    minVolume: 0,
    desc: {
      es: 'Socio Bronce: registro inicial.',
      en: 'Bronze partner: initial registration.',
    },
  },
];

/**
 * Partner tier math — pure. Tiers are computed from closed deal volume
 * (USD) and referral count only; nothing is fetched or invented.
 * - gold: closedVolume >= 50,000
 * - silver: closedVolume >= 10,000 OR referrals >= 10
 * - bronze: otherwise
 * Returns { tier, es, en, progressToNext } where progressToNext is null on
 * gold and { usdNeeded } otherwise.
 */
export function partnerTier({ closedVolume = 0, referrals = 0 } = {}) {
  const volume = safeNum(closedVolume);
  const refs = Math.max(0, Math.round(safeNum(referrals)));
  if (volume >= 50000) {
    const gold = TIER_DEFS[0];
    return {
      tier: gold.id,
      es: gold.es,
      en: gold.en,
      progressToNext: null,
    };
  }
  if (volume >= 10000 || refs >= 10) {
    const silver = TIER_DEFS[1];
    return {
      tier: silver.id,
      es: silver.es,
      en: silver.en,
      progressToNext: { usdNeeded: Math.max(0, 50000 - volume) },
    };
  }
  const bronze = TIER_DEFS[2];
  const silverBar = refs >= 10 ? 0 : 10000 - volume;
  return {
    tier: bronze.id,
    es: bronze.es,
    en: bronze.en,
    progressToNext: { usdNeeded: Math.max(0, silverBar) },
  };
}

/**
 * Buyer completeness 0..100 — share of the key directory fields that are
 * present. Pure reporting; missing data scores 0, never invented.
 */
export function buyerCompleteness(buyer = {}) {
  if (!buyer || typeof buyer !== 'object') return 0;
  const checks = [
    hasText(buyer.name),
    hasText(buyer.type),
    hasText(buyer.province),
    hasText(buyer.municipality),
    hasText(buyer.contact?.name) ||
      hasText(buyer.contact?.phone) ||
      hasText(buyer.contact?.whatsapp),
    hasText(buyer.activity),
    Array.isArray(buyer.interestedProducts) &&
      buyer.interestedProducts.length > 0,
    buyer.verification === 'verified',
  ];
  const hit = checks.filter(Boolean).length;
  return Math.round((hit / checks.length) * 100);
}

function normWord(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Match a sourcing request against a buyer directory entry, 0..100.
 * - +50 if the product text shares a token with the buyer's
 *   interestedProducts (accent/case-insensitive).
 * - +20 if the request's destinationPort is in the buyer's province/municipality
 *   text (best-effort, purely textual).
 * - +20 if the buyer is verified.
 * - +10 if the buyer has a WhatsApp contact.
 * Pure and textual — no external lookups.
 */
export function matchBuyerToRequest(request = {}, buyer = {}) {
  if (!request || typeof request !== 'object') return 0;
  if (!buyer || typeof buyer !== 'object') return 0;
  let score = 0;
  const productTokens = normWord(request.product)
    .split(/[\s,;./-]+/)
    .filter((t) => t.length > 2);
  const buyerProducts = Array.isArray(buyer.interestedProducts)
    ? buyer.interestedProducts.map(normWord)
    : [];
  const productHit =
    productTokens.length > 0 &&
    productTokens.some((tok) =>
      buyerProducts.some((bp) => bp.includes(tok) || tok.includes(bp)),
    );
  if (productHit) score += 50;
  const portNorm = normWord(request.destinationPort);
  const areaNorm = normWord(`${buyer.province} ${buyer.municipality}`);
  if (portNorm && areaNorm && portNorm.length > 2) {
    const portTokens = portNorm.split(/[\s-]+/).filter((t) => t.length > 2);
    if (portTokens.some((t) => areaNorm.includes(t))) score += 20;
  }
  if (buyer.verification === 'verified') score += 20;
  if (hasText(buyer.contact?.whatsapp)) score += 10;
  return Math.min(100, Math.max(0, score));
}

/**
 * Suggested buyer ranking for a request: [{ buyer, score }] sorted
 * highest-first. Only buyers with score > 0 are returned.
 */
export function rankBuyersForRequest(request = {}, buyers = []) {
  if (!Array.isArray(buyers)) return [];
  return buyers
    .map((buyer) => ({ buyer, score: matchBuyerToRequest(request, buyer) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

export const REQUEST_VERDICT_TIERS = Object.freeze([
  'green',
  'yellow',
  'red',
  'gray',
]);

export const PARTNER_TIERS = Object.freeze(['bronze', 'silver', 'gold']);
