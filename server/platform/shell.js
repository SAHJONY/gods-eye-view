/**
 * SAHJONY Trade & Energy Platform — shell plugin (Phase 1).
 *
 * Vite plugin (dev + preview; production runs `vite dev`) that serves:
 * - GET /platform (exact path) → the unified owner shell page
 *   (public/owner/index.html) with the module registry injected as
 *   window.__PLATFORM_MODULES. Everything else under /platform/* falls
 *   through to static files.
 *   (Path is /platform — /owner* is owned by legacy prune redirects.)
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

/** Owner shell page: GET /platform (exact path only). No auth required. */
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
  // Module directory index: bare `/import-export/<mod>/` must serve the
  // module's public/index.html. Vite dev serves the explicit file path but
  // the bare directory falls through to the SPA fallback (wrong app), so
  // resolve it here. Map built from the registry; only single-segment dirs.
  const moduleIndex = new Map();
  for (const m of listModules()) {
    const p = String(m.path || '');
    if (!p.startsWith('/import-export/') || !p.endsWith('/')) continue;
    const dir = p.slice('/import-export/'.length, -1);
    if (!dir || dir.includes('/')) continue;
    const file = path.join(defaultSourceRoot, 'public', dir, 'index.html');
    try {
      if (fs.statSync(file).isFile()) {
        moduleIndex.set(p, file);
        moduleIndex.set(p.slice(0, -1), file);
      }
    } catch {
      // No static page for this module — leave it to the SPA / next handler.
    }
  }
  const install = (middlewares) => {
    middlewares.use('/api/platform/modules', platformModulesMiddleware());
    middlewares.use('/import-export', (req, res, next) => {
      const full = String(req.originalUrl || req.url || '').split('?')[0];
      const file = moduleIndex.get(full);
      if (!file) return next();
      fs.readFile(file, 'utf8', (err, html) => {
        if (err) return next();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(html);
      });
    });
    // Exact /platform (and /platform/) serves the shell. Registered so that
    // /platform/index.html and any future /platform/* assets fall through to static.
    middlewares.use('/platform', (req, res, next) => {
      const full = String(req.originalUrl || req.url || '').split('?')[0];
      if (full !== '/platform' && full !== '/platform/') return next();
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
