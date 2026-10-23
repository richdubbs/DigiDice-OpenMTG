/**
 * Card wave 2, slice s16 (std-rx11): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. Nothing is mocked. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 208.1, 613.4a-c    "a creature you control with power greater than its base power": a +1/+1 counter (layer 7c) raises power above the base; a creature
 *                         without one does not qualify
 *   CR 603.2c, 510.2      "one or more creatures you control each with power greater than its base power deals combat damage to a player": one trigger for the
 *                         batch, and none when only creatures at their base power deal the damage
 *   CR 603.4              the intervening "if you control a creature with power greater than its base power" of an end step trigger
 *   CR 603.7c, 510.2      "Whenever that creature deals combat damage this turn, you may exile it": the delayed trigger waits for the target's combat damage
 *   CR 400.7, 608.2c      "If you do, return it to the battlefield under its owner's control": the exiled card returns (a new object); declining leaves it
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

interface Script { yes?: boolean[]; targets?: TargetChoice[][] }
/** Answer the decisions that come up (yes/no and targets in order; costs paid automatically) until a player has priority or combat asks for a declaration. */
function settle(s0: GameState, q: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers' && s.pending.kind !== 'declareBlockers'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes?.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets?.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Pass priority (no blockers) until `done`, answering what comes up. */
function passTo(s0: GameState, done: (s: GameState) => boolean, q: Script = {}, max = 200): GameState {
  let s = s0;
  for (let guard = 0; guard < max && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, q);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
/** Attack with these creatures and play the turn on to its second main phase. */
function attackWith(s0: GameState, attackers: ObjectId[], q: Script = {}): GameState {
  const s = declareAttackers(toDeclareAttackers(s0), attackers.map((a) => [a]));
  return passTo(s, (x) => x.turn.step === 'main2' && x.zones.stack.length === 0 && x.pending?.kind === 'priority', q);
}
const hand = (s: GameState): number => findAll(s, 'Test Filler', 'hand', 'p1').length;
const tokens = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.');
const SIGIL = card('Test Sigil of Growth', 'Enchantment', 'Whenever one or more creatures you control each with power greater than its base power deals combat damage to a player, draw a card.');
const BANNER = card('Test Growth Banner', 'Enchantment', 'Whenever a creature you control with power greater than its base power deals combat damage to a player, draw a card.');
const CALL = card('Test Muster Call', 'Enchantment', 'At the beginning of your end step, if you control a creature with power greater than its base power, create a 1/1 white Soldier creature token.');
const DEFS = [BEAR, FILLER, SIGIL, BANNER, CALL];
const LIBRARY = ['Test Filler', 'Test Filler', 'Test Filler', 'Test Filler'];

describe('CR 208.1, 613.4: "with power greater than its base power" (rules/filter.ts, base power after layer 7b)', () => {
  it('the three wordings are automated', () => {
    expect(full(SIGIL)).toBe(true);
    expect(full(BANNER)).toBe(true);
    expect(full(CALL)).toBe(true);
  });
  it('CR 613.4c: a creature with a +1/+1 counter deals combat damage to a player: its power 3 is greater than its base power 2, so you draw', () => {
    let s = scenario([], { p1: { battlefield: ['Test Growth Banner', { name: 'Test Bear', counters: { '+1/+1': 1 } }], library: LIBRARY }, defs: DEFS });
    s = attackWith(s, [find(s, 'Test Bear', 'battlefield', 'p1')]);
    expect(hand(s)).toBe(1);
  });
  it('a creature at its base power (no counter) deals combat damage: no draw', () => {
    let s = scenario([], { p1: { battlefield: ['Test Growth Banner', 'Test Bear'], library: LIBRARY }, defs: DEFS });
    s = attackWith(s, [find(s, 'Test Bear', 'battlefield', 'p1')]);
    expect(hand(s)).toBe(0);
  });
});

describe('CR 603.2c, 510.2: "one or more creatures you control each with power greater than its base power deals combat damage to a player"', () => {
  it('two such creatures in one combat damage step: one trigger, one card', () => {
    let s = scenario([], { p1: { battlefield: ['Test Sigil of Growth', { name: 'Test Bear', counters: { '+1/+1': 1 } }, { name: 'Test Bear', counters: { '+1/+1': 2 } }], library: LIBRARY }, defs: DEFS });
    s = attackWith(s, findAll(s, 'Test Bear', 'battlefield', 'p1'));
    expect(hand(s)).toBe(1);
  });
  it('only a creature at its base power deals the damage (the one with a counter stays home): no trigger', () => {
    let s = scenario([], { p1: { battlefield: ['Test Sigil of Growth', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Bear'], library: LIBRARY }, defs: DEFS });
    const plain = findAll(s, 'Test Bear', 'battlefield', 'p1').find((id) => (s.objects[id]!.counters['+1/+1'] ?? 0) === 0)!;
    s = attackWith(s, [plain]);
    expect(hand(s)).toBe(0);
  });
});

describe('CR 603.4: "if you control a creature with power greater than its base power" at the beginning of your end step', () => {
  const toEnd = (s: GameState): GameState => passTo(s, (x) => x.turn.step === 'cleanup' || (x.turn.number > 1));
  it('with a +1/+1 counter on a creature you control: a Soldier token', () => {
    const s = toEnd(scenario([], { p1: { battlefield: ['Test Muster Call', { name: 'Test Bear', counters: { '+1/+1': 1 } }], library: LIBRARY }, defs: DEFS }));
    expect(tokens(s)).toHaveLength(1);
  });
  it('without one (every creature at its base power): no token; an opponent\'s countered creature does not count', () => {
    const s = toEnd(scenario([], { p1: { battlefield: ['Test Muster Call', 'Test Bear'], library: LIBRARY }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }] }, defs: DEFS }));
    expect(tokens(s)).toHaveLength(0);
  });
});

const TOAD = card('Test River Toad', 'Creature — Frog', "When this creature enters, target creature you control can't be blocked this turn. Whenever that creature deals combat damage this turn, you may exile it. If you do, return it to the battlefield under its owner's control.", ['1', '1']);

describe('CR 603.7c, 400.7: "Whenever that creature deals combat damage this turn, you may exile it. If you do, return it to the battlefield under its owner\'s control."', () => {
  it('is automated; the return is inside the delayed trigger and acts on the exiled card (a binding of the exile), not on the target', () => {
    expect(full(TOAD)).toBe(true);
    const json = JSON.stringify(TOAD.faces[0]!.abilities[0]);
    expect(json).toContain('"op":"delay"');
    expect(json).toMatch(/"what":\{"ref":"bound","name":"[^"]+"\},"to":\{"zone":"battlefield","controller":"owner"\}/);
  });
  /** Cast the Toad targeting the Bear, then attack with the Bear (unblockable this turn). */
  const play = (yes: boolean): { s: GameState; bear: ObjectId } => {
    let s = scenario([], { p1: { hand: ['Test River Toad'], battlefield: ['Test Bear'], library: LIBRARY }, defs: [...DEFS, TOAD] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test River Toad', 'hand', 'p1') }));
    s = settle(pass(pass(s)), { targets: [[obj(bear)]] }); // the Toad resolves; its trigger targets the Bear
    s = settle(pass(pass(s))); // the trigger resolves
    return { s: attackWith(s, [bear], { yes: [yes] }), bear };
  };
  it('the creature deals combat damage and you exile it: it returns to the battlefield as a new object (untapped, out of combat), and the player took the damage', () => {
    const { s, bear } = play(true);
    const now = findAll(s, 'Test Bear', 'battlefield', 'p1');
    expect(now).toHaveLength(1);
    expect(now[0]).not.toBe(bear);
    expect(s.objects[now[0]!]!.tapped).toBe(false);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    expect(s.zones.exile).toEqual([]);
  });
  it('declining ("you may") leaves the same creature on the battlefield, tapped from attacking', () => {
    const { s, bear } = play(false);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toEqual([bear]);
    expect(s.objects[bear]!.tapped).toBe(true);
  });
});
