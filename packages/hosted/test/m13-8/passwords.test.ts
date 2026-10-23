/**
 * M13-8: table passwords (design 4.3, 11): the scrypt hook on its own (right and wrong passwords, Unicode forms, the same work for every answer, the
 * bounded gate), then through the real gateway and tables (creating and joining a password table, the join-attempt limits and lock-outs with the real
 * hook, no lock-out of a table for others). Cheap scrypt settings except one test of the defaults; fixed inputs, a fake clock.
 */
import { timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HOSTED_LIMITS } from '../../src/api';
import { PASSWORD_KEY_BYTES, PasswordBusyError, PASSWORD_SALT_BYTES, scryptDerive, ScryptPasswords, TABLE_SCRYPT, type PasswordDerive } from '../../src/lobby';
import { createTable, freshPeer, guest, makeGateway, settle, TEST_DECK } from '../m13-6/harness';
import { CHEAP_SCRYPT, counterRandom, lobbyGateway, MIN, SEC } from './helpers';

/** The real cheap derivation and the real comparison, with a record of how often each ran and what the derivation was given. */
function counting() {
  const seen: { input: string; salt: string }[] = [];
  let compared = 0;
  const derive: PasswordDerive = (input, salt, s) => {
    seen.push({ input: input.toString('utf8'), salt: salt.toString('hex') });
    return scryptDerive(input, salt, s);
  };
  const equal = (a: Buffer, b: Buffer): boolean => {
    compared++;
    return timingSafeEqual(a, b);
  };
  return { derive, equal, seen, get compared() { return compared; } };
}

/** A derivation that waits to be told (its key is as long a run of one byte as the input is long, so passwords of other lengths differ): for the gate. */
function held() {
  const jobs: { input: string; resolve: () => void; reject: (e: Error) => void }[] = [];
  const derive: PasswordDerive = (input) =>
    new Promise((resolve, reject) => {
      jobs.push({ input: input.toString('utf8'), resolve: () => resolve(Buffer.alloc(PASSWORD_KEY_BYTES, input.length)), reject });
    });
  return { derive, jobs };
}

/** The real hook at the cheapest settings, its salts from a counter. */
const hook = (o: ConstructorParameters<typeof ScryptPasswords>[0] = {}) => new ScryptPasswords({ scrypt: CHEAP_SCRYPT, random: counterRandom(), ...o });

/** A stored hash and salt that are well formed and match no password. */
const HASH = '02'.repeat(32);
const SALT = 'a'.repeat(32);

