import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  createInsuranceStore,
  INSURANCE_STORE_KEY,
  BUILT_IN_BIZ,
  OPEN_CLAIM_MAX_STAGE,
} = await import('./insuranceStore.js');

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

const savedStorage = globalThis.localStorage;

function withStorage(data, fn) {
  globalThis.localStorage = makeStorage(
    data === undefined ? {} : { [INSURANCE_STORE_KEY]: JSON.stringify(data) },
  );
  try {
    fn();
  } finally {
    if (savedStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = savedStorage;
  }
}

const SAMPLE = {
  businesses: {
    personal: {
      coverages: [
        { id: 'c1', type: 'auto', status: 'gap' },
        { id: 'c2', type: 'home', status: 'active', exp: '2026-10-10', state: 'TX' },
      ],
      claims: [
        { id: 'cl1', type: 'auto', stage: 1 },
        { id: 'cl2', type: 'prop', stage: 5 },
      ],
    },
    wholesale: {
      coverages: [{ id: 'c3', type: 'gl', status: 'gap' }],
      claims: [{ id: 'cl3', type: 'liab', stage: 3 }],
    },
  },
  custom: [{ id: 'biz1', name: 'Test Biz', industry: 'retail' }],
  attorney: [{ id: 'a1', status: 2 }, { id: 'a2', status: 6 }],
  quotes: [{ id: 'q1', type: 'auto', premium: 1200 }],
};

test('getState returns the stored state, null when missing', () => {
  withStorage(SAMPLE, () => {
    const store = createInsuranceStore();
    assert.deepEqual(store.getState(), SAMPLE);
  });
  withStorage(undefined, () => {
    const store = createInsuranceStore();
    assert.equal(store.getState(), null);
  });
});

test('corrupt or wrong-shaped data yields safe empties', () => {
  for (const bad of ['not json{{{', JSON.stringify({ foo: 1 }), JSON.stringify({ businesses: [1, 2] })]) {
    globalThis.localStorage = makeStorage({ [INSURANCE_STORE_KEY]: bad });
    try {
      const store = createInsuranceStore();
      assert.equal(store.getState(), null);
      assert.deepEqual(store.getGaps(), []);
      assert.deepEqual(store.getRenewals(), []);
      assert.deepEqual(store.getOpenClaims(), []);
      assert.deepEqual(store.getQuotes(), []);
      assert.deepEqual(store.getBusinessIds(), []);
      assert.deepEqual(store.getCustomBiz(), []);
      assert.deepEqual(store.getAttorney(), []);
    } finally {
      if (savedStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = savedStorage;
    }
  }
});

test('getBusinessIds includes built-ins and customs', () => {
  withStorage(SAMPLE, () => {
    const store = createInsuranceStore();
    const ids = store.getBusinessIds();
    for (const b of BUILT_IN_BIZ) assert.ok(ids.includes(b), b);
    assert.ok(ids.includes('biz1'));
  });
});

test('getGaps finds gaps across businesses', () => {
  withStorage(SAMPLE, () => {
    const store = createInsuranceStore();
    const gaps = store.getGaps();
    assert.equal(gaps.length, 2);
    assert.deepEqual(
      gaps.map((g) => g.biz).sort(),
      ['personal', 'wholesale'],
    );
  });
});

test('getRenewals returns coverages expiring within 30 days, soonest first', () => {
  // c2 expires 2026-10-10: 23 days after 2026-09-17 → within 30.
  withStorage(SAMPLE, () => {
    const store = createInsuranceStore();
    const renewals = store.getRenewals(30);
    assert.ok(renewals.length >= 1);
    const ids = renewals.map((r) => r.coverage.id);
    assert.ok(ids.includes('c2'));
    assert.ok(!ids.includes('c1'), 'gaps are excluded');
    for (let i = 1; i < renewals.length; i++) {
      assert.ok(renewals[i - 1].daysLeft <= renewals[i].daysLeft);
    }
  });
});

test('getOpenClaims returns only stage <= OPEN_CLAIM_MAX_STAGE', () => {
  withStorage(SAMPLE, () => {
    const store = createInsuranceStore();
    const open = store.getOpenClaims();
    assert.equal(OPEN_CLAIM_MAX_STAGE, 4);
    assert.deepEqual(
      open.map((o) => o.claim.id).sort(),
      ['cl1', 'cl3'],
    );
  });
});

test('getCoverages/getClaims/getCustomBiz/getAttorney/getQuotes', () => {
  withStorage(SAMPLE, () => {
    const store = createInsuranceStore();
    assert.equal(store.getCoverages('personal').length, 2);
    assert.deepEqual(store.getCoverages('nope'), []);
    assert.equal(store.getClaims('wholesale').length, 1);
    assert.deepEqual(store.getCustomBiz(), SAMPLE.custom);
    assert.equal(store.getAttorney().length, 2);
    assert.equal(store.getQuotes().length, 1);
  });
});

test('saveState persists and round-trips', () => {
  withStorage(undefined, () => {
    const store = createInsuranceStore();
    assert.equal(store.getState(), null);
    assert.equal(store.saveState(SAMPLE), true);
    assert.deepEqual(store.getState(), SAMPLE);
  });
});
