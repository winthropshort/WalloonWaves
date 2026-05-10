export type Environment = 'dev' | 'prod';

export interface WalloonConfig {
  env: Environment;
  account: string;
  region: string;
  usEast1Region: string;
  domainName: string;
  monitoringEmail: string;
  frontendUrl: string;
  retain: boolean;
  logRetentionDays: number;
  lambdaMemoryMb: number;
  lambdaTimeoutSeconds: number;
}

const BASE: Omit<WalloonConfig, 'env' | 'domainName' | 'frontendUrl' | 'retain' | 'account'> = {
  region: 'us-east-2',
  usEast1Region: 'us-east-1',
  monitoringEmail: 'wshort@gmail.com',
  logRetentionDays: 30,
  lambdaMemoryMb: 256,
  lambdaTimeoutSeconds: 29,
};

export function getConfig(env: Environment, account: string): WalloonConfig {
  if (env === 'prod') {
    return {
      ...BASE,
      env: 'prod',
      account,
      domainName: 'walloon.org',
      frontendUrl: 'https://walloon.org/weather',
      retain: true,
      logRetentionDays: 90,
    };
  }

  return {
    ...BASE,
    env: 'dev',
    account,
    domainName: 'dev.walloon.org',
    frontendUrl: 'https://dev.walloon.org/weather',
    retain: false,
  };
}
