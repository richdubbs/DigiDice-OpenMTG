/**
 * Round edh-mana-keywords-12: the behaviour it added, played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 *
 *   CR 605.3b, 701.20a, 402.3, 608.2d  "{T}: Reveal any number of artifact cards in your hand. Add {C}{C} for each card revealed this way." (Metalworker): any number (none too) of artifact
 *                                   cards of your hand are revealed, two colorless mana for each, at once (a mana ability)
 *   CR 702.24a, 106.4, 118.1         "Cumulative upkeep--Add {R}." (Braid of Fire): an age counter and {R} for each age counter in your upkeep; the mana is lost as the step ends (ruling 2009-10-01)
 *   CR 106.1, 602.2b, 607.2d         "Note the type of mana spent to pay this activation cost." / "Add one mana of this artifact's last noted type." (Jeweled Amulet, rulings 2008-10-01)
 *   CR 701.3a, 301.5c, 205.1b, 613.4  "Equip planeswalker {1}" + "Equipped permanent isn't a planeswalker and is a creature in addition to its other types." (Luxior, Giada's Gift, ruling 2022-04-29)
 *   CR 601.2i, 611.2, 702.44a        "When you next cast an artifact spell this turn, that spell gains sunburst." (Solar Array, ruling 2025-07-25)
 *   CR 601.2i, 106.3, 702.85a         "The first spell you cast each turn that mana from a Treasure was spent to cast has cascade." (Rain of Riches)
 *   CR 708.2a, 708.4, 613.2b, 305.6  "Turn target creature face down. It's a 2/2 Cyberman artifact creature." (Cyber Conversion) / "..., you may return it to the battlefield face down under its owner's control. It's a Forest land." (Yedora, Grave Gardener; both rulings 2021-04-16 / 2023-10-13)
 *   CR 613.1f, 609.4b, 602.2b, 106.1  "~ has all activated abilities of all creatures your opponents control. You may spend mana as though it were mana of any color to activate those abilities." (Drana and Linvala)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pool, put, scenario } from '../../m3/scenario';
import { card, full, pt, resolveAll, settle } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const handNames = (s: GameState, p = 'p1'): string[] => (s.zones.hand[p] ?? []).map((id) => nameOf(s, id)).sort();
const activateOf = (s: GameState, name: string, label?: RegExp) => legal(s, 'p1', 'activate').find((a) => a.object !== undefined && nameOf(s, a.object) === name && (label === undefined || label.test(a.label)));

// ---- Metalworker -----------------------------------------------------------------------------------------------------------------------------------------
const SMITH = card('Test Smith', 'Artifact Creature — Construct', '{T}: Reveal any number of artifact cards in your hand. Add {C}{C} for each card revealed this way.', ['1', '1']);
const GIZMO = card('Test Gizmo', 'Artifact', 'Indestructible');
const CHARM = card('Test Charm', 'Instant', 'You gain 1 life.');

describe('CR 605.3b, 701.20a: "Reveal any number of artifact cards in your hand. Add {C}{C} for each card revealed this way." (Metalworker)', () => {
  it('the card is fully automated and its activation is a mana ability', () => {
    expect(full(SMITH), JSON.stringify(SMITH.automation)).toBe(true);
    const s = scenario([], { defs: [SMITH, GIZMO, CHARM], p1: { hand: ['Test Gizmo'], battlefield: ['Test Smith'] } });
    expect(activateOf(s, 'Test Smith')?.isMana).toBe(true);
  });
  const board = (): GameState => scenario([], { defs: [SMITH, GIZMO, CHARM], p1: { hand: ['Test Gizmo', 'Test Gizmo', 'Test Charm'], battlefield: ['Test Smith'] } });
  const run = (pick: (s: GameState, options: ObjectId[]) => ObjectId[]): GameState => {
    const s0 = board();
    const s1 = act(s0, activateOf(s0, 'Test Smith')!.action);
    expect(s1.pending?.kind).toBe('chooseObjects');
    const options = (s1.pending as unknown as { options: ObjectId[] }).options;
    return answer(s1, { kind: 'chooseObjects', ids: pick(s1, options) });
  };
  it('both artifact cards revealed: two colorless mana for each (four), the cards stay in the hand, the Smith is tapped', () => {
    const s = run((_, o) => o);
    expect(pool(s, 'p1')).toBe('CCCC');
    expect(handNames(s)).toEqual(['Test Charm', 'Test Gizmo', 'Test Gizmo']);
    expect(s.objects[find(s, 'Test Smith', 'battlefield')]!.tapped).toBe(true);
  });
  it('one card revealed: {C}{C}', () => {
    expect(pool(run((_, o) => [o[0]!]), 'p1')).toBe('CC');
  });
  it('ruling 2004-10-04: you can reveal zero cards to gain zero mana', () => {
    expect(pool(run(() => []), 'p1')).toBe('');
  });
  it('negative: only artifact cards are offered (the instant in the hand is not)', () => {
    const s0 = board();
    const s1 = act(s0, activateOf(s0, 'Test Smith')!.action);
    const options = (s1.pending as unknown as { options: ObjectId[] }).options;
    expect(options.map((id) => nameOf(s1, id))).toEqual(['Test Gizmo', 'Test Gizmo']);
  });
});

// ---- Braid of Fire ---------------------------------------------------------------------------------------------------------------------------------------
const BRAID = card('Test Braid', 'Enchantment', 'Cumulative upkeep--Add {R}.');

describe('CR 702.24a, 106.4: "Cumulative upkeep--Add {R}." (Braid of Fire)', () => {
  it('the card is fully automated', () => {
    expect(full(BRAID), JSON.stringify(BRAID.automation)).toBe(true);
  });
  const ages = (s: GameState): number => s.objects[find(s, 'Test Braid', 'battlefield')]!.counters['age'] ?? 0;
  it('each of your upkeeps: one more age counter and {R} for each age counter (1, then 2)', () => {
    let s = advanceTo(scenario([], { defs: [BRAID], p1: { battlefield: ['Test Braid'] } }), 3, 'upkeep');
    s = resolveAll(s);
    expect(ages(s)).toBe(1);
    expect(pool(s, 'p1')).toBe('R');
    s = advanceTo(s, 5, 'upkeep');
    s = resolveAll(s);
    expect(ages(s)).toBe(2);
    expect(pool(s, 'p1')).toBe('RR');
  });
  it('ruling 2009-10-01: the mana not spent in the upkeep is gone before the draw step', () => {
    let s = advanceTo(scenario([], { defs: [BRAID], p1: { battlefield: ['Test Braid'] } }), 3, 'upkeep');
    s = resolveAll(s);
    s = advanceTo(s, 3, 'draw');
    expect(pool(s, 'p1')).toBe('');
    expect(s.zones.battlefield.map((id) => nameOf(s, id))).toContain('Test Braid');
  });
  it('negative: it is not your upkeep (turn 2 is the opponent\'s): nothing happens', () => {
    let s = advanceTo(scenario([], { defs: [BRAID], p1: { battlefield: ['Test Braid'] } }), 2, 'upkeep');
    s = resolveAll(s);
    expect(ages(s)).toBe(0);
    expect(pool(s, 'p1')).toBe('');
  });
});

// ---- Jeweled Amulet --------------------------------------------------------------------------------------------------------------------------------------
const AMULET = card('Test Amulet', 'Artifact', "{1}, {T}: Put a charge counter on this artifact. Note the type of mana spent to pay this activation cost. Activate only if there are no charge counters on this artifact.\n{T}, Remove a charge counter from this artifact: Add one mana of this artifact's last noted type.");

describe('CR 106.1, 602.2b, 607.2d: "Note the type of mana spent to pay this activation cost." (Jeweled Amulet)', () => {
  it('the card is fully automated', () => {
    expect(full(AMULET), JSON.stringify(AMULET.automation)).toBe(true);
  });
  const board = (lands: string[]): GameState => scenario(['Mountain', 'Forest', 'Island'], { defs: [AMULET], p1: { battlefield: ['Test Amulet', ...lands] } });
  const first = (s0: GameState): GameState => resolveAll(act(s0, activateOf(s0, 'Test Amulet', /charge counter on/i)!.action));
  const second = (s0: GameState): GameState => act(s0, activateOf(s0, 'Test Amulet', /Add \{?.?\}?|noted type/i)!.action);
  const amulet = (s: GameState) => s.objects[find(s, 'Test Amulet', 'battlefield')]!;
  /** Both abilities tap the Amulet, so the second one waits for the next untap step (turn 3 is the controller's next turn). */
  const later = (s: GameState, turn: number): GameState => advanceTo(s, turn, 'main1');
  it('pays with a Mountain: the type noted is red, and the second ability, on a later turn, adds {R}', () => {
    let s = first(board(['Mountain']));
    expect(amulet(s).counters['charge']).toBe(1);
    s = second(later(s, 3));
    expect(pool(s, 'p1')).toBe('R');
    expect(amulet(s).counters['charge'] ?? 0).toBe(0);
  });
  it('the LAST type noted counts: noted with a Mountain (R), then again with a Forest (G): the second ability adds {G}', () => {
    let s = first(board(['Mountain']));
    s = second(later(s, 3));
    expect(pool(s, 'p1')).toBe('R');
    // the Mountain is gone from the board: a Forest pays the next note
    const mountain = find(s, 'Mountain', 'battlefield');
    s.zones.battlefield = s.zones.battlefield.filter((id) => id !== mountain);
    delete s.objects[mountain];
    s.zones.battlefield.push(put(s, 'p1', 'battlefield', 'Forest'));
    s = first(later(s, 5));
    s = second(later(s, 7));
    expect(pool(s, 'p1')).toBe('G');
  });
  it('ruling 2008-10-01: with no type noted yet, the second ability produces no mana', () => {
    const s0 = scenario([], { defs: [AMULET], p1: { battlefield: [{ name: 'Test Amulet', counters: { charge: 1 } }] } });
    const s = second(s0);
    expect(pool(s, 'p1')).toBe('');
    expect(amulet(s).counters['charge'] ?? 0).toBe(0);
  });
  it('negative: the first ability is not offered while the Amulet has a charge counter', () => {
    const s = first(board(['Mountain']));
    expect(activateOf(s, 'Test Amulet', /charge counter on/i)).toBeUndefined();
  });
});

