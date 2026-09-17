import { test } from 'node:test';
import assert from 'node:assert/strict';

// These modules never import cesium, so the DOM double can be installed
// before the import without breaking anything.
const {
  initDealDashboard,
  parseLeadsCsv,
  leadsToCsv,
  csvTemplate,
  dealMath,
  scorePillClass,
  draftOfferText,
  createMemoryLeadStore,
  STATUSES,
} = await import('./dealDashboard.js');

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
    appendChild(c) { this.children.push(c); return c; },
    remove() { this.removed = true; },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener(type, fn) { this._handlers[type] = fn; },
    removeEventListener() {},
    click() { if (typeof this._handlers.click === 'function') this._handlers.click(); },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  return el;
}

const bodyEl = makeEl();
let openedUrl = null;

globalThis.window = globalThis;
globalThis.window.open = (url) => {
  openedUrl = url;
  return null;
};
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

const SAMPLE_CSV = [
  'address,city,state,zip,score,status,condition,arv,repairs,targetFee,contractPrice,notes',
  '"123 Main St",Houston,TX,77002,82,new,Good,180000,25000,15000,,Motivated owner',
  '"456 Oak Ave",Houston,TX,77003,45,researching,Fair,150000,40000,12000,90000,Needs roof',
].join('\n');

function fakeStore(seed = []) {
  return createMemoryLeadStore(seed);
}

test('dashboard: renders KPIs from stats double', () => {
  const store = fakeStore([
    { address: 'A', score: 80, arv: 200000, targetFee: 15000 },
    { address: 'B', score: 60, arv: 100000, targetFee: 10000 },
  ]);
  const dd = initDealDashboard({ leadStore: store });
  dd.open();
  const stats = store.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.avgScore, 70);
  assert.equal(stats.pipelineValue, 300000);
  assert.equal(stats.potentialFees, 25000);
  assert.ok(dd.refs.kpis, 'KPI container ref exists');
  assert.ok(dd.refs.kpis.innerHTML.includes('2'), 'total leads rendered');
  dd.destroy();
});

test('dashboard: CSV import button exists and importCsvText works without network', () => {
  const store = fakeStore();
  const dd = initDealDashboard({ leadStore: store });
  dd.open();
  assert.ok(dd.refs.importBtn, 'import button ref exists');
  assert.ok(dd.refs.exportBtn, 'export button ref exists');
  assert.ok(dd.refs.templateBtn, 'template button ref exists');
  const added = dd.importCsvText(SAMPLE_CSV);
  assert.equal(added.length, 2);
  assert.equal(store.list().length, 2);
  assert.equal(store.list('new').length, 1);
  dd.destroy();
});

