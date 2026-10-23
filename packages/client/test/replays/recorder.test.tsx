/**
 * RPL-1 (replays design 7.1, 4, D8): the recorder of a local game. It appends each applied action, its time and the checkpoint digests to the game's
 * in-progress record; an undo truncates it; a restored game continues it; the game becomes a library entry when it ends or when the player leaves the
 * game screen; at start an in-progress record whose game screen is gone becomes an abandoned entry, and a replay whose worker was cut short is
 * completed.
 */
import { act as reactAct, render } from '@testing-library/react';
import {
  GameSession, checkReplay, checkpointAfter, gameDigest, replay, type Action, type GameState, type ReplayCheckpoint, type ReplayFile,
} from '@openmtg/engine';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { NavProvider, useNav, type Nav } from '../../src/app/nav';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { ComputerGame } from '../../src/game/computer';
import { sealConnection } from '../../src/game/sealed';
import { MemoryReplayDb } from '../../src/replays/db';
import { gameReplayFile } from '../../src/replays/file';
import { actionOp, headOp, readInProgress, RECORD_VERSION, type InProgressHead } from '../../src/replays/inProgress';
import { leftGameScreen, liveReplayOf } from '../../src/replays/live';
import { recordLocalGame } from '../../src/replays/record';
import { GameRecorder, finishAbandoned, recordedGameInfo } from '../../src/replays/recorder';
import { STALE_MS, timeLiveness } from '../../src/replays/liveness';
import { FlakyReplayDb, aiMove, duel, heldBy, inlineCompleter, pageClosedCompleter, playUntil, settle, testClock, testEnv } from './helpers';

/** The checkpoints the rule takes along a log (design 4), without the last action's (the recorder adds that one when the game is saved). */
function ruleCheckpoints(config: Parameters<typeof replay>[0], actions: readonly Action[]): ReplayCheckpoint[] {
  const s = new GameSession(config);
  const out: ReplayCheckpoint[] = [];
  actions.forEach((a, i) => {
    const before = s.state;
    const r = s.apply(a);
    if (!r.ok) throw new Error(r.error.message);
    const c = checkpointAfter(i, before.turn.number, s.state, false);
    if (c) out.push(c);
  });
  return out;
}

async function storedFile(env: ReturnType<typeof testEnv>, id: string): Promise<ReplayFile> {
  const read = await env.library.read(id);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}

describe('RPL-1: the recorder appends each applied action, its time and its checkpoints (design 7.1, 4)', () => {
  it('keeps the log, a time per action (ms since the start) and the rule\'s checkpoints in the in-progress store as the game goes', async () => {
    const clock = testClock();
    const env = testEnv({ now: clock.now });
    const conn = new LocalConnection(duel('rpl1-append'));
    const rec = GameRecorder.start(conn, { format: 'standard' }, env);
    await playUntil(conn, () => conn.session.actions.length >= 45, 3000, () => clock.advance(1500));
    await settle();
    const { records } = await readInProgress(env.db);
    expect(records).toHaveLength(1);
    const { head, log } = records[0]!;
    expect(head.id).toBe(rec.id);
    expect(head.mode).toBe('hotseat');
    expect(head.savedBy).toBeNull();
    expect(head.players.map((p) => [p.id, p.name, p.kind])).toEqual([['p1', 'Alice', 'person'], ['p2', 'Bob', 'person']]);
    expect(head.config).toEqual(conn.session.config);
    expect(log.actions).toEqual(conn.session.actions);
    expect(log.times).toHaveLength(log.actions.length);
    expect(log.times.every((t, i) => t === 1500 * (i + 1))).toBe(true);
    expect(log.checkpoints).toEqual(ruleCheckpoints(conn.session.config, conn.session.actions));
    expect(log.checkpoints.length).toBeGreaterThan(2);
    // one short write per action, not a rewrite of the whole game
    expect(env.db.writes).toBe(1 + log.actions.length);
  });
});

