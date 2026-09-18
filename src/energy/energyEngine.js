// SAHJONY · GOD'S EYE VIEW — Energy (diesel/gasoline/LPG → Cuba) math engine.
// ---------------------------------------------------------------------------
// Pure, unit-testable, zero dependencies. Bilingual (Spanish/English).
// No cesium, no network, no API keys, no DOM.
//
// HONESTY RULES (never relaxed):
//   - Spec tables below are STATIC REFERENCE data from published product
//     standards (EN 590, EN 228, commercial-propane practice). They describe
//     what a spec sheet looks like — they are not live offers or lab results.
//   - SAHJONY is a fee/spread BROKER. These functions compute the broker's
//     spread/fee arithmetic only; SAHJONY never takes title, never buys or
//     sells product, zero capital at risk.
//   - Missing data is reported, never invented. Never throws on bad input.
//   - This engine does NO legal advice and NO sanctions analysis of any kind.

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

/** Format a gallon volume with commas. Bad input -> "0 gal". */
export function formatGal(n) {
  const value = Math.round(safeNum(n));
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} gal`;
}

/** Format a metric-ton volume. Bad input -> "0 MT". */
export function formatMt(n) {
  const value = safeNum(n);
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value)} MT`;
}

/** Products the energy module brokers (brokered goods, never owned). */
export const PRODUCTS = Object.freeze(['diesel', 'gasoline', 'lpg', 'crude']);

export const PRODUCT_LABELS = Object.freeze({
  diesel: { es: 'Diésel', en: 'Diesel' },
  gasoline: { es: 'Gasolina', en: 'Gasoline' },
  lpg: { es: 'GLP (propano)', en: 'LPG (propane)' },
  crude: { es: 'Crudo (referencia)', en: 'Crude (context only)' },
});

export function productLabel(product, lang = 'es') {
  const entry = PRODUCT_LABELS[product];
  if (!entry) return String(product ?? '');
  return lang === 'es' ? entry.es : entry.en;
}

// ---------------------------------------------------------------------------
// Static reference spec sheets (published standards — not live data).
// ---------------------------------------------------------------------------

const row = (es, en, value, unit = '', note = null) => ({
  param: { es, en },
  value,
  unit,
  ...(note ? { note } : {}),
});

export const PRODUCT_SPECS = Object.freeze({
  diesel: {
    product: 'diesel',
    standard: 'EN 590',
    standardNote: {
      es: 'Valores de referencia de la norma publicada EN 590. Referencia estática — no es una oferta ni un resultado de laboratorio.',
      en: 'Reference values from published standard EN 590. Static reference — not an offer or lab result.',
    },
    rows: [
      row('Densidad a 15 °C', 'Density at 15 °C', '820–845', 'kg/m³'),
      row('Azufre (S)', 'Sulfur (S)', '≤ 10', 'mg/kg'),
      row('Número de cetano', 'Cetane number', '≥ 51', ''),
      row('Índice de cetano', 'Cetane index', '≥ 46', ''),
      row('Punto de inflamación', 'Flash point', '> 55', '°C'),
      row(
        'Viscosidad cinemática a 40 °C',
        'Kinematic viscosity at 40 °C',
        '2.00–4.50',
        'mm²/s',
      ),
      row('Destilación, 95 % v/v', 'Distillation, 95 % v/v', '≤ 360', '°C'),
      row('Contenido de agua', 'Water content', '≤ 200', 'mg/kg'),
      row('Corrosión lámina de cobre', 'Copper strip corrosion', 'Clase 1', ''),
      row(
        'Estabilidad a la oxidación',
        'Oxidation stability',
        '≥ 20',
        'h (RPVOT)',
      ),
    ],
  },
  gasoline: {
    product: 'gasoline',
    standard: 'EN 228',
    standardNote: {
      es: 'Valores de referencia de la norma publicada EN 228 (gasolina sin plomo). Referencia estática — no es una oferta ni un resultado de laboratorio.',
      en: 'Reference values from published standard EN 228 (unleaded gasoline). Static reference — not an offer or lab result.',
    },
    rows: [
      row('Índice de octano RON', 'Research octane number (RON)', '≥ 95', ''),
      row('Índice de octano MON', 'Motor octane number (MON)', '≥ 85', ''),
      row('Azufre (S)', 'Sulfur (S)', '≤ 10', 'mg/kg'),
      row('Densidad a 15 °C', 'Density at 15 °C', '720–775', 'kg/m³'),
      row('Benceno', 'Benzene', '≤ 1.0', '% v/v'),
      row('Aromáticos', 'Aromatics', '≤ 35', '% v/v'),
      row('Olefinas', 'Olefins', '≤ 18', '% v/v'),
      row('Contenido de plomo', 'Lead content', '≤ 5', 'mg/l'),
      row('Presión de vapor (verano)', 'Vapor pressure (summer)', '45–60', 'kPa', {
        es: 'Grado de verano; el grado de invierno difiere.',
        en: 'Summer grade; winter grade differs.',
      }),
      row('Corrosión lámina de cobre', 'Copper strip corrosion', 'Clase 1', ''),
    ],
  },
  lpg: {
    product: 'lpg',
    standard: 'HD-5 / GPA 2140 (propano comercial)',
    standardNote: {
      es: 'Valores de referencia de propano comercial grado HD-5. Referencia estática — no es una oferta ni un resultado de laboratorio.',
      en: 'Reference values for HD-5 commercial-grade propane. Static reference — not an offer or lab result.',
    },
    rows: [
      row('Propano', 'Propane', '≥ 90', '% v/v'),
      row('Propileno', 'Propylene', '≤ 5', '% v/v'),
      row('Butanos y más pesados', 'Butanes and heavier', '≤ 2.5', '% v/v'),
      row('Azufre total', 'Total sulfur', '≤ 185', 'ppm m/m'),
      row(
        'Presión de vapor a 37.8 °C',
        'Vapor pressure at 37.8 °C',
        '≤ 1434',
        'kPa',
      ),
      row('Residuo volátil', 'Volatile residue', '≤ 0.05', 'ml/100 ml'),
      row('Corrosión lámina de cobre', 'Copper strip corrosion', 'N.º 1', ''),
      row(
        'Densidad líquida a 15 °C (propano)',
        'Liquid density at 15 °C (propane)',
        '~506',
        'kg/m³',
        {
          es: 'Valor de referencia para conversión; el GLP comercial varía por composición.',
          en: 'Reference value for conversion; commercial LPG varies with composition.',
        },
      ),
    ],
  },
});

