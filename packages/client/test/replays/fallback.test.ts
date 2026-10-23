/**
 * RPL-1 (replays design 3, 4, 6): the fallback recording of a game replay, made after the game by running it again (in a worker in the browser; in
 * this thread here). It is what the default perspective was shown, frame by frame (the views and the redacted events of the live screen), it passes
 * the replay validator and the frame check the board's player runs, and it is made only of a game that plays here as it was recorded.
 */
import {
  HIDDEN_DEF, checkReplay, recordingFrameView, viewFor, type GameEvent, type GameView, type RecordingKeyView, type ReplayFile,
} from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { ComputerGame } from '../../src/game/computer';
import { completeGame, defaultPerspective, KEY_FRAME_TURNS, withCompleted } from '../../src/replays/fallback';
import { leftGameScreen } from '../../src/replays/live';
import { recordLocalGame } from '../../src/replays/record';
import { GameRecorder } from '../../src/replays/recorder';
import { duel, inlineCompleter, playUntil, settle, testEnv } from './helpers';

const BUILD = 'test-engine-build';

const keyless = (v: GameView): RecordingKeyView => {
  const { defs: _defs, ...rest } = v;
  return rest;
};

/** Every frame's view, as the replay's player would build it (key views and patches, each checked as the board reads it). */
function frameViews(file: ReplayFile): RecordingKeyView[] {
  const rec = file.recording!;
  const out: RecordingKeyView[] = [];
  let prev: RecordingKeyView | null = null;
  for (const f of rec.frames) {
    const v = recordingFrameView(prev, f, { viewer: rec.viewer, defs: rec.defs });
    if (!v.ok) throw new Error(`frame ${f.seq}: ${v.error.message}`);
    out.push(v.value);
    prev = v.value;
  }
  return out;
}

async function savedFile(env: ReturnType<typeof testEnv>): Promise<ReplayFile> {
  const [entry] = await env.library.list();
  const read = await env.library.read(entry!.key);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}

describe('RPL-1: the fallback recording is what the default perspective was shown (design 3, 6)', () => {
  it('against the computer: the person\'s own seat, every frame equal to the live screen\'s view and events (CR 400.2)', async () => {
    const env = testEnv();
    const game = recordLocalGame(new ComputerGame(duel('rpl1-fallback-vs', 5), 'p1', 'p2', { delayMs: 0, seed: 'c' }), { format: 'casual' }, env);
    const conn = game.local;
    const live: { view: RecordingKeyView; events: readonly GameEvent[] }[] = [{ view: keyless(conn.view()), events: [] }];
    conn.subscribe(() => live.push({ view: keyless(conn.view()), events: conn.events().events }));
    await playUntil(conn, () => conn.session.state.result !== null || conn.session.actions.length >= 150);
    leftGameScreen(game);
    await settle();
    const file = await savedFile(env);
    expect(defaultPerspective(file)).toBe('p1');
    const done = completeGame(file, BUILD);
    expect(done.problem).toBeUndefined();
    const complete = withCompleted(file, done);
    expect(checkReplay(JSON.parse(JSON.stringify(complete))).ok).toBe(true);
    const rec = complete.recording!;
    expect(rec.viewer).toBe('p1');
    // one frame per action, after the view before the first (seq = action index + 1)
    expect(rec.frames.map((f) => f.seq)).toEqual([...Array(file.play!.actions.length + 1).keys()]);
    expect(rec.frames.map((f) => f.t)).toEqual([0, ...file.play!.times]);
    const views = frameViews(complete);
    expect(views).toHaveLength(live.length);
    views.forEach((v, i) => expect(v, `frame ${i}`).toEqual(live[i]!.view));
    rec.frames.forEach((f, i) => expect(f.events, `frame ${i}`).toEqual(live[i]!.events));
    // the definitions are kept once and cover every view; the computer's hand stays hidden in every frame
    for (const v of views) {
      for (const o of Object.values(v.objects)) expect(o.defId === HIDDEN_DEF || Object.hasOwn(rec.defs, o.defId)).toBe(true);
      for (const id of v.zones.hand['p2'] ?? []) expect(v.objects[id]!.defId).toBe(HIDDEN_DEF);
      for (const id of v.zones.library['p1'] ?? []) expect(v.objects[id]!.defId).toBe(HIDDEN_DEF);
    }
  });

  it('hot-seat: the public view (nobody\'s hand), with a full view at the start and at every 5th turn', async () => {
    const env = testEnv();
    const conn = recordLocalGame(new LocalConnection(duel('rpl1-fallback-hot', 20)), { format: 'casual' }, env);
    const states = [conn.session.state];
    conn.subscribe(() => {
      if (states[states.length - 1] !== conn.session.state) states.push(conn.session.state);
    });
    await playUntil(conn, () => conn.session.state.turn.number >= 12 || conn.session.state.result !== null);
    leftGameScreen(conn);
    await settle();
    const file = await savedFile(env);
    expect(defaultPerspective(file)).toBeNull();
    const complete = withCompleted(file, completeGame(file, BUILD));
    const views = frameViews(complete);
    views.forEach((v, i) => expect(v, `frame ${i}`).toEqual(keyless(viewFor(states[i]!, null))));
    for (const v of views) for (const p of ['p1', 'p2']) for (const id of v.zones.hand[p] ?? []) expect(v.objects[id]!.defId).toBe(HIDDEN_DEF);
    const keyTurns = complete.recording!.frames.flatMap((f, i) => (f.key !== undefined ? [views[i]!.turn.number] : []));
    expect(keyTurns[0]).toBe(states[0]!.turn.number);
    for (const t of keyTurns.slice(1)) expect((t - 1) % KEY_FRAME_TURNS).toBe(0);
    expect(conn.session.state.turn.number).toBeGreaterThanOrEqual(12);
    expect(keyTurns).toEqual([states[0]!.turn.number, 1, 6, 11]);
  });
});

