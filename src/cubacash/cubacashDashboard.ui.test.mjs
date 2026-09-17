import { test } from 'node:test';
import assert from 'node:assert/strict';

// This module never imports cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initCubacashDashboard,
  STATUSES,
  statusPillClass,
  providersToCsv,
  corridorsToCsv,
  providerCsvTemplate,
  corridorCsvTemplate,
  feeCompare,
  draftFeeComparisonText,
  betaBanner,
  adaptStore,
  createMemoryProviderStore,
  CUBACASH_CSS,
  DOCK_BUTTON_ID,
} = await import('./cubacashDashboard.js');

function makeEl() {
  const el = {
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    _html: '',
    textContent: '',
    value: '',
    id: '',
    removed: false,
    _handlers: {},
    _attrs: {},
    appendChild(c) { this.children.push(c); return c; },
    remove() { this.removed = true; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] ?? null; },
    addEventListener(type, fn) { this._handlers[type] = fn; },
    removeEventListener() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    click() { if (typeof this._handlers.click === 'function') this._handlers.click(); },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  return el;
}

const bodyEl = makeEl();

globalThis.window = globalThis;
globalThis.document = {
  location: { href: 'http://localhost/' },
  getElementById: () => null,
  createElement: () => makeEl(),
  head: makeEl(),
  body: bodyEl,
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
};

test('STATUSES cover the four provider statuses, bilingual', () => {
  assert.deepEqual(
    STATUSES.map((s) => s.id),
    ['candidate', 'verifying', 'live', 'paused'],
  );
  for (const s of STATUSES) {
    assert.ok(s.es && s.en, `bilingual label for ${s.id}`);
  }
});

test('statusPillClass maps tiers and statuses', () => {
  assert.equal(statusPillClass('green'), 'green');
  assert.equal(statusPillClass('yellow'), 'yellow');
  assert.equal(statusPillClass('red'), 'red');
  assert.equal(statusPillClass('live'), 'green');
  assert.equal(statusPillClass('verifying'), 'yellow');
  assert.equal(statusPillClass('paused'), 'gray');
  assert.equal(statusPillClass('candidate'), 'gray');
  assert.equal(statusPillClass('nope'), 'gray');
});

test('providersToCsv serializes with canonical headers', () => {
  const csv = providersToCsv([
    {
      name: 'Cubamax',
      channels: ['app', 'web'],
      coverageCountries: ['USA'],
      feeModel: { type: 'flat', flat: 4.99 },
      status: 'live',
      website: 'https://example.test',
      lat: 25.76,
      lng: -80.19,
      notes: 'ok',
    },
  ]);
  const [header, row] = csv.trim().split('\n');
  assert.equal(
    header,
    'name,channels,coverageCountries,feeModelType,feePct,feeFlat,feeMin,feeMax,status,website,lat,lng,notes',
  );
  assert.ok(row.startsWith('Cubamax,'));
  assert.ok(row.includes('app;web'));
  assert.ok(row.includes('4.99'));
});

test('corridorsToCsv resolves provider names from the id map', () => {
  const csv = corridorsToCsv(
    [
      {
        id: 'c1',
        fromCountry: 'USA',
        toCountry: 'Cuba',
        providerId: 'p1',
        sendAmount: 100,
        fxRate: 100,
        fxRateAsOf: '2026-09-17',
      },
    ],
    { p1: { id: 'p1', name: 'Cubamax' } },
  );
  const [header, row] = csv.trim().split('\n');
  assert.equal(
    header,
    'fromCountry,toCountry,providerName,sendAmount,fxRate,fxRateAsOf,fromLat,fromLng,toLat,toLng,notes',
  );
  assert.ok(row.includes('Cubamax'));
  assert.ok(row.includes('2026-09-17'));
});

test('templates carry clearly-labeled fictional sample rows', () => {
  assert.ok(providerCsvTemplate().includes('(fictional)'));
  assert.ok(corridorCsvTemplate().includes('(sample)'));
  assert.ok(corridorCsvTemplate().includes('2026-09-17'));
});

