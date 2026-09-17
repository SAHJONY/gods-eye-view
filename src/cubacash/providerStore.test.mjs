import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  PROVIDER_STATUSES,
  STATUS_LABELS,
  CHANNELS,
  chicagoIso,
  createProvider,
  getProvider,
  updateProvider,
  moveProvider,
  deleteProvider,
  listProviders,
  addProviderNote,
  createCorridor,
  getCorridor,
  updateCorridor,
  deleteCorridor,
  listCorridors,
  addCorridorNote,
  stats,
  asWorkforceStore,
  findDuplicateProvider,
  resetCubacashStore,
  reloadCubacashStore,
  applyAuditSeed,
} from './providerStore.js';

const SEED_NAMES = [
  'Western Union',
  'Cubamax',
  'Sendvalu',
  'Fonmoney',
  'Correos España',
  'Íkualo Rem',
];

const FIXTURE_PROVIDER = {
  name: 'ACME REMIT (fixture)',
  channels: ['app', 'web'],
  coverageCountries: ['FICTITIA', 'FICTITIA'],
  feeModel: { type: 'percentage', pct: 1.25, min: 1, max: 12 },
  status: 'candidate',
  website: 'https://example.com (fixture)',
};

const FIXTURE_CORRIDOR = {
  fromCountry: 'Spain (fixture)',
  toCountry: 'Cuba (fixture)',
  sendAmount: 100,
  notes: 'fixture',
};

beforeEach(() => {
  // Fresh state, then reseed — every test starts with exactly the 6 seeds.
  resetCubacashStore();
  reloadCubacashStore();
});

test('chicagoIso: matches America/Chicago offset format', () => {
  const iso = chicagoIso(new Date('2026-09-17T05:00:00Z'));
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  // 05:00 UTC = 00:00 CDT on 2026-09-17
  assert.ok(iso.startsWith('2026-09-17T00:00:00-05:00'), iso);
});

test('constants: frozen, bilingual, correct key', () => {
  assert.equal(STORAGE_KEY, 'sahjony.cubacash.v1');
  assert.ok(Object.isFrozen(PROVIDER_STATUSES));
  assert.ok(Object.isFrozen(CHANNELS));
  assert.deepEqual([...PROVIDER_STATUSES], [
    'candidate',
    'verifying',
    'live',
    'paused',
  ]);
  assert.deepEqual([...CHANNELS], ['app', 'web', 'whatsapp', 'agent', 'retail']);
  assert.equal(STATUS_LABELS.candidate.es, 'Candidato');
  assert.equal(STATUS_LABELS.candidate.en, 'Candidate');
  assert.equal(STATUS_LABELS.verifying.es, 'Verificando');
  assert.equal(STATUS_LABELS.verifying.en, 'Verifying');
  assert.equal(STATUS_LABELS.live.es, 'Activo');
  assert.equal(STATUS_LABELS.live.en, 'Live');
  assert.equal(STATUS_LABELS.paused.es, 'Pausado');
  assert.equal(STATUS_LABELS.paused.en, 'Paused');
});

test('seeding: exactly the 6 known providers, once', () => {
  const providers = listProviders();
  assert.equal(providers.length, 6);
  assert.deepEqual(
    providers.map((p) => p.name),
    SEED_NAMES,
  );
});

test('seeding: zero fabrication — no fees, no rates, no coords, no notes', () => {
  for (const p of listProviders()) {
    assert.equal(p.status, 'live');
    assert.deepEqual(p.feeModel, {
      type: 'undisclosed',
      pct: null,
      flat: null,
      min: null,
      max: null,
    });
    assert.deepEqual(p.channels, []);
    assert.deepEqual(p.coverageCountries, []);
    assert.equal(p.website, '');
    assert.equal(p.notes, '');
    assert.equal(p.lat, null);
    assert.equal(p.lng, null);
    assert.deepEqual(p.agentNotes, []);
  }
});

test('seeding: idempotent across reloads, no reseed after delete', () => {
  reloadCubacashStore();
  assert.equal(listProviders().length, 6);
  const first = listProviders()[0];
  deleteProvider(first.id);
  assert.equal(listProviders().length, 5);
  reloadCubacashStore();
  assert.equal(listProviders().length, 5);
  assert.equal(findDuplicateProvider({ name: first.name }), null);
});

