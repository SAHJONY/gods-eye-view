// Cuba market CSV import/export — the honest import path for the buyer
// directory. Bilingual ES/EN. The directory ships EMPTY (no buyer, partner,
// or request is ever invented); real records enter through this parser,
// manual entry in the dashboard, or Juan adding them directly.
//
// Buyer CSV headers:
// name,type,province,municipality,contactName,contactPhone,contactEmail,
// contactWhatsapp,activity,interestedProducts,verification
//
// Blocker #4: NO street-address and NO registration-number columns exist in
// this format. They are not collected, not stored, not rendered.

export const BUYER_CSV_HEADERS = Object.freeze([
  'name',
  'type',
  'province',
  'municipality',
  'contactName',
  'contactPhone',
  'contactEmail',
  'contactWhatsapp',
  'activity',
  'interestedProducts',
  'verification',
]);

export const REQUEST_CSV_HEADERS = Object.freeze([
  'ref',
  'product',
  'quantity',
  'targetPrice',
  'currency',
  'incoterms',
  'destinationPort',
  'timeline',
  'status',
  'notes',
]);

const REQUEST_NUM_FIELDS = new Set(['quantity', 'targetprice']);

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function cleanRow(row, numFields) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s === '') continue;
    out[k] = numFields.has(k.toLowerCase()) && s !== '' ? Number(s) : s;
  }
  return out;
}

function rowsToObjects(lines, canonicalHeaders, numFields) {
  const rawHeaders = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const headers = rawHeaders.map((h) => {
    const canon = canonicalHeaders.find((c) => c.toLowerCase() === h);
    return canon || h;
  });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    rows.push(cleanRow(row, numFields));
  }
  return rows;
}

const VALID_REQUEST_STATUSES = new Set([
  'intake',
  'triage',
  'quoted',
  'negotiating',
  'won',
  'lost',
]);

/**
 * Parse a CSV string into buyers and sourcing requests.
 * An optional `#REQUESTS` marker starts a second table with
 * REQUEST_CSV_HEADERS. Buyer rows need a name (and province for dedupe);
 * request rows need ref, product or quantity. Unknown request statuses
 * normalize to 'intake'.
 * Returns { buyers, requests, errors }.
 */
export function parseCubaCsv(text) {
  const result = { buyers: [], requests: [], errors: 0 };
  if (typeof text !== 'string' || !text.trim()) return result;
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const marker = lines.findIndex((l) => l.trim().toLowerCase() === '#requests');
  const buyerLines = marker === -1 ? lines : lines.slice(0, marker);
  const reqLines = marker === -1 ? [] : lines.slice(marker + 1);
  if (buyerLines.length >= 2) {
    for (const row of rowsToObjects(
      buyerLines,
      BUYER_CSV_HEADERS,
      new Set(),
    )) {
      if (!row.name) {
        result.errors += 1;
        continue;
      }
      result.buyers.push({
        name: row.name,
        type: row.type,
        province: row.province,
        municipality: row.municipality,
        contact: {
          name: row.contactName,
          phone: row.contactPhone,
          email: row.contactEmail,
          whatsapp: row.contactWhatsapp,
        },
        activity: row.activity,
        interestedProducts: row.interestedProducts,
        verification: row.verification,
      });
    }
  }
  if (reqLines.length >= 2) {
    for (const row of rowsToObjects(
      reqLines,
      REQUEST_CSV_HEADERS,
      REQUEST_NUM_FIELDS,
    )) {
      if (!row.ref && !row.product && !row.quantity) {
        result.errors += 1;
        continue;
      }
      if (!VALID_REQUEST_STATUSES.has(String(row.status)))
        row.status = 'intake';
      result.requests.push(row);
    }
  }
  return result;
}

/** Serialize buyers to CSV. */
export function buyersToCsv(buyers) {
  const rows = [BUYER_CSV_HEADERS.join(',')];
  for (const b of buyers || []) {
    rows.push(
      [
        b.name,
        b.type,
        b.province,
        b.municipality,
        b.contact?.contactName ?? b.contact?.name,
        b.contact?.contactPhone ?? b.contact?.phone,
        b.contact?.contactEmail ?? b.contact?.email,
        b.contact?.contactWhatsapp ?? b.contact?.whatsapp,
        b.activity,
        Array.isArray(b.interestedProducts)
          ? b.interestedProducts.join('; ')
          : b.interestedProducts,
        b.verification,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return rows.join('\n');
}

/**
 * Downloadable buyer CSV template: header row ONLY. No sample people or
 * companies are ever shipped — see the real-data-only rule. Instructions
 * for where to get real records live in CSV_IMPORT_INSTRUCTIONS.
 */
export function buyerCsvTemplate() {
  return `${BUYER_CSV_HEADERS.join(',')}\n`;
}

/**
 * Bilingual instructions pointing to the real data sources. Never includes
 * a sample row — the directory only accepts real CRM records.
 */
export const CSV_IMPORT_INSTRUCTIONS = Object.freeze({
  es: 'Pegue filas REALES del CRM de MIPYMEs de Cuba (una por línea). La plantilla es solo el encabezado: no incluye datos de ejemplo. Nada se inventa — las filas falsas rompen la confianza.',
  en: 'Paste REAL rows from the Cuba MIPYME CRM (one per line). The template is header-only: it contains no sample data. Nothing is invented — fake rows break trust.',
});
