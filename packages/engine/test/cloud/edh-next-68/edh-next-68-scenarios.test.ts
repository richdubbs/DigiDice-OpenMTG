/**
 * Commander lane graveyard, second round edh-next-68 (code edhn68): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites checked against the 2026-09-25 text.
 *
 *   CR 118.9, 601.2b, 601.2f, 601.3   "You may cast ~ from your graveyard by paying {3}{R} and exiling four other cards from your graveyard rather than paying its mana cost." (Squee, Dubious Monarch)
 *   CR 118.9, 601.2h                  "... by paying {B}{B} and sacrificing two creatures rather than paying its mana cost." (Scourge of Nel Toth)
 *   CR 601.2b, 118.8                  "You may cast ~ from your graveyard by exiling four instant and/or sorcery cards from your graveyard in addition to paying its other costs." (Demilich)
 *   CR 118.9, 614.1a                  "As long as you control a Giant, you may cast ~ from your graveyard by paying {U} ... If you cast ~ this way ... exile it instead." (Glimpse the Cosmos)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, scenario } from '../../m5/helpers';
import { drive, resolveAll } from '../../m5/cr-examples/helpers';
import { synthetic } from '../../m6/costs/support';

const PT = { power: '2', toughness: '2' };
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const gyCasts = (s: GameState, player: PlayerId = 'p1'): string[] =>
  legalActions(s, player).filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'graveyard').map((a) => nameOf(s, a.object!)).sort();
const inZone = (s: GameState, zone: 'graveyard' | 'exile' | 'hand', name: string, p: PlayerId = 'p1'): ObjectId[] =>
  ((zone === 'exile' ? s.zones.exile : s.zones[zone][p]) as ObjectId[]).filter((id) => nameOf(s, id) === name);
/** Casts the card from its graveyard with the way the legal actions offer (the alternative cost or the permission). */
const castFromYard = (s: GameState, name: string): GameState => {
  const a = legalActions(s, 'p1').find((x) => x.kind === 'cast' && s.objects[x.object!]?.zone === 'graveyard' && nameOf(s, x.object!) === name);
  if (a === undefined) throw new Error(`no cast of ${name} from the graveyard`);
  return drive(act(s, a.action));
};
const onField = (s: GameState, name: string, p?: PlayerId): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p));
const mana = (kind: string, n: number): string[] => Array(n).fill(kind) as string[];

const SQUIRE = synthetic('Test Squire', 'Creature — Goblin', '{4}{R}{R}', 'You may cast ~ from your graveyard by paying {3}{R} and exiling four other cards from your graveyard rather than paying its mana cost.', PT);
const SCOURGE = synthetic('Test Scourge', 'Creature — Zombie Dragon', '{5}{B}{B}', 'You may cast ~ from your graveyard by paying {B}{B} and sacrificing two creatures rather than paying its mana cost.', PT);
const LICH = synthetic('Test Lich', 'Creature — Skeleton Wizard', '{3}{U}', 'You may cast ~ from your graveyard by exiling four instant and/or sorcery cards from your graveyard in addition to paying its other costs.', PT);
const GLIMPSE = synthetic('Test Glimpse', 'Instant', '{1}{U}{U}', 'Draw a card.\nAs long as you control a Giant, you may cast ~ from your graveyard by paying {U} rather than paying its mana cost. If you cast ~ this way and it would be put into your graveyard, exile it instead.');
const GIANT = synthetic('Test Giant', 'Creature — Giant', '{3}', '', PT);
const BEAR = synthetic('Test Bear', 'Creature — Bear', '{1}', '', PT);
const BOLT = synthetic('Test Bolt', 'Instant', '{R}', 'Draw a card.');
const SORC = synthetic('Test Study', 'Sorcery', '{U}', 'Draw a card.');
const DEFS = [SQUIRE, SCOURGE, LICH, GLIMPSE, GIANT, BEAR, BOLT, SORC];

describe('edh-next-68: the readings are automated', () => {
  it('every synthetic card compiles without a manual ability', () => {
    for (const d of DEFS) expect(d.faces[0]!.abilities.filter((a) => a.kind === 'manual'), d.name).toEqual([]);
  });
});

