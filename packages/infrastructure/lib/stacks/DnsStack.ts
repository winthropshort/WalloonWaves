/**
 * DnsStack — Route53 hosted zone + ACM certificate.
 * Region: us-east-1 (required for CloudFront).
 *
 * Deploy first. After deploying, copy NameServers output into your registrar.
 * Domain TBD with WLA — will be walloon.org/weather or a subdomain.
 */

import { Stack, type StackProps, CfnOutput, Fn } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { WalloonConfig } from '../config.js';

export interface DnsStackProps extends StackProps {
  config: WalloonConfig;
}

export class DnsStack extends Stack {
  static ssmKeys(env: string) {
    return {
      hostedZoneId:   `/walloon/${env}/dns/hostedZoneId`,
      certificateArn: `/walloon/${env}/dns/certificateArn`,
    };
  }

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, {
      ...props,
      env: { account: props.config.account, region: props.config.usEast1Region },
    });

    const { config } = props;

    const hostedZone = new HostedZone(this, 'HostedZone', {
      zoneName: config.domainName,
    });

    const cert = new Certificate(this, 'Certificate', {
      domainName: config.domainName,
      subjectAlternativeNames: [`*.${config.domainName}`],
      validation: CertificateValidation.fromDns(hostedZone),
    });

    const ssm = DnsStack.ssmKeys(config.env);

    new StringParameter(this, 'HostedZoneIdParam', {
      parameterName: ssm.hostedZoneId,
      stringValue: hostedZone.hostedZoneId,
    });

    new StringParameter(this, 'CertArnParam', {
      parameterName: ssm.certificateArn,
      stringValue: cert.certificateArn,
    });

    new CfnOutput(this, 'NameServers', {
      value: Fn.join(', ', hostedZone.hostedZoneNameServers!),
      description: 'Route53 NS records — enter these as custom nameservers at your registrar',
    });

    new CfnOutput(this, 'HostedZoneId', {
      value: hostedZone.hostedZoneId,
    });
  }
}
