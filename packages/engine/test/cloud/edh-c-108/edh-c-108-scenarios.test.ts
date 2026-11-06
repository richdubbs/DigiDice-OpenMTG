/**
 * Commander lane edh-c, round edh-c-108: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Each test is named after the rule it checks and has its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round record).
 *
 *   CR 604.1, 611.3a, 613.4c   "Equipped creature gets +1/+0. It gets +3/+1 instead as long as an opponent has eight or more cards in their graveyard."
 *   CR 611.3a, 615.1, 702.4    "Enchanted creature has double strike as long as it's an enchantment. Otherwise, prevent all damage that would be dealt by enchanted creature."
 *   CR 701.13a, 608.2d, 406.3  "You choose a nonland card from that player's graveyard or hand and exile it."
 *   CR 609.4b, 601.3           "You may cast that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell."
 *   CR 701.23a, 101.4          "Each player may search their library for a basic land card, reveal it, put it into their hand, then shuffle."
 *   CR 303.4, 700.4, 400.7     "When enchanted Forest is put into a graveyard, you may return this card from your graveyard to your hand."
 *   CR 701.20a, 701.13a, 406.1, 119.3   "Exile all other cards revealed this way, and you lose 1 life for each of the exiled cards."
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { act, answer, find, life, pass, put, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const LANDS = ['Plains', 'Forest', 'Island', 'Mountain'];
const chars = (s: GameState, id: ObjectId) => charsOfObject(s, s.objects[id]!);
const hasKw = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => (s.zones[zone][p] ?? []).map((id) => s.objects[id]!.defId);
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const inExile = (s: GameState, name: string): ObjectId | undefined => s.zones.exile.find((id) => nameOf(s, id) === name);
const castAction = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === name)?.action;
/** Cast `name`, then resolve everything, answering a card-name choice with `cardName` (CR 201.3). */
const resolveNamed = (s0: GameState, cardName: string, picks = {}): GameState => {
  let s = s0;
  for (let g = 0; g < 60; g++) {
    if (s.pending?.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: cardName });
    else if (s.pending !== null && s.pending.kind !== 'priority') s = settle(s, picks);
    else if (s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
};
/** Resolve everything, answering each yes/no with yes and each choice of objects with the first option (a search finds the first card). */
const resolveEager = (s0: GameState, prefer: string[] = []): GameState => {
  let s = s0;
  for (let g = 0; g < 60; g++) {
    const d = s.pending as { kind: string; options?: ObjectId[]; min?: number; max?: number } | null;
    if (d?.kind === 'chooseObjects' && (d.options?.length ?? 0) > 0) s = answer(s, { kind: 'chooseObjects', ids: [d.options!.find((id) => prefer.includes(nameOf(s, id))) ?? d.options![0]!] });
    else if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d !== null && d.kind !== 'priority') s = settle(s);
    else if (s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
};
const castCard = (s: GameState, name: string, picks = {}): GameState => resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), picks), picks);

