import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Bucket } from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import { BucketDeployment, Source } from '@aws-cdk/aws-s3-deployment';
import { ProductStackSynthesizer } from './private/product-stack-synthesizer';
import { ProductStackHistory } from './product-stack-history';

// keep this import separate from other imports to reduce chance for merge conflicts with v2-main
// eslint-disable-next-line no-duplicate-imports, import/order
import { Construct } from 'constructs';

/**
 * A Service Catalog product stack, which is similar in form to a Cloudformation nested stack.
 * You can add the resources to this stack that you want to define for your service catalog product.
 *
 * This stack will not be treated as an independent deployment
 * artifact (won't be listed in "cdk list" or deployable through "cdk deploy"),
 * but rather only synthesized as a template and uploaded as an asset to S3.
 *
 */
export class ProductStack extends cdk.Stack {
  public readonly templateFile: string;
  private _parentProductStackHistory?: ProductStackHistory;
  private _templateUrl?: string;
  private _parentStack: cdk.Stack;
  private readonly _sharedAssetLocation: string[];

  constructor(scope: Construct, id: string) {
    super(scope, id, {
      synthesizer: new ProductStackSynthesizer(),
    });

    this._parentStack = findParentStack(scope);
    // this is the file name of the synthesized template file within the cloud assembly
    this.templateFile = `${cdk.Names.uniqueId(this)}.product.template.json`;
    this._sharedAssetLocation = [];
  }

  /**
   * Set the parent product stack history
   *
   * @internal
   */
  public _setParentProductStackHistory(parentProductStackHistory: ProductStackHistory) {
    return this._parentProductStackHistory = parentProductStackHistory;
  }

  /**
   * Fetch the template URL.
   *
   * @internal
   */
  public _getTemplateUrl(): string {
    return cdk.Lazy.uncachedString({ produce: () => this._templateUrl });
  }

  public addFileAssetToParentSynthesizer(asset: cdk.FileAssetSource): cdk.FileAssetLocation {
    const bucket = Bucket.fromBucketName(this._parentStack, 'SharableAssetBucket_' + asset.fileName, 'sc-sharable-asset-deployment-bucket-alex');
    const s3Prefix = 'assets';

    //These values are hardcoded due to BucketDeployment unzipping asset
    const assetPath = './cdk.out/' + asset.fileName;

    new BucketDeployment(this._parentStack, 'Deploy_' + asset.fileName, {
      sources: [Source.asset(assetPath)],
      destinationBucket: bucket,
      destinationKeyPrefix: s3Prefix,
      unzipFile: false,
      // This "prune" keeps files in the bucket from previous bucket deployments.
      // This is beneficial in our usecase of multiple file assets per SC product.
      // TODO: May remove these comments
      prune: false,
    });

    const bucketName = bucket.bucketName;
    const s3Filename = asset.fileName?.split('.')[1] + '.zip';
    const objectKey = `${s3Prefix}/${s3Filename}`;

    const httpUrl = `https://s3.${bucketName}/${objectKey}`;
    const s3ObjectUrl = `s3://${bucketName}/${objectKey}`;

    return { bucketName, objectKey, httpUrl, s3ObjectUrl, s3Url: httpUrl };
  }

  public _getSharedAssetLocation(): ReadonlyArray<string> {
    return this._sharedAssetLocation;
  }


  /**
   * Synthesize the product stack template, overrides the `super` class method.
   *
   * Defines an asset at the parent stack which represents the template of this
   * product stack.
   *
   * @internal
   */
  public _synthesizeTemplate(session: cdk.ISynthesisSession): void {
    const cfn = JSON.stringify(this._toCloudFormation(), undefined, 2);
    const templateHash = crypto.createHash('sha256').update(cfn).digest('hex');

    this._templateUrl = this._parentStack.synthesizer.addFileAsset({
      packaging: cdk.FileAssetPackaging.FILE,
      sourceHash: templateHash,
      fileName: this.templateFile,
    }).httpUrl;

    if (this._parentProductStackHistory) {
      this._parentProductStackHistory._writeTemplateToSnapshot(cfn);
    }

    fs.writeFileSync(path.join(session.assembly.outdir, this.templateFile), cfn);
  }
}

/**
 * Validates the scope for a product stack, which must be defined within the scope of another `Stack`.
 */
function findParentStack(scope: Construct): cdk.Stack {
  try {
    const parentStack = cdk.Stack.of(scope);
    return parentStack as cdk.Stack;
  } catch (e) {
    throw new Error('Product stacks must be defined within scope of another non-product stack');
  }
}
