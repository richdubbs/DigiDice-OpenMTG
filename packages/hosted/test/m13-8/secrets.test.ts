/**
 * M13-8: a table's password never leaves the server except as the hash the tables layer keeps (design 4.3, 11): every frame the browsers received, every
 * log line, every metric and every row the store holds is scanned for each password a flow sent (right ones and wrong ones, in every escaping), and for
 * the table's hash and salt, which no browser may see either. A scan that finds nothing proves little unless it can find something: the passwords are
 * shown to have been sent, and the scan is shown to find a planted one. Normal traffic only.
 */
import { describe, expect, it } from 'vitest';
import { Browser, createTable, freshPeer, guest, settle, TEST_DECK } from '../m13-6/harness';
import { PasswordBusyError, ScryptPasswords } from '../../src/lobby';
import { CHEAP_SCRYPT, counterRandom, lobbyGateway, SEC, type LobbyRig } from './helpers';

/** The passwords of the flow, in forms that need escaping on the wire and in a log line. */
const RIGHT = ['tangerine-8841-ZQ', 'пароль-密码-🔑', 'say "hi" \\o/ now <b>&amp;'];
const WRONG = ['tangerine-8841-ZR', 'wrong guess one', 'пароль-密码-🔒', 'say "hi" \\o/ nope', 'x'.repeat(64), 'abcd-wxyz'];
const BAD = ['abc', 'a'.repeat(65), 'with\u0000nul', 'line\nbreak'];

/** The ways a password can appear in text: as is, JSON-escaped, URL-encoded, as hex and base64 of its UTF-8 bytes, and in capitals and lower case. */
function forms(secret: string): string[] {
  const bytes = Buffer.from(secret, 'utf8');
  return [...new Set([
    secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), bytes.toString('hex'), bytes.toString('base64'), secret.toLowerCase(), secret.toUpperCase(),
    secret.replace(/\\/g, '\\\\'),
  ])].filter((f) => f.length >= 4);
}

/** The secrets of `secrets` that occur in any of `texts`, in any form. */
function found(texts: readonly string[], secrets: readonly string[]): string[] {
  const hits: string[] = [];
  for (const s of secrets) for (const f of forms(s)) if (texts.some((t) => t.includes(f))) hits.push(`${JSON.stringify(s)} as ${JSON.stringify(f)}`);
  return hits;
}

/** A browser that records what it sends as well as what it receives. */
async function recording(t: LobbyRig, name: string, o: { peer?: string } = {}): Promise<{ b: Browser; sent: string[] }> {
  const b = Browser.connect(t, { peer: o.peer ?? freshPeer() });
  const sent: string[] = [];
  const send = b.client.send.bind(b.client);
  b.client.send = (m: object | string, binary?: boolean) => {
    sent.push(typeof m === 'string' ? m : JSON.stringify(m));
    send(m, binary);
  };
  await b.hello(name);
  return { b, sent };
}

