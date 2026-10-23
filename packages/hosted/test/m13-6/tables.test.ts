/**
 * M13-6: tables before the start (design 4.1, 4.3 codes, 4.4), through the gateway on a fake runtime and a fake clock: private tables with one hashed
 * invite code per seat (create, join, spent, New codes), listed tables and their passwords (never sent, never stored but as a hash), one table per session,
 * two unstarted tables per address key, MAX_LOBBY and MAX_LISTED, leaving, the 5-minute expiry, lobby chat, the listing, name and title moderation, deck
 * refusals, and what a table message may carry.
 */
import { describe, expect, it } from 'vitest';
import { CLOSE_PROTOCOL, type LobbyListing } from '../../src/api';
import { inviteHash } from '../../src/tables/codes';
import { METRICS } from '../../src/obs';
import { normalizeJoinCode } from '@openmtg/net/server-kit';
import type { DeckResult } from '../../src/runtime/api';
import { MemoryStore } from '../../src/store';
import { Browser, counted, createTable, FakePasswords, freshPeer, guest, makeGateway, ScriptedAdmission, settle, slowStore, startTable, TEST_DECK } from './harness';

const MIN = 60_000;
const BAD_DECK = { main: [{ name: 'Bad Card', count: 60 }], sideboard: [] };
const CODE_FORMAT = /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/;
const POD_ENV = { PODS_ENABLED: '1' };