describe('RPL-1: an undo truncates the record (design D8: a replay shows the game as it was finally played)', () => {
  it('drops the undone action from the stored log and from the saved replay', async () => {
    const env = testEnv();
    // Alice's red deck plays a land in her first main phase: undoable (no library change, nothing hidden seen, CR 733.1).
    const conn = new LocalConnection(duel('rpl1-undo'));
    GameRecorder.start(conn, { format: 'casual' }, env);
    let undone = false;
    for (let i = 0; i < 400 && !undone; i++) {
      if (conn.handoff()) conn.acceptHandoff();
      if (conn.canUndo()) {
        const before = conn.session.actions.length;
        expect(conn.undo()).toBe(true);
        expect(conn.session.actions.length).toBe(before - 1);
        undone = true;
        break;
      }
      if (!(await aiMove(conn))) break;
    }
    expect(undone, 'an undoable action came up').toBe(true);
    await settle();
    const { records } = await readInProgress(env.db);
    expect(records[0]!.log.actions).toEqual(conn.session.actions);
    expect(records[0]!.log.checkpoints.every((c) => c.action < conn.session.actions.length)).toBe(true);
    // play on: the record follows the log again from there
    await playUntil(conn, () => conn.session.actions.length >= records[0]!.log.actions.length + 10);
    await settle();
    expect((await readInProgress(env.db)).records[0]!.log.actions).toEqual(conn.session.actions);
  });

  it('an undo whose delete failed leaves no undone action in the record: the next undo, or the next action\'s write, deletes it again', async () => {
    // One failed delete, then a second undo; and two failed deletes, then the action played again.
    for (const failing of [1, 2]) {
      const db = new FlakyReplayDb();
      const env = testEnv({ db });
      const conn = new LocalConnection(duel(`rpl1-undo-failed-${failing}`));
      const rec = GameRecorder.start(conn, { format: 'casual' }, env);
      await playUntil(conn, () => conn.session.actions.length >= 12);
      await settle();
      const log = [...conn.session.actions];
      const n = log.length;
      const s = new GameSession(conn.session.config);
      for (const a of log.slice(0, n - 2)) s.apply(a);
      const before = s.state;
      s.apply(log[n - 2]!);
      // what LocalConnection.undo (twice) and act tell the recorder: the last two actions taken back, the first of them played again
      db.failing = failing;
      rec.undone(n - 1);
      rec.undone(n - 2);
      rec.applied(log[n - 2]!, n - 2, before, s.state);
      await settle();
      const { records } = await readInProgress(db);
      expect(records[0]!.log.actions, `${failing} failed`).toEqual(log.slice(0, n - 1));
    }
  });

  it('a recorded game left after an undo saves exactly its final log', async () => {
    const env = testEnv();
    const conn = recordLocalGame(new LocalConnection(duel('rpl1-undo-left')), { format: 'casual' }, env);
    for (let i = 0; i < 400; i++) {
      if (conn.handoff()) conn.acceptHandoff();
      if (conn.canUndo()) {
        conn.undo();
        break;
      }
      if (!(await aiMove(conn))) break;
    }
    await playUntil(conn, () => false, 15);
    leftGameScreen(conn);
    await settle();
    const [entry] = await env.library.list();
    const file = await storedFile(env, entry!.key);
    expect(file.play!.actions).toEqual(conn.session.actions);
    expect(replay(file.play!.config, file.play!.actions).errors).toEqual([]);
  });
});

