import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShareLinkManager, isClientModeHash } from './sharelink.js';
import { decodeLayerStateParams } from './data/layerState.js';

function makeManager(hash = '') {
  globalThis.window = { location: { hash, href: `http://localhost/${hash}` } };
  globalThis.history = {
    replaceState(_state, _title, nextHash) {
      window.location.hash = nextHash;
    },
  };
  const viewer = {
    camera: {
      changed: { addEventListener() {} },
      positionCartographic: { latitude: 0, longitude: 0, height: 1000 },
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
    },
  };
  return new ShareLinkManager(viewer);
}

test('vessel deep-link accepts a numeric MMSI', () => {
  const parsed = makeManager(
    '#lat=23.3&lon=-81.5&alt=200000&pitch=-55&v=2&l=ais&vessel=316023339',
  ).parseInitialHash();
  assert.equal(parsed.vesselMmsi, '316023339');
});

test('vessel deep-link rejects malformed MMSI values', () => {
  for (const bad of ['abc', '12', '1234', '12345678901', '3160 23339', '']) {
    const parsed = makeManager(
      `#lat=23.3&lon=-81.5&v=2&l=ais&vessel=${encodeURIComponent(bad)}`,
    ).parseInitialHash();
    assert.equal(parsed.vesselMmsi, null, `vessel=${bad} should be rejected`);
  }
});

test('vessel deep-link is absent by default', () => {
  const parsed = makeManager('#lat=23.3&lon=-81.5&v=2&l=ais').parseInitialHash();
  assert.equal(parsed.vesselMmsi, null);
});

test('client mode requires an explicit client=1 hash param', () => {
  assert.equal(isClientModeHash('#lat=10&lon=20&client=1'), true);
  assert.equal(isClientModeHash('#client=1'), true);
  assert.equal(isClientModeHash('#lat=10&lon=20'), false);
  assert.equal(isClientModeHash('#lat=10&client=0'), false);
  assert.equal(isClientModeHash('#lat=10&vessel=316023339'), false);
  assert.equal(isClientModeHash(''), false);
});

test('hash rewrites preserve the vessel deep-link and client mode params', () => {
  const manager = makeManager(
    '#v=2&lat=10&lon=20&l=ais&vessel=316023339&client=1',
  );
  manager.parseInitialHash();
  manager._initialRestorePending = false;
  manager._updateHash();
  const rewritten = new URLSearchParams(
    String(window.location.hash).replace(/^#/, ''),
  );
  assert.equal(rewritten.get('vessel'), '316023339');
  assert.equal(rewritten.get('client'), '1');
});

test('hash rewrites drop malformed vessel params instead of preserving them', () => {
  const manager = makeManager('#v=2&lat=10&lon=20&l=ais&vessel=abc&client=1');
  manager.parseInitialHash();
  manager._initialRestorePending = false;
  manager._updateHash();
  const rewritten = new URLSearchParams(
    String(window.location.hash).replace(/^#/, ''),
  );
  assert.equal(rewritten.get('vessel'), null);
  assert.equal(rewritten.get('client'), '1');
});

test('the portal 3D deep-link layer param decodes to the AIS vessel layer', () => {
  // Contract with public/portal/panel.html: the "Ver en 3D" button must
  // carry a v2 layer token that actually enables ais-live-vessels. The
  // full word 'ais' is not a valid token and silently enables nothing.
  const portalHash =
    '#lat=10.66281&lon=-61.78696&alt=200000&pitch=-55&v=2&l=a&vessel=304664000&client=1';
  const decoded = decodeLayerStateParams(
    new URLSearchParams(portalHash.replace(/^#/, '')),
  );
  assert.ok(decoded, 'portal layer params must decode');
  assert.ok(
    decoded.enabledLayerIds.includes('ais-live-vessels'),
    'AIS vessel layer must be enabled by the portal link',
  );
  // And the invalid form must keep failing closed so regressions are loud.
  assert.equal(
    decodeLayerStateParams(new URLSearchParams('v=2&l=ais')),
    null,
  );
});
