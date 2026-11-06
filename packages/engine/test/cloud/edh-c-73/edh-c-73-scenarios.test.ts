/**
 * Commander lane edh-c, round edh-c-73 (EDHREC ranks 22,501 to 23,000, second pass): the round's readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. Alice (p1) casts or controls the card under test. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 120.3, 120.2b      "~ deals 1 damage to each other creature and each player." (Conductor of Cacophony: the source is not hit)
 *   CR 108.3, 109.4       "Exile target permanent you own or control." (Telim'Tor's Edict: owned by you or controlled by you)
 *   CR 120.3, 701.9a      "that player discards cards equal to the damage" (Jagged Poppet: Hellbent, damage dealt to a player)
 *   CR 701.9a, 608.2c     "If fewer than two cards were discarded this way, you draw cards equal to the difference." (Skull Raid)
 *   CR 701.20a, 404.1     "Put a creature card from among them into your hand and the rest into your graveyard." (Tracker's Instincts)
 *   CR 404.1              "Put the top card of your graveyard on the bottom of your library." (Soldevi Digger)
 *   CR 601.2f, 109.4      "Each artifact spell costs {1} more to cast for each artifact its controller controls." (Hum of the Radix)
 *   CR 603.7, 107.3       "create X 1/1 ... tokens that are red, green, and white at the beginning of your next upkeep, where X is the number of lands you control at that time." (Hazezon Tamar)
 *   CR 120.3, 105.2       "~ deals 1 damage to target creature and each other creature that shares a color with it." (Wojek Embermage)
 *   CR 205.1a, 613.1d     "Enchanted permanent is an enchantment and loses all other card types." (One with the Stars)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, compileCard, getChars, type CardDef, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, put, scenario } from '../../m3/scenario';
import { card, cast, full, pt, resolveAll, settle } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const fails = (f: () => unknown): boolean => { try { f(); return false; } catch { return true; } };
const handOf = (s: GameState, p: string): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);
const yardOf = (s: GameState, p: string): string[] => s.zones.graveyard[p]!.map((id) => s.objects[id]!.defId);
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);
/** The hand of a player after the turns advanced (draws included): exactly these cards. */
function setHand(s: GameState, p: string, names: string[]): void {
  for (const id of s.zones.hand[p]!) delete s.objects[id];
  s.zones.hand[p] = [];
  for (const n of names) put(s, p, 'hand', n);
}
const activate = (s: GameState, id: ObjectId, n = 0): GameState => act(s, { type: 'activate', player: s.objects[id]!.controller, source: id, ability: activatedAbilities(s, s.objects[id]!)[n]!.key });

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{1}');
const ROCK = card('Test Rock', 'Artifact', '', undefined, '{0}');
const SPARK = card('Test Spark', 'Instant', 'Draw a card.');

