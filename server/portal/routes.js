/**
 * SAHJONY Client Portal — HTTP API.
 *
 * Mounted at /api/portal (see portalApiPlugin(), registered in
 * server/providers/local.js). Plain Node http handlers — no framework.
 *
 * Security model:
 * - Every non-admin endpoint requires a session cookie; the session's
 *   clientId scopes EVERY read. A client can never address another client's
 *   data: cross-client ids answer 404 (existence is not leaked).
 * - /api/portal/admin/* requires the PORTAL_OWNER_KEY bearer token
 *   (fail-closed when unset). The app has no other owner-auth mechanism;
 *   this one is documented in server/portal/README.md.
 * - /shipments/:id/vessel returns the AIS position of THAT vessel only —
 *   it reuses the server-side AIS cache and never dumps the raw feed.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  PORTAL_SESSION_COOKIE,
  clearSessionCookie,
  createLoginRateLimiter,
  createSessionStore,
  isOwnerAuthorized,
  parseCookies,
  rateLimitKey,
  setSessionCookie,
  verifyPassword,
} from './auth.js';
import { createClientStore, publicClient, demoPublicClient, isClientActive, SERVICE_INTEREST_OPTIONS } from './clients.js';
import { createShipmentStore, DEMO_CLIENT_ID } from './shipments.js';
import { createQuoteStore, QUOTE_STATUSES } from './quotes.js';
import { createBuyerRequestStore, BUYER_REQUEST_STATUSES } from './buyer-requests.js';
import { createShipmentWatcher } from './watcher.js';
import { aisStreamRows, readAisTrack } from '../providers/vessels/ais-store.js';
import { defaultSourceRoot } from '../providers/common/source-root.js';

const JSON_BODY_MAX_BYTES = 64 * 1024;

/** Default vessel lookup: single-vessel slice of the server-side AIS cache. */
export function defaultVesselLookup(mmsi) {
  const wanted = String(mmsi || '').trim();
  let row = null;
  try {
    const rows = aisStreamRows(50_000);
    row = rows.find((entry) => String(entry?.mmsi) === wanted) || null;
  } catch {
    row = null;
  }
  let track = [];
  try {
    track = readAisTrack(wanted) || [];
  } catch {
    track = [];
  }
  return { mmsi: wanted, vessel: row, track };
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Atomic JSON write (tmp + rename) so a crash never leaves a half file. */
function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > JSON_BODY_MAX_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '');
  return forwarded.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

/**
 * Product ids from the supplier-directory catalog (public/suppliers/data.json).
 * Used to validate buyer-intake submissions. Loaded once; failures leave the
 * set empty (fail-open on validation only — ids are still format-checked).
 */
