import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_MODULES,
  MODULE_STATUSES,
  MODULE_PHASES,
  listModules,
  getModule,
  liveModules,
} from './registry.js';

test('registry is frozen and every entry is complete + bilingual', () => {
  assert.ok(Object.isFrozen(PLATFORM_MODULES));
  assert.ok(PLATFORM_MODULES.length >= 6);
  const ids = new Set();
  const paths = new Set();
  for (const m of PLATFORM_MODULES) {
    assert.ok(m.id && typeof m.id === 'string', 'id');
    assert.ok(!ids.has(m.id), `duplicate id ${m.id}`);
    ids.add(m.id);
    assert.ok(m.path.startsWith('/') && m.path.endsWith('/'), `${m.id} path wrapped in slashes`);
    assert.ok(!paths.has(m.path), `duplicate path ${m.path}`);
    paths.add(m.path);
    assert.ok(m.name?.es && m.name?.en, `${m.id} bilingual name`);
    assert.ok(m.tagline?.es && m.tagline?.en, `${m.id} bilingual tagline`);
    assert.ok(MODULE_STATUSES.includes(m.status), `${m.id} valid status`);
    assert.ok(MODULE_PHASES.includes(m.phase), `${m.id} valid phase`);
    assert.ok(['owner', 'client', 'both'].includes(m.audience), `${m.id} valid audience`);
    assert.ok(m.icon && typeof m.icon === 'string', `${m.id} icon`);
  }
});

test('live modules all have distinct working paths; soon modules name their phase', () => {
  for (const m of PLATFORM_MODULES) {
    if (m.status === 'soon') {
      assert.ok(m.phase !== '1', `${m.id} soon module points at a future phase`);
    }
  }
  const live = liveModules();
  assert.ok(live.length >= 3, 'at least import-export, crude and portal are live');
  assert.ok(live.every((m) => m.status === 'live'));
});

test('listModules/getModule return copies, never the frozen originals', () => {
  const all = listModules();
  assert.notEqual(all[0], PLATFORM_MODULES[0]);
  all[0].name.es = 'MUTATED';
  assert.notEqual(PLATFORM_MODULES[0].name.es, 'MUTATED');
  const one = getModule('crude');
  assert.equal(one.id, 'crude');
  assert.equal(one.path, '/crude/');
  assert.equal(getModule('nope'), null);
});

test('portal module links the owner admin page', () => {
  const portal = getModule('portal');
  assert.equal(portal.adminPath, '/portal/admin.html');
});
