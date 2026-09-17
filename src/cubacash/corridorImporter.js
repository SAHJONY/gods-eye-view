/**
 * MY CUBA CASH provider/corridor CSV importer — pure ES module (no DOM, no cesium).
 *
 * $0, no API keys. Parses CSV provider lists and remittance-corridor lists into
 * the canonical shapes consumed by the cubacash store and map layers. One file
 * may mix both row kinds. Header-flexible: English or Spanish column names are
 * accepted and mapped to canonical fields. Honesty conventions: missing numbers
 * → null (never 0 for unknown), missing text → '', and an FX rate without an
 * as-of date is an ERROR — no rate without provenance.
 *
 * Canonical provider shape (fields null/empty when missing — never invented):
 *   {
 *     name, channels, coverageCountries,
 *     feeModelType, feePct, feeFlat, feeMin, feeMax, // fee numbers or null
 *     status,          // known statuses, default 'candidate'
 *     website, lat, lng, notes,
 *   }
 *
 * Canonical corridor shape:
 *   {
 *     fromCountry, toCountry, providerName,  // providerName is text; resolving
 *                                            // it to a providerId is the caller's job
 *     sendAmount, fxRate,                     // numbers or null
 *     fxRateAsOf,                             // text; required whenever fxRate is present
 *     fromLat, fromLng, toLat, toLng,         // null when blank
 *     notes,
 *   }
 */

import { PROVIDER_STATUSES, CHANNELS } from './providerStore.js';

export const MAX_ROWS = 5000;

export const PROVIDER_CSV_HEADERS = [
  'name',
  'channels',
  'coverageCountries',
  'feeModelType',
  'feePct',
  'feeFlat',
  'feeMin',
  'feeMax',
  'status',
  'website',
  'lat',
  'lng',
  'notes',
];

export const CORRIDOR_CSV_HEADERS = [
  'fromCountry',
  'toCountry',
  'providerName',
  'sendAmount',
  'fxRate',
  'fxRateAsOf',
  'fromLat',
  'fromLng',
  'toLat',
  'toLng',
  'notes',
];

/**
 * Provider template row a user can download and fill in. Every value in the
 * sample row is deliberately fictional and labeled as such — do not copy into
 * real use.
 */
export function providerCsvTemplate() {
  const header = PROVIDER_CSV_HEADERS.join(',');
  const sample = [
    '"Sample Provider (fictional)"',
    'app;web',
    '"Spain;United States (fictional)"',
    'percentage',
    '1.25',
    '',
    '1',
    '12',
    'candidate',
    '"https://example.com (fictional)"',
    '',
    '',
    '"Sample row only — do not use (fila de ejemplo)"',
  ].join(',');
  return `${header}\n${sample}\n`;
}

/**
 * Corridor template row a user can download and fill in. Every value in the
 * sample row is deliberately fictional and labeled as such — do not copy into
 * real use.
 */
export function corridorCsvTemplate() {
  const header = CORRIDOR_CSV_HEADERS.join(',');
  const sample = [
    '"Spain (sample)"',
    '"Cuba (sample)"',
    '"Sample Provider (fictional)"',
    '100',
    '120',
    '2026-09-17',
    '',
    '',
    '',
    '',
    '"Sample row only — do not use (fila de ejemplo)"',
  ].join(',');
  return `${header}\n${sample}\n`;
}

