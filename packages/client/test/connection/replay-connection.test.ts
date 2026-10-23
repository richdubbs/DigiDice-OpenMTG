/**
 * RPL-2 (replays design 5, 6, 8): a replay played back through `ReplayConnection`. Every seat's views and events equal the live game's (`LocalConnection`)
 * at every step of seeded AI games; seeking and stepping back give the same view as playing forward; the reveal policy is enforced by the connection
 * (CR 400.2); under another engine build a replay is checked first and plays exactly up to its last matching checkpoint, then its recording takes over or
 * it stops with the explanation; a damaged frame ends a recording at the frame before it.
 */
import { checkReplay, openView, viewFor, type GameEvent, type ReplayFile } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { createReplayConnection, REPLAY_ACT_REFUSED, ReplayUnplayable, type ReplayConnection } from '../../src/connection/ReplayConnection';
import { inlineChecker, type CheckOutcome, type ReplayChecker } from '../../src/replays/viewer/check';
import { OPEN, PUBLIC, seat } from '../../src/replays/viewer/policy';
import { replayControllerOf } from '../../src/replays/viewer/controllerOf';
import { sealConnection } from '../../src/game/sealed';
import { GameTimeline, SNAPSHOT_EVERY } from '../../src/replays/viewer/timeline';
import { SLOW, slowTitle } from '../../../engine/test/slow';
import { aiGame, instantChecker, recordingFileOf, replayFileOf, rerun, TEST_BUILD, type PlayedGame } from './replay-files';

const json = (x: unknown): string => JSON.stringify(x);
const OTHER_BUILD = 'f'.repeat(64);

/** The live game: a LocalConnection seating only `player`, driven with the log (the other seat acts through its own connection). */
async function liveViews(g: PlayedGame, player: string): Promise<{ views: string[]; events: GameEvent[][] }> {
  const local = new LocalConnection(g.config, { seats: [player] });
  const views = [json(local.view())];
  const events: GameEvent[][] = [[]];
  for (const a of g.actions) {
    const by = 'player' in a && a.player !== player ? local.seat(a.player) : local;
    const r = await by.act(a);
    if (!r.ok) throw new Error(`the live game refused ${a.type}: ${r.error.message}`);
    views.push(json(local.view()));
    events.push([...local.events().events]);
  }
  return { views, events };
}

/**
 * A replay connection of `file` once its background work is done (`wait`). A file of this build skips the background check (tested by itself below);
 * another build's is checked for real.
 */
async function opened(file: ReplayFile, opts: Parameters<typeof createReplayConnection>[1] = {}, wait = true): Promise<ReplayConnection> {
  const checker = file.engine.build === TEST_BUILD ? instantChecker : undefined;
  const conn = createReplayConnection(file, { engineBuild: TEST_BUILD, sliceMs: 40, ...(checker ? { checker } : {}), ...opts });
  if (wait) await conn.controller.ready();
  return conn;
}

/** Play `seed`'s AI game through a ReplayConnection seat by seat and compare every step with the live game. */
async function sameAsLive(seed: string, d1: number, d2: number): Promise<void> {
  const g = aiGame(seed, d1, d2);
  expect(g.actions.length).toBeGreaterThan(40);
  const file = replayFileOf(g);
  expect(checkReplay(JSON.parse(json(file))).ok).toBe(true);
  for (const player of ['p1', 'p2']) {
    const live = await liveViews(g, player);
    const conn = await opened(file, { perspective: seat(player) }, false);
    const c = conn.controller;
    expect(c.state().perspective).toEqual(seat(player));
    expect(json(conn.view()), `${player} at the start`).toBe(live.views[0]);
    let seq = conn.events().seq;
    for (let i = 1; i <= g.actions.length; i++) {
      expect(c.step(1)).toBe(true);
      expect(c.state().position).toBe(i);
      expect(json(conn.view()), `${player} after action ${i}`).toBe(live.views[i]);
      const batch = conn.events();
      expect(batch.seq).toBe(seq + 1);
      seq = batch.seq;
      expect(json(batch.events), `${player}'s events of action ${i}`).toBe(json(live.events[i]));
    }
    expect(c.step(1)).toBe(false);
    expect(c.state().label).toMatch(new RegExp(`action ${g.actions.length} of ${g.actions.length}$`));
    c.dispose();
  }
}

