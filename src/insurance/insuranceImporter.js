/**
 * Insurance backup import/export for GOD'S EYE VIEW — $0, no network.
 *
 * exportBackup(state): triggers a JSON download of the full insurance state.
 * parseBackup(text): validates the shape of a backup (businesses object with
 * per-business coverage/claim arrays, attorney/quotes arrays when present)
 * and returns the parsed state, or throws a bilingual Error on invalid input.
 */

export function backupFileName(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `insurance-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
}

export function invalidBackupError(lang = 'es') {
  return new Error(
    lang === 'es'
      ? 'Copia de seguridad inválida: se esperaba un objeto con "businesses" y arreglos de coberturas/reclamos.'
      : 'Invalid backup: expected an object with "businesses" and coverage/claim arrays.',
  );
}

/** Validate the parsed backup shape; throws a bilingual Error when invalid. */
export function parseBackup(text, lang = 'es') {
  let parsed = null;
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : null;
  } catch {
    throw invalidBackupError(lang);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidBackupError(lang);
  }
  const businesses = parsed.businesses;
  if (
    !businesses ||
    typeof businesses !== 'object' ||
    Array.isArray(businesses)
  ) {
    throw invalidBackupError(lang);
  }
  for (const [biz, b] of Object.entries(businesses)) {
    if (!b || typeof b !== 'object' || Array.isArray(b))
      throw invalidBackupError(lang);
    if (b.coverages !== undefined && !Array.isArray(b.coverages))
      throw invalidBackupError(lang);
    if (b.claims !== undefined && !Array.isArray(b.claims))
      throw invalidBackupError(lang);
    if (typeof biz !== 'string' || !biz) throw invalidBackupError(lang);
  }
  for (const key of ['attorney', 'quotes', 'qreq', 'custom']) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key]))
      throw invalidBackupError(lang);
  }
  return parsed;
}

/** Serialize state to a pretty JSON string (throws on circular input). */
export function serializeBackup(state) {
  return JSON.stringify(state, null, 2);
}

/** Trigger a JSON download of the state in the browser. Returns the file name. */
export function exportBackup(state) {
  const name = backupFileName();
  try {
    if (typeof document === 'undefined') return name;
    const blob = new Blob([serializeBackup(state)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* noop */
      }
      a.remove();
    }, 500);
  } catch {
    /* downloads unavailable in this environment */
  }
  return name;
}
