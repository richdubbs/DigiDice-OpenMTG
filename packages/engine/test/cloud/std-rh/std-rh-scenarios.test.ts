/**
 * Standard round H (slot H of F-J): the readings of the round played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 103.4, 119.1, 611.3a        "As long as your life total is greater than your starting life total, ... ~ gets an additional +N/+N as long as your life total is at
 *                                  least N greater than your starting life total." (one static ability per conditional sentence of a paragraph)
 *   CR 702.166, 205.1b, 611.2a     "If this spell was bargained, target land you control becomes a 2/2 Insect creature with reach that's still a land."
 *   CR 701.20e, 202.3, 608.2c      "Reveal the top X cards ... put any number of permanent cards with mana value X or less from among them onto the battlefield ...
 *                                  all cards revealed this way that weren't put onto the battlefield into your graveyard"
 *   CR 601.3, 609.4b, 305.1        "Until end of turn, you may cast spells from among those cards, and mana of any type can be spent to cast those spells."
 *   CR 116.2m, 709.5e, 118.7       "Unlock costs you pay cost {1} less." (the unlock cost of a door of a Room)
 *   CR 702.167c, 607.2a            "... equal to the mana value of the exiled card used to craft it."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, life, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { yes?: boolean[]; targets?: ({ kind: 'object'; id: ObjectId } | { kind: 'player'; id: string })[][]; objects?: ObjectId[][]; x?: number[] }
/** Answer the decisions of a cast or a resolution in order of kind; payment is automatic. Stops at the next priority decision. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])], x: [...(script.x ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.x.shift() ?? p.min });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });
const named = (s: GameState, name: string, zone: 'battlefield' | 'exile' = 'battlefield'): ObjectId[] => s.zones[zone].filter((id) => s.objects[id]!.defId === name);
const inGraveyard = (s: GameState, name: string, owner: string): boolean => s.zones.graveyard[owner]!.some((id) => s.objects[id]!.defId === name);
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id); return `${c.power}/${c.toughness}`; };
const setLife = (s: GameState, player: string, n: number): void => { s.players.find((p) => p.id === player)!.life = n; };

// ---- Elenda's shape: one paragraph, two conditional statics ---------------------------------------------------------------------------------------------------

const PALADIN = card('Test Paladin', 'Creature — Knight', 'As long as your life total is greater than your starting life total, ~ gets +1/+1 and has trample. ~ gets an additional +3/+3 as long as your life total is at least 6 greater than your starting life total.', '{2}', ['2', '2']);

describe('CR 113.1, 604.1, 611.3a, 103.4: a paragraph of two conditional statics is one static ability per sentence, each with its own condition', () => {
  it('is automated, as two static abilities', () => {
    expect(full(PALADIN)).toBe(true);
    expect(PALADIN.faces[0]!.abilities.filter((a) => a.kind === 'static')).toHaveLength(2);
  });
  it('at the starting life total neither applies (2/2); one life above, the first (3/3 with trample); 5 above, still the first; 6 above, both (6/6)', () => {
    const s = scenario([], { defs: [PALADIN], p1: { battlefield: ['Test Paladin'] } });
    const id = find(s, 'Test Paladin', 'battlefield', 'p1');
    expect(life(s, 'p1')).toBe(20);
    expect(pt(s, id)).toBe('2/2');
    setLife(s, 'p1', 21);
    expect(pt(s, id)).toBe('3/3');
    expect(hasKeyword(getChars(s, id), 'trample')).toBe(true);
    setLife(s, 'p1', 25);
    expect(pt(s, id)).toBe('3/3');
    setLife(s, 'p1', 26);
    expect(pt(s, id)).toBe('6/6');
    setLife(s, 'p1', 19);
    expect(pt(s, id)).toBe('2/2');
    expect(hasKeyword(getChars(s, id), 'trample')).toBe(false);
  });
  it('CR 103.4: the starting life total of the game is the base (a 40-life game: 41 life is one above, 45 is not yet 6 above)', () => {
    const s = scenario([], { defs: [PALADIN], life: 40, p1: { battlefield: ['Test Paladin'] } });
    const id = find(s, 'Test Paladin', 'battlefield', 'p1');
    setLife(s, 'p1', 45);
    expect(pt(s, id)).toBe('3/3');
    setLife(s, 'p1', 46);
    expect(pt(s, id)).toBe('6/6');
  });
  it('CR 611.3a: the opponent\'s life total is no part of it', () => {
    const s = scenario([], { defs: [PALADIN], p1: { battlefield: ['Test Paladin'] } });
    const id = find(s, 'Test Paladin', 'battlefield', 'p1');
    setLife(s, 'p2', 30);
    expect(pt(s, id)).toBe('2/2');
  });
});

// ---- Brave the Wilds' shape -----------------------------------------------------------------------------------------------------------------------------------

const GROWTH = card('Test Growth', 'Sorcery', 'Bargain\nIf this spell was bargained, target land you control becomes a 2/2 Insect creature with reach that\'s still a land.\nYou gain 1 life.');
const TRINKET = card('Test Trinket', 'Artifact', '');

describe('CR 702.166, 205.1b, 611.2a: "target land you control becomes a 2/2 Insect creature with reach that\'s still a land" when the spell was bargained', () => {
  it('is automated', () => expect(full(GROWTH)).toBe(true));
  it('bargained: the land is a 2/2 Insect creature with reach and still a land (no end: it lasts), and the rest of the spell happens', () => {
    let s = scenario([], { defs: [GROWTH, TRINKET], p1: { hand: ['Test Growth'], battlefield: ['Plains', 'Test Trinket'] } });
    const land = find(s, 'Plains', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Growth', { yes: [true], targets: [[obj(land)]], objects: [[find(s, 'Test Trinket', 'battlefield', 'p1')]] }));
    const c = getChars(s, land);
    expect(c.types).toContain('Land');
    expect(c.types).toContain('Creature');
    expect(c.subtypes).toContain('Insect');
    expect(c.subtypes).toContain('Plains');
    expect(pt(s, land)).toBe('2/2');
    expect(hasKeyword(getChars(s, land), 'reach')).toBe(true);
    expect(life(s, 'p1')).toBe(21);
    // it lasts through the turn and the next
    for (let i = 0; i < 2 && s.turn.number < 3; i++) s = passBoth(s);
    expect(getChars(s, land).types).toContain('Creature');
  });
  it('not bargained: no target is asked for, the land stays a land, and the rest of the spell still happens', () => {
    let s = scenario([], { defs: [GROWTH, TRINKET], p1: { hand: ['Test Growth'], battlefield: ['Plains', 'Test Trinket'] } });
    const land = find(s, 'Plains', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Growth', { yes: [false] }));
    expect(getChars(s, land).types).not.toContain('Creature');
    expect(life(s, 'p1')).toBe(21);
  });
});

// ---- Genesis Wave's shape -------------------------------------------------------------------------------------------------------------------------------------

const SURGE = card('Test Surge', 'Sorcery', "Reveal the top X cards of your library. You may put any number of permanent cards with mana value X or less from among them onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield into your graveyard. You gain 1 life.", '{X}');
const CUB = card('Test Cub', 'Creature — Bear', '', '{2}', ['2', '2']);
const TITAN = card('Test Titan', 'Creature — Giant', '', '{5}', ['6', '6']);
const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.', '{1}');
const SURGE_DEFS = [SURGE, CUB, TITAN, ZAP];

describe('CR 701.20e, 202.3, 608.2c: "put any number of permanent cards with mana value X or less from among them onto the battlefield ... all cards revealed this way that weren\'t put onto the battlefield into your graveyard"', () => {
  it('is automated', () => expect(full(SURGE)).toBe(true));
  it('X = 3 reveals three cards: the Cub (mana value 2) can be put onto the battlefield; the Titan (5, too high) and the Zap (not a permanent card) go to the graveyard with nothing else', () => {
    let s = scenario([], { defs: SURGE_DEFS, p1: { hand: ['Test Surge'], battlefield: ['Plains', 'Plains', 'Plains'], library: ['Test Cub', 'Test Titan', 'Test Zap', 'Test Cub'] } });
    s = resolveAll(cast(s, 'Test Surge', { x: [3] }), { yes: [true], objects: [[find(s, 'Test Cub', 'library', 'p1')]] });
    expect(named(s, 'Test Cub')).toHaveLength(1);
    expect(inGraveyard(s, 'Test Titan', 'p1')).toBe(true);
    expect(inGraveyard(s, 'Test Zap', 'p1')).toBe(true);
    expect(inGraveyard(s, 'Test Cub', 'p1')).toBe(false);
    // the fourth card was never revealed: still on top of the library
    expect(s.zones.library.p1!.some((id) => s.objects[id]!.defId === 'Test Cub')).toBe(true);
    expect(life(s, 'p1')).toBe(21);
  });
  it('choosing none: every revealed card, the Cub too, goes to the graveyard', () => {
    let s = scenario([], { defs: SURGE_DEFS, p1: { hand: ['Test Surge'], battlefield: ['Plains', 'Plains', 'Plains'], library: ['Test Cub', 'Test Titan', 'Test Zap'] } });
    s = resolveAll(cast(s, 'Test Surge', { x: [3] }), { yes: [true], objects: [[]] });
    expect(named(s, 'Test Cub')).toHaveLength(0);
    expect(inGraveyard(s, 'Test Cub', 'p1')).toBe(true);
    expect(inGraveyard(s, 'Test Titan', 'p1')).toBe(true);
  });
  it('X = 5: the Titan (mana value 5) is now allowed', () => {
    let s = scenario([], { defs: SURGE_DEFS, p1: { hand: ['Test Surge'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'], library: ['Test Titan', 'Test Zap', 'Test Cub', 'Test Cub', 'Test Cub'] } });
    s = resolveAll(cast(s, 'Test Surge', { x: [5] }), { yes: [true], objects: [[find(s, 'Test Titan', 'library', 'p1')]] });
    expect(named(s, 'Test Titan')).toHaveLength(1);
  });
});

// ---- Laughing Jasper Flint's shape ----------------------------------------------------------------------------------------------------------------------------

const BANDIT = card('Test Bandit', 'Creature — Rogue', '{0}: Exile the top two cards of target opponent\'s library. Until end of turn, you may cast spells from among those cards, and mana of any type can be spent to cast those spells.', '{1}', ['1', '1']);
const WRAITH = card('Test Wraith', 'Creature — Spirit', '', '{B}{B}', ['2', '2']);
const FIELD = card('Test Field', 'Land', '');
const BANDIT_DEFS = [BANDIT, WRAITH, FIELD];

describe('CR 601.3, 609.4b, 305.1: "Until end of turn, you may cast spells from among those cards, and mana of any type can be spent to cast those spells"', () => {
  it('is automated', () => expect(full(BANDIT)).toBe(true));
  it('the exiled creature spell can be cast with white mana alone; the exiled land card is no spell and cannot', () => {
    const s0 = scenario([], { defs: BANDIT_DEFS, p1: { battlefield: ['Test Bandit', 'Plains', 'Plains'] }, p2: { library: ['Test Wraith', 'Test Field'] } });
    const [ability] = legal(s0, 'p1', 'activate').filter((a) => a.object === find(s0, 'Test Bandit', 'battlefield', 'p1') && !a.isMana);
    expect(ability).toBeDefined();
    const s = resolveAll(drive(act(s0, ability!.action), { targets: [[{ kind: 'player', id: 'p2' }]] }), {});
    const exiled = s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2');
    expect(exiled).toHaveLength(2);
    const wraith = exiled.find((id) => s.objects[id]!.defId === 'Test Wraith')!;
    const field = exiled.find((id) => s.objects[id]!.defId === 'Test Field')!;
    const castable = legal(s, 'p1', 'cast').map((a) => a.object);
    expect(castable).toContain(wraith);
    expect(castable).not.toContain(field);
  });
});

// ---- Inquisitive Glimmer's shape ------------------------------------------------------------------------------------------------------------------------------

const ROOM = compileCard({
  name: 'Test Hall // Test Stair', layout: 'split', type_line: 'Enchantment — Room // Enchantment — Room', mana_cost: '{2}{W} // {3}{U}', colors: [],
  card_faces: [
    { name: 'Test Hall', type_line: 'Enchantment — Room', mana_cost: '{2}{W}', oracle_text: '' },
    { name: 'Test Stair', type_line: 'Enchantment — Room', mana_cost: '{3}{U}', oracle_text: '' },
  ],
} as unknown as OracleCard);
const FOX = card('Test Fox', 'Creature — Fox', 'Unlock costs you pay cost {1} less.', '{1}', ['1', '1']);

describe('CR 116.2m, 709.5e, 118.7: "Unlock costs you pay cost {1} less." (the unlock special action of a door of a Room)', () => {
  it('is automated', () => expect(full(FOX)).toBe(true));
  const unlocks = (s: GameState) => legal(s, 'p1', 'special').filter((a) => a.label.startsWith('Unlock'));
  it('with the Fox, the left door ({2}{W}) is unlocked for {1}{W}: offered with two lands, and paying two lands unlocks it', () => {
    const s0 = scenario([], { defs: [ROOM, FOX], p1: { battlefield: ['Test Hall // Test Stair', 'Test Fox', 'Plains', 'Plains'] } });
    const offered = unlocks(s0);
    expect(offered.map((a) => a.label)).toEqual(['Unlock Test Hall ({1}{W})']);
    const s = drive(act(s0, offered[0]!.action));
    const room = find(s, 'Test Hall // Test Stair', 'battlefield', 'p1');
    expect(s.objects[room]!.unlocked).toEqual([0]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(2);
  });
  it('without the Fox the same two lands cannot pay {2}{W}; the opponent\'s Fox changes nothing for you', () => {
    const s = scenario([], { defs: [ROOM, FOX], p1: { battlefield: ['Test Hall // Test Stair', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Fox'] } });
    expect(unlocks(s)).toEqual([]);
  });
  it('the reduction never goes below {0} and takes generic mana only: a {3}{U} door costs {2}{U} with the Fox (three lands pay it, two do not)', () => {
    const two = scenario(['Island'], { defs: [ROOM, FOX], p1: { battlefield: ['Test Hall // Test Stair', 'Test Fox', 'Island', 'Island'] } });
    expect(unlocks(two)).toEqual([]);
    const three = scenario(['Island'], { defs: [ROOM, FOX], p1: { battlefield: ['Test Hall // Test Stair', 'Test Fox', 'Island', 'Island', 'Island'] } });
    expect(unlocks(three).map((a) => a.label)).toEqual(['Unlock Test Stair ({2}{U})']);
  });
});

// ---- Jadeheart Attendant's shape ------------------------------------------------------------------------------------------------------------------------------

const RELIC = compileCard({
  name: 'Test Relic // Test Golem', layout: 'transform', mana_cost: '', type_line: 'Artifact // Artifact Creature — Golem', oracle_text: '', colors: [], keywords: [],
  card_faces: [
    { name: 'Test Relic', mana_cost: '{1}', type_line: 'Artifact', oracle_text: "Craft with creature {0} ({0}, Exile this artifact, Exile a creature you control or a creature card from your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)" },
    { name: 'Test Golem', mana_cost: '', type_line: 'Artifact Creature — Golem', oracle_text: 'When this creature enters, you gain life equal to the mana value of the exiled card used to craft it.', power: '3', toughness: '3' },
  ],
} as unknown as OracleCard);
const HOUND = card('Test Hound', 'Creature — Dog', '', '{3}', ['3', '3']);
const KITTEN = card('Test Kitten', 'Creature — Cat', '', '{1}', ['1', '1']);

describe('CR 702.167c, 607.2a: "you gain life equal to the mana value of the exiled card used to craft it"', () => {
  it('is automated on both faces', () => expect(RELIC.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))).toBe(true));
  it('crafting with a creature of mana value 3 gains 3 life; with a creature card of mana value 1 from the graveyard, 1 life', () => {
    for (const [zone, name, gain] of [['battlefield', 'Test Hound', 3], ['graveyard', 'Test Kitten', 1]] as const) {
      const s0 = scenario([], { defs: [RELIC, HOUND, KITTEN], p1: { battlefield: ['Test Relic // Test Golem', ...(zone === 'battlefield' ? [name] : [])], graveyard: zone === 'graveyard' ? [name] : [] } });
      const [craft] = legal(s0, 'p1', 'activate').filter((a) => a.object === find(s0, 'Test Relic // Test Golem', 'battlefield', 'p1') && !a.isMana);
      expect(craft, name).toBeDefined();
      const s = resolveAll(drive(act(s0, craft!.action)));
      expect(life(s, 'p1'), name).toBe(20 + gain);
      expect(named(s, 'Test Relic // Test Golem')).toHaveLength(1);
    }
  });
});
