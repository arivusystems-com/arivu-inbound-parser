import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { Env } from '@arivu/config';
import { Readable } from 'node:stream';

export interface ObjectStorage {
  putRawMime(tenantId: string, messageId: string, stream: Readable): Promise<string>;
  getRawMime(path: string): Promise<Readable>;
  putAttachment(tenantId: string, attachmentId: string, stream: Readable, contentType: string): Promise<string>;
  rawMimePath(tenantId: string, messageId: string): string;
  attachmentPath(tenantId: string, attachmentId: string): string;
}

export function createObjectStorage(config: Pick<
  Env,
  | 'STORAGE_ENDPOINT'
  | 'STORAGE_REGION'
  | 'STORAGE_ACCESS_KEY'
  | 'STORAGE_SECRET_KEY'
  | 'STORAGE_BUCKET'
  | 'STORAGE_FORCE_PATH_STYLE'
>): ObjectStorage {
  const s3 = new S3Client({
    endpoint: config.STORAGE_ENDPOINT,
    region: config.STORAGE_REGION,
    credentials: {
      accessKeyId: config.STORAGE_ACCESS_KEY,
      secretAccessKey: config.STORAGE_SECRET_KEY,
    },
    forcePathStyle: config.STORAGE_FORCE_PATH_STYLE ?? true,
  });

  const bucket = config.STORAGE_BUCKET;

  async function put(key: string, stream: Readable, contentType: string): Promise<string> {
    const existing = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).catch(() => null);
    if (existing) {
      throw new Error(`Object already exists (immutable): ${key}`);
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: stream,
        ContentType: contentType,
      }),
    );

    return key;
  }

  return {
    rawMimePath: (tenantId, messageId) => `raw/${tenantId}/${messageId}.eml`,
    attachmentPath: (tenantId, attachmentId) => `attachments/${tenantId}/${attachmentId}`,

    async putRawMime(tenantId, messageId, stream) {
      const key = `raw/${tenantId}/${messageId}.eml`;
      return put(key, stream, 'message/rfc822');
    },

    async getRawMime(path) {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: path }));
      if (!res.Body || !(res.Body instanceof Readable)) {
        throw new Error(`Failed to read object: ${path}`);
      }
      return res.Body;
    },

    async putAttachment(tenantId, attachmentId, stream, contentType) {
      const key = `attachments/${tenantId}/${attachmentId}`;
      return put(key, stream, contentType);
    },
  };
}