describe('M13-8 the hook: hash and verify', () => {
  it('a right password verifies and a wrong one does not; case, spaces and look-alikes count', async () => {
    const p = hook();
    const { hash, salt } = await p.hash('Open Sesame');
    expect(await p.verify('Open Sesame', hash, salt)).toBe(true);
    for (const wrong of ['open sesame', 'Open Sesame ', ' Open Sesame', 'Open  Sesame', 'Open Sesam', 'Open Sesamee', 'Open Sesаme' /* a Cyrillic "а" */, '', '    ']) {
      expect(await p.verify(wrong, hash, salt), JSON.stringify(wrong)).toBe(false);
    }
  });

  it('the hash is 32 bytes and the salt 16, both hex; the same password gets another salt and so another hash each time', async () => {
    const p = hook();
    const a = await p.hash('same password');
    const b = await p.hash('same password');
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(PASSWORD_KEY_BYTES).toBe(32);
    expect(PASSWORD_SALT_BYTES).toBe(16);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await p.verify('same password', a.hash, a.salt)).toBe(true);
    // a hash only goes with its own salt
    expect(await p.verify('same password', a.hash, b.salt)).toBe(false);
    expect(await p.verify('same password', b.hash, a.salt)).toBe(false);
  });

  it('neither the hash nor the salt holds the password, in any form', async () => {
    const p = hook();
    const password = 'correct horse battery';
    const { hash, salt } = await p.hash(password);
    const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');
    for (const form of [password, password.toLowerCase(), hex(password), Buffer.from(password).toString('base64')]) {
      expect(hash).not.toContain(form);
      expect(salt).not.toContain(form);
    }
  });

  it('the limits of a table password: 4 characters, 64 characters, 64 characters of two UTF-16 units each', async () => {
    const p = hook();
    for (const pw of ['abcd', 'a'.repeat(64), '🔥'.repeat(64), '密码密码', 'пароль', ' with spaces ', '    ']) {
      const { hash, salt } = await p.hash(pw);
      expect(await p.verify(pw, hash, salt), JSON.stringify(pw).slice(0, 20)).toBe(true);
    }
    expect(HOSTED_LIMITS.passwordMin).toBe(4);
    expect(HOSTED_LIMITS.passwordMax).toBe(64);
  });

  it('the same password typed in another Unicode form is the same password (NFKC); a different one is not', async () => {
    const p = hook();
    const { hash, salt } = await p.hash('Café déjà vu 123');
    const nfd = 'Café déjà vu 123'.normalize('NFD');
    expect(nfd).not.toBe('Café déjà vu 123');
    expect(await p.verify(nfd, hash, salt)).toBe(true);
    expect(await p.verify('Café déjà vu 123'.normalize('NFC'), hash, salt)).toBe(true);
    expect(await p.verify('Cafe déjà vu 123', hash, salt)).toBe(false);
    const wide = await p.hash('ＡＢＣ１２３');
    expect(await p.verify('ABC123', wide.hash, wide.salt)).toBe(true);
  });

  it('the longest password typed in a longer form is still the same password: the bound is on what is compared (M13-8 review, finding 3)', async () => {
    const p = hook();
    const pw = '각'.repeat(HOSTED_LIMITS.passwordMax);
    const { hash, salt } = await p.hash(pw);
    const nfd = pw.normalize('NFD');
    expect(nfd.length).toBe(3 * HOSTED_LIMITS.passwordMax); // 192 UTF-16 units as typed, 64 once compared
    expect(await p.verify(nfd, hash, salt)).toBe(true);
    // what is too long once normalized is still no password, however it was typed
    expect(await p.verify(`${pw}각`.normalize('NFD'), hash, salt)).toBe(false);
    expect(await p.verify('x'.repeat(10_000), hash, salt)).toBe(false);
  });

  it('hash refuses what is not a table password (a bug in its caller), with an error that holds no password', async () => {
    const p = hook();
    for (const bad of ['abc', '', 'a'.repeat(65), 'nul\u0000nul', 'bidi‮!', 'lone\ud800surrogate', 'new\nline', 42, null, undefined, { password: 'secretpass' }]) {
      const e = await p.hash(bad as string).then(() => null, (err: Error) => err);
      expect(e, JSON.stringify(bad)).toBeInstanceOf(RangeError);
      if (typeof bad === 'string' && bad.length >= 3) expect((e as Error).message).not.toContain(bad);
    }
  });

  it('settings: the defaults are scrypt N=2^15, r=8, p=1; the settings are checked; with the defaults a derivation really runs (memory limit included)', async () => {
    expect(TABLE_SCRYPT).toEqual({ ln: 15, r: 8, p: 1 });
    for (const bad of [{ ln: 3 }, { ln: 21 }, { r: 0 }, { r: 33 }, { p: 0 }, { p: 17 }, { ln: 15.5 }]) expect(() => new ScryptPasswords({ scrypt: { ...TABLE_SCRYPT, ...bad } })).toThrow(RangeError);
    for (const bad of [{ concurrency: 0 }, { concurrency: 1.5 }, { queue: -1 }]) expect(() => new ScryptPasswords(bad)).toThrow(RangeError);
    const p = new ScryptPasswords();
    const { hash, salt } = await p.hash('defaults work');
    expect(await p.verify('defaults work', hash, salt)).toBe(true);
    expect(await p.verify('defaults wrong', hash, salt)).toBe(false);
  }, 60_000);
});