/** The AI game most tests here use (106 actions, 18 turns, a win); two more run with the slow suites. */
const GAME: [string, number, number] = ['rpl2-b', 1, 2];
const MORE_GAMES: [string, number, number][] = [['rpl2-a', 0, 1], ['rpl2-c', 2, 0]];

describe('RPL-2: a replay shows what the live game showed (replays design 8)', { timeout: 300_000 }, () => {
  it.each([GAME])('every seat\'s views and events equal the live ones at every step (AI game %s)', sameAsLive);

  describe.skipIf(!SLOW)(slowTitle('more AI games'), () => {
    it.each(MORE_GAMES)('every seat\'s views and events equal the live ones at every step (AI game %s)', sameAsLive);
  });

  it('the public view and the open view are the engine\'s, with their events (design 6)', async () => {
    const g = aiGame(...GAME);
    const conn = await opened(replayFileOf(g, { agreed: ['p1'] }), {}, false);
    const c = conn.controller;
    for (const [p, viewOf] of [[PUBLIC, (i: number) => viewFor(g.states[i]!, null)], [OPEN, (i: number) => openView(g.states[i]!)]] as const) {
      expect(c.setPerspective(p)).toEqual({ ok: true });
      for (let i = 0; i <= g.actions.length; i += 7) {
        c.seek(i);
        expect(json(conn.view())).toBe(json(viewOf(i)));
      }
    }
    // The open view's events are every event the engine returned (less those it was given at the stop), so they name the computer's draws.
    c.seek(0);
    c.setPerspective(OPEN);
    const opened_: GameEvent[] = [];
    const hidden: GameEvent[] = [];
    for (let i = 1; i <= Math.min(60, g.actions.length); i++) {
      c.step(1);
      opened_.push(...conn.events().events);
    }
    c.seek(0);
    c.setPerspective(seat('p1'));
    for (let i = 1; i <= Math.min(60, g.actions.length); i++) {
      c.step(1);
      hidden.push(...conn.events().events);
    }
    const drawsOf = (es: GameEvent[]) => es.filter((e): e is Extract<GameEvent, { type: 'drew' }> => e.type === 'drew' && e.player === 'p2');
    expect(drawsOf(opened_).length).toBeGreaterThan(0);
    expect(drawsOf(opened_).every((e) => e.objectId !== '')).toBe(true);
    expect(drawsOf(hidden).every((e) => e.objectId === '')).toBe(true);
    c.dispose();
  });

  it('seeking and stepping back give the same view as playing forward, shown at once (design 8, "States")', async () => {
    const g = aiGame(...GAME);
    const conn = await opened(replayFileOf(g));
    const c = conn.controller;
    const forward: string[] = [json(conn.view())];
    for (let i = 1; i <= g.actions.length; i++) {
      c.step(1);
      forward.push(json(conn.view()));
    }
    // Step back all the way: every view is the forward one, every change has a new seq and no events (nothing is animated backwards).
    for (let i = g.actions.length - 1; i >= 0; i--) {
      const seq = conn.events().seq;
      expect(c.step(-1)).toBe(true);
      expect(json(conn.view()), `back to ${i}`).toBe(forward[i]);
      expect(conn.events()).toEqual({ seq: seq + 1, events: [] });
    }
    expect(c.step(-1)).toBe(false);
    // Jumps anywhere, in a fixed scattered order.
    const n = g.actions.length;
    for (const k of [n, 3, Math.floor(n / 2), 1, n - 1, 17, 0, Math.floor(n / 3), n]) {
      c.seek(k);
      expect(c.state().position).toBe(k);
      expect(json(conn.view()), `seek ${k}`).toBe(forward[k]);
      expect(conn.events().events).toEqual([]);
    }
    // A turn's start is where its turn number first appears, and the ticks are the turns' starts.
    const turnOf = (i: number) => g.states[i]!.turn.number;
    for (const turn of [2, 3, 5]) {
      expect(c.seekTurn(turn)).toBe(true);
      const p = c.state().position;
      expect(turnOf(p)).toBe(turn);
      expect(turnOf(p - 1)).toBe(turn - 1);
      expect(c.state().ticks.some((t) => t.position === p && t.turn === turn)).toBe(true);
      expect(c.state().label).toMatch(new RegExp(`^Turn ${turn} · `));
    }
    c.seekTurn(5);
    c.step(1);
    c.step(1);
    expect(c.previousTurn()).toBe(true);
    expect(turnOf(c.state().position)).toBe(5);
    expect(turnOf(c.state().position - 1)).toBe(4);
    c.previousTurn();
    expect(turnOf(c.state().position)).toBe(4);
    c.nextTurn();
    expect(turnOf(c.state().position)).toBe(5);
    // Markers: spells cast, combat damage, life changes, at positions whose change did that.
    const kinds = new Set(c.state().markers.flatMap((m) => m.kinds));
    expect(kinds.has('spell')).toBe(true);
    expect(kinds.has('life')).toBe(true);
    c.dispose();
  });

  it('snapshots per turn start: reaching any position runs at most one turn, and never 20 actions, of the log', () => {
    const g = aiGame(...GAME);
    const play = replayFileOf(g).play!;
    const timeline = new GameTimeline(play, g.states[0]!);
    expect(timeline.extend()).toBe(true);
    let steps = 0;
    const stepInto = timeline.stepInto.bind(timeline);
    timeline.stepInto = (prev, p) => {
      steps++;
      return stepInto(prev, p);
    };
    const turnStart = (p: number) => {
      let q = p;
      while (q > 0 && g.states[q - 1]!.turn.number === g.states[p]!.turn.number) q--;
      return q;
    };
    const n = g.actions.length;
    for (let i = 0; i < 40; i++) {
      const p = (i * 7919) % (n + 1);
      steps = 0;
      const s = timeline.stateAt(p);
      expect(json(s), `position ${p}`).toBe(json(g.states[p]));
      expect(steps).toBeLessThan(SNAPSHOT_EVERY);
      expect(steps).toBeLessThanOrEqual(p - turnStart(p));
    }
  });
});

