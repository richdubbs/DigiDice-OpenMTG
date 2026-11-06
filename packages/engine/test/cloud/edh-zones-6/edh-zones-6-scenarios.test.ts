/**
 * edh-zones-6 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites from memory,
 * unverified.
 *
 *   CR 202.1, 202.1b, 107.3     "Search your library for an artifact card with mana cost {0} or {1}": the printed mana cost, exactly; a land has none, {X} is not {0} (Urza's Saga)
 *   CR 113.1c, 201.5a, 111.4    a quoted ability inside a quoted ability: "This Saga gains \"{2}, {T}: Create a ... token with 'This token gets +1/+1 for each artifact you control.'\""
 *   CR 114.2, 608.2c            "You get an emblem with \"...\" ." followed by another sentence (Nissa, Who Shakes the World): the emblem and the search both happen
 *   CR 614.1a, 614.6, 113.6b    "If ~ would be put into a graveyard from anywhere, reveal ~ and shuffle it into its owner's library instead." on a sorcery (Nexus of Fate)
 *   CR 400.7, 202.3, 603.10a    "return to your hand target artifact card in your graveyard with lesser mana value" (Scrap Trawler)
 *   CR 122.6, 614.1c            "put that card onto the battlefield with an additional +1/+1 counter on it" (Neoform)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { put } from '../../m3/scenario';
import { act, advanceTo, answer, find, full, card, cast, drive, passBoth, resolveAll, scenario, activations, legal } from '../r5-cost/support';

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id));
/** Replace a player's whole library (the scenario's filler Plains included) with the named cards, top first. */
function setLibrary(s: GameState, p: 'p1' | 'p2', libNames: string[]): void {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
}
const onBattlefield = (s: GameState, name: string, owner?: string): string[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (owner === undefined || s.objects[id]!.controller === owner));
const pendingObjects = (s: GameState) => s.pending as { kind: 'chooseObjects'; player: string; options: string[]; min: number; max: number };

const SAGA = card('Test Forge Saga', 'Enchantment — Saga', "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — This Saga gains \"{T}: Add {C}.\"\nII — This Saga gains \"{2}, {T}: Create a 0/0 colorless Golem artifact creature token with 'This token gets +1/+1 for each artifact you control.'\"\nIII — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.", '{2}');
const MOX = card('Test Mox', 'Artifact', '{T}: Add {C}.', '{0}');
const RING = card('Test Ring', 'Artifact', '{T}: Add {C}.', '{1}');
const HULK = card('Test Hulk', 'Artifact', '{T}: Add {C}{C}.', '{2}');
const GEM = card('Test X Gem', 'Artifact', '{T}: Add {C}.', '{X}');
const TINT = card('Test Tint', 'Artifact', '{T}: Add {C}.', '{G}');
const PEST = card('Test Pest', 'Creature — Pest', '', '{1}', ['1', '1']);
const WALKER = card('Test Gaea Walker', 'Legendary Planeswalker — Testwalker', '−8: You get an emblem with "Lands you control have indestructible." Search your library for any number of Forest cards, put them onto the battlefield tapped, then shuffle.', '{0}');
const NEXUS = card('Test Fate Spell', 'Sorcery', "Take an extra turn after this one.\nIf Test Fate Spell would be put into a graveyard from anywhere, reveal Test Fate Spell and shuffle it into its owner's library instead.", '{0}');
const PLAIN = card('Test Plain Spell', 'Sorcery', 'You gain 1 life.', '{0}');
const DISCARD = card('Test Discarder', 'Sorcery', 'Target player discards a card.', '{0}');
const TRAWLER = card('Test Scrap Heap', 'Artifact Creature — Construct', "Whenever this creature dies or another artifact you control is put into a graveyard from the battlefield, return to your hand target artifact card in your graveyard with lesser mana value.", '{3}', ['2', '2']);
const SHATTER = card('Test Shatter', 'Sorcery', 'Destroy target artifact.', '{0}');
const SPARK = card('Test Spark', 'Artifact', '', '{1}');
const ANVIL = card('Test Anvil', 'Artifact', '', '{2}');
const PYLON = card('Test Pylon', 'Artifact', '', '{3}');
const PRISM = card('Test Prism', 'Artifact', '', '{2}');
const NEOFORM = card('Test Remold', 'Sorcery', "As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield with an additional +1/+1 counter on it, then shuffle.", '{0}');
const C1 = card('Test Cub One', 'Creature — Bear', '', '{1}', ['1', '1']);
const C2 = card('Test Cub Two', 'Creature — Bear', '', '{2}', ['2', '2']);
const C3 = card('Test Cub Three', 'Creature — Bear', '', '{3}', ['3', '3']);
const C3B = card('Test Cub Three B', 'Creature — Bear', '', '{3}', ['3', '3']);
const C4 = card('Test Cub Four', 'Creature — Bear', '', '{4}', ['4', '4']);
const DEFS = [SAGA, MOX, RING, HULK, GEM, TINT, PEST, WALKER, NEXUS, PLAIN, DISCARD, TRAWLER, SHATTER, SPARK, ANVIL, PYLON, PRISM, NEOFORM, C1, C2, C3, C3B, C4];

