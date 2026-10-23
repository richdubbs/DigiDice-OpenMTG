/**
 * r3-cost (Standard round 3: costs and mana): shared helpers of the engine scenarios. Synthetic cards are compiled by the game's default compiler from
 * invented wordings (design 6.10); payment is automatic.
 */
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, passBoth } from '../../m3/scenario';

export { act, advanceTo, answer, find, legal, passBoth, pool, scenario } from '../../m3/scenario';

/** A synthetic card compiled like any card (`pt` for a creature). */
export function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Fully automated: level full, no manual ability and no manual step. */
export const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** The answers to the decisions of a cast or a resolution, in order of kind. Stops at the next priority decision. */
export interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][]; options?: string[][]; x?: number[]; colors?: string[] }
export function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])], options: [...(script.options ?? [])], x: [...(script.x ?? [])], colors: [...(script.colors ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: q.options.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.x.shift() ?? p.min });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (q.colors.shift() ?? 'R') as 'R' });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
export const cast = (s: GameState, name: string, script?: Script, player: PlayerId = 'p1', method?: string): GameState =>
  drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player), ...(method !== undefined ? { method } : {}) }), script);
/** Both players pass until the stack is empty (triggers included), answering what comes up with the script. */
export function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
export const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
export const named = (s: GameState, name: string, zone: 'battlefield' | 'exile' = 'battlefield'): ObjectId[] => s.zones[zone].filter((id) => s.objects[id]!.defId === name);
export const lifeOf = (s: GameState, p: PlayerId = 'p1'): number => s.players.find((x) => x.id === p)!.life;
/** The legal activations of a permanent of p1 (`mana`: its mana abilities, else the others). */
export const activations = (s: GameState, name: string, mana = false, player: PlayerId = 'p1') =>
  legal(s, player, 'activate').filter((a) => a.object === find(s, name, 'battlefield', player) && (a.isMana === true) === mana);