describe('the synthetic cards are automated', () => {
  const CARVER = card('Test Gravewhetter', 'Artifact — Equipment', 'Equipped creature gets +1/+0. It gets +3/+1 instead as long as an opponent has eight or more cards in their graveyard.');
  const NYX = card('Test Nyx Mantle', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has double strike as long as it\'s an enchantment. Otherwise, prevent all damage that would be dealt by enchanted creature.');
  const LEAK = card('Test Mind Drain', 'Sorcery', "Target opponent reveals their hand. You choose a nonland card from that player's graveyard or hand and exile it.");
  const INTRUSION = card('Test Mind Theft', 'Sorcery', "Target opponent reveals their hand. You choose a nonland card from that player's graveyard or hand and exile it. You may cast that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell.");
  const WAYFINDER = card('Test Wayfinder', 'Creature — Scout', 'When this creature enters, each player may search their library for a basic land card, reveal it, put it into their hand, then shuffle.', ['1', '1']);
  const GENJU = card('Test Spirit Shroud', 'Enchantment — Aura', 'Enchant Forest\nWhen enchanted Forest is put into a graveyard, you may return this card from your graveyard to your hand.');
  const SPOILS = card('Test Vault Plunder', 'Sorcery', 'Choose a card name. Reveal cards from the top of your library until you reveal a card with that name, then put that card into your hand. Exile all other cards revealed this way, and you lose 1 life for each of the exiled cards.');
  it('every synthetic card plays fully', () => {
    for (const d of [CARVER, NYX, LEAK, INTRUSION, WAYFINDER, GENJU, SPOILS]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 604.1, 611.3a, 613.4c: "Equipped creature gets +1/+0. It gets +3/+1 instead as long as an opponent has eight or more cards in their graveyard."', () => {
  const CARVER = card('Test Gravewhetter', 'Artifact — Equipment', 'Equipped creature gets +1/+0. It gets +3/+1 instead as long as an opponent has eight or more cards in their graveyard.');
  const BEAR = card('Test Carver Bear', 'Creature — Bear', '', ['2', '2']);
  const JUNK = card('Test Carver Junk', 'Artifact', '');
  const defs: CardDef[] = [CARVER, BEAR, JUNK];
  const setup = (opp: number, mine = 0) => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Carver Bear'], graveyard: Array(mine).fill('Test Carver Junk') }, p2: { graveyard: Array(opp).fill('Test Carver Junk') } });
    s.objects[put(s, 'p1', 'battlefield', 'Test Gravewhetter')]!.attachedTo = find(s, 'Test Carver Bear', 'battlefield', 'p1');
    return s;
  };
  const stats = (s: GameState): string => { const c = chars(s, find(s, 'Test Carver Bear', 'battlefield', 'p1')); return `${c.power}/${c.toughness}`; };
  it('with eight cards in an opponent graveyard the creature is 5/3 (not 6/3: "instead")', () => { expect(stats(setup(8))).toBe('5/3'); });
  it('negative: with seven cards in the opponent graveyard it is only 3/2; cards in your own graveyard do not count', () => {
    expect(stats(setup(7))).toBe('3/2');
    expect(stats(setup(0, 9))).toBe('3/2');
  });
  it('the better bonus ends when the graveyard shrinks: the same creature reads 5/3 then 3/2 as the count crosses eight', () => {
    const s = setup(8);
    expect(stats(s)).toBe('5/3');
    s.zones.graveyard['p2']!.pop();
    expect(stats(s)).toBe('3/2');
  });
});

describe('CR 611.3a, 615.1, 702.4: "Enchanted creature has double strike as long as it\'s an enchantment. Otherwise, prevent all damage that would be dealt by enchanted creature."', () => {
  const NYX = card('Test Nyx Mantle', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has double strike as long as it\'s an enchantment. Otherwise, prevent all damage that would be dealt by enchanted creature.');
  const PLAIN = card('Test Mantle Bruiser', 'Creature — Ogre', '{T}: This creature deals 3 damage to target player.', ['3', '3']);
  const SPIRIT = card('Test Mantle Spirit', 'Enchantment Creature — Spirit', '{T}: This creature deals 3 damage to target player.', ['3', '3']);
  const defs: CardDef[] = [NYX, PLAIN, SPIRIT];
  const ping = (s: GameState, name: string): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object !== undefined && nameOf(s, x.object) === name)!.action;
    return resolveAll(act(s, a), { targets: [{ kind: 'player' as const, id: 'p2' }] });
  };
  it('a creature that is not an enchantment: its damage is prevented and it has no double strike', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Mantle Bruiser'] } });
    const bruiser = find(s, 'Test Mantle Bruiser', 'battlefield', 'p1');
    s.objects[put(s, 'p1', 'battlefield', 'Test Nyx Mantle')]!.attachedTo = bruiser;
    expect(hasKw(s, bruiser, 'double strike')).toBe(false);
    const before = life(s, 'p2');
    expect(life(ping(s, 'Test Mantle Bruiser'), 'p2')).toBe(before);
  });
  it('negative: an enchantment creature has double strike and its damage is not prevented; the same creature without the Aura deals its damage', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Mantle Spirit'] } });
    const spirit = find(s, 'Test Mantle Spirit', 'battlefield', 'p1');
    s.objects[put(s, 'p1', 'battlefield', 'Test Nyx Mantle')]!.attachedTo = spirit;
    expect(chars(s, spirit).keywords.map((k) => k.keyword), 'keywords').toContain('double strike');
    const before = life(s, 'p2');
    expect(life(ping(s, 'Test Mantle Spirit'), 'p2')).toBe(before - 3);
    const bare = scenario([], { defs, p1: { battlefield: ['Test Mantle Bruiser'] } });
    expect(life(ping(bare, 'Test Mantle Bruiser'), 'p2')).toBe(life(bare, 'p2') - 3);
  });
  it('the prevention is only for the enchanted creature: another creature of yours still deals its damage', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Mantle Bruiser', 'Test Mantle Bruiser'] } });
    const [a, b] = [find(s, 'Test Mantle Bruiser', 'battlefield', 'p1'), s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Mantle Bruiser')[1]!];
    s.objects[put(s, 'p1', 'battlefield', 'Test Nyx Mantle')]!.attachedTo = a;
    const act2 = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === b)!.action;
    const after = resolveAll(act(s, act2), { targets: [{ kind: 'player' as const, id: 'p2' }] });
    expect(life(after, 'p2')).toBe(life(s, 'p2') - 3);
  });
});

