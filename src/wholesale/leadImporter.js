/**
 * Wholesale lead CSV importer — pure ES module (no DOM, no cesium).
 *
 * $0, no API keys. Parses CSV lead lists (county tax rolls, driving routes,
 * list-provider exports) into the canonical wholesale lead shape consumed by
 * the map layer and deal engine. Header-flexible: English or Spanish column
 * names are accepted and mapped to canonical fields.
 *
 * Canonical lead shape:
 *   {
 *     id, address, city, state, zip,
 *     lat, lng,                    // numbers or null
 *     owner, ownerType,             // 'individual' | 'entity' | 'unknown'
 *     source, condition, notes,
 *     arv, repairs,                // numbers or null
 *     taxDelinquent,               // boolean
 *     score,                       // null until the deal engine scores it
 *     status,                      // 'new'
 *   }
 */

export const MAX_LEAD_ROWS = 5000;

/** Canonical headers for the downloadable template. */
export const CSV_TEMPLATE_HEADERS = [
  'address',
  'city',
  'state',
  'zip',
  'lat',
  'lng',
  'owner',
  'ownerType',
  'source',
  'condition',
  'notes',
  'arv',
  'repairs',
  'taxDelinquent',
];

/** Header row a user can download and fill in; bilingual hints included. */
export function sampleCsvTemplate() {
  const header = CSV_TEMPLATE_HEADERS.join(',');
  const sample = [
    '1234 Canal St',
    'Houston',
    'TX',
    '77003',
    '29.7545',
    '-95.3621',
    'Juan Gonzalez',
    'individual',
    'driver-for-dollars',
    'vacant',
    '"Boarded, overgrown yard"',
    '185000',
    '45000',
    'yes',
  ].join(',');
  return `${header}\n${sample}\n`;
}

