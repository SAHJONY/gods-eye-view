import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULE_ID,
  WORKFORCE_LOG_KEY,
  ESCALATION_LOG_KEY,
  AGENT_TIERS,
  SANCTIONS_HARD_STOP,
  WORKFORCE_NOTE,
  ROLE_IDS,
  isSanctionsQuestion,
  mentionsSanctions,
  classifyTrack,
  escalate,
  readEscalations,
  logAction,
  createWorkforce,
  getWorkforceSummary,
} from './energyWorkforce.js';
import * as energyEngine from '../energy/energyEngine.js';

function makeStore() {
  const inquiries = [];
  return {
    rows: inquiries,
    getAll: () => [...inquiries],
    get: (id) => inquiries.find((i) => i.id === id) ?? null,
    update: (id, patch) => {
      const inq = inquiries.find((i) => i.id === id);
      if (!inq) return null;
      Object.assign(inq, patch);
      return inq;
    },
    notes: (id) => {
      const inq = inquiries.find((i) => i.id === id);
      return (inq?.agentNotes || []).map((n) => ({
        t: n.at,
        agent: n.agent,
        es: n.es,
        en: n.en,
      }));
    },
    add(inq) {
      inquiries.push({ agentNotes: [], status: 'inquiry', ...inq });
      return inquiries[inquiries.length - 1];
    },
  };
}

// ---------------------------------------------------------------------------
// SANCTIONS HARD STOP — the heart of this module.
// ---------------------------------------------------------------------------

test('SANCTIONS_HARD_STOP semantics are exported per the core spec', () => {
  assert.equal(SANCTIONS_HARD_STOP.gate, 'sanctions');
  assert.equal(SANCTIONS_HARD_STOP.action, 'escalate-always');
  assert.equal(AGENT_TIERS.READ, 'read');
  assert.equal(AGENT_TIERS.DRAFT, 'draft');
  assert.equal(AGENT_TIERS.PROPOSE, 'propose');
  assert.ok(!('execute' in AGENT_TIERS), 'no execute tier exists');
});

test('isSanctionsQuestion: detects ES/EN sanctions questions', () => {
  assert.equal(isSanctionsQuestion('¿Puedo vender diésel a Cuba sin violar el embargo?'), true);
  assert.equal(isSanctionsQuestion('How do I check OFAC sanctions for this counterparty?'), true);
  assert.equal(isSanctionsQuestion('¿Necesito una licencia de exportación para el GLP?'), true);
  assert.equal(isSanctionsQuestion('Is this customs route legal?'), true);
  assert.equal(isSanctionsQuestion('Explícame el riesgo de sanciones aquí'), true);
  assert.equal(isSanctionsQuestion(''), false);
  assert.equal(isSanctionsQuestion(null), false);
});

test('isSanctionsQuestion: static compliance copy is NOT a question', () => {
  const checklistCopy =
    'Ninguna contraparte, buque, banco ni intermediario aparece en listas de sancionados (verificación MANUAL por Juan).';
  assert.equal(isSanctionsQuestion(checklistCopy), false);
  assert.equal(isSanctionsQuestion('El diésel EN 590 tiene azufre ≤ 10 mg/kg.'), false);
});

test('mentionsSanctions: statements detected, plain text ignored', () => {
  assert.equal(mentionsSanctions('El embargo afecta la ruta.'), true);
  assert.equal(mentionsSanctions('Precio del diésel esta semana.'), false);
});

test('screenContent: sanctions question → escalate, NEVER an answer', () => {
  const store = makeStore();
  const wf = createWorkforce({ energyStore: store, energyEngine });
  const out = wf.screenContent('¿Cómo evito las sanciones de OFAC en este trato?', {
    inquiryId: 'inq-1',
  });
  assert.equal(out.escalated, true);
  assert.ok(out.record, 'escalation record returned');
  assert.equal(out.record.module, 'energy');
  assert.equal(out.record.reason, 'sanctions');
  assert.equal(out.record.status, 'awaiting-juan');
  // The workforce produces no answer text — the record carries the policy,
  // not advice.
  assert.ok(!out.record.payload.answer, 'no answer in the escalation payload');
  assert.match(out.record.payload.policy, /never answered/i);
  wf.destroy();
});

test('screenContent: benign text does not escalate', () => {
  const store = makeStore();
  const wf = createWorkforce({ energyStore: store, energyEngine });
  const before = readEscalations().length;
  const out = wf.screenContent('El volumen es de 500 MT de diésel.', { inquiryId: 'inq-2' });
  assert.equal(out.escalated, false);
  assert.equal(readEscalations().length, before, 'no new escalation');
  wf.destroy();
});

