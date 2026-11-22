import { constants } from 'node:fs';
import { open, unlink, type FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';

const maxSourceBytes = 268_435_456;
const maxId3Tags = 8;
const maxFlacBlocks = 1024;
const copyChunkBytes = 65_536;

export class ProbeCopyError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function invalid(): never {
  throw new ProbeCopyError('INVALID_AUDIO');
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProbeCopyError('PROCESSING_CANCELLED');
}
async function header(
  input: FileHandle,
  length: number,
  position: number,
  size: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!Number.isSafeInteger(position) || position < 0 || position + length > size) invalid();
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    checkAbort(signal);
    const { bytesRead } = await input.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) invalid();
    offset += bytesRead;
  }
  checkAbort(signal);
  return buffer;
}
interface ProbePlan {
  offset: number;
  prefix: Buffer;
  container: 'mp3' | 'flac';
}
async function planCopy(
  input: FileHandle,
  size: number,
  signal?: AbortSignal,
): Promise<ProbePlan | undefined> {
  if (size < 4) return undefined; // The native parser reports malformed short input.
  const marker = await header(input, 4, 0, size, signal);
  if (marker.subarray(0, 3).equals(Buffer.from('ID3'))) {
    let offset = 0,
      tags = 0;
    while (offset + 3 <= size) {
      const identifier = await header(input, 3, offset, size, signal);
      if (!identifier.equals(Buffer.from('ID3'))) break;
      if (++tags > maxId3Tags) invalid();
      const tag = await header(input, 10, offset, size, signal);
      const version = tag[3],
        revision = tag[4],
        flags = tag[5];
      const allowedFlags = version === 2 ? 0xc0 : version === 3 ? 0xe0 : version === 4 ? 0xf0 : -1;
      if (
        allowedFlags < 0 ||
        revision === 0xff ||
        (flags & ~allowedFlags) !== 0 ||
        tag.subarray(6, 10).some((byte) => byte >= 0x80)
      )
        invalid();
      const bodyLength = tag[6] * 2 ** 21 + tag[7] * 2 ** 14 + tag[8] * 2 ** 7 + tag[9];
      const hasFooter = version === 4 && (flags & 0x10) !== 0;
      const end = offset + 10 + bodyLength + (hasFooter ? 10 : 0);
      if (end > size) invalid();
      if (hasFooter) {
        const footer = await header(input, 10, end - 10, size, signal);
        if (
          !footer.subarray(0, 3).equals(Buffer.from('3DI')) ||
          !footer.subarray(3).equals(tag.subarray(3))
        )
          invalid();
      }
      offset = end;
    }
    if (size - offset < 4) invalid();
    return { offset, prefix: Buffer.alloc(0), container: 'mp3' };
  }
  if (!marker.equals(Buffer.from('fLaC'))) return undefined;
  const first = await header(input, 4, 4, size, signal);
  if ((first[0] & 0x7f) !== 0 || first.readUIntBE(1, 3) !== 34) invalid();
  const streamInfo = await header(input, 34, 8, size, signal);
  let offset = 42,
    blocks = 1,
    last = (first[0] & 0x80) !== 0;
  if (last) {
    if (offset >= size) invalid();
    return undefined;
  }
  while (!last) {
    if (++blocks > maxFlacBlocks) invalid();
    const block = await header(input, 4, offset, size, signal);
    const type = block[0] & 0x7f,
      length = block.readUIntBE(1, 3);
    // STREAMINFO occurs exactly once. Unknown/reserved blocks are not accepted.
    if (type === 0 || type > 6 || offset + 4 + length > size) invalid();
    offset += 4 + length;
    last = (block[0] & 0x80) !== 0;
  }
  if (offset >= size) invalid();
  // Only STREAMINFO is needed for probing. Comments may themselves contain an
  // encoded picture, so omit every other metadata block without parsing it.
  const prefix = Buffer.alloc(42);
  prefix.write('fLaC', 0, 'ascii');
  prefix[4] = 0x80;
  prefix.writeUIntBE(34, 5, 3);
  streamInfo.copy(prefix, 8);
  return { offset, prefix, container: 'flac' };
}
async function writeFully(
  output: FileHandle,
  buffer: Buffer,
  length: number,
  position: number,
  signal?: AbortSignal,
): Promise<void> {
  let offset = 0;
  while (offset < length) {
    checkAbort(signal);
    const { bytesWritten } = await output.write(buffer, offset, length - offset, position + offset);
    if (!bytesWritten) invalid();
    offset += bytesWritten;
  }
  checkAbort(signal);
}

/** Metadata-only probe copy. Original MPEG/FLAC audio frames are copied exactly;
 * no tag/image payload is interpreted, decoded, remuxed or persisted to storage. */
export async function withAudioProbeCopy<T>(
  source: string,
  action: (file: string, expectedContainer?: 'mp3' | 'flac') => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  checkAbort(signal);
  if (!isAbsolute(source)) invalid();
  let input: FileHandle | undefined, output: FileHandle | undefined, target: string | undefined;
  try {
    input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await input.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size <= 0) invalid();
    if (before.size > maxSourceBytes) throw new ProbeCopyError('SOURCE_SIZE_LIMIT');
    const plan = await planCopy(input, before.size, signal);
    if (!plan) return await action(source);
    const filename = join(dirname(source), `.infosound-probe-${randomUUID()}.${plan.container}`);
    output = await open(
      filename,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    target = filename; // Never unlink a path unless our exclusive create succeeded.
    await writeFully(output, plan.prefix, plan.prefix.length, 0, signal);
    const buffer = Buffer.allocUnsafe(copyChunkBytes);
    let readPosition = plan.offset,
      writePosition = plan.prefix.length;
    while (readPosition < before.size) {
      checkAbort(signal);
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(copyChunkBytes, before.size - readPosition),
        readPosition,
      );
      if (!bytesRead) invalid();
      if (writePosition + bytesRead > maxSourceBytes) throw new ProbeCopyError('SOURCE_SIZE_LIMIT');
      await writeFully(output, buffer, bytesRead, writePosition, signal);
      readPosition += bytesRead;
      writePosition += bytesRead;
    }
    const after = await input.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      invalid();
    await output.close();
    output = undefined;
    await input.close();
    input = undefined;
    checkAbort(signal);
    return await action(target, plan.container);
  } finally {
    await output?.close().catch(() => {});
    await input?.close().catch(() => {});
    if (target) await unlink(target).catch(() => {}); // Attempt-directory cleanup remains the final safety net.
  }
}
