/**
 * Commander fifth pass, round edh-b-12 (EDHREC ranks 8,001 to 9,000): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 601.3b, 702.8a, 513.1     "During each opponent's end step, you may cast spells as though they had flash."
 *   CR 601.3, 602.5, 113.6       "Players can't cast spells from graveyards or activate abilities of cards in graveyards."
 *   CR 601.2f, 108.3             "Spells you cast but don't own cost {1} less to cast."
 *   CR 602.5, 605.1a, 606.1      "Enchanted player can't activate abilities that aren't mana abilities or loyalty abilities."
 *   CR 701.12a, 401.1            "Exchange your hand and library, then shuffle."
 *   CR 401.5, 305.1              "You may look at the top card of your library any time, and you may play lands from the top of your library."
 *   CR 608.2d, 701.17a           "Mill two cards, then return a nonland card of an opponent's choice from your graveyard to your hand."
 *   CR 608.2d, 701.8a            "Choose up to one creature. Destroy the rest."
 *   CR 611.2a, 611.2c, 613.4b    "Creatures your opponents control lose all abilities and have base power and toughness 1/1 until end of turn."
 *   CR 205.3m, 613.1d, 613.4b    "Until end of turn, ~ has base power and toughness 5/3, gains trample, and isn't a Human."
 *   CR 106.4, 102.1, 119.3       "The active player adds {C}{C} for each of your opponents who lost life this turn."
 *   CR 701.21a, 122.1            "That player sacrifices a permanent of their choice for each soot counter on ~."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], o: { cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const ofName = (s: GameState, name: string, player?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && (player === undefined || s.objects[id]!.controller === player));
const nameIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', player: string): string[] => s.zones[zone][player]!.map((id) => s.objects[id]!.defId);

interface Picks { targets?: TargetChoice[]; x?: number; yes?: boolean; objects?: ObjectId[] }
/** Answer every decision until a player has priority (X as asked, objects: the minimum unless given). */
function settle(s0: GameState, p: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const d = s.pending as { kind: string; options?: unknown[]; min?: number };
    if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.objects ?? (d.options as ObjectId[]).slice(0, d.min ?? 0) });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: p.targets ?? [] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: p.yes ?? true });
    else if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.x ?? (d.min ?? 0) });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(d.options as { id: string }[])[0]!.id] });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, p: Picks = {}): GameState {
  let s = settle(s0, p);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(pass(s), p);
  return s;
}
const cast = (s: GameState, name: string, p: Picks = {}, player = 'p1'): GameState => resolveAll(settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), p), p);
const castable = (s: GameState, name: string, player = 'p1'): boolean => applyAction(s, { type: 'cast', player, card: find(s, name, 'hand', player) }).error === undefined;
/** The active player passes: the next player (p1 in a two-player game on p2's turn) has priority in the same step. */
const toP1 = (s: GameState): GameState => (s.pending?.player === 'p1' ? s : pass(s));
/** Pass priority until a decision other than priority is asked, or the stack is empty. */
function passToDecision(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 10; guard++) s = pass(s);
  return s;
}
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (k as unknown as { keyword: string }).keyword);
const obj = (id: string): TargetChoice => ({ kind: 'object', id });
const activateOf = (s: GameState, name: string, player = 'p1'): ReturnType<typeof legalActions>[number][] => legalActions(s, player).filter((l) => l.kind === 'activate' && !l.isMana && s.defs[s.objects[l.object!]!.defId]!.name === name);

const BEARS = card('Test Bears', 'Creature — Bear', '', ['2', '3']);
const BRUTE = card('Test Brute', 'Creature — Ogre', 'Flying', ['3', '5']);
const SORCERY = card('Test Sorcery', 'Sorcery', 'You gain 1 life.');
const INSTANT = card('Test Instant', 'Instant', 'You gain 1 life.');

