/**
 * GET /locations
 * Returns the three preset Walloon Lake locations, each augmented with:
 *   - currentWave: WaveConditions computed from the most recent NWS observation
 *   - weatherUpdated: ISO timestamp of that observation
 *
 * All three locations share the same NWS wind data (same grid point).
 * Wave height differs between them only because of their individual fetch tables.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PRESET_LOCATIONS, calcWaves } from '@walloon/shared';
import { db, TABLE_NAME } from '../lib/dynamo.js';
import { ok, internalError } from '../lib/response.js';

function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function getCurrentWeather() {
  const now     = new Date();
  const nowIso  = now.toISOString();
  const today   = utcDateStr(now);

  const query = async (dateStr: string) => {
    const result = await db.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK <= :skMax',
      ExpressionAttributeValues: {
        ':pk':    `WEATHER#${dateStr}`,
        ':skMax': `OBS#${nowIso}`,
      },
      ScanIndexForward: false,
      Limit: 1,
    }));
    return result.Items?.[0] ?? null;
  };

  const item = await query(today);
  if (item) return item;

  const yesterday = utcDateStr(new Date(now.getTime() - 86_400_000));
  return query(yesterday);
}

export const handler: APIGatewayProxyHandler = async () => {
  try {
    const now     = new Date();
    const weather = await getCurrentWeather();

    const windSpeed_mph = (weather?.windSpeed_mph as number | undefined) ?? 0;
    const windDir_deg   = (weather?.windDir_deg   as number | null | undefined) ?? null;
    const weatherTs     = (weather?.timestamp     as string | undefined)        ?? null;

    const dataAge_hours = weatherTs
      ? Math.round((now.getTime() - new Date(weatherTs).getTime()) / 360_000) / 10
      : null;
    const stale = dataAge_hours !== null && dataAge_hours > 8;

    const locations = PRESET_LOCATIONS.map((loc) => ({
      ...loc,
      currentWave:    calcWaves(loc.id, windSpeed_mph, windDir_deg),
      weatherUpdated: weatherTs,
      dataAge_hours,
      stale,
    }));

    return ok(locations);
  } catch (err) {
    console.error('[weatherLocations] error:', err);
    return internalError('Failed to retrieve locations');
  }
};
