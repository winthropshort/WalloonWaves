/**
 * StorageStack — DynamoDB single-table + S3 web bucket.
 * Region: us-east-2.
 *
 * CRITICAL: RemovalPolicy.RETAIN in production. Never destroy in prod.
 */

import { Stack, type StackProps, RemovalPolicy } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { WalloonConfig } from '../config.js';

export interface StorageStackProps extends StackProps {
  config: WalloonConfig;
  tags?: Record<string, string>;
}

export class StorageStack extends Stack {
  static ssmKeys(env: string) {
    return {
      tableName: `/walloon/${env}/storage/tableName`,
    };
  }

  readonly table: Table;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, {
      ...props,
      env: { account: props.config.account, region: props.config.region },
    });

    const { config } = props;
    const retentionPolicy = config.retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // Single-table design: PK=WEATHER#<date>, SK=OBS#<timestamp>; TTL=90 days
    this.table = new Table(this, 'MainTable', {
      tableName: `walloon-${config.env}-main`,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey:      { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: config.retain },
      removalPolicy: retentionPolicy,
    });

    const ssm = StorageStack.ssmKeys(config.env);

    new StringParameter(this, 'TableNameParam', {
      parameterName: ssm.tableName,
      stringValue: this.table.tableName,
    });
  }
}
