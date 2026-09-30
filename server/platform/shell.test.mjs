import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ownerShellHtml,
  platformModulesMiddleware,
  platformModulesPayload,
  ownerPageMiddleware,
} from './shell.js';

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = String(b ?? ''); },
  };
}

test('ownerShellHtml injects the registry as window.__PLATFORM_MODULES', () => {
  const html = ownerShellHtml();
  assert.match(html, /<title>SAHJONY/);
  const m = html.match(/window\.__PLATFORM_MODULES=(\[.*?\]);<\/script>/s);
  assert.ok(m, 'injected script present');
  const modules = JSON.parse(m[1]);
  assert.ok(Array.isArray(modules) && modules.length >= 6);
  const ids = modules.map((x) => x.id);
  assert.ok(ids.includes('import-export') && ids.includes('portal'));
});

test('injected JSON cannot break out of the script tag', () => {
  const html = ownerShellHtml();
  assert.ok(!html.includes('</script><script>window.__PLATFORM_MODULES'), 'no raw close tag inside payload');
});

test('platformModulesMiddleware serves the registry as JSON on GET', () => {
  const res = makeRes();
  let nexted = false;
  platformModulesMiddleware()({ method: 'GET' }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /application\/json/);
  const payload = JSON.parse(res.body);
  assert.ok(Array.isArray(payload.modules));
  assert.equal(payload.modules.length, platformModulesPayload().modules.length);
});

test('platformModulesMiddleware passes non-GET through', () => {
  const res = makeRes();
  let nexted = false;
  platformModulesMiddleware()({ method: 'POST' }, res, () => { nexted = true; });
  assert.equal(nexted, true);
});

test('ownerPageMiddleware serves HTML on GET and passes other methods', () => {
  const res = makeRes();
  let nexted = false;
  ownerPageMiddleware()({ method: 'GET' }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);
  assert.match(res.body, /window\.__PLATFORM_MODULES/);
  const res2 = makeRes();
  let nexted2 = false;
  ownerPageMiddleware()({ method: 'POST' }, res2, () => { nexted2 = true; });
  assert.equal(nexted2, true);
});
