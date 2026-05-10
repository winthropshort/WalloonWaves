#!/usr/bin/env node
/**
 * CDK App entry point.
 *
 * Stack deploy order:
 *   1. WalloonWaves-Dns      (us-east-1) — Route53 + ACM cert
 *   2. WalloonWaves-Storage  (us-east-2) — DynamoDB + S3
 *   3. WalloonWaves-Api      (us-east-2) — API Gateway + Lambda
 *   4. WalloonWaves-Frontend (us-east-1) — CloudFront
 *
 * Usage:
 *   cdk synth --context env=dev
 *   cdk deploy --all --context env=dev
 */

import { App } from 'aws-cdk-lib';
import { getConfig, type Environment } from '../lib/config.js';
import { DnsStack } from '../lib/stacks/DnsStack.js';
import { StorageStack } from '../lib/stacks/StorageStack.js';
import { ApiStack } from '../lib/stacks/ApiStack.js';
import { FrontendStack } from '../lib/stacks/FrontendStack.js';

const app = new App();

const envName = (app.node.tryGetContext('env') as string | undefined) ?? 'dev';
if (envName !== 'dev' && envName !== 'prod') {
  throw new Error(`Invalid env context: "${envName}". Must be "dev" or "prod".`);
}

const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'];
if (!account) {
  throw new Error('CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID must be set');
}

const config = getConfig(envName as Environment, account);

const tags = {
  Project: 'WalloonWaves',
  Environment: config.env,
  ManagedBy: 'CDK',
};

// 1. DNS + TLS (us-east-1)
const dnsStack = new DnsStack(app, `WalloonWaves-Dns-${config.env}`, { config, tags });

// 2. Storage — DynamoDB (us-east-2)
const storageStack = new StorageStack(app, `WalloonWaves-Storage-${config.env}`, { config, tags });

// 3. API — API Gateway + Lambda (us-east-2)
const storageSsm = StorageStack.ssmKeys(config.env);
const apiStack = new ApiStack(app, `WalloonWaves-Api-${config.env}`, {
  config,
  tags,
  tableNameSsmParam: storageSsm.tableName,
});
apiStack.addDependency(storageStack);

// 4. Frontend — CloudFront (us-east-1)
const frontendStack = new FrontendStack(app, `WalloonWaves-Frontend-${config.env}`, { config, tags });
if (config.env === 'prod') {
  frontendStack.addDependency(dnsStack);
}

void storageStack;
void apiStack;

app.synth();
