/**
 * edh-d-30 (Commander coordinator D, lane type-change, second pass): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player. Each test is named after the rule it checks and has its negative case. CR cites are checked against the
 * Comprehensive Rules text of 2026-09-25 (see the record).
 *
 *   CR 205.1b, 105.3, 613.1d-e      "Target artifact you control becomes a 2/2 black Bat creature with flying and haste in addition to its other types." (for good)
 *   CR 611.2b, 613.1f, 508.1c       "For as long as ~ remains tapped, another target permanent loses all abilities and can't attack or block."
 *   CR 109.4, 108.3, 613.1d         "Each creature you control but don't own gets +2/+2, has menace and deathtouch, and is a Pirate in addition to its other types."
 *   CR 205.3i, 205.3m, 305.6, 613.1d  "Each land with an everything counter on it is every land type in addition to its other types." / "... nonland creature ... is every creature type."
 *   CR 604.3, 613.4b                "... gains "~'s power and toughness are each equal to the number of lore counters on it."" (a granted ability is not a characteristic-defining ability: layer 7b)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { attackCandidates } from '../../../src/rules/combat-rules';
import { find, findAll, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { activate, target } from '../../m5/cr-examples/helpers';
import { resolveStack } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => k.keyword);
const attackers = (s: GameState): ObjectId[] => attackCandidates(s, 'p1').map((c) => c.id);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const FLIER = card('Test Flier', 'Creature — Bird', 'Flying', ['1', '1']);
const RELIC = card('Test Relic', 'Artifact — Clue', '');

describe('CR 205.1b, 105.3, 613.1d-e: "Target artifact you control becomes a 2/2 black Bat creature with flying and haste in addition to its other types." (no duration: for good)', () => {
  const SHAPER = card('Test Shaper', 'Creature — Wizard', '{0}: Target artifact you control becomes a 2/2 black Bat creature with flying and haste in addition to its other types.', ['1', '1']);
  const board = (): { s: GameState; r1: ObjectId; r2: ObjectId } => {
    const s0 = scenario([], { defs: [SHAPER, RELIC], p1: { battlefield: ['Test Shaper', 'Test Relic', 'Test Relic'] } });
    const [r1, r2] = findAll(s0, 'Test Relic', 'battlefield', 'p1') as [ObjectId, ObjectId];
    return { s: s0, r1, r2 };
  };
  it('is automated', () => expect(full(SHAPER)).toBe(true));
  it('the targeted artifact is a black 2/2 Bat creature with flying and haste that is still an artifact Clue; the other artifact is unchanged', () => {
    const { s: s0, r1, r2 } = board();
    const s = resolveStack(activate(s0, find(s0, 'Test Shaper', 'battlefield'), [target(r1)]));
    const c = getChars(s, r1)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Clue', 'Bat']));
    expect(c.colors).toEqual(['B']);
    expect(pt(s, r1)).toBe('2/2');
    expect(kw(s, r1)).toEqual(expect.arrayContaining(['flying', 'haste']));
    const other = getChars(s, r2)!;
    expect(other.types).not.toContain('Creature');
    expect(other.colors).toEqual([]);
  });
  it('the change lasts: the continuous effect has no end (permanent duration)', () => {
    const { s: s0, r1 } = board();
    const s = resolveStack(activate(s0, find(s0, 'Test Shaper', 'battlefield'), [target(r1)]));
    expect(s.continuousEffects.some((e) => e.duration.d === 'permanent')).toBe(true);
    expect(s.continuousEffects.some((e) => e.duration.d !== 'permanent')).toBe(false);
  });
});

describe('CR 611.2b, 613.1f, 508.1c, 509.1b: "For as long as ~ remains tapped, another target permanent loses all abilities and can\'t attack or block."', () => {
  const ROD = card('Test Rod', 'Artifact', '{0}, {T}: For as long as ~ remains tapped, another target permanent loses all abilities and can\'t attack or block.');
  const board = (): { s: GameState; flier: ObjectId; bear: ObjectId; rod: ObjectId } => {
    const s0 = scenario([], { defs: [ROD, FLIER, BEAR], p1: { battlefield: ['Test Rod', 'Test Flier', 'Test Bear'] } });
    return { s: s0, flier: find(s0, 'Test Flier', 'battlefield'), bear: find(s0, 'Test Bear', 'battlefield'), rod: find(s0, 'Test Rod', 'battlefield') };
  };
  it('is automated', () => expect(full(ROD)).toBe(true));
  it('while the Rod stays tapped the target has no abilities and can\'t attack; another creature attacks as before', () => {
    const { s: s0, flier, bear, rod } = board();
    expect(attackers(s0)).toEqual(expect.arrayContaining([flier, bear]));
    const s = resolveStack(activate(s0, rod, [target(flier)]));
    expect(s.objects[rod]!.tapped).toBe(true);
    expect(kw(s, flier)).not.toContain('flying');
    expect(attackers(s)).not.toContain(flier);
    expect(attackers(s)).toContain(bear);
  });
  it('when the Rod untaps the target has its abilities again and may attack (the duration is "for as long as ~ remains tapped")', () => {
    const { s: s0, flier, rod } = board();
    const s = tweak(resolveStack(activate(s0, rod, [target(flier)])), (t) => { t.objects[rod]!.tapped = false; });
    expect(kw(s, flier)).toContain('flying');
    expect(attackers(s)).toContain(flier);
  });
});

describe('CR 109.4, 108.3, 613.1d, 613.1f, 613.4c: "Each creature you control but don\'t own gets +2/+2, has menace and deathtouch, and is a Pirate in addition to its other types."', () => {
  const RAIDER = card('Test Raider', 'Creature — Human Pirate', 'Each creature you control but don\'t own gets +2/+2, has menace and deathtouch, and is a Pirate in addition to its other types.', ['2', '2']);
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  it('a creature you control but another player owns gets it; your own creatures and the opponent\'s do not', () => {
    const s0 = scenario([], { defs: [RAIDER, BEAR], p1: { battlefield: ['Test Raider', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    let taken = '' as ObjectId;
    const stolen = tweak(s0, (t) => { taken = put(t, 'p2', 'battlefield', 'Test Bear'); t.objects[taken]!.controller = 'p1'; });
    const c = getChars(stolen, taken)!;
    expect(pt(stolen, taken)).toBe('4/4');
    expect(kw(stolen, taken)).toEqual(expect.arrayContaining(['menace', 'deathtouch']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Bear', 'Pirate']));
    expect(pt(stolen, mine)).toBe('2/2');
    expect(getChars(stolen, mine)!.subtypes).not.toContain('Pirate');
    expect(pt(stolen, theirs)).toBe('2/2');
    expect(kw(stolen, theirs)).not.toContain('menace');
  });
});

describe('CR 205.3i, 205.3m, 305.6, 613.1d: "Each land with an everything counter on it is every land type in addition to its other types." / "Each nonland creature with an everything counter on it is every creature type."', () => {
  const QUEEN = card('Test Queen', 'Legendary Creature — Shapeshifter', 'Each land with an everything counter on it is every land type in addition to its other types.\nEach nonland creature with an everything counter on it is every creature type.', ['3', '3']);
  const WASTE = card('Test Waste', 'Land', '');
  const ARBOR = card('Test Arbor', 'Land Creature — Forest Dryad', '', ['1', '1']);
  const board = (): GameState => scenario([], { defs: [QUEEN, WASTE, BEAR, ARBOR], p1: { battlefield: ['Test Queen', { name: 'Test Waste', counters: { everything: 1 } }, 'Test Waste', { name: 'Test Bear', counters: { everything: 1 } }, 'Test Bear', { name: 'Test Arbor', counters: { everything: 1 } }] } });
  it('is automated', () => expect(full(QUEEN)).toBe(true));
  it('a land with the counter has every land type (basic and nonbasic) besides its own; a land without it has none', () => {
    const s = board();
    const [withC, without] = findAll(s, 'Test Waste', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const counted = [withC, without].find((id) => (s.objects[id]!.counters['everything'] ?? 0) > 0)!;
    const bare = [withC, without].find((id) => id !== counted)!;
    expect(getChars(s, counted)!.subtypes).toEqual(expect.arrayContaining(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Gate', 'Tower', "Urza's", 'Power-Plant']));
    expect(getChars(s, bare)!.subtypes).toEqual([]);
  });
  it('a nonland creature with the counter is every creature type; one without it keeps only its own; a land creature is not "nonland" (it gets every land type only)', () => {
    const s = board();
    const [bearC, bear] = findAll(s, 'Test Bear', 'battlefield', 'p1').sort((a, b) => (s.objects[b]!.counters['everything'] ?? 0) - (s.objects[a]!.counters['everything'] ?? 0)) as [ObjectId, ObjectId];
    expect(getChars(s, bearC)!.subtypes.length).toBeGreaterThan(20);
    expect(getChars(s, bearC)!.subtypes).toEqual(expect.arrayContaining(['Bear', 'Elf', 'Goblin']));
    expect(getChars(s, bear)!.subtypes).toEqual(['Bear']);
    const arbor = find(s, 'Test Arbor', 'battlefield');
    const a = getChars(s, arbor)!;
    expect(a.subtypes).toEqual(expect.arrayContaining(['Dryad', 'Gate', 'Mountain']));
    expect(a.subtypes).not.toContain('Goblin');
  });
});

describe('CR 604.3, 613.4b, 611.2a: a GRANTED "power and toughness are each equal to ..." is not a characteristic-defining ability: it sets base power and toughness in layer 7b by timestamp', () => {
  const REALIZED = card('Test Realized', 'Enchantment', '{0}: Until end of turn, ~ becomes a Monk Avatar creature in addition to its other types and gains "~\'s power and toughness are each equal to the number of lore counters on it."');
  const LULL = card('Test Lull', 'Artifact', '{0}: Target permanent has base power and toughness 5/5 until end of turn.');
  const board = (): GameState => scenario([], { defs: [REALIZED, LULL], p1: { battlefield: [{ name: 'Test Realized', counters: { lore: 3 } }, 'Test Lull'] } });
  it('is automated', () => expect(full(REALIZED)).toBe(true));
  it('it becomes a Monk Avatar creature enchantment as big as its lore counters', () => {
    const s0 = board();
    const id = find(s0, 'Test Realized', 'battlefield');
    const s = resolveStack(activate(s0, id));
    const c = getChars(s, id)!;
    expect(c.types).toEqual(expect.arrayContaining(['Enchantment', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Monk', 'Avatar']));
    expect(pt(s, id)).toBe('3/3');
    expect(getChars(board(), id)!.types).not.toContain('Creature');
  });
  it('an earlier "base power and toughness 5/5" effect does not beat the later grant (layer 7b, timestamp order): 3/3, not 5/5 (a characteristic-defining ability would lose to it)', () => {
    const s0 = board();
    const id = find(s0, 'Test Realized', 'battlefield');
    const lull = resolveStack(activate(s0, find(s0, 'Test Lull', 'battlefield'), [target(id)]));
    const s = resolveStack(activate(lull, id));
    expect(pt(s, id)).toBe('3/3');
  });
});

describe('CR 604.3a (2): a token\'s own quoted ability (part of the token) stays a CDA; the same words granted LATER, to a token or not, are not', () => {
  const MAKER = card('Test Maker', 'Artifact', '{0}: Create a green Elephant creature token with "This token\'s power and toughness are each equal to the number of lands you control."');
  const SHRINKER = card('Test Shrinker', 'Enchantment', 'Creatures you control have base power and toughness 1/1.');
  const GIVER = card('Test Giver', 'Artifact', '{0}: Until end of turn, target creature becomes a Monk creature in addition to its other types and gains "This creature\'s power and toughness are each equal to the number of lands you control."');
  const base = (): GameState => scenario(['Forest'], { defs: [MAKER, SHRINKER, GIVER, BEAR], p1: { battlefield: ['Test Shrinker', 'Test Maker', 'Test Giver', 'Test Bear', 'Forest', 'Forest', 'Forest'] } });
  it('all are automated', () => { for (const d of [MAKER, SHRINKER, GIVER]) expect(full(d)).toBe(true); });
  it('an older static "base 1/1" beats the token\'s own CDA (7a before 7b): 1/1', () => {
    let s = base();
    s = resolveStack(activate(s, find(s, 'Test Maker', 'battlefield')));
    const tok = s.zones.battlefield.find((i) => s.objects[i]!.kind === 'token')!;
    expect(pt(s, tok)).toBe('1/1');
  });
  it('granted later it is set in 7b by timestamp and wins over the older static: 3/3, for a token as for a card', () => {
    let s = base();
    s = resolveStack(activate(s, find(s, 'Test Maker', 'battlefield')));
    const tok = s.zones.battlefield.find((i) => s.objects[i]!.kind === 'token')!;
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveStack(activate(s, find(s, 'Test Giver', 'battlefield'), [target(tok)]));
    s = resolveStack(activate(s, find(s, 'Test Giver', 'battlefield'), [target(bear)]));
    expect(pt(s, tok)).toBe('3/3');
    expect(pt(s, bear)).toBe('3/3');
  });
});
