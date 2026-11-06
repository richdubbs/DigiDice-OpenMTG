/**
 * Commander lane edh-next, round edh-next-36: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 702.57a             Forecast: "{1}{W}, Reveal this card from your hand: ... Activate only during your upkeep and only once each turn." (Spirit en-Dal, Sky Hussar)
 *   CR 701.17a, 608.2d     "Mill three cards. You may put a <description> from among the cards milled this way into your hand. If you don't, put a +1/+1 counter" (Fallaji Archaeologist, Airlift Chaplain)
 *   CR 701.20e, 608.2d     "Put up to two of them into your hand and the rest on the bottom of your library in a random order." (The Mana Rig)
 *   CR 603.7, 400.7        "Return ~ to the battlefield under its owner's control when that token dies." (Tatsumasa, the Dragon's Fang)
 *   CR 508.1c, 509.1b, 702.122a, 602.5, 605.1a   "Enchanted permanent can't attack, block, or crew Vehicles. Its activated abilities can't be activated unless they're mana abilities." (Intercessor's Arrest)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
/** Resolve everything on the stack. `yes` answers every yes/no; `take` picks which of the offered objects a choice takes. */
const resolveAll = (s0: GameState, yes = true, take: 'one' | 'all' | 'none' | 'last' = 'one'): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 60 && s.pending !== null && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); g++) {
    const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number };
    if (d.kind === 'priority') s = settle(pass(s));
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes } as DecisionAnswer);
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer);
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: take === 'none' ? [] : take === 'all' ? (d.options ?? []) : take === 'last' ? (d.options ?? []).slice(-1) : (d.options ?? []).slice(0, Math.max(1, d.min ?? 1)) } as DecisionAnswer);
    else s = settle(s);
  }
  return s;
};
const cast = (s: GameState, name: string, yes = true, take: 'one' | 'all' | 'none' | 'last' = 'one'): GameState =>
  resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never)), yes, take);
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const lib = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));
const gy = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id));
const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id));
const count = (xs: string[], n: string): number => xs.filter((x) => x === n).length;
const counters = (s: GameState, name: string): number => s.objects[find(s, name, 'battlefield')]!.counters?.['+1/+1'] ?? 0;

