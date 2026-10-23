// @vitest-environment node
/**
 * RPL-3 (replays design 6 "What enforces it", 7.3, 13 tests): a recording of seat p holds nothing `viewFor(…, p)` does not. The property search of M6-3
 * (test/m6/face-down/hidden-property.test.ts), as RPL-0's tests run it (test/rpl0/hidden-events.test.ts): random games with face-down cards (morph,
 * megamorph, disguise, manifest, cloak, Clone), games of looting, cycling and discard spells (packages/net's NETFIX2 deck), and a seeded AI game
 * (packages/engine test/rpl0/games.ts). Each change is sent to the guest's page as the host sends it (packages/net host.ts `sendGuestView`: `viewFor` of
 * the guest, the events after what that seat was given already, `replayedEvents`, redacted by `eventsFor` with the state of the last view sent) through
 * the page's OnlineLink and RemoteConnection (a fake socket: normal traffic only), and the guest's recorder (online/recording.ts) records it. Then:
 *  - every frame's view, rebuilt as playback rebuilds it (key views and patches, each checked as the board reads it), is the view the page was shown,
 *    and that is `viewFor` of the host's state at that point;
 *  - every frame's events are the events the page was shown;
 *  - every definition the recording keeps is one a view showed;
 *  - the search: every text in the recording (ids, names, rules text, log lines) is one of the texts the page was shown; no hidden card's definition
 *    reaches a frame where `viewFor` hid it;
 *  - the file passes the replay validator and plays through RPL-2's ReplayConnection with the live views.
 * A reconnection (views missed, then the latest view again) is recorded as a key frame; a resent view is not a new frame; a reloaded page goes on with the
 * same record (the start-up sweep leaves the record of the game its server still has open alone, and a recording an older sweep kept as abandoned goes
 * on when the player returns); a page that was closed leaves an abandoned recording for the next start.
 */
import {
  HIDDEN_DEF, checkReplay, eventsFor, legalActions, recordingFrameView, replayedEvents, viewFor, type GameEvent, type GameState, type GameView, type PlayerId,
  type RecordingKeyView, type ReplayFile,
} from '@openmtg/engine';
import type { OnlineStatus, ServerMessage } from '@openmtg/server/online';
import { describe, expect, it } from 'vitest';
import { createReplayConnection } from '../../src/connection/ReplayConnection';
import { RemoteConnection } from '../../src/connection/RemoteConnection';
import { finishAbandonedOnline, OnlineGuestRecorder, ONLINE_FRAME, ONLINE_HEAD } from '../../src/online/recording';
import { sweepOnlineReplays } from '../../src/online/replays';
import { readInProgress } from '../../src/replays/inProgress';
import { finishAbandoned } from '../../src/replays/recorder';
import { aiGame, botGame, discardConfig, faceDownConfig, type PlayedGame } from '../../../engine/test/rpl0/games';
import { instantChecker } from '../connection/replay-files';
import { fakeLink, flush } from '../online-fakes';
import { heldBy, testClock, testEnv } from '../replays/helpers';

type ViewMsg = Extract<ServerMessage, { t: 'view' }>;

const ID = 'r-00000000000000rpl3a1';

const status = (me: PlayerId, id = ID): OnlineStatus => ({
  role: 'guest', phase: 'playing', me, format: 'casual', warnings: [], opponent: 'Host', opponentConnected: true, replay: { id, agree: false, shared: false },
});

/**
 * What the host sends `viewer` over the game (host.ts `broadcast` / `sendGuestView`), seq by seq: the view, the events after what the seat was given
 * already, redacted with the state of the last view sent. `missed`: seqs the page does not get (a dropped link); the next view after them is the
 * reconnection's sync (the latest view, no events). `resent`: seqs sent twice (a new socket gets the last view again, without its events).
 */
function hostMessages(g: PlayedGame, viewer: PlayerId, o: { missed?: ReadonlySet<number>; resent?: ReadonlySet<number> } = {}): ViewMsg[] {
  const out: ViewMsg[] = [];
  let sent: GameState | null = null;
  let gap = false;
  for (let seq = 0; seq < g.states.length; seq++) {
    const state = g.states[seq]!;
    if (o.missed?.has(seq)) {
      gap = true;
      continue;
    }
    let events: GameEvent[] = [];
    if (seq > 0 && !gap) {
      const prev = g.states[seq - 1]!;
      const all = g.events[seq - 1]!;
      const fresh = all.slice(replayedEvents(prev, g.actions[seq - 1]!, viewer));
      events = eventsFor(state, fresh, viewer, sent ? { before: sent } : {});
    }
    gap = false;
    sent = state;
    const m: ViewMsg = JSON.parse(JSON.stringify({ t: 'view', seq, view: viewFor(state, viewer), events, legal: legalActions(state, viewer) }));
    out.push(m);
    if (o.resent?.has(seq)) out.push({ ...m, events: [] });
  }
  return out;
}

