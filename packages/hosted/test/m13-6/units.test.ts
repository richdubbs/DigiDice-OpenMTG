/**
 * M13-6 units (fixed lists of crafted inputs, a fake clock; no floods, no fuzzing: the owner rule): address keys and the proxy rule, the strict Origin
 * allow-list, frames checked for size and depth BEFORE parsing, the per-key limits, the outbound budget and behind mode with a fake slow socket, ids,
 * invite codes, the runtime's table directory, and the additive interface changes (the history type, the command limits).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOSTED_TOKEN, MAX_FRAME_BYTES, NOTICE_KINDS, type HistoryEntryView, type HostedServerType } from '../../src/api';
import * as api from '../../src/api';
import { clocksAt, ropeFor, seatClockAt } from '../../src/clock';
import { COMMAND_LIMITS } from '../../src/config';
import type { HistoryEntry } from '../../src/ledger/history';
import { addressKey, aggregateKey, canonicalAddress, clientAddress } from '../../src/gateway/address';
import { parseFrame } from '../../src/gateway/frames';
import { newToken, sha256Hex, ulid } from '../../src/gateway/ids';
import { JoinGuard, KeyBuckets, SessionGuard, SocketGuard } from '../../src/gateway/limits';
import { originAllowed } from '../../src/gateway/origin';
import { Outbound, OutboundBudget, REBALANCE_EVERY_MS } from '../../src/gateway/outbound';
import { bearerMatches, PrometheusMetrics } from '../../src/gateway/metrics';
import { METRICS } from '../../src/obs';
import { STORE_ID } from '../../src/store';
import type { SeatRow, TableRow } from '../../src/store/api';
import { inviteHash, newInviteCode, typedInviteHash } from '../../src/tables/codes';
import { metaOfRow, StoreTableDirectory } from '../../src/tables/directory';
import { normalizeJoinCode } from '@openmtg/net/server-kit';
import { TEST_DECK } from './harness';

afterEach(() => vi.restoreAllMocks());

describe('M13-6 addresses: keys /32 and /64, the proxy rule', () => {
  it('canonical addresses and keys (IPv4-mapped IPv6 counts as IPv4)', () => {
    const cases: [string, string | null, string | null][] = [
      ['203.0.113.7', '203.0.113.7', '4:203.0.113.7'],
      ['::ffff:203.0.113.7', '203.0.113.7', '4:203.0.113.7'],
      ['::FFFF:CB00:7107', '203.0.113.7', '4:203.0.113.7'],
      ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2:3:4:5:6', '6:2001:db8:1:2'],
      ['2001:db8:1:2::9', '2001:db8:1:2:0:0:0:9', '6:2001:db8:1:2'],
      ['2001:DB8:1:2:ffff::1', '2001:db8:1:2:ffff:0:0:1', '6:2001:db8:1:2'],
      ['[2001:db8::1]', '2001:db8:0:0:0:0:0:1', '6:2001:db8:0:0'],
      ['fe80::1%eth0', 'fe80:0:0:0:0:0:0:1', '6:fe80:0:0:0'],
      ['::1', '0:0:0:0:0:0:0:1', '6:0:0:0:0'],
      ['127.0.0.1', '127.0.0.1', '4:127.0.0.1'],
      ['', null, null],
      ['localhost', null, null],
      ['1.2.3', null, null],
      ['2001:db8::1::2', null, null],
    ];
    for (const [raw, canon, key] of cases) {
      expect(canonicalAddress(raw), raw).toBe(canon);
      if (canon) expect(addressKey(canon), raw).toBe(key);
    }
    // Two addresses of one /64 share a key; another /64 does not.
    expect(addressKey(canonicalAddress('2001:db8:1:2::a')!)).toBe(addressKey(canonicalAddress('2001:db8:1:2:ffff:ffff:ffff:ffff')!));
    expect(addressKey(canonicalAddress('2001:db8:1:3::a')!)).not.toBe(addressKey(canonicalAddress('2001:db8:1:2::a')!));
  });

  it('without TRUST_PROXY the TCP peer is the client and X-Forwarded-For is ignored', () => {
    expect(clientAddress('198.51.100.4', '203.0.113.9', null)).toEqual({ ok: true, address: '198.51.100.4', key: '4:198.51.100.4' });
    expect(clientAddress(undefined, undefined, null)).toEqual({ ok: false, reason: 'address' });
  });

  it('with TRUST_PROXY only the proxy may connect; the client is the rightmost X-Forwarded-For entry', () => {
    const proxy = '10.0.0.2';
    expect(clientAddress('10.0.0.2', '203.0.113.9', proxy)).toEqual({ ok: true, address: '203.0.113.9', key: '4:203.0.113.9' });
    // entries left of the proxy's own came from the client: never trusted
    expect(clientAddress('10.0.0.2', '1.1.1.1, 203.0.113.9', proxy)).toMatchObject({ ok: true, address: '203.0.113.9' });
    expect(clientAddress('::ffff:10.0.0.2', ['1.1.1.1', '2001:db8::5'], proxy)).toMatchObject({ ok: true, key: '6:2001:db8:0:0' });
    // any other peer is refused, whatever it claims
    expect(clientAddress('10.0.0.3', '203.0.113.9', proxy)).toEqual({ ok: false, reason: 'proxy' });
    expect(clientAddress('203.0.113.9', '10.0.0.2', proxy)).toEqual({ ok: false, reason: 'proxy' });
    // the proxy without a usable header
    expect(clientAddress('10.0.0.2', undefined, proxy)).toEqual({ ok: false, reason: 'address' });
    expect(clientAddress('10.0.0.2', 'unknown', proxy)).toEqual({ ok: false, reason: 'address' });
    expect(clientAddress('10.0.0.2', '203.0.113.9, ', proxy)).toMatchObject({ ok: true, address: '203.0.113.9' });
  });
});

describe('M13-6 Origin: a strict allow-list', () => {
  const prod = { publicOrigins: ['https://play.digidice.net'], allowDesktopOrigins: true };
  it('accepts exactly the public origins and the desktop app loopback origins', () => {
    for (const o of ['https://play.digidice.net', 'http://127.0.0.1:5173', 'http://localhost:8787', 'http://127.0.0.1:65535', 'http://localhost:1']) {
      expect(originAllowed(o, prod), o).toBe(true);
    }
  });
  it('refuses everything else (no null, prefix, suffix, wildcard, case folding, default port, trailing slash)', () => {
    const bad: unknown[] = [
      undefined, '', 'null', ['https://play.digidice.net'], 'https://play.digidice.net/', 'https://play.digidice.net.evil.example', 'https://evil.play.digidice.net',
      'http://play.digidice.net', 'HTTPS://PLAY.DIGIDICE.NET', 'https://play.digidice.net:443', 'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:65536',
      'http://127.0.0.1:080', 'https://127.0.0.1:5173', 'http://127.0.0.2:5173', 'http://localhost.evil.example:5173', 'http://[::1]:5173', 'file://',
      'http://127.0.0.1:5173/', 'http://user@127.0.0.1:5173', '*',
    ];
    for (const o of bad) expect(originAllowed(o as string, prod), String(o)).toBe(false);
    expect(originAllowed('http://127.0.0.1:5173', { publicOrigins: prod.publicOrigins, allowDesktopOrigins: false })).toBe(false);
  });
});

describe('M13-6 frames: size and depth before parsing, strict fields', () => {
  it('a frame past 256 KB or nested past 24 is refused without JSON.parse ever seeing it', () => {
    const parse = vi.spyOn(JSON, 'parse');
    const big = JSON.stringify({ t: 'chat', id: 1, text: 'x'.repeat(MAX_FRAME_BYTES) });
    expect(parseFrame(big, false)).toEqual({ ok: false, fatal: 'frame' });
    const deep = `{"t":"chat","id":1,"text":${'['.repeat(25)}${']'.repeat(25)}}`;
    expect(parseFrame(deep, false)).toEqual({ ok: false, fatal: 'depth' });
    // A deep frame hidden in a string is not deep.
    expect(parseFrame(`{"t":"chat","id":1,"text":"${'['.repeat(40)}"}`, false)).toMatchObject({ ok: true });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('a frame the `ws` library hands over as fragments or as an ArrayBuffer is the same frame; multibyte text is measured in bytes', () => {
    const text = JSON.stringify({ t: 'chat', id: 4, text: 'héllo 🎲' });
    const bytes = Buffer.from(text);
    for (const data of [bytes, [bytes.subarray(0, 7), bytes.subarray(7, 20), bytes.subarray(20)], bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), text]) {
      expect(parseFrame(data as never, false)).toMatchObject({ ok: true, msg: { t: 'chat', id: 4, text: 'héllo 🎲' } });
    }
    // 256 KB is a size in bytes: 90,000 three-byte characters are 270,000 bytes though only 90,000 characters
    expect(parseFrame(JSON.stringify({ t: 'chat', id: 1, text: '€'.repeat(90_000) }), false)).toEqual({ ok: false, fatal: 'frame' });
    // 80,000 of them (240,000 bytes) pass the frame check and meet the text limit of the command instead
    expect(parseFrame(JSON.stringify({ t: 'chat', id: 1, text: '€'.repeat(80_000) }), false)).toMatchObject({ ok: false, fatal: null, error: { code: 'badMessage' } });
  });

  it('binary frames, non-JSON, unknown types and bad ids are fatal; bad fields are answered', () => {
    expect(parseFrame(Buffer.from('{"t":"ping"}'), true)).toEqual({ ok: false, fatal: 'binary' });
    expect(parseFrame('not json', false)).toEqual({ ok: false, fatal: 'json' });
    for (const t of ['[]', '"x"', '{"t":"nope"}', '{"t":"__proto__"}', '{"t":"toString"}', '{}', 'null']) expect(parseFrame(t, false), t).toEqual({ ok: false, fatal: 'type' });
    for (const id of ['0', '-1', '1.5', '"1"', '2147483648', 'null']) expect(parseFrame(`{"t":"sync","id":${id}}`, false), id).toEqual({ ok: false, fatal: 'id' });
    expect(parseFrame('{"t":"sync","id":3,"extra":1}', false)).toMatchObject({ ok: false, fatal: null, id: 3, error: { code: 'badMessage' } });
    expect(parseFrame('{"t":"sync","id":3,"__proto__":{"x":1}}', false)).toMatchObject({ ok: false, fatal: null, error: { code: 'badMessage' } });
    expect(parseFrame('{"t":"chat","id":3}', false)).toMatchObject({ ok: false, fatal: null, error: { message: 'Missing field "text".' } });
  });

  it('values of each command (fixed crafted inputs)', () => {
    const deck = TEST_DECK;
    const ok = [
      { t: 'hello', protocol: 1, name: 'Ann' },
      { t: 'hello', protocol: 1, name: 'Ann', token: newToken() },
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'private', deck },
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'listed', title: 'Game night', password: 'open sesame', deck },
      // CMP1: a companion section (CR 702.139a), also named in the sideboard as lists do
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'private', deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [{ name: 'Lurrus of the Dream-Den', count: 1 }], companion: [{ name: 'Lurrus of the Dream-Den', count: 1 }] } },
      { t: 'join', id: 2, code: 'ABCD-EFGH-JKMN-PQRS', deck },
      { t: 'join', id: 2, table: '01HZZZZZZZZZZZZZZZZZZZZZZZ', password: 'pw12', deck },
      { t: 'act', id: 3, seq: 0, action: { type: 'pass', player: 'p1' } },
      { t: 'vote', id: 4, proposal: 2, accept: false, reason: 'no thanks' },
      { t: 'browse', id: 5, filter: { format: 'casual', open: true }, sort: 'newest', page: 0 },
      { t: 'watchLobby', id: 6, filter: null },
      { t: 'report', id: 7, kind: 'bug', text: 'It broke', attachments: [{ kind: 'view', json: '{}' }] },
      { t: 'history', id: 8 },
      { t: 'ready', id: 9, start: 'abcdef0123456789' },
      { t: 'queue', id: 10, format: 'casual', size: 2, deck },
    ];
    for (const m of ok) expect(parseFrame(JSON.stringify(m), false), JSON.stringify(m).slice(0, 60)).toMatchObject({ ok: true });
    const bad = [
      { t: 'create', id: 1, format: 'historic', seats: 2, visibility: 'private', deck },
      { t: 'create', id: 1, format: 'casual', seats: 5, visibility: 'private', deck },
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'secret', deck },
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'private', deck: { main: [], sideboard: [], extra: [] } },
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'private', deck: { main: [{ name: 'Forest', count: 60, foil: true }], sideboard: [] } },
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'private', deck: { main: [{ name: 'For‮est', count: 60 }], sideboard: [] } },
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'private', deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [], companion: [{ name: 'Lurrus', count: 1, foil: true }] } },
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'private', deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [], companion: [{ name: 'Lur‮rus', count: 1 }] } },
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'private', deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [], companion: 'Lurrus' } },
      { t: 'create', id: 1, format: 'casual', seats: 2, visibility: 'private', deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [], companion: [{ name: 'Lurrus', count: 1 }, { name: 'Zirda', count: 1 }] } },
      { t: 'join', id: 2, deck },
      { t: 'join', id: 2, code: 'ABCD', table: 'x', deck },
      { t: 'join', id: 2, code: 'ABCD', password: 'x', deck },
      { t: 'join', id: 2, table: '../etc', deck },
      { t: 'act', id: 3, seq: -1, action: { type: 'pass', player: 'p1' } },
      { t: 'act', id: 3, seq: 0, action: { type: 'pass', player: 'p1', extra: 1 } },
      { t: 'act', id: 3, seq: 0, action: { type: 'answer', player: 'p1', decisionId: 'd1', answer: { kind: 'chooseName', name: 'a\u0000b' } } },
      { t: 'act', id: 3, seq: 0, action: { type: 'answer', player: 'p1', decisionId: 'd1', answer: { kind: 'chooseName', name: 'x'.repeat(201) } } },
      { t: 'vote', id: 4, proposal: 2, accept: 'yes' },
      { t: 'vote', id: 4, proposal: 2, accept: true, reason: 'a⁦b' },
      { t: 'browse', id: 5, filter: { format: 'casual', x: 1 }, sort: 'newest', page: 0 },
      { t: 'browse', id: 5, filter: {}, sort: 'oldest', page: 0 },
      { t: 'report', id: 7, kind: 'spam', text: 'x' },
      { t: 'report', id: 7, kind: 'bug', text: 'x', attachments: [{ kind: 'log', json: '{}' }] },
      { t: 'ready', id: 9, start: '' },
      { t: 'queue', id: 10, format: 'casual', size: 3, deck },
    ];
    for (const m of bad) expect(parseFrame(JSON.stringify(m), false), JSON.stringify(m).slice(0, 80)).toMatchObject({ ok: false, fatal: null });
  });
});

describe('M13-6 limits (a fake clock, fixed inputs)', () => {
  it('per-key buckets with no shared bucket: one key using its budget never refuses another', () => {
    const b = new KeyBuckets({ rate: 1, burst: 2 });
    expect([b.take('a', 0), b.take('a', 0), b.take('a', 0)]).toEqual([true, true, false]);
    expect(b.take('b', 0)).toBe(true);
    expect(b.wait('a', 0)).toBe(1_000);
    expect(b.take('a', 1_000)).toBe(true);
    const small = new KeyBuckets({ rate: 1, burst: 1 }, 4);
    for (const k of ['1', '2', '3', '4', '5', '6']) expect(small.take(k, 0), k).toBe(true);
    expect(small.size).toBeLessThanOrEqual(4);
  });

  it('join attempts: 1/s burst 5 per session and address key; 10 failures in 10 minutes lock both for 10 minutes', () => {
    const g = new JoinGuard();
    let t = 0;
    for (let i = 0; i < 5; i++) expect(g.check('s1', 'k1', t)).toBeNull();
    expect(g.check('s1', 'k1', t)).toBe('rate');
    // another session from another address is not affected
    expect(g.check('s2', 'k2', t)).toBeNull();
    for (let i = 0; i < 9; i++) {
      t += 1_000;
      expect(g.check('s1', 'k1', t)).toBeNull();
      expect(g.fail('s1', 'k1', t)).toBe(false);
    }
    t += 1_000;
    expect(g.fail('s1', 'k1', t)).toBe(true);
    expect(g.check('s1', 'k1', t + 1_000)).toBe('locked');
    // a new session from the same address key is locked too, and the old session from elsewhere
    expect(g.check('s9', 'k1', t + 1_000)).toBe('locked');
    expect(g.check('s1', 'k9', t + 1_000)).toBe('locked');
    expect(g.lockedFor('s1', 'k1', t + 1_000)).toBe(10 * 60_000 - 1_000);
    expect(g.check('s1', 'k1', t + 10 * 60_000)).toBeNull();
  });

  it('locks that ended are forgotten even when their session never comes back (bounded memory)', () => {
    const g = new JoinGuard();
    // 5,000 sessions, each from its own address key, fail ten times at once: 5,000 session locks and 5,000 key locks
    for (let i = 0; i < 5_000; i++) for (let n = 0; n < 10; n++) g.fail(`s${i}`, `k${i}`, 0);
    expect(g.locks).toBeGreaterThan(4_096);
    // after the ten minutes the next lock sweeps the ended ones out
    for (let n = 0; n < 10; n++) g.fail('late', 'late-key', 10 * 60_000 + 1);
    expect(g.locks).toBe(2);
    expect(g.check('late', 'other', 10 * 60_000 + 2)).toBe('locked');
    expect(g.check('s1', 'k1', 10 * 60_000 + 2)).toBeNull();
  });

  it('new sessions: 5 a minute per key (burst 10); past the global rate only heavy keys are refused', () => {
    const g = new SessionGuard(12);
    let t = 0;
    for (let i = 0; i < 10; i++) expect(g.allow('heavy', t), `burst ${i}`).toBe(true);
    expect(g.allow('heavy', t)).toBe(false);
    // The global rate (12 a minute) is now nearly used: a light key still gets its sessions...
    expect(g.allow('light-1', t)).toBe(true);
    expect(g.allow('light-2', t)).toBe(true);
    // ...past it too (backpressure sheds only keys with more than 2 in the last 10 minutes)
    expect(g.allow('light-3', t)).toBe(true);
    t += 60_000;
    for (let i = 0; i < 4; i++) expect(g.allow('heavy', t)).toBe(true); // the bucket refilled 5 a minute
    for (let i = 0; i < 8; i++) g.allow(`l${i}`, t);
    expect(g.allow('heavy', t)).toBe(false); // over the global rate, heavy: shed
    expect(g.allow('new-key', t)).toBe(true);
  });

  it('sockets: 8 open per key, 1 new a second (burst 10), MAX_CONNECTIONS in all', () => {
    const g = new SocketGuard(12);
    for (let i = 0; i < 8; i++) expect(g.admit('k', 0)).toBeNull();
    expect(g.admit('k', 0)).toBe('sockets');
    g.release('k');
    expect(g.admit('k', 0)).toBeNull();
    // 8 open sockets of 'k' and 4 of 'j' are the 12 connections: the 13th, from any key, is refused whatever its own budget
    for (let i = 0; i < 4; i++) expect(g.admit('j', 0)).toBeNull();
    expect(g.admit('x', 0)).toBe('connections');
    expect(g.connections).toBe(12);
  });
});

/** A socket that reports frames written only when told. */
class SlowSocket {
  sent: { text: string; done: () => void }[] = [];
  send(text: string, done: () => void): void {
    this.sent.push({ text, done });
  }
  flush(): void {
    for (const s of this.sent.splice(0)) s.done();
  }
}

