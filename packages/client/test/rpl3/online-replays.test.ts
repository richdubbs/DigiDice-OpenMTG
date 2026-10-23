// @vitest-environment node
/**
 * RPL-3 (replays design 6, 7.2, 7.3, 8, 16.3): online replays from the pages down, in process (normal traffic only: each page's OnlineLink talks to its
 * own server's bridge in process, the bridges play over packages/net's in-memory link; helpers.ts). With 2 and 3 players:
 *
 *  - every person agreed: after the end each guest's page keeps the whole game (kind 'game', saved by that guest, every seat and the open view allowed),
 *    with its fallback recording made under this build; the host's page reads its game's record from its own server and keeps it, and the server removes
 *    it. Each replay opens and plays through RPL-2's ReplayConnection, and at every change a page was shown live its own seat's view in the replay is
 *    the live view;
 *  - not everyone agreed: each guest's page keeps only its own recording (kind 'recording'), which opens and plays with the live views, frame by frame;
 *    nothing of the game reached it;
 *  - a leaver's choice counts: the guest who agreed and left keeps its recording, the others the game;
 *  - the host's page that closed before the end: its next start reads the record the server kept;
 *  - choices made after the end reach the host's kept replay: at once while its page is open, at its next start when it closed (the server keeps the
 *    record until the game is closed or shared); a game shared after the guest's page left is kept from the online setup screen.
 */
import { checkReplay, type ReplayFile } from '@openmtg/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { reportContent } from '../../src/bugs/capture';
import { RemoteConnection } from '../../src/connection/RemoteConnection';
import { createReplayConnection, type ReplayConnection } from '../../src/connection/ReplayConnection';
import { sealConnection } from '../../src/game/sealed';
import { collectHostReplays } from '../../src/online/hostReplay';
import { keepSharedOnlineGame, recordOnlineGame } from '../../src/online/replays';
import { seat } from '../../src/replays/viewer/policy';
import { instantChecker } from '../connection/replay-files';
import { testEnv, inlineCompleter } from '../replays/helpers';
import { allOver, BUILD, keptFile, onlineTable, pageLink, playUntil, until, untilAsync, type OnlineTable, type Page } from './helpers';

const tables: OnlineTable[] = [];
afterEach(async () => {
  for (const t of tables.splice(0)) await t.close();
});

async function table(seats: 2 | 3, tag: string, o: { completer?: boolean } = {}): Promise<OnlineTable> {
  const t = await onlineTable(seats, tag, o);
  tables.push(t);
  return t;
}

function opened(file: ReplayFile): ReplayConnection {
  return createReplayConnection(file, { engineBuild: BUILD, checker: instantChecker, sliceMs: 40 });
}

/** At every change `p` was shown live, the replay (opened on `p`'s own seat) shows the same view: a game by its seq, a recording frame by frame. */
async function samePlayback(p: Page, file: ReplayFile): Promise<void> {
  const conn = opened(file);
  await conn.controller.ready();
  const c = conn.controller;
  expect(c.state().perspective).toEqual(seat(p.me));
  if (file.kind === 'game') {
    expect(c.state().badge).toBe('exact');
    for (const s of p.shown) {
      if (c.state().position !== s.seq) expect(c.seek(s.seq), `${p.me} seq ${s.seq}`).toBe(true);
      expect(c.state().position).toBe(s.seq);
      expect(conn.view(), `${p.me}'s view after ${s.seq} actions`).toEqual(s.view);
    }
  } else {
    expect(c.state().badge).toBe('recording');
    const frames = file.recording!.frames;
    expect(frames.map((f) => f.seq)).toEqual(p.shown.map((s) => s.seq));
    // A recording keeps each definition once (replays design 4), and its player shows them with every frame: the view is the live one, and its
    // definitions hold every one the live view had.
    for (let i = 0; i < frames.length; i++) {
      if (c.state().position !== i) expect(c.seek(i)).toBe(true);
      expect(c.state().position).toBe(i);
      const { defs, ...rest } = conn.view();
      const { defs: liveDefs, ...live } = p.shown[i]!.view;
      expect(rest, `${p.me}'s frame ${i}`).toEqual(live);
      for (const [id, d] of Object.entries(liveDefs)) expect(defs[id], `${p.me}'s frame ${i}: ${id}`).toEqual(d);
    }
  }
  c.dispose();
}

