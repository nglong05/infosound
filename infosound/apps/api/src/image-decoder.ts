import sharp from 'sharp';
import {
  MAX_ARTWORK_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_NORMALIZED_IMAGE_BYTES,
} from '@infosound/contracts';
import { validateImageDimensions, validateImageInput } from './image-validation';

/** Only launched inside the fail-closed OS sandbox; never imports DB/auth/storage. */
async function main() {
  const [kind, contentType] = process.argv.slice(2);
  if (
    !['avatar', 'cover'].includes(kind ?? '') ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(contentType ?? '')
  )
    throw new Error();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_ARTWORK_BYTES) throw new Error();
    chunks.push(Buffer.from(chunk));
  }
  const input = Buffer.concat(chunks);
  const detected = validateImageInput(input, contentType!);
  sharp.cache(false);
  sharp.concurrency(1);
  const image = sharp(input, {
    limitInputPixels: MAX_IMAGE_PIXELS,
    failOn: 'warning',
    animated: false,
    sequentialRead: true,
  });
  const metadata = await image.metadata();
  const expected = detected === 'image/jpeg' ? 'jpeg' : detected === 'image/png' ? 'png' : 'webp';
  if (
    metadata.format !== expected ||
    (metadata.pages ?? 1) !== 1 ||
    (metadata.pageHeight && metadata.pageHeight !== metadata.height)
  )
    throw new Error();
  validateImageDimensions(metadata.width, metadata.height);
  const edge = kind === 'avatar' ? 512 : 1200;
  // No withMetadata/keepMetadata: EXIF, comments, ICC and user filenames are stripped.
  const output = await image
    .rotate()
    .resize(edge, edge, { fit: kind === 'avatar' ? 'cover' : 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .webp({ quality: 82, effort: 3 })
    .toBuffer();
  if (!output.length || output.length > MAX_NORMALIZED_IMAGE_BYTES) throw new Error();
  process.stdout.write(output);
}
void main().catch(() => {
  process.stderr.write('IMAGE_INVALID\n');
  process.exitCode = 1;
});
