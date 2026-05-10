/**
 * FrontendStack — CloudFront distribution + S3 web bucket.
 * Region: us-east-1 (CloudFront global; bucket + CF must be us-east-1).
 */

import { Stack, type StackProps, RemovalPolicy, CfnOutput, Duration } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import {
  Distribution,
  ViewerProtocolPolicy,
  CachePolicy,
  AllowedMethods,
  ResponseHeadersPolicy,
  HeadersFrameOption,
  HeadersReferrerPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { HostedZone, ARecord, CnameRecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { DnsStack } from './DnsStack.js';
import type { WalloonConfig } from '../config.js';

export interface FrontendStackProps extends StackProps {
  config: WalloonConfig;
  tags?: Record<string, string>;
}

export class FrontendStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, {
      ...props,
      env: { account: props.config.account, region: props.config.usEast1Region },
    });

    const { config } = props;

    const webBucket = new Bucket(this, 'WebBucket', {
      bucketName: `walloon-${config.env}-web-${config.account}`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      removalPolicy: config.retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.retain,
    });

    const isProd = config.env === 'prod';
    const certificate = isProd
      ? Certificate.fromCertificateArn(
          this,
          'Cert',
          StringParameter.valueForStringParameter(this, DnsStack.ssmKeys(config.env).certificateArn),
        )
      : undefined;

    const securityHeaders = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `walloon-${config.env}-security`,
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.seconds(63072000),
          includeSubdomains: true,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        responseHeadersPolicy: securityHeaders,
      },
      ...(isProd && certificate
        ? { domainNames: [config.domainName], certificate }
        : {}),
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      defaultRootObject: 'index.html',
      comment: `walloon-${config.env}`,
    });

    if (isProd) {
      const hostedZone = HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: StringParameter.valueForStringParameter(
          this, DnsStack.ssmKeys(config.env).hostedZoneId,
        ),
        zoneName: config.domainName,
      });

      new ARecord(this, 'ApexAlias', {
        zone: hostedZone,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
      });

      new CnameRecord(this, 'WwwCname', {
        zone: hostedZone,
        recordName: 'www',
        domainName: distribution.distributionDomainName,
      });
    }

    new CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName,
      description: 'CloudFront distribution domain',
    });

    new CfnOutput(this, 'WebBucketName', {
      value: webBucket.bucketName,
      description: 'S3 web bucket',
    });

    new CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID (for cache invalidation)',
    });
  }
}
