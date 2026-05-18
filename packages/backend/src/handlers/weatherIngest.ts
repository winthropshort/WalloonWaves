/**
 * WeatherIngest Lambda — triggered by EventBridge every 4 hours.
 * Fetches NWS hourly forecast and writes all periods to DynamoDB.
 *
 * DynamoDB schema:
 *   PK  = WEATHER#<YYYY-MM-DD>   (UTC date of period startTime)
 *   SK  = OBS#<ISO-UTC-timestamp>
 *   ttl = unix timestamp 90 days from period startTime
 */

import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE_NAME } from '../lib/dynamo.js';
import { fetchHourlyForecast, fetchGridpointData, degToLabel } from '../lib/nws.js';

const TTL_DAYS = 90;

/** NWS wind-chill formula, valid when T ≤ 50 °F and V ≥ 3 mph. */
function windChill(temp_f: number, windSpeed_mph: number): number {
  if (temp_f > 50 || windSpeed_mph < 3) return temp_f;
  const v = Math.pow(windSpeed_mph, 0.16);
  return Math.round((35.74 + 0.6215 * temp_f - 35.75 * v + 0.4275 * temp_f * v) * 10) / 10;
}

function toUtcDateStr(isoWithOffset: string): string {
  return new Date(isoWithOffset).toISOString().slice(0, 10);  // YYYY-MM-DD
}

function toUtcIso(isoWithOffset: string): string {
  return new Date(isoWithOffset).toISOString();
}

export const handler = async (): Promise<void> => {
  const fetchedAt = new Date().toISOString();
  console.log(`[WeatherIngest] Starting fetch at ${fetchedAt}`);

  let periods;
  try {
    periods = await fetchHourlyForecast();
  } catch (err) {
    console.error('[WeatherIngest] NWS fetch failed:', err);
    throw err;
  }

  console.log(`[WeatherIngest] Fetched ${periods.length} periods`);

  let gridpoint = {
    pressureMap:  new Map<string, number>(),
    skyCoverMap:  new Map<string, number>(),
    precipMap:    new Map<string, number>(),
    windSpeedMap: new Map<string, number>(),
    windGustMap:  new Map<string, number>(),
    windDirMap:   new Map<string, number>(),
  };
  try {
    gridpoint = await fetchGridpointData();
    console.log(`[WeatherIngest] Gridpoint: ${gridpoint.pressureMap.size} pressure, ${gridpoint.skyCoverMap.size} sky cover, ${gridpoint.precipMap.size} precip values`);
  } catch (err) {
    console.warn('[WeatherIngest] Gridpoint fetch failed, continuing without gridpoint data:', err);
  }

  const { pressureMap, skyCoverMap, precipMap, windSpeedMap, windGustMap, windDirMap } = gridpoint;

  const items = periods.map((p) => {
    const utcIso  = toUtcIso(p.startTime);
    const dateStr = toUtcDateStr(p.startTime);
    const startMs = new Date(p.startTime).getTime();
    const ttl     = Math.floor(startMs / 1000) + TTL_DAYS * 86400;

    const hourKey   = utcIso.slice(0, 13); // "YYYY-MM-DDTHH"
    const pressure  = pressureMap.get(hourKey);
    const skyCover  = skyCoverMap.get(hourKey);
    const precipMm  = precipMap.get(hourKey);

    // Prefer Open-Meteo for numeric wind (continuous degrees, mph); fall back to NWS
    const omSpeed = windSpeedMap.get(hourKey);
    const omGust  = windGustMap.get(hourKey);
    const omDir   = windDirMap.get(hourKey);
    const windSpeed = omSpeed ?? p.windSpeed_mph;
    const windGust  = omGust  ?? p.windGust_mph;
    const windDeg   = omDir   !== undefined ? omDir : p.windDir_deg;
    const windLabel = omDir   !== undefined ? degToLabel(omDir) : p.windDir_label;

    return {
      PK:            `WEATHER#${dateStr}`,
      SK:            `OBS#${utcIso}`,
      timestamp:     utcIso,
      windSpeed_mph: windSpeed,
      windGust_mph:  windGust,
      windDir_deg:   windDeg,
      windDir_label: windLabel,
      temperature_f: p.temperature_f,
      windChill_f:   windChill(p.temperature_f, windSpeed),
      ...(pressure  !== undefined && { pressure_mb:  pressure }),
      ...(p.pop_pct !== null      && p.pop_pct !== undefined && { pop_pct: p.pop_pct }),
      ...(skyCover  !== undefined && { skyCover_pct: Math.round(skyCover) }),
      ...(precipMm  !== undefined && { precip_in:    Math.round(precipMm * 0.03937 * 1000) / 1000 }),
      shortForecast: p.shortForecast,
      ttl,
      fetchedAt,
    };
  });

  // DynamoDB BatchWrite: max 25 items per request
  const CHUNK = 25;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    await db.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: chunk.map((item) => ({ PutRequest: { Item: item } })),
      },
    }));
  }

  console.log(`[WeatherIngest] Wrote ${items.length} items to DynamoDB`);
};
