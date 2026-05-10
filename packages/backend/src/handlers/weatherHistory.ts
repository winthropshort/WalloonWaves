/**
 * GET /weather/history?hours=48
 * Returns NWS forecast periods from the past N hours (default 48, max 168).
 * Queries all date partitions that overlap the requested window.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE_NAME } from '../lib/dynamo.js';
import { ok, badRequest, internalError } from '../lib/response.js';

function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** All YYYY-MM-DD UTC dates between two dates (inclusive). */
function dateBetween(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cur = new Date(Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
  ));
  const endDay = new Date(Date.UTC(
    end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(),
  ));
  while (cur <= endDay) {
    dates.push(utcDateStr(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const hoursParam = event.queryStringParameters?.['hours'];
    const hours = hoursParam ? parseInt(hoursParam, 10) : 48;

    if (isNaN(hours) || hours < 1 || hours > 168) {
      return badRequest('hours must be between 1 and 168');
    }

    const now      = new Date();
    const start    = new Date(now.getTime() - hours * 3_600_000);
    const startIso = start.toISOString();
    const nowIso   = now.toISOString();

    const dates = dateBetween(start, now);

    const allItems: unknown[] = [];

    for (const dateStr of dates) {
      const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :skMin AND :skMax',
        ExpressionAttributeValues: {
          ':pk':    `WEATHER#${dateStr}`,
          ':skMin': `OBS#${startIso}`,
          ':skMax': `OBS#${nowIso}`,
        },
        ScanIndexForward: true,
      }));
      if (result.Items) allItems.push(...result.Items);
    }

    // Sort ascending by SK (already in ISO order, so string sort is correct)
    allItems.sort((a, b) => {
      const aKey = (a as { SK: string }).SK;
      const bKey = (b as { SK: string }).SK;
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });

    return ok(allItems);
  } catch (err) {
    console.error('[weatherHistory] error:', err);
    return internalError('Failed to retrieve weather history');
  }
};