describe('M13-6 outbound: 1 MB per connection, behind mode, the total budget', () => {
  const patch = (n: number) => JSON.stringify({ t: 'patch', seq: n, base: n - 1, ops: [{ op: 'x', v: 'y'.repeat(100 * 1024) }], events: [], legal: [] });

  it('hands the socket at most 256 KB at a time; past 1 MB the connection goes behind and drops its queued patches; one full view after the drain', () => {
    const budget = new OutboundBudget(256 * 1024 * 1024);
    const sock = new SlowSocket();
    const events: string[] = [];
    let catchUps = 0;
    const out = new Outbound(sock, budget, { catchUp: () => (catchUps++, true), overflow: (r) => events.push(`overflow:${r}`), behind: () => events.push('behind') });
    for (let i = 1; i <= 3; i++) out.send('patch', patch(i));
    expect(sock.sent.length).toBe(3); // 300 KB in flight: the next waits
    for (let i = 4; i <= 12; i++) out.send('patch', patch(i));
    expect(sock.sent.length).toBe(3);
    expect(events).toEqual(['behind']);
    expect(out.state).toBe('behind');
    // queued patches dropped; only what the socket holds is counted
    expect(out.backlog).toBeLessThan(400 * 1024);
    // control messages still go; game payloads do not
    out.send('reply', JSON.stringify({ t: 'reply', id: 9, ok: true }));
    out.send('patch', patch(13));
    out.send('clock', JSON.stringify({ t: 'clock', at: 0, seats: [] }));
    sock.flush();
    expect(sock.sent.map((s) => (JSON.parse(s.text) as { t: string }).t)).toEqual(['reply']);
    expect(catchUps).toBe(0);
    sock.flush();
    // drained: it asked for one fresh full view; patches until that view are dropped
    expect(catchUps).toBe(1);
    expect(out.state).toBe('catchup');
    out.send('patch', patch(20));
    expect(sock.sent).toEqual([]);
    out.send('view', JSON.stringify({ t: 'view', seq: 20, view: {}, events: [], legal: [] }));
    out.send('patch', patch(21));
    expect(out.state).toBe('normal');
    expect(sock.sent.map((s) => (JSON.parse(s.text) as { t: string }).t)).toEqual(['view', 'patch']);
  });

  it('behind: the lobby updates and the queue status are kept (nothing sends them again); the views, patches, clocks and chat are dropped', () => {
    const budget = new OutboundBudget(256 * 1024 * 1024);
    const all: string[] = [];
    const pending: (() => void)[] = [];
    const sock = { send: (text: string, done: () => void) => (all.push(text), pending.push(done)) };
    const out = new Outbound(sock, budget, { catchUp: () => false, overflow: () => undefined });
    out.send('notice', JSON.stringify({ t: 'notice', n: 0 })); // in flight: the reader has not read it
    out.goBehind();
    expect(out.state).toBe('behind');
    for (const k of ['view', 'patch', 'clock', 'chat', 'lobbyUpdate', 'queueStatus', 'notice', 'reply'] as const) out.send(k, JSON.stringify({ t: k }));
    while (pending.length > 0) pending.shift()!();
    expect(all.map((x) => (JSON.parse(x) as { t: string }).t)).toEqual(['notice', 'lobbyUpdate', 'queueStatus', 'notice', 'reply']);
    expect(out.state).toBe('normal'); // nothing to catch up on: it was not seated
  });

  it('behind: control messages past the hard cap close the connection (4004)', () => {
    const budget = new OutboundBudget(256 * 1024 * 1024);
    const sock = new SlowSocket();
    const events: string[] = [];
    const out = new Outbound(sock, budget, { catchUp: () => true, overflow: (r) => events.push(r) });
    out.goBehind();
    const big = JSON.stringify({ t: 'notice', kind: 'degraded', text: 'z'.repeat(300 * 1024) });
    for (let i = 0; i < 12 && events.length === 0; i++) out.send('notice', big);
    expect(events).toEqual(['behind']);
    expect(budget.used).toBe(0);
  });

  it('the total budget: above 80% the largest backlogs go behind first; at 100% the largest offenders are closed', () => {
    const budget = new OutboundBudget(4 * 1024 * 1024);
    const closed: number[] = [];
    const behind: number[] = [];
    const conns = [0, 1, 2, 3].map((i) => new Outbound(new SlowSocket(), budget, { catchUp: () => true, overflow: () => closed.push(i), behind: () => behind.push(i) }, { highWater: 256 * 1024, connection: 8 * 1024 * 1024, hardCap: 16 * 1024 * 1024 }));
    // connection 3 is the slow one: it piles up; the others stay small
    for (let i = 0; i < 4; i++) conns[i]!.send('patch', patch(1));
    for (let i = 0; i < 40 && behind.length === 0; i++) conns[3]!.send('patch', patch(i + 2));
    expect(behind).toEqual([3]);
    expect(budget.fraction()).toBeLessThan(0.8);
    // control messages to the behind connection keep growing: past 100% it is closed
    const notice = JSON.stringify({ t: 'notice', kind: 'degraded', text: 'z'.repeat(256 * 1024) });
    for (let i = 0; i < 20 && closed.length === 0; i++) conns[3]!.send('notice', notice);
    expect(closed).toEqual([3]);
    expect(budget.used).toBeLessThan(budget.limitBytes);
  });
});