describe('RPL-1: a restored game continues its record (design 7.1)', () => {
  it('keeps the id, the start and the times, and appends what is played after the restore', async () => {
    const clock = testClock();
    const env = testEnv({ now: clock.now });
    const conn = new LocalConnection(duel('rpl1-restore'));
    const first = GameRecorder.start(conn, { format: 'modern' }, env);
    await playUntil(conn, () => conn.session.actions.length >= 30, 3000, () => clock.advance(1000));
    await settle();
    // the tab closes; a later page restores the game from its record
    const { records } = await readInProgress(env.db);
    const record = records[0]!;
    const restored = new LocalConnection(GameSession.fromJSON({ config: record.head.config, actions: [...record.log.actions] }));
    clock.advance(60_000);
    const second = GameRecorder.resume(restored, record, env);
    expect(second.id).toBe(first.id);
    await playUntil(restored, () => restored.session.actions.length >= 50, 3000, () => clock.advance(1000));
    await settle();
    const again = (await readInProgress(env.db)).records.find((r) => r.head.id === first.id)!;
    expect(again.log.actions).toEqual(restored.session.actions);
    expect(again.log.times.slice(0, 30)).toEqual(record.log.times);
    expect(again.log.times[30]).toBe(30_000 + 60_000 + 1000);
    expect(again.log.checkpoints).toEqual(ruleCheckpoints(record.head.config, restored.session.actions));
    const entry = await second.finish();
    const file = await storedFile(env, entry!.key);
    expect(file.id).toBe(first.id);
    expect(file.play!.actions).toEqual(restored.session.actions);
  });

  it('a record longer than the restored game is cut back to what they have in common', async () => {
    const env = testEnv();
    const conn = new LocalConnection(duel('rpl1-restore-cut'));
    GameRecorder.start(conn, { format: 'casual' }, env);
    await playUntil(conn, () => conn.session.actions.length >= 25);
    await settle();
    const record = (await readInProgress(env.db)).records[0]!;
    const restored = new LocalConnection(GameSession.fromJSON({ config: record.head.config, actions: record.log.actions.slice(0, 20) }));
    GameRecorder.resume(restored, record, env);
    await settle();
    const again = (await readInProgress(env.db)).records[0]!;
    expect(again.log.actions).toEqual(record.log.actions.slice(0, 20));
    expect(again.stored).toBe(20);
  });
});

