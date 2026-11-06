/**
 * Commander lane edh-perms, round edh-perms-11: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout), except where a ruling is named.
 *
 *   CR 208.1, 613.4a-b   "for each creature you control with base power or toughness 1" (the base values, after layer 7b: counters and pumps never change them)
 *   CR 205.3m, 613.4c    "for each other creature you control that shares a creature type with it" (other than the equipped creature)
 *   CR 614.1a, 614.5     "if one or more creature tokens would be created under your control, those tokens plus a 1/1 white Soldier creature token are created instead"
 *   CR 603.6a, 603.4     "the number of nontoken creatures you had enter the battlefield under your control this turn"
 *   CR 122.1, 603.10a    "create X tapped ... tokens, where X is the number of counters it had on it" (the dying creature as it last existed)
 *   CR 109.2, 700.9      "the number of modified creatures you control other than ~"
 *   CR 109.2, 608.2c     "put a +1/+1 counter on each creature you control and a loyalty counter on each other planeswalker you control" (other than the source)
 *   CR 607.2a, 608.2h    "~'s power and toughness are each equal to the number of cards exiled with it"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[]; keywords?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: opts.keywords ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onField = (s: GameState, name: string, who?: string): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (who === undefined || s.objects[id]!.controller === who));
const stat = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { owner?: string; yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options.find((x) => x.id === (o.owner ?? 'p1'))?.id ?? p.options[0]!.id] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
const attach = (s: GameState, equipment: ObjectId, host: ObjectId): void => { s.objects[equipment]!.attachedTo = host; };

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const MOUSE = card('Test Mouse', 'Creature — Mouse', '', { pt: ['1', '1'] });
const RAT = card('Test Rat', 'Creature — Rat', '', { pt: ['1', '4'] });
const DOG = card('Test Dog', 'Creature — Dog', '', { pt: ['3', '1'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '5'] });
const ELF = card('Test Elf', 'Creature — Elf Warrior', '', { pt: ['2', '2'] });
const ELF2 = card('Test Elf Mage', 'Creature — Elf Wizard', '', { pt: ['1', '1'] });
const SHIFTER = card('Test Shifter', 'Creature — Shapeshifter', 'Changeling', { pt: ['2', '2'], keywords: ['Changeling'] });
const DEFS = [BEAR, MOUSE, RAT, DOG, OGRE, ELF, ELF2, SHIFTER];

describe('CR 208.1, 613.4a-b: "Equipped creature gets +1/+1 for each creature you control with base power or toughness 1."', () => {
  const SQUEAK = card('Test Squeak Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1 for each creature you control with base power or toughness 1.\nEquip {2}');
  const SHRINK = card('Test Shrink', 'Instant', 'Until end of turn, target creature has base power and toughness 1/1.');
  const defs = [...DEFS, SQUEAK, SHRINK];
  it('is fully automated', () => expect(full(SQUEAK)).toBe(true));
  it('counts a base power of 1 (Rat 1/4), a base toughness of 1 (Dog 3/1) and a creature whose counters raised it (Mouse 1/1 with two +1/+1 counters is 3/3 but its base is still 1); not an opponent\'s Mouse, not 2/2 or 5/5', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Squeak Blade', 'Test Bear', 'Test Rat', 'Test Dog', 'Test Ogre', { name: 'Test Mouse', counters: { '+1/+1': 2 } }] }, p2: { battlefield: ['Test Mouse'] } });
    attach(s, find(s, 'Test Squeak Blade', 'battlefield', 'p1'), onField(s, 'Test Bear', 'p1')[0]!);
    expect(stat(s, onField(s, 'Test Bear')[0]!)).toBe('5/5'); // 2/2 + 3 (Rat, Dog, Mouse)
    expect(stat(s, onField(s, 'Test Mouse', 'p1')[0]!)).toBe('3/3'); // not equipped: counters only
    expect(stat(s, onField(s, 'Test Ogre')[0]!)).toBe('5/5');
  });
  it('the equipped creature counts itself when its own base qualifies (a Mouse equipped: base 1, so it adds one for itself)', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Squeak Blade', 'Test Mouse', 'Test Bear'] } });
    attach(s, find(s, 'Test Squeak Blade', 'battlefield', 'p1'), onField(s, 'Test Mouse', 'p1')[0]!);
    expect(stat(s, onField(s, 'Test Mouse')[0]!)).toBe('2/2'); // 1/1 + 1 (itself)
  });
  it('a base set by an effect counts (CR 613.4b): until end of turn the Ogre has base power and toughness 1/1, so it is a creature with base 1; with no Squeak target it stays out', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Shrink'], battlefield: ['Test Squeak Blade', 'Test Bear', 'Test Ogre'] } });
    attach(s, find(s, 'Test Squeak Blade', 'battlefield', 'p1'), onField(s, 'Test Bear', 'p1')[0]!);
    expect(stat(s, onField(s, 'Test Bear')[0]!)).toBe('2/2'); // nothing has a base of 1
    s = cast(s, 'Test Shrink', { targets: [[onField(s, 'Test Ogre')[0]!]] });
    expect(stat(s, onField(s, 'Test Ogre')[0]!)).toBe('1/1');
    expect(stat(s, onField(s, 'Test Bear')[0]!)).toBe('3/3'); // the Ogre now has base 1/1
  });
  it('the negative case: a creature that only looks like 1 (a 2/2 with a -1/-1 counter is 1/1 now, base 2/2) is not counted', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Squeak Blade', 'Test Bear', { name: 'Test Elf', counters: { '-1/-1': 1 } }] } });
    attach(s, find(s, 'Test Squeak Blade', 'battlefield', 'p1'), onField(s, 'Test Bear', 'p1')[0]!);
    expect(stat(s, onField(s, 'Test Elf')[0]!)).toBe('1/1');
    expect(stat(s, onField(s, 'Test Bear')[0]!)).toBe('2/2');
  });
});

describe('CR 205.3m, 613.4c: "Equipped creature gets +1/+1 for each other creature you control that shares a creature type with it."', () => {
  const MASTER = card('Test Kin Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1 for each other creature you control that shares a creature type with it.\nEquip {2}');
  const defs = [...DEFS, MASTER];
  it('is fully automated', () => expect(full(MASTER)).toBe(true));
  it('counts each other creature you control that shares a type: an Elf, an Elf Wizard and a Changeling, but not the equipped creature itself, a Bear, or an opponent\'s Elf', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Kin Blade', 'Test Elf', 'Test Elf Mage', 'Test Shifter', 'Test Bear'] }, p2: { battlefield: ['Test Elf'] } });
    attach(s, find(s, 'Test Kin Blade', 'battlefield', 'p1'), onField(s, 'Test Elf', 'p1')[0]!);
    expect(stat(s, onField(s, 'Test Elf', 'p1')[0]!)).toBe('4/4'); // 2/2 + Elf Mage, Shifter... see below
  });
  it('the negative case: alone it counts nothing (the equipped creature is not "another" creature), and a creature with no type in common adds nothing', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Kin Blade', 'Test Elf', 'Test Bear', 'Test Ogre'] } });
    attach(s, find(s, 'Test Kin Blade', 'battlefield', 'p1'), onField(s, 'Test Elf', 'p1')[0]!);
    expect(stat(s, onField(s, 'Test Elf')[0]!)).toBe('2/2');
  });
});

describe('CR 614.1a, 614.5, 111.1: "If one or more creature tokens would be created under your control, those tokens plus a 1/1 white Soldier creature token are created instead."', () => {
  const QUEEN = card('Test Muster Queen', 'Legendary Creature — Elf Noble', 'If one or more creature tokens would be created under your control, those tokens plus a 1/1 white Soldier creature token are created instead.', { pt: ['2', '2'] });
  const MAKE = card('Test Rat Call', 'Sorcery', 'Create two 1/1 black Rat creature tokens.');
  const GEM = card('Test Gem Call', 'Sorcery', 'Create a Treasure token.');
  const defs = [...DEFS, QUEEN, MAKE, GEM];
  const tokens = (s: GameState, who: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === who);
  it('is fully automated', () => expect(full(QUEEN)).toBe(true));
  it('two Rat tokens come with one Soldier token (three tokens, not four: the added Soldier is part of the same replaced event, CR 614.5)', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Rat Call'], battlefield: ['Test Muster Queen'] } }), 'Test Rat Call');
    expect(tokens(s, 'p1').map((id) => chars(s, id).subtypes[0]).sort()).toEqual(['Rat', 'Rat', 'Soldier']);
  });
  it('the negative cases: a Treasure token (not a creature token) gets no Soldier; without the Queen nothing is added; an opponent\'s creature tokens get no Soldier', () => {
    const treasure = cast(scenario([], { defs, p1: { hand: ['Test Gem Call'], battlefield: ['Test Muster Queen'] } }), 'Test Gem Call');
    expect(tokens(treasure, 'p1').map((id) => chars(treasure, id).subtypes[0])).toEqual(['Treasure']);
    const none = cast(scenario([], { defs, p1: { hand: ['Test Rat Call'] } }), 'Test Rat Call');
    expect(tokens(none, 'p1').length).toBe(2);
    let theirs = scenario([], { defs, p1: { battlefield: ['Test Muster Queen'] }, p2: { hand: ['Test Rat Call'] } });
    theirs = advanceTo(theirs, 2, 'main1');
    theirs = resolveAll(act(theirs, { type: 'cast', player: 'p2', card: find(theirs, 'Test Rat Call', 'hand', 'p2') }));
    expect(tokens(theirs, 'p2').length).toBe(2);
    expect(tokens(theirs, 'p1').length).toBe(0);
  });
});

describe('CR 603.6a, 603.4: "At the beginning of your end step, create a number of Food tokens equal to the number of nontoken creatures you had enter the battlefield under your control this turn."', () => {
  const CHEF = card('Test Pantry Troll', 'Legendary Creature — Troll', 'At the beginning of your end step, create a number of Food tokens equal to the number of nontoken creatures you had enter the battlefield under your control this turn.', { pt: ['3', '3'] });
  const SPLIT = card('Test Twin Call', 'Sorcery', 'Create two 1/1 black Rat creature tokens.');
  const defs = [...DEFS, CHEF, SPLIT];
  const food = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && chars(s, id).subtypes.includes('Food'));
  it('is fully automated', () => expect(full(CHEF)).toBe(true));
  it('two nontoken creatures that entered this turn make two Food tokens; two creature tokens that entered, an opponent\'s creature and a creature that entered earlier make none', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bear', 'Test Ogre', 'Test Twin Call'], battlefield: ['Test Pantry Troll', 'Test Elf'] }, p2: { hand: ['Test Dog'] } });
    s = cast(s, 'Test Bear');
    s = cast(s, 'Test Ogre');
    s = cast(s, 'Test Twin Call');
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s);
    expect(food(s).length).toBe(2);
  });
  it('the negative case: no creature entered this turn, no Food', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Pantry Troll', 'Test Elf'] } });
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s);
    expect(food(s).length).toBe(0);
  });
});

describe('CR 122.1, 603.10a, 608.2h: "Whenever a nontoken creature you control dies, if it had counters on it, create X tapped 2/1 white and black Inkling creature tokens with flying, where X is the number of counters it had on it."', () => {
  const SEER = card('Test Ink Seer', 'Legendary Creature — Vampire', 'Whenever a nontoken creature you control dies, if it had counters on it, create X tapped 2/1 white and black Inkling creature tokens with flying, where X is the number of counters it had on it.', { pt: ['2', '2'] });
  const KILL = card('Test Smite', 'Instant', 'Destroy target creature.');
  const defs = [...DEFS, SEER, KILL];
  const inklings = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).subtypes.includes('Inkling'));
  const smite = (s0: GameState, victim: ObjectId): GameState => cast(s0, 'Test Smite', { targets: [[victim]] });
  it('is fully automated', () => expect(full(SEER)).toBe(true));
  it('a creature with two +1/+1 counters and one charge counter dies: three tapped 2/1 flying Inklings (counters of every kind, as it last existed)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Ink Seer', { name: 'Test Bear', counters: { '+1/+1': 2, charge: 1 } }] } });
    const s = smite(s0, onField(s0, 'Test Bear')[0]!);
    expect(onField(s, 'Test Bear').length).toBe(0);
    const ink = inklings(s);
    expect(ink.length).toBe(3);
    for (const id of ink) {
      expect(stat(s, id)).toBe('2/1');
      expect(s.objects[id]!.tapped).toBe(true);
      expect(chars(s, id).keywords.some((k) => k.keyword === 'flying')).toBe(true);
      expect(chars(s, id).colors.slice().sort()).toEqual(['B', 'W']);
    }
  });
  it('the negative cases: a creature with no counters makes none (the intervening if); an opponent\'s creature with counters makes none; a token with counters makes none', () => {
    const plain = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Ink Seer', 'Test Bear'] } });
    expect(inklings(smite(plain, onField(plain, 'Test Bear')[0]!)).length).toBe(0);
    const theirs = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Ink Seer'] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 2 } }] } });
    expect(inklings(smite(theirs, onField(theirs, 'Test Bear')[0]!)).length).toBe(0);
    const tok = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Ink Seer', { name: 'Test Bear', counters: { '+1/+1': 2 } }] } });
    const bear = onField(tok, 'Test Bear')[0]!;
    tok.objects[bear]!.kind = 'token';
    expect(inklings(smite(tok, bear)).length).toBe(0);
  });
});

describe('CR 109.2, 700.9: "put a +1/+1 counter on target creature you control. Then ~ deals X damage to each opponent, where X is the number of modified creatures you control other than ~."', () => {
  const RAIJU = card('Test Storm Spirit', 'Creature — Spirit', '{T}: Put a +1/+1 counter on target creature you control. Then ~ deals X damage to each opponent, where X is the number of modified creatures you control other than ~.', { pt: ['4', '4'] });
  const BLADE = card('Test Plain Blade', 'Artifact — Equipment', 'Equip {2}');
  const defs = [...DEFS, RAIJU, BLADE];
  const run = (s0: GameState, target: ObjectId): GameState => {
    const src = find(s0, 'Test Storm Spirit', 'battlefield', 'p1');
    return resolveAll(act(s0, { type: 'activate', player: 'p1', source: src, ability: 'p:0:0' }), { targets: [[target]] });
  };
  it('is fully automated', () => expect(full(RAIJU)).toBe(true));
  it('counts creatures with counters or equipment you control, other than the source: a counter on a Goblin-less target adds it (Bear with a counter, Elf equipped, the target Ogre = 3), a plain Dog adds nothing', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Storm Spirit', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Elf', 'Test Plain Blade', 'Test Dog', 'Test Ogre'] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    attach(s0, find(s0, 'Test Plain Blade', 'battlefield', 'p1'), onField(s0, 'Test Elf', 'p1')[0]!);
    const s = run(s0, onField(s0, 'Test Ogre')[0]!);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20 - 3);
  });
  it('the negative case: putting the counter on the source itself does not count the source (other than ~), only the Bear with a counter does', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Storm Spirit', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Dog'] } });
    const s = run(s0, find(s0, 'Test Storm Spirit', 'battlefield', 'p1'));
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20 - 1);
  });
});

describe('CR 109.2, 608.2c: "-2: Put a +1/+1 counter on each creature you control and a loyalty counter on each other planeswalker you control."', () => {
  const AJ = card('Test Lion Walker', 'Legendary Planeswalker — Lion', '+1: You gain 3 life.\n-2: Put a +1/+1 counter on each creature you control and a loyalty counter on each other planeswalker you control.', { loyalty: '5' });
  const OTHER = card('Test Other Walker', 'Legendary Planeswalker — Ally', '+1: You gain 1 life.', { loyalty: '3' });
  const defs = [...DEFS, AJ, OTHER];
  const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;
  it('is fully automated', () => expect(full(AJ)).toBe(true));
  it('every creature you control gets a +1/+1 counter and every OTHER planeswalker you control a loyalty counter: the source gets only its cost (5 - 2 = 3), an opponent\'s creature and planeswalker get nothing', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Lion Walker', counters: { loyalty: 5 } }, { name: 'Test Other Walker', counters: { loyalty: 3 } }, 'Test Bear', 'Test Elf'] }, p2: { battlefield: ['Test Bear', { name: 'Test Other Walker', counters: { loyalty: 3 } }] } });
    const src = find(s0, 'Test Lion Walker', 'battlefield', 'p1');
    const s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: src, ability: 'p:0:1' }));
    expect(counters(s, src, 'loyalty')).toBe(3);
    expect(counters(s, onField(s, 'Test Other Walker', 'p1')[0]!, 'loyalty')).toBe(4);
    expect(counters(s, onField(s, 'Test Other Walker', 'p2')[0]!, 'loyalty')).toBe(3);
    for (const id of [...onField(s, 'Test Bear', 'p1'), ...onField(s, 'Test Elf', 'p1')]) expect(counters(s, id, '+1/+1')).toBe(1);
    expect(counters(s, onField(s, 'Test Bear', 'p2')[0]!, '+1/+1')).toBe(0);
  });
  it('the guard stays closed for two groups of one kind: "each creature you control and each other creature you control" is not read (two candidates for "other")', () => {
    const twin = card('Test Twin Walker', 'Legendary Planeswalker — Lion', '-2: Put a +1/+1 counter on each creature you control and a loyalty counter on each other creature you control.', { loyalty: '5' });
    expect(full(twin)).toBe(false);
  });
});

describe('CR 607.2a, 608.2h: "~\'s power and toughness are each equal to the number of cards exiled with it."', () => {
  const HEARSE = card('Test Bone Cart', 'Artifact — Vehicle', '{T}: Exile up to two target cards from a single graveyard.\nTest Bone Cart\'s power and toughness are each equal to the number of cards exiled with it.');
  const defs = [...DEFS, HEARSE];
  const exile = (s0: GameState, cart: ObjectId, names: string[], owner = 'p1'): GameState => {
    const ids = s0.zones.graveyard[owner as 'p1']!.filter((id) => names.includes(chars(s0, id).name));
    return resolveAll(act(s0, { type: 'activate', player: 'p1', source: cart, ability: 'p:0:0' }), { targets: [ids], owner });
  };
  it('is fully automated', () => expect(full(HEARSE)).toBe(true));
  it('exiling two cards makes it 2/2; after it untaps and exiles two more it is 4/4; cards that another object exiled are not counted', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Bone Cart'], graveyard: ['Test Bear', 'Test Elf', 'Test Dog', 'Test Ogre'] }, p2: { graveyard: ['Test Ogre'] } });
    const cart = find(s, 'Test Bone Cart', 'battlefield', 'p1');
    expect(stat(s, cart)).toBe('0/0');
    s = exile(s, cart, ['Test Bear', 'Test Elf']);
    expect(stat(s, cart)).toBe('2/2');
    expect(s.objects[cart]!.tapped).toBe(true);
    s.objects[cart]!.tapped = false;
    s = exile(s, cart, ['Test Dog', 'Test Ogre']);
    expect(stat(s, cart)).toBe('4/4');
    // a card exiled by something else is not linked to the cart
    put(s, 'p1', 'exile', 'Test Mouse');
    expect(stat(s, cart)).toBe('4/4');
  });
  it('the negative case: a second Cart counts only the cards its own ability exiled', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Bone Cart', 'Test Bone Cart'], graveyard: ['Test Bear', 'Test Elf'] } });
    const [a, b] = onField(s, 'Test Bone Cart');
    s = exile(s, a!, ['Test Bear', 'Test Elf']);
    expect(stat(s, a!)).toBe('2/2');
    expect(stat(s, b!)).toBe('0/0');
  });
});