describe('the synthetic cards are automated', () => {
  it('play fully', () => { for (const d of [SAGA, WALKER, NEXUS, TRAWLER, NEOFORM]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

describe('a Saga that gains a quoted ability with a quoted ability inside it, and a search by printed mana cost (CR 202.1, 113.1c; Urza\'s Saga)', () => {
  it('chapter II: the Saga gains "{2}, {T}: Create a 0/0 ... token ..." and the token is +1/+1 for each artifact its controller controls (the token itself included)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Forge Saga', counters: { lore: 1 } }, 'Test Mox', 'Test Hulk', 'Test Ring', 'Test Ring', 'Test Ring', 'Test Ring', 'Test Ring'] }, p2: {} });
    s = resolveAll(s); // the scenario starts in the precombat main phase: the lore counter goes 1 -> 2 and chapter II resolves
    const saga = find(s, 'Test Forge Saga', 'battlefield');
    const acts = activations(s, 'Test Forge Saga');
    expect(acts.length).toBe(1);
    s = drive(act(s, acts[0]!.action));
    s = resolveAll(s);
    const tokens = onBattlefield(s, 'Golem Token');
    expect(tokens).toHaveLength(1);
    const ch = getChars(s, tokens[0]!)!;
    // the artifacts you control: Mox, Hulk, five Rings and the token itself
    expect(`${ch.power}/${ch.toughness}`).toBe('8/8');
    expect(s.objects[saga]!.tapped).toBe(true);
  });
  it('the negative case: before chapter II the Saga has no such ability', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Forge Saga', counters: { lore: 0 } }] }, p2: {} });
    expect(activations(s, 'Test Forge Saga').length).toBe(0);
  });
  it('chapter III: only an artifact card whose printed mana cost is exactly {0} or {1} can be found: not {2}, {X}, {G}, a land, or a non-artifact with {1}', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Forge Saga', counters: { lore: 2 } }] }, p2: {} });
    setLibrary(s, 'p1', ['Test Hulk', 'Test X Gem', 'Test Tint', 'Test Pest', 'Test Mox', 'Test Ring']);
    s = passBoth(s); // the trigger of chapter III is already on the stack in the scenario's first main phase? resolve it
    s = s.pending?.kind === 'chooseObjects' ? s : resolveAll(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Test Mox', 'Test Ring']);
    const ring = pendingObjects(s).options.find((id) => nameOf(s, id) === 'Test Ring')!;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [ring] }));
    expect(onBattlefield(s, 'Test Ring', 'p1')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Mox')).toHaveLength(0);
  });
});

describe('"You get an emblem with \\"...\\" Search your library for any number of Forest cards, put them onto the battlefield tapped, then shuffle." (CR 114.2, 608.2c; Nissa, Who Shakes the World)', () => {
  const start = (): GameState => {
    let s = scenario(['Forest', 'Swamp'], { defs: DEFS, p1: { battlefield: [{ name: 'Test Gaea Walker', counters: { loyalty: 8 } }, 'Swamp'] }, p2: {} });
    setLibrary(s, 'p1', ['Forest', 'Swamp', 'Forest', 'Test Pest']);
    s = advanceTo(s, 1, 'main1');
    return s;
  };
  it('the emblem is made (lands you control have indestructible) and then every Forest of the library enters tapped under your control', () => {
    let s = start();
    const a = legal(s, 'p1', 'activate').filter((x) => x.object === find(s, 'Test Gaea Walker', 'battlefield'));
    expect(a.length).toBe(1);
    s = passBoth(act(s, a[0]!.action));
    expect(s.pending?.kind).toBe('chooseObjects'); // the emblem is made first, then the search
    expect(names(s, pendingObjects(s).options)).toEqual(['Forest', 'Forest']); // the Swamp and the creature stay in the library
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: pendingObjects(s).options }));
    const forests = onBattlefield(s, 'Forest', 'p1');
    expect(forests).toHaveLength(2);
    expect(forests.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(getChars(s, forests[0]!)!.keywords.map((k) => k.keyword)).toContain('indestructible');
    expect(getChars(s, find(s, 'Swamp', 'battlefield', 'p1'))!.keywords.map((k) => k.keyword)).toContain('indestructible');
    expect(names(s, s.zones.library.p1!)).not.toContain('Forest');
  });
  it('the negative case: a creature you control gets no indestructible from the emblem', () => {
    let s = start();
    put(s, 'p1', 'battlefield', 'Test Pest');
    const a = legal(s, 'p1', 'activate').filter((x) => x.object === find(s, 'Test Gaea Walker', 'battlefield'));
    s = passBoth(act(s, a[0]!.action));
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [] }));
    expect(getChars(s, find(s, 'Test Pest', 'battlefield', 'p1'))!.keywords.map((k) => k.keyword)).not.toContain('indestructible');
  });
});

