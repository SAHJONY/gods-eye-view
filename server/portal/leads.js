/**
 * SAHJONY Client Portal — leads CRM store (OWNER ONLY).
 *
 * Buyer leads for SAHJONY's wholesale operations. Every lead is tagged with
 * a business unit so the businesses stay separated (Juan: "Los negocios van
 * separados" — nada se mezcla). This store backs ONLY the owner console;
 * lead data must never appear on client-facing pages.
 *
 * Persisted as JSON under server/portal/data/ (gitignored), like the other
 * portal stores. Upserts dedupe on (name, country).
 */
import { randomBytes } from 'node:crypto';

export const LEAD_STATUSES = Object.freeze([
  'nuevo',
  'contactado',
  'interesado',
  'cliente',
  'descartado',
]);

/**
 * Business units — mirrors the business registry in
 * src/businessLauncher.js (BUSINESSES ids). New leads from the iPhone
 * wholesale buyer-lead build are tagged 'cell-phones'.
 */
export const BUSINESS_UNITS = Object.freeze([
  { id: 'cell-phones', es: 'Teléfonos al por mayor', en: 'Wholesale Cell Phones' },
  { id: 'trade', es: 'Comercio import/export', en: 'Import/Export Trade' },
  { id: 'cubacash', es: 'MY CUBA CASH', en: 'MY CUBA CASH' },
  { id: 'crude', es: 'Corretaje de crudo', en: 'Crude Oil Brokerage' },
  { id: 'insurance', es: 'Seguros', en: 'Insurance' },
  { id: 'wholesale', es: 'Bienes raíces mayoristas', en: 'Wholesale Real Estate' },
]);

export const BUSINESS_UNIT_IDS = Object.freeze(BUSINESS_UNITS.map((u) => u.id));

export function businessUnitLabel(id, lang = 'es') {
  const unit = BUSINESS_UNITS.find((u) => u.id === id);
  if (!unit) return String(id || '');
  return lang === 'en' ? unit.en : unit.es;
}

export function assertBusinessUnit(value) {
  const v = String(value || '').trim();
  if (!BUSINESS_UNIT_IDS.includes(v)) {
    throw new Error('business must be one of: ' + BUSINESS_UNIT_IDS.join(' / '));
  }
  return v;
}

export function assertLeadStatus(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!LEAD_STATUSES.includes(v)) {
    throw new Error('status must be one of: ' + LEAD_STATUSES.join(' / '));
  }
  return v;
}

function newId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function normKeyPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/** Dedupe key: name + country, accent/diacritic-insensitive. */
export function leadKey(name, country) {
  return `${normKeyPart(name)}|${normKeyPart(country)}`;
}

const SEARCHABLE = ['name', 'city', 'country', 'phone', 'email', 'web'];

