/**
 * Helpers for the M6-5a tests (m6 design 3.8, section 5; push package K1): real fixture cards compiled by the default compiler (the game path) and
 * synthetic cards compiled from invented Oracle-like text by the same compiler, driven through applyAction. Nothing is mocked.
 */
import { compileCard, legalActions, type CardDef, type CostsPaid, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, find } from '../../m5/helpers';
import { drive } from '../../m5/cr-examples/helpers';
import type { DecisionAnswer } from '../../../src/index';

export { answer, find, pass, scenario } from '../../m5/helpers';
export { drive, gamePath, handSize, resolveAll, resolveTop, stackNames, target } from '../../m5/cr-examples/helpers';

/** A synthetic card compiled by the default compiler from invented text (design 6.10: never Wizards text). */
export function synthetic(name: string, typeLine: string, manaCost: string, text: string, extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', type_line: typeLine, mana_cost: manaCost, oracle_text: text, colors: [], ...extra } as OracleCard);
}

/** Begin casting `name` from `player`'s hand (with a cast method when given), then answer `answers`, paying automatically. */
export function castWith(s: GameState, name: string, answers: DecisionAnswer[] = [], method?: string, player: PlayerId = 'p1'): GameState {
  return drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player), ...(method !== undefined ? { method } : {}) }), answers);
}

/** The costs paid of the topmost spell. */
export const topPaid = (s: GameState): CostsPaid => s.objects[s.zones.stack[s.zones.stack.length - 1]!]!.stack!.costsPaid;

/** The cast methods `legalActions` offers for a card in hand. */
export function castMethodsOffered(s: GameState, card: ObjectId, player: PlayerId = 'p1'): (string | undefined)[] {
  return legalActions(s, player).filter((a) => a.kind === 'cast' && a.object === card).map((a) => (a.action as { method?: string }).method);
}

export const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
export const no: DecisionAnswer = { kind: 'yesNo', yes: false };

/** Names of the cards in a player's zone. */
export const namesIn = (s: GameState, zone: 'hand' | 'graveyard' | 'exile', p: PlayerId): string[] =>
  (zone === 'exile' ? s.zones.exile : s.zones[zone][p]!).map((id) => s.defs[s.objects[id]!.defId]!.name);