// ---- Luxior, Giada's Gift --------------------------------------------------------------------------------------------------------------------------------
const LUXIOR = card('Test Luxior', 'Legendary Artifact — Equipment', "Equipped creature gets +1/+1 for each counter on it.\nEquipped permanent isn't a planeswalker and is a creature in addition to its other types.\nEquip planeswalker {1}\nEquip {3}");
const WALKER = card('Test Walker', 'Planeswalker — Test', 'Test text.');
const BEAR = card('Test Bear', 'Creature — Bear', 'Vigilance', ['2', '2']);

describe('CR 701.3a, 301.5c, 205.1b: "Equip planeswalker {1}" and "Equipped permanent isn\'t a planeswalker and is a creature in addition to its other types." (Luxior)', () => {
  it('the card is fully automated', () => {
    expect(full(LUXIOR), JSON.stringify(LUXIOR.automation)).toBe(true);
  });
  const board = (): GameState => scenario(['Forest', 'Mountain', 'Plains'], { defs: [LUXIOR, WALKER, BEAR], p1: { battlefield: ['Test Luxior', { name: 'Test Walker', counters: { loyalty: 4 } }, 'Test Bear', 'Forest'] } });
  it('Equip planeswalker {1}: the planeswalker becomes a creature (not a planeswalker) with power and toughness equal to its counters (base 0/0, ruling 2022-04-29), and stays equipped', () => {
    const s0 = board();
    const eq = legal(s0, 'p1', 'activate').find((a) => /Equip planeswalker/.test(a.label))!;
    const walker = find(s0, 'Test Walker', 'battlefield');
    const s = resolveAll(act(s0, eq.action), { targets: [{ kind: 'object', id: walker }] });
    expect(s.objects[find(s, 'Test Luxior', 'battlefield')]!.attachedTo).toBe(walker);
    const chars = getChars(s, walker)!;
    expect(chars.types).toContain('Creature');
    expect(chars.types).not.toContain('Planeswalker');
    expect(pt(s, walker)).toBe('4/4');
  });
  it('only a planeswalker you control is a target of Equip planeswalker (the Bear is not)', () => {
    const s0 = board();
    const eq = legal(s0, 'p1', 'activate').find((a) => /Equip planeswalker/.test(a.label))!;
    const s = act(s0, eq.action);
    const options = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(options).toEqual([find(s0, 'Test Walker', 'battlefield')]);
  });
  it('negative: Equip {3} (the plain equip) still attaches to creatures only; with three mana the Bear is a target, the Walker is not', () => {
    const s0 = scenario(['Forest', 'Mountain', 'Plains'], { defs: [LUXIOR, WALKER, BEAR], p1: { battlefield: ['Test Luxior', { name: 'Test Walker', counters: { loyalty: 4 } }, 'Test Bear', 'Forest', 'Mountain', 'Plains'] } });
    const eq = legal(s0, 'p1', 'activate').find((a) => /^Test Luxior: Equip \{3\}/.test(a.label))!;
    const s = act(s0, eq.action);
    expect((s.pending as unknown as { objects: ObjectId[] }).objects).toEqual([find(s0, 'Test Bear', 'battlefield')]);
  });
  it('the Bear equipped gets +1/+1 for each counter on it (none: 2/2)', () => {
    const s0 = scenario(['Forest', 'Mountain', 'Plains'], { defs: [LUXIOR, WALKER, BEAR], p1: { battlefield: ['Test Luxior', 'Test Bear', 'Forest', 'Mountain', 'Plains'] } });
    const eq = legal(s0, 'p1', 'activate').find((a) => /^Test Luxior: Equip \{3\}/.test(a.label))!;
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = resolveAll(act(s0, eq.action), { targets: [{ kind: 'object', id: bear }] });
    expect(s.objects[find(s, 'Test Luxior', 'battlefield')]!.attachedTo).toBe(bear);
    expect(pt(s, bear)).toBe('2/2');
    expect(getChars(s, bear)!.types).toEqual(['Creature']);
  });
});

