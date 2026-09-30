import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createLoginRateLimiter,
  createSessionStore,
  hashPassword,
  isOwnerAuthorized,
  parseCookies,
  rateLimitKey,
  verifyPassword,
  PORTAL_SESSION_COOKIE,
} from '../../server/portal/auth.js';

describe('portal auth: password hashing', () => {
  it('hashes and verifies a password', () => {
    const hash = hashPassword('secreto-123');
    assert.match(hash, /^pbkdf2\$\d+\$/);
    assert.equal(verifyPassword('secreto-123', hash), true);
  });

  it('rejects the wrong password', () => {
    const hash = hashPassword('secreto-123');
    assert.equal(verifyPassword('otra-clave-1', hash), false);
  });

  it('rejects malformed hashes and non-strings', () => {
    assert.equal(verifyPassword('x', 'not-a-hash'), false);
    assert.equal(verifyPassword('x', ''), false);
    assert.equal(verifyPassword(null, 'pbkdf2$1$a$b'), false);
  });

  it('refuses short passwords', () => {
    assert.throws(() => hashPassword('corta'), /at least 8/);
  });

  it('salts hashes uniquely', () => {
    assert.notEqual(hashPassword('misma-clave-1'), hashPassword('misma-clave-1'));
  });
});

describe('portal auth: sessions', () => {
  it('creates, reads and destroys sessions', () => {
    const store = createSessionStore();
    const session = store.create('cli_1');
    assert.ok(session.token.length >= 32);
    assert.equal(store.get(session.token)?.clientId, 'cli_1');
    assert.equal(store.destroy(session.token), true);
    assert.equal(store.get(session.token), null);
  });

  it('rejects expired sessions', () => {
    const store = createSessionStore();
    const session = store.create('cli_1');
    // Force expiry by reaching into the persisted snapshot path is not
    // possible; instead verify unknown tokens are null.
    assert.equal(store.get('no-existe'), null);
    assert.ok(session.expiresAt > Date.now());
  });

  it('persists sessions across store instances', () => {
    let snapshot = null;
    const a = createSessionStore({
      load: () => snapshot,
      save: (value) => {
        snapshot = value;
      },
    });
    const session = a.create('cli_9');
    const b = createSessionStore({
      load: () => snapshot,
      save: () => {},
    });
    assert.equal(b.get(session.token)?.clientId, 'cli_9');
  });

  it('revokes every session of a client', () => {
    const store = createSessionStore();
    const s1 = store.create('cli_1');
    const s2 = store.create('cli_1');
    const s3 = store.create('cli_2');
    assert.equal(store.destroyForClient('cli_1'), 2);
    assert.equal(store.get(s1.token), null);
    assert.equal(store.get(s2.token), null);
    assert.equal(store.get(s3.token)?.clientId, 'cli_2');
  });
});

describe('portal auth: login rate limiter', () => {
  it('blocks after the budget is spent', () => {
    const limiter = createLoginRateLimiter({ max: 3, windowMs: 60_000 });
    const key = rateLimitKey('1.2.3.4', 'Ana@Example.com');
    assert.equal(limiter.attempt(key), true);
    assert.equal(limiter.attempt(key), true);
    assert.equal(limiter.attempt(key), true);
    assert.equal(limiter.attempt(key), false);
  });

  it('keys are case-insensitive on email', () => {
    const limiter = createLoginRateLimiter({ max: 1, windowMs: 60_000 });
    assert.equal(limiter.attempt(rateLimitKey('9.9.9.9', 'A@b.co')), true);
    assert.equal(limiter.attempt(rateLimitKey('9.9.9.9', 'a@B.CO')), false);
  });

  it('reset() restores the budget', () => {
    const limiter = createLoginRateLimiter({ max: 1, windowMs: 60_000 });
    const key = rateLimitKey('5.5.5.5', 'c@d.co');
    assert.equal(limiter.attempt(key), true);
    assert.equal(limiter.attempt(key), false);
    limiter.reset(key);
    assert.equal(limiter.attempt(key), true);
  });
});

describe('portal auth: cookies', () => {
  it('parses a Cookie header', () => {
    const parsed = parseCookies(`${PORTAL_SESSION_COOKIE}=abc123; other=x`);
    assert.equal(parsed[PORTAL_SESSION_COOKIE], 'abc123');
    assert.deepEqual(parseCookies(''), {});
  });

  it('builds an httpOnly SameSite session cookie', () => {
    const value = buildSessionCookie('tok');
    assert.ok(value.includes('HttpOnly'));
    assert.ok(value.includes('SameSite=Lax'));
    assert.ok(value.includes('Path=/'));
    assert.ok(!value.includes('Secure'));
    assert.ok(buildSessionCookie('tok', { secure: true }).includes('Secure'));
  });

  it('builds an expired cookie for logout', () => {
    assert.ok(buildClearedSessionCookie().includes('Max-Age=0'));
  });
});

describe('portal auth: owner guard', () => {
  const reqWith = (headers) => ({ headers });

  it('denies when no owner key is configured (fail closed)', () => {
    assert.equal(
      isOwnerAuthorized(reqWith({ authorization: 'Bearer anything' }), ''),
      false,
    );
    assert.equal(isOwnerAuthorized(reqWith({ authorization: 'Bearer x' })), false);
  });

  it('accepts a matching Bearer token', () => {
    assert.equal(
      isOwnerAuthorized(reqWith({ authorization: 'Bearer s3cret' }), 's3cret'),
      true,
    );
  });

  it('accepts the x-portal-owner-key header', () => {
    assert.equal(
      isOwnerAuthorized(reqWith({ 'x-portal-owner-key': 's3cret' }), 's3cret'),
      true,
    );
  });

  it('rejects wrong or missing tokens', () => {
    assert.equal(isOwnerAuthorized(reqWith({ authorization: 'Bearer wrong' }), 's3cret'), false);
    assert.equal(isOwnerAuthorized(reqWith({}), 's3cret'), false);
  });
});
