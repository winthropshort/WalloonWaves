#!/usr/bin/env node
/**
 * gen_lake_addresses.ts
 *
 * Reads scripts/shoreline_data.json and regenerates
 * packages/backend/src/data/lakeAddresses.ts
 *
 * Run after adding / editing points in shoreline_data.json:
 *   npx tsx scripts/gen_lake_addresses.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, '..');
const JSON_PATH  = resolve(ROOT, 'scripts/shoreline_data.json');
const OUT_PATH   = resolve(ROOT, 'packages/backend/src/data/lakeAddresses.ts');

// ─── Types matching the JSON shape ───────────────────────────────────────────

interface Pt   { address?: string; lat: number; lng: number; notes?: string; }
interface Basin { [key: string]: Pt[] | string; }

interface ShorelineData {
  narrows:        Pt[];
  basins:         Record<string, Basin>;
}

// ─── Filtering ────────────────────────────────────────────────────────────────

function isUsableAddress(addr: string | undefined): addr is string {
  if (!addr) return false;
  if (addr === '(no address)') return false;
  if (addr.startsWith('(')) return false;   // "(WA narrows, east pin) …" etc.
  if (/°/.test(addr))        return false;  // raw GPS strings like "45.309° N …"
  // Must contain a digit (house number)
  return /\d/.test(addr);
}

/** Strip parenthetical remarks: "5791 Country Club Shores (Walloon Lake CC)" → "5791 Country Club Shores". */
function stripParens(addr: string): string {
  return addr.replace(/\s*\(.*?\)\s*/g, ' ').trim().replace(/\s+/g, ' ');
}

/** "5467-5691 Indian Garden Rd" → "5579 Indian Garden Rd" (midpoint). */
function resolveRange(addr: string): string {
  const m = addr.match(/^(\d+)-(\d+)\s+(.+)$/);
  if (m) {
    const mid = Math.round((parseInt(m[1]!, 10) + parseInt(m[2]!, 10)) / 2);
    return `${mid} ${m[3]}`;
  }
  return addr;
}

function cleanAddress(addr: string): string {
  return resolveRange(stripParens(addr));
}

// ─── Collect entries ──────────────────────────────────────────────────────────

interface Entry { address: string; lat: number; lng: number; section: string; }

const data = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as ShorelineData;
const raw: Entry[] = [];

// narrows
for (const pt of data.narrows ?? []) {
  if (isUsableAddress(pt.address)) {
    raw.push({ address: cleanAddress(pt.address), lat: pt.lat, lng: pt.lng, section: 'narrows' });
  }
}

// basins.*.*[]
for (const [basinKey, basin] of Object.entries(data.basins ?? {})) {
  for (const [shoreKey, pts] of Object.entries(basin)) {
    if (!Array.isArray(pts)) continue;
    const section = `${basinKey}.${shoreKey}`;
    for (const pt of pts as Pt[]) {
      if (isUsableAddress(pt.address)) {
        raw.push({ address: cleanAddress(pt.address), lat: pt.lat, lng: pt.lng, section });
      }
    }
  }
}

// Deduplicate by address string (keep first occurrence, which preserves
// ordering from the JSON — later duplicates are usually notes like "second data point")
const seen = new Set<string>();
const entries = raw.filter(e => {
  if (seen.has(e.address)) return false;
  seen.add(e.address);
  return true;
});

// ─── Generate TypeScript ──────────────────────────────────────────────────────

const HEADER = `\
// AUTO-GENERATED — do not edit by hand.
// Source: scripts/shoreline_data.json
// Regenerate: npx tsx scripts/gen_lake_addresses.ts

export interface LakeAddress { address: string; lat: number; lng: number; }

export const LAKE_ADDRESSES: LakeAddress[] = [
`;

let currentSection = '';
const rows: string[] = [];

for (const e of entries) {
  if (e.section !== currentSection) {
    currentSection = e.section;
    rows.push(`\n  // ${currentSection}`);
  }
  const latStr = e.lat.toFixed(5);
  const lngStr = e.lng.toFixed(5);
  rows.push(`  { address: ${JSON.stringify(e.address)}, lat: ${latStr}, lng: ${lngStr} },`);
}

const output = HEADER + rows.join('\n') + '\n];\n';

writeFileSync(OUT_PATH, output, 'utf8');
console.log(`Wrote ${entries.length} entries to ${OUT_PATH}`);