/** A guest page: its link (a fake socket the test drives as the local server), its RemoteConnection and its recorder, over `env`. */
async function guestPage(me: PlayerId, first: ViewMsg, env: ReturnType<typeof testEnv>, id = ID) {
  const f = fakeLink({ initial: [{ t: 'status', status: status(me, id) }, first] });
  await f.link.connect();
  const conn = new RemoteConnection(f.link);
  const recorder = OnlineGuestRecorder.start(conn, f.link, env);
  await flush();
  return { f, conn, recorder };
}

async function recorded(env: ReturnType<typeof testEnv>): Promise<ReplayFile> {
  const [entry] = await env.library.list();
  const read = await env.library.read(entry!.key);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}

const keyless = (v: GameView): RecordingKeyView => {
  const { defs: _defs, ...rest } = v;
  return rest;
};

/** Every text in `x` (deeply): values and keys. */
function texts(x: unknown, out: Set<string>): Set<string> {
  if (typeof x === 'string') out.add(x);
  else if (Array.isArray(x)) for (const v of x) texts(v, out);
  else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      out.add(k);
      texts(v, out);
    }
  }
  return out;
}

interface Tally { frames: number; keys: number; hidden: number; texts: number }

/** The property (see the file comment) for the recording `file` of the messages `sent` to `viewer`, from the game `g`. */
function checkRecording(g: PlayedGame, viewer: PlayerId, sent: ViewMsg[], file: ReplayFile, tally: Tally): void {
  expect(checkReplay(JSON.parse(JSON.stringify(file))).ok).toBe(true);
  expect(file).toMatchObject({ kind: 'recording', game: { mode: 'onlineGuest', savedBy: viewer }, reveal: { policy: 'own' } });
  expect(file.play).toBeUndefined();
  const rec = file.recording!;
  expect(rec.viewer).toBe(viewer);
  // One frame per change shown: resent views are not new frames.
  const shown = sent.filter((m, i) => i === 0 || m.seq !== sent[i - 1]!.seq);
  expect(rec.frames.map((f) => f.seq)).toEqual(shown.map((m) => m.seq));
  const shownTexts = new Set<string>();
  const shownDefs = new Map<string, unknown>();
  let prev: RecordingKeyView | null = null;
  rec.frames.forEach((f, i) => {
    const m = shown[i]!;
    const v = recordingFrameView(prev, f, { viewer, defs: rec.defs });
    if (!v.ok) throw new Error(`frame ${i}: ${v.error.message}`);
    // The frame is what the page was shown, and that is viewFor of the host's state then.
    expect(v.value, `${viewer} frame ${i} (seq ${f.seq})`).toEqual(keyless(m.view));
    expect(JSON.parse(JSON.stringify(viewFor(g.states[f.seq]!, viewer)))).toEqual(m.view);
    expect(f.events, `${viewer} frame ${i}'s events`).toEqual(m.events);
    texts(m.view, shownTexts);
    texts(m.events, shownTexts);
    for (const [id, d] of Object.entries(m.view.defs)) shownDefs.set(id, d);
    // M6-3's search, on the frame: another player's hand cards stay blank cards unless revealed to this seat (CR 400.2, 701.20b).
    for (const o of Object.values(v.value.objects)) {
      if (o.owner === viewer || o.zone !== 'hand') continue;
      if (o.defId === HIDDEN_DEF) tally.hidden++;
      else expect(o.revealedTo?.includes(viewer), `${o.id} shown in ${o.owner}'s hand`).toBe(true);
    }
    if (f.key) tally.keys++;
    tally.frames++;
    prev = v.value;
  });
  // Every definition kept is one a view showed, as it showed it.
  for (const [id, d] of Object.entries(rec.defs)) {
    expect(shownDefs.has(id), `${id} was never shown`).toBe(true);
    expect(d).toEqual(shownDefs.get(id));
  }
  // The search: every text of the recording is a text the page was shown.
  const recorded = texts({ defs: rec.defs, frames: rec.frames }, new Set<string>());
  // The recording's own words (the frame and patch fields).
  for (const w of ['defs', 'frames', 'seq', 't', 'key', 'patch', 'events', 'op', 'path', 'value', 'set', 'del', 'splice', 'keys', 'at', 'add']) shownTexts.add(w);
  for (const s of recorded) if (!shownTexts.has(s)) throw new Error(`the recording holds "${s.slice(0, 80)}", which the page was never shown`);
  tally.texts += recorded.size;
}

