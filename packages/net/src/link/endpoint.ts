/**
 * UDP endpoints (docs/design/online.md, "Transport"): the sockets around the handshake of handshake.ts. The host feeds every datagram to its
 * HostHandshake and drives all connections from one timer; the guest repeats its INIT with backoff until an authenticated ACCEPT arrives.
 */
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { isIPv6 } from 'node:net';
import { NetError } from '../errors';
import { normalizeJoinCode, weakJoinCode } from '../wire/codes';
import { PacketType, parsePacket } from '../wire/packet';
import { DEFAULT_LINK_OPTIONS, type LinkOptions } from './channel';
import { Connection, type Remote, type SendDatagram } from './connection';
import type { FaultInjector } from './faults';
import { GuestHandshake, HostHandshake, type EndpointStats, type HostLimits } from './handshake';

export { DEFAULT_HOST_LIMITS, type EndpointStats, type HostLimits } from './handshake';

export const DEFAULT_PORT = 47620;
/** M12-5a: the most join codes a host has: one per guest seat of a 4-player game. */
export const MAX_JOIN_CODES = 3;
/** How long a closing endpoint keeps its socket open so the bye datagrams of its connections leave (ms). */
export const BYE_GRACE_MS = 100;

export interface EndpointOptions {
  link?: Partial<LinkOptions>;
  /** Test hook: datagrams this endpoint sends go through the injector. */
  faults?: FaultInjector;
  /** How long a handshake may take (ms). Default 10 s. */
  handshakeTimeout?: number;
}

function linkOptions(o: EndpointOptions): LinkOptions {
  return { ...DEFAULT_LINK_OPTIONS, ...o.link };
}

function sender(socket: Socket, faults: FaultInjector | undefined): SendDatagram {
  const raw: SendDatagram = (buf, to) => {
    try {
      socket.send(buf, to.port, to.address, () => undefined); // UDP: errors (unreachable...) are just loss
    } catch {
      // socket closed
    }
  };
  return faults ? faults.wrap(raw) : raw;
}

function remoteOf(r: RemoteInfo): Remote {
  return { address: r.address, port: r.port };
}

function requireCode(code: string): string {
  const c = normalizeJoinCode(code);
  if (!c) throw new NetError('badCode', 'That is not a valid join code (16 letters and digits, like 7KQ2-M9XD-4TRB-HC8P).');
  return c;
}

/**
 * A join code the host may use: well formed and not too easy to guess (audit 2026-10-12, m9: the code's security assumes 80 random bits). Leave the
 * code out and a random one is made.
 */
export function requireStrongCode(code: string): string {
  const c = requireCode(code);
  const weak = weakJoinCode(c);
  if (weak) throw new NetError('badCode', `That join code is too easy to guess (${weak}). Leave the code out and a random one is made.`);
  return c;
}

/** The host side: listens on a UDP port and turns authenticated handshakes into connections (handshake.ts). */
export class HostEndpoint {
  private readonly core: HostHandshake;
  private readonly sweeper: NodeJS.Timeout;
  private readonly ticker: NodeJS.Timeout;
  private closed = false;

  private constructor(private readonly socket: Socket, codes: readonly string[], options: EndpointOptions & { limits?: Partial<HostLimits> }) {
    const link = linkOptions(options);
    this.core = new HostHandshake({
      code: codes[0]!, codes, send: sender(socket, options.faults), link, cookieAge: Math.ceil((options.handshakeTimeout ?? 10000) / 1000) + 1,
      ...(options.limits ? { limits: options.limits } : {}),
    });
    socket.on('message', (buf, rinfo) => this.core.datagram(buf, remoteOf(rinfo)));
    this.sweeper = setInterval(() => this.core.sweep(), 1000);
    this.sweeper.unref();
    this.ticker = setInterval(() => this.core.tick(), link.tickMs); // one timer for every connection (audit m6)
    this.ticker.unref();
  }

  /**
   * Open the port. `codes` (M12-5a, m12 design 6): one join code per guest seat of a 3-4 player game, instead of `code` (each connection then records the
   * code it was made with, `Connection.joinCode`).
   */
  static async listen(o: EndpointOptions & { code: string; codes?: readonly string[]; port?: number; address?: string; limits?: Partial<HostLimits> }): Promise<HostEndpoint> {
    // At most one code per guest seat of a 4-player game (each INIT and DATA0 may cost the host one derivation per code).
    if (o.codes && o.codes.length > MAX_JOIN_CODES) throw new NetError('badCode', `A host has at most ${MAX_JOIN_CODES} join codes (one per guest seat).`);
    const codes = (o.codes && o.codes.length > 0 ? o.codes : [o.code]).map(requireStrongCode);
    if (new Set(codes).size !== codes.length) throw new NetError('badCode', 'Each seat needs its own join code.');
    const address = o.address ?? '0.0.0.0';
    const socket = createSocket({ type: isIPv6(address) ? 'udp6' : 'udp4' });
    socket.on('error', () => undefined); // ICMP errors and the like: UDP is lossy anyway
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(o.port ?? DEFAULT_PORT, address, () => {
        socket.off('error', reject);
        resolve();
      });
    });
    return new HostEndpoint(socket, codes, o);
  }

  get stats(): EndpointStats {
    return this.core.stats;
  }

  get port(): number {
    return this.socket.address().port;
  }

  get connections(): Connection[] {
    return this.core.connections;
  }

  /** Datagrams dropped by the endpoint and by its connections (malformed, unknown connection, failed authentication, replays, rate limits). */
  get dropped(): number {
    return this.core.stats.dropped + this.core.connections.reduce((n, c) => n + c.stats.dropped, 0);
  }

  onConnection(l: (c: Connection) => void): void {
    this.core.onConnection(l);
  }

  /**
   * Close every connection politely (each sends its bye datagrams) and then the socket. FIX-NET gap 1: `dgram.send` to an address string resolves
   * the address on a later tick, so a socket closed at once dropped those bye datagrams and a guest that had not received the game's own `bye` yet
   * heard nothing more and timed out after 10 s ("Connection lost"). The socket now stays open for `BYE_GRACE_MS` (the guest side does the same).
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.sweeper);
    clearInterval(this.ticker);
    this.core.close();
    await new Promise((r) => setTimeout(r, BYE_GRACE_MS));
    await new Promise<void>((r) => this.socket.close(() => r()));
  }
}

/** The addresses of a host name, IPv4 first (a host bound to 0.0.0.0 is IPv4 only, and "localhost" often resolves to ::1 first). */
async function addressesOf(host: string): Promise<string[]> {
  if (isIPLiteral(host)) return [host];
  try {
    const all = await lookup(host, { all: true });
    const list = [...all.filter((a) => a.family === 4), ...all.filter((a) => a.family !== 4)].map((a) => a.address);
    if (list.length) return [...new Set(list)];
  } catch (e) {
    throw new NetError('hostNotFound', `Cannot find the host "${host}" (${(e as { code?: string }).code ?? 'lookup failed'}). Check the name, or use the host's IP address.`);
  }
  throw new NetError('hostNotFound', `The host name "${host}" has no address.`);
}

