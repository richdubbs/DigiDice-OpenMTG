/**
 * The keyword-line compiler (cards/keywords.ts): keyword-only cards are fully automated, every other keyword stays manual and the card
 * says so. Ability keys stay stable for cards the milestone 3 compiler already understood.
 */
import { describe, expect, it } from 'vitest';
import {
  ENGINE_CAPABILITIES, KEYWORD_RULES, compileCard, enumerateAbilities, getChars, hasQuality, parseEnchant, parseKeywordLine, parseLandwalk, parseQuality, SUBTYPE_QUALITY_WORDS, type KeywordAbilityDef, type OracleCard,
} from '../../src/index';
import { compiledDef, fixtureCardNames, getCard, nativeDef } from '../fixtures';
import { find, scenario } from './helpers';

const kws = (line: string) => parseKeywordLine(line)?.abilities.map((a) => [a.keyword, a.quality ?? a.amount ?? ''].join(':').replace(/:$/, ''));
const compile = (text: string, extra: Partial<OracleCard> = {}) =>
  compileCard({ name: 'Test Card', layout: 'normal', type_line: 'Creature — Test', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: text, ...extra } as OracleCard);

describe('keyword lines compile into keyword abilities', () => {
  it('CR 702.9, 702.20: "Flying, vigilance" (Serra Angel) is fully automated', () => {
    const d = compiledDef('Serra Angel');
    expect(d.automation).toMatchObject({ level: 'full', unsupported: [], source: 'keywords-only' }); // WP18: the whole CardAutomation of the compile pipeline
    expect(d.faces[0]!.abilities.map((a) => a.kind === 'keyword' && a.keyword)).toEqual(['flying', 'vigilance']);
  });

  it('every simple combat keyword compiles by itself and in a list', () => {
    for (const k of ['Deathtouch', 'Defender', 'Double strike', 'First strike', 'Flying', 'Haste', 'Hexproof', 'Indestructible', 'Intimidate', 'Lifelink', 'Reach', 'Shroud', 'Trample', 'Vigilance', 'Menace', 'Fear', 'Shadow', 'Horsemanship', 'Skulk', 'Infect', 'Wither']) {
      expect(kws(k), k).toEqual([k.toLowerCase()]);
    }
    expect(kws('First strike, lifelink')).toEqual(['first strike', 'lifelink']);
    expect(kws('Flying; swampwalk')).toEqual(['flying', 'landwalk:swamp']);
    expect(compile('Deathtouch, trample').automation.level).toBe('full');
  });

  it('CR 702.164: toxic N carries its number; CR 702.164b: total toxic value is the sum', () => {
    expect(kws('Toxic 2')).toEqual(['toxic:2']);
    expect(parseKeywordLine('Toxic 1')!.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'toxic', amount: 1, text: 'Toxic 1' });
  });

  it('CR 702.16g: "Protection from X and from Y" is two abilities; qualities cover colors, types, subtypes and everything', () => {
    expect(kws('Protection from black and from red')).toEqual(['protection:color:B', 'protection:color:R']);
    expect(kws('Protection from Vampires, from Werewolves, and from Zombies')).toEqual(['protection:subtype:vampires', 'protection:subtype:werewolves', 'protection:subtype:zombies']);
    expect(kws('Protection from artifacts')).toEqual(['protection:type:Artifact']);
    expect(kws('Protection from everything')).toEqual(['protection:everything']);
    expect(kws('Protection from multicolored')).toEqual(['protection:multicolored']);
    expect(kws('Hexproof from monocolored')).toEqual(['hexproof:monocolored']);
    // A quality the engine can't test stays manual text.
    expect(parseKeywordLine('Protection from permanents with corruption counters on them')).toBeNull();
    // W3b, guard G2 (closed vocabulary): a capitalized word that is no subtype of the lexicon is no quality (it used to be "subtype:zorblaxine", full)
    expect(parseKeywordLine('Protection from Zorblaxine')).toBeNull();
    expect(parseQuality('Zorblaxine', SUBTYPE_QUALITY_WORDS)).toBeNull();
    expect(parseQuality('Goblins')).toBeNull(); // no vocabulary given: no subtype quality (fail closed)
    expect(kws('Protection from Goblins')).toEqual(['protection:subtype:goblins']);
  });

  it('CR 702.16a: qualities are tested against characteristics (color, type, subtype in the plural, supertype)', () => {
    const goblin = { colors: ['R'], types: ['Creature'], subtypes: ['Goblin', 'Warrior'], supertypes: [] as string[] };
    const elf = { colors: ['G'], types: ['Creature'], subtypes: ['Elf'], supertypes: ['Snow'] };
    expect(hasQuality(goblin, parseQuality('red')!)).toBe(true);
    expect(hasQuality(goblin, parseQuality('Goblins', SUBTYPE_QUALITY_WORDS)!)).toBe(true);
    expect(hasQuality(goblin, parseQuality('Warriors', SUBTYPE_QUALITY_WORDS)!)).toBe(true);
    expect(hasQuality(goblin, parseQuality('Elves', SUBTYPE_QUALITY_WORDS)!)).toBe(false);
    expect(hasQuality(elf, parseQuality('Elves', SUBTYPE_QUALITY_WORDS)!)).toBe(true);
    expect(hasQuality(elf, parseQuality('snow')!)).toBe(true);
    expect(hasQuality(goblin, parseQuality('multicolored')!)).toBe(false);
    expect(hasQuality(goblin, parseQuality('monocolored')!)).toBe(true);
    expect(hasQuality(goblin, parseQuality('creatures')!)).toBe(true);
    expect(hasQuality(goblin, parseQuality('artifacts')!)).toBe(false);
    expect(hasQuality(goblin, parseQuality('everything')!)).toBe(true);
  });

  it('CR 702.14: landwalk words: land types, supertypes and "nonbasic"', () => {
    expect(parseLandwalk('Islandwalk')).toBe('island');
    expect(parseLandwalk('Snow forestwalk')).toBe('snow forest');
    expect(parseLandwalk('Nonbasic landwalk')).toBe('nonbasic');
    expect(parseLandwalk('Legendary landwalk')).toBe('legendary');
    expect(parseLandwalk('Planeswalkerwalk')).toBeNull(); // not a land word
    expect(parseLandwalk('Sidewalk')).toBeNull();
  });

  it('CR 702.5a: an enchant restriction becomes an object filter', () => {
    expect(parseEnchant('creature')).toEqual({ filter: { types: ['Creature'] } });
    expect(parseEnchant('land you control')).toEqual({ filter: { types: ['Land'], controller: 'you' } });
    expect(parseEnchant('artifact or creature')).toEqual({ filter: { types: ['Artifact', 'Creature'] } });
    expect(parseEnchant('artifact, creature, or planeswalker')).toEqual({ filter: { types: ['Artifact', 'Creature', 'Planeswalker'] } });
    expect(parseEnchant('Forest')).toEqual({ filter: { subtypes: ['Forest'] } });
    expect(parseEnchant('nonland permanent')).toEqual({ filter: { notTypes: ['Land'] } });
    expect(parseEnchant('red or green creature')).toEqual({ filter: { colors: ['R', 'G'], types: ['Creature'] } });
    expect(parseEnchant('creature an opponent controls')).toEqual({ filter: { types: ['Creature'], controller: 'opponent' } });
    expect(parseEnchant('player')).toEqual({ filter: {}, player: 'any' });
    expect(parseEnchant('opponent')).toEqual({ filter: {}, player: 'opponent' });
    expect(parseEnchant('creature or Vehicle')).toBeNull(); // a type or a subtype can't be one filter
    expect(parseEnchant('creature with power 3 or less')).toBeNull();
    expect(parseKeywordLine('Enchant creature')!.abilities[0]).toMatchObject({ keyword: 'enchant', quality: 'creature', filter: { types: ['Creature'] } });
  });
});

