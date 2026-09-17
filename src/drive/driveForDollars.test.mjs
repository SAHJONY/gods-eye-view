import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineM,
  routeDistanceM,
  reverseGeocode,
  propertiesToCsv,
  encodeStorage,
  decodeStorage,
  driveFileName,
  conditionLabel,
  PROPERTY_CONDITIONS,
} from './driveForDollars.js';

test('haversineM: ~111 m per 0.001° latitude', () => {
  const d = haversineM(29.76, -95.36, 29.761, -95.36);
  assert.ok(d > 105 && d < 118, `expected ~111 m, got ${d}`);
});

test('haversineM: zero for identical points', () => {
  assert.equal(haversineM(29.76, -95.36, 29.76, -95.36), 0);
});

test('routeDistanceM sums segments', () => {
  const pts = [
    { lat: 29.76, lng: -95.36 },
    { lat: 29.761, lng: -95.36 },
    { lat: 29.762, lng: -95.36 },
  ];
  const d = routeDistanceM(pts);
  assert.ok(d > 210 && d < 236, `expected ~222 m, got ${d}`);
  assert.equal(routeDistanceM([]), 0);
  assert.equal(routeDistanceM([pts[0]]), 0);
});

test('reverseGeocode resolves display_name via injected fetch', async () => {
  const stub = async (url) => {
    assert.match(url, /nominatim\.openstreetmap\.org\/reverse/);
    assert.match(url, /lat=29\.760400/);
    return {
      ok: true,
      json: async () => ({ display_name: '123 Main St, Houston, TX' }),
    };
  };
  const addr = await reverseGeocode(29.7604, -95.3698, stub);
  assert.equal(addr, '123 Main St, Houston, TX');
});

test('reverseGeocode returns null on failure (best effort)', async () => {
  const failing = async () => ({ ok: false });
  assert.equal(await reverseGeocode(0, 0, failing), null);
  const throwing = async () => { throw new Error('net down'); };
  assert.equal(await reverseGeocode(0, 0, throwing), null);
});

test('propertiesToCsv shapes rows for the scanner importer', () => {
  const csv = propertiesToCsv([
    {
      timestamp: '2026-09-17T05:00:00.000Z',
      lat: 29.7604,
      lng: -95.3698,
      address: '123 Main St, Houston, TX',
      condition: 'boarded',
      notes: 'Tapiada, "se vende" pintado',
      photoName: 'IMG_001.jpg',
    },
  ]);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'fecha,latitud,longitud,direccion,condicion,notas,foto');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /123 Main St, Houston, TX/);
  assert.match(lines[1], /boarded/);
  // quotes doubled, newlines stripped
  assert.match(lines[1], /""se vende"" pintado/);
});

test('propertiesToCsv handles empty list', () => {
  assert.equal(
    propertiesToCsv([]),
    'fecha,latitud,longitud,direccion,condicion,notas,foto',
  );
});

test('storage codec round-trips drives and properties (no photos)', () => {
  const state = {
    drives: [
      {
        id: 'drive-1',
        startedAt: '2026-09-17T05:00:00.000Z',
        endedAt: '2026-09-17T06:00:00.000Z',
        distanceM: 1234.56,
        points: [{ lat: 1, lng: 2 }],
      },
    ],
    properties: [
      {
        id: 'prop-1',
        lat: 29.76,
        lng: -95.36,
        address: 'x',
        condition: 'vacant',
        notes: '',
        photoName: '',
        timestamp: '2026-09-17T05:30:00.000Z',
      },
    ],
  };
  const decoded = decodeStorage(encodeStorage(state));
  assert.equal(decoded.properties.length, 1);
  assert.equal(decoded.properties[0].id, 'prop-1');
  assert.equal(decoded.drives.length, 1);
  assert.equal(decoded.drives[0].distanceM, 1235); // rounded
  assert.deepEqual(decoded.drives[0].points, [[1, 2]]);
});

test('decodeStorage tolerates garbage', () => {
  assert.deepEqual(decodeStorage('not json'), { drives: [], properties: [] });
  assert.deepEqual(decodeStorage('{"v":1}'), { drives: [], properties: [] });
});

test('driveFileName stamps exports', () => {
  const name = driveFileName('csv', new Date(2026, 8, 17, 5, 4));
  assert.equal(name, 'd4d-propiedades-20260917-0504.csv');
});

test('conditionLabel is bilingual', () => {
  assert.equal(conditionLabel('boarded', 'es'), 'Tapiada');
  assert.equal(conditionLabel('boarded', 'en'), 'Boarded up');
  assert.ok(PROPERTY_CONDITIONS.length >= 6);
});