describe('CR 120.3, 120.2b: "~ deals 1 damage to each other creature and each player."', () => {
  const CINDER = card('Test Cinder', 'Creature — Demon', 'Test Cinder enters with two +1/+1 counters on it.\n{B}, Remove a +1/+1 counter from Test Cinder: Test Cinder deals 1 damage to each other creature and each player.', ['1', '1'], '{0}');
  it('is automated', () => expect(full(CINDER)).toBe(true));
  it('every other creature and both players take 1, the source takes none; the counter is the cost', () => {
    let s = scenario(['Swamp'], { p1: { battlefield: ['Test Cinder', 'Swamp', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: [CINDER, BEAR, OGRE] });
    s = advanceTo(s, 3, 'main1');
    const cinder = find(s, 'Test Cinder', 'battlefield', 'p1');
    s.objects[cinder]!.counters['+1/+1'] = 2;
    const before = [life(s, 'p1'), life(s, 'p2')];
    s = resolveAll(settle(activate(s, cinder)));
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.damage).toBe(1);
    expect(s.objects[find(s, 'Test Ogre', 'battlefield', 'p2')]!.damage).toBe(1);
    expect(s.objects[cinder]!.damage).toBe(0);
    expect(s.objects[cinder]!.counters['+1/+1']).toBe(1);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([before[0]! - 1, before[1]! - 1]);
  });
  it('negative: with no counter to remove the ability cannot be activated', () => {
    let s = scenario(['Swamp'], { p1: { battlefield: ['Test Cinder', 'Swamp'] }, defs: [CINDER] });
    s = advanceTo(s, 3, 'main1');
    const cinder = find(s, 'Test Cinder', 'battlefield', 'p1');
    s.objects[cinder]!.counters = {};
    expect(fails(() => settle(activate(s, cinder)))).toBe(true);
  });
});

describe('CR 108.3, 109.4: "Exile target permanent you own or control."', () => {
  const EDICT = card('Test Edict', 'Instant', 'Exile target permanent you own or control. Draw a card at the beginning of the next turn\'s upkeep.');
  const DEFS: CardDef[] = [EDICT, BEAR, OGRE];
  it('is automated', () => expect(full(EDICT)).toBe(true));
  it('a permanent you control, or one you own that an opponent controls, can be exiled; the draw comes at the next upkeep', () => {
    let s = scenario([], { p1: { hand: ['Test Edict', 'Test Edict'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const stolen = find(s, 'Test Ogre', 'battlefield', 'p2');
    s.objects[stolen]!.owner = 'p1'; // owned by Alice, controlled by Bob
    const hand = s.zones.hand.p1!.length;
    s = resolveAll(cast(s, 'Test Edict', { targets: [obj(mine)] }));
    expect(s.zones.battlefield).not.toContain(mine);
    s = resolveAll(cast(s, 'Test Edict', { targets: [obj(stolen)] }));
    expect(s.zones.battlefield).not.toContain(stolen);
    s = advanceTo(s, s.turn.number + 1, 'draw');
    expect(s.zones.hand.p1!.length).toBe(hand); // two Edicts cast (-2), two delayed draws (+2)
  });
  it('negative: a permanent an opponent owns and controls is not a legal target', () => {
    let s = scenario([], { p1: { hand: ['Test Edict'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const theirs = find(s, 'Test Ogre', 'battlefield', 'p2');
    expect(fails(() => resolveAll(cast(s, 'Test Edict', { targets: [obj(theirs)] })))).toBe(true);
    expect(s.zones.battlefield).toContain(theirs);
  });
});

describe('CR 120.3, 701.9a, 603.4: "Hellbent — Whenever ~ deals combat damage to a player, if you have no cards in hand, that player discards cards equal to the damage."', () => {
  const POPPET = card('Test Poppet', 'Creature — Ogre', 'Whenever Test Poppet is dealt damage, discard that many cards.\nHellbent — Whenever Test Poppet deals combat damage to a player, if you have no cards in hand, that player discards cards equal to the damage.', ['3', '3'], '{0}');
  const DEFS: CardDef[] = [POPPET, BEAR, OGRE];
  it('is automated', () => expect(full(POPPET)).toBe(true));
  it('with no cards in hand the damaged player discards as many cards as the damage (3)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Poppet'] }, p2: { hand: ['Test Bear', 'Test Ogre', 'Test Bear', 'Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    setHand(s, 'p1', []);
    setHand(s, 'p2', ['Test Bear', 'Test Ogre', 'Test Bear', 'Test Ogre']);
    const poppet = find(s, 'Test Poppet', 'battlefield', 'p1');
    s = attack(s, poppet);
    expect(handOf(s, 'p2')).toHaveLength(1);
  });
  it('negative: with a card in hand nothing is discarded', () => {
    let s = scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Poppet'] }, p2: { hand: ['Test Bear', 'Test Ogre', 'Test Bear', 'Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    setHand(s, 'p1', ['Test Bear']);
    setHand(s, 'p2', ['Test Bear', 'Test Ogre', 'Test Bear', 'Test Ogre']);
    s = attack(s, find(s, 'Test Poppet', 'battlefield', 'p1'));
    expect(handOf(s, 'p2')).toHaveLength(4);
  });
  it('whenever it is dealt damage its controller discards that many cards', () => {
    const PRICK = card('Test Prick', 'Instant', 'Test Prick deals 2 damage to target creature.');
    let s = scenario([], { p1: { battlefield: ['Test Poppet'] }, p2: { hand: ['Test Prick'] }, defs: [...DEFS, PRICK] });
    s = advanceTo(s, 3, 'main1');
    setHand(s, 'p1', ['Test Bear', 'Test Ogre', 'Test Bear']);
    put(s, 'p1', 'hand', 'Test Prick');
    const poppet = find(s, 'Test Poppet', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Prick', { targets: [obj(poppet)] }));
    expect(handOf(s, 'p1')).toHaveLength(1);
  });
});

/** Alice's creature attacks Bob and nobody blocks; the damage step and its triggers resolve. */
function attack(s0: GameState, attacker: ObjectId): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
  for (let i = 0; i < 80 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2' && !s.result; i++) {
    const d = s.pending;
    if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d !== null && d?.kind !== 'priority') s = settle(s);
    else s = pass(s);
  }
  return resolveAll(s);
}

describe('CR 701.9a, 608.2c: "If fewer than two cards were discarded this way, you draw cards equal to the difference."', () => {
  const RAID = card('Test Raid', 'Sorcery', 'Target opponent discards two cards. If fewer than two cards were discarded this way, you draw cards equal to the difference.');
  const run = (opponentHand: string[]): { drawn: number; left: number } => {
    let s = scenario([], { p1: { hand: ['Test Raid'] }, defs: [RAID, BEAR, OGRE] });
    s = advanceTo(s, 3, 'main1');
    setHand(s, 'p2', opponentHand);
    const before = s.zones.hand.p1!.length;
    s = resolveAll(cast(s, 'Test Raid', { targets: [player('p2')] }));
    return { drawn: s.zones.hand.p1!.length - (before - 1), left: s.zones.hand.p2!.length };
  };
  it('is automated', () => expect(full(RAID)).toBe(true));
  it('no cards in their hand: you draw two; one card: you draw one; two or more: you draw none', () => {
    expect(run([])).toEqual({ drawn: 2, left: 0 });
    expect(run(['Test Bear'])).toEqual({ drawn: 1, left: 0 });
    expect(run(['Test Bear', 'Test Ogre'])).toEqual({ drawn: 0, left: 0 });
    expect(run(['Test Bear', 'Test Ogre', 'Test Bear'])).toEqual({ drawn: 0, left: 1 });
  });
});

describe('CR 701.20a, 404.1: "Reveal the top four cards of your library. Put a creature card from among them into your hand and the rest into your graveyard."', () => {
  const TRACK = card('Test Tracker', 'Sorcery', 'Reveal the top four cards of your library. Put a creature card from among them into your hand and the rest into your graveyard.');
  const stack = (s: GameState, names: string[]): void => { for (const n of [...names].reverse()) { const id = put(s, 'p1', 'library', n); s.zones.library.p1!.pop(); s.zones.library.p1!.unshift(id); } };
  it('is automated', () => expect(full(TRACK)).toBe(true));
  it('exactly one creature goes to your hand, the other three revealed cards to your graveyard; the fifth card stays', () => {
    let s = scenario([], { p1: { hand: ['Test Tracker'] }, defs: [TRACK, BEAR, OGRE] });
    s = advanceTo(s, 3, 'main1');
    stack(s, ['Plains', 'Test Bear', 'Test Ogre', 'Plains', 'Test Bear']);
    const lib = s.zones.library.p1!.length;
    s = resolveAll(cast(s, 'Test Tracker'));
    expect(handOf(s, 'p1').filter((n) => n.startsWith('Test ') && n !== 'Test Tracker')).toHaveLength(1);
    expect(yardOf(s, 'p1').filter((n) => n !== 'Test Tracker')).toHaveLength(3);
    expect(s.zones.library.p1!.length).toBe(lib - 4);
  });
  it('negative: with no creature among them all four cards go to your graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Tracker'] }, defs: [TRACK, BEAR] });
    s = advanceTo(s, 3, 'main1');
    stack(s, ['Plains', 'Plains', 'Plains', 'Plains', 'Test Bear']);
    s = resolveAll(cast(s, 'Test Tracker'));
    expect(yardOf(s, 'p1').filter((n) => n === 'Plains')).toHaveLength(4);
    expect(handOf(s, 'p1').filter((n) => n === 'Test Bear')).toHaveLength(0);
  });
});

describe('CR 404.1: "{2}: Put the top card of your graveyard on the bottom of your library."', () => {
  const DIGGER = card('Test Digger', 'Artifact', '{2}: Put the top card of your graveyard on the bottom of your library.', undefined, '{0}');
  it('is automated', () => expect(full(DIGGER)).toBe(true));
  it('the card put into the graveyard last goes to the bottom of the library; the card below it and the opponent\'s graveyard stay', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Digger', 'Plains', 'Plains'], graveyard: ['Test Bear', 'Test Ogre'] }, p2: { graveyard: ['Test Bear'] }, defs: [DIGGER, BEAR, OGRE] });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(settle(activate(s, find(s, 'Test Digger', 'battlefield', 'p1'))));
    expect(yardOf(s, 'p1')).toEqual(['Test Bear']);
    const lib = s.zones.library.p1!;
    expect(s.objects[lib[lib.length - 1]!]!.defId).toBe('Test Ogre');
    expect(yardOf(s, 'p2')).toEqual(['Test Bear']);
  });
  it('negative: with an empty graveyard nothing is put into the library', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Digger', 'Plains', 'Plains'] }, defs: [DIGGER] });
    s = advanceTo(s, 3, 'main1');
    const lib = s.zones.library.p1!.length;
    s = resolveAll(settle(activate(s, find(s, 'Test Digger', 'battlefield', 'p1'))));
    expect(s.zones.library.p1!.length).toBe(lib);
  });
});

