/**
 * SAHJONY buyer intake — sourcing request store (v1, manual quoting).
 *
 * A prospective buyer registers on the public page (/import-export/buyer-intake/)
 * and picks products from the catalog with estimated monthly volumes. Each
 * submission lands here as `nuevo`; the owner triages it from the admin
 * console (public/portal/admin.html → "Solicitudes" tab) via the owner-gated
 * /api/portal/admin/buyer-requests endpoints.
 *
 * Persisted as JSON under server/portal/data/ (gitignored), same pattern as
 * quotes.js. Rows hold customer contact info only — NO prices, NO supplier
 * data, NO margins. v1 is manual quoting: prices never appear in this flow.
 */
import { randomBytes } from 'node:crypto';

/** nuevo → cotizado (quoted) | cerrado (closed). Owner-driven only. */
export const BUYER_REQUEST_STATUSES = Object.freeze(['nuevo', 'cotizado', 'cerrado']);

/** Business types offered on the public form. */
export const BUSINESS_TYPES = Object.freeze(['mayorista', 'minorista', 'distribuidor', 'otro']);

/** Volume units offered per product. */
export const VOLUME_UNITS = Object.freeze(['contenedor 20ft', 'contenedor 40ft', 'toneladas', 'kg', 'unidades']);

/** Container sizes offered per product on the intake form (default 40ft). */
export const CONTAINER_SIZES = Object.freeze(['20ft', '40ft']);

function newId() {
  return `buy_${randomBytes(8).toString('hex')}`;
}

function reqString(value, field, { max = 200, min = 1 } = {}) {
  const s = String(value ?? '').trim();
  if (s.length < min) throw new Error(`${field} is required`);
  if (s.length > max) throw new Error(`${field} is too long`);
  return s;
}

function optString(value, { max = 500 } = {}) {
  const s = String(value ?? '').trim();
  if (s.length > max) throw new Error('field is too long');
  return s;
}

export function createBuyerRequestStore({ load, save, validProductIds } = {}) {
  /** @type {Map<string,object>} */
  const requests = new Map();
  let loaded = false;

  function ensureLoaded() {
    if (loaded || !load) return;
    loaded = true;
    try {
      const raw = load();
      const list = Array.isArray(raw?.requests) ? raw.requests : [];
      for (const r of list) {
        if (r?.id) requests.set(r.id, r);
      }
    } catch {
      // Corrupt snapshot: start empty rather than crash.
    }
  }

  function persist() {
    if (!save) return;
    try {
      save({ requests: [...requests.values()] });
    } catch {
      // best-effort
    }
  }

  function assertProductId(id) {
    const pid = String(id || '').trim();
    if (!pid) throw new Error('product id is required');
    if (validProductIds && !validProductIds.has(pid)) {
      throw new Error(`unknown product: ${pid}`);
    }
    return pid;
  }

  return {
    /**
     * Record a public buyer intake submission. No auth — the endpoint itself
     * is rate-limited. Throws on any validation failure.
     */
    create({
      fullName,
      company = '',
      country,
      whatsapp,
      email = '',
      businessType,
      products,
      notes = '',
    }) {
      ensureLoaded();
      const name = reqString(fullName, 'fullName', { max: 120 });
      const biz = reqString(businessType, 'businessType', { max: 40 });
      if (!BUSINESS_TYPES.includes(biz)) {
        throw new Error('businessType must be one of: ' + BUSINESS_TYPES.join(' / '));
      }
      const ctry = reqString(country, 'country', { max: 80 });
      const phone = reqString(whatsapp, 'whatsapp', { max: 40 });
      if (phone.replace(/\D/g, '').length < 7) throw new Error('whatsapp is invalid');
      const mail = optString(email, { max: 160 });
      if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new Error('email is invalid');

      if (!Array.isArray(products) || products.length === 0) {
        throw new Error('at least one product is required');
      }
      if (products.length > 90) throw new Error('too many products');
      const seen = new Set();
      const items = products.map((p) => {
        const id = assertProductId(p?.id);
        if (seen.has(id)) throw new Error(`duplicate product: ${id}`);
        seen.add(id);
        const volRaw = String(p?.volume ?? '').trim();
        const volume = volRaw ? volRaw.slice(0, 20) : '';
        if (volume && !/^\d+(\.\d+)?$/.test(volume)) throw new Error('volume must be numeric');
        const unit = String(p?.unit ?? '').trim();
        if (unit && !VOLUME_UNITS.includes(unit)) {
          throw new Error('unit must be one of: ' + VOLUME_UNITS.join(' / '));
        }
        const size = String(p?.containerSize ?? '40ft').trim() || '40ft';
        if (!CONTAINER_SIZES.includes(size)) {
          throw new Error('containerSize must be one of: ' + CONTAINER_SIZES.join(' / '));
        }
        return { id, volume, unit, containerSize: size };
      });

      const now = new Date().toISOString();
      const req = {
        id: newId(),
        fullName: name,
        company: optString(company, { max: 160 }),
        country: ctry,
        whatsapp: phone,
        email: mail,
        businessType: biz,
        products: items,
        notes: optString(notes, { max: 1000 }),
        status: 'nuevo',
        createdAt: now,
        updatedAt: now,
      };
      requests.set(req.id, req);
      persist();
      return req;
    },

    get(id) {
      ensureLoaded();
      return requests.get(id) || null;
    },

    /** Newest first — owner triage order. */
    listAll() {
      ensureLoaded();
      return [...requests.values()].sort((a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)),
      );
    },

    updateStatus(id, status) {
      ensureLoaded();
      const r = requests.get(id);
      if (!r) return null;
      if (!BUYER_REQUEST_STATUSES.includes(status)) {
        throw new Error('status must be one of: ' + BUYER_REQUEST_STATUSES.join(' / '));
      }
      r.status = status;
      r.updatedAt = new Date().toISOString();
      persist();
      return r;
    },
  };
}