describe('M13-8 the same work whatever the answer', () => {
  it('a right password, a wrong one, a damaged hash, a damaged salt, a text no password can be and a non-string each cost exactly one derivation and one comparison', async () => {
    const c = counting();
    const p = hook({ derive: c.derive, equal: c.equal });
    const { hash, salt } = await p.hash('the password');
    expect(c.seen).toHaveLength(1);
    const cases: [string, unknown, unknown, unknown, boolean][] = [
      ['right', 'the password', hash, salt, true],
      ['wrong', 'the passwore', hash, salt, false],
      ['hash not hex', 'the password', 'z'.repeat(64), salt, false],
      ['hash too short', 'the password', hash.slice(0, 62), salt, false],
      ['hash too long', 'the password', `${hash}00`, salt, false],
      ['hash upper-case', 'the password', hash.toUpperCase(), salt, false],
      ['hash empty', 'the password', '', salt, false],
      ['hash missing', 'the password', null, salt, false],
      ['salt not hex', 'the password', hash, 'q'.repeat(32), false],
      ['salt too short', 'the password', hash, salt.slice(0, 30), false],
      ['salt empty', 'the password', hash, '', false],
      ['salt missing', 'the password', hash, undefined, false],
      ['text too long for a password', 'x'.repeat(129), hash, salt, false],
      ['a megabyte', 'x'.repeat(1_000_000), hash, salt, false],
      ['not text', 12345, hash, salt, false],
      ['nothing', undefined, hash, salt, false],
      ['everything damaged', 'the password', 'nope', 'nope', false],
    ];
    for (const [why, password, h, s, expected] of cases) {
      const before = { derived: c.seen.length, compared: c.compared };
      const answer = await p.verify(password as string, h as string, s as string);
      expect(answer, why).toBe(expected);
      expect(c.seen.length - before.derived, `${why}: derivations`).toBe(1);
      expect(c.compared - before.compared, `${why}: comparisons`).toBe(1);
    }
  });

  it('a row that cannot be a real one never accepts, even when the derivation happens to come out as the dummy key (the answer is decided by the row, not by luck)', async () => {
    const same = Buffer.alloc(PASSWORD_KEY_BYTES, 7);
    const p = new ScryptPasswords({ scrypt: CHEAP_SCRYPT, derive: async () => same, random: (n) => Buffer.alloc(n, 7) });
    expect(await p.verify('anything', '07'.repeat(32), '0a'.repeat(16))).toBe(true); // a well-formed row whose key is what the derivation gives
    for (const [why, hash, salt] of [['hash', 'nope', '0a'.repeat(16)], ['salt', '07'.repeat(32), 'nope'], ['both', null, null], ['hash short', '07'.repeat(31), '0a'.repeat(16)]] as const) {
      expect(await p.verify('anything', hash as string, salt as string), why).toBe(false);
    }
  });

  it('a text too long to be a password never accepts, even against the hash of the empty text it is derived as', async () => {
    const p = hook();
    const empty = await scryptDerive(Buffer.alloc(0), Buffer.alloc(PASSWORD_SALT_BYTES, 9), CHEAP_SCRYPT);
    const row = [empty.toString('hex'), Buffer.alloc(PASSWORD_SALT_BYTES, 9).toString('hex')] as const;
    expect(await p.verify('', ...row)).toBe(true); // (no table has this password: hash refuses it)
    expect(await p.verify('x'.repeat(129), ...row)).toBe(false);
    expect(await p.verify('x'.repeat(5_000), ...row)).toBe(false);
    expect(await p.verify(42 as unknown as string, ...row)).toBe(false);
  });

  it('a damaged row derives against a salt of its own and never against the password as the key', async () => {
    const c = counting();
    const p = hook({ derive: c.derive });
    await p.verify('visible', 'not a hash', 'not a salt');
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]!.salt).toMatch(/^[0-9a-f]{32}$/);
    // a text no password can be is derived as nothing, not as the megabyte it is
    await p.verify('x'.repeat(5_000), 'a'.repeat(64), 'b'.repeat(32));
    expect(c.seen[1]!.input).toBe('');
  });

  it('a verify never throws for the data it is given', async () => {
    const p = hook();
    for (const x of [undefined, null, 0, {}, [], 'a'.repeat(10_000), '\ud800', '\u0000']) {
      await expect(p.verify(x as string, x as string, x as string), JSON.stringify(x)?.slice(0, 20)).resolves.toBe(false);
    }
  });
});

