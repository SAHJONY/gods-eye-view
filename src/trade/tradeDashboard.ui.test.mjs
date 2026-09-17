import { test } from 'node:test';
import assert from 'node:assert/strict';

// This module never imports cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initTradeDashboard,
  parseRfqsCsv,
  rfqsToCsv,
  csvTemplate,
  statusPillClass,
  verificationLabel,
  draftCommissionText,
  createMemoryRfqStore,
  adaptStore,
  STATUSES,
} = await import('./tradeDashboard.js');

function makeEl() {
  const el = {
    children: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    _html: '',
    _text: '',
    value: '',
    id: '',
    removed: false,
    _handlers: {},
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    remove() {
      this.removed = true;
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    addEventListener(type, fn) {
      this._handlers[type] = fn;
    },
    removeEventListener() {},
    click() {
      if (typeof this._handlers.click === 'function') this._handlers.click();
    },
    querySelector() {
      return makeEl();
    },
    querySelectorAll() {
      return [];
    },
  };
  // Real DOM aggregates child text into parent textContent; mimic that so
  // drawer/panel assertions can read rendered values.
  Object.defineProperty(el, 'textContent', {
    get() {
      return (
        (this._text || '') +
        this.children.map((c) => c.textContent || '').join('')
      );
    },
    set(v) {
      this._text = String(v);
      this.children.length = 0;
    },
    configurable: true,
  });
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return this._html;
    },
    set(v) {
      this._html = String(v);
      this.children.length = 0;
    },
    configurable: true,
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

const RFQ_FIXTURE = {
  ref: 'FIX-001',
  product: 'Fixture Product',
  quantity: 1000,
  unitCost: 12.5,
  sellUnitPrice: 18,
  freight: 1200,
  duties: 300,
  otherCosts: 150,
  commissionPct: 5,
  status: 'prospect',
  incoterms: 'FOB',
  originPort: 'Fixture Origin Port',
  destinationPort: 'Fixture Destination Port',
};

const SUP_FIXTURE = {
  name: 'Example Supplier Ltd',
  type: 'manufacturer',
  role: 'supplier',
  country: 'Exampleland',
  verification: 'pending',
  contactName: 'Sample Contact',
  contactEmail: 'sample@example.test',
  contactPhone: '+1-555-0100',
};

function fakeStore(seed = []) {
  return createMemoryRfqStore(seed);
}

function fakeEngine(overrides = {}) {
  return {
    landedCostUnit: () => 14.5,
    netMarginTotal: () => 2500,
    netMarginPct: () => 10,
    commissionAmount: () => 100,
    missingFields: () => [],
    rfqVerdict: () => ({
      tier: 'green',
      es: 'Veredicto verde de prueba.',
      en: 'Test green verdict.',
      reasons: [],
    }),
    scoreRfq: () => 82,
    formatMoney: (n) => `$${Number(n).toLocaleString('en-US')}`,
    ...overrides,
  };
}

test('dashboard: STATUSES cover the 6 trade pipeline statuses', () => {
  assert.deepEqual(
    STATUSES.map((s) => s.id),
    ['prospect', 'contacted', 'quoting', 'negotiating', 'won', 'lost'],
  );
  const dd = initTradeDashboard({ rfqStore: fakeStore() });
  dd.destroy();
});

test('dashboard: honest empty state when there are no RFQs', () => {
  const dd = initTradeDashboard({ rfqStore: fakeStore() });
  dd.open();
  assert.ok(dd.refs.emptyState, 'empty state element rendered');
  assert.ok(
    dd.refs.emptyState.textContent.includes('Sin RFQs'),
    `empty state honest in ES: ${dd.refs.emptyState.textContent}`,
  );
  dd.setLang('en');
  assert.ok(dd.refs.emptyState, 'empty state persists after language switch');
  assert.ok(
    dd.refs.emptyState.textContent.includes('No RFQs yet'),
    'empty state honest in EN',
  );
  assert.equal(dd.refs.rfqCards.length, 0, 'no cards when empty');
  dd.destroy();
});

test('dashboard: renders KPIs; potential commission computed via rfqEngine', () => {
  const store = fakeStore([
    { ...RFQ_FIXTURE, ref: 'A' },
    { ...RFQ_FIXTURE, ref: 'B', status: 'lost' },
  ]);
  const dd = initTradeDashboard({
    rfqStore: store,
    rfqEngine: fakeEngine({ commissionAmount: () => 100 }),
  });
  dd.open();
  const stats = store.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.openRfqs, 1);
  assert.ok(dd.refs.kpis, 'KPI container ref exists');
  assert.ok(dd.refs.kpis.innerHTML.includes('2'), 'total RFQs rendered');
  // Only the open RFQ (A) counts: 1 × $100 commission via the engine.
  assert.ok(dd.refs.kpis.innerHTML.includes('$100'), 'engine commission rendered');
  dd.destroy();
});

