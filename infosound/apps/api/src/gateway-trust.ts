import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

type AddressRecord = { address: string; family: number };
type ResolveGateway = () => Promise<AddressRecord[]>;
type LogTrustEvent = (event: string, trustedAddressCount: number) => void;

export function normalizeProxyAddress(address: string): string {
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return '';
  let canonical: string;
  try {
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return '';
  }
  // URL canonicalization renders IPv4-mapped IPv6 as hexadecimal. Normalize both
  // the resolver result and socket address so dual-stack sockets match correctly.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const high = Number.parseInt(mapped[1]!, 16);
    const low = Number.parseInt(mapped[2]!, 16);
    return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  }
  return canonical;
}

export class GatewayTrustCache {
  private addresses = new Set<string>();
  private refreshing = false;
  private interval?: NodeJS.Timeout;
  private lastStatus = '';

  constructor(
    private readonly resolveGateway: ResolveGateway = () => lookup('gateway', { all: true }),
    private readonly log: LogTrustEvent = () => undefined,
    private readonly timeoutMs = 2000,
  ) {}

  readonly trust = (address: string): boolean => this.addresses.has(normalizeProxyAddress(address));

  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    let timeout: NodeJS.Timeout | undefined;
    try {
      const records = await Promise.race([
        this.resolveGateway(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('GATEWAY_DNS_TIMEOUT')), this.timeoutMs);
          timeout.unref();
        }),
      ]);
      const next = new Set(
        records.map((record) => normalizeProxyAddress(record.address)).filter(Boolean),
      );
      if (!next.size) throw new Error('GATEWAY_DNS_NO_ADDRESSES');
      this.addresses = next;
      const status = [...next].sort().join(',');
      if (status !== this.lastStatus) this.log('gateway_trust_resolved', next.size);
      this.lastStatus = status;
    } catch {
      // Never keep a stale trusted address after lookup failure or trust a whole
      // subnet as a fallback: another container could later receive the old IP.
      this.addresses.clear();
      if (this.lastStatus !== 'failed') this.log('gateway_trust_unavailable', 0);
      this.lastStatus = 'failed';
    } finally {
      if (timeout) clearTimeout(timeout);
      this.refreshing = false;
    }
  }

  async start(): Promise<void> {
    await this.refresh();
    this.interval = setInterval(() => {
      void this.refresh();
    }, 30000);
    this.interval.unref();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.addresses.clear();
  }
}