// ---- Solar Array -----------------------------------------------------------------------------------------------------------------------------------------
const ARRAY = card('Test Array', 'Artifact', '{T}: Add one mana of any color. When you next cast an artifact spell this turn, that spell gains sunburst.');
const MECH = card('Test Mechan', 'Artifact Creature — Construct', 'Vigilance', ['1', '1'], '{1}{W}');
const PLAINROCK = card('Test Rock', 'Artifact', 'Indestructible', undefined, '{1}');
const SHOCK = card('Test Bolt', 'Instant', 'You gain 1 life.', undefined, '{1}');

describe('CR 601.2i, 611.2, 702.44a: "When you next cast an artifact spell this turn, that spell gains sunburst." (Solar Array)', () => {
  it('the card is fully automated and its activation is a mana ability', () => {
    expect(full(ARRAY), JSON.stringify(ARRAY.automation)).toBe(true);
    const s = scenario([], { defs: [ARRAY], p1: { battlefield: ['Test Array'] } });
    expect(activateOf(s, 'Test Array')?.isMana).toBe(true);
  });
  const withMana = (): GameState => scenario(['Plains'], { defs: [ARRAY, MECH, PLAINROCK, SHOCK], p1: { hand: ['Test Mechan', 'Test Rock', 'Test Bolt'], battlefield: ['Test Array', 'Plains'] } });
  it('an artifact creature cast with mana of two colors enters with two +1/+1 counters (sunburst counts the colors of mana spent)', () => {
    const s0 = withMana();
    let s = act(s0, activateOf(s0, 'Test Array')!.action);
    s = answer(s, { kind: 'chooseColor', color: 'U' });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mechan', 'hand') }));
    const mechan = s.objects[find(s, 'Test Mechan', 'battlefield')]!;
    expect(mechan.counters['+1/+1']).toBe(2);
  });
  it('negative: a spell that is not an artifact (the instant) does not use it up, and gets nothing', () => {
    const s0 = withMana();
    let s = answer(act(s0, activateOf(s0, 'Test Array')!.action), { kind: 'chooseColor', color: 'U' });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bolt', 'hand') }));
    expect(s.turn.nextSpell?.length ?? 0).toBe(1);
  });
  it('an artifact that is not a creature enters with charge counters, one for each color of mana spent', () => {
    const s0 = scenario(['Plains'], { defs: [ARRAY, PLAINROCK], p1: { hand: ['Test Rock'], battlefield: ['Test Array'] } });
    let s = answer(act(s0, activateOf(s0, 'Test Array')!.action), { kind: 'chooseColor', color: 'U' });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rock', 'hand') }));
    expect(s.objects[find(s, 'Test Rock', 'battlefield')]!.counters['charge']).toBe(1);
  });
  it('ruling 2025-07-25: two Solar Arrays give two instances of sunburst: the counters double', () => {
    const s0 = scenario(['Plains'], { defs: [ARRAY, MECH], p1: { hand: ['Test Mechan'], battlefield: ['Test Array', 'Test Array'] } });
    const arrays = s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Test Array');
    let s = answer(act(s0, { type: 'activate', player: 'p1', source: arrays[0]!, ability: 'p:0:0' }), { kind: 'chooseColor', color: 'U' });
    s = answer(act(s, { type: 'activate', player: 'p1', source: arrays[1]!, ability: 'p:0:0' }), { kind: 'chooseColor', color: 'W' });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mechan', 'hand') }));
    expect(s.objects[find(s, 'Test Mechan', 'battlefield')]!.counters['+1/+1']).toBe(4);
  });
});