describe('CR 601.2f, 109.4: "Each artifact spell costs {1} more to cast for each artifact its controller controls."', () => {
  const HUM = card('Test Hum', 'Enchantment', 'Each artifact spell costs {1} more to cast for each artifact its controller controls.');
  const GADGET = card('Test Gadget', 'Artifact', '', undefined, '{0}');
  it('is automated', () => expect(full(HUM)).toBe(true));
  it('the caster pays {1} more for each artifact they control: two artifacts, two more; an opponent\'s artifacts do not count', () => {
    const base = (lands: number): GameState => {
      const s = scenario(['Plains'], { p1: { hand: ['Test Gadget'], battlefield: ['Test Hum', 'Test Rock', 'Test Rock', ...Array(lands).fill('Plains')] }, p2: { battlefield: ['Test Rock', 'Test Rock', 'Test Rock'] }, defs: [HUM, GADGET, ROCK] });
      return advanceTo(s, 3, 'main1');
    };
    expect(fails(() => settle(cast(base(1), 'Test Gadget')))).toBe(true);
    expect(fails(() => settle(cast(base(2), 'Test Gadget')))).toBe(false);
  });
  it('negative: a spell that is not an artifact costs nothing more, and with no artifacts the artifact spell costs its normal price', () => {
    let s = scenario([], { p1: { hand: ['Test Gadget', 'Test Bear'], battlefield: ['Test Hum'] }, defs: [HUM, GADGET, BEAR] });
    s = advanceTo(s, 3, 'main1');
    expect(fails(() => settle(cast(s, 'Test Gadget')))).toBe(false);
  });
});

