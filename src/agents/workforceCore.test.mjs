/**
 * Tests for the cross-cutting workforce core (src/agents/workforceCore.js).
 * node:test. Pure functions are tested directly; localStorage-backed
 * functions (logAction, escalate) run against an in-memory fake.
 * No real-world data — fixtures only.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_TIERS,
  LOG_CAP,
  ESCALATION_QUEUE_KEY,
  registerWorkforce,
  logAction,
  escalate,
  classifyTrack,
  SANCTIONS_HARD_STOP,
  checkSanctions,
  LANG_POLICY,
  defaultRoster,
  reviewDraft,
} from './workforceCore.js';

// -- in-memory localStorage fake -------------------------------------------
function makeStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };
}

const savedStorage = globalThis.localStorage;
before(() => {
  globalThis.localStorage = makeStorage();
});
after(() => {
  if (savedStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = savedStorage;
});

function readKey(key) {
  return JSON.parse(globalThis.localStorage.getItem(key));
}

// -- AGENT_TIERS -------------------------------------------------------------
test('AGENT_TIERS has exactly READ/DRAFT/PROPOSE — no execute tier', () => {
  assert.deepEqual({ ...AGENT_TIERS }, {
    READ: 'read',
    DRAFT: 'draft',
    PROPOSE: 'propose',
  });
  assert.ok(!('EXECUTE' in AGENT_TIERS), 'there must be no execute tier');
  assert.ok(Object.isFrozen(AGENT_TIERS));
});

// -- registerWorkforce -------------------------------------------------------
test('registerWorkforce registers a valid roster and returns the record', () => {
  const rec = registerWorkforce('trade', [
    { id: 'sourcing', role: 'sourcing', tier: 'draft', lang: 'bilingual' },
    { id: 'oversight', role: 'oversight', tier: 'read', lang: 'bilingual' },
  ]);
  assert.equal(rec.moduleId, 'trade');
  assert.equal(rec.agents.length, 2);
  assert.equal(rec.agents[0].id, 'sourcing');
  assert.equal(rec.agents[0].tier, 'draft');
  assert.ok(typeof rec.registeredAt === 'number');
});

test('registerWorkforce throws on missing/empty moduleId', () => {
  assert.throws(() => registerWorkforce('', [{ id: 'a', tier: 'read' }]), /moduleId/);
  assert.throws(() => registerWorkforce(null, [{ id: 'a', tier: 'read' }]), /moduleId/);
  assert.throws(() => registerWorkforce('  ', [{ id: 'a', tier: 'read' }]), /moduleId/);
});

test('registerWorkforce throws on missing/empty agents array', () => {
  assert.throws(() => registerWorkforce('trade', []), /agents/);
  assert.throws(() => registerWorkforce('trade', null), /agents/);
  assert.throws(() => registerWorkforce('trade', 'nope'), /agents/);
});

test('registerWorkforce throws on missing agent id', () => {
  assert.throws(
    () => registerWorkforce('trade', [{ role: 'x', tier: 'read' }]),
    /missing id/,
  );
  assert.throws(
    () => registerWorkforce('trade', [{ id: '  ', tier: 'read' }]),
    /missing id/,
  );
});

test('registerWorkforce throws on unknown tier', () => {
  assert.throws(
    () => registerWorkforce('trade', [{ id: 'rogue', tier: 'execute' }]),
    /unknown tier/,
  );
  assert.throws(
    () => registerWorkforce('trade', [{ id: 'rogue', tier: 'EXECUTE' }]),
    /unknown tier/,
  );
  assert.throws(
    () => registerWorkforce('trade', [{ id: 'rogue' }]),
    /unknown tier/,
  );
});

test('registerWorkforce accepts all three valid tiers', () => {
  const rec = registerWorkforce('crude', [
    { id: 'r', tier: 'read' },
    { id: 'd', tier: 'draft' },
    { id: 'p', tier: 'propose' },
  ]);
  assert.deepEqual(rec.agents.map((a) => a.tier), ['read', 'draft', 'propose']);
});

test('registerWorkforce re-registering a module replaces its roster', () => {
  registerWorkforce('energy', [{ id: 'old', tier: 'read' }]);
  const rec = registerWorkforce('energy', [
    { id: 'new1', tier: 'read' },
    { id: 'new2', tier: 'draft' },
  ]);
  assert.deepEqual(rec.agents.map((a) => a.id), ['new1', 'new2']);
});

// -- logAction ---------------------------------------------------------------
test('logAction appends a well-formed entry with registry tier', () => {
  registerWorkforce('trade', [{ id: 'sourcing', tier: 'draft' }]);
  const entry = logAction('trade', 'sourcing', 'drafted shortlist');
  assert.equal(entry.module, 'trade');
  assert.equal(entry.agent, 'sourcing');
  assert.equal(entry.action, 'drafted shortlist');
  assert.equal(entry.tier, 'draft');
  assert.equal(entry.status, 'logged');
  assert.ok(typeof entry.ts === 'number');

  const stored = readKey('sahjony.workforce.trade.log.v1');
  assert.ok(Array.isArray(stored));
  assert.deepEqual(stored[stored.length - 1], entry);
});

test('logAction uses tier "unknown" for unregistered agent/module', () => {
  const entry = logAction('never-registered-mod', 'ghost', 'x');
  assert.equal(entry.tier, 'unknown');
  const stored = readKey('sahjony.workforce.never-registered-mod.log.v1');
  assert.equal(stored.length, 1);
});

test('logAction throws on empty moduleId/agentId', () => {
  assert.throws(() => logAction('', 'a', 'x'), /moduleId/);
  assert.throws(() => logAction('trade', '', 'x'), /agentId/);
});

test('logAction caps the log at LOG_CAP, keeping the newest', () => {
  const mod = 'cap-test-mod';
  globalThis.localStorage.removeItem(`sahjony.workforce.${mod}.log.v1`);
  for (let i = 0; i < LOG_CAP + 5; i++) {
    logAction(mod, 'agent', `action-${i}`);
  }
  const stored = readKey(`sahjony.workforce.${mod}.log.v1`);
  assert.equal(stored.length, LOG_CAP);
  assert.equal(stored[0].action, 'action-5');
  assert.equal(stored[stored.length - 1].action, `action-${LOG_CAP + 4}`);
});

test('logAction coerces non-string actions to strings', () => {
  const entry = logAction('trade', 'sourcing', 42);
  assert.equal(entry.action, '42');
  const entry2 = logAction('trade', 'sourcing', null);
  assert.equal(entry2.action, '');
});

// -- escalate ----------------------------------------------------------------
test('escalate writes an awaiting-juan item to the queue', () => {
  globalThis.localStorage.removeItem(ESCALATION_QUEUE_KEY);
  const payload = { text: '¿Aplica alguna sanción de OFAC?' };
  const item = escalate('energy', 'sanctions', payload);
  assert.equal(item.module, 'energy');
  assert.equal(item.reason, 'sanctions');
  assert.deepEqual(item.payload, payload);
  assert.equal(item.status, 'awaiting-juan');
  assert.ok(typeof item.ts === 'number');

  const queue = readKey(ESCALATION_QUEUE_KEY);
  assert.equal(queue.length, 1);
  assert.deepEqual(queue[0], item);
});

test('escalate appends and never drops queue items', () => {
  escalate('trade', 'sanctions', { text: 'one' });
  escalate('crude', 'counterparty-flag', { text: 'two' });
  const queue = readKey(ESCALATION_QUEUE_KEY);
  assert.equal(queue.length, 3);
  assert.ok(queue.every((i) => i.status === 'awaiting-juan'));
});

test('escalate with undefined payload stores null', () => {
  const item = escalate('cuba', 'sanctions');
  assert.equal(item.payload, null);
});

test('escalate throws on empty reason/moduleId', () => {
  assert.throws(() => escalate('trade', ''), /reason/);
  assert.throws(() => escalate('', 'sanctions'), /moduleId/);
});

// -- classifyTrack -----------------------------------------------------------
const TRACK_CASES = [
  // trade — worldwide global desk (Module 1)
  ['sourcing rice from Vietnam for Houston buyer', 'trade'],
  ['rice for Cuba, FOB Vietnam', 'trade'],
  ['soda ash 210 MT FOB Qingdao quotation', 'trade'],
  ['solicitud de cotización: arroz pilado, 2 contenedores', 'trade'],
  ['supplier quotes for freight Houston to Maracaibo', 'trade'],
  ['RFQ: mercancía en contenedor, embarque CIF', 'trade'],
  // cuba — dedicated Cuba desk (Module 2). Commodity words alone do NOT
  // pull a Cuba-desk message into 'trade'; MIPYME/Cuba-buyer signals win.
  ['solicitud de arroz para MIPYME en La Habana', 'cuba'],
  ['arroz para MIPYME en Santiago de Cuba', 'cuba'],
  ['emprendedor en La Habana busca proveedor de alimentos', 'cuba'],
  ['MIPYME buyer in Havana needs sourcing', 'cuba'],
  ['hola, somos una mipyme en Mariel', 'cuba'],
  // cars
  ['carro en Cuba, precio para gestor', 'cars'],
  ['I want to buy a car through a gestoria', 'cars'],
  ['coche usado, traspaso en La Habana', 'cars'],
  // crude
  ['crude oil cargo WTI 700k barrels laycan', 'crude'],
  ['petróleo crudo Brent para refinería', 'crude'],
  ['buque tanque STS, 500k barriles', 'crude'],
  // energy
  ['precio del diésel EN 590 por IBC', 'energy'],
  ['diesel and gasoline for Cuba, nationalized', 'energy'],
  ['combustible GLP para planta eléctrica', 'energy'],
  // mycubacash
  ['envío de dinero a mi familia en Cuba', 'mycubacash'],
  ['send money to Cuba via cash app', 'mycubacash'],
  ['remesa mensual a La Habana', 'mycubacash'],
  ['recarga para mi mamá en Cuba', 'mycubacash'],
  // unknown
  ['hola buenos días', 'unknown'],
  ['', 'unknown'],
  ['the weather is nice today', 'unknown'],
];

for (const [text, want] of TRACK_CASES) {
  test(`classifyTrack(${JSON.stringify(text)}) → ${want}`, () => {
    assert.equal(classifyTrack(text), want);
  });
}

test('classifyTrack never blends: exactly one of the seven tracks', () => {
  const valid = new Set([
    'trade',
    'cuba',
    'cars',
    'crude',
    'energy',
    'mycubacash',
    'unknown',
  ]);
  for (const [text] of TRACK_CASES) {
    assert.ok(valid.has(classifyTrack(text)), text);
  }
});

test('classifyTrack: trade vs cuba desks stay distinct on commodity words', () => {
  // Worldwide desk: commodity + non-Cuba buyer signals → trade.
  assert.equal(classifyTrack('arroz from Vietnam for Houston'), 'trade');
  // Cuba desk: same commodity + MIPYME buyer → cuba, never blended.
  assert.equal(classifyTrack('arroz from Vietnam for MIPYME buyer'), 'cuba');
  // Bare country mention with trade economics stays on the worldwide desk.
  assert.equal(classifyTrack('rice FOB price for Cuba shipment'), 'trade');
});

test('classifyTrack: Spanish-first weighting favors Cuba tracks in Spanish', () => {
  // 'proveedor' alone is a trade word (weight 2); 'para Cuba' adds the
  // Cuba-desk signal — Spanish-first weighting (2 × 1.5 = 3) beats trade.
  assert.equal(classifyTrack('proveedor para Cuba'), 'cuba');
});

test('classifyTrack: money-movement wins ties (mycubacash priority)', () => {
  assert.equal(classifyTrack('remesa a Cuba'), 'mycubacash');
});

test('classifyTrack is pure: same input, same output, no side effects', () => {
  const a = classifyTrack('diésel para Cuba');
  const b = classifyTrack('diésel para Cuba');
  assert.equal(a, b);
  assert.equal(a, 'energy');
});

test('classifyTrack handles non-string input without throwing', () => {
  assert.equal(classifyTrack(null), 'unknown');
  assert.equal(classifyTrack(undefined), 'unknown');
  assert.equal(classifyTrack(123), 'unknown');
});

// -- SANCTIONS_HARD_STOP / checkSanctions ------------------------------------
test('SANCTIONS_HARD_STOP has the specified gate shape', () => {
  assert.deepEqual({ ...SANCTIONS_HARD_STOP }, {
    gate: 'sanctions',
    action: 'escalate-always',
  });
  assert.ok(Object.isFrozen(SANCTIONS_HARD_STOP));
});

const SANCTIONS_TRUE = [
  '¿Aplica alguna sanción de OFAC a este envío?',
  'hay embargo contra Cuba?',
  'Is this entity on the SDN blacklist?',
  'lista negra de sanciones',
  'denied party screening question',
  'restricted party list',
  'entity list check',
  'SANCTIONS review needed',
];

for (const text of SANCTIONS_TRUE) {
  test(`checkSanctions(${JSON.stringify(text)}) → true`, () => {
    assert.equal(checkSanctions(text), true);
  });
}

test('checkSanctions fires on customs/aduana QUESTIONS', () => {
  assert.equal(checkSanctions('¿cuánto tarda la aduana?'), true);
  assert.equal(checkSanctions('how long does customs clearance take?'), true);
  assert.equal(checkSanctions('cuanto cuesta la aduana en Mariel'), true);
});

test('checkSanctions does NOT fire on routine customs mentions', () => {
  assert.equal(checkSanctions('la aduana de Mariel retuvo el contenedor'), false);
  assert.equal(checkSanctions('customs clearance included in the quote'), false);
});

const SANCTIONS_FALSE = [
  'precio del arroz FOB Qingdao',
  'soda ash 210 MT quotation',
  'hola buenos días',
  '',
];

for (const text of SANCTIONS_FALSE) {
  test(`checkSanctions(${JSON.stringify(text)}) → false`, () => {
    assert.equal(checkSanctions(text), false);
  });
}

test('checkSanctions handles non-string input', () => {
  assert.equal(checkSanctions(null), false);
  assert.equal(checkSanctions(undefined), false);
});

// -- LANG_POLICY -------------------------------------------------------------
test('LANG_POLICY matches the architecture doc', () => {
  assert.deepEqual({ ...LANG_POLICY }, {
    cuba: 'es-first',
    cars: 'es-first',
    energy: 'es-first',
    trade: 'bilingual',
    crude: 'bilingual',
  });
  assert.ok(Object.isFrozen(LANG_POLICY));
});

// -- defaultRoster -----------------------------------------------------------
test('defaultRoster returns the 8-agent deal-flow roster', () => {
  const roster = defaultRoster('trade');
  assert.equal(roster.length, 8);
  assert.deepEqual(
    roster.map((a) => a.id),
    [
      'sourcing',
      'counterparty-diligence',
      'pricing-economics',
      'logistics',
      'compliance',
      'outreach-drafting',
      'follow-up',
      'oversight',
    ],
  );
});

test('defaultRoster tiers: outreach-drafting and follow-up are DRAFT only', () => {
  const byId = Object.fromEntries(
    defaultRoster('trade').map((a) => [a.id, a]),
  );
  assert.equal(byId['outreach-drafting'].tier, AGENT_TIERS.DRAFT);
  assert.equal(byId['follow-up'].tier, AGENT_TIERS.DRAFT);
});

test('defaultRoster tiers: compliance is READ; nothing above PROPOSE', () => {
  const roster = defaultRoster('energy');
  const byId = Object.fromEntries(roster.map((a) => [a.id, a]));
  assert.equal(byId['compliance'].tier, AGENT_TIERS.READ);
  assert.equal(byId['pricing-economics'].tier, AGENT_TIERS.READ);
  assert.equal(byId['logistics'].tier, AGENT_TIERS.READ);
  assert.equal(byId['oversight'].tier, AGENT_TIERS.READ);
  assert.equal(byId['sourcing'].tier, AGENT_TIERS.DRAFT);
  assert.equal(byId['counterparty-diligence'].tier, AGENT_TIERS.PROPOSE);
  const allowed = new Set(Object.values(AGENT_TIERS));
  for (const agent of roster) {
    assert.ok(allowed.has(agent.tier), `agent ${agent.id} tier ${agent.tier}`);
  }
});

test('defaultRoster sets module and lang per LANG_POLICY', () => {
  const esRoster = defaultRoster('cuba');
  assert.ok(esRoster.every((a) => a.module === 'cuba'));
  assert.ok(esRoster.every((a) => a.lang === 'es-first'));
  const biRoster = defaultRoster('crude');
  assert.ok(biRoster.every((a) => a.lang === 'bilingual'));
  // mycubacash is not in LANG_POLICY; Cuba-facing convention → es-first.
  const cashRoster = defaultRoster('mycubacash');
  assert.ok(cashRoster.every((a) => a.lang === 'es-first'));
});

test('defaultRoster agents carry bilingual names', () => {
  for (const agent of defaultRoster('trade')) {
    assert.ok(
      typeof agent.name.es === 'string' && agent.name.es.length > 0,
      agent.id,
    );
    assert.ok(
      typeof agent.name.en === 'string' && agent.name.en.length > 0,
      agent.id,
    );
  }
});

test('defaultRoster is pure: fresh objects every call', () => {
  const a = defaultRoster('trade');
  const b = defaultRoster('trade');
  assert.notEqual(a, b);
  assert.notEqual(a[0], b[0]);
  assert.notEqual(a[0].name, b[0].name);
  a[0].tier = 'hacked';
  assert.equal(defaultRoster('trade')[0].tier, AGENT_TIERS.DRAFT);
});

test('defaultRoster throws on empty moduleId', () => {
  assert.throws(() => defaultRoster(''), /moduleId/);
});

test('defaultRoster output passes registerWorkforce validation', () => {
  const roster = defaultRoster('cars');
  const rec = registerWorkforce(
    'cars',
    roster.map((a) => ({ id: a.id, role: a.role, tier: a.tier, lang: a.lang })),
  );
  assert.equal(rec.agents.length, 8);
});

// -- reviewDraft -------------------------------------------------------------
test('reviewDraft passes a clean draft', () => {
  const result = reviewDraft({
    es: 'Borrador: cotización aproximada de $265/MT según la oferta recibida. Pendiente de aprobación.',
    en: 'Draft: estimated quote ~$265/MT per the received offer. Pending approval.',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.flags, []);
});

test('reviewDraft flags guarantee language (GUARANTEE)', () => {
  const result = reviewDraft('Te garantizo que el precio no va a subir.');
  assert.equal(result.ok, false);
  assert.ok(result.flags.some((f) => f.code === 'GUARANTEE'));
});

test('reviewDraft flags committed prices (PRICE_COMMIT)', () => {
  const result = reviewDraft('El precio final es $265 por tonelada.');
  assert.ok(result.flags.some((f) => f.code === 'PRICE_COMMIT'));
});

test('reviewDraft flags availability stated as fact (AVAILABILITY)', () => {
  const result = reviewDraft('Tenemos el diésel en stock en Mariel.');
  assert.ok(result.flags.some((f) => f.code === 'AVAILABILITY'));
});

test('reviewDraft flags promised timelines (TIMELINE)', () => {
  const result = reviewDraft('Guaranteed delivery in 10 days.');
  assert.ok(result.flags.some((f) => f.code === 'TIMELINE'));
});

test('reviewDraft flags invented counterparties (COUNTERPARTY)', () => {
  const result = reviewDraft('Nuestro proveedor en Qingdao ya confirmó.');
  assert.ok(result.flags.some((f) => f.code === 'COUNTERPARTY'));
});

test('reviewDraft flags invented track records (TRACK_RECORD)', () => {
  const result = reviewDraft('We have sold 50 containers to our clients.');
  assert.ok(result.flags.some((f) => f.code === 'TRACK_RECORD'));
});

test('reviewDraft flags unqualified $ amounts (PRICE_AS_FACT)', () => {
  const result = reviewDraft('El costo es $12,500 por el embarque.');
  assert.ok(result.flags.some((f) => f.code === 'PRICE_AS_FACT'));
});

test('reviewDraft does NOT flag $ amounts with quote/estimate qualifiers', () => {
  const clean = reviewDraft(
    'Cotización recibida: aprox $12,500 por embarque (estimado).',
  );
  assert.ok(!clean.flags.some((f) => f.code === 'PRICE_AS_FACT'));
});

test('reviewDraft flags carry code, match snippet, and bilingual notes', () => {
  const result = reviewDraft('Te garantizo entrega inmediata.');
  assert.ok(result.flags.length >= 1);
  for (const flag of result.flags) {
    assert.ok(typeof flag.code === 'string' && flag.code.length > 0);
    assert.ok(typeof flag.match === 'string' && flag.match.length > 0);
    assert.ok(typeof flag.es === 'string' && flag.es.length > 0);
    assert.ok(typeof flag.en === 'string' && flag.en.length > 0);
  }
});

test('reviewDraft accepts a plain string or {es,en} or {text}', () => {
  assert.equal(reviewDraft('borrador limpio sin promesas').ok, true);
  assert.equal(reviewDraft({ text: 'borrador limpio' }).ok, true);
  assert.equal(reviewDraft({ es: 'te garantizo todo' }).ok, false);
});

test('reviewDraft handles empty/missing input', () => {
  assert.deepEqual(reviewDraft(''), { ok: true, flags: [] });
  assert.deepEqual(reviewDraft(null), { ok: true, flags: [] });
  assert.deepEqual(reviewDraft({}), { ok: true, flags: [] });
});

test('reviewDraft is pure: identical input, identical output', () => {
  const text = 'Precio final $100, te lo garantizo.';
  const a = reviewDraft(text);
  const b = reviewDraft(text);
  assert.deepEqual(a, b);
  assert.equal(a.ok, false);
});