test('seeding: never seeds anything beyond the 6 names', () => {
  // Corridors are never seeded either.
  assert.equal(listCorridors().length, 0);
});

test('createProvider: normalized shape, empty contact-like fields until added', () => {
  const p = createProvider(FIXTURE_PROVIDER);
  assert.ok(p.id);
  assert.equal(p.name, 'ACME REMIT (fixture)');
  assert.deepEqual(p.channels, ['app', 'web']);
  assert.deepEqual(p.coverageCountries, ['FICTITIA']); // deduped
  assert.equal(p.feeModel.type, 'percentage');
  assert.equal(p.feeModel.pct, 1.25);
  assert.equal(p.feeModel.flat, null); // missing → null, never 0
  assert.equal(p.feeModel.min, 1);
  assert.equal(p.feeModel.max, 12);
  assert.equal(p.status, 'candidate');
  assert.equal(p.website, 'https://example.com (fixture)');
  assert.equal(p.lat, null);
  assert.equal(p.lng, null);
  assert.deepEqual(p.agentNotes, []);
  assert.ok(p.createdAt && p.updatedAt);
});

test('createProvider: channels validated against CHANNELS, garbage dropped', () => {
  const p = createProvider({
    name: 'CHANNELS (fixture)',
    channels: ['app', 'telegram', 'WHATSAPP', 'app'],
  });
  assert.deepEqual(p.channels, ['app', 'whatsapp']);
});

test('createProvider: unknown feeModel type → undisclosed, negatives → null', () => {
  const p = createProvider({
    name: 'WEIRD FEES (fixture)',
    feeModel: { type: 'bogus', pct: -5, flat: 'abc' },
  });
  assert.equal(p.feeModel.type, 'undisclosed');
  assert.equal(p.feeModel.pct, null);
  assert.equal(p.feeModel.flat, null);
});

test('createProvider: lat/lng null when blank, never (0,0)', () => {
  const p = createProvider({ name: 'COORDS (fixture)', lat: '', lng: '' });
  assert.equal(p.lat, null);
  assert.equal(p.lng, null);
  const q = createProvider({
    name: 'COORDS 2 (fixture)',
    lat: 23.1136,
    lng: -82.3666,
  });
  assert.equal(q.lat, 23.1136);
  assert.equal(q.lng, -82.3666);
});

test('createProvider: dedupes on normalized name, returns existing', () => {
  const existing = findDuplicateProvider({ name: 'Western Union' });
  assert.ok(existing);
  const again = createProvider({ name: '  WESTERN  union  ', status: 'paused' });
  assert.equal(again.id, existing.id);
  assert.equal(listProviders().length, 6);
  // Existing record untouched by the dupe attempt.
  assert.equal(getProvider(existing.id).status, 'live');
});

test('findDuplicateProvider: null for unknown or blank names', () => {
  assert.equal(findDuplicateProvider({ name: 'NOPE (fixture)' }), null);
  assert.equal(findDuplicateProvider({ name: '' }), null);
  assert.equal(findDuplicateProvider({}), null);
});

test('provider CRUD: get/update/delete', () => {
  const p = createProvider(FIXTURE_PROVIDER);
  assert.equal(getProvider(p.id).name, 'ACME REMIT (fixture)');
  const updated = updateProvider(p.id, {
    status: 'verifying',
    website: 'https://acme.example (fixture)',
    lat: 25.76,
  });
  assert.equal(updated.status, 'verifying');
  assert.equal(updated.website, 'https://acme.example (fixture)');
  assert.equal(updated.lat, 25.76);
  assert.equal(getProvider('nope'), null);
  assert.equal(updateProvider('nope', {}), null);
  assert.equal(deleteProvider(p.id), true);
  assert.equal(deleteProvider(p.id), false);
  assert.equal(findDuplicateProvider({ name: 'ACME REMIT (fixture)' }), null);
});

test('moveProvider: status transitions and strict coercion', () => {
  const p = createProvider(FIXTURE_PROVIDER);
  assert.equal(moveProvider(p.id, 'live').status, 'live');
  assert.throws(
    () => moveProvider(p.id, 'bogus-status'),
    /Unknown cubacash provider status/,
  );
  assert.equal(moveProvider('nope', 'live'), null);
  assert.throws(
    () => createProvider({ name: 'BAD (fixture)', status: 'bogus' }),
    /Unknown cubacash provider status/,
  );
});

