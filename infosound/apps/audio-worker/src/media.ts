import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ProbeCopyError, withAudioProbeCopy } from './audio-probe-copy.js';

export class MediaError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export interface AudioMetadata {
  codec: 'pcm_s16le' | 'pcm_s24le' | 'flac' | 'mp3';
  container: 'wav' | 'flac' | 'mp3';
  sampleRate: number;
  channels: number;
  bitDepth: number | null;
  durationSeconds: number;
}

/** Only these environment values reach an untrusted media parser. Never spread process.env. */
export function parserEnvironment(directory: string): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    HOME: directory,
    TMPDIR: directory,
  };
}

interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  hashOutput?: boolean;
  consumePcm?: (chunk: Buffer) => void;
}
export function runParser(
  binary: 'ffmpeg' | 'ffprobe',
  args: readonly string[],
  cwd: string,
  options: RunOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new MediaError('PROCESSING_CANCELLED'));
      return;
    }
    // The Linux runtime image provides this fail-closed Landlock launcher.
    const launcher = process.env.PARSER_SANDBOX_BIN || '/usr/local/bin/infosound-parser';
    const child = spawn(launcher, [cwd, `/usr/bin/${binary}`, ...args], {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: parserEnvironment(cwd),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const digest = createHash('sha256');
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderrBytes = 0;
    let failure: Error | undefined;
    const terminate = (code: string) => {
      failure ??= new MediaError(code);
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* Already exited. */
      }
    };
    const abort = () => terminate('PROCESSING_CANCELLED');
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => terminate('MEDIA_TIMEOUT'), options.timeoutMs ?? 240_000);
    timer.unref();
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (options.hashOutput || options.consumePcm) {
        // Bound actual decoded PCM independently of untrusted duration metadata.
        if (bytes > 536_870_912) terminate('OUTPUT_SIZE_LIMIT');
        else {
          if (options.hashOutput) digest.update(chunk);
          try {
            options.consumePcm?.(chunk);
          } catch {
            terminate('WAVEFORM_INVALID_PCM');
          }
        }
      } else {
        if (bytes > 131_072) terminate('MEDIA_OUTPUT_LIMIT');
        else chunks.push(chunk);
      }
    });
    // Decoder output is untrusted and may contain filenames/tags. Bound and discard it.
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 131_072) terminate('MEDIA_OUTPUT_LIMIT');
    });
    child.once('error', () => {
      failure ??= new MediaError('PARSER_UNAVAILABLE');
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code === 125) reject(new MediaError('PARSER_SANDBOX_UNAVAILABLE'));
      else if (code !== 0) reject(new MediaError('INVALID_AUDIO'));
      else
        resolve(
          options.hashOutput
            ? digest.digest('hex')
            : options.consumePcm
              ? ''
              : Buffer.concat(chunks).toString('utf8'),
        );
    });
  });
}

const losslessSampleRates: readonly number[] = [44_100, 48_000, 96_000];
const mp3SampleRates: readonly number[] = [
  8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000,
];

// Only preparePlayback may use this context for a generated FLAC. Raw uploads
// always enter through validateProbe/probeAudio without an output exception.
function validateProbeResult(input: unknown, mp3OutputSampleRate?: number): AudioMetadata {
  if (!input || typeof input !== 'object') throw new MediaError('INVALID_AUDIO');
  const probe = input as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
  if (
    !Array.isArray(probe.streams) ||
    probe.streams.some((stream) => !stream || typeof stream !== 'object' || Array.isArray(stream))
  )
    throw new MediaError('UNSUPPORTED_STREAMS');
  const container = String(probe.format?.format_name);
  if (!['wav', 'flac', 'mp3'].includes(container)) throw new MediaError('UNSUPPORTED_CONTAINER');
  const audioStreams = probe.streams.filter((stream) => stream.codec_type === 'audio');
  if (audioStreams.length !== 1) throw new MediaError('UNSUPPORTED_STREAMS');
  const stream = audioStreams[0];
  const extras = probe.streams.filter((candidate) => candidate !== stream);
  if (
    extras.some((extra) => {
      const disposition = extra.disposition as Record<string, unknown> | undefined;
      return (
        !['mp3', 'flac'].includes(container) ||
        extra.codec_type !== 'video' ||
        !disposition ||
        typeof disposition !== 'object' ||
        Array.isArray(disposition) ||
        disposition.attached_pic !== 1
      );
    })
  )
    throw new MediaError('UNSUPPORTED_STREAMS');
  const codec = String(stream.codec_name);
  if (!['pcm_s16le', 'pcm_s24le', 'flac', 'mp3'].includes(codec))
    throw new MediaError('UNSUPPORTED_CODEC');
  if (
    (container === 'wav' && !codec.startsWith('pcm_')) ||
    (container === 'flac' && codec !== 'flac') ||
    (container === 'mp3' && codec !== 'mp3')
  )
    throw new MediaError('CONTAINER_CODEC_MISMATCH');
  const sampleRate = Number(stream.sample_rate);
  const channels = Number(stream.channels);
  const durationSeconds = Number(stream.duration ?? probe.format?.duration);
  const bitDepth =
    codec === 'mp3' ? null : Number(stream.bits_per_raw_sample || stream.bits_per_sample);
  const generatedMp3FlacRate =
    container === 'flac' &&
    codec === 'flac' &&
    mp3OutputSampleRate !== undefined &&
    mp3SampleRates.includes(mp3OutputSampleRate) &&
    sampleRate === mp3OutputSampleRate;
  if (
    !(codec === 'mp3'
      ? mp3SampleRates.includes(sampleRate)
      : losslessSampleRates.includes(sampleRate) || generatedMp3FlacRate)
  )
    throw new MediaError('UNSUPPORTED_SAMPLE_RATE');
  if (![1, 2].includes(channels)) throw new MediaError('TOO_MANY_CHANNELS');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 900)
    throw new MediaError('DURATION_LIMIT');
  if (bitDepth !== null && ![16, 24].includes(bitDepth))
    throw new MediaError('UNSUPPORTED_BIT_DEPTH');
  return {
    codec: codec as AudioMetadata['codec'],
    container: container as AudioMetadata['container'],
    sampleRate,
    channels,
    bitDepth,
    durationSeconds,
  };
}