test('feeCompare wraps the engine defensively', () => {
  const engine = {
    compareProviders: ({ amount, providers }) =>
      (providers || []).map((p) => ({ providerId: p.id, receivedAmount: amount })),
  };
  const rows = feeCompare(engine, 100, [{ id: 'a' }], {});
  assert.equal(rows.length, 1);
  assert.deepEqual(feeCompare(null, 100, [], {}), []);
  const throwing = {
    compareProviders: () => {
      throw new Error('boom');
    },
  };
  assert.deepEqual(feeCompare(throwing, 100, [], {}), []);
});

test('draftFeeComparisonText is bilingual and honest about gaps', () => {
  const draft = draftFeeComparisonText([], 100, 'es');
  assert.ok(draft.includes('BORRADOR INTERNO'));
  assert.ok(draft.includes('no enviado') || draft.includes('Nada se inventó'));
  const full = draftFeeComparisonText(
    [
      {
        name: 'Cubamax',
        complete: true,
        fee: 4.99,
        receivedAmount: 9501,
        fxAsOf: '2026-09-17',
      },
    ],
    100,
    'en',
  );
  assert.ok(full.includes('INTERNAL DRAFT'));
  assert.ok(full.includes('Cubamax'));
  assert.ok(full.includes('2026-09-17'));
});

test('betaBanner always reports honest zero beta state', () => {
  const [l1, l2] = betaBanner((es) => es);
  assert.ok(l1.includes('Beta v0.9'));
  assert.ok(l1.includes('0 clientes verificados'));
  assert.ok(l2.includes('Sin datos inventados'));
  const [e1] = betaBanner((es, en) => en);
  assert.ok(e1.includes('0 verified customers'));
});

test('createMemoryProviderStore: full API surface', () => {
  const store = createMemoryProviderStore();
  const p = store.createProvider({
    name: 'Íkualo Rem',
    channels: ['app'],
    feeModel: { type: 'undisclosed' },
  });
  assert.ok(p.id);
  assert.equal(p.status, 'candidate');
  store.moveProvider(p.id, 'live');
  assert.equal(store.getProvider(p.id).status, 'live');
  assert.equal(store.listProviders().length, 1);
  assert.equal(store.listProviders((x) => x.status === 'live').length, 1);
  const c = store.createCorridor({
    fromCountry: 'USA',
    toCountry: 'Cuba',
    providerId: p.id,
    sendAmount: 100,
    fxRate: 100,
    fxRateAsOf: '2026-09-17',
  });
  assert.ok(c.id);
  assert.equal(store.listCorridors().length, 1);
  const stats = store.stats();
  assert.equal(stats.totalProviders, 1);
  assert.equal(stats.liveProviders, 1);
  assert.equal(stats.totalCorridors, 1);
  assert.equal(stats.betaCustomers, 0);
  assert.equal(stats.betaTransactions, 0);
  assert.equal(stats.betaReviews, 0);
  assert.equal(store.deleteCorridor(c.id), true);
  assert.equal(store.deleteProvider(p.id), true);
  assert.equal(store.listProviders().length, 0);
});

test('adaptStore speaks the real cubacash store shape', () => {
  const raw = createMemoryProviderStore();
  const adapted = adaptStore(raw);
  const created = adapted.addMany([{ name: 'Sendvalu' }]);
  assert.equal(created.length, 1);
  assert.equal(adapted.list('candidate').length, 1);
  assert.equal(adapted.byId(created[0].id).name, 'Sendvalu');
  adapted.move(created[0].id, 'verifying');
  assert.equal(adapted.byId(created[0].id).status, 'verifying');
  const corridor = adapted.addCorridor({ fromCountry: 'Spain', toCountry: 'Cuba' });
  assert.ok(corridor.id);
  assert.equal(adapted.listCorridors().length, 1);
  assert.equal(adapted.removeCorridor(corridor.id), true);
  assert.equal(adapted.remove(created[0].id), true);
  assert.equal(adapted.list().length, 0);
  const empty = adaptStore(null);
  assert.deepEqual(empty.list(), []);
});