/** Strip accents, lowercase, keep only alphanumerics: "País de destino" → "paisdedestino". */
function normHeader(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Map normalized header aliases → canonical field names. */
const HEADER_ALIASES = new Map([
  // ---- shared kind marker ----
  ['kind', 'kind'],
  ['tipo', 'kind'],
  ['type', 'kind'],
  // ---- provider: name ----
  ['name', 'name'],
  ['nombre', 'name'],
  ['empresa', 'name'],
  ['company', 'name'],
  ['proveedor', 'name'],
  ['providername', 'providerName'],
  ['nombreproveedor', 'providerName'],
  // ---- provider: channels ----
  ['channels', 'channels'],
  ['canales', 'channels'],
  ['canal', 'channels'],
  ['channel', 'channels'],
  // ---- provider: coverageCountries ----
  ['coveragecountries', 'coverageCountries'],
  ['coverage', 'coverageCountries'],
  ['paises', 'coverageCountries'],
  ['countries', 'coverageCountries'],
  ['paisescobertura', 'coverageCountries'],
  // ---- provider: fee model ----
  ['feemodeltype', 'feeModelType'],
  ['tipocomision', 'feeModelType'],
  ['feet', 'feeModelType'],
  ['feetype', 'feeModelType'],
  ['comisiontipo', 'feeModelType'],
  ['feemodel', 'feeModelType'],
  ['feepct', 'feePct'],
  ['comisionpct', 'feePct'],
  ['percent', 'feePct'],
  ['porcentaje', 'feePct'],
  ['feepercent', 'feePct'],
  ['feeflat', 'feeFlat'],
  ['comisionfija', 'feeFlat'],
  ['comisionflat', 'feeFlat'],
  ['flatfee', 'feeFlat'],
  ['feemin', 'feeMin'],
  ['comisionminima', 'feeMin'],
  ['minfee', 'feeMin'],
  ['feemax', 'feeMax'],
  ['comisionmaxima', 'feeMax'],
  ['maxfee', 'feeMax'],
  // ---- provider: status ----
  ['status', 'status'],
  ['estado', 'status'],
  // ---- provider: website ----
  ['website', 'website'],
  ['sitio', 'website'],
  ['sitioweb', 'website'],
  ['url', 'website'],
  ['web', 'website'],
  // ---- provider lat/lng ----
  ['lat', 'lat'],
  ['latitud', 'lat'],
  ['latitude', 'lat'],
  ['lng', 'lng'],
  ['longitud', 'lng'],
  ['longitude', 'lng'],
  ['lon', 'lng'],
  // ---- corridor: fromCountry ----
  ['fromcountry', 'fromCountry'],
  ['paisorigen', 'fromCountry'],
  ['origen', 'fromCountry'],
  ['from', 'fromCountry'],
  ['paisdeenvio', 'fromCountry'],
  // ---- corridor: toCountry ----
  ['tocountry', 'toCountry'],
  ['paisdestino', 'toCountry'],
  ['destino', 'toCountry'],
  ['to', 'toCountry'],
  ['paisrecepcion', 'toCountry'],
  // ---- corridor: sendAmount ----
  ['sendamount', 'sendAmount'],
  ['monto', 'sendAmount'],
  ['montoenvio', 'sendAmount'],
  ['cantidad', 'sendAmount'],
  ['amount', 'sendAmount'],
  // ---- corridor: fxRate ----
  ['fxrate', 'fxRate'],
  ['tasa', 'fxRate'],
  ['tasacambio', 'fxRate'],
  ['exchangerate', 'fxRate'],
  ['rate', 'fxRate'],
  ['tipodecambio', 'fxRate'],
  // ---- corridor: fxRateAsOf ----
  ['fxrateasof', 'fxRateAsOf'],
  ['tasaal', 'fxRateAsOf'],
  ['tasaactualizada', 'fxRateAsOf'],
  ['rateasof', 'fxRateAsOf'],
  ['fechatasa', 'fxRateAsOf'],
  ['asof', 'fxRateAsOf'],
  // ---- corridor lat/lng ----
  ['fromlat', 'fromLat'],
  ['lat_origen', 'fromLat'],
  ['latorigen', 'fromLat'],
  ['fromlng', 'fromLng'],
  ['lngorigen', 'fromLng'],
  ['lonorigen', 'fromLng'],
  ['tolat', 'toLat'],
  ['latdestino', 'toLat'],
  ['tolng', 'toLng'],
  ['lngdestino', 'toLng'],
  ['londestino', 'toLng'],
  // ---- notes ----
  ['notes', 'notes'],
  ['notas', 'notes'],
  ['observaciones', 'notes'],
]);

/** Fields that only ever appear on provider rows. */
const PROVIDER_ONLY_FIELDS = new Set([
  'name',
  'channels',
  'coverageCountries',
  'feeModelType',
  'feePct',
  'feeFlat',
  'feeMin',
  'feeMax',
  'website',
]);

/** Fields that only ever appear on corridor rows. */
const CORRIDOR_ONLY_FIELDS = new Set([
  'fromCountry',
  'toCountry',
  'providerName',
  'sendAmount',
  'fxRate',
  'fxRateAsOf',
  'fromLat',
  'fromLng',
  'toLat',
  'toLng',
]);

const FEE_MODEL_ALIASES = new Map([
  ['percentage', 'percentage'],
  ['porcentaje', 'percentage'],
  ['porcentual', 'percentage'],
  ['flat', 'flat'],
  ['fija', 'flat'],
  ['fijo', 'flat'],
  ['mixed', 'mixed'],
  ['mixto', 'mixed'],
  ['mixta', 'mixed'],
  ['undisclosed', 'undisclosed'],
  ['nodefinido', 'undisclosed'],
  ['desconocido', 'undisclosed'],
  ['unknown', 'undisclosed'],
]);

/** Normalize fee model type; unknown/blank → 'undisclosed'. */
function normalizeFeeModelType(raw) {
  const s = normAlpha(raw);
  if (!s) return 'undisclosed';
  return FEE_MODEL_ALIASES.get(s) || 'undisclosed';
}

const PROVIDER_STATUS_ALIASES = new Map([
  ['candidate', 'candidate'],
  ['candidato', 'candidate'],
  ['verifying', 'verifying'],
  ['verificando', 'verifying'],
  ['enverificacion', 'verifying'],
  ['live', 'live'],
  ['activo', 'live'],
  ['active', 'live'],
  ['paused', 'paused'],
  ['pausado', 'paused'],
]);

/** Normalize provider status; unknown/blank → 'candidate'. */
function normalizeProviderStatus(raw) {
  const s = normAlpha(raw);
  if (!s) return 'candidate';
  return PROVIDER_STATUS_ALIASES.get(s) || 'candidate';
}

function normAlpha(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

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

function isBlankRow(cells) {
  return cells.every((c) => String(c || '').trim() === '');
}

function validLat(value) {
  return value === null || (value >= -90 && value <= 90);
}

function validLng(value) {
  return value === null || (value >= -180 && value <= 180);
}

/** Escape one cell for CSV output (quote when needed, double inner quotes). */
function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Serialize canonical provider rows back to CSV. */
export function providersToCsv(providers) {
  return rowsToCsv(
    PROVIDER_CSV_HEADERS,
    (providers || []).map((p) => ({
      name: p.name ?? '',
      channels: Array.isArray(p.channels) ? p.channels.join(';') : '',
      coverageCountries: Array.isArray(p.coverageCountries)
        ? p.coverageCountries.join(';')
        : '',
      feeModelType: p.feeModel?.type ?? p.feeModelType ?? '',
      feePct: p.feeModel?.pct ?? p.feePct ?? '',
      feeFlat: p.feeModel?.flat ?? p.feeFlat ?? '',
      feeMin: p.feeModel?.min ?? p.feeMin ?? '',
      feeMax: p.feeModel?.max ?? p.feeMax ?? '',
      status: p.status ?? '',
      website: p.website ?? '',
      lat: p.lat ?? '',
      lng: p.lng ?? '',
      notes: p.notes ?? '',
    })),
  );
}

/** Serialize canonical corridor rows back to CSV. */
export function corridorsToCsv(corridors) {
  return rowsToCsv(
    CORRIDOR_CSV_HEADERS,
    (corridors || []).map((c) => ({
      fromCountry: c.fromCountry ?? '',
      toCountry: c.toCountry ?? '',
      providerName: c.providerName ?? '',
      sendAmount: c.sendAmount ?? '',
      fxRate: c.fxRate ?? '',
      fxRateAsOf: c.fxRateAsOf ?? '',
      fromLat: c.fromLat ?? '',
      fromLng: c.fromLng ?? '',
      toLat: c.toLat ?? '',
      toLng: c.toLng ?? '',
      notes: c.notes ?? '',
    })),
  );
}

/** Spanish aliases → canonical channel values. */
const CHANNEL_ALIASES = new Map([
  ['app', 'app'],
  ['aplicacion', 'app'],
  ['web', 'web'],
  ['sitio', 'web'],
  ['whatsapp', 'whatsapp'],
  ['agent', 'agent'],
  ['agente', 'agent'],
  ['oficina', 'agent'],
  ['retail', 'retail'],
  ['minorista', 'retail'],
  ['tienda', 'retail'],
]);

const err = (row, es, en) => ({ row, es, en });

/**
 * Parse a semicolon-separated list cell: "app; whatsapp" → ['app','whatsapp'].
 * When an aliasMap is given, each item is normalized through it first
 * (e.g. "agente" → "agent"). Values not in the allow-list are dropped and
 * reported.
 */
function parseListCell(raw, allowList, aliasMap) {
  const rawItems = String(raw || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = [];
  const dropped = [];
  const seen = new Set();
  for (const item of rawItems) {
    const normalized = aliasMap
      ? aliasMap.get(normHeader(item)) || item.toLowerCase()
      : item;
    if (allowList && !allowList.includes(normalized)) {
      dropped.push(item);
      continue;
    }
    const value = allowList ? normalized : item;
    if (!seen.has(value)) {
      seen.add(value);
      kept.push(value);
    }
  }
  return { kept, dropped };
}

function parseLatLngPair(latField, latRaw, lngField, lngRaw, rowNo, errors) {
  const lat = latRaw === '' ? null : parseNumberLoose(latRaw);
  const lng = lngRaw === '' ? null : parseNumberLoose(lngRaw);
  if ((latRaw !== '' && lat === null) || (lngRaw !== '' && lng === null)) {
    errors.push(
      err(
        rowNo,
        `Coordenadas no numéricas (non-numeric coordinates): ${latField}="${latRaw}", ${lngField}="${lngRaw}" — fila omitida (row skipped)`,
        `Coordenadas no numéricas (non-numeric coordinates): ${latField}="${latRaw}", ${lngField}="${lngRaw}" — fila omitida (row skipped)`,
      ),
    );
    return null;
  }
  if (!validLat(lat) || !validLng(lng)) {
    errors.push(
      err(
        rowNo,
        `Coordenadas fuera de rango (coordinates out of range): ${latField}="${latRaw}", ${lngField}="${lngRaw}" — fila omitida (row skipped)`,
        `Coordenadas fuera de rango (coordinates out of range): ${latField}="${latRaw}", ${lngField}="${lngRaw}" — fila omitida (row skipped)`,
      ),
    );
    return null;
  }
  return { lat, lng };
}

/**
 * Parse a fee number cell. Blank → null (missing, never 0). Negative or
 * unparseable garbage → error marker so the caller can reject the row.
 */
function parseFeeCell(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: null, invalid: false };
  const n = parseNumberLoose(raw);
  if (n === null || n < 0) return { value: null, invalid: true };
  return { value: n, invalid: false };
}

/**
 * Parse CSV text into MY CUBA CASH providers and remittance corridors.
 *
 * @param {string} text — raw CSV content.
 * @returns {{ providers: object[], corridors: object[], errors: { row: number, es: string, en: string }[] }}
 *
 * Row classification: an explicit `kind` column ('provider' | 'corridor') wins;
 * otherwise a row with any non-empty corridor-only field is a corridor, a row
 * with any non-empty provider-only field is a provider, and anything else is
 * an error row. One file may mix both kinds. Row numbers in errors count data
 * rows starting at 1 (header excluded). Errors are bilingual {row, es, en}.
 */
export function parseCubacashCsv(text) {
  const providers = [];
  const corridors = [];
  const errors = [];

  if (!text || !String(text).trim()) {
    return {
      providers,
      corridors,
      errors: [
        err(0, 'Archivo vacío (empty file)', 'Archivo vacío (empty file)'),
      ],
    };
  }

  const allRows = parseCsvRows(text);
  const hIdx = headerRowIndex(allRows);
  if (hIdx === -1) {
    return {
      providers,
      corridors,
      errors: [
        err(0, 'Archivo vacío (empty file)', 'Archivo vacío (empty file)'),
      ],
    };
  }

  const headers = allRows[hIdx];
  const colToField = headers.map(
    (h) => HEADER_ALIASES.get(normHeader(h)) || null,
  );
  const recognized = colToField.filter(Boolean);
  if (recognized.length === 0) {
    return {
      providers,
      corridors,
      errors: [
        err(
          0,
          'No se reconocieron columnas (no recognized columns). Esperadas: name/nombre, channels/canales, fromCountry/paisOrigen, toCountry/paisDestino, fxRate/tasa…',
          'No recognized columns (no se reconocieron columnas). Expected: name/nombre, channels/canales, fromCountry/paisOrigen, toCountry/paisDestino, fxRate/tasa…',
        ),
      ],
    };
  }

  const dataRows = allRows.slice(hIdx + 1);
  let dataRowNo = 0;
  for (let i = 0; i < dataRows.length; i += 1) {
    const cells = dataRows[i];
    if (isBlankRow(cells)) continue;
    dataRowNo += 1;

    if (dataRowNo > MAX_ROWS) {
      errors.push(
        err(
          dataRowNo,
          `Límite de ${MAX_ROWS.toLocaleString('en-US')} filas alcanzado — filas extra ignoradas (row limit reached, extra rows skipped)`,
          `Row limit of ${MAX_ROWS.toLocaleString('en-US')} reached — extra rows ignored (límite alcanzado, filas extra ignoradas)`,
        ),
      );
      break;
    }

    const get = (field) => {
      const col = colToField.indexOf(field);
      if (col === -1) return '';
      return String(cells[col] ?? '').trim();
    };

    const kindRaw = normAlpha(get('kind'));
    let isCorridor;
    if (kindRaw === 'corridor' || kindRaw === 'corredor') {
      isCorridor = true;
    } else if (kindRaw === 'provider' || kindRaw === 'proveedor') {
      isCorridor = false;
    } else {
      const hasCorridorField = [...CORRIDOR_ONLY_FIELDS].some(
        (f) => get(f) !== '',
      );
      const hasProviderField = [...PROVIDER_ONLY_FIELDS].some(
        (f) => get(f) !== '',
      );
      if (hasCorridorField) {
        isCorridor = true;
      } else if (hasProviderField) {
        isCorridor = false;
      } else {
        errors.push(
          err(
            dataRowNo,
            'No se pudo clasificar la fila (unclassifiable row) — falta name/nombre o fromCountry/paisOrigen — fila omitida (row skipped)',
            'Unclassifiable row (no se pudo clasificar la fila) — missing name/nombre or fromCountry/paisOrigen — row skipped (fila omitida)',
          ),
        );
        continue;
      }
    }

    if (isCorridor) {
      parseCorridorRow(get, dataRowNo, corridors, errors);
    } else {
      parseProviderRow(get, dataRowNo, providers, errors);
    }
  }

  return { providers, corridors, errors };
}

function parseProviderRow(get, rowNo, providers, errors) {
  const name = get('name');
  if (!name) {
    errors.push(
      err(
        rowNo,
        'Falta el nombre del proveedor (missing provider name) — fila omitida (row skipped)',
        'Missing provider name (falta el nombre del proveedor) — row skipped (fila omitida)',
      ),
    );
    return;
  }

  const { kept: channels, dropped } = parseListCell(
    get('channels'),
    CHANNELS,
    CHANNEL_ALIASES,
  );
  if (dropped.length > 0) {
    errors.push(
      err(
        rowNo,
        `Aviso (warning): canales no reconocidos ignorados: ${dropped.join(', ')} (unrecognized channels dropped)`,
        `Warning (aviso): unrecognized channels dropped: ${dropped.join(', ')} (canales no reconocidos ignorados)`,
      ),
    );
  }
  const { kept: coverageCountries } = parseListCell(get('coverageCountries'));

  const feeModelType = normalizeFeeModelType(get('feeModelType'));
  const feeCells = ['feePct', 'feeFlat', 'feeMin', 'feeMax'];
  const feeValues = {};
  let feeInvalid = null;
  for (const field of feeCells) {
    const { value, invalid } = parseFeeCell(get(field));
    if (invalid) {
      feeInvalid = `${field}="${get(field)}"`;
      break;
    }
    feeValues[field] = value;
  }
  if (feeInvalid) {
    errors.push(
      err(
        rowNo,
        `Comisión inválida (invalid fee): ${feeInvalid} — debe ser un número ≥ 0 — fila omitida (row skipped)`,
        `Invalid fee (comisión inválida): ${feeInvalid} — must be a number ≥ 0 — row skipped (fila omitida)`,
      ),
    );
    return;
  }
  if (
    feeModelType === 'percentage' &&
    !(feeValues.feePct !== null && feeValues.feePct > 0)
  ) {
    errors.push(
      err(
        rowNo,
        'Comisión porcentual requiere feePct > 0 (percentage fee requires feePct > 0) — fila omitida (row skipped)',
        'Percentage fee requires feePct > 0 (comisión porcentual requiere feePct > 0) — row skipped (fila omitida)',
      ),
    );
    return;
  }

  const coords = parseLatLngPair(
    'lat',
    get('lat'),
    'lng',
    get('lng'),
    rowNo,
    errors,
  );
  if (!coords) return;

  providers.push({
    name,
    channels,
    coverageCountries,
    feeModelType,
    feePct: feeValues.feePct,
    feeFlat: feeValues.feeFlat,
    feeMin: feeValues.feeMin,
    feeMax: feeValues.feeMax,
    status: normalizeProviderStatus(get('status')),
    website: get('website'),
    lat: coords.lat,
    lng: coords.lng,
    notes: get('notes'),
  });
}

function parseCorridorRow(get, rowNo, corridors, errors) {
  const fromCountry = get('fromCountry');
  const toCountry = get('toCountry');
  if (!fromCountry || !toCountry) {
    errors.push(
      err(
        rowNo,
        'Falta el país de origen o destino (missing fromCountry or toCountry) — fila omitida (row skipped)',
        'Missing fromCountry or toCountry (falta el país de origen o destino) — row skipped (fila omitida)',
      ),
    );
    return;
  }

  const sendAmountRaw = get('sendAmount');
  const sendAmount =
    sendAmountRaw === '' ? null : parseNumberLoose(sendAmountRaw);
  if (sendAmountRaw !== '' && (sendAmount === null || sendAmount < 0)) {
    errors.push(
      err(
        rowNo,
        `Monto inválido (invalid sendAmount): "${sendAmountRaw}" — debe ser un número ≥ 0 — fila omitida (row skipped)`,
        `Invalid sendAmount (monto inválido): "${sendAmountRaw}" — must be a number ≥ 0 — row skipped (fila omitida)`,
      ),
    );
    return;
  }

  const fxRateRaw = get('fxRate');
  const fxRate = fxRateRaw === '' ? null : parseNumberLoose(fxRateRaw);
  if (fxRateRaw !== '' && (fxRate === null || fxRate <= 0)) {
    errors.push(
      err(
        rowNo,
        `Tasa inválida (invalid fxRate): "${fxRateRaw}" — debe ser un número > 0 — fila omitida (row skipped)`,
        `Invalid fxRate (tasa inválida): "${fxRateRaw}" — must be a number > 0 — row skipped (fila omitida)`,
      ),
    );
    return;
  }
  const fxRateAsOf = get('fxRateAsOf');
  if (fxRate !== null && fxRateAsOf === '') {
    errors.push(
      err(
        rowNo,
        'Tasa sin fecha de vigencia (fxRate without fxRateAsOf) — no se acepta tasa sin fecha (no rate without an as-of date) — fila omitida (row skipped)',
        'fxRate without fxRateAsOf (tasa sin fecha de vigencia) — no rate without an as-of date (no se acepta tasa sin fecha) — row skipped (fila omitida)',
      ),
    );
    return;
  }

  const fromCoords = parseLatLngPair(
    'fromLat',
    get('fromLat'),
    'fromLng',
    get('fromLng'),
    rowNo,
    errors,
  );
  if (!fromCoords) return;
  const toCoords = parseLatLngPair(
    'toLat',
    get('toLat'),
    'toLng',
    get('toLng'),
    rowNo,
    errors,
  );
  if (!toCoords) return;

  corridors.push({
    fromCountry,
    toCountry,
    providerName: get('providerName') || get('name'),
    sendAmount,
    fxRate,
    fxRateAsOf,
    fromLat: fromCoords.lat,
    fromLng: fromCoords.lng,
    toLat: toCoords.lat,
    toLng: toCoords.lng,
    notes: get('notes'),
  });
}

export { PROVIDER_STATUSES, CHANNELS };
