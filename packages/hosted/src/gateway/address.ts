/**
 * Client addresses and address keys (design 3.1, 11; review 5, 9).
 *
 * - **Address keys**: per-address limits use the client address truncated to /32 for IPv4 and /64 for IPv6, so one IPv6 host cannot pick a fresh
 *   address per request. IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) count as IPv4. Addresses are used for limits and the operational log only, never
 *   stored in the database.
 * - **The proxy** (`TRUST_PROXY`): with a proxy configured, every TCP peer that is not the proxy is refused, and the client address is the RIGHTMOST
 *   `X-Forwarded-For` entry (the one the proxy itself added; entries left of it came from the client and are not trusted). Without a proxy, the TCP peer
 *   is the client and `X-Forwarded-For` is ignored.
 */
import { isIP } from 'node:net';

/** The address in a canonical form: IPv4 dotted (also from an IPv4-mapped IPv6 address), IPv6 as 8 lowercase groups; null if it is not an address. */
export function canonicalAddress(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 64) return null;
  let a = raw.trim();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  const kind = isIP(a);
  if (kind === 4) return a.split('.').map((x) => String(Number(x))).join('.');
  if (kind !== 6) return null;
  const groups = expandV6(a);
  if (!groups) return null;
  // ::ffff:a.b.c.d (and ::ffff:hhhh:hhhh): IPv4-mapped, counted as IPv4
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join('.');
  }
  return groups.map((g) => g.toString(16)).join(':');
}

/** The 8 groups of an IPv6 address that `isIP` accepted (an embedded IPv4 tail included). */
function expandV6(a: string): number[] | null {
  let s = a.toLowerCase();
  const tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  const last = s.slice(lastColon + 1);
  if (last.includes('.')) {
    const p = last.split('.').map(Number);
    if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
    tail.push((p[0]! << 8) | p[1]!, (p[2]! << 8) | p[3]!);
    s = s.slice(0, lastColon + 1) + '0';
    // the placeholder '0' is replaced by the tail below
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const rest = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const want = 8 - (tail.length ? 1 : 0);
  let groups: string[];
  if (parts.length === 2) groups = [...head, ...Array<string>(Math.max(0, want - head.length - rest.length)).fill('0'), ...rest];
  else groups = head;
  if (groups.length !== want) return null;
  const nums = groups.map((g) => parseInt(g, 16));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  if (tail.length) nums.splice(nums.length - 1, 1, ...tail);
  return nums.length === 8 ? nums : null;
}

/** The address key of a canonical address: `4:a.b.c.d` (/32) or `6:g0:g1:g2:g3` (/64). */
export function addressKey(address: string): string {
  if (!address.includes(':')) return `4:${address}`;
  return `6:${address.split(':').slice(0, 4).join(':')}`;
}

/**
 * The /48 aggregate of an IPv6 address key (`6:g0:g1:g2:g3` -> `6/48:g0:g1:g2`); null for an IPv4 key. One network of 65,536 /64s must not have 65,536 times the
 * allowance of one (config.ts ADDRESS_AGGREGATE).
 */
export function aggregateKey(key: string): string | null {
  if (!key.startsWith('6:')) return null;
  return `6/48:${key.slice(2).split(':').slice(0, 3).join(':')}`;
}

export type PeerCheck = { ok: true; address: string; key: string } | { ok: false; reason: 'proxy' | 'address' };

/**
 * The client of a new connection (design 3.1): `peer` is the TCP peer's address, `forwardedFor` the `X-Forwarded-For` header(s), `trustProxy` the
 * configured proxy address or null.
 */
export function clientAddress(peer: string | undefined, forwardedFor: string | string[] | undefined, trustProxy: string | null): PeerCheck {
  const p = canonicalAddress(peer);
  if (!p) return { ok: false, reason: 'address' };
  if (trustProxy === null) return { ok: true, address: p, key: addressKey(p) };
  if (p !== canonicalAddress(trustProxy)) return { ok: false, reason: 'proxy' };
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  if (typeof header !== 'string' || header.length > 4096) return { ok: false, reason: 'address' };
  const entries = header.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
  const client = canonicalAddress(entries[entries.length - 1]);
  if (!client) return { ok: false, reason: 'address' };
  return { ok: true, address: client, key: addressKey(client) };
}
