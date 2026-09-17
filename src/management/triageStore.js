/**
 * SAHJONY · GOD'S EYE VIEW — Inbound triage store (per-business WhatsApp
 * inquiries needing attention).
 * ---------------------------------------------------------------------------
 * localStorage key: 'sahjony.gev.triage.v1'
 *
 * HONESTY RULE: this store NEVER invents conversations. It starts empty;
 * items arrive only via addTriageItem() (Juan pastes/forwards) or
 * importTriageJson() (JSON import). An empty list renders an honest empty
 * state — never placeholder chats.
 *
 * SINGLE-OPERATOR: one inbox per business, all triaged by Juan. No shared
 * inboxes, no assignment, no team workflow.
 *
 * Item: { id, businessId, from, channel, text, receivedAt, status:
 *         'new' | 'in-progress' | 'done', note, createdAt, updatedAt }
 */

export const TRIAGE_KEY = 'sahjony.gev.triage.v1';

export const TRIAGE_STATUSES = Object.freeze(['new', 'in-progress', 'done']);

const BUSINESS_IDS = Object.freeze([
  'wholesale',
  'crude',
  'trade',
  'cubacash',
]);

const MAX_IMPORT = 200;

function chicagoIso(date = new Date()) {
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
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}-05:00`;
}

function makeId() {
  return `trg_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function storageAvailable() {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      typeof localStorage.getItem === 'function'
    );
  } catch {
    return false;
  }
}

function blankDoc() {
  return { version: 1, items: [] };
}

let _fallback = blankDoc();

function loadDoc() {
  if (!storageAvailable()) return _fallback;
  try {
    const raw = localStorage.getItem(TRIAGE_KEY);
    if (!raw) return blankDoc();
    const doc = JSON.parse(raw);
    if (!doc || !Array.isArray(doc.items)) return blankDoc();
    return doc;
  } catch {
    return blankDoc();
  }
}

function saveDoc(doc) {
  if (!storageAvailable()) {
    _fallback = doc;
    return;
  }
  try {
    localStorage.setItem(TRIAGE_KEY, JSON.stringify(doc));
  } catch {
    _fallback = doc;
  }
}

/** Test-only reset. */
export function _resetTriageForTests() {
  _fallback = blankDoc();
  if (storageAvailable()) {
    try {
      localStorage.removeItem(TRIAGE_KEY);
    } catch {
      /* noop */
    }
  }
}

function assertBusiness(businessId) {
  if (!BUSINESS_IDS.includes(businessId)) {
    throw new Error(`Unknown businessId: ${String(businessId)}`);
  }
}

function cleanStr(v, max = 5000) {
  return String(v ?? '').slice(0, max);
}

function coerceStatus(status) {
  if (TRIAGE_STATUSES.includes(status)) return status;
  return 'new';
}

/** Add one inbound inquiry. Never called automatically — Juan adds/imports. */
export function addTriageItem(businessId, data = {}) {
  assertBusiness(businessId);
  const doc = loadDoc();
  const now = chicagoIso();
  const item = {
    id: makeId(),
    businessId,
    from: cleanStr(data.from, 200),
    channel: cleanStr(data.channel, 40) || 'whatsapp',
    text: cleanStr(data.text, 5000),
    receivedAt: cleanStr(data.receivedAt, 40) || now,
    status: coerceStatus(data.status),
    note: cleanStr(data.note, 2000),
    createdAt: now,
    updatedAt: now,
  };
  doc.items.push(item);
  saveDoc(doc);
  return { ...item };
}

/** List triage items for a business, optionally by status, newest first. */
export function listTriage(businessId, status) {
  assertBusiness(businessId);
  const doc = loadDoc();
  let items = doc.items.filter((i) => i.businessId === businessId);
  if (status) {
    if (!TRIAGE_STATUSES.includes(status)) {
      throw new Error(`Unknown triage status: ${String(status)}`);
    }
    items = items.filter((i) => i.status === status);
  }
  return items
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((i) => ({ ...i }));
}

export function getTriageItem(id) {
  const doc = loadDoc();
  const found = doc.items.find((i) => i.id === id);
  return found ? { ...found } : null;
}

/** Update status/note on one item. No assignment — single operator. */
export function updateTriage(id, patch = {}) {
  const doc = loadDoc();
  const item = doc.items.find((i) => i.id === id);
  if (!item) throw new Error(`Triage item not found: ${String(id)}`);
  if (patch.status !== undefined) item.status = coerceStatus(patch.status);
  if (patch.note !== undefined) item.note = cleanStr(patch.note, 2000);
  if (patch.text !== undefined) item.text = cleanStr(patch.text, 5000);
  if (patch.from !== undefined) item.from = cleanStr(patch.from, 200);
  item.updatedAt = chicagoIso();
  saveDoc(doc);
  return { ...item };
}

/**
 * Import triage items from a JSON string: an array of
 * { from, text, receivedAt?, status?, note? }. Returns
 * { imported, skipped, errors[] }. Never invents — only imports what is
 * given; malformed entries are reported, not fixed up silently.
 */
export function importTriageJson(businessId, jsonText) {
  assertBusiness(businessId);
  let parsed;
  try {
    parsed = JSON.parse(String(jsonText || ''));
  } catch (error) {
    return { imported: 0, skipped: 0, errors: [`JSON inválido / Invalid JSON: ${error.message}`] };
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const result = { imported: 0, skipped: 0, errors: [] };
  for (const [index, entry] of list.slice(0, MAX_IMPORT).entries()) {
    if (!entry || typeof entry !== 'object') {
      result.skipped += 1;
      result.errors.push(`[#${index}] no es un objeto / not an object`);
      continue;
    }
    const text = String(entry.text ?? '').trim();
    const from = String(entry.from ?? '').trim();
    if (!text && !from) {
      result.skipped += 1;
      result.errors.push(`[#${index}] sin texto ni remitente / no text or sender`);
      continue;
    }
    addTriageItem(businessId, {
      from,
      text,
      channel: entry.channel || 'whatsapp',
      receivedAt: entry.receivedAt,
      status: entry.status,
      note: entry.note,
    });
    result.imported += 1;
  }
  if (list.length > MAX_IMPORT) {
    result.errors.push(
      `Límite de ${MAX_IMPORT} por importación / ${MAX_IMPORT}-item import cap`,
    );
  }
  return result;
}

/** Count items still needing attention (new + in-progress). */
export function countOpenTriage(businessId) {
  return listTriage(businessId).filter((i) => i.status !== 'done').length;
}
