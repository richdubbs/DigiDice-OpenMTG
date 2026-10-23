/**
 * M14-5: address keys and their aggregates (design 8.1, D15). The host passes the connection's address key (RequestContext.addressKey): the client
 * address truncated to /32 for IPv4 and /64 for IPv6, IPv4-mapped IPv6 addresses as IPv4 (m13 3.1). The service derives the IPv6 /56 and /48 keys
 * itself, so a /48's 65,536 /64s do not each get a fresh allowance.
 *
 * The key arrives as text (an address, or a prefix with or without its "/64"); this module reads it and gives canonical keys: "v4:<dotted quad>",
 * "v6/64:<16 hex digits>", "v6/56:<14>", "v6/48:<12>". A key that is no address (a test's "a1", the ladder's system context's "system") is kept as
 * it is ("k:<text>") and has no aggregates. These keys live in memory only (the limits of ./limiter.ts and ./signin.ts, the audit tag of
 * src/audit/writer.ts); nothing here is ever stored.
 */

/** The canonical keys of one address key. */
export interface AddressKeys {
  /** The /32 (IPv4), the /64 (IPv6), or the opaque key. */
  key: string;
  /** IPv6 only: the /56 and /48 aggregates; null otherwise. */
  p56: string | null;
  p48: string | null;
  /** What 8.2 rule 3 (CAPTCHA=none) and the registration shedding of 8.1 count by: the /48 for IPv6, the key itself otherwise. */
  wide: string;
  /** Every prefix the key belongs to, narrowest first: [key] or [/64, /56, /48]. */
  all: readonly string[];
}

/** Longer opaque keys are cut here: a key is an in-memory map key, never a place for a client to put a megabyte. */
const OPAQUE_MAX = 128;

function parseIPv4(s: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number];
  return parts.every((p) => p <= 255) ? parts : null;
}

/** The eight 16-bit groups of an IPv6 address (with "::" and an embedded IPv4 tail), or null. */
function parseIPv6(input: string): number[] | null {
  let s = input;
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (s.length === 0 || s.length > 45) return null;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  if (lastColon < 0) return null;
  const after = s.slice(lastColon + 1);
  if (after.includes('.')) {
    const v4 = parseIPv4(after);
    if (v4 === null) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, lastColon + 1);
    if (!s.endsWith('::')) s = s.slice(0, -1);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = groups(halves[0]!);
  if (head === null) return null;
  if (halves.length === 1) {
    const all = [...head, ...tail];
    return all.length === 8 ? all : null;
  }
  const rest = groups(halves[1]!);
  if (rest === null) return null;
  const known = head.length + rest.length + tail.length;
  if (known > 7) return null;
  return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...tail];
}

const hex4 = (n: number): string => n.toString(16).padStart(4, '0');

/**
 * The canonical keys of an address key (see the header). Never throws: anything that does not read as an IPv4 or IPv6 address (or prefix) is an
 * opaque key without aggregates.
 */
export function addressKeys(addressKey: string): AddressKeys {
  const raw = typeof addressKey === 'string' ? addressKey.trim() : '';
  let s = raw;
  if (s.startsWith('[')) {
    const close = s.indexOf(']');
    if (close > 0) s = s.slice(1, close);
  }
  const slash = s.indexOf('/');
  if (slash >= 0 && /^\d{1,3}$/.test(s.slice(slash + 1))) s = s.slice(0, slash);
  const v4 = parseIPv4(s);
  if (v4 !== null) {
    const key = `v4:${v4.join('.')}`;
    return { key, p56: null, p48: null, wide: key, all: [key] };
  }
  if (s.includes(':')) {
    const g = parseIPv6(s);
    if (g !== null) {
      // IPv4-mapped (::ffff:a.b.c.d) counts as the IPv4 address (m13 3.1)
      if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
        const key = `v4:${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
        return { key, p56: null, p48: null, wide: key, all: [key] };
      }
      const h = g.slice(0, 4).map(hex4).join('');
      const key = `v6/64:${h}`;
      const p56 = `v6/56:${h.slice(0, 14)}`;
      const p48 = `v6/48:${h.slice(0, 12)}`;
      return { key, p56, p48, wide: p48, all: [key, p56, p48] };
    }
  }
  const key = `k:${raw.slice(0, OPAQUE_MAX)}`;
  return { key, p56: null, p48: null, wide: key, all: [key] };
}