describe('CR 601.3b, 702.8a, 513.1: "During each opponent\'s end step, you may cast spells as though they had flash."', () => {
  const PHANTOM = card('Test Phantom', 'Creature — Spirit', "During each opponent's end step, you may cast spells as though they had flash.", ['1', '1']);
  it('is automated', () => expect(full(PHANTOM)).toBe(true));
  it('a sorcery can be cast in the end step of an opponent\'s turn, not in the upkeep of that turn, and not in the controller\'s own end step', () => {
    let s = scenario([], { p1: { battlefield: ['Test Phantom'], hand: ['Test Sorcery', 'Test Instant'] }, defs: [PHANTOM, SORCERY, INSTANT] });
    s = advanceTo(s, 2, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
    s = toP1(s);
    expect(castable(s, 'Test Sorcery')).toBe(false);
    expect(castable(s, 'Test Instant')).toBe(true);
    s = toP1(advanceTo(s, 2, 'end'));
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.turn.step).toBe('end');
    expect(castable(s, 'Test Sorcery')).toBe(true);
    const own = advanceTo(scenario([], { p1: { battlefield: ['Test Phantom'], hand: ['Test Sorcery'] }, defs: [PHANTOM, SORCERY] }), 1, 'end');
    expect(own.turn.activePlayer).toBe('p1');
    expect(castable(own, 'Test Sorcery')).toBe(false);
  });
  it('negative: without it a sorcery can\'t be cast in an opponent\'s end step; an opponent\'s own Phantom gives nothing to its controller\'s rival on that opponent\'s own turn', () => {
    let s = scenario([], { p1: { hand: ['Test Sorcery'] }, defs: [PHANTOM, SORCERY] });
    s = toP1(advanceTo(s, 2, 'end'));
    expect(castable(s, 'Test Sorcery')).toBe(false);
    let t = scenario([], { p1: { hand: ['Test Sorcery'] }, p2: { battlefield: ['Test Phantom'] }, defs: [PHANTOM, SORCERY] });
    t = toP1(advanceTo(t, 2, 'end'));
    expect(castable(t, 'Test Sorcery')).toBe(false); // p2's Phantom: p2's opponents' end steps, not p2's own
  });
});

describe('CR 601.3, 602.5, 113.6: "Players can\'t cast spells from graveyards or activate abilities of cards in graveyards."', () => {
  const ASHES = card('Test Ashes', 'Enchantment', "Players can't cast spells from graveyards or activate abilities of cards in graveyards.\nWhenever a creature dies, you gain 2 life.");
  const FLASHBACKER = card('Test Flashbacker', 'Sorcery', 'You gain 1 life.\nFlashback {0}');
  const RETURNER = card('Test Returner', 'Creature — Zombie', '{0}: Return Test Returner from your graveyard to your hand.', ['1', '1']);
  const MANA_DORK = card('Test Dork', 'Creature — Elf', '{T}: Add {G}.', ['1', '1']);
  const GAINER = card('Test Gainer', 'Creature — Cleric', '{0}: You gain 1 life.', ['1', '1']);
  const defs = [ASHES, FLASHBACKER, RETURNER, MANA_DORK, GAINER];
  const flashbackOffered = (s: GameState): boolean => legalActions(s, 'p1').some((l) => l.kind === 'cast' && l.object !== undefined && s.objects[l.object]!.zone === 'graveyard');
  it('is automated', () => expect(full(ASHES)).toBe(true));
  it('with it out a flashback spell can\'t be cast from either graveyard and an ability of a card in a graveyard can\'t be activated; without it both can', () => {
    const base = { p1: { graveyard: ['Test Flashbacker', 'Test Returner'] }, p2: { graveyard: ['Test Flashbacker'] }, defs };
    const without = scenario([], base);
    expect(flashbackOffered(without)).toBe(true);
    expect(activateOf(without, 'Test Returner').length).toBe(1);
    const withIt = scenario([], { ...base, p1: { ...base.p1, battlefield: ['Test Ashes'] } });
    expect(flashbackOffered(withIt)).toBe(false);
    expect(activateOf(withIt, 'Test Returner').length).toBe(0);
    const theirs = scenario([], { ...base, p2: { ...base.p2, battlefield: ['Test Ashes'] } });
    expect(flashbackOffered(theirs)).toBe(false);
    expect(activateOf(theirs, 'Test Returner').length).toBe(0);
  });
  it('negative: spells from hand and abilities of permanents on the battlefield (mana abilities too) are unaffected', () => {
    const s = scenario([], { p1: { battlefield: ['Test Ashes', 'Test Gainer', 'Test Dork'], hand: ['Test Sorcery'] }, defs: [...defs, SORCERY] });
    expect(castable(s, 'Test Sorcery')).toBe(true);
    expect(activateOf(s, 'Test Gainer').length).toBe(1);
    expect(legalActions(s, 'p1').some((l) => l.kind === 'activate' && l.isMana && l.object === find(s, 'Test Dork', 'battlefield', 'p1'))).toBe(true);
  });
});

