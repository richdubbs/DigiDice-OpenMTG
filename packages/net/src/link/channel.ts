/**
 * The reliability layer (docs/design/online.md, "Transport"): turns an unreliable, unordered datagram path into an ordered stream of JSON
 * messages. Message bodies (codec.ts) are split into fragments of FRAGMENT_BYTES with consecutive sequence numbers; every fragment is
 * retransmitted until acknowledged (cumulative + selective acks piggybacked on every payload), with an RTT-based timeout (RFC 6298) that backs off
 * exponentially; the receiver buffers out-of-order fragments, drops duplicates and delivers whole messages in order. Keep-alive pings keep the
 * peer informed when there is nothing to send; a peer that stays silent for `idleTimeout` is declared gone.
 *
 * The channel knows nothing about sockets, encryption or real time: it is driven by `receive(payload, now)` and `tick(now)` and sends through a
 * hook, so tests can run it on a simulated wire with a fake clock.
 */
import { decodeBody, encodeBody, MAX_JSON_BYTES, MAX_JSON_DEPTH } from '../wire/codec';
import { decodePayload, encodePayload, Flag, FRAGMENT_BYTES, isAcked, SACK_SPAN, sackBitmap, type Fragment, type Payload } from '../wire/frame';

export interface LinkOptions {
  /** How often the connection timer runs (ms). */
  tickMs: number;
  /** Retransmission timeout before the first RTT sample (ms). */
  rtoInitial: number;
  rtoMin: number;
  rtoMax: number;
  /** Fragments in flight (sent, not yet acknowledged) at most. */
  window: number;
  /** Send a keep-alive when nothing was sent for this long (ms). */
  pingInterval: number;
  /** Nothing heard from the other side for this long (or a fragment unacknowledged this long) = disconnected (ms). */
  idleTimeout: number;
  /** Largest message, in fragments (65535 at most: the fragment count is 16 bits). */
  maxMessageFragments: number;
  /**
   * Largest message this side accepts, in bytes of JSON after decompression (and so in fragments too). The host takes small messages from a guest
   * (game/host.ts, GUEST_MESSAGE_BYTES); the guest takes whole views (the default, MAX_JSON_BYTES).
   */
  maxReceiveBytes: number;
  /** Deepest nesting of arrays and objects this side accepts in a message (codec.ts, audit C4). */
  maxReceiveDepth: number;
  /**
   * Bytes of encoded messages waiting to be sent at most (audit M5: a peer that stops reading must not make the send queue grow without bound).
   * Past it the channel stops with a protocol error.
   */
  maxSendQueueBytes: number;
}

export const DEFAULT_LINK_OPTIONS: LinkOptions = {
  tickMs: 10,
  rtoInitial: 300,
  rtoMin: 40,
  rtoMax: 3000,
  window: 128,
  pingInterval: 1000,
  idleTimeout: 10000,
  maxMessageFragments: 40000,
  maxReceiveBytes: MAX_JSON_BYTES,
  maxReceiveDepth: MAX_JSON_DEPTH,
  maxSendQueueBytes: 48 * 1024 * 1024,
};

/** Options of one message sent. */
export interface SendOptions {
  /**
   * A message that supersedes an earlier one with the same key: if that one has not started to go out yet, it is dropped and this one goes to the
   * end of the queue (audit M5: at most one unsent view per guest).
   */
  replace?: string;
}

/** Out-of-order fragments the receiver buffers at most (well above any sender window). */
const RECV_WINDOW = 4096;

export interface ChannelHooks {
  transmit(payload: Buffer): void;
  message(message: unknown): void;
  /** Called once when the channel stops: peer said bye, timeout, or a protocol error. Not called by close(). */
  dead(reason: string): void;
}

export interface ChannelStats {
  fragmentsSent: number;
  retransmissions: number;
  fragmentsReceived: number;
  duplicates: number;
  outOfWindow: number;
  messagesSent: number;
  messagesReceived: number;
  /** Smoothed round-trip time (ms), once measured. */
  srtt: number | null;
}

/** A message waiting to go out: it is cut into fragments (and given sequence numbers) only as it is sent, so an unsent one can be dropped. */
interface Outgoing {
  msgId: number;
  body: Buffer;
  count: number;
  /** Index of the next fragment to send. */
  next: number;
  key?: string;
}

interface Flight {
  frag: Fragment;
  sentAt: number;
  firstSentAt: number;
  tries: number;
  rto: number;
}