describe('M13-6 the total budget sorts the connections at most every 100 ms above 80% (review 2)', () => {
  /** 50 connections whose sockets do not write; `mb` KB sent to the first... each notice is 1,000 bytes of JSON text. */
  function room(limit: number, clock: { t: number }) {
    const budget = new OutboundBudget(limit, 0.8, () => clock.t);
    const conns = Array.from({ length: 50 }, () => new Outbound({ send: () => undefined }, budget, { catchUp: () => true, overflow: () => undefined }));
    const notice = (n: number) => JSON.stringify({ t: 'notice', kind: 'degraded', text: 'z'.repeat(n - 42) });
    return { budget, conns, notice };
  }

  it('the first send over 80% sorts at once; the sends after it within 100 ms do not; 100 ms later the next does; at 100% every send does', () => {
    const clock = { t: 1_000_000 };
    const { budget, conns, notice } = room(100_000, clock);
    for (let i = 0; i < 79; i++) conns[i % 50]!.send('notice', notice(1_000)); // 79%
    expect(budget.rebalances).toBe(0);
    conns[0]!.send('notice', notice(2_000)); // 81%: the first crossing
    expect(budget.rebalances).toBe(1);
    for (let i = 0; i < 15; i++) conns[i]!.send('notice', notice(1_000)); // up to 96% in the same instant: no more sorting
    expect(budget.rebalances).toBe(1);
    clock.t += REBALANCE_EVERY_MS - 1;
    conns[1]!.send('notice', notice(500));
    expect(budget.rebalances).toBe(1);
    clock.t += 1;
    conns[1]!.send('notice', notice(500));
    expect(budget.rebalances).toBe(2);
    // the housekeeping tick sorts when nothing else has (a total that stays above 80% with no send)
    clock.t += 1_000;
    budget.check();
    expect(budget.rebalances).toBe(3);
    // at 100% the send sorts at once, within the same instant (the largest backlog is closed and gives its bytes back)
    const before = budget.rebalances;
    const used = budget.used;
    conns[40]!.send('notice', notice(100_000 - used));
    expect(budget.rebalances).toBe(before + 1);
    expect(budget.used).toBeLessThan(100_000);
  });

  it('under 80% the tick and the sends never sort', () => {
    const clock = { t: 5 };
    const { budget, conns, notice } = room(100_000, clock);
    for (let i = 0; i < 70; i++) conns[i % 50]!.send('notice', notice(1_000));
    budget.check();
    expect(budget.rebalances).toBe(0);
  });

  it('a total of exactly 100% closes the largest backlog (the limit is the limit, not one byte past it)', () => {
    const budget = new OutboundBudget(1_000);
    const closed: string[] = [];
    const out = new Outbound({ send: () => undefined }, budget, { catchUp: () => true, overflow: (r) => closed.push(r) });
    out.send('notice', JSON.stringify({ t: 'notice', kind: 'degraded', text: 'z'.repeat(1_000 - 41) }));
    expect(budget.used).toBe(0); // its bytes left the budget when it was closed
    expect(closed).toEqual(['outbound']);
  });
});

