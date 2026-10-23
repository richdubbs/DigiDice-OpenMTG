/**
 * Helpers for the WP11 tests (proposal pipeline and performers, design 8.5): real fixture cards whose abilities are the hand-written JSON of design section 13
 * (what the milestone 5 compiler will produce), synthetic cards, typed shield records, and a way to run the pipeline directly on a state with answers.
 */
import type { AbilityDef, CardDef, DecisionAnswer, Decision, GameEvent, GameState, ReplacementDef, StaticEffect, ZoneName } from '../../../src/index';
import { Game, NeedDecision } from '../../../src/core/game';
import type { ContinuousEffectRec } from '../../../src/types/state';
import { clone } from '../../../src/util/clone';
import { compiledDef } from '../../fixtures';
import { synth } from '../helpers';

/** A fixture card with the given abilities instead of what the milestone 4 compiler makes of its text. */
export const withAbilities = (name: string, abilities: AbilityDef[]): CardDef => compiledDef(name, () => ({ abilities, unsupported: [] }));

/** A static ability (CR 604) with these effects, functioning in `zone` (battlefield by default). */
export const staticAbility = (text: string, effects: StaticEffect[], extra: { zone?: ZoneName[]; condition?: Extract<AbilityDef, { kind: 'static' }>['condition'] } = {}): AbilityDef => ({
  kind: 'static', text, effects, ...(extra.zone ? { zone: extra.zone } : {}), ...(extra.condition ? { condition: extra.condition } : {}),
});

/** "As ~ enters, ..." (CR 614.1c, 614.12): a self replacement with an `enters` body. */
export const entersSelf = (body: Omit<Extract<ReplacementDef['body'], { b: 'enters' }>, 'b'>, extra: Partial<ReplacementDef> = {}): ReplacementDef => ({
  s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', ...body }, ...extra,
});

/** A synthetic permanent card with abilities. */
export const permanent = (name: string, type: string, abilities: AbilityDef[], opts: { cost?: string; pt?: [string, string] } = {}): CardDef =>
  synth({ name, type, abilities, ...(opts.cost !== undefined ? { cost: opts.cost } : {}), ...(opts.pt ? { pt: opts.pt } : {}) });

/** A shield record as a resolved `effect` step creates it (WP15): a shielded replacement or prevention effect with a duration (CR 614.1, 615.7-615.8). */
export function shieldRecord(id: string, effect: ReplacementDef, extra: Partial<ContinuousEffectRec> = {}): ContinuousEffectRec {
  return { id, source: null, sourceName: `Shield ${id}`, controller: 'p1', timestamp: 900, startedTurn: 1, duration: { d: 'endOfTurn' }, effect, ...extra };
}

/** The result of running engine code directly: the game it ran in, and the decision it stopped at if it needed one. */
export interface Ran<T> {
  g: Game;
  result?: T;
  need?: Decision;
}

/**
 * Run `f` on a private copy of the state with these answers, as core/apply.ts would (re-execution model): if a decision is needed and not answered, the run
 * stops and `need` says which. Never mutates `s`.
 */
export function run<T>(s: GameState, f: (g: Game) => T, answers: DecisionAnswer[] = []): Ran<T> {
  const g = new Game(clone(s), answers);
  try {
    return { g, result: f(g) };
  } catch (e) {
    if (e instanceof NeedDecision) return { g, need: e.decision };
    throw e;
  }
}

export const eventsOf = <K extends GameEvent['type']>(g: Game, type: K): Extract<GameEvent, { type: K }>[] => g.events.filter((e): e is Extract<GameEvent, { type: K }> => e.type === type);
