/**
 * WP5, the generated lexicon (design 6.11): scripts/gen-lexicon.ts reads the Comprehensive Rules and writes parser/lexicon.generated.json. A test fails when the
 * checked-in file is stale. The generator is also tested against a tiny SYNTHETIC rules tree (invented text in the shape of the real files), so the extraction
 * logic is covered even on a machine without the git-ignored rules/ folder.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  findCardsFile,
  findCrRoot,
  generateLexicon,
  indexSubtypes,
  INDEX_LEXICON_PATH,
  LEXICON_PATH,
  pluralize,
  readIndexCards,
  serializeIndexLexicon,
  serializeLexicon,
} from '../../../../../scripts/gen-lexicon';
import { CR_LEXICON, GENERATED_LEXICON, keywordAt, lexiconIndex } from '../../../src/parser/front/lexicon-index';
import { localIndex } from './support';

const crRoot = findCrRoot();
const cardsFile = findCardsFile();
const checkedIn = (): string => readFileSync(LEXICON_PATH, 'utf8').replace(/\r\n/g, '\n');

describe('the checked-in lexicon (CR words, plus the newer subtypes of the Oracle index)', () => {
  const lex = GENERATED_LEXICON;

  it('has every field of the Lexicon contract and a CR edition', () => {
    expect(lex.crEdition).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const k of ['cardTypes', 'supertypes', 'subtypes', 'colors', 'keywordAbilities', 'keywordActions', 'counterKinds', 'predefinedTokens', 'abilityWords'] as const) {
      expect(lex[k].length, k).toBeGreaterThan(0);
    }
  });

  it('CR 205.2a, 205.4a, 105.1: card types, supertypes and colors', () => {
    expect(lex.cardTypes).toEqual(expect.arrayContaining(['Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Land', 'Planeswalker', 'Sorcery']));
    expect(lex.cardTypes).toHaveLength(15);
    expect(lex.supertypes).toEqual(['Basic', 'Legendary', 'Ongoing', 'Snow', 'World']);
    expect(lex.colors).toEqual([
      { word: 'white', color: 'W' }, { word: 'blue', color: 'U' }, { word: 'black', color: 'B' }, { word: 'red', color: 'R' }, { word: 'green', color: 'G' },
    ]);
  });

  it('CR 205.3: every subtype has a plural form; the lists have their classes', () => {
    const creature = lex.subtypes.filter((s) => s.class === 'creature');
    expect(creature.length).toBeGreaterThan(300);
    for (const s of lex.subtypes) {
      expect(s.plural, s.singular).not.toBe('');
      expect(s.singular, s.singular).not.toMatch(/[‘’]/); // ASCII apostrophes, like the normalized text
    }
    const cls = (c: string) => lex.subtypes.filter((s) => s.class === c).map((s) => s.singular);
    expect(cls('land')).toEqual(expect.arrayContaining(['Forest', 'Island', 'Mountain', 'Plains', 'Swamp', "Urza's"]));
    expect(cls('artifact')).toEqual(expect.arrayContaining(['Equipment', 'Vehicle', 'Treasure', 'Clue']));
    expect(cls('enchantment')).toEqual(expect.arrayContaining(['Aura', 'Saga', 'Class', 'Case', 'Role']));
    expect(cls('spell')).toEqual(expect.arrayContaining(['Adventure', 'Arcane', 'Omen']));
    expect(cls('battle')).toEqual(['Siege']);
    expect(creature.map((s) => s.singular)).toEqual(expect.arrayContaining(['Time Lord', 'Elf', 'Goblin', 'Human', 'Wizard']));
  });

  it('plural forms: regular, irregular and invariant (checked against Oracle usage)', () => {
    const plural = (s: string) => lex.subtypes.find((x) => x.singular === s)!.plural;
    expect(plural('Goblin')).toBe('Goblins');
    expect(plural('Elf')).toBe('Elves');
    expect(plural('Wolf')).toBe('Wolves');
    expect(plural('Werewolf')).toBe('Werewolves');
    expect(plural('Fungus')).toBe('Fungi');
    expect(plural('Mouse')).toBe('Mice');
    expect(plural('Dwarf')).toBe('Dwarves');
    expect(plural('Hero')).toBe('Heroes');
    expect(plural('Time Lord')).toBe('Time Lords');
    expect(plural('Ally')).toBe('Allies');
    expect(plural('Fox')).toBe('Foxes');
    expect(plural('Sphinx')).toBe('Sphinxes');
    expect(plural('Merfolk')).toBe('Merfolk');
    expect(plural('Samurai')).toBe('Samurai');
    expect(plural('Plains')).toBe('Plains');
    expect(plural('Swamp')).toBe('Swamps');
  });

  it('CR 702 and 701: keyword abilities and actions, with their rule numbers', () => {
    const kw = (n: string) => lex.keywordAbilities.find((k) => k.name === n);
    expect(kw('Flying')?.rule).toBe('702.9');
    expect(kw('Double Strike')?.rule).toBe('702.4');
    expect(kw('Ward')?.rule).toBe('702.21');
    expect(lex.keywordAbilities.length).toBeGreaterThan(190);
    expect(kw('Daybound')?.rule).toBe('702.145'); // "Daybound and Nightbound" names two keywords
    expect(kw('Nightbound')?.rule).toBe('702.145');
    expect(kw('Megamorph')?.rule).toBe('702.37b'); // variants the rules name in prose
    expect(kw('Multikicker')?.rule).toBe('702.33c');
    expect(kw('Partner with')).toBeDefined();
    expect(kw('∞')?.rule).toBe('702.186');
    const act = (n: string) => lex.keywordActions.find((k) => k.name === n);
    expect(act('Scry')).toMatchObject({ rule: '701.22', forms: ['scry', 'scries', 'scried', 'scrying'] });
    expect(act('Destroy')!.forms).toEqual(['destroy', 'destroys', 'destroyed', 'destroying']);
    expect(act('Fight')!.forms).toContain('fought');
    expect(act('Tap')!.forms).toEqual(['tap', 'taps', 'tapped', 'tapping']);
    expect(act('Untap')).toBeDefined(); // "Tap and Untap" names two actions
    expect(act('Venture into the Dungeon')!.forms).toContain('ventures into the dungeon');
    expect(act('Time Travel')!.forms).toContain('time travels');
    expect(act('Monstrosity')!.forms).toEqual(['monstrosity']);
  });

  it('CR 122, 111.10, 207.2c: counter kinds, predefined tokens, ability words', () => {
    expect(lex.counterKinds).toEqual(expect.arrayContaining(['+1/+1', '-1/-1', 'loyalty', 'poison', 'shield', 'stun', 'lore', 'time', 'energy', 'flying']));
    expect(lex.predefinedTokens.map((t) => t.name)).toEqual(expect.arrayContaining(['Treasure', 'Food', 'Clue', 'Blood', 'Powerstone', 'Incubator', 'Cursed Role', 'Young Hero Role', 'Map']));
    expect(lex.predefinedTokens.find((t) => t.name === 'Treasure')!.rule).toBe('111.10a');
    expect(lex.abilityWords).toEqual(expect.arrayContaining(['landfall', 'constellation', 'council\'s dilemma', 'descend 4', 'will of the council']));
    expect(lex.abilityWords).not.toContain('and will of the council');
  });

  it('the index over the lexicon finds keyword names at a position (longest first, families included)', () => {
    const ix = lexiconIndex(GENERATED_LEXICON);
    const at = (s: string, i = 0) => keywordAt(ix, s.toLowerCase(), i);
    expect(at('double strike')).toEqual({ name: 'Double Strike', length: 13 });
    expect(at('first strike, flying')?.name).toBe('First Strike');
    expect(at('islandwalk')).toEqual({ name: 'Landwalk', length: 10 });
    expect(at('snow forestwalk')).toEqual({ name: 'Landwalk', length: 15 });
    expect(at('basic landcycling {1}')?.name).toBe('Cycling');
    expect(at('planeswalk')).toBeUndefined();
    expect(at('equipped creature')).toBeUndefined(); // "equip" must end at a word boundary
    expect(at('commander ninjutsu {1}{U}')?.name).toBe('Commander ninjutsu');
    expect(at('draw a card')).toBeUndefined();
  });

  it('the index over the local Oracle data: nearly every subtype used on a card is in the lexicon', () => {
    const cards = localIndex();
    if (!cards) return; // no cache on this machine
    const known = new Set(GENERATED_LEXICON.subtypes.map((s) => s.singular));
    const typeWords = new Set([...GENERATED_LEXICON.cardTypes, ...GENERATED_LEXICON.supertypes, 'Tribal']);
    let total = 0;
    const missing = new Map<string, number>();
    for (const c of cards) {
      for (const f of c.card_faces && c.card_faces.length > 1 ? c.card_faces : [c]) {
        const tl = f.type_line ?? c.type_line ?? '';
        const [left, right] = tl.split(' — ');
        // Planeswalker and battle types are names of people and places that rules text never uses as a type word, and a type line with a word that is no
        // card type (Plane, Conspiracy, an Un-card's invention) is not a card of the game: the generator reads neither.
        const lefts = (left ?? '').split(' ').filter(Boolean);
        if (!right || lefts.some((w) => !typeWords.has(w)) || !lefts.some((w) => ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Kindred', 'Tribal'].includes(w))) continue;
        for (const w of right.replace('Time Lord', 'TimeLord').split(' ')) {
          if (!w || !/^\p{Lu}[\p{L}'-]*$/u.test(w)) continue;
          total++;
          if (w !== 'TimeLord' && !known.has(w)) missing.set(w, (missing.get(w) ?? 0) + 1);
        }
      }
    }
    // Types added by sets newer than the CR edition come from lexicon.index.generated.json (design 6.11: the generator reads the rules AND the local index).
    const missingCount = [...missing.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(1000);
    expect(missingCount, `missing: ${[...missing.entries()].slice(0, 12).join(', ')}`).toBe(0);
  });

  it('design 6.11: subtypes of sets newer than the rules are in the lexicon with their class and a plural', () => {
    const find = (s: string) => lex.subtypes.find((x) => x.singular === s);
    expect(CR_LEXICON.subtypes.some((x) => x.singular === 'Officer')).toBe(false); // not in the CR edition
    expect(find('Officer')).toMatchObject({ plural: 'Officers', class: 'creature' });
    expect(find('Borg')).toMatchObject({ plural: 'Borg', class: 'creature' });
    expect(lexiconIndex(lex).subtypes.has('klingons')).toBe(true);
    expect(CR_LEXICON.crEdition).toBe(lex.crEdition);
  });

  it('CR 701: every inflection of a keyword action verb that the Oracle text uses is one of its forms (surveilled, not surveiled)', () => {
    const cards = localIndex();
    if (!cards) return; // no cache on this machine
    expect(lex.keywordActions.find((a) => a.name === 'Surveil')!.forms).toEqual(['surveil', 'surveils', 'surveilled', 'surveilling']);
    const words = new Set<string>();
    for (const c of cards) for (const f of c.card_faces && c.card_faces.length > 1 ? c.card_faces : [c]) for (const m of (f.oracle_text ?? '').toLowerCase().matchAll(/[a-z]+/g)) words.add(m[0]);
    const re = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const missing: string[] = [];
    for (const a of lex.keywordActions) {
      const base = a.forms[0]!;
      if (a.forms.length < 4 || base.includes(' ')) continue; // fixed phrases and noun-named actions have no verb forms to check
      const last = base[base.length - 1]!;
      const inflection = new RegExp(`^(?:${re(base)}(?:s|es|ed|d|ing)|${re(base.replace(/e$/, ''))}ing|${re(base.replace(/y$/, ''))}(?:ies|ied)|${re(base)}${re(last)}(?:ed|ing))$`);
      for (const w of words) if (inflection.test(w) && !a.forms.includes(w)) missing.push(`${a.name}:${w}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('scripts/gen-lexicon.ts', () => {
  it.skipIf(!crRoot)('STALENESS: the checked-in lexicon is exactly what the rules in rules/cr produce', () => {
    expect(serializeLexicon(generateLexicon(crRoot!)), 'run: npx tsx scripts/gen-lexicon.ts').toBe(checkedIn());
  });

  it.skipIf(!crRoot || !cardsFile)('STALENESS: the checked-in index subtypes are exactly what the local Oracle index produces (skipped without rules or index)', () => {
    const out = serializeIndexLexicon(indexSubtypes(readIndexCards(cardsFile!), generateLexicon(crRoot!)));
    expect(out, 'run: npx tsx scripts/gen-lexicon.ts').toBe(readFileSync(INDEX_LEXICON_PATH, 'utf8').replace(/\r\n/g, '\n'));
  });

  it('indexSubtypes: unknown subtypes of the playable card types, with class and plural, sorted; Planes and funny type lines skipped (synthetic cards)', () => {
    const base = { cardTypes: ['Artifact', 'Creature', 'Enchantment', 'Instant', 'Land', 'Sorcery'], supertypes: ['Legendary', 'Snow'], subtypes: [{ singular: 'Elf', plural: 'Elves', class: 'creature' as const }] };
    const cards = [
        { type_line: 'Legendary Creature — Elf Zorgian' },
        { type_line: 'Creature — Zorgian Quux' },
        { type_line: 'Sorcery — Chorus' },
        { type_line: 'Artifact — Gizmoid' },
        { type_line: 'Snow Land — Cavern' },
        { type_line: 'Plane — Zorgia' },
        { type_line: 'Creature — Elves Time Lord' },
        { type_line: 'Creature — human' },
        { type_line: 'Instant', card_faces: [{ type_line: 'Instant — Trapish' }, { type_line: 'Enchantment — Auric' }] },
        { type_line: 'Creature // Creature', card_faces: [{ type_line: 'Creature — Quux' }, { type_line: 'Creature — Zorgian' }] },
    ];
    const out = indexSubtypes(cards, base);
    expect(out).toEqual([
      { singular: 'Quux', plural: 'Quuxes', class: 'creature' },
      { singular: 'Zorgian', plural: 'Zorgians', class: 'creature' },
      { singular: 'Chorus', plural: 'Choruses', class: 'spell' },
      { singular: 'Trapish', plural: 'Trapishes', class: 'spell' },
      { singular: 'Gizmoid', plural: 'Gizmoids', class: 'artifact' },
      { singular: 'Auric', plural: 'Aurics', class: 'enchantment' },
      { singular: 'Cavern', plural: 'Caverns', class: 'land' },
    ]);
    expect(indexSubtypes([...cards].reverse(), base)).toEqual(out); // the order of the cards does not matter
  });

  it('a lexicon that differs from what the rules produce is detected (the comparison the staleness test makes)', () => {
    const lex = generateLexicon(syntheticCr());
    const edited = { ...lex, keywordAbilities: lex.keywordAbilities.slice(1) };
    expect(serializeLexicon(edited)).not.toBe(serializeLexicon(lex));
    expect(serializeLexicon(lex)).not.toBe(checkedIn()); // synthetic rules, different words
  });

  it('is deterministic: the same rules give byte-identical output', () => {
    expect(serializeLexicon(generateLexicon(syntheticCr()))).toBe(serializeLexicon(generateLexicon(syntheticCr())));
  });

  it('extracts every word class from a rules tree (synthetic rules)', () => {
    const lex = generateLexicon(syntheticCr());
    expect(lex.crEdition).toBe('2001-02-03');
    expect(lex.cardTypes).toEqual(['Artifact', 'Creature', 'Sorcery']);
    expect(lex.supertypes).toEqual(['Basic', 'Legendary', 'Snow']);
    expect(lex.subtypes.map((s) => `${s.class}:${s.singular}>${s.plural}`)).toEqual([
      'artifact:Gadget>Gadgets', 'artifact:Gizmo>Gizmos', 'artifact:Widget>Widgets',
      'enchantment:Aura>Auras', 'enchantment:Shrine>Shrines',
      "land:Cave>Caves", "land:Forest>Forests", "land:Urza's>Urza's",
      'planeswalker:Ajani>Ajanis',
      'spell:Arcane>Arcanes', 'spell:Trap>Traps',
      'creature:Time Lord>Time Lords', 'creature:Elf>Elves', 'creature:Wolf>Wolves', 'creature:Ally>Allies', 'creature:Fungus>Fungi', 'creature:Fox>Foxes', 'creature:Zubera>Zubera',
      'battle:Siege>Sieges',
    ]);
    expect(lex.colors.map((c) => c.color)).toEqual(['W', 'U', 'B', 'R', 'G']);
    expect(lex.keywordAbilities).toEqual([
      { name: 'Deathtouch', rule: '702.2' },
      { name: 'Double Strike', rule: '702.3' },
      { name: 'Daybound', rule: '702.4' },
      { name: 'Nightbound', rule: '702.4' },
      { name: 'Morph', rule: '702.5' },
      { name: 'Megamorph', rule: '702.5b' },
      { name: 'Choose a Background', rule: '702.124k' },
    ]);
    expect(lex.keywordActions.map((a) => [a.name, a.rule, a.forms[1]])).toEqual([
      ['Scry', '701.2', 'scries'], ['Tap', '701.3', 'taps'], ['Untap', '701.3', 'untaps'], ['Venture into the Dungeon', '701.4', 'ventures into the dungeon'],
    ]);
    expect(lex.counterKinds).toEqual(['+1/+1', '-1/-1', 'flying', 'first strike', 'shield', 'trample'].sort());
    expect(lex.predefinedTokens).toEqual([{ name: 'Treasure', rule: '111.10a' }, { name: 'Cursed Role', rule: '111.10j' }]);
    expect(lex.abilityWords).toEqual(['adamant', "council's dilemma", 'landfall', 'will of the council']);
  });

  it('fails loudly when a rule it needs is missing (a new edition must be looked at, not guessed)', () => {
    const dir = syntheticCr();
    writeFileSync(join(dir, '2-parts-of-a-card', '205.md'), '205.2a The card types are artifact.\n');
    expect(() => generateLexicon(dir)).toThrow(/rule .* not found|marker/);
  });

  it('pluralize: regular endings and the exception table', () => {
    expect(pluralize('Cat')).toBe('Cats');
    expect(pluralize('Ally')).toBe('Allies');
    expect(pluralize('Fox')).toBe('Foxes');
    expect(pluralize('Leech')).toBe('Leeches');
    expect(pluralize('Elf')).toBe('Elves');
    expect(pluralize('Moonfolk')).toBe('Moonfolk');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// A tiny synthetic rules tree
// ---------------------------------------------------------------------------------------------------------------------------------

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function syntheticCr(): string {
  const dir = mkdtempSync(join(tmpdir(), 'openmtg-cr-'));
  made.push(dir);
  mkdirSync(join(dir, '1-game-concepts'), { recursive: true });
  mkdirSync(join(dir, '2-parts-of-a-card'), { recursive: true });
  mkdirSync(join(dir, '7-additional-rules'), { recursive: true });
  writeFileSync(join(dir, 'INDEX.md'), '# Rules index (effective 2001-02-03)\n');
  writeFileSync(
    join(dir, '1-game-concepts', '105-colors.md'),
    'There are five colors in the Magic game: white, blue, black, red, and green.\n'.replace(/^/, '105.1. '),
  );
  writeFileSync(
    join(dir, '1-game-concepts', '111-tokens.md'),
    [
      '111.10. Some effects create a predefined token.',
      '111.10a A Treasure token is a colorless Treasure artifact token with “made-up ability one.”',
      '111.10j A Cursed Role token is a colorless Aura Role enchantment token named Cursed with made-up text.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, '1-game-concepts', '122-counters.md'),
    [
      '122.1b The keywords that a keyword counter can be are flying, first strike, and trample, as well as any variants of those keywords.',
      '122.1c One or more shield counters on a permanent do invented things.',
      '122.3 A permanent with a +1/+1 counter and a -1/-1 counter loses both.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, '2-parts-of-a-card', '205.md'),
    [
      '205.2a The card types are artifact, creature, and sorcery.',
      '205.3g The artifact types are Gadget (see rule 1), Gizmo, and Widget.',
      '205.3h The enchantment types are Aura and Shrine.',
      '205.3i The land types are Cave, Forest, and Urza’s. Of that list, Forest is basic.',
      '205.3j The planeswalker types are Ajani.',
      '205.3k The spell types are Arcane and Trap.',
      '205.3m Creatures share lists. One creature type is two words long: Time Lord. All other creature types are one word long: Elf, Wolf, Ally, Fungus, Fox, and Zubera.',
      '205.3q That battle type is Siege.',
      '205.4a An object can have supertypes. The supertypes are basic, legendary, and snow.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, '2-parts-of-a-card', '207-text-box.md'),
    '207.2c An ability word appears in italics. The ability words are adamant, council’s dilemma, landfall, and will of the council.\n',
  );
  writeFileSync(
    join(dir, '7-additional-rules', '701-keyword-actions.md'),
    [
      '701.1. Most actions use ordinary English. Invented sentence.',
      '701.2. Scry',
      '701.2a To scry is invented.',
      '701.3. Tap and Untap',
      '701.4. Venture into the Dungeon',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, '7-additional-rules', '702-keyword-abilities.md'),
    [
      '702.1. Some abilities are keywords. Invented sentence.',
      '702.2. Deathtouch',
      '702.3. Double Strike',
      '702.4. Daybound and Nightbound',
      '702.5. Morph',
      '702.5b Megamorph is a variant of the morph ability. It costs invented things.',
      '702.124k “Choose a Background” means invented things.',
      '',
    ].join('\n'),
  );
  return dir;
}
