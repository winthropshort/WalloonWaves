/**
 * ApiStack — API Gateway REST API + Lambda functions.
 * Region: us-east-2.
 *
 * Phase 1: skeleton only — placeholder Lambda wired to GET /health.
 * Phase 2 adds WeatherIngest Lambda + EventBridge rule.
 * Phase 3 adds wave prediction endpoints.
 */

import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import {
  RestApi,
  LambdaIntegration,
  Cors,
  MethodLoggingLevel,
  LogGroupLogDestination,
  AccessLogFormat,
} from 'aws-cdk-lib/aws-apigateway';
import { Function, Runtime, Code, Architecture } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { StorageStack } from './StorageStack.js';
import type { WalloonConfig } from '../config.js';

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

    // ─── Placeholder Lambda ───────────────────────────────────────────────────
    const healthFn = new Function(this, 'HealthFn', {
      functionName: `walloon-${config.env}-health`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromInline(`
        exports.handler = async () => ({
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ok', env: '${config.env}' }),
        });
      `),
      memorySize: config.lambdaMemoryMb,
      timeout: Duration.seconds(config.lambdaTimeoutSeconds),
      environment: {
        DYNAMODB_TABLE_NAME: tableName,
        ENV_NAME: config.env,
        CORS_ORIGIN: config.env === 'prod' ? `https://${config.domainName}` : '*',
      },
    });

    // ─── API Gateway access log group ─────────────────────────────────────────
    const accessLogGroup = new LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/walloon-${config.env}-api-access`,
      retention: RetentionDays.THREE_MONTHS,
    });

    // ─── API Gateway ──────────────────────────────────────────────────────────
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
    const health = api.root.addResource('health');
    health.addMethod('GET', new LambdaIntegration(healthFn));

    // ─── SSM: store API URL for frontend env file ─────────────────────────────
    new StringParameter(this, 'ApiUrlParam', {
      parameterName: `/walloon/${config.env}/api/url`,
      stringValue: api.url,
    });

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway invoke URL',
    });

    // Suppress unused variable warning
    void healthFn;
  }
}