describe('RPL-3: online replays kept by every page', { timeout: 120_000 }, () => {
  it('2 players, both agree: the guest keeps the game, the host its record; both open and play with the live views', async () => {
    const t = await table(2, 'both');
    for (const p of t.pages) expect((await p.link.setReplayConsent(true)).ok).toBe(true);
    const [guest] = t.guests as [Page];
    await playUntil(t, () => t.hostGame().seq < 12);
    // RPL-4's seam (bugs/capture.ts, live.ts `soFar`): a bug report during the game carries what the guest was shown so far, never the game; the host's
    // page holds no game, so its report carries the view on screen.
    const during = reportContent(sealConnection(guest.conn), { online: { role: 'guest' } });
    expect(during.holds).toBe('recording');
    expect(during.replay.recording!.frames.map((f) => f.seq)).toEqual(guest.shown.map((s) => s.seq));
    expect(during.replay.play).toBeUndefined();
    expect(reportContent(sealConnection(t.host.conn), { online: { role: 'host' } }).holds).toBe('view');
    await playUntil(t, allOver(t));
    await until(() => guest.link.replayGame() !== null, 5000, 'the shared game');
    if (guest.replay?.role !== 'guest' || t.host.replay?.role !== 'host') throw new Error('no replays');
    await guest.replay.recorder.whenAdopted();
    expect(guest.replay.recorder.refused).toBeNull();
    // Once every player agreed and the game was shared, a report may carry the game itself (every person agreed).
    expect(reportContent(sealConnection(guest.conn), { online: { role: 'guest' } })).toMatchObject({ holds: 'game', replay: { reveal: { policy: 'all' } } });
    await until(() => t.host.replay?.live.state().phase === 'saved', 5000, 'the host\'s replay');
    await guest.env.completion!.enqueue(guest.replay.recorder.id); // its fallback recording (the worker's job), done here
    await t.host.env.completion!.enqueue(t.host.replay.replay.id);

    const g = await keptFile(guest);
    expect(checkReplay(JSON.parse(JSON.stringify(g))).ok).toBe(true);
    expect(g).toMatchObject({ kind: 'game', id: guest.replay.recorder.id, game: { mode: 'onlineGuest', savedBy: 'p2' }, reveal: { policy: 'all' } });
    expect(g.engine.build).toBe(BUILD);
    expect(g.recording?.viewer).toBe('p2'); // made under this build, one frame per action
    expect(g.recording!.frames).toHaveLength(g.play!.actions.length + 1);
    await samePlayback(guest, g);
    // With everyone's agreement the guest may watch every seat and the open view (replays design 6).
    const conn = opened(g);
    expect(conn.controller.state().perspectives.map((p) => (p.kind === 'seat' ? p.player : p.kind))).toEqual([...g.game.players.map((p) => p.id), 'public', 'open']);
    conn.controller.dispose();

    const h = await keptFile(t.host);
    expect(h).toMatchObject({ kind: 'game', game: { mode: 'onlineHost', savedBy: 'p1' }, reveal: { policy: 'all' } });
    expect(h.play).toEqual(g.play); // the same game
    expect(h.recording?.viewer).toBe('p1');
    await samePlayback(t.host, h);
    expect(t.store.list()).toEqual([]); // the host's server removed the record its page kept
  });

  it('2 players, the guest does not agree: each page keeps what it saw; the guest\'s recording plays frame by frame', async () => {
    const t = await table(2, 'own');
    expect((await t.host.link.setReplayConsent(true)).ok).toBe(true);
    await playUntil(t, allOver(t));
    const [guest] = t.guests as [Page];
    await until(() => guest.replay?.live.state().phase === 'saved', 5000, 'the guest\'s recording');
    await until(() => t.host.replay?.live.state().phase === 'saved', 5000, 'the host\'s replay');
    await new Promise((r) => setTimeout(r, 100));
    expect(guest.link.replayGame()).toBeNull();
    const g = await keptFile(guest);
    expect(checkReplay(JSON.parse(JSON.stringify(g))).ok).toBe(true);
    expect(g).toMatchObject({ kind: 'recording', game: { mode: 'onlineGuest', savedBy: 'p2', ended: expect.stringMatching(/finished|conceded/) }, reveal: { policy: 'own', agreed: [] } });
    expect(g.play).toBeUndefined();
    expect(JSON.stringify(g).includes('rpl3-client-own')).toBe(false); // no seed
    await samePlayback(guest, g);
    // The host keeps the whole game (its machine ran it), shown as the policy allows: its seat and the public view.
    const h = await keptFile(t.host);
    expect(h).toMatchObject({ kind: 'game', game: { mode: 'onlineHost' }, reveal: { policy: 'own', agreed: ['p1'] } });
    const conn = opened(h);
    expect(conn.controller.state().perspectives.map((p) => (p.kind === 'seat' ? p.player : p.kind))).toEqual(['p1', 'public']);
    conn.controller.dispose();
  });

  it('3 players: a leaver\'s choice counts: Bianca agrees and leaves; the others agree after the end; Gus keeps the game, Bianca her recording', async () => {
    const t = await table(3, 'leaver');
    const [gus, bianca] = t.guests as [Page, Page];
    expect((await bianca.link.setReplayConsent(true)).ok).toBe(true);
    await until(() => t.host.link.status().replay?.agreed?.includes('p3') === true, 3000, 'Bianca\'s choice at the host');
    await playUntil(t, () => t.hostGame().seq < 8);
    // Bianca leaves (GameScreen: the server leaves the game, conceding it, CR 104.3a; then the screen goes): the game goes on for the others.
    const leaving = bianca.link.leave();
    bianca.replay!.live.left();
    expect((await leaving).ok).toBe(true);
    await until(() => bianca.replay?.live.state().phase === 'saved', 6000, 'Bianca\'s recording');
    await playUntil(t, allOver(t, [t.host, gus]), 90000, [t.host, gus]);
    for (const p of [t.host, gus]) expect((await p.link.setReplayConsent(true)).ok).toBe(true);
    await until(() => gus.link.replayGame() !== null, 5000, 'Gus\'s copy');
    if (gus.replay?.role !== 'guest') throw new Error('no replay');
    await gus.replay.recorder.whenAdopted();
    const g = await keptFile(gus);
    expect(g).toMatchObject({ kind: 'game', game: { mode: 'onlineGuest', savedBy: gus.me }, reveal: { policy: 'all' } });
    expect(g.reveal.agreed).toHaveLength(3);
    await samePlayback(gus, g);
    const b = await keptFile(bianca);
    // Her page saw the game up to her leaving (her server concedes as it leaves, after the page has stopped taking its views): unfinished for her.
    expect(b).toMatchObject({ kind: 'recording', game: { savedBy: 'p3', ended: 'abandoned', result: null } });
    expect(bianca.link.replayGame()).toBeNull();
    await samePlayback(bianca, b);
  });

  it('the host\'s page left before the end: the next start reads the record its server kept (an abandoned game when it never ended)', async () => {
    const t = await table(2, 'later');
    await playUntil(t, () => t.hostGame().seq < 10);
    const seq = t.hostGame().seq;
    await t.host.bridge.close(); // the server stops: no result, the record stays
    expect(t.store.list()).toMatchObject([{ over: false, running: false }]);
    const next = testEnv({ build: BUILD, completer: inlineCompleter, now: () => Date.now() });
    const kept = await collectHostReplays(next, (p, init) => t.host.link.request(p, init));
    expect(kept).toHaveLength(1);
    const read = await next.library.read(kept[0]!);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.game).toMatchObject({ mode: 'onlineHost', ended: 'abandoned', result: null, actions: seq });
    expect(t.store.list()).toEqual([]);
  });

  it('the host\'s page reloaded after it kept the replay: Watch finds the one it kept; the record stays until the game is closed', async () => {
    const t = await table(2, 'reload');
    await playUntil(t, allOver(t));
    await until(() => t.host.replay?.live.state().phase === 'saved', 5000, 'the host\'s replay');
    // Kept by the page, but the game is still open at the server (the choices may still change): the record stays.
    expect(t.store.list()).toMatchObject([{ over: true, running: false }]);
    // The reloaded page: the same library, a new link to the same server, the game screen again (still over at the server).
    const again = recordOnlineGame(new RemoteConnection(t.host.link), t.host.link, t.host.env);
    if (again?.role !== 'host') throw new Error('no replay');
    const file = await again.live.file();
    expect(file).toMatchObject({ kind: 'game', game: { mode: 'onlineHost', savedBy: 'p1' } });
    expect((await t.host.env.library.list()).length).toBe(1);
    // The host leaves the game: nothing changed since its page kept the record, which goes.
    expect((await t.host.link.leave()).ok).toBe(true);
    expect(t.store.list()).toEqual([]);
  });

  it('the host\'s page open after the end: the reveal record of the replay it kept follows a choice made after the end', async () => {
    const t = await table(2, 'follow');
    expect((await t.host.link.setReplayConsent(true)).ok).toBe(true);
    await playUntil(t, allOver(t));
    await until(() => t.host.replay?.live.state().phase === 'saved', 5000, 'the host\'s replay');
    expect((await keptFile(t.host)).reveal).toEqual({ policy: 'own', agreed: ['p1'] });
    const [guest] = t.guests as [Page];
    expect((await guest.link.setReplayConsent(true)).ok).toBe(true);
    await until(() => t.host.link.status().replay?.shared === true, 5000, 'the shared game');
    await untilAsync(async () => (await keptFile(t.host)).reveal.policy === 'all', 5000, 'the kept file\'s reveal record');
    expect((await keptFile(t.host)).reveal).toEqual({ policy: 'all', agreed: ['p1', 'p2'] });
  });

  it('a game the host shares after the guest\'s page left the game screen is kept from the setup screen; leaving that game then loses nothing', async () => {
    const t = await table(2, 'late-share');
    const [guest] = t.guests as [Page];
    expect((await guest.link.setReplayConsent(true)).ok).toBe(true);
    await playUntil(t, allOver(t));
    await until(() => guest.replay?.live.state().phase === 'saved', 5000, 'the guest\'s recording');
    if (guest.replay?.role !== 'guest') throw new Error('no replay');
    guest.replay.recorder.stop(); // the guest's page closes; the game stays open at its server
    guest.link.close();
    // The host agrees after the end: the game is shared, and waits at the guest's server.
    expect((await t.host.link.setReplayConsent(true)).ok).toBe(true);
    await until(() => guest.bridge.current.replay?.shared === true, 5000, 'the shared game at the guest\'s server');
    expect((await keptFile(guest)).kind).toBe('recording');
    // The guest opens an online setup screen: its link sees the game open, and the game the host shared.
    const setup = pageLink(guest.bridge);
    await setup.connect();
    await until(() => setup.replayGame() !== null, 3000, 'the shared game on the new link');
    expect(await keepSharedOnlineGame(setup, guest.env)).toBe(true);
    const g = await keptFile(guest);
    expect(g).toMatchObject({ kind: 'game', id: guest.replay.recorder.id, game: { mode: 'onlineGuest', savedBy: 'p2' }, reveal: { policy: 'all' } });
    // Leaving that game there (the server forgets the shared game) loses nothing.
    expect((await setup.leave()).ok).toBe(true);
    expect(setup.replayGame()).toBeNull();
    expect((await keptFile(guest)).kind).toBe('game');
    setup.close();
  });

  it('a choice made after the host\'s page kept its replay and closed reaches that replay at the next start (the record stays until shared)', async () => {
    const t = await table(2, 'later-choice');
    const id = t.hostGame().replayId;
    expect((await t.host.link.setReplayConsent(true)).ok).toBe(true);
    await playUntil(t, allOver(t));
    await until(() => t.host.replay?.live.state().phase === 'saved', 5000, 'the host\'s replay');
    if (t.host.replay?.role !== 'host') throw new Error('no replay');
    t.host.replay.replay.stop(); // the host's page closes: its replay no longer follows the status
    // The guest agrees after the end: everyone has, and the game is shared.
    const [guest] = t.guests as [Page];
    expect((await guest.link.setReplayConsent(true)).ok).toBe(true);
    await until(() => guest.link.replayGame() !== null, 5000, 'the shared game');
    expect((await keptFile(t.host)).reveal).toEqual({ policy: 'own', agreed: ['p1'] });
    // The host's next page start reads the record again: everyone agreed. Read again after the sharing, the record goes.
    expect(await collectHostReplays(t.host.env, (p, init) => t.host.link.request(p, init))).toEqual([id]);
    expect((await keptFile(t.host)).reveal).toEqual({ policy: 'all', agreed: ['p1', 'p2'] });
    expect(t.store.list()).toEqual([]);
  });
});
