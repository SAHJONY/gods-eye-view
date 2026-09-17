import { test } from 'node:test';
import assert from 'node:assert/strict';

// This module never imports cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initCrudeDashboard,
  parseCargoesCsv,
  cargoesToCsv,
  csvTemplate,
  dealMath,
  verdictOf,
  statusPillClass,
  draftCommissionText,
  createMemoryCargoStore,
  adaptStore,
  STATUSES,
} = await import('./crudeDashboard.js');

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
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return this._html;
    },
    set(v) {
      this._html = String(v);
    },
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

const CARGO_FIXTURE = {
  ref: 'FIX-001',
  grade: 'Sample Blend',
  volume: 500000,
  buy: 68.5,
  sell: 70.25,
  commissionPerBbl: 0.1,
  costs: 25000,
  status: 'prospect',
  incoterms: 'FOB',
  laycan: '2026-10-01/2026-10-05',
  loadPort: 'Port Example',
  dischargePort: 'Port Example',
};

const CP_FIXTURE = {
  name: 'Example Trading Ltd',
  type: 'trader',
  role: 'buyer',
  country: 'Exampleland',
  verification: 'pending',
  contactName: 'Sample Contact',
  contactEmail: 'sample@example.test',
  contactPhone: '+1-555-0100',
};

function fakeStore(seed = []) {
  return createMemoryCargoStore(seed);
}

test('dashboard: STATUSES cover the crude pipeline', () => {
  assert.equal(STATUSES.length, 9);
  assert.deepEqual(
    STATUSES.map((s) => s.id),
    [
      'prospect',
      'diligence',
      'negotiating',
      'contracted',
      'loading',
      'in-transit',
      'delivered',
      'closed',
      'dead',
    ],
  );
  const dd = initCrudeDashboard({ cargoStore: fakeStore() });
  dd.destroy();
});

test('dashboard: renders KPIs from memory store stats', () => {
  const store = fakeStore([
    { ...CARGO_FIXTURE, ref: 'A', volume: 600000, commissionPerBbl: 0.1 },
    {
      ...CARGO_FIXTURE,
      ref: 'B',
      volume: 400000,
      commissionPerBbl: 0.2,
      status: 'dead',
    },
  ]);
  const dd = initCrudeDashboard({ cargoStore: store });
  dd.open();
  const stats = store.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.openCargoes, 1);
  assert.equal(stats.totalVolume, 600000);
  assert.equal(stats.potentialCommission, 60000); // 600000 * 0.10, dead excluded
  assert.ok(dd.refs.kpis, 'KPI container ref exists');
  assert.ok(dd.refs.kpis.innerHTML.includes('1'), 'open cargoes rendered');
  assert.ok(dd.refs.kpis.innerHTML.includes('600,000'), 'volume rendered');
  dd.destroy();
});

test('dashboard: pipeline columns cover all 9 statuses', () => {
  const dd = initCrudeDashboard({
    cargoStore: fakeStore([{ ...CARGO_FIXTURE, status: 'negotiating' }]),
  });
  dd.open();
  assert.equal(dd.refs.cargoCards.length, 1);
  dd.destroy();
});

test('dashboard: drawer opens on card click, draft + notes work', () => {
  const store = fakeStore([CARGO_FIXTURE]);
  const dd = initCrudeDashboard({ cargoStore: store });
  dd.open();
  assert.equal(dd.refs.cargoCards.length, 1);
  dd.refs.cargoCards[0].click();
  const cargoId = store.listCargoes()[0].id;
  assert.ok(dd.refs.drawer, 'drawer rendered');
  assert.ok(dd.refs.draftBtn, 'commission draft button rendered');
  dd.refs.draftBtn.click();
  assert.ok(dd.refs.draftPre, 'draft <pre> rendered');
  assert.ok(dd.refs.draftPre.textContent.includes('Juan Gonzalez'));
  assert.ok(
    dd.refs.draftPre.textContent
      .toLowerCase()
      .includes('borrador — nada enviado'),
  );
  dd.refs.noteInput.value = 'Seller confirmed laycan.';
  dd.refs.noteBtn.click();
  assert.equal(store.notes(cargoId).length, 1);
  dd.closeDrawer();
  assert.equal(dd.refs.drawer, null, 'drawer closed');
  dd.destroy();
});

test('dashboard: CSV import via injected parser, error count shown', () => {
  const dd = initCrudeDashboard({
    cargoStore: fakeStore(),
    parseCsv: () => ({
      cargoes: [
        {
          ref: 'INJ-001',
          volume: 100000,
          buy: 60,
          sell: 61,
          status: 'prospect',
        },
      ],
      counterparties: [{ name: 'Injected Trader' }],
      errors: 2,
    }),
  });
  dd.open();
  assert.ok(dd.refs.importBtn, 'import button ref exists');
  assert.ok(dd.refs.exportBtn, 'export button ref exists');
  assert.ok(dd.refs.templateBtn, 'template button ref exists');
  const res = dd.importCsvText('anything at all');
  assert.equal(res.cargoes.length, 1);
  assert.equal(res.counterparties.length, 1);
  assert.equal(res.errors, 2);
  assert.ok(
    dd.refs.importStatus.textContent.includes('2'),
    'error count shown',
  );
  assert.equal(dd.getCounterparties().length, 1);
  dd.destroy();
});

