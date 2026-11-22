import { MAX_ARTWORK_BYTES, MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS } from '@infosound/contracts';

export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type ImageKind = 'avatar' | 'cover';
export class ImageValidationError extends Error {
  constructor(readonly code: 'IMAGE_INVALID' | 'IMAGE_LIMIT' | 'IMAGE_FORMAT') {
    super(code);
  }
}
const invalid = (): never => {
  throw new ImageValidationError('IMAGE_INVALID');
};
export function validateImageDimensions(width: unknown, height: unknown): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    Number(width) < 1 ||
    Number(height) < 1 ||
    Number(width) > MAX_IMAGE_EDGE ||
    Number(height) > MAX_IMAGE_EDGE ||
    Number(width) * Number(height) > MAX_IMAGE_PIXELS
  )
    throw new ImageValidationError('IMAGE_LIMIT');
}

/** Container inspection is bounded and never decompresses data in the API process. */
export function detectImageType(input: Buffer): ImageContentType {
  if (!input.length || input.length > MAX_ARTWORK_BYTES)
    throw new ImageValidationError('IMAGE_LIMIT');
  if (input.length >= 4 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) {
    if (input[input.length - 2] !== 0xff || input[input.length - 1] !== 0xd9) invalid();
    return 'image/jpeg';
  }
  if (
    input.length >= 33 &&
    input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    let offset = 8,
      count = 0,
      ended = false;
    while (offset < input.length) {
      if (++count > 1024 || offset + 12 > input.length) invalid();
      const length = input.readUInt32BE(offset);
      if (length > input.length - offset - 12) invalid();
      const type = input.toString('ascii', offset + 4, offset + 8);
      if (!/^[A-Za-z]{4}$/.test(type) || ['acTL', 'fcTL', 'fdAT'].includes(type)) invalid();
      if (count === 1) {
        if (type !== 'IHDR' || length !== 13) invalid();
        validateImageDimensions(input.readUInt32BE(offset + 8), input.readUInt32BE(offset + 12));
      } else if (type === 'IHDR') invalid();
      offset += length + 12;
      if (type === 'IEND') {
        if (length || offset !== input.length) invalid();
        ended = true;
        break;
      }
    }
    if (!ended) invalid();
    return 'image/png';
  }
  if (
    input.length >= 20 &&
    input.toString('ascii', 0, 4) === 'RIFF' &&
    input.toString('ascii', 8, 12) === 'WEBP'
  ) {
    if (input.readUInt32LE(4) + 8 !== input.length) invalid();
    let offset = 12,
      count = 0,
      rasters = 0;
    while (offset < input.length) {
      if (++count > 1024 || offset + 8 > input.length) invalid();
      const type = input.toString('ascii', offset, offset + 4),
        length = input.readUInt32LE(offset + 4);
      if (length > input.length - offset - 8) invalid();
      if (type === 'ANIM' || type === 'ANMF') invalid();
      if (type === 'VP8X') {
        if (count !== 1 || length !== 10 || input[offset + 8]! & 2) invalid();
        validateImageDimensions(
          input.readUIntLE(offset + 12, 3) + 1,
          input.readUIntLE(offset + 15, 3) + 1,
        );
      }
      if (type === 'VP8 ' || type === 'VP8L') if (++rasters !== 1) invalid();
      offset += 8 + length + (length % 2);
    }
    if (offset !== input.length || rasters !== 1) invalid();
    return 'image/webp';
  }
  throw new ImageValidationError('IMAGE_FORMAT');
}
export function validateImageInput(input: Buffer, contentType: string): ImageContentType {
  const detected = detectImageType(input);
  if (detected !== contentType) throw new ImageValidationError('IMAGE_FORMAT');
  return detected;
}
/** Validate the sandbox output framing before it is stored as a web image. */
export function validateNormalizedImage(input: Buffer, kind: ImageKind): void {
  if (detectImageType(input) !== 'image/webp') invalid();
  let offset = 12,
    width = 0,
    height = 0;
  const edge = kind === 'avatar' ? 512 : 1200;
  while (offset < input.length) {
    const type = input.toString('ascii', offset, offset + 4),
      length = input.readUInt32LE(offset + 4),
      data = offset + 8;
    if (!['VP8X', 'ALPH', 'VP8 ', 'VP8L'].includes(type)) invalid();
    if (type === 'VP8X') {
      width = input.readUIntLE(data + 4, 3) + 1;
      height = input.readUIntLE(data + 7, 3) + 1;
    }
    if (type === 'VP8 ') {
      if (length < 10 || !input.subarray(data + 3, data + 6).equals(Buffer.from([157, 1, 42])))
        invalid();
      width = input.readUInt16LE(data + 6) & 0x3fff;
      height = input.readUInt16LE(data + 8) & 0x3fff;
    }
    if (type === 'VP8L') {
      if (length < 5 || input[data] !== 0x2f) invalid();
      const bits = input.readUInt32LE(data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    if (width > edge || height > edge) invalid();
    offset += 8 + length + (length % 2);
  }
  if (!width || !height || width > edge || height > edge) invalid();
}