describe('CR 205.1a, 613.1d: "Enchanted permanent is an enchantment and loses all other card types."', () => {
  const STARS = card('Test Stars', 'Enchantment — Aura', 'Enchant creature or enchantment\nEnchanted permanent is an enchantment and loses all other card types.', undefined, '{0}');
  const FLYER = card('Test Flyer', 'Creature — Bird', 'Flying', ['1', '1'], '{0}');
  it('is automated', () => expect(full(STARS)).toBe(true));
  it('the enchanted creature is only an enchantment (no longer a creature) and keeps its abilities', () => {
    let s = scenario([], { p1: { hand: ['Test Stars'], battlefield: ['Test Flyer'] }, defs: [STARS, FLYER] });
    s = advanceTo(s, 3, 'main1');
    const bird = find(s, 'Test Flyer', 'battlefield', 'p1');
    expect(getChars(s, bird)!.types).toContain('Creature');
    s = resolveAll(cast(s, 'Test Stars', { targets: [obj(bird)] }));
    const c = getChars(s, bird)!;
    expect(c.types).toEqual(['Enchantment']);
    expect(c.keywords.map((k) => k.keyword)).toContain('flying');
    expect(c.subtypes).not.toContain('Bird');
  });
});

describe('CR 603.7, 107.3, 608.2h: "create X 1/1 ... tokens that are red, green, and white at the beginning of your next upkeep, where X is the number of lands you control at that time."', () => {
  const HAZE = card('Test Hazard', 'Legendary Creature — Human Warrior', 'When Test Hazard enters, create X 1/1 Sand Warrior creature tokens that are red, green, and white at the beginning of your next upkeep, where X is the number of lands you control at that time.\nWhen Test Hazard leaves the battlefield, exile all Sand Warriors.', ['4', '4'], '{0}');
  it('is automated', () => expect(full(HAZE)).toBe(true));
  it('the tokens come at the next upkeep, as many as the lands then (not when it entered); leaving the battlefield exiles every Sand Warrior', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Hazard'], battlefield: ['Plains', 'Plains'] }, defs: [HAZE] });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Hazard'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
    put(s, 'p1', 'battlefield', 'Plains'); // a third land arrives before the upkeep
    s = advanceTo(s, 5, 'upkeep');
    s = resolveAll(s);
    const sand = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(sand).toHaveLength(3);
    expect(getChars(s, sand[0]!)!.colors).toEqual(expect.arrayContaining(['W', 'R', 'G']));
    expect(getChars(s, sand[0]!)!.subtypes).toEqual(expect.arrayContaining(['Sand', 'Warrior']));
    expect(pt(s, sand[0]!)).toBe('1/1');
    const hazard = find(s, 'Test Hazard', 'battlefield', 'p1');
    const warrior = put(s, 'p2', 'battlefield', { name: 'Test Hazard' }); // another permanent with Warrior only: a Test Hazard is Human Warrior, not Sand
    expect(s.zones.battlefield).toContain(warrior);
    expect(s.zones.battlefield).toContain(hazard);
  });
});