describe('RPL-1: a recording is made only of a game that plays here as it was recorded (design 5, 7.1)', () => {
  async function finishedFile(seed: string): Promise<ReplayFile> {
    const env = testEnv();
    const conn = new LocalConnection(duel(seed, 4));
    const rec = GameRecorder.start(conn, { format: 'casual' }, env);
    await playUntil(conn, () => conn.session.state.result !== null);
    await rec.finish();
    return savedFile(env);
  }

  it('a replay saved by another build is kept without a recording', async () => {
    const file = await finishedFile('rpl1-fallback-build');
    const done = completeGame(file, 'another-build');
    expect(done.recording).toBeUndefined();
    expect(done.problem).toMatch(/another version/);
    expect(withCompleted(file, done)).toBe(file);
  });

  it('a log whose checkpoints differ here gets no recording', async () => {
    const file = await finishedFile('rpl1-fallback-differs');
    const cps = file.play!.checkpoints;
    const changed: ReplayFile = { ...file, play: { ...file.play!, checkpoints: cps.map((c, i) => (i === 1 ? { ...c, digest: 'd1:00000000000000000000000000000000' } : c)) } };
    const done = completeGame(changed, BUILD);
    expect(done.recording).toBeUndefined();
    expect(done.problem).toMatch(/differently/);
  });

  it('an action the engine refuses stops it (CR 733: never half-applied)', async () => {
    const file = await finishedFile('rpl1-fallback-refused');
    const actions = [...file.play!.actions];
    const was = actions[5]!;
    actions[5] = { type: 'pass', player: 'player' in was && was.player === 'p1' ? 'p2' : 'p1' };
    const done = completeGame({ ...file, play: { ...file.play!, actions } }, BUILD);
    expect(done.recording).toBeUndefined();
    expect(done.problem).toMatch(/action 6/);
  });
});

describe('RPL-1: after the game a worker completes the replay in the library (design 3, 7.1)', () => {
  it('the stored file gets its recording, and the library lists it as having one', async () => {
    const env = testEnv({ completer: inlineCompleter });
    const conn = new LocalConnection(duel('rpl1-fallback-queue', 4));
    const rec = GameRecorder.start(conn, { format: 'casual' }, env);
    await playUntil(conn, () => conn.session.state.result !== null);
    await rec.finish();
    await settle(40);
    const [entry] = await env.library.list();
    expect(entry!.summary.hasRecording).toBe(true);
    const file = await savedFile(env);
    expect(file.recording!.frames).toHaveLength(file.play!.actions.length + 1);
    expect(checkReplay(JSON.parse(JSON.stringify(file))).ok).toBe(true);
  });
});
