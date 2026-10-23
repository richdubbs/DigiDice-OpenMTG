/** Helpers for the WP8 tests: drive the trigger machinery directly on a game (events from real engine primitives) or end to end through `applyAction`. */
import { Game } from '../../../src/core/game';
import { moveObject, type MoveOptions } from '../../../src/core/zones';
import { putPendingTriggersOnStack } from '../../../src/core/triggers';
import { clone } from '../../../src/util/clone';
import { NeedDecision } from '../../../src/core/errors';
import type { Decision, DecisionAnswer, GameState, ObjectId, PlayerId, ZoneKind } from '../../../src/index';
import { splitBatches, normalize } from '../../../src/triggers/normalize';
import type { SemEvent } from '../../../src/index';

import { act } from '../helpers';

export * from '../helpers';

/** A game around a copy of `s` (the test may mutate `g.s`); `answers` are the decisions it will be asked, in order. */
export const gameOf = (s: GameState, answers: DecisionAnswer[] = []): Game => new Game(clone(s), answers);

/**
 * Pass priority until the given turn and step, or until some other decision comes up (the caller answers it). Declarations of attackers and blockers are
 * answered with "none".
 */
export function passTo(s: GameState, turn: number, step: GameState['turn']['step']): GameState {
  for (let i = 0; i < 400; i++) {
    if (s.turn.number === turn && s.turn.step === step && s.pending?.kind === 'priority') return s;
    const d = s.pending;
    if (d?.kind === 'declareAttackers') s = act(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [] } });
    else if (d?.kind === 'declareBlockers') s = act(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [] } });
    else if (d?.kind !== 'priority') return s;
    else s = act(s, { type: 'pass', player: d.player });
  }
  throw new Error(`never reached turn ${turn} ${step}`);
}

/** Everything that has happened in `g` so far, normalized into batches. */
export function batchesOf(g: Game): SemEvent[][] {
  return splitBatches(g.events).map((evs) => normalize(g, evs, g.events.indexOf(evs[0]!)));
}

/** Move an object (a real zone change with its events). Returns the new id. */
export const move = (g: Game, id: ObjectId, to: ZoneKind, opts: MoveOptions = {}): ObjectId | null => moveObject(g, id, to, opts);

/** Triggered abilities on the stack, bottom to top. */
export function stackAbilities(s: GameState): { id: ObjectId; source: string; controller: PlayerId; text: string; targets: string[] }[] {
  return s.zones.stack
    .map((id) => s.objects[id]!)
    .filter((o) => o.kind === 'ability')
    .map((o) => {
      const def = o.stack!.inline ?? s.defs[o.defId]!.faces[o.stack!.abilityRef!.face]!.abilities[o.stack!.abilityRef!.index]!;
      return { id: o.id, source: o.stack!.sourceName ?? '', controller: o.controller, text: def.text, targets: o.stack!.targets.flat().map((t) => t.id) };
    });
}

/** Run `putPendingTriggersOnStack` on a game until it stops (it may need decisions: the tests that use this have none). */
export function settle(g: Game): GameState {
  while (putPendingTriggersOnStack(g)) { /* loop until nothing more */ }
  return g.s;
}

/** The decision a run asks for: calls `fn`, which must stop at a decision nobody has answered. */
export function decisionOf(fn: () => unknown): Decision {
  try {
    fn();
  } catch (e) {
    if (e instanceof NeedDecision) return e.decision;
    throw e;
  }
  throw new Error('expected a decision to be asked, but none was');
}
