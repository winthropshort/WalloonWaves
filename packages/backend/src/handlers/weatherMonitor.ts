/**
 * WeatherMonitor Lambda — runs daily at 8 AM UTC via EventBridge.
 * Checks DynamoDB data freshness and publishes a summary to SNS.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { db, TABLE_NAME } from '../lib/dynamo.js';

const sns = new SNSClient({});
const SNS_TOPIC_ARN = process.env['SNS_TOPIC_ARN']!;
const ENV_NAME      = process.env['ENV_NAME'] ?? 'dev';

function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function getLatestWeather() {
  const now    = new Date();
  const nowIso = now.toISOString();

  const query = async (dateStr: string) => {
    const result = await db.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK <= :skMax',
      ExpressionAttributeValues: { ':pk': `WEATHER#${dateStr}`, ':skMax': `OBS#${nowIso}` },
      ScanIndexForward: false,
      Limit: 1,
    }));
    return result.Items?.[0] ?? null;
  };

  const item = await query(utcDateStr(now));
  if (item) return item;

  return query(utcDateStr(new Date(now.getTime() - 86_400_000)));
}

export const handler = async (): Promise<void> => {
  const now = new Date();
  console.log(`[WeatherMonitor] Daily check at ${now.toISOString()}`);

  const latest = await getLatestWeather();

  let subject: string;
  let message: string;

  if (!latest) {
    subject = `⚠ WalloonWaves ${ENV_NAME}: No weather data`;
    message = [
      `WalloonWaves daily monitor — ${now.toUTCString()}`,
      '',
      '⚠ No weather data found in DynamoDB.',
      'The WeatherIngest Lambda may have failed repeatedly.',
    ].join('\n');
  } else {
    const ts        = latest.timestamp as string;
    const ageHours  = (now.getTime() - new Date(ts).getTime()) / 3_600_000;
    const stale     = ageHours > 8;
    const windSpeed = (latest.windSpeed_mph as number | null) ?? 0;
    const windDir   = (latest.windDir_label as string | null) ?? 'VRB';
    const forecast  = (latest.shortForecast as string | null) ?? 'Unknown';

    subject = stale
      ? `⚠ WalloonWaves ${ENV_NAME}: Stale data (${ageHours.toFixed(1)}h old)`
      : `✓ WalloonWaves ${ENV_NAME}: Daily check OK`;

    message = [
      `WalloonWaves daily monitor — ${now.toUTCString()}`,
      '',
      `Latest data:  ${ts}`,
      `Data age:     ${ageHours.toFixed(1)} hours ${stale ? '⚠ STALE' : '✓'}`,
      '',
      `Wind:         ${windSpeed} mph from ${windDir}`,
      `Forecast:     ${forecast}`,
    ].join('\n');
  }

  await sns.send(new PublishCommand({
    TopicArn: SNS_TOPIC_ARN,
    Subject:  subject,
    Message:  message,
  }));

  console.log(`[WeatherMonitor] Published: ${subject}`);
};
