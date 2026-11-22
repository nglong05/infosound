import { MediaError, streamWaveformPcm, type AudioMetadata } from './media.js';

export const waveformPoints = 512;

/** PCM16 LE interleaved channels, constant memory independent of audio size. */
export class WaveformAccumulator {
  private readonly squares = new Float64Array(waveformPoints);
  private readonly maxima = new Float64Array(waveformPoints);
  private readonly counts = new Uint32Array(waveformPoints);
  private samples = 0;
  private trailingByte: number | null = null;
  constructor(
    private readonly metadata: Pick<AudioMetadata, 'durationSeconds' | 'sampleRate' | 'channels'>,
  ) {
    if (
      !Number.isFinite(metadata.durationSeconds) ||
      metadata.durationSeconds <= 0 ||
      metadata.durationSeconds > 900 ||
      !Number.isInteger(metadata.sampleRate) ||
      metadata.sampleRate < 8000 ||
      metadata.sampleRate > 96000 ||
      ![1, 2].includes(metadata.channels)
    )
      throw new MediaError('WAVEFORM_METADATA_INVALID');
  }
  consume(chunk: Buffer): void {
    let offset = 0;
    if (this.trailingByte !== null && chunk.length) {
      const unsigned = this.trailingByte | (chunk[0] << 8);
      this.sample(unsigned >= 32768 ? unsigned - 65536 : unsigned);
      this.trailingByte = null;
      offset = 1;
    }
    for (; offset + 1 < chunk.length; offset += 2) this.sample(chunk.readInt16LE(offset));
    if (offset < chunk.length) this.trailingByte = chunk[offset];
  }
  private sample(value: number): void {
    const samplesPerSecond = this.metadata.sampleRate * this.metadata.channels;
    // Actual decode has a second duration/size bound independent of metadata.
    if (this.samples >= samplesPerSecond * 900) throw new MediaError('DURATION_LIMIT');
    const bucket = Math.min(
      waveformPoints - 1,
      Math.floor(
        (this.samples * waveformPoints) / (this.metadata.durationSeconds * samplesPerSecond),
      ),
    );
    const absolute = Math.abs(value / 32768);
    this.squares[bucket] += absolute * absolute;
    this.maxima[bucket] = Math.max(this.maxima[bucket], absolute);
    this.counts[bucket]++;
    this.samples++;
  }
  finish(): { duration: number; peaks: number[] } {
    if (this.trailingByte !== null || !this.samples || this.samples % this.metadata.channels)
      throw new MediaError('WAVEFORM_INVALID_PCM');
    const duration = this.samples / (this.metadata.sampleRate * this.metadata.channels);
    if (
      Math.abs(duration - this.metadata.durationSeconds) >
      Math.max(0.5, this.metadata.durationSeconds * 0.02)
    )
      throw new MediaError('WAVEFORM_DURATION_MISMATCH');
    const peaks = Array.from(this.squares, (square, index) =>
      this.counts[index]
        ? 0.85 * Math.sqrt(square / this.counts[index]) + 0.15 * this.maxima[index]
        : 0,
    );
    const maximum = Math.max(...peaks);
    return {
      duration,
      peaks: peaks.map((value) => (maximum ? Math.round((value / maximum) * 10000) / 10000 : 0)),
    };
  }
}

export async function generateWaveform(
  file: string,
  metadata: AudioMetadata,
  signal?: AbortSignal,
): Promise<{ duration: number; peaks: number[] }> {
  const accumulator = new WaveformAccumulator(metadata);
  await streamWaveformPcm(file, (chunk) => accumulator.consume(chunk), signal);
  return accumulator.finish();
}
