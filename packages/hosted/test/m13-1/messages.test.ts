/**
 * The hosted protocol's shapes (design 3.4): each client message's field list matches its type exactly (the gateway refuses other fields), the token
 * format (D6), the constants of design 3.1, and the deck shape shared with milestone 9.
 */
import { describe, expect, it } from 'vitest';
import type { OnlineDeck } from '@openmtg/server/online';
import type { DeckSubmission } from '@openmtg/net/server-kit';
import * as net from '@openmtg/net';
import {
  CLIENT_MESSAGE_FIELDS, CLOSE_PROTOCOL, CLOSE_REFUSED, CLOSE_REPLACED, CLOSE_STOPPING, CLOSE_VERSION, HOSTED_FORMATS, HOSTED_PROTOCOL, HOSTED_TOKEN,
  HOSTED_ERROR_CODES, HOSTED_TOKEN_BYTES, isHostedFormat, isHostedToken, LOBBY_FILTER_FIELDS, MAX_FRAME_BYTES, MAX_FRAME_DEPTH, NOTICE_KINDS,
  reportAttachmentsProblem, seatsAllowed, type HostedClientMessage, type HostedClientType, type HostedDeck, type HostedErrorCode, type HostedServerMessage,
  type LobbyFilter, type NoticeKind,
} from '@openmtg/hosted/api';
import { findFormat } from '@openmtg/cards';
import { commanderVariantOf } from '@openmtg/net/server-kit';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const pin = <T extends true>(_: T): void => {};

type Msg<K extends HostedClientType> = Extract<HostedClientMessage, { t: K }>;
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
type Fields<K extends HostedClientType> = (typeof CLIENT_MESSAGE_FIELDS)[K];
/** The field list of K names exactly the type's required keys and exactly its optional keys. */
type Exact<K extends HostedClientType> = Equal<RequiredKeys<Msg<K>>, Fields<K>['required'][number]> extends true
  ? Equal<Exclude<keyof Msg<K>, RequiredKeys<Msg<K>>>, Fields<K>['optional'][number]>
  : false;
type AllExact = { [K in HostedClientType]: Exact<K> }[HostedClientType];
pin<Equal<AllExact, true>>(true);
pin<Equal<keyof typeof CLIENT_MESSAGE_FIELDS, HostedClientType>>(true);
pin<Equal<(typeof LOBBY_FILTER_FIELDS)[number], keyof LobbyFilter>>(true);

// One decklist shape with milestone 9: the browser sends the same deck to its local server and to the hosted server.
pin<Equal<HostedDeck, OnlineDeck>>(true);
const toNet = (d: HostedDeck): DeckSubmission => d;
const fromNet = (d: DeckSubmission): HostedDeck => d;
void toNet;
void fromNet;