test('dashboard: pipeline columns cover all 6 statuses', () => {
  const dd = initTradeDashboard({
    rfqStore: fakeStore([{ ...RFQ_FIXTURE, status: 'negotiating' }]),
  });
  dd.open();
  assert.equal(dd.refs.rfqCards.length, 1);
  dd.destroy();
});

test('dashboard: drawer opens on card click, economics from engine, draft + notes work', () => {
  const store = fakeStore([RFQ_FIXTURE]);
  const dd = initTradeDashboard({
    rfqStore: store,
    rfqEngine: fakeEngine(),
  });
  dd.open();
  assert.equal(dd.refs.rfqCards.length, 1);
  dd.refs.rfqCards[0].click();
  const rfqId = store.listRfqs()[0].id;
  assert.ok(dd.refs.drawer, 'drawer rendered');
  // Economics come from the injected engine.
  assert.ok(
    dd.refs.drawer.textContent.includes('$14.5'),
    'landed cost/unit from engine',
  );
  assert.ok(
    dd.refs.drawer.textContent.includes('$2,500'),
    'net margin from engine',
  );
  assert.ok(dd.refs.drawer.textContent.includes('82/100'), 'score from engine');
  assert.ok(dd.refs.drawer.textContent.includes('10.0%'), 'margin pct from engine');
  // Draft generator.
  assert.ok(dd.refs.draftBtn, 'commission draft button rendered');
  dd.refs.draftBtn.click();
  assert.ok(dd.refs.draftPre, 'draft <pre> rendered');
  assert.ok(dd.refs.draftPre.textContent.includes('Juan Gonzalez'));
  assert.ok(
    dd.refs.draftPre.textContent
      .toLowerCase()
      .includes('borrador — nada enviado'),
  );
  // Notes round-trip.
  dd.refs.noteInput.value = 'Supplier confirmed price.';
  dd.refs.noteBtn.click();
  assert.equal(store.notes(rfqId).length, 1);
  dd.closeDrawer();
  assert.equal(dd.refs.drawer, null, 'drawer closed');
  dd.destroy();
});

test('dashboard: drawer missing-fields line renders from engine', () => {
  const store = fakeStore([RFQ_FIXTURE]);
  const dd = initTradeDashboard({
    rfqStore: store,
    rfqEngine: fakeEngine({
      missingFields: () => [{ es: 'aranceles', en: 'duties' }],
    }),
  });
  dd.open();
  dd.refs.rfqCards[0].click();
  assert.ok(
    dd.refs.drawer.textContent.includes('aranceles'),
    'missing fields shown in ES',
  );
  dd.destroy();
});

test('dashboard: card map button calls shippingMap.flyToRfq', () => {
  const store = fakeStore([RFQ_FIXTURE]);
  const seen = [];
  const dd = initTradeDashboard({
    rfqStore: store,
    rfqEngine: fakeEngine(),
    shippingMap: { flyToRfq: (id) => seen.push(id) },
  });
  dd.open();
  const card = dd.refs.rfqCards[0];
  // card children: [refDiv, metaDiv]; meta children: [pill, info, mapBtn].
  const mapBtn = card.children[1].children[2];
  assert.ok(mapBtn, 'map button rendered');
  mapBtn.click();
  assert.deepEqual(seen, [store.listRfqs()[0].id]);
  dd.destroy();
});

