import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShareLinkManager, isClientModeHash } from './sharelink.js';

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