describe('M13-6 ids and the metrics listener', () => {
  it('tokens: 32 random bytes as 64 hex digits, stored only as SHA-256; ids are ULIDs the store accepts', () => {
    const t = newToken();
    expect(HOSTED_TOKEN.test(t)).toBe(true);
    expect(newToken()).not.toBe(t);
    expect(sha256Hex(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(t)).not.toBe(t);
    const a = ulid(1_000);
    const b = ulid(2_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(STORE_ID.test(a)).toBe(true);
    expect(a < b).toBe(true);
  });

  it('metrics need the exact bearer token; the text is Prometheus format with checked names', () => {
    const token = 'f'.repeat(64);
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true);
    for (const h of [undefined, '', token, `bearer ${token}`, `Bearer ${token} `, `Bearer ${token.slice(1)}`, `Bearer ${'e'.repeat(64)}`]) expect(bearerMatches(h, token), String(h)).toBe(false);
    const m = new PrometheusMetrics();
    m.inc(METRICS.refusals, { reason: 'origin' });
    m.inc(METRICS.refusals, { reason: 'origin' });
    m.set(METRICS.connections, 3);
    m.observe(METRICS.actionSeconds, 0.25);
    const text = m.text();
    expect(text).toContain('openmtg_hosted_refusals_total{reason="origin"} 2');
    expect(text).toContain('openmtg_hosted_connections 3');
    expect(text).toContain('openmtg_hosted_action_seconds_count 1');
    expect(() => m.inc(METRICS.refusals, { reason: 'a session id' })).toThrow();
    const types: HostedServerType[] = ['patch'];
    expect(types).toHaveLength(1);
  });
});

describe('M13-6 invite codes', () => {
  it('a new code is 16 Crockford characters in groups of four; the server keeps only its hash; typed variations hash alike; other codes do not', () => {
    const a = newInviteCode();
    const b = newInviteCode();
    expect(a.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(a.code).not.toBe(b.code);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(inviteHash(normalizeJoinCode(a.code)!));
    expect(a.hash).not.toContain(a.code.replace(/-/g, ''));
    // typed: any case, spaces for dashes, none at all, the look-alike letters Crockford maps (O is 0, I and L are 1)
    const plain = a.code.replace(/-/g, '');
    for (const typed of [a.code.toLowerCase(), a.code.replace(/-/g, ' '), plain, ` ${a.code} `, plain.replace(/0/g, 'o').replace(/1/g, 'l')]) expect(typedInviteHash(typed), typed).toBe(a.hash);
    for (const typed of ['', 'short', `${plain}0`, plain.slice(1), plain.replace(/.$/, 'U'), a.code + b.code]) expect(typedInviteHash(typed), typed).toBeNull();
    expect(typedInviteHash(b.code)).toBe(b.hash);
    expect(typedInviteHash(b.code)).not.toBe(a.hash);
    // a hash of a code is not a hash of the same text as a token (the two never stand in for each other)
    expect(inviteHash(plain)).not.toBe(sha256Hex(plain));
  });
});

describe('M13-6 the table directory of the runtime (design 2.3: what a recovered game needs besides its log)', () => {
  const seat = (n: 1 | 2, session: string | null, deckHash: string | null): SeatRow => ({
    seat: n, player: null, session, name: session ? `Name ${n}` : null, deck: null, deckHash, inviteHash: null, joinedAt: null, leftAt: null,
  });
  const row = (o: Partial<TableRow> = {}): TableRow => ({
    id: 'G1', format: 'casual', variant: null, seats: 2, source: 'listed', title: 'Table', passwordHash: null, passwordSalt: null, createdAt: new Date(0),
    seatRows: [seat(1, 's1', 'h1'), seat(2, 's2', 'h2')], status: 'running', waitingSince: null, startedAt: new Date(5_000), seating: [1, 2], ...o,
  });

  it('a running table with every seat sat and fingerprinted is known: its ledger seats are the sessions and fingerprints of the rows', () => {
    expect(metaOfRow(row())).toEqual({
      game: 'G1', format: 'casual', source: 'listed', seats: 2, startedAt: 5_000,
      ledgerSeats: [{ seat: 1, session: 's1', account: null, deckHash: 'h1' }, { seat: 2, session: 's2', account: null, deckHash: 'h2' }],
    });
    const clock = { bankMs: 60_000, delayMs: 1_000, dropMs: 30_000 };
    expect(metaOfRow(row({ source: 'matched' }), { clock: () => clock, limits: { checkpointEvery: 10 } })).toMatchObject({ source: 'matched', clock, limits: { checkpointEvery: 10 } });
  });

  it('anything else is unknown (the runtime voids the game: recovery): another status, no start, a format of another server, an empty seat, a missing fingerprint', () => {
    const unknown: Partial<TableRow>[] = [
      { status: 'lobby' }, { status: 'waitingCapacity' }, { status: 'finished' }, { status: 'void' }, { status: 'quarantined' }, { startedAt: null },
      { format: 'historic' as never }, { seatRows: [seat(1, 's1', 'h1'), seat(2, null, null)] }, { seatRows: [seat(1, 's1', 'h1'), seat(2, 's2', null)] },
      { seatRows: [seat(1, 's1', 'h1')] }, { seats: 3 },
    ];
    for (const o of unknown) expect(metaOfRow(row(o)), JSON.stringify(o)).toBeNull();
  });

  it('StoreTableDirectory asks the store, and does not know a game the store does not', async () => {
    const asked: string[] = [];
    const dir = new StoreTableDirectory({ tableRow: async (id) => (asked.push(id), id === 'G1' ? row() : null) });
    expect(await dir.meta('G1')).toMatchObject({ game: 'G1', seats: 2 });
    expect(await dir.meta('nope')).toBeNull();
    expect(asked).toEqual(['G1', 'nope']);
  });
});

describe('M13-6 the additive interface changes stay what they were made to be', () => {
  it('the `history` reply carries exactly the history entry of the ledger (api.ts keeps its own copy of the type for browsers: the two must not drift)', () => {
    type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
    const same: Same<HistoryEntryView, HistoryEntry> = true;
    expect(same).toBe(true);
  });

  it('every command of the protocol has a limit but those the gate, the table or the command itself paces; the new notice and limits exist', () => {
    expect(Object.keys(COMMAND_LIMITS).sort()).toEqual(['browse', 'codes', 'create', 'history', 'join', 'leave', 'ping', 'queue', 'ready', 'report', 'spectate', 'vote', 'watchLobby']);
    expect(NOTICE_KINDS).toContain('cancelsUsed');
  });
});

describe('M13-6 what @openmtg/hosted/api gives the client (review: the heartbeat and the clock arithmetic)', () => {
  it('the clock and rope arithmetic of the server is exported by the browser-safe contract (the same functions), with the numbers the design gives', () => {
    expect(api.clocksAt).toBe(clocksAt);
    expect(api.seatClockAt).toBe(seatClockAt);
    expect(api.ropeFor).toBe(ropeFor);
    expect(api.ROPE_URGENT_MS).toBe(60_000);
    const view = { at: 1_000, seats: [{ seat: 1 as const, bankMs: 100_000, running: true, delayMs: 5_000, dropMs: 300_000, dropRunning: false }, { seat: 2 as const, bankMs: 900_000, running: false, delayMs: 0, dropMs: 120_000, dropRunning: true }], abandonMs: 50_000 };
    // 3 s later: the delay of seat 1 is not spent; its bank is whole; seat 2's drop clock ran
    const early = api.clocksAt(view, 4_000);
    expect(early.seats[0]).toMatchObject({ delayMs: 2_000, bankMs: 100_000, rope: false, urgent: false });
    expect(early.seats[1]).toMatchObject({ dropMs: 117_000 });
    expect(early.abandonMs).toBe(47_000);
    // 50 s later: the delay is spent and 45 s of bank gone: the rope is shown, and urgent (under 60 s)
    expect(api.ropeFor(view, 1, 51_000)).toEqual({ bankMs: 55_000, urgent: true });
    expect(api.ropeFor(view, 2, 51_000)).toBeNull();
    expect(api.ropeFor(view, 3 as never, 51_000)).toBeNull();
  });

  it('ping is answered by a pong message of the protocol', () => {
    const pong: api.HostedServerMessage = { t: 'pong' };
    const type: api.HostedServerType = pong.t;
    expect(type).toBe('pong');
  });
});

describe('M13-6 IPv6 aggregates: a /48 holds 65,536 /64s and has 16 times the allowance of one (review note)', () => {
  const v6 = (net: number, host = 1) => addressKey(canonicalAddress(`2001:db8:${(1).toString(16)}:${net.toString(16)}::${host}`)!); // one /48, a /64 per `net`
  const other48 = (net: number) => addressKey(canonicalAddress(`2001:db8:2:${net.toString(16)}::1`)!);

  it('the aggregate of a key: its /48 for IPv6, none for IPv4', () => {
    expect(aggregateKey('6:2001:db8:1:2')).toBe('6/48:2001:db8:1');
    expect(aggregateKey(v6(7))).toBe('6/48:2001:db8:1');
    expect(aggregateKey(v6(7))).toBe(aggregateKey(v6(9, 5)));
    expect(aggregateKey(other48(7))).not.toBe(aggregateKey(v6(7)));
    expect(aggregateKey('4:203.0.113.7')).toBeNull();
    expect(aggregateKey('')).toBeNull();
  });

  it('open sockets: 8 per /64 and 128 per /48, however many /64s it comes from; another /48 and IPv4 are not affected; a closed socket gives its place back', () => {
    const g = new SocketGuard(5_000);
    let t = 0;
    // 16 /64s of 8 sockets each: 128 in the /48 (each key's new-socket burst of 10 and the aggregate's 160 are not met)
    for (let net = 0; net < 16; net++) for (let i = 0; i < 8; i++) expect(g.admit(v6(net), t), `${net}/${i}`).toBeNull();
    expect(g.admit(v6(16), t)).toBe('sockets');
    expect(g.admit(other48(0), t)).toBeNull();
    expect(g.admit('4:203.0.113.9', t)).toBeNull();
    g.release(v6(3));
    expect(g.admit(v6(16), t)).toBeNull();
    expect(g.admit(v6(17), t)).toBe('sockets');
    // everything given back: the /48 is free again
    for (let net = 0; net < 16; net++) if (net !== 3) for (let i = 0; i < 8; i++) g.release(v6(net));
    g.release(v6(3));
    g.release(v6(3));
    for (let i = 0; i < 7; i++) g.release(v6(3));
    g.release(v6(16));
    t += 60_000;
    expect(g.admit(v6(30), t)).toBeNull();
  });

  it('new sockets: 16 a second per /48 (burst 160) across its /64s', () => {
    const g = new SocketGuard(5_000);
    let admitted = 0;
    for (let net = 0; net < 40; net++) {
      for (let i = 0; i < 8; i++) {
        if (g.admit(v6(net), 0) === null) {
          admitted++;
          g.release(v6(net)); // never more than one open: the rate is what is tested
        }
      }
    }
    expect(admitted).toBe(160);
    expect(g.admit(v6(99), 62)).toBe('sockets'); // 16 tokens a second: one comes back after 62.5 ms
    expect(g.admit(v6(99), 63)).toBeNull();
  });

  it('new sessions: 160 a burst and 16 times 5 a minute for a /48; one /64 keeps its own 10', () => {
    const g = new SessionGuard(100_000);
    let ok = 0;
    for (let net = 0; net < 40; net++) for (let i = 0; i < 6; i++) if (g.allow(v6(net), 0)) ok++;
    expect(ok).toBe(160);
    expect(g.allow(other48(1), 0)).toBe(true);
    expect(g.allow('4:203.0.113.9', 0)).toBe(true);
    // 12 s later the /48 has 16 tokens of 80 a minute / 60 x 12 = 16
    for (let i = 0; i < 16; i++) expect(g.allow(v6(50 + i), 12_000), `late ${i}`).toBe(true);
    expect(g.allow(v6(80), 12_000)).toBe(false);
  });

  it('join attempts: 16 a second (burst 80) for a /48; 160 failures in 10 minutes lock the whole /48 for 10 minutes, whichever /64 they came from', () => {
    const g = new JoinGuard();
    let t = 0;
    let passed = 0;
    for (let net = 0; net < 40; net++) for (let i = 0; i < 3; i++) if (g.check(`s${net}${i}`, v6(net), t) === null) passed++;
    expect(passed).toBe(80);
    expect(g.check('late', v6(41), t)).toBe('rate');
    expect(g.check('other', other48(1), t)).toBeNull();
    // failures: 9 each from 17 /64s (under each key's 10) are 153 in the /48; the 160th locks it
    t += 60_000;
    for (let net = 0; net < 17; net++) for (let i = 0; i < 9; i++) expect(g.fail(`f${net}-${i}`, v6(100 + net), t)).toBe(false);
    for (let i = 0; i < 9; i++) expect(g.fail(`g${i}`, v6(120), t), `failure ${154 + i}`).toBe(i >= 6);
    t += 1_000;
    expect(g.check('anyone', v6(200), t)).toBe('locked');
    expect(g.lockedFor('anyone', v6(200), t)).toBe(10 * 60_000 - 1_000);
    expect(g.check('somebody', other48(5), t)).toBeNull();
    expect(g.check('anyone', v6(200), t + 10 * 60_000)).toBeNull();
  });
});