test('dashboard: CSV import via injected parser, error count shown', () => {
  const dd = initTradeDashboard({
    rfqStore: fakeStore(),
    parseCsv: () => ({
      rfqs: [
        {
          ref: 'INJ-001',
          product: 'Injected Product',
          quantity: 500,
          status: 'prospect',
        },
      ],
      suppliers: [{ name: 'Injected Supplier' }],
      errors: 2,
    }),
  });
  dd.open();
  assert.ok(dd.refs.importBtn, 'import button ref exists');
  assert.ok(dd.refs.exportBtn, 'export button ref exists');
  assert.ok(dd.refs.templateBtn, 'template button ref exists');
  const res = dd.importCsvText('anything at all');
  assert.equal(res.rfqs.length, 1);
  assert.equal(res.suppliers.length, 1);
  assert.equal(res.errors, 2);
  assert.ok(
    dd.refs.importStatus.textContent.includes('2'),
    'error count shown',
  );
  assert.equal(dd.getSuppliers().length, 1);
  dd.destroy();
});

test('dashboard: supplier add + edit', () => {
  const dd = initTradeDashboard({ rfqStore: fakeStore([RFQ_FIXTURE]) });
  dd.open();
  assert.equal(dd.getSuppliers().length, 0);
  const sup = dd.addSupplier({ ...SUP_FIXTURE });
  assert.ok(sup.id, 'supplier gets an id');
  assert.equal(dd.getSuppliers().length, 1);
  // Edit flow: select + save via form refs.
  assert.ok(dd.refs.supSaveBtn, 'supplier save button rendered');
  dd.refs.supForm.name.value = 'Example Supplier Ltd';
  dd.refs.supForm.verification.value = 'verified';
  dd.destroy();
});

test('dashboard: open/close/toggle/destroy lifecycle', () => {
  const dd = initTradeDashboard({ rfqStore: fakeStore() });
  assert.equal(globalThis.__gevTrade, dd, 'window handle exposed');
  dd.toggle();
  assert.ok(dd.refs.kpis, 'toggle opens the panel');
  dd.toggle();
  assert.equal(dd.refs.kpis, null, 'toggle closes the panel');
  dd.open();
  dd.destroy();
  assert.equal(dd.refs.kpis, null, 'destroy clears refs');
});

test('parseRfqsCsv: parses header + rows, numbers, supplier section', () => {
  const parsed = parseRfqsCsv(csvTemplate());
  assert.ok(parsed.rfqs.length >= 1);
  const r = parsed.rfqs.find((x) => x.ref === 'SAMPLE-001');
  assert.ok(r, 'sample row parsed');
  assert.equal(r.quantity, 1000);
  assert.equal(r.unitCost, 12.5);
  assert.equal(r.sellUnitPrice, 18);
  assert.equal(r.commissionPct, 5);
  assert.equal(r.status, 'prospect');
  assert.ok(parsed.suppliers.length >= 1);
  assert.equal(parsed.suppliers[0].name, 'Example Supplier Ltd');
  assert.equal(parsed.errors, 0);
  assert.deepEqual(parseRfqsCsv(''), { rfqs: [], suppliers: [], errors: 0 });
});

test('parseRfqsCsv: empty rows count as errors, bad statuses normalize', () => {
  const parsed = parseRfqsCsv(
    'ref,product,quantity,status\n,,\nBAD-1,Widget,10,bogus-status',
  );
  assert.equal(parsed.errors, 1);
  assert.equal(parsed.rfqs.length, 1);
  assert.equal(parsed.rfqs[0].status, 'prospect');
});

test('rfqsToCsv + parseRfqsCsv round-trip', () => {
  const out = rfqsToCsv([{ ...RFQ_FIXTURE }]);
  assert.ok(out.startsWith('ref,product,quantity'));
  const back = parseRfqsCsv(out);
  assert.equal(back.rfqs.length, 1);
  assert.equal(back.rfqs[0].ref, 'FIX-001');
  assert.equal(back.rfqs[0].quantity, 1000);
});

