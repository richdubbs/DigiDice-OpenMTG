/**
 * Standard card wave 2, slice s4 (std-rt): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks (CR cites from memory, unverified: rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 608.2c, 400.7, 609.4b   "Exile the top card of target opponent's library. You may play the exiled card this turn, and mana of any type can be spent to
 *                              cast it": the exiled card (not the next card of that library), this turn only, with any type of mana
 *   CR 603.7b, 611.2a, 514.2   "Until the end of your next turn, whenever you cast a spell, ...": triggers on each of your spells through the rest of this
 *                              turn, the opponent's turn and all of your next turn, then ends; never on an opponent's spell; begun on an opponent's turn it
 *                              lasts through your coming turn
 *   CR 603.3d, 115.1           ... "~ deals 2 damage to up to one target creature": the target is chosen as the delayed trigger is put on the stack (none is
 *                              allowed)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

/** Answer the decisions that come up: target groups from `targets`, then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const groups = [...targets];
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty; the targets of triggers that go on the stack on the way come from `targets`. */
function drain(s0: GameState, targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const groups = [...targets];
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    if (s.pending?.kind === 'priority') s = pass(s);
    else {
      const before = s;
      s = settle(s, s.pending?.kind === 'chooseTargets' && groups.length > 0 ? [groups.shift()!] : []);
      if (s === before) break;
    }
  }
  return s;
}
/** `player` casts `name` from their hand (the other player passes priority to them first) and everything on the stack resolves. */
function castNow(s0: GameState, name: string, player: 'p1' | 'p2' = 'p1', targets: TargetChoice[][] = []): GameState {
  const s = s0.pending?.kind === 'priority' && s0.pending.player !== player ? pass(s0) : s0;
  return drain(settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) })), targets);
}
function activate(s: GameState, name: string, targets: TargetChoice[][] = []): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return drain(settle(act(s, la.action), targets));
}
const offered = (s: GameState, id: ObjectId, kind: 'cast' | 'playLand' = 'cast'): boolean => legal(s, 'p1', kind).some((a) => a.object === id);

const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '3'], '{R}{R}');
const IMP = card('Test Imp', 'Creature — Imp', '', ['2', '2'], '{R}');
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);

describe('CR 608.2c, 400.7, 609.4b: "Exile the top card of target opponent\'s library. You may play the exiled card this turn, and mana of any type can be spent to cast it."', () => {
  const RAID = card('Test Raid Thief', 'Artifact', '{T}: Exile the top card of target opponent\'s library. You may play the exiled card this turn, and mana of any type can be spent to cast it.');
  const opp: TargetChoice[][] = [[{ kind: 'player', id: 'p2' }]];
  const defs = [RAID, BRUTE, IMP];

  it('is fully automated (eff.e29.permit.play.obj.dur.anyType, stable since this round)', () => {
    expect(full(RAID), JSON.stringify(RAID.automation)).toBe(true);
    expect(JSON.stringify(RAID.faces[0]!.abilities[0])).toContain('"anyManaType":true');
  });
  it('the exiled card is cast with two Plains this turn; the card under it stays in the library and is not offered', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Raid Thief', 'Plains', 'Plains'] }, p2: { library: ['Test Brute', 'Test Imp'] }, defs });
    let s = activate(s0, 'Test Raid Thief', opp);
    const brute = find(s, 'Test Brute', 'exile', 'p2');
    const imp = find(s, 'Test Imp', 'library', 'p2');
    expect(offered(s, brute)).toBe(true);
    expect(offered(s, imp)).toBe(false);
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: brute })));
    expect(battlefieldNames(s, 'p1')).toContain('Test Brute'); // {R}{R} paid with two Plains (CR 609.4b)
  });
  it('the permission ends with the turn (CR 514.2): on your next turn the exiled card is no longer offered', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Raid Thief', 'Plains', 'Plains'] }, p2: { library: ['Test Brute', 'Test Imp', 'Test Imp', 'Test Imp'] }, defs });
    let s = activate(s0, 'Test Raid Thief', opp);
    const brute = find(s, 'Test Brute', 'exile', 'p2');
    s = advanceTo(s, 3, 'main1');
    expect(offered(s, brute)).toBe(false);
  });
});

