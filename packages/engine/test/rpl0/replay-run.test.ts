/**
 * RPL-0 review: a replay's game is data from a file, so a file that passes the validator never makes the engine throw. Every action is checked as
 * packages/net checks a guest's (core/action-shape.ts), card definitions with their faces, and the log is run through `startReplay` and `replayAction`
 * (`checkpointsOf` among them), which report anything the engine cannot do as a rejection with its index (design 5.3: playback stops there).
 */
import { describe, expect, it } from 'vitest';
import {
  actionShapeProblem, checkpointsOf, checkReplay, createGame, currentEngine, replayAction, startReplay, type Action, type GameConfig, type ReplayFile,
} from '../../src/index';
import { compiledDefs } from '../fixtures';
import { aiGame, botGame, discardConfig, faceDownConfig } from './games';

const NAMES = ['Grizzly Bears', 'Forest', 'Lightning Bolt', 'Mountain'];
const deck = Array.from({ length: 40 }, (_, i) => NAMES[i % 4]!);
const config = (): GameConfig => ({ seed: 's', players: [{ name: 'A', deck }, { name: 'B', deck }], defs: compiledDefs(NAMES), options: { skipMulligans: true } });
const first = { type: 'answer', player: 'p1', decisionId: 'd0', answer: { kind: 'playFirst', player: 'p1' } };
const passes = Array.from({ length: 30 }, (_, i) => ({ type: 'pass', player: i % 2 === 0 ? 'p1' : 'p2' }));

/** A game replay of `cfg` and `actions` (shape only: the engine is not run). */
function fileOf(cfg: unknown, actions: unknown[]): ReplayFile {
  return {
    format: 'openmtg-replay', formatVersion: 1, kind: 'game', id: 'r-x', title: 't', createdAt: '2026-10-21T12:00:00Z',
    app: { version: '0.5.0', commit: 'abc' }, engine: currentEngine(null),
    game: {
      mode: 'computer', format: '', players: [{ id: 'p1', name: 'A', kind: 'person' }, { id: 'p2', name: 'B', kind: 'computer' }], savedBy: 'p1',
      ended: 'abandoned', result: null, turns: 1, actions: actions.length, startedAt: '2026-10-21T12:00:00Z', endedAt: '2026-10-21T12:00:00Z',
    },
    reveal: { policy: 'own', agreed: [] },
    play: { config: cfg as GameConfig, actions: actions as Action[], times: actions.map(() => 0), checkpoints: [] },
  };
}

/** Logs the engine reads with a TypeError or an EngineBug instead of rejecting (the review's cases), each with where the validator now refuses it. */
const HOSTILE: [string, unknown, unknown[], RegExp][] = [
  ['a concession without its player', config(), [first, { type: 'concede' }], /^play\.actions\[1\]\.player$/],
  ['setStops with null stops', config(), [{ type: 'setStops', player: 'p1', stops: null }, first, ...passes], /^play\.actions\[0\]\.stops$/],
  ['setStops with text for stops', config(), [{ type: 'setStops', player: 'p1', stops: 'x' }, first, ...passes], /^play\.actions\[0\]\.stops$/],
  ['setStops without stops', config(), [{ type: 'setStops', player: 'p1' }, first, ...passes], /^play\.actions\[0\]\.stops$/],
  ['an answer that is null', config(), [{ type: 'answer', player: 'p1', decisionId: 'd0', answer: null }, ...passes], /^play\.actions\[0\]$/],
  ['startGame in the log', config(), [{ type: 'startGame' }, first], /^play\.actions\[0\]\.type$/],
  ['an action type the engine does not have', config(), [first, { type: 'teleport', player: 'p1' }], /^play\.actions\[1\]\.type$/],
  ['card definitions of an id and a name only', { ...config(), defs: [{ id: 'X', name: 'X' }], players: [{ name: 'A', deck: Array(40).fill('X') }, { name: 'B', deck: Array(40).fill('X') }] }, [first, ...passes], /^play\.config\.defs\[0\]\.layout$/],
  ['a face without its type lists', { ...config(), defs: compiledDefs(NAMES).map((d, i) => (i === 0 ? { ...d, faces: [{ ...d.faces[0]!, types: null }] } : d)) }, [first, ...passes], /^play\.config\.defs\[0\]\.faces\[0\]\.types$/],
];

describe('RPL-0 review: a replay never makes the engine throw', { timeout: 300_000 }, () => {
  it('the validator refuses an action or a definition the engine would throw on, and says where', () => {
    for (const [what, cfg, actions, path] of HOSTILE) {
      const r = checkReplay(fileOf(cfg, actions));
      expect(r.ok, what).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, what).toBe('malformed');
      expect(r.error.path, `${what}: ${r.error.message}`).toMatch(path);
    }
  });

  it('checkpointsOf never throws, even on a log nobody checked: it stops at the action, with why', () => {
    for (const [what, cfg, actions] of HOSTILE) {
      let run: ReturnType<typeof checkpointsOf> | undefined;
      expect(() => { run = checkpointsOf(cfg as GameConfig, actions as Action[]); }, what).not.toThrow();
      expect(run!.rejected, what).not.toBeNull();
    }
    // Definitions without faces: the game is set up, and the engine throws once it reads them (here, as the opening hands are drawn).
    const thin = checkpointsOf(HOSTILE[7]![1] as GameConfig, HOSTILE[7]![2] as Action[]);
    expect(thin.rejected).toMatchObject({ cause: 'threw' });
    expect(thin.rejected!.error.message).toMatch(/TypeError/);
    expect(checkpointsOf({ ...config(), defs: [] }, []).rejected).toMatchObject({ index: -1, cause: 'config' });
    expect(checkpointsOf(config(), [first, { type: 'concede' }] as Action[]).rejected).toMatchObject({ index: 1, cause: 'shape' });
    expect(checkpointsOf(config(), [first, { type: 'pass', player: 'p2' }] as Action[]).rejected).toMatchObject({ index: 1, cause: 'illegal' });
    // The same, a step at a time (RPL-2's snapshots and seeks): startReplay and replayAction never throw either.
    expect(startReplay({ ...config(), defs: [] })).toMatchObject({ ok: false, rejection: { cause: 'config' } });
    const start = startReplay(config());
    if (!start.ok) throw new Error(start.rejection.error.message);
    expect(replayAction(start.state, { type: 'answer', player: 'p1', decisionId: 'd0', answer: null } as never, 0)).toMatchObject({ ok: false, rejection: { index: 0, cause: 'shape' } });
    expect(replayAction(start.state, first as Action, 0).ok).toBe(true);
  });

  it('every action of seeded AI and bot games has the shape the check accepts, and their replays run as they were played', () => {
    const games = [aiGame('rpl0-run-ai', 0, 1), botGame(faceDownConfig('rpl0-run-fd'), 700), botGame(discardConfig('rpl0-run-disc'), 700)];
    for (const g of games) {
      for (const [i, a] of g.actions.entries()) expect(actionShapeProblem(JSON.parse(JSON.stringify(a))), `${g.config.seed} action ${i}`).toBeNull();
      const run = checkpointsOf(g.config, g.actions);
      expect(run.rejected, g.config.seed).toBeNull();
      expect(run.checkpoints.length).toBeGreaterThan(0);
      expect(checkReplay(JSON.parse(JSON.stringify(fileOf(g.config, g.actions)))).ok, g.config.seed).toBe(true);
    }
    expect(createGame(config()).players).toHaveLength(2);
  });
});