describe('CR 601.2f, 108.3: "Spells you cast but don\'t own cost {1} less to cast."', () => {
  const THIEF = card('Test Thief', 'Creature — Rogue', "Spells you cast but don't own cost {1} less to cast.", ['1', '1']);
  const PILFER = card('Test Pilfer', 'Sorcery', 'Exile the top card of target opponent\'s library. You may cast that card this turn.');
  const LOOT = card('Test Loot', 'Sorcery', 'You gain 1 life.', undefined, { cost: '{2}' });
  const MINE = card('Test Mine', 'Sorcery', 'You gain 1 life.', undefined, { cost: '{2}' });
  it('is automated', () => expect(full(THIEF)).toBe(true));
  it('a spell cast from an opponent\'s card costs {1} less, a spell the caster owns does not', () => {
    const lands = ['Plains', 'Plains'];
    const mk = (thief: boolean): GameState => scenario([], { p1: { battlefield: thief ? ['Test Thief', ...lands] : lands, hand: ['Test Pilfer', 'Test Mine'] }, p2: { library: ['Test Loot'] }, defs: [THIEF, PILFER, LOOT, MINE] });
    const s = mk(true);
    // Test Pilfer costs {0}; the exiled Test Loot ({2}) is cast with two lands only because of the reduction
    let t = cast(s, 'Test Pilfer', { targets: [{ kind: 'player', id: 'p2' }] });
    const loot = findAll(t, 'Test Loot', 'exile');
    expect(loot.length).toBe(1);
    const tryLoot = applyAction(t, { type: 'cast', player: 'p1', card: loot[0]! });
    expect(tryLoot.error, tryLoot.error?.message).toBeUndefined();
    const cost = (state: GameState): number => { let u = settle(act(state, { type: 'cast', player: 'p1', card: findAll(state, 'Test Loot', 'exile')[0]! })); return state.zones.battlefield.filter((id) => state.objects[id]!.defId === 'Plains' && !state.objects[id]!.tapped).length - u.zones.battlefield.filter((id) => u.objects[id]!.defId === 'Plains' && !u.objects[id]!.tapped).length; };
    expect(cost(t)).toBe(1);
    // the same card owned by the caster costs {2}
    const own = mk(true);
    const ownCost = (): number => { const u = settle(act(own, { type: 'cast', player: 'p1', card: find(own, 'Test Mine', 'hand', 'p1') })); return own.zones.battlefield.filter((id) => own.objects[id]!.defId === 'Plains' && !own.objects[id]!.tapped).length - u.zones.battlefield.filter((id) => u.objects[id]!.defId === 'Plains' && !u.objects[id]!.tapped).length; };
    expect(ownCost()).toBe(2);
    // without the Thief the exiled card costs {2}
    const noThief = cast(mk(false), 'Test Pilfer', { targets: [{ kind: 'player', id: 'p2' }] });
    const noCost = (): number => { const u = settle(act(noThief, { type: 'cast', player: 'p1', card: findAll(noThief, 'Test Loot', 'exile')[0]! })); return noThief.zones.battlefield.filter((id) => noThief.objects[id]!.defId === 'Plains' && !noThief.objects[id]!.tapped).length - u.zones.battlefield.filter((id) => u.objects[id]!.defId === 'Plains' && !u.objects[id]!.tapped).length; };
    expect(noCost()).toBe(2);
  });
});