/** Return the spec sheet for a product, or null for unknown products. */
export function getSpecSheet(product) {
  return PRODUCT_SPECS[product] || null;
}

// ---------------------------------------------------------------------------
// Reference conversion factors (published midpoint densities).
// ---------------------------------------------------------------------------

/** Reference densities (kg/L at 15 °C) used for MT ⇄ volume conversions. */
export const REF_DENSITY_KG_L = Object.freeze({
  diesel: 0.835,
  gasoline: 0.745,
  lpg: 0.506,
  crude: 0.86,
});

export const LITERS_PER_GALLON = 3.785411784;
export const GALLONS_PER_BARREL = 42;
export const KG_PER_MT = 1000;

/** Metric tons → gallons for a product's reference density. */
export function mtToGal(product, mt) {
  const density = REF_DENSITY_KG_L[product];
  const tons = safeNum(mt);
  if (!density || tons <= 0) return 0;
  return ((tons * KG_PER_MT) / density / LITERS_PER_GALLON);
}

/** Gallons → metric tons for a product's reference density. */
export function galToMt(product, gal) {
  const density = REF_DENSITY_KG_L[product];
  const gallons = safeNum(gal);
  if (!density || gallons <= 0) return 0;
  return ((gallons * LITERS_PER_GALLON * density) / KG_PER_MT);
}

/** US gallons → barrels (42 gal/bbl). */
export function galToBbl(gal) {
  return safeNum(gal) / GALLONS_PER_BARREL;
}

/** Barrels → US gallons. */
export function bblToGal(bbl) {
  return safeNum(bbl) * GALLONS_PER_BARREL;
}

/** Metric tons → barrels for a product's reference density. */
export function mtToBbl(product, mt) {
  return galToBbl(mtToGal(product, mt));
}

// ---------------------------------------------------------------------------
// Broker economics — SAHJONY earns a spread/fee, never takes title.
// ---------------------------------------------------------------------------

/**
 * Per-unit broker spread: sellPerUnit - buyPerUnit (same currency/unit).
 * Can be negative (bad deal). This is the BROKER's spread — SAHJONY never
 * buys or sells the product itself.
 */
export function spreadPerUnit({ buyPerUnit, sellPerUnit } = {}) {
  return safeNum(sellPerUnit, 0) - safeNum(buyPerUnit, 0);
}

/**
 * Total broker spread for a parcel: perUnitSpread × volumeUnits.
 */
export function totalSpread({ perUnitSpread, volumeUnits } = {}) {
  return safeNum(perUnitSpread, 0) * safeNum(volumeUnits, 0);
}

/**
 * Flat-fee broker deal: volumeUnits × feePerUnit.
 * SAHJONY's fee — never the product's price.
 */
export function brokerFee({ volumeUnits, feePerUnit } = {}) {
  return safeNum(volumeUnits) * safeNum(feePerUnit);
}

/** Price per gallon equivalent: pricePerMt / (gallons per MT). */
export function pricePerGal(product, pricePerMt) {
  const gal = mtToGal(product, 1);
  if (gal <= 0) return 0;
  return safeNum(pricePerMt) / gal;
}

/**
 * Parcel economics summary for a product inquiry.
 * inq: { product, volumeMt, buyPerUnit, sellPerUnit, feePerUnit,
 *        unit: 'MT'|'gal'|'bbl' }.
 * Returns bilingual-ready numbers (no text here).
 */
/**
 * Broker economics for one inquiry (parcel).
 *
 * PRICING-UNIT CONTRACT (explicit): buyPerUnit, sellPerUnit and feePerUnit
 * are quoted in the inquiry's own `unit` ('MT' | 'gal' | 'bbl'). Volume is
 * converted to that same unit before totals are computed, so per-unit ×
 * volume-in-same-unit is always consistent regardless of the selected unit.
 * Volume is always ALSO reported in MT, gal and bbl for reference.
 */
