/**
 * M13-13: the bug inbox's intake (design 4.8): what is stored, the limits (one report per minute per session, 10 KB of text, attachments of the listed
 * kinds only, 64 KB), who may report which game, and a store that fails. In process, a fake clock, fixed inputs.
 */
import { describe, expect, it } from 'vitest';
import { HOSTED_LIMITS, type ReportMessage } from '../../src/api';
import { DEFAULT_INTAKE_LIMITS, ReportIntake, reportProblem, TITLE_ATTACHMENT } from '../../src/inbox';
import { MemoryLogger } from '../../src/obs';
import { MemoryStore } from '../../src/store';
import type { GameStore } from '../../src/store/api';
import type { Who } from '../../src/tables/tables';
import { clientAttachments, SESSION_A, SESSION_B, storeGame, T0 } from './helpers';

const MIN = 60_000;

class Clock {
  constructor(public t = T0.getTime()) {}
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

const who = (session = SESSION_A, key = '10.0.0.1'): Who => ({ session, name: 'Alice', key });
const bug = (text = 'The stack looks wrong', extra: Partial<ReportMessage> = {}): ReportMessage => ({ t: 'report', id: 1, kind: 'bug', text, ...extra });

function rig(o: { store?: GameStore; titles?: Record<string, { title: string; creator: string | null }> } = {}) {
  const clock = new Clock();
  const store = o.store ?? new MemoryStore({ now: () => new Date(clock.now()) });
  const logger = new MemoryLogger();
  const intake = new ReportIntake({ store, titleOf: (t) => o.titles?.[t] ?? null, now: clock.now, logger });
  return { clock, store, intake, logger };
}

describe('M13-13 what a report stores', () => {
  it('a bug report in a game stores the words, the client attachments as sent, the game and the seat; its status is new', async () => {
    const { intake, store, clock } = rig();
    const atts = clientAttachments();
    const r = await intake.report(who(), bug('The stack looks wrong', { attachments: atts }), { table: 'G1', seat: 2 });
    expect(r).toEqual({ ok: true });
    const [row] = await store.reports(new Date(0), 10);
    expect(row).toMatchObject({ kind: 'bug', session: SESSION_A, game: 'G1', seat: 2, text: 'The stack looks wrong', status: 'new', createdAt: new Date(clock.now()) });
    expect(row!.attachments).toEqual(atts);
    expect(row!.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('a bug report outside a game (the lobby, the client) stores no game and no seat', async () => {
    const { intake, store } = rig();
    expect(await intake.report(who(), bug(), null)).toEqual({ ok: true });
    expect((await store.reports(new Date(0), 10))[0]).toMatchObject({ game: null, seat: null });
  });

  it('the reply is a bare ok: the report carries nothing back to the reporter', async () => {
    const { intake } = rig();
    const r = await intake.report(who(), bug('words', { attachments: clientAttachments() }), { table: 'G1', seat: 1 });
    expect(Object.keys(r)).toEqual(['ok']);
  });

  it('a game the session sat at before can be reported by naming it (its stored seats say so); another session\'s game or an unknown one is noTable', async () => {
    const { intake, store } = rig();
    const g = await storeGame(store, { moves: 6 });
    expect(await intake.report(who(SESSION_B), bug('after the game', { table: g.id }), null)).toEqual({ ok: true });
    expect((await store.reports(new Date(0), 10))[0]).toMatchObject({ game: g.id, seat: 2, session: SESSION_B });
    const other = who('S0000000000000000000000CCC', '10.0.0.2');
    expect(await intake.report(other, bug('not mine', { table: g.id }), null)).toMatchObject({ ok: false, error: { code: 'noTable' } });
    expect(await intake.report(other, bug('unknown', { table: 'NOPE' }), null)).toMatchObject({ ok: false, error: { code: 'noTable' } });
    expect(await store.reports(new Date(0), 10)).toHaveLength(1);
  });

  it('a bug report that names the table the session sits at needs no stored seat', async () => {
    const { intake, store } = rig();
    expect(await intake.report(who(), bug('here', { table: 'G9' }), { table: 'G9', seat: 1 })).toEqual({ ok: true });
    expect((await store.reports(new Date(0), 10))[0]).toMatchObject({ game: 'G9', seat: 1 });
  });

  it('a title report keeps the title as it was and the creator\'s name beside the words; the table must be a listed one', async () => {
    const { intake, store } = rig({ titles: { T1: { title: 'A rude title', creator: 'Mallory' } } });
    expect(await intake.report(who(), { t: 'report', id: 2, kind: 'title', text: '', table: 'T1' }, null)).toEqual({ ok: true });
    const row = (await store.reports(new Date(0), 10))[0]!;
    expect(row).toMatchObject({ kind: 'title', game: 'T1', seat: null, text: '' });
    expect(row.attachments).toEqual([{ kind: TITLE_ATTACHMENT, json: JSON.stringify({ title: 'A rude title', creator: 'Mallory' }) }]);
    expect(await intake.report(who(SESSION_B, '10.0.0.9'), { t: 'report', id: 3, kind: 'title', text: 'x', table: 'PRIVATE' }, null)).toMatchObject({ ok: false, error: { code: 'noTable' } });
    expect(await intake.report(who(SESSION_B, '10.0.0.9'), { t: 'report', id: 4, kind: 'title', text: 'x' }, null)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
  });
});

describe('M13-13 sizes and kinds', () => {
  it('the text is at most 10 KB (UTF-16 code units): exactly that is stored, one more is refused', async () => {
    const { intake, store } = rig();
    const max = HOSTED_LIMITS.reportText;
    expect(max).toBe(10 * 1024);
    expect(await intake.report(who(), bug('x'.repeat(max + 1)), null)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(await intake.report(who(), bug('x'.repeat(max)), null)).toEqual({ ok: true });
    expect((await store.reports(new Date(0), 10))[0]!.text).toHaveLength(max);
  });

  it('the hosted text rules apply to the words: NUL, an unpaired surrogate, bidi and control characters are refused, nothing is cleaned', async () => {
    const { intake, store } = rig();
    for (const text of ['a\u0000b', 'a\ud800b', 'a‮b', 'a\u001bb', 'a\nb']) {
      expect(await intake.report(who(), bug(text), null), JSON.stringify(text)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    }
    expect(await store.reports(new Date(0), 10)).toEqual([]);
  });

  it('a bug report needs words; a title report may have none', () => {
    expect(reportProblem(bug('   '))).toMatch(/say what went wrong/i);
    expect(reportProblem({ t: 'report', id: 1, kind: 'title', text: '', table: 'T' })).toBeNull();
  });

  it('attachments: only the listed kinds, each once, at most 4, 64 KB in all (UTF-16 code units), text rules on their text', () => {
    const att = (kind: string, json = '{}') => ({ kind, json }) as unknown as NonNullable<ReportMessage['attachments']>[number];
    expect(reportProblem(bug('x', { attachments: clientAttachments() }))).toBeNull();
    expect(reportProblem(bug('x', { attachments: [att('log')] }))).toMatch(/malformed/);
    expect(reportProblem(bug('x', { attachments: [att('config')] }))).toMatch(/malformed/);
    expect(reportProblem(bug('x', { attachments: [att(TITLE_ATTACHMENT)] }))).toMatch(/malformed/);
    expect(reportProblem(bug('x', { attachments: [att('view'), att('view')] }))).toMatch(/once/);
    expect(reportProblem(bug('x', { attachments: [att('view'), att('settings'), att('client'), att('view'), att('view')] }))).toMatch(/malformed/);
    const max = HOSTED_LIMITS.reportAttachments;
    expect(max).toBe(64 * 1024);
    expect(reportProblem(bug('x', { attachments: [att('view', 'a'.repeat(max))] }))).toBeNull();
    expect(reportProblem(bug('x', { attachments: [att('view', 'a'.repeat(max + 1))] }))).toMatch(/too large/);
    expect(reportProblem(bug('x', { attachments: [att('view', 'a'.repeat(max - 10)), att('settings', 'b'.repeat(11))] }))).toMatch(/too large/);
    expect(reportProblem(bug('x', { attachments: [att('view', 'a\u0000b')] }))).toMatch(/NUL/);
    expect(reportProblem(bug('x', { attachments: [att('view', 'a\udc00b')] }))).toMatch(/surrogate/);
    expect(reportProblem({ ...bug('x'), kind: 'spam' } as unknown as ReportMessage)).toMatch(/kind/);
  });

  it('attachments that are JSON escapes of NUL or a lone surrogate are ordinary text: stored as sent (TEXT, never jsonb), in every store', async () => {
    const { intake, store } = rig();
    const json = JSON.stringify({ a: '\u0000', b: '\ud800' }); // the text holds the escapes \u0000 and \ud800, not the characters
    expect(json).toContain('\\u0000');
    expect(await intake.report(who(), bug('escapes', { attachments: [{ kind: 'view', json }] }), null)).toEqual({ ok: true });
    expect((await store.reports(new Date(0), 10))[0]!.attachments).toEqual([{ kind: 'view', json }]);
  });
});

describe('M13-13 limits', () => {
  it('one report per minute per session: a second within the minute is rateLimited with the wait, even from a new connection; after the minute it is stored', async () => {
    const { intake, store, clock } = rig();
    expect(await intake.report(who(), bug('one'), null)).toEqual({ ok: true });
    clock.advance(20_000);
    const r = await intake.report(who(), bug('two'), null);
    expect(r).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMs: 40_000 } });
    clock.advance(40_000);
    expect(await intake.report(who(), bug('three'), null)).toEqual({ ok: true });
    expect((await store.reports(new Date(0), 10)).map((x) => x.text)).toEqual(['one', 'three']);
  });

  it('another session may report meanwhile', async () => {
    const { intake, store } = rig();
    expect(await intake.report(who(SESSION_A, 'k1'), bug('a'), null)).toEqual({ ok: true });
    expect(await intake.report(who(SESSION_B, 'k2'), bug('b'), null)).toEqual({ ok: true });
    expect(await store.reports(new Date(0), 10)).toHaveLength(2);
  });

  it('per address key: 12 an hour however many sessions it makes; the 13th waits for the first to leave the hour', async () => {
    const { intake, store, clock } = rig();
    expect(DEFAULT_INTAKE_LIMITS.perAddress).toBe(12);
    for (let i = 0; i < 12; i++) {
      expect(await intake.report(who(`S${String(i).padStart(25, '0')}`, '10.0.0.1'), bug(`n${i}`), null)).toEqual({ ok: true });
      clock.advance(1_000);
    }
    const r = await intake.report(who('S1'.padEnd(26, '9'), '10.0.0.1'), bug('too many'), null);
    expect(r).toMatchObject({ ok: false, error: { code: 'rateLimited' } });
    if (r.ok) throw new Error('unreachable');
    expect(r.error.retryAfterMs).toBe(3_600_000 - 12_000);
    // another address key is not affected
    expect(await intake.report(who('S2'.padEnd(26, '9'), '10.0.0.2'), bug('elsewhere'), null)).toEqual({ ok: true });
    clock.advance(3_600_000 - 12_000);
    expect(await intake.report(who('S1'.padEnd(26, '9'), '10.0.0.1'), bug('later'), null)).toEqual({ ok: true });
    expect(await store.reports(new Date(0), 100)).toHaveLength(14);
  });

  it('a refused report (bad text, no such table) uses up nothing; a report the store could not save neither', async () => {
    const clock = new Clock();
    const base = new MemoryStore({ now: () => new Date(clock.now()) });
    let fail = true;
    const store = new Proxy(base, {
      get(t, p, r) {
        const v = Reflect.get(t, p, r) as unknown;
        if (p === 'putReport') return async (x: Parameters<GameStore['putReport']>[0]) => (fail ? Promise.reject(new Error('disk full')) : t.putReport(x));
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    const intake = new ReportIntake({ store, titleOf: () => null, now: clock.now });
    expect(await intake.report(who(), bug('bad\u0000'), null)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(await intake.report(who(), bug('n', { table: 'NOPE' }), null)).toMatchObject({ ok: false, error: { code: 'noTable' } });
    expect(await intake.report(who(), bug('saved?'), null)).toMatchObject({ ok: false, error: { code: 'busy' } });
    fail = false;
    expect(await intake.report(who(), bug('now it saves'), null)).toEqual({ ok: true });
    expect((await base.reports(new Date(0), 10)).map((x) => x.text)).toEqual(['now it saves']);
  });

  it('what it remembers stays as small as the traffic: sessions and address keys are forgotten after their windows', async () => {
    const { intake, clock } = rig();
    for (let i = 0; i < 5; i++) {
      await intake.report(who(`S${i}`.padEnd(26, '0'), `k${i}`), bug(`n${i}`), null);
      clock.advance(10 * MIN);
    }
    clock.advance(2 * 3_600_000);
    await intake.report(who('Sx'.padEnd(26, '0'), 'kx'), bug('late'), null);
    expect(intake.remembered).toEqual({ sessions: 1, addresses: 1 });
  });

  it('nothing the player wrote is logged: the log line names the kind, the game and the seat only', async () => {
    const { intake, logger } = rig();
    await intake.report(who(), bug('a secret-looking sentence', { attachments: clientAttachments() }), { table: 'G1', seat: 1 });
    const text = logger.lines.join('\n');
    expect(text).toContain('reportFiled');
    expect(text).not.toContain('secret-looking');
    expect(text).not.toContain('Mozilla');
    expect(text).not.toContain(SESSION_A);
  });
});
