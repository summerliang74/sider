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
import { Readable } from "node:stream";

import { getServerEnv } from "@/src/lib/env";

let cachedClient: S3Client | undefined;
let cachedUploadClient: S3Client | undefined;

function createClient(requestTimeout: number): S3Client {
  const env = getServerEnv();
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.s3ForcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout }),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

function client(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = createClient(15_000);
  return cachedClient;
}

function uploadClient(): S3Client {
  if (cachedUploadClient) return cachedUploadClient;
  cachedUploadClient = createClient(120_000);
  return cachedUploadClient;
}

export function getDownloadOrigin(): string {
  const env = getServerEnv();
  const endpoint = new URL(env.S3_ENDPOINT);
  if (!env.s3ForcePathStyle && !endpoint.hostname.startsWith(`${env.S3_BUCKET}.`)) {
    endpoint.hostname = `${env.S3_BUCKET}.${endpoint.hostname}`;
  }
  return endpoint.origin;
}

export async function uploadObject(input: {
  objectKey: string;
  contentType: string;
  contentLength: number;
  resourceId: string;
  body: ReadableStream<Uint8Array>;
}): Promise<void> {
  const env = getServerEnv();
  await uploadClient().send(new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: input.objectKey,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
    Metadata: { resource: input.resourceId },
    Body: Readable.fromWeb(input.body as unknown as import("node:stream/web").ReadableStream),
  }));
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
}): Promise<{ url: string; expiresIn: number }> {
  const env = getServerEnv();
  const expiresIn = 120;
  const asciiFallback = input.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(input.filename)}`;
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: input.objectKey,
    ResponseContentDisposition: disposition,
  });
  return { url: await getSignedUrl(client(), command, { expiresIn }), expiresIn };
}

export async function getObjectPreview(objectKey: string): Promise<{
  body: ReadableStream<Uint8Array>;
  contentLength?: number;
}> {
  const env = getServerEnv();
  const result = await client().send(new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: objectKey,
  }));
  if (!result.Body) throw new Error("preview_body_missing");
  return {
    body: result.Body.transformToWebStream() as ReadableStream<Uint8Array>,
    contentLength: result.ContentLength,
  };
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
