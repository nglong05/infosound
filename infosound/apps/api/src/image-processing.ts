import { spawn } from 'node:child_process';
import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { MAX_NORMALIZED_IMAGE_BYTES } from '@infosound/contracts';
import { ImageKind, validateImageInput, validateNormalizedImage } from './image-validation';

let processing = false;
let imageJob = false;
/** Includes S3 download and encode: reject rather than queue unbounded image buffers. */
export async function runImageJob<T>(action: () => Promise<T>): Promise<T> {
  if (imageJob)
    throw new HttpException(
      { code: 'IMAGE_BUSY', message: 'Đang xử lý ảnh khác. Vui lòng thử lại sau vài giây.' },
      429,
    );
  imageJob = true;
  try {
    return await action();
  } finally {
    imageJob = false;
  }
}
export async function normalizeImage(
  input: Buffer,
  declaredContentType: string,
  kind: ImageKind,
): Promise<Buffer> {
  try {
    validateImageInput(input, declaredContentType);
  } catch {
    throw new BadRequestException({
      code: 'IMAGE_INVALID',
      message:
        'Ảnh không hợp lệ, không đúng định dạng hoặc vượt giới hạn. Hãy chọn ảnh JPEG, PNG hoặc WebP khác.',
    });
  }
  if (processing)
    throw new HttpException(
      { code: 'IMAGE_BUSY', message: 'Đang xử lý ảnh khác. Vui lòng thử lại sau vài giây.' },
      429,
    );
  processing = true;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn('/usr/local/bin/infosound-image-parser', [kind, declaredContentType], {
        shell: false,
        detached: true,
        windowsHide: true,
        cwd: '/app',
        // Do not inherit auth, SMTP, DB, storage credentials or secret paths.
        env: {
          PATH: '/usr/local/bin:/usr/bin:/bin',
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
          VIPS_CONCURRENCY: '1',
          MALLOC_ARENA_MAX: '2',
          HOME: '/nonexistent',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = [];
      let bytes = 0,
        stderrBytes = 0,
        failed = false,
        unavailable = false;
      const terminate = () => {
        failed = true;
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          /* Already closed. */
        }
      };
      const timer = setTimeout(terminate, 7000);
      timer.unref();
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_NORMALIZED_IMAGE_BYTES) terminate();
        else chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 8192) terminate();
      });
      child.stdin.on('error', () => {
        /* Child may reject an invalid header before input finishes. */
      });
      child.once('error', () => {
        unavailable = true;
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (unavailable || code === 125)
          reject(
            new ServiceUnavailableException({
              code: 'IMAGE_PROCESSOR_UNAVAILABLE',
              message: 'Tạm thời chưa xử lý được ảnh. Vui lòng thử lại sau.',
            }),
          );
        else if (failed || code !== 0 || !bytes)
          reject(
            new BadRequestException({
              code: 'IMAGE_INVALID',
              message:
                'Không xử lý được ảnh trong giới hạn cho phép. Hãy chọn ảnh nhỏ hơn hoặc ảnh khác.',
            }),
          );
        else {
          const output = Buffer.concat(chunks);
          try {
            validateNormalizedImage(output, kind);
            resolve(output);
          } catch {
            reject(
              new BadRequestException({
                code: 'IMAGE_INVALID',
                message: 'Ảnh kết quả không hợp lệ. Hãy chọn ảnh khác.',
              }),
            );
          }
        }
      });
      child.stdin.end(input);
    });
  } finally {
    processing = false;
  }
}
