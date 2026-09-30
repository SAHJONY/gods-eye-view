/**
 * SAHJONY Trade & Energy Platform — shell plugin (Phase 1).
 *
 * Vite plugin (dev + preview; production runs `vite dev`) that serves:
 * - GET /owner (exact path) → the unified owner shell page
 *   (public/owner/index.html) with the module registry injected as
 *   window.__PLATFORM_MODULES. Everything else under /owner/* falls through
 *   to static files.
 * - GET /api/platform/modules → the registry as JSON (single source of
 *   truth for future consumers: voice, other shells, phase 2 modules).
 *
 * No auth at the HTTP layer — same posture as /import-export/ and the portal
 * pages. Owner-only ACTIONS still require their own keys (e.g. the portal
 * admin API needs PORTAL_OWNER_KEY). The shell itself exposes no data; it
 * only frames pages that already exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { listModules } from './registry.js';
import { defaultSourceRoot } from '../providers/common/source-root.js';

export function platformModulesPayload() {
  return { modules: listModules() };
}

/** Owner shell page: GET /owner (exact path only). No auth required. */
export function ownerShellHtml(sourceRoot = defaultSourceRoot) {
  const file = path.join(sourceRoot, 'public', 'owner', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  // Escape `<` so a hostile registry string can never break out of the script.
  const json = JSON.stringify(platformModulesPayload().modules).replace(/</g, '\\u003c');
  const inject = `<script>window.__PLATFORM_MODULES=${json};</script>`;
  return html.replace('</head>', `${inject}</head>`);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

/** Connect-style middleware for GET /api/platform/modules. */
export function platformModulesMiddleware() {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    try {
      sendJson(res, 200, platformModulesPayload());
    } catch (error) {
      if (typeof next === 'function') next(error);
      else sendJson(res, 500, { error: 'registry unavailable' });
    }
  };
}

/** Connect-style middleware serving the shell HTML on GET (no auth). */
export function ownerPageMiddleware(sourceRoot = defaultSourceRoot) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    try {
      const html = ownerShellHtml(sourceRoot);
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

/** Vite plugin registering the platform shell in dev and preview. */
export function platformShellPlugin() {
  const install = (middlewares) => {
    middlewares.use('/api/platform/modules', platformModulesMiddleware());
    // Exact /owner (and /owner/) serves the shell. Registered so that
    // /owner/index.html and any future /owner/* assets fall through to static.
    middlewares.use('/owner', (req, res, next) => {
      const full = String(req.originalUrl || req.url || '').split('?')[0];
      if (full !== '/owner' && full !== '/owner/') return next();
      return ownerPageMiddleware()(req, res, next);
    });
  };
  return {
    name: 'sahjony-platform-shell',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
