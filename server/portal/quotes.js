/**
 * SAHJONY Client Portal — quote request store.
 *
 * Persisted as JSON under server/portal/data/ (gitignored). A client
 * submits a quote request from the portal's "Cotizar" tab; it lands here as
 * `pending` and the owner triages it from the admin console. Quote rows
 * hold client-safe contact info only — no proprietary fields, by design.
 *
 * Container-first: when serviceTier is 'Enviar contenedor completo' the
 * request must carry a containerSize ('20ft' | '40ft') plus origin /
 * destination, so the owner can price the lane immediately.
 */
import { randomBytes } from 'node:crypto';
import { SERVICE_INTEREST_OPTIONS } from './clients.js';

/** pending → done (atendida) | rejected (rechazada). Owner-driven only. */
export const QUOTE_STATUSES = Object.freeze(['pending', 'done', 'rejected']);

/** Container sizes offered for the full-container tier. */
export const CONTAINER_SIZES = Object.freeze(['20ft', '40ft']);

/** Service tier that triggers the container-size selector. */
export const CONTAINER_TIER = 'Enviar contenedor completo';

function newId() {
  return `quo_${randomBytes(8).toString('hex')}`;
}

function assertTier(value) {
  const tier = String(value || '').trim();
  if (!SERVICE_INTEREST_OPTIONS.includes(tier)) {
    throw new Error('serviceTier must be one of: ' + SERVICE_INTEREST_OPTIONS.join(' / '));
  }
  return tier;
}

function assertContainerSize(tier, value) {
  const size = String(value || '').trim();
  if (tier === CONTAINER_TIER) {
    if (!CONTAINER_SIZES.includes(size)) {
      throw new Error(`containerSize is required for ${CONTAINER_TIER} (one of: ${CONTAINER_SIZES.join(', ')})`);
    }
    return size;
  }
  // Other tiers: the selector is never shown, so ignore any stray value.
  return undefined;
}

function assertStatus(value) {
  if (!QUOTE_STATUSES.includes(value)) {
    throw new Error(`status must be one of: ${QUOTE_STATUSES.join(', ')}`);
  }
  return value;
}

export function createQuoteStore({ load, save } = {}) {
  /** @type {Map<string,object>} */
  const quotes = new Map();
  let loaded = false;

  function ensureLoaded() {
    if (loaded || !load) return;
    loaded = true;
    try {
      const raw = load();
      const list = Array.isArray(raw?.quotes) ? raw.quotes : [];
      for (const quote of list) {
        if (quote?.id && quote?.clientId) quotes.set(quote.id, quote);
      }
    } catch {
      // Corrupt snapshot: start empty rather than crash.
    }
  }

  function persist() {
    if (!save) return;
    try {
      save({ quotes: [...quotes.values()] });
    } catch {
      // best-effort
    }
  }

  return {
    /**
     * Record a quote request from an authenticated client. The demo (prospect)
     * session is view-only and is rejected one layer up, in routes.js.
     */
    create({
      clientId,
      companyName = '',
      serviceTier,
      containerSize,
      cargoDescription,
      origin = '',
      destination = '',
      contactName,
      contactPhone,
      contactEmail = '',
    }) {
      ensureLoaded();
      if (!clientId) throw new Error('clientId is required');
      const tier = assertTier(serviceTier);
      const size = assertContainerSize(tier, containerSize);
      const desc = String(cargoDescription || '').trim();
      if (!desc) throw new Error('cargoDescription is required');
      if (desc.length > 2000) throw new Error('cargoDescription is too long');
      const name = String(contactName || '').trim();
      if (!name) throw new Error('contactName is required');
      const phone = String(contactPhone || '').trim();
      if (phone.replace(/\D/g, '').length < 7) throw new Error('contactPhone is invalid');
      const email = String(contactEmail || '').trim();
      if (email && !email.includes('@')) throw new Error('contactEmail is invalid');
      const now = new Date().toISOString();
      const quote = {
        id: newId(),
        clientId: String(clientId),
        companyName: String(companyName || '').trim(),
        serviceTier: tier,
        containerSize: size,
        cargoDescription: desc,
        origin: String(origin || '').trim(),
        destination: String(destination || '').trim(),
        contactName: name,
        contactPhone: phone,
        contactEmail: email,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      quotes.set(quote.id, quote);
      persist();
      return quote;
    },

    get(id) {
      ensureLoaded();
      return quotes.get(id) || null;
    },

    /** Scoped read: only the owning client's requests. */
    listForClient(clientId) {
      ensureLoaded();
      return [...quotes.values()]
        .filter((q) => q.clientId === clientId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    /** Owner-only: pending first, then newest. */
    listAll() {
      ensureLoaded();
      return [...quotes.values()].sort((a, b) => {
        const pa = a.status === 'pending' ? 0 : 1;
        const pb = b.status === 'pending' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
    },

    /** Owner triage: pending → done | rejected. */
    updateStatus(id, status) {
      ensureLoaded();
      const quote = quotes.get(id);
      if (!quote) return null;
      quote.status = assertStatus(status);
      quote.updatedAt = new Date().toISOString();
      persist();
      return quote;
    },

    _size() {
      ensureLoaded();
      return quotes.size;
    },
  };
}
