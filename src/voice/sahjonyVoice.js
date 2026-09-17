/**
 * SAHJONY VOZ — free bilingual (ES/EN) voice commander for GOD'S EYE VIEW.
 *
 * Uses the browser's built-in Web Speech API (SpeechRecognition +
 * speechSynthesis): $0, no API keys, works in Spanish and English.
 * Commands are parsed by a local bilingual intent engine and executed
 * through the same GEV action runner the (paid) OpenAI realtime voice uses,
 * so every capability stays consistent.
 *
 * Pure intent parsing lives in parseSahjonyCommand() and is unit-tested;
 * the live microphone/TTS/UI wiring lives in createSahjonyVoiceCommander().
 */
const ES = 'es';
const EN = 'en';

/* Component styles, injected as <style> on first UI build (keeps node --test green). */
const SV_CSS = `
#sahjony-voice{--sv-accent:#ffd166;--sv-bg:rgba(10,14,22,.82);--sv-border:rgba(255,209,102,.28);display:flex;flex-direction:column;gap:6px;align-items:center;padding:10px 12px;margin-top:8px;background:var(--sv-bg);border:1px solid var(--sv-border);border-radius:14px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f2f4f8;font-family:inherit;min-width:172px;max-width:210px;box-shadow:0 6px 24px rgba(0,0,0,.45)}
#sahjony-voice .sv-kicker{font-size:10px;letter-spacing:.18em;color:var(--sv-accent);font-weight:700;white-space:nowrap}
#sahjony-voice .sv-row{display:flex;gap:8px;align-items:center}
#sv-mic{width:52px;height:52px;border-radius:50%;border:2px solid var(--sv-border);background:radial-gradient(circle at 35% 30%,#2a3348,#121826);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .15s ease,border-color .2s ease,box-shadow .2s ease}
#sv-mic .sv-mic-icon{font-size:24px;line-height:1;filter:grayscale(.4)}
#sv-mic:hover{transform:scale(1.06)}
#sv-mic.is-listening{border-color:#ff5d5d;box-shadow:0 0 0 4px rgba(255,93,93,.25),0 0 18px rgba(255,93,93,.55);animation:sv-pulse 1.6s ease-in-out infinite}
#sv-mic.is-listening .sv-mic-icon{filter:none}
@keyframes sv-pulse{0%,100%{box-shadow:0 0 0 3px rgba(255,93,93,.22),0 0 12px rgba(255,93,93,.4)}50%{box-shadow:0 0 0 7px rgba(255,93,93,.12),0 0 22px rgba(255,93,93,.6)}}
#sv-lang{min-width:44px;height:32px;border-radius:9px;border:1px solid var(--sv-border);background:rgba(255,209,102,.1);color:var(--sv-accent);font-weight:800;font-size:13px;letter-spacing:.08em;cursor:pointer}
#sv-lang:hover{background:rgba(255,209,102,.22)}
#sahjony-voice .sv-status{font-size:10px;letter-spacing:.12em;color:#9fb0c9;text-align:center;min-height:14px}
#sahjony-voice[data-listening="true"] .sv-status{color:#ff8d8d}
#sahjony-voice .sv-transcript{font-size:11px;color:#d7dee9;text-align:center;min-height:16px;max-width:100%;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.35}
`;

function injectStyles() {
  if (document.getElementById('sahjony-voice-styles')) return;
  const style = document.createElement('style');
  style.id = 'sahjony-voice-styles';
  style.textContent = SV_CSS;
  document.head.appendChild(style);
}

