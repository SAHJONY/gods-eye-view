import {
  isCubaBound,
  destinationWords,
  isCubaLaneVessel,
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
