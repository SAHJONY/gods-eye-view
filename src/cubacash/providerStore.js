// MY CUBA CASH provider + corridor store — localStorage persistence, guarded for non-browser.
// Key: 'sahjony.cubacash.v1'. Falls back to in-memory storage outside a browser.
// Providers (remittance providers) + corridors (send routes provider → country).
// No cesium, no network, no API keys. Honesty convention: missing data is
// reported, never invented. The 6 seed providers ship with no fees, no FX
// rates, and no coordinates — everything else stays empty until Juan adds it.
// Beta customer/transaction/review counters always start at 0 and only ever
// change from real platform data, never locally.

export const STORAGE_KEY = 'sahjony.cubacash.v1';

export const PROVIDER_STATUSES = Object.freeze([
  'candidate',
  'verifying',
  'live',
  'paused',
]);

export const STATUS_LABELS = Object.freeze({
  candidate: { es: 'Candidato', en: 'Candidate' },
  verifying: { es: 'Verificando', en: 'Verifying' },
  live: { es: 'Activo', en: 'Live' },
  paused: { es: 'Pausado', en: 'Paused' },
});

export const CHANNELS = Object.freeze([
  'app',
  'web',
  'whatsapp',
  'agent',
  'retail',
]);

export const FEE_MODEL_TYPES = Object.freeze([
  'percentage',
  'flat',
  'mixed',
  'undisclosed',
]);

/** The only providers that ever get seeded. No fees, no FX, no coords. */
const SEED_PROVIDERS = Object.freeze([
  'Western Union',
  'Cubamax',
  'Sendvalu',
  'Fonmoney',
  'Correos España',
  'Íkualo Rem',
]);

const memoryStorage = (() => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
})();

function storageBackend() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      // Probe — some contexts define localStorage but throw on access.
      const probe = '__sahjony_cubacash_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStorage;
}

