/**
 * The handshake of both sides, without sockets (docs/design/online.md, "Transport" and "Security"). endpoint.ts feeds it datagrams from UDP;
 * tests feed it crafted datagrams directly, in process.
 *
 *   guest                                          host
 *   INIT(connId, guestSalt, guestPub), padded ---->  hostSalt = cookie(host secret, time, connId, guestSalt, guestPub, source address and port);
 *                                                    hostPub = the X25519 key pair of this second (random, kept in memory, forgotten after
 *                                                    the cookie's lifetime)
 *                                            <----   ACCEPT(hostSalt, hostPub, sealed "openmtg-accept" with a key from the code)
 *                                                    (only a host that knows the code can seal it; it binds hostPub)
 *   DATA0(salts, guestPub, hello, sealed)    ---->   the cookie is checked, the keys derived from the code and the X25519 shared secret; the first
 *                                                    datagram that authenticates creates the connection (only a guest that knows the code and holds
 *                                                    its private key can seal it); everything else is dropped
 *
 * The host keeps no state for a handshake that has not authenticated (wire/crypto.ts, hostSaltCookie; only one key pair per second), so a flood of
 * INITs from anyone who can reach the port cannot push a joining guest out. The guest repeats INIT with backoff until an ACCEPT arrives, and its
 * datagrams carry both salts and its public key (DATA0) until it hears from the host. A cookie is good for a few seconds, and a connection id that
 * made a connection is remembered for longer than that, so a recorded DATA0 cannot open a second connection. Connections are found by connection
 * id, not by address.
 *
 * Resource limits (audit 2026-10-12, m6): a DATA0 that would open a connection (it costs an X25519 computation) is rate-limited per source address
 * and in total. The limits are taken only after the cookie checks, and the cookie covers the source address and port of the INIT
 * (wire/crypto.ts, hostSaltCookie): a valid cookie proves that the sender receives at that address, so a cookie replayed from forged addresses is
 * dropped before it can spend anyone's tokens. A connection id whose DATA0 failed to open is remembered for the cookie's lifetime, so one cookie
 * buys at most one X25519 computation.
 *
 * INITs are not rate-limited at all (a deviation from the audit's "rate-limit INIT and DATA0 per address"): their source can be forged, so a limit
 * per address would let anyone lock a guest out by forging its address, and a total limit would let anyone lock every guest out with a cheap
 * flood of forged INITs. An INIT costs only an HMAC, an HKDF and one AES-GCM seal (M12-5a, a host with several codes: up to three more HMACs for the code
 * tag, or one for a decoy key), stores nothing (but the bounded tag-less counter below), and is answered with fewer bytes than it has.
 *
 * At most `maxPending` connections may wait for the game layer to admit them (the oldest is closed for a newer one), at most `maxConnections`
 * exist at all, and the owner drives every connection from one timer (`tick`). A datagram that makes anything here throw is dropped (audit C4).
 *
 * One join code per seat (M12-5a, m12 design 6): a host of a 3-4 player game has one code per guest seat (`codes`). The guest's INIT carries a code tag
 * (crypto.ts, codeTag) that tells the host which code to seal its ACCEPT with. An INIT whose tag matches none is answered with an ACCEPT of the same size
 * sealed with a decoy key derived for that INIT (an HMAC under a secret of this host process of its connection id, salt, public key and the host salt:
 * stateless, never the same key for two INITs, and nobody can open it), so the guest reports a wrong code, as with one code. An INIT whose tag is all
 * zeros comes from a guest older than the tag (milestone 9, protocol 3): it is answered with the ACCEPT of each code in turn, one per repeat of that INIT
 * (a counter per connection id, in a table bounded by MAX_TAGLESS and forgotten with the cookies), so an old guest holding any of the codes completes the
 * link and then hears the game's clear version refusal (protocol 4), instead of a wrong-code error. The DATA0 is tried with each code (at most three key
 * derivations, after the cookie and rate-limit checks); the connection records the code it was made with (`Connection.joinCode`), which is its seat.
 * A host with one code ignores the tag: a two-player game's handshake is exactly milestone 9's.
 *
 * Anyone who can reach the port gets an ACCEPT for an INIT of their own, sealed with a key derived from the join code and their own key exchange:
 * an offline guessing oracle for the code. 80 random bits keep guessing out of reach (wire/codes.ts).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  acceptKey, checkHostSaltCookie, codeTag, deriveKeys, hostSaltCookie, newEphemeral, open, sameCodeTag, seal, sharedSecret, SALT_BYTES, type ConnectionKeys,
  type Ephemeral,
} from '../wire/crypto';
import { ACCEPT_PLAIN, acceptAad, encodeInit, PacketType, parsePacket, type Packet } from '../wire/packet';
import type { LinkOptions } from './channel';
import { Connection, type Remote, type SendDatagram } from './connection';
import { KeyedLimiter, type RateConfig } from './ratelimit';

/** Host-side limits (audit m6). */
export interface HostLimits {
  /** Connections not yet admitted by the game layer, at most (default 4); a new one closes the oldest. */
  maxPending: number;
  /** Connections at all, admitted or not (default 8); past it new ones are dropped. */
  maxConnections: number;
  /** DATA0 datagrams that would open a connection (an X25519 computation each), per source address (default 10/s, bursts of 20). */
  handshakesPerAddress: RateConfig;
  /** The same over every address together (default 200/s, bursts of 400). */
  handshakesTotal: RateConfig;
}