describe('automation is classified honestly', () => {
  it('a card is full only when every line compiled', () => {
    expect(compile('Flying').automation.level).toBe('full');
    expect(compile('').automation.level).toBe('full'); // vanilla
    // W3b: the attack trigger (CR 508.1m, 603.2) is understood by the template set now, so the line that stays manual uses an invented word (G2)
    expect(compile('Flying\nWhenever this creature attacks, draw a card.').automation.level).toBe('full');
    expect(compile('Flying\nWhenever this creature attacks, zorble a card.').automation).toMatchObject({ level: 'partial', unsupported: ['zorble a card.'] }); // the trigger is understood, its effect is not
  });

  it('a keyword the engine recognizes from CR 702 but does not implement is NOT automated: the card stays manual and names the capability (design 10.2) of the rule', () => {
    for (const [text, rule] of [['Persist', '702.79'], ['Ward {2}', '702.21'], ['Exalted', '702.83'], ['Prowess', '702.108'], ['Cascade', '702.85'], ['Banding', '702.22']] as const) {
      const d = compile(text);
      const name = text.split(' ')[0]!.toLowerCase();
      expect(KEYWORD_RULES.get(name), text).toBe(rule); // the keyword is the one of that rule
      // WP18: milestone 5's keyword library implements some of these (exalted, prowess): a keyword the engine has is automated, the others stay manual
      if (ENGINE_CAPABILITIES.has(`keyword:${name}`)) {
        expect(d.automation.level, text).toBe('full');
        continue;
      }
      expect(d.automation.level, text).toBe('manual');
      expect(d.automation.unsupported, text).toEqual([text]);
      const manual = d.faces[0]!.abilities[0]!;
      expect(manual.kind, text).toBe('manual');
      // WP18: the compile pipeline names the capability the engine lacks (design 10.2, "needs-engine: keyword:persist") and lists it in requiresEngine
      expect((manual as { reason: string }).reason, text).toBe(`needs-engine: keyword:${name}`);
      expect(d.automation.requiresEngine, text).toEqual([`keyword:${name}`]);
    }
  });

  // W3 integration: ward is implemented since WP32 (keyword:ward), so the unimplemented keyword here was rampage (CR 702.23); CMD3 implements rampage, so it is absorb (CR 702.64).
  it('a mixed line automates what it can and keeps the rest as manual text: "Flying, absorb 2" is partial', () => {
    const d = compile('Flying, absorb 2');
    expect(d.automation).toMatchObject({ level: 'partial', unsupported: ['absorb 2'] });
    expect(d.faces[0]!.abilities.map((a) => a.kind)).toEqual(['keyword', 'manual']);
  });

  it('real cards: Pacifism is full (W3b: "can\'t attack or block" is a rule hook, CR 508.1c, 509.1b), Kitchen Finks is full (FAST5X E28: persist is automated), Hexbane Tortoise is full (WP32: ward; std-ry8: enlist), Zombie Musher is full (W3b: its regeneration is understood; FAST4 T33: snow landwalk), Vampire Nighthawk is full', () => {
    expect(compiledDef('Vampire Nighthawk').automation.level).toBe('full');
    expect(compiledDef('Pacifism').automation.level).toBe('full'); // W3b; enforced by the WP16 hooks (test/m5/rulehooks/restrictions.test.ts)
    expect(compiledDef('Kitchen Finks').automation.level).toBe('full'); // FAST5X E28: persist (CR 702.79a, keywords/data/persist.json)
    expect(compiledDef('Hexbane Tortoise').automation).toMatchObject({ level: 'full', unsupported: [] }); // CR 702.21a: WP32 implements ward; std-ry8 implements CR 702.154 enlist
    // WP18: the {S} cost is understood, regeneration is a manual step ("~" is the card itself); WP18 review (D14): "Snow landwalk" is manual until the
    // renderer prints the form (milestone 4's recognizer read it, the exact render gate cannot confirm it). W3b: "{S}: Regenerate this creature." is
    // understood by the template set (CR 701.19, cost {S} CR 107.4h), so the card is partial with only the snow landwalk line manual
    // FAST4 T33: the renderer prints "snow landwalk" (CR 702.14c; render/kw.ts), so the native line is confirmed and the card is full
    const musher = compiledDef('Zombie Musher').automation;
    expect(musher.level).toBe('full');
    expect(musher.unsupported).toEqual([]);
  });

  it('invariant over the whole fixture: every compiled keyword ability is one the engine implements (nothing claims automation it lacks)', () => {
    const seen = new Set<string>();
    for (const name of fixtureCardNames()) {
      const d = compileCard(getCard(name));
      for (const f of d.faces) {
        for (const a of f.abilities) {
          if (a.kind !== 'keyword') continue;
          seen.add(a.keyword);
          // WP18: what the engine implements is its capability set (design 5.2); the degrade pass makes any other keyword manual
          expect(ENGINE_CAPABILITIES.has(`keyword:${a.keyword}`), `${name}: ${a.keyword}`).toBe(true);
        }
      }
      // Cards whose text is fully compiled have no unsupported pieces; cards with manual abilities are never 'full'.
      const hasManual = d.faces.some((f) => f.abilities.some((a) => a.kind === 'manual'));
      if (hasManual) expect(d.automation.level, name).not.toBe('full');
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(['flying', 'first strike', 'double strike', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'protection', 'landwalk', 'toxic', 'enchant', 'hexproof', 'shroud', 'indestructible']));
  }, 120_000); // every fixture card is compiled: the set grows with every package, so the default 5 s is not enough on a busy machine

  it('the official keyword list (CR 702) is available with rule numbers', () => {
    expect(KEYWORD_RULES.get('deathtouch')).toBe('702.2');
    expect(KEYWORD_RULES.get('first strike')).toBe('702.7');
    expect(KEYWORD_RULES.get('menace')).toBe('702.111');
    expect(KEYWORD_RULES.get('skulk')).toBe('702.118');
    expect(KEYWORD_RULES.get('toxic')).toBe('702.164');
    expect(KEYWORD_RULES.size).toBeGreaterThan(180);
  });
});