describe('CR 602.5, 605.1a, 606.1: "Enchanted player can\'t activate abilities that aren\'t mana abilities or loyalty abilities."', () => {
  const CURSE = card('Test Curse', 'Enchantment — Aura Curse', "Enchant player\nEnchanted player can't activate abilities that aren't mana abilities or loyalty abilities.");
  const GAINER = card('Test Gainer', 'Creature — Cleric', '{0}: You gain 1 life.', ['1', '1']);
  const DORK = card('Test Dork', 'Creature — Elf', '{T}: Add {G}.', ['1', '1']);
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Testy', '+1: You gain 1 life.', undefined, { loyalty: '3' });
  const defs = [CURSE, GAINER, DORK, WALKER];
  const mk = (cursed: boolean): GameState => {
    let s = scenario([], { p1: { hand: ['Test Curse'], battlefield: ['Test Gainer', 'Test Dork', { name: 'Test Walker', counters: { loyalty: 3 } }] }, p2: { battlefield: ['Test Gainer', 'Test Dork', { name: 'Test Walker', counters: { loyalty: 3 } }] }, defs });
    if (cursed) s = cast(s, 'Test Curse', { targets: [{ kind: 'player', id: 'p2' }] });
    return s;
  };
  const offered = (s: GameState, player: string): { plain: number; mana: number; loyalty: number } => {
    const acts = legalActions(s, player).filter((l) => l.kind === 'activate');
    const name = (l: { object?: ObjectId }): string => s.defs[s.objects[l.object!]!.defId]!.name;
    return { plain: acts.filter((l) => !l.isMana && name(l) === 'Test Gainer').length, mana: acts.filter((l) => l.isMana).length, loyalty: acts.filter((l) => name(l) === 'Test Walker').length };
  };
  it('is automated', () => expect(full(CURSE)).toBe(true));
  it('the enchanted player (given priority in their own turn) is offered mana abilities and loyalty abilities but not other activated abilities; the other player keeps all of them', () => {
    const before = mk(false);
    const s = mk(true);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Curse')).toBe(true);
    let t = advanceTo(s, 2, 'main1');
    expect(t.turn.activePlayer).toBe('p2');
    const o2 = offered(t, 'p2');
    expect(o2.plain).toBe(0);
    expect(o2.mana).toBeGreaterThan(0);
    expect(o2.loyalty).toBeGreaterThan(0);
    // negative: the same turn without the Curse offers the plain ability
    expect(offered(advanceTo(before, 2, 'main1'), 'p2').plain).toBe(1);
    // negative: the Curse's controller is not restricted
    expect(offered(s, 'p1').plain).toBe(1);
  });
});

describe('CR 701.12a, 401.1: "Exchange your hand and library, then shuffle." (planeswalker loyalty ability)', () => {
  const WALKER = card('Test Swapper', 'Legendary Planeswalker — Testy', '-1: Exchange your hand and library, then shuffle.', undefined, { loyalty: '4' });
  it('is automated', () => expect(full(WALKER)).toBe(true));
  it('the hand becomes the library and the library becomes the hand; the opponent\'s zones don\'t change', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Swapper', counters: { loyalty: 4 } }], hand: ['Test Bears', 'Test Sorcery'], library: ['Test Brute', 'Test Instant'] }, p2: { hand: ['Test Bears'], library: ['Test Brute'] }, defs: [WALKER, BEARS, BRUTE, SORCERY, INSTANT] });
    const handBefore = nameIn(s0, 'hand', 'p1');
    const libBefore = nameIn(s0, 'library', 'p1');
    expect(handBefore.length).toBe(2);
    const oppHand = nameIn(s0, 'hand', 'p2');
    const oppLib = nameIn(s0, 'library', 'p2');
    const a = activateOf(s0, 'Test Swapper')[0]!;
    const s = resolveAll(act(s0, a.action));
    const handAfter = nameIn(s, 'hand', 'p1');
    const libAfter = nameIn(s, 'library', 'p1');
    expect(handAfter.length).toBe(libBefore.length);
    expect([...handAfter].sort()).toEqual([...libBefore].sort());
    expect([...libAfter].sort()).toEqual([...handBefore].sort());
    expect(nameIn(s, 'hand', 'p2')).toEqual(oppHand);
    expect(nameIn(s, 'library', 'p2')).toEqual(oppLib);
  });
});

const s0Top = (s: GameState): string => s.objects[s.zones.library.p1![0]!]!.defId;

