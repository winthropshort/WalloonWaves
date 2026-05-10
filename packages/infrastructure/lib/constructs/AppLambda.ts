import { Construct } from 'constructs';
import { NodejsFunction, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type { WalloonConfig } from '../config.js';

export interface AppLambdaProps extends Omit<NodejsFunctionProps, 'runtime' | 'architecture'> {
  config: WalloonConfig;
  extraEnv?: Record<string, string>;
}

/** Lambda pre-configured for WalloonWaves: Node 22 ARM64, esbuild-bundled. */
export class AppLambda extends NodejsFunction {
  constructor(scope: Construct, id: string, props: AppLambdaProps) {
    const { config, extraEnv = {}, ...rest } = props;

    const logGroupName = `/aws/lambda/walloon-${config.env}-${id}`;

    const logGroup = new LogGroup(scope, `${id}LogGroup`, {
      logGroupName,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: config.retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    super(scope, id, {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: config.lambdaMemoryMb,
      timeout: Duration.seconds(config.lambdaTimeoutSeconds),
      logGroup,
      bundling: {
        forceDockerBundling: false,
        minify: true,
        sourceMap: config.env === 'dev',
        target: 'node22',
        externalModules: [],  // bundle AWS SDK v3 (not included in Node 22 runtime)
      },
      environment: {
        NODE_ENV: config.env,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        ...extraEnv,
      },
      ...rest,
    });
  }
}
