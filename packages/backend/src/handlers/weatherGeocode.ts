/**
 * GET /geocode?address=...
 * Geocodes an address via OpenStreetMap Nominatim and validates that the
 * result falls within the Walloon Lake bounding box.
 *
 * Rate limit: Nominatim enforces 1 req/s; Lambda concurrency provides natural
 * throttling. No API key required (User-Agent required).
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { ok, badRequest, internalError } from '../lib/response.js';

// Bounding box around Walloon Lake with ~10 km padding
const BOUNDS = {
  minLat: 45.27,
  maxLat: 45.38,
  minLng: -85.10,
  maxLng: -84.85,
};

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'WalloonWaves/1.0 (wshort@gmail.com)';

function withinBounds(lat: number, lng: number): boolean {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat
      && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const address = event.queryStringParameters?.['address']?.trim();
    if (!address) {
      return badRequest('address query parameter is required');
    }

    const params = new URLSearchParams({
      q:              address,
      format:         'json',
      limit:          '1',
      addressdetails: '0',
    });

    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!res.ok) {
      console.error(`[weatherGeocode] Nominatim HTTP ${res.status}`);
      return internalError('Geocoding service unavailable');
    }

    const results = (await res.json()) as Array<{
      lat:          string;
      lon:          string;
      display_name: string;
    }>;

    if (!results.length) {
      return ok(null);
    }

    const { lat: latStr, lon: lonStr, display_name } = results[0]!;
    const lat = parseFloat(latStr);
    const lng = parseFloat(lonStr);

    return ok({
      lat,
      lng,
      displayName:  display_name,
      withinBounds: withinBounds(lat, lng),
    });
  } catch (err) {
    console.error('[weatherGeocode] error:', err);
    return internalError('Geocoding failed');
  }
};
