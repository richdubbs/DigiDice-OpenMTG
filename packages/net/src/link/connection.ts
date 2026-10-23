/**
 * One encrypted, reliable connection: a Channel (reliability) whose payloads travel in DATA datagrams sealed with the connection's keys.
 * Created by the endpoints (endpoint.ts) once the handshake has succeeded. Packet numbers start at 1 (the host's ACCEPT used 0) and only go
 * up, so a nonce is never reused; the replay window drops authenticated datagrams seen before. Until the guest has heard from the host it sends
 * DATA0 datagrams, which repeat the handshake salts and its public key (the host keeps no handshake state, endpoint.ts).
 *
 * Path validation (audit 2026-10-12, m10; like QUIC's PATH_CHALLENGE, RFC 9000 section 8.2): the peer's address changes only when a datagram with
 * the highest packet number so far arrives from a new address and the new address then answers a challenge (8 random bytes, sealed like any
 * datagram) with the same bytes. Until then datagrams keep going to the old address. So a NAT rebinding still moves the connection, but a stale or
 * raced copy of a datagram from another address cannot redirect the stream.
 *
 * Nothing a peer sends can throw out of here: a message listener that throws closes this connection only (audit C4).
 */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { open, ReplayWindow, seal, type ConnectionKeys } from '../wire/crypto';
import { data0Aad, dataAad, PacketType, PlainKind, type Packet } from '../wire/packet';
import { Channel, type ChannelStats, type LinkOptions, type SendOptions } from './channel';

export interface Remote {
  address: string;
  port: number;
}

export type SendDatagram = (buf: Buffer, to: Remote) => void;
export type DataPacket = Extract<Packet, { type: typeof PacketType.Data | typeof PacketType.Data0 }>;

export interface ConnectionStats extends ChannelStats {
  /** Datagrams for this connection that failed authentication or were replays. */
  dropped: number;
  /** Times the peer's address changed after a successful path validation. */
  migrations: number;
}

export interface ConnectionInit {
  connId: Buffer;
  keys: ConnectionKeys;
  role: 'host' | 'guest';
  remote: Remote;
  send: SendDatagram;
  options: LinkOptions;
  /** Guest only: the handshake values repeated in DATA0 datagrams until the first authenticated datagram from the host arrives. */
  salts?: { guest: Buffer; host: Buffer; guestPublic: Buffer };
  /** False: the owner calls `tick()` (the host endpoint drives all its connections from one timer, audit m6). Default true: an own timer. */
  ownTimer?: boolean;
  /** M12-5a: host only, the join code (normalized) the guest's handshake used: with one code per seat, it is the seat (handshake.ts). */
  joinCode?: string | null;
}

type MessageListener = (message: unknown) => void;
type CloseListener = (reason: string, byUs: boolean) => void;

const CHALLENGE_BYTES = 8;
/** How often a path challenge is repeated (ms), and how many times at most. */
const CHALLENGE_EVERY = 250;
const CHALLENGE_TRIES = 6;

const sameRemote = (a: Remote, b: Remote) => a.address === b.address && a.port === b.port;

export class Connection {
  readonly connId: Buffer;
  readonly role: 'host' | 'guest';
  readonly keys: ConnectionKeys;
  /** M12-5a: host only, the join code (normalized) this connection's handshake used; null when the transport does not say (ConnectionInit.joinCode). */
  readonly joinCode: string | null;
  remote: Remote;
  private pn = 1n;
  private readonly replay = new ReplayWindow();
  private readonly channel: Channel;
  private readonly timer: NodeJS.Timeout | null;
  private readonly messageListeners: MessageListener[] = [];
  private readonly closeListeners: CloseListener[] = [];
  private dropped = 0;
  private migrations = 0;
  private closedReason: string | null = null;
  private salts: { guest: Buffer; host: Buffer; guestPublic: Buffer } | null;
  private heard = false;
  private isAdmitted = false;
  /** A path being validated: the new address, the challenge bytes, when it was last sent and how often. */
  private probe: { to: Remote; token: Buffer; sentAt: number; tries: number } | null = null;

  constructor(private readonly init: ConnectionInit) {
    this.connId = init.connId;
    this.role = init.role;
    this.keys = init.keys;
    this.joinCode = init.joinCode ?? null;
    this.remote = init.remote;
    this.salts = init.salts ?? null;
    this.channel = new Channel(
      {
        transmit: (payload) => this.transmit(PlainKind.Channel, payload, this.remote),
        message: (m) => this.deliver(m),
        dead: (reason) => this.finish(reason, false),
      },
      init.options,
      performance.now(),
    );
    if (init.ownTimer === false) this.timer = null;
    else {
      this.timer = setInterval(() => this.tick(), init.options.tickMs);
      this.timer.unref();
    }
  }

  get closed(): boolean {
    return this.closedReason !== null;
  }

  get closeReason(): string | null {
    return this.closedReason;
  }

  /** True once an authenticated datagram arrived from the other side. */
  get heardFromPeer(): boolean {
    return this.heard;
  }