describe('M13-1: hosted protocol 1', () => {
  it('lists the fields of every client message (unknown fields are refused by the gateway)', () => {
    const types: HostedClientType[] = ['hello', 'browse', 'watchLobby', 'create', 'join', 'codes', 'queue', 'unqueue', 'ready', 'leave', 'act', 'vote', 'sync', 'chat', 'report', 'ping', 'spectate', 'history']; // history: M13-6
    expect(Object.keys(CLIENT_MESSAGE_FIELDS).sort()).toEqual([...types].sort());
    for (const t of types) {
      const f = CLIENT_MESSAGE_FIELDS[t];
      expect(f.required[0], t).toBe('t');
      const all = [...f.required, ...f.optional];
      expect(new Set(all).size, t).toBe(all.length);
      // every command but hello and ping has an id and gets one reply
      expect((f.required as readonly string[]).includes('id'), t).toBe(t !== 'hello' && t !== 'ping');
    }
    // the token never travels in anything but hello
    for (const t of types) if (t !== 'hello') expect([...CLIENT_MESSAGE_FIELDS[t].required, ...CLIENT_MESSAGE_FIELDS[t].optional]).not.toContain('token');
  });

  it('server messages carry no session token except welcome, and no full placements', () => {
    // A compile-time check: `result` placements are PublicPlacement (no session, account or deck fingerprint).
    type ResultPlacement = Extract<HostedServerMessage, { t: 'result' }>['placements'][number];
    pin<Equal<'session' extends keyof ResultPlacement ? true : false, false>>(true);
    pin<Equal<'deckHash' extends keyof ResultPlacement ? true : false, false>>(true);
    pin<Equal<'account' extends keyof ResultPlacement ? true : false, false>>(true);
    expect(true).toBe(true);
  });

  it('HOSTED_TOKEN: 32 bytes as 64 lowercase hex digits, nothing else', () => {
    const good = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);
    expect(good).toHaveLength(64);
    expect(isHostedToken(good)).toBe(true);
    expect(HOSTED_TOKEN.test(good)).toBe(true);
    expect(HOSTED_TOKEN_BYTES).toBe(32);
    const bad: unknown[] = [
      good.toUpperCase(), good.slice(1), `${good}0`, `${good.slice(0, 63)}g`, `${good}\n`, ` ${good.slice(1)}`, '0'.repeat(32), // net's 16-byte format
      null, undefined, 42, ['x'], { token: good },
    ];
    for (const b of bad) expect(isHostedToken(b), JSON.stringify(b)).toBe(false);
    // net's SESSION_TOKEN (16 bytes) is a different, shorter format and is not exported for reuse
    expect('SESSION_TOKEN' in net).toBe(false);
  });

  it('error codes and notice kinds are closed lists (metrics label values come from them)', () => {
    pin<Equal<(typeof HOSTED_ERROR_CODES)[number], HostedErrorCode>>(true);
    pin<Equal<(typeof NOTICE_KINDS)[number], NoticeKind>>(true);
    expect(HOSTED_ERROR_CODES).toContain('serverBusy');
    expect(new Set(HOSTED_ERROR_CODES).size).toBe(HOSTED_ERROR_CODES.length);
    expect(NOTICE_KINDS).toContain('capacityTimeout');
  });

  it('report attachments: listed kinds, the text rules, 64 KB in all; stored as text (jsonb would refuse JSON escapes of NUL)', () => {
    expect(reportAttachmentsProblem(undefined)).toBeNull();
    expect(reportAttachmentsProblem([{ kind: 'view', json: '{"turn":3}' }, { kind: 'settings', json: '{}' }])).toBeNull();
    // A JSON escape of NUL or of a lone surrogate is plain text here: accepted, because the attachment is stored as TEXT (api.ts ReportAttachment note).
    expect(reportAttachmentsProblem([{ kind: 'client', json: '{"x":"\\u0000\\ud800"}' }])).toBeNull();
    const bad: unknown[] = [
      [{ kind: 'view', json: '{"x":"\u0000"}' }], // a literal NUL
      [{ kind: 'view', json: 'a\ud800' }], // a literal lone surrogate
      [{ kind: 'view', json: '\u202e' }],
      [{ kind: 'log', json: '{}' }], [{ kind: 'view', json: {} }], [{ kind: 'view', json: '{}', extra: 1 }], [null], 'x', {},
      Array.from({ length: 5 }, () => ({ kind: 'view', json: '{}' })),
      [{ kind: 'view', json: 'x'.repeat(40_000) }, { kind: 'settings', json: 'y'.repeat(30_000) }],
    ];
    for (const b of bad) expect(reportAttachmentsProblem(b), JSON.stringify(b)?.slice(0, 60)).not.toBeNull();
  });

  it('constants of design 3.1', () => {
    expect(HOSTED_PROTOCOL).toBe(1);
    expect(MAX_FRAME_BYTES).toBe(256 * 1024);
    expect(MAX_FRAME_DEPTH).toBe(24);
    expect([CLOSE_REPLACED, CLOSE_PROTOCOL, CLOSE_STOPPING, CLOSE_REFUSED, CLOSE_VERSION]).toEqual([4001, 4002, 4003, 4004, 4005]);
  });

  it('formats: every hosted format is a format of the cards package; pods exactly in the Free-for-All Commander formats (Duel Commander is 1v1)', () => {
    expect(HOSTED_FORMATS.map((f) => f.id)).toEqual(['standard', 'pioneer', 'modern', 'pauper', 'legacy', 'vintage', 'casual', 'duel', 'commander', 'brawl', 'standardbrawl']);
    for (const f of HOSTED_FORMATS) {
      expect(findFormat(f.id)?.id, f.id).toBe(f.id);
      if (f.pods) expect(commanderVariantOf(f.id), f.id).not.toBeNull();
    }
    expect(HOSTED_FORMATS.filter((f) => f.pods).map((f) => f.id)).toEqual(['commander', 'brawl', 'standardbrawl']);
    expect(seatsAllowed('commander', true)).toEqual([2, 3, 4]);
    expect(seatsAllowed('commander', false)).toEqual([2]);
    expect(seatsAllowed('duel', true)).toEqual([2]);
    expect(isHostedFormat('historic')).toBe(false);
    expect(isHostedFormat('__proto__')).toBe(false);
  });
});
