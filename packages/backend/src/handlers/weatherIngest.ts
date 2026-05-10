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
import { fetchHourlyForecast } from '../lib/nws.js';

const TTL_DAYS = 90;

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

  const items = periods.map((p) => {
    const utcIso  = toUtcIso(p.startTime);
    const dateStr = toUtcDateStr(p.startTime);
    const startMs = new Date(p.startTime).getTime();
    const ttl     = Math.floor(startMs / 1000) + TTL_DAYS * 86400;

    return {
      PK:            `WEATHER#${dateStr}`,
      SK:            `OBS#${utcIso}`,
      timestamp:     utcIso,
      windSpeed_mph: p.windSpeed_mph,
      windGust_mph:  p.windGust_mph,
      windDir_deg:   p.windDir_deg,
      windDir_label: p.windDir_label,
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
