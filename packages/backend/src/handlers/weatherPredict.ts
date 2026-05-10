/**
 * POST /predict
 * Computes wave height for a preset location given wind speed and direction.
 *
 * Body: { locationId: string, windSpeed_mph: number, windDir_deg: number | null }
 * Returns: WaveConditions
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { calcWaves, KNOWN_LOCATION_IDS } from '@walloon/shared';
import { ok, badRequest, internalError } from '../lib/response.js';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return badRequest('Invalid JSON body');
    }

    const { locationId, windSpeed_mph, windDir_deg } = body;

    if (typeof locationId !== 'string' || !KNOWN_LOCATION_IDS.includes(locationId)) {
      return badRequest(`locationId must be one of: ${KNOWN_LOCATION_IDS.join(', ')}`);
    }
    if (typeof windSpeed_mph !== 'number' || windSpeed_mph < 0 || windSpeed_mph > 200) {
      return badRequest('windSpeed_mph must be a number between 0 and 200');
    }
    if (windDir_deg !== null && windDir_deg !== undefined) {
      if (typeof windDir_deg !== 'number' || windDir_deg < 0 || windDir_deg >= 360) {
        return badRequest('windDir_deg must be a number 0–359.9, or null for variable direction');
      }
    }

    const result = calcWaves(
      locationId,
      windSpeed_mph,
      windDir_deg === undefined ? null : (windDir_deg as number | null),
    );

    return ok(result);
  } catch (err) {
    console.error('[weatherPredict] error:', err);
    return internalError('Wave prediction failed');
  }
};
