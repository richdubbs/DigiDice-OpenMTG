/**
 * Commander lane edh-misc, round edh-misc-6: the round's engine concepts played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites are from the Comprehensive Rules 2026-09-25 where the round checked them
 * (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt); unverified ones are listed in the round's record.
 *
 *   CR 122.5, 608.2d   "Move any number of counters from among creatures you control onto target creature.": how many of each kind each creature gives; the receiver gives none
 *   CR 122.5           "Move a counter of each kind not on ~ from target creature you control onto ~.": one counter of every kind the receiver lacks
 *   CR 122.5, 608.2d   "Move one or more counters from ~ onto another target creature you control. If you do, ...": not none; "if you do" needs a counter moved
 *   CR 603.12, 608.2c  "If C, X. Otherwise, you may pay {X}. When you do, ~ deals X damage to any target.": the reflexive trigger waits for the payment of the "otherwise" branch alone
 *   CR 400.7f, 603.7c  "When enchanted creature dies, return this card to the battlefield at the beginning of the next end step.": the card the Aura became in the graveyard returns at the end step
 *   CR 612.1, 612.2    "Change the text of target creature by replacing all instances of one creature type with Vampire.": the type chosen as it resolves becomes Vampire, the name never changes
 *   CR 106.4, 605.1a   "{T}: A player of your choice adds {G}.": a mana ability; the controller chooses who gets the mana; it is not mana the controller pays with by itself
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer } from '../../m3/scenario';
import { activate, target } from '../../m5/cr-examples/helpers';
import { castWith, find, handSize, resolveAll, scenario, synthetic } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const counters = (s: GameState, id: ObjectId): Record<string, number> => Object.fromEntries(Object.entries(s.objects[id]!.counters ?? {}).filter(([, n]) => n > 0));
const number = (n: number): DecisionAnswer => ({ kind: 'chooseNumber', n });
const poolOf = (s: GameState, p: 'p1' | 'p2'): string => s.players.find((x) => x.id === p)!.manaPool.map((u) => u.type).sort().join('');

const GATHER = synthetic('Test Gather Idol', 'Artifact', '{1}', '{2}: Move any number of counters from among creatures you control onto target creature.');
const SWAP = synthetic('Test Kind Swapper', 'Artifact', '{1}', '{T}: Move a counter of each kind not on ~ from target creature you control onto ~.');
const ONEMORE = synthetic('Test Tithe Idol', 'Artifact', '{1}', '{1}, {T}: Move one or more counters from ~ onto target creature you control. If you do, draw a card.');
const BELL = synthetic('Test Grand Bell', 'Artifact', '{1}', '{T}: A player of your choice adds {G}.');
const BEAR = synthetic('Test Grey Bear', 'Creature — Bear', '{1}{G}', '', { power: '2', toughness: '2' });
const ELK = synthetic('Test Grey Elk', 'Creature — Elk', '{1}{G}', '', { power: '2', toughness: '2' });
const OX = synthetic('Test Grey Ox', 'Creature — Ox', '{1}{G}', '', { power: '2', toughness: '2' });
const BOLT = synthetic('Test Green Bolt', 'Sorcery', '{G}', 'You gain 3 life.');
const DEFS = [GATHER, SWAP, ONEMORE, BELL, BEAR, ELK, OX, BOLT];

describe('the synthetic cards are automated', () => {
  it('every synthetic card with text plays fully', () => {
    for (const d of [GATHER, SWAP, ONEMORE, BELL, BOLT]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

/** p1: the bear (two +1/+1 counters and a charge counter), the elk (a charge counter), the ox (none), and `extra`; p2: an elk with three charge counters. */
function board(extra: string[]): { s: GameState; bear: ObjectId; elk: ObjectId; ox: ObjectId; theirs: ObjectId } {
  const s = scenario(['Forest', 'Island'], { defs: DEFS, p1: { battlefield: ['Test Grey Bear', 'Test Grey Elk', 'Test Grey Ox', ...extra, ...lands('Forest', 4)] }, p2: { battlefield: ['Test Grey Elk'] } });
  const bear = find(s, 'Test Grey Bear', 'battlefield');
  const elk = find(s, 'Test Grey Elk', 'battlefield', 'p1');
  const ox = find(s, 'Test Grey Ox', 'battlefield');
  const theirs = find(s, 'Test Grey Elk', 'battlefield', 'p2');
  s.objects[bear]!.counters = { '+1/+1': 2, charge: 1 };
  s.objects[elk]!.counters = { charge: 1 };
  s.objects[theirs]!.counters = { charge: 3 };
  return { s, bear, elk, ox, theirs };
}

