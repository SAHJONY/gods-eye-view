/**
 * SAHJONY Client Portal — authentication primitives.
 *
 * - PBKDF2 password hashing (sha512, 600k iterations). No plaintext anywhere.
 * - Opaque session tokens in httpOnly + SameSite cookies. Public
 *   self-registration creates `pending` accounts; only owner-approved
 *   (`active`) accounts can log in.
 * - Login AND registration rate limiting (per IP sliding window).
 * - Owner guard for /api/portal/admin/* via the PORTAL_OWNER_KEY env var
 *   (Bearer token). The app has no other owner-auth mechanism to reuse; the
 *   key is set on the server only and never shipped to any client bundle.
 */
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

export const PORTAL_SESSION_COOKIE = 'portal_session';
/** Session lifetime: 7 days. */
export const PORTAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Login rate limit: 10 attempts per 10 minutes per (ip, email). */
export const LOGIN_RATE_LIMIT_MAX = 10;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';
const SALT_BYTES = 32;

/**
 * Hash a password. Returns `pbkdf2$<iterations>$<saltB64>$<hashB64>`.
 * @param {string} password
 */
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('password must be a string of at least 8 characters');
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Verify a password against a stored hash. Constant-time comparison.
 * @param {string} password
 * @param {string} stored
 */
export function verifyPassword(password, stored) {
  try {
    if (typeof password !== 'string' || typeof stored !== 'string') return false;
    const [scheme, iterationsRaw, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'pbkdf2') return false;
    const iterations = Number.parseInt(iterationsRaw, 10);
    if (!Number.isFinite(iterations) || iterations < 100_000) return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = pbkdf2Sync(password, salt, iterations, expected.length, PBKDF2_DIGEST);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Parse a Cookie header into an object. */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

function isSecureRequest(req) {
  if (req?.socket?.encrypted) return true;
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase();
  return forwarded.split(',')[0].trim() === 'https';
}

/**
 * Build a Set-Cookie value for the portal session.
 * @param {string} token
 * @param {{secure:boolean}} [opts]
 */
export function buildSessionCookie(token, { secure = false } = {}) {
  const parts = [
    `${PORTAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(PORTAL_SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Expired-session cookie (logout). */
export function buildClearedSessionCookie() {
  return `${PORTAL_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Attach the session cookie to a ServerResponse. */
export function setSessionCookie(res, token, req) {
  const existing = res.getHeader('Set-Cookie');
  const value = buildSessionCookie(token, { secure: isSecureRequest(req) });
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
  res.setHeader('Set-Cookie', [...list.filter(Boolean), value]);
}

/** Clear the session cookie on a ServerResponse. */
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', buildClearedSessionCookie());
}

/**
 * Persistent session store. Sessions are kept in memory and snapshotted to a
 * JSON file so logins survive server restarts. The file lives under
 * server/portal/data/ (gitignored) — never in the repo.
 */
export function createSessionStore({ load, save } = {}) {
  /** @type {Map<string,{token:string,clientId:string,createdAt:number,expiresAt:number}>} */
  const sessions = new Map();
  let loaded = false;

  function ensureLoaded() {
    if (loaded || !load) return;
    loaded = true;
    try {
      const raw = load();
      if (raw && typeof raw === 'object') {
        const now = Date.now();
        for (const entry of Object.values(raw)) {
          if (entry?.token && entry?.clientId && entry.expiresAt > now) {
            sessions.set(entry.token, entry);
          }
        }
      }
    } catch {
      // Corrupt snapshot: start empty rather than crash the server.
    }
  }

  function persist() {
    if (!save) return;
    try {
      save(Object.fromEntries(sessions));
    } catch {
      // Persistence is best-effort; the in-memory map stays authoritative.
    }
  }

  function prune() {
    const now = Date.now();
    let changed = false;
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) {
        sessions.delete(token);
        changed = true;
      }
    }
    if (changed) persist();
  }

  return {
    /** @param {string} clientId */
    create(clientId) {
      ensureLoaded();
      prune();
      const token = randomBytes(32).toString('hex');
      const now = Date.now();
      const session = {
        token,
        clientId,
        createdAt: now,
        expiresAt: now + PORTAL_SESSION_TTL_MS,
      };
      sessions.set(token, session);
      persist();
      return session;
    },
    /** @param {string} token */
    get(token) {
      ensureLoaded();
      if (!token) return null;
      const session = sessions.get(token) || null;
      if (!session) return null;
      if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        persist();
        return null;
      }
      return session;
    },
    /** @param {string} token */
    destroy(token) {
      ensureLoaded();
      const existed = sessions.delete(token);
      if (existed) persist();
      return existed;
    },
    /** @param {string} clientId revoke every session of one client */
    destroyForClient(clientId) {
      ensureLoaded();
      let count = 0;
      for (const [token, session] of sessions) {
        if (session.clientId === clientId) {
          sessions.delete(token);
          count += 1;
        }
      }
      if (count) persist();
      return count;
    },
    /** Test/maintenance hook. */
    _size() {
      ensureLoaded();
      return sessions.size;
    },
  };
}

/**
 * Sliding-window login rate limiter, keyed by (ip, normalized email).
 * In-memory; a restart clears the budget (fail-open for availability, the
 * password check itself stays the gate).
 */
export function createLoginRateLimiter({
  max = LOGIN_RATE_LIMIT_MAX,
  windowMs = LOGIN_RATE_LIMIT_WINDOW_MS,
} = {}) {
  /** @type {Map<string,number[]>} */
  const attempts = new Map();
  return {
    /**
     * Record an attempt. Returns true when the attempt is allowed, false when
     * the caller must answer 429.
     */
    attempt(key) {
      const now = Date.now();
      const history = (attempts.get(key) || []).filter((t) => now - t < windowMs);
      if (history.length >= max) {
        attempts.set(key, history);
        return false;
      }
      history.push(now);
      attempts.set(key, history);
      return true;
    },
    /** Forget the budget for a key (used after a successful login). */
    reset(key) {
      attempts.delete(key);
    },
    _count(key) {
      const now = Date.now();
      return (attempts.get(key) || []).filter((t) => now - t < windowMs).length;
    },
  };
}

/** Normalize the rate-limit key. */
export function rateLimitKey(ip, email) {
  return `${String(ip || 'unknown').slice(0, 64)}|${String(email || '').trim().toLowerCase().slice(0, 160)}`;
}

/**
 * Owner guard for /api/portal/admin/*. The owner presents
 * `Authorization: Bearer <PORTAL_OWNER_KEY>` (or the x-portal-owner-key header).
 * When PORTAL_OWNER_KEY is unset every admin call is denied — fail closed.
 * @param {import('node:http').IncomingMessage} req
 * @param {string} [ownerKey] defaults to process.env.PORTAL_OWNER_KEY
 */
export function isOwnerAuthorized(req, ownerKey = process.env.PORTAL_OWNER_KEY) {
  if (!ownerKey) return false;
  const header = String(req?.headers?.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const presented = match ? match[1].trim() : String(req?.headers?.['x-portal-owner-key'] || '').trim();
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(ownerKey);
  return a.length === b.length && timingSafeEqual(a, b);
}