/**
 * The guest side: handshake with a host and return the connection (which owns its socket and closes it when it ends). A host name is tried at each of
 * its addresses in turn. Rejects with NetError 'badCode' when the host answers but its ACCEPT does not authenticate with our code, 'timeout' when
 * nobody answers, 'hostNotFound' when the name does not resolve.
 */
export async function connect(o: EndpointOptions & { host: string; port: number; code: string }): Promise<Connection> {
  const code = requireCode(o.code);
  const addresses = await addressesOf(o.host);
  const total = o.handshakeTimeout ?? 10000;
  const each = addresses.length > 1 ? Math.max(1000, Math.floor(total / addresses.length)) : total;
  let last: NetError | null = null;
  for (const address of addresses) {
    try {
      return await handshake(o, code, address, each);
    } catch (e) {
      if (!(e instanceof NetError) || e.code === 'badCode') throw e;
      last = e;
    }
  }
  throw new NetError('timeout', `No answer from ${o.host}:${o.port}. Is the host running, and is UDP port ${o.port} forwarded to it?${last && addresses.length > 1 ? ` (tried ${addresses.join(', ')})` : ''}`);
}

async function handshake(o: EndpointOptions & { host: string; port: number }, code: string, address: string, timeoutMs: number): Promise<Connection> {
  const socket = createSocket({ type: isIPv6(address) ? 'udp6' : 'udp4' });
  socket.on('error', () => undefined);
  await new Promise<void>((resolve) => socket.bind(0, () => resolve()));
  const send = sender(socket, o.faults);
  const hostRemote: Remote = { address, port: o.port };
  const hs = new GuestHandshake(code);

  return await new Promise<Connection>((resolve, reject) => {
    let conn: Connection | null = null;
    let badAccepts = 0;
    let delay = 250;
    let retry: NodeJS.Timeout | undefined;
    const fail = (e: NetError) => {
      clearTimeout(retry);
      clearTimeout(deadline);
      closeQuietly(socket);
      reject(e);
    };
    const deadline = setTimeout(
      () => fail(badAccepts > 0
        ? new NetError('badCode', 'The host answered, but with a different join code.')
        : new NetError('timeout', `No answer from ${o.host}:${o.port}. Is the host running, and is UDP port ${o.port} forwarded to it?`)),
      timeoutMs,
    );
    const sendInit = () => {
      send(hs.init, hostRemote);
      retry = setTimeout(sendInit, delay);
      delay = Math.min(delay * 2, 2000);
    };
    const onDatagram = (buf: Buffer, rinfo: RemoteInfo) => {
      const p = parsePacket(buf);
      if (!p || !p.connId.equals(hs.connId)) return;
      if (p.type === PacketType.Data && conn) return void conn.receive(p, remoteOf(rinfo));
      if (p.type !== PacketType.Accept || conn) return;
      const got = hs.accept(p);
      if (!got) {
        // A wrong code shows up as ACCEPTs we cannot authenticate; the host answers each INIT, so give up after a few.
        if (++badAccepts >= 3) fail(new NetError('badCode', 'Join code rejected: the host uses a different code.'));
        return;
      }
      clearTimeout(retry);
      clearTimeout(deadline);
      conn = new Connection({ connId: hs.connId, keys: got.keys, role: 'guest', remote: remoteOf(rinfo), send, options: linkOptions(o), salts: got.salts });
      conn.onClose(() => setTimeout(() => closeQuietly(socket), BYE_GRACE_MS).unref()); // let the bye datagrams leave first
      resolve(conn);
    };
    socket.on('message', (buf, rinfo) => {
      try {
        onDatagram(buf, rinfo);
      } catch {
        // a hostile datagram must not crash the guest either (audit C4): it is dropped
      }
    });
    sendInit();
  });
}

function closeQuietly(socket: Socket): void {
  try {
    socket.close();
  } catch {
    // already closed
  }
}

function isIPLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || isIPv6(host);
}