// ---- Drana and Linvala -----------------------------------------------------------------------------------------------------------------------------------
const DRANA = card('Test Dran', 'Legendary Creature — Vampire Angel', 'Flying\nTest Dran has all activated abilities of all creatures your opponents control. You may spend mana as though it were mana of any color to activate those abilities.', ['3', '4']);
const PUMPER = card('Test Pumper', 'Creature — Imp', '{R}: This creature gets +1/+0 until end of turn.', ['1', '1']);

describe('CR 613.1f, 609.4b: "~ has all activated abilities of all creatures your opponents control. You may spend mana as though it were mana of any color to activate those abilities." (Drana and Linvala)', () => {
  it('the card is fully automated', () => {
    expect(full(DRANA), JSON.stringify(DRANA.automation)).toBe(true);
    expect(full(PUMPER), JSON.stringify(PUMPER.automation)).toBe(true);
  });
  const board = (): GameState => scenario(['Forest'], { defs: [DRANA, PUMPER], p1: { battlefield: ['Test Dran', 'Forest', 'Test Pumper'] }, p2: { battlefield: ['Test Pumper'] } });
  it('Drana has the opponent creature\'s ability and pays {R} with a Forest (as though it were red); the opponent\'s own creature is not touched', () => {
    const s0 = board();
    const dran = find(s0, 'Test Dran', 'battlefield');
    const ab = legal(s0, 'p1', 'activate').filter((a) => a.object === dran);
    expect(ab).toHaveLength(1);
    const s = resolveAll(act(s0, ab[0]!.action));
    expect(pt(s, dran)).toBe('4/4');
  });
  it('negative: the spend permission is for Drana\'s abilities only: your own Pumper still needs red mana, which a Forest is not', () => {
    const s0 = board();
    const mine = s0.zones.battlefield.find((id) => nameOf(s0, id) === 'Test Pumper' && s0.objects[id]!.controller === 'p1')!;
    const own = legal(s0, 'p1', 'activate').filter((a) => a.object === mine);
    expect(own).toHaveLength(0);
  });
  it('negative: without Drana\'s permission (an ordinary Forest and the same ability) the cost is not payable by that mana', () => {
    const s0 = scenario(['Forest'], { defs: [PUMPER], p1: { battlefield: ['Test Pumper', 'Forest'] } });
    expect(legal(s0, 'p1', 'activate').filter((a) => a.object === find(s0, 'Test Pumper', 'battlefield'))).toHaveLength(0);
  });
});