test('dashboard lifecycle: open/close/toggle/destroy, drawer', () => {
  const store = createMemoryProviderStore([
    { name: 'Fonmoney', status: 'live', feeModel: { type: 'undisclosed' } },
  ]);
  const engine = {
    formatMoney: (n) => `$${n}`,
    compareProviders: () => [],
  };
  const dd = initCubacashDashboard({
    providerStore: store,
    corridorEngine: engine,
    parseCsv: () => ({ providers: [], corridors: [], errors: [] }),
  });
  dd.open();
  const provider = store.listProviders()[0];
  dd.openDrawer(provider.id); // must not throw on the DOM double
  dd.toggle();
  dd.toggle();
  dd.close();
  dd.destroy();
  dd.destroy(); // idempotent
});

test('dashboard renders without a store (all adapters defensive)', () => {
  const dd = initCubacashDashboard({ providerStore: null });
  dd.open();
  dd.toggle();
  dd.destroy();
});

test('phone readability contract: 44px touch targets, solid contrast, no hover-only actions', () => {
  // Solid high-contrast panel background (no translucent overlay).
  assert.match(CUBACASH_CSS, /\.mcc-panel\{[^}]*background:#0b1220/);
  // 44px minimum touch targets on buttons, inputs, cards, close.
  assert.match(CUBACASH_CSS, /\.mcc-btn\{[^}]*min-height:44px/);
  assert.match(CUBACASH_CSS, /\.mcc-input\{[^}]*min-height:44px/);
  assert.match(CUBACASH_CSS, /\.mcc-card\{[^}]*min-height:44px/);
  assert.match(CUBACASH_CSS, /\.mcc-close\{[^}]*min-height:44px/);
  assert.match(CUBACASH_CSS, /\.mcc-dockbtn\{[^}]*min-height:44px/);
  // 16px inputs prevent iOS auto-zoom on focus.
  assert.match(CUBACASH_CSS, /\.mcc-input\{[^}]*font-size:16px/);
  // Clear section headings: uppercase, bright, with a rule.
  assert.match(CUBACASH_CSS, /\.mcc-section h4\{[^}]*text-transform:uppercase/);
  // Phone sheet: full-screen panel under 640px.
  assert.match(CUBACASH_CSS, /@media \(max-width:640px\)/);
  assert.match(CUBACASH_CSS, /\.mcc-panel\{top:0;right:0;bottom:0;left:0/);
  // Nothing hides content behind :hover — no hover rule toggles display.
  for (const rule of CUBACASH_CSS.split('}')) {
    if (rule.includes(':hover')) {
      assert.ok(
        !/display\s*:\s*none/.test(rule),
        `hover must not hide content: ${rule.slice(0, 60)}`,
      );
    }
  }
});

test('command-dock entry: clearly labeled, one tap to the workspace', () => {
  const dock = makeEl();
  dock.id = 'command-dock';
  const realGet = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) =>
    id === 'command-dock' ? dock : null;
  try {
    const dd = initCubacashDashboard({
      providerStore: createMemoryProviderStore(),
    });
    const btn = dock.children.find((c) => c.id === DOCK_BUTTON_ID);
    assert.ok(btn, 'dock button appended to #command-dock');
    assert.equal(btn.getAttribute('aria-label'), 'MY CUBA CASH — remesas / remittances');
    assert.ok(
      btn.innerHTML.includes('MY CUBA CASH'),
      'button carries a clear business label',
    );
    // One tap toggles the workspace open…
    assert.equal(dd.openDrawer ? typeof dd.toggle : null, 'function');
    btn.click();
    dd.destroy();
    assert.ok(btn.removed, 'destroy removes the dock entry');
  } finally {
    globalThis.document.getElementById = realGet;
  }
});

test('dock entry falls back to body when #command-dock is absent', () => {
  const before = bodyEl.children.length;
  const dd = initCubacashDashboard({
    providerStore: createMemoryProviderStore(),
  });
  const added = bodyEl.children.slice(before);
  const btn = added.find((c) => c.id === DOCK_BUTTON_ID);
  assert.ok(btn, 'button appended to body as fallback');
  dd.destroy();
});

test('setLang switches ES/EN and rebuilds the panel', () => {
  const dd = initCubacashDashboard({
    providerStore: createMemoryProviderStore(),
  });
  dd.open();
  assert.equal(dd.getLang(), 'es');
  assert.equal(dd.setLang('en'), 'en');
  assert.equal(dd.getLang(), 'en');
  assert.equal(dd.setLang('es'), 'es');
  dd.destroy();
});