describe('RPL-1: the game becomes a library entry when it ends (CR 104) or when the player leaves the game screen', () => {
  it('a finished game: a checked game replay with the last checkpoint, the result, and no in-progress record left', async () => {
    const env = testEnv();
    const conn = new LocalConnection(duel('rpl1-end', 4));
    const rec = GameRecorder.start(conn, { format: 'standard' }, env);
    await playUntil(conn, () => conn.session.state.result !== null);
    expect(conn.session.state.result).not.toBeNull();
    await rec.finish();
    expect((await readInProgress(env.db)).records).toEqual([]);
    const entries = await env.library.list();
    expect(entries).toHaveLength(1);
    const file = await storedFile(env, entries[0]!.key);
    expect(checkReplay(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    expect(file.kind).toBe('game');
    expect(file.title).toBe('Alice vs Bob, Standard');
    expect(file.game).toMatchObject({ mode: 'hotseat', format: 'standard', savedBy: null, ended: 'finished', actions: conn.session.actions.length });
    expect(file.game.result).toEqual(conn.session.state.result);
    expect(file.game.turns).toBe(conn.session.state.turn.number);
    const last = file.play!.checkpoints[file.play!.checkpoints.length - 1]!;
    expect(last).toEqual({ action: conn.session.actions.length - 1, turn: conn.session.state.turn.number, digest: gameDigest(conn.session.state) });
    // the game replays to the same end (D1: playback runs the engine again)
    const again = replay(file.play!.config, file.play!.actions);
    expect(again.errors).toEqual([]);
    expect(gameDigest(again.state)).toBe(last.digest);
    expect(file.engine.build).toBe('test-engine-build');
    expect(file.app).toEqual({ version: '0.0.0-test', commit: 'testcommit' });
  });

  it('CR 104.3a: a conceded game is saved as conceded', async () => {
    const env = testEnv();
    const conn = new LocalConnection(duel('rpl1-concede'));
    const rec = GameRecorder.start(conn, { format: 'casual' }, env);
    await playUntil(conn, () => conn.session.actions.length >= 12);
    expect((await conn.act({ type: 'concede', player: 'p2' })).ok).toBe(true);
    await rec.finish();
    const file = await storedFile(env, (await env.library.list())[0]!.key);
    expect(file.game.ended).toBe('conceded');
    expect(file.game.result!.winner).toBe('p1');
  });

  it('leaving the game screen through the navigation saves an unfinished game as abandoned', async () => {
    const env = testEnv();
    const conn = recordLocalGame(new LocalConnection(duel('rpl1-leave')), { format: 'pioneer' }, env);
    const sealed = sealConnection(conn);
    expect(liveReplayOf(sealed)).not.toBeNull();
    await playUntil(conn, () => conn.session.actions.length >= 20);
    let nav: Nav | null = null;
    function Grab() {
      const n = useNav();
      useEffect(() => {
        nav = n;
      });
      return null;
    }
    render(
      <NavProvider initial={{ screen: 'game', connection: sealed }}>
        <Grab />
      </NavProvider>,
    );
    // Settings over the game keeps it on the back stack: not left
    reactAct(() => nav!.go({ screen: 'settings' }));
    await settle();
    expect(await env.library.list()).toEqual([]);
    reactAct(() => nav!.back());
    reactAct(() => nav!.reset({ screen: 'home' }));
    await settle();
    const entries = await env.library.list();
    expect(entries).toHaveLength(1);
    const file = await storedFile(env, entries[0]!.key);
    expect(file.game).toMatchObject({ ended: 'abandoned', result: null, actions: 20, format: 'pioneer', turns: conn.session.state.turn.number });
    expect(liveReplayOf(sealed)!.state().phase).toBe('saved');
    expect((await readInProgress(env.db)).records).toEqual([]);
  });

  it('removing older replays failed after the save: the end screen says saved, the toggles and Keep land, and the worker completes it', async () => {
    const db = new FlakyReplayDb();
    const env = testEnv({ db, limit: 1, completer: inlineCompleter });
    const older = recordLocalGame(new LocalConnection(duel('rpl1-retain-older')), { format: 'casual' }, env);
    await playUntil(older, () => older.session.actions.length >= 10);
    leftGameScreen(older);
    await settle(40);
    // retention's delete fails (the replay itself was written)
    db.fails = (ops) => ops.some((op) => 'delete' in op && op.store === 'library');
    const conn = new LocalConnection(duel('rpl1-retain-fails', 4));
    const rec = GameRecorder.start(conn, { format: 'casual' }, env);
    await playUntil(conn, () => conn.session.state.result !== null);
    const entry = await rec.finish();
    expect(entry).not.toBeNull();
    expect(rec.live.state().phase).toBe('saved');
    rec.live.setAgreed('p1', true);
    rec.live.setAgreed('p2', true);
    rec.live.setKept(true);
    await settle(40);
    expect((await env.library.entry(entry!.key))!.keep).toBe(true);
    const file = await storedFile(env, entry!.key);
    expect(file.reveal).toEqual({ policy: 'all', agreed: ['p1', 'p2'] });
    expect(file.recording).toBeDefined();
    expect((await readInProgress(db)).records).toEqual([]);
  });

  it('a game left before its first action is not kept', async () => {
    const env = testEnv();
    const conn = recordLocalGame(new LocalConnection(duel('rpl1-empty')), { format: 'casual' }, env);
    leftGameScreen(sealConnection(conn));
    await settle();
    expect(await env.library.list()).toEqual([]);
    expect((await readInProgress(env.db)).records).toEqual([]);
  });

  it('against the computer: the person is the saver, the computer a computer seat, and the replay records the AI stops it was played with', async () => {
    const env = testEnv();
    const game = recordLocalGame(new ComputerGame(duel('rpl1-computer'), 'p1', 'p2', { delayMs: 0, seed: 'c' }), { format: 'casual' }, env);
    await playUntil(game.local, () => game.local.session.actions.length >= 10);
    leftGameScreen(game);
    await settle();
    const file = await storedFile(env, (await env.library.list())[0]!.key);
    expect(file.game.mode).toBe('computer');
    expect(file.game.savedBy).toBe('p1');
    expect(file.game.players.map((p) => p.kind)).toEqual(['person', 'computer']);
    expect(file.play!.config).toEqual(game.local.session.config);
    expect(file.reveal).toEqual({ policy: 'all', agreed: ['p1'] });
  });
});

/** Write the record of a game played on another page (one that closed without saving it). */
async function writeOrphanedRecord(env: ReturnType<typeof testEnv>, seed: string, actions: number, startMs: number, life = 6): Promise<{ head: InProgressHead; state: GameState }> {
  const conn = new LocalConnection(duel(seed, life));
  await playUntil(conn, () => conn.session.actions.length >= actions);
  const info = recordedGameInfo(conn, 'standard', `r-${seed}`, startMs, env);
  const head: InProgressHead = { ...info, key: info.id, type: 'head', version: RECORD_VERSION, startMs, agreed: [] };
  const s = new GameSession(conn.session.config);
  const ops = [headOp(head)];
  conn.session.actions.forEach((a, i) => {
    const before = s.state;
    s.apply(a);
    ops.push(actionOp(head.id, i, a, (i + 1) * 1000, checkpointAfter(i, before.turn.number, s.state, false)));
  });
  await env.db.write(ops);
  return { head, state: conn.session.state };
}

describe('RPL-1: at start, an in-progress record whose game screen is gone becomes an abandoned entry (design 7.1)', () => {
  it('saves the record as an abandoned game replay and removes it; a record another tab still holds is left alone', async () => {
    const clock = testClock();
    const gone = await writeOrphanedRecord(testEnv(), 'rpl1-gone', 30, clock.now() - 3_600_000);
    const env = testEnv({ now: clock.now, liveness: heldBy(['r-rpl1-held']) });
    await writeOrphanedRecord(env, 'rpl1-gone', 30, clock.now() - 3_600_000);
    await writeOrphanedRecord(env, 'rpl1-held', 12, clock.now() - 60_000);
    expect(await finishAbandoned(env)).toEqual([gone.head.id]);
    const entries = await env.library.list();
    expect(entries.map((e) => e.key)).toEqual([gone.head.id]);
    const file = await storedFile(env, gone.head.id);
    expect(file.game.ended).toBe('abandoned');
    expect(file.game.actions).toBe(30);
    expect(file.game.turns).toBe(gone.state.turn.number);
    expect(file.game.endedAt).toBe(new Date(gone.head.startMs + 30_000).toISOString());
    expect(checkReplay(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    const left = (await readInProgress(env.db)).records.map((r) => r.head.id);
    expect(left).toEqual(['r-rpl1-held']);
  });

  it('without Web Locks a record is abandoned once it was not touched for a while', async () => {
    const clock = testClock();
    const env = testEnv({ now: clock.now, liveness: timeLiveness });
    await writeOrphanedRecord(env, 'rpl1-old', 10, clock.now() - STALE_MS - 20_000);
    await writeOrphanedRecord(env, 'rpl1-recent', 10, clock.now() - 60_000);
    expect(await finishAbandoned(env)).toEqual(['r-rpl1-old']);
  });

  it('under the same build the worker completes it: the recording, the last checkpoint, and the result when the game had in fact ended', async () => {
    const clock = testClock();
    const env = testEnv({ now: clock.now, completer: inlineCompleter });
    // the tab closed on the end screen, before the replay was saved
    const { head, state } = await writeOrphanedRecord(env, 'rpl1-ended', 100_000, clock.now() - 3_600_000, 4);
    expect(state.result).not.toBeNull();
    expect(await finishAbandoned(env)).toEqual([head.id]);
    await settle(40);
    const file = await storedFile(env, head.id);
    expect(file.recording).toBeDefined();
    expect(file.game.ended).toBe('finished');
    expect(file.game.result).toEqual(state.result);
    const last = file.play!.checkpoints[file.play!.checkpoints.length - 1]!;
    expect(last).toEqual({ action: file.play!.actions.length - 1, turn: state.turn.number, digest: gameDigest(state) });
    expect(checkReplay(JSON.parse(JSON.stringify(file))).ok).toBe(true);
  });

  it('a game this page is recording is never swept, whatever the locks say', async () => {
    const env = testEnv();
    const conn = new LocalConnection(duel('rpl1-mine'));
    GameRecorder.start(conn, { format: 'casual' }, env);
    await playUntil(conn, () => conn.session.actions.length >= 5);
    await settle();
    expect(await finishAbandoned(env)).toEqual([]);
    expect((await readInProgress(env.db)).records).toHaveLength(1);
  });
});

describe('RPL-1: a replay whose worker was cut short is completed at the next start (design 7.1, 14.1: the recording keeps it watchable)', () => {
  it('a finished game saved by a page that closed while its worker ran gets its recording; a rename and a toggle made meanwhile are kept', async () => {
    const db = new MemoryReplayDb();
    const env = testEnv({ db, completer: pageClosedCompleter });
    const conn = new LocalConnection(duel('rpl1-resume-closed', 4));
    const rec = GameRecorder.start(conn, { format: 'casual' }, env);
    await playUntil(conn, () => conn.session.state.result !== null);
    const entry = (await rec.finish())!;
    rec.live.setAgreed('p1', true);
    await env.library.rename(entry.key, 'Our game');
    await settle();
    expect((await storedFile(env, entry.key)).recording).toBeUndefined();
    expect((await env.library.entry(entry.key))!.completion).toEqual({ tries: 0 });
    // the next page
    const next = testEnv({ db, completer: inlineCompleter });
    expect(await finishAbandoned(next)).toEqual([]);
    await settle(40);
    const file = await storedFile(next, entry.key);
    expect(file.recording!.frames).toHaveLength(file.play!.actions.length + 1);
    expect(file.title).toBe('Our game');
    expect(file.reveal.agreed).toEqual(['p1']);
    const listed = (await next.library.list())[0]!;
    expect(listed.summary.hasRecording).toBe(true);
    expect(listed.completion).toBeUndefined();
  });

  it('an abandoned record of a game that had ended gets its result and its recording, though the first sweep\'s worker was cut short', async () => {
    const clock = testClock();
    const db = new MemoryReplayDb();
    const first = testEnv({ db, now: clock.now, completer: pageClosedCompleter });
    const { head, state } = await writeOrphanedRecord(first, 'rpl1-resume-ended', 100_000, clock.now() - 3_600_000, 4);
    expect(state.result).not.toBeNull();
    expect(await finishAbandoned(first)).toEqual([head.id]);
    await settle();
    expect((await storedFile(first, head.id)).game).toMatchObject({ ended: 'abandoned', result: null });
    const next = testEnv({ db, now: clock.now, completer: inlineCompleter });
    expect(await finishAbandoned(next)).toEqual([]);
    await settle(40);
    const file = await storedFile(next, head.id);
    expect(file.recording).toBeDefined();
    expect(file.game.ended).toBe('finished');
    expect(file.game.result).toEqual(state.result);
  });

  it('a crash after the entry was saved and before its record was removed: the next start removes the record and completes the entry', async () => {
    const clock = testClock();
    const env = testEnv({ now: clock.now, completer: inlineCompleter });
    const { head } = await writeOrphanedRecord(env, 'rpl1-resume-crash', 30, clock.now() - 3_600_000);
    // what GameRecorder.save had written when the page went
    const record = (await readInProgress(env.db)).records[0]!;
    const saved = gameReplayFile({ info: record.head, log: record.log, ending: null, endedAt: new Date(clock.now()).toISOString(), agreed: record.head.agreed });
    await env.library.add(saved, { toComplete: true });
    expect(await finishAbandoned(env)).toEqual([]);
    await settle(40);
    expect((await readInProgress(env.db)).records).toEqual([]);
    expect((await storedFile(env, head.id)).recording).toBeDefined();
  });
});
