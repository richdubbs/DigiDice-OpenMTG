/**
 * CMD3 (commander batch): helpers of the cmd3 scenario tests (synthetic cards compiled by the game's default compiler, wordings invented, design 6.10).
 */
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { pass } from '../../m3/scenario';

export function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
export const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
export const full = (d: CardDef): boolean => d.automation.level === 'full';
export const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]?.counters[kind] ?? 0;
export const named = (s: GameState, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId);
export const tokens = (s: GameState, player = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player);
export const inYard = (s: GameState, defId: string, player = 'p1'): boolean => (s.zones.graveyard[player] ?? []).some((id) => s.objects[id]!.defId === defId);
export const permanentsOf = (s: GameState, player: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player);

export interface Picks { objects?: ObjectId[]; option?: string; yes?: boolean; targets?: TargetChoice[] }
/** Answer the decisions in front of us until a player has priority. */
export function settle(s0: GameState, p: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const d = s.pending;
    if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.objects ?? (d as { options: ObjectId[] }).options.slice(0, (d as { min: number }).min) });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: p.targets ?? [] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: p.yes ?? true });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.option ?? (d as { options: { id: string }[] }).options[0]!.id] });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (d.kind === 'assignDamage') {
      const a = d as { amount: number; recipients: { id: string }[] };
      s = answer(s, { kind: 'assignDamage', amounts: a.recipients.map((r, i) => ({ id: r.id, amount: i === 0 ? a.amount : 0 })) });
    } else break;
  }
  return s;
}
export function resolveAll(s0: GameState, p: Picks = {}): GameState {
  let s = settle(s0, p);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(pass(s), p);
  return s;
}
export function cast(s: GameState, name: string, p: Picks = {}, player = 'p1'): GameState {
  return settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), p);
}
/** Declare these attackers and stop at the first point after the declaration where something happens (a trigger, a decision, the damage step). */
export const attackWith = (s: GameState, ids: ObjectId[]): GameState =>
  passUntil(declareAttackers(toDeclareAttackers(s), ids.map((id) => [id] as [ObjectId])), (x) => x.pending?.kind !== 'priority' || x.zones.stack.length > 0 || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'combat');