test('listProviders: filter object and function', () => {
  createProvider(FIXTURE_PROVIDER);
  assert.equal(listProviders().length, 7);
  assert.equal(listProviders({ status: 'live' }).length, 6);
  assert.equal(listProviders({ status: 'candidate' }).length, 1);
  assert.equal(listProviders((p) => p.name.includes('ACME')).length, 1);
});

test('addProviderNote: bilingual note with at/agent/es/en', () => {
  const p = createProvider(FIXTURE_PROVIDER);
  const note = addProviderNote(
    p.id,
    'researcher',
    'Nota (fixture)',
    'Note (fixture)',
  );
  assert.equal(note.agent, 'researcher');
  assert.equal(note.es, 'Nota (fixture)');
  assert.equal(note.en, 'Note (fixture)');
  assert.ok(note.at);
  assert.equal(getProvider(p.id).agentNotes.length, 1);
  assert.equal(addProviderNote('nope', 'a', 'b', 'c'), null);
});

test('createCorridor: normalized shape, fxRate null when missing — never invented', () => {
  const c = createCorridor({ ...FIXTURE_CORRIDOR, providerId: 'p-fixture' });
  assert.ok(c.id);
  assert.equal(c.fromCountry, 'Spain (fixture)');
  assert.equal(c.toCountry, 'Cuba (fixture)');
  assert.equal(c.providerId, 'p-fixture');
  assert.equal(c.sendAmount, 100);
  assert.equal(c.fxRate, null);
  assert.equal(c.fxRateAsOf, '');
  assert.equal(c.fromLat, null);
  assert.equal(c.fromLng, null);
  assert.equal(c.toLat, null);
  assert.equal(c.toLng, null);
  assert.equal(c.notes, 'fixture');
  assert.deepEqual(c.agentNotes, []);
  assert.ok(c.createdAt && c.updatedAt);
});

test('createCorridor: sendAmount 0 when missing, keeps real fxRate and coords', () => {
  const c = createCorridor({
    fromCountry: 'Spain (fixture)',
    toCountry: 'Cuba (fixture)',
    fxRate: 120.5,
    fxRateAsOf: '2026-09-17',
    fromLat: 40.41,
    fromLng: -3.7,
    toLat: 23.11,
    toLng: -82.36,
  });
  assert.equal(c.sendAmount, 0);
  assert.equal(c.fxRate, 120.5);
  assert.equal(c.fxRateAsOf, '2026-09-17');
  assert.equal(c.fromLat, 40.41);
  assert.equal(c.toLat, 23.11);
});

test('createCorridor: non-positive fxRate → null, negative sendAmount → 0', () => {
  const c = createCorridor({
    fromCountry: 'Spain (fixture)',
    toCountry: 'Cuba (fixture)',
    sendAmount: -50,
    fxRate: -3,
  });
  assert.equal(c.sendAmount, 0);
  assert.equal(c.fxRate, null);
});

test('corridor CRUD: get/update/delete, notes', () => {
  const c = createCorridor(FIXTURE_CORRIDOR);
  assert.equal(getCorridor(c.id).toCountry, 'Cuba (fixture)');
  const updated = updateCorridor(c.id, { fxRate: 119, fxRateAsOf: '2026-09-17' });
  assert.equal(updated.fxRate, 119);
  assert.equal(updated.fxRateAsOf, '2026-09-17');
  const createdAt = updated.createdAt;
  const again = updateCorridor(c.id, { notes: 'nueva (fixture)' });
  assert.equal(again.createdAt, createdAt);
  const note = addCorridorNote(c.id, 'analyst', 'Nota (fixture)', 'Note (fixture)');
  assert.ok(note.at);
  assert.equal(getCorridor(c.id).agentNotes.length, 1);
  assert.equal(getCorridor('nope'), null);
  assert.equal(updateCorridor('nope', {}), null);
  assert.equal(addCorridorNote('nope', 'a', 'b', 'c'), null);
  assert.equal(deleteCorridor(c.id), true);
  assert.equal(deleteCorridor(c.id), false);
});

test('listCorridors: filter object and function', () => {
  createCorridor(FIXTURE_CORRIDOR);
  createCorridor({ fromCountry: 'Mexico (fixture)', toCountry: 'Cuba (fixture)' });
  assert.equal(listCorridors().length, 2);
  assert.equal(listCorridors({ toCountry: 'Cuba (fixture)' }).length, 2);
  assert.equal(listCorridors({ fromCountry: 'Mexico (fixture)' }).length, 1);
  assert.equal(listCorridors((c) => c.sendAmount === 100).length, 1);
});

