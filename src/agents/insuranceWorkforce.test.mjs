import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  createInsuranceWorkforce,
  claimChecklist,
  CLAIM_DOC_CHECKLISTS,
  INSURANCE_WORKFORCE_LOG_KEY,
  INSURANCE_LOG_CAP,
  INSURANCE_AGENT_HARD_RULES,
} = await import('./insuranceWorkforce.js');

const savedStorage = globalThis.localStorage;

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
  };
}

const SAMPLE = {
  businesses: {
    personal: {
      coverages: [
        { id: 'c1', type: 'auto', status: 'gap' },
        { id: 'c2', type: 'home', status: 'active', exp: '2026-09-25' },
      ],
      claims: [{ id: 'cl1', type: 'auto', stage: 1, docs: {} }],
    },
    wholesale: {
      coverages: [{ id: 'c3', type: 'gl', status: 'gap' }],
      claims: [{ id: 'cl2', type: 'prop', stage: 5, docs: {} }],
    },
  },
};

function makeStore(state) {
  return { getState: () => state };
}

function withFreshStorage(fn) {
  globalThis.localStorage = makeStorage();
  try {
    fn();
  } finally {
    if (savedStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = savedStorage;
  }
}

test('requires an insuranceStore', () => {
  assert.throws(() => createInsuranceWorkforce({}), /insuranceStore/);
});

test('processOnce emits memos for gaps, renewals, and claim docs', () => {
  withFreshStorage(() => {
    const wf = createInsuranceWorkforce({ insuranceStore: makeStore(SAMPLE) });
    wf.processOnce();
    const log = wf.getActivityLog();
    const kinds = log.map((e) => e.kind);
    assert.ok(kinds.includes('gaps-found'), 'gaps-found');
    assert.ok(kinds.includes('renewals-due'), 'renewals-due');
    assert.ok(kinds.includes('claim-docs-needed'), 'claim-docs-needed');
    // closed claim (stage 5) is not flagged
    const prep = log.find((e) => e.kind === 'claim-docs-needed');
    assert.match(prep.es, /cl1/);
    assert.ok(!prep.es.includes('cl2'));
    assert.ok(prep.es && prep.en, 'bilingual memo');
    wf.destroy();
  });
});

test('clear data emits clear memos', () => {
  withFreshStorage(() => {
    const wf = createInsuranceWorkforce({
      insuranceStore: makeStore({ businesses: {} }),
    });
    wf.processOnce();
    const kinds = wf.getActivityLog().map((e) => e.kind);
    assert.ok(kinds.includes('gaps-clear'));
    assert.ok(kinds.includes('renewals-clear'));
    assert.ok(kinds.includes('claims-ready'));
    wf.destroy();
  });
});

test('identical consecutive passes do not duplicate memos', () => {
  withFreshStorage(() => {
    const wf = createInsuranceWorkforce({ insuranceStore: makeStore(SAMPLE) });
    wf.processOnce();
    const first = wf.getActivityLog().length;
    wf.processOnce();
    assert.equal(wf.getActivityLog().length, first);
    wf.destroy();
  });
});

test('log persists under the insurance key and is capped', () => {
  withFreshStorage(() => {
    const storage = globalThis.localStorage;
    const wf = createInsuranceWorkforce({ insuranceStore: makeStore(SAMPLE) });
    wf.processOnce();
    const raw = storage.getItem(INSURANCE_WORKFORCE_LOG_KEY);
    assert.ok(raw, 'log key written');
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length <= INSURANCE_LOG_CAP);
    wf.destroy();
  });
});

test('hard rules forbid all external actions', () => {
  assert.match(INSURANCE_AGENT_HARD_RULES.en, /NEVER send, email, post, purchase, file, sign, call, or text/);
  assert.match(INSURANCE_AGENT_HARD_RULES.es, /NUNCA/);
});

test('claimChecklist covers all 7 claim types in both languages', () => {
  const types = ['prop', 'cargo', 'liab', 'theft', 'bi', 'auto', 'health'];
  assert.deepEqual(
    Object.keys(CLAIM_DOC_CHECKLISTS).sort(),
    [...types].sort(),
  );
  for (const t of types) {
    assert.ok(claimChecklist(t, 'es').length >= 4, t);
    assert.ok(claimChecklist(t, 'en').length >= 4, t);
  }
  // unknown type falls back to a generic list
  assert.ok(claimChecklist('nope', 'es').length >= 4);
});

test('getSummary reports honest note and findings', () => {
  withFreshStorage(() => {
    const wf = createInsuranceWorkforce({ insuranceStore: makeStore(SAMPLE) });
    const s = wf.getSummary();
    assert.equal(s.note.en, 'The workforce runs while the app is open.');
    assert.equal(s.findings.gaps, 2);
    assert.equal(s.findings.openClaims, 1);
    assert.equal(s.agents.length, 3);
    wf.destroy();
  });
});

test('start/pause/resume/destroy lifecycle', () => {
  withFreshStorage(() => {
    const wf = createInsuranceWorkforce({ insuranceStore: makeStore(SAMPLE) });
    assert.equal(wf.running, false);
    wf.start();
    assert.equal(wf.running, true);
    wf.pause();
    assert.equal(wf.running, false);
    wf.resume();
    assert.equal(wf.running, true);
    wf.destroy();
    assert.equal(wf.running, false);
  });
});