describe('CR 118.9, 601.2b: "by paying {3}{R} and exiling four other cards from your graveyard rather than paying its mana cost"', () => {
  const start = (others: number, red = 4): GameState => scenario(['Mountain'], { p1: { battlefield: mana('Mountain', red), graveyard: ['Test Squire', ...mana('Test Bear', others)] }, defs: DEFS });
  it('offers the cast with four other cards to exile, and the cast exiles four of them and puts the card on the stack', () => {
    const s = start(4);
    expect(gyCasts(s)).toEqual(['Test Squire']);
    const t = castFromYard(s, 'Test Squire');
    expect(inZone(t, 'exile', 'Test Bear').length).toBe(4);
    expect(inZone(t, 'graveyard', 'Test Squire').length).toBe(0);
    const u = resolveAll(t);
    expect(onField(u, 'Test Squire', 'p1')).toBeDefined();
  });
  it('negative: not offered with only three other cards, or without {3}{R}', () => {
    expect(gyCasts(start(3))).toEqual([]);
    expect(gyCasts(start(4, 3))).toEqual([]);
  });
});

describe('CR 118.9, 601.2h: "by paying {B}{B} and sacrificing two creatures rather than paying its mana cost"', () => {
  const start = (creatures: number): GameState => scenario(['Swamp'], { p1: { battlefield: [...mana('Swamp', 2), ...mana('Test Bear', creatures)], graveyard: ['Test Scourge'] }, defs: DEFS });
  it('sacrifices two creatures and casts it', () => {
    const s = start(2);
    expect(gyCasts(s)).toEqual(['Test Scourge']);
    const u = resolveAll(castFromYard(s, 'Test Scourge'));
    expect(onField(u, 'Test Scourge', 'p1')).toBeDefined();
    expect(inZone(u, 'graveyard', 'Test Bear').length).toBe(2);
  });
  it('negative: not offered with only one creature to sacrifice', () => {
    expect(gyCasts(start(1))).toEqual([]);
  });
});

describe('CR 601.2b, 118.8: "by exiling four instant and/or sorcery cards from your graveyard in addition to paying its other costs"', () => {
  const start = (spells: number, bears = 0): GameState => scenario(['Island'], { p1: { battlefield: mana('Island', 4), graveyard: ['Test Lich', ...mana('Test Bolt', spells), ...mana('Test Bear', bears)] }, defs: DEFS });
  it('exiles four instant or sorcery cards and still pays the mana cost', () => {
    const s = start(4);
    expect(gyCasts(s)).toEqual(['Test Lich']);
    const t = castFromYard(s, 'Test Lich');
    expect(inZone(t, 'exile', 'Test Bolt').length).toBe(4);
    expect(onField(resolveAll(t), 'Test Lich', 'p1')).toBeDefined();
  });
  it('negative: three instants and creature cards do not make four; without the mana it is not offered', () => {
    expect(gyCasts(start(3, 3))).toEqual([]);
    const poor = scenario(['Island'], { p1: { battlefield: mana('Island', 3), graveyard: ['Test Lich', ...mana('Test Bolt', 4)] }, defs: DEFS });
    expect(gyCasts(poor)).toEqual([]);
  });
});

describe('CR 118.9, 614.1a: "As long as you control a Giant, you may cast ~ from your graveyard by paying {U} rather than paying its mana cost. ... exile it instead."', () => {
  const start = (giant: boolean): GameState => scenario(['Island'], { p1: { battlefield: [...mana('Island', 1), ...(giant ? ['Test Giant'] : [])], graveyard: ['Test Glimpse'], library: mana('Test Bear', 3) }, defs: DEFS });
  it('is offered with a Giant for {U}, and the spell is exiled instead of put into the graveyard', () => {
    const s = start(true);
    expect(gyCasts(s)).toEqual(['Test Glimpse']);
    const u = resolveAll(castFromYard(s, 'Test Glimpse'));
    expect(inZone(u, 'exile', 'Test Glimpse').length).toBe(1);
    expect(inZone(u, 'graveyard', 'Test Glimpse').length).toBe(0);
  });
  it('negative: not offered without a Giant', () => {
    expect(gyCasts(start(false))).toEqual([]);
  });
});