describe('CR 401.5, 305.1: "You may look at the top card of your library any time, and you may play lands from the top of your library."', () => {
  const ELF = card('Test Topper', 'Creature — Elf Warrior', 'You may look at the top card of your library any time, and you may play lands from the top of your library.', ['2', '2']);
  it('is automated', () => expect(full(ELF)).toBe(true));
  it('a land on top of the library can be played; a nonland card on top can\'t be cast; without the Elf a land on top can\'t be played', () => {
    const top = (s: GameState): ObjectId => s.zones.library.p1![0]!; // the first card listed is on top (setup order)
    const land = scenario([], { p1: { battlefield: ['Test Topper'] }, defs: [ELF] });
    expect(s0Top(land)).toBe('Plains');
    expect(applyAction(land, { type: 'playLand', player: 'p1', card: top(land) }).error).toBeUndefined();
    const spell = scenario([], { p1: { battlefield: ['Test Topper', 'Plains'], library: ['Test Sorcery'] }, defs: [ELF, SORCERY] });
    expect(s0Top(spell)).toBe('Test Sorcery');
    expect(applyAction(spell, { type: 'cast', player: 'p1', card: top(spell) }).error).toBeDefined();
    const none = scenario([], { p1: {}, defs: [ELF] });
    expect(applyAction(none, { type: 'playLand', player: 'p1', card: top(none) }).error).toBeDefined();
  });
});

describe('CR 608.2d, 701.17a: "Mill two cards, then return a nonland card of an opponent\'s choice from your graveyard to your hand."', () => {
  const GOLD = card('Test Goldfang', 'Legendary Creature — Human Shaman', '{0}: Mill two cards, then return a nonland card of an opponent\'s choice from your graveyard to your hand.', ['4', '5']);
  it('is automated', () => expect(full(GOLD)).toBe(true));
  it('the opponent chooses among the nonland cards of the controller\'s graveyard (the milled ones too); lands are not offered; the chosen card goes to the controller\'s hand', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Goldfang'], graveyard: ['Test Bears', 'Test Brute', 'Plains'], library: ['Test Sorcery', 'Plains'] }, defs: [GOLD, BEARS, BRUTE, SORCERY] });
    let s = passToDecision(act(s0, activateOf(s0, 'Test Goldfang')[0]!.action));
    const d = s.pending as { kind: string; player: string; options: ObjectId[] };
    expect(d.kind).toBe('chooseObjects');
    expect(d.player).toBe('p2'); // the opponent chooses
    const names = d.options.map((id) => s.objects[id]!.defId).sort();
    expect(names).toEqual(['Test Bears', 'Test Brute', 'Test Sorcery']); // the milled Test Sorcery is offered; neither Plains is
    const brute = d.options.find((id) => s.objects[id]!.defId === 'Test Brute')!;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [brute] }));
    expect(nameIn(s, 'hand', 'p1')).toContain('Test Brute');
    expect(nameIn(s, 'graveyard', 'p1')).not.toContain('Test Brute');
    expect(nameIn(s, 'graveyard', 'p1')).toContain('Test Bears');
  });
  it('negative: a graveyard of lands only returns nothing', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Goldfang'], graveyard: ['Plains'] }, defs: [GOLD] });
    let s = passToDecision(act(s0, activateOf(s0, 'Test Goldfang')[0]!.action));
    s = resolveAll(settle(s));
    expect(nameIn(s, 'hand', 'p1')).toEqual([]);
  });
});

describe('CR 608.2d, 701.8a: "Choose up to one creature. Destroy the rest."', () => {
  const BLAST = card('Test Blast', 'Sorcery', 'Choose up to one creature. Destroy the rest.');
  it('is automated', () => expect(full(BLAST)).toBe(true));
  it('the caster chooses one creature of any player; every other creature is destroyed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Blast'], battlefield: ['Test Bears', 'Test Brute'] }, p2: { battlefield: ['Test Bears', 'Test Brute'] }, defs: [BLAST, BEARS, BRUTE] });
    const theirs = ofName(s0, 'Test Brute', 'p2')[0]!;
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Blast', 'hand', 'p1') }), { objects: [theirs] });
    s = resolveAll(s, { objects: [theirs] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.zone === 'battlefield')).toEqual([theirs]);
  });
  it('negative: choosing none destroys every creature; a noncreature permanent is never destroyed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Blast'], battlefield: ['Test Bears', 'Plains'] }, p2: { battlefield: ['Test Brute'] }, defs: [BLAST, BEARS, BRUTE] });
    const s = cast(s0, 'Test Blast');
    expect(ofName(s, 'Test Bears').length + ofName(s, 'Test Brute').length).toBe(0);
    expect(ofName(s, 'Plains').length).toBe(1);
  });
});

