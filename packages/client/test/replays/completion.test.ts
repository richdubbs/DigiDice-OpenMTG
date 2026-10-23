/**
 * RPL-1 (replays design 3, 7.1, 14.1): completing a replay after the game outlives the page. A replay saved of a game played here keeps its
 * completion mark until its fallback recording lands, and every start completes the marked ones again (recorder.test.tsx shows a closed page's
 * replay caught up). Completing one is given up after a few failed runs, at once for a game that does not play here as it was recorded, and without a
 * run for a replay of another build. An imported replay is kept as it was given: it is never completed.
 */
import { describe, expect, it } from 'vitest';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { COMPLETION_TRIES, type Completer } from '../../src/replays/completion';
import { MemoryReplayDb } from '../../src/replays/db';
import { GameRecorder, finishAbandoned } from '../../src/replays/recorder';
import { duel, inlineCompleter, pageClosedCompleter, playUntil, settle, testEnv } from './helpers';

/** A finished game saved by a page that closed while its worker ran: its replay waits for its recording. */
async function waitingReplay(seed: string): Promise<{ db: MemoryReplayDb; id: string }> {
  const db = new MemoryReplayDb();
  const env = testEnv({ db, completer: pageClosedCompleter });
  const conn = new LocalConnection(duel(seed, 4));
  const rec = GameRecorder.start(conn, { format: 'casual' }, env);
  await playUntil(conn, () => conn.session.state.result !== null);
  const entry = await rec.finish();
  await settle();
  expect((await env.library.entry(entry!.key))!.completion).toEqual({ tries: 0 });
  return { db, id: entry!.key };
}

/** A page opening over `db`: its start-up sweep, and the completion jobs it queued run to their end. */
async function pageStart(db: MemoryReplayDb, completer: Completer, build?: string): Promise<ReturnType<typeof testEnv>> {
  const env = testEnv({ db, completer, ...(build !== undefined ? { build } : {}) });
  await finishAbandoned(env);
  await settle(40);
  return env;
}

/** A completer that counts its runs and answers as `answer` does. */
function counted(answer: Completer): Completer & { runs: number } {
  const c = Object.assign((async (file, build) => {
    c.runs++;
    return answer(file, build);
  }) as Completer, { runs: 0 });
  return c;
}

describe('RPL-1: completing a replay after the game outlives the page, and is given up when it cannot succeed (design 3, 7.1, 14.1)', () => {
  it(`a worker that fails is tried again at the next start, and given up after ${COMPLETION_TRIES} runs; the replay stays as it was saved`, async () => {
    const { db, id } = await waitingReplay('rpl1-completion-tries');
    const failing = counted(async () => null);
    for (let i = 0; i < COMPLETION_TRIES + 2; i++) await pageStart(db, failing);
    expect(failing.runs).toBe(COMPLETION_TRIES);
    const env = testEnv({ db });
    expect((await env.library.entry(id))!.completion).toBeUndefined();
    const read = await env.library.read(id);
    expect(read.ok && read.value.recording).toBeUndefined();
    expect(read.ok && read.value.game.ended).toBe('finished');
  });

  it('a game that does not play here as it was recorded is given up after its one run (it never will under this build)', async () => {
    const { db, id } = await waitingReplay('rpl1-completion-differs');
    const differs = counted(async () => ({
      checkpoints: [],
      final: { turns: 0, result: null, ended: null },
      problem: 'This version of OpenMTG plays the game differently than it was recorded.',
    }));
    await pageStart(db, differs);
    await pageStart(db, differs);
    expect(differs.runs).toBe(1);
    expect((await testEnv({ db }).library.entry(id))!.completion).toBeUndefined();
  });

  it('a replay of another build is given up without a run: only the build that played it can record it', async () => {
    const { db, id } = await waitingReplay('rpl1-completion-build');
    const worker = counted(inlineCompleter);
    const env = await pageStart(db, worker, 'another-engine-build');
    expect(worker.runs).toBe(0);
    expect((await env.library.entry(id))!.completion).toBeUndefined();
    const read = await env.library.read(id);
    expect(read.ok && read.value.recording).toBeUndefined();
  });

  it('RPL-3: a recording saved to be replaced stays through a rename and a failed run; the worker\'s replaces it when a run succeeds', async () => {
    const { db, id } = await waitingReplay('rpl3-completion-replace');
    const env = testEnv({ db });
    const read = await env.library.read(id);
    if (!read.ok) throw new Error(read.error.message);
    // A recording of its own (an online guest's live one; here the first two frames of the worker's).
    const whole = (await inlineCompleter(read.value, env.build))!.recording!;
    await env.library.add({ ...read.value, recording: { ...whole, frames: whole.frames.slice(0, 2) } }, { toComplete: 'replace' });
    expect((await env.library.entry(id))!.completion).toEqual({ tries: 0, replace: true });
    await env.library.rename(id, 'Renamed while it waits');
    expect((await env.library.entry(id))!.completion).toEqual({ tries: 0, replace: true });
    await pageStart(db, counted(async () => null));
    expect((await env.library.entry(id))!.completion).toEqual({ tries: 1, replace: true });
    const kept = await env.library.read(id);
    expect(kept.ok && kept.value.recording!.frames).toHaveLength(2);
    await pageStart(db, inlineCompleter);
    expect((await env.library.entry(id))!.completion).toBeUndefined();
    const done = await env.library.read(id);
    if (!done.ok) throw new Error(done.error.message);
    expect(done.value.recording!.frames).toHaveLength(whole.frames.length);
    expect(done.value.title).toBe('Renamed while it waits');
  });

  it('an imported replay is kept as it was given: it is never completed', async () => {
    const { db, id } = await waitingReplay('rpl1-completion-import');
    const bytes = (await testEnv({ db }).library.bytes(id))!;
    const other = new MemoryReplayDb();
    const env = testEnv({ db: other, completer: inlineCompleter });
    expect((await env.library.importBytes(bytes)).ok).toBe(true);
    expect((await env.library.entry(id))!.completion).toBeUndefined();
    await pageStart(other, inlineCompleter);
    expect(Array.from((await env.library.bytes(id))!)).toEqual(Array.from(bytes));
  });
});