// ---- Cyber Conversion and Yedora ------------------------------------------------------------------------------------------------------------------------
const CONVERT = card('Test Convert', 'Instant', "Turn target creature face down. It's a 2/2 Cyberman artifact creature.");
const GARDENER = card('Test Gardener', 'Legendary Creature — Treefolk Druid', "Whenever another nontoken creature you control dies, you may return it to the battlefield face down under its owner's control. It's a Forest land.", ['5', '5']);
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const GIANT2 = card('Test Giant', 'Creature — Giant', 'Trample', ['4', '4']);

describe('CR 708.2a, 708.4, 613.2b: a face-down permanent with set characteristics (Cyber Conversion, Yedora, Grave Gardener)', () => {
  it('the cards are fully automated', () => {
    for (const d of [CONVERT, GARDENER]) expect(full(d), `${d.name} ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('Cyber Conversion: the creature is face down, a 2/2 Cyberman artifact creature with no name and no color (ruling 2023-10-13)', () => {
    const s0 = scenario([], { defs: [CONVERT, GIANT2], p1: { hand: ['Test Convert'] }, p2: { battlefield: ['Test Giant'] } });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const s = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Convert', 'hand') }), { targets: [{ kind: 'object', id: giant }] }));
    const o = s.objects[giant]!;
    expect(o.faceDown).toBe(true);
    const c = getChars(s, giant)!;
    expect(c.name).toBe('');
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(c.subtypes).toEqual(['Cyberman']);
    expect(c.colors).toEqual([]);
    expect(pt(s, giant)).toBe('2/2');
    expect(c.abilities).toHaveLength(0);
  });
  it('negative: a plain turn-face-down effect (no set characteristics) gives the plain 2/2 creature with no subtypes and no artifact type', () => {
    const PLAIN = card('Test Plain Down', 'Instant', 'Turn target creature face down.');
    const s0 = scenario([], { defs: [PLAIN, GIANT2], p1: { hand: ['Test Plain Down'] }, p2: { battlefield: ['Test Giant'] } });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const s = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Plain Down', 'hand') }), { targets: [{ kind: 'object', id: giant }] }));
    const c = getChars(s, giant)!;
    expect(s.objects[giant]!.faceDown).toBe(true);
    expect(c.types).toEqual(['Creature']);
    expect(c.subtypes).toEqual([]);
  });
  const yedora = (): GameState => {
    const s0 = scenario(['Forest'], { defs: [GARDENER, GIANT2, KILL], p1: { hand: ['Test Kill'], battlefield: ['Test Gardener', 'Test Giant', 'Forest'] } });
    return s0;
  };
  it('Yedora: another creature of yours that dies returns face down under its owner\'s control as a Forest land with only "{T}: Add {G}" (ruling 2021-04-16)', () => {
    const s0 = yedora();
    const giant = find(s0, 'Test Giant', 'battlefield');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand') }), { targets: [{ kind: 'object', id: giant }] });
    s = resolveAll(s, { yes: true });
    const back = s.zones.battlefield.map((id) => s.objects[id]!).find((o) => o.faceDown === true);
    expect(back).toBeDefined();
    const c = getChars(s, back!.id)!;
    expect(c.name).toBe('');
    expect(c.types).toEqual(['Land']);
    expect(c.subtypes).toEqual(['Forest']);
    expect(c.colors).toEqual([]);
    const mana = legal(s, 'p1', 'activate').filter((a) => a.object === back!.id && a.isMana === true);
    expect(mana).toHaveLength(1);
    expect(pool(act(s, mana[0]!.action), 'p1')).toBe('G');
  });
  it('negative: a declined "may" returns nothing', () => {
    const s0 = yedora();
    const giant = find(s0, 'Test Giant', 'battlefield');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand') }), { targets: [{ kind: 'object', id: giant }] });
    s = resolveAll(s, { yes: false });
    expect(s.zones.battlefield.map((id) => s.objects[id]!).some((o) => o.faceDown === true)).toBe(false);
  });
});

// ---- Rain of Riches --------------------------------------------------------------------------------------------------------------------------------------
const RICHES = card('Test Riches', 'Enchantment', 'The first spell you cast each turn that mana from a Treasure was spent to cast has cascade.');
const TREASURE = card('Test Treasure', 'Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.');
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.', undefined, '{1}');
const SPARK2 = card('Test Spark Too', 'Instant', 'You gain 2 life.', undefined, '{1}');

describe('CR 601.2i, 106.3: "The first spell you cast each turn that mana from a Treasure was spent to cast has cascade." (Rain of Riches)', () => {
  it('the card is fully automated', () => {
    expect(full(RICHES), JSON.stringify(RICHES.automation)).toBe(true);
  });
  const board = (): GameState => scenario(['Mountain'], { defs: [RICHES, TREASURE, SPARK, SPARK2], p1: { hand: ['Test Spark', 'Test Spark Too'], battlefield: ['Test Riches', 'Test Treasure', 'Test Treasure', 'Mountain'] } });
  const castWith = (s0: GameState, name: string, source: string): GameState => {
    const id = s0.zones.battlefield.find((o) => nameOf(s0, o) === source)!;
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand') });
    if (s.pending?.kind === 'payCost') {
      const src = (s.pending as unknown as { manaSources: { objectId: string; abilityKey: string }[] }).manaSources.find((m) => m.objectId === id)!;
      s = answer(s, { kind: 'payCost', auto: false, activations: [{ objectId: id, abilityKey: src.abilityKey, ...(source === 'Test Treasure' ? { color: 'W' as const } : {}) }] });
    }
    return s;
  };
  /** Casting a spell with cascade puts the spell and its cascade trigger on the stack (CR 702.85a: "When you cast this spell"); one without, only the spell. */
  const cascades = (s: GameState): number => s.zones.stack.filter((id) => s.objects[id]!.kind === 'ability').length;
  it('the first spell cast with Treasure mana has cascade (a cascade trigger on the stack); the second one cast with Treasure mana does not', () => {
    let s = castWith(board(), 'Test Spark', 'Test Treasure');
    expect(s.zones.stack).toHaveLength(2);
    expect(cascades(s)).toBe(1);
    s = castWith(s, 'Test Spark Too', 'Test Treasure');
    expect(s.zones.stack).toHaveLength(3); // only the second spell was added: no second cascade
    expect(cascades(s)).toBe(1);
  });
  it('negative: a spell paid with a Mountain has none, and it does not use up the first Treasure-paid spell: the next one paid with a Treasure has cascade', () => {
    let s = castWith(board(), 'Test Spark', 'Mountain');
    expect(s.zones.stack).toHaveLength(1);
    expect(cascades(s)).toBe(0);
    s = castWith(s, 'Test Spark Too', 'Test Treasure');
    expect(cascades(s)).toBe(1);
  });
});

describe('review fixes of edh-mana-keywords-12', () => {
  it('Solar Array tapped for mana WHILE the artifact spell is being paid for gives that spell sunburst (CR 601.2g, 601.2i)', () => {
    const s0 = scenario(['Plains'], { defs: [ARRAY, MECH], p1: { hand: ['Test Mechan'], battlefield: ['Test Array', 'Plains', 'Plains'] } });
    const array = find(s0, 'Test Array', 'battlefield');
    const plains = find(s0, 'Plains', 'battlefield');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mechan', 'hand') });
    const srcs = (s.pending as unknown as { manaSources: { objectId: string; abilityKey: string }[] }).manaSources;
    const a = srcs.find((m) => m.objectId === array)!;
    const p = srcs.find((m) => m.objectId === plains)!;
    s = answer(s, { kind: 'payCost', auto: false, activations: [{ objectId: array, abilityKey: a.abilityKey, color: 'U' }, { objectId: plains, abilityKey: p.abilityKey }] });
    s = resolveAll(s);
    expect(s.objects[find(s, 'Test Mechan', 'battlefield')]!.counters['+1/+1']).toBe(2);
    expect(s.turn.nextSpell?.length ?? 0).toBe(0);
  });
  it('Blood Moon-like land type change removes the face-down Forest\'s own mana ability (CR 305.7)', () => {
    const MOON = card('Test Moon', 'Enchantment', 'Nonbasic lands are Mountains.');
    const s0 = scenario(['Forest'], { defs: [GARDENER, GIANT2, KILL, MOON], p1: { hand: ['Test Kill'], battlefield: ['Test Gardener', 'Test Giant', 'Test Moon'] } });
    const giant = find(s0, 'Test Giant', 'battlefield');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand') }), { targets: [{ kind: 'object', id: giant }] });
    s = resolveAll(s, { yes: true });
    const back = s.zones.battlefield.map((id) => s.objects[id]!).find((o) => o.faceDown === true)!;
    const keys = getChars(s, back.id)!.abilities.map((a) => a.key);
    expect(keys).toContain('r:basic:R');
    expect(keys).not.toContain('r:basic:G');
  });
});