/** Connection ids whose DATA0 failed to open that are remembered at most (HostHandshake.failed). */
const MAX_FAILED = 4096;
/** M12-5a: tag-less INITs (a guest older than the code tag) counted at most, at a host with several codes (HostHandshake.codeOf). */
const MAX_TAGLESS = 1024;

export const DEFAULT_HOST_LIMITS: HostLimits = {
  maxPending: 4,
  maxConnections: 8,
  handshakesPerAddress: { rate: 10, burst: 20 },
  handshakesTotal: { rate: 200, burst: 400 },
};

export interface EndpointStats {
  /** Datagrams dropped before reaching a connection: malformed, unknown connection, failed authentication, rate-limited. */
  dropped: number;
  handshakes: number;
  /** Handshake datagrams dropped by the rate limits. */
  rateLimited: number;
  /** Pending connections closed for a newer one, or new ones dropped because there were too many. */
  evicted: number;
}

export interface HostHandshakeOptions {
  /** The normalized join code (codes.ts#normalizeJoinCode). */
  code: string;
  /**
   * M12-5a: every join code of the host (one per guest seat, normalized); `code` is then ignored. A guest's INIT names its code by its tag (codeTag) and
   * its connection records it (`Connection.joinCode`). With one code (or none given) the tag is not read: milestone 9's handshake.
   */
  codes?: readonly string[];
  send: SendDatagram;
  link: LinkOptions;
  /** How many seconds a cookie is good for. */
  cookieAge: number;
  limits?: Partial<HostLimits>;
  /** Wall clock in milliseconds (cookies, rate limits). Default Date.now; tests pass a fake one. */
  now?: () => number;
}

/** The host side: turns authenticated handshakes into connections. */
export class HostHandshake {
  readonly stats: EndpointStats = { dropped: 0, handshakes: 0, rateLimited: 0, evicted: 0 };
  readonly limits: HostLimits;
  private readonly conns = new Map<string, Connection>();
  /** Connection ids that made a connection, until their cookies are long expired (filled only by authenticated handshakes). */
  private readonly used = new Map<string, number>();
  /**
   * Connection ids whose DATA0 had a valid cookie but did not open, until their cookies expire (at most `MAX_FAILED`; filled only by senders that
   * passed the per-address limit, so a flood cannot grow it past that).
   */
  private readonly failed = new Map<string, number>();
  private readonly secret = randomBytes(32);
  private readonly ephemerals = new Map<number, Ephemeral>();
  private readonly listeners: ((c: Connection) => void)[] = [];
  private readonly limiter: KeyedLimiter;
  private readonly now: () => number;
  /** M12-5a: the host's join codes (one, or one per guest seat). */
  private readonly codes: readonly string[];
  /** M12-5a: the secret of the decoy keys (`decoyKey`): the ACCEPT of an INIT whose code tag matches none of the codes. */
  private readonly decoySecret = randomBytes(32);
  /** M12-5a: tag-less INITs (an older guest) seen per connection id, and until when (`codeOf`); at most MAX_TAGLESS entries. */
  private readonly tagless = new Map<string, { n: number; until: number }>();
  private closed = false;

  constructor(private readonly o: HostHandshakeOptions) {
    this.codes = o.codes && o.codes.length > 0 ? [...o.codes] : [o.code];
    if (this.codes.length > 3) throw new RangeError('A host has at most 3 join codes (one per guest seat).');
    this.limits = { ...DEFAULT_HOST_LIMITS, ...o.limits };
    this.now = o.now ?? Date.now;
    this.limiter = new KeyedLimiter(this.limits.handshakesPerAddress, this.limits.handshakesTotal, this.now());
  }

  get connections(): Connection[] {
    return [...this.conns.values()];
  }

  onConnection(l: (c: Connection) => void): void {
    this.listeners.push(l);
  }

  /** Handle one datagram. Never throws: whatever a datagram makes fail, it is dropped (audit C4). */
  datagram(buf: Buffer, from: Remote): void {
    try {
      this.handle(buf, from);
    } catch {
      this.stats.dropped++;
    }
  }

