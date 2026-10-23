/**
 * Merge wave 8, audit D4 (review item E4): Leader, Super-Genius ("If a creature you control would connive, instead you draw a
 * card, then that creature connives.") turned "connives X" into "draw a card, then connive 1": template rep.r3repl.connive.drawFirst rebuilt the event without
 * its amount. It now uses the replacement body "instead A, then [the replaced event]" (`insteadThen`, effects/instead.ts): the draw, then the same connive with
 * all its parameters. Real cards (Oracle text from the card index) and, for two Leaders on one side (Leader is legendary), a nonlegendary synthetic copy.
 *
 *   CR 614.1a, 614.6   the connive is replaced by the modified event: you draw a card, then the same connive (connive N stays connive N)
 *   CR 614.5           Leader applies to one connive once: the connive that follows its draw is not replaced by it again
 *   CR 616.1           two such effects: the affected player orders them, the second applies to the modified event (draw, draw, connive N)
 *   CR 701.50a, 701.50d  connive N: draw N, discard N, a +1/+1 counter for each nonland card discarded
 *   CR 701.50b         a permanent no longer on the battlefield still connives (its last known information); it is no longer "a creature you control"
 *   CR 121.1, 614.1a   Leader's draw is a draw: a draw replacement applies to it
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil } from '../../m4/helpers';

function oracle(name: string, mana_cost: string, type_line: string, oracle_text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost, type_line, oracle_text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const LEADER_TEXT = 'If a creature you control would connive, instead you draw a card, then that creature connives.\nAt the beginning of combat on your turn, target creature you control connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on that creature.)';
const LEADER = oracle('Leader, Super-Genius', '{2}{U}{U}', 'Legendary Creature — Gamma Scientist Villain', LEADER_TEXT, ['1', '3']);
const RAFFINE = oracle('Raffine, Scheming Seer', '{W}{U}{B}', 'Legendary Creature — Sphinx Demon',
  'Flying, ward {1}\nWhenever you attack, target attacking creature connives X, where X is the number of attacking creatures. (Draw X cards, then discard X cards. Put a +1/+1 counter on that creature for each nonland card discarded this way.)', ['1', '4']);
const LEDGER = oracle('Ledger Shredder', '{1}{U}', 'Creature — Bird Advisor',
  'Flying\nWhenever a player casts their second spell each turn, this creature connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)', ['1', '3']);
const GENIUS = oracle('Test Genius', '{2}{U}{U}', 'Creature — Gamma Scientist', 'If a creature you control would connive, instead you draw a card, then that creature connives.', ['1', '3']);
const DOUBLER = oracle('Test Reflection', '{0}', 'Enchantment', 'If you would draw a card, draw two cards instead.');
const CANTRIP = oracle('Test Cantrip', '{0}', 'Instant', 'You gain 1 life.');
const DEFS = [LEADER, RAFFINE, LEDGER, GENIUS, DOUBLER, CANTRIP];

const hand = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const yard = (s: GameState, p = 'p1'): number => s.zones.graveyard[p]!.length;
const plusOnes = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;

interface Plan { targets?: TargetChoice[]; discard?: (options: ObjectId[], min: number) => ObjectId[] }
/** Answer what comes up (targets, discards, the order of replacement effects) until a player has priority with an empty stack. */
function settle(s0: GameState, plan: Plan = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80; guard++) {
    const d = s.pending;
    if (!d) break;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: plan.targets ?? [] });
    else if (d.kind === 'chooseObjects') {
      const o = d as unknown as { options: ObjectId[]; min: number };
      s = answer(s, { kind: 'chooseObjects', ids: plan.discard ? plan.discard(o.options, o.min) : o.options.slice(0, o.min) });
    } else if (d.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: (d as unknown as { options: { id: string }[] }).options[0]!.id });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}

/** Turn 1, p1's beginning of combat with the stack empty, from main 1 (Leader's own begin-combat trigger resolved with `plan`). */
function toCombat(s0: GameState, plan: Plan): GameState {
  const s = passUntil(s0, (x) => x.turn.step === 'beginCombat' && (x.pending?.kind !== 'priority' || x.zones.stack.length > 0), 'the beginning of combat');
  return settle(s, plan);
}