export class Channel {
  readonly stats: ChannelStats = { fragmentsSent: 0, retransmissions: 0, fragmentsReceived: 0, duplicates: 0, outOfWindow: 0, messagesSent: 0, messagesReceived: 0, srtt: null };
  private nextSeq = 0;
  private nextMsgId = 1;
  private queue: Outgoing[] = [];
  private queueHead = 0;
  private queuedBytes = 0;
  private readonly inFlight = new Map<number, Flight>();
  private recvNext = 0;
  /** The highest cumulative ack the peer has sent (everything below it arrived). */
  private peerCum = 0;
  private readonly recvBuf = new Map<number, Fragment>();
  private assembling: { msgId: number; count: number; parts: Buffer[] } | null = null;
  private ackDue = false;
  private lastRecv: number;
  private lastSend: number;
  private rttvar = 0;
  private rto: number;
  private stopped = false;
  /** The largest message accepted, in fragments (a compressed body is never much larger than its JSON). */
  private readonly receiveFragments: number;
  /** Out-of-order fragments buffered at most: enough for the sender's window, and no more than a few largest messages. */
  private readonly recvWindow: number;

  constructor(private readonly hooks: ChannelHooks, private readonly options: LinkOptions, now: number) {
    this.lastRecv = now;
    this.lastSend = now;
    this.rto = options.rtoInitial;
    this.receiveFragments = Math.min(options.maxMessageFragments, Math.ceil((options.maxReceiveBytes + 64) / FRAGMENT_BYTES) + 1);
    this.recvWindow = Math.min(RECV_WINDOW, Math.max(2 * this.receiveFragments, 4 * options.window, 256));
  }

  get dead(): boolean {
    return this.stopped;
  }

  /** True when every message sent so far has been acknowledged. */
  get idle(): boolean {
    return this.queueHead >= this.queue.length && this.inFlight.size === 0;
  }

  /** Bytes of messages waiting to be sent (not cut into fragments yet; a message counts until its last fragment went out). */
  get queued(): number {
    return this.queuedBytes;
  }

  /** Queue a message (any JSON value). Returns its message id. */
  send(message: unknown, now: number, options: SendOptions = {}): number {
    if (this.stopped) throw new Error('The connection is closed.');
    const body = encodeBody(message);
    const count = Math.max(1, Math.ceil(body.length / FRAGMENT_BYTES));
    if (count > Math.min(this.options.maxMessageFragments, 0xffff)) throw new RangeError(`Message too large (${body.length} bytes)`);
    if (options.replace !== undefined) this.dropUnsent(options.replace);
    const msgId = this.nextMsgId++;
    this.queue.push({ msgId, body, count, next: 0, ...(options.replace !== undefined ? { key: options.replace } : {}) });
    this.queuedBytes += body.length;
    this.stats.messagesSent++;
    if (this.queuedBytes > this.options.maxSendQueueBytes) {
      this.die(`send queue overflow: ${this.queuedBytes} bytes waiting (the other side is not reading)`);
      return msgId;
    }
    this.pump(now);
    return msgId;
  }

  /** Drop the queued message with this key if none of its fragments went out yet. */
  private dropUnsent(key: string): void {
    for (let i = this.queueHead; i < this.queue.length; i++) {
      const m = this.queue[i]!;
      if (m.key !== key || m.next > 0) continue;
      this.queue.splice(i, 1);
      this.queuedBytes -= m.body.length;
      return;
    }
  }

  /** Handle the plaintext of an authenticated datagram. */
  receive(raw: Buffer, now: number): void {
    if (this.stopped) return;
    const p = decodePayload(raw);
    if (!p) return this.die('protocol error: malformed payload');
    this.lastRecv = now;
    if (p.flags & Flag.Bye) return this.die('closed by the other side');
    this.onAck(p, now);
    if (p.frame) this.onFrame(p.frame);
    if (this.stopped) return;
    this.pump(now);
    if (this.ackDue) this.sendControl(0, now);
  }

  /** Timers: retransmissions, delayed acks, keep-alive, disconnect detection. */
  tick(now: number): void {
    if (this.stopped) return;
    if (now - this.lastRecv >= this.options.idleTimeout) return this.die(`timeout: nothing heard for ${Math.round((now - this.lastRecv) / 1000)} s`);
    for (const f of this.inFlight.values()) {
      if (now - f.sentAt < f.rto) continue;
      if (now - f.firstSentAt >= this.options.idleTimeout) return this.die('timeout: data not acknowledged');
      f.tries++;
      f.sentAt = now;
      f.rto = Math.min(f.rto * 2, this.options.rtoMax);
      this.stats.retransmissions++;
      this.transmitFrame(f.frag, now);
    }
    this.pump(now);
    if (this.ackDue) this.sendControl(0, now);
    if (now - this.lastSend >= this.options.pingInterval) this.sendControl(Flag.Ping, now);
  }

