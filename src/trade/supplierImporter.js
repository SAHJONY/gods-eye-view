/**
 * Import/Export trade CSV importer — pure ES module (no DOM, no cesium).
 *
 * $0, no API keys. Parses CSV RFQ lists and supplier lists into the canonical
 * shapes consumed by the trade map layers and RFQ engine. One file may mix
 * both row kinds. Header-flexible: English or Spanish column names are
 * accepted and mapped to canonical fields.
 *
 * Canonical RFQ shape (fields are null when missing — never invented):
 *   {
 *     ref, product, quantity, unitCost, sellUnitPrice, commissionPct, // numbers or null
 *     targetMarginPct,          // percent number (20 = 20%) or null
 *     incoterms,                // 'FOB' | 'CIF' | 'EXW' | 'DAP' | ''
 *     originPort, destinationPort, originLat, originLng, destLat, destLng,
 *     supplier, buyer,
 *     status,                   // known statuses, default 'prospect'
 *     freight, duties, otherCosts, // numbers or null
 *     notes,
 *   }
 *
 * Canonical supplier shape:
 *   {
 *     name, type, role, country,
 *     contactName, contactPhone, contactEmail,
 *     verification,             // 'unverified' | 'in-review' | 'verified' | 'flagged'
 *     notes,
 *   }
 *
 * Mirrors src/crude/cargoImporter.js.
 */

export const MAX_TRADE_ROWS = 5000;

/** Canonical headers for the downloadable trade template. */
export const CSV_TEMPLATE_HEADERS = [
  'ref',
  'product',
  'quantity',
  'unitCost',
  'sellUnitPrice',
  'commissionPct',
  'targetMarginPct',
  'incoterms',
  'originPort',
  'destinationPort',
  'originLat',
  'originLng',
  'destLat',
  'destLng',
  'supplier',
  'buyer',
  'status',
  'freight',
  'duties',
  'otherCosts',
  'notes',
  'name',
  'type',
  'role',
  'country',
  'contactName',
  'contactPhone',
  'contactEmail',
  'verification',
];

/**
 * Header row a user can download and fill in. Every value in the sample row
 * is deliberately fictional and labeled as such — do not copy into real use.
 */
export function sampleCsvTemplate() {
  const header = CSV_TEMPLATE_HEADERS.join(',');
  const sample = [
    'SAMPLE-001',
    '"Sample Widget (fictional)"',
    '5000',
    '12.50',
    '15.75',
    '5',
    '20',
    'FOB',
    '"Sample Origin Port"',
    '"Sample Destination Port"',
    '',
    '',
    '',
    '',
    '"Sample Supplier (fictional)"',
    '"Sample Buyer (fictional)"',
    'prospect',
    '2500',
    '800',
    '300',
    '"Sample row only — do not use (fila de ejemplo)"',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ].join(',');
  return `${header}\n${sample}\n`;
}

