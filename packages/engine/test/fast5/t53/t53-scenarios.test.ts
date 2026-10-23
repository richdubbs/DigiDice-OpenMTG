/**
 * FAST5 T53 (redone on top of E17/E21/E22): the intervening "if" clauses the earlier packages did not read, played through the engine with synthetic cards compiled by the game's
 * default compiler (invented wordings, design 6.10).
 *
 *   CR 505.1, 505.1b    "the second main phase" is the first postcombat main phase of the turn; an additional main phase an effect adds is no second main phase
 *   CR 700.11           "you descended this turn": a permanent card was put into your graveyard from anywhere (a token, a spell and an opponent's card are not)
 *   CR 119.3, 119.9     "you gained or lost life this turn", "you gained and lost life this turn"
 *   CR 603.4, 603.10a   "a creature died under an opponent's control this turn", "one or more cards were put into exile this turn", "a card left your graveyard
 *                       this turn", "you didn't cast a spell this turn", "eight or more cards are in your graveyard"
 *   CR 701.21a          "you sacrificed one or more permanents this turn ... that much"
 *   CR 122.5, 122.8     "if it had counters on it, put its counters on up to one target creature": the counters the creature had as it died (last known information)
 *   CR 402.1, 102.3     "an opponent has more cards in hand than you", "investigate once for each opponent who has more cards in hand than you"
 *   CR 119.4, 608.2d    "you may pay 1 life. If you do, ..."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, pass, put, scenario } from '../../m3/scenario';
import { lifeOf, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
/** Every ability of the card automated, and the card full. */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

/** Answer the decisions that come up (targets, costs, then `answers` in order); stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((i) => i.id) }); // CR 603.3b: any order
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty (each object resolves after both players pass), answering what comes up. */
function resolveAll(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = settle(s0, targets, answers);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), targets, answers);
  expect(s.zones.stack.length).toBe(0);
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], player = 'p1'): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), targets);
/** The end step of the current turn with its triggers resolved. */
const endStep = (s: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState => resolveAll(advanceTo(s, s.turn.number, 'end'), targets, answers);
import { getChars } from '../../../src/rules/characteristics';
const clues = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token' && getChars(s, id)!.subtypes.includes('Clue')).length;
const counters = (s: GameState, id: ObjectId): Record<string, number> => ({ ...s.objects[id]!.counters });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const MAKER = card('Test Maker', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
const SIP = card('Test Sip', 'Instant', 'You gain 1 life.');
const DRAIN = card('Test Drain', 'Instant', 'You lose 1 life.');
const DISCARD = card('Test Discard', 'Instant', 'Discard a card.');
const EXILER = card('Test Exiler', 'Instant', 'Exile target card from a graveyard.');

/** Counter on an end-step watcher, as a plain number. */
const watcher = (name: string, ifClause: string, effect = 'put a +1/+1 counter on ~'): CardDef =>
  card(name, 'Creature — Spirit', `At the beginning of your end step, if ${ifClause}, ${effect}.`, { pt: ['1', '1'] });
const plus = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;

describe('CR 603.4, 603.10a: "if a creature died under an opponent\'s control this turn"', () => {
  const HUNT = card('Test Hunt Pup', 'Creature — Spirit', "At the beginning of your end step, if a creature died under an opponent's control this turn, you gain 3 life.", { pt: ['1', '1'] });
  const game = (): GameState => scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Hunt Pup', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [HUNT, BEAR, KILL] });
  it('is automated', () => expect(full(HUNT)).toBe(true));
  it('their creature died: the trigger resolves', () => {
    let s = game();
    s = resolveAll(cast(s, 'Test Kill', [obj(find(s, 'Test Bear', 'battlefield', 'p2'))]));
    expect(lifeOf(endStep(s), 'p1')).toBe(23);
  });
  it('your own creature died: it did not die under an opponent\'s control', () => {
    let s = game();
    s = resolveAll(cast(s, 'Test Kill', [obj(find(s, 'Test Bear', 'battlefield', 'p1'))]));
    expect(lifeOf(endStep(s), 'p1')).toBe(20);
  });
});

describe('CR 404.1: "if eight or more cards are in your graveyard"', () => {
  const COLLECT = card('Test Collector', 'Creature — Spirit', 'At the beginning of your end step, if eight or more cards are in your graveyard, you gain 1 life.', { pt: ['1', '1'] });
  it('is automated; seven cards do not trigger it, eight do', () => {
    expect(full(COLLECT)).toBe(true);
    const seven = Array(7).fill('Test Bear') as string[];
    expect(lifeOf(endStep(scenario([], { p1: { graveyard: seven, battlefield: ['Test Collector'] }, defs: [COLLECT, BEAR] })), 'p1')).toBe(20);
    expect(lifeOf(endStep(scenario([], { p1: { graveyard: [...seven, 'Test Bear'], battlefield: ['Test Collector'] }, defs: [COLLECT, BEAR] })), 'p1')).toBe(21);
  });
});

describe('CR 402.1, 102.3: "if an opponent has more cards in hand than you" and "investigate once for each opponent who has more cards in hand than you"', () => {
  const GUARD = card('Test Hand Guard', 'Creature — Spirit', 'At the beginning of your upkeep, if an opponent has more cards in hand than you, you gain 3 life.', { pt: ['1', '1'] });
  const SLEUTH = card('Test Hand Sleuth', 'Creature — Spirit', 'At the beginning of your upkeep, investigate once for each opponent who has more cards in hand than you.', { pt: ['1', '1'] });
  const game = (mine: number, theirs: number): GameState =>
    scenario([], { p1: { hand: Array(mine).fill('Test Bear') as string[], battlefield: ['Test Hand Guard', 'Test Hand Sleuth'] }, p2: { hand: Array(theirs).fill('Test Bear') as string[] }, defs: [GUARD, SLEUTH, BEAR] });
  // p1's next upkeep is turn 3 (p2 has turn 2 and draws one card in it)
  const upkeep3 = (s: GameState): GameState => resolveAll(advanceTo(s, 3, 'upkeep'));
  it('are automated', () => { expect(full(GUARD)).toBe(true); expect(full(SLEUTH)).toBe(true); });
  it('the opponent has more cards: 3 life and one Clue', () => {
    const s = upkeep3(game(1, 4));
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(clues(s)).toBe(1);
  });
  it('the opponent has as many or fewer cards (after their draw): nothing', () => {
    for (const [mine, theirs] of [[3, 2], [4, 1]] as const) {
      const s = upkeep3(game(mine, theirs));
      expect(lifeOf(s, 'p1')).toBe(20);
      expect(clues(s)).toBe(0);
    }
  });
});