describe('CR 701.13a, 608.2d, 406.3: "You choose a nonland card from that player\'s graveyard or hand and exile it."', () => {
  const LEAK = card('Test Mind Drain', 'Sorcery', "Target opponent reveals their hand. You choose a nonland card from that player's graveyard or hand and exile it.");
  const OGRE = card('Test Drain Ogre', 'Creature — Ogre', '', ['2', '2']);
  const IDOL = card('Test Drain Idol', 'Artifact', '');
  const defs: CardDef[] = [LEAK, OGRE, IDOL];
  const opp = { targets: [{ kind: 'player' as const, id: 'p2' }] };
  const optionsOf = (s: GameState): string[] => ((s.pending as { options?: ObjectId[] } | null)?.options ?? []).map((id) => nameOf(s, id));
  it('the nonland cards of the opponent hand and graveyard are the choices; the chosen one is exiled, a land and your own cards stay', () => {
    const s0 = scenario(LANDS, { defs, p1: { hand: ['Test Mind Drain'], graveyard: ['Test Drain Idol'] }, p2: { hand: ['Plains', 'Test Drain Ogre'], graveyard: ['Test Drain Idol', 'Forest'] } });
    const cast = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mind Drain', 'hand', 'p1') }), opp);
    const pass1 = resolveAll(cast, opp);
    expect(pass1.pending?.kind === 'chooseObjects' || inExile(pass1, 'Test Drain Ogre') !== undefined || inExile(pass1, 'Test Drain Idol') !== undefined).toBe(true);
    const mid = ((): GameState => { let s = cast; for (let g = 0; g < 10 && s.pending?.kind !== 'chooseObjects' && s.zones.stack.length > 0; g++) s = act(s, { type: 'pass', player: s.pending!.player }); return s; })();
    expect(mid.pending?.kind).toBe('chooseObjects');
    expect(optionsOf(mid).sort()).toEqual(['Test Drain Idol', 'Test Drain Ogre']);
    const ogre = ((mid.pending as { options: ObjectId[] }).options).find((id) => nameOf(mid, id) === 'Test Drain Ogre')!;
    const done = resolveAll(mid, { objects: [ogre] });
    expect(inExile(done, 'Test Drain Ogre')).toBeDefined();
    expect(names(done, 'hand', 'p2')).toEqual(['Plains']);
    expect(names(done, 'graveyard', 'p2').sort()).toEqual(['Forest', 'Test Drain Idol']);
    expect(names(done, 'graveyard', 'p1')).toContain('Test Drain Idol');
  });
  it('negative: with only lands in the opponent hand and graveyard nothing is chosen or exiled', () => {
    const s0 = scenario(LANDS, { defs, p1: { hand: ['Test Mind Drain'] }, p2: { hand: ['Plains'], graveyard: ['Forest'] } });
    const done = resolveAll(castCard(s0, 'Test Mind Drain', opp), opp);
    expect(s0.zones.exile.length).toBe(0);
    expect(done.zones.exile.length).toBe(0);
    expect(names(done, 'hand', 'p2')).toEqual(['Plains']);
  });
});