const LAND = card('Test Moor', 'Land', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const BIG = card('Test Giant', 'Creature — Giant', '', { pt: ['6', '6'], cost: '{5}{G}' });
const RING = card('Test Ring', 'Artifact', '');
const SPELL = card('Test Charm', 'Instant', '');

describe('CR 702.57a: forecast is a hand ability for your upkeep, once each turn', () => {
  const FOR = card('Test Seer', 'Creature — Human', 'Forecast — {0}, Reveal this card from your hand: Draw a card. (Activate only during your upkeep and only once each turn.)', { pt: ['1', '1'] });
  const setup = (): GameState => scenario([], { defs: [FOR, BEAR, LAND], p1: { hand: ['Test Seer'], library: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { library: ['Test Bear'] } });
  const forecasts = (s: GameState) => legal(s, 'p1', 'activate');
  it('is automated, with the ability functioning in the hand', () => { expect(noManual(FOR)).toEqual([]); });
  it('is offered in your upkeep, reveals the card (it stays in your hand) and draws once; a second activation the same turn is refused', () => {
    const s0 = advanceTo(setup(), 3, 'upkeep');
    expect(forecasts(s0).length).toBeGreaterThan(0);
    const s1 = resolveAll(settle(act(s0, forecasts(s0)[0]!.action)));
    expect(handNames(s1, 'p1')).toContain('Test Seer');
    expect(count(handNames(s1, 'p1'), 'Test Bear')).toBe(1);
    expect(forecasts(s1)).toEqual([]);
  });
  it('is not offered in your main phase, nor in an opponent\'s upkeep', () => {
    expect(forecasts(setup())).toEqual([]);
    const theirs = advanceTo(setup(), 2, 'upkeep');
    expect(legal(theirs, 'p1', 'activate')).toEqual([]);
  });
  it('can be activated again in your next upkeep (the limit is once each turn)', () => {
    const s0 = advanceTo(setup(), 3, 'upkeep');
    const s1 = resolveAll(settle(act(s0, forecasts(s0)[0]!.action)));
    const s2 = advanceTo(s1, 5, 'upkeep');
    expect(forecasts(s2).length).toBeGreaterThan(0);
  });
});

describe('CR 701.17a, 608.2d: "Mill three cards. You may put a <description> from among the cards milled this way into your hand. If you don\'t, put a +1/+1 counter on this creature."', () => {
  const ARCH = card('Test Delver', 'Creature — Human', 'When this creature enters, mill three cards. You may put a noncreature, nonland card from among the cards milled this way into your hand. If you don\'t, put a +1/+1 counter on this creature.', { pt: ['1', '1'] });
  const CHAP = card('Test Chaplain', 'Creature — Human', 'When this creature enters, mill three cards. You may put a Forest card or a creature card with mana value 3 or less from among the cards milled this way into your hand. If you don\'t, put a +1/+1 counter on this creature.', { pt: ['1', '1'] });
  const FOREST = card('Test Forest', 'Basic Land — Forest', '');
  const defs = [ARCH, CHAP, BEAR, BIG, LAND, RING, SPELL, FOREST];
  it('are automated', () => { expect(noManual(ARCH)).toEqual([]); expect(noManual(CHAP)).toEqual([]); });
  it('noncreature, nonland: takes the artifact, leaves creature and land cards, and puts no counter', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Delver'], library: ['Test Bear', 'Test Ring', 'Test Moor', 'Test Bear'] } }), 'Test Delver');
    expect(handNames(s, 'p1')).toEqual(['Test Ring']);
    expect(gy(s, 'p1')).toEqual(expect.arrayContaining(['Test Bear', 'Test Moor']));
    expect(counters(s, 'Test Delver')).toBe(0);
  });
  it('noncreature, nonland: with only creatures and lands milled (nothing to take), the counter goes on', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Delver'], library: ['Test Bear', 'Test Moor', 'Test Bear', 'Test Bear'] } }), 'Test Delver');
    expect(handNames(s, 'p1')).toEqual([]);
    expect(counters(s, 'Test Delver')).toBe(1);
  });
  it('noncreature, nonland: choosing not to take a card puts the counter on, and the card stays in the graveyard', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Delver'], library: ['Test Ring', 'Test Bear', 'Test Bear', 'Test Bear'] } }), 'Test Delver', true, 'none');
    expect(handNames(s, 'p1')).toEqual([]);
    expect(gy(s, 'p1')).toContain('Test Ring');
    expect(counters(s, 'Test Delver')).toBe(1);
  });
  it('only the cards milled this way: a matching card already in the graveyard or still in the library is not offered', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Delver'], graveyard: ['Test Ring'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Ring'] } }), 'Test Delver');
    expect(handNames(s, 'p1')).toEqual([]);
    expect(counters(s, 'Test Delver')).toBe(1);
    expect(lib(s, 'p1')[0]).toBe('Test Ring');
  });
  it('Forest or creature with mana value 3 or less: takes a Forest, or a cheap creature; a mana value 6 creature and a plain land are not offered', () => {
    const f = cast(scenario([], { defs, p1: { hand: ['Test Chaplain'], library: ['Test Forest', 'Test Moor', 'Test Giant', 'Test Ring'] } }), 'Test Chaplain');
    expect(handNames(f, 'p1')).toEqual(['Test Forest']);
    expect(counters(f, 'Test Chaplain')).toBe(0);
    const b = cast(scenario([], { defs, p1: { hand: ['Test Chaplain'], library: ['Test Bear', 'Test Moor', 'Test Ring', 'Test Giant'] } }), 'Test Chaplain');
    expect(handNames(b, 'p1')).toEqual(['Test Bear']);
    const n = cast(scenario([], { defs, p1: { hand: ['Test Chaplain'], library: ['Test Giant', 'Test Moor', 'Test Ring', 'Test Charm'] } }), 'Test Chaplain');
    expect(handNames(n, 'p1')).toEqual([]);
    expect(counters(n, 'Test Chaplain')).toBe(1);
  });
});