describe('CR 603.7b, 611.2a, 514.2: "Until the end of your next turn, whenever you cast a spell, ..." (eff.stdrt.untilEndOfYourNextTurn.whenever)', () => {
  const VIGIL = card('Test Long Vigil', 'Instant', 'Until the end of your next turn, whenever you cast a spell, you gain 2 life.');
  const defs = [VIGIL, SPARK];
  const hand = (n: number): string[] => Array.from({ length: n }, () => 'Test Spark');

  it('is fully automated as a delayed trigger with the duration endOfNextTurn (capability dur:endOfNextTurn)', () => {
    expect(full(VIGIL), JSON.stringify(VIGIL.automation)).toBe(true);
    expect(JSON.stringify(VIGIL.faces[0]!.abilities[0])).toContain('"duration":{"d":"endOfNextTurn","whose":{"ref":"you"}}');
  });
  it('begun on your turn: your spells this turn, during the opponent\'s turn and during your next turn trigger it; the opponent\'s do not; it is over after your next turn', () => {
    let s = scenario([], { p1: { hand: ['Test Long Vigil', ...hand(4)] }, p2: { hand: hand(1) }, defs });
    s = castNow(s, 'Test Long Vigil');
    expect(s.delayedTriggers).toHaveLength(1);
    const l0 = life(s, 'p1'); // 20
    s = castNow(s, 'Test Spark'); // this turn: +2 (trigger) +1 (spell)
    expect(life(s, 'p1')).toBe(l0 + 3);
    s = advanceTo(s, 2, 'main1'); // the opponent's turn
    s = castNow(s, 'Test Spark', 'p2'); // an opponent's spell: no trigger (p2 gains 1)
    expect(life(s, 'p1')).toBe(l0 + 3);
    s = castNow(s, 'Test Spark', 'p1'); // your instant on their turn: +3
    expect(life(s, 'p1')).toBe(l0 + 6);
    s = advanceTo(s, 3, 'main1'); // your next turn
    s = castNow(s, 'Test Spark'); // +3
    expect(life(s, 'p1')).toBe(l0 + 9);
    s = advanceTo(s, 5, 'main1'); // the turn after: over (the cleanup step of turn 3 ended it)
    expect(s.delayedTriggers).toHaveLength(0);
    s = castNow(s, 'Test Spark'); // +1 only
    expect(life(s, 'p1')).toBe(l0 + 10);
  });
  it('begun on an opponent\'s turn: it lasts through your coming turn (the next turn of yours, not the current one), and then ends', () => {
    let s = scenario([], { p1: { hand: ['Test Long Vigil', ...hand(2)] }, defs });
    s = advanceTo(s, 2, 'main1');
    s = castNow(s, 'Test Long Vigil');
    s = advanceTo(s, 3, 'main1');
    const l0 = life(s, 'p1');
    s = castNow(s, 'Test Spark');
    expect(life(s, 'p1')).toBe(l0 + 3);
    s = advanceTo(s, 5, 'main1');
    expect(s.delayedTriggers).toHaveLength(0);
    s = castNow(s, 'Test Spark');
    expect(life(s, 'p1')).toBe(l0 + 4);
  });
});

describe('CR 603.3d, 115.1: "Until the end of your next turn, whenever you cast a spell, ~ deals 2 damage to up to one target creature."', () => {
  const EMBER = card('Test Ember Season', 'Sorcery', 'Until the end of your next turn, whenever you cast a spell, ~ deals 2 damage to up to one target creature.');
  const defs = [EMBER, SPARK, BEAR];
  it('is fully automated', () => expect(full(EMBER), JSON.stringify(EMBER.automation)).toBe(true));
  it('each of your spells lets you pick a creature as the trigger goes on the stack: a 2/2 dies; with no target chosen nothing is dealt damage', () => {
    let s = scenario([], { p1: { hand: ['Test Ember Season', 'Test Spark', 'Test Spark'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs });
    s = castNow(s, 'Test Ember Season');
    const [b1, b2] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear');
    s = castNow(s, 'Test Spark', 'p1', [[obj(b1!)]]);
    expect(battlefieldNames(s, 'p2')).toEqual(['Test Bear']);
    expect(s.zones.battlefield).toContain(b2);
    s = castNow(s, 'Test Spark', 'p1', [[]]);
    expect(battlefieldNames(s, 'p2')).toEqual(['Test Bear']);
    expect(s.objects[b2!]!.damage ?? 0).toBe(0);
  });
});
