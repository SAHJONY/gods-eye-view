// New850 case-intake CSV importer — pure ES module (no DOM, no cesium).
//
// $0, no API keys. Parses CSV rows into DRAFT case-intake objects consumed
// by the New850 store. Every imported row becomes a draft case in the
// 'intake' stage — never a live case, never sent anywhere.
//
// PII RULES: phones are masked to ***4567 on intake; SSN-like columns
// (ssn, social security, seguro social) are DROPPED with a warning — SSNs
// are never stored or displayed. SSN-like values in free text are redacted.

import { maskPhone, redactSsn, containsSsnLike, BUREAUS } from './new850Store.js';

export const MAX_CASE_ROWS = 5000;

/** Canonical headers for the downloadable intake template. */
export const CSV_TEMPLATE_HEADERS = [
  'ref',
  'clientLabel',
  'phone',
  'bureaus',
  'item',
  'creditor',
  'evidence',
  'notes',
];

/**
 * Header row a user can download and fill in. The sample row is clearly
 * labeled DEMO/fictional — do not copy into real use.
 */
export function sampleCsvTemplate() {
  const header = CSV_TEMPLATE_HEADERS.join(',');
  const sample = [
    'DEMO-001',
    '"DEMO Cliente (ejemplo)"',
    '"***4567"',
    '"equifax,experian"',
    '"pago tardío (ejemplo)"',
    '"Acreedor Ejemplo (ficticio)"',
    '"Evidencia de ejemplo — fila DEMO"',
    '"Fila de ejemplo DEMO — no usar con datos reales"',
  ].join(',');
  return `${header}\n${sample}\n`;
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
  ['ref', 'ref'],
  ['referencia', 'ref'],
  ['reference', 'ref'],
  ['caso', 'ref'],
  ['case', 'ref'],
  ['clientlabel', 'clientLabel'],
  ['etiqueta', 'clientLabel'],
  ['label', 'clientLabel'],
  ['cliente', 'clientLabel'],
  ['client', 'clientLabel'],
  ['phone', 'phone'],
  ['telefono', 'phone'],
  ['tel', 'phone'],
  ['celular', 'phone'],
  ['bureaus', 'bureaus'],
  ['buros', 'bureaus'],
  ['bureau', 'bureaus'],
  ['buro', 'bureaus'],
  ['item', 'item'],
  ['disputa', 'item'],
  ['dispute', 'item'],
  ['concepto', 'item'],
  ['creditor', 'creditor'],
  ['acreedor', 'creditor'],
  ['informante', 'creditor'],
  ['furnisher', 'creditor'],
  ['evidence', 'evidence'],
  ['evidencia', 'evidence'],
  ['prueba', 'evidence'],
  ['proof', 'evidence'],
  ['notes', 'notes'],
  ['notas', 'notes'],
  ['observaciones', 'notes'],
]);

/** Headers that carry SSNs — dropped entirely, never stored. */
const SSN_HEADERS = new Set([
  'ssn',
  'socialsecurity',
  'socialsecuritynumber',
  'segurosocial',
  'numerosegurosocial',
  'seguridadsocial',
]);

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
    } else if (ch === '﻿') {
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
  if (inQuotes || cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function isBlankRow(cells) {
  return cells.every((c) => String(c || '').trim() === '');
}

function headerRowIndex(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    if (!isBlankRow(rows[i])) return i;
  }
  return -1;
}

function parseBureauList(raw) {
  const out = [];
  for (const part of String(raw || '').split(/[,;|]/)) {
    const s = part.trim().toLowerCase();
    if (BUREAUS.includes(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Parse CSV text into New850 draft-case intakes.
 *
 * @param {string} text — raw CSV content.
 * @returns {{ cases: object[], errors: { row: number, message: string }[] }}
 *
 * Every accepted row becomes a draft case ({ stage: 'intake',
 * intakeDraft: true }) with an optional first dispute. Phones are masked,
 * SSN columns are dropped with a warning, SSN-like free text is redacted.
 * Row numbers in errors count data rows starting at 1 (header excluded).
 */
export function parseCaseCsv(text) {
  const cases = [];
  const errors = [];

  if (!text || !String(text).trim()) {
    return {
      cases,
      errors: [{ row: 0, message: 'Archivo vacío (empty file)' }],
    };
  }

  const allRows = parseCsvRows(text);
  const hIdx = headerRowIndex(allRows);
  if (hIdx === -1) {
    return {
      cases,
      errors: [{ row: 0, message: 'Archivo vacío (empty file)' }],
    };
  }

  const headers = allRows[hIdx];
  const colToField = headers.map((h) => {
    const norm = normHeader(h);
    if (SSN_HEADERS.has(norm)) return '__SSN_DROPPED__';
    return HEADER_ALIASES.get(norm) || null;
  });

  const ssnCols = colToField.filter((f) => f === '__SSN_DROPPED__').length;
  if (ssnCols > 0) {
    errors.push({
      row: 0,
      message:
        `Columna(s) de SSN detectadas y ELIMINADAS (${ssnCols}) — los SSN nunca se guardan ` +
        `(SSN column(s) detected and DROPPED — SSNs are never stored)`,
    });
  }

  const recognized = colToField.filter(
    (f) => f && f !== '__SSN_DROPPED__',
  );
  if (recognized.length === 0) {
    return {
      cases,
      errors: [
        ...errors,
        {
          row: 0,
          message:
            'No se reconocieron columnas (no recognized columns). ' +
            'Esperadas: ref/referencia, clientLabel/cliente, phone/telefono, bureaus/buros, ' +
            'item/disputa, creditor/acreedor, evidence/evidencia, notes/notas…',
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

    if (dataRowNo > MAX_CASE_ROWS) {
      errors.push({
        row: dataRowNo,
        message: `Límite de ${MAX_CASE_ROWS.toLocaleString('en-US')} filas alcanzado — filas extra ignoradas (row limit reached, extra rows skipped)`,
      });
      break;
    }

    const get = (field) => {
      const col = colToField.indexOf(field);
      if (col === -1) return '';
      return String(cells[col] ?? '').trim();
    };

    const ref = get('ref');
    const clientLabel = get('clientLabel');
    if (!ref && !clientLabel) {
      errors.push({
        row: dataRowNo,
        message:
          'Falta la referencia y la etiqueta del cliente (missing ref and client label) — fila omitida (row skipped)',
      });
      continue;
    }

    const item = redactSsn(get('item'));
    const creditor = redactSsn(get('creditor'));
    const evidence = redactSsn(get('evidence'));
    const notes = redactSsn(get('notes'));

    if (
      containsSsnLike(get('item')) ||
      containsSsnLike(get('creditor')) ||
      containsSsnLike(get('evidence')) ||
      containsSsnLike(get('notes'))
    ) {
      errors.push({
        row: dataRowNo,
        message:
          'Aviso (warning): se detectó texto con forma de SSN y fue redactado (SSN-like text redacted)',
      });
    }

    const draftCase = {
      ref,
      clientLabel,
      // Store masked only — the full number never survives intake.
      phoneMasked: maskPhone(get('phone')),
      stage: 'intake',
      intakeDraft: true,
      bureaus: parseBureauList(get('bureaus')),
      notes,
    };

    if (item || creditor) {
      draftCase.disputes = [
        {
          item,
          creditor,
          evidence,
          status: 'draft',
          round: 1,
          bureaus: parseBureauList(get('bureaus')),
        },
      ];
    }

    cases.push(draftCase);
  }

  return { cases, errors };
}