export function createLeadStore({ load, save } = {}) {
  /** @type {Map<string,object>} */
  const leads = new Map();
  let loaded = false;

  function ensureLoaded() {
    if (loaded || !load) return;
    loaded = true;
    try {
      const raw = load();
      const list = Array.isArray(raw?.leads) ? raw.leads : [];
      for (const lead of list) {
        if (lead?.id) leads.set(lead.id, lead);
      }
    } catch {
      // Corrupt snapshot: start empty rather than crash.
    }
  }

  function persist() {
    if (!save) return;
    try {
      save({ leads: [...leads.values()] });
    } catch {
      // best-effort
    }
  }

  function findByKey(key) {
    for (const lead of leads.values()) {
      if (leadKey(lead.name, lead.country) === key) return lead;
    }
    return null;
  }

  function matches(lead, { q, country, region, type, status, business } = {}) {
    if (business && lead.business !== business) return false;
    if (status && lead.status !== status) return false;
    if (country && normKeyPart(lead.country) !== normKeyPart(country)) return false;
    if (region && normKeyPart(lead.region) !== normKeyPart(region)) return false;
    if (type && normKeyPart(lead.type) !== normKeyPart(type)) return false;
    if (q) {
      const needle = normKeyPart(q);
      const hit = SEARCHABLE.some((field) => normKeyPart(lead[field]).includes(needle));
      if (!hit) return false;
    }
    return true;
  }

  return {
    /**
     * Insert or update a lead. Dedupe is on (name, country). On update the
     * existing status/notes/email are preserved unless the patch provides
     * new values; business is set on insert and only changed when the patch
     * explicitly carries it.
     */
    upsert(input = {}) {
      ensureLoaded();
      const name = String(input.name || '').trim();
      const country = String(input.country || '').trim();
      if (!name) throw new Error('name is required');
      if (!country) throw new Error('country is required');
      const key = leadKey(name, country);
      const existing = findByKey(key);
      const now = new Date().toISOString();
      const business =
        input.business !== undefined ? assertBusinessUnit(input.business) : 'cell-phones';
      if (existing) {
        for (const field of ['type', 'city', 'region', 'address', 'phone', 'web']) {
          if (input[field] !== undefined && String(input[field]).trim() !== '') {
            existing[field] = String(input[field]).trim();
          }
        }
        if (input.email !== undefined && String(input.email).trim() !== '') {
          existing.email = String(input.email).trim();
        }
        if (input.status !== undefined) existing.status = assertLeadStatus(input.status);
        if (input.notes !== undefined) existing.notes = String(input.notes);
        if (input.business !== undefined) existing.business = business;
        existing.updatedAt = now;
        persist();
        return { lead: existing, created: false };
      }
      const lead = {
        id: newId('lead'),
        name,
        type: String(input.type || '').trim(),
        city: String(input.city || '').trim(),
        country,
        region: String(input.region || '').trim(),
        address: String(input.address || '').trim(),
        phone: String(input.phone || '').trim(),
        email: String(input.email || '').trim(),
        web: String(input.web || '').trim(),
        business,
        status: input.status !== undefined ? assertLeadStatus(input.status) : 'nuevo',
        notes: String(input.notes || ''),
        source: String(input.source || 'leads-latam-caribe-2026-10-09').trim(),
        createdAt: now,
        updatedAt: now,
      };
      leads.set(lead.id, lead);
      persist();
      return { lead, created: true };
    },

    get(id) {
      ensureLoaded();
      return leads.get(id) || null;
    },

    /** Owner update: status, notes, email, phone, business. */
    update(id, patch = {}) {
      ensureLoaded();
      const lead = leads.get(id);
      if (!lead) return null;
      if (patch.status !== undefined) lead.status = assertLeadStatus(patch.status);
      if (patch.notes !== undefined) lead.notes = String(patch.notes);
      if (patch.email !== undefined) lead.email = String(patch.email).trim();
      if (patch.phone !== undefined) lead.phone = String(patch.phone).trim();
      if (patch.business !== undefined) lead.business = assertBusinessUnit(patch.business);
      lead.updatedAt = new Date().toISOString();
      persist();
      return lead;
    },

    /** Filtered list, newest-first within name order; returns { leads, total }. */
    list(filters = {}) {
      ensureLoaded();
      const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 50, 1), 500);
      const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
      const matched = [...leads.values()]
        .filter((lead) => matches(lead, filters))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
      return { leads: matched.slice(offset, offset + limit), total: matched.length };
    },

    /** Distinct values for a field (filter dropdowns), sorted. */
    distinct(field) {
      ensureLoaded();
      const values = new Set();
      for (const lead of leads.values()) {
        const v = String(lead[field] || '').trim();
        if (v) values.add(v);
      }
      return [...values].sort((a, b) => a.localeCompare(b, 'es'));
    },

    countByStatus(business) {
      ensureLoaded();
      const counts = {};
      for (const s of LEAD_STATUSES) counts[s] = 0;
      for (const lead of leads.values()) {
        if (business && lead.business !== business) continue;
        counts[lead.status] = (counts[lead.status] || 0) + 1;
      }
      return counts;
    },

    countByBusiness() {
      ensureLoaded();
      const counts = {};
      for (const lead of leads.values()) {
        counts[lead.business] = (counts[lead.business] || 0) + 1;
      }
      return counts;
    },

    _size() {
      ensureLoaded();
      return leads.size;
    },
  };
}
