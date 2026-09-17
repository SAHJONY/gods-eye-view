import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVoiceText,
  findLayerInText,
  parseSahjonyCommand,
} from './sahjonyVoice.js';

test('normalizeVoiceText strips accents, punctuation and case', () => {
  assert.equal(normalizeVoiceText('¡Muéstrame los AVIONES!'), 'muestrame los aviones');
  assert.equal(normalizeVoiceText('  Vuela   a La Habana  '), 'vuela a la habana');
});

test('findLayerInText matches Spanish and English layer words', () => {
  assert.equal(findLayerInText('muestrame los aviones'), 'flights');
  assert.equal(findLayerInText('show me aircraft'), 'flights');
  assert.equal(findLayerInText('oculta los barcos'), 'ais-live-vessels');
  assert.equal(findLayerInText('hide ships'), 'ais-live-vessels');
  assert.equal(findLayerInText('terremotos'), 'earthquakes');
  assert.equal(findLayerInText('satelites'), 'satellites');
  assert.equal(findLayerInText('incendios'), 'local-firms');
  assert.equal(findLayerInText('la habana'), null);
});

test('parse: Spanish show/hide layer', () => {
  let parsed = parseSahjonyCommand('muéstrame los aviones');
  assert.equal(parsed.action, 'set_layer_visibility');
  assert.deepEqual(parsed.args, { layerId: 'flights', enabled: true });
  assert.match(parsed.say.es, /aviones/);

  parsed = parseSahjonyCommand('oculta los barcos');
  assert.equal(parsed.action, 'set_layer_visibility');
  assert.deepEqual(parsed.args, { layerId: 'ais-live-vessels', enabled: false });

  parsed = parseSahjonyCommand('apaga los terremotos');
  assert.deepEqual(parsed.args, { layerId: 'earthquakes', enabled: false });
});

test('parse: English show/hide layer', () => {
  const parsed = parseSahjonyCommand('show me satellites');
  assert.equal(parsed.action, 'set_layer_visibility');
  assert.deepEqual(parsed.args, { layerId: 'satellites', enabled: true });
  assert.match(parsed.say.en, /satellites/);

  const hidden = parseSahjonyCommand('hide traffic');
  assert.deepEqual(hidden.args, { layerId: 'traffic', enabled: false });
});

test('parse: toggle layer', () => {
  const parsed = parseSahjonyCommand('alterna las cámaras');
  assert.equal(parsed.action, 'toggle_layer');
  assert.equal(parsed.args.layerId, 'cctv');
});

test('parse: fly to places ES/EN', () => {
  let parsed = parseSahjonyCommand('vuela a La Habana');
  assert.equal(parsed.action, 'fly_to_location');
  assert.equal(parsed.args.query, 'la habana');

  parsed = parseSahjonyCommand('fly to Houston');
  assert.equal(parsed.action, 'fly_to_location');
  assert.equal(parsed.args.query, 'houston');

  // show verb with a place (not a layer) flies there
  parsed = parseSahjonyCommand('muéstrame Miami');
  assert.equal(parsed.action, 'fly_to_location');
  assert.equal(parsed.args.query, 'miami');
});

test('parse: zoom in/out ES/EN', () => {
  assert.deepEqual(parseSahjonyCommand('acerca').args, { direction: 'in', amount: 'medium' });
  assert.deepEqual(parseSahjonyCommand('zoom out').args, { direction: 'out', amount: 'medium' });
  assert.equal(parseSahjonyCommand('aléjate').action, 'adjust_camera_zoom');
});

test('parse: globe', () => {
  const parsed = parseSahjonyCommand('muestra el globo');
  assert.equal(parsed.action, 'zoom_to_globe');
  assert.equal(parseSahjonyCommand('show the whole globe').action, 'zoom_to_globe');
});

test('parse: map views', () => {
  assert.deepEqual(parseSahjonyCommand('vista satélite').args, { stack: 'esri-imagery' });
  assert.deepEqual(parseSahjonyCommand('vista 3d').args, { stack: 'photoreal' });
  assert.deepEqual(parseSahjonyCommand('map view').args, { stack: 'osm' });
});

test('parse: scenes, ISS, status, stop', () => {
  assert.deepEqual(parseSahjonyCommand('reproduce la escena').args, { action: 'play' });
  assert.deepEqual(parseSahjonyCommand('next scene').args, { action: 'next' });
  assert.equal(parseSahjonyCommand('estación espacial').action, 'next_iss_pass');
  assert.equal(parseSahjonyCommand('qué estoy viendo').action, 'get_current_view_state');
  assert.equal(parseSahjonyCommand('what am i looking at').action, 'get_current_view_state');
  assert.equal(parseSahjonyCommand('para').action, 'stop_tracking');
});

test('parse: hands-free language switch and help', () => {
  const toEn = parseSahjonyCommand('cambia a inglés');
  assert.equal(toEn.action, '__set_lang');
  assert.equal(toEn.args.lang, 'en');

  const toEs = parseSahjonyCommand('switch to spanish');
  assert.equal(toEs.action, '__set_lang');
  assert.equal(toEs.args.lang, 'es');

  assert.equal(parseSahjonyCommand('ayuda').action, '__help');
  assert.equal(parseSahjonyCommand('help').action, '__help');
});

test('parse: unknown text returns null', () => {
  assert.equal(parseSahjonyCommand('el ornitorrinco baila'), null);
  assert.equal(parseSahjonyCommand(''), null);
});