/** ISO timestamp with America/Chicago offset, e.g. 2026-09-17T01:15:00-05:00. */
export function chicagoIso(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  const local = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;

  const utcMs = d.getTime();
  const chicagoWall = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  );
  const offsetMin = Math.round((chicagoWall - utcMs) / 60000);
  const sign = offsetMin <= 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local}${sign}${hh}:${mm}`;
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function coerceProviderStatus(status) {
  if (typeof status === 'string' && PROVIDER_STATUSES.includes(status))
    return status;
  throw new Error(`Unknown cubacash provider status: ${String(status)}`);
}

function coerceFeeModelType(type) {
  return FEE_MODEL_TYPES.includes(type) ? type : 'undisclosed';
}

function coerceChannels(value) {
  const list = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      list
        .filter((c) => typeof c === 'string')
        .map((c) => c.trim().toLowerCase())
        .filter((c) => CHANNELS.includes(c)),
    ),
  ];
}

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const asTextList = (value) => {
  const list = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      list
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
};

/** Fee figures stay null when missing — never 0 for an unknown fee. */
const asFeeNumber = (value) => {
  if (value === undefined || value === null || String(value).trim() === '')
    return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const asMoney = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** FX rate: number > 0, or null when missing — never invented. */
const asFxRate = (value) => {
  if (value === undefined || value === null || String(value).trim() === '')
    return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Coordinates stay null when blank — never (0,0) from missing input. */
const asLatLng = (value) => {
  if (value === undefined || value === null || String(value).trim() === '')
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeName = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

function normalizeProvider(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    name: asText(data.name),
    channels: coerceChannels(data.channels),
    coverageCountries: asTextList(data.coverageCountries),
    feeModel: {
      type: coerceFeeModelType(data.feeModel?.type),
      pct: asFeeNumber(data.feeModel?.pct),
      flat: asFeeNumber(data.feeModel?.flat),
      min: asFeeNumber(data.feeModel?.min),
      max: asFeeNumber(data.feeModel?.max),
    },
    status: data.status ? coerceProviderStatus(data.status) : 'candidate',
    website: asText(data.website),
    notes: typeof data.notes === 'string' ? data.notes : '',
    lat: asLatLng(data.lat),
    lng: asLatLng(data.lng),
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...n }))
      : [],
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

function normalizeCorridor(data = {}) {
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    fromCountry: asText(data.fromCountry),
    toCountry: asText(data.toCountry),
    providerId: asText(data.providerId),
    sendAmount: asMoney(data.sendAmount),
    fxRate: asFxRate(data.fxRate),
    fxRateAsOf: asText(data.fxRateAsOf),
    fromLat: asLatLng(data.fromLat),
    fromLng: asLatLng(data.fromLng),
    toLat: asLatLng(data.toLat),
    toLng: asLatLng(data.toLng),
    notes: typeof data.notes === 'string' ? data.notes : '',
    agentNotes: Array.isArray(data.agentNotes)
      ? data.agentNotes.map((n) => ({ ...n }))
      : [],
    createdAt: data.createdAt || chicagoIso(),
    updatedAt: data.updatedAt || chicagoIso(),
  };
}

class CubacashStore {
  constructor() {
    this.backend = storageBackend();
    this.db = this.load();
    this.seedIfEmpty();
  }

  load() {
    try {
      const raw = this.backend.getItem(STORAGE_KEY);
      if (!raw) return { providers: [], corridors: [], seeded: false };
      const parsed = JSON.parse(raw);
      return {
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
        corridors: Array.isArray(parsed.corridors) ? parsed.corridors : [],
        seeded: parsed.seeded === true,
      };
    } catch {
      return { providers: [], corridors: [], seeded: false };
    }
  }

  save() {
    try {
      this.backend.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      /* persistence is best-effort */
    }
  }

  /**
   * Seed the 6 known providers once, on first load, only when the db is
   * empty AND db.seeded is not true. Never seeds any other provider, fee,
   * FX rate, or transaction — seeding is names only.
   */
  seedIfEmpty() {
    if (this.db.seeded) return;
    if (this.db.providers.length > 0 || this.db.corridors.length > 0) return;
    const now = chicagoIso();
    this.db.providers = SEED_PROVIDERS.map((name) => ({
      id: makeId(),
      name,
      channels: [],
      coverageCountries: [],
      feeModel: {
        type: 'undisclosed',
        pct: null,
        flat: null,
        min: null,
        max: null,
      },
      status: 'live',
      website: '',
      notes: '',
      lat: null,
      lng: null,
      agentNotes: [],
      createdAt: now,
      updatedAt: now,
    }));
    this.db.seeded = true;
    this.save();
  }

  /** Clear all providers and corridors (used by tests). */
  reset() {
    this.db = { providers: [], corridors: [], seeded: false };
    this.save();
  }

  // ---- Providers ----
  findDuplicateProvider(data) {
    const name = normalizeName(data.name);
    if (!name) return null;
    return (
      this.db.providers.find((p) => normalizeName(p.name) === name) ?? null
    );
  }

  createProvider(data = {}) {
    const existing = this.findDuplicateProvider(data);
    if (existing) return existing;
    const provider = normalizeProvider(data);
    this.db.providers.push(provider);
    this.save();
    return provider;
  }

  getProvider(id) {
    return this.db.providers.find((p) => p.id === id) ?? null;
  }

  updateProvider(id, patch = {}) {
    const provider = this.getProvider(id);
    if (!provider) return null;
    const merged = normalizeProvider({
      ...provider,
      ...patch,
      id: provider.id,
    });
    merged.createdAt = provider.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(provider, merged);
    this.save();
    return provider;
  }

  moveProvider(id, status) {
    const provider = this.getProvider(id);
    if (!provider) return null;
    provider.status = coerceProviderStatus(status);
    provider.updatedAt = chicagoIso();
    this.save();
    return provider;
  }

  deleteProvider(id) {
    const index = this.db.providers.findIndex((p) => p.id === id);
    if (index < 0) return false;
    this.db.providers.splice(index, 1);
    this.save();
    return true;
  }

  listProviders(filter) {
    const providers = [...this.db.providers];
    if (!filter) return providers;
    if (typeof filter === 'function') return providers.filter(filter);
    return providers.filter((p) =>
      Object.entries(filter).every(([key, value]) => p[key] === value),
    );
  }

  addProviderNote(providerId, agent, es, en) {
    const provider = this.getProvider(providerId);
    if (!provider) return null;
    const note = {
      agent: typeof agent === 'string' ? agent : '',
      es: typeof es === 'string' ? es : '',
      en: typeof en === 'string' ? en : '',
      at: chicagoIso(),
    };
    provider.agentNotes.push(note);
    provider.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Corridors ----
  createCorridor(data = {}) {
    const corridor = normalizeCorridor(data);
    this.db.corridors.push(corridor);
    this.save();
    return corridor;
  }

  getCorridor(id) {
    return this.db.corridors.find((c) => c.id === id) ?? null;
  }

  updateCorridor(id, patch = {}) {
    const corridor = this.getCorridor(id);
    if (!corridor) return null;
    const merged = normalizeCorridor({
      ...corridor,
      ...patch,
      id: corridor.id,
    });
    merged.createdAt = corridor.createdAt;
    merged.updatedAt = chicagoIso();
    Object.assign(corridor, merged);
    this.save();
    return corridor;
  }

  deleteCorridor(id) {
    const index = this.db.corridors.findIndex((c) => c.id === id);
    if (index < 0) return false;
    this.db.corridors.splice(index, 1);
    this.save();
    return true;
  }

  listCorridors(filter) {
    const corridors = [...this.db.corridors];
    if (!filter) return corridors;
    if (typeof filter === 'function') return corridors.filter(filter);
    return corridors.filter((c) =>
      Object.entries(filter).every(([key, value]) => c[key] === value),
    );
  }

  addCorridorNote(corridorId, agent, es, en) {
    const corridor = this.getCorridor(corridorId);
    if (!corridor) return null;
    const note = {
      agent: typeof agent === 'string' ? agent : '',
      es: typeof es === 'string' ? es : '',
      en: typeof en === 'string' ? en : '',
      at: chicagoIso(),
    };
    corridor.agentNotes.push(note);
    corridor.updatedAt = chicagoIso();
    this.save();
    return note;
  }

  // ---- Stats ----
  stats() {
    const providers = this.db.providers;
    const byStatus = {};
    for (const status of PROVIDER_STATUSES) byStatus[status] = 0;
    for (const provider of providers) {
      const status = PROVIDER_STATUSES.includes(provider.status)
        ? provider.status
        : 'candidate';
      byStatus[status] += 1;
    }
    const corridors = this.db.corridors;
    return {
      totalProviders: providers.length,
      liveProviders: byStatus.live,
      byStatus,
      totalCorridors: corridors.length,
      corridorsWithRates: corridors.filter((c) => c.fxRate !== null).length,
      // HONEST beta state: these counters only ever change from real
      // platform data, never from local store operations. They ship as 0.
      betaCustomers: 0,
      betaTransactions: 0,
      betaReviews: 0,
    };
  }
}

const wfNoteKey = (note) =>
  `${note?.at ?? note?.t ?? ''}|${note?.agent ?? ''}|${note?.es ?? ''}`;

const store = new CubacashStore();

// ---- Public API (mirrors the crude store names) ----
export const createProvider = (data) => store.createProvider(data);
export const getProvider = (id) => store.getProvider(id);
export const updateProvider = (id, patch) => store.updateProvider(id, patch);
export const moveProvider = (id, status) => store.moveProvider(id, status);
export const deleteProvider = (id) => store.deleteProvider(id);
export const listProviders = (filter) => store.listProviders(filter);
export const addProviderNote = (providerId, agent, es, en) =>
  store.addProviderNote(providerId, agent, es, en);

export const createCorridor = (data) => store.createCorridor(data);
export const getCorridor = (id) => store.getCorridor(id);
export const updateCorridor = (id, patch) => store.updateCorridor(id, patch);
export const deleteCorridor = (id) => store.deleteCorridor(id);
export const listCorridors = (filter) => store.listCorridors(filter);
export const addCorridorNote = (corridorId, agent, es, en) =>
  store.addCorridorNote(corridorId, agent, es, en);

export const stats = () => store.stats();

/** Exposed for tests: does the provider exist in the seed set by normalized name? */
export const findDuplicateProvider = (data) =>
  store.findDuplicateProvider(data);

/**
 * Workforce-adapter view over providers. The AI workforce agent expects
 * notes shaped {t, agent, es, en}; providers store them as {at, agent, es, en}.
 */
export function asWorkforceStore() {
  const withWfNotes = (provider) => ({
    ...provider,
    notes: (provider.agentNotes || []).map((n) => ({
      t: n.at,
      agent: n.agent,
      es: n.es,
      en: n.en,
    })),
  });
  return {
    getAll: () => store.listProviders().map(withWfNotes),
    get: (id) => {
      const provider = store.getProvider(id);
      return provider ? withWfNotes(provider) : null;
    },
    update: (id, patch = {}) => {
      const provider = store.getProvider(id);
      if (!provider) return null;
      const { notes, ...rest } = patch;
      const updated = store.updateProvider(id, rest);
      if (updated && Array.isArray(notes)) {
        const seen = new Set(updated.agentNotes.map(wfNoteKey));
        for (const raw of notes) {
          if (!raw || typeof raw !== 'object') continue;
          const at = raw.at ?? raw.t ?? '';
          const normalized = {
            at: typeof at === 'string' ? at : '',
            agent: typeof raw.agent === 'string' ? raw.agent : '',
            es: typeof raw.es === 'string' ? raw.es : '',
            en: typeof raw.en === 'string' ? raw.en : '',
          };
          const key = wfNoteKey(normalized);
          if (seen.has(key)) continue;
          seen.add(key);
          updated.agentNotes.push(normalized);
        }
        updated.updatedAt = chicagoIso();
        store.save();
      }
      return updated;
    },
    notes: (id) => {
      const provider = store.getProvider(id);
      if (!provider) return [];
      return (provider.agentNotes || []).map((n) => ({
        t: n.at,
        agent: n.agent,
        es: n.es,
        en: n.en,
      }));
    },
  };
}

/** Testing / maintenance helper: wipe the store. */
export const resetCubacashStore = () => store.reset();

/** Exposed for tests: force reload from the storage backend. */
export const reloadCubacashStore = () => {
  store.db = store.load();
  store.seedIfEmpty();
  return store.db;
};
