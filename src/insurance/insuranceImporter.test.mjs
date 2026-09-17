import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  parseBackup,
  backupFileName,
  exportBackup,
  invalidBackupError,
} = await import('./insuranceImporter.js');

const VALID = {
  businesses: {
    personal: {
      coverages: [{ id: 'c1', status: 'gap' }],
      claims: [{ id: 'cl1', stage: 1 }],
    },
  },
  attorney: [],
  quotes: [{ id: 'q1', premium: 100 }],
};

test('parseBackup accepts a valid backup', () => {
  assert.deepEqual(parseBackup(JSON.stringify(VALID)), VALID);
});

test('parseBackup accepts businesses without per-biz arrays and without optional keys', () => {
  assert.deepEqual(parseBackup(JSON.stringify({ businesses: { x: {} } })), {
    businesses: { x: {} },
  });
});

test('parseBackup throws bilingual error on corrupt JSON', () => {
  assert.throws(() => parseBackup('not json{{{'), /Copia de seguridad inválida/);
  assert.throws(() => parseBackup('not json{{{', 'en'), /Invalid backup/);
});

test('parseBackup throws on wrong shape', () => {
  const bads = [
    JSON.stringify({ foo: 1 }),
    JSON.stringify({ businesses: [1, 2] }),
    JSON.stringify({ businesses: { x: { coverages: 'nope' } } }),
    JSON.stringify({ businesses: { x: { claims: {} } } }),
    JSON.stringify({ businesses: { x: [] } }),
    JSON.stringify({ businesses: { p: {} }, quotes: {} }),
    JSON.stringify(['array']),
    '42',
  ];
  for (const b of bads) {
    assert.throws(() => parseBackup(b), /Copia de seguridad inválida/, b);
    assert.throws(() => parseBackup(b, 'en'), /Invalid backup/, b);
  }
});

test('invalidBackupError is bilingual', () => {
  assert.match(invalidBackupError('es').message, /Copia de seguridad inválida/);
  assert.match(invalidBackupError('en').message, /Invalid backup/);
});

test('backupFileName includes the date', () => {
  assert.equal(backupFileName(new Date(2026, 8, 17)), 'insurance-backup-20260917.json');
});

test('exportBackup returns a file name without a DOM', () => {
  // No document in node: should not throw, just return the name.
  assert.match(exportBackup(VALID), /^insurance-backup-\d{8}\.json$/);
});