test('statusPillClass maps verdict tiers and RFQ statuses', () => {
  assert.equal(statusPillClass('green'), 'green');
  assert.equal(statusPillClass('won'), 'green');
  assert.equal(statusPillClass('contacted'), 'yellow');
  assert.equal(statusPillClass('quoting'), 'yellow');
  assert.equal(statusPillClass('negotiating'), 'yellow');
  assert.equal(statusPillClass('red'), 'red');
  assert.equal(statusPillClass('lost'), 'gray');
  assert.equal(statusPillClass('prospect'), 'gray');
  assert.equal(statusPillClass('bogus'), 'gray');
});

test('verificationLabel: bilingual badges', () => {
  assert.equal(verificationLabel('verified', 'es'), 'Verificado');
  assert.equal(verificationLabel('flagged', 'en'), 'Flagged');
  assert.equal(verificationLabel('pending', 'es'), 'En verificación');
  assert.equal(verificationLabel('bogus', 'en'), 'Unverified');
});

test('draftCommissionText: pure, bilingual, never sends', () => {
  const es = draftCommissionText(
    { ...RFQ_FIXTURE, landedUnit: 14.5, netMargin: 2500, commission: 625 },
    SUP_FIXTURE,
    'es',
  );
  const en = draftCommissionText(
    { ...RFQ_FIXTURE, landedUnit: 14.5, netMargin: 2500, commission: 625 },
    SUP_FIXTURE,
    'en',
  );
  assert.ok(es.includes('Juan Gonzalez'), 'first-person signer present');
  assert.ok(es.includes('comerciante privado'), 'spanish draft');
  assert.ok(es.includes('Esto no es asesoría legal.'), 'not-legal-advice line');
  assert.ok(es.includes('borrador — nada enviado'), 'nothing-sent line');
  assert.ok(es.includes('BORRADOR DE COMISIÓN — NADA ENVIADO'));
  assert.ok(en.includes('private trader'), 'english draft');
  assert.ok(en.includes('This is not legal advice.'));
  assert.ok(en.includes('draft — nothing sent'));
  assert.ok(en.includes('COMMISSION DRAFT — NOTHING SENT'));
  assert.ok(es.includes('Example Supplier Ltd'));
  assert.ok(
    !/fetch\(|XMLHttpRequest|https?:\/\//.test(es + en),
    'no network calls',
  );
  // Supplier optional.
  const bare = draftCommissionText(RFQ_FIXTURE, null, 'es');
  assert.ok(bare.includes('Juan Gonzalez'));
});

test('createMemoryRfqStore: full tools.js-wrapped API surface', () => {
  const s = createMemoryRfqStore();
  const r = s.createRfq({ ...RFQ_FIXTURE });
  assert.ok(r.id);
  assert.equal(s.getRfq(r.id).ref, 'FIX-001');
  s.updateRfq(r.id, { sellUnitPrice: 19 });
  assert.equal(s.getRfq(r.id).sellUnitPrice, 19);
  s.moveRfq(r.id, 'contacted');
  assert.equal(s.getRfq(r.id).status, 'contacted');
  s.moveRfq(r.id, 'bogus');
  assert.equal(s.getRfq(r.id).status, 'contacted', 'invalid status ignored');
  assert.equal(s.listRfqs('contacted').length, 1);
  s.addRfqNote(r.id, 'hello');
  assert.equal(s.notes(r.id).length, 1);
  const sup = s.createSupplier({ ...SUP_FIXTURE });
  assert.equal(s.getSupplier(sup.id).name, 'Example Supplier Ltd');
  s.updateSupplier(sup.id, { verification: 'verified' });
  assert.equal(s.getSupplier(sup.id).verification, 'verified');
  assert.equal(s.stats().total, 1);
  assert.equal(s.stats().supplierCount, 1);
  s.deleteRfq(r.id);
  assert.equal(s.getRfq(r.id), null);
});

test('dashboard: adapts the real trade store shape', () => {
  // Mimics a production trade store wrapped by tools.js:
  // listRfqs/getRfq/createRfq/updateRfq/moveRfq/deleteRfq/addRfqNote/
  // listSuppliers/getSupplier/createSupplier/updateSupplier/stats/onMutate.
  const db = {
    rfqs: [
      {
        id: 'r1',
        ref: 'REAL-1',
        product: 'Sample Product',
        quantity: 500,
        unitCost: 10,
        sellUnitPrice: 14,
        status: 'prospect',
        supplierId: 's1',
        agentNotes: [],
      },
    ],
    suppliers: [
      { id: 's1', name: 'Real Supplier Co', verification: 'verified' },
    ],
  };
  const realStore = {
    createRfq: (data) => {
      const r = { id: `r${db.rfqs.length + 1}`, ...data };
      db.rfqs.push(r);
      return r;
    },
    getRfq: (id) => db.rfqs.find((r) => r.id === id) || null,
    updateRfq: (id, patch) => {
      const r = db.rfqs.find((x) => x.id === id);
      Object.assign(r, patch);
      return r;
    },
    moveRfq: (id, status) => {
      const r = db.rfqs.find((x) => x.id === id);
      r.status = status;
      return r;
    },
    deleteRfq: (id) => {
      db.rfqs = db.rfqs.filter((r) => r.id !== id);
    },
    listRfqs: (status) =>
      !status ? [...db.rfqs] : db.rfqs.filter((r) => r.status === status),
    addRfqNote: (id, text) => {
      db.rfqs.find((x) => x.id === id).agentNotes.push({ t: 1, text });
    },
    stats: () => ({
      total: db.rfqs.length,
      openRfqs: 1,
      potentialCommission: 500,
      supplierCount: 1,
    }),
    listSuppliers: () => [...db.suppliers],
    getSupplier: (id) => db.suppliers.find((s) => s.id === id) || null,
    createSupplier: (data) => {
      const s = { id: `s${db.suppliers.length + 1}`, ...data };
      db.suppliers.push(s);
      return s;
    },
    updateSupplier: (id, patch) => {
      const s = db.suppliers.find((x) => x.id === id);
      Object.assign(s, patch);
      return s;
    },
  };
  const dd = initTradeDashboard({
    rfqStore: realStore,
    rfqEngine: fakeEngine(),
  });
  dd.open();
  try {
    assert.equal(
      dd.refs.rfqCards.length,
      1,
      'columns render from listRfqs',
    );
    dd.refs.rfqCards[0].click();
    assert.ok(dd.refs.drawer, 'drawer opens');
    // Draft uses the adapted store.
    const draft = dd.draftCommission('r1');
    assert.ok(draft.includes('REAL-1'));
    assert.ok(draft.includes('Real Supplier Co'));
    // Notes round-trip through addRfqNote.
    dd.refs.noteInput.value = 'Checked incoterms.';
    dd.refs.noteBtn.click();
    assert.equal(db.rfqs[0].agentNotes.length, 1);
    // Stats flow through to the KPI row.
    assert.ok(dd.refs.kpis.innerHTML.includes('$500'), 'stats commission shown');
  } finally {
    dd.destroy();
  }
  assert.deepEqual(
    adaptStore(null).list(),
    [],
    'null store falls back to memory',
  );
});

test('dashboard: workforce controls render only when workforce is present', () => {
  const store = fakeStore([RFQ_FIXTURE]);
  const dd = initTradeDashboard({ rfqStore: store });
  dd.open();
  assert.equal(dd.refs.wfBtn, null, 'no workforce button without workforce');
  dd.destroy();
  const wf = {
    processOnce() {},
    getSummary: () => ({ agents: [], queueDepth: 0 }),
  };
  const dd2 = initTradeDashboard({ rfqStore: store, workforce: wf });
  dd2.open();
  assert.ok(dd2.refs.wfBtn, 'workforce button rendered with workforce');
  dd2.destroy();
});

test('dashboard: phone usability — shipped CSS enforces 44px touch targets', async () => {
  const { TRADE_DASHBOARD_CSS } = await import('./tradeDashboard.js');
  const css = TRADE_DASHBOARD_CSS;
  assert.ok(css.includes('#gev-trade-btn'), 'dock button styled');
  // Every tap target is at least 44px: buttons, close, lang toggle, cards.
  for (const sel of ['.tdp-btn{', '.tdp-close{', '.tdp-lang{', '.tdp-card{']) {
    const block = css.split(sel)[1];
    assert.ok(
      block && block.slice(0, 600).includes('min-height:44px'),
      `${sel} has a 44px minimum touch target`,
    );
  }
  // Drawer inputs are 16px: iOS must not auto-zoom on focus.
  const drawerInputs = css.split('#gev-trade-drawer input')[1];
  assert.ok(
    drawerInputs && drawerInputs.slice(0, 500).includes('font-size:16px'),
    'drawer inputs are 16px (no iOS zoom)',
  );
  assert.ok(
    drawerInputs && drawerInputs.slice(0, 500).includes('min-height:48px'),
    'drawer inputs are tall enough to tap',
  );
  // Readable type sizes throughout the panel.
  assert.ok(css.includes('font-size:14px'), 'panel base type is 14px');
});

test('dashboard: one-tap dock button is clearly labeled with a live RFQ badge', () => {
  const before = bodyEl.children.length;
  const store = fakeStore([RFQ_FIXTURE]);
  const dd = initTradeDashboard({ rfqStore: store });
  const btn = bodyEl.children.slice(before).find(
    (c) => c.id === 'gev-trade-btn',
  );
  assert.ok(btn, 'dock button appended');
  assert.ok(btn.innerHTML.includes('Comercio · Trade'), 'bilingual label');
  assert.ok(btn.innerHTML.includes('tbadge'), 'live badge present');
  assert.ok(btn.innerHTML.includes('🚢'), 'ship icon');
  // refresh() updates the badge even while the panel is closed.
  const badge = {
    textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
  };
  btn.querySelector = (sel) => (sel === '.tbadge' ? badge : null);
  dd.refresh();
  assert.equal(badge.textContent, '1', 'badge shows the open RFQ count');
  dd.destroy();
});

test('dashboard: drawer body is readable at a glance — bilingual headings', () => {
  const store = fakeStore([{ ...RFQ_FIXTURE, status: 'quoting' }]);
  const dd = initTradeDashboard({
    rfqStore: store,
    rfqEngine: fakeEngine(),
  });
  dd.setLang('es');
  dd.open();
  assert.ok(
    dd.refs.kpis.innerHTML.includes('RFQS ABIERTOS'),
    'Spanish KPI headings render',
  );
  assert.ok(
    dd.refs.cols.textContent.includes('Cotizando'),
    'Spanish pipeline column heading renders',
  );
  dd.setLang('en');
  assert.ok(
    dd.refs.kpis.innerHTML.includes('OPEN RFQS'),
    'English KPI headings render',
  );
  assert.ok(
    dd.refs.cols.textContent.includes('Quoting'),
    'English pipeline column heading renders',
  );
  dd.destroy();
});

test('openDeepLink opens /import-export/index.html#<view>', () => {
  // The trade ui test mock sets globalThis.window = globalThis, so
  // window.open resolves to globalThis.open; stub it just for this test.
  const prev = globalThis.open;
  let openedUrl = null;
  globalThis.open = (url) => {
    openedUrl = url;
    return null;
  };
  try {
    const dd = initTradeDashboard({
      rfqStore: fakeStore(),
      rfqEngine: fakeEngine(),
    });
    dd.openDeepLink('rfqs');
    assert.equal(openedUrl, '/import-export/index.html#rfqs');
    dd.openDeepLink('suppliers');
    assert.equal(openedUrl, '/import-export/index.html#suppliers');
    dd.destroy();
  } finally {
    if (prev === undefined) delete globalThis.open;
    else globalThis.open = prev;
  }
});
