/**
 * Helpers for the CR worked-example suite of milestone 5 (WP29, design 15.2 and 15.4): real fixture cards compiled by the default compiler (the game
 * path), placed on a board with the milestone 3 `scenario` helper and driven with real actions and answers through `applyAction`. No module is mocked.
 */
import {
  compileCard, getChars, legalActions, ptNumbers, validateAbility, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId,
} from '../../../src/index';
import { getCard } from '../../fixtures';
import { act, answer, find, pass } from '../helpers';

/**
 * Answer the pending decisions in order, paying costs automatically and keeping the offered order of simultaneous triggers (CR 603.3b) unless an answer
 * says otherwise; stops at priority, when nothing is pending, or when the answers run out.
 */
export function drive(s: GameState, answers: DecisionAnswer[] = []): GameState {
  let t = s;
  let i = 0;
  while (t.pending && t.pending.kind !== 'priority') {
    if (t.pending.kind === 'payCost' && answers[i]?.kind !== 'payCost') { t = answer(t, { kind: 'payCost', auto: true }); continue; }
    if (t.pending.kind === 'order' && answers[i]?.kind !== 'order') { t = answer(t, { kind: 'order', ids: t.pending.items.map((x) => x.id) }); continue; }
    const a = answers[i++];
    if (!a) break;
    t = answer(t, a);
  }
  return t;
}

/** Cast a card from `player`'s hand, answering its announcement decisions and paying automatically: the spell is on the stack afterwards. */
export function cast(s: GameState, name: string, answers: DecisionAnswer[] = [], player: PlayerId = 'p1'): GameState {
  if (s.pending?.player !== player) throw new Error(`${player} does not have priority (${s.pending?.player} has ${s.pending?.kind})`);
  return drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), answers);
}

/** Activate the ability of `source` whose legal-action label matches `label` (the first activated non-mana ability when omitted). */
export function activate(s: GameState, source: ObjectId, answers: DecisionAnswer[] = [], label?: RegExp): GameState {
  const player = s.pending!.player;
  const la = legalActions(s, player).find((a) => a.kind === 'activate' && !a.isMana && a.object === source && (!label || label.test(a.label)));
  if (!la) throw new Error(`no activation of ${source} matching ${label} among: ${legalActions(s, player).map((a) => a.label).join('; ')}`);
  return drive(act(s, la.action), answers);
}

export const target = (...ids: string[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => (id === 'p1' || id === 'p2' ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });

/** Both players pass priority once: the top object of the stack resolves (CR 608), then the active player receives priority (CR 117.3b). */
export function resolveTop(s: GameState, answers: DecisionAnswer[] = []): GameState {
  const before = s.zones.stack.length;
  if (before === 0) throw new Error('the stack is empty');
  let t = pass(s);
  t = drive(pass(t), answers);
  return t;
}

/** Pass priority until the stack is empty, answering every decision with the given answers in order. */
export function resolveAll(s: GameState, answers: DecisionAnswer[] = []): GameState {
  let t = s;
  const queue = [...answers];
  for (let i = 0; i < 40 && t.zones.stack.length > 0; i++) {
    t = pass(t);
    while (t.pending && t.pending.kind !== 'priority') {
      if (t.pending.kind === 'payCost') { t = answer(t, { kind: 'payCost', auto: true }); continue; }
      if (t.pending.kind === 'order' && queue[0]?.kind !== 'order') { t = answer(t, { kind: 'order', ids: t.pending.items.map((x) => x.id) }); continue; }
      const a = queue.shift();
      if (!a) return t;
      t = answer(t, a);
    }
  }
  return t;
}

export const pt = (s: GameState, id: ObjectId): [number | null, number | null] => {
  const n = ptNumbers(getChars(s, id));
  return [n.power, n.toughness];
};

export const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
/** The stack from bottom to top: card names for spells, "ability of <source>" for abilities. */
export const stackNames = (s: GameState): string[] =>
  s.zones.stack.map((id) => (s.objects[id]!.kind === 'ability' ? `ability of ${s.objects[id]!.stack?.sourceName ?? '?'}` : nameOf(s, id)));
export const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
export const countOn = (s: GameState, name: string, controller?: PlayerId): number =>
  s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (!controller || s.objects[id]!.controller === controller)).length;

/** The default compiler's result for a fixture card (what a decklist would load). */
export const gamePath = (name: string): CardDef => compileCard(getCard(name));

/**
 * A card with these hand-built abilities, for a wording no template covers yet: hand-built JSON of the same behavior as the example's text. It is NOT
 * what the compiler would produce: the render gate (G6) does not accept most of these abilities for their wording yet, so they could not come out of the
 * parser. Each ability must pass the schema and the lint (`validateAbility`, design 12.1) with no issue, or the card is refused (M5Z review).
 */
export function equivalent(card: Partial<OracleCard> & { name: string; type_line: string }, abilities: AbilityDef[]): CardDef {
  for (const a of abilities) {
    const issues = validateAbility(a);
    if (issues.length > 0) throw new Error(`equivalent ${card.name}: validateAbility reports ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  }
  const base = compileCard({ layout: 'normal', mana_cost: '', oracle_text: '', colors: [], ...card } as OracleCard);
  return { ...base, faces: base.faces.map((f, i) => (i === 0 ? { ...f, abilities } : f)), automation: { ...base.automation, level: 'full', unsupported: [] } };
}