describe('M13-8 bounded work: at most `concurrency` derivations at once, `queue` waiting, then PasswordBusyError', () => {
  it('two run, the next wait in order, the one past the queue is refused at once with an error that holds no password', async () => {
    const h = held();
    const p = new ScryptPasswords({ scrypt: CHEAP_SCRYPT, derive: h.derive, concurrency: 2, queue: 3 });
    const results: string[] = [];
    const ask = (pw: string) => p.verify(pw, HASH, SALT).then((ok) => results.push(`${pw}:${ok}`), (e: Error) => results.push(`${pw}:${e.name}`));
    const all = ['one', 'two', 'three', 'four', 'five'].map(ask);
    await settle(3);
    expect(h.jobs.map((j) => j.input)).toEqual(['one', 'two']);
    expect(p.load()).toEqual({ running: 2, waiting: 3 });
    const refused = ask('six');
    await refused;
    expect(results).toEqual(['six:PasswordBusyError']);
    expect(new PasswordBusyError().message).toBe('Too many password checks at once.');
    h.jobs[0]!.resolve();
    await settle(3);
    expect(h.jobs.map((j) => j.input)).toEqual(['one', 'two', 'three']);
    h.jobs[1]!.resolve();
    h.jobs[2]!.resolve();
    await settle(3);
    expect(h.jobs.map((j) => j.input)).toEqual(['one', 'two', 'three', 'four', 'five']);
    h.jobs[3]!.resolve();
    h.jobs[4]!.resolve();
    await Promise.all(all);
    expect(results.slice(1).sort()).toEqual(['five:false', 'four:false', 'one:false', 'three:false', 'two:false']);
    expect(p.load()).toEqual({ running: 0, waiting: 0 });
    // the room is back
    const later = ask('seven');
    await settle(3);
    h.jobs.at(-1)!.resolve();
    await later;
    expect(results.at(-1)).toBe('seven:false');
  });

  it('a derivation that fails gives its slot back and the error is the derivation\'s own', async () => {
    const h = held();
    const p = new ScryptPasswords({ scrypt: CHEAP_SCRYPT, derive: h.derive, concurrency: 1, queue: 1 });
    const first = p.verify('first', HASH, SALT).catch((e: Error) => e);
    const second = p.verify('second', HASH, SALT);
    await settle(3);
    h.jobs[0]!.reject(new Error('scrypt failed'));
    expect(await first).toMatchObject({ message: 'scrypt failed' });
    await settle(3);
    expect(h.jobs.map((j) => j.input)).toEqual(['first', 'second']);
    h.jobs[1]!.resolve();
    expect(await second).toBe(false);
    expect(p.load()).toEqual({ running: 0, waiting: 0 });
  });

  it('a queue of 0 refuses whatever cannot start at once; the defaults are 2 at once and 256 waiting', async () => {
    const h = held();
    const none = new ScryptPasswords({ scrypt: CHEAP_SCRYPT, derive: h.derive, concurrency: 1, queue: 0 });
    void none.verify('a', HASH, SALT);
    await expect(none.verify('b', HASH, SALT)).rejects.toBeInstanceOf(PasswordBusyError);
    const d = held();
    const defaults = new ScryptPasswords({ scrypt: CHEAP_SCRYPT, derive: d.derive });
    const pending = Array.from({ length: 258 }, (_, i) => defaults.verify(`pw${i}`, HASH, SALT).catch((e: Error) => e.name));
    await settle(3);
    expect(defaults.load()).toEqual({ running: 2, waiting: 256 });
    await expect(defaults.verify('one more', HASH, SALT)).rejects.toBeInstanceOf(PasswordBusyError);
    void pending;
  });
});