export function validateProbe(input: unknown): AudioMetadata {
  return validateProbeResult(input);
}

const safeInput = [
  '-v',
  'error',
  '-max_alloc',
  '268435456',
  '-protocol_whitelist',
  'file,pipe',
  '-format_whitelist',
  'wav,flac,mp3',
  '-codec_whitelist',
  'pcm_s16le,pcm_s24le,flac,mp3,mp3float',
] as const;
async function readProbe(file: string, signal?: AbortSignal): Promise<unknown> {
  const output = await runParser(
    'ffprobe',
    [
      ...safeInput,
      '-show_entries',
      'stream=codec_type,codec_name,sample_rate,channels,bits_per_sample,bits_per_raw_sample,duration:stream_disposition=attached_pic:format=format_name,duration',
      '-of',
      'json',
      file,
    ],
    dirname(file),
    { signal },
  );
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new MediaError('INVALID_AUDIO');
  }
  return value;
}

export async function probeAudio(file: string, signal?: AbortSignal): Promise<AudioMetadata> {
  try {
    return await withAudioProbeCopy(
      file,
      async (probeFile, expectedContainer) => {
        const result = validateProbe(await readProbe(probeFile, signal));
        if (expectedContainer && result.container !== expectedContainer)
          throw new MediaError('CONTAINER_CODEC_MISMATCH');
        return result;
      },
      signal,
    );
  } catch (error) {
    if (error instanceof ProbeCopyError) throw new MediaError(error.code);
    throw error;
  }
}

export async function decodeChecksum(
  file: string,
  metadata: AudioMetadata,
  signal?: AbortSignal,
): Promise<string> {
  // MP3 has no integer source bit depth. Use a 24-bit canonical representation
  // for it and its FLAC output, rather than quantizing the conversion to 16-bit.
  const use24Bit = metadata.codec === 'mp3' || metadata.bitDepth === 24;
  const pcm = use24Bit ? 'pcm_s24le' : 'pcm_s16le';
  const format = use24Bit ? 's24le' : 's16le';
  return runParser(
    'ffmpeg',
    [
      ...safeInput,
      '-nostdin',
      '-threads',
      '2',
      '-i',
      file,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-threads',
      '2',
      '-c:a',
      pcm,
      '-f',
      format,
      'pipe:1',
    ],
    dirname(file),
    { signal, hashOutput: true },
  );
}

/** Stream bounded PCM through the same mandatory parser sandbox; never buffer an entire song. */
export async function streamWaveformPcm(
  file: string,
  consumePcm: (chunk: Buffer) => void,
  signal?: AbortSignal,
): Promise<void> {
  await runParser(
    'ffmpeg',
    [
      ...safeInput,
      '-nostdin',
      '-threads',
      '2',
      '-i',
      file,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-threads',
      '2',
      '-c:a',
      'pcm_s16le',
      '-f',
      's16le',
      'pipe:1',
    ],
    dirname(file),
    { signal, consumePcm },
  );
}

export async function preparePlayback(
  source: string,
  output: string,
  metadata: AudioMetadata,
  convertLossy: boolean,
  signal?: AbortSignal,
): Promise<{
  file: string;
  metadata: AudioMetadata;
  lossyTranscode: boolean;
  pcmChecksum: string;
}> {
  const sourceChecksum = await decodeChecksum(source, metadata, signal);
  if (metadata.codec === 'flac' || (metadata.codec === 'mp3' && !convertLossy))
    return { file: source, metadata, lossyTranscode: false, pcmChecksum: sourceChecksum };
  const outputBitDepth = metadata.codec === 'mp3' || metadata.bitDepth === 24 ? 24 : 16;
  await runParser(
    'ffmpeg',
    [
      ...safeInput,
      '-nostdin',
      '-y',
      '-threads',
      '2',
      '-i',
      source,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-threads',
      '2',
      '-c:a',
      'flac',
      '-sample_fmt',
      outputBitDepth === 24 ? 's32' : 's16',
      '-bits_per_raw_sample',
      String(outputBitDepth),
      '-fs',
      '536870913',
      output,
    ],
    dirname(source),
    { signal },
  );
  if ((await stat(output)).size > 536_870_912) throw new MediaError('OUTPUT_SIZE_LIMIT');
  const result = validateProbeResult(
    await readProbe(output, signal),
    metadata.codec === 'mp3' ? metadata.sampleRate : undefined,
  );
  if (
    result.container !== 'flac' ||
    result.codec !== 'flac' ||
    result.sampleRate !== metadata.sampleRate ||
    result.channels !== metadata.channels ||
    result.bitDepth !== outputBitDepth
  )
    throw new MediaError('OUTPUT_METADATA_MISMATCH');
  const outputChecksum = await decodeChecksum(output, result, signal);
  if (outputChecksum !== sourceChecksum) throw new MediaError('PCM_CHECKSUM_MISMATCH');
  return {
    file: output,
    metadata: result,
    lossyTranscode: metadata.codec === 'mp3',
    pcmChecksum: outputChecksum,
  };
}