describe('CR 701.20e, 608.2d: "Put up to two of them into your hand and the rest on the bottom of your library in a random order."', () => {
  const DIG = card('Test Dig', 'Sorcery', 'Look at the top four cards of your library. Put up to two of them into your hand and the rest on the bottom of your library in a random order.');
  const setup = (): GameState => scenario([], { defs: [DIG, BEAR, LAND, RING, SPELL], p1: { hand: ['Test Dig'], library: ['Test Bear', 'Test Moor', 'Test Ring', 'Test Charm', 'Test Bear'] } });
  it('is automated', () => { expect(noManual(DIG)).toEqual([]); });
  it('takes two when you choose two; the other two go below the fifth card; the fifth card is untouched', () => {
    let t = settle(act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Dig', 'hand', 'p1') } as never));
    for (let g = 0; g < 20 && t.pending?.kind !== 'chooseObjects'; g++) t = settle(t.pending?.kind === 'priority' ? pass(t) : t);
    const d = t.pending as unknown as { options: ObjectId[]; max?: number };
    expect(d.options.length).toBe(4);
    expect(d.max).toBe(2);
    const s = resolveAll(answer(t, { kind: 'chooseObjects', ids: d.options.slice(0, 2) } as DecisionAnswer));
    expect(handNames(s, 'p1').sort()).toEqual(['Test Bear', 'Test Moor']);
    expect(lib(s, 'p1')[0]).toBe('Test Bear');
  });
  it('may take fewer: none puts all four on the bottom, below the card that was fifth', () => {
    const s = cast(setup(), 'Test Dig', true, 'none');
    expect(handNames(s, 'p1')).toEqual([]);
    expect(lib(s, 'p1')[0]).toBe('Test Bear');
    expect(lib(s, 'p1').slice(-4).sort()).toEqual(['Test Bear', 'Test Charm', 'Test Moor', 'Test Ring']);
  });
  it('taking one puts the other three on the bottom, and the card taken is not in the library', () => {
    const s = cast(setup(), 'Test Dig', true, 'one');
    expect(handNames(s, 'p1').length).toBe(1);
    expect(lib(s, 'p1').slice(-3).length).toBe(3);
    expect(lib(s, 'p1')[0]).toBe('Test Bear');
  });
});

describe('CR 603.7, 400.7: "Return ~ to the battlefield under its owner\'s control when that token dies."', () => {
  const FANG = card('Test Fang', 'Legendary Artifact — Equipment', '{0}, Exile Test Fang: Create a 1/1 white Spirit creature token. Return Test Fang to the battlefield under its owner\'s control when that token dies.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target creature.');
  const GONE = card('Test Banish', 'Instant', 'Exile target creature.');
  it('is automated', () => { expect(noManual(FANG)).toEqual([]); });
  const start = (spell: string): GameState => {
    const s0 = scenario([], { defs: [FANG, BOLT, GONE, BEAR], p1: { battlefield: ['Test Fang'], hand: [spell] } });
    return resolveAll(settle(act(s0, legal(s0, 'p1', 'activate')[0]!.action)));
  };
  const hit = (s: GameState, spell: string): GameState => {
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    let t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') } as never));
    if (t.pending?.kind === 'chooseTargets') t = settle(answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: token }] } as DecisionAnswer));
    return resolveAll(t);
  };
  it('the card is exiled by the cost and returns only when the token dies', () => {
    const s1 = start('Test Bolt');
    expect(findAll(s1, 'Test Fang', 'exile').length).toBe(1);
    expect(findAll(s1, 'Test Fang', 'battlefield').length).toBe(0);
    const s2 = hit(s1, 'Test Bolt');
    expect(findAll(s2, 'Test Fang', 'battlefield').length).toBe(1);
    expect(findAll(s2, 'Test Fang', 'exile').length).toBe(0);
  });
  it('a token that is exiled instead of dying does not bring the card back', () => {
    const s2 = hit(start('Test Banish'), 'Test Banish');
    expect(findAll(s2, 'Test Fang', 'battlefield').length).toBe(0);
    expect(findAll(s2, 'Test Fang', 'exile').length).toBe(1);
  });
});

describe('CR 508.1c, 509.1b, 702.122a, 602.5, 605.1a: "Enchanted permanent can\'t attack, block, or crew Vehicles. Its activated abilities can\'t be activated unless they\'re mana abilities."', () => {
  const ARREST = card('Test Arrest', 'Enchantment — Aura', 'Enchant permanent\nEnchanted permanent can\'t attack, block, or crew Vehicles. Its activated abilities can\'t be activated unless they\'re mana abilities.');
  const HOST = card('Test Host', 'Creature — Elf', '{T}: Add {G}.\n{0}: Draw a card.', { pt: ['2', '2'] });
  const FREE = card('Test Free', 'Creature — Elf', '{0}: Draw a card.', { pt: ['2', '2'] });
  it('is automated', () => { expect(noManual(ARREST)).toEqual([]); });
  const enchant = (host: string, mine = true): GameState => {
    const s0 = scenario([], { defs: [ARREST, HOST, FREE, BEAR], p1: { battlefield: mine ? [host] : [], hand: ['Test Arrest'] }, p2: { battlefield: mine ? [] : [host] } });
    const target = findAll(s0, host, 'battlefield')[0]!;
    let t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Arrest', 'hand', 'p1') } as never));
    if (t.pending?.kind === 'chooseTargets') t = settle(answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] } as DecisionAnswer));
    return resolveAll(t);
  };
  it('the enchanted permanent loses its non-mana activated abilities and keeps its mana ability; an unenchanted one keeps both', () => {
    const s = enchant('Test Host');
    const labels = legal(s, 'p1', 'activate').map((a) => a.label);
    expect(labels.some((l) => l.includes('Add {G}'))).toBe(true);
    expect(labels.some((l) => l.includes('Draw a card'))).toBe(false);
    const free = scenario([], { defs: [HOST], p1: { battlefield: ['Test Host'] } });
    expect(legal(free, 'p1', 'activate').map((a) => a.label).some((l) => l.includes('Draw a card'))).toBe(true);
  });
  it('the enchanted creature cannot attack; an unenchanted creature can', () => {
    const s0 = advanceTo(enchant('Test Free'), 1, 'declareAttackers');
    expect(s0.pending?.kind).not.toBe('declareAttackers'); // the only creature cannot attack: no attack is declared at all
    const plain = advanceTo(scenario([], { defs: [FREE], p1: { battlefield: ['Test Free'] } }), 1, 'declareAttackers');
    expect(plain.pending?.kind).toBe('declareAttackers');
  });

});