describe('M13-6 private tables: one hashed invite code per open seat (design 4.3)', () => {
  it('create: the creator sits at seat 1 and gets the codes once; the server keeps only their hash; the table message carries no secret', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    const r = await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'private', deck: TEST_DECK });
    expect(r).toMatchObject({ ok: true });
    const { table, codes } = r as { table: string; codes: string[] };
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatch(CODE_FORMAT);
    // what the creator is told about the table
    const view = a.last('table')!.table;
    expect(Object.keys(view).sort()).toEqual(['clock', 'createdAt', 'creator', 'format', 'locked', 'seats', 'source', 'status', 'table', 'title', 'variant', 'you']);
    expect(view).toMatchObject({ table, title: "Alice's table", format: 'casual', source: 'private', status: 'lobby', locked: false, you: 1, creator: 1 });
    expect(view.seats).toEqual([
      { seat: 1, name: 'Alice', connected: true, deckAccepted: true, ready: false, left: false },
      { seat: 2, name: null, connected: false, deckAccepted: false, ready: false, left: false },
    ]);
    // what the server keeps
    const row = (await t.store.tableRow(table))!;
    expect(row).toMatchObject({ id: table, status: 'lobby', source: 'private', seats: 2, passwordHash: null, passwordSalt: null });
    expect(row.seatRows[0]).toMatchObject({ seat: 1, session: a.session, name: 'Alice', deck: TEST_DECK, inviteHash: null });
    expect(row.seatRows[0]!.deckHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.seatRows[1]).toMatchObject({ seat: 2, session: null, deck: null, inviteHash: inviteHash(normalizeJoinCode(codes[0]!)!) });
    const plain = normalizeJoinCode(codes[0]!)!;
    expect(JSON.stringify(row)).not.toContain(plain);
    expect(JSON.stringify(row)).not.toContain(codes[0]!);
    expect(t.logger.lines.join('\n')).not.toContain(plain);
    expect(t.gateway.tables.listings()).toEqual([]); // a private table is never listed
  });

  it('join by code: typed in any case, with spaces or dashes; both seats are told; the code is spent (also in the store)', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const { table, codes } = await createTable(a, { visibility: 'private' });
    const typed = codes[0]!.toLowerCase().replace(/-/g, ' ');
    const j = await b.cmd({ t: 'join', code: typed, deck: TEST_DECK });
    expect(j).toMatchObject({ ok: true, table });
    expect(b.last('table')!.table).toMatchObject({ you: 2, source: 'private' });
    // full: a ready check starts for both and the creator sees who sat down
    await a.client.until(() => a.last('readyCheck') !== undefined && b.last('readyCheck') !== undefined);
    expect(a.last('table')!.table.seats.map((s) => s.name)).toEqual(['Alice', 'Bob']);
    expect(a.last('readyCheck')!.players).toEqual([{ seat: 1, name: 'Alice', ready: false }, { seat: 2, name: 'Bob', ready: false }]);
    const row = (await t.store.tableRow(table))!;
    expect(row.seatRows[1]).toMatchObject({ session: b.session, name: 'Bob', inviteHash: null, deck: TEST_DECK });
    // spent
    expect(await c.cmd({ t: 'join', code: codes[0]!, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badCode' } });
  });

  it('a wrong code, a malformed code and a code for a taken seat are badCode; none of them says which', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const { codes } = await createTable(a, { visibility: 'private' });
    t.clock.advance(1_000);
    for (const code of ['AAAA-BBBB-CCCC-DDDD', 'not a code', codes[0]!.replace(/.$/, (x) => (x === '2' ? '3' : '2'))]) {
      const r = await b.cmd({ t: 'join', code, deck: TEST_DECK });
      expect(r, code).toMatchObject({ ok: false, error: { code: 'badCode', message: 'That invite code is not valid (or its seat is taken).' } });
      t.clock.advance(1_000);
    }
  });

  it('`codes`: New codes for the open seats replace the old ones; only the creator of a private table, only before the start', async () => {
    const t = makeGateway({ env: POD_ENV });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const { table, codes } = await createTable(a, { format: 'commander', seats: 3, visibility: 'private' });
    expect(codes).toHaveLength(2);
    expect(new Set(codes).size).toBe(2);
    // each code opens its own seat: the second code is seat 3
    expect(await b.cmd({ t: 'join', code: codes[1]!, deck: TEST_DECK })).toMatchObject({ ok: true });
    expect(a.last('table')!.table.seats.map((s) => s.name)).toEqual(['Alice', null, 'Bob']);
    expect(b.last('table')!.table.you).toBe(3);
    // the creator asks again: only the open seat (2) gets a new code; the old one stops working
    t.clock.advance(10_000);
    const fresh = (await a.cmd({ t: 'codes' })) as { ok: true; codes: string[] };
    expect(fresh).toMatchObject({ ok: true, table });
    expect(fresh.codes).toHaveLength(1);
    expect(fresh.codes[0]).toMatch(CODE_FORMAT);
    expect(fresh.codes[0]).not.toBe(codes[0]);
    expect(await c.cmd({ t: 'join', code: codes[0]!, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badCode' } });
    // not the creator, not at a table, not a listed table
    expect(await b.cmd({ t: 'codes' })).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    expect(await c.cmd({ t: 'codes' })).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    t.clock.advance(1_000);
    expect(await c.cmd({ t: 'join', code: fresh.codes[0]!, deck: TEST_DECK })).toMatchObject({ ok: true });
    // after the table is full, nothing to renew
    t.clock.advance(10_000);
    expect(await a.cmd({ t: 'codes' })).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    const d = await guest(t, 'Dora');
    const listed = await createTable(d, { visibility: 'listed' });
    t.clock.advance(10_000);
    expect(await d.cmd({ t: 'codes' })).toMatchObject({ ok: false, error: { code: 'notAllowed', message: 'Only private tables have invite codes.' } });
    expect(listed.codes).toEqual([]);
  });

  it('pods are not open until PODS_ENABLED; a two-player format cannot have 3 seats', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    expect(await a.cmd({ t: 'create', format: 'commander', seats: 3, visibility: 'private', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'notYet' } });
    t.clock.advance(10_000);
    expect(await a.cmd({ t: 'create', format: 'casual', seats: 3, visibility: 'private', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    const h = makeGateway({ env: { ...POD_ENV, HOSTED_FORMATS: 'casual,commander' } });
    const b = await guest(h, 'Bob');
    expect(await b.cmd({ t: 'create', format: 'casual', seats: 3, visibility: 'private', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    h.clock.advance(10_000);
    expect(await b.cmd({ t: 'create', format: 'brawl', seats: 2, visibility: 'private', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'notAllowed', message: 'This server does not offer that format.' } });
  });
});

describe('M13-6 listed tables and their passwords (design 4.2, 4.3)', () => {
  it('a listed table is in the listing with what the browser shows; titles are collapsed and checked', async () => {
    const sink: [string, LobbyListing | null][] = [];
    const s = makeGateway({ listings: { changed: (table, listing) => sink.push([table, listing]) } });
    const a = await guest(s, 'Alice');
    const { table } = await createTable(a, { title: '  Game    night  ' });
    const listing = s.gateway.tables.listings();
    expect(listing).toEqual([{
      table, title: 'Game night', format: 'casual', variant: null, seats: 2, filled: 1, locked: false,
      clock: { bankMs: 15 * MIN, delayMs: 5_000, dropMs: 5 * MIN }, creator: 'Alice', ranked: false, createdAt: expect.any(Number),
    }]);
    expect(sink).toEqual([[table, listing[0]]]);
    // a default title; too short, too long, with control characters
    const b = await guest(s, 'Bob');
    expect((await createTable(b)).table).toBeTruthy();
    expect(s.gateway.tables.listings().map((l) => l.title)).toEqual(['Game night', "Bob's table"]);
    const c = await guest(s, 'Carol');
    for (const title of ['ab', 'x'.repeat(61), 'Bad\u0000title', 'Bad‮title', '   ']) {
      s.clock.advance(10_000);
      expect(await c.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', title, deck: TEST_DECK }), JSON.stringify(title)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    }
  });

  it('a listing sink that throws (code of another package) never stops a table command; the failures are logged', async () => {
    const t = makeGateway({ listings: { changed: () => { throw new Error('the index broke'); } } });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const { table } = await createTable(a);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    expect(a.client.closed).toBeNull();
    expect(b.client.closed).toBeNull();
    // a ready check that runs out changes the listing too
    t.clock.advance(30_000);
    t.gateway.tables.tick();
    await settle(5);
    expect(a.of('notice').map((n) => n.kind)).toEqual(['readyCheckFailed', 'tableClosed']);
    expect(t.logger.entries().filter((e) => e['event'] === 'listingSinkError').length).toBeGreaterThanOrEqual(4);
    expect(t.logger.lines.join('\n')).not.toContain('the index broke');
  });

  it('a password needs the password hook; it is checked by it, never sent, never logged, never stored as text', async () => {
    const none = makeGateway();
    const x = await guest(none, 'Xavier');
    expect(await x.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'notYet' } });

    const passwords = new FakePasswords();
    const t = makeGateway({ passwords });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    // a private table has codes, not passwords; short and long passwords are refused
    expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'private', password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    for (const pw of ['abc', 'x'.repeat(65), 'pass\u0000word']) {
      t.clock.advance(10_000);
      expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', password: pw, deck: TEST_DECK }), JSON.stringify(pw)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    }
    t.clock.advance(10_000);
    const { table } = await createTable(a, { password: 'open sesame' });
    expect(t.gateway.tables.listings()[0]).toMatchObject({ table, locked: true });
    expect(a.last('table')!.table.locked).toBe(true);
    // the player at the door: no password, a wrong one, the right one
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badPassword', message: 'That table needs a password.' } });
    t.clock.advance(1_000);
    expect(await b.cmd({ t: 'join', table, password: 'open sesame!', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badPassword', message: 'Wrong password.' } });
    t.clock.advance(1_000);
    expect(await b.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: true, table });
    // nothing anyone received, logged or stored holds it
    const everything = [a, b, c].flatMap((x) => x.client.frames).join('\n') + t.logger.lines.join('\n') + JSON.stringify(await t.store.tableRow(table));
    expect(everything).not.toContain('open sesame');
    const row = (await t.store.tableRow(table))!;
    expect(row.passwordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.passwordSalt).toMatch(/^[0-9a-f]{32}$/);
    expect(passwords.given).toEqual(['open sesame']);
  });

  it('a password hook that throws (a busy hasher) is answered busy; the connection, the table and the join attempts are as they were', async () => {
    class BusyError extends Error {
      override name = 'PasswordBusyError';
    }
    const passwords = new FakePasswords();
    let busy = false;
    const hook = {
      hash: async (pw: string) => {
        if (busy) throw new BusyError('the hasher is busy');
        return passwords.hash(pw);
      },
      verify: async (pw: string, h: string, salt: string) => {
        if (busy) throw new BusyError('the hasher is busy');
        return passwords.verify(pw, h, salt);
      },
    };
    const t = makeGateway({ passwords: hook });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    // creating a locked table while the hasher is busy: busy, nothing made, the connection stays, the same create works a moment later
    busy = true;
    expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy', retryAfterMs: 2_000 } });
    expect(a.client.closed).toBeNull();
    expect(t.gateway.tables.counts().lobby).toBe(0);
    expect(t.gateway.tables.seatOf(a.session)).toBeNull();
    busy = false;
    t.clock.advance(10_000);
    const { table } = await createTable(a, { password: 'open sesame' });
    // joining it while the hasher is busy: busy, the seat is not taken and it was not a failed attempt
    busy = true;
    for (let i = 0; i < 12; i++) {
      t.clock.advance(1_000);
      expect(await b.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK }), `attempt ${i}`).toMatchObject({ ok: false, error: { code: 'busy', retryAfterMs: 2_000 } });
    }
    expect(b.client.closed).toBeNull();
    expect(a.last('table')!.table.seats[1]!.name).toBeNull();
    expect(counted(t.metrics, METRICS.strikes)).toBe(0);
    busy = false;
    t.clock.advance(1_000);
    expect(await b.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: true, table }); // twelve failures of the hasher did not lock b out
    expect(t.logger.entries().filter((e) => e['event'] === 'passwordHookFailed')).toHaveLength(13);
  });

  it('the password hash and salt are deleted with the table: when its creator closes it, when it expires, when the server drains', async () => {
    const t = makeGateway({ passwords: new FakePasswords() });
    const lock = async (creator: Awaited<ReturnType<typeof guest>>, title: string) => {
      const { table } = await createTable(creator, { password: 'open sesame', title });
      expect(await t.store.tableRow(table)).toMatchObject({ passwordHash: expect.stringMatching(/^[0-9a-f]{64}$/), passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/) });
      return table;
    };
    const gone = { status: 'void', passwordHash: null, passwordSalt: null };
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const left = await lock(a, 'Locked one');
    const expired = await lock(b, 'Locked two');
    // the creator leaves
    expect(await a.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    await settle(5);
    expect(await t.store.tableRow(left)).toMatchObject(gone);
    // nobody comes for five minutes
    t.clock.advance(5 * MIN);
    t.gateway.tables.tick();
    await settle(5);
    expect(await t.store.tableRow(expired)).toMatchObject(gone);
    // the server drains
    const drained = await lock(c, 'Locked three');
    t.gateway.drain();
    await settle(5);
    expect(await t.store.tableRow(drained)).toMatchObject(gone);
    expect(await t.store.openTables()).toEqual([]);
  });

  it('listed tables are joined by id only: private, unknown, full and closed tables answer noTable or tableFull', async () => {
    const t = makeGateway({ env: POD_ENV });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const d = await guest(t, 'Dora');
    const priv = await createTable(a, { visibility: 'private' });
    expect(await b.cmd({ t: 'join', table: priv.table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'noTable' } });
    t.clock.advance(1_000);
    expect(await b.cmd({ t: 'join', table: '01HZZZZZZZZZZZZZZZZZZZZZZZ', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'noTable' } });
    const listed = await createTable(c);
    t.clock.advance(1_000);
    expect(await b.cmd({ t: 'join', table: listed.table, deck: TEST_DECK })).toMatchObject({ ok: true });
    // the two seats are taken now (a ready check runs): not open for players
    expect(await d.cmd({ t: 'join', table: listed.table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'tableFull' } });
  });

  it('two players asking for the last seat at once: one sits, the other is told the table is full', async () => {
    const t = makeGateway();
    t.runtime.prepareDelayMs = 20;
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const { table } = await createTable(a);
    const [rb, rc] = await Promise.all([b.cmd({ t: 'join', table, deck: TEST_DECK }), c.cmd({ t: 'join', table, deck: TEST_DECK })]);
    expect([rb.ok, rc.ok].sort()).toEqual([false, true]);
    const loser = rb.ok ? rc : rb;
    expect(loser).toMatchObject({ ok: false, error: { code: 'tableFull' } });
    expect(a.last('table')!.table.seats.filter((s) => s.name !== null)).toHaveLength(2);
  });
});

describe('M13-6 text from everywhere is kept as it was typed (the hosted text rules refuse bad characters; they do not rewrite)', () => {
  it('names, titles and chat in other scripts and with emoji arrive and are stored as typed; whitespace is collapsed, nothing else is changed', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Zoë  😀');
    expect(a.last('welcome')!.name).toBe('Zoë 😀');
    const { table } = await createTable(a, { title: '日本語の  テーブル' });
    expect(a.last('table')!.table.title).toBe('日本語の テーブル');
    expect(a.last('table')!.table.seats[0]!.name).toBe('Zoë 😀');
    expect(await a.cmd({ t: 'chat', text: '  héllo 🎲 مرحبا  ' })).toMatchObject({ ok: true });
    expect(a.of('chat').at(-1)).toEqual({ t: 'chat', from: 1, text: 'héllo 🎲 مرحبا' });
    const row = (await t.store.tableRow(table))!;
    expect(row).toMatchObject({ title: '日本語の テーブル' });
    expect(row.seatRows[0]!.name).toBe('Zoë 😀');
    expect(t.gateway.tables.listings()[0]).toMatchObject({ title: '日本語の テーブル', creator: 'Zoë 😀' });
  });

  it('no address of a client is stored (limits and the operational log only): not in the session row, not in the table rows', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice', { peer: '203.0.113.99' });
    const { table } = await createTable(a);
    const stored = JSON.stringify([await t.store.sessionByTokenHash((await import('../../src/gateway/ids')).sha256Hex(a.token)), await t.store.tableRow(table)]);
    expect(stored).not.toContain('203.0.113.99');
    expect(stored).not.toContain('4:203.0.113.99');
  });
});

describe('M13-6 decks: refused with the problems listed; nothing is created or taken', () => {
  it('create and join refuse a deck the deck pool rejects, with the problems; the seat stays open', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const r = await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: BAD_DECK });
    expect(r).toMatchObject({ ok: false, error: { code: 'deckRejected', message: 'The deck is not legal for this table.', details: ['Unknown card: Bad Card'] } });
    expect(t.gateway.tables.counts()).toMatchObject({ lobby: 0 });
    expect(await t.store.openTables()).toEqual([]);
    t.clock.advance(10_000);
    const { table } = await createTable(a);
    expect(await b.cmd({ t: 'join', table, deck: BAD_DECK })).toMatchObject({ ok: false, error: { code: 'deckRejected' } });
    expect(a.last('table')!.table.seats[1]!.name).toBeNull();
    t.clock.advance(1_000);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
  });

  it('a deck pool that is full or fails answers busy, and the seat is not held', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const { table } = await createTable(a);
    t.runtime.prepare = async (): Promise<DeckResult> => ({ ok: false, errors: [], warnings: [], busy: true });
    const r = await b.cmd({ t: 'join', table, deck: TEST_DECK });
    expect(r).toMatchObject({ ok: false, error: { code: 'busy', retryAfterMs: 2_000 } });
    t.runtime.prepare = async () => {
      throw new Error('deck pool is down');
    };
    t.clock.advance(1_000);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy' } });
    t.runtime.prepare = async (): Promise<DeckResult> => ({ ok: false, errors: [], warnings: [], timeout: true });
    t.clock.advance(1_000);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy', message: 'The deck check took too long; try again.' } });
    expect(a.last('table')!.table.seats[1]!.name).toBeNull();
  });
});

describe('M13-6 caps: one table per session, two unstarted per address key, MAX_LOBBY and MAX_LISTED (review 5)', () => {
  it('a session sits at one table at a time: creating or joining a second is busy; after leaving it may', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const first = await createTable(a);
    const other = await createTable(b);
    t.clock.advance(10_000);
    expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy' } });
    expect(await a.cmd({ t: 'join', table: other.table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy' } });
    // her own table is not hers to join either
    expect(await a.cmd({ t: 'join', table: first.table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy' } });
    // leaving closes her own table (she is its creator), and she may sit down elsewhere
    expect(await a.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(t.gateway.tables.has(first.table)).toBe(false);
    t.clock.advance(1_000);
    expect(await a.cmd({ t: 'join', table: other.table, deck: TEST_DECK })).toMatchObject({ ok: true });
  });

  it('a session matchmaking elsewhere may not sit down (the match service says it is busy)', async () => {
    const queued = new Set<string>();
    const t = makeGateway({ hooks: { match: { busy: (s) => queued.has(s), queue: async () => ({ ok: true }), unqueue: async () => null, ready: () => null } } });
    const a = await guest(t, 'Alice');
    queued.add(a.session);
    expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy' } });
    expect(await a.cmd({ t: 'queue', format: 'casual', size: 2, deck: TEST_DECK })).toMatchObject({ ok: true });
  });

  it('an address key may have two unstarted tables, whoever made them; the third is busy until one closes', async () => {
    const t = makeGateway();
    const peer = '203.0.113.60';
    const a = await guest(t, 'Alice', { peer });
    const b = await guest(t, 'Bob', { peer });
    const c = await guest(t, 'Carol', { peer });
    const d = await guest(t, 'Dora', { peer: freshPeer() });
    const first = await createTable(a);
    await createTable(b);
    expect(await c.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy', message: 'Your network already has two tables waiting for players.' } });
    // another network is not affected
    expect((await createTable(d)).table).toBeTruthy();
    // a table that closes frees the place
    expect(await a.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(t.gateway.tables.has(first.table)).toBe(false);
    t.clock.advance(10_000);
    expect((await createTable(c)).table).toBeTruthy();
  });

  it('a /48 may have 32 unstarted tables, from its /64s; the 33rd is busy, another /48 is not affected', async () => {
    const t = makeGateway();
    const guests = [];
    for (let net = 0; net < 33; net++) guests.push(await guest(t, `G${net}`, { peer: `2001:db8:1:${net.toString(16)}::1` }));
    for (let i = 0; i < 32; i++) expect((await createTable(guests[i]!)).table, `table ${i}`).toBeTruthy();
    expect(await guests[32]!.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy', message: 'Your network already has many tables waiting for players.' } });
    const elsewhere = await guest(t, 'Elsewhere', { peer: '2001:db8:2:0::1' });
    expect((await createTable(elsewhere)).table).toBeTruthy();
    expect(t.gateway.tables.counts().lobby).toBe(33);
  });

  it('the same limit holds for creates in flight together (the deck pool and the store are awaited between the check and the table)', async () => {
    const t = makeGateway({ store: slowStore(new MemoryStore(), 'createGame', 20) });
    t.runtime.prepareDelayMs = 20;
    const peer = '203.0.113.61';
    const guests = [await guest(t, 'A', { peer }), await guest(t, 'B', { peer }), await guest(t, 'C', { peer })];
    const results = await Promise.all(guests.map((g) => g.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK })));
    expect(results.map((r) => r.ok).sort()).toEqual([false, true, true]);
    expect(t.gateway.tables.counts().lobby).toBe(2);
    expect(await t.store.openTables()).toHaveLength(2);
  });

  it('MAX_LOBBY and MAX_LISTED count unstarted tables only: serverBusy for a network without a table, busy for one that has one', async () => {
    const t = makeGateway({ env: { MAX_LOBBY: '3', MAX_LISTED: '2' } });
    // a running game is counted separately from the lobby
    await startTable(t, ['Pat', 'Quinn']);
    const peerA = '203.0.113.70';
    const a = await guest(t, 'Alice', { peer: peerA });
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const d = await guest(t, 'Dora');
    const e = await guest(t, 'Eve', { peer: peerA });
    const f = await guest(t, 'Fay');
    await createTable(a);
    await createTable(b);
    // two listed tables: a third listed one is refused, a private one is not
    expect(await c.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'serverBusy', retryAfterMs: 60_000 } });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'listedFull' })).toBe(1);
    // a network that has a table gets busy instead (it can still play at the one it has)
    expect(await e.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy' } });
    t.clock.advance(10_000);
    expect((await createTable(c, { visibility: 'private' })).codes).toHaveLength(1);
    // three unstarted tables: the lobby is full for everyone else
    expect(await d.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'private', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'serverBusy' } });
    expect(await f.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'private', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'serverBusy' } });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'lobbyFull' })).toBe(2);
    expect(t.gateway.tables.counts()).toMatchObject({ lobby: 3, playing: 1 });
  });
});