  /** True once the game layer accepted the peer (a seated guest): the host endpoint then no longer counts it as a pending connection (audit m6). */
  get admitted(): boolean {
    return this.isAdmitted;
  }

  admit(): void {
    this.isAdmitted = true;
  }

  get stats(): ConnectionStats {
    return { ...this.channel.stats, dropped: this.dropped, migrations: this.migrations };
  }

  /** Bytes of messages waiting to be sent. */
  get queuedBytes(): number {
    return this.channel.queued;
  }

  onMessage(l: MessageListener): void {
    this.messageListeners.push(l);
  }

  onClose(l: CloseListener): void {
    this.closeListeners.push(l);
  }

  /** Send a message reliably. Returns false when the connection is closed. */
  send(message: unknown, options: SendOptions = {}): boolean {
    if (this.closed || this.channel.dead) return false;
    this.channel.send(message, performance.now(), options);
    return true;
  }

  /** Timers: the channel's, and the path challenge's. Called by the own timer, or by the owner when `ownTimer` is false. */
  tick(now = performance.now()): void {
    if (this.closed) return;
    this.channel.tick(now);
    const p = this.probe;
    if (p && now - p.sentAt >= CHALLENGE_EVERY) {
      if (p.tries >= CHALLENGE_TRIES) this.probe = null; // the new path does not answer: stay on the old one
      else {
        p.tries++;
        p.sentAt = now;
        this.transmit(PlainKind.PathChallenge, p.token, p.to);
      }
    }
  }

  /** Handle an incoming DATA datagram for this connection. Returns false when it was dropped. */
  receive(p: DataPacket, from: Remote): boolean {
    if (this.closed || !this.replay.fresh(p.pn)) return this.drop();
    const plain = open(this.keys.recv, p.pn, p.aad, p.sealed);
    if (!plain || plain.length < 1) return this.drop();
    const newest = p.pn > this.replay.highest;
    this.replay.mark(p.pn);
    this.heard = true;
    this.salts = null; // the host has the keys: plain DATA from now on
    const kind = plain[0];
    const body = plain.subarray(1);
    if (kind === PlainKind.PathChallenge) {
      // Answer on the path the challenge came by (RFC 9000 section 8.2.2), whatever our current remote is.
      if (body.length === CHALLENGE_BYTES) this.transmit(PlainKind.PathResponse, body, from);
      return true;
    }
    if (kind === PlainKind.PathResponse) {
      const pr = this.probe;
      if (pr && sameRemote(pr.to, from) && body.length === CHALLENGE_BYTES && body.equals(pr.token)) {
        this.remote = from;
        this.probe = null;
        this.migrations++;
      }
      return true;
    }
    if (kind !== PlainKind.Channel) return this.drop();
    if (!sameRemote(from, this.remote) && newest && !(this.probe && sameRemote(this.probe.to, from))) this.challenge(from);
    this.channel.receive(body, performance.now());
    return true;
  }

  /** Wait until everything sent has been acknowledged (or the timeout passes, or the connection drops). */
  async flush(timeoutMs = 2000): Promise<boolean> {
    const end = performance.now() + timeoutMs;
    while (!this.channel.idle && !this.closed && performance.now() < end) await new Promise((r) => setTimeout(r, this.init.options.tickMs));
    return this.channel.idle;
  }

  /** Close politely: the other side is told (bye) and sees the connection end at once. */
  close(reason = 'closed'): void {
    if (this.closed) return;
    this.channel.close(performance.now());
    this.finish(reason, true);
  }

  /** Drop the connection without telling the other side (it notices by timeout). */
  destroy(reason = 'destroyed'): void {
    this.finish(reason, true);
  }

  private challenge(to: Remote): void {
    const now = performance.now();
    this.probe = { to, token: randomBytes(CHALLENGE_BYTES), sentAt: now, tries: 1 };
    this.transmit(PlainKind.PathChallenge, this.probe.token, to);
  }

  private deliver(m: unknown): void {
    for (const l of [...this.messageListeners]) {
      if (this.closed) return;
      try {
        l(m);
      } catch (e) {
        // A message no listener could handle must not take the process down (audit C4): close this connection only.
        this.close(`protocol error: message handler failed (${e instanceof Error ? e.message : String(e)})`);
        return;
      }
    }
  }

  private drop(): false {
    this.dropped++;
    return false;
  }

  private transmit(kind: number, payload: Buffer, to: Remote): void {
    const pn = this.pn++;
    const aad = this.salts ? data0Aad(this.connId, this.salts.guest, this.salts.host, this.salts.guestPublic, pn) : dataAad(this.connId, pn);
    this.init.send(Buffer.concat([aad, seal(this.keys.send, pn, aad, Buffer.concat([Buffer.from([kind]), payload]))]), to);
  }

  private finish(reason: string, byUs: boolean): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    if (this.timer) clearInterval(this.timer);
    this.probe = null;
    for (const l of [...this.closeListeners]) {
      try {
        l(reason, byUs);
      } catch {
        // a failing listener must not stop the others or escape into the socket handler
      }
    }
  }
}