describe('CR 609.4b, 601.3: "You may cast that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell."', () => {
  const THEFT = card('Test Mind Theft', 'Sorcery', "Target opponent reveals their hand. You choose a nonland card from that player's graveyard or hand and exile it. You may cast that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell.");
  const BRUTE = card('Test Theft Brute', 'Creature — Ogre', '', ['3', '3'], '{R}{R}');
  const defs: CardDef[] = [THEFT, BRUTE];
  const opp = { targets: [{ kind: 'player' as const, id: 'p2' }] };
  const run = (s0: GameState): GameState => {
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mind Theft', 'hand', 'p1') }), opp);
    for (let g = 0; g < 10 && s.pending?.kind !== 'chooseObjects' && s.zones.stack.length > 0; g++) s = act(s, { type: 'pass', player: s.pending!.player });
    return resolveAll(s);
  };
  it('the exiled {R}{R} creature from the opponent graveyard is cast with two Plains while it stays exiled', () => {
    const s = run(scenario(LANDS, { defs, p1: { hand: ['Test Mind Theft'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { graveyard: ['Test Theft Brute'] } }));
    expect(inExile(s, 'Test Theft Brute')).toBeDefined();
    expect(castAction(s, 'Test Theft Brute')).toBeDefined();
    const cast = resolveAll(settle(act(s, castAction(s, 'Test Theft Brute')!)));
    expect(cast.zones.battlefield.some((id) => nameOf(cast, id) === 'Test Theft Brute')).toBe(true);
  });
  it('negative: an opponent cannot cast it (the permission is yours) and with one Plains you cannot pay {R}{R}', () => {
    const s = run(scenario(LANDS, { defs, p1: { hand: ['Test Mind Theft'], battlefield: ['Plains'] }, p2: { graveyard: ['Test Theft Brute'], battlefield: ['Mountain', 'Mountain'] } }));
    expect(inExile(s, 'Test Theft Brute')).toBeDefined();
    expect(castAction(s, 'Test Theft Brute')).toBeUndefined();
    expect(castAction(s, 'Test Theft Brute', 'p2')).toBeUndefined();
  });
});

describe('CR 701.23a, 701.20a, 101.4: "Each player may search their library for a basic land card, reveal it, put it into their hand, then shuffle."', () => {
  const WAY = card('Test Wayfinder', 'Creature — Scout', 'When this creature enters, each player may search their library for a basic land card, reveal it, put it into their hand, then shuffle.', ['1', '1']);
  const OGRE = card('Test Way Ogre', 'Creature — Ogre', '', ['2', '2']);
  const defs: CardDef[] = [WAY, OGRE];
  it('every player takes a basic land from their own library into their own hand (creature cards stay in the library)', () => {
    const s0 = scenario(LANDS, { defs, p1: { hand: ['Test Wayfinder'], library: ['Test Way Ogre', 'Forest'] }, p2: { library: ['Island', 'Test Way Ogre'] } });
    const s = resolveEager(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Wayfinder', 'hand', 'p1') })), ['Forest', 'Island']);
    expect(names(s, 'hand', 'p1')).toEqual(['Forest']);
    expect(names(s, 'hand', 'p2')).toEqual(['Island']);
    expect(names(s, 'library', 'p1')).toContain('Test Way Ogre');
    expect(names(s, 'library', 'p2')).toContain('Test Way Ogre');
    expect(names(s, 'library', 'p1')).toHaveLength(s0.zones.library['p1']!.length - 1);
  });
  it('negative: only basic land cards are offered (a creature card is not), and each player finds at most one card', () => {
    const s0 = scenario(LANDS, { defs, p1: { hand: ['Test Wayfinder'], library: ['Test Way Ogre', 'Test Way Ogre'] }, p2: { library: ['Test Way Ogre', 'Island'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Wayfinder', 'hand', 'p1') }));
    const offered: string[] = [];
    for (let g = 0; g < 60 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      const d = s.pending as { kind: string; options?: ObjectId[] };
      if (d.kind === 'chooseObjects') { offered.push(...d.options!.map((id) => nameOf(s, id))); s = answer(s, { kind: 'chooseObjects', ids: [d.options![0]!] }); }
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else s = pass(s);
    }
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).not.toContain('Test Way Ogre');
    expect(names(s, 'hand', 'p1')).toHaveLength(1);
    expect(names(s, 'hand', 'p2')).toHaveLength(1);
  });
});

describe('CR 303.4, 700.4, 400.7: "When enchanted Forest is put into a graveyard, you may return this card from your graveyard to your hand."', () => {
  const GENJU = card('Test Spirit Shroud', 'Enchantment — Aura', 'Enchant Forest\nWhen enchanted Forest is put into a graveyard, you may return this card from your graveyard to your hand.');
  const SMITE = card('Test Shroud Smite', 'Instant', 'Destroy target land.');
  const defs: CardDef[] = [GENJU, SMITE];
  it('when the enchanted Forest is destroyed the Aura goes to the graveyard and then returns to its owner hand', () => {
    const s0 = scenario(LANDS, { defs, p1: { hand: ['Test Shroud Smite'] , battlefield: ['Forest'] } });
    const forest = find(s0, 'Forest', 'battlefield', 'p1');
    s0.objects[put(s0, 'p1', 'battlefield', 'Test Spirit Shroud')]!.attachedTo = forest;
    const s = resolveAll(castCard(s0, 'Test Shroud Smite', { targets: [{ kind: 'object' as const, id: forest }] }), { targets: [{ kind: 'object' as const, id: forest }], yes: true });
    expect(names(s, 'graveyard', 'p1')).toContain('Forest');
    expect(names(s, 'hand', 'p1')).toContain('Test Spirit Shroud');
    expect(names(s, 'graveyard', 'p1')).not.toContain('Test Spirit Shroud');
  });
  it('negative: another Forest being destroyed does not return it, and a declined "may" leaves it in the graveyard', () => {
    const s0 = scenario(LANDS, { defs, p1: { hand: ['Test Shroud Smite'], battlefield: ['Forest', 'Forest'] } });
    const [f1, f2] = s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Forest');
    s0.objects[put(s0, 'p1', 'battlefield', 'Test Spirit Shroud')]!.attachedTo = f1!;
    const other = resolveAll(castCard(s0, 'Test Shroud Smite', { targets: [{ kind: 'object' as const, id: f2! }] }), { targets: [{ kind: 'object' as const, id: f2! }], yes: true });
    expect(names(other, 'hand', 'p1')).not.toContain('Test Spirit Shroud');
    expect(other.zones.battlefield.some((id) => nameOf(other, id) === 'Test Spirit Shroud')).toBe(true);
    const declined = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shroud Smite', 'hand', 'p1') }), { targets: [{ kind: 'object' as const, id: f1! }] }), { yes: false });
    expect(names(declined, 'graveyard', 'p1')).toContain('Test Spirit Shroud');
    expect(names(declined, 'hand', 'p1')).not.toContain('Test Spirit Shroud');
  });
});

describe('CR 701.20a, 701.13a, 406.1, 119.3: "Exile all other cards revealed this way, and you lose 1 life for each of the exiled cards."', () => {
  const SPOILS = card('Test Vault Plunder', 'Sorcery', 'Choose a card name. Reveal cards from the top of your library until you reveal a card with that name, then put that card into your hand. Exile all other cards revealed this way, and you lose 1 life for each of the exiled cards.');
  const A = card('Test Vault Gem', 'Artifact', '');
  const B = card('Test Vault Coin', 'Artifact', '');
  const defs: CardDef[] = [SPOILS, A, B];
  it('the named card goes to the hand, the cards revealed before it are exiled and cost 1 life each, the cards below it stay', () => {
    const s0 = scenario(LANDS, { defs, life: 100, p1: { hand: ['Test Vault Plunder'], library: ['Test Vault Coin', 'Test Vault Coin', 'Test Vault Gem', 'Test Vault Coin'] } });
    const s = resolveNamed(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Vault Plunder', 'hand', 'p1') })), 'Test Vault Gem');
    expect(names(s, 'hand', 'p1')).toEqual(['Test Vault Gem']);
    expect(s.zones.exile.filter((id) => nameOf(s, id) === 'Test Vault Coin')).toHaveLength(2);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 2);
    expect(names(s, 'library', 'p1')[0]).toBe('Test Vault Coin');
    expect(names(s, 'library', 'p1')).toHaveLength(s0.zones.library['p1']!.length - 3);
  });
  it('negative: the name is not in the library: every card is revealed and exiled, you lose 1 life for each, and nothing goes to the hand', () => {
    const s0 = scenario(LANDS, { defs, life: 100, p1: { hand: ['Test Vault Plunder'], library: ['Test Vault Coin', 'Test Vault Coin', 'Test Vault Coin'] } });
    const s = resolveNamed(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Vault Plunder', 'hand', 'p1') })), 'Test Vault Gem');
    expect(names(s, 'hand', 'p1')).toEqual([]);
    const n = s0.zones.library['p1']!.length;
    expect(s.zones.exile.filter((id) => nameOf(s, id) === 'Test Vault Coin')).toHaveLength(3);
    expect(s.zones.exile).toHaveLength(n);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - n);
    expect(names(s, 'library', 'p1')).toEqual([]);
  });
});