  /** Drive every connection's timers (one timer for all, audit m6). */
  tick(now = performance.now()): void {
    for (const c of [...this.conns.values()]) c.tick(now);
  }

  /** Forget expired connection ids, old X25519 keys and idle rate-limit buckets (about once a second). */
  sweep(): void {
    const now = this.now();
    for (const [id, until] of this.used) if (until < now) this.used.delete(id);
    for (const [id, until] of this.failed) if (until < now) this.failed.delete(id);
    for (const [id, t] of this.tagless) if (t.until < now) this.tagless.delete(id);
    // A bucket's key is needed only while its cookies are good (checkHostSaltCookie); forgetting it is what gives forward secrecy.
    for (const bucket of this.ephemerals.keys()) if (this.second() - bucket > this.o.cookieAge) this.ephemerals.delete(bucket);
    this.limiter.prune(now);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const c of [...this.conns.values()]) c.close('host closed');
    this.ephemerals.clear();
  }

  private second(): number {
    return Math.floor(this.now() / 1000);
  }

  private handle(buf: Buffer, remote: Remote): void {
    if (this.closed) return;
    const p = parsePacket(buf);
    if (!p) return void this.stats.dropped++;
    const id = p.connId.toString('hex');
    if (p.type === PacketType.Init) {
      if (this.conns.has(id)) return; // a late repeat: the guest is connected already
      // Stateless: the same INIT from the same source in the same second gets the same ACCEPT, and nothing is stored per INIT (but the bounded counter
      // of tag-less INITs at a host with several codes). No key exchange here (it runs for a DATA0 whose cookie, bound to this source, proves the sender
      // receives there): INITs from forged addresses cost one HMAC, one HKDF and one AES-GCM seal, and at a host with several codes up to three more
      // HMACs (the code tag) or one (a decoy key).
      const bucket = this.second();
      const hostSalt = hostSaltCookie(this.secret, { connId: p.connId, guestSalt: p.salt, guestPublic: p.publicKey, source: remote }, bucket);
      const hostPublic = this.ephemeral(bucket).publicKey;
      const code = this.codeOf(p.tag, p.connId, p.salt, p.publicKey);
      const key = code !== null
        ? acceptKey({ code, connId: p.connId, guestSalt: p.salt, hostSalt, guestPublic: p.publicKey, hostPublic })
        : this.decoyKey(p.connId, p.salt, p.publicKey, hostSalt);
      const aad = acceptAad(p.connId, hostSalt, hostPublic, 0n);
      this.o.send(Buffer.concat([aad, seal(key, 0n, aad, ACCEPT_PLAIN)]), remote);
      return;
    }
    if (p.type !== PacketType.Data && p.type !== PacketType.Data0) return void this.stats.dropped++;
    const conn = this.conns.get(id);
    if (conn) {
      if (!conn.receive(p, remote)) this.stats.dropped++;
      return;
    }
    // A new connection needs a DATA0 with a fresh cookie of ours, sealed with the derived key (checked here, before anyone sees it).
    if (p.type !== PacketType.Data0 || this.used.has(id) || this.failed.has(id)) return void this.stats.dropped++;
    const cookie = { connId: p.connId, guestSalt: p.guestSalt, guestPublic: p.guestPublic, source: remote };
    if (!checkHostSaltCookie(this.secret, cookie, p.hostSalt, this.second(), this.o.cookieAge)) return void this.stats.dropped++;
    // Only now, with the source proven by the cookie, does the sender spend tokens (its own and the shared ones).
    if (!this.limiter.take(remote.address, this.now())) {
      this.stats.rateLimited++;
      return void this.stats.dropped++;
    }
    const eph = this.ephemerals.get(p.hostSalt.readUInt32BE(0));
    const shared = eph ? sharedSecret(eph, p.guestPublic) : null;
    // M12-5a: the code this DATA0 was sealed with (one per seat): the first that opens it.
    let keys: ConnectionKeys | null = null;
    let joinCode: string | null = null;
    if (eph && shared) {
      for (const code of this.codes) {
        const k = deriveKeys({ code, connId: p.connId, guestSalt: p.guestSalt, hostSalt: p.hostSalt, guestPublic: p.guestPublic, hostPublic: eph.publicKey, shared }, 'host');
        if (open(k.recv, p.pn, p.aad, p.sealed)) {
          keys = k;
          joinCode = code;
          break;
        }
      }
    }
    if (!keys || joinCode === null) {
      this.rememberFailed(id);
      return void this.stats.dropped++;
    }
    if (!this.makeRoom()) return;
    this.used.set(id, this.now() + (this.o.cookieAge + 5) * 1000);
    this.stats.handshakes++;
    const c = new Connection({ connId: p.connId, keys, role: 'host', remote, send: this.o.send, options: this.o.link, ownTimer: false, joinCode });
    this.conns.set(id, c);
    c.onClose(() => this.conns.delete(id));
    for (const l of [...this.listeners]) l(c);
    c.receive(p, remote);
  }

  /**
   * M12-5a: the code an INIT's tag names: the only code when there is one (the tag is not read), else the code whose tag it is, or null. An all-zero tag
   * (a guest older than the tag) gets each code in turn, one per repeat of its INIT (see the file comment).
   */
  private codeOf(tag: Buffer, connId: Buffer, salt: Buffer, publicKey: Buffer): string | null {
    if (this.codes.length === 1) return this.codes[0]!;
    if (tag.every((b) => b === 0)) {
      const id = connId.toString('hex');
      const seen = this.tagless.get(id);
      if (!seen && this.tagless.size >= MAX_TAGLESS) this.tagless.delete(this.tagless.keys().next().value!);
      const n = seen?.n ?? 0;
      this.tagless.set(id, { n: n + 1, until: this.now() + (this.o.cookieAge + 1) * 1000 });
      return this.codes[n % this.codes.length]!;
    }
    return this.codes.find((code) => sameCodeTag(tag, code, connId, salt, publicKey)) ?? null;
  }

  /** M12-5a: the decoy key of one INIT: stateless (the same INIT gets the same one), different for every INIT, known to nobody. */
  private decoyKey(connId: Buffer, salt: Buffer, publicKey: Buffer, hostSalt: Buffer): Buffer {
    return createHmac('sha256', this.decoySecret).update('openmtg-decoy').update(connId).update(salt).update(publicKey).update(hostSalt).digest();
  }

  /** A connection id whose DATA0 did not open is not tried again while its cookie is good (bounded: the oldest entry goes first). */
  private rememberFailed(id: string): void {
    if (this.failed.size >= MAX_FAILED) this.failed.delete(this.failed.keys().next().value!);
    this.failed.set(id, this.now() + (this.o.cookieAge + 1) * 1000);
  }

  /** The host's X25519 key pair of a time bucket (one per second, made when the first INIT of that second arrives; `sweep` forgets old ones). */
  private ephemeral(bucket: number): Ephemeral {
    let e = this.ephemerals.get(bucket);
    if (!e) {
      e = newEphemeral();
      this.ephemerals.set(bucket, e);
    }
    return e;
  }

  /** Room for one more connection: close the oldest pending one if too many wait; false when there are too many connections at all. */
  private makeRoom(): boolean {
    const all = [...this.conns.values()].filter((c) => !c.closed);
    const pending = all.filter((c) => !c.admitted);
    if (pending.length >= this.limits.maxPending) {
      pending[0]!.close('too many connections are waiting to join'); // Map order: the oldest first
      this.stats.evicted++;
      return true;
    }
    if (all.length >= this.limits.maxConnections) {
      this.stats.evicted++;
      this.stats.dropped++;
      return false;
    }
    return true;
  }
}

