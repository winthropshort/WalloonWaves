/**
 * GET /weather/current
 * Returns the most recent NWS forecast period whose startTime ≤ now.
 * Queries today's date partition, falls back to yesterday if needed.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE_NAME } from '../lib/dynamo.js';
import { ok, internalError } from '../lib/response.js';

function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function queryLatest(dateStr: string, beforeIso: string) {
  const result = await db.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND SK <= :skMax',
    ExpressionAttributeValues: {
      ':pk':    `WEATHER#${dateStr}`,
      ':skMax': `OBS#${beforeIso}`,
    },
    ScanIndexForward: false,
    Limit: 1,
  }));
  return result.Items?.[0] ?? null;
}

export const handler: APIGatewayProxyHandler = async () => {
  try {
    const now     = new Date();
    const nowIso  = now.toISOString();
    const today   = utcDateStr(now);

    let item = await queryLatest(today, nowIso);

    if (!item) {
      const yesterday = utcDateStr(new Date(now.getTime() - 86_400_000));
      item = await queryLatest(yesterday, nowIso);
    }

    if (!item) {
      return ok(null);
    }

    return ok(item);
  } catch (err) {
    console.error('[weatherCurrent] error:', err);
    return internalError('Failed to retrieve current weather');
  }
};
