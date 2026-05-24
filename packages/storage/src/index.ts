import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { Env } from '@arivu/config';
import { Readable } from 'node:stream';

export interface ObjectStorage {
  putRawMime(
    tenantId: string,
    messageId: string,
    stream: Readable,
    options?: { maxBytes?: number },
  ): Promise<string>;
  getRawMime(path: string): Promise<Readable>;
  putAttachment(
    tenantId: string,
    attachmentId: string,
    body: Buffer,
    contentType: string,
  ): Promise<string>;
  /** Best-effort delete (ignores missing keys). */
  deleteObject(key: string): Promise<void>;
  rawMimePath(tenantId: string, messageId: string): string;
  attachmentPath(tenantId: string, attachmentId: string): string;
}

async function readStreamToBuffer(stream: Readable, maxBytes?: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (maxBytes !== undefined && total > maxBytes) {
      throw new Error(`Object exceeds maximum size (${maxBytes} bytes)`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** OCI Object Storage S3-compatible client (see docs/OCI-STORAGE.md). */
function createS3Client(config: Pick<
  Env,
  | 'STORAGE_ENDPOINT'
  | 'STORAGE_REGION'
  | 'STORAGE_ACCESS_KEY'
  | 'STORAGE_SECRET_KEY'
  | 'STORAGE_FORCE_PATH_STYLE'
>): S3Client {
  return new S3Client({
    endpoint: config.STORAGE_ENDPOINT,
    region: config.STORAGE_REGION,
    credentials: {
      accessKeyId: config.STORAGE_ACCESS_KEY.trim(),
      secretAccessKey: config.STORAGE_SECRET_KEY.trim(),
    },
    forcePathStyle: config.STORAGE_FORCE_PATH_STYLE ?? true,
    // Required for OCI with recent AWS SDK (avoid auth/checksum mismatches)
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
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
  const s3 = createS3Client(config);
  const bucket = config.STORAGE_BUCKET;

  async function put(key: string, body: Buffer, contentType: string): Promise<string> {
    const existing = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).catch(() => null);
    if (existing) {
      throw new Error(`Object already exists (immutable): ${key}`);
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: contentType,
      }),
    );

    return key;
  }

  return {
    rawMimePath: (tenantId, messageId) => `raw/${tenantId}/${messageId}.eml`,
    attachmentPath: (tenantId, attachmentId) => `attachments/${tenantId}/${attachmentId}`,

    async putRawMime(tenantId, messageId, stream, options) {
      const key = `raw/${tenantId}/${messageId}.eml`;
      const body = await readStreamToBuffer(stream, options?.maxBytes);
      return put(key, body, 'message/rfc822');
    },

    async getRawMime(path) {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: path }));
      if (!res.Body || !(res.Body instanceof Readable)) {
        throw new Error(`Failed to read object: ${path}`);
      }
      return res.Body;
    },

    async putAttachment(tenantId, attachmentId, body, contentType) {
      const key = `attachments/${tenantId}/${attachmentId}`;
      return put(key, body, contentType);
    },

    async deleteObject(key) {
      await s3
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        .catch(() => undefined);
    },
  };
}

export { createS3Client };
