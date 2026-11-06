/**
 * Coordinator D, round edh-d-21 (lane type-change): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case. CR cites are from the Comprehensive Rules of
 * 2026-09-25 (media.wizards.com text, fetched 2026-11-03).
 *
 *   CR 205.1b, 611.2b, 613.1d   "That land is a Swamp in addition to its other types for as long as it has a blorp counter on it."
 *   CR 205.1b, 611.2a, 613.1d   "Return target artifact card from your graveyard to the battlefield. It's a 1/1 Spirit creature with flying in addition to its other types."
 *   CR 205.1b, 611.2a, 613.1d   "Return all creature cards from your graveyard to the battlefield. Each of them is a 1/1 Spirit with flying in addition to its other types."
 *   CR 105.3, 205.1b, 613.1e    "Each of those creatures is a black Zombie in addition to its other colors and types."
 *   CR 205.2a, 205.3m, 115.1    "Return target artifact or non-Aura enchantment card from your graveyard to the battlefield." (the shared word "card")
 *   CR 604.1, 611.3a, 613.1d    "As long as ~ has two or more blorp counters on it, it's a Phyrexian creature in addition to its other types."
 *   CR 604.1, 613.1d, 613.1f    "Each creature your opponents control is an Illusion in addition to its other types and has flying."
 *   CR 303.4, 613.1d, 613.4c    "Enchanted creature gets +1/+1 and has flying. It's a Dragon in addition to its other types."
 *   CR 205.3m, 607.2d, 613.1d   "Each creature card in your graveyard has the chosen creature type in addition to its other types."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { find, findAll, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { activate, cast, target } from '../../m5/cr-examples/helpers';
import { resolveStack } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const subs = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.subtypes].sort();
const hasKeyword = (s: GameState, id: ObjectId, kw: string): boolean => getChars(s, id)!.abilities.some((a) => (a as { def?: { kind?: string; keyword?: string } }).def?.keyword === kw || JSON.stringify(a).includes(`"keyword":"${kw}"`));
const setCounters = (s: GameState, id: ObjectId, counters: Record<string, number>): GameState => tweak(s, (t) => { t.objects[id]!.counters = { ...counters }; });

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{0}', ['W']);
const IDOL = card('Test Idol', 'Artifact', '');

// ---- "That land is a Swamp in addition to its other types for as long as it has a blorp counter on it." -------------------------------------------------------------------
const CALLER = card('Test Floodcaller', 'Creature — Wizard', '{T}: Put a blorp counter on target land. That land is a Swamp in addition to its other types for as long as it has a blorp counter on it.', ['1', '1']);
describe('CR 205.1b, 611.2b, 613.1d: "That land is a Swamp in addition to its other types for as long as it has a blorp counter on it" (the type lasts while the object has the counter)', () => {
  it('is automated', () => expect(full(CALLER)).toBe(true));
  it('the targeted Plains is a Plains Swamp while it has the counter; the other Plains is not; with the counter gone it is a Plains again', () => {
    let s = scenario(['Plains'], { defs: [CALLER], p1: { battlefield: ['Test Floodcaller', 'Plains', 'Plains'] } });
    const [p1, p2] = findAll(s, 'Plains', 'battlefield', 'p1') as [ObjectId, ObjectId];
    s = activate(s, find(s, 'Test Floodcaller', 'battlefield'), [target(p1)]);
    s = resolveStack(s);
    expect(s.objects[p1]!.counters['blorp']).toBe(1);
    expect(subs(s, p1)).toEqual(['Plains', 'Swamp']);
    expect(subs(s, p2)).toEqual(['Plains']);
    s = setCounters(s, p1, {});
    expect(subs(s, p1)).toEqual(['Plains']); // negative: the counter is gone, so is the type (CR 611.2b: the duration is about the object's own state)
  });
});

// ---- "Return ... to the battlefield. It's a 1/1 Spirit creature with flying in addition to its other types." ------------------------------------------------------------------
const RAISER = card('Test Raiser', 'Sorcery', "Return target artifact card from your graveyard to the battlefield. It's a 1/1 Spirit creature with flying in addition to its other types.");
describe('CR 205.1b, 611.2a, 613.1d, 613.4b: "It\'s a 1/1 Spirit creature with flying in addition to its other types" (the card that came back, and only it)', () => {
  it('is automated', () => expect(full(RAISER)).toBe(true));
  it('the returned artifact is an Artifact Creature Spirit 1/1 with flying; an artifact already on the battlefield is not changed', () => {
    let s = scenario([], { defs: [RAISER, IDOL], p1: { hand: ['Test Raiser'], graveyard: ['Test Idol'], battlefield: ['Test Idol'] } });
    const inGy = find(s, 'Test Idol', 'graveyard', 'p1');
    const onBf = find(s, 'Test Idol', 'battlefield', 'p1');
    s = cast(s, 'Test Raiser', [target(inGy)]);
    s = resolveStack(s);
    const back = findAll(s, 'Test Idol', 'battlefield', 'p1').find((id) => id !== onBf)!;
    expect(back).toBeDefined();
    const c = getChars(s, back)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(subs(s, back)).toEqual(['Spirit']);
    expect(pt(s, back)).toBe('1/1');
    expect(hasKeyword(s, back, 'flying')).toBe(true);
    expect(getChars(s, onBf)!.types).not.toContain('Creature'); // negative
    expect(pt(s, onBf)).not.toBe('1/1');
  });
});

const STORM = card('Test Stormcall', 'Sorcery', 'Return all creature cards from your graveyard to the battlefield. Each of them is a 1/1 Spirit with flying in addition to its other types.');
describe('CR 205.1b, 611.2a, 613.4b: "Return all creature cards from your graveyard to the battlefield. Each of them is a 1/1 Spirit with flying in addition to its other types"', () => {
  it('is automated', () => expect(full(STORM)).toBe(true));
  it('every returned creature is a 1/1 Bear Spirit with flying; a Bear that was already on the battlefield is still a 2/2 without flying', () => {
    let s = scenario([], { defs: [STORM, BEAR], p1: { hand: ['Test Stormcall'], graveyard: ['Test Bear', 'Test Bear'], battlefield: ['Test Bear'] } });
    const stay = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Stormcall');
    s = resolveStack(s);
    const back = findAll(s, 'Test Bear', 'battlefield', 'p1').filter((id) => id !== stay);
    expect(back).toHaveLength(2);
    for (const id of back) {
      expect(subs(s, id)).toEqual(['Bear', 'Spirit']);
      expect(pt(s, id)).toBe('1/1');
      expect(hasKeyword(s, id, 'flying')).toBe(true);
    }
    expect(subs(s, stay)).toEqual(['Bear']); // negative
    expect(pt(s, stay)).toBe('2/2');
    expect(hasKeyword(s, stay, 'flying')).toBe(false);
  });
});

// ---- colors and types ------------------------------------------------------------------------------------------------------------------------------------------------------
const AFTER = card('Test Afterlife', 'Sorcery', 'Return up to two target creature cards from your graveyard to the battlefield. Each of those creatures is a black Zombie in addition to its other colors and types.');
describe('CR 105.3, 205.1b, 613.1e: "Each of those creatures is a black Zombie in addition to its other colors and types" (colors added, not set)', () => {
  it('is automated', () => expect(full(AFTER)).toBe(true));
  it('a returned white Bear is white and black, a Bear Zombie; another white Bear that stayed on the battlefield is only white', () => {
    let s = scenario([], { defs: [AFTER, BEAR], p1: { hand: ['Test Afterlife'], graveyard: ['Test Bear'], battlefield: ['Test Bear'] } });
    const stay = find(s, 'Test Bear', 'battlefield', 'p1');
    const gy = find(s, 'Test Bear', 'graveyard', 'p1');
    s = cast(s, 'Test Afterlife', [target(gy)]);
    s = resolveStack(s);
    const back = findAll(s, 'Test Bear', 'battlefield', 'p1').find((id) => id !== stay)!;
    expect([...getChars(s, back)!.colors].sort()).toEqual(['B', 'W']);
    expect(subs(s, back)).toEqual(['Bear', 'Zombie']);
    expect([...getChars(s, stay)!.colors]).toEqual(['W']); // negative
    expect(subs(s, stay)).toEqual(['Bear']);
  });
});

// ---- the shared word "card" ------------------------------------------------------------------------------------------------------------------------------------------------
const RECALL = card('Test Recall', 'Sorcery', 'Return target artifact or non-Aura enchantment card from your graveyard to the battlefield.');
const SHRINE = card('Test Shrine', 'Enchantment', '');
const BLESS = card('Test Blessing', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
describe('CR 205.2a, 205.3m, 115.1: "target artifact or non-Aura enchantment card" (an artifact card, or an enchantment card that is not an Aura)', () => {
  it('is automated', () => expect(full(RECALL)).toBe(true));
  const targets = (name: string): boolean => {
    const s = scenario([], { defs: [RECALL, IDOL, SHRINE, BLESS, BEAR], p1: { hand: ['Test Recall'], graveyard: [name] } });
    const id = find(s, name, 'graveyard', 'p1');
    try { const t = resolveStack(cast(s, 'Test Recall', [target(id)])); return t.zones.battlefield.filter((b) => t.objects[b]?.defId === name).length === 1; } catch { return false; }
  };
  it('an artifact card and a non-Aura enchantment card can be returned', () => {
    expect(targets('Test Idol')).toBe(true);
    expect(targets('Test Shrine')).toBe(true);
  });
  it('negative: an Aura card and a creature card cannot be the target', () => {
    expect(targets('Test Blessing')).toBe(false);
    expect(targets('Test Bear')).toBe(false);
  });
});

// ---- "As long as ~ has two or more blorp counters on it, it's a Phyrexian creature in addition to its other types." ------------------------------------------------------------
const SHIP = card('Test Hulk', 'Artifact — Vehicle', "As long as ~ has two or more blorp counters on it, it's a Phyrexian creature in addition to its other types.", ['3', '3']);
describe('CR 604.1, 611.3a, 613.1d: "As long as ~ has two or more blorp counters on it, it\'s a Phyrexian creature in addition to its other types"', () => {
  it('is automated', () => expect(full(SHIP)).toBe(true));
  it('with two counters it is an Artifact Creature Phyrexian Vehicle; with one it is only a Vehicle artifact', () => {
    let s = scenario([], { defs: [SHIP], p1: { battlefield: ['Test Hulk'] } });
    const id = find(s, 'Test Hulk', 'battlefield', 'p1');
    expect(getChars(s, id)!.types).not.toContain('Creature');
    s = setCounters(s, id, { blorp: 1 });
    expect(getChars(s, id)!.types).not.toContain('Creature'); // negative: one counter is not enough
    s = setCounters(s, id, { blorp: 2 });
    expect(getChars(s, id)!.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(subs(s, id)).toEqual(['Phyrexian', 'Vehicle']);
  });
});

// ---- group static ----------------------------------------------------------------------------------------------------------------------------------------------------------
const DREAM = card('Test Dreamfield', 'Enchantment', 'Each creature your opponents control is an Illusion in addition to its other types and has flying.');
describe('CR 604.1, 613.1d, 613.1f: "Each creature your opponents control is an Illusion in addition to its other types and has flying"', () => {
  it('is automated', () => expect(full(DREAM)).toBe(true));
  it('an opponent\'s Bear is a Bear Illusion with flying; the controller\'s own Bear is not changed', () => {
    const s = scenario([], { defs: [DREAM, BEAR], p1: { battlefield: ['Test Dreamfield', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(subs(s, theirs)).toEqual(['Bear', 'Illusion']);
    expect(hasKeyword(s, theirs, 'flying')).toBe(true);
    expect(subs(s, mine)).toEqual(['Bear']); // negative
    expect(hasKeyword(s, mine, 'flying')).toBe(false);
  });
});

const DREAM2 = card('Test Dreamsnare', 'Enchantment', 'Each creature your opponents control is an Illusion in addition to its other types and has "When this creature becomes the target of a spell or ability, sacrifice it."');
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to target creature.');
describe('CR 603.2, 701.21a, 613.1f: the ability each opposing creature is given by "has \"When this creature becomes the target of a spell or ability, sacrifice it.\""', () => {
  it('is automated', () => expect(full(DREAM2)).toBe(true));
  it('targeting an opponent\'s creature gets it sacrificed (the trigger resolves before the spell); targeting your own creature does nothing to it', () => {
    const base = () => scenario([], { defs: [DREAM2, BEAR, ZAP], p1: { hand: ['Test Zap'], battlefield: ['Test Dreamsnare', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    let s = base();
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveStack(cast(s, 'Test Zap', [target(theirs)]));
    expect(s.zones.battlefield.includes(theirs)).toBe(false);
    expect(s.zones.graveyard['p2']!.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
    let t = base();
    const mine = find(t, 'Test Bear', 'battlefield', 'p1');
    t = resolveStack(cast(t, 'Test Zap', [target(mine)]));
    expect(t.zones.battlefield.some((id) => t.objects[id]!.defId === 'Test Bear' && t.objects[id]!.controller === 'p1')).toBe(true); // negative: only 1 damage to a 2/2, no sacrifice
  });
});

// ---- Aura, two sentences ---------------------------------------------------------------------------------------------------------------------------------------------------
const SCALES = card('Test Scales', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +1/+1 and has flying and \"{2}: This creature gets +0/+1 until end of turn.\" It's a Dragon in addition to its other types.");
describe('CR 303.4, 613.1d, 613.4c: "Enchanted creature gets +1/+1 and has flying. It\'s a Dragon in addition to its other types"', () => {
  it('is automated', () => expect(full(SCALES)).toBe(true));
  it('the enchanted Bear is a 3/3 Bear Dragon with flying; another Bear is unchanged', () => {
    const s0 = scenario([], { defs: [SCALES, BEAR], p1: { battlefield: ['Test Bear', 'Test Bear'] } });
    const [bear, other] = findAll(s0, 'Test Bear', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const s = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Scales')]!.attachedTo = bear; });
    expect(subs(s, bear)).toEqual(['Bear', 'Dragon']);
    expect(pt(s, bear)).toBe('3/3');
    expect(hasKeyword(s, bear, 'flying')).toBe(true);
    expect(subs(s, other)).toEqual(['Bear']); // negative
    expect(pt(s, other)).toBe('2/2');
  });
});

// ---- the chosen creature type for cards in a graveyard ---------------------------------------------------------------------------------------------------------------------
const ASHES = card('Test Ashes', 'Artifact', 'As this artifact enters, choose a creature type.\nEach creature card in your graveyard has the chosen creature type in addition to its other types.');
describe('CR 205.3m, 607.2d, 613.1d: "Each creature card in your graveyard has the chosen creature type in addition to its other types"', () => {
  it('is automated', () => expect(full(ASHES)).toBe(true));
  it('with Elf chosen, a Bear card in its owner\'s graveyard is a Bear Elf; a Bear card in the other graveyard and a Bear on the battlefield are not', () => {
    let s = scenario([], { defs: [ASHES, BEAR], p1: { hand: ['Test Ashes'], graveyard: ['Test Bear'], battlefield: ['Test Bear'] }, p2: { graveyard: ['Test Bear'] } });
    const mineGy = find(s, 'Test Bear', 'graveyard', 'p1');
    const theirGy = find(s, 'Test Bear', 'graveyard', 'p2');
    const onBf = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveStack(cast(s, 'Test Ashes'), [{ kind: 'chooseName', name: 'Elf' }]);
    expect(subs(s, mineGy)).toEqual(['Bear', 'Elf']);
    expect(subs(s, theirGy)).toEqual(['Bear']); // negative
    expect(subs(s, onBf)).toEqual(['Bear']);
  });
});

// ---- a card a replacement effect exiled instead is not "it" ---------------------------------------------------------------------------------------------------------------
const PRIEST = card('Test Priest', 'Creature — Cleric', "If a nontoken creature would enter and it wasn't cast, exile it instead.", ['2', '2']);
describe('CR 400.7, 608.2c, 614.1: "Return ... to the battlefield. Each of them is a 1/1 Spirit..." only changes what was put onto the battlefield', () => {
  it('under a replacement that exiles it instead, the Bear card in exile stays a 2/2 Bear', () => {
    let s = scenario([], { defs: [STORM, BEAR, PRIEST], p1: { hand: ['Test Stormcall'], graveyard: ['Test Bear'], battlefield: ['Test Priest'] } });
    s = resolveStack(cast(s, 'Test Stormcall'));
    const ex = s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Bear');
    expect(ex).toHaveLength(1);
    expect(subs(s, ex[0]!)).toEqual(['Bear']);
    expect(pt(s, ex[0]!)).toBe('2/2');
  });
});
