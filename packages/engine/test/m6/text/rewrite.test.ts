/**
 * M6-8 (m6 design 3.5, D9, E9): statics/text-change.ts as pure functions. `rewriteAbility` changes exactly the typed positions where a word is used as a word of
 * its kind (CR 612.2): never a mana symbol, never a name; `applyWordChange` rewrites the abilities that are rules text of the object (CR 612.3) and only
 * where their text uses the word (fail closed), and the words of the type line (CR 612.1, 612.4); `wordChangeOf` reads the two words.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasQuality, type AbilityDef, type GameState, type OracleCard } from '../../../src/index';
import type { Chars } from '../../../src/rules/characteristics';
import type { CharAbility } from '../../../src/statics/api';
import { localIndex } from '../../m5/parser/support';
import { cast, color, find, islands, resolveTop, scenario, target } from './support';
import { applyWordChange, LAYER_3, mentionsWord, printedPlural, rewriteAbility, rewriteText, wordChangeOf, type WordChange } from '../../../src/statics/text-change';

const RED_BLUE: WordChange = { kind: 'color', from: 'R', to: 'U' };
const GOBLIN_ELF: WordChange = { kind: 'creatureType', from: 'Goblin', to: 'Elf' };
const SWAMP_ISLAND: WordChange = { kind: 'landType', from: 'Swamp', to: 'Island' };

const ability = (a: unknown): AbilityDef => a as AbilityDef;
const BLACK_RED: WordChange = { kind: 'color', from: 'B', to: 'R' };
const BLUE_BLACK: WordChange = { kind: 'color', from: 'U', to: 'B' };

function chars(abilities: CharAbility[], extra: Partial<Chars> = {}): Chars {
  return {
    name: 'Test Glamer', names: ['Test Glamer'], face: 0, combined: false, manaCost: null, manaValue: 0, colors: [], supertypes: [], types: ['Creature'], subtypes: [],
    abilities, keywords: [], controller: 'p1', cantHave: [], ...extra,
  } as Chars;
}
const printed = (def: AbilityDef, index = 0): CharAbility => ({ key: `p:0:${index}`, origin: 'printed', face: 0, index, def });

describe('CR 612.2: rewriteAbility changes the words used as words of their kind', () => {
  it('color words: filters (colors, notColors), layer 5 changes, tokens, devotion, protection, a color choice and the condition that reads it', () => {
    const def = ability({
      kind: 'spell', text: 'Destroy target nonred creature. Red creatures become red. Create a red Goblin. Devotion to red. Protection from red. Choose red or green.',
      effect: {
        targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target nonred creature', filter: { types: ['Creature'], notColors: ['R'] } }],
        steps: [
          { op: 'effect', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { colors: ['R', 'G'] } }, mods: [{ layer: 5, colors: { set: ['R'] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'protection', quality: 'color:R', text: 'protection from red' }] }] }] },
          { op: 'createToken', who: { ref: 'you' }, count: { q: 'devotion', to: ['R', 'B'], of: { ref: 'you' } }, token: { colors: ['R'], types: ['Creature'], subtypes: ['Goblin'] } },
          { op: 'chooseValue', who: { ref: 'you' }, what: 'color', as: 'c', link: 'c', options: ['red', 'green'] },
          { op: 'if', cond: { cond: 'chosen', link: 'c', equals: 'R' }, then: [{ op: 'addMana', who: { ref: 'you' }, units: [['R']] }] },
        ],
      },
    });
    const out = rewriteAbility(def, RED_BLUE) as Extract<AbilityDef, { kind: 'spell' }>;
    const steps = out.effect.steps as unknown as Record<string, unknown>[];
    expect(out.effect.targets[0]!.filter).toEqual({ types: ['Creature'], notColors: ['U'] });
    expect(steps[0]).toMatchObject({ effects: [{ affects: { ref: 'each', filter: { colors: ['U', 'G'] } }, mods: [{ layer: 5, colors: { set: ['U'] } }, { layer: 6, add: [{ quality: 'color:U', text: 'protection from blue' }] }] }] });
    expect(steps[1]).toMatchObject({ count: { q: 'devotion', to: ['U', 'B'] }, token: { colors: ['U'], subtypes: ['Goblin'] } });
    expect(steps[2]!['options']).toEqual(['blue', 'green']);
    expect(steps[3]).toMatchObject({ cond: { equals: 'U' }, then: [{ op: 'addMana', units: [['R']] }] }); // CR 612.2: {R} is a mana symbol, not a word
    expect(out.text).toBe('Destroy target nonblue creature. Blue creatures become blue. Create a blue Goblin. Devotion to blue. Protection from blue. Choose blue or green.');
    expect(def).not.toBe(out);
  });

  it('a change that makes two values the same keeps one ("red or blue" with red -> blue is "blue")', () => {
    const def = ability({ kind: 'static', text: 'Red or blue creatures get +1/+1.', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { colors: ['R', 'U'] } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] });
    expect((rewriteAbility(def, RED_BLUE) as unknown as { effects: { affects: { filter: unknown } }[] }).effects[0]!.affects.filter).toEqual({ colors: ['U'] });
  });

  it('CR 612.2a: creature types: filters, layer 4 changes, a token\'s subtypes and the name it is given by them; protection from Goblins', () => {
    const def = ability({
      kind: 'spell', text: 'Create a Goblin named Goblin. Other Goblins are Goblins. Protection from Goblins. non-Goblin.',
      effect: {
        targets: [],
        steps: [
          { op: 'createToken', who: { ref: 'you' }, count: 1, token: { name: 'Goblin', colors: ['R'], types: ['Creature'], subtypes: ['Goblin', 'Warrior'] } },
          { op: 'effect', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Goblin'], notSubtypes: ['Goblin'] } }, mods: [{ layer: 4, subtypes: { add: ['Goblin'], remove: ['Wall'] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'protection', quality: 'subtype:goblins', text: 'protection from Goblins' }] }] }] },
        ],
      },
    });
    const out = rewriteAbility(def, GOBLIN_ELF, ['Goblin King']) as Extract<AbilityDef, { kind: 'spell' }>;
    const steps = out.effect.steps as unknown as Record<string, unknown>[];
    expect(steps[0]).toMatchObject({ token: { name: 'Elf', subtypes: ['Elf', 'Warrior'] } });
    expect(steps[1]).toMatchObject({ effects: [{ affects: { filter: { subtypes: ['Elf'], notSubtypes: ['Elf'] } }, mods: [{ layer: 4, subtypes: { add: ['Elf'], remove: ['Wall'] } }, { layer: 6, add: [{ quality: 'subtype:elves' }] }] }] });
    expect(hasQuality({ colors: [], types: ['Creature'], subtypes: ['Elf'], supertypes: [] }, 'subtype:elves')).toBe(true); // rules/quality.ts reads the new plural
    expect(out.text).toBe('Create a Elf named Elf. Other Elves are Elves. Protection from Elves. non-Elf.');
  });

  it('land types: landwalk\'s words, a type filter (landcycling), "swampwalk" and "Swamps" in the text', () => {
    const def = ability({ kind: 'keyword', keyword: 'landwalk', quality: 'snow swamp', text: 'Snow swampwalk' });
    expect(rewriteAbility(def, SWAMP_ISLAND)).toEqual({ kind: 'keyword', keyword: 'landwalk', quality: 'snow island', text: 'Snow islandwalk' });
    const cycle = ability({ kind: 'activated', text: 'Swampcycling {2}', cost: { mana: '{2}' }, effect: { targets: [], steps: [{ op: 'search', who: { ref: 'you' }, zone: 'library', filter: { subtypes: ['Swamp'] }, max: 1, as: 'found' }] } });
    expect(rewriteAbility(cycle, SWAMP_ISLAND)).toMatchObject({ text: 'Islandcycling {2}', cost: { mana: '{2}' }, effect: { steps: [{ filter: { subtypes: ['Island'] } }] } });
    expect(rewriteText('Swamps you control have swampwalk.', SWAMP_ISLAND)).toBe('Islands you control have islandwalk.');
  });

  it('CR 612.2: a name is never changed (the object\'s names are protected in the text), and a word inside another word is not a word', () => {
    expect(rewriteText('Whenever Goblin King attacks, other Goblins get +1/+1.', GOBLIN_ELF, ['Goblin King'])).toBe('Whenever Goblin King attacks, other Elves get +1/+1.');
    expect(rewriteText('Redirect it. Shred it. Tired red creatures.', RED_BLUE)).toBe('Redirect it. Shred it. Tired blue creatures.');
    expect(mentionsWord('Red Elemental Blast deals damage.', RED_BLUE, ['Red Elemental Blast'])).toBe(false);
    expect(printedPlural('Elf')).toBe('Elves');
    expect(printedPlural('Plains')).toBe('Plains');
  });

  it('CR 612.2: a hybrid mana symbol in a cost is not a word ({1}{B/G} stays {1}{B/G}, {U/B} with blue -> black stays {U/B}, {U/B/P} too)', () => {
    const cost = [{ kind: 'generic', amount: 1 }, { kind: 'hybrid', colors: ['B', 'G'] }];
    const def = ability({
      kind: 'activated', text: '{1}{B/G}, Exile ~ from your graveyard: Create a 2/2 black and green Elf creature token.', cost: { mana: cost, other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1, self: true }] },
      effect: { targets: [], steps: [{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { colors: ['B', 'G'], types: ['Creature'], subtypes: ['Elf'], power: 2, toughness: 2 } }] },
    });
    const out = rewriteAbility(def, BLACK_RED) as Extract<AbilityDef, { kind: 'activated' }>;
    expect(out.cost).toEqual({ mana: [{ kind: 'generic', amount: 1 }, { kind: 'hybrid', colors: ['B', 'G'] }], other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1, self: true }] });
    expect(out.effect.steps[0]).toMatchObject({ token: { colors: ['R', 'G'] } }); // the word "black" is still changed
    expect(out.text).toBe('{1}{B/G}, Exile ~ from your graveyard: Create a 2/2 red and green Elf creature token.');
    // a change between a symbol's own two colors would make a one-color hybrid symbol; a granted ability's cost inside a static ability is a cost too
    const grant = ability({
      kind: 'static', text: 'Other blue creatures you control have "{U/B}: Draw a card." and "{U/B/P}: Scry 1."', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { colors: ['U'] } }, mods: [{ layer: 6, add: [
        { kind: 'activated', text: '{U/B}: Draw a card.', cost: { mana: [{ kind: 'hybrid', colors: ['U', 'B'] }] }, effect: { targets: [], steps: [] } },
        { kind: 'activated', text: '{U/B/P}: Scry 1.', cost: { mana: [{ kind: 'hybridPhyrexian', colors: ['U', 'B'] }] }, effect: { targets: [], steps: [] } },
      ] }] }],
    });
    const g = rewriteAbility(grant, BLUE_BLACK) as unknown as { effects: { affects: { filter: unknown }; mods: { add: { cost: unknown }[] }[] }[] };
    expect(g.effects[0]!.affects.filter).toEqual({ colors: ['B'] });
    expect(g.effects[0]!.mods[0]!.add.map((a) => a.cost)).toEqual([{ mana: [{ kind: 'hybrid', colors: ['U', 'B'] }] }, { mana: [{ kind: 'hybridPhyrexian', colors: ['U', 'B'] }] }]);
  });

  it('is pure: the input is never edited, an unchanged ability is the same object, and a frozen one is rewritten once (memo)', () => {
    const def = Object.freeze(ability({ kind: 'keyword', keyword: 'protection', quality: 'color:R', text: 'Protection from red' }));
    const a = rewriteAbility(def, RED_BLUE);
    expect(rewriteAbility(def, RED_BLUE)).toBe(a);
    expect(def).toEqual({ kind: 'keyword', keyword: 'protection', quality: 'color:R', text: 'Protection from red' });
    // cached versus uncached (docs/ARCHITECTURE.md, memos): the memo of a frozen definition gives what the walk of an unfrozen copy gives
    const spell = ability({ kind: 'static', text: 'Red creatures have protection from red.', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { colors: ['R'] } }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'protection', quality: 'color:R', text: 'protection from red' }] }] }] });
    expect(rewriteAbility(Object.freeze(JSON.parse(JSON.stringify(spell))) as AbilityDef, RED_BLUE, ['X'])).toEqual(rewriteAbility(spell, RED_BLUE, ['X']));
    expect(Object.isFrozen(rewriteAbility(Object.freeze(JSON.parse(JSON.stringify(spell))) as AbilityDef, RED_BLUE))).toBe(true);
    const flying = ability({ kind: 'keyword', keyword: 'flying', text: 'Flying' });
    expect(rewriteAbility(flying, RED_BLUE)).toBe(flying);
  });
});

describe('applyWordChange (the layer 3 applier, CR 612.1-612.4)', () => {
  it('CR 612.3: only abilities that are rules text of the object (printed, keyword, copied) change; a granted one and a rule one keep their words', () => {
    const prot = ability({ kind: 'keyword', keyword: 'protection', quality: 'color:R', text: 'Protection from red' });
    const c = chars([
      printed(prot),
      { key: 'c:e1:0:0', origin: 'copied', face: 0, index: 0, def: prot },
      { key: 'g:e2:0', origin: 'granted', face: 0, index: -1, def: prot, grantedBy: 'e2' },
    ]);
    const out = applyWordChange(c, RED_BLUE);
    expect(out.abilities.map((a) => (a.def as { quality?: string }).quality)).toEqual(['color:U', 'color:U', 'color:R']);
    expect(out.abilities.map((a) => a.key)).toEqual(['p:0:0', 'c:e1:0:0', 'g:e2:0']); // the same abilities, changed
    expect(out.keywords.map((k) => k.quality)).toEqual(['color:U', 'color:U', 'color:R']);
  });

  it('fail closed: an ability whose text does not use the word keeps every typed value ("protection from the color of your choice" enumerates R)', () => {
    const choice = ability({
      kind: 'activated', text: '{W}: ~ gains protection from the color of your choice until end of turn.', cost: { mana: '{W}' },
      effect: { targets: [], steps: [
        { op: 'chooseValue', who: { ref: 'you' }, what: 'color', as: 'p', link: 'p' },
        { op: 'if', cond: { cond: 'chosen', link: 'p', equals: 'R' }, then: [{ op: 'effect', effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'protection', quality: 'color:R', text: 'protection from red' }] }] }] }] },
      ] },
    });
    const c = chars([printed(choice)]);
    expect(applyWordChange(c, RED_BLUE)).toBe(c);
  });

  it('a keyword\'s expansion is rewritten when its keyword\'s text uses the word (the expansion\'s own text may not)', () => {
    const kw = ability({ kind: 'keyword', keyword: 'typecycling', text: 'Swampcycling {2}', filter: { subtypes: ['Swamp'] } });
    const expansion = ability({ kind: 'activated', text: '', cost: { mana: '{2}' }, effect: { targets: [], steps: [{ op: 'search', who: { ref: 'you' }, zone: 'library', filter: { subtypes: ['Swamp'] }, max: 1, as: 'found' }] } });
    const c = chars([printed(kw), { key: 'k:0:0:0', origin: 'keyword', face: 0, index: 0, def: expansion, parent: 'p:0:0' }]);
    const out = applyWordChange(c, SWAMP_ISLAND);
    expect(out.abilities[1]!.def).toMatchObject({ effect: { steps: [{ filter: { subtypes: ['Island'] } }] } });
  });

  it('CR 612.1, 612.4: the type line\'s creature or land type changes; the colors (no text) and the name never do', () => {
    const c = chars([], { name: 'Goblin Raider', names: ['Goblin Raider'], subtypes: ['Goblin', 'Warrior'], colors: ['R'] });
    expect(applyWordChange(c, GOBLIN_ELF)).toMatchObject({ name: 'Goblin Raider', subtypes: ['Elf', 'Warrior'] });
    expect(applyWordChange(c, RED_BLUE)).toBe(c);
    const land = chars([], { types: ['Land'], subtypes: ['Swamp', 'Island'] });
    expect(applyWordChange(land, SWAMP_ISLAND).subtypes).toEqual(['Island']);
  });
});

describe('wordChangeOf and LAYER_3: the two words', () => {
  const s = { objects: { o1: { links: { from: { values: ['Goblin'] }, to: { values: ['Elf'] } } } } } as unknown as GameState;

  it('words are canonical (a color letter or word, a type as printed); a word not of its kind or the same word twice changes nothing', () => {
    expect(wordChangeOf({ kind: 'color', from: 'red', to: 'Blue' }, s, null)).toEqual(RED_BLUE);
    expect(wordChangeOf({ kind: 'creatureType', from: 'goblin', to: 'elf' }, s, null)).toEqual(GOBLIN_ELF);
    expect(wordChangeOf({ kind: 'creatureType', from: 'Swamp', to: 'Elf' }, s, null)).toBeNull();
    expect(wordChangeOf({ kind: 'landType', from: 'Swamp', to: 'Swamp' }, s, null)).toBeNull();
    expect(wordChangeOf({ kind: 'color', from: 'R', to: 'purple' }, s, null)).toBeNull();
  });

  it('a chosen word of a static ability is read from its source\'s link store; nothing chosen is no change', () => {
    expect(wordChangeOf({ kind: 'creatureType', from: { chosen: 'from' }, to: { chosen: 'to' } }, s, 'o1')).toEqual(GOBLIN_ELF);
    expect(wordChangeOf({ kind: 'creatureType', from: { chosen: 'from' }, to: { chosen: 'none' } }, s, 'o1')).toBeNull();
    const c = chars([], { subtypes: ['Goblin'] });
    expect(LAYER_3!(c, [{ layer: 3, changeWord: { kind: 'creatureType', from: { chosen: 'from' }, to: { chosen: 'to' } } }], 'o2', s, new Map(), { id: 'e1', source: 'o1', controller: 'p1', timestamp: 1 }).subtypes).toEqual(['Elf']);
    expect(LAYER_3!(c, [{ layer: 3, changeWord: { kind: 'creatureType', from: { chosen: 'from' }, to: { chosen: 'to' } } }], 'o2', s, new Map())).toBe(c);
  });
});

const idx = localIndex();

describe.skipIf(!idx)('CR 612.2 on the game path: Scourge of the Nobilis (local card cache)', () => {
  it('Sleight of Mind red -> blue: the condition reads blue, the granted ability\'s {R/W} cost is not a word and stays {R/W}', () => {
    const oracle = idx!.find((c) => c.name === 'Scourge of the Nobilis');
    expect(oracle).toBeDefined();
    const scourgeDef = compileCard(oracle as OracleCard);
    expect(scourgeDef.automation.level).toBe('full');
    let s = scenario(['Sleight of Mind', 'Raging Goblin', 'Mountain', 'Island'], {
      p1: { hand: ['Scourge of the Nobilis', 'Sleight of Mind'], battlefield: ['Raging Goblin', 'Mountain', 'Mountain', 'Mountain', ...islands(1)] }, defs: [scourgeDef],
    });
    const goblin = find(s, 'Raging Goblin', 'battlefield');
    s = resolveTop(cast(s, 'Scourge of the Nobilis', [target(goblin)]));
    const scourge = find(s, 'Scourge of the Nobilis', 'battlefield');
    s = resolveTop(cast(s, 'Sleight of Mind', [target(scourge)]), [color('R'), color('U')]);
    const st = getChars(s, scourge).abilities.find((a) => a.def.kind === 'static' && /\{R\/W\}/.test(a.def.text))!.def as unknown as {
      text: string; condition: { filter: unknown }; effects: { mods: { add?: { cost: unknown; text: string }[] }[] }[];
    };
    expect(st.text).toContain('is blue');
    expect(st.condition.filter).toEqual({ colors: ['U'] });
    const granted = st.effects[0]!.mods.find((m) => m.add)!.add![0]!;
    expect(granted.cost).toEqual({ mana: [{ kind: 'hybrid', colors: ['R', 'W'] }] });
    expect(granted.text).toContain('{R/W}');
  });
});
