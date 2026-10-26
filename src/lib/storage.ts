import "server-only";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";

import { getServerEnv } from "@/src/lib/env";

let cachedClient: S3Client | undefined;

function client(): S3Client {
  if (cachedClient) return cachedClient;
  const env = getServerEnv();
  cachedClient = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.s3ForcePathStyle,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 15_000 }),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return cachedClient;
}

export async function createUploadUrl(input: {
  objectKey: string;
  contentType: string;
  contentLength: number;
  resourceId: string;
}): Promise<{ url: string; expiresIn: number }> {
  const env = getServerEnv();
  const expiresIn = 300;
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: input.objectKey,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
    Metadata: { resource: input.resourceId },
  });
  return { url: await getSignedUrl(client(), command, { expiresIn }), expiresIn };
}

export async function headObject(objectKey: string) {
  const env = getServerEnv();
  const result = await client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }));
  return {
    contentLength: result.ContentLength,
    contentType: result.ContentType,
    resourceId: result.Metadata?.resource,
  };
}

export async function createDownloadUrl(input: {
  objectKey: string;
  filename: string;
  contentType: string;
}): Promise<{ url: string; expiresIn: number }> {
  const env = getServerEnv();
  const expiresIn = 120;
  const asciiFallback = input.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(input.filename)}`;
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: input.objectKey,
    ResponseContentDisposition: disposition,
    ResponseContentType: input.contentType,
  });
  return { url: await getSignedUrl(client(), command, { expiresIn }), expiresIn };
}

export async function deleteObject(objectKey: string): Promise<void> {
  const env = getServerEnv();
  await client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }));
}

export async function moveObject(sourceKey: string, targetKey: string): Promise<void> {
  const env = getServerEnv();
  const copySource = [env.S3_BUCKET, ...sourceKey.split("/")]
    .map((part) => encodeURIComponent(part))
    .join("/");
  await client().send(new CopyObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: targetKey,
    CopySource: copySource,
    MetadataDirective: "COPY",
  }));
  try {
    await deleteObject(sourceKey);
  } catch {
    // The promoted copy is authoritative; the pending lifecycle rule removes leftovers.
  }
}

export async function checkStorage(): Promise<void> {
  const env = getServerEnv();
  await client().send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: "pending/", MaxKeys: 1 }));
}