export function parcelEconomics(inq = {}) {
  if (!inq || typeof inq !== 'object') inq = {};
  const product = PRODUCTS.includes(inq.product) ? inq.product : 'diesel';
  const unit = ['MT', 'gal', 'bbl'].includes(inq.unit) ? inq.unit : 'MT';
  const volumeMt =
    unit === 'MT'
      ? safeNum(inq.volumeMt)
      : unit === 'gal'
        ? galToMt(product, inq.volumeGal)
        : galToMt(product, bblToGal(inq.volumeBbl));
  const volumeGal = mtToGal(product, volumeMt);
  const volumeBbl = galToBbl(volumeGal);
  const perUnit = spreadPerUnit({
    buyPerUnit: inq.buyPerUnit,
    sellPerUnit: inq.sellPerUnit,
  });
  // Volume expressed in the pricing unit so the per-unit × volume
  // multiplication is always unit-consistent.
  const volumeUnits =
    unit === 'MT' ? volumeMt : unit === 'gal' ? volumeGal : volumeBbl;
  return {
    product,
    unit,
    volumeMt,
    volumeGal,
    volumeBbl,
    perUnitSpread: perUnit,
    totalSpread: totalSpread({ perUnitSpread: perUnit, volumeUnits }),
    flatFee: brokerFee({
      volumeUnits,
      feePerUnit: inq.feePerUnit,
    }),
  };
}

// ---------------------------------------------------------------------------
// Compliance gate evaluation — pure predicate logic, NEVER legal advice.
// ---------------------------------------------------------------------------

/** Static compliance gate checklist template (ES/EN). */
export const GATE_CHECKLIST_TEMPLATE = Object.freeze([
  {
    id: 'private-sector-eligibility',
    es: 'La contraparte cubana es un actor privado independiente y verificable (no solo una afirmación).',
    en: 'The Cuban counterparty is an independently verifiable private-sector actor (not just a claim).',
  },
  {
    id: 'restricted-party-screen',
    es: 'Ninguna contraparte, buque, banco ni intermediario aparece en listas de sancionados (verificación MANUAL por Juan — la fuerza nunca evalúa).',
    en: 'No counterparty, vessel, bank, or intermediary appears on sanctions lists (MANUAL verification by Juan — the workforce never screens).',
  },
  {
    id: 'state-entity-involvement',
    es: 'No hay participación de entidades estatales cubanas en la cadena, o Juan la revisó con asesoría legal.',
    en: 'No Cuban state-entity involvement in the chain, or Juan reviewed it with legal counsel.',
  },
  {
    id: 'origin-route-documented',
    es: 'El origen del producto y la ruta de transporte están documentados.',
    en: 'Product origin and transport route are documented.',
  },
  {
    id: 'legal-authorization-basis',
    es: 'La base legal de la transacción está confirmada por asesor legal (no por la fuerza ni por el motor).',
    en: 'The transaction\'s legal basis is confirmed by legal counsel (not by the workforce or this engine).',
  },
  {
    id: 'banking-payment-path',
    es: 'La ruta de pago/bancaria evita entidades sancionadas y está documentada.',
    en: 'The banking/payment path avoids sanctioned entities and is documented.',
  },
  {
    id: 'export-classification',
    es: 'La clasificación de exportación del producto está determinada.',
    en: 'The product\'s export classification is determined.',
  },
]);

const GATE_ANSWERS = new Set(['yes', 'no', 'unknown']);

/** Normalize an answer map to { [itemId]: 'yes'|'no'|'unknown' }. */
export function normalizeGateAnswers(answers = {}) {
  const out = {};
  for (const item of GATE_CHECKLIST_TEMPLATE) {
    const raw = answers[item.id];
    out[item.id] = GATE_ANSWERS.has(raw) ? raw : 'unknown';
  }
  return out;
}

/**
 * Evaluate the compliance gate. Pure predicate logic — NOT legal advice.
 *
 * Gate PASSES only when every item is answered 'yes' (zero red flags,
 * zero unknowns). ANY 'no' or 'unknown' → { passed: false, redFlags: [...] }
 * and the caller MUST escalate to Juan (SANCTIONS_HARD_STOP semantics live
 * in the workforce/store layer; this engine only reports the predicate).
 */
export function evaluateGate(answers = {}) {
  const normalized = normalizeGateAnswers(answers);
  const redFlags = [];
  const unanswered = [];
  for (const item of GATE_CHECKLIST_TEMPLATE) {
    const answer = normalized[item.id];
    if (answer === 'no') {
      redFlags.push({ id: item.id, es: item.es, en: item.en, answer });
    } else if (answer === 'unknown') {
      unanswered.push({ id: item.id, es: item.es, en: item.en, answer });
    }
  }
  const passed = redFlags.length === 0 && unanswered.length === 0;
  return { passed, redFlags, unanswered, answers: normalized };
}

/** Gate item count for UI progress. */
export function gateItemCount() {
  return GATE_CHECKLIST_TEMPLATE.length;
}
