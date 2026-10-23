/**
 * Test helpers: agents (the AI through the player's view, and a uniformly random legal-move bot) and a game loop that records every action for replay.
 */
import { applyAction, createGame, viewFor, type Action, type GameConfig, type GameState, type PlayerId } from '@openmtg/engine';
import { Bot } from '../../engine/test/m3/bot';
import { chooseAction } from '../src/index';

export type Agent = (s: GameState) => Action;

/** The AI, reading only its own view of the game (CR 400.2). `timings` gets the time of each `chooseAction` (the AI alone, not the engine's `viewFor`). */
export function aiAgent(seed: string, timings?: number[]): Agent {
  return (s) => {
    const d = s.pending!;
    const view = viewFor(s, d.player);
    const t0 = performance.now();
    const a = chooseAction(view, view.pending!, seed);
    timings?.push(performance.now() - t0);
    return a;
  };
}

/** A random legal-move bot (the engine soak test's), which also names a card when asked. */
export function randomAgent(seed: string): Agent {
  const bot = new Bot(seed);
  return (s) => {
    const d = s.pending!;
    if (d.kind === 'chooseName') {
      const name = d.options?.[0] ?? 'Forest';
      return { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseName', name } };
    }
    return bot.next(s);
  };
}

export interface Played {
  state: GameState;
  actions: Action[];
  /** Actions the engine rejected, with who made them. */
  rejected: { player: PlayerId; action: Action; message: string }[];
  finished: boolean;
}

export function playGame(config: GameConfig, agents: Record<PlayerId, Agent>, maxActions = 8000): Played {
  let s = createGame(config);
  const actions: Action[] = [];
  const rejected: Played['rejected'] = [];
  let strikes = 0;
  for (let i = 0; i < maxActions && !s.result; i++) {
    const d = s.pending!;
    const a = agents[d.player]!(s);
    const r = applyAction(s, a);
    if (r.error) {
      rejected.push({ player: d.player, action: a, message: r.error.message });
      // A rejected answer leaves the decision open. It is recorded in `rejected` first, and every test asserts there are none for the AI, so a rejection
      // is a failure even though the game goes on: the harness then cancels or passes for that player, and gives up on the game after 50.
      if (++strikes > 50) break;
      if (d.cancellable) {
        const c = applyAction(s, { type: 'cancel', player: d.player });
        if (!c.error) { s = c.state; actions.push({ type: 'cancel', player: d.player }); }
      } else if (d.kind === 'priority') {
        s = applyAction(s, { type: 'pass', player: d.player }).state;
        actions.push({ type: 'pass', player: d.player });
      }
      continue;
    }
    s = r.state;
    actions.push(a);
  }
  return { state: s, actions, rejected, finished: s.result !== null };
}
