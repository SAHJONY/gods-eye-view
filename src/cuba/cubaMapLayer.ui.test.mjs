// UI test for the Cuba port map layer: cubaMapLayer.js.
// The Cesium module is imported BEFORE any DOM double is installed (the
// import below runs at file load, before beforeEach installs the double),
// so the module under test resolves the same Cesium object the app sees.
// All Cesium calls use the real module; viewer interactions are intercepted
// by the local viewer double. Nothing leaves the box.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CUBA_PORTS,
  initCubaMapLayer,
  portColor,
} from './cubaMapLayer.js';

let realDocument;
let realWindow;
let realHTMLElement;

function installDomDouble() {
  realDocument = globalThis.document;
  realWindow = globalThis.window;
  realHTMLElement = globalThis.HTMLElement;

  const elements = [];
  function makeEl(tag) {
    const el = {
      tag,
      id: '',
      className: '',
      style: {},
      dataset: {},
      children: [],
      textContent: '',
      innerHTML: '',
      parent: null,
      appendChild(child) {
        child.parent = el;
        el.children.push(child);
        return child;
      },
      remove() {
        if (el.parent) {
          const i = el.parent.children.indexOf(el);
          if (i >= 0) el.parent.children.splice(i, 1);
          el.parent = null;
        }
      },
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      getAttribute() {
        return null;
      },
      querySelector(sel) {
        const q = sel.startsWith('#') ? sel.slice(1) : sel;
        return (
          elements.find(
            (e) => e.id === q || e.className.split(' ').includes(q),
          ) || null
        );
      },
    };
    elements.push(el);
    return el;
  }

  globalThis.HTMLElement = class {};
  const body = makeEl('body');
  globalThis.document = {
    createElement: (t) => makeEl(t),
    body,
    getElementById: (id) => elements.find((e) => e.id === id) || null,
    head: makeEl('head'),
  };
  globalThis.window = {};
}

function removeDomDouble() {
  globalThis.document = realDocument;
  globalThis.window = realWindow;
  globalThis.HTMLElement = realHTMLElement;
}

function makeViewerDouble() {
  const entities = [];
  const flyTos = [];
  return {
    _entities: entities,
    _flyTos: flyTos,
    entities: {
      add(def) {
        entities.push(def);
        return def;
      },
      remove(def) {
        const i = entities.indexOf(def);
        if (i >= 0) entities.splice(i, 1);
        return i >= 0;
      },
    },
    camera: {
      flyTo(args) {
        flyTos.push(args);
      },
    },
  };
}

beforeEach(() => {
  installDomDouble();
});

afterEach(() => {
  removeDomDouble();
});

test('CUBA_PORTS: the four real receiving ports with finite coords', () => {
  const ids = CUBA_PORTS.map((p) => p.id).sort();
  assert.deepEqual(ids, ['cienfuegos', 'la-habana', 'mariel', 'santiago']);
  for (const p of CUBA_PORTS) {
    assert.ok(Number.isFinite(p.lat), `${p.id} lat finite`);
    assert.ok(Number.isFinite(p.lng), `${p.id} lng finite`);
    assert.ok(p.name.es.length > 0);
    assert.ok(p.name.en.length > 0);
  }
  assert.equal(portColor(), '#38bdf8');
});

test('refresh(): adds one entity per port, dedupes, labels are 15px Spanish-first', () => {
  const viewer = makeViewerDouble();
  const layer = initCubaMapLayer({ viewer, lang: 'es' });
  const first = layer.refresh();
  assert.equal(first.added, 4);
  assert.equal(layer._count(), 4);
  const second = layer.refresh();
  assert.equal(second.added, 0, 'refresh dedupes by port id');
  assert.equal(viewer._entities.length, 4);
  for (const def of viewer._entities) {
    assert.ok(def.id.startsWith('gev-cuba-port-'));
    assert.equal(def.label.font, '15px sans-serif', 'label readability floor');
    assert.ok(String(def.label.text).length > 0);
  }
  // Spanish-first default: Mariel's label is Spanish.
  const mariel = viewer._entities.find((d) => d.id === 'gev-cuba-port-mariel');
  assert.equal(mariel.label.text, 'Puerto de Mariel');
  layer.destroy();
  assert.equal(viewer._entities.length, 0);
});

test('refresh(): English labels when lang=en', () => {
  const viewer = makeViewerDouble();
  const layer = initCubaMapLayer({ viewer, lang: 'en' });
  layer.refresh();
  const mariel = viewer._entities.find((d) => d.id === 'gev-cuba-port-mariel');
  assert.equal(mariel.label.text, 'Port of Mariel');
  layer.destroy();
});

test('flyToPort: flies the camera to Mariel, ignores unknown ports', () => {
  const viewer = makeViewerDouble();
  const layer = initCubaMapLayer({ viewer });
  assert.equal(layer.flyToPort('mariel'), true);
  assert.equal(viewer._flyTos.length, 1);
  assert.equal(layer.flyToPort('not-a-port'), false);
  assert.equal(viewer._flyTos.length, 1);
  layer.destroy();
});

test('setVisible: toggles entity show flags (phone-tappable pins stay)', () => {
  const viewer = makeViewerDouble();
  const layer = initCubaMapLayer({ viewer });
  layer.refresh();
  layer.setVisible(false);
  assert.ok(viewer._entities.every((d) => d.show === false));
  layer.setVisible(true);
  assert.ok(viewer._entities.every((d) => d.show === true));
  layer.destroy();
});

test('onPortClick + _pick: tapping a port pin reports the port', () => {
  const viewer = makeViewerDouble();
  const layer = initCubaMapLayer({ viewer });
  layer.refresh();
  let shown = null;
  const unsub = layer.onPortClick((port) => {
    shown = port;
  });
  const picked = { id: 'gev-cuba-port-mariel' };
  const port = layer._pick(picked);
  assert.equal(port.id, 'mariel');
  assert.equal(shown.id, 'mariel');
  // A non-port entity does not fire the handler.
  shown = null;
  layer._pick({ id: 'something-else' });
  assert.equal(shown, null);
  unsub();
  layer.destroy();
});

test('destroy(): removes entities and is safe to call twice', () => {
  const viewer = makeViewerDouble();
  const layer = initCubaMapLayer({ viewer });
  layer.refresh();
  assert.equal(layer._count(), 4);
  layer.destroy();
  layer.destroy();
  assert.equal(viewer._entities.length, 0);
  assert.equal(layer._count(), 0);
});

test('initCubaMapLayer without a viewer: refresh/flyTo are safe no-ops', () => {
  const layer = initCubaMapLayer({});
  assert.deepEqual(layer.refresh(), { added: 0, removed: 0 });
  assert.equal(layer.flyToPort('mariel'), false);
  layer.destroy();
});
