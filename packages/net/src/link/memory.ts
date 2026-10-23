/**
 * An in-process link (no sockets): a host transport whose connections are joined to guest connections by an in-memory wire. Datagrams are sealed and
 * opened like on UDP (keys from a real X25519 exchange) and arrive on the next turn of the event loop. For tests of the layers above the link (the
 * server's online bridge, game-level tests) that must not open sockets.
 *
 *   const transport = new MemoryTransport();
 *   const host = await GameHost.attach({ ... }, transport);
 *   const guest = await GameGuest.join({ ..., connector: (o) => transport.connect(o.link) });
 */
import { randomBytes } from 'node:crypto';
import { NetError } from '../errors';
import { normalizeJoinCode } from '../wire/codes';
import type { HostTransport } from '../game/host';
import { deriveKeys, newEphemeral, sharedSecret } from '../wire/crypto';
import { PacketType, parsePacket } from '../wire/packet';
import { DEFAULT_LINK_OPTIONS, type LinkOptions } from './channel';
import { Connection, type Remote } from './connection';

/** Documentation addresses (RFC 5737): nothing here is ever sent anywhere. */
const HOST_ADDR: Remote = { address: '192.0.2.1', port: 47620 };
const GUEST_ADDR: Remote = { address: '198.51.100.7', port: 50000 };
const TEST_CODE = '8RFA2QXNK7DM5WCT';

function deliver(conn: Connection, buf: Buffer, from: Remote): void {
  const p = parsePacket(buf);
  if (p && (p.type === PacketType.Data || p.type === PacketType.Data0)) conn.receive(p, from);
}

/**
 * A host and a guest connection joined by an in-memory wire. `hostLink` adds options of the host's end only (its receive limits). `code` (M12-5a): the
 * join code the guest holds; the host's end records it normalized (`Connection.joinCode`, its seat in a 3-4 player game), or null when it is left out.
 */
export function memoryPair(link: Partial<LinkOptions> = {}, hostLink: Partial<LinkOptions> = {}, code?: string): { host: Connection; guest: Connection } {
  const g = newEphemeral();
  const h = newEphemeral();
  const shared = sharedSecret(g, h.publicKey);
  if (!shared) throw new Error('X25519 failed');
  const joinCode = code === undefined ? null : normalizeJoinCode(code);
  const hs = { code: joinCode ?? TEST_CODE, connId: randomBytes(8), guestSalt: randomBytes(32), hostSalt: randomBytes(32), guestPublic: g.publicKey, hostPublic: h.publicKey, shared };
  const options = { ...DEFAULT_LINK_OPTIONS, ...link };
  const ends: { host?: Connection; guest?: Connection } = {};
  const host = new Connection({
    connId: hs.connId, keys: deriveKeys(hs, 'host'), role: 'host', remote: GUEST_ADDR, options: { ...options, ...hostLink }, joinCode,
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

/** A HostTransport whose connections come from `connect` (or are handed over with `accept`). */
export class MemoryTransport implements HostTransport {
  readonly port = 0;
  readonly dropped = 0;
  private readonly listeners: ((c: Connection) => void)[] = [];
  private readonly open = new Set<Connection>();
  private closed = false;

  /** `hostLink`: options of the host's ends (GameHost.start gives its endpoint the guest-message limits; pass them here to get the same). */
  constructor(private readonly hostLink: Partial<LinkOptions> = {}) {}

  onConnection(l: (c: Connection) => void): void {
    this.listeners.push(l);
  }

  accept(c: Connection): void {
    this.open.add(c);
    c.onClose(() => this.open.delete(c));
    for (const l of this.listeners) l(c);
  }

  /**
   * A guest's end of a new connection to this host (for GuestOptions.connector). Rejects once the transport is closed, like a host that is gone. `code`
   * (M12-5a): the join code the guest holds, recorded on the host's end (`Connection.joinCode`: its seat in a 3-4 player game); the in-memory link does
   * not check it (the host's game layer does, as UDP's handshake would refuse a code the host has not got).
   */
  async connect(link: Partial<LinkOptions> = {}, code?: string): Promise<Connection> {
    if (this.closed) throw new NetError('timeout', 'No answer from the host (it closed the game).');
    const { host, guest } = memoryPair(link, this.hostLink, code);
    this.accept(host);
    return guest;
  }

  /** Drop every host end without telling the guests (a crashed host or a cut cable): the guests notice by their idle timeout. */
  cut(reason = 'cut'): void {
    for (const c of [...this.open]) c.destroy(reason);
  }

  /** Close every host end politely (each tells its guest end: bye), like HostEndpoint.close. */
  async close(): Promise<void> {
    this.closed = true;
    for (const c of [...this.open]) c.close('host closed');
  }
}