describe('CR 122.5, 608.2d: "Move any number of counters from among creatures you control onto target creature."', () => {
  it('each creature gives how many of each kind the controller says: one +1/+1 counter from the bear, no charge counter from it, the elk\'s charge counter; the opponent\'s creature gives none', () => {
    const { s: s0, bear, elk, ox, theirs } = board(['Test Gather Idol']);
    const s = resolveAll(activate(s0, find(s0, 'Test Gather Idol', 'battlefield'), [target(ox)]), [number(1), number(0), number(1)]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 1, charge: 1 });
    expect(counters(s, elk)).toEqual({});
    expect(counters(s, ox)).toEqual({ '+1/+1': 1, charge: 1 });
    expect(counters(s, theirs)).toEqual({ charge: 3 });
  });
  it('CR 122.5 (negative): the receiver gives none of its own: with the bear as the target only the elk is asked', () => {
    const { s: s0, bear, elk } = board(['Test Gather Idol']);
    const s = resolveAll(activate(s0, find(s0, 'Test Gather Idol', 'battlefield'), [target(bear)]), [number(1)]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 2, charge: 2 });
    expect(counters(s, elk)).toEqual({});
  });
  it('CR 608.2d (negative): moving none of them is a legal choice: nothing moves', () => {
    const { s: s0, bear, elk, ox } = board(['Test Gather Idol']);
    const s = resolveAll(activate(s0, find(s0, 'Test Gather Idol', 'battlefield'), [target(ox)]), [number(0), number(0), number(0)]);
    expect(counters(s, bear)).toEqual({ '+1/+1': 2, charge: 1 });
    expect(counters(s, elk)).toEqual({ charge: 1 });
    expect(counters(s, ox)).toEqual({});
  });
});

describe('CR 122.5: "Move a counter of each kind not on ~ from target creature you control onto ~."', () => {
  it('one counter of each kind the artifact lacks: a +1/+1 counter and nothing of the charge kind it already has', () => {
    const { s: s0, bear } = board(['Test Kind Swapper']);
    const idol = find(s0, 'Test Kind Swapper', 'battlefield');
    s0.objects[idol]!.counters = { charge: 1 };
    const s = resolveAll(activate(s0, idol, [target(bear)]));
    expect(counters(s, idol)).toEqual({ charge: 1, '+1/+1': 1 });
    expect(counters(s, bear)).toEqual({ '+1/+1': 1, charge: 1 });
  });
  it('a kind the artifact lacks moves one counter, however many the creature has: two +1/+1 counters on the bear, one moves', () => {
    const { s: s0, bear } = board(['Test Kind Swapper']);
    const idol = find(s0, 'Test Kind Swapper', 'battlefield');
    const s = resolveAll(activate(s0, idol, [target(bear)]));
    expect(counters(s, idol)).toEqual({ '+1/+1': 1, charge: 1 });
    expect(counters(s, bear)).toEqual({ '+1/+1': 1 });
  });
  it('CR 122.5 (negative): a creature whose kinds are all on the artifact already gives nothing', () => {
    const { s: s0, elk } = board(['Test Kind Swapper']);
    const idol = find(s0, 'Test Kind Swapper', 'battlefield');
    s0.objects[idol]!.counters = { charge: 2 };
    const s = resolveAll(activate(s0, idol, [target(elk)]));
    expect(counters(s, idol)).toEqual({ charge: 2 });
    expect(counters(s, elk)).toEqual({ charge: 1 });
  });
});