  /** Stop and tell the other side (best effort: the bye is sent three times, unacknowledged). */
  close(now: number): void {
    if (this.stopped) return;
    for (let i = 0; i < 3; i++) this.sendControl(Flag.Bye, now);
    this.stopped = true;
  }

  // ---- sending

  private pump(now: number): void {
    // A fragment is sent only inside the span the peer's selective acks cover, so it can always tell us it got it.
    while (!this.stopped && this.inFlight.size < this.options.window && this.queueHead < this.queue.length && this.nextSeq <= this.peerCum + SACK_SPAN) {
      const m = this.queue[this.queueHead]!;
      const i = m.next++;
      const frag: Fragment = { seq: this.nextSeq++, msgId: m.msgId, index: i, count: m.count, data: m.body.subarray(i * FRAGMENT_BYTES, (i + 1) * FRAGMENT_BYTES) };
      if (m.next >= m.count) {
        this.queueHead++;
        this.queuedBytes -= m.body.length;
      }
      this.inFlight.set(frag.seq, { frag, sentAt: now, firstSentAt: now, tries: 1, rto: this.rto });
      this.transmitFrame(frag, now);
    }
    if (this.queueHead > 256 && this.queueHead * 2 > this.queue.length) {
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
  }

  /** Cumulative ack plus the bitmap of what arrived above it: after a loss the sender learns about everything behind the hole. */
  private ackBlock(): Pick<Payload, 'cum' | 'sack'> {
    return { cum: this.recvNext, sack: sackBitmap(this.recvNext, this.recvBuf.keys()) };
  }

  private transmitFrame(frame: Fragment, now: number): void {
    this.stats.fragmentsSent++;
    this.emit({ flags: Flag.Frame, ...this.ackBlock(), frame }, now);
  }

  private sendControl(flags: number, now: number): void {
    this.emit({ flags, ...this.ackBlock() }, now);
  }

  private emit(p: Payload, now: number): void {
    this.ackDue = false;
    this.lastSend = now;
    this.hooks.transmit(encodePayload(p));
  }

  // ---- receiving

  private onAck(p: Payload, now: number): void {
    if (p.cum > this.peerCum) this.peerCum = p.cum;
    for (const [seq, f] of this.inFlight) if (isAcked(p, seq)) this.acked(seq, f, now);
  }

  private acked(seq: number, f: Flight, now: number): void {
    this.inFlight.delete(seq);
    if (f.tries === 1) this.sampleRtt(now - f.sentAt); // Karn: only fragments sent once give a sample
  }

  /** RFC 6298 section 2. */
  private sampleRtt(r: number): void {
    const o = this.options;
    if (this.stats.srtt === null) {
      this.stats.srtt = r;
      this.rttvar = r / 2;
    } else {
      this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.stats.srtt - r);
      this.stats.srtt = 0.875 * this.stats.srtt + 0.125 * r;
    }
    this.rto = Math.min(o.rtoMax, Math.max(o.rtoMin, this.stats.srtt + Math.max(o.tickMs, 4 * this.rttvar)));
  }

  private onFrame(f: Fragment): void {
    if (f.seq < this.recvNext || this.recvBuf.has(f.seq)) {
      this.stats.duplicates++;
      this.ackDue = true; // the ack was probably lost
      return;
    }
    if (f.seq >= this.recvNext + this.recvWindow) {
      this.stats.outOfWindow++;
      return;
    }
    this.stats.fragmentsReceived++;
    this.recvBuf.set(f.seq, f);
    this.ackDue = true;
    for (let next = this.recvBuf.get(this.recvNext); next && !this.stopped; next = this.recvBuf.get(this.recvNext)) {
      this.recvBuf.delete(this.recvNext);
      this.recvNext++;
      this.deliver(next);
    }
  }

  /** Fragments arrive here in sequence order; reassemble and hand over whole messages. */
  private deliver(f: Fragment): void {
    const a = this.assembling;
    if (f.index === 0) {
      if (a) return this.die('protocol error: message interrupted');
      if (f.count > this.receiveFragments) return this.die('protocol error: message too large');
      this.assembling = { msgId: f.msgId, count: f.count, parts: [f.data] };
    } else {
      if (!a || a.msgId !== f.msgId || a.count !== f.count || a.parts.length !== f.index) return this.die('protocol error: fragment out of place');
      a.parts.push(f.data);
    }
    const cur = this.assembling!;
    if (cur.parts.length < cur.count) return;
    this.assembling = null;
    let message: unknown;
    try {
      message = decodeBody(Buffer.concat(cur.parts), this.options.maxReceiveBytes, this.options.maxReceiveDepth);
    } catch (e) {
      return this.die(`protocol error: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.stats.messagesReceived++;
    this.hooks.message(message);
  }

  private die(reason: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.hooks.dead(reason);
  }
}
