import * as cdk from '@aws-cdk/core';
import { Fn } from '@aws-cdk/core';
import { assertBound } from '@aws-cdk/core/lib/stack-synthesizers/_shared';
import * as cxapi from '@aws-cdk/cx-api';

export const BOOTSTRAP_QUALIFIER_CONTEXT = '@aws-cdk/core:bootstrapQualifier';


/**
 * Deployment environment for an AWS Service Catalog product stack.
 *
 * Interoperates with the StackSynthesizer of the parent stack.
 */
export class ProductStackSynthesizer extends cdk.StackSynthesizer {
  private stack?: cdk.Stack;
  private _parentStack?: cdk.Stack;
  private _fileLocations?: [string, string][];

  constructor(parentStack: cdk.Stack) {
    super();
    this._parentStack = parentStack;
    this._fileLocations = [];
  }

  public bind(stack: cdk.Stack): void {
    if (this.stack !== undefined) {
      throw new Error('A Stack Synthesizer can only be bound once, create a new instance to use with a different Stack');
    }
    this.stack = stack;
  }

  public addFileAsset(_asset: cdk.FileAssetSource): cdk.FileAssetLocation {
    if (this._parentStack) {
      assertBound(this._parentStack);
      this._parentStack.synthesizer.addFileAsset(_asset);
      const bucketName = `cdk-hnb659fds-assets-${this._parentStack.account}-${this._parentStack.region}`;
      //const bucketName = 'test-for-service-catalog-assets';

      // key is prefix|postfix
      const encodedKey = `assets/||${_asset.sourceHash}.zip`;

      const s3Prefix = Fn.select(0, Fn.split(cxapi.ASSET_PREFIX_SEPARATOR, encodedKey));
      const s3Filename = Fn.select(1, Fn.split(cxapi.ASSET_PREFIX_SEPARATOR, encodedKey));
      const objectKey = `${s3Prefix}${s3Filename}`;

      const httpUrl = `https://s3.${this._parentStack.region}.${this._parentStack.urlSuffix}/${bucketName}/${objectKey}`;
      const s3ObjectUrl = `s3://${bucketName}/${objectKey}`;

      console.log("File locations before: " + this._fileLocations);
      this._fileLocations?.push([bucketName, objectKey]);
      console.log("File locations after: " + this._fileLocations);
      return { bucketName, objectKey, httpUrl, s3ObjectUrl, s3Url: httpUrl };
    } else {
      throw new Error('Service Catalog Product Stacks cannot use Assets');
    }
  }

  public addDockerImageAsset(_asset: cdk.DockerImageAssetSource): cdk.DockerImageAssetLocation {
    throw new Error('Service Catalog Product Stacks cannot use Assets');
  }

  public synthesize(session: cdk.ISynthesisSession): void {
    if (!this.stack) {
      throw new Error('You must call bindStack() first');
    }
    // Synthesize the template, but don't emit as a cloud assembly artifact.
    // It will be registered as an S3 asset of its parent instead.
    this.synthesizeStackTemplate(this.stack, session);
  }

  public getFileLocations(): [string, string][] {
    return this._fileLocations ?? [];
  }
}