test('dashboard: draft offer produces bilingual text without network', () => {
  const store = fakeStore([
    { address: '123 Main St', arv: 180000, repairs: 25000, targetFee: 15000, contractPrice: 100000 },
  ]);
  const dd = initDealDashboard({ leadStore: store });
  dd.addBuyer('Cash Buyer One', 130000);
  const lead = store.list()[0];
  const es = dd.draftOffer(lead.id);
  assert.ok(es.includes('Juan Gonzalez'), 'first-person signer present');
  assert.ok(es.includes('inversionista privado'), 'spanish draft');
  assert.ok(es.toLowerCase().includes('no es asesoría legal'), 'not-legal-advice line');
  assert.ok(!/https?:\/\//.test(es), 'no network URLs in draft');
  dd.setLang('en');
  const en = dd.draftOffer(lead.id);
  assert.ok(en.includes('private investor'), 'english draft');
  assert.ok(en.toLowerCase().includes('not legal advice'), 'english legal line');
  dd.destroy();
});

test('dashboard: drawer opens on card click and edits persist', () => {
  const store = fakeStore([{ address: '789 Pine Rd', score: 90, arv: 200000, repairs: 20000, targetFee: 15000 }]);
  const dd = initDealDashboard({ leadStore: store });
  dd.open();
  assert.equal(dd.refs.leadCards.length, 1);
  const card = dd.refs.leadCards[0];
  card.click();
  const lead = store.list()[0];
  assert.ok(dd.refs.drawer, 'drawer rendered');
  assert.ok(dd.refs.draftBtn, 'draft offer button rendered');
  // Draft offer button click renders the draft text in-panel.
  dd.refs.draftBtn.click();
  assert.ok(dd.refs.draftPre, 'draft <pre> rendered');
  assert.ok(dd.refs.draftPre.textContent.includes('Juan Gonzalez'));
  // Notes timeline works.
  dd.refs.noteInput.value = 'Called the owner, wants cash fast.';
  dd.refs.noteBtn.click();
  assert.equal(store.notes(lead.id).length, 1);
  dd.destroy();
});

test('dashboard: pipeline columns cover all statuses', () => {
  const dd = initDealDashboard({ leadStore: fakeStore() });
  assert.equal(STATUSES.length, 8);
  dd.destroy();
});

test('parseLeadsCsv: parses header + rows, numbers, quoted fields', () => {
  const leads = parseLeadsCsv(SAMPLE_CSV);
  assert.equal(leads.length, 2);
  assert.equal(leads[0].address, '123 Main St');
  assert.equal(leads[0].score, 82);
  assert.equal(leads[0].arv, 180000);
  assert.equal(leads[1].status, 'researching');
  assert.equal(leads[1].contractPrice, 90000);
  assert.deepEqual(parseLeadsCsv(''), []);
  assert.deepEqual(parseLeadsCsv('address\n'), []);
});

test('leadsToCsv + csvTemplate round-trip', () => {
  const leads = parseLeadsCsv(SAMPLE_CSV);
  const out = leadsToCsv(leads);
  assert.ok(out.startsWith('address,city,state,zip'));
  const back = parseLeadsCsv(out);
  assert.equal(back.length, 2);
  assert.equal(back[0].address, '123 Main St');
  assert.ok(csvTemplate().includes('address,city'));
});

test('dealMath: MAO and per-buyer fee ranking', () => {
  const lead = { arv: 200000, repairs: 30000, targetFee: 15000, contractPrice: 100000 };
  const buyers = [
    { name: 'Buyer A', maxOffer: 120000 },
    { name: 'Buyer B', maxOffer: 140000 },
  ];
  const { mao, fees } = dealMath(lead, buyers);
  assert.equal(mao, 95000); // 200000*0.7 - 30000 - 15000
  assert.equal(fees[0].buyer, 'Buyer B');
  assert.equal(fees[0].fee, 40000);
  assert.equal(fees[0].status, 'green');
  assert.equal(fees[1].status, 'green');
  const neg = dealMath(lead, [{ name: 'Cheap', maxOffer: 80000 }]);
  assert.equal(neg.fees[0].fee, -20000);
  assert.equal(neg.fees[0].status, 'red');
});

test('scorePillClass thresholds', () => {
  assert.equal(scorePillClass(85), 'green');
  assert.equal(scorePillClass(70), 'green');
  assert.equal(scorePillClass(55), 'yellow');
  assert.equal(scorePillClass(40), 'yellow');
  assert.equal(scorePillClass(20), 'red');
  assert.equal(scorePillClass(NaN), 'gray');
});

test('draftOfferText: pure, bilingual, no network', () => {
  const lead = { address: '1 Test Way', arv: 180000, repairs: 25000, targetFee: 15000, contractPrice: 110000 };
  const buyers = [{ name: 'Fast Cash LLC', maxOffer: 135000 }];
  const es = draftOfferText(lead, buyers, 'es');
  const en = draftOfferText(lead, buyers, 'en');
  assert.ok(es.includes('Yo, Juan Gonzalez, inversionista privado'));
  assert.ok(es.includes('BORRADOR DE OFERTA — NO ENVIADO'));
  assert.ok(en.includes('I, Juan Gonzalez, private investor'));
  assert.ok(en.includes('DRAFT OFFER — NOT SENT'));
  assert.ok(es.includes('Fast Cash LLC'));
  assert.ok(!/fetch\(|XMLHttpRequest|https?:\/\//.test(es + en));
});

test('window.__gevWholesale is exposed', () => {
  const dd = initDealDashboard({});
  assert.equal(globalThis.__gevWholesale, dd);
  dd.destroy();
});

test('dashboard: adapts the real wholesale store shape', () => {
  // Mimics src/wholesale/leadStore.js: listLeads/getLead/updateLead/
  // createLead/addAgentNote/listBuyers/addBuyer/stats.
  const db = {
    leads: [{ id: 'l1', address: '1 Real Way', status: 'new', score: 75, arv: 160000, repairs: 20000, targetFee: 12000, contractPrice: 95000, notes: [] }],
    buyers: [{ id: 'b1', name: 'Real Cash LLC', buyBox: { maxPrice: 120000 } }],
  };
  const realStore = {
    listLeads: (filter) => !filter ? [...db.leads] : db.leads.filter((l) => l.status === filter.status),
    getLead: (id) => db.leads.find((l) => l.id === id) || null,
    updateLead: (id, patch) => { const l = db.leads.find((x) => x.id === id); Object.assign(l, patch); return l; },
    createLead: (data) => { const l = { id: `l${db.leads.length + 1}`, ...data }; db.leads.push(l); return l; },
    addAgentNote: (leadId, agent, es, en) => { const l = db.leads.find((x) => x.id === leadId); l.notes.push({ t: 1, agent, es, en }); },
    listBuyers: () => [...db.buyers],
    addBuyer: (data) => { const b = { id: `b${db.buyers.length + 1}`, ...data }; db.buyers.push(b); return b; },
    stats: () => ({ total: db.leads.length, avgScore: 75, pipelineValue: 160000, potentialFees: 12000 }),
  };
  const dd = initDealDashboard({ leadStore: realStore });
  dd.open();
  assert.equal(dd.refs.leadCards.length, 1, 'columns render from listLeads');
  assert.deepEqual(dd.getBuyers().map((b) => b.name), ['Real Cash LLC'], 'buyers seed from store (buyBox.maxPrice)');
  assert.equal(dd.getBuyers()[0].maxOffer, 120000);
  // Buyer add persists to the real store.
  dd.addBuyer('Second Buyer', 110000);
  assert.equal(db.buyers.length, 2);
  // Notes round-trip through addAgentNote.
  dd.refs.leadCards[0].click();
  dd.refs.noteInput.value = 'Owner called back.';
  dd.refs.noteBtn.click();
  assert.equal(db.leads[0].notes.length, 1);
  assert.equal(db.leads[0].notes[0].es, 'Owner called back.');
  // Draft offer uses the real buyer's max offer.
  const draft = dd.draftOffer('l1');
  assert.ok(draft.includes('Real Cash LLC'));
  dd.destroy();
});

test('openDeepLink opens /wholesale/index.html#<view>', () => {
  openedUrl = null;
  const dd = initDealDashboard({ leadStore: fakeStore() });
  dd.openDeepLink('pipeline');
  assert.equal(openedUrl, '/wholesale/index.html#pipeline');
  dd.openDeepLink('buyers');
  assert.equal(openedUrl, '/wholesale/index.html#buyers');
  dd.destroy();
});
