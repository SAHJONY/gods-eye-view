// Cuba car competition-price CSV importer — pure ES module (no DOM, no cesium).
//
// $0, no API keys. Parses competition price rows (the shape the daily
// `car-competition-price-scan` cron produces) into the canonical shapes
// consumed by carStore.addSnapshot(). Header-flexible: English or Spanish
// column names are accepted and mapped to canonical fields.
//
// Canonical snapshot shape (fields empty string/null when missing — never
// invented):
//   { competitor, model, price, date, sourceUrl }  (price: number or null)
//
// Buyer-facing prices only. This importer has no field for margins, floors,
// or supplier names and will not map one.

export const MAX_PRICE_ROWS = 5000;

/** Canonical headers for the downloadable template. */
export const CSV_TEMPLATE_HEADERS = [
  'competitor',
  'model',
  'price',
  'date',
  'sourceUrl',
];

export function sampleCsvTemplate() {
  const header = CSV_TEMPLATE_HEADERS.join(',');
  const sample = [
    '"Sample Competitor (fictional)"',
    '"Sample Model (fictional)"',
    '99999',
    '2026-09-17',
    '"https://example.com/sample-listing"',
  ].join(',');
  return `${header}\n${sample}\n// Sample row only — fila de ejemplo, no usar\n`;
}

/** Strip accents, lowercase, keep only alphanumerics. */
function normHeader(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Map normalized header aliases → canonical field names. */
const HEADER_ALIASES = new Map([
  // competitor
  ['competitor', 'competitor'],
  ['competidor', 'competitor'],
  ['vendedor', 'competitor'],
  ['seller', 'competitor'],
  ['dealer', 'competitor'],
  ['agencia', 'competitor'],
  // model
  ['model', 'model'],
  ['modelo', 'model'],
  ['car', 'model'],
  ['carro', 'model'],
  ['vehiculo', 'model'],
  ['vehicle', 'model'],
  // price
  ['price', 'price'],
  ['precio', 'price'],
  ['precioventa', 'price'],
  ['cost', 'price'],
  // date
  ['date', 'date'],
  ['fecha', 'date'],
  ['observed', 'date'],
  ['observedat', 'date'],
  ['scandate', 'date'],
  // sourceUrl
  ['sourceurl', 'sourceUrl'],
  ['url', 'sourceUrl'],
  ['fuente', 'sourceUrl'],
  ['fuenteurl', 'sourceUrl'],
  ['source', 'sourceUrl'],
  ['enlace', 'sourceUrl'],
  ['link', 'sourceUrl'],
]);

const REQUIRED_FIELDS = ['competitor', 'model', 'price'];

export function normalizeFieldName(raw) {
  return HEADER_ALIASES.get(normHeader(raw)) ?? null;
}

function asText(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function asPrice(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const cleaned = String(v).replace(/[$,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Minimal CSV parser: handles quoted fields with commas and escaped quotes.
 * Returns { headers, rows } where rows are arrays of strings.
 */
export function parseCsvRaw(text) {
  const input = String(text ?? '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  const [headers = [], ...data] = rows;
  return { headers, rows: data };
}

/**
 * parseCompetitionCsv(text) → { rows: [snapshot], errors: [string], skipped }.
 * Rows follow the canonical snapshot shape. Comment lines starting with //
 * and the sample row are ignored. Empty price → null (never invented).
 */
export function parseCompetitionCsv(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l));
  const { headers, rows } = parseCsvRaw(lines.join('\n'));
  const colMap = headers.map(normalizeFieldName);
  const missing = REQUIRED_FIELDS.filter((f) => !colMap.includes(f));
  if (missing.length) {
    return {
      rows: [],
      errors: [
        `Missing required columns: ${missing.join(', ')} / Faltan columnas: ${missing.join(', ')}`,
      ],
      skipped: rows.length,
    };
  }
  const out = [];
  const errors = [];
  let skipped = 0;
  for (const cells of rows.slice(0, MAX_PRICE_ROWS)) {
    const record = {};
    for (let i = 0; i < colMap.length; i += 1) {
      const key = colMap[i];
      if (!key) continue;
      record[key] = cells[i] ?? '';
    }
    if (REQUIRED_FIELDS.every((f) => asText(record[f]) === '')) {
      skipped += 1;
      continue;
    }
    const price = asPrice(record.price);
    if (price === null && asText(record.price) !== '') {
      errors.push(
        `Invalid price "${asText(record.price)}" for ${asText(record.competitor)} ${asText(record.model)} — row skipped / Precio inválido, fila omitida`,
      );
      skipped += 1;
      continue;
    }
    out.push({
      competitor: asText(record.competitor),
      model: asText(record.model),
      price,
      date: asText(record.date),
      sourceUrl: asText(record.sourceUrl),
    });
  }
  return { rows: out, errors, skipped };
}

/** snapshots → CSV text (canonical headers). */
export function snapshotsToCsv(snapshots = []) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_TEMPLATE_HEADERS.join(',')];
  for (const s of snapshots) {
    lines.push(
      [
        esc(s.competitor),
        esc(s.model),
        s.price == null ? '' : s.price,
        esc(s.date),
        esc(s.sourceUrl),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