describe('RPL-2: whose view (replays design 6, CR 400.2)', { timeout: 300_000 }, () => {
  it('a replay is read-only: no legal actions, act refuses, no undo, no hand-off, nobody seated', async () => {
    const conn = await opened(replayFileOf(aiGame(...GAME)), {}, false);
    expect(conn.kind).toBe('replay');
    expect(conn.legalActions()).toEqual([]);
    expect(await conn.act({ type: 'concede', player: 'p1' })).toEqual({ ok: false, error: { message: REPLAY_ACT_REFUSED, rules: [] } });
    expect(conn.canUndo()).toBe(false);
    expect(conn.undo()).toBe(false);
    expect(conn.handoff()).toBeNull();
    expect(conn.seated!()).toEqual([]);
    // The controller is found through the connection and through its sealed form (what the game screen holds).
    expect(replayControllerOf(conn)).toBe(conn.controller);
    expect(replayControllerOf(sealConnection(conn))).toBe(conn.controller);
    conn.controller.dispose();
  });

  it('CR 400.2: in hot-seat a seat view or the open view is refused without everyone\'s agreement', async () => {
    const g = aiGame(...GAME);
    const conn = await opened(replayFileOf(g, { mode: 'hotseat', agreed: ['p1'], noRecording: true }), {}, false);
    const c = conn.controller;
    expect(c.state().perspective).toEqual(PUBLIC);
    expect(c.state().perspectives).toEqual([PUBLIC]);
    for (const p of [seat('p1'), seat('p2'), OPEN]) {
      const r = c.setPerspective(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toMatch(/CR 400\.2/);
      expect(c.state().perspective).toEqual(PUBLIC);
    }
    expect(conn.view().viewer).toBeNull();
    expect(conn.view().open).toBeUndefined();
    // Asking for another perspective when opening is refused the same way.
    const asked = await opened(replayFileOf(g, { mode: 'hotseat', agreed: [], noRecording: true }), { perspective: OPEN }, false);
    expect(asked.controller.state().perspective).toEqual(PUBLIC);
    expect(asked.view().open).toBeUndefined();
    // With both people's agreement every seat and the open view are allowed.
    const agreed = await opened(replayFileOf(g, { mode: 'hotseat', agreed: ['p1', 'p2'], noRecording: true }), {}, false);
    expect(agreed.controller.state().perspectives).toEqual([seat('p1'), seat('p2'), PUBLIC, OPEN]);
    expect(agreed.controller.setPerspective(seat('p2'))).toEqual({ ok: true });
    expect(json(agreed.view())).toBe(json(viewFor(g.states[0]!, 'p2')));
    for (const x of [c, asked.controller, agreed.controller]) x.dispose();
  });

  it('design 16.1: against the computer the person\'s own seat, the public and the open view need no agreement; the computer\'s seat does', async () => {
    const g = aiGame(...GAME);
    const conn = await opened(replayFileOf(g, { agreed: [], noRecording: true }), {}, false);
    const c = conn.controller;
    expect(c.state().perspective).toEqual(seat('p1'));
    expect(c.state().perspectives).toEqual([seat('p1'), PUBLIC, OPEN]);
    expect(c.setPerspective(seat('p2')).ok).toBe(false);
    expect(c.setPerspective(OPEN)).toEqual({ ok: true });
    expect(conn.view().open).toBe(true);
    c.dispose();
    // RPL-1 records the lone person as having agreed: then every seat may be shown.
    const all = await opened(replayFileOf(g, { agreed: ['p1'], noRecording: true }), {}, false);
    expect(all.controller.state().perspectives).toEqual([seat('p1'), seat('p2'), PUBLIC, OPEN]);
    all.controller.dispose();
  });

  it('a recording shows only its own viewer, with the events it recorded', async () => {
    const g = aiGame(...GAME);
    const file = recordingFileOf(g, 'p2');
    expect(checkReplay(JSON.parse(json(file))).ok).toBe(true);
    const conn = await opened(file);
    const c = conn.controller;
    expect(c.state().badge).toBe('recording');
    expect(c.state().perspectives).toEqual([]);
    expect(c.state().perspectiveFixed).toBe(true);
    expect(c.setPerspective(PUBLIC).ok).toBe(false);
    const { defs: _d, ...want } = viewFor(g.states[5]!, 'p2');
    c.seek(4);
    c.step(1);
    const { defs: _e, ...got } = conn.view();
    expect(json(got)).toBe(json(want));
    expect(conn.events().events).toEqual(file.recording!.frames[5]!.events);
    c.dispose();
  });
});

/** A checker that answers when the test says so. */
function heldChecker(): ReplayChecker & { release(): Promise<void> } {
  let go: (() => void) | null = null;
  const inner = inlineChecker();
  return {
    check(play, onProgress) {
      return new Promise<CheckOutcome>((resolve) => {
        go = () => void inner.check(play, onProgress).then(resolve);
      });
    },
    cancel() {},
    async release() {
      go?.();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

/** The file with the digest of its `k`-th checkpoint changed (as a build that plays the game differently from there computes it). */
function doctoredDigest(file: ReplayFile, k: number): ReplayFile {
  const out = JSON.parse(json(file)) as ReplayFile;
  const c = out.play!.checkpoints[k]!;
  c.digest = c.digest.replace(/.$/, (d) => (d === '0' ? '1' : '0'));
  return out;
}

describe('RPL-2: a replay never plays wrong (replays design 5)', { timeout: 300_000 }, () => {
  it('under the same build the replay is exact and plays at once; its digests are checked in the background', async () => {
    const g = aiGame(...GAME);
    const held = heldChecker();
    const conn = createReplayConnection(replayFileOf(g), { engineBuild: TEST_BUILD, checker: held });
    expect(conn.controller.state().badge).toBe('exact');
    expect(conn.controller.state().playable).toBe(true);
    expect(conn.controller.step(1)).toBe(true);
    await held.release();
    await conn.controller.ready();
    expect(conn.controller.state().badge).toBe('exact');
    expect(conn.status!()).toBeNull();
    conn.controller.dispose();
  });

  it('under another build it is checked before it plays, then "Checked on this version"', async () => {
    const g = aiGame(...GAME);
    const held = heldChecker();
    const conn = createReplayConnection(replayFileOf(g, { build: OTHER_BUILD }), { engineBuild: TEST_BUILD, checker: held });
    const c = conn.controller;
    expect(c.state().badge).toBe('checking');
    expect(c.state().playable).toBe(false);
    expect(c.step(1)).toBe(false);
    expect(c.seek(10)).toBe(false);
    c.play();
    expect(c.state().playing).toBe(false);
    expect(conn.status!()).toMatch(/^Checking this replay on this version of OpenMTG/);
    await held.release();
    await c.ready();
    expect(c.state().badge).toBe('checked');
    expect(c.state().statusText).toBe('Checked on this version');
    expect(c.state().last).toBe(g.actions.length);
    expect(c.seek(10)).toBe(true);
    c.dispose();
  });

  it('a digest that differs: it plays exactly up to the last matching checkpoint, then its recording takes over', async () => {
    const g = aiGame(...GAME);
    const base = replayFileOf(g, { build: OTHER_BUILD });
    const k = Math.floor(base.play!.checkpoints.length / 2);
    const verified = base.play!.checkpoints[k - 1]!.action + 1;
    const conn = await opened(doctoredDigest(base, k), { perspective: OPEN });
    const c = conn.controller;
    const s = c.state();
    const turn = g.states[verified]!.turn.number;
    expect(s.badge).toBe('recordingFrom');
    expect(s.statusText).toBe(`Recording from turn ${turn}`);
    expect(conn.status!()).toBe(
      `From turn ${turn} this replay shows the recording; this version of OpenMTG plays the game differently than the one it was played on, commit 2a8e88ae, 2026-10-18.`,
    );
    expect(s.last).toBe(g.actions.length);
    // Up to the checkpoint: the game, in the chosen perspective (the open view).
    c.seek(verified);
    expect(json(conn.view())).toBe(json(openView(g.states[verified]!)));
    expect(c.state().perspectiveFixed).toBe(false);
    // After it: the recording, in its own perspective (p1), and the perspective can no longer be switched.
    c.step(1);
    const { defs: _d, ...want } = viewFor(g.states[verified + 1]!, 'p1');
    const { defs: _e, ...got } = conn.view();
    expect(json(got)).toBe(json(want));
    expect(conn.events().events).toEqual([]); // the switch from the open view to p1's is shown at once
    expect(c.state().perspective).toEqual(seat('p1'));
    expect(c.state().perspectiveFixed).toBe(true);
    expect(c.setPerspective(OPEN).ok).toBe(false);
    c.step(1);
    expect(conn.events().events).toEqual(base.recording!.frames[verified + 2]!.events);
    c.dispose();
  });

  it('without a recording it stops there: "You can watch it up to turn N"', async () => {
    const g = aiGame(...GAME);
    const base = replayFileOf(g, { build: OTHER_BUILD, noRecording: true });
    const k = Math.floor(base.play!.checkpoints.length / 2);
    const verified = base.play!.checkpoints[k - 1]!.action + 1;
    const conn = await opened(doctoredDigest(base, k));
    const c = conn.controller;
    const turn = g.states[verified]!.turn.number;
    expect(c.state().badge).toBe('watchingUpTo');
    expect(c.state().statusText).toBe(`Watching up to turn ${turn}`);
    expect(conn.status!()).toMatch(new RegExp(`You can watch it up to turn ${turn}\\.$`));
    expect(c.state().last).toBe(verified);
    c.seek(verified + 5);
    expect(c.state().position).toBe(verified);
    expect(json(conn.view())).toBe(json(viewFor(g.states[verified]!, 'p1')));
    c.dispose();
  });

  it('a doctored action: the engine refuses it (CR 733), and the replay switches to its recording at the checkpoint before it', async () => {
    const g = aiGame(...GAME);
    const file = replayFileOf(g, { build: OTHER_BUILD });
    const cps = file.play!.checkpoints;
    const bad = cps[Math.floor(cps.length / 2)]!.action + 3;
    // An answer for a decision that is not pending: the engine rejects it, the state is unchanged.
    file.play!.actions[bad] = { type: 'answer', player: 'p1', decisionId: 'no-such-decision', answer: { kind: 'yesNo', yes: true } } as never;
    const conn = await opened(file);
    const c = conn.controller;
    const verified = Math.max(...cps.filter((x) => x.action < bad).map((x) => x.action + 1));
    expect(c.state().badge).toBe('recordingFrom');
    c.seek(verified);
    expect(c.state().perspectiveFixed).toBe(false);
    c.step(1);
    expect(c.state().perspectiveFixed).toBe(true);
    const { defs: _d, ...want } = viewFor(g.states[verified + 1]!, 'p1');
    const { defs: _e, ...got } = conn.view();
    expect(json(got)).toBe(json(want));
    c.dispose();
  });

  it('nothing matches and there is no recording: it cannot be watched here', async () => {
    const g = aiGame(...GAME);
    const conn = await opened(doctoredDigest(replayFileOf(g, { build: OTHER_BUILD, noRecording: true }), 0));
    expect(conn.controller.state().badge).toBe('unplayable');
    expect(conn.controller.state().playable).toBe(false);
    expect(conn.status!()).toMatch(/cannot be watched here/);
    conn.controller.dispose();
  });

  it('another card model: the recording only; nothing readable at all: refused when opened', async () => {
    const g = aiGame(...GAME);
    const file = replayFileOf(g);
    file.engine.model += 1;
    const conn = await opened(file);
    expect(conn.controller.state().badge).toBe('recordingFrom');
    expect(conn.controller.state().perspectiveFixed).toBe(true);
    expect(conn.status!()).toMatch(/card model/);
    conn.controller.dispose();
    const { recording: _r, ...bare } = file;
    expect(() => createReplayConnection(bare as ReplayFile, { engineBuild: TEST_BUILD })).toThrow(ReplayUnplayable);
  });

  it('design 4: a frame that does not fit ends the recording at the frame before it', async () => {
    const g = aiGame(...GAME);
    const file = recordingFileOf(g, 'p1');
    const frames = file.recording!.frames;
    const bad = frames.findIndex((f, i) => i > 30 && f.patch !== undefined);
    frames[bad]!.patch = [{ op: 'set', path: ['zones'], value: null }];
    const conn = await opened(file);
    const c = conn.controller;
    expect(c.state().last).toBe(bad - 1);
    expect(conn.status!()).toMatch(/The recording ends early/);
    c.seek(bad + 10);
    expect(c.state().position).toBe(bad - 1);
    c.dispose();
  });

  it('a replay of an unfinished game, played to its end, rebuilds the last state the log reached', async () => {
    const g = aiGame('rpl2-b', 1, 2, 60);
    const again = rerun(g.config, g.actions);
    const conn = await opened(replayFileOf(g));
    conn.controller.seek(g.actions.length);
    expect(json(conn.view())).toBe(json(viewFor(again.states[again.states.length - 1]!, 'p1')));
    conn.controller.dispose();
  });
});