describe('CR 122.5, 608.2d: "Move one or more counters from ~ onto target creature you control. If you do, draw a card."', () => {
  it('the last kind can\'t be refused when nothing else moves: none of the +1/+1 counters, so the charge counter moves, and the card is drawn', () => {
    const { s: s0, ox } = board(['Test Tithe Idol']);
    const idol = find(s0, 'Test Tithe Idol', 'battlefield');
    s0.objects[idol]!.counters = { '+1/+1': 2, charge: 1 };
    const s = resolveAll(activate(s0, idol, [target(ox)]), [number(0), number(1)]);
    expect(counters(s, idol)).toEqual({ '+1/+1': 2 });
    expect(counters(s, ox)).toEqual({ charge: 1 });
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') + 1);
  });
  it('taking both +1/+1 counters, the charge counter may stay', () => {
    const { s: s0, ox } = board(['Test Tithe Idol']);
    const idol = find(s0, 'Test Tithe Idol', 'battlefield');
    s0.objects[idol]!.counters = { '+1/+1': 2, charge: 1 };
    const s = resolveAll(activate(s0, idol, [target(ox)]), [number(2), number(0)]);
    expect(counters(s, idol)).toEqual({ charge: 1 });
    expect(counters(s, ox)).toEqual({ '+1/+1': 2 });
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') + 1);
  });
  it('CR 608.2c (negative): with no counters on it nothing moves and "if you do" does nothing: no card', () => {
    const { s: s0, ox } = board(['Test Tithe Idol']);
    const s = resolveAll(activate(s0, find(s0, 'Test Tithe Idol', 'battlefield'), [target(ox)]));
    expect(counters(s, ox)).toEqual({});
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1'));
  });
});

describe('CR 106.4, 605.1a: "{T}: A player of your choice adds {G}."', () => {
  const manaActions = (s: GameState) => legalActions(s, 'p1').filter((l) => l.kind === 'activate' && l.isMana === true && l.object === find(s, 'Test Grand Bell', 'battlefield'));
  const tap = (s0: GameState, who: 'p1' | 'p2'): GameState => {
    const a = manaActions(s0)[0];
    if (!a) throw new Error('no mana ability offered');
    const s1 = act(s0, a.action);
    expect(s1.pending?.kind).toBe('chooseOption');
    const s = answer(s1, { kind: 'chooseOption', ids: [who] });
    expect(s.zones.stack.length).toBe(0); // a mana ability (CR 605.3a)
    return s;
  };
  const start = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Grand Bell'], hand: ['Test Green Bolt'] } });
  it('the controller chooses an opponent: that opponent adds {G}, the controller nothing', () => {
    const s = tap(start(), 'p2');
    expect(poolOf(s, 'p2')).toBe('G');
    expect(poolOf(s, 'p1')).toBe('');
  });
  it('the controller chooses themself: they add {G}', () => {
    const s = tap(start(), 'p1');
    expect(poolOf(s, 'p1')).toBe('G');
    expect(poolOf(s, 'p2')).toBe('');
  });
  it('negative: the mana is the chosen player\'s, never an automatic payment for the controller: a {G} spell is not castable from the bell alone, but is once it made {G} for its controller', () => {
    const s0 = start();
    const castable = (s: GameState) => legalActions(s, 'p1').filter((l) => l.kind === 'cast' && l.object === find(s, 'Test Green Bolt', 'hand'));
    expect(castable(s0)).toHaveLength(0);
    expect(castable(tap(s0, 'p1')).length).toBeGreaterThan(0);
    expect(castable(tap(s0, 'p2'))).toHaveLength(0);
  });
});