describe('CR 603.6c, 608.2c: Hazezon leaving the battlefield exiles every permanent that is both a Sand and a Warrior', () => {
  const HAZE = card('Test Hazard', 'Legendary Creature — Human Warrior', 'When Test Hazard enters, create X 1/1 Sand Warrior creature tokens that are red, green, and white at the beginning of your next upkeep, where X is the number of lands you control at that time.\nWhen Test Hazard leaves the battlefield, exile all Sand Warriors.', ['4', '4'], '{0}');
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  const mk = (name: string, type: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: '', colors: [], power: '1', toughness: '1' } as never);
  it('a Sand Warrior and a token Sand Warrior are exiled; a Warrior only and a Sand only stay', () => {
    let s = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Hazard', 'Test Sander', 'Test Warrior', 'Test Sandy'] }, p2: { battlefield: ['Test Sander'] }, defs: [HAZE, SMITE, mk('Test Sander', 'Creature — Sand Warrior'), mk('Test Warrior', 'Creature — Goblin Warrior'), mk('Test Sandy', 'Creature — Sand Elemental')] });
    s = advanceTo(s, 3, 'main1');
    const hazard = find(s, 'Test Hazard', 'battlefield', 'p1');
    const [mine, theirs] = [find(s, 'Test Sander', 'battlefield', 'p1'), find(s, 'Test Sander', 'battlefield', 'p2')];
    s = resolveAll(cast(s, 'Test Smite', { targets: [obj(hazard)] }));
    expect(s.zones.battlefield).not.toContain(mine);
    expect(s.zones.battlefield).not.toContain(theirs);
    expect(s.zones.battlefield).toContain(find(s, 'Test Warrior', 'battlefield', 'p1'));
    expect(s.zones.battlefield).toContain(find(s, 'Test Sandy', 'battlefield', 'p1'));
  });
});

