export type ListenGrant = { token: string; minimumSeconds: number };

/** One logical play. URL renewal preserves progress; a new play gets a new instance. */
export class ListeningProgress {
  seconds = 0;
  done = false;
  inFlight = false;
  attempts = 0;
  retryAt = 0;
  private last: { media: number; wall: number } | null = null;
  private receivedAt: number;
  private eligibleAt: number;
  constructor(
    readonly trackId: string,
    readonly sourceVersion: number,
    public grant: ListenGrant,
    now: number,
  ) {
    this.receivedAt = now;
    this.eligibleAt = now + grant.minimumSeconds * 1000 + 250;
  }
  interrupt() {
    this.last = null;
  }
  renew(grant: ListenGrant, now: number) {
    // Keep the original ticket across ordinary URL refreshes. Replace before its 15-minute expiry.
    if (now - this.receivedAt < 14 * 60 * 1000) return;
    this.grant = grant;
    this.receivedAt = now;
    this.eligibleAt = now + grant.minimumSeconds * 1000 + 250;
  }
  sample(media: number, wall: number, rate: number, eligible: boolean) {
    if (
      !eligible ||
      !Number.isFinite(media) ||
      !Number.isFinite(wall) ||
      !Number.isFinite(rate) ||
      rate <= 0
    ) {
      this.interrupt();
      return;
    }
    if (this.last) {
      const elapsed = (wall - this.last.wall) / 1000;
      const advanced = media - this.last.media;
      // A seek cannot turn skipped media time into listening time. Never count a stalled clock.
      if (elapsed > 0 && advanced > 0 && advanced <= elapsed * rate + 0.5)
        this.seconds += Math.min(elapsed, advanced / rate);
    }
    this.last = { media, wall };
  }
  ready(now: number) {
    return (
      !this.done &&
      !this.inFlight &&
      this.attempts < 3 &&
      this.seconds >= this.grant.minimumSeconds &&
      now >= this.eligibleAt &&
      now >= this.retryAt
    );
  }
}