// ---- Oskar, Brokkos, Welcome the Dead, Solemn Doomguide, Gerrard's Hourglass Pendant -------------------------------------------------------------------------------
const OSKAR = synthetic('Test Oskar', 'Legendary Creature — Human Wizard', '{3}', 'Whenever you discard a nonland card, you may cast it from your graveyard.', PT);
const CULL = synthetic('Test Cull', 'Sorcery', '{0}', 'Discard a card.');
const BROKKOS = synthetic('Test Brokkos', 'Legendary Creature — Beast', '{5}{G}{G}', 'Mutate {1}{G}\nTrample\nYou may cast this card from your graveyard using its mutate ability.', { power: '4', toughness: '4' });
const HUMAN = synthetic('Test Human', 'Creature — Human', '{1}', '', PT);
const WELCOME = synthetic('Test Welcome', 'Sorcery', '{1}{B}', 'Draw two cards, then discard a card and you lose 2 life. Create X tapped 2/2 black Zombie Druid creature tokens, where X is the number of cards that were put into your graveyard from your hand or library this turn.');
const MILLER = synthetic('Test Miller', 'Sorcery', '{0}', 'Mill two cards.');
const DOOM = synthetic('Test Doomguide', 'Creature — Tiefling Cleric', '{2}{B}', "Each creature card in your graveyard that's a Cleric, Rogue, Warrior, and/or Wizard has unearth {1}{B}.", PT);
const CLERIC = synthetic('Test Cleric', 'Creature — Human Cleric', '{1}', '', PT);
const KNIGHT = synthetic('Test Knight', 'Creature — Human Knight', '{1}', '', PT);
const PENDANT = synthetic('Test Pendant', 'Legendary Artifact', '{3}', '{4}, {T}, Exile ~: Return to the battlefield tapped all artifact, creature, enchantment, and land cards in your graveyard that were put there from the battlefield this turn.');
const SMITE = synthetic('Test Smite', 'Instant', '{0}', 'Destroy target creature.');
const EXILER = synthetic('Test Exiler', 'Sorcery', '{0}', 'Exile target card from your graveyard.');
const DEFS2 = [EXILER, OSKAR, CULL, BROKKOS, HUMAN, WELCOME, MILLER, DOOM, CLERIC, KNIGHT, PENDANT, SMITE, BEAR];

describe('edh-next-68: the second set of readings is automated', () => {
  it('every synthetic card compiles without a manual ability', () => {
    for (const d of DEFS2) expect(d.faces[0]!.abilities.filter((a) => a.kind === 'manual'), d.name).toEqual([]);
  });
});

describe('CR 601.3, 400.7: "Whenever you discard a nonland card, you may cast it from your graveyard."', () => {
  const start = (hand: string[]): GameState => scenario(['Forest'], { p1: { battlefield: ['Test Oskar', ...mana('Forest', 3)], hand }, defs: DEFS2 });
  it('offers the discarded nonland card once the discard trigger resolves, and casting it pays its costs', () => {
    let s = start(['Test Cull', 'Test Bear']);
    s = drive(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => nameOf(s, id) === 'Test Cull')! }));
    s = resolveAll(s, [{ kind: 'yesNo', yes: true } as never]);
    expect(onField(s, 'Test Bear', 'p1')).toBeDefined(); // cast from the graveyard (it cost {1}) and resolved
    expect(inZone(s, 'graveyard', 'Test Bear').length).toBe(0);
  });
  it('negative: declining leaves the card in the graveyard', () => {
    let s = start(['Test Cull', 'Test Bear']);
    s = drive(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => nameOf(s, id) === 'Test Cull')! }));
    s = resolveAll(s, [{ kind: 'yesNo', yes: false } as never]);
    expect(onField(s, 'Test Bear', 'p1')).toBeUndefined();
    expect(inZone(s, 'graveyard', 'Test Bear').length).toBe(1);
  });
});

describe('CR 702.140a, 601.3, 113.6f: "You may cast this card from your graveyard using its mutate ability."', () => {
  const start = (target: boolean): GameState => scenario(['Forest'], { p1: { battlefield: [...mana('Forest', 4), ...(target ? ['Test Bear'] : [])], graveyard: ['Test Brokkos'] }, defs: DEFS2 });
  it('is offered with a non-Human creature to mutate onto, as the mutate method only', () => {
    const s = start(true);
    const casts = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'graveyard');
    expect(casts.map((a) => (a.action as { method?: string }).method)).toEqual(['mutate']);
  });
  it('negative: not offered for the plain mana cost (no mutate target, no mutate method)', () => {
    const s = start(false);
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'cast' && nameOf(s, a.object!) === 'Test Brokkos' && (a.action as { method?: string }).method !== 'mutate')).toEqual([]);
  });
});