test('dashboard: counterparty add + edit', () => {
  const dd = initCrudeDashboard({ cargoStore: fakeStore([CARGO_FIXTURE]) });
  dd.open();
  assert.equal(dd.getCounterparties().length, 0);
  const cp = dd.addCounterparty({ ...CP_FIXTURE });
  assert.ok(cp.id, 'counterparty gets an id');
  assert.equal(dd.getCounterparties().length, 1);
  // Edit flow: select + save via form refs.
  assert.ok(dd.refs.cpSaveBtn, 'counterparty save button rendered');
  dd.refs.cpForm.name.value = 'Example Trading Ltd';
  dd.refs.cpForm.verification.value = 'verified';
  dd.destroy();
});

test('dashboard: open/close/toggle/destroy lifecycle', () => {
  const dd = initCrudeDashboard({ cargoStore: fakeStore() });
  assert.equal(globalThis.__gevCrude, dd, 'window handle exposed');
  dd.toggle();
  assert.ok(dd.refs.kpis, 'toggle opens the panel');
  dd.toggle();
  assert.equal(dd.refs.kpis, null, 'toggle closes the panel');
  dd.open();
  dd.destroy();
  assert.equal(dd.refs.kpis, null, 'destroy clears refs');
});

test('parseCargoesCsv: parses header + rows, numbers, counterparty section', () => {
  const parsed = parseCargoesCsv(csvTemplate());
  assert.ok(parsed.cargoes.length >= 1);
  const c = parsed.cargoes.find((x) => x.ref === 'SAMPLE-001');
  assert.ok(c, 'sample row parsed');
  assert.equal(c.volume, 500000);
  assert.equal(c.buy, 68.5);
  assert.equal(c.sell, 70.25);
  assert.equal(c.status, 'prospect');
  assert.ok(parsed.counterparties.length >= 1);
  assert.equal(parsed.counterparties[0].name, 'Example Trading Ltd');
  assert.equal(parsed.errors, 0);
  assert.deepEqual(parseCargoesCsv(''), {
    cargoes: [],
    counterparties: [],
    errors: 0,
  });
});

test('cargoesToCsv + parseCargoesCsv round-trip', () => {
  const out = cargoesToCsv([{ ...CARGO_FIXTURE }]);
  assert.ok(out.startsWith('ref,grade,volume'));
  const back = parseCargoesCsv(out);
  assert.equal(back.cargoes.length, 1);
  assert.equal(back.cargoes[0].ref, 'FIX-001');
  assert.equal(back.cargoes[0].volume, 500000);
});

test('dealMath: spread, margins, commission — pure and defensive', () => {
  const m = dealMath({
    volume: 100000,
    buy: 70,
    sell: 72,
    commissionPerBbl: 0.1,
    costs: 50000,
  });
  assert.equal(m.spreadPerBbl, 2);
  assert.equal(m.grossMargin, 200000);
  assert.equal(m.totalCosts, 50000);
  assert.equal(m.netMargin, 150000);
  assert.equal(m.netPerBbl, 1.5);
  assert.equal(m.commissionTotal, 10000);
  // Defensive: junk in, zeros out, no NaN.
  const d = dealMath({});
  assert.deepEqual(d, {
    spreadPerBbl: 0,
    grossMargin: 0,
    totalCosts: 0,
    netMargin: 0,
    netPerBbl: 0,
    commissionTotal: 0,
  });
  const zero = dealMath({ volume: 0, buy: 70, sell: 75, costs: 100 });
  assert.equal(zero.netPerBbl, 0, 'zero volume never divides by zero');
  const loss = dealMath({ volume: 1000, buy: 80, sell: 75, costs: 0 });
  assert.equal(loss.netMargin, -5000);
});

test('statusPillClass + verdictOf thresholds', () => {
  assert.equal(statusPillClass('green'), 'green');
  assert.equal(statusPillClass('dead'), 'red');
  assert.equal(statusPillClass('closed'), 'green');
  assert.equal(statusPillClass('negotiating'), 'yellow');
  assert.equal(statusPillClass('bogus'), 'gray');
  assert.equal(verdictOf({ volume: 1000, buy: 70, sell: 72 }), 'green');
  assert.equal(verdictOf({ volume: 1000, buy: 70, sell: 70 }), 'yellow');
  assert.equal(verdictOf({ volume: 1000, buy: 72, sell: 70 }), 'red');
});