test('persistence round-trip: reloadCubacashStore restores providers and corridors', () => {
  const p = createProvider(FIXTURE_PROVIDER);
  const c = createCorridor({ ...FIXTURE_CORRIDOR, providerId: p.id });
  addProviderNote(p.id, 'researcher', 'Nota (fixture)', 'Note (fixture)');
  const db = reloadCubacashStore();
  assert.equal(db.providers.length, 7);
  assert.equal(db.corridors.length, 1);
  assert.equal(db.seeded, true);
  const reloaded = getProvider(p.id);
  assert.equal(reloaded.name, 'ACME REMIT (fixture)');
  assert.equal(reloaded.agentNotes.length, 1);
  assert.equal(getCorridor(c.id).providerId, p.id);
});

test('stats: totals, byStatus, corridorsWithRates, honest beta zeros', () => {
  createProvider(FIXTURE_PROVIDER);
  createCorridor(FIXTURE_CORRIDOR);
  createCorridor({ ...FIXTURE_CORRIDOR, fxRate: 120, fxRateAsOf: '2026-09-17' });
  const s = stats();
  assert.equal(s.totalProviders, 7);
  assert.equal(s.liveProviders, 6);
  assert.equal(s.byStatus.live, 6);
  assert.equal(s.byStatus.candidate, 1);
  assert.equal(s.byStatus.verifying, 0);
  assert.equal(s.byStatus.paused, 0);
  assert.equal(s.totalCorridors, 2);
  assert.equal(s.corridorsWithRates, 1);
  // Honest beta state: real platform data only, never local.
  assert.equal(s.betaCustomers, 0);
  assert.equal(s.betaTransactions, 0);
  assert.equal(s.betaReviews, 0);
});

test('stats: fresh store has 6 live seeds and zero beta counters', () => {
  const s = stats();
  assert.equal(s.totalProviders, 6);
  assert.equal(s.liveProviders, 6);
  assert.equal(s.totalCorridors, 0);
  assert.equal(s.corridorsWithRates, 0);
  assert.equal(s.betaCustomers, 0);
  assert.equal(s.betaTransactions, 0);
  assert.equal(s.betaReviews, 0);
});

test('asWorkforceStore: getAll/get map agentNotes to workforce notes {t,…}', () => {
  const p = createProvider(FIXTURE_PROVIDER);
  addProviderNote(p.id, 'researcher', 'Nota (fixture)', 'Note (fixture)');
  const wf = asWorkforceStore();
  assert.equal(wf.getAll().length, 7);
  const mapped = wf.get(p.id);
  assert.ok(Array.isArray(mapped.notes));
  assert.equal(mapped.notes.length, 1);
  assert.deepEqual(Object.keys(mapped.notes[0]).sort(), [
    'agent',
    'en',
    'es',
    't',
  ]);
  assert.equal(mapped.notes[0].agent, 'researcher');
  assert.equal(mapped.notes[0].es, 'Nota (fixture)');
  assert.equal(mapped.notes[0].en, 'Note (fixture)');
  assert.ok(mapped.notes[0].t);
  assert.equal(wf.get('nope'), null);
});

test('asWorkforceStore: notes maps at→t shape', () => {
  const p = createProvider(FIXTURE_PROVIDER);
  addProviderNote(p.id, 'analyst', 'Nota (fixture)', 'Note (fixture)');
  const notes = asWorkforceStore().notes(p.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].t, getProvider(p.id).agentNotes[0].at);
  assert.deepEqual(asWorkforceStore().notes('nope'), []);
});

