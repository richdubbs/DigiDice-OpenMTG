/**
 * FAST5 T42: helpers shared by the scenario tests (synthetic cards compiled by the game's default compiler; invented names and wordings, design 6.10).
 */
import { expect } from 'vitest';
import { compileCard, type CardDef, type Color, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass } from '../../m3/scenario';

export function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[]; faces?: Partial<OracleCard>[] } = {}): CardDef {
  if (opts.faces) return compileCard({ name, layout: 'transform', mana_cost: opts.cost ?? '{0}', type_line: type, colors: opts.colors ?? [], card_faces: opts.faces } as unknown as OracleCard);
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
export const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));

/** Answer what comes up until priority returns: automatic payment, then `choose` (undefined stops). */
export function settle(s0: GameState, choose: (s: GameState) => DecisionAnswer | undefined = () => undefined): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else {
      const a = choose(s);
      if (!a) break;
      s = answer(s, a);
    }
  }
  return s;
}
export const resolve = (s: GameState, choose?: (s: GameState) => DecisionAnswer | undefined): GameState => settle(pass(pass(s)), choose);
export const cast = (s: GameState, name: string, choose?: (s: GameState) => DecisionAnswer | undefined): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), choose);
export const ids = (s: GameState, name: string, zone: 'graveyard' | 'hand' | 'library' | 'battlefield', owner: 'p1' | 'p2' = 'p1'): ObjectId[] => findAll(s, name, zone, owner);
export const inZone = (s: GameState, zone: 'graveyard' | 'hand' | 'library', owner: 'p1' | 'p2' = 'p1'): string[] => s.zones[zone][owner]!.map((id) => s.objects[id]!.defId);
export const onBattlefield = (s: GameState): string[] => s.zones.battlefield.map((id) => s.objects[id]!.defId);
/** The object targets the engine offers for the decision that is pending. */
export const offered = (s: GameState): string[] => {
  const d = s.pending as unknown as { kind: string; objects?: ObjectId[] };
  expect(d.kind).toBe('chooseTargets');
  return (d.objects ?? []).map((id) => s.objects[id]!.defId).sort();
};
/** The objects offered by a pending chooseObjects decision (names). */
export const options = (s: GameState): string[] => {
  const d = s.pending as unknown as { kind: string; options?: ObjectId[] };
  expect(d.kind).toBe('chooseObjects');
  return (d.options ?? []).map((id) => s.objects[id]!.defId).sort();
};
export const pick = (...id: ObjectId[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: id.map((i): TargetChoice => ({ kind: 'object', id: i })) });

export const MOUSE = card('Test Mouse', 'Creature — Mouse', '', { pt: ['1', '1'], cost: '{W}', colors: ['W'] });
export const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['2', '2'], cost: '{1}{G}', colors: ['G'] });
export const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'], cost: '{2}{R}', colors: ['R'] });
export const WURM = card('Test Wurm', 'Creature — Wurm', '', { pt: ['1', '1'], cost: '{B}', colors: ['B'] });
export const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', { cost: '{0}', colors: ['B'] });
