/**
 * RPL-3 (replays design 6, 16.3): protocol 5, in process (no sockets; normal traffic only). The two new messages and their checks: a player's
 * `replayConsent`, and `replayGame` (base64 of at most REPLAY_GAME_MAX_BYTES of gzip), whose malformed or oversized forms are dropped without throwing;
 * and the version handshake: a guest of protocol 4 is refused with 'version' in a message its version reads, and a guest of protocol 5 reads the refusal
 * of a protocol-4 host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH } from '../../src/game/host';
import { MemoryTransport } from '../../src/link/memory';
import {
  isReplayGameData, parseGuestMessage, parseHostMessage, PROTOCOL_VERSION, REPLAY_GAME_MAX_BYTES, REPLAY_GAME_MAX_TEXT,
} from '../../src/protocol/messages';
import { localVersions } from '../../src/protocol/versions';
import { helloProof } from '../../src/wire/crypto';
import { deck, FAST_LINK, fixtureDb, until } from '../helpers';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe('protocol 5 (RPL-3): the version handshake', () => {
  it('is protocol 5', () => {
    expect(PROTOCOL_VERSION).toBe(5);
  });

  for (const seats of [2, 3] as const) {
    it(`a guest of protocol 4 is refused with "version" in a message its version can read (${seats} seats)`, async () => {
      const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
      const host = await GameHost.attach({ name: 'Hana', deck: deck({ Forest: 40 }), cards: fixtureDb(), seats }, transport);
      cleanups.push(() => host.close('test over', 100));
      const rejected: string[] = [];
      host.on('rejected', (r) => rejected.push(r));
      const conn = await transport.connect(FAST_LINK, host.code);
      cleanups.push(() => conn.close('done'));
      const got: Record<string, unknown>[] = [];
      conn.onMessage((m) => got.push(m as Record<string, unknown>));
      conn.send({ v: 4, type: 'hello', versions: { ...localVersions(null), protocol: 4 }, name: 'Old', deck: deck({ Mountain: 40 }), proof: helloProof(conn.keys, conn.connId) });
      await until(() => got.length > 0, 3000, 'the refusal');
      expect(got[0]).toMatchObject({ v: 4, type: 'error', code: 'version', fatal: true });
      expect(got[0]!['message']).toBe('Message rejected: different OpenMTG network protocols (host 5, guest 4). Both players need the same OpenMTG version.');
      expect(rejected).toHaveLength(1);
      expect(host.started).toBe(false);
    });
  }

  it('a guest of protocol 5 reads the refusal of a protocol-4 host, so the player learns why; anything else of protocol 4 is dropped', () => {
    const e = parseHostMessage({ v: 4, type: 'error', code: 'version', message: 'Message rejected: different OpenMTG network protocols (host 4, guest 5).', fatal: true });
    expect(e).toMatchObject({ type: 'error', code: 'version', fatal: true });
    expect(e && e.type === 'error' && e.message).toMatch(/^The host runs another OpenMTG version \(network protocol 4; this one speaks 5\)\. Both players need the same OpenMTG version\./);
    expect(parseHostMessage({ v: 4, type: 'view', seq: 1, view: {}, events: [], legal: [] })).toBeNull();
    expect(parseHostMessage({ v: 4, type: 'replayGame', data: 'AAAA' })).toBeNull();
    // A version-4 guest's consent is refused like any message of another version (the host answers it in version 4, as above).
    expect(parseGuestMessage({ v: 4, type: 'replayConsent', agree: true })).toMatchObject({ ok: false, version: true, peerVersion: 4 });
  });
});

describe('protocol 5 (RPL-3): replayConsent and replayGame', () => {
  it('replayConsent carries one boolean; nothing else of it is kept', () => {
    expect(parseGuestMessage({ v: 5, type: 'replayConsent', agree: true })).toEqual({ ok: true, message: { v: 5, type: 'replayConsent', agree: true } });
    expect(parseGuestMessage({ v: 5, type: 'replayConsent', agree: false, extra: 'x' })).toEqual({ ok: true, message: { v: 5, type: 'replayConsent', agree: false } });
    for (const agree of [undefined, 'yes', 1, null, {}]) expect(parseGuestMessage({ v: 5, type: 'replayConsent', agree })).toEqual({ ok: false, error: 'replay consent malformed' });
  });

  it('replayGame: base64 of 1 to REPLAY_GAME_MAX_BYTES bytes', () => {
    const data = Buffer.from('a replay, gzipped').toString('base64');
    expect(parseHostMessage({ v: 5, type: 'replayGame', data })).toEqual({ v: 5, type: 'replayGame', data });
    expect(parseHostMessage({ v: 5, type: 'replayGame', data, extra: 1 })).toEqual({ v: 5, type: 'replayGame', data });
    expect(REPLAY_GAME_MAX_BYTES).toBe(1024 * 1024);
    const biggest = Buffer.alloc(REPLAY_GAME_MAX_BYTES, 7).toString('base64');
    expect(biggest.length).toBe(REPLAY_GAME_MAX_TEXT);
    expect(isReplayGameData(biggest)).toBe(true);
    for (const pad of ['QQ==', 'QUI=', 'QUJD']) expect(isReplayGameData(pad)).toBe(true);
  });

  it('a malformed or oversized replayGame is refused (dropped) without throwing', () => {
    const tooLong = Buffer.alloc(REPLAY_GAME_MAX_BYTES + 3, 7).toString('base64');
    expect(tooLong.length).toBe(REPLAY_GAME_MAX_TEXT + 4);
    const bad: unknown[] = [
      undefined, null, 42, true, {}, [], ['QUJD'], '', 'QUJ', 'QUJDR', 'QU=D', '====', 'QUJD====', 'QUJ\nD', 'QUJD\u0000', 'QUJ-', 'QUJ_', 'é'.repeat(4), tooLong,
      'A'.repeat(REPLAY_GAME_MAX_TEXT) + 'AAAA',
    ];
    for (const data of bad) {
      expect(() => parseHostMessage({ v: 5, type: 'replayGame', data }), String(data).slice(0, 20)).not.toThrow();
      expect(parseHostMessage({ v: 5, type: 'replayGame', data }), String(data).slice(0, 20)).toBeNull();
      expect(isReplayGameData(data)).toBe(false);
    }
    expect(parseHostMessage({ v: 5, type: 'replayGame' })).toBeNull();
  });
});