test('asWorkforceStore: update converts workforce {t,…} notes into {at,…} agentNotes, deduped', () => {
  const p = createProvider(FIXTURE_PROVIDER);
  const first = addProviderNote(
    p.id,
    'analyst',
    'Nota (fixture)',
    'Note (fixture)',
  );
  const wf = asWorkforceStore();
  const updated = wf.update(p.id, {
    notes: [
      {
        t: first.at,
        agent: 'analyst',
        es: 'Nota (fixture)',
        en: 'Note (fixture)',
      },
      {
        t: '2026-09-17T01:30:00-05:00',
        agent: 'analyst',
        es: 'Otra (fixture)',
        en: 'Another (fixture)',
      },
    ],
  });
  assert.equal(updated.agentNotes.length, 2);
  const stored = getProvider(p.id).agentNotes;
  assert.deepEqual(Object.keys(stored[1]).sort(), ['agent', 'at', 'en', 'es']);
  assert.equal(stored[1].at, '2026-09-17T01:30:00-05:00');
  // Second identical update must not duplicate.
  const again = wf.update(p.id, {
    notes: [
      {
        t: first.at,
        agent: 'analyst',
        es: 'Nota (fixture)',
        en: 'Note (fixture)',
      },
    ],
  });
  assert.equal(again.agentNotes.length, 2);
  assert.equal(wf.notes(p.id).length, 2);
});

test('asWorkforceStore: update applies regular patch fields', () => {
  const p = createProvider(FIXTURE_PROVIDER);
  const updated = asWorkforceStore().update(p.id, { status: 'paused' });
  assert.equal(updated.status, 'paused');
  assert.equal(asWorkforceStore().update('nope', {}), null);
});

test('resetCubacashStore: wipes providers and corridors, unseeds', () => {
  createProvider(FIXTURE_PROVIDER);
  createCorridor(FIXTURE_CORRIDOR);
  resetCubacashStore();
  assert.equal(listProviders().length, 0);
  assert.equal(listCorridors().length, 0);
  const db = reloadCubacashStore();
  assert.equal(db.providers.length, 6);
  assert.equal(db.seeded, true);
});

test('applyAuditSeed: adds audit providers/corridors, idempotent, nothing invented', () => {
  const before = applyAuditSeed();
  assert.equal(before.providers, 12); // 6 seeds + 6 audit providers
  assert.equal(before.corridors, 2); // Peru→Cuba + Chile→Cuba

  const byName = (n) => listProviders().find((p) => p.name === n);
  assert.equal(byName('Money Exchange S.A.').status, 'live');
  assert.equal(byName('Correo Uruguayo').status, 'live');
  const inposdom = byName('INPOSDOM');
  assert.equal(inposdom.status, 'live');
  assert.ok(
    inposdom.agentNotes.some((n) => /2025/.test(n.es || '')),
    'INPOSDOM note flags the 2025 tariff vintage',
  );
  assert.equal(byName('TropiPay').status, 'candidate');
  assert.equal(byName('Lindo').status, 'candidate');
  assert.equal(byName('Antilla Capital').status, 'candidate');

  // The 6 seeded providers get the audit as-of stamp…
  for (const name of [
    'Western Union',
    'Cubamax',
    'Sendvalu',
    'Fonmoney',
    'Correos España',
    'Íkualo Rem',
  ]) {
    const p = byName(name);
    assert.ok(
      p.agentNotes.some((n) => /2026-09-17/.test(n.es || '')),
      `${name} carries the audit as-of note`,
    );
    assert.equal(p.feeModel.pct, null); // still no invented fees
  }

  // …but GlobalTrust is NOT registered as a provider — observation only.
  assert.equal(byName('GlobalTrust Express S&E S.A.C.'), undefined);

  const peru = listCorridors().find(
    (c) => c.fromCountry === 'Peru' && c.toCountry === 'Cuba',
  );
  assert.ok(peru);
  assert.equal(peru.fxRate, null); // observed figure never stored as fxRate
  assert.equal(peru.providerId, '');
  assert.ok(
    peru.agentNotes.some((n) => /GlobalTrust/.test(n.es || '')),
    'Peru corridor carries the GlobalTrust observation',
  );
  const chile = listCorridors().find(
    (c) => c.fromCountry === 'Chile' && c.toCountry === 'Cuba',
  );
  assert.ok(chile);
  assert.equal(chile.fxRate, null);

  // Idempotent: second run adds nothing.
  const after = applyAuditSeed();
  assert.deepEqual(after, before);
  assert.equal(listProviders().length, 12);
  assert.equal(listCorridors().length, 2);
});

test('applyAuditSeed: demotes an existing TropiPay to candidate (audit verdict)', () => {
  const tp = createProvider({ name: 'TropiPay', status: 'live' });
  assert.equal(tp.status, 'live');
  applyAuditSeed();
  assert.equal(getProvider(tp.id).status, 'candidate');
  assert.ok(
    getProvider(tp.id).agentNotes.some((n) => /Degradado|Demoted/.test(n.es || n.en || '')),
  );
});