/** Strip accents, lowercase, keep only alphanumerics: "Código postal" → "codigopostal". */
function normHeader(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Map normalized header aliases → canonical field names. */
const HEADER_ALIASES = new Map([
  // address
  ['address', 'address'],
  ['direccion', 'address'],
  ['dir', 'address'],
  // city
  ['city', 'city'],
  ['ciudad', 'city'],
  // state
  ['state', 'state'],
  ['estado', 'state'],
  ['st', 'state'],
  // zip
  ['zip', 'zip'],
  ['zipcode', 'zip'],
  ['codigopostal', 'zip'],
  ['cp', 'zip'],
  // lat / lng
  ['lat', 'lat'],
  ['latitud', 'lat'],
  ['latitude', 'lat'],
  ['lng', 'lng'],
  ['lon', 'lng'],
  ['long', 'lng'],
  ['longitud', 'lng'],
  ['longitude', 'lng'],
  ['lngitud', 'lng'],
  // owner
  ['owner', 'owner'],
  ['propietario', 'owner'],
  ['dueno', 'owner'],
  ['duenodepropiedad', 'owner'],
  ['nombrepropietario', 'owner'],
  // ownerType
  ['ownertype', 'ownerType'],
  ['tipopropietario', 'ownerType'],
  ['tipodepropietario', 'ownerType'],
  // source
  ['source', 'source'],
  ['fuente', 'source'],
  ['origen', 'source'],
  // condition
  ['condition', 'condition'],
  ['condicion', 'condition'],
  ['estadopropiedad', 'condition'],
  // notes
  ['notes', 'notes'],
  ['notas', 'notes'],
  ['observaciones', 'notes'],
  // arv
  ['arv', 'arv'],
  ['valorpostreparacion', 'arv'],
  ['afterrepairvalue', 'arv'],
  // repairs
  ['repairs', 'repairs'],
  ['repairsest', 'repairs'],
  ['reparaciones', 'repairs'],
  ['cestoreparacion', 'repairs'],
  // taxDelinquent
  ['taxdelinquent', 'taxDelinquent'],
  ['taxesdelinquent', 'taxDelinquent'],
  ['delinquenttaxes', 'taxDelinquent'],
  ['impuestosatrasados', 'taxDelinquent'],
  ['impuestosmora', 'taxDelinquent'],
  ['taxesdelincuentes', 'taxDelinquent'],
]);

/**
 * Lenient number parse: "$185,000.50" → 185000.5 ; "1.250,50" (ES) → 1250.5 ;
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

const TRUTHY = new Set(['yes', 'si', 'sí', 'true', '1', 'y', 's', 'verdad']);

function parseBoolLoose(raw) {
  if (raw === null || raw === undefined) return false;
  const s = String(raw).trim().toLowerCase();
  return TRUTHY.has(s);
}

function normalizeOwnerType(raw) {
  const s = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!s) return 'unknown';
  if (
    s === 'individual' ||
    s === 'person' ||
    s === 'persona' ||
    s === 'personafisica' ||
    s === 'owner' ||
    s === 'dueno' ||
    s === 'duenodepropiedad'
  ) {
    return 'individual';
  }
  if (
    s === 'entity' ||
    s === 'company' ||
    s === 'empresa' ||
    s === 'compania' ||
    s === 'sociedad' ||
    s === 'llc' ||
    s === 'corp' ||
    s === 'corporation' ||
    s === 'fideicomiso' ||
    s === 'trust'
  ) {
    return 'entity';
  }
  return 'unknown';
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

/**
 * Parse CSV text into wholesale leads.
 *
 * @param {string} text — raw CSV content.
 * @returns {{ leads: object[], errors: { row: number, message: string }[] }}
 *
 * A data row is accepted when it has an address OR both lat and lng.
 * Latitude must be in [-90, 90], longitude in [-180, 180].
 * Row numbers in errors count data rows starting at 1 (header excluded).
 */
export function parseLeadsCsv(text) {
  const leads = [];
  const errors = [];

  if (!text || !String(text).trim()) {
    return {
      leads,
      errors: [{ row: 0, message: 'Archivo vacío (empty file)' }],
    };
  }

  const allRows = parseCsvRows(text);
  const hIdx = headerRowIndex(allRows);
  if (hIdx === -1) {
    return {
      leads,
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
      leads,
      errors: [
        {
          row: 0,
          message:
            'No se reconocieron columnas (no recognized columns). ' +
            'Esperadas: address/dirección, city/ciudad, state/estado, zip, lat, lng, owner/propietario…',
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

    if (dataRowNo > MAX_LEAD_ROWS) {
      errors.push({
        row: dataRowNo,
        message: `Límite de ${MAX_LEAD_ROWS.toLocaleString('en-US')} filas alcanzado — filas extra ignoradas (row limit reached, extra rows skipped)`,
      });
      break;
    }

    const get = (field) => {
      const col = colToField.indexOf(field);
      if (col === -1) return '';
      return String(cells[col] ?? '').trim();
    };

    const address = get('address');
    const latRaw = get('lat');
    const lngRaw = get('lng');
    const lat = latRaw === '' ? null : parseNumberLoose(latRaw);
    const lng = lngRaw === '' ? null : parseNumberLoose(lngRaw);

    const hasCoords = lat !== null && lng !== null;
    const coordsOk =
      hasCoords && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    const hasAddress = address !== '';

    if (!hasAddress && !coordsOk) {
      errors.push({
        row: dataRowNo,
        message:
          'Falta la dirección y las coordenadas válidas (missing address and valid lat+lng)',
      });
      continue;
    }
    if (hasCoords && !coordsOk) {
      errors.push({
        row: dataRowNo,
        message: `Coordenadas fuera de rango (coordinates out of range): lat=${latRaw}, lng=${lngRaw}`,
      });
      continue;
    }
    if ((latRaw !== '' && lat === null) || (lngRaw !== '' && lng === null)) {
      errors.push({
        row: dataRowNo,
        message: `Coordenadas no numéricas (non-numeric coordinates): lat="${latRaw}", lng="${lngRaw}"`,
      });
      continue;
    }

    leads.push({
      id: `csv-lead-${dataRowNo}`,
      address,
      city: get('city'),
      state: get('state'),
      zip: get('zip'),
      lat,
      lng,
      owner: get('owner'),
      ownerType: normalizeOwnerType(get('ownerType')),
      source: get('source') || 'csv-import',
      condition: get('condition'),
      notes: get('notes'),
      arv: parseNumberLoose(get('arv')),
      repairs: parseNumberLoose(get('repairs')),
      taxDelinquent: parseBoolLoose(get('taxDelinquent')),
      score: null,
      status: 'new',
    });
  }

  return { leads, errors };
}
