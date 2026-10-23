// @vitest-environment node
/**
 * RPL-3 (replays design 4 "Data, never code", 6, D5): the game a host shares (`replayGame`) as the guest's page keeps it (online/recording.ts), with a
 * fake socket playing the local server (normal traffic only). A file that is the game this player saw replaces the recording in the library (a game
 * replay saved by this player, mode 'onlineGuest'), with the live recording as its fallback until the worker's lands; the worker replaces it only when
 * this build plays the game as it was recorded (one whose checkpoints do not match keeps the live recording).
 * A malformed or oversized one is refused, never thrown on, and the recording stays: text that is not base64, longer than the bound, not gzip, not JSON,
 * not a replay, a recording, a game made for another player, another game, less of the game than the player saw, another result than the last view's.
 * The link forgets an earlier game's shared game when a new one is set up.
 */
import { gzipSync } from 'node:zlib';
import { viewFor, type GameView, type RecordingKeyView } from '@openmtg/engine';
import { encodeReplayGame, onlineReplayFile } from '@openmtg/net';
import { REPLAY_GAME_MAX_BYTES, type OnlineStatus, type ServerMessage } from '@openmtg/server/online';
import { describe, expect, it } from 'vitest';
import { checkSharedGame } from '../../src/online/recording';
import { discardConfig, botGame, type PlayedGame } from '../../../engine/test/rpl0/games';
import { fakeLink, flush } from '../online-fakes';
import { inlineCompleter, testEnv } from '../replays/helpers';
import { guestStatus, recordedGuest, recordOf, SHARED_APP as APP, SHARED_BUILD as BUILD } from './shared-fixtures';

const ID = 'r-0000000000000rpl3sg1';

let played: PlayedGame | null = null;
/** A short game of the NETFIX2 deck, to its end or 160 actions. */
function game(): PlayedGame {
  played ??= botGame(discardConfig('rpl3-shared'), 160);
  return played;
}

const gz = (x: unknown): string => gzipSync(Buffer.from(typeof x === 'string' ? x : JSON.stringify(x))).toString('base64');

const status = (me: 'p2'): OnlineStatus => guestStatus(me, ID);

/** A guest page (p2) shown the whole game, then sent `data` as the shared game. */
async function shownThenShared(data: unknown, o: { completer?: boolean } = {}) {
  const env = testEnv({ build: BUILD, completer: o.completer === false ? null : inlineCompleter });
  const { f, recorder } = await recordedGuest(game(), env, ID);
  expect(() => f.socket().push({ t: 'replayGame', data } as ServerMessage)).not.toThrow();
  await flush();
  await recorder.whenAdopted();
  const [entry] = await env.library.list();
  const read = await env.library.read(entry!.key);
  if (!read.ok) throw new Error(read.error.message);
  return { env, recorder, file: read.value, entries: await env.library.list() };
}