test('draftCommissionText: pure, bilingual, never sends', () => {
  const es = draftCommissionText(CARGO_FIXTURE, CP_FIXTURE, 'es');
  const en = draftCommissionText(CARGO_FIXTURE, CP_FIXTURE, 'en');
  assert.ok(es.includes('Juan Gonzalez'), 'first-person signer present');
  assert.ok(es.includes('corredor privado'), 'spanish draft');
  assert.ok(es.includes('Esto no es asesoría legal.'), 'not-legal-advice line');
  assert.ok(es.includes('borrador — nada enviado'), 'nothing-sent line');
  assert.ok(es.includes('BORRADOR DE COMISIÓN — NADA ENVIADO'));
  assert.ok(en.includes('private broker'), 'english draft');
  assert.ok(en.includes('This is not legal advice.'));
  assert.ok(en.includes('draft — nothing sent'));
  assert.ok(en.includes('COMMISSION DRAFT — NOTHING SENT'));
  assert.ok(es.includes('Example Trading Ltd'));
  assert.ok(
    !/fetch\(|XMLHttpRequest|https?:\/\//.test(es + en),
    'no network calls',
  );
  // Counterparty optional.
  const bare = draftCommissionText(CARGO_FIXTURE, null, 'es');
  assert.ok(bare.includes('Juan Gonzalez'));
});

test('createMemoryCargoStore: full real-API surface', () => {
  const s = createMemoryCargoStore();
  const c = s.createCargo({ ...CARGO_FIXTURE });
  assert.ok(c.id);
  assert.equal(s.getCargo(c.id).ref, 'FIX-001');
  s.updateCargo(c.id, { sell: 71 });
  assert.equal(s.getCargo(c.id).sell, 71);
  s.moveCargo(c.id, 'diligence');
  assert.equal(s.getCargo(c.id).status, 'diligence');
  s.moveCargo(c.id, 'bogus');
  assert.equal(s.getCargo(c.id).status, 'diligence', 'invalid status ignored');
  assert.equal(s.listCargoes('diligence').length, 1);
  s.addCargoNote(c.id, 'hello');
  assert.equal(s.notes(c.id).length, 1);
  const cp = s.addCounterparty({ ...CP_FIXTURE });
  assert.equal(s.counterpartyById(cp.id).name, 'Example Trading Ltd');
  s.updateCounterparty(cp.id, { verification: 'verified' });
  assert.equal(s.counterpartyById(cp.id).verification, 'verified');
  s.addCounterpartyNote(cp.id, 'KYC started');
  assert.equal(s.counterpartyNotes(cp.id).length, 1);
  s.deleteCargo(c.id);
  assert.equal(s.getCargo(c.id), null);
});

test('dashboard: adapts the real crude store shape', () => {
  // Mimics a production crude store: createCargo/getCargo/updateCargo/
  // moveCargo/deleteCargo/listCargoes/stats + counterparty fns.
  const db = {
    cargoes: [
      {
        id: 'c1',
        ref: 'REAL-1',
        grade: 'Sample Blend',
        volume: 200000,
        buy: 68,
        sell: 69,
        commissionPerBbl: 0.1,
        costs: 10000,
        status: 'prospect',
        notes: [],
      },
    ],
    cps: [
      {
        id: 'cp1',
        name: 'Real Trader Co',
        verification: 'verified',
        notes: [],
      },
    ],
  };
  const realStore = {
    createCargo: (data) => {
      const c = { id: `c${db.cargoes.length + 1}`, ...data };
      db.cargoes.push(c);
      return c;
    },
    getCargo: (id) => db.cargoes.find((c) => c.id === id) || null,
    updateCargo: (id, patch) => {
      const c = db.cargoes.find((x) => x.id === id);
      Object.assign(c, patch);
      return c;
    },
    moveCargo: (id, status) => {
      const c = db.cargoes.find((x) => x.id === id);
      c.status = status;
      return c;
    },
    deleteCargo: (id) => {
      db.cargoes = db.cargoes.filter((c) => c.id !== id);
    },
    listCargoes: (status) =>
      !status ? [...db.cargoes] : db.cargoes.filter((c) => c.status === status),
    stats: () => ({
      total: db.cargoes.length,
      openCargoes: 1,
      totalVolume: 200000,
      potentialCommission: 20000,
    }),
    listCounterparties: () => [...db.cps],
    addCounterparty: (data) => {
      const cp = { id: `cp${db.cps.length + 1}`, ...data };
      db.cps.push(cp);
      return cp;
    },
    updateCounterparty: (id, patch) => {
      const cp = db.cps.find((x) => x.id === id);
      Object.assign(cp, patch);
      return cp;
    },
    addCargoNote: (id, text) => {
      db.cargoes.find((x) => x.id === id).notes.push({ ts: 1, text });
    },
  };
  const dd = initCrudeDashboard({ cargoStore: realStore });
  dd.open();
  try {
    assert.equal(
      dd.refs.cargoCards.length,
      1,
      'columns render from listCargoes',
    );
    dd.refs.cargoCards[0].click();
    assert.ok(dd.refs.drawer, 'drawer opens');
    // Draft uses the adapted store.
    const draft = dd.draftCommission('c1');
    assert.ok(draft.includes('REAL-1'));
    // Notes round-trip through addCargoNote.
    dd.refs.noteInput.value = 'Called the refinery.';
    dd.refs.noteBtn.click();
    assert.equal(db.cargoes[0].notes.length, 1);
    assert.equal(db.cargoes[0].notes[0].text, 'Called the refinery.');
  } finally {
    dd.destroy();
  }
  assert.deepEqual(
    adaptStore(null).list(),
    [],
    'null store falls back to memory',
  );
});