test('gate-keeper pass: sanctions question in inquiry notes → hard stop + forced awaiting-juan', () => {
  const store = makeStore();
  store.add({
    id: 'inq-gate',
    ref: 'ENQ-SANCTION',
    product: 'diesel',
    status: 'gate-review',
    notes: '¿Podemos estructurar el pago para evitar el embargo?',
  });
  const wf = createWorkforce({ energyStore: store, energyEngine });
  wf.processOnce();
  const inq = store.get('inq-gate');
  assert.equal(inq.status, 'awaiting-juan', 'inquiry forced to Juan, cannot proceed');
  const escalations = readEscalations().filter(
    (e) => e.reason === 'sanctions' && e.payload?.inquiryId === 'inq-gate',
  );
  assert.ok(escalations.length >= 1, 'escalation written');
  // The workforce must never ADVISE: its notes carry the hard-stop notice,
  // not guidance. Scan every note for advisory language.
  const advisory = /\b(recomiendo|te recomiendo|puedes hacerlo|deberías|es legal|no hay riesgo|workaround|structur\w* para evitar)\b/i;
  for (const n of inq.agentNotes) {
    assert.ok(!advisory.test(`${n.es} ${n.en}`), `no advisory language: ${n.es.slice(0, 80)}`);
  }
  const hardStopNote = inq.agentNotes.find((n) =>
    /no responde|does not answer|escalad/i.test(`${n.es} ${n.en}`),
  );
  assert.ok(hardStopNote || escalations.length, 'hard-stop notice present');
  wf.destroy();
});

test('gate-keeper: one question escalates once across cycles; a NEW question fires again', () => {
  const store = makeStore();
  store.add({
    id: 'inq-dedupe',
    ref: 'ENQ-DEDUPE',
    product: 'diesel',
    status: 'gate-review',
    notes: '¿Puedo vender diésel a Cuba sin violar el embargo?',
  });
  const wf = createWorkforce({ energyStore: store, energyEngine });
  wf.processOnce();
  wf.processOnce();
  wf.processOnce();
  const first = readEscalations().filter(
    (e) => e.reason === 'sanctions' && e.payload?.inquiryId === 'inq-dedupe',
  );
  assert.equal(first.length, 1, 'same question escalated exactly once');
  // A new question in the notes fires a second, distinct escalation.
  store.update('inq-dedupe', {
    notes: '¿Puedo vender diésel a Cuba sin violar el embargo? ¿Y qué hay de la licencia OFAC?',
  });
  wf.processOnce();
  const second = readEscalations().filter(
    (e) => e.reason === 'sanctions' && e.payload?.inquiryId === 'inq-dedupe',
  );
  assert.equal(second.length, 2, 'new question escalates again');
  wf.destroy();
});

test('workforce never advances an inquiry past the compliance gate itself', () => {
  const store = makeStore();
  store.add({ id: 'inq-nogate', ref: 'ENQ-NG', product: 'lpg', status: 'gate-review', volumeMt: 100 });
  const wf = createWorkforce({ energyStore: store, energyEngine });
  for (let i = 0; i < 3; i += 1) wf.processOnce();
  const inq = store.get('inq-nogate');
  assert.notEqual(inq.status, 'commercial', 'workforce never sets commercial');
  wf.destroy();
});

// ---------------------------------------------------------------------------
// Draft-only by design.
// ---------------------------------------------------------------------------

test('draft-only: no send/post/publish/offer function exists in the module', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./energyWorkforce.js', import.meta.url), 'utf8');
  assert.equal(/export\s+(function|const)\s+send\b/.test(src), false);
  assert.equal(/export\s+(function|const)\s+post\b/.test(src), false);
  assert.equal(/export\s+(function|const)\s+publish\b/.test(src), false);
  assert.equal(/export\s+(function|const)\s+offer\b/.test(src), false);
  assert.equal(/\bfetch\s*\(/.test(src), false, 'no network calls');
  assert.equal(/XMLHttpRequest/.test(src), false, 'no XHR');
});

test('outreach-drafter: drafts only for gate-passed inquiries, marked not sent', () => {
  const store = makeStore();
  const ok = store.add({ id: 'inq-ok', ref: 'ENQ-OK', product: 'diesel', status: 'commercial', volumeMt: 100 });
  const blocked = store.add({ id: 'inq-blocked', ref: 'ENQ-BL', product: 'diesel', status: 'gate-review', volumeMt: 100 });
  const wf = createWorkforce({ energyStore: store, energyEngine });
  wf.processOnce();
  assert.ok(ok.agentNotes.some((n) => /BORRADOR \(no enviado\)/.test(n.es)), 'draft marked not sent');
  assert.ok(!blocked.agentNotes.some((n) => n.agent === 'outreach-drafter'), 'no drafts before the gate');
  wf.destroy();
});