describe('M13-8 passwords never leave: frames, logs, metrics, the store', () => {
  it('a whole flow: tables made with passwords, browsed, watched, joined with wrong and right passwords, refused, locked out', async () => {
    const t = lobbyGateway();
    const owner1 = await recording(t, 'Alice');
    const owner2 = await recording(t, 'Bob');
    const watcher = await recording(t, 'Watcher');
    const viewer = await recording(t, 'Viewer');
    const guesser = await recording(t, 'Guesser');
    const friend = await recording(t, 'Friend');
    const friend2 = await recording(t, 'Friend Two');
    const sentBy = [owner1, owner2, watcher, viewer, guesser, friend, friend2];

    expect(await watcher.b.cmd({ t: 'watchLobby', filter: { locked: true } })).toMatchObject({ ok: true });
    const one = await createTable(owner1.b, { title: 'Locked one', password: RIGHT[0] });
    const two = await createTable(owner2.b, { title: 'Locked two', password: RIGHT[1], format: 'standard' });
    t.clock.advance(SEC);
    t.lobby.tick(t.clock.now());
    expect(await viewer.b.cmd({ t: 'browse', filter: { locked: true }, sort: 'newest', page: 0 })).toMatchObject({ ok: true, total: 2 });

    // refused creates: the password is in the message, the reply must not be (the viewer sits nowhere, so the password is what is refused)
    for (const bad of BAD) {
      t.clock.advance(10 * SEC);
      expect(await viewer.b.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', password: bad, deck: TEST_DECK }), bad).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    }
    t.clock.advance(10 * SEC);
    expect(await viewer.b.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'private', password: RIGHT[2], deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badMessage' } });

    // wrong passwords, a missing one, a password for another table, then the right ones
    for (const wrong of WRONG) {
      expect(await guesser.b.cmd({ t: 'join', table: one.table, password: wrong, deck: TEST_DECK }), wrong).toMatchObject({ ok: false });
      t.clock.advance(SEC);
    }
    expect(await guesser.b.cmd({ t: 'join', table: two.table, password: RIGHT[0], deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badPassword' } });
    t.clock.advance(SEC);
    expect(await friend.b.cmd({ t: 'join', table: one.table, password: RIGHT[0], deck: TEST_DECK })).toMatchObject({ ok: true });
    expect(await friend2.b.cmd({ t: 'join', table: two.table, password: RIGHT[1], deck: TEST_DECK })).toMatchObject({ ok: true });
    // a lock-out: ten wrong passwords at the table that is still open
    const lock = await createTable(await guest(t, 'Carol'), { title: 'Locked three', password: RIGHT[2] });
    for (let i = 0; i < 10; i++) {
      await guesser.b.cmd({ t: 'join', table: lock.table, password: `lockout ${i} ${WRONG[0]}`, deck: TEST_DECK });
      t.clock.advance(SEC);
    }
    expect(await guesser.b.cmd({ t: 'join', table: lock.table, password: RIGHT[2], deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'rateLimited' } });
    // both ready checks run, one game starts: the rest of the traffic
    for (const who of [owner1, friend]) {
      await who.b.client.until(() => who.b.last('readyCheck') !== undefined);
      await who.b.cmd({ t: 'ready', start: who.b.last('readyCheck')!.start });
    }
    await settle(5);
    t.lobby.tick(t.clock.now());
    await settle(5);

    const secrets = [...RIGHT, ...WRONG, ...BAD, ...[...Array(10).keys()].map((i) => `lockout ${i} ${WRONG[0]}`)];
    const received = sentBy.flatMap((s) => s.b.client.frames);
    const sent = sentBy.flatMap((s) => s.sent);
    const rowsOf = async () => JSON.stringify([await t.store.tableRow(one.table), await t.store.tableRow(two.table), await t.store.tableRow(lock.table), await t.store.openTables()]);
    const store = await rowsOf();

    // the flow did send them: the scan is about something
    for (const p of [...RIGHT, ...WRONG]) expect(found(sent, [p]), `sent: ${p}`).not.toEqual([]);
    expect(received.length).toBeGreaterThan(30);
    expect(t.logger.lines.length).toBeGreaterThan(10);
    // and it finds a planted one
    expect(found([...received, `{"t":"notice","text":"the password is ${RIGHT[0]}"}`], RIGHT)).toHaveLength(1);

    // none of them is in anything that went out, was logged, counted or stored
    expect(found(received, secrets), 'frames').toEqual([]);
    expect(found(t.logger.lines, secrets), 'log lines').toEqual([]);
    expect(found([...t.metrics.values.keys(), ...[...t.metrics.values.values()].map(String), ...[...t.metrics.observations.keys()]], secrets), 'metrics').toEqual([]);
    expect(found([store], secrets), 'the store').toEqual([]);

    // the hash and the salt are the server's: no frame carries them
    const rows = await Promise.all([one.table, two.table, lock.table].map((id) => t.store.tableRow(id)));
    const hs = rows.flatMap((r) => (r?.passwordHash ? [r.passwordHash, r.passwordSalt!] : []));
    expect(hs.length).toBeGreaterThanOrEqual(4);
    for (const h of hs) {
      expect(received.some((f) => f.includes(h)), `a frame with ${h.slice(0, 8)}`).toBe(false);
      expect(t.logger.lines.some((l) => l.includes(h)), `a log line with ${h.slice(0, 8)}`).toBe(false);
    }
    // what a listing says of a locked table is a flag
    const listed = received.filter((f) => f.includes('"lobbyUpdate"') || f.includes('"tables"'));
    expect(listed.length).toBeGreaterThan(0);
    for (const f of listed) expect(f).not.toMatch(/passw|salt|hash/i);
  });

  it('the hook busy while a password is being checked: the join is answered busy, the log names the error and nothing else', async () => {
    const jobs: (() => void)[] = [];
    const derive = (input: Buffer) => new Promise<Buffer>((resolve) => jobs.push(() => resolve(Buffer.alloc(32, input.length))));
    const t = lobbyGateway({ passwords: new ScryptPasswords({ scrypt: CHEAP_SCRYPT, derive, concurrency: 1, queue: 0, random: counterRandom() }) });
    const owner = await recording(t, 'Alice');
    const creating = owner.b.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', password: RIGHT[0], deck: TEST_DECK });
    await settle(5);
    jobs.shift()!();
    const { table } = (await creating) as { table: string };
    const first = await recording(t, 'First');
    const second = await recording(t, 'Second');
    first.b.client.send({ t: 'join', id: 1, table, password: WRONG[1], deck: TEST_DECK });
    await settle(5);
    second.b.client.send({ t: 'join', id: 1, table, password: WRONG[2], deck: TEST_DECK });
    await second.b.client.until(() => second.b.replyTo(1) !== undefined);
    expect(second.b.replyTo(1)).toMatchObject({ ok: false, error: { code: 'busy' } });
    jobs.shift()!();
    await first.b.client.until(() => first.b.replyTo(1) !== undefined);
    expect(t.logger.lines.join('\n')).toContain(PasswordBusyError.name);
    const all = [owner, first, second].flatMap((s) => s.b.client.frames);
    expect(found([...all, ...t.logger.lines], [...RIGHT, WRONG[1]!, WRONG[2]!])).toEqual([]);
  });

  it('the scan knows its forms: a password is found as typed, JSON-escaped, URL-encoded, in hex and in base64, and not by what it merely resembles', () => {
    const p = 'say "hi" \\o/ now';
    for (const text of [`x ${p} y`, JSON.stringify({ text: p }), `?p=${encodeURIComponent(p)}`, Buffer.from(p).toString('hex'), Buffer.from(p).toString('base64'), p.toUpperCase()]) {
      expect(found([text], [p]), text).not.toEqual([]);
    }
    expect(found(['say hi o now'], [p])).toEqual([]);
    expect(found(['nothing'], ['abc'])).toEqual([]); // under 4 characters a form is too short to scan for
  });
});
