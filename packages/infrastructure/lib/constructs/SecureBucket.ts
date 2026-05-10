import { Construct } from 'constructs';
import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess,
  ObjectOwnership,
  HttpMethods,
} from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface SecureBucketProps {
  bucketName?: string;
  retain?: boolean;
  allowPutCors?: boolean;
}

export class SecureBucket extends Bucket {
  constructor(scope: Construct, id: string, props: SecureBucketProps = {}) {
    const { retain = false, allowPutCors = false } = props;

    super(scope, id, {
      bucketName: props.bucketName,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      removalPolicy: retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !retain,
      ...(allowPutCors
        ? {
            cors: [
              {
                allowedMethods: [HttpMethods.PUT],
                allowedOrigins: ['*'],
                allowedHeaders: ['*'],
                maxAge: 3600,
              },
            ],
          }
        : {}),
    });
  }
}
