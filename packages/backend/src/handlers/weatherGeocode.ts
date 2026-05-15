/**
 * GET /geocode?address=...
 *
 * Two-pass geocoding:
 *   1. Local interpolating lookup against the 90+ known Walloon Lake
 *      shoreline addresses in lakeAddresses.ts.  Works for any numbered
 *      street address on the lake (e.g. "6666 Lake Grove Road") even when
 *      OSM has no record of it.
 *   2. Nominatim fallback with viewbox + Walloon Lake context for named
 *      landmarks the local table doesn't cover (marinas, camps, etc.).
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { ok, badRequest, internalError } from '../lib/response.js';
import { LAKE_ADDRESSES } from '../data/lakeAddresses.js';

const BOUNDS = { minLat: 45.24, maxLat: 45.38, minLng: -85.10, maxLng: -84.85 };
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'WalloonWaves/1.0 (wshort@gmail.com)';

function withinBounds(lat: number, lng: number): boolean {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat
      && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;
}

// ─── Local lookup ────────────────────────────────────────────────────────────

const SUFFIX_MAP: Record<string, string> = {
  road: 'rd', trail: 'trl', drive: 'dr', lane: 'ln',
  avenue: 'ave', boulevard: 'blvd', street: 'st', court: 'ct',
  highway: 'hwy', place: 'pl', way: 'wy',
};

function normStreet(s: string): string {
  return s.toLowerCase()
    .replace(/\b(road|trail|drive|lane|avenue|boulevard|street|court|highway|place|way)\b/g,
      (w) => SUFFIX_MAP[w] ?? w)
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ParsedAddr { num: number; street: string; }

/** Extract leading house number + normalized street name, e.g. "6666 lake grove rd". */
function parseAddr(input: string): ParsedAddr | null {
  // Strip city/state suffix ("6666 Lake Grove Rd, Walloon Lake, MI" → "6666 Lake Grove Rd")
  const stripped = input.split(',')[0]!
    .replace(/\bwalloon\s+lake\b.*/i, '')
    .replace(/\bmi\b.*$/i, '')
    .trim();
  const m = normStreet(stripped).match(/^(\d+)\s+(.+)$/);
  return m ? { num: parseInt(m[1]!, 10), street: m[2]!.trim() } : null;
}

interface LocalResult { lat: number; lng: number; displayName: string; }

function localLookup(query: string): LocalResult | null {
  const parsed = parseAddr(query);
  if (!parsed) return null;

  // Collect all entries whose normalized street name matches
  const matches: Array<{ num: number; lat: number; lng: number }> = [];
  for (const entry of LAKE_ADDRESSES) {
    const ep = parseAddr(entry.address);
    if (ep && ep.street === parsed.street) {
      matches.push({ num: ep.num, lat: entry.lat, lng: entry.lng });
    }
  }
  if (!matches.length) return null;

  matches.sort((a, b) => a.num - b.num);
  const streetLabel = titleCase(parsed.street);
  const displayName = `${parsed.num} ${streetLabel}, Walloon Lake, MI`;

  // Clamp to range endpoints
  if (parsed.num <= matches[0]!.num) {
    const { lat, lng } = matches[0]!;
    return { lat, lng, displayName };
  }
  const last = matches[matches.length - 1]!;
  if (parsed.num >= last.num) {
    return { lat: last.lat, lng: last.lng, displayName };
  }

  // Interpolate between the two bracketing points
  let lo = matches[0]!;
  let hi = matches[1]!;
  for (let i = 1; i < matches.length; i++) {
    if (matches[i]!.num >= parsed.num) {
      lo = matches[i - 1]!;
      hi = matches[i]!;
      break;
    }
  }
  const t = (parsed.num - lo.num) / (hi.num - lo.num);
  return {
    lat: lo.lat + t * (hi.lat - lo.lat),
    lng: lo.lng + t * (hi.lng - lo.lng),
    displayName,
  };
}

// ─── Nominatim fallback ───────────────────────────────────────────────────────

async function nominatimLookup(address: string): Promise<LocalResult | null> {
  // Append lake context if not already present
  const q = /walloon/i.test(address) ? address : `${address}, Walloon Lake, MI`;
  const params = new URLSearchParams({
    q,
    format:         'json',
    limit:          '1',
    addressdetails: '0',
    countrycodes:   'us',
    // Nominatim viewbox: left,top,right,bottom (lon,lat order)
    viewbox:        `${BOUNDS.minLng},${BOUNDS.maxLat},${BOUNDS.maxLng},${BOUNDS.minLat}`,
    bounded:        '1',
  });

  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    console.error(`[weatherGeocode] Nominatim HTTP ${res.status}`);
    return null;
  }

  const results = (await res.json()) as Array<{
    lat: string; lon: string; display_name: string;
  }>;
  if (!results.length) return null;

  const { lat: latStr, lon: lonStr, display_name } = results[0]!;
  return { lat: parseFloat(latStr), lng: parseFloat(lonStr), displayName: display_name };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const address = event.queryStringParameters?.['address']?.trim();
    if (!address) return badRequest('address query parameter is required');

    // 1 — Try local street-number interpolation first
    const local = localLookup(address);
    if (local) {
      return ok({
        lat:          local.lat,
        lng:          local.lng,
        displayName:  local.displayName,
        withinBounds: withinBounds(local.lat, local.lng),
      });
    }

    // 2 — Fall back to Nominatim with geographic context
    const geo = await nominatimLookup(address);
    if (!geo) return ok(null);

    return ok({
      lat:          geo.lat,
      lng:          geo.lng,
      displayName:  geo.displayName,
      withinBounds: withinBounds(geo.lat, geo.lng),
    });
  } catch (err) {
    console.error('[weatherGeocode] error:', err);
    return internalError('Geocoding failed');
  }
};