describe('CR 611.2a, 611.2c, 613.4b: "Creatures your opponents control lose all abilities and have base power and toughness 1/1 until end of turn."', () => {
  const SHRINK = card('Test Shrinker', 'Sorcery', 'Creatures your opponents control lose all abilities and have base power and toughness 1/1 until end of turn.');
  const CHEAT = card('Test Latecomer', 'Creature — Ogre', 'Flying', ['4', '4']);
  it('is automated', () => expect(full(SHRINK)).toBe(true));
  it('opponents\' creatures become 1/1 without abilities until end of turn, yours are unchanged, a creature that enters later is unaffected, and the end of turn restores them', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shrinker'], battlefield: ['Test Brute'] }, p2: { battlefield: ['Test Brute'], hand: ['Test Latecomer'] }, defs: [SHRINK, BRUTE, CHEAT] });
    let s = cast(s0, 'Test Shrinker');
    const mine = ofName(s, 'Test Brute', 'p1')[0]!;
    const theirs = ofName(s, 'Test Brute', 'p2')[0]!;
    expect(pt(s, theirs)).toBe('1/1');
    expect(kws(s, theirs)).not.toContain('flying');
    expect(kws(s, mine)).toContain('flying');
    expect(pt(s, mine)).toBe('3/5');
    const late = put(s, 'p2', 'battlefield', 'Test Latecomer');
    expect(pt(s, late)).toBe('4/4'); // CR 611.2c: only the creatures there as it resolved
    s = advanceTo(s, 2, 'main1');
    expect(pt(s, theirs)).toBe('3/5');
  });
});

describe('CR 205.3m, 613.1d, 613.4b: "Until end of turn, ~ has base power and toughness 5/3, gains trample, and isn\'t a Human."', () => {
  const WOLF = card('Test Packwolf', 'Creature — Human Werewolf', '{0}: Until end of turn, ~ has base power and toughness 5/3, gains trample, and isn\'t a Human.', ['2', '2']);
  it('is automated', () => expect(full(WOLF)).toBe(true));
  it('the creature becomes 5/3 with trample and loses the Human type (not Werewolf) until end of turn', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Packwolf'] }, defs: [WOLF] });
    const id = ofName(s0, 'Test Packwolf')[0]!;
    expect(getChars(s0, id)!.subtypes).toContain('Human');
    expect(kws(s0, id)).not.toContain('trample');
    const s = resolveAll(act(s0, activateOf(s0, 'Test Packwolf')[0]!.action));
    const c = getChars(s, id)!;
    expect(`${c.power}/${c.toughness}`).toBe('5/3');
    expect(c.subtypes).not.toContain('Human');
    expect(c.subtypes).toContain('Werewolf');
    expect(kws(s, id)).toContain('trample');
    const next = advanceTo(s, 2, 'main1');
    const n = getChars(next, id)!;
    expect(`${n.power}/${n.toughness}`).toBe('2/2');
    expect(n.subtypes).toContain('Human');
  });
});

describe('CR 106.4, 102.1, 119.3, 500.1: "At the beginning of each postcombat main phase, the active player adds {C}{C} for each of your opponents who lost life this turn."', () => {
  const OBSERVER = card('Test Observer', 'Legendary Creature — Phyrexian', 'At the beginning of each postcombat main phase, the active player adds {C}{C} for each of your opponents who lost life this turn.', ['2', '2']);
  const BURN = card('Test Burn', 'Sorcery', 'Test Burn deals 1 damage to target player.');
  const pool = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.manaPool.filter((u) => u.type === 'C').length;
  it('is automated', () => expect(full(OBSERVER)).toBe(true));
  it('in the postcombat main phase the active player gets {C}{C} for each opponent of the controller who lost life this turn; none when no one lost life', () => {
    const mk = (burn: boolean): GameState => {
      let s = scenario([], { p1: { battlefield: ['Test Observer'], hand: ['Test Burn'] }, defs: [OBSERVER, BURN] });
      if (burn) s = cast(s, 'Test Burn', { targets: [{ kind: 'player', id: 'p2' }] });
      return s;
    };
    for (const [burn, expected] of [[true, 2], [false, 0]] as const) {
      let s = mk(burn);
      s = advanceTo(s, 1, 'main2');
      s = resolveAll(s);
      expect(s.turn.step).toBe('main2');
      expect(pool(s, 'p1'), burn ? 'an opponent lost life' : 'nobody lost life').toBe(expected);
      expect(pool(s, 'p2')).toBe(0);
    }
  });
});

