// Crude benchmark price log — pure, unit-testable, zero dependencies.
// Dated WTI/Brent front-month entries. Every entry carries its source and
// date. The seed values below are the verified 2026-09-17 quotes supplied
// with the build brief — marked as such. No other prices are ever invented:
// entries only arrive from real desk input.

export const BENCHMARK_GRADES = Object.freeze(['WTI', 'Brent']);

export const BENCHMARK_SOURCES = Object.freeze([
  'verified-seed',
  'manual-entry',
]);

/**
 * Seed entries — verified 2026-09-17 front-month quotes from the build brief.
 * Labeled 'verified-seed' so the desk can always tell where they came from.
 * These are the ONLY prices this module will ever contain without Juan
 * adding them by hand.
 */
export const SEED_BENCHMARKS = Object.freeze([
  {
    grade: 'WTI',
    price: 101.29,
    basis: 'front-month',
    date: '2026-09-17',
    source: 'verified-seed',
    note: 'Verified seed value — 2026-09-17',
    nota: 'Valor verificado inicial — 2026-09-17',
  },
  {
    grade: 'Brent',
    price: 104.59,
    basis: 'front-month',
    date: '2026-09-17',
    source: 'verified-seed',
    note: 'Verified seed value — 2026-09-17',
    nota: 'Valor verificado inicial — 2026-09-17',
  },
]);

function coerceGrade(grade) {
  return BENCHMARK_GRADES.includes(grade) ? grade : 'WTI';
}

function coercePrice(price) {
  const n = Number(price);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function coerceDate(date) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date.trim())) {
    return date.trim().slice(0, 10);
  }
  return '';
}

/** Defensive normalization of a benchmark entry. Never throws. */
export function normalizeBenchmark(entry = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const price = coercePrice(entry.price);
  if (price <= 0) return null;
  return {
    grade: coerceGrade(entry.grade),
    price,
    basis:
      typeof entry.basis === 'string' && entry.basis.trim()
        ? entry.basis.trim()
        : 'front-month',
    date: coerceDate(entry.date),
    source: BENCHMARK_SOURCES.includes(entry.source)
      ? entry.source
      : 'manual-entry',
    note: typeof entry.note === 'string' ? entry.note : '',
    nota: typeof entry.nota === 'string' ? entry.nota : '',
  };
}

/**
 * Pure append: returns a NEW array with the normalized entry, or the input
 * array unchanged when the entry is invalid. No I/O.
 */
export function addBenchmark(benchmarks, entry) {
  const list = Array.isArray(benchmarks) ? benchmarks : [];
  const normalized = normalizeBenchmark(entry);
  if (!normalized) return list;
  return [...list, normalized];
}

/** All entries for a grade, oldest first (entries without dates sort last). */
export function listBenchmarks(benchmarks, grade) {
  const list = Array.isArray(benchmarks) ? benchmarks : [];
  const wanted = coerceGrade(grade);
  return list
    .filter((b) => b && b.grade === wanted)
    .sort((a, b) => String(a.date || 'z').localeCompare(String(b.date || 'z')));
}

/** Latest entry for a grade (by date, then by insertion order). Null when none. */
export function latestBenchmark(benchmarks, grade) {
  const entries = listBenchmarks(benchmarks, grade);
  return entries.length ? entries[entries.length - 1] : null;
}

/**
 * Whole days between the entry date and a reference day (YYYY-MM-DD).
 * Returns null when either date is missing/invalid. Pure.
 */
export function daysStale(entryDate, refDate) {
  const a = coerceDate(entryDate);
  const b = coerceDate(refDate);
  if (!a || !b) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86400000));
}

/** Bilingual staleness label for a benchmark entry. */
export function stalenessLabel(entry, refDate, lang = 'es') {
  const days = daysStale(entry?.date, refDate);
  if (days === null) {
    return lang === 'es' ? 'Fecha desconocida' : 'Unknown date';
  }
  if (days === 0) return lang === 'es' ? 'Hoy' : 'Today';
  if (days === 1) return lang === 'es' ? 'Ayer' : 'Yesterday';
  return lang === 'es' ? `Hace ${days} días` : `${days} days ago`;
}

/** Seed payload for a fresh store (deep copy — callers may mutate freely). */
export function seedBenchmarkPayload() {
  return SEED_BENCHMARKS.map((b) => ({ ...b }));
}

/** Does this list already carry the verified seed? (idempotent seeding). */
export function hasSeed(benchmarks) {
  return (
    Array.isArray(benchmarks) &&
    benchmarks.some((b) => b && b.source === 'verified-seed')
  );
}
