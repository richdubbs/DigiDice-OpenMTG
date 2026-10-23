/**
 * M13-13: `report` through the gateway (design 3.4, 3.6, 4.8): the intake wired as the gateway's `ReportService`, driven over the in-process transport.
 * Where the report is stored from (the game and seat the gateway knows), the per-command and per-session limits, the size limits of the frame, what the
 * reporter and the other players hear (a bare reply, nothing else), and a title report for a listed table.
 */
import { describe, expect, it } from 'vitest';
import { HOSTED_LIMITS } from '../../src/api';
import { ReportIntake } from '../../src/inbox';
import type { TestGateway } from '../m13-6/harness';
import { Browser, createTable, freshPeer, guest, makeGateway, settle, startTable } from '../m13-6/harness';
import { clientAttachments } from './helpers';

function withIntake(env: Record<string, string> = {}): TestGateway {
  // the intake needs the gateway's tables (for a title report), the gateway needs the intake: bound late, as main.ts binds it
  let t: TestGateway | null = null;
  const made = makeGateway({
    env,
    hooks: {
      reports: new ReportIntake({
        get store() {
          return t!.store;
        },
        now: () => t!.clock.now(),
        titleOf: (table) => {
          const v = t!.gateway.tables.viewFor(table, null);
          return v && v.source === 'listed' ? { title: v.title, creator: v.creator === null ? null : (v.seats[v.creator - 1]?.name ?? null) } : null;
        },
      }),
    },
  });
  t = made;
  return made;
}

const report = (b: Browser, text: string, extra: Record<string, unknown> = {}) => b.cmd({ t: 'report', kind: 'bug', text, ...extra });

describe('M13-13 report through the gateway', () => {
  it('a seated player\'s report is stored with the session, the game and the seat; the reply is a bare ok and nobody at the table hears anything', async () => {
    const t = withIntake();
    const { a, b, table } = await startTable(t);
    await settle();
    const aliceBefore = a.client.frames.length;
    const bobBefore = b.client.frames.length;
    const r = await report(a, 'The stack looks wrong', { attachments: clientAttachments() });
    expect(r).toEqual({ t: 'reply', id: expect.any(Number), ok: true });
    await settle();
    const [row] = await t.store.reports(new Date(0), 10);
    expect(row).toMatchObject({ kind: 'bug', session: a.session, game: table, seat: 1, text: 'The stack looks wrong', status: 'new', attachments: clientAttachments() });
    // Alice heard only the reply; Bob heard nothing at all
    expect(a.client.frames.slice(aliceBefore).map((f) => JSON.parse(f))).toEqual([r]);
    expect(b.client.frames.slice(bobBefore)).toEqual([]);
    // the other seat reports on its own, later: its seat is 2
    t.clock.advance(1_000);
    const second = await report(b, 'Bob here');
    expect(second.ok).toBe(true);
    const rows = await t.store.reports(new Date(0), 10);
    expect(rows.map((x) => [x.session === b.session ? 'bob' : 'alice', x.seat])).toEqual([['alice', 1], ['bob', 2]]);
  });

  it('a session that sits nowhere reports a bug of the lobby or the client: no game, no seat', async () => {
    const t = withIntake();
    const c = await guest(t, 'Carol');
    expect((await report(c, 'The lobby button does nothing')).ok).toBe(true);
    expect((await t.store.reports(new Date(0), 10))[0]).toMatchObject({ session: c.session, game: null, seat: null });
  });

  it('one report a minute per session, also across a new connection with the same token; a minute later it is stored', async () => {
    const t = withIntake();
    const a = await guest(t, 'Alice');
    expect((await report(a, 'one')).ok).toBe(true);
    // the same connection: the gateway's own bucket (design 3.6)
    const again = await report(a, 'two');
    expect(again).toMatchObject({ ok: false, error: { code: 'rateLimited' } });
    // a new connection (a fresh bucket) of the same session: the session's limit (design 4.8)
    const token = a.token;
    const a2 = Browser.connect(t, { peer: freshPeer() });
    await a2.hello('Alice', token);
    expect(a2.session).toBe(a.session);
    const third = await report(a2, 'three');
    expect(third).toMatchObject({ ok: false, error: { code: 'rateLimited' } });
    expect(third.ok ? 0 : third.error.retryAfterMs).toBeGreaterThan(0);
    t.clock.advance(60_000);
    expect((await report(a2, 'four')).ok).toBe(true);
    expect((await t.store.reports(new Date(0), 10)).map((x) => x.text)).toEqual(['one', 'four']);
  });

  it('sizes: the text at most 10 KB, attachments only of the listed kinds, at most 64 KB; a refusal stores nothing', async () => {
    const t = withIntake();
    const a = await guest(t, 'Alice');
    const max = HOSTED_LIMITS.reportText;
    // each refusal is a bad command (a strike) answered badMessage; one connection can take a few
    expect(await report(a, 'x'.repeat(max + 1))).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(await report(a, 'ok', { attachments: [{ kind: 'log', json: '{}' }] })).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(await report(a, 'ok', { attachments: [{ kind: 'view', json: 'a'.repeat(HOSTED_LIMITS.reportAttachments + 1) }] })).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(await t.store.reports(new Date(0), 10)).toEqual([]);
    // and none of them used up the minute: exactly the limits are accepted
    expect((await report(a, 'x'.repeat(max), { attachments: [{ kind: 'view', json: 'a'.repeat(HOSTED_LIMITS.reportAttachments) }] })).ok).toBe(true);
    expect((await t.store.reports(new Date(0), 10))[0]!.text).toHaveLength(max);
  });

  it('a title report for a listed table keeps the title and the creator; a private table or an unknown one is noTable', async () => {
    const t = withIntake();
    const a = await guest(t, 'Alice');
    const c = await guest(t, 'Carol');
    const d = await guest(t, 'Dave');
    const listed = await createTable(a, { title: 'A listed table' });
    const priv = await createTable(d, { visibility: 'private', title: 'Hidden one' });
    const r = await c.cmd({ t: 'report', kind: 'title', table: listed.table, text: 'rude' });
    expect(r.ok).toBe(true);
    const [row] = await t.store.reports(new Date(0), 10);
    expect(row).toMatchObject({ kind: 'title', game: listed.table, session: c.session, text: 'rude' });
    expect(JSON.parse(row!.attachments[0]!.json)).toEqual({ title: 'A listed table', creator: 'Alice' });
    t.clock.advance(60_000);
    expect(await c.cmd({ t: 'report', kind: 'title', table: priv.table, text: 'x' })).toMatchObject({ ok: false, error: { code: 'noTable' } });
    t.clock.advance(60_000);
    expect(await c.cmd({ t: 'report', kind: 'title', table: 'NO-SUCH-TABLE', text: 'x' })).toMatchObject({ ok: false, error: { code: 'noTable' } });
    expect(await t.store.reports(new Date(0), 10)).toHaveLength(1);
  });
});