type AcceptPacket = Extract<Packet, { type: typeof PacketType.Accept }>;

/** The guest side of one handshake attempt: its INIT, and the keys from the host's ACCEPT. */
export class GuestHandshake {
  readonly connId = randomBytes(8);
  readonly init: Buffer;
  private readonly guestSalt = randomBytes(SALT_BYTES);
  private readonly eph = newEphemeral();

  /** `code`: the normalized join code. */
  constructor(private readonly code: string) {
    this.init = encodeInit(this.connId, this.guestSalt, this.eph.publicKey, codeTag(code, this.connId, this.guestSalt, this.eph.publicKey));
  }

  /**
   * The connection keys from an ACCEPT, or null when it does not authenticate with our code (or its public key is unusable). `salts` are what the
   * guest repeats in its DATA0 datagrams until it hears from the host.
   */
  accept(p: AcceptPacket): { keys: ConnectionKeys; salts: { guest: Buffer; host: Buffer; guestPublic: Buffer } } | null {
    if (!p.connId.equals(this.connId) || p.pn !== 0n) return null;
    const context = { code: this.code, connId: this.connId, guestSalt: this.guestSalt, hostSalt: p.salt, guestPublic: this.eph.publicKey, hostPublic: p.publicKey };
    const plain = open(acceptKey(context), p.pn, p.aad, p.sealed);
    if (!plain?.equals(ACCEPT_PLAIN)) return null;
    const shared = sharedSecret(this.eph, p.publicKey);
    if (!shared) return null;
    return { keys: deriveKeys({ ...context, shared }, 'guest'), salts: { guest: this.guestSalt, host: p.salt, guestPublic: this.eph.publicKey } };
  }
}