describe('abilities are read through getChars(...).keywords', () => {
  it('Chars.keywords lists the keyword abilities of the object in order, with their parameters', () => {
    // WP18 review (D14): "protection from black and from green" is not printable by the renderer yet: the milestone 4 recognizer's reading (nativeDef)
    const s = scenario(['Branchblight Stalker'], { defs: [nativeDef('Mirran Crusader')], p1: { battlefield: ['Mirran Crusader', 'Branchblight Stalker'] } });
    const crusader = getChars(s, find(s, 'Mirran Crusader', 'battlefield'));
    expect(crusader.keywords.map((k: KeywordAbilityDef) => [k.keyword, k.quality])).toEqual([['double strike', undefined], ['protection', 'color:B'], ['protection', 'color:G']]);
    expect(getChars(s, find(s, 'Branchblight Stalker', 'battlefield')).keywords).toMatchObject([{ keyword: 'toxic', amount: 2 }]);
  });

  it('CR 613.4c: power and toughness include +1/+1 and -1/-1 counters; a "*" is left alone', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: [{ name: 'Grizzly Bears', counters: { '+1/+1': 2, '-1/-1': 1 } }] } });
    expect(getChars(s, find(s, 'Grizzly Bears', 'battlefield'))).toMatchObject({ power: '3', toughness: '3' });
  });

  it('ability keys follow the printed lines (WP18: the compile pipeline; milestone 4 appended its new keywords after the abilities milestone 3 had keyed)', () => {
    const s = scenario(['Birds of Paradise', 'Llanowar Elves', 'Ambush Viper', 'Glorybringer'], { p1: { battlefield: ['Birds of Paradise', 'Llanowar Elves', 'Ambush Viper', 'Glorybringer'] } });
    const keys = (name: string) => enumerateAbilities(s, s.objects[find(s, name, 'battlefield')]!).map((i) => `${i.key}:${i.def.kind}`);
    expect(keys('Birds of Paradise')).toEqual(['p:0:0:keyword', 'p:0:1:activated']);
    expect(keys('Llanowar Elves')).toEqual(['p:0:0:activated']);
    expect(keys('Ambush Viper')).toEqual(['p:0:0:keyword', 'p:0:1:keyword']);
    expect(enumerateAbilities(s, s.objects[find(s, 'Glorybringer', 'battlefield')]!).map((i) => (i.def.kind === 'keyword' ? i.def.keyword : i.def.kind)).slice(0, 2)).toEqual(['flying', 'haste']);
  });
});