describe('"If ~ would be put into a graveyard from anywhere, reveal ~ and shuffle it into its owner\'s library instead." on a sorcery (CR 614.1a, 113.6b; Nexus of Fate)', () => {
  it('the sorcery that resolves goes into its owner\'s library, not the graveyard, and the extra turn happens', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Fate Spell'] }, p2: {} });
    s = cast(s, 'Test Fate Spell');
    s = resolveAll(s);
    expect(names(s, s.zones.graveyard.p1!)).not.toContain('Test Fate Spell');
    expect(names(s, s.zones.library.p1!)).toContain('Test Fate Spell');
    expect(s.zones.stack).toHaveLength(0);
    expect(s.turn.extraTurns).toHaveLength(1); // the extra turn is queued
  });
  it('discarded from a hand it also goes into the library of its owner (anywhere)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Discarder'] }, p2: { hand: ['Test Fate Spell'] } });
    s = cast(s, 'Test Discarder', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(drive(passBoth(s)));
    expect(names(s, s.zones.graveyard.p2!)).not.toContain('Test Fate Spell');
    expect(names(s, s.zones.library.p2!)).toContain('Test Fate Spell');
  });
  it('the negative case: a sorcery without the line goes to the graveyard as always', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Plain Spell'] }, p2: {} });
    s = resolveAll(cast(s, 'Test Plain Spell'));
    expect(names(s, s.zones.graveyard.p1!)).toContain('Test Plain Spell');
  });
});

describe('"return to your hand target artifact card in your graveyard with lesser mana value" (CR 603.2, 202.3; Scrap Trawler)', () => {
  const setup = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Shatter'], battlefield: ['Test Scrap Heap', 'Test Prism'], graveyard: ['Test Spark', 'Test Anvil', 'Test Pylon'] }, p2: { battlefield: [] } });
  const targetsOf = (s: GameState): string[] => {
    expect(s.pending?.kind).toBe('chooseTargets');
    return names(s, (s.pending as unknown as { objects: string[] }).objects).sort();
  };
  it('another artifact you control is destroyed: the target must have a mana value LOWER than that artifact\'s (here {2}): only the {1} one', () => {
    let s = setup();
    s = cast(s, 'Test Shatter', { targets: [[{ kind: 'object', id: find(s, 'Test Prism', 'battlefield', 'p1') }]] });
    s = passBoth(s);
    expect(targetsOf(s)).toEqual(['Test Spark']); // not the {2} Anvil (equal), not the {3} Pylon, and not the Prism itself
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: (s.pending as unknown as { objects: string[] }).objects[0]! }] }));
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Spark']);
    expect(names(s, s.zones.graveyard.p1!).sort()).toEqual(['Test Anvil', 'Test Prism', 'Test Pylon', 'Test Shatter']);
  });
  it('the Heap itself dying (mana value 3): a {1} or {2} artifact card, not the {3} one', () => {
    let s = setup();
    s = cast(s, 'Test Shatter', { targets: [[{ kind: 'object', id: find(s, 'Test Scrap Heap', 'battlefield', 'p1') }]] });
    s = passBoth(s);
    expect(targetsOf(s)).toEqual(['Test Anvil', 'Test Spark']);
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Anvil', 'graveyard', 'p1') }] }));
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Anvil']);
  });
  it('the negative case: an artifact an opponent controls being destroyed does not trigger it', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Shatter'], battlefield: ['Test Scrap Heap'], graveyard: ['Test Spark'] }, p2: { battlefield: ['Test Prism'] } });
    s = cast(s, 'Test Shatter', { targets: [[{ kind: 'object', id: find(s, 'Test Prism', 'battlefield', 'p2') }]] });
    s = resolveAll(drive(passBoth(s)));
    expect(names(s, s.zones.hand.p1!)).toEqual([]);
  });
});

describe('"put that card onto the battlefield with an additional +1/+1 counter on it" (CR 122.6, 614.1c; Neoform)', () => {
  it('sacrifice a creature of mana value 2: the creature card of mana value 3 found enters with one +1/+1 counter, a second {3} or a {4} could not be found', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Remold'], battlefield: ['Test Cub Two'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Cub One', 'Test Cub Four', 'Test Cub Three', 'Test Cub Three B', 'Test Cub Two']);
    s = cast(s, 'Test Remold'); // the only creature is sacrificed
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(names(s, pendingObjects(s).options).sort()).toEqual(['Test Cub Three', 'Test Cub Three B']); // mana value 3 exactly: not the {1}, {2} or {4} one
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [pendingObjects(s).options.find((id) => nameOf(s, id) === 'Test Cub Three')!] }));
    const found = onBattlefield(s, 'Test Cub Three', 'p1');
    expect(found).toHaveLength(1);
    expect(s.objects[found[0]!]!.counters['+1/+1'] ?? 0).toBe(1);
    expect(names(s, s.zones.graveyard.p1!)).toContain('Test Cub Two');
  });
  it('the negative case: with no creature card of that mana value in the library nothing enters', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Remold'], battlefield: ['Test Cub One'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Cub Four', 'Test Cub One']);
    s = cast(s, 'Test Remold');
    s = resolveAll(drive(passBoth(s)));
    expect(onBattlefield(s, 'Test Cub Four')).toHaveLength(0);
    expect(onBattlefield(s, 'Test Cub One')).toHaveLength(0);
  });
});
