/**
 * Sanctions hard-stop tests for the crude workforce researcher.
 * node:test with fake in-memory cargoStore + fake cargoEngine doubles.
 * Fixtures only — no real counterparties, no real cargoes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkforce,
  escalateCrude,
  buildCrudeEscalation,
  registerCrudeWorkforce,
  CRUDE_AGENT_ROSTER,
  SANCTIONS_HARD_STOP,
} from './crudeWorkforce.js';

function makeStore(seedCargoes = []) {
  const map = new Map();
  let seq = 0;
  const store = {
    getAll() {
      return [...map.values()];
    },
    get(id) {
      return map.get(id);
    },
    update(id, patch) {
      const current = map.get(id);
      if (!current) throw new Error(`unknown cargo ${id}`);
      map.set(id, { ...current, ...patch });
    },
    add(cargo) {
      const id = cargo.id || `cargo-${++seq}`;
      map.set(id, { notes: [], ...cargo, id });
      return id;
    },
  };
  for (const c of seedCargoes) store.add(c);
  return store;
}

const engine = {
  cargoVerdict: () => ({ tier: 'green', es: 'Verde.', en: 'Green.' }),
  brokerCommission: ({ volumeBbl, commissionPerBbl }) =>
    volumeBbl * commissionPerBbl,
  netPerBbl: (cargo) => (cargo.sellPrice || 0) - (cargo.buyPrice || 0),
  missingFields: () => [],
  scoreCargo: () => 75,
};

function diligenceCargo(store, buyer) {
  return store.add({
    ref: 'FIXTURE-SANCTIONS',
    grade: 'Fixture Crude',
    volumeBbl: 500000,
    buyPrice: 70,
    sellPrice: 73,
    commissionPerBbl: 0.25,
    loadPort: 'Fixture Port A',
    dischargePort: 'Fixture Port B',
    buyerId: buyer.name,
    status: 'diligence',
  });
}

test('buildCrudeEscalation: core-shaped, awaiting-juan', () => {
  const esc = buildCrudeEscalation('sanctions', { foo: 'bar' });
  assert.equal(esc.module, 'crude');
  assert.equal(esc.reason, 'sanctions');
  assert.equal(esc.status, 'awaiting-juan');
  assert.deepEqual(esc.payload, { foo: 'bar' });
  assert.ok(typeof esc.ts === 'number');
  assert.deepEqual(buildCrudeEscalation().payload, {});
});

test('escalateCrude: returns the escalation, never throws without the core', () => {
  const esc = escalateCrude('sanctions', { a: 1 });
  assert.equal(esc.status, 'awaiting-juan');
  assert.equal(esc.module, 'crude');
});

test('registerCrudeWorkforce: no-op-safe until the core lands', () => {
  assert.equal(registerCrudeWorkforce(), true);
  assert.ok(Array.isArray(CRUDE_AGENT_ROSTER));
  assert.ok(CRUDE_AGENT_ROSTER.some((a) => a.id === 'researcher'));
  // Tiers come from the core spec — there is no execute tier.
  const tiers = new Set(CRUDE_AGENT_ROSTER.map((a) => a.tier));
  assert.ok(tiers.has('read'));
  assert.ok(tiers.has('draft'));
  assert.ok(tiers.has('propose'));
  assert.ok(!tiers.has('execute'));
});

test('SANCTIONS_HARD_STOP re-exported from the crude workforce', () => {
  assert.deepEqual(SANCTIONS_HARD_STOP, {
    gate: 'sanctions',
    action: 'escalate-always',
  });
});

test('researcher: sanctions red flag → escalate, never advance, never advise', () => {
  const buyer = {
    name: 'Fixture Buyer Co',
    type: 'trader',
    role: 'buyer',
    verification: 'unverified',
    country: 'Fictitia',
    diligence: {
      'sanctions-redflag': { status: 'flagged', ref: '', note: '' },
    },
  };
  const store = makeStore();
  const cargoId = diligenceCargo(store, buyer);
  const wf = createWorkforce({ cargoStore: store, cargoEngine: engine });
  wf.setBuyers([buyer]);

  const events = [];
  wf.onActivity((e) => events.push(e));
  wf.processOnce();

  const cargo = store.get(cargoId);
  // Cargo stays in diligence — the researcher never advances it, and the
  // analyst hold blocks advancement even with a green verdict.
  assert.equal(cargo.status, 'diligence');
  assert.ok(wf.isSanctionsHeld(cargoId));
  assert.deepEqual(wf.getSanctionsHold(), [cargoId]);
  // The escalation event is recorded with the core shape attached.
  const escEvent = events.find((e) => e.kind === 'sanctions-escalation');
  assert.ok(escEvent, 'expected a sanctions-escalation event');
  assert.equal(escEvent.agent, 'researcher');
  assert.equal(escEvent.escalation.status, 'awaiting-juan');
  assert.equal(escEvent.escalation.module, 'crude');
  assert.equal(escEvent.escalation.reason, 'sanctions');
  assert.deepEqual(escEvent.escalation.payload.flaggedItems, [
    'sanctions-redflag',
  ]);
  // The note is a hard stop, not advice.
  const note = cargo.notes[cargo.notes.length - 1];
  assert.ok(note.es.includes('PARADA DE SANCIONES'));
  assert.ok(!/aconsej|recommend|asesor/i.test(note.es + note.en));
  // Release is Juan's call: after release, the analyst resumes normally.
  assert.equal(wf.releaseSanctionsHold(cargoId), true);
  assert.ok(!wf.isSanctionsHeld(cargoId));
  wf.destroy();
});

test('researcher: clean diligence does NOT escalate', () => {
  const buyer = {
    name: 'Clean Fixture Buyer',
    type: 'trader',
    role: 'buyer',
    verification: 'unverified',
    country: 'Fictitia',
    diligence: {},
  };
  const store = makeStore();
  const cargoId = diligenceCargo(store, buyer);
  const wf = createWorkforce({ cargoStore: store, cargoEngine: engine });
  wf.setBuyers([buyer]);
  const events = [];
  wf.onActivity((e) => events.push(e));
  wf.processOnce();
  assert.ok(!events.some((e) => e.kind === 'sanctions-escalation'));
  const cargo = store.get(cargoId);
  assert.ok(
    cargo.notes.some((n) => n.agent === 'researcher'),
    'researcher still logs its diligence checklist note',
  );
  wf.destroy();
});
