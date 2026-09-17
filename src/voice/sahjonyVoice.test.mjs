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

test('parse: street view (ES/EN)', () => {
  const es = parseSahjonyCommand('vista de calle');
  assert.equal(es.action, '__street_view');
  assert.match(es.say.es, /calle/);

  const en = parseSahjonyCommand('show me the street view');
  assert.equal(en.action, '__street_view');
  assert.match(en.say.en, /Street view/);
});

test('parse: driver for dollars start/stop/mark (ES/EN)', () => {
  const startEs = parseSahjonyCommand('empieza a manejar');
  assert.equal(startEs.action, '__drive_start');

  const startEn = parseSahjonyCommand('start driving');
  assert.equal(startEn.action, '__drive_start');

  const d4d = parseSahjonyCommand('driver for dollars');
  assert.equal(d4d.action, '__drive_start');

  const stopEs = parseSahjonyCommand('termina el recorrido');
  assert.equal(stopEs.action, '__drive_stop');

  const stopEn = parseSahjonyCommand('stop driving');
  assert.equal(stopEn.action, '__drive_stop');

  const markEs = parseSahjonyCommand('marca esta propiedad');
  assert.equal(markEs.action, '__drive_mark');

  const markEn = parseSahjonyCommand('mark this property');
  assert.equal(markEn.action, '__drive_mark');
});

test('parse: street-view and drive phrases do not collide with map views', () => {
  // "vista calle" (street MAP) must keep mapping to the OSM stack…
  assert.equal(parseSahjonyCommand('vista calle').action, 'set_map_stack');
  // …while "vista de calle" (street VIEW) opens the viewer.
  assert.equal(parseSahjonyCommand('vista de calle').action, '__street_view');
  // plain "para" still stops tracking, "para de manejar" ends the drive
  assert.equal(parseSahjonyCommand('para').action, 'stop_tracking');
  assert.equal(parseSahjonyCommand('para de manejar').action, '__drive_stop');
});

test('parse: MY CUBA CASH intents (ES/EN)', () => {
  assert.equal(parseSahjonyCommand('abre cuba cash').action, '__cubacash_open');
  assert.equal(parseSahjonyCommand('open cuba cash').action, '__cubacash_open');
  assert.equal(
    parseSahjonyCommand('muéstrame los proveedores de cuba cash').action,
    '__cubacash_providers',
  );
  assert.equal(
    parseSahjonyCommand('show me cuba cash providers').action,
    '__cubacash_providers',
  );
  assert.equal(
    parseSahjonyCommand('muéstrame los corredores').action,
    '__cubacash_corridors',
  );
  assert.equal(
    parseSahjonyCommand('show me corridors').action,
    '__cubacash_corridors',
  );
  assert.equal(
    parseSahjonyCommand('estado de cuba cash').action,
    '__cubacash_status',
  );
  assert.equal(
    parseSahjonyCommand('cuba cash status').action,
    '__cubacash_status',
  );
  assert.equal(
    parseSahjonyCommand('analiza este corredor').action,
    '__cubacash_analyze',
  );
  assert.equal(
    parseSahjonyCommand('analyze this corridor').action,
    '__cubacash_analyze',
  );
  assert.equal(
    parseSahjonyCommand('inicia el equipo de cuba cash').action,
    '__cubacash_workforce_start',
  );
  assert.equal(
    parseSahjonyCommand('start the cuba cash team').action,
    '__cubacash_workforce_start',
  );
  assert.equal(
    parseSahjonyCommand('pausa el equipo de cuba cash').action,
    '__cubacash_workforce_pause',
  );
  assert.equal(
    parseSahjonyCommand('pause the cuba cash team').action,
    '__cubacash_workforce_pause',
  );
});

test('parse: cuba-cash provider intent is disambiguated from generic supplier phrases', () => {
  // The "cuba cash" qualified phrase must route to MY CUBA CASH, while the
  // generic phrase must NOT swallow into the cuba-cash route.
  assert.equal(
    parseSahjonyCommand('muéstrame los proveedores de cuba cash').action,
    '__cubacash_providers',
  );
  assert.equal(
    parseSahjonyCommand('show me cuba cash providers').action,
    '__cubacash_providers',
  );
  assert.notEqual(
    parseSahjonyCommand('muéstrame los proveedores').action,
    '__cubacash_providers',
  );
});

test('parse: New850 intents (ES/EN) — list pending approvals, open station', () => {
  // Spanish-first: list pending approvals.
  let parsed = parseSahjonyCommand(
    'qué disputas están pendientes de aprobar',
  );
  assert.equal(parsed.action, '__new850_pending_approvals');
  assert.match(parsed.say.es, /aprobaciones/);

  parsed = parseSahjonyCommand('qué aprobaciones tengo pendientes');
  assert.equal(parsed.action, '__new850_pending_approvals');

  // English: list pending approvals.
  parsed = parseSahjonyCommand('what disputes are pending approval');
  assert.equal(parsed.action, '__new850_pending_approvals');
  assert.match(parsed.say.en, /approval queue/);

  parsed = parseSahjonyCommand('list pending approvals');
  assert.equal(parsed.action, '__new850_pending_approvals');

  // Open the station.
  assert.equal(
    parseSahjonyCommand('abre new850').action,
    '__new850_open',
  );
  assert.equal(
    parseSahjonyCommand('open new850').action,
    '__new850_open',
  );
});

test('parse: New850 — approval/rejection is TAP-ONLY, never by voice', () => {
  // No voice phrasing may resolve to an approve/reject action. These must
  // either miss (null) or land on the list intent — never approve/reject.
  for (const phrase of [
    'aprueba la disputa',
    'approve the dispute',
    'rechaza el borrador',
    'reject the draft',
    'aprueba todo',
    'approve all',
  ]) {
    const parsed = parseSahjonyCommand(phrase);
    const action = parsed ? parsed.action : null;
    assert.ok(
      !/approv|reject/i.test(action || ''),
      `voice must never approve/reject (phrase: "${phrase}" -> ${action})`,
    );
  }
});