/** The recording opens and plays through RPL-2's ReplayConnection with the live views, frame by frame. */
async function playsAsLive(file: ReplayFile, sent: ViewMsg[]): Promise<void> {
  const shown = sent.filter((m, i) => i === 0 || m.seq !== sent[i - 1]!.seq);
  const conn = createReplayConnection(file, { engineBuild: 'test-engine-build', checker: instantChecker, sliceMs: 40 });
  await conn.controller.ready();
  const c = conn.controller;
  expect(c.state().badge).toBe('recording');
  for (let i = 0; i < shown.length; i++) {
    if (i > 0) expect(c.step(1)).toBe(true);
    expect(keyless(conn.view()), `frame ${i}`).toEqual(keyless(shown[i]!.view));
    if (i > 0) expect(conn.events().events).toEqual(shown[i]!.events);
  }
  expect(c.step(1)).toBe(false);
  c.dispose();
}

/** Record `sent` on a guest page (the first message with the page's start, the rest one by one), and the recording kept. */
async function record(viewer: PlayerId, sent: ViewMsg[]): Promise<ReplayFile> {
  const clock = testClock();
  const env = testEnv({ completer: null, now: clock.now });
  const page = await guestPage(viewer, sent[0]!, env);
  for (const m of sent.slice(1)) {
    clock.advance(700);
    page.f.socket().push(m);
  }
  await page.recorder.finish();
  return recorded(env);
}

const GAMES: { name: string; game: () => PlayedGame; viewer: PlayerId; missed?: number[]; resent?: number[] }[] = [
  { name: 'face-down cards (morph, megamorph, disguise, manifest, cloak, Clone)', game: () => botGame(faceDownConfig('rpl3-fd-1'), 260), viewer: 'p2', resent: [3, 40] },
  { name: 'face-down cards, the other seat, with a reconnection', game: () => botGame(faceDownConfig('rpl3-fd-2'), 260), viewer: 'p1', missed: [30, 31, 32, 33] },
  { name: 'looting, cycling and discard spells (NETFIX2)', game: () => botGame(discardConfig('rpl3-dc-1'), 260), viewer: 'p2', missed: [50] },
  { name: 'a seeded AI game', game: () => aiGame('rpl3-ai-1', 0, 1), viewer: 'p1' },
];

describe('RPL-3: a recording of seat p holds nothing viewFor(…, p) does not (the M6-3 property search)', { timeout: 300_000 }, () => {
  for (const c of GAMES) {
    it(`${c.name}: seat ${c.viewer}`, async () => {
      const g = c.game();
      expect(g.actions.length).toBeGreaterThan(60);
      const sent = hostMessages(g, c.viewer, { missed: new Set(c.missed ?? []), resent: new Set(c.resent ?? []) });
      const file = await record(c.viewer, sent);
      const tally: Tally = { frames: 0, keys: 0, hidden: 0, texts: 0 };
      checkRecording(g, c.viewer, sent, file, tally);
      if (c.missed) {
        // The view after a reconnection is a key frame.
        const after = file.recording!.frames.find((f) => f.seq === Math.max(...c.missed!) + 1);
        expect(after?.key).toBeDefined();
      }
      expect(tally.hidden).toBeGreaterThan(0);
      await playsAsLive(file, sent);
      console.log(`RPL-3 recording property (${c.name}): ${JSON.stringify(tally)}`);
    });
  }
});

/** The page's own server as the start-up sweep asks it (the replays API's list): the game it has open; or no answer at all. */
const serverWith = (open: string | null) => async () => new Response(JSON.stringify({ replays: [], open }), { status: 200 });
const noServer = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch');
};

/** Until the store holds `n` frame rows (a recorder that goes on from the library reads it first; its writes follow). */
async function framesStored(env: ReturnType<typeof testEnv>, n: number): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    const rows = await env.library.db.getAll<{ key: string; type: string }>('inProgress');
    if (rows.filter((r) => r.type === ONLINE_FRAME).length >= n) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`the store never held ${n} frames`);
}