// ---------------------------------------------------------------------------
// Core plumbing.
// ---------------------------------------------------------------------------

test('createWorkforce requires store + engine', () => {
  assert.throws(() => createWorkforce({}), /energyStore/);
  assert.throws(
    () => createWorkforce({ energyStore: makeStore() }),
    /energyEngine/,
  );
});

test('roster: 5 v1 agents, drafts-only tiers, no execute', () => {
  assert.deepEqual([...ROLE_IDS].sort(), [
    'economics-memo',
    'gate-keeper',
    'logistics-checker',
    'outreach-drafter',
    'spec-analyst',
  ].sort());
  const store = makeStore();
  const wf = createWorkforce({ energyStore: store, energyEngine });
  const tiers = new Set(wf.agents.map((a) => a.tier));
  assert.ok(tiers.has('read') && tiers.has('draft'));
  assert.ok(!tiers.has('execute'));
  assert.equal(wf.agents.find((a) => a.id === 'gate-keeper').tier, 'read');
  assert.equal(wf.agents.find((a) => a.id === 'outreach-drafter').tier, 'draft');
  wf.destroy();
});

test('log keys and module id follow the core spec', () => {
  assert.equal(MODULE_ID, 'energy');
  assert.equal(WORKFORCE_LOG_KEY, 'sahjony.workforce.energy.log.v1');
  assert.ok(WORKFORCE_NOTE.es && WORKFORCE_NOTE.en);
});

test('logAction writes {ts, module, agent, action, tier, status}', () => {
  const rec = logAction('energy', 'gate-keeper', 'screened');
  assert.equal(rec.module, 'energy');
  assert.equal(rec.agent, 'gate-keeper');
  assert.equal(rec.action, 'screened');
  assert.equal(rec.tier, 'read');
  assert.equal(rec.status, 'logged');
  assert.ok(rec.ts);
});

test('classifyTrack: energy-domain → energy, else unknown (one track, never blended)', () => {
  assert.equal(classifyTrack('Buscamos diésel EN 590 para Cuba'), 'energy');
  assert.equal(classifyTrack('LPG propane inquiry'), 'energy');
  assert.equal(classifyTrack('quiero comprar una casa'), 'unknown');
  assert.equal(classifyTrack(''), 'unknown');
});

test('processOnce: spec-analyst + economics-memo + logistics notes without crashing', () => {
  const store = makeStore();
  store.add({ id: 'inq-eco', ref: 'ENQ-ECO', product: 'lpg', status: 'gate-review', volumeMt: 200 });
  const wf = createWorkforce({ energyStore: store, energyEngine });
  wf.processOnce();
  const inq = store.get('inq-eco');
  const agents = new Set(inq.agentNotes.map((n) => n.agent));
  assert.ok(agents.has('spec-analyst'));
  assert.ok(agents.has('economics-memo'));
  assert.ok(agents.has('logistics-checker'));
  const memo = inq.agentNotes.find((n) => n.agent === 'economics-memo');
  assert.match(memo.es, /corredor/i, 'broker positioning in the memo');
  assert.match(memo.es, /cero capital en riesgo/i);
  wf.destroy();
});

test('start/pause/resume/destroy lifecycle', () => {
  const store = makeStore();
  const wf = createWorkforce({ energyStore: store, energyEngine, tickMs: 50, staggerMs: 10 });
  assert.equal(wf.running, false);
  wf.start();
  assert.equal(wf.running, true);
  wf.pause();
  assert.equal(wf.running, false);
  assert.ok(wf.agents.every((a) => a.status === 'paused'));
  wf.resume();
  assert.equal(wf.running, true);
  wf.destroy();
  assert.equal(wf.running, false);
});

test('getWorkforceSummary: shape with note, agents, queueDepth', () => {
  const store = makeStore();
  store.add({ id: 'inq-q', ref: 'ENQ-Q', product: 'diesel', status: 'inquiry' });
  const wf = createWorkforce({ energyStore: store, energyEngine });
  const summary = getWorkforceSummary(wf);
  assert.equal(summary.module, 'energy');
  assert.ok(summary.note.es && summary.note.en);
  assert.equal(summary.agents.length, 5);
  assert.equal(summary.queueDepth, 1);
  wf.destroy();
});

test('onActivity listener receives events and unsubscribes', () => {
  const store = makeStore();
  store.add({ id: 'inq-ev', ref: 'ENQ-EV', product: 'gasoline', status: 'gate-review' });
  const wf = createWorkforce({ energyStore: store, energyEngine });
  const events = [];
  const off = wf.onActivity((e) => events.push(e));
  wf.processOnce();
  assert.ok(events.length > 0);
  off();
  const before = events.length;
  wf.processOnce();
  assert.equal(events.length, before, 'unsubscribed listener gets nothing');
  wf.destroy();
});
