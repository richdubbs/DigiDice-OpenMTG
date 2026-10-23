/**
 * Helpers of the M6-4 tests (m6 design 3.6, 5 "M6-4"): real fixture cards compiled by the default compiler (the game path), placed with the milestone 3
 * `scenario` helper and driven by real actions and answers through `applyAction`. Synthetic cards are invented text (design 6.10) or hand-built JSON of the
 * same behavior (`equivalent`, `dfc`). Nothing is mocked.
 */
import { compileCard, getChars, ptNumbers, validateAbility, type AbilityDef, type CardDef, type DecisionAnswer, type EffectStep, type GameState, type ObjectId, type OracleCard, type TargetSpec } from '../../../src/index';
import { act, answer, find, pass } from '../../m5/helpers';
import { equivalent } from '../../m5/cr-examples/helpers';

export { act, answer, find, pass, put, scenario, tweak } from '../../m5/helpers';
export { cast, drive, equivalent, resolveAll, resolveTop, stackNames, target } from '../../m5/cr-examples/helpers';

/** Choose `ids` in a `chooseObjects` decision (Clone's choice of what to copy, CR 707.5). */
export const pick = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });

/** The name, P/T, types and supertypes of an object after every layer. */
export function looks(s: GameState, id: ObjectId): { name: string; pt: [number | null, number | null]; types: string[]; supertypes: string[]; face: number } {
  const c = getChars(s, id);
  const n = ptNumbers(c);
  return { name: c.name, pt: [n.power, n.toughness], types: [...c.types], supertypes: [...c.supertypes], face: s.objects[id]!.face };
}

/** Lands of one name. */
export const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];

const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, text: 'target creature', min: 1, max: 1 };

/** A {0} instant with one target creature and these steps on it (hand-built JSON, `equivalent`). */
export function instantOnTarget(name: string, text: string, steps: (t: { ref: 'target'; id: 't0' }) => EffectStep[]): CardDef {
  return equivalent({ name, type_line: 'Instant', mana_cost: '{0}' }, [{ kind: 'spell', text, effect: { targets: [creature], steps: steps({ ref: 'target', id: 't0' }) } } as AbilityDef]);
}

/** "Transform target creature." / "Convert target creature." / "Flip target creature." */
export const TRANSFORM = instantOnTarget('Test Turnabout', 'Transform target creature.', (t) => [{ op: 'changeFace', what: t, to: 'transform' }]);
export const CONVERT = instantOnTarget('Test Reconfigure', 'Convert target creature.', (t) => [{ op: 'changeFace', what: t, to: 'convert' }]);
export const FLIP = instantOnTarget('Test Upend', 'Flip target creature.', (t) => [{ op: 'changeFace', what: t, to: 'flip' }]);
export const BOUNCE = instantOnTarget('Test Recall', "Return target creature to its owner's hand.", (t) => [{ op: 'move', what: t, to: { zone: 'hand' } }]);

/** "Target creature becomes a copy of another target creature until end of turn." (a Cytoshape-style spell, as test/m6/copy builds it). */
export const SHAPESHIFT: CardDef = equivalent({ name: 'Test Shapeshift', type_line: 'Instant', mana_cost: '{0}' }, [{
  kind: 'spell', text: 'Target creature becomes a copy of another target creature until end of turn.',
  effect: {
    targets: [{ id: 't1', kind: 'object', filter: { types: ['Creature'] }, text: 'target creature', min: 1, max: 1 }, { id: 't2', kind: 'object', filter: { types: ['Creature'] }, text: 'another target creature', distinctFrom: ['t1'], min: 1, max: 1 }],
    steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't1' }, mods: [{ layer: '1a', copyOf: { ref: 'target', id: 't2' } }] }] }],
  },
} as AbilityDef]);

export interface FaceSpec { name: string; type_line: string; mana_cost?: string; power?: string; toughness?: string; abilities?: AbilityDef[] }

/**
 * A synthetic transforming double-faced card (layout `transform`) with hand-built abilities on each face. Each ability must pass the schema and the lint
 * (`validateAbility`), as `equivalent` requires.
 */
export function dfc(front: FaceSpec, back: FaceSpec, layout: 'transform' | 'modal_dfc' = 'transform'): CardDef {
  for (const a of [...(front.abilities ?? []), ...(back.abilities ?? [])]) {
    const issues = validateAbility(a);
    if (issues.length > 0) throw new Error(`dfc ${front.name}: validateAbility reports ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  }
  const face = (f: FaceSpec) => ({ name: f.name, type_line: f.type_line, mana_cost: f.mana_cost ?? '', oracle_text: '', colors: [], ...(f.power !== undefined ? { power: f.power, toughness: f.toughness } : {}) });
  const base = compileCard({ name: `${front.name} // ${back.name}`, layout, type_line: `${front.type_line} // ${back.type_line}`, mana_cost: front.mana_cost ?? '', card_faces: [face(front), face(back)], colors: [] } as unknown as OracleCard);
  const abilities = [front.abilities ?? [], back.abilities ?? []];
  return { ...base, faces: base.faces.map((f, i) => ({ ...f, abilities: abilities[i]! })), automation: { ...base.automation, level: 'full', unsupported: [] } };
}

/** One step forward: declare no attackers or blockers, or pass priority. */
export function next(s: GameState): GameState {
  const p = s.pending;
  if (!p) throw new Error('nothing pending');
  if (p.kind === 'declareAttackers') return answer(s, { kind: 'declareAttackers', attacks: [] });
  if (p.kind === 'declareBlockers') return answer(s, { kind: 'declareBlockers', blocks: [] } as DecisionAnswer);
  if (p.kind === 'priority') return pass(s);
  throw new Error(`next: unexpected decision ${p.kind}`);
}

/** Step forward until `done` holds (at most `max` steps). */
export function until(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t); i++) t = next(t);
  if (!done(t)) throw new Error('until: not reached');
  return t;
}

/** The permanent of `name` (its full card name) on the battlefield. */
export const onField = (s: GameState, name: string, owner: 'p1' | 'p2' = 'p1'): ObjectId => find(s, name, 'battlefield', owner);

export { act as action };
