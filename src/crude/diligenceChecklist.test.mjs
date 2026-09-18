import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SANCTIONS_HARD_STOP,
  SANCTIONS_BANNER,
  DILIGENCE_CATEGORIES,
  DILIGENCE_ITEMS,
  DILIGENCE_STATUS,
  blankChecklist,
  itemState,
  scorableItems,
  scoreDiligence,
  flaggedItems,
  hasSanctionsFlag,
  diligenceStatus,
  evaluateDiligence,
  buildSanctionsEscalation,
} from './diligenceChecklist.js';

const done = (id, extra = {}) => ({
  [id]: { status: 'done', ref: '', note: '', ...extra },
});

test('checklist covers the four diligence categories', () => {
  assert.deepEqual(DILIGENCE_CATEGORIES, [
    'identity',
    'registry',
    'references',
    'sanctions',
  ]);
  for (const cat of DILIGENCE_CATEGORIES) {
    assert.ok(
      DILIGENCE_ITEMS.some((i) => i.category === cat),
      `category ${cat} has items`,
    );
  }
  assert.ok(DILIGENCE_ITEMS.every((i) => i.es && i.en));
  assert.ok(DILIGENCE_ITEMS.some((i) => i.kind === 'redflag'));
  assert.ok(DILIGENCE_ITEMS.some((i) => i.kind === 'ref'));
});

test('blankChecklist: all items open, serializable', () => {
  const blank = blankChecklist();
  assert.equal(Object.keys(blank).length, DILIGENCE_ITEMS.length);
  assert.ok(Object.values(blank).every((s) => s.status === 'open'));
  assert.doesNotThrow(() => JSON.stringify(blank));
});

test('scoreDiligence: partial completion scores proportionally', () => {
  assert.equal(scoreDiligence(blankChecklist()), 0);
  assert.equal(scoreDiligence(null), 0);
  const scorable = scorableItems();
  const half = {};
  scorable.slice(0, Math.floor(scorable.length / 2)).forEach((i) => {
    half[i.id] = { status: 'done', ref: '', note: '' };
  });
  const pct = scoreDiligence(half);
  assert.ok(pct > 0 && pct < 100);
  const full = {};
  scorable.forEach((i) => {
    full[i.id] =
      i.kind === 'ref'
        ? { status: 'open', ref: 'REG-12345', note: '' }
        : { status: 'done', ref: '', note: '' };
  });
  assert.equal(scoreDiligence(full), 100);
});

test('diligenceStatus: escalate on any sanctions red flag, clear only at 100', () => {
  assert.equal(diligenceStatus(blankChecklist()), 'pending');
  assert.ok(DILIGENCE_STATUS.includes(diligenceStatus({})));
  const flagged = { 'sanctions-redflag': { status: 'flagged', ref: '', note: '' } };
  assert.equal(diligenceStatus(flagged), 'escalate');
  assert.ok(hasSanctionsFlag(flagged));
  assert.ok(!hasSanctionsFlag(blankChecklist()));
  const scorable = scorableItems();
  const full = {};
  scorable.forEach((i) => {
    full[i.id] =
      i.kind === 'ref'
        ? { status: 'open', ref: 'REG-12345', note: '' }
        : { status: 'done', ref: '', note: '' };
  });
  assert.equal(diligenceStatus(full), 'clear');
  // A sanctions flag overrides even a fully-checked list.
  full['sanctions-redflag'] = { status: 'flagged', ref: '', note: '' };
  assert.equal(diligenceStatus(full), 'escalate');
});

test('flaggedItems lists red-flag observations only', () => {
  assert.deepEqual(flaggedItems(blankChecklist()), []);
  const st = { 'sanctions-redflag': { status: 'flagged', ref: '', note: '' } };
  assert.deepEqual(flaggedItems(st), ['sanctions-redflag']);
});

test('evaluateDiligence: combined shape with the hard-stop gate', () => {
  const ev = evaluateDiligence(blankChecklist());
  assert.equal(ev.score, 0);
  assert.equal(ev.status, 'pending');
  assert.equal(ev.sanctionsStop, false);
  assert.equal(ev.gate, null);
  const flagged = { 'sanctions-redflag': { status: 'flagged', ref: '', note: '' } };
  const ev2 = evaluateDiligence(flagged);
  assert.equal(ev2.status, 'escalate');
  assert.equal(ev2.sanctionsStop, true);
  assert.deepEqual(ev2.gate, SANCTIONS_HARD_STOP);
});

test('SANCTIONS_HARD_STOP mirrors the workforce core spec', () => {
  assert.deepEqual(SANCTIONS_HARD_STOP, {
    gate: 'sanctions',
    action: 'escalate-always',
  });
  assert.ok(SANCTIONS_BANNER.es.includes('PARADA DE SANCIONES'));
  assert.ok(SANCTIONS_BANNER.en.includes('SANCTIONS HARD STOP'));
});

test('buildSanctionsEscalation: core-shaped, awaiting-juan, never advisory', () => {
  const esc = buildSanctionsEscalation(
    { id: 'cp-1', name: 'ACME (fixture)', country: 'Fictitia' },
    { 'sanctions-redflag': { status: 'flagged', ref: '', note: '' } },
  );
  assert.equal(esc.module, 'crude');
  assert.equal(esc.reason, 'sanctions');
  assert.equal(esc.status, 'awaiting-juan');
  assert.deepEqual(esc.gate, SANCTIONS_HARD_STOP);
  assert.equal(esc.payload.counterpartyName, 'ACME (fixture)');
  assert.deepEqual(esc.payload.flaggedItems, ['sanctions-redflag']);
  assert.ok(typeof esc.ts === 'string');
});

test('itemState: defensive on junk input', () => {
  assert.equal(itemState(null, 'x').status, 'open');
  assert.equal(itemState({}, 'nope').status, 'open');
  assert.equal(itemState({ a: { status: 'bogus' } }, 'a').status, 'open');
  assert.deepEqual(done('x')['x'].status, 'done');
});