function loadCatalogProductIds() {
  const ids = new Set();
  try {
    const file = path.join(defaultSourceRoot, 'public', 'suppliers', 'data.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(raw?.products) ? raw.products : [];
    for (const p of list) {
      if (p?.id) ids.add(String(p.id));
    }
  } catch {
    // keep empty
  }
  return ids;
}

/**
 * Build the portal API.
 * @param {{dataDir?:string, vesselLookup?:function, resolveOwnerKey?:function}} [opts]
 */
export function createPortalApi(opts = {}) {
  const dataDir =
    opts.dataDir || path.join(defaultSourceRoot, 'server', 'portal', 'data');
  const vesselLookup = opts.vesselLookup || defaultVesselLookup;
  const resolveOwnerKey =
    opts.resolveOwnerKey || (() => process.env.PORTAL_OWNER_KEY);

  const fileFor = (name) => path.join(dataDir, name);
  const sessionStore = createSessionStore({
    load: () => readJsonFile(fileFor('sessions.json')),
    save: (value) => writeJsonFile(fileFor('sessions.json'), value),
  });
  const clientStore = createClientStore({
    load: () => readJsonFile(fileFor('clients.json')),
    save: (value) => writeJsonFile(fileFor('clients.json'), value),
  });
  const shipmentStore = createShipmentStore({
    load: () => readJsonFile(fileFor('shipments.json')),
    save: (value) => writeJsonFile(fileFor('shipments.json'), value),
  });
  const quoteStore = createQuoteStore({
    load: () => readJsonFile(fileFor('quotes.json')),
    save: (value) => writeJsonFile(fileFor('quotes.json'), value),
  });
  // Buyer intake (public sourcing requests, v1 manual quoting). Product ids
  // are validated against the supplier-directory catalog.
  const buyerRequestStore = createBuyerRequestStore({
    load: () => readJsonFile(fileFor('buyer-requests.json')),
    save: (value) => writeJsonFile(fileFor('buyer-requests.json'), value),
    validProductIds: loadCatalogProductIds(),
  });
  const buyerRequestLimiter = createLoginRateLimiter({ max: 5, windowMs: 10 * 60 * 1000 });
  const rateLimiter = createLoginRateLimiter();
  const watcher = createShipmentWatcher({ shipmentStore, vesselLookup });

  /** Session → active client, or null. Deactivated clients lose access. */
  function sessionClient(req) {
    const cookies = parseCookies(req.headers?.cookie);
    const token = cookies[PORTAL_SESSION_COOKIE];
    const session = sessionStore.get(token);
    if (!session) return null;
    // The demo account is synthetic (no stored client record).
    if (session.clientId === DEMO_CLIENT_ID) {
      return { session, client: demoPublicClient() };
    }
    const client = clientStore.get(session.clientId);
    if (!isClientActive(client)) {
      sessionStore.destroy(token);
      return null;
    }
    return { session, client };
  }

  async function handleLogin(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const key = rateLimitKey(clientIp(req), email);
    if (!rateLimiter.attempt(key)) {
      res.setHeader('Retry-After', '600');
      return json(res, 429, {
        error: 'too_many_attempts',
        message: 'Demasiados intentos. Espere 10 minutos.',
      });
    }
    const client = clientStore.getByEmail(email);
    if (!client || !verifyPassword(password, client.passwordHash)) {
      // Identical answer for unknown email / wrong password: never leak
      // which emails exist.
      return json(res, 401, { error: 'invalid_credentials', message: 'Credenciales inválidas.' });
    }
    if (client.status === 'pending') {
      return json(res, 401, {
        error: 'pending_approval',
        message: 'Su cuenta está pendiente de aprobación. Le avisaremos cuando esté activa.',
      });
    }
    if (!isClientActive(client)) {
      // Rejected or deactivated: same generic answer as bad credentials.
      return json(res, 401, { error: 'invalid_credentials', message: 'Credenciales inválidas.' });
    }
    rateLimiter.reset(key);
    const session = sessionStore.create(client.id);
    setSessionCookie(res, session.token, req);
    return json(res, 200, { ok: true, client: publicClient(client) });
  }

  function handleLogout(req, res) {
    const cookies = parseCookies(req.headers?.cookie);
    if (cookies[PORTAL_SESSION_COOKIE]) {
      sessionStore.destroy(cookies[PORTAL_SESSION_COOKIE]);
    }
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  /**
   * Self-healing demo vessel: the demo must always show a REAL, MOVING ship.
   * If the demo shipment's vessel currently has no AIS signal or is
   * stationary (e.g. a parked canal boat drifting in/out of satellite
   * coverage), repoint the demo at a live underway cargo vessel so prospects
   * always see live tracking. Demo-only, persisted.
   */
  function repointDemoAtLiveVessel() {
    const demo = shipmentStore.getDemo();
    if (!demo) return;
    let curVessel = null;
    try {
      curVessel = (defaultVesselLookup(demo.vesselMmsi) || {}).vessel || null;
    } catch {
      curVessel = null;
    }
    const curSpeed = Number(curVessel?.speed);
    if (curVessel && Number.isFinite(curSpeed) && curSpeed >= 2) return; // live and moving — keep it
    let pick = null;
    try {
      const now = Date.now() / 1000;
      const rows = aisStreamRows(50_000);
      pick =
        rows.find((v) => {
          const t = Number(v?.type);
          const sp = Number(v?.speed);
          const la = Number(v?.lat);
          const lo = Number(v?.lon);
          const age = now - Number(v?.last_position_epoch || 0);
          return (
            t >= 70 &&
            t <= 79 &&
            sp >= 2 &&
            la > 0 &&
            la < 50 &&
            lo > -100 &&
            lo < -20 &&
            age < 1800 &&
            String(v?.name || '').trim().length > 2
          );
        }) || null;
    } catch {
      pick = null;
    }
    if (!pick) return;
    try {
      shipmentStore.updateDemo({
        vesselMmsi: String(pick.mmsi),
        vesselName: String(pick.name).trim(),
      });
    } catch {
      // keep the old vessel rather than break the demo login
    }
  }

  /**
   * Prospect demo login: no password, rate-limited, view-only. Seeds the
   * single demo shipment (flagged demo:true, permanently en tránsito)
   * on first use.
   */
  function handleDemo(req, res) {
    const key = rateLimitKey(clientIp(req), 'demo');
    if (!rateLimiter.attempt(key)) {
      res.setHeader('Retry-After', '600');
      return json(res, 429, {
        error: 'too_many_attempts',
        message: 'Demasiados intentos. Espere 10 minutos.',
      });
    }
    const demoShipment = shipmentStore.ensureDemoShipment();
    repointDemoAtLiveVessel();
    const session = sessionStore.create(DEMO_CLIENT_ID);
    setSessionCookie(res, session.token, req);
    return json(res, 200, {
      ok: true,
      demo: true,
      client: demoPublicClient(),
      shipmentId: demoShipment.id,
    });
  }

  /**
   * Public self-registration: creates a `pending` account. Rate-limited per
   * IP; every field validated server-side. A pending account CANNOT log in
   * or see any data until the owner approves it — no session is created.
   */
  async function handleRegister(req, res) {
    const key = rateLimitKey(clientIp(req), 'register');
    if (!rateLimiter.attempt(key)) {
      res.setHeader('Retry-After', '600');
      return json(res, 429, {
        error: 'too_many_attempts',
        message: 'Demasiados intentos. Espere 10 minutos.',
      });
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    const companyName = String(body.companyName || '').trim();
    const contactName = String(body.contactName || '').trim();
    const email = String(body.email || '').trim();
    const phone = String(body.phone || '').trim();
    const password = String(body.password || '');
    const serviceInterest = String(body.serviceInterest || '').trim();
    if (!companyName) {
      return json(res, 400, { error: 'companyName_required', message: 'Indique el nombre de su empresa.' });
    }
    if (!contactName) {
      return json(res, 400, { error: 'contactName_required', message: 'Indique su nombre de contacto.' });
    }
    if (!email || !email.includes('@')) {
      return json(res, 400, { error: 'email_invalid', message: 'Indique un correo electrónico válido.' });
    }
    if (!phone || phone.replace(/\D/g, '').length < 7) {
      return json(res, 400, { error: 'phone_invalid', message: 'Indique un teléfono válido.' });
    }
    if (password.length < 8) {
      return json(res, 400, { error: 'password_too_short', message: 'La contraseña debe tener al menos 8 caracteres.' });
    }
    if (!SERVICE_INTEREST_OPTIONS.includes(serviceInterest)) {
      return json(res, 400, {
        error: 'serviceInterest_invalid',
        message: 'Indique qué servicio le interesa: ' + SERVICE_INTEREST_OPTIONS.join(', ') + '.',
      });
    }
    try {
      const client = clientStore.register({ companyName, contactName, email, phone, serviceInterest, password });
      return json(res, 201, {
        ok: true,
        pending: true,
        client: publicClient(client),
        message: 'Registro recibido. Le avisaremos cuando su acceso esté activo.',
      });
    } catch (error) {
      if (String(error.message).includes('already registered')) {
        return json(res, 409, {
          error: 'email_taken',
          message: 'Este correo ya está registrado.',
        });
      }
      return json(res, 400, { error: error.message });
    }
  }

  /**
   * Quote request from the "Cotizar" tab: lands as a `pending` quote for the
   * owner to triage. The prospect demo is view-only (403); every field is
   * validated server-side, including the container-size selector when the
   * full-container tier is chosen.
   */
  async function handleQuoteCreate(req, res, sc) {
    if (sc.client.demo === true) {
      return json(res, 403, {
        error: 'demo_readonly',
        message: 'La demostración es de solo lectura. Regístrese para solicitar cotizaciones.',
      });
    }
    const key = rateLimitKey(clientIp(req), 'quote:' + sc.client.id);
    if (!rateLimiter.attempt(key)) {
      res.setHeader('Retry-After', '600');
      return json(res, 429, {
        error: 'too_many_attempts',
        message: 'Demasiadas solicitudes. Espere 10 minutos.',
      });
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    try {
      const quote = quoteStore.create({
        clientId: sc.client.id,
        companyName: sc.client.companyName,
        serviceTier: body.serviceTier,
        containerSize: body.containerSize,
        cargoDescription: body.cargoDescription,
        origin: body.origin,
        destination: body.destination,
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        contactEmail: body.contactEmail,
      });
      return json(res, 201, {
        ok: true,
        quote,
        message: 'Cotización recibida. Le contactaremos pronto.',
      });
    } catch (error) {
      return json(res, 400, { error: 'validation', message: error.message });
    }
  }

  /**
   * Cuenta tab: change password. Verifies the current password, enforces the
   * 8-char minimum, then rotates the session (all sessions revoked, a fresh
   * one issued for this browser).
   */
  async function handlePasswordChange(req, res, sc) {
    if (sc.client.demo === true) {
      return json(res, 403, {
        error: 'demo_readonly',
        message: 'La demostración es de solo lectura.',
      });
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!verifyPassword(currentPassword, sc.client.passwordHash)) {
      return json(res, 401, {
        error: 'wrong_password',
        message: 'La contraseña actual no es correcta.',
      });
    }
    if (newPassword.length < 8) {
      return json(res, 400, {
        error: 'password_too_short',
        message: 'La nueva contraseña debe tener al menos 8 caracteres.',
      });
    }
    try {
      clientStore.setPassword(sc.client.id, newPassword);
    } catch (error) {
      return json(res, 400, { error: 'validation', message: error.message });
    }
    sessionStore.destroyForClient(sc.client.id);
    const session = sessionStore.create(sc.client.id);
    setSessionCookie(res, session.token, req);
    return json(res, 200, { ok: true, message: 'Contraseña actualizada.' });
  }

  async function handler(req, res, next) {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      let pathname = url.pathname || '/';
      // connect strips the mount prefix; tolerate both forms.
      if (pathname.startsWith('/api/portal')) pathname = pathname.slice('/api/portal'.length) || '/';

      const authed = () => {
        const sc = sessionClient(req);
        if (!sc) {
          json(res, 401, { error: 'unauthorized', message: 'Inicie sesión.' });
          return null;
        }
        return sc;
      };
      const owner = () => {
        if (!isOwnerAuthorized(req, resolveOwnerKey())) {
          json(res, 401, { error: 'owner_unauthorized' });
          return false;
        }
        return true;
      };

      // ---- public auth -------------------------------------------------
      if (pathname === '/login' && req.method === 'POST') return handleLogin(req, res);
      if (pathname === '/logout' && req.method === 'POST') return handleLogout(req, res);
      if (pathname === '/demo' && req.method === 'POST') return handleDemo(req, res);
      if (pathname === '/register' && req.method === 'POST') return handleRegister(req, res);

      // ---- buyer intake (public sourcing requests, v1 manual quoting) ----
      // No session: prospective buyers submit before they have an account.
      // Rate-limited per IP; the owner triages from /admin/buyer-requests.
      if (pathname === '/buyer-requests' && req.method === 'POST') {
        if (!buyerRequestLimiter.attempt(clientIp(req))) {
          return json(res, 429, {
            error: 'rate_limited',
            message: 'Demasiados intentos. Espera unos minutos.',
          });
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
        try {
          const created = buyerRequestStore.create(body || {});
          return json(res, 201, { ok: true, id: created.id });
        } catch (error) {
          return json(res, 400, { error: 'invalid_request', message: error.message });
        }
      }

      // ---- client session ----------------------------------------------
      if (pathname === '/me' && req.method === 'GET') {
        const sc = authed();
        if (!sc) return undefined;
        return json(res, 200, { client: publicClient(sc.client) });
      }
      if (pathname === '/shipments' && req.method === 'GET') {
        const sc = authed();
        if (!sc) return undefined;
        return json(res, 200, { shipments: shipmentStore.listForClient(sc.client.id) });
      }

      const shipmentMatch = /^\/shipments\/([^/]+)(\/vessel)?$/.exec(pathname);
      if (shipmentMatch && req.method === 'GET') {
        const sc = authed();
        if (!sc) return undefined;
        const shipment = shipmentStore.getForClient(shipmentMatch[1], sc.client.id);
        if (!shipment) return json(res, 404, { error: 'not_found' });
        if (shipmentMatch[2] === '/vessel') {
          const lookup = vesselLookup(shipment.vesselMmsi) || {};
          const coordOrNull = (lat, lon, name) =>
            Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
              ? { lat: Number(lat), lon: Number(lon), name }
              : null;
          return json(res, 200, {
            shipment: {
              id: shipment.id,
              vesselMmsi: shipment.vesselMmsi,
              vesselName: shipment.vesselName,
              origin: shipment.origin,
              destination: shipment.destination,
              cargoLabel: shipment.cargoLabel,
              status: shipment.status,
              eta: shipment.eta,
              containerNumber: shipment.containerNumber,
              serviceTier: shipment.serviceTier,
            },
            // Port coordinates are public geographic facts, not proprietary
            // data — the client already knows their ports by name.
            route: {
              origin: coordOrNull(shipment.originLat, shipment.originLon, shipment.origin),
              destination: coordOrNull(shipment.destLat, shipment.destLon, shipment.destination),
            },
            vessel: lookup.vessel || null,
            track: Array.isArray(lookup.track) ? lookup.track : [],
          });
        }
        return json(res, 200, { shipment });
      }

      // ---- quote requests (Cotizar tab) ----------------------------------
      if (pathname === '/quotes' && req.method === 'GET') {
        const sc = authed();
        if (!sc) return undefined;
        return json(res, 200, { quotes: quoteStore.listForClient(sc.client.id) });
      }
      if (pathname === '/quotes' && req.method === 'POST') {
        const sc = authed();
        if (!sc) return undefined;
        return handleQuoteCreate(req, res, sc);
      }

      // ---- account (Cuenta tab) ------------------------------------------
      if (pathname === '/account/password' && req.method === 'POST') {
        const sc = authed();
        if (!sc) return undefined;
        return handlePasswordChange(req, res, sc);
      }

      // ---- owner admin ---------------------------------------------------
      if (pathname.startsWith('/admin/')) {
        if (!owner()) return undefined;
        const adminPath = pathname.slice('/admin'.length);

        // Provider keys (e.g. SHIPSGO_TOKEN for the client container tracker).
        // Owner-gated; the key is written to a root-only env file (0600),
        // applied to this process live, and never echoed back.
        if (adminPath === '/provider-keys' && req.method === 'GET') {
          return json(res, 200, {
            keys: { SHIPSGO_TOKEN: String(process.env.SHIPSGO_TOKEN || '').trim() !== '' },
          });
        }
        if (adminPath === '/provider-keys' && req.method === 'POST') {
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
          const token = String(body?.SHIPSGO_TOKEN ?? '');
          if (
            token.length < 1 || token.length > 300 ||
            /[\s#'"`\\]/.test(token) || /[\x00-\x1f\x7f]/.test(token)
          ) {
            return json(res, 400, { error: 'invalid_token' });
          }
          const file = process.env.GEV_PROVIDER_KEYS_FILE || '/etc/gods-eye-view/provider-keys.env';
          try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `SHIPSGO_TOKEN=${token}\n`, { mode: 0o600 });
          } catch (error) {
            return json(res, 500, { error: 'write_failed' });
          }
          process.env.SHIPSGO_TOKEN = token;
          return json(res, 200, { ok: true, keys: { SHIPSGO_TOKEN: true } });
        }
        if (adminPath === '/clients' && req.method === 'GET') {
          return json(res, 200, { clients: clientStore.list() });
        }
        if (adminPath === '/clients' && req.method === 'POST') {
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
          try {
            const client = clientStore.create(body);
            return json(res, 201, { client: publicClient(client) });
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
        }
        const clientIdMatch = /^\/clients\/([^/]+)$/.exec(adminPath);
        if (clientIdMatch && req.method === 'PATCH') {
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
          try {
            const client = clientStore.update(clientIdMatch[1], body);
            if (!client) return json(res, 404, { error: 'not_found' });
            if (body.active === false) sessionStore.destroyForClient(clientIdMatch[1]);
            return json(res, 200, { client: publicClient(client) });
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
        }
        // Registration approval workflow: pending → active / rejected.
        const approveMatch = /^\/clients\/([^/]+)\/approve$/.exec(adminPath);
        if (approveMatch && req.method === 'POST') {
          const client = clientStore.approve(approveMatch[1]);
          if (!client) return json(res, 404, { error: 'not_found' });
          return json(res, 200, { client: publicClient(client) });
        }
        const rejectMatch = /^\/clients\/([^/]+)\/reject$/.exec(adminPath);
        if (rejectMatch && req.method === 'POST') {
          const client = clientStore.reject(rejectMatch[1]);
          if (!client) return json(res, 404, { error: 'not_found' });
          sessionStore.destroyForClient(rejectMatch[1]);
          return json(res, 200, { client: publicClient(client) });
        }
        const pwMatch = /^\/clients\/([^/]+)\/password$/.exec(adminPath);
        if (pwMatch && req.method === 'POST') {
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
          try {
            const client = clientStore.setPassword(pwMatch[1], String(body.password || ''));
            if (!client) return json(res, 404, { error: 'not_found' });
            sessionStore.destroyForClient(pwMatch[1]);
            return json(res, 200, { ok: true });
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
        }

        if (adminPath === '/shipments' && req.method === 'GET') {
          return json(res, 200, { shipments: shipmentStore.listAll() });
        }
        if (adminPath === '/shipments' && req.method === 'POST') {
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
          try {
            if (body.clientId && !clientStore.get(body.clientId)) {
              return json(res, 400, { error: 'unknown clientId' });
            }
            const shipment = shipmentStore.create(body);
            return json(res, 201, { shipment });
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
        }
        const shipmentIdMatch = /^\/shipments\/([^/]+)$/.exec(adminPath);
        if (shipmentIdMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
          if (req.method === 'DELETE') {
            const ok = shipmentStore.delete(shipmentIdMatch[1]);
            if (!ok) return json(res, 404, { error: 'not_found' });
            return json(res, 200, { ok: true });
          }
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
          try {
            const shipment = shipmentStore.update(shipmentIdMatch[1], body);
            if (!shipment) return json(res, 404, { error: 'not_found' });
            return json(res, 200, { shipment });
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
        }

        // Quote requests: owner triage. Pending first.
        if (adminPath === '/quotes' && req.method === 'GET') {
          return json(res, 200, { quotes: quoteStore.listAll() });
        }
        const quoteIdMatch = /^\/quotes\/([^/]+)$/.exec(adminPath);
        if (quoteIdMatch && req.method === 'PATCH') {
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
          try {
            if (!QUOTE_STATUSES.includes(String(body.status))) {
              return json(res, 400, {
                error: 'invalid_status',
                message: 'status must be one of: ' + QUOTE_STATUSES.join(', '),
              });
            }
            const quote = quoteStore.updateStatus(quoteIdMatch[1], body.status);
            if (!quote) return json(res, 404, { error: 'not_found' });
            return json(res, 200, { quote });
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
        }

        // Buyer intake requests: owner triage. Newest first.
        if (adminPath === '/buyer-requests' && req.method === 'GET') {
          return json(res, 200, { requests: buyerRequestStore.listAll() });
        }
        const buyerReqMatch = /^\/buyer-requests\/([^/]+)$/.exec(adminPath);
        if (buyerReqMatch && req.method === 'PATCH') {
          let body;
          try {
            body = await readJsonBody(req);
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
          try {
            if (!BUYER_REQUEST_STATUSES.includes(String(body.status))) {
              return json(res, 400, {
                error: 'invalid_status',
                message: 'status must be one of: ' + BUYER_REQUEST_STATUSES.join(', '),
              });
            }
            const updated = buyerRequestStore.updateStatus(buyerReqMatch[1], body.status);
            if (!updated) return json(res, 404, { error: 'not_found' });
            return json(res, 200, { request: updated });
          } catch (error) {
            return json(res, 400, { error: error.message });
          }
        }

        // AIS watcher ops: manual tick (fallback probe) and status.
        if (adminPath === '/watcher/tick' && req.method === 'POST') {
          const transitions = watcher.tick().filter(Boolean);
          return json(res, 200, { transitions, status: watcher.status() });
        }
        if (adminPath === '/watcher/status' && req.method === 'GET') {
          return json(res, 200, watcher.status());
        }
        return json(res, 404, { error: 'not_found' });
      }

      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[portal] request failed', error?.message || error);
      if (!res.headersSent) json(res, 500, { error: 'internal_error' });
      else if (typeof next === 'function') next(error);
    }
    return undefined;
  }

  return {
    handler,
    watcher,
    stores: { sessionStore, clientStore, shipmentStore, quoteStore },
    dataDir,
  };
}

/** Read a portal page from public/portal, optionally injecting a script. */
function portalPageFile(sourceRoot, fileName, inject) {
  const file = path.join(sourceRoot, 'public', 'portal', fileName);
  const html = fs.readFileSync(file, 'utf8');
  return inject ? html.replace('</head>', `<script>${inject}</script></head>`) : html;
}

/**
 * Shareable prospect-demo page: GET /portal/demo.
 *
 * Serves the client panel with window.__PORTAL_AUTODEMO injected, so the
 * page starts a rate-limited demo session itself — no login screen, no
 * credentials. All data still flows through the session-scoped demo API,
 * so the page alone can never expose real shipments.
 */
export function demoPageHtml(sourceRoot = defaultSourceRoot) {
  return portalPageFile(sourceRoot, 'panel.html', 'window.__PORTAL_AUTODEMO=true;');
}

/** Public self-registration page: GET /portal/registro. No auth required. */
export function registerPageHtml(sourceRoot = defaultSourceRoot) {
  return portalPageFile(sourceRoot, 'registro.html', '');
}

/**
 * Client panel: GET /portal/panel.html. No autodemo injection — the page
 * runs in real mode and requires a login session. Registered explicitly
 * because the Vite SPA fallback (base /import-export/) otherwise swallows
 * this path with a base-URL error page instead of letting it fall through
 * to static.
 */
export function panelPageHtml(sourceRoot = defaultSourceRoot) {
  return portalPageFile(sourceRoot, 'panel.html', '');
}

/** Client login page: GET /portal (exact path only). No auth required. */
export function loginPageHtml(sourceRoot = defaultSourceRoot) {
  return portalPageFile(sourceRoot, 'index.html', '');
}

/**
 * Client container tracker: GET /portal/rastrear(.html). No auth required.
 * Dead-simple page: paste container/BL/booking numbers, see the ship, its
 * live position on a map, status and ETA — plus a 3D deep link.
 */
export function trackPageHtml(sourceRoot = defaultSourceRoot) {
  return portalPageFile(sourceRoot, 'rastrear.html', '');
}

/**
 * Cuba fleet 24/7 tracker: GET /portal/cuba-fleet. No auth required.
 * Internal SAHJONY ops page listing the US–Cuba trade vessels with live
 * AIS positions (auto-refresh), last-known fallback, and per-vessel 3D
 * deep links into the client-mode globe view.
 */
export function fleetPageHtml(sourceRoot = defaultSourceRoot) {
  return portalPageFile(sourceRoot, 'cuba-fleet.html', '');
}

/** Connect-style middleware serving one portal page on GET (no auth). */
export function portalPageMiddleware(pageFn, sourceRoot = defaultSourceRoot) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    try {
      const html = pageFn(sourceRoot);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(html);
    } catch (error) {
      if (typeof next === 'function') next(error);
      else {
        res.statusCode = 500;
        res.end('page unavailable');
      }
    }
  };
}

/**
 * Vite plugin registering the portal API in dev and preview.
 * Lazy: stores and middleware are built on first configure call.
 * The AIS watcher starts with the dev server and stops when it closes
 * (same lifecycle pattern as the AIS live proxy).
 */
export function portalApiPlugin() {
  let api = null;
  const ensure = () => {
    if (!api) api = createPortalApi();
    return api;
  };
  const install = (middlewares) => {
    middlewares.use('/portal/demo', portalPageMiddleware(demoPageHtml));
    middlewares.use('/portal/registro', portalPageMiddleware(registerPageHtml));
    middlewares.use('/portal/panel.html', portalPageMiddleware(panelPageHtml));
    middlewares.use('/portal/cuba-fleet', portalPageMiddleware(fleetPageHtml));
    middlewares.use('/portal/rastrear', portalPageMiddleware(trackPageHtml));
    middlewares.use('/portal/rastrear.html', portalPageMiddleware(trackPageHtml));
    // Exact /portal (and /portal/) serves the client login page. Registered
    // after the specific routes above; the exact-path guard lets everything
    // else (/portal/vendor/*, …) fall through to static.
    middlewares.use('/portal', (req, res, next) => {
      const full = String(req.originalUrl || req.url || '').split('?')[0];
      if (full !== '/portal' && full !== '/portal/') return next();
      return portalPageMiddleware(loginPageHtml)(req, res, next);
    });
    middlewares.use('/api/portal', (req, res, next) => {
      ensure().handler(req, res, next);
    });
  };
  const startWatcher = (server) => {
    ensure().watcher.start();
    // Vite restarts the server in-process on config changes; stop the
    // interval so restarts cannot stack timers.
    server.httpServer?.on('close', () => ensure().watcher.stop());
  };
  return {
    name: 'sahjony-portal-api',
    configureServer(server) {
      install(server.middlewares);
      startWatcher(server);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
      startWatcher(server);
    },
    closeBundle() {
      api?.watcher.stop();
    },
  };
}
