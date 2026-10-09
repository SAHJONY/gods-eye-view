#!/usr/bin/env node
/**
 * Import buyer leads into the portal leads CRM store.
 *
 * Re-runnable: upserts by (name, country) so re-importing never duplicates.
 * Run the email merge any time the enrichment file lands — it updates only
 * the email field of matching leads.
 *
 * Usage:
 *   node scripts/import-leads.mjs [--leads <file>] [--emails <file>] [--data <dir>]
 *
 * Defaults (repo layout):
 *   --leads  ../../goals/iphone-resale-sourcing-10-units/files/leads-latam-caribe-2026-10-09.md
 *            (falls back to ~/workspace/goals/... when the repo is not under ~/workspace)
 *   --emails ~/workspace/goals/iphone-resale-sourcing-10-units/files/leads-emails-2026-10-09.md
 *            (skipped silently when absent)
 *   --data   server/portal/data   (relative to the repo root)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLeadStore } from '../server/portal/leads.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.HOME || '/home/hatch';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const GOALS_LEADS = path.join(
  HOME, 'workspace', 'goals', 'iphone-resale-sourcing-10-units', 'files',
  'leads-latam-caribe-2026-10-09.md'
);
const GOALS_EMAILS = path.join(
  HOME, 'workspace', 'goals', 'iphone-resale-sourcing-10-units', 'files',
  'leads-emails-2026-10-09.md'
);

const leadsFile = arg('--leads', GOALS_LEADS);
const emailsFile = arg('--emails', GOALS_EMAILS);
const dataDir = arg('--data', path.join(REPO_ROOT, 'server', 'portal', 'data'));

const REGION_LABELS = {
  CARIBE: 'caribe',
  'MÉXICO Y CENTROAMÉRICA': 'mexico-centroamerica',
  'MEXICO Y CENTROAMERICA': 'mexico-centroamerica',
  SUDAMÉRICA: 'sudamerica',
};

function isLeadLine(line) {
  if (!line.includes('|')) return false;
  if (/^\s*[#\-`]/.test(line)) return false;
  if (/Formato por lead/i.test(line)) return false;
  return line.split('|').length >= 7;
}

/**
 * Split a lead line into the 7 fields. Some type fields contain a literal
 * pipe (e.g. "Technology & más | phone/computer shop") — when there are
 * more than 7 parts, anchor name/city/country/address/phone/web from the
 * ends and join the middle back into the type.
 */
function splitLeadLine(line) {
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length === 7) {
    const [name, type, city, country, address, phone, web] = parts;
    return { name, type, city, country, address, phone, web };
  }
  const n = parts.length;
  return {
    name: parts[0],
    type: parts.slice(1, n - 5).join(' | '),
    city: parts[n - 5],
    country: parts[n - 4],
    address: parts[n - 3],
    phone: parts[n - 2],
    web: parts[n - 1],
  };
}

/** Parse the lead markdown into records { name, type, city, country, region, address, phone, web }. */
function parseLeads(text) {
  const leads = [];
  let region = '';
  let country = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const regionMatch = /^#\s+(.+)$/.exec(line);
    if (regionMatch && !line.startsWith('##')) {
      const label = REGION_LABELS[regionMatch[1].trim().toUpperCase()] || '';
      if (label) region = label;
      continue;
    }
    const countryMatch = /^##\s+(.+)$/.exec(line);
    if (countryMatch) {
      country = countryMatch[1].trim();
      continue;
    }
    if (!isLeadLine(line)) continue;
    const { name, type, city, country: countryField, address, phone, web } = splitLeadLine(line);
    leads.push({
      name: name || '',
      type: type || '',
      city: city || '',
      country: countryField || country,
      region,
      address: address === '—' ? '' : address || '',
      phone: phone === '—' ? '' : phone || '',
      web: web === '—' ? '' : web || '',
      business: 'cell-phones',
      source: 'leads-latam-caribe-2026-10-09',
    });
  }
  return leads.filter((l) => l.name && l.country);
}

/** Parse the email-enrichment markdown: lines `Nombre | país | email(s) | source`. */
function parseEmails(text) {
  const out = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.includes('|')) continue;
    if (/^\s*[#\-`]/.test(line)) continue;
    if (/Formato por lead|Nombre\s*\|/i.test(line)) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 3) continue;
    const [name, country, emails, source] = parts;
    if (!name || !country) continue;
    if (/^none found$/i.test(emails)) continue;
    out.push({ name, country, emails, source: source || 'email-enrichment-2026-10-09' });
  }
  return out;
}

function main() {
  const store = createLeadStore({
    load: () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dataDir, 'leads.json'), 'utf8'));
      } catch {
        return null;
      }
    },
    save: (value) => {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = path.join(dataDir, `leads.json.${process.pid}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
      fs.renameSync(tmp, path.join(dataDir, 'leads.json'));
    },
  });

  let created = 0;
  let updated = 0;
  if (!fs.existsSync(leadsFile)) {
    console.error(`leads file not found: ${leadsFile}`);
    process.exit(1);
  }
  const records = parseLeads(fs.readFileSync(leadsFile, 'utf8'));
  for (const record of records) {
    const { created: wasCreated } = store.upsert(record);
    if (wasCreated) created++;
    else updated++;
  }
  console.log(`import: ${records.length} parsed, ${created} created, ${updated} updated`);

  let merged = 0;
  if (fs.existsSync(emailsFile)) {
    const entries = parseEmails(fs.readFileSync(emailsFile, 'utf8'));
    for (const entry of entries) {
      const { lead } = store.upsert({
        name: entry.name,
        country: entry.country,
        email: entry.emails,
      });
      if (lead.email) merged++;
    }
    console.log(`email merge: ${entries.length} entries processed, ${merged} leads with email set`);
  } else {
    console.log('email merge: enrichment file not found, skipped');
  }
  console.log(`store size: ${store._size()} leads`);
}

main();
