/**
 * One encrypted connection, in process (no sockets): crafted datagrams are handed to `Connection.receive` directly. Forged, tampered and replayed
 * datagrams are dropped; a failing message listener closes only its connection (audit 2026-10-12, C4); the peer's address moves only after path
 * validation (m10).
 */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { dataAad } from '../src/wire/packet';
import { capturedPair, deliver, GUEST_ADDR, HOST_ADDR, type Datagram } from './memory';

const NEW_ADDR = { address: '203.0.113.9', port: 61000 };
const take = (list: Datagram[]) => list.splice(0);

describe('connection: authentication and replay', () => {
  it('drops forged, tampered and replayed datagrams; the connection keeps working', () => {
    const { host, guest, fromGuest } = capturedPair();
    const received: unknown[] = [];
    host.onMessage((m) => received.push(m));
    guest.send({ n: 1 });
    const [genuine] = take(fromGuest);
    expect(deliver(host, genuine!.buf, GUEST_ADDR)).toBe(true);
    expect(received).toEqual([{ n: 1 }]);

    // Forged: right connection id and a fresh packet number, sealed with a key the forger had to guess.
    expect(deliver(host, Buffer.concat([dataAad(host.connId, 1000n), randomBytes(64)]), GUEST_ADDR)).toBe(false);
    // Tampered: a genuine datagram with one bit of its header (associated data) flipped.
    const tampered = Buffer.from(genuine!.buf);
    tampered[15]! ^= 0x01;
    expect(deliver(host, tampered, GUEST_ADDR)).toBe(false);
    // Replayed: the genuine datagram again.
    expect(deliver(host, genuine!.buf, GUEST_ADDR)).toBe(false);
    expect(host.stats.dropped).toBe(3);
    expect(received).toEqual([{ n: 1 }]);

    guest.send({ n: 2 });
    for (const d of take(fromGuest)) deliver(host, d.buf, GUEST_ADDR);
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
    expect(host.closed).toBe(false);
  });
});

describe('connection: a failing handler (audit C4)', () => {
  it('a message listener that throws closes this connection only, and nothing escapes into the socket handler', () => {
    const { host, guest, fromGuest } = capturedPair();
    host.onMessage(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });
    const reasons: string[] = [];
    host.onClose((r) => reasons.push(r));
    host.onClose(() => {
      throw new Error('a failing close listener');
    });
    guest.send({ deep: true });
    for (const d of take(fromGuest)) expect(() => deliver(host, d.buf, GUEST_ADDR)).not.toThrow();
    expect(host.closed).toBe(true);
    expect(reasons[0]).toMatch(/protocol error: message handler failed \(Maximum call stack/);
  });
});

describe('connection: path validation (audit m10)', () => {
  it('a NAT rebinding moves the connection once the new address answers a challenge', () => {
    const { host, guest, fromHost, fromGuest } = capturedPair();
    guest.send({ n: 1 });
    // The guest's newest datagram arrives from a new address: the host challenges that address but keeps sending to the old one.
    for (const d of take(fromGuest)) deliver(host, d.buf, NEW_ADDR);
    expect(host.remote).toEqual(GUEST_ADDR);
    const challenges = take(fromHost).filter((d) => d.to.address === NEW_ADDR.address);
    expect(challenges).toHaveLength(1);
    host.send({ reply: 1 });
    expect(take(fromHost).every((d) => d.to.address === GUEST_ADDR.address)).toBe(true);
    // The guest answers on the path the challenge came by; the answer arrives from the new address: the host moves there.
    deliver(guest, challenges[0]!.buf, HOST_ADDR);
    const responses = take(fromGuest);
    expect(responses).toHaveLength(1);
    for (const d of responses) deliver(host, d.buf, NEW_ADDR);
    expect(host.remote).toEqual(NEW_ADDR);
    expect(host.stats.migrations).toBe(1);
  });

  it('a stale or raced copy from another address cannot redirect the stream', () => {
    const { host, guest, fromHost, fromGuest } = capturedPair();
    guest.send({ n: 1 });
    const old = take(fromGuest);
    guest.send({ n: 2 });
    for (const d of take(fromGuest)) deliver(host, d.buf, GUEST_ADDR);
    // An older datagram (not yet seen: inside the replay window) arrives from elsewhere: authenticated, but not the newest, so no challenge.
    for (const d of old) deliver(host, d.buf, NEW_ADDR);
    expect(take(fromHost).filter((d) => d.to.address === NEW_ADDR.address)).toHaveLength(0);
    expect(host.remote).toEqual(GUEST_ADDR);

    // A newest datagram from elsewhere gets a challenge, but an answer from a third address (or a wrong answer) moves nothing.
    guest.send({ n: 3 });
    for (const d of take(fromGuest)) deliver(host, d.buf, NEW_ADDR);
    const challenge = take(fromHost).find((d) => d.to.address === NEW_ADDR.address)!;
    deliver(guest, challenge.buf, HOST_ADDR);
    for (const d of take(fromGuest)) deliver(host, d.buf, { address: '233.252.0.1', port: 1 });
    expect(host.remote).toEqual(GUEST_ADDR);
    expect(host.stats.migrations).toBe(0);
  });

  it('a challenge that is never answered is given up after a few tries; the connection stays on its address', () => {
    const { host, guest, fromHost, fromGuest } = capturedPair();
    guest.send({ n: 1 });
    for (const d of take(fromGuest)) deliver(host, d.buf, NEW_ADDR);
    let t = performance.now();
    for (let i = 0; i < 20; i++) host.tick((t += 300));
    const toNew = take(fromHost).filter((d) => d.to.address === NEW_ADDR.address);
    expect(toNew.length).toBeGreaterThan(1);
    expect(toNew.length).toBeLessThanOrEqual(6);
    expect(host.remote).toEqual(GUEST_ADDR);
  });
});