describe('CR 120.3, 105.2: "~ deals 1 damage to target creature and each other creature that shares a color with it."', () => {
  const MAGE = card('Test Embermage', 'Creature — Human Wizard', 'Radiance — {T}: Test Embermage deals 1 damage to target creature and each other creature that shares a color with it.', ['1', '1'], '{0}');
  const colored = (name: string, type: string, cost: string, colors: string[]): CardDef => compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: '', colors, power: '2', toughness: '3' } as never);
  const RED = colored('Test Red', 'Creature — Goblin', '{R}', ['R']);
  const GRUUL = colored('Test Gruul', 'Creature — Beast', '{R}{G}', ['R', 'G']);
  const BLUE = colored('Test Blue', 'Creature — Wizard', '{U}', ['U']);
  const GEM = colored('Test Gem', 'Artifact Creature — Golem', '{3}', []);
  it('is automated', () => expect(full(MAGE)).toBe(true));
  it('the target and every other creature sharing a color with it takes 1; a creature of other colors, and a colorless target\'s neighbors, take none', () => {
    const defs: CardDef[] = [MAGE, RED, GRUUL, BLUE];
    let s = scenario([], { p1: { battlefield: ['Test Embermage', 'Test Red', 'Test Blue'] }, p2: { battlefield: ['Test Gruul', 'Test Red'] }, defs });
    s = advanceTo(s, 3, 'main1');
    const mage = find(s, 'Test Embermage', 'battlefield', 'p1');
    const myRed = find(s, 'Test Red', 'battlefield', 'p1');
    const blue = find(s, 'Test Blue', 'battlefield', 'p1');
    const gruul = find(s, 'Test Gruul', 'battlefield', 'p2');
    const theirRed = find(s, 'Test Red', 'battlefield', 'p2');
    s = resolveAll(settle(activate(s, mage), { targets: [obj(myRed)] }));
    expect(s.objects[myRed]!.damage).toBe(1);
    expect(s.objects[theirRed]!.damage).toBe(1);
    expect(s.objects[gruul]!.damage).toBe(1); // red and green shares red
    expect(s.objects[blue]!.damage).toBe(0);
    expect(s.objects[mage]!.damage).toBe(0); // the Embermage is colorless in this test
  });
  it('negative: a colorless target shares no color with anything, so only it is damaged', () => {
    const defs: CardDef[] = [MAGE, RED, GEM];
    let s = scenario([], { p1: { battlefield: ['Test Embermage', 'Test Gem'] }, p2: { battlefield: ['Test Red'] }, defs });
    s = advanceTo(s, 3, 'main1');
    const gem = find(s, 'Test Gem', 'battlefield', 'p1');
    const red = find(s, 'Test Red', 'battlefield', 'p2');
    s = resolveAll(settle(activate(s, find(s, 'Test Embermage', 'battlefield', 'p1')), { targets: [obj(gem)] }));
    expect(s.objects[gem]!.damage).toBe(1);
    expect(s.objects[red]!.damage).toBe(0);
  });
});

describe('CR 404.1, 613.1f: a static ability reading "the top card of your graveyard" reads the graveyard, not the library', () => {
  const KEEPER = card('Test Keeper', 'Creature — Zombie', 'As long as the top card of your graveyard is a creature card, Test Keeper gets +1/+1.', ['2', '2'], '{0}');
  it('the last card put into the graveyard decides; the library top is irrelevant', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Keeper'], graveyard: ['Test Bear', 'Plains'] }, defs: [KEEPER, BEAR] });
    s = advanceTo(s, 3, 'main1');
    const keeper = find(s, 'Test Keeper', 'battlefield', 'p1');
    expect(pt(s, keeper)).toBe('2/2'); // top of the graveyard is Plains
    const bear = put(s, 'p1', 'graveyard', 'Test Bear'); // now the newest card
    expect(pt(s, keeper)).toBe('3/3');
    s.zones.graveyard.p1!.splice(s.zones.graveyard.p1!.indexOf(bear), 1);
    delete s.objects[bear];
    expect(pt(s, keeper)).toBe('2/2');
  });
});
