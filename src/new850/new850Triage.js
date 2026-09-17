/**
 * New850 — Inbound triage store (GOD'S EYE VIEW plugin).
 * ---------------------------------------------------------------------------
 * WhatsApp credit-repair inquiries that need Juan's attention. Triage only —
 * this store never invents conversations or customers: it starts EMPTY and
 * fills exclusively from explicit JSON import (or manual add).
 *
 * Privacy: only masked phones are stored ("***4567"); SSN-like sequences are
 * redacted on import. Full phone numbers never persist.
 *
 * Client-side only. $0. No API keys. No external network calls.
 * No send path: triage items are read and classified; replies stay with Juan.
 */

import { maskPhone, redactSsn } from './new850Store.js';

export const TRIAGE_KEY = 'sahjony.new850.triage.v1';
export const TRIAGE_STATUSES = Object.freeze([
  'new',
  'reviewed',
  'converted',
  'dismissed',
]);
export const TRIAGE_STATUS_LABELS = Object.freeze({
  new: { es: 'Nuevo', en: 'New' },
  reviewed: { es: 'Revisado', en: 'Reviewed' },
  converted: { es: 'Convertido a caso', en: 'Converted to case' },
  dismissed: { es: 'Descartado', en: 'Dismissed' },
});

const MAX_ITEMS = 2000;

const asText = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function chicagoIso(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  } catch {
    return date.toISOString();
  }
}

function storageBackend() {
  try {
    if (typeof localStorage !== 'undefined') {
      return {
        getItem: (k) => localStorage.getItem(k),
        setItem: (k, v) => localStorage.setItem(k, String(v)),
      };
    }
  } catch {
    /* fall through to memory */
  }
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

function makeId() {
  return `trg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Mask phone-like digit runs inside free text (keep last 4).
function maskPhonesInText(text) {
  return asText(text).replace(
    /(\+?\d[\d\s().-]{6,}\d)/g,
    (m) => maskPhone(m) || '***',
  );
}

const coerceStatus = (s) =>
  TRIAGE_STATUSES.includes(s) ? s : 'new';

function normalizeItem(data = {}) {
  const senderRaw = asText(data.sender ?? data.phone ?? data.from);
  return {
    id: asText(data.id) || makeId(),
    receivedAt: asText(data.receivedAt) || chicagoIso(),
    channel: 'whatsapp',
    senderMasked: maskPhone(senderRaw),
    message: redactSsn(maskPhonesInText(asText(data.message ?? data.text))),
    status: coerceStatus(data.status),
    caseId: asText(data.caseId),
    notes: redactSsn(asText(data.notes)),
    demo: data.demo === true,
  };
}

/**
 * importTriageJson(text) — parses a JSON array (or { items: [...] }) of
 * WhatsApp inquiries into triage items. Never invents: invalid rows are
 * reported as errors, not filled in.
 * Returns { items: [...], errors: [{ row, message }] }.
 */
export function importTriageJson(text) {
  const errors = [];
  const items = [];
  let parsed;
  try {
    parsed = JSON.parse(asText(text));
  } catch (e) {
    return { items: [], errors: [{ row: 0, message: `JSON inválido: ${e.message}` }] };
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : null;
  if (!rows) {
    return {
      items: [],
      errors: [
        { row: 0, message: 'Se esperaba un arreglo JSON o { "items": [...] }.' },
      ],
    };
  }
  rows.slice(0, MAX_ITEMS).forEach((row, i) => {
    if (!row || typeof row !== 'object') {
      errors.push({ row: i + 1, message: 'Fila no es un objeto; omitida.' });
      return;
    }
    const msg = asText(row.message ?? row.text);
    const sender = asText(row.sender ?? row.phone ?? row.from);
    if (!msg && !sender) {
      errors.push({
        row: i + 1,
        message: 'Sin mensaje ni remitente; omitida (no se inventa).',
      });
      return;
    }
    items.push(normalizeItem(row));
  });
  return { items, errors };
}

export function exportTriageJson(items) {
  return JSON.stringify({ exportedAt: chicagoIso(), items }, null, 2);
}

/** Sample JSON template — clearly labeled DEMO, obviously fictional. */
export function sampleTriageTemplate() {
  return JSON.stringify(
    {
      items: [
        {
          sender: '+1 (555) 010-4567',
          message:
            'DEMO — Hola, quiero información sobre reparación de crédito.',
          receivedAt: '2026-09-17T09:00:00-05:00',
          notes: 'DEMO — fila de ejemplo, no es un cliente real.',
        },
      ],
    },
    null,
    2,
  );
}

export class TriageStore {
  constructor(key = TRIAGE_KEY) {
    this.key = key;
    this.backend = storageBackend();
    this.db = this.load();
  }

  load() {
    try {
      const raw = this.backend.getItem(this.key);
      if (!raw) return { items: [] };
      const parsed = JSON.parse(raw);
      return { items: Array.isArray(parsed.items) ? parsed.items : [] };
    } catch {
      return { items: [] };
    }
  }

  save() {
    try {
      this.backend.setItem(this.key, JSON.stringify(this.db));
    } catch {
      /* memory-only */
    }
  }

  reset() {
    this.db = { items: [] };
    this.save();
  }

  listTriage(filter = {}) {
    const { status } = filter;
    return this.db.items.filter(
      (i) => !status || i.status === status,
    );
  }

  getTriageItem(id) {
    return this.db.items.find((i) => i.id === id) ?? null;
  }

  addTriageItem(data = {}) {
    const item = normalizeItem(data);
    this.db.items.push(item);
    if (this.db.items.length > MAX_ITEMS) {
      this.db.items = this.db.items.slice(-MAX_ITEMS);
    }
    this.save();
    return item;
  }

  importJson(text) {
    const { items, errors } = importTriageJson(text);
    for (const item of items) this.db.items.push(item);
    if (this.db.items.length > MAX_ITEMS) {
      this.db.items = this.db.items.slice(-MAX_ITEMS);
    }
    this.save();
    return { added: items.length, errors };
  }

  setStatus(id, status) {
    const item = this.getTriageItem(id);
    if (!item) return null;
    item.status = coerceStatus(status);
    this.save();
    return item;
  }

  linkCase(id, caseId) {
    const item = this.getTriageItem(id);
    if (!item) return null;
    item.caseId = asText(caseId);
    item.status = 'converted';
    this.save();
    return item;
  }

  deleteTriageItem(id) {
    const idx = this.db.items.findIndex((i) => i.id === id);
    if (idx < 0) return false;
    this.db.items.splice(idx, 1);
    this.save();
    return true;
  }

  stats() {
    const items = this.db.items;
    return {
      total: items.length,
      new: items.filter((i) => i.status === 'new').length,
      reviewed: items.filter((i) => i.status === 'reviewed').length,
      converted: items.filter((i) => i.status === 'converted').length,
      dismissed: items.filter((i) => i.status === 'dismissed').length,
    };
  }
}

export const createTriageStore = (key) => new TriageStore(key);

export const __internals = { maskPhonesInText, normalizeItem };
