/**
 * ApiStack — API Gateway REST API + Lambda functions.
 * Region: us-east-2.
 *
 * Phase 2 endpoints:
 *   GET /health              — liveness check
 *   GET /weather/current     — most recent NWS forecast period (≤ now)
 *   GET /weather/history     — past N hours of forecast periods (?hours=48)
 *
 * Background:
 *   EventBridge rate(4 hours) → WeatherIngest Lambda → DynamoDB
 */

import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  RestApi,
  LambdaIntegration,
  Cors,
  MethodLoggingLevel,
  LogGroupLogDestination,
  AccessLogFormat,
} from 'aws-cdk-lib/aws-apigateway';
import { Function, Runtime, Code, Architecture } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction as LambdaTarget } from 'aws-cdk-lib/aws-events-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { AppLambda } from '../constructs/AppLambda.js';
import { StorageStack } from './StorageStack.js';
import type { WalloonConfig } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = path.resolve(__dirname, '../../../backend/src');

export interface ApiStackProps extends StackProps {
  config: WalloonConfig;
  tableNameSsmParam: string;
  tags?: Record<string, string>;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, {
      ...props,
      env: { account: props.config.account, region: props.config.region },
    });

    const { config } = props;
    const tableName = StringParameter.valueForStringParameter(this, props.tableNameSsmParam);

    const commonEnv = {
      DYNAMODB_TABLE_NAME: tableName,
      ENV_NAME:            config.env,
      CORS_ORIGIN:         config.env === 'prod' ? `https://${config.domainName}` : '*',
    };

    const dynamoReadPolicy = new PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:GetItem'],
      resources: [
        `arn:aws:dynamodb:${config.region}:${config.account}:table/walloon-${config.env}-main`,
      ],
    });

    const dynamoWritePolicy = new PolicyStatement({
      actions: [
        'dynamodb:PutItem', 'dynamodb:BatchWriteItem',
        'dynamodb:UpdateItem', 'dynamodb:DeleteItem',
      ],
      resources: [
        `arn:aws:dynamodb:${config.region}:${config.account}:table/walloon-${config.env}-main`,
      ],
    });

    // ─── Health Lambda (inline — no external deps) ───────────────────────────
    const healthFn = new Function(this, 'HealthFn', {
      functionName: `walloon-${config.env}-health`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromInline(
        `exports.handler = async () => ({
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ success: true, data: { status: 'ok', env: '${config.env}' } }),
        });`,
      ),
      memorySize: 128,
      timeout: Duration.seconds(5),
    });

    // ─── WeatherIngest Lambda (EventBridge-triggered) ────────────────────────
    const ingestFn = new AppLambda(this, 'WeatherIngestFn', {
      functionName: `walloon-${config.env}-weather-ingest`,
      config,
      entry:   path.join(BACKEND_SRC, 'handlers/weatherIngest.ts'),
      handler: 'handler',
      extraEnv: commonEnv,
    });
    ingestFn.addToRolePolicy(dynamoWritePolicy);

    // ─── WeatherCurrent Lambda ───────────────────────────────────────────────
    const currentFn = new AppLambda(this, 'WeatherCurrentFn', {
      functionName: `walloon-${config.env}-weather-current`,
      config,
      entry:   path.join(BACKEND_SRC, 'handlers/weatherCurrent.ts'),
      handler: 'handler',
      extraEnv: commonEnv,
    });
    currentFn.addToRolePolicy(dynamoReadPolicy);

    // ─── WeatherHistory Lambda ───────────────────────────────────────────────
    const historyFn = new AppLambda(this, 'WeatherHistoryFn', {
      functionName: `walloon-${config.env}-weather-history`,
      config,
      entry:   path.join(BACKEND_SRC, 'handlers/weatherHistory.ts'),
      handler: 'handler',
      extraEnv: commonEnv,
    });
    historyFn.addToRolePolicy(dynamoReadPolicy);

    // ─── WeatherPredict Lambda (stateless — no DynamoDB) ─────────────────────
    const predictFn = new AppLambda(this, 'WeatherPredictFn', {
      functionName: `walloon-${config.env}-weather-predict`,
      config,
      entry:   path.join(BACKEND_SRC, 'handlers/weatherPredict.ts'),
      handler: 'handler',
      extraEnv: commonEnv,
    });

    // ─── WeatherGeocode Lambda (stateless — calls Nominatim) ─────────────────
    const geocodeFn = new AppLambda(this, 'WeatherGeocodeFn', {
      functionName: `walloon-${config.env}-weather-geocode`,
      config,
      entry:   path.join(BACKEND_SRC, 'handlers/weatherGeocode.ts'),
      handler: 'handler',
      extraEnv: commonEnv,
    });

    // ─── WeatherLocations Lambda ──────────────────────────────────────────────
    const locationsFn = new AppLambda(this, 'WeatherLocationsFn', {
      functionName: `walloon-${config.env}-weather-locations`,
      config,
      entry:   path.join(BACKEND_SRC, 'handlers/weatherLocations.ts'),
      handler: 'handler',
      extraEnv: commonEnv,
    });
    locationsFn.addToRolePolicy(dynamoReadPolicy);

    // ─── EventBridge: every 4 hours → WeatherIngest ─────────────────────────
    new Rule(this, 'WeatherIngestRule', {
      ruleName:    `walloon-${config.env}-weather-ingest`,
      description: 'Trigger NWS forecast ingest every 4 hours',
      schedule:    Schedule.rate(Duration.hours(4)),
      targets:     [new LambdaTarget(ingestFn)],
    });

    // ─── API Gateway ─────────────────────────────────────────────────────────
    const accessLogGroup = new LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/walloon-${config.env}-api-access`,
      retention:    RetentionDays.THREE_MONTHS,
    });

    const api = new RestApi(this, 'WalloonApi', {
      restApiName: `walloon-${config.env}`,
      description: 'WalloonWaves API',
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ['Content-Type'],
      },
      deployOptions: {
        stageName: 'v1',
        loggingLevel: MethodLoggingLevel.INFO,
        metricsEnabled: true,
        accessLogDestination: new LogGroupLogDestination(accessLogGroup),
        accessLogFormat: AccessLogFormat.custom(
          '{"requestId":"$context.requestId"' +
          ',"ip":"$context.identity.sourceIp"' +
          ',"method":"$context.httpMethod"' +
          ',"path":"$context.path"' +
          ',"status":"$context.status"' +
          ',"latency":"$context.responseLatency"}',
        ),
      },
    });

    // GET /health
    api.root
      .addResource('health')
      .addMethod('GET', new LambdaIntegration(healthFn));

    // GET  /weather/current
    // GET  /weather/history?hours=N
    // POST /weather/predict
    // GET  /weather/geocode?address=...
    // GET  /weather/locations
    const weather = api.root.addResource('weather');
    weather.addResource('current').addMethod('GET',  new LambdaIntegration(currentFn));
    weather.addResource('history').addMethod('GET',  new LambdaIntegration(historyFn));
    weather.addResource('predict').addMethod('POST', new LambdaIntegration(predictFn));
    weather.addResource('geocode').addMethod('GET',  new LambdaIntegration(geocodeFn));
    weather.addResource('locations').addMethod('GET', new LambdaIntegration(locationsFn));

    // ─── SSM: store API URL for deploy scripts ────────────────────────────────
    new StringParameter(this, 'ApiUrlParam', {
      parameterName: `/walloon/${config.env}/api/url`,
      stringValue:   api.url,
    });

    new CfnOutput(this, 'ApiUrl', {
      value:       api.url,
      description: 'API Gateway invoke URL',
    });
  }
}
