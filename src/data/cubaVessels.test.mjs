import {
  isCubaBound,
  destinationWords,
  isCubaLaneVessel,
  isDepartingCuba,
  isAnchoredInCuba,
  isInCubaZone,
  cubaVesselCss,
  cubaVesselBadge,
} from './cubaVessels.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('cubaVessels — destination matching', () => {
  it('matches Havana spellings', () => {
    assert.equal(isCubaBound({ destination: 'HAVANA' }), true);
    assert.equal(isCubaBound({ destination: 'La Habana' }), true);
    assert.equal(isCubaBound({ destination: 'CU HAV' }), true);
  });

  it('matches Mariel and other Cuban ports', () => {
    assert.equal(isCubaBound({ destination: 'MARIEL' }), true);
    assert.equal(isCubaBound({ destination: 'Santiago de Cuba' }), true);
    assert.equal(isCubaBound({ destination: 'CUMAR' }), true);
    assert.equal(isCubaBound({ destination: 'CUCFG' }), true);
  });

  it('rejects lookalikes (Samoa, Le Havre)', () => {
    assert.equal(isCubaBound({ destination: 'PAGO PAGO, SAMOA' }), false);
    assert.equal(isCubaBound({ destination: 'LE HAVRE' }), false);
    assert.equal(isCubaBound({ destination: 'MOBILE, AL' }), false);
  });

  it('handles empty / missing destinations', () => {
    assert.equal(isCubaBound({ destination: '' }), false);
    assert.equal(isCubaBound({}), false);
    assert.equal(isCubaBound(null), false);
  });
});

describe('cubaVessels — lane fleet', () => {
  it('matches fleet MMSIs', () => {
    assert.equal(isCubaLaneVessel({ mmsi: '304304000' }), true); // REGULA
    assert.equal(isCubaLaneVessel({ mmsi: '636025531' }), true); // SEABOARD RANGER
  });

  it('rejects unknown MMSIs', () => {
    assert.equal(isCubaLaneVessel({ mmsi: '123456789' }), false);
    assert.equal(isCubaLaneVessel({}), false);
  });
});

describe('cubaVessels — color precedence', () => {
  it('bound beats lane', () => {
    const rec = { mmsi: '304304000', destination: 'MARIEL' };
    assert.equal(cubaVesselCss(rec), '#00e676');
    assert.equal(cubaVesselBadge(rec).text, '🇨🇺 RUMBO A CUBA');
  });

  it('lane vessels get gold', () => {
    const rec = { mmsi: '304304000', destination: 'MIAMI' };
    assert.equal(cubaVesselCss(rec), '#ffc107');
    assert.equal(cubaVesselBadge(rec).text, '🇨🇺 RUTA CUBA');
  });

  it('ordinary vessels keep type color (null)', () => {
    const rec = { mmsi: '123456789', destination: 'ROTTERDAM' };
    assert.equal(cubaVesselCss(rec), null);
    assert.equal(cubaVesselBadge(rec), null);
  });
});

describe('cubaVessels — destinationWords', () => {
  it('normalizes punctuation and case', () => {
    assert.deepEqual(destinationWords('La Habana, Cuba'), [
      'LA',
      'HABANA',
      'CUBA',
    ]);
  });
});

describe('cubaVessels — departing / anchored in Cuba', () => {
  it('detects vessels leaving Cuban waters', () => {
    const rec = { lat: 22.0, lon: -80.0, speed: 12, destination: 'USHOU' };
    assert.equal(isInCubaZone(rec), true);
    assert.equal(isDepartingCuba(rec), true);
    assert.equal(isAnchoredInCuba(rec), false);
    assert.equal(cubaVesselCss(rec), '#b388ff');
    assert.equal(cubaVesselBadge(rec).text, '🇨🇺 SALIENDO DE CUBA');
  });

  it('detects vessels anchored in Cuba', () => {
    const rec = { lat: 23.1, lon: -82.4, speed: 0, destination: '' };
    assert.equal(isDepartingCuba(rec), false);
    assert.equal(isAnchoredInCuba(rec), true);
    assert.equal(cubaVesselBadge(rec).text, '🇨🇺 EN CUBA');
  });

  it('bound beats departing inside the zone', () => {
    const rec = { lat: 22.0, lon: -80.0, speed: 12, destination: 'MARIEL' };
    assert.equal(isCubaBound(rec), true);
    assert.equal(cubaVesselCss(rec), '#00e676');
  });

  it('rejects vessels outside the zone', () => {
    const rec = { lat: 25.7, lon: -80.1, speed: 12, destination: '' };
    assert.equal(isInCubaZone(rec), false);
    assert.equal(isDepartingCuba(rec), false);
    assert.equal(cubaVesselCss(rec), null);
  });
});