describe('CR 603.12, 608.2c: "If C, X. Otherwise, you may pay {X}. When you do, ~ deals X damage to any target."', () => {
  const OGRE = synthetic('Test Tally Ogre', 'Creature — Ogre', '{3}', 'Whenever another creature you control enters, you gain 1 life if this is the first time this ability has resolved this turn. Otherwise, you may pay {X}. When you do, ~ deals X damage to any target.', { power: '2', toughness: '2' });
  const WISP = synthetic('Test Tally Wisp', 'Creature — Spirit', '{0}', '', { power: '1', toughness: '1' });
  const start = (): GameState => scenario(['Forest'], { defs: [OGRE, WISP], p1: { battlefield: ['Test Tally Ogre', ...lands('Forest', 3)], hand: ['Test Tally Wisp', 'Test Tally Wisp'] } });
  const yesAnswer: DecisionAnswer = { kind: 'yesNo', yes: true };
  it('is fully automated', () => {
    expect(full(OGRE), JSON.stringify(OGRE.automation)).toBe(true);
  });
  it('the first creature gains a life and nothing is asked: the "otherwise" branch and its reflexive trigger do not run', () => {
    const s = resolveAll(castWith(start(), 'Test Tally Wisp'));
    expect(s.pending?.kind).toBe('priority');
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(21);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20);
  });
  it('the second creature: pay {X} with X = 2 (two Forests tap) and the trigger deals 2 damage to the chosen target', () => {
    const s1 = resolveAll(castWith(start(), 'Test Tally Wisp'));
    const s = resolveAll(castWith(s1, 'Test Tally Wisp'), [yesAnswer, number(2), target('p2')]);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(21);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped && s.defs[s.objects[id]!.defId]!.name === 'Forest')).toHaveLength(2);
  });
  it('negative: declining to pay means "you do" did not happen: no target is asked and nothing is dealt', () => {
    const s1 = resolveAll(castWith(start(), 'Test Tally Wisp'));
    const s = resolveAll(castWith(s1, 'Test Tally Wisp'), [{ kind: 'yesNo', yes: false }]);
    expect(s.pending?.kind).toBe('priority');
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(0);
  });
});

describe('CR 400.7f, 603.7c: "When enchanted creature dies, return this card to the battlefield at the beginning of the next end step."', () => {
  const AURA = synthetic('Test Grim Mantle', 'Enchantment — Aura', '{0}', 'Enchant creature\nEnchanted creature gets +1/+1, has deathtouch, and is goaded.\nWhen enchanted creature dies, return this card to the battlefield at the beginning of the next end step.');
  const DOOM = synthetic('Test Doom', 'Instant', '{0}', 'Destroy target creature.');
  const BOUNCE = synthetic('Test Gust', 'Instant', '{0}', 'Return target creature to its owner\'s hand.');
  const setup = (bears: number): { s: GameState; ids: ObjectId[] } => {
    const s0 = scenario(['Forest'], { defs: [AURA, DOOM, BOUNCE, BEAR], p1: { battlefield: Array(bears).fill('Test Grey Bear') as string[], hand: ['Test Grim Mantle', 'Test Doom', 'Test Gust'] } });
    const ids = s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Grey Bear');
    return { s: resolveAll(castWith(s0, 'Test Grim Mantle', [target(ids[0]!)])), ids };
  };
  const onBattlefield = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
  const inYard = (s: GameState, name: string): boolean => s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
  it('is fully automated (the goaded static is promoted with this card)', () => {
    expect(full(AURA), JSON.stringify(AURA.automation)).toBe(true);
  });
  it('the Aura gives +1/+1 and deathtouch to the creature it enchants (the goad itself is played in cloud/c3/c3-goad.test.ts)', () => {
    const { s, ids } = setup(2);
    const hasDeathtouch = (st: GameState, id: ObjectId): boolean => JSON.stringify(getChars(st, id)!.abilities).includes('deathtouch');
    expect(`${getChars(s, ids[0]!)!.power}/${getChars(s, ids[0]!)!.toughness}`).toBe('3/3');
    expect(hasDeathtouch(s, ids[0]!)).toBe(true);
    expect(`${getChars(s, ids[1]!)!.power}/${getChars(s, ids[1]!)!.toughness}`).toBe('2/2');
    expect(hasDeathtouch(s, ids[1]!)).toBe(false);
  });
  it('the host dies: the Aura goes to the graveyard (CR 704.5m), and at the beginning of the next end step the card returns, enchanting a creature its controller chooses', () => {
    const { s: s0, ids } = setup(2);
    const s1 = resolveAll(castWith(s0, 'Test Doom', [target(ids[0]!)]));
    expect(onBattlefield(s1, 'Test Grim Mantle')).toBe(false);
    expect(inYard(s1, 'Test Grim Mantle')).toBe(true);
    const s2 = resolveAll(advanceTo(s1, s1.turn.number, 'end'), []);
    expect(s2.pending?.kind).toBe('chooseObjects');
    const s3 = resolveAll(answer(s2, { kind: 'chooseObjects', ids: [ids[1]!] }));
    expect(onBattlefield(s3, 'Test Grim Mantle')).toBe(true);
    expect(inYard(s3, 'Test Grim Mantle')).toBe(false);
    expect(s3.objects[find(s3, 'Test Grim Mantle', 'battlefield')]!.attachedTo).toBe(ids[1]);
  });
  it('negative: the host leaves without dying (returned to its owner\'s hand): the Aura is put into the graveyard and nothing returns it', () => {
    const { s: s0, ids } = setup(2);
    const s1 = resolveAll(castWith(s0, 'Test Gust', [target(ids[0]!)]));
    expect(inYard(s1, 'Test Grim Mantle')).toBe(true);
    const s2 = resolveAll(advanceTo(s1, s1.turn.number, 'end'));
    expect(onBattlefield(s2, 'Test Grim Mantle')).toBe(false);
    expect(inYard(s2, 'Test Grim Mantle')).toBe(true);
  });
  it('negative: the card is gone from the graveyard before the end step (exiled): it does not return', () => {
    const { s: s0, ids } = setup(2);
    const s1 = resolveAll(castWith(s0, 'Test Doom', [target(ids[0]!)]));
    const t = structuredClone(s1);
    const card = find(t, 'Test Grim Mantle', 'graveyard', 'p1');
    t.zones.graveyard['p1'] = t.zones.graveyard['p1']!.filter((x) => x !== card);
    t.zones.exile.push(card);
    t.objects[card]!.zone = 'exile';
    const s2 = resolveAll(advanceTo(t, t.turn.number, 'end'));
    expect(s2.pending?.kind).toBe('priority');
    expect(onBattlefield(s2, 'Test Grim Mantle')).toBe(false);
  });
});