describe('CR 400.7: "X is the number of cards that were put into your graveyard from your hand or library this turn"', () => {
  const start = (): GameState => scenario(['Swamp'], { p1: { battlefield: mana('Swamp', 3), hand: ['Test Welcome', 'Test Miller', 'Test Bear'], graveyard: ['Test Knight', 'Test Knight'], library: mana('Test Bear', 8) }, defs: DEFS2 });
  it('counts the milled and discarded cards, not the cards that were already there or the spell itself', () => {
    let s = start();
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => nameOf(s, id) === 'Test Miller')! })));
    const before = s.zones.battlefield.length;
    const spare = s.zones.hand.p1!.find((id) => nameOf(s, id) === 'Test Bear')!;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => nameOf(s, id) === 'Test Welcome')! })), [{ kind: 'chooseObjects', ids: [spare] } as never]);
    // the Miller itself goes to the graveyard from the stack (not from the hand or library); 2 milled + 1 discarded to the Welcome = 3 Zombies, the 2 old Knights and the Miller do not count
    expect(s.zones.battlefield.length - before).toBe(3);
  });
});

describe('CR 400.7 (review): a card that was put into your graveyard this turn and left it again still counts for Welcome the Dead', () => {
  it('counts 3 even though one milled card was exiled from the graveyard before', () => {
    let s = scenario(['Swamp'], { p1: { battlefield: mana('Swamp', 3), hand: ['Test Welcome', 'Test Miller', 'Test Exiler', 'Test Bear'], library: mana('Test Bear', 8) }, defs: DEFS2 });
    const inHand = (n: string): ObjectId => s.zones.hand.p1!.find((id) => nameOf(s, id) === n)!;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: inHand('Test Miller') })));
    const milled = s.zones.graveyard.p1!.find((id) => nameOf(s, id) === 'Test Bear')!;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: inHand('Test Exiler') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: milled }] }]));
    expect(s.zones.exile.includes(milled)).toBe(false); // a new object was made in exile
    const before = s.zones.battlefield.length;
    const spare = inHand('Test Bear');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: inHand('Test Welcome') })), [{ kind: 'chooseObjects', ids: [spare] } as never]);
    expect(s.zones.battlefield.length - before).toBe(3);
  });
});

describe('CR 702.84a: "Each creature card in your graveyard that\'s a Cleric, Rogue, Warrior, and/or Wizard has unearth {1}{B}."', () => {
  it('gives unearth to a Cleric card in the graveyard, not to a Knight card', () => {
    const s = scenario(['Swamp'], { p1: { battlefield: ['Test Doomguide', ...mana('Swamp', 2)], graveyard: ['Test Cleric', 'Test Knight'] }, defs: DEFS2 });
    const acts = legalActions(s, 'p1').filter((a) => a.kind === 'activate' && !a.isMana && s.objects[a.object!]?.zone === 'graveyard').map((a) => nameOf(s, a.object!));
    expect(acts).toEqual(['Test Cleric']);
  });
});

describe('CR 400.3, 614.1c: "Return to the battlefield tapped all artifact, creature, enchantment, and land cards in your graveyard that were put there from the battlefield this turn."', () => {
  it('returns the creature that died this turn, tapped, and leaves the one already in the graveyard', () => {
    let s = scenario(['Swamp'], { p1: { battlefield: ['Test Pendant', 'Test Bear', ...mana('Swamp', 4)], hand: ['Test Smite'], graveyard: ['Test Knight'] }, defs: DEFS2 });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => nameOf(s, id) === 'Test Smite')! }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: onField(s, 'Test Bear')! }] }]));
    expect(inZone(s, 'graveyard', 'Test Bear').length).toBe(1);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && !x.isMana && nameOf(s, x.object!) === 'Test Pendant');
    expect(a).toBeDefined();
    s = resolveAll(drive(act(s, a!.action)));
    const bear = onField(s, 'Test Bear', 'p1');
    expect(bear).toBeDefined();
    expect(s.objects[bear!]!.tapped).toBe(true);
    expect(inZone(s, 'graveyard', 'Test Knight').length).toBe(1);
  });
});

