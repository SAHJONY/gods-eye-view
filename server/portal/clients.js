/**
 * SAHJONY Client Portal — client account store.
 *
 * Persisted as JSON under server/portal/data/ (gitignored). A client record
 * holds identity + credential hash ONLY. Commercially sensitive data
 * (suppliers, costs, margins) must NEVER be added here — this store backs a
 * client-facing surface.
 */
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.js';

function newId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/**
 * Strip everything a client must never see about their own record internals.
 * (The store holds no secrets beyond the password hash, but the hash itself
 * must never leave the server.)
 */
export function publicClient(client) {
  if (!client) return null;
  return {
    id: client.id,
    companyName: client.companyName,
    contactName: client.contactName,
    email: client.email,
    phone: client.phone || '',
    serviceInterest: client.serviceInterest || '',
    // 'pending' | 'active' | 'rejected'. Self-registrations start pending;
    // only active clients can log in or see data.
    status: client.status || (client.active === false ? 'inactive' : 'active'),
    active: client.active !== false,
    createdAt: client.createdAt,
    // Lets the frontend label the prospect-demo session DEMOSTRACIÓN.
    demo: client.demo === true,
  };
}

/**
 * Synthetic public profile for the no-password prospect demo.
 * Never stored in the client store.
 */
export function demoPublicClient() {
  return {
    id: 'demo',
    companyName: 'DEMOSTRACIÓN · Cliente de muestra',
    contactName: '',
    email: '',
    active: true,
    createdAt: null,
    demo: true,
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Allowed values for "¿Qué servicio le interesa?" on the registration form.
 * This is how the owner knows whether the prospect wants to BUY through
 * SAHJONY or SHIP with SAHJONY — and at which tier — both convert to
 * tracked shipments.
 */
export const SERVICE_INTEREST_OPTIONS = Object.freeze([
  'Comprar mercancía',
  'Enviar contenedor completo',
  'Enviar carga por pallet',
  'Enviar paquetería',
  'Varios servicios',
]);

/** Server-side guard: only the 3 allowed values, nothing else. */
export function assertServiceInterest(value) {
  const v = String(value || '').trim();
  if (!SERVICE_INTEREST_OPTIONS.includes(v)) {
    throw new Error('serviceInterest must be one of: ' + SERVICE_INTEREST_OPTIONS.join(' / '));
  }
  return v;
}

/**
 * True when the account may log in and see data: status 'active'.
 * Legacy records without a status fall back to the active boolean.
 */
export function isClientActive(client) {
  if (!client) return false;
  if (client.active === false) return false;
  if (client.status) return client.status === 'active';
  return true;
}

export function createClientStore({ load, save } = {}) {
  /** @type {Map<string,object>} */
  const clients = new Map();
  let loaded = false;

  function ensureLoaded() {
    if (loaded || !load) return;
    loaded = true;
    try {
      const raw = load();
      const list = Array.isArray(raw?.clients) ? raw.clients : [];
      for (const client of list) {
        if (client?.id) clients.set(client.id, client);
      }
    } catch {
      // Corrupt snapshot: start empty rather than crash.
    }
  }

  function persist() {
    if (!save) return;
    try {
      save({ clients: [...clients.values()] });
    } catch {
      // best-effort
    }
  }

  function findByEmail(email) {
    const wanted = normalizeEmail(email);
    for (const client of clients.values()) {
      if (normalizeEmail(client.email) === wanted) return client;
    }
    return null;
  }

  return {
    /**
     * Create a client account, ACTIVE immediately (owner-only operation:
     * the admin panel creates accounts for approved clients).
     */
    create({ companyName, contactName, email, phone, serviceInterest, password }) {
      ensureLoaded();
      companyName = String(companyName || '').trim();
      email = normalizeEmail(email);
      if (!companyName) throw new Error('companyName is required');
      if (!email || !email.includes('@')) throw new Error('a valid email is required');
      if (findByEmail(email)) throw new Error('email already registered');
      const client = {
        id: newId('cli'),
        companyName,
        contactName: String(contactName || '').trim(),
        email,
        phone: String(phone || '').trim(),
        serviceInterest: serviceInterest ? assertServiceInterest(serviceInterest) : '',
        passwordHash: hashPassword(password),
        status: 'active',
        active: true,
        createdAt: new Date().toISOString(),
      };
      clients.set(client.id, client);
      persist();
      return client;
    },

    /**
     * Public self-registration: the account is created as `pending` and
     * CANNOT log in or see any data until the owner approves it.
     */
    register({ companyName, contactName, email, phone, serviceInterest, password }) {
      ensureLoaded();
      companyName = String(companyName || '').trim();
      contactName = String(contactName || '').trim();
      email = normalizeEmail(email);
      phone = String(phone || '').trim();
      if (!companyName) throw new Error('companyName is required');
      if (!contactName) throw new Error('contactName is required');
      if (!email || !email.includes('@')) throw new Error('a valid email is required');
      if (!phone || phone.replace(/\D/g, '').length < 7) throw new Error('a valid phone is required');
      if (findByEmail(email)) throw new Error('email already registered');
      const client = {
        id: newId('cli'),
        companyName,
        contactName,
        email,
        phone,
        serviceInterest: assertServiceInterest(serviceInterest),
        passwordHash: hashPassword(password),
        status: 'pending',
        active: false,
        createdAt: new Date().toISOString(),
      };
      clients.set(client.id, client);
      persist();
      return client;
    },

    /** Owner approves a pending registration → the client can log in. */
    approve(id) {
      ensureLoaded();
      const client = clients.get(id);
      if (!client) return null;
      client.status = 'active';
      client.active = true;
      persist();
      return client;
    },

    /** Owner rejects a pending registration → it can never log in. */
    reject(id) {
      ensureLoaded();
      const client = clients.get(id);
      if (!client) return null;
      client.status = 'rejected';
      client.active = false;
      persist();
      return client;
    },

    get(id) {
      ensureLoaded();
      return clients.get(id) || null;
    },

    getByEmail(email) {
      ensureLoaded();
      return findByEmail(email);
    },

    /** Safe list for the owner console (no password hashes). */
    list() {
      ensureLoaded();
      return [...clients.values()].map(publicClient);
    },

    /**
     * Owner update: companyName, contactName, active. Email/password changes
     * go through dedicated methods below.
     */
    update(id, patch = {}) {
      ensureLoaded();
      const client = clients.get(id);
      if (!client) return null;
      if (patch.companyName !== undefined) {
        const name = String(patch.companyName).trim();
        if (!name) throw new Error('companyName cannot be empty');
        client.companyName = name;
      }
      if (patch.contactName !== undefined) client.contactName = String(patch.contactName).trim();
      if (patch.phone !== undefined) client.phone = String(patch.phone).trim();
      if (patch.serviceInterest !== undefined) {
        client.serviceInterest = patch.serviceInterest ? assertServiceInterest(patch.serviceInterest) : '';
      }
      if (patch.active !== undefined) client.active = patch.active !== false;
      persist();
      return client;
    },

    /** Owner password reset. */
    setPassword(id, password) {
      ensureLoaded();
      const client = clients.get(id);
      if (!client) return null;
      client.passwordHash = hashPassword(password);
      persist();
      return client;
    },

    _size() {
      ensureLoaded();
      return clients.size;
    },
  };
}
