import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MapStackController,
  photorealUnavailableReason,
} from './mapStackController.js';

test('missing photoreal credentials explain both supported setup routes', () => {
  assert.match(
    photorealUnavailableReason(false),
    /Necesita GOOGLE_MAPS_API_KEY.*Ajustes de proveedores/,
  );
  assert.match(photorealUnavailableReason(false), /token de Cesium ion/);
});

test('a configured but failed photoreal route does not ask for another key', () => {
  const reason = photorealUnavailableReason(true);
  assert.match(reason, /no disponibles.*restricciones de API de la clave, la cuota o la red/);
  assert.doesNotMatch(reason, /Necesita|agrégala/);
});

test('controller credential detection accepts ion without a browser global', () => {
  const hasCredentials = MapStackController.prototype._hasPhotorealCredentials;
  assert.equal(hasCredentials.call({ cesiumToken: 'configured' }), true);
  assert.equal(hasCredentials.call({ cesiumToken: '   ' }), false);
});