describe('M13-8 password tables through the gateway', () => {
  it('a password is 4 to 64 characters of text, only for a listed table, and only where the server has the hook', async () => {
    const t = lobbyGateway();
    const a = await guest(t, 'Alice');
    const create = async (extra: Record<string, unknown>) => {
      const r = await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK, ...extra });
      t.clock.advance(10 * SEC);
      return r;
    };
    for (const [why, password] of [['too short', 'abc'], ['too long', 'a'.repeat(65)], ['NUL', 'pass\u0000word'], ['a control character', 'pass\nword'], ['a lone surrogate', 'pass\ud800word'], ['empty', '']] as const) {
      expect(await create({ password }), why).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    }
    expect(await create({ visibility: 'private', password: 'a fine password' })).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(t.gateway.tables.counts().lobby).toBe(0);
    expect(await create({ password: 'abcd' })).toMatchObject({ ok: true });
  });

  it('a server without the hook says so (notYet) and makes no table', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', password: 'some password', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'notYet' } });
    expect(t.gateway.tables.counts().lobby).toBe(0);
  });

  it('the table keeps the hash and the salt, not the password; the listing says locked', async () => {
    const t = lobbyGateway();
    const a = await guest(t, 'Alice');
    const { table } = await createTable(a, { password: 'my very secret table' });
    const row = (await t.store.tableRow(table))!;
    expect(row.passwordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.passwordSalt).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain('my very secret table');
    expect(t.lobby.index.get(table)).toMatchObject({ locked: true });
    expect(await t.passwords.verify('my very secret table', row.passwordHash!, row.passwordSalt!)).toBe(true);
  });

  it('joining: the right password sits you down; a wrong or missing one is badPassword and leaves the seat open; an unlocked table needs none', async () => {
    const t = lobbyGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const { table } = await createTable(a, { password: 'open sesame' });
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badPassword', message: 'That table needs a password.' } });
    t.clock.advance(SEC);
    expect(await b.cmd({ t: 'join', table, password: 'Open Sesame', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badPassword', message: 'Wrong password.' } });
    expect(t.gateway.tables.seatOf(b.session)).toBeNull();
    expect(t.lobby.index.get(table)).toMatchObject({ filled: 1 });
    t.clock.advance(SEC);
    expect(await b.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: true, table });
    expect(t.gateway.tables.seatOf(b.session)).toMatchObject({ table });
    // a third player: the table is full now (no password needed to be told so)
    expect(await c.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'tableFull' } });
    const open = await createTable(await guest(t, 'Dave'));
    expect(await c.cmd({ t: 'join', table: open.table, password: 'a password nobody asked for', deck: TEST_DECK })).toMatchObject({ ok: true });
  });

  it('a bad deck is refused after the password was right, and the right password is not spent', async () => {
    const t = lobbyGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const { table } = await createTable(a, { password: 'open sesame' });
    const bad = { main: [{ name: 'Bad Card', count: 60 }], sideboard: [] };
    expect(await b.cmd({ t: 'join', table, password: 'open sesame', deck: bad })).toMatchObject({ ok: false, error: { code: 'deckRejected' } });
    t.clock.advance(SEC);
    expect(await b.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: true });
  });
});