describe('M13-6 leaving and expiry before the start (design 4.1, 4.4)', () => {
  it('a joiner who leaves opens the seat again; the creator who leaves closes the table (a notice, voided in the store, its code dead)', async () => {
    const admission = new ScriptedAdmission();
    const sink: [string, LobbyListing | null][] = [];
    const t = makeGateway({ admission, listings: { changed: (table, listing) => sink.push([table, listing]) } });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const { table } = await createTable(a);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    await a.client.until(() => a.last('readyCheck') !== undefined);
    // Bob leaves during the ready check: the seat opens, the table is open for players again
    t.clock.advance(1_000);
    expect(await b.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(admission.releases).toEqual([table]);
    expect(admission.releaseCauses).toEqual(['left']); // a stand-up is no ready-check failure (M13-10 counts only 'readyCheck')
    expect(a.last('table')!.table).toMatchObject({ status: 'lobby' });
    expect(a.last('table')!.table.seats.map((s) => s.name)).toEqual(['Alice', null]);
    expect(t.gateway.tables.listings()[0]).toMatchObject({ table, filled: 1 });
    expect(sink.at(-1)![1]).toMatchObject({ table, filled: 1 });
    const row = (await t.store.tableRow(table))!;
    expect(row.seatRows[1]).toMatchObject({ session: null, name: null, deck: null, deckHash: null });
    // Alice leaves: the table closes
    expect(await a.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(t.gateway.tables.has(table)).toBe(false);
    expect(t.gateway.tables.listings()).toEqual([]);
    expect(sink.at(-1)).toEqual([table, null]);
    await settle(5);
    expect((await t.store.tableRow(table))!.status).toBe('void');
    expect(await t.store.openTables()).toEqual([]);
    // Bob can sit elsewhere, and the closed table cannot be joined
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'noTable' } });
  });

  it('closing a table tells everyone who sat there; the invite codes of a closed table are dead', async () => {
    const t = makeGateway({ env: POD_ENV });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const { codes } = await createTable(a, { format: 'commander', seats: 3, visibility: 'private' });
    expect(await b.cmd({ t: 'join', code: codes[0]!, deck: TEST_DECK })).toMatchObject({ ok: true });
    t.clock.advance(1_000);
    expect(await a.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(b.of('notice').map((n) => n.kind)).toEqual(['tableClosed']);
    expect(await c.cmd({ t: 'join', code: codes[1]!, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badCode' } });
    // Bob is not left sitting at a table that is gone
    expect(t.gateway.tables.seatOf(b.session)).toBeNull();
    t.clock.advance(10_000);
    expect((await createTable(b)).table).toBeTruthy();
  });

  it('an unstarted table expires 5 minutes after the last join by another player; the creator\'s own actions do not extend it', async () => {
    const t = makeGateway({ env: POD_ENV });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const { table } = await createTable(a, { format: 'commander', seats: 3, visibility: 'private' });
    // Alice chats and asks for new codes at +4 minutes: nothing is extended
    t.clock.advance(4 * MIN);
    expect((await a.cmd({ t: 'chat', text: 'anyone?' })).ok).toBe(true);
    expect((await a.cmd({ t: 'codes' })).ok).toBe(true);
    t.clock.advance(MIN - 1);
    t.gateway.tables.tick();
    expect(t.gateway.tables.has(table)).toBe(true);
    t.clock.advance(1);
    t.gateway.tables.tick();
    expect(t.gateway.tables.has(table)).toBe(false);
    expect(a.of('notice').map((n) => n.kind)).toEqual(['tableExpired']);
    expect(a.of('notice')[0]!.text).toBe('The table expired: nobody joined for 5 minutes.');
    await settle(3);
    expect((await t.store.tableRow(table))!.status).toBe('void');
    // Another table: Bob joins at +2 minutes, which starts its 5 minutes again
    t.clock.advance(1_000);
    const second = await createTable(c, { format: 'commander', seats: 3, visibility: 'listed' });
    t.clock.advance(2 * MIN);
    expect(await b.cmd({ t: 'join', table: second.table, deck: TEST_DECK })).toMatchObject({ ok: true });
    t.clock.advance(5 * MIN - 1);
    t.gateway.tables.tick();
    expect(t.gateway.tables.has(second.table)).toBe(true);
    t.clock.advance(1);
    t.gateway.tables.tick();
    expect(t.gateway.tables.has(second.table)).toBe(false);
    expect(b.of('notice').map((n) => n.kind)).toEqual(['tableExpired']);
    // both may sit down again
    t.clock.advance(10_000);
    expect((await createTable(b)).table).toBeTruthy();
  });
});

describe('M13-6 chat at an unstarted table, moderation, and what is shown', () => {
  it('lobby chat goes to every seat with the speaker\'s seat; outside a table it is refused; bad text is badMessage', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const { table } = await createTable(a);
    expect(await c.cmd({ t: 'chat', text: 'hello?' })).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    expect(await a.cmd({ t: 'chat', text: '  hi there  ' })).toMatchObject({ ok: true });
    expect(a.of('chat')).toEqual([{ t: 'chat', from: 1, text: 'hi there' }]);
    expect(b.of('chat')).toEqual([]); // not seated yet
    expect(await a.cmd({ t: 'chat', text: 'bad\u0000text' })).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(await a.cmd({ t: 'chat', text: '   ' })).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(await a.cmd({ t: 'chat', text: 'x'.repeat(501) })).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    expect(await b.cmd({ t: 'chat', text: 'hi Alice' })).toMatchObject({ ok: true });
    expect(a.of('chat').map((m) => [m.from, m.text])).toEqual([[1, 'hi there'], [2, 'hi Alice']]);
    expect(b.of('chat').map((m) => [m.from, m.text])).toEqual([[2, 'hi Alice']]);
  });

  it('the word filter refuses names (the hello closes, 4002) and titles (notAllowed); a name the filter passes is unchanged', async () => {
    const t = makeGateway({
      moderation: {
        nameProblem: (n) => (n.toLowerCase().includes('badword') ? 'That name is not allowed here.' : null),
        titleProblem: (n) => (n.toLowerCase().includes('badword') ? 'That title is not allowed here.' : null),
      },
    });
    const bad = Browser.connect(t, { peer: freshPeer() });
    bad.client.send({ t: 'hello', protocol: 1, name: 'My BadWord name' });
    await bad.client.until(() => bad.client.closed !== null);
    expect(bad.client.closed).toMatchObject({ code: CLOSE_PROTOCOL });
    expect(bad.of('bye')[0]!.reason).toBe('That name is not allowed here.');
    const a = await guest(t, 'Alice');
    expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', title: 'badword table', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'notAllowed', message: 'That title is not allowed here.' } });
    t.clock.advance(10_000);
    expect((await createTable(a, { title: 'A fine table' })).table).toBeTruthy();
  });

  it('every message about a table carries only what a player may see: no session ids but your own, no decks, no hashes', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const { table } = await createTable(a);
    await b.cmd({ t: 'join', table, deck: TEST_DECK });
    await a.client.until(() => a.last('readyCheck') !== undefined);
    const row = (await t.store.tableRow(table))!;
    for (const [who, other] of [[a, b], [b, a]] as const) {
      const text = who.client.frames.join('\n');
      expect(text, 'the other session id').not.toContain(other.session);
      expect(text, 'the other token').not.toContain(other.token);
      for (const s of row.seatRows) expect(text, 'a deck fingerprint').not.toContain(s.deckHash!);
      expect(text, 'a decklist').not.toContain('"Forest"');
    }
  });
});

