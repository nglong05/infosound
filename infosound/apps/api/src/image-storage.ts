import { BadRequestException } from '@nestjs/common';
import { MAX_ARTWORK_BYTES } from '@infosound/contracts';
import { GetObjectCommand, HeadObjectCommand, storageClient } from '@infosound/storage';

type BodyStream = AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void };
export async function readImageSnapshot(
  key: string,
  declaredSize: number,
  contentType: string,
): Promise<{ input: Buffer; versionId: string | null }> {
  const client = storageClient('API');
  const controller = new AbortController();
  let stream: BodyStream | undefined;
  const timer = setTimeout(() => {
    controller.abort();
    stream?.destroy?.();
  }, 10_000);
  timer.unref();
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: 'uploads-quarantine', Key: key }),
      { abortSignal: controller.signal },
    );
    if (
      !head.ETag ||
      head.ContentLength !== declaredSize ||
      declaredSize < 1 ||
      declaredSize > MAX_ARTWORK_BYTES ||
      head.ContentType !== contentType
    )
      throw new Error();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: 'uploads-quarantine',
        Key: key,
        VersionId: head.VersionId,
        IfMatch: head.ETag,
      }),
      { abortSignal: controller.signal },
    );
    if (
      !response.Body ||
      response.ETag !== head.ETag ||
      response.ContentLength !== declaredSize ||
      response.ContentType !== contentType ||
      (head.VersionId && response.VersionId !== head.VersionId)
    )
      throw new Error();
    stream = response.Body as BodyStream;
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > MAX_ARTWORK_BYTES || bytes > declaredSize) throw new Error();
      chunks.push(Buffer.from(chunk));
    }
    if (bytes !== declaredSize || controller.signal.aborted) throw new Error();
    return { input: Buffer.concat(chunks), versionId: response.VersionId ?? null };
  } catch {
    throw new BadRequestException({
      code: 'IMAGE_UPLOAD_CHANGED',
      message: 'Ảnh chưa tải xong, đã thay đổi hoặc không đúng dung lượng. Hãy tải lại ảnh.',
    });
  } finally {
    clearTimeout(timer);
    stream?.destroy?.();
    client.destroy();
  }
}

export function imageDeletePayload(
  bucket: 'artwork' | 'uploads-quarantine',
  key: string,
  versionId: string | null,
) {
  return { bucket, key, versionId };
}
