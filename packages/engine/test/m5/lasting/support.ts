/**
 * Boards for the WP15 tests: real fixture cards (some carrying the JSON of design section 13, as the milestone 5 compiler will produce it) and synthetic cards
 * whose abilities are hand-written model JSON. Every test file mocks the neighbors of neighbors.ts and calls `setup()` before each test.
 */
import { OP_HANDLERS } from '../../../src/effects/handlers';
import type { AbilityDef, CardDef, DecisionAnswer, EffectProgram, EffectStep, GameState, ObjectId, PlayerId, TargetSpec } from '../../../src/index';
import { getChars } from '../../../src/index';
import { ptNumbers } from '../../../src/rules/characteristics';
import { clone } from '../../../src/util/clone';
import { drive } from '../announce/support';
import { act, find, passBoth, synth } from '../helpers';
import { EXAMPLES } from '../model/examples';
import { neighbors } from './neighbors';

export function setup(): void {
  neighbors.reset();
  neighbors.handlers = OP_HANDLERS as Record<string, unknown>;
}

/** Replace the abilities of the named cards' definitions by the section 13 JSON (test setup only). */
export function withExamples(s: GameState, ...names: string[]): GameState {
  const t = clone(s);
  for (const name of names) {
    const ex = EXAMPLES.find((e) => e.name === name);
    if (!ex) throw new Error(`No worked example "${name}" in design section 13`);
    const id = Object.keys(t.defs).find((k) => t.defs[k]!.name === name);
    if (!id) throw new Error(`"${name}" is not in the scenario`);
    const def = t.defs[id]!;
    t.defs = { ...t.defs, [id]: { ...def, faces: def.faces.map((f, i) => ({ ...f, abilities: ex.faces[i]?.abilities ?? f.abilities })) } };
  }
  return t;
}

/** The abilities of a section 13 example. */
export const example = (name: string): AbilityDef[] => EXAMPLES.find((e) => e.name === name)!.faces[0]!.abilities;

/** The effect program of ability `index` of a section 13 example. */
export function programOf(name: string, index = 0): EffectProgram {
  const a = example(name)[index]!;
  if (!('effect' in a) || !a.effect) throw new Error(`${name} ability ${index} has no effect`);
  return a.effect;
}

/** A synthetic instant (or sorcery) with one spell ability. */
export const instant = (name: string, steps: EffectStep[], targets: TargetSpec[] = [], type = 'Instant', cost = '{0}'): CardDef =>
  synth({ name, type, cost, abilities: [{ kind: 'spell', text: name, effect: { targets, steps } }] });

/** A synthetic permanent with abilities. */
export const permanent = (name: string, type: string, abilities: AbilityDef[], pt?: [string, string]): CardDef =>
  synth({ name, type, cost: '{0}', abilities, ...(pt ? { pt } : {}) });

/** "{0}: [program]" */
export const activated = (text: string, effect: EffectProgram): AbilityDef => ({ kind: 'activated', text, cost: {}, effect });

export const creatureTarget = (id = 't0'): TargetSpec => ({ id, kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } });

/** Cast a card from p1's hand (or `player`'s), answering its decisions; the spell is then on the stack with priority. */
export function cast(s: GameState, name: string, answers: DecisionAnswer[] = [], player: PlayerId = 'p1'): GameState {
  const t = drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), answers);
  if (t.pending?.kind !== 'priority') throw new Error(`${name}: still deciding ${t.pending?.kind}`);
  return t;
}

/** Activate the printed ability `index` of a permanent, answering its decisions. */
export function activate(s: GameState, source: ObjectId, index = 0, answers: DecisionAnswer[] = [], player: PlayerId = 'p1'): GameState {
  const t = drive(act(s, { type: 'activate', player, source, ability: `p:0:${index}` }), answers);
  if (t.pending?.kind !== 'priority') throw new Error(`activation: still deciding ${t.pending?.kind}`);
  return t;
}

/** Cast and resolve (both players pass). */
export const castAndResolve = (s: GameState, name: string, answers: DecisionAnswer[] = []): GameState => passBoth(cast(s, name, answers));

export const pt = (s: GameState, id: ObjectId): [number | null, number | null] => {
  const n = ptNumbers(getChars(s, id));
  return [n.power, n.toughness];
};

export const objectTarget = (id: string) => ({ kind: 'object' as const, id });
export const playerTarget = (id: string) => ({ kind: 'player' as const, id });
export const targets = (...ts: ReturnType<typeof objectTarget | typeof playerTarget>[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ts });

/** The text of the last log line that matches. */
export function lastLog(s: GameState, re: RegExp): string {
  const hit = [...s.log].reverse().find((l) => re.test(l.text));
  if (!hit) throw new Error(`no log line matches ${re}`);
  return hit.text;
}
