/**
 * M13-13, the whole stack (design 4.8, 6.4, 13.1): the hosted server as `npm start` builds it (`startHosted`: store, game workers, deck pool, gateway,
 * tables, the report intake), driven in process. Two computer players play a real game; one of them reports a bug in the middle of it. The report is in
 * the store with its game and seat; the game's log and config are attached on the server's side when the owner exports the report (the file replays under
 * `npm run bug -- replay`), and nothing of the log or the report reaches the reporter or the other player (CR 400.2).
 */
import { writeGzippedJson } from '@openmtg/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Inbox } from '../../src/inbox';
import { startHosted, type HostedServer } from '../../src/main';
import { InProcessTransport } from '../../src/gateway/in-process';
import { MemoryLogger } from '../../src/obs';
import { MemoryStore } from '../../src/store';
import { runBugReport } from '../../../../scripts/bug';
import { aiPlayer, createTable, DECKS, deckOf, FIXTURE_CARDS, quiet, RIG_SECRET, type AiPlayer } from '../m13-6/harness';
import { clientAttachments } from './helpers';

describe('M13-13 a report from a game that is running on the real server', () => {
  let server: HostedServer;
  let a: AiPlayer;
  let b: AiPlayer;
  let game: string;
  let reportId: string;
  let framesBefore: { a: number; b: number };

  beforeAll(async () => {
    server = await startHosted({
      env: { STORE: 'memory', WORKERS: '1', LEDGER_SECRET: RIG_SECRET },
      store: new MemoryStore(),
      listenPort: null,
      cards: { module: FIXTURE_CARDS },
      engineBuild: 'build-test',
      logger: new MemoryLogger(),
    });
    const rig = { transport: new InProcessTransport(server.gateway) };
    a = await aiPlayer(rig, 'Alice', 'rep-a');
    b = await aiPlayer(rig, 'Bob', 'rep-b');
    a.seat.limit = 14;
    b.seat.limit = 14;
    game = (await createTable(a.browser, { deck: deckOf(DECKS[0]!) })).table;
    expect(await b.browser.cmd({ t: 'join', table: game, deck: deckOf(DECKS[1]!) })).toMatchObject({ ok: true });
    await a.browser.client.until(() => a.seat.view !== null && b.seat.view !== null);
    await quiet([a, b]);
    framesBefore = { a: a.frames.length, b: b.frames.length };
    const r = await a.browser.cmd({ t: 'report', kind: 'bug', text: 'The attack was not declared', attachments: clientAttachments() });
    expect(r).toEqual({ t: 'reply', id: expect.any(Number), ok: true });
    await new Promise((res) => setTimeout(res, 200));
    reportId = (await server.store.reports(new Date(0), 10))[0]!.id;
  }, 120_000);

  afterAll(async () => {
    await server?.close();
  }, 60_000);

  it('the report is in the store with the game and the seat the gateway knew; the reporter\'s own words and attachments are as sent', async () => {
    const rows = await server.store.reports(new Date(0), 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: reportId, kind: 'bug', session: a.browser.session, game, seat: 1, text: 'The attack was not declared', status: 'new', attachments: clientAttachments() });
  });

  it('the game\'s log and config are attached on the server\'s side: the export holds every committed action, the stored seed and the moment of the report, and replays', async () => {
    const stored = await server.store.loadForRecovery(game, { ignoreSnapshots: true });
    expect(stored.records.length).toBeGreaterThan(8);
    const made = await new Inbox(server.store).export(reportId);
    if (!made.ok) throw new Error(made.message);
    const f = made.export.file;
    expect(f.replay.game).toMatchObject({ mode: 'hosted', savedBy: 'p1', actions: stored.records.length });
    expect(f.replay.play!.actions).toEqual(stored.records.map((r) => r.action));
    expect(f.replay.play!.config.seed).toBe(stored.seed);
    expect(f.at.action).toBe(stored.records.length - 1);
    expect(f.replay.engine.build).toBe('build-test');
    const gz = await writeGzippedJson(f);
    if (!gz.ok) throw new Error(gz.error.message);
    const run = await runBugReport(gz.value, { build: 'build-test' });
    expect(run.code, run.lines.join('\n')).toBe(0);
    expect(run.lines.join('\n')).toContain('The attack was not declared');
    expect(run.game!.actions).toHaveLength(stored.records.length);
  });

  it('nothing of the log or the report reached the reporter or the other player: after the report Alice heard one reply and Bob nothing, and no frame holds the seed, the report or its words', async () => {
    const stored = await server.store.loadForRecovery(game, { ignoreSnapshots: true });
    expect(a.frames.slice(framesBefore.a).map((f) => JSON.parse(f).t)).toEqual(['reply']);
    expect(b.frames.slice(framesBefore.b)).toEqual([]);
    for (const [who, frames] of [['alice', a.frames], ['bob', b.frames]] as const) {
      const text = frames.join('\n');
      expect(text.includes(stored.seed), `${who}: the seed`).toBe(false);
      expect(text.includes(reportId), `${who}: the report id`).toBe(false);
      expect(text.includes('The attack was not declared') && who === 'bob', 'bob: the reporter\'s words').toBe(false);
      expect(text.includes('"elapsedMs"'), `${who}: a log record's fields`).toBe(false);
      expect(text.includes('Mozilla/5.0 (test)') && who === 'bob', 'bob: the reporter\'s browser').toBe(false);
    }
  });
});