describe('CR 701.21a, 122.1: "At the beginning of each player\'s upkeep, that player sacrifices a permanent of their choice for each soot counter on ~."', () => {
  const STACK = card('Test Chimney', 'Artifact', "At the beginning of each player's upkeep, that player sacrifices a permanent of their choice for each soot counter on ~.");
  it('is automated', () => expect(full(STACK)).toBe(true));
  it('the player whose upkeep it is sacrifices as many permanents of their choice as there are soot counters; the other player sacrifices nothing', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Chimney', counters: { soot: 2 } }, 'Test Bears', 'Test Brute'] }, p2: { battlefield: ['Test Bears', 'Test Brute', 'Plains'] }, defs: [STACK, BEARS, BRUTE] });
    let s = advanceTo(s0, 2, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
    for (let guard = 0; guard < 6 && s.pending && s.pending.kind !== 'chooseObjects'; guard++) s = pass(s);
    const d = s.pending as { kind: string; player: string; min: number; options: ObjectId[] };
    expect(d.kind).toBe('chooseObjects');
    expect(d.player).toBe('p2');
    expect(d.min).toBe(2);
    expect(d.options.every((id) => s.objects[id]!.controller === 'p2')).toBe(true);
    const pick = d.options.filter((id) => s.objects[id]!.defId !== 'Test Brute').slice(0, 2);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: pick }));
    expect(ofName(s, 'Test Brute', 'p2').length).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').length).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length).toBe(3);
  });
  it('negative: with no soot counter nothing is sacrificed', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Chimney'] }, p2: { battlefield: ['Test Bears'] }, defs: [STACK, BEARS] });
    let s = advanceTo(s0, 2, 'upkeep');
    for (let guard = 0; guard < 6 && s.turn.step === 'upkeep' && s.pending; guard++) s = pass(s);
    expect(ofName(s, 'Test Bears', 'p2').length).toBe(1);
  });
});

describe('CR 701.21a, 122.1, 608.2h: "{0}, Sacrifice ~: Target player sacrifices a permanent of their choice for each blood counter on ~." (the source is gone: its counters as it last existed)', () => {
  const KNIFE = card('Test Riteknife', 'Artifact — Equipment', '{0}, Sacrifice ~: Target player sacrifices a permanent of their choice for each blood counter on ~.');
  it('is automated', () => expect(full(KNIFE)).toBe(true));
  it('the target player sacrifices one permanent for each counter the sacrificed source had', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Riteknife', counters: { blood: 2 } }] }, p2: { battlefield: ['Test Bears', 'Test Brute', 'Plains'] }, defs: [KNIFE, BEARS, BRUTE] });
    let s = settle(act(s0, activateOf(s0, 'Test Riteknife')[0]!.action), { targets: [{ kind: 'player', id: 'p2' }] });
    s = passToDecision(s);
    const d = s.pending as { kind: string; player: string; min: number; options: ObjectId[] };
    expect(d.kind).toBe('chooseObjects');
    expect(d.player).toBe('p2');
    expect(d.min).toBe(2);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, 2) }));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').length).toBe(1);
  });
});

describe('CR 119.3, 800.4a (ruling 2020-11-10): an opponent who lost life and then lost the game is still counted for "each of your opponents who lost life this turn"', () => {
  const OBSERVER = card('Test Watcher', 'Legendary Creature — Phyrexian', 'At the beginning of each postcombat main phase, the active player adds {C}{C} for each of your opponents who lost life this turn.', ['2', '2']);
  const DRAW = card('Test Counter', 'Sorcery', 'Draw a card for each opponent who lost life this turn.');
  it('the count of opponents who lost life includes one that has since left the game', () => {
    let s = scenario([], { p1: { battlefield: ['Test Watcher'], hand: ['Test Counter'] }, p2: {}, defs: [OBSERVER, DRAW] });
    s.players.find((p) => p.id === 'p2')!.turnStats.lifeLost = 3;
    s.players.find((p) => p.id === 'p2')!.hasLost = true;
    const before = s.zones.hand.p1!.length;
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Counter', 'hand', 'p1') })));
    expect(s.zones.hand.p1!.length).toBe(before); // cast one card, drew one for the opponent who lost life and then lost the game
  });
});