describe('RPL-3: the shared game, kept by the guest\'s page', { timeout: 120_000 }, () => {
  it('the game this player saw replaces its recording: a game replay saved by this player, with the fallback recording made under this build', async () => {
    const data = encodeReplayGame(onlineReplayFile(recordOf(game()), { savedBy: 'p2', mode: 'onlineGuest', app: APP }))!;
    const { env, recorder, file, entries } = await shownThenShared(data);
    expect(recorder.refused).toBeNull();
    expect(entries).toHaveLength(1);
    expect(file).toMatchObject({ kind: 'game', id: ID, game: { mode: 'onlineGuest', savedBy: 'p2' }, reveal: { policy: 'all', agreed: ['p1', 'p2'] } });
    expect(file.app).toEqual(env.app); // saved by this page
    expect(file.play!.config.seed).toBe('rpl3-shared');
    // Until the worker's lands, the fallback is this page's own recording (it was shown views without events).
    expect(file.recording!.frames.every((f) => f.events.length === 0)).toBe(true);
    await env.completion!.enqueue(ID);
    const done = await env.library.read(ID);
    if (!done.ok) throw new Error(done.error.message);
    expect(done.value.recording?.viewer).toBe('p2');
    expect(done.value.recording!.frames).toHaveLength(game().actions.length + 1);
    expect(done.value.recording!.frames.some((f) => f.events.length > 0)).toBe(true); // the worker's, made from the game
    expect((await env.library.entry(ID))?.completion).toBeUndefined();
  });

  it('a shared game this build does not play as it was recorded keeps the guest\'s own recording: the worker replaces it only when it succeeds', async () => {
    const r = recordOf(game());
    const last = r.checkpoints[r.checkpoints.length - 1]!;
    const wrong = { ...last, digest: `${last.digest.slice(0, -1)}${last.digest.endsWith('0') ? '1' : '0'}` };
    const data = encodeReplayGame(onlineReplayFile({ ...r, checkpoints: [...r.checkpoints.slice(0, -1), wrong] }, { savedBy: 'p2', mode: 'onlineGuest', app: APP }))!;
    const { env, recorder, file } = await shownThenShared(data);
    expect(recorder.refused).toBeNull();
    expect(file.kind).toBe('game');
    await env.completion!.enqueue(ID);
    const done = await env.library.read(ID);
    if (!done.ok) throw new Error(done.error.message);
    expect(done.value.kind).toBe('game');
    expect(done.value.recording?.viewer).toBe('p2');
    expect(done.value.recording!.frames).toHaveLength(game().states.length); // every view this page was shown
    expect(done.value.recording!.frames.map((f) => f.t)).toEqual([0, ...done.value.play!.times]);
    expect((await env.library.entry(ID))?.completion).toBeUndefined(); // given up: this build never plays it as recorded
  });

  it('without a worker (or another build) the guest\'s own recording stays as the game\'s fallback, at the host\'s times', async () => {
    const data = encodeReplayGame(onlineReplayFile(recordOf(game()), { savedBy: 'p2', mode: 'onlineGuest', app: APP }))!;
    const { file } = await shownThenShared(data, { completer: false });
    expect(file.kind).toBe('game');
    const frames = file.recording!.frames;
    expect(frames).toHaveLength(game().states.length);
    expect(frames.map((f) => f.t)).toEqual([0, ...file.play!.times]);
  });

  const bad: [string, () => unknown, RegExp][] = [
    ['text that is not base64', () => 'not base64 at all!', /not base64/],
    ['text longer than the bound', () => 'A'.repeat(4 * Math.ceil(REPLAY_GAME_MAX_BYTES / 3) + 4), /size/],
    ['bytes that are not gzip, not JSON', () => Buffer.from('plain words').toString('base64'), /not JSON/],
    ['gzip that is damaged', () => gz({ a: 1 }).slice(0, 24), /damaged/],
    ['JSON that is not a replay', () => gz({ hello: 'world' }), /not an OpenMTG replay/],
    ['a recording, not the game', () => gz({ ...onlineReplayFile(recordOf(game()), { savedBy: 'p2', mode: 'onlineGuest', app: APP }), kind: 'recording', play: undefined, recording: { viewer: 'p2', defs: {}, frames: [] } }), /not a game replay/],
    ['a game made for another player', () => encodeReplayGame(onlineReplayFile(recordOf(game()), { savedBy: 'p1', mode: 'onlineGuest', app: APP })), /another player/],
    ['another game (other players)', () => encodeReplayGame(onlineReplayFile(recordOf(game(), { names: ['Carol', 'Dan'] }), { savedBy: 'p2', mode: 'onlineGuest', app: APP })), /players/],
    ['less of the game than the player saw', () => encodeReplayGame(onlineReplayFile(recordOf(game(), { actions: 40 }), { savedBy: 'p2', mode: 'onlineGuest', app: APP })), /less of the game/],
  ];
  for (const [what, data, why] of bad) {
    it(`refuses ${what} without throwing; the recording stays`, async () => {
      const { recorder, file, entries } = await shownThenShared(data());
      expect(recorder.refused).toMatch(why);
      expect(entries).toHaveLength(1);
      expect(file.kind).toBe('recording');
      expect(file.play).toBeUndefined();
    });
  }

  it('refuses a game whose result is not the one the last view showed', async () => {
    const file = onlineReplayFile(recordOf(game()), { savedBy: 'p2', mode: 'onlineGuest', app: APP });
    const data = encodeReplayGame(file)!;
    const { defs: _defs, ...seen } = JSON.parse(JSON.stringify(viewFor(game().states[game().states.length - 1]!, 'p2'))) as GameView;
    const winner = file.game.result?.winner ?? null;
    const reason = file.game.result?.reason ?? 'concede';
    const other = winner === 'p1' ? 'p2' : 'p1';
    expect(await checkSharedGame(data, 'p2', { ...seen, result: { winner: other, reason } } as RecordingKeyView, 0)).toEqual({ ok: false, reason: 'its result is not the one of this game' });
    expect((await checkSharedGame(data, 'p2', { ...seen, result: winner === null ? undefined : { winner, reason } } as RecordingKeyView, 0)).ok).toBe(true);
  });

  it('the link forgets the game shared in an earlier game when a new one is set up', async () => {
    const data = encodeReplayGame(onlineReplayFile(recordOf(game()), { savedBy: 'p2', mode: 'onlineGuest', app: APP }))!;
    const f = fakeLink({ initial: [{ t: 'status', status: { ...status('p2'), phase: 'over' } }, { t: 'replayGame', data }] });
    await f.link.connect();
    expect(f.link.replayGame()).toBe(data);
    for (const phase of ['idle', 'joining'] as const) {
      f.socket().push({ t: 'replayGame', data });
      expect(f.link.replayGame()).toBe(data);
      f.socket().push({ t: 'status', status: { role: phase === 'idle' ? 'none' : 'guest', phase, warnings: [] } as OnlineStatus });
      expect(f.link.replayGame(), phase).toBeNull();
    }
  });

  it('a replayGame that is not text is not even kept by the link', async () => {
    const f = fakeLink({ initial: [{ t: 'status', status: status('p2') }] });
    await f.link.connect();
    for (const data of [42, null, { a: 1 }, ['x']]) f.socket().push({ t: 'replayGame', data } as unknown as ServerMessage);
    expect(f.link.replayGame()).toBeNull();
  });
});