describe('CR 612.1, 612.2: "Change the text of target creature by replacing all instances of one creature type with Vampire."', () => {
  const MARK = synthetic('Test Dark Rite', 'Sorcery', '{0}', 'Change the text of target creature by replacing all instances of one creature type with Vampire.');
  const RAT = synthetic('Test Cellar Rat', 'Creature — Rat Rogue', '{0}', '', { power: '1', toughness: '1' });
  const named = (name: string): DecisionAnswer => ({ kind: 'chooseName', name });
  const start = (): { s: GameState; rat: ObjectId } => {
    const s = scenario(['Forest'], { defs: [MARK, RAT], p1: { battlefield: ['Test Cellar Rat'], hand: ['Test Dark Rite'] } });
    return { s, rat: find(s, 'Test Cellar Rat', 'battlefield') };
  };
  it('is fully automated', () => {
    expect(full(MARK), JSON.stringify(MARK.automation)).toBe(true);
  });
  it('the chosen creature type becomes Vampire in the type line (CR 612.2a): a Rat Rogue is a Vampire Rogue; its name stays (CR 612.2)', () => {
    const { s: s0, rat } = start();
    const s = resolveAll(castWith(s0, 'Test Dark Rite', [target(rat)]), [named('Rat')]);
    expect(getChars(s, rat)!.subtypes).toEqual(['Vampire', 'Rogue']);
    expect(getChars(s, rat)!.name).toBe('Test Cellar Rat');
  });
  it('negative: a type the creature doesn\'t have may be chosen (CR 612.2 ruling) and changes nothing', () => {
    const { s: s0, rat } = start();
    const s = resolveAll(castWith(s0, 'Test Dark Rite', [target(rat)]), [named('Elf')]);
    expect(getChars(s, rat)!.subtypes).toEqual(['Rat', 'Rogue']);
  });
});