/** Strip accents, lowercase, keep only alphanumerics: "Precio compra" → "preciocompra". */
function normHeader(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Map normalized header aliases → canonical field names. */
const HEADER_ALIASES = new Map([
  // ref
  ['ref', 'ref'],
  ['referencia', 'ref'],
  ['contrato', 'ref'],
  ['reference', 'ref'],
  ['contract', 'ref'],
  // product
  ['product', 'product'],
  ['producto', 'product'],
  ['mercancia', 'product'],
  ['merchandise', 'product'],
  // quantity
  ['quantity', 'quantity'],
  ['cantidad', 'quantity'],
  ['volumen', 'quantity'],
  ['volume', 'quantity'],
  ['unidades', 'quantity'],
  ['units', 'quantity'],
  // unitCost
  ['unitcost', 'unitCost'],
  ['costounitario', 'unitCost'],
  ['preciocompra', 'unitCost'],
  ['purchaseprice', 'unitCost'],
  // sellUnitPrice
  ['sellunitprice', 'sellUnitPrice'],
  ['precioventa', 'sellUnitPrice'],
  ['saleprice', 'sellUnitPrice'],
  // commissionPct
  ['commissionpct', 'commissionPct'],
  ['commission', 'commissionPct'],
  ['comision', 'commissionPct'],
  ['comisionpct', 'commissionPct'],
  // targetMarginPct
  ['targetmarginpct', 'targetMarginPct'],
  ['margenobjetivo', 'targetMarginPct'],
  ['marginobjetivo', 'targetMarginPct'],
  ['targetmargin', 'targetMarginPct'],
  // incoterms
  ['incoterms', 'incoterms'],
  ['incoterm', 'incoterms'],
  // originPort
  ['originport', 'originPort'],
  ['puertoorigen', 'originPort'],
  ['loadingport', 'originPort'],
  // destinationPort
  ['destinationport', 'destinationPort'],
  ['puertodestino', 'destinationPort'],
  ['dischargeport', 'destinationPort'],
  // originLat / originLng
  ['originlat', 'originLat'],
  ['latorigen', 'originLat'],
  ['originlng', 'originLng'],
  ['lngorigen', 'originLng'],
  ['lonorigen', 'originLng'],
  // destLat / destLng
  ['destlat', 'destLat'],
  ['latdestino', 'destLat'],
  ['destlng', 'destLng'],
  ['lngdestino', 'destLng'],
  ['londestino', 'destLng'],
  // supplier
  ['supplier', 'supplier'],
  ['proveedor', 'supplier'],
  ['vendedor', 'supplier'],
  ['seller', 'supplier'],
  // buyer
  ['buyer', 'buyer'],
  ['comprador', 'buyer'],
  // status
  ['status', 'status'],
  ['estado', 'status'],
  // freight
  ['freight', 'freight'],
  ['flete', 'freight'],
  // duties
  ['duties', 'duties'],
  ['duty', 'duties'],
  ['aranceles', 'duties'],
  ['impuestos', 'duties'],
  // otherCosts
  ['othercosts', 'otherCosts'],
  ['othercost', 'otherCosts'],
  ['otroscostos', 'otherCosts'],
  // notes
  ['notes', 'notes'],
  ['notas', 'notes'],
  ['observaciones', 'notes'],
  // ---- supplier fields ----
  // name
  ['name', 'name'],
  ['nombre', 'name'],
  ['empresa', 'name'],
  ['company', 'name'],
  ['contraparte', 'name'],
  // type
  ['type', 'type'],
  ['tipo', 'type'],
  // role
  ['role', 'role'],
  ['rol', 'role'],
  // country
  ['country', 'country'],
  ['pais', 'country'],
  // contactName
  ['contactname', 'contactName'],
  ['contacto', 'contactName'],
  ['nombrecontacto', 'contactName'],
  // contactPhone
  ['contactphone', 'contactPhone'],
  ['telefono', 'contactPhone'],
  ['tel', 'contactPhone'],
  ['phone', 'contactPhone'],
  // contactEmail
  ['contactemail', 'contactEmail'],
  ['email', 'contactEmail'],
  ['correo', 'contactEmail'],
  ['correoelectronico', 'contactEmail'],
  // verification
  ['verification', 'verification'],
  ['verificacion', 'verification'],
]);

/**
 * Lenient number parse: "$1,250,000.50" → 1250000.5 ; "1.250,50" (ES) → 1250.5 ;
 * blanks → null ; garbage → null.
 */
export function parseNumberLoose(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .trim()
    .replace(/[$€£¥\s]/g, '');
  if (s === '') return null;
  let cleaned = s;
  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');
  if (hasDot && hasComma) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      // Spanish style: "1.250,50" → dot is thousands, comma is decimal.
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US style: "1,250.50" → comma is thousands.
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Only commas: exactly 3 digits after the last comma → US thousands
    // ("185,000"); otherwise Spanish decimal comma ("1,25").
    const tail = cleaned.split(',').pop();
    cleaned = /^\d{3}$/.test(tail)
      ? cleaned.replace(/,/g, '')
      : cleaned.replace(/,/g, '.');
  }
  // Keep digits, one leading minus, one dot.
  cleaned = cleaned.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normAlpha(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Normalize incoterms: FOB/CIF/EXW/DAP kept, everything else → ''. */
function normalizeIncoterms(raw) {
  const s = normAlpha(raw).toUpperCase();
  return ['FOB', 'CIF', 'EXW', 'DAP'].includes(s) ? s : '';
}

const RFQ_STATUS_ALIASES = new Map([
  ['prospect', 'prospect'],
  ['prospecto', 'prospect'],
  ['contacted', 'contacted'],
  ['contactado', 'contacted'],
  ['quoting', 'quoting'],
  ['cotizando', 'quoting'],
  ['cotizacion', 'quoting'],
  ['negotiating', 'negotiating'],
  ['negociacion', 'negotiating'],
  ['negociando', 'negotiating'],
  ['won', 'won'],
  ['ganado', 'won'],
  ['cerrado', 'won'],
  ['lost', 'lost'],
  ['perdido', 'lost'],
  ['descartado', 'lost'],
]);

/** Normalize RFQ status; unknown → 'prospect'. */
function normalizeRfqStatus(raw) {
  const s = normAlpha(raw);
  if (!s) return 'prospect';
  return RFQ_STATUS_ALIASES.get(s) || 'prospect';
}

const SUPPLIER_TYPE_ALIASES = new Map([
  ['manufacturer', 'manufacturer'],
  ['fabricante', 'manufacturer'],
  ['distributor', 'distributor'],
  ['distribuidor', 'distributor'],
  ['trader', 'trader'],
  ['comercializadora', 'trader'],
  ['logistics', 'logistics'],
  ['logistica', 'logistics'],
]);

/** Normalize supplier type; unknown → 'trader'. */
function normalizeSupplierType(raw) {
  const s = normAlpha(raw);
  if (!s) return 'trader';
  return SUPPLIER_TYPE_ALIASES.get(s) || 'trader';
}

/** Normalize supplier role: supplier | buyer | both (default 'both'). */
function normalizeSupplierRole(raw) {
  const s = normAlpha(raw);
  if (!s) return 'both';
  if (s === 'supplier' || s === 'proveedor') return 'supplier';
  if (s === 'buyer' || s === 'comprador') return 'buyer';
  if (s === 'both' || s === 'ambos' || s === 'ambas') return 'both';
  return 'both';
}

const VERIFICATION_ALIASES = new Map([
  ['unverified', 'unverified'],
  ['noverificado', 'unverified'],
  ['sinverificar', 'unverified'],
  ['inreview', 'in-review'],
  ['enrevision', 'in-review'],
  ['pending', 'in-review'],
  ['pendiente', 'in-review'],
  ['verified', 'verified'],
  ['verificado', 'verified'],
  ['flagged', 'flagged'],
  ['marcado', 'flagged'],
]);

/** Normalize verification state; unknown → 'unverified'. */
function normalizeVerification(raw) {
  const s = normAlpha(raw);
  if (!s) return 'unverified';
  return VERIFICATION_ALIASES.get(s) || 'unverified';
}

function isBlankRow(cells) {
  return cells.every((c) => String(c || '').trim() === '');
}

/**
 * Minimal RFC-4180-ish CSV reader: honors quoted fields (incl. embedded
 * quotes, commas and newlines), trims unquoted cells. Returns rows of strings.
 */
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text || '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      // ignore; \n ends the row
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  // Trailing content without a final newline.
  if (inQuotes || cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function headerRowIndex(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    if (!isBlankRow(rows[i])) return i;
  }
  return -1;
}

function validLat(value) {
  return value === null || (value >= -90 && value <= 90);
}

function validLng(value) {
  return value === null || (value >= -180 && value <= 180);
}

/**
 * Parse CSV text into trade RFQs and suppliers.
 *
 * @param {string} text — raw CSV content.
 * @returns {{ rfqs: object[], suppliers: object[], errors: { row: number, message: string }[] }}
 *
 * Row classification: a data row with a non-empty `ref` is an RFQ; a row
 * with a non-empty `name` and an empty `ref` is a supplier; a row with
 * neither is an error ("missing ref and name"). One file may mix both kinds.
 * RFQ rows with missing quantity/prices are accepted with a warning — the
 * fields stay null so the deal engine can mark them missing. Row numbers in
 * errors count data rows starting at 1 (header excluded).
 */
export function parseTradeCsv(text) {
  const rfqs = [];
  const suppliers = [];
  const errors = [];

  if (!text || !String(text).trim()) {
    return {
      rfqs,
      suppliers,
      errors: [{ row: 0, message: 'Archivo vacío (empty file)' }],
    };
  }

  const allRows = parseCsvRows(text);
  const hIdx = headerRowIndex(allRows);
  if (hIdx === -1) {
    return {
      rfqs,
      suppliers,
      errors: [{ row: 0, message: 'Archivo vacío (empty file)' }],
    };
  }

  const headers = allRows[hIdx];
  const colToField = headers.map(
    (h) => HEADER_ALIASES.get(normHeader(h)) || null,
  );
  const recognized = colToField.filter(Boolean);
  if (recognized.length === 0) {
    return {
      rfqs,
      suppliers,
      errors: [
        {
          row: 0,
          message:
            'No se reconocieron columnas (no recognized columns). ' +
            'Esperadas: ref/referencia, product/producto, quantity/cantidad, unitCost/costoUnitario, ' +
            'sellUnitPrice/precioVenta, originPort/puertoOrigen, destinationPort/puertoDestino, name/nombre…',
        },
      ],
    };
  }

  const dataRows = allRows.slice(hIdx + 1);
  let dataRowNo = 0;
  for (let i = 0; i < dataRows.length; i += 1) {
    const cells = dataRows[i];
    if (isBlankRow(cells)) continue;
    dataRowNo += 1;

    if (dataRowNo > MAX_TRADE_ROWS) {
      errors.push({
        row: dataRowNo,
        message: `Límite de ${MAX_TRADE_ROWS.toLocaleString('en-US')} filas alcanzado — filas extra ignoradas (row limit reached, extra rows skipped)`,
      });
      break;
    }

    const get = (field) => {
      const col = colToField.indexOf(field);
      if (col === -1) return '';
      return String(cells[col] ?? '').trim();
    };

    const ref = get('ref');
    const name = get('name');

    if (!ref && !name) {
      errors.push({
        row: dataRowNo,
        message:
          'Falta la referencia y el nombre (missing ref and name) — fila omitida (row skipped)',
      });
      continue;
    }

    if (!ref) {
      // Supplier row: ref empty, name present.
      suppliers.push({
        name,
        type: normalizeSupplierType(get('type')),
        role: normalizeSupplierRole(get('role')),
        country: get('country'),
        contactName: get('contactName'),
        contactPhone: get('contactPhone'),
        contactEmail: get('contactEmail'),
        verification: normalizeVerification(get('verification')),
        notes: get('notes'),
      });
      continue;
    }

    // RFQ row: ref present.
    const coordPairs = [
      ['originLat', get('originLat'), 'originLng', get('originLng')],
      ['destLat', get('destLat'), 'destLng', get('destLng')],
    ];
    const coords = {};
    let coordError = null;
    for (const [latField, latRaw, lngField, lngRaw] of coordPairs) {
      const lat = latRaw === '' ? null : parseNumberLoose(latRaw);
      const lng = lngRaw === '' ? null : parseNumberLoose(lngRaw);
      if ((latRaw !== '' && lat === null) || (lngRaw !== '' && lng === null)) {
        coordError =
          `Coordenadas no numéricas (non-numeric coordinates): ` +
          `${latField}="${latRaw}", ${lngField}="${lngRaw}"`;
        break;
      }
      if (!validLat(lat) || !validLng(lng)) {
        coordError =
          `Coordenadas fuera de rango (coordinates out of range): ` +
          `${latField}="${latRaw}", ${lngField}="${lngRaw}"`;
        break;
      }
      coords[latField] = lat;
      coords[lngField] = lng;
    }
    if (coordError) {
      errors.push({
        row: dataRowNo,
        message: `${coordError} — fila omitida (row skipped)`,
      });
      continue;
    }

    const quantity = parseNumberLoose(get('quantity'));
    const unitCost = parseNumberLoose(get('unitCost'));
    const sellUnitPrice = parseNumberLoose(get('sellUnitPrice'));
    const missing = [];
    if (quantity === null) missing.push('quantity');
    if (unitCost === null) missing.push('unitCost');
    if (sellUnitPrice === null) missing.push('sellUnitPrice');
    if (missing.length > 0) {
      errors.push({
        row: dataRowNo,
        message:
          `Aviso (warning): ref="${ref}" sin ${missing.join('/')} — se deja null, ` +
          `el motor marca los campos faltantes (kept null, engine marks them missing)`,
      });
    }

    rfqs.push({
      ref,
      product: get('product'),
      quantity,
      unitCost,
      sellUnitPrice,
      commissionPct: parseNumberLoose(get('commissionPct')),
      targetMarginPct: parseNumberLoose(get('targetMarginPct')),
      incoterms: normalizeIncoterms(get('incoterms')),
      originPort: get('originPort'),
      destinationPort: get('destinationPort'),
      originLat: coords.originLat,
      originLng: coords.originLng,
      destLat: coords.destLat,
      destLng: coords.destLng,
      supplier: get('supplier'),
      buyer: get('buyer'),
      status: normalizeRfqStatus(get('status')),
      freight: parseNumberLoose(get('freight')),
      duties: parseNumberLoose(get('duties')),
      otherCosts: parseNumberLoose(get('otherCosts')),
      notes: get('notes'),
    });
  }

  return { rfqs, suppliers, errors };
}
