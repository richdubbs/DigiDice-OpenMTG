/**
 * In-process stand-ins for the network (no sockets): two Connections with keys from a real X25519 exchange whose datagrams land in arrays, so a
 * test delivers them itself (and can alter, repeat or redirect them); and a HostTransport for GameHost whose connections are such pairs.
 */
import { DEFAULT_LINK_OPTIONS, type LinkOptions } from '../src/link/channel';
import { Connection, type Remote } from '../src/link/connection';
import type { HostTransport } from '../src/game/host';
import { deriveKeys, newEphemeral, sharedSecret, type Handshake } from '../src/wire/crypto';
import { PacketType, parsePacket } from '../src/wire/packet';
import { randomBytes } from 'node:crypto';

export interface Datagram {
  buf: Buffer;
  to: Remote;
}

export const HOST_ADDR: Remote = { address: '192.0.2.1', port: 47620 };
export const GUEST_ADDR: Remote = { address: '198.51.100.7', port: 50000 };

/** Hand a datagram to a connection as if it came from `from`. Returns false when the connection dropped it. */
export function deliver(conn: Connection, buf: Buffer, from: Remote): boolean {
  const p = parsePacket(buf);
  if (!p || (p.type !== PacketType.Data && p.type !== PacketType.Data0)) return false;
  return conn.receive(p, from);
}

export function handshakeKeys(code = '8RFA2QXNK7DM5WCT'): Handshake {
  const g = newEphemeral();
  const h = newEphemeral();
  return {
    code, connId: randomBytes(8), guestSalt: randomBytes(32), hostSalt: randomBytes(32), guestPublic: g.publicKey, hostPublic: h.publicKey,
    shared: sharedSecret(g, h.publicKey)!,
  };
}

/** A host and a guest connection whose outgoing datagrams are collected (no timers: the test calls `tick`). */
export function capturedPair(link: Partial<LinkOptions> = {}): { host: Connection; guest: Connection; fromHost: Datagram[]; fromGuest: Datagram[] } {
  const hs = handshakeKeys();
  const options = { ...DEFAULT_LINK_OPTIONS, ...link };
  const fromHost: Datagram[] = [];
  const fromGuest: Datagram[] = [];
  const host = new Connection({
    connId: hs.connId, keys: deriveKeys(hs, 'host'), role: 'host', remote: GUEST_ADDR, send: (buf, to) => fromHost.push({ buf: Buffer.from(buf), to }), options,
    ownTimer: false,
  });
  const guest = new Connection({
    connId: hs.connId, keys: deriveKeys(hs, 'guest'), role: 'guest', remote: HOST_ADDR, send: (buf, to) => fromGuest.push({ buf: Buffer.from(buf), to }), options,
    ownTimer: false,
  });
  return { host, guest, fromHost, fromGuest };
}

/**
 * A host and a guest connection joined by an in-memory wire: datagrams arrive on the next turn of the event loop. `hostLink` adds options of the
 * host's end only (its receive limits). Close both when done.
 */
export function wiredPair(link: Partial<LinkOptions> = {}, hostLink: Partial<LinkOptions> = {}): { host: Connection; guest: Connection } {
  const hs = handshakeKeys();
  const options = { ...DEFAULT_LINK_OPTIONS, tickMs: 5, ...link };
  const ends: { host?: Connection; guest?: Connection } = {};
  const host = new Connection({
    connId: hs.connId, keys: deriveKeys(hs, 'host'), role: 'host', remote: GUEST_ADDR, options: { ...options, ...hostLink },
    send: (buf) => void setImmediate(() => ends.guest && !ends.guest.closed && deliver(ends.guest, buf, HOST_ADDR)),
  });
  const guest = new Connection({
    connId: hs.connId, keys: deriveKeys(hs, 'guest'), role: 'guest', remote: HOST_ADDR, options,
    send: (buf) => void setImmediate(() => ends.host && !ends.host.closed && deliver(ends.host, buf, GUEST_ADDR)),
  });
  ends.host = host;
  ends.guest = guest;
  return { host, guest };
}

/** A HostTransport whose connections the test hands over (`accept`). */
export class MemoryTransport implements HostTransport {
  readonly port = 0;
  readonly dropped = 0;
  private readonly listeners: ((c: Connection) => void)[] = [];

  onConnection(l: (c: Connection) => void): void {
    this.listeners.push(l);
  }

  accept(c: Connection): void {
    for (const l of this.listeners) l(c);
  }

  async close(): Promise<void> {
    // nothing to release
  }
}
