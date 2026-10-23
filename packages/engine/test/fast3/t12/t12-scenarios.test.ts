/**
 * FAST3 T12: the static shapes of parser/templates/zz-fast3/t12.json and the readings render/ learned for the package's shapes, played through the engine
 * with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 122.1, 613.4c       "Equipped creature gets +1/+1 for each charge counter on ~" follows the counters on the Equipment
 *   CR 105.2, 110.2        "~ gets +1/+0 as long as any player controls a green permanent" (either player's, never its own color alone)
 *   CR 303.4, 611.3a       "Enchanted creature gets +1/+1 for each other creature you control" excludes the enchanted creature itself
 *   CR 305.6, 205.3i       domain: basic land types among lands you control (a dual land counts twice, a Desert never)
 *   CR 604.3, 613.4a       domain and "that number plus 1" as characteristic-defining abilities, in every zone
 *   CR 509.1b              "can't block creatures with power 3 or greater"; "creatures with power less than ~'s power can't block it"
 *   CR 613.1f, 613.4c      "gets -3/-0 and loses all abilities"
 *   CR 607.2d              "Creatures you control of the chosen color get +1/+1"
 *   CR 604.1, 402.1, 121.1 "as long as you control a Garruk planeswalker", "as long as you have no cards in hand", "as long as you've drawn two or more
 *                          cards this turn", "for each Swamp your opponents control" (existing templates, the new readings)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { ruleDenial } from '../../../src/statics/hooks';
import { act, answer, find, pass, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
/** Every ability of the card automated, and the card full (the T12 templates are stable). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const attach = (s: GameState, what: ObjectId, to: ObjectId): GameState => tweak(s, (t) => { t.objects[what]!.attachedTo = to; });
/** An Aura of p1 put onto the battlefield attached to `to` (after the scenario's start: an unattached Aura would go to the graveyard, CR 704.5m). */
const enchant = (s: GameState, aura: string, to: ObjectId): GameState => tweak(s, (t) => { const id = put(t, 'p1', 'battlefield', aura); t.objects[id]!.attachedTo = to; });