describe('the cards are automated', () => {
  it('every card of this file plays fully', () => {
    for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
});

describe('audit D4: Leader, Super-Genius keeps the connive it replaces (CR 614.1a, 614.6, 701.50d)', () => {
  it('Raffine, Scheming Seer attacking with three creatures (connive 3): draw 1, then draw 3 and discard 3, one counter for each nonland card discarded', () => {
    // Alice's library is all Plains (scenario.ts): the 4 cards drawn are lands; she discards 2 lands and the Shock she held, one nonland card
    const s0 = scenario(['Plains', 'Grizzly Bears', 'Shock'], {
      p1: { hand: ['Shock'], battlefield: ['Leader, Super-Genius', 'Raffine, Scheming Seer', 'Grizzly Bears'] }, defs: DEFS,
    });
    const leader = find(s0, 'Leader, Super-Genius', 'battlefield');
    const raffine = find(s0, 'Raffine, Scheming Seer', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const shock = find(s0, 'Shock', 'hand');
    // Leader's own trigger first (connive 1 on Leader): draw 1 (Leader), then draw 1 and discard a Plains
    const c = toCombat(s0, { targets: [{ kind: 'object', id: leader }], discard: (o, min) => o.filter((x) => x !== shock).slice(0, min) });
    expect(hand(c)).toBe(2); // Shock + one Plains
    const atk = passUntil(c, (x) => x.pending?.kind === 'declareAttackers', 'the declare attackers decision');
    const declared = declareAttackers(atk, [[leader], [raffine], [bears]]);
    const handBefore = hand(declared);
    const yardBefore = yard(declared);
    const s = settle(declared, { targets: [{ kind: 'object', id: bears }], discard: (o, min) => [...(o.includes(shock) ? [shock] : []), ...o.filter((x) => x !== shock)].slice(0, min) });
    expect(hand(s)).toBe(handBefore + 1 + 3 - 3); // Leader's draw, then connive 3
    expect(yard(s)).toBe(yardBefore + 3); // three cards discarded, not one
    expect(plusOnes(s, bears)).toBe(1); // Shock is the one nonland card discarded
  });
  it('a connive 1 (Leader\'s own trigger): draw 1, then draw 1 and discard 1', () => {
    const s0 = scenario(['Plains', 'Shock'], { p1: { hand: ['Shock'], battlefield: ['Leader, Super-Genius'] }, defs: DEFS });
    const leader = find(s0, 'Leader, Super-Genius', 'battlefield');
    const shock = find(s0, 'Shock', 'hand');
    const s = toCombat(s0, { targets: [{ kind: 'object', id: leader }], discard: () => [shock] });
    expect(hand(s)).toBe(1 + 1 + 1 - 1);
    expect(yard(s)).toBe(1);
    expect(plusOnes(s, leader)).toBe(1);
  });
  it('two such effects (Leader and a nonlegendary copy of its text): draw, draw, then connive 1, each applied once (CR 614.5, 616.1)', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Leader, Super-Genius', 'Test Genius'] }, defs: DEFS });
    const leader = find(s0, 'Leader, Super-Genius', 'battlefield');
    const s = toCombat(s0, { targets: [{ kind: 'object', id: leader }] });
    expect(hand(s)).toBe(1 + 1 + 1 - 1);
    expect(yard(s)).toBe(1);
  });
  it('an opponent\'s creature that connives is not replaced (only "a creature you control")', () => {
    const s0 = scenario(['Plains', 'Shock'], { p1: { battlefield: ['Leader, Super-Genius'] }, p2: { battlefield: ['Test Genius'] }, defs: DEFS });
    const leader = find(s0, 'Leader, Super-Genius', 'battlefield');
    // Bob's Test Genius replaces only Bob's creatures' connives: Alice's Leader connives with one draw of Leader's (Alice's) own replacement
    const s = toCombat(s0, { targets: [{ kind: 'object', id: leader }] });
    expect(hand(s)).toBe(1);
    expect(hand(s, 'p2')).toBe(0);
  });
  it('the conniving creature left the battlefield (Lightning Bolt in response to its trigger): it still connives, draw 1 and discard 1 (CR 701.50b), and Leader does not apply', () => {
    const s0 = scenario(['Plains', 'Mountain', 'Lightning Bolt'], {
      p1: { hand: ['Test Cantrip', 'Test Cantrip', 'Lightning Bolt'], battlefield: ['Leader, Super-Genius', 'Ledger Shredder', 'Mountain'] }, defs: DEFS,
    });
    const ledger = find(s0, 'Ledger Shredder', 'battlefield');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cantrip', 'hand') }));
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cantrip', 'hand') }); // the second spell this turn: Ledger Shredder's trigger
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.stack.length).toBe(2);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: ledger }] });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    const handBefore = hand(s);
    s = settle(s, { discard: (o, min) => o.slice(0, min) });
    expect(s.zones.battlefield).not.toContain(ledger);
    expect(hand(s)).toBe(handBefore + 1 - 1); // the connive's draw and discard; no draw of Leader's
  });
  it('Leader\'s draw is a draw: a draw replacement applies to it (If you would draw a card, draw two cards instead; CR 121.1, 614.1a)', () => {
    const s0 = scenario(['Plains', 'Shock'], { p1: { hand: ['Shock'], battlefield: ['Leader, Super-Genius', 'Test Reflection'] }, defs: DEFS });
    const leader = find(s0, 'Leader, Super-Genius', 'battlefield');
    const shock = find(s0, 'Shock', 'hand');
    const s = toCombat(s0, { targets: [{ kind: 'object', id: leader }], discard: (o) => (o.includes(shock) ? [shock] : [o[0]!]) });
    expect(hand(s)).toBe(1 + 2 + 2 - 1); // Leader's draw and the connive's draw, each replaced by two draws; one card discarded
    expect(plusOnes(s, leader)).toBe(1); // Shock, a nonland card
  });
});
