/**
 * Crude-oil cargo CSV importer — pure ES module (no DOM, no cesium).
 *
 * $0, no API keys. Parses CSV cargo lists and counterparty lists into the
 * canonical shapes consumed by the crude brokerage map layers and deal
 * engine. One file may mix both row kinds. Header-flexible: English or
 * Spanish column names are accepted and mapped to canonical fields.
 *
 * Canonical cargo shape (fields are null when missing — never invented):
 *   {
 *     ref, grade, volumeBbl, buyPrice, sellPrice, commissionPerBbl, // numbers or null
 *     incoterms,            // 'FOB' | 'CIF' | 'DAP' | ''
 *     laycanStart, laycanEnd,                                       // raw strings (yyyy-mm-dd or free text)
 *     loadPort, dischargePort, loadLat, loadLng, dischargeLat, dischargeLng,
 *     supplier, buyer,
 *     status,               // known statuses, default 'prospect'
 *     freight, insurance, inspection, otherCost, // numbers or null
 *     notes,
 *   }
 *
 * Canonical counterparty shape:
 *   {
 *     name, type, role, country,
 *     contactName, contactPhone, contactEmail,
 *     verification,          // 'unverified' | 'pending' | 'verified'
 *     notes,
 *   }
 */

export const MAX_CARGO_ROWS = 5000;

/** Canonical headers for the downloadable cargo template. */
export const CSV_TEMPLATE_HEADERS = [
  'ref',
  'grade',
  'volumeBbl',
  'buyPrice',
  'sellPrice',
  'commissionPerBbl',
  'incoterms',
  'laycanStart',
  'laycanEnd',
  'loadPort',
  'dischargePort',
  'loadLat',
  'loadLng',
  'dischargeLat',
  'dischargeLng',
  'supplier',
  'buyer',
  'status',
  'freight',
  'insurance',
  'inspection',
  'otherCost',
  'notes',
];

/**
 * Header row a user can download and fill in. Every value in the sample row
 * is deliberately fictional and labeled as such — do not copy into real use.
 */