const BEARS = card('Test Bears', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const BRUTE = card('Test Brute', 'Creature — Giant', '', ['5', '1']);
const MOSS = card('Test Moss', 'Creature — Plant', '', ['1', '1'], '{G}', ['G']);

describe('CR 122.1, 613.4c: "Equipped creature gets +2/+1 for each charge counter on ~"', () => {
  const SIGIL = card('Test Sigil', 'Artifact — Equipment', 'Equipped creature gets +2/+1 for each charge counter on Test Sigil.\nEquip {2}');
  it('is automated, and the bonus follows the number of charge counters on the Equipment, not on the creature', () => {
    expect(full(SIGIL)).toBe(true);
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Sigil', counters: { charge: 2 } }, 'Test Bears'] }, defs: [SIGIL, BEARS] });
    const bears = find(s, 'Test Bears', 'battlefield');
    const sigil = find(s, 'Test Sigil', 'battlefield');
    expect(pt(s, bears)).toBe('2/2');
    s = attach(s, sigil, bears);
    expect(pt(s, bears)).toBe('6/4');
    s = tweak(s, (t) => { t.objects[sigil]!.counters = { charge: 3 }; t.objects[bears]!.counters = { charge: 5 }; });
    expect(pt(s, bears)).toBe('8/5');
  });
});

describe('CR 105.2, 110.2: "~ gets +1/+0 as long as any player controls a green permanent"', () => {
  const KNIGHT = card('Test Knight', 'Creature — Knight', 'Test Knight gets +1/+0 as long as any player controls a green permanent.', ['2', '2'], '{1}{W}', ['W']);
  it('counts a green permanent of either player and nothing else', () => {
    expect(full(KNIGHT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Knight', 'Test Bears'] }, p2: { hand: ['Test Moss'] }, defs: [KNIGHT, BEARS, MOSS] });
    const knight = find(s, 'Test Knight', 'battlefield');
    expect(pt(s, knight)).toBe('2/2');
    put(s, 'p2', 'battlefield', 'Test Moss');
    s = { ...s };
    expect(pt(s, knight)).toBe('3/2');
  });
});

describe('CR 303.4, 611.3a: "Enchanted creature gets +1/+2 for each other creature you control"', () => {
  const RALLY = card('Test Rally', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+2 for each other creature you control.');
  it('counts the Aura controller\'s other creatures, never the enchanted creature itself', () => {
    expect(full(RALLY)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Bears', 'Test Ogre'] }, p2: { battlefield: ['Test Brute'] }, defs: [RALLY, BEARS, OGRE, BRUTE] });
    const bears = find(s, 'Test Bears', 'battlefield');
    s = enchant(s, 'Test Rally', bears);
    expect(pt(s, bears)).toBe('3/4'); // one other creature you control: the Ogre
    put(s, 'p1', 'battlefield', 'Test Brute');
    s = { ...s };
    expect(pt(s, bears)).toBe('4/6');
  });
  it('on an opponent\'s creature, every creature of the Aura\'s controller counts', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bears', 'Test Ogre'] }, p2: { battlefield: ['Test Brute'] }, defs: [RALLY, BEARS, OGRE, BRUTE] });
    const brute = find(s, 'Test Brute', 'battlefield');
    s = enchant(s, 'Test Rally', brute);
    expect(pt(s, brute)).toBe('7/5');
  });
});

describe('CR 305.6, 205.3i: domain, the basic land types among lands you control', () => {
  const MIGHT = card('Test Might', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+2 for each basic land type among lands you control.');
  const GIANT = card('Test Wayfarer', 'Creature — Giant', 'Test Wayfarer gets +1/+0 for each basic land type among lands you control.', ['1', '1']);
  const KAVU = card('Test Kavu', 'Creature — Kavu', "Test Kavu's power and toughness are each equal to the number of basic land types among lands you control.", ['*', '*']);
  const DUAL = card('Test Savannah', 'Land — Forest Plains', '');
  const DESERT = card('Test Desert', 'Land — Desert', '');
  const ISLAND = card('Test Island', 'Land — Island', '');
  const defs = [MIGHT, GIANT, KAVU, DUAL, DESERT, ISLAND, BEARS];
  it('every domain card is automated', () => {
    for (const d of [MIGHT, GIANT, KAVU]) expect(full(d), d.name).toBe(true);
  });
  it('a dual land gives two types, a second land of a type adds nothing, a Desert never counts, an opponent\'s land never counts', () => {
    let s = scenario([], { p1: { battlefield: ['Test Wayfarer', 'Test Kavu', 'Test Savannah', 'Test Desert', 'Plains'] }, p2: { battlefield: ['Test Island'] }, defs });
    const giant = find(s, 'Test Wayfarer', 'battlefield');
    const kavu = find(s, 'Test Kavu', 'battlefield');
    expect(pt(s, giant)).toBe('3/1');
    expect(pt(s, kavu)).toBe('2/2');
    put(s, 'p1', 'battlefield', 'Test Island');
    s = { ...s };
    expect(pt(s, giant)).toBe('4/1');
    expect(pt(s, kavu)).toBe('3/3');
  });
  it('an Aura: the enchanted creature gets the bonus', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bears', 'Test Savannah', 'Test Island'] }, defs });
    const bears = find(s, 'Test Bears', 'battlefield');
    s = enchant(s, 'Test Might', bears);
    expect(pt(s, bears)).toBe('5/8');
  });
  it('CR 604.3: the characteristic-defining ability works in the hand and the graveyard too', () => {
    const s = scenario([], { p1: { hand: ['Test Kavu'], graveyard: ['Test Kavu'], battlefield: ['Test Savannah'] }, defs });
    expect(pt(s, find(s, 'Test Kavu', 'hand'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Kavu', 'graveyard'))).toBe('2/2');
  });
});

describe('CR 604.3, 613.4a: "power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1"', () => {
  const GOYF = card('Test Goyf', 'Creature — Lhurgoyf', "Test Goyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.", ['*', '1+*']);
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', undefined, '{R}');
  const RELIC = card('Test Relic', 'Artifact Creature — Golem', '', ['1', '1']);
  it('counts card types (an artifact creature is two) in every graveyard, on the battlefield and in the hand', () => {
    expect(full(GOYF)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Goyf'], hand: ['Test Goyf'], graveyard: ['Test Bolt'] }, p2: { graveyard: ['Test Relic', 'Test Bears'] }, defs: [GOYF, BOLT, RELIC, BEARS] });
    expect(pt(s, find(s, 'Test Goyf', 'battlefield'))).toBe('3/4');
    expect(pt(s, find(s, 'Test Goyf', 'hand'))).toBe('3/4');
  });
});

describe('CR 509.1b: block restrictions', () => {
  const ORC = card('Test Orc', 'Creature — Orc', "Test Orc can't block creatures with power 3 or greater.", ['2', '2']);
  const WOLF = card('Test Wolf', 'Creature — Wolf', "Creatures with power less than Test Wolf's power can't block it.", ['3', '3']);
  it('"can\'t block creatures with power 3 or greater": a 3-power attacker can\'t be blocked by it, a 2-power one can', () => {
    expect(full(ORC)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Ogre', 'Test Bears'] }, p2: { battlefield: ['Test Orc'] }, defs: [ORC, OGRE, BEARS] });
    const orc = find(s, 'Test Orc', 'battlefield');
    expect(ruleDenial(s, { action: 'block', subject: orc, other: find(s, 'Test Ogre', 'battlefield') })).not.toBeNull();
    expect(ruleDenial(s, { action: 'block', subject: orc, other: find(s, 'Test Bears', 'battlefield') })).toBeNull();
  });
  it('"creatures with power less than ~\'s power can\'t block it": compared with its power at the time', () => {
    expect(full(WOLF)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Wolf'] }, p2: { battlefield: ['Test Bears', 'Test Ogre'] }, defs: [WOLF, OGRE, BEARS] });
    const wolf = find(s, 'Test Wolf', 'battlefield');
    const bears = find(s, 'Test Bears', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: wolf, other: bears })).not.toBeNull();
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: wolf, other: ogre })).toBeNull();
    s = tweak(s, (t) => { t.objects[wolf]!.counters = { '-1/-1': 1 }; });
    expect(pt(s, wolf)).toBe('2/2');
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: wolf, other: bears })).toBeNull();
  });
});

describe('CR 613.1f, 613.4c: "Enchanted creature gets -3/-0 and loses all abilities"', () => {
  const HUSH = card('Test Hush', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -3/-0 and loses all abilities.');
  const FLIER = card('Test Flier', 'Creature — Bird', 'Flying', ['4', '2']);
  it('the creature loses flying and gets -3/-0', () => {
    expect(full(HUSH)).toBe(true);
    let s = scenario([], { p2: { battlefield: ['Test Flier'] }, defs: [HUSH, FLIER] });
    const flier = find(s, 'Test Flier', 'battlefield');
    expect(hasKeyword(getChars(s, flier)!, 'flying')).toBe(true);
    s = enchant(s, 'Test Hush', flier);
    expect(pt(s, flier)).toBe('1/2');
    expect(hasKeyword(getChars(s, flier)!, 'flying')).toBe(false);
  });
});

describe('CR 607.2d: "Creatures you control of the chosen color get +1/+1"', () => {
  const STANDARD = card('Test Standard', 'Artifact', 'As Test Standard enters, choose a color.\nCreatures you control of the chosen color get +1/+1.');
  it('only your creatures of the color chosen as it entered', () => {
    expect(full(STANDARD)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Standard'], battlefield: ['Test Moss', 'Test Bears'] }, p2: { battlefield: ['Test Moss'] }, defs: [STANDARD, MOSS, BEARS] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Standard', 'hand', 'p1') });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = pass(pass(s));
    expect(s.pending?.kind).not.toBe('priority');
    s = answer(s, chooseGreen(s));
    expect(pt(s, find(s, 'Test Moss', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Bears', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Moss', 'battlefield', 'p2'))).toBe('1/1');
  });
});

/** The answer that chooses green in the pending color choice. */
function chooseGreen(s: GameState): DecisionAnswer {
  const p = s.pending as unknown as { kind: string; options?: unknown[] };
  if (p.kind === 'chooseColor') return { kind: 'chooseColor', color: 'G' } as unknown as DecisionAnswer;
  if (p.kind === 'chooseOption') {
    const i = (p.options ?? []).findIndex((o) => /green|^G$/i.test(typeof o === 'string' ? o : JSON.stringify(o)));
    return { kind: 'chooseOption', index: i } as unknown as DecisionAnswer;
  }
  throw new Error(`unexpected decision ${p.kind}`);
}

describe('CR 604.1: conditions and counts of existing templates the new readings let through', () => {
  const WURM = card('Test Wurm', 'Creature — Wurm', 'Test Wurm gets +2/+2 as long as you control a Garruk planeswalker.', ['4', '4']);
  const GARRUK = card('Test Garruk', 'Legendary Planeswalker — Garruk', '+1: You gain 1 life.');
  const LILIANA = card('Test Liliana', 'Legendary Planeswalker — Liliana', '+1: You gain 1 life.');
  const RAIDER = card('Test Raider', 'Creature — Human', 'Test Raider gets +2/+2 as long as you have no cards in hand.', ['2', '2']);
  const HUNTER = card('Test Hunter', 'Creature — Human', "As long as you've drawn two or more cards this turn, Test Hunter has lifelink and menace.", ['2', '2']);
  const CRUSADER = card('Test Crusader', 'Creature — Knight', 'Test Crusader gets +1/+1 for each Swamp your opponents control.', ['2', '2']);
  const SWAMP = card('Test Swamp', 'Land — Swamp', '');
  const SCARECROW = card('Test Scarecrow', 'Artifact Creature — Scarecrow', 'Creatures with flying your opponents control get -1/-0.', ['2', '3']);
  const FLIER = card('Test Flier', 'Creature — Bird', 'Flying', ['4', '2']);
  const DRAKE = card('Test Drake', 'Creature — Drake', "Flying\nTest Drake's power is equal to the number of instant and sorcery cards in your graveyard.", ['*', '4']);
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', undefined, '{R}');
  const SORCERY = card('Test Ponder', 'Sorcery', 'Draw a card.', undefined, '{U}');
  it('every card is automated', () => {
    for (const d of [WURM, RAIDER, HUNTER, CRUSADER, SCARECROW, DRAKE]) expect(full(d), d.name).toBe(true);
  });
  it('CR 205.3j: a Garruk planeswalker turns the bonus on, another planeswalker does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Wurm', 'Test Liliana'] }, defs: [WURM, GARRUK, LILIANA] });
    const wurm = find(s, 'Test Wurm', 'battlefield');
    expect(pt(s, wurm)).toBe('4/4');
    put(s, 'p1', 'battlefield', 'Test Garruk');
    s = { ...s };
    expect(pt(s, wurm)).toBe('6/6');
  });
  it('CR 402.1: the bonus only with no cards in your hand (an opponent\'s hand does not matter)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Raider'] }, p2: { hand: ['Test Bears'] }, defs: [RAIDER, BEARS] });
    const raider = find(s, 'Test Raider', 'battlefield');
    expect(pt(s, raider)).toBe('4/4');
    put(s, 'p1', 'hand', 'Test Bears');
    s = { ...s };
    expect(pt(s, raider)).toBe('2/2');
  });
  it('CR 121.1: lifelink and menace once its controller drew two cards this turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hunter'] }, defs: [HUNTER] });
    const hunter = find(s, 'Test Hunter', 'battlefield');
    expect(hasKeyword(getChars(s, hunter)!, 'lifelink')).toBe(false);
    s = tweak(s, (t) => { t.players.find((p) => p.id === 'p2')!.turnStats.cardsDrawn = 3; });
    expect(hasKeyword(getChars(s, hunter)!, 'menace')).toBe(false);
    s = tweak(s, (t) => { t.players.find((p) => p.id === 'p1')!.turnStats.cardsDrawn = 2; });
    expect(hasKeyword(getChars(s, hunter)!, 'lifelink')).toBe(true);
    expect(hasKeyword(getChars(s, hunter)!, 'menace')).toBe(true);
  });
  it('CR 109.4: every opponent\'s Swamp counts, your own do not', () => {
    const s = scenario([], { p1: { battlefield: ['Test Crusader', 'Test Swamp'] }, p2: { battlefield: ['Test Swamp', 'Test Swamp'] }, defs: [CRUSADER, SWAMP] });
    expect(pt(s, find(s, 'Test Crusader', 'battlefield'))).toBe('4/4');
  });
  it('"Creatures with flying your opponents control get -1/-0": the opponent\'s fliers only', () => {
    const s = scenario([], { p1: { battlefield: ['Test Scarecrow', 'Test Flier'] }, p2: { battlefield: ['Test Flier', 'Test Bears'] }, defs: [SCARECROW, FLIER, BEARS] });
    expect(pt(s, find(s, 'Test Flier', 'battlefield', 'p2'))).toBe('3/2');
    expect(pt(s, find(s, 'Test Flier', 'battlefield', 'p1'))).toBe('4/2');
    expect(pt(s, find(s, 'Test Bears', 'battlefield', 'p2'))).toBe('2/2');
  });
  it('CR 604.3: "the number of instant and sorcery cards in your graveyard" counts both types', () => {
    const s = scenario([], { p1: { battlefield: ['Test Drake'], graveyard: ['Test Bolt', 'Test Ponder', 'Test Bears'] }, p2: { graveyard: ['Test Bolt'] }, defs: [DRAKE, BOLT, SORCERY, BEARS] });
    expect(pt(s, find(s, 'Test Drake', 'battlefield'))).toBe('2/4');
  });
});
