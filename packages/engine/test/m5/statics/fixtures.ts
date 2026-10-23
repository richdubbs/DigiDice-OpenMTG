/**
 * Fixtures for the WP9 tests (layers, live statics, characteristics, links): synthetic cards with static abilities written as data, boards built from them,
 * and a way to add a resolved continuous effect to a state. Nothing here is card-specific engine code: a card is an `AbilityDef` list.
 */
import {
  type AbilityDef, type CardDef, type Color, type ContinuousEffectDef, type ContinuousEffectRec, type GameState, type Modification, type ObjectFilter,
  type ObjectId, type ObjRef, type StaticAbilityDef,
} from '../../../src/index';
import { scenario, synth, tweak, type ScenarioOptions } from '../helpers';

export { find, findAll } from '../helpers';
export { tweak };

/** "Creatures you control get +1/+1." style: a static ability with continuous effects. */
export const staticOf = (text: string, effects: ContinuousEffectDef[], extra: Partial<StaticAbilityDef> = {}): AbilityDef => ({ kind: 'static', text, effects, ...extra });

export const continuous = (affects: ObjRef, mods: Modification[], cda = false): ContinuousEffectDef => ({ s: 'continuous', affects, mods, ...(cda ? { cda: true } : {}) });

export const each = (filter: ObjectFilter): ObjRef => ({ ref: 'each', filter });
export const SELF: ObjRef = { ref: 'self' };

export const creature = (name: string, p: string, t: string, abilities: AbilityDef[] = [], opts: { cost?: string; type?: string } = {}): CardDef =>
  synth({ name, cost: opts.cost ?? '{1}', type: opts.type ?? 'Creature — Bear', pt: [p, t], abilities });

export const enchantment = (name: string, cost: string, abilities: AbilityDef[], type = 'Enchantment'): CardDef => synth({ name, cost, type, abilities });

export const land = (name: string, abilities: AbilityDef[] = [], type = 'Land'): CardDef => synth({ name, type, abilities });

export const artifact = (name: string, cost: string, abilities: AbilityDef[] = [], type = 'Artifact'): CardDef => synth({ name, cost, type, abilities });

/** A game at the first main phase with exactly these cards on the battlefields. Basic lands come from the fixtures; everything else from `defs`. */
export function board(defs: CardDef[], p1: string[] = [], p2: string[] = [], opts: Omit<ScenarioOptions, 'defs' | 'p1' | 'p2'> = {}): GameState {
  return scenario([], { ...opts, defs, p1: { battlefield: p1 }, p2: { battlefield: p2 } });
}

/** The nth object of this name on the battlefield, in the order they were placed. */
export function nth(s: GameState, name: string, n = 0): ObjectId {
  const hits = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);
  if (!hits[n]) throw new Error(`No ${name} #${n} on the battlefield`);
  return hits[n]!;
}

/** Add a resolved continuous effect (what the `effect` step of WP12-WP15 stores): its own effect id, timestamp and fixed duration. */
export function withEffect(s: GameState, effect: ContinuousEffectDef, opts: { source?: ObjectId; controller?: string; duration?: ContinuousEffectRec['duration'] } = {}): GameState {
  return tweak(s, (t) => {
    const id = `e${t.counters.effect++}`;
    const src = opts.source ? { id: opts.source, zone: t.objects[opts.source]!.zone } : null;
    t.continuousEffects.push({
      id, source: src, sourceName: 'test', controller: opts.controller ?? 'p1', timestamp: t.counters.timestamp++, startedTurn: t.turn.number,
      duration: opts.duration ?? { d: 'endOfTurn' }, effect,
    });
  });
}

/** Handles to objects fixed when the effect was created (CR 611.2c). */
export const fixedOn = (s: GameState, ...ids: ObjectId[]): ObjRef => ({ ref: 'fixed', objects: ids.map((id) => ({ id, zone: s.objects[id]!.zone })) });

export const colorsOf = (cs: Color[]): Color[] => cs;
