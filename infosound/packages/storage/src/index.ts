import { readFileSync } from 'node:fs';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketVersioningCommand,
  GetBucketVersioningCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function credential(name: string): string {
  const path = process.env[`${name}_FILE`];
  const value = path ? readFileSync(path, 'utf8').trim() : process.env[name];
  if (!value) throw new Error(`Missing ${name}_FILE`);
  return value;
}
export function storageClient(
  identity: 'UPLOAD' | 'READ' | 'API' | 'WORKER' | 'CLEANER' | 'BACKUP' | 'BOOTSTRAP',
  publicEndpoint = false,
): S3Client {
  const endpoint = publicEndpoint
    ? process.env.S3_PUBLIC_ENDPOINT
    : process.env.S3_INTERNAL_ENDPOINT;
  if (!endpoint) throw new Error('Missing S3 endpoint');
  return new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: credential(`S3_${identity}_ACCESS_KEY`),
      secretAccessKey: credential(`S3_${identity}_SECRET_KEY`),
    },
  });
}
export async function uploadUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  return getSignedUrl(
    storageClient('UPLOAD', true),
    new PutObjectCommand({ Bucket: 'uploads-quarantine', Key: key, ContentType: contentType }),
    { expiresIn: Math.max(1, Math.min(300, expiresIn)) },
  );
}
/** Images are single-write capabilities with exact header/byte-count binding. */
export async function imageUploadUrl(
  key: string,
  contentType: string,
  size: number,
  expiresIn = 120,
): Promise<string> {
  if (
    !/^images\/(avatar|cover)\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key) ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(contentType) ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 5 * 1024 * 1024
  )
    throw new Error('INVALID_IMAGE_UPLOAD');
  return getSignedUrl(
    storageClient('UPLOAD', true),
    new PutObjectCommand({
      Bucket: 'uploads-quarantine',
      Key: key,
      ContentType: contentType,
      ContentLength: size,
      IfNoneMatch: '*',
    }),
    {
      expiresIn: Math.max(1, Math.min(120, expiresIn)),
      signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
      unhoistableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
    },
  );
}
export async function mediaUrl(
  bucket: string,
  key: string,
  options: { versionId?: string | null; filename?: string; expiresIn?: number } = {},
): Promise<string> {
  const filename = options.filename?.replace(/[\r\n"\\]/g, '_').slice(0, 160);
  return getSignedUrl(
    storageClient('READ', true),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      VersionId: options.versionId || undefined,
      ...(filename
        ? {
            ResponseContentDisposition: `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          }
        : {}),
    }),
    { expiresIn: options.expiresIn ?? 300 },
  );
}
export async function mediaHeadUrl(
  bucket: string,
  key: string,
  versionId?: string | null,
): Promise<string> {
  return getSignedUrl(
    storageClient('READ', true),
    new HeadObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId || undefined }),
    { expiresIn: 300 },
  );
}
export {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketVersioningCommand,
  GetBucketVersioningCommand,
  getSignedUrl,
};