describe('M13-8 password attempts: the gateway\'s limits in front of the real hook', () => {
  async function room() {
    const c = counting();
    const t = lobbyGateway({ passwords: hook({ derive: c.derive }) });
    const owner = await guest(t, 'Owner');
    const { table } = await createTable(owner, { password: 'open sesame' });
    c.seen.length = 0; // the creator's hash
    return { t, table, c, owner };
  }

  it('ten wrong passwords in ten minutes lock the session for ten minutes; a locked attempt never reaches the hook; the right password works afterwards', async () => {
    const { t, table, c } = await room();
    const g = await guest(t, 'Guesser');
    for (let i = 0; i < 10; i++) {
      expect(await g.cmd({ t: 'join', table, password: `wrong ${i}`, deck: TEST_DECK }), `attempt ${i + 1}`).toMatchObject({ ok: false, error: { code: 'badPassword' } });
      t.clock.advance(SEC);
    }
    expect(c.seen).toHaveLength(10);
    const locked = await g.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK });
    expect(locked).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMs: 10 * MIN - SEC } });
    expect(c.seen).toHaveLength(10);
    t.clock.advance(10 * MIN);
    expect(await g.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: true });
    expect(c.seen).toHaveLength(11);
  });

  it('attempts faster than one a second are refused before the hook', async () => {
    const { t, table, c } = await room();
    const g = await guest(t, 'Hasty');
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await g.cmd({ t: 'join', table, password: `wrong ${i}`, deck: TEST_DECK }));
    expect(answers.map((r) => (r.ok ? 'ok' : r.error.code))).toEqual(['badPassword', 'badPassword', 'rateLimited', 'rateLimited']);
    expect(c.seen).toHaveLength(2);
  });

  it('the lock reaches the address key: another session from it is locked too, and a session from elsewhere is not (no per-table lock-out)', async () => {
    const { t, table } = await room();
    const peer = freshPeer();
    const g = await guest(t, 'Guesser', { peer });
    for (let i = 0; i < 10; i++) {
      await g.cmd({ t: 'join', table, password: `wrong ${i}`, deck: TEST_DECK });
      t.clock.advance(SEC);
    }
    const sibling = await guest(t, 'Sibling', { peer });
    expect(await sibling.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'rateLimited' } });
    const friend = await guest(t, 'Friend');
    expect(await friend.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: true });
  });

  it('slow guessing is never locked: nine wrong ones spread over ten minutes, then more', async () => {
    const { t, table } = await room();
    const g = await guest(t, 'Slow');
    for (let i = 0; i < 9; i++) {
      expect(await g.cmd({ t: 'join', table, password: `wrong ${i}`, deck: TEST_DECK })).toMatchObject({ error: { code: 'badPassword' } });
      t.clock.advance(70 * SEC);
    }
    expect(await g.cmd({ t: 'join', table, password: `wrong 10`, deck: TEST_DECK })).toMatchObject({ error: { code: 'badPassword' } });
  });

  it('a hook that is too busy answers that join busy with a short wait (M13-8 request 11); the connection stays and the others go on', async () => {
    const h = held();
    const t = lobbyGateway({ passwords: new ScryptPasswords({ scrypt: CHEAP_SCRYPT, derive: h.derive, concurrency: 1, queue: 0 }) });
    const owner = await guest(t, 'Owner');
    const creating = owner.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', password: 'open sesame', deck: TEST_DECK });
    await settle(5);
    h.jobs[0]!.resolve();
    const { table } = { table: ((await creating) as { table: string }).table };
    const first = await guest(t, 'First');
    const second = await guest(t, 'Second');
    first.client.send({ t: 'join', id: 1, table, password: 'one', deck: TEST_DECK });
    await settle(5);
    second.client.send({ t: 'join', id: 1, table, password: 'two', deck: TEST_DECK });
    await second.client.until(() => second.replyTo(1) !== undefined);
    expect(second.replyTo(1)).toMatchObject({ ok: false, error: { code: 'busy', retryAfterMs: 2_000 } });
    expect(second.client.closed).toBeNull();
    expect(t.logger.lines.join('\n')).toContain('PasswordBusyError');
    expect(t.logger.lines.join('\n')).not.toContain('"two"');
    expect(first.client.closed).toBeNull();
    h.jobs[1]!.resolve();
    await first.client.until(() => first.replyTo(1) !== undefined);
    expect(first.replyTo(1)).toMatchObject({ ok: false, error: { code: 'badPassword' } });
  });
});