export function sampleCsvTemplate() {
  const header = CSV_TEMPLATE_HEADERS.join(',');
  const sample = [
    'SAMPLE-001',
    '"Brent (sample)"',
    '1000000',
    '70.50',
    '71.25',
    '0.10',
    'FOB',
    '2026-10-01',
    '2026-10-10',
    '"Sample Load Port"',
    '"Sample Discharge Port"',
    '',
    '',
    '',
    '',
    '"Sample Supplier (fictional)"',
    '"Sample Buyer (fictional)"',
    'prospect',
    '150000',
    '20000',
    '5000',
    '1000',
    '"Sample row only — do not use (fila de ejemplo)"',
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
  // grade
  ['grade', 'grade'],
  ['calidad', 'grade'],
  ['tipocrudo', 'grade'],
  ['crudegrade', 'grade'],
  ['tipodecrudo', 'grade'],
  // volumeBbl
  ['volumebbl', 'volumeBbl'],
  ['volumenbbl', 'volumeBbl'],
  ['volume', 'volumeBbl'],
  ['volumen', 'volumeBbl'],
  ['bbl', 'volumeBbl'],
  ['barriles', 'volumeBbl'],
  ['cantidad', 'volumeBbl'],
  ['quantity', 'volumeBbl'],
  // buyPrice
  ['buyprice', 'buyPrice'],
  ['preciocompra', 'buyPrice'],
  ['compra', 'buyPrice'],
  ['purchaseprice', 'buyPrice'],
  // sellPrice
  ['sellprice', 'sellPrice'],
  ['precioventa', 'sellPrice'],
  ['venta', 'sellPrice'],
  ['saleprice', 'sellPrice'],
  // commissionPerBbl
  ['commissionperbbl', 'commissionPerBbl'],
  ['commission', 'commissionPerBbl'],
  ['comision', 'commissionPerBbl'],
  ['comisionbbl', 'commissionPerBbl'],
  ['comisionporbbl', 'commissionPerBbl'],
  // incoterms
  ['incoterms', 'incoterms'],
  ['incoterm', 'incoterms'],
  // laycanStart
  ['laycanstart', 'laycanStart'],
  ['iniciolaycan', 'laycanStart'],
  ['laycaninicio', 'laycanStart'],
  ['laycaniniciov', 'laycanStart'],
  // laycanEnd
  ['laycanend', 'laycanEnd'],
  ['finlaycan', 'laycanEnd'],
  ['laycanfin', 'laycanEnd'],
  ['laycanfinal', 'laycanEnd'],
  // loadPort
  ['loadport', 'loadPort'],
  ['puertocarga', 'loadPort'],
  ['puertoorigen', 'loadPort'],
  ['loadingport', 'loadPort'],
  // dischargePort
  ['dischargeport', 'dischargePort'],
  ['puertodescarga', 'dischargePort'],
  ['puertodestino', 'dischargePort'],
  ['dischargepor', 'dischargePort'],
  // loadLat / loadLng
  ['loadlat', 'loadLat'],
  ['latcarga', 'loadLat'],
  ['loadlng', 'loadLng'],
  ['lngcarga', 'loadLng'],
  ['loncarga', 'loadLng'],
  // dischargeLat / dischargeLng
  ['dischargelat', 'dischargeLat'],
  ['latdescarga', 'dischargeLat'],
  ['dischargelng', 'dischargeLng'],
  ['lngdescarga', 'dischargeLng'],
  ['londescarga', 'dischargeLng'],
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
  // insurance
  ['insurance', 'insurance'],
  ['seguro', 'insurance'],
  // inspection
  ['inspection', 'inspection'],
  ['inspeccion', 'inspection'],
  // otherCost
  ['othercost', 'otherCost'],
  ['otroscostos', 'otherCost'],
  ['othercosts', 'otherCost'],
  // notes
  ['notes', 'notes'],
  ['notas', 'notes'],
  ['observaciones', 'notes'],
  // ---- counterparty fields ----
  ['name', 'name'],
  ['nombre', 'name'],
  ['empresa', 'name'],
  ['company', 'name'],
  ['counterparty', 'name'],
  ['contraparte', 'name'],
  // type
  ['type', 'type'],
  ['tipo', 'type'],
  ['counterpartytype', 'type'],
  // role
  ['role', 'role'],
  ['rol', 'role'],
  ['rolcontraparte', 'role'],
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

/** Normalize incoterms: FOB/CIF/DAP kept, everything else → ''. */
function normalizeIncoterms(raw) {
  const s = normAlpha(raw).toUpperCase();
  return s === 'FOB' || s === 'CIF' || s === 'DAP' ? s : '';
}

const CARGO_STATUS_ALIASES = new Map([
  ['prospect', 'prospect'],
  ['prospecto', 'prospect'],
  ['offered', 'offered'],
  ['oferta', 'offered'],
  ['ofertado', 'offered'],
  ['negotiating', 'negotiating'],
  ['negociacion', 'negotiating'],
  ['negociando', 'negotiating'],
  ['firm', 'firm'],
  ['firme', 'firm'],
  ['closed', 'closed'],
  ['cerrado', 'closed'],
  ['cancelled', 'cancelled'],
  ['cancelado', 'cancelled'],
]);

/** Normalize cargo status; unknown → 'prospect'. */
function normalizeCargoStatus(raw) {
  const s = normAlpha(raw);
  if (!s) return 'prospect';
  return CARGO_STATUS_ALIASES.get(s) || 'prospect';
}

const COUNTERPARTY_TYPE_ALIASES = new Map([
  ['trader', 'trader'],
  ['comercializadora', 'trader'],
  ['refiner', 'refiner'],
  ['refineria', 'refiner'],
  ['refinery', 'refiner'],
  ['broker', 'broker'],
  ['corredor', 'broker'],
  ['producer', 'producer'],
  ['productor', 'producer'],
  ['agent', 'agent'],
  ['agente', 'agent'],
  ['buyer', 'buyer'],
  ['comprador', 'buyer'],
  ['seller', 'seller'],
  ['vendedor', 'seller'],
]);

/** Normalize counterparty type; unknown → 'trader'. */
function normalizeCounterpartyType(raw) {
  const s = normAlpha(raw);
  if (!s) return 'trader';
  return COUNTERPARTY_TYPE_ALIASES.get(s) || 'trader';
}

/** Normalize counterparty role: buyer | seller | both (default 'both'). */
function normalizeCounterpartyRole(raw) {
  const s = normAlpha(raw);
  if (!s) return 'both';
  if (s === 'buyer' || s === 'comprador' || s === 'compra') return 'buyer';
  if (s === 'seller' || s === 'vendedor' || s === 'venta') return 'seller';
  if (s === 'both' || s === 'ambos' || s === 'ambas') return 'both';
  return 'both';
}

const VERIFICATION_ALIASES = new Map([
  ['unverified', 'unverified'],
  ['noverificado', 'unverified'],
  ['sinverificar', 'unverified'],
  ['pending', 'pending'],
  ['pendiente', 'pending'],
  ['enrevision', 'pending'],
  ['verified', 'verified'],
  ['verificado', 'verified'],
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
 * Parse CSV text into crude cargoes and counterparties.
 *
 * @param {string} text — raw CSV content.
 * @returns {{ cargoes: object[], counterparties: object[], errors: { row: number, message: string }[] }}
 *
 * Row classification: a data row with a non-empty `ref` is a cargo; a row
 * with a non-empty `name` and an empty `ref` is a counterparty; a row with
 * neither is an error ("missing ref and name"). One file may mix both kinds.
 * Cargo rows with missing volume/prices are accepted with a warning — the
 * fields stay null so the deal engine can mark them missing. Row numbers in
 * errors count data rows starting at 1 (header excluded).
 */
export function parseCargoCsv(text) {
  const cargoes = [];
  const counterparties = [];
  const errors = [];

  if (!text || !String(text).trim()) {
    return {
      cargoes,
      counterparties,
      errors: [{ row: 0, message: 'Archivo vacío (empty file)' }],
    };
  }

  const allRows = parseCsvRows(text);
  const hIdx = headerRowIndex(allRows);
  if (hIdx === -1) {
    return {
      cargoes,
      counterparties,
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
      cargoes,
      counterparties,
      errors: [
        {
          row: 0,
          message:
            'No se reconocieron columnas (no recognized columns). ' +
            'Esperadas: ref/referencia, grade/calidad, volumeBbl/volumen, buyPrice/precioCompra, ' +
            'sellPrice/precioVenta, loadPort/puertoCarga, dischargePort/puertoDescarga, name/nombre…',
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

    if (dataRowNo > MAX_CARGO_ROWS) {
      errors.push({
        row: dataRowNo,
        message: `Límite de ${MAX_CARGO_ROWS.toLocaleString('en-US')} filas alcanzado — filas extra ignoradas (row limit reached, extra rows skipped)`,
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
      // Counterparty row: ref empty, name present.
      counterparties.push({
        name,
        type: normalizeCounterpartyType(get('type')),
        role: normalizeCounterpartyRole(get('role')),
        country: get('country'),
        contactName: get('contactName'),
        contactPhone: get('contactPhone'),
        contactEmail: get('contactEmail'),
        verification: normalizeVerification(get('verification')),
        notes: get('notes'),
      });
      continue;
    }

    // Cargo row: ref present.
    const coordPairs = [
      ['loadLat', get('loadLat'), 'loadLng', get('loadLng')],
      [
        'dischargeLat',
        get('dischargeLat'),
        'dischargeLng',
        get('dischargeLng'),
      ],
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

    const volumeBbl = parseNumberLoose(get('volumeBbl'));
    const buyPrice = parseNumberLoose(get('buyPrice'));
    const sellPrice = parseNumberLoose(get('sellPrice'));
    const missing = [];
    if (volumeBbl === null) missing.push('volumeBbl');
    if (buyPrice === null) missing.push('buyPrice');
    if (sellPrice === null) missing.push('sellPrice');
    if (missing.length > 0) {
      errors.push({
        row: dataRowNo,
        message:
          `Aviso (warning): ref="${ref}" sin ${missing.join('/')} — se deja null, ` +
          `el motor marca los campos faltantes (kept null, engine marks them missing)`,
      });
    }

    cargoes.push({
      ref,
      grade: get('grade'),
      volumeBbl,
      buyPrice,
      sellPrice,
      commissionPerBbl: parseNumberLoose(get('commissionPerBbl')),
      incoterms: normalizeIncoterms(get('incoterms')),
      laycanStart: get('laycanStart'),
      laycanEnd: get('laycanEnd'),
      loadPort: get('loadPort'),
      dischargePort: get('dischargePort'),
      loadLat: coords.loadLat,
      loadLng: coords.loadLng,
      dischargeLat: coords.dischargeLat,
      dischargeLng: coords.dischargeLng,
      supplier: get('supplier'),
      buyer: get('buyer'),
      status: normalizeCargoStatus(get('status')),
      freight: parseNumberLoose(get('freight')),
      insurance: parseNumberLoose(get('insurance')),
      inspection: parseNumberLoose(get('inspection')),
      otherCost: parseNumberLoose(get('otherCost')),
      notes: get('notes'),
    });
  }

  return { cargoes, counterparties, errors };
}