// ---- Haakon ----------------------------------------------------------------------------------------------------------------------------------------------------------
const HAAKON = synthetic('Test Haakon', 'Legendary Creature — Human Knight', '{2}{B}', "You may cast ~ from your graveyard, but not from anywhere else.\nAs long as ~ is on the battlefield, you may cast Knight spells from your graveyard.", PT);
const KNIGHT2 = synthetic('Test Paladin', 'Creature — Human Knight', '{1}', '', PT);
describe('CR 601.3, 113.6b: "You may cast ~ from your graveyard, but not from anywhere else." / "As long as ~ is on the battlefield, you may cast Knight spells from your graveyard."', () => {
  const casts = (s: GameState, zone: 'hand' | 'graveyard'): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === zone).map((a) => nameOf(s, a.object!)).sort();
  it('can be cast from the graveyard and not from the hand', () => {
    const inYard = scenario(['Swamp'], { p1: { battlefield: mana('Swamp', 3), graveyard: ['Test Haakon'] }, defs: [HAAKON, KNIGHT2, BEAR] });
    expect(casts(inYard, 'graveyard')).toEqual(['Test Haakon']);
    const inHand = scenario(['Swamp'], { p1: { battlefield: mana('Swamp', 3), hand: ['Test Haakon', 'Test Bear'] }, defs: [HAAKON, KNIGHT2, BEAR] });
    expect(casts(inHand, 'hand')).toEqual(['Test Bear']); // Haakon cannot be cast from the hand, other cards can
  });
  it('lets Knight spells (not other creatures) be cast from the graveyard while Haakon is on the battlefield', () => {
    const s = scenario(['Swamp'], { p1: { battlefield: ['Test Haakon', ...mana('Swamp', 3)], graveyard: ['Test Paladin', 'Test Bear'] }, defs: [HAAKON, KNIGHT2, BEAR] });
    expect(casts(s, 'graveyard')).toEqual(['Test Paladin']);
  });
});

// ---- Edgar ----------------------------------------------------------------------------------------------------------------------------------------------------------
const EDGAR = synthetic('Test Edgar', 'Legendary Creature — Human Artificer', '{2}{R}', 'Once during each of your turns, you may cast an artifact spell from your graveyard. If you cast a spell this way, that artifact enters tapped.', PT);
const TRINKET = synthetic('Test Trinket', 'Artifact', '{1}', '');
const TIN = synthetic('Test Tin', 'Artifact Creature — Construct', '{1}', '', PT);
describe('CR 614.1c, 601.3: "Once during each of your turns, you may cast an artifact spell from your graveyard. If you cast a spell this way, that artifact enters tapped."', () => {
  const start = (): GameState => scenario(['Mountain'], { p1: { battlefield: ['Test Edgar', ...mana('Mountain', 4)], graveyard: ['Test Trinket', 'Test Tin', 'Test Bear'] }, defs: [EDGAR, TRINKET, TIN, BEAR] });
  it('casts an artifact from the graveyard that enters tapped, once; a non-artifact is not offered', () => {
    let s = start();
    expect(gyCasts(s)).toEqual(['Test Tin', 'Test Trinket']);
    s = resolveAll(castFromYard(s, 'Test Tin'));
    const tin = onField(s, 'Test Tin', 'p1');
    expect(tin).toBeDefined();
    expect(s.objects[tin!]!.tapped).toBe(true);
    expect(gyCasts(s)).toEqual([]); // once during each of your turns
  });
  it('negative: a spell cast from the hand does not enter tapped', () => {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Edgar', ...mana('Mountain', 4)], hand: ['Test Tin'] }, defs: [EDGAR, TRINKET, TIN, BEAR] });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => nameOf(s, id) === 'Test Tin')! })));
    expect(s.objects[onField(s, 'Test Tin', 'p1')!]!.tapped).toBeFalsy();
  });
});

describe('CR 614.1a: Glimpse the Cosmos is exiled only instead of the graveyard (review)', () => {
  it('a Glimpse cast this way that is returned to its owner\'s hand goes to the hand, not exile', () => {
    const BOUNCE = synthetic('Test Bounce', 'Instant', '{0}', "Return target spell to its owner's hand.");
    let s = scenario(['Island'], { p1: { battlefield: [...mana('Island', 1), 'Test Giant'], graveyard: ['Test Glimpse'], library: mana('Test Bear', 3) }, p2: { hand: ['Test Bounce'] }, defs: [...DEFS, BOUNCE] } as never);
    s = castFromYard(s, 'Test Glimpse');
    const bounce = s.zones.hand.p2!.find((id) => nameOf(s, id) === 'Test Bounce')!;
    s = act(s, { type: 'pass', player: 'p1' } as never);
    s = drive(act(s, { type: 'cast', player: 'p2', card: bounce }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: s.zones.stack[0]! }] }]);
    s = resolveAll(s);
    expect(inZone(s, 'hand', 'Test Glimpse').length).toBe(1);
    expect(inZone(s, 'exile', 'Test Glimpse').length).toBe(0);
  });
});