/** Strip accents/diacritics so "avión" and "avion" match alike. */
export function normalizeVoiceText(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[?!¡¿.,;:"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bilingual layer vocabulary → canonical data-layer id. */
const LAYER_WORDS = [
  ['flights', ['avion', 'aviones', 'vuelo', 'vuelos', 'aereo', 'aereos', 'aircraft', 'airplane', 'airplanes', 'plane', 'planes', 'flight', 'flights']],
  ['ais-live-vessels', ['barco', 'barcos', 'buque', 'buques', 'embarcacion', 'embarcaciones', 'navio', 'ship', 'ships', 'vessel', 'vessels', 'boat', 'boats']],
  ['satellites', ['satelite', 'satelites', 'satellite', 'satellites']],
  ['earthquakes', ['terremoto', 'terremotos', 'sismo', 'sismos', 'earthquake', 'earthquakes', 'quake', 'quakes']],
  ['cctv', ['camara', 'camaras', 'camera', 'cameras', 'cctv']],
  ['traffic', ['trafico', 'traffic']],
  ['military', ['militar', 'militares', 'military']],
  ['rocket-launches', ['lanzamiento', 'lanzamientos', 'cohete', 'cohetes', 'launch', 'launches', 'rocket', 'rockets', 'mision espacial', 'misiones espaciales', 'space mission', 'space missions']],
  ['radio', ['radio']],
  ['local-firms', ['incendio', 'incendios', 'fuego', 'fire', 'fires', 'wildfire', 'wildfires']],
  ['telegeography-submarine-cables', ['cable submarino', 'cables submarinos', 'submarine cable', 'submarine cables']],
  ['bikeshare', ['bicicleta', 'bicicletas', 'bike', 'bikes', 'bikeshare']],
  ['local-dams', ['represa', 'represas', 'dam', 'dams']],
  ['local-datacenters', ['centro de datos', 'centros de datos', 'datacenter', 'datacenters', 'data center', 'data centers']],
];

const LAYER_NAMES = {
  flights: { es: 'aviones', en: 'aircraft' },
  'ais-live-vessels': { es: 'barcos', en: 'ships' },
  satellites: { es: 'satélites', en: 'satellites' },
  earthquakes: { es: 'terremotos', en: 'earthquakes' },
  cctv: { es: 'cámaras', en: 'cameras' },
  traffic: { es: 'tráfico', en: 'traffic' },
  military: { es: 'vuelos militares', en: 'military flights' },
  'rocket-launches': { es: 'lanzamientos', en: 'launches' },
  radio: { es: 'radio', en: 'radio' },
  'local-firms': { es: 'incendios', en: 'fires' },
  'telegeography-submarine-cables': { es: 'cables submarinos', en: 'submarine cables' },
  bikeshare: { es: 'bicicletas', en: 'bikes' },
  'local-dams': { es: 'represas', en: 'dams' },
  'local-datacenters': { es: 'centros de datos', en: 'data centers' },
};

/** Find a layer id mentioned anywhere in the normalized text. */
export function findLayerInText(text) {
  const norm = normalizeVoiceText(text);
  for (const [layerId, words] of LAYER_WORDS) {
    for (const word of words) {
      const pattern = new RegExp(`(^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
      if (pattern.test(norm)) return layerId;
    }
  }
  return null;
}

const SHOW_VERBS = '\\b(?:muestra|muestrame|mostrar|ensen[ae]me|pon|activa|enciende|show|display|turn on|enable)\\b';
const HIDE_VERBS = '\\b(?:oculta|ocultar|esconde|esconder|quita|quitar|desactiva|apaga|hide|turn off|disable)\\b';
const TOGGLE_VERBS = '\\b(?:alterna|alternar|cambia|toggle)\\b';
const FLY_VERBS = '\\b(?:vuela a|ve a|llevame a|ir a|viaja a|fly to|go to|take me to|navigate to)\\b';

function layerName(layerId, lang) {
  return (LAYER_NAMES[layerId] || {})[lang] || layerId;
}

/**
 * Parse a bilingual voice command into a GEV action call.
 * Returns { action, args, say: { es, en } } or null when nothing matched.
 */
export function parseSahjonyCommand(rawText) {
  const text = normalizeVoiceText(rawText);
  if (!text) return null;

  // --- language switch (hands-free) ---
  if (/\bcambia (a|al) ingles\b|\bponlo en ingles\b/.test(text)) {
    return { action: '__set_lang', args: { lang: EN }, say: { es: 'Cambiando a inglés', en: 'Switching to English' } };
  }
  if (/\bswitch to spanish\b|\bcambia a espanol\b/.test(text)) {
    return { action: '__set_lang', args: { lang: ES }, say: { es: 'Cambiando a español', en: 'Switching to Spanish' } };
  }

  // --- help ---
  if (/^(ayuda|help|que puedes hacer|what can you do|comandos|commands)$/.test(text)) {
    return {
      action: '__help',
      args: {},
      say: {
        es: 'Puedo mostrar capas como aviones, barcos o terremotos, volar a cualquier ciudad, acercar o alejar, seguir aviones, abrir la vista de calle y manejar el modo driver for dollars. Prueba: marca esta propiedad.',
        en: 'I can show layers like aircraft, ships or earthquakes, fly to any city, zoom in or out, track aircraft, open street view, and run driver-for-dollars mode. Try: mark this property.',
      },
    };
  }

  // --- stop ---
  if (/^(para|parar|deten|detente|alto|stop|stop everything)$/.test(text)) {
    return {
      action: 'stop_tracking',
      args: {},
      say: { es: 'Detenido', en: 'Stopped' },
    };
  }

  // --- globe / zoom out fully ---
  if (/\b(el globo|globo terraqueo|vista global|planeta completo|whole globe|entire globe|show.*globe|zoom.*all the way out)\b/.test(text)) {
    return {
      action: 'zoom_to_globe',
      args: {},
      say: { es: 'Mostrando el globo completo', en: 'Showing the whole globe' },
    };
  }

  // --- zoom in / out ---
  if (/\b(acerca|acercate|acercar|acercame|zoom in)\b/.test(text)) {
    return {
      action: 'adjust_camera_zoom',
      args: { direction: 'in', amount: 'medium' },
      say: { es: 'Acercando', en: 'Zooming in' },
    };
  }
  if (/\b(aleja|alejate|alejar|alejame|zoom out)\b/.test(text)) {
    return {
      action: 'adjust_camera_zoom',
      args: { direction: 'out', amount: 'medium' },
      say: { es: 'Alejando', en: 'Zooming out' },
    };
  }

  // --- track nearest aircraft ---
  if (/\b(sigue|seguir|rastra|rastrear|siguiendo|track|follow).*(avion|aircraft|plane|vuelo|flight)|\b(track|follow).*(nearest|closest)/.test(text)) {
    return {
      action: 'select_nearest_aircraft',
      args: {},
      say: { es: 'Buscando el avión más cercano', en: 'Finding the nearest aircraft' },
    };
  }

  // --- street view (photo / 3D, no API key) ---
  if (/\b(vista de calle|street view)\b/.test(text)) {
    return {
      action: '__street_view',
      args: {},
      say: { es: 'Vista de calle lista', en: 'Street view ready' },
    };
  }

  // --- driver for dollars ---
  if (/\b(driver for dollars|modo manejo|modo manejar|empieza( a)? manejar|inicia( el)? recorrido|start driving|begin driving)\b/.test(text)) {
    return {
      action: '__drive_start',
      args: {},
      say: { es: 'Modo manejo activado. Buena cacería.', en: 'Driving mode on. Happy hunting.' },
    };
  }
  if (/\b(termina( el)? recorrido|finaliza( el)? recorrido|para de manejar|deja de manejar|stop driving|end (the )?drive|finish driving)\b/.test(text)) {
    return {
      action: '__drive_stop',
      args: {},
      say: { es: 'Recorrido terminado', en: 'Drive finished' },
    };
  }
  if (/\b(marca esta propiedad|marca esta casa|agrega esta propiedad|anade esta propiedad|mark this property|mark this house)\b/.test(text)) {
    return {
      action: '__drive_mark',
      args: {},
      say: { es: 'Marcando esta propiedad', en: 'Marking this property' },
    };
  }

  // --- map views ---
  if (/\b(vista satelite|vista satelital|satellite view|vista aerea)\b/.test(text)) {
    return {
      action: 'set_map_stack',
      args: { stack: 'esri-imagery' },
      say: { es: 'Vista satélite', en: 'Satellite view' },
    };
  }
  if (/\b(vista 3d|3d view|vista tridimensional|photorealistic view|vista fotorrealista)\b/.test(text)) {
    return {
      action: 'set_map_stack',
      args: { stack: 'photoreal' },
      say: { es: 'Vista tres D', en: '3D view' },
    };
  }
  if (/\b(vista mapa|vista calles|vista calle|map view|street map|road map)\b/.test(text)) {
    return {
      action: 'set_map_stack',
      args: { stack: 'osm' },
      say: { es: 'Vista de mapa', en: 'Map view' },
    };
  }

  // --- scenes ---
  if (/\b(siguiente escena|proxima escena|next scene)\b/.test(text)) {
    return {
      action: 'control_scene',
      args: { action: 'next' },
      say: { es: 'Siguiente escena', en: 'Next scene' },
    };
  }
  if (/\b(det[ée]n|para).*(escena|scene)|\bstop.*scene/.test(text)) {
    return {
      action: 'control_scene',
      args: { action: 'stop' },
      say: { es: 'Escena detenida', en: 'Scene stopped' },
    };
  }
  if (/\b(reproduce|reproducir|inicia|iniciar|pon).*(escena|scene)|\bplay.*scene/.test(text)) {
    return {
      action: 'control_scene',
      args: { action: 'play' },
      say: { es: 'Reproduciendo escena', en: 'Playing scene' },
    };
  }

  // --- ISS ---
  if (/\b(estacion espacial|iss|international space station)\b/.test(text)) {
    return {
      action: 'next_iss_pass',
      args: {},
      say: { es: 'Buscando el próximo paso de la estación espacial', en: 'Finding the next space station pass' },
    };
  }

  // --- status: what am I looking at ---
  if (/\b(que estoy viendo|what am i looking at|donde estoy|where am i|que se ve|what do i see)\b/.test(text)) {
    return {
      action: 'get_current_view_state',
      args: {},
      say: null, // commander narrates from the result
    };
  }

  // --- layer visibility (show / hide / toggle) ---
  const verbMatch =
    text.match(new RegExp(SHOW_VERBS)) ||
    text.match(new RegExp(HIDE_VERBS)) ||
    text.match(new RegExp(TOGGLE_VERBS));
  if (verbMatch) {
    const layerId = findLayerInText(text);
    if (layerId) {
      const verb = verbMatch[0];
      const isShow = new RegExp(SHOW_VERBS).test(verb);
      const isHide = new RegExp(HIDE_VERBS).test(verb);
      if (!isShow && !isHide) {
        return {
          action: 'toggle_layer',
          args: { layerId },
          say: { es: `Alternando ${layerName(layerId, ES)}`, en: `Toggling ${layerName(layerId, EN)}` },
        };
      }
      const enabled = isShow;
      return {
        action: 'set_layer_visibility',
        args: { layerId, enabled },
        say: {
          es: enabled ? `Mostrando ${layerName(layerId, ES)}` : `Ocultando ${layerName(layerId, ES)}`,
          en: enabled ? `Showing ${layerName(layerId, EN)}` : `Hiding ${layerName(layerId, EN)}`,
        },
      };
    }
  }

  // --- fly to a place (anything not matched above with a fly verb, or a show verb with no layer) ---
  const flyMatch = text.match(new RegExp(`${FLY_VERBS}\\s+(.+)`));
  if (flyMatch) {
    const query = flyMatch[1].trim();
    if (query) {
      return {
        action: 'fly_to_location',
        args: { query },
        say: { es: `Volando a ${flyMatch[1].trim()}`, en: `Flying to ${flyMatch[1].trim()}` },
      };
    }
  }
  // "muéstrame La Habana" — show verb but no layer: treat remainder as a place.
  const showMatch = text.match(new RegExp(`${SHOW_VERBS}\\s+(.+)`));
  if (showMatch) {
    const query = showMatch[1].replace(/^(el|la|los|las|the)\s+/, '').trim();
    if (query && !findLayerInText(query)) {
      return {
        action: 'fly_to_location',
        args: { query },
        say: { es: `Volando a ${query}`, en: `Flying to ${query}` },
      };
    }
  }

  return null;
}

/** Pick a speech-synthesis voice matching the language. */
function pickVoice(lang) {
  try {
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!voices.length) return null;
    const tag = lang === ES ? /^es([-_]|$)/i : /^en([-_]|$)/i;
    return (
      voices.find((v) => tag.test(v.lang) && /google/i.test(v.name)) ||
      voices.find((v) => tag.test(v.lang)) ||
      null
    );
  } catch {
    return null;
  }
}

function speak(text, lang) {
  try {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang === ES ? 'es-US' : 'en-US';
    const voice = pickVoice(lang);
    if (voice) utter.voice = voice;
    utter.rate = 1.02;
    window.speechSynthesis.speak(utter);
  } catch {
    /* speech unavailable — silent */
  }
}

function describeViewState(result, lang) {
  if (!result || typeof result !== 'object') {
    return lang === ES ? 'No pude leer la vista actual.' : 'I could not read the current view.';
  }
  const parts = [];
  if (result.locality) parts.push(result.locality);
  else if (result.place) parts.push(result.place);
  if (result.altitude || result.range) {
    const alt = result.altitude || result.range;
    parts.push(lang === ES ? `a ${alt}` : `at ${alt}`);
  }
  const layers = Array.isArray(result.visibleLayers)
    ? result.visibleLayers
    : Array.isArray(result.layers)
      ? result.layers
      : [];
  if (layers.length) {
    parts.push(
      lang === ES
        ? `capas visibles: ${layers.slice(0, 4).join(', ')}`
        : `visible layers: ${layers.slice(0, 4).join(', ')}`,
    );
  }
  if (!parts.length) {
    return lang === ES ? 'Viendo el mapa.' : 'Looking at the map.';
  }
  return (lang === ES ? 'Estás viendo ' : 'You are looking at ') + parts.join(', ') + '.';
}

/**
 * Live commander: microphone (Web Speech API) + intent engine + TTS + UI.
 */
export function createSahjonyVoiceCommander({ runner, dataManager = null, signal = null, defaultLang = ES, extensions = {} } = {}) {
  if (typeof runner !== 'function') throw new Error('sahjonyVoice: runner is required');
  const ext = extensions && typeof extensions === 'object' ? extensions : {};
  let lang = defaultLang === EN ? EN : ES;
  let listening = false;
  let recognition = null;
  let root = null;
  let statusEl = null;
  let transcriptEl = null;
  let langButton = null;
  let micButton = null;
  const aborted = { current: false };
  signal?.addEventListener?.('abort', () => {
    aborted.current = true;
    stop();
  }, { once: true });

  const SpeechRecognition =
    typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  function render() {
    if (!root) return;
    root.dataset.listening = String(listening);
    root.dataset.lang = lang;
    if (micButton) {
      micButton.setAttribute('aria-pressed', String(listening));
      micButton.classList.toggle('is-listening', listening);
    }
    if (langButton) langButton.textContent = lang === ES ? 'ES' : 'EN';
    if (statusEl) {
      statusEl.textContent = !SpeechRecognition
        ? (lang === ES ? 'Voz no disponible en este navegador — usa Chrome o Edge' : 'Voice unavailable in this browser — use Chrome or Edge')
        : listening
          ? (lang === ES ? 'ESCUCHANDO…' : 'LISTENING…')
          : (lang === ES ? 'SAHJONY VOZ · toca el micrófono' : 'SAHJONY VOICE · tap the mic');
    }
  }

  function setTranscript(text) {
    if (transcriptEl) transcriptEl.textContent = text || '';
  }

  function setLang(next) {
    lang = next === EN ? EN : ES;
    if (recognition) {
      try { recognition.lang = lang === ES ? 'es-US' : 'en-US'; } catch { /* noop */ }
    }
    render();
  }

  async function execute(parsed, originalText) {
    if (!parsed) {
      const msg = lang === ES
        ? 'No entendí. Prueba: muéstrame los aviones.'
        : 'I did not catch that. Try: show me aircraft.';
      setTranscript(`«${originalText}» — ${lang === ES ? 'sin comando' : 'no command'}`);
      speak(msg, lang);
      return;
    }
    if (parsed.action === '__set_lang') {
      setLang(parsed.args.lang);
      speak(parsed.say[parsed.args.lang], parsed.args.lang);
      setTranscript(`«${originalText}» ✓`);
      return;
    }
    if (parsed.action === '__help') {
      setTranscript(`«${originalText}» ✓`);
      speak(parsed.say[lang], lang);
      return;
    }
    // Extension actions (street view, driver-for-dollars, …) are handled by
    // the host app, not the GEV action runner.
    if (parsed.action.startsWith('__') && typeof ext[parsed.action] === 'function') {
      setTranscript(`«${originalText}» ✓`);
      try {
        await ext[parsed.action](parsed.args, { lang });
        if (parsed.say) speak(parsed.say[lang], lang);
      } catch {
        speak(lang === ES ? 'Ese comando falló.' : 'That command failed.', lang);
      }
      return;
    }
    let { action, args } = parsed;
    if (action === 'toggle_layer' && dataManager?.layers) {
      const layer = dataManager.layers.get(args.layerId);
      const enabled = !(layer && typeof layer.enabled === 'boolean' ? layer.enabled : layer?.isEnabled?.());
      action = 'set_layer_visibility';
      args = { layerId: args.layerId, enabled };
      parsed = {
        ...parsed,
        say: {
          es: enabled ? `Mostrando ${layerName(args.layerId, ES)}` : `Ocultando ${layerName(args.layerId, ES)}`,
          en: enabled ? `Showing ${layerName(args.layerId, EN)}` : `Hiding ${layerName(args.layerId, EN)}`,
        },
      };
    }
    setTranscript(`«${originalText}» → ${action}`);
    try {
      const result = await runner(action, args);
      if (action === 'get_current_view_state') {
        speak(describeViewState(result, lang), lang);
        return;
      }
      if (result && result.ok === false && result.error) {
        speak(lang === ES ? `No se pudo: ${result.error}` : `Could not do that: ${result.error}`, lang);
        return;
      }
      if (parsed.say) speak(parsed.say[lang], lang);
    } catch (error) {
      speak(lang === ES ? 'Ese comando falló.' : 'That command failed.', lang);
    }
  }

  function startRecognition() {
    if (!SpeechRecognition || listening || aborted.current) return;
    recognition = new SpeechRecognition();
    recognition.lang = lang === ES ? 'es-US' : 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalChunk = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk += ` ${transcript}`;
        else interim += transcript;
      }
      setTranscript((finalChunk + ' ' + interim).trim());
      const finals = finalChunk.trim();
      if (finals) {
        finalChunk = '';
        const parsed = parseSahjonyCommand(finals);
        void execute(parsed, finals);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setTranscript(lang === ES ? 'Permiso de micrófono denegado' : 'Microphone permission denied');
        stop();
      }
    };
    recognition.onend = () => {
      // Auto-restart while the toggle is on (hands-free 24/7 listening).
      if (listening && !aborted.current) {
        try { recognition.start(); } catch { /* will retry on toggle */ }
      }
    };
    try {
      recognition.start();
      listening = true;
    } catch {
      listening = false;
    }
    render();
  }

  function stop() {
    listening = false;
    try { recognition?.stop(); } catch { /* noop */ }
    recognition = null;
    render();
  }

  function toggle() {
    if (listening) stop();
    else startRecognition();
  }

  function buildUi() {
    injectStyles();
    const dock = document.getElementById('command-dock');
    root = document.createElement('div');
    root.id = 'sahjony-voice';
    root.dataset.listening = 'false';
    root.dataset.lang = lang;
    root.innerHTML = `
      <div class="sv-kicker">SAHJONY · AI AGENT</div>
      <div class="sv-row">
        <button id="sv-mic" type="button" aria-pressed="false" aria-label="Activar voz / toggle voice">
          <span class="sv-mic-icon">🎙</span>
        </button>
        <button id="sv-lang" type="button" aria-label="Idioma / language">ES</button>
      </div>
      <div id="sv-status" class="sv-status"></div>
      <div id="sv-transcript" class="sv-transcript" aria-live="polite"></div>
    `;
    if (dock) dock.appendChild(root);
    else document.body.appendChild(root);
    micButton = root.querySelector('#sv-mic');
    langButton = root.querySelector('#sv-lang');
    statusEl = root.querySelector('#sv-status');
    transcriptEl = root.querySelector('#sv-transcript');
    micButton.addEventListener('click', toggle);
    langButton.addEventListener('click', () => setLang(lang === ES ? EN : ES));
    render();
  }

  buildUi();

  const api = {
    get lang() { return lang; },
    get listening() { return listening; },
    setLang,
    start: startRecognition,
    stop,
    toggle,
    parse: parseSahjonyCommand,
    execute: (text) => execute(parseSahjonyCommand(text), text),
    destroy() {
      aborted.current = true;
      stop();
      root?.remove();
      root = null;
    },
  };
  return api;
}

/**
 * App wiring: create a dedicated action runner and attach the commander.
 * Mirrors the options initGevVoiceCommands receives in app/tools.js.
 */
export function initSahjonyVoice(options = {}) {
  const commander = createSahjonyVoiceCommander({
    runner: options.runner,
    dataManager: options.dataManager || null,
    signal: options.signal || null,
    defaultLang: options.defaultLang || ES,
    extensions: options.extensions || {},
  });
  if (typeof window !== 'undefined') {
    window.__sahjonyVoice = commander;
  }
  options.signal?.addEventListener?.('abort', () => {
    if (window.__sahjonyVoice === commander) delete window.__sahjonyVoice;
  }, { once: true });
  return commander;
}