describe('RPL-3: the guest\'s record survives a reload and a closed page', { timeout: 120_000 }, () => {
  it('a reloaded page goes on with the same record: the start-up sweep leaves the open game alone; the recording is the whole game', async () => {
    const g = botGame(discardConfig('rpl3-dc-2'), 200);
    const sent = hostMessages(g, 'p2');
    const env = testEnv({ completer: null });
    const half = Math.floor(sent.length / 2);
    const first = await guestPage('p2', sent[0]!, env);
    for (const m of sent.slice(1, half)) first.f.socket().push(m);
    await flush();
    first.recorder.stop(); // the page is reloaded: no more views reach it, nothing is saved
    expect(await env.library.list()).toEqual([]);
    // The new page opens on Home, and its start-up sweep runs before the player returns to the game, which the page's server still has open.
    await sweepOnlineReplays(env, serverWith(ID));
    expect(await env.library.list()).toEqual([]);
    // The game screen again: the server sends the last view again (no events), then the game goes on.
    const again = await guestPage('p2', { ...sent[half - 1]!, events: [] }, env);
    for (const m of sent.slice(half)) again.f.socket().push(m);
    await again.recorder.finish();
    const file = await recorded(env);
    checkRecording(g, 'p2', sent, file, { frames: 0, keys: 0, hidden: 0, texts: 0 });
    expect((await env.library.db.getAll('inProgress')).length).toBe(0);
  });

  it('kept as abandoned by an older page\'s sweep while the game went on, the recording goes on when the player returns; closed again, the longer one stays', async () => {
    const g = botGame(discardConfig('rpl3-dc-3'), 200);
    const sent = hostMessages(g, 'p2');
    const env = testEnv({ completer: null });
    const third = Math.floor(sent.length / 3);
    const first = await guestPage('p2', sent[0]!, env);
    for (const m of sent.slice(1, third)) first.f.socket().push(m);
    await flush();
    first.recorder.stop();
    // The sweep of the next page could not ask its server (no answer): the record became an abandoned recording.
    await sweepOnlineReplays(env, noServer);
    const cut = await recorded(env);
    expect(cut.game.ended).toBe('abandoned');
    expect(cut.recording!.frames).toHaveLength(third);
    // The player returns to the game, still open at the server: the recording goes on from the library's.
    const second = await guestPage('p2', { ...sent[third - 1]!, events: [] }, env);
    for (const m of sent.slice(third, 2 * third)) second.f.socket().push(m);
    await framesStored(env, 2 * third);
    second.recorder.stop(); // closed again
    await sweepOnlineReplays(env, noServer);
    expect((await recorded(env)).recording!.frames).toHaveLength(2 * third);
    // Once more, to the end of what the host sends.
    const last = await guestPage('p2', { ...sent[2 * third - 1]!, events: [] }, env);
    for (const m of sent.slice(2 * third)) last.f.socket().push(m);
    await last.recorder.finish();
    const file = await recorded(env);
    checkRecording(g, 'p2', sent, file, { frames: 0, keys: 0, hidden: 0, texts: 0 });
    expect(await env.library.list()).toHaveLength(1);
    expect((await env.library.db.getAll('inProgress')).length).toBe(0);
  });

  it('a page closed during the game: the next start keeps its recording as abandoned (and the local games\' sweep leaves its rows alone)', async () => {
    const g = botGame(faceDownConfig('rpl3-fd-3'), 120);
    const sent = hostMessages(g, 'p2');
    const env = testEnv({ completer: null });
    const page = await guestPage('p2', sent[0]!, env);
    for (const m of sent.slice(1, 60)) page.f.socket().push(m);
    await flush();
    page.recorder.stop();
    const rows = await env.library.db.getAll<{ key: string; type: string }>('inProgress');
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set([ONLINE_HEAD, ONLINE_FRAME]));
    // The local games' reader and sweep do not take the online rows for theirs (replays/inProgress.ts).
    const next = testEnv({ db: env.db, completer: null, liveness: heldBy([]) });
    expect(await readInProgress(next.library.db)).toEqual({ records: [], orphans: [] });
    expect(await finishAbandoned(next)).toEqual([]);
    expect(await next.library.db.getAll('inProgress')).toHaveLength(rows.length);
    // Still held by an open page: left alone.
    expect(await finishAbandonedOnline(testEnv({ db: env.db, completer: null, liveness: heldBy([ID]) }))).toEqual([]);
    expect(await finishAbandonedOnline(next)).toEqual([ID]);
    const file = await recorded(next);
    expect(file.game).toMatchObject({ ended: 'abandoned', result: null, actions: 59 });
    checkRecording(g, 'p2', sent.slice(0, 60), file, { frames: 0, keys: 0, hidden: 0, texts: 0 });
    expect(await next.library.db.getAll('inProgress')).toEqual([]);
  });
});
