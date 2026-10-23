/**
 * Scryfall search syntax (src/scryfall-search.ts): the parser and the matcher over a small made-up card pool (Oracle fields only; no network, no
 * Scryfall traffic), keyword by keyword, then through GET /api/cards/search's `scry` parameter.
 */
import type { IndexedCard } from '@openmtg/cards';
import { describe, expect, it } from 'vitest';
import { IS_VALUES, parseScryfall, SUPPORTED_KEYWORDS } from '../src/scryfall-search';
import { parseSearch, searchRow, type SearchRow } from '../src/search-query';

type Spec = Partial<IndexedCard> & { name: string };

const card = (c: Spec): IndexedCard => ({ layout: 'normal', cmc: 0, ...c }) as IndexedCard;
const legal = (o: Record<string, string> = {}) => ({ modern: 'legal', legacy: 'legal', vintage: 'legal', commander: 'legal', standard: 'not_legal', ...o }) as IndexedCard['legalities'];

const POOL: IndexedCard[] = [
  card({ name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1, type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', colors: ['R'], color_identity: ['R'], legalities: legal() }),
  card({ name: 'Sol Ring', mana_cost: '{1}', cmc: 1, type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', colors: [], color_identity: [], produced_mana: ['C'], legalities: legal({ modern: 'not_legal', legacy: 'banned', vintage: 'restricted' }) }),
  card({ name: 'Grizzly Bears', mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2', colors: ['G'], color_identity: ['G'], legalities: legal({ standard: 'legal' }) }),
  card({ name: 'Serra Angel', mana_cost: '{3}{W}{W}', cmc: 5, type_line: 'Creature — Angel', oracle_text: 'Flying, vigilance', power: '4', toughness: '4', colors: ['W'], color_identity: ['W'], keywords: ['Flying', 'Vigilance'], legalities: legal() }),
  card({ name: 'Llanowar Elves', mana_cost: '{G}', cmc: 1, type_line: 'Creature — Elf Druid', oracle_text: '{T}: Add {G}.', power: '1', toughness: '1', colors: ['G'], color_identity: ['G'], produced_mana: ['G'], legalities: legal() }),
  card({ name: 'Tarmogoyf', mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Lhurgoyf', oracle_text: "Tarmogoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.", power: '*', toughness: '1+*', colors: ['G'], color_identity: ['G'], legalities: legal() }),
  card({ name: 'Jace, the Mind Sculptor', mana_cost: '{2}{U}{U}', cmc: 4, type_line: 'Legendary Planeswalker — Jace', oracle_text: '+2: Look at the top card of target player’s library.\n0: Draw three cards, then put two cards from your hand on top of your library in any order.', loyalty: '3', colors: ['U'], color_identity: ['U'], legalities: legal({ modern: 'banned' }) }),
  card({
    name: 'Fire // Ice',
    layout: 'split',
    cmc: 4,
    colors: ['R', 'U'],
    color_identity: ['R', 'U'],
    legalities: legal(),
    card_faces: [
      { name: 'Fire', mana_cost: '{1}{R}', type_line: 'Instant', oracle_text: 'Fire deals 2 damage divided as you choose among one or two targets.' },
      { name: 'Ice', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Tap target permanent.\nDraw a card.' },
    ],
  }),
  card({
    name: 'Delver of Secrets // Insectile Aberration',
    layout: 'transform',
    cmc: 1,
    color_identity: ['U'],
    legalities: legal(),
    card_faces: [
      { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard', oracle_text: 'At the beginning of your upkeep, look at the top card of your library.', power: '1', toughness: '1', colors: ['U'] },
      { name: 'Insectile Aberration', type_line: 'Creature — Human Insect', oracle_text: 'Flying', power: '3', toughness: '2', colors: ['U'], color_indicator: ['U'] },
    ],
  }),
  card({
    name: 'Sea Gate Restoration // Sea Gate, Reborn',
    layout: 'modal_dfc',
    cmc: 6,
    colors: ['U'],
    color_identity: ['U'],
    legalities: legal(),
    card_faces: [
      { name: 'Sea Gate Restoration', mana_cost: '{4}{U}{U}', type_line: 'Sorcery', oracle_text: 'Draw cards equal to the number of cards in your hand plus one.', colors: ['U'] },
      { name: 'Sea Gate, Reborn', type_line: 'Land', oracle_text: 'As Sea Gate, Reborn enters, you may pay 3 life.\n{T}: Add {U}.', colors: [] },
    ],
  }),
  card({
    name: 'Bonecrusher Giant // Stomp',
    layout: 'adventure',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    legalities: legal(),
    card_faces: [
      { name: 'Bonecrusher Giant', mana_cost: '{2}{R}', type_line: 'Creature — Giant', oracle_text: 'Whenever Bonecrusher Giant becomes the target of a spell, Bonecrusher Giant deals 2 damage to that spell’s controller.', power: '4', toughness: '3' },
      { name: 'Stomp', mana_cost: '{1}{R}', type_line: 'Instant — Adventure', oracle_text: 'Damage can’t be prevented this turn. Stomp deals 2 damage to any target.' },
    ],
  }),
  card({ name: 'Kolaghan’s Command', mana_cost: '{1}{B}{R}', cmc: 3, type_line: 'Instant', oracle_text: 'Choose two —\n• Return target creature card from your graveyard to your hand.', colors: ['B', 'R'], color_identity: ['B', 'R'], legalities: legal() }),
  card({ name: 'Niv-Mizzet, Parun', mana_cost: '{2}{U}{U}{R}{R}', cmc: 6, type_line: 'Legendary Creature — Dragon Wizard', oracle_text: 'This spell can’t be countered.\nFlying\nWhenever you draw a card, Niv-Mizzet, Parun deals 1 damage to any target.', power: '5', toughness: '5', colors: ['U', 'R'], color_identity: ['U', 'R'], keywords: ['Flying'], legalities: legal() }),
  card({ name: 'Island', type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)', colors: [], color_identity: ['U'], produced_mana: ['U'], legalities: legal() }),
  card({ name: 'Boros Reckoner', mana_cost: '{R/W}{R/W}{R/W}', cmc: 3, type_line: 'Creature — Minotaur Wizard', oracle_text: 'Whenever Boros Reckoner is dealt damage, it deals that much damage to any target.', power: '3', toughness: '3', colors: ['R', 'W'], color_identity: ['R', 'W'], legalities: legal() }),
  card({ name: 'Gitaxian Probe', mana_cost: '{U/P}', cmc: 1, type_line: 'Sorcery', oracle_text: 'Look at target player’s hand.\nDraw a card.', colors: ['U'], color_identity: ['U'], legalities: legal({ modern: 'banned' }) }),
  card({ name: 'Gray Merchant of Asphodel', mana_cost: '{3}{B}{B}', cmc: 5, type_line: 'Creature — Zombie', oracle_text: 'When Gray Merchant of Asphodel enters, each opponent loses X life, where X is your devotion to black.', power: '2', toughness: '4', colors: ['B'], color_identity: ['B'], legalities: legal() }),
  card({ name: 'Counterspell', mana_cost: '{U}{U}', cmc: 2, type_line: 'Instant', oracle_text: 'Counter target spell.', colors: ['U'], color_identity: ['U'], legalities: legal({ modern: 'not_legal' }) }),
  card({ name: 'Wastes', type_line: 'Basic Land', oracle_text: '({T}: Add {C}.)', colors: [], color_identity: [], produced_mana: ['C'], legalities: legal() }),
  card({ name: 'Eldrazi Spawn Maker', mana_cost: '{4}', cmc: 4, type_line: 'Creature — Eldrazi', oracle_text: '{2}, Sacrifice Eldrazi Spawn Maker: Add {C}.', power: '3', toughness: '3', colors: [], color_identity: [], legalities: legal() }),
];
const ROWS: SearchRow[] = POOL.map(searchRow);
const FORMATS = ['modern', 'legacy', 'vintage', 'commander', 'standard'];

/** The names of the pool cards a query finds (in pool order); throws on a query error. */
function find(q: string): string[] {
  const r = parseScryfall(q);
  if (typeof r === 'string') throw new Error(`"${q}": ${r}`);
  return ROWS.filter((row) => r.test(row)).map((row) => row.card.name).sort();
}
/** The error message of a query that cannot be run. */
function error(q: string): string {
  const r = parseScryfall(q);
  if (typeof r !== 'string') throw new Error(`"${q}" parsed`);
  return r;
}

const only = (...n: string[]) => [...n].sort();

describe('names', () => {
  it('bare words are names, ANDed; quotes keep a phrase; case, accents and quote marks do not matter', () => {
    expect(find('bolt')).toEqual(only('Lightning Bolt'));
    expect(find('lightning bolt')).toEqual(only('Lightning Bolt'));
    expect(find('"lightning bolt"')).toEqual(only('Lightning Bolt'));
    expect(find("'mind sculptor'")).toEqual(only('Jace, the Mind Sculptor'));
    expect(find('lightning grizzly')).toEqual([]);
    expect(find("kolaghan's")).toEqual(only('Kolaghan’s Command'));
    // A face name finds the whole split / transform card.
    expect(find('ice')).toEqual(expect.arrayContaining(['Fire // Ice']));
    expect(find('insectile')).toEqual(only('Delver of Secrets // Insectile Aberration'));
  });

  it('name: is a name too, and does not match rules text', () => {
    expect(find('name:bolt')).toEqual(only('Lightning Bolt'));
    expect(find('tarmogoyf')).toEqual(only('Tarmogoyf'));
    expect(find('damage')).toEqual([]);
  });

  it('!"exact name" needs the whole name (or a face name), not part of it', () => {
    expect(find('!"Lightning Bolt"')).toEqual(only('Lightning Bolt'));
    expect(find('!lightning')).toEqual([]);
    expect(find('!fire')).toEqual(only('Fire // Ice'));
    expect(find('!"fire // ice"')).toEqual(only('Fire // Ice'));
    expect(find('-!"Lightning Bolt" t:instant')).toEqual(expect.not.arrayContaining(['Lightning Bolt']));
  });

  it('/regex/ matches names (bare, name:, and per face)', () => {
    expect(find('/^lightning/')).toEqual(only('Lightning Bolt'));
    expect(find('name:/^ice$/')).toEqual(only('Fire // Ice'));
    expect(find('name:/(bolt|goyf)$/')).toEqual(only('Lightning Bolt', 'Tarmogoyf'));
    expect(error('name:/(/')).toMatch(/regular expression \/\(\/ after "name:" is not valid/);
  });
});

describe('colors', () => {
  it('c: means at least those colors; letters, names, guilds, shards and wedges', () => {
    expect(find('c:r')).toEqual(only('Lightning Bolt', 'Fire // Ice', 'Bonecrusher Giant // Stomp', 'Kolaghan’s Command', 'Niv-Mizzet, Parun', 'Boros Reckoner'));
    expect(find('c:rg')).toEqual([]);
    expect(find('color:red -c:u -c:b -c:w')).toEqual(only('Lightning Bolt', 'Bonecrusher Giant // Stomp'));
    expect(find('c:izzet')).toEqual(only('Fire // Ice', 'Niv-Mizzet, Parun'));
    expect(find('c:rakdos')).toEqual(only('Kolaghan’s Command'));
    expect(find('c:grixis')).toEqual([]);
    expect(find('c:white')).toEqual(only('Serra Angel', 'Boros Reckoner'));
  });

  it('operators: = exactly, >= at least, > more, <= at most, < fewer, != not exactly', () => {
    expect(find('c=ur')).toEqual(only('Fire // Ice', 'Niv-Mizzet, Parun'));
    expect(find('c=u')).toEqual(only('Jace, the Mind Sculptor', 'Delver of Secrets // Insectile Aberration', 'Sea Gate Restoration // Sea Gate, Reborn', 'Gitaxian Probe', 'Counterspell'));
    expect(find('c>=ur')).toEqual(find('c=ur'));
    expect(find('c>u c:u')).toEqual(only('Fire // Ice', 'Niv-Mizzet, Parun'));
    expect(find('c<=ur c:r')).toEqual(only('Lightning Bolt', 'Fire // Ice', 'Bonecrusher Giant // Stomp', 'Niv-Mizzet, Parun'));
    expect(find('c<ur c:r')).toEqual(only('Lightning Bolt', 'Bonecrusher Giant // Stomp'));
    expect(find('c!=u c:u')).toEqual(only('Fire // Ice', 'Niv-Mizzet, Parun'));
  });

  it('c:c / colorless, c:m / multicolor, and a number of colors', () => {
    expect(find('c:c')).toEqual(only('Sol Ring', 'Island', 'Wastes', 'Eldrazi Spawn Maker'));
    expect(find('c=colorless')).toEqual(find('c:c'));
    expect(find('c!=c')).toEqual(expect.not.arrayContaining(['Sol Ring']));
    expect(find('c:m')).toEqual(only('Fire // Ice', 'Kolaghan’s Command', 'Niv-Mizzet, Parun', 'Boros Reckoner'));
    expect(find('c:multicolor')).toEqual(find('c:m'));
    expect(find('c=2')).toEqual(find('c:m'));
    expect(find('c>=2')).toEqual(find('c:m'));
    expect(find('c=0')).toEqual(find('c:c'));
    expect(find('c<2 c:r')).toEqual(only('Lightning Bolt', 'Bonecrusher Giant // Stomp'));
  });

  it('id: counts the identity (":" and "<=" fit a deck of those colors), including a mana symbol the card only has in its text', () => {
    expect(find('id:ur')).toEqual(find('id<=ur'));
    expect(find('id<=ur')).toEqual(
      expect.arrayContaining(['Lightning Bolt', 'Fire // Ice', 'Niv-Mizzet, Parun', 'Counterspell', 'Sol Ring', 'Island', 'Wastes', 'Delver of Secrets // Insectile Aberration']),
    );
    expect(find('id<=ur')).toEqual(expect.not.arrayContaining(['Grizzly Bears', 'Kolaghan’s Command', 'Boros Reckoner']));
    expect(find('identity=ur')).toEqual(only('Fire // Ice', 'Niv-Mizzet, Parun'));
    expect(find('id>=r id<=r')).toEqual(find('id=r'));
    expect(find('id=c')).toEqual(only('Sol Ring', 'Wastes', 'Eldrazi Spawn Maker'));
    expect(find('id<=grixis id>=b')).toEqual(only('Kolaghan’s Command', 'Gray Merchant of Asphodel'));
    expect(find('id:m')).toEqual(find('c:m'));
    expect(find('commander:g')).toEqual(find('id<=g'));
  });

  it('says what is wrong with a color', () => {
    expect(error('c:purple')).toMatch(/"purple" is not a color for c/);
    expect(error('id:xyz')).toMatch(/not a color for id/);
    expect(error('c>m')).toMatch(/multicolor/);
  });
});

describe('text', () => {
  it('t: is a substring of the type line, any face; supertypes, types and subtypes', () => {
    expect(find('t:instant')).toEqual(only('Lightning Bolt', 'Fire // Ice', 'Bonecrusher Giant // Stomp', 'Kolaghan’s Command', 'Counterspell'));
    expect(find('t:legend t:creature')).toEqual(only('Niv-Mizzet, Parun'));
    expect(find('type:"legendary creature"')).toEqual(only('Niv-Mizzet, Parun'));
    expect(find('t:"legendary creature — dragon"')).toEqual(only('Niv-Mizzet, Parun'));
    expect(find('t:elf')).toEqual(only('Llanowar Elves'));
    expect(find('t:land')).toEqual(only('Sea Gate Restoration // Sea Gate, Reborn', 'Island', 'Wastes'));
    expect(find('t:basic')).toEqual(only('Island', 'Wastes'));
    expect(find('t:/^creature — human/')).toEqual(only('Delver of Secrets // Insectile Aberration'));
  });

  it('o: is a substring of any face\'s rules text; ~ stands for the card name; {T} symbols work', () => {
    expect(find('o:flying')).toEqual(only('Serra Angel', 'Delver of Secrets // Insectile Aberration', 'Niv-Mizzet, Parun'));
    expect(find('o:"draw a card"')).toEqual(only('Fire // Ice', 'Gitaxian Probe', 'Niv-Mizzet, Parun'));
    expect(find('o:draw o:target')).toEqual(only('Jace, the Mind Sculptor', 'Fire // Ice', 'Gitaxian Probe', 'Niv-Mizzet, Parun'));
    expect(find('oracle:"deals 3 damage"')).toEqual(only('Lightning Bolt'));
    expect(find('o:"~ deals 3"')).toEqual(only('Lightning Bolt'));
    expect(find('o:"sacrifice ~"')).toEqual(only('Eldrazi Spawn Maker'));
    expect(find('o:"{T}: Add"')).toEqual(only('Sol Ring', 'Llanowar Elves', 'Sea Gate Restoration // Sea Gate, Reborn', 'Island', 'Wastes'));
    expect(find('o:"{T}: Add {C}{C}"')).toEqual(only('Sol Ring'));
    // Each face's text is searched on its own: a phrase cannot join two faces' texts, but separate terms may each match a different face.
    expect(find('o:"top card of your library flying"')).toEqual([]);
    expect(find('o:"look at the top card" o:flying')).toEqual(only('Delver of Secrets // Insectile Aberration'));
    expect(find('-o:the t:creature c:g')).toEqual(only('Grizzly Bears', 'Llanowar Elves'));
  });

  it('o: with /regex/; accents, curly quotes and case are folded', () => {
    // ^ and $ match at each line of the text.
    expect(find('o:/^flying$/')).toEqual(only('Delver of Secrets // Insectile Aberration', 'Niv-Mizzet, Parun'));
    expect(find('o:/deals \\d damage/')).toEqual(only('Lightning Bolt', 'Fire // Ice', 'Bonecrusher Giant // Stomp', 'Niv-Mizzet, Parun'));
    expect(find("o:\"player's library\"")).toEqual(only('Jace, the Mind Sculptor'));
    expect(error('o:/[/')).toMatch(/not valid/);
  });

  it('fo: also matches the name and type line', () => {
    expect(find('fo:"serra angel"')).toEqual(only('Serra Angel'));
    expect(find('fo:"creature — angel"')).toEqual(only('Serra Angel'));
    expect(find('o:"serra angel"')).toEqual([]);
    expect(find('fulloracle:vigilance')).toEqual(only('Serra Angel'));
  });

  it('kw: is a keyword the card has (exactly)', () => {
    expect(find('kw:flying')).toEqual(only('Serra Angel', 'Niv-Mizzet, Parun'));
    expect(find('keyword:Vigilance')).toEqual(only('Serra Angel'));
    expect(find('kw:fly')).toEqual([]);
  });
});

describe('numbers', () => {
  it('mv / cmc / manavalue with every comparison, even and odd', () => {
    expect(find('mv=2')).toEqual(only('Grizzly Bears', 'Tarmogoyf', 'Counterspell'));
    expect(find('cmc:2')).toEqual(find('mv=2'));
    expect(find('mv>=5')).toEqual(only('Serra Angel', 'Sea Gate Restoration // Sea Gate, Reborn', 'Niv-Mizzet, Parun', 'Gray Merchant of Asphodel'));
    expect(find('mv>5')).toEqual(only('Sea Gate Restoration // Sea Gate, Reborn', 'Niv-Mizzet, Parun'));
    expect(find('mv<=0')).toEqual(only('Island', 'Wastes'));
    expect(find('mv<1')).toEqual(find('mv<=0'));
    expect(find('mv!=1 mv<3')).toEqual(only('Grizzly Bears', 'Tarmogoyf', 'Counterspell', 'Island', 'Wastes'));
    expect(find('mv:even mv<3')).toEqual(only('Grizzly Bears', 'Tarmogoyf', 'Counterspell', 'Island', 'Wastes'));
    expect(find('mv:odd mv<3')).toEqual(only('Lightning Bolt', 'Sol Ring', 'Llanowar Elves', 'Delver of Secrets // Insectile Aberration', 'Gitaxian Probe'));
    expect(find('manavalue=4')).toEqual(only('Jace, the Mind Sculptor', 'Fire // Ice', 'Eldrazi Spawn Maker'));
  });

  it('pow / tou / pt over any face; a printed * counts as 0 and 1+* as 1; pow=* finds the stars', () => {
    expect(find('pow>=4')).toEqual(only('Serra Angel', 'Bonecrusher Giant // Stomp', 'Niv-Mizzet, Parun'));
    expect(find('power=3')).toEqual(only('Delver of Secrets // Insectile Aberration', 'Boros Reckoner', 'Eldrazi Spawn Maker'));
    expect(find('tou<=1 t:creature')).toEqual(only('Llanowar Elves', 'Tarmogoyf', 'Delver of Secrets // Insectile Aberration'));
    expect(find('pow=0')).toEqual(only('Tarmogoyf'));
    expect(find('pow=*')).toEqual(only('Tarmogoyf'));
    expect(find('tou=*')).toEqual(only('Tarmogoyf'));
    expect(find('pt>=8')).toEqual(only('Serra Angel', 'Niv-Mizzet, Parun'));
    expect(find('pt=2')).toEqual(only('Delver of Secrets // Insectile Aberration', 'Llanowar Elves'));
    expect(find('toughness:4')).toEqual(only('Serra Angel', 'Gray Merchant of Asphodel'));
  });

  it('compares one stat with another', () => {
    expect(find('pow>tou')).toEqual(only('Delver of Secrets // Insectile Aberration', 'Bonecrusher Giant // Stomp'));
    expect(find('pow=tou t:creature pow>3')).toEqual(only('Serra Angel', 'Niv-Mizzet, Parun'));
    expect(find('pow>mv t:creature')).toEqual(only('Delver of Secrets // Insectile Aberration', 'Bonecrusher Giant // Stomp'));
    expect(find('tou>pow')).toEqual(expect.arrayContaining(['Tarmogoyf', 'Gray Merchant of Asphodel']));
  });

  it('loy and def', () => {
    expect(find('loy=3')).toEqual(only('Jace, the Mind Sculptor'));
    expect(find('loyalty>=4')).toEqual([]);
    expect(find('def>0')).toEqual([]);
    expect(error('mv:big')).toMatch(/"big" is not a number for mv:/);
    expect(error('pow:x')).toMatch(/not a number for pow/);
  });
});

describe('mana, produces, devotion', () => {
  it('m: contains these symbols; = is exactly them; hybrid and Phyrexian symbols; short forms', () => {
    expect(find('m:{R}')).toEqual(only('Lightning Bolt', 'Fire // Ice', 'Bonecrusher Giant // Stomp', 'Kolaghan’s Command', 'Niv-Mizzet, Parun'));
    expect(find('m:{R}{R}')).toEqual(only('Niv-Mizzet, Parun'));
    expect(find('mana:{2}{U}{U}')).toEqual(only('Jace, the Mind Sculptor', 'Niv-Mizzet, Parun'));
    expect(find('m:2UU')).toEqual(find('m:{2}{U}{U}'));
    expect(find('m={R}')).toEqual(only('Lightning Bolt'));
    expect(find('m={1}{R}')).toEqual(only('Fire // Ice', 'Bonecrusher Giant // Stomp'));
    expect(find('m>{1}{B}{R}')).toEqual([]);
    expect(find('m<={1}{B}{R} m:{B}')).toEqual(only('Kolaghan’s Command'));
    expect(find('m:{R/W}{R/W}')).toEqual(only('Boros Reckoner'));
    expect(find('m:{W/R}')).toEqual(only('Boros Reckoner'));
    expect(find('m:{U/P}')).toEqual(only('Gitaxian Probe'));
    expect(find('m:{1}{U}')).toEqual(only('Fire // Ice'));
    expect(error('m:{R')).toMatch(/not a list of mana symbols/);
    expect(error('m:hello')).toMatch(/not a list of mana symbols/);
  });

  it('produces: at least those colors; = exactly', () => {
    expect(find('produces:c')).toEqual(only('Sol Ring', 'Wastes'));
    expect(find('produces:g')).toEqual(only('Llanowar Elves'));
    expect(find('produces=u')).toEqual(only('Island'));
    expect(find('produces>=wubrg')).toEqual([]);
    expect(find('produces<=ug')).toEqual(only('Llanowar Elves', 'Island'));
    expect(error('produces:x')).toMatch(/not a list of mana colors/);
  });

  it('devotion: the symbols of a color in the mana cost (hybrid counts for both colors)', () => {
    expect(find('devotion:{B}{B}')).toEqual(only('Gray Merchant of Asphodel'));
    expect(find('devotion>={R}{R}{R}')).toEqual(only('Boros Reckoner'));
    expect(find('devotion:{W}{W}{W}')).toEqual(only('Boros Reckoner'));
    expect(find('devotion={U}{U}')).toEqual(only('Jace, the Mind Sculptor', 'Sea Gate Restoration // Sea Gate, Reborn', 'Counterspell', 'Niv-Mizzet, Parun'));
    expect(error('devotion:{2}')).toMatch(/devotion counts colored mana symbols/);
  });
});

describe('formats', () => {
  it('f: / format: / legal: is legal or restricted; banned: and restricted: are exact; aliases work', () => {
    expect(find('f:modern t:artifact')).toEqual([]);
    expect(find('f:vintage t:artifact')).toEqual(only('Sol Ring'));
    expect(find('legal:legacy t:artifact')).toEqual([]);
    expect(find('banned:legacy')).toEqual(only('Sol Ring'));
    expect(find('banned:modern')).toEqual(only('Jace, the Mind Sculptor', 'Gitaxian Probe'));
    expect(find('restricted:vintage')).toEqual(only('Sol Ring'));
    expect(find('format:standard')).toEqual(only('Grizzly Bears'));
    expect(find('f:edh t:artifact')).toEqual(only('Sol Ring'));
    expect(find('f:commander t:artifact')).toEqual(only('Sol Ring'));
  });

  it('reports the legality keys the query names, so the handler can reject an unknown format', () => {
    const r = parseScryfall('f:modern -banned:legacy f:edh');
    expect(typeof r).not.toBe('string');
    expect((r as { formats: string[] }).formats).toEqual(['modern', 'legacy', 'commander']);
    expect(error('f:casual')).toMatch(/format without a card pool/);
    expect(error('f:Mod!ern')).toMatch(/not a format name/);
  });
});

describe('is:, not:, has:, layout:', () => {
  it('permanent, spell, historic, commander', () => {
    expect(find('is:permanent t:artifact')).toEqual(only('Sol Ring'));
    expect(find('is:permanent')).not.toContain('Lightning Bolt');
    expect(find('is:permanent')).toContain('Island');
    expect(find('is:spell')).not.toContain('Island');
    expect(find('is:spell')).toContain('Lightning Bolt');
    // A modal DFC with a spell face can be cast.
    expect(find('is:spell')).toContain('Sea Gate Restoration // Sea Gate, Reborn');
    expect(find('is:historic')).toEqual(only('Sol Ring', 'Jace, the Mind Sculptor', 'Niv-Mizzet, Parun'));
    expect(find('is:commander')).toEqual(only('Niv-Mizzet, Parun'));
    // Bonecrusher Giant has an Instant face but is a creature card, so it is a permanent.
    expect(find('not:permanent t:instant')).toEqual(only('Lightning Bolt', 'Fire // Ice', 'Kolaghan’s Command', 'Counterspell'));
    expect(find('-is:spell')).toEqual(only('Island', 'Wastes'));
  });

  it('vanilla and frenchvanilla', () => {
    expect(find('is:vanilla')).toEqual(only('Grizzly Bears'));
    expect(find('is:frenchvanilla')).toEqual(only('Serra Angel'));
  });

  it('layouts: split, transform, mdfc, dfc, adventure and layout:', () => {
    expect(find('is:split')).toEqual(only('Fire // Ice'));
    expect(find('is:transform')).toEqual(only('Delver of Secrets // Insectile Aberration'));
    expect(find('is:mdfc')).toEqual(only('Sea Gate Restoration // Sea Gate, Reborn'));
    expect(find('is:dfc')).toEqual(only('Delver of Secrets // Insectile Aberration', 'Sea Gate Restoration // Sea Gate, Reborn'));
    expect(find('is:adventure')).toEqual(only('Bonecrusher Giant // Stomp'));
    expect(find('layout:split')).toEqual(find('is:split'));
    expect(error('layout:wide')).toMatch(/not a card layout/);
  });

  it('hybrid, phyrexian, has:', () => {
    expect(find('is:hybrid')).toEqual(only('Boros Reckoner'));
    expect(find('is:phyrexian')).toEqual(only('Gitaxian Probe'));
    expect(find('has:indicator')).toEqual(only('Delver of Secrets // Insectile Aberration'));
    expect(find('has:loyalty')).toEqual(only('Jace, the Mind Sculptor'));
    expect(find('has:pt t:elf')).toEqual(only('Llanowar Elves'));
    expect(error('has:wings')).toMatch(/"has:wings" is not supported/);
  });

  it('a printing property is reported by name, never guessed', () => {
    for (const p of ['reprint', 'promo', 'foil', 'digital', 'reserved', 'fullart']) expect(error(`is:${p}`)).toContain(`"is:${p}" is not supported`);
    expect(error('is:bikeland')).toMatch(/"is:bikeland" is not a supported property. Supported: .*commander/);
  });
});

describe('logic', () => {
  it('implicit AND, and, OR / or, parentheses, negation', () => {
    expect(find('t:creature c:g mv<2')).toEqual(only('Llanowar Elves'));
    expect(find('t:creature and c:g and mv<2')).toEqual(find('t:creature c:g mv<2'));
    expect(find('bolt OR goyf')).toEqual(only('Lightning Bolt', 'Tarmogoyf'));
    expect(find('bolt or goyf')).toEqual(find('bolt OR goyf'));
    expect(find('t:elf or t:bear mv<2')).toEqual(only('Llanowar Elves'));
    expect(find('(t:elf or t:bear) mv<2')).toEqual(only('Llanowar Elves'));
    expect(find('(t:elf or t:bear) mv<3')).toEqual(only('Grizzly Bears', 'Llanowar Elves'));
    expect(find('-(c:g or c:u or c:w or c:b or c:r) mv>0')).toEqual(only('Sol Ring', 'Eldrazi Spawn Maker'));
    expect(find('-t:creature -t:instant -t:land -t:planeswalker -t:sorcery')).toEqual(only('Sol Ring'));
    expect(find('t:instant -c:r')).toEqual(only('Counterspell'));
    expect(find('((t:elf))')).toEqual(only('Llanowar Elves'));
    expect(find('t:creature (c:r or c:w) (mv=3 or mv=5)')).toEqual(only('Serra Angel', 'Bonecrusher Giant // Stomp', 'Boros Reckoner'));
  });

  it('AND binds tighter than OR', () => {
    expect(find('t:elf or t:bear c:u')).toEqual(only('Llanowar Elves'));
    expect(find('t:elf or t:angel c:w')).toEqual(only('Llanowar Elves', 'Serra Angel'));
  });

  it('reports malformed queries by what is wrong', () => {
    expect(error('')).toMatch(/Type a search in Scryfall syntax/);
    expect(error('   ')).toMatch(/Type a search/);
    expect(error('(t:elf')).toMatch(/missing its closing "\)"/);
    expect(error('t:elf)')).toMatch(/no matching "\("/);
    expect(error('()')).toMatch(/Empty parentheses/);
    expect(error('or t:elf')).toMatch(/"or" needs a search on its left side/);
    expect(error('t:elf or')).toMatch(/"or" needs a search on its right side/);
    expect(error('t:elf and')).toMatch(/"and" needs a search on its right side/);
    expect(error('t:"elf')).toMatch(/missing its closing "/);
    expect(error('t:')).toMatch(/Missing value after "t:"/);
    expect(error('- t:elf')).toMatch(/"-" must be directly followed/);
    expect(error('t:"a"b')).toMatch(/Unexpected text after the closing/);
    expect(error('t>=elf')).toMatch(/"t" takes ":" only/);
    expect(error('-')).toBeTruthy();
    expect(error('t:elf -')).toBeTruthy();
  });
});

describe('sets (s:, set:, e:, edition:)', () => {
  it('names each set once, as typed in lower case, and matches the cards the handler lists for it', () => {
    const r = parseScryfall('s:LEA or set:"Dominaria United" or e:dmu edition:dmu');
    if (typeof r === 'string') throw new Error(r);
    expect(r.sets).toEqual(['lea', 'dominaria united', 'dmu']);
    const bolt = searchRow(card({ name: 'Lightning Bolt', oracle_id: 'bolt-id', type_line: 'Instant', oracle_text: '' }));
    const bears = searchRow(card({ name: 'Grizzly Bears', oracle_id: 'bears-id', type_line: 'Creature — Bear', oracle_text: '' }));
    // A set the handler has not filled matches nothing (never every card).
    expect([bolt, bears].filter(r.test)).toEqual([]);
    r.setCards.set('lea', new Set(['bolt-id', 'bears-id']));
    r.setCards.set('dmu', new Set(['bears-id']));
    expect([bolt, bears].filter(r.test).map((x) => x.card.name)).toEqual(['Lightning Bolt', 'Grizzly Bears']);
    const neg = parseScryfall('t:creature -s:dmu');
    if (typeof neg === 'string') throw new Error(neg);
    neg.setCards.set('dmu', new Set(['bears-id']));
    expect([bolt, bears].filter(neg.test)).toEqual([]);
  });

  it('takes ":" and "=" only, and no regular expression', () => {
    expect(error('s>dmu')).toMatch(/takes ":" only/);
    expect(error('s:/dm/')).toMatch(/Regular expressions/);
    expect(error(`s:${'x'.repeat(61)}`)).toMatch(/too long/);
  });
});

describe('unsupported and unknown keywords', () => {
  it('names the keyword and says why, for every printing, price, tag and display keyword', () => {
    const cases: [string, RegExp][] = [
      ['b:ravnica', /"b:" \(block\) is not supported: .*printing data/],
      ['block:ravnica', /\(block\)/],
      ['r:mythic', /"r:" \(rarity\)/],
      ['rarity>=rare', /"rarity>=" \(rarity\)/],
      ['a:"Rebecca Guay"', /"a:" \(artist\)/],
      ['artist:guay', /\(artist\)/],
      ['ft:"flavor"', /"ft:" \(flavor text\)/],
      ['flavor:fire', /\(flavor text\)/],
      ['year>=2020', /"year>=" \(release year\)/],
      ['date>2020-01-01', /\(release date\)/],
      ['usd>10', /"usd>" \(price in US dollars\) is not supported: the local card index keeps no prices/],
      ['eur<1', /\(price in euros\)/],
      ['tix<1', /\(price in tickets\)/],
      ['cn:1', /\(collector number\)/],
      ['wm:izzet', /\(watermark\)/],
      ['lang:ja', /\(language\)/],
      ['in:lea', /\(printed in\)/],
      ['game:arena', /\(game\)/],
      ['border:black', /\(border\)/],
      ['frame:2015', /\(frame\)/],
      ['stamp:acorn', /\(security stamp\)/],
      ['function:removal', /\(function tag\)/],
      ['otag:removal', /\(oracle tag\)/],
      ['art:squirrel', /\(art tag\)/],
      ['order:cmc', /"order:" \(result order\)/],
      ['unique:prints', /\(result grouping\)/],
      ['prefer:newest', /\(preferred printing\)/],
      ['display:text', /\(result display\)/],
      ['include:extras', /\(extra results\)/],
    ];
    for (const [q, re] of cases) expect(error(q), q).toMatch(re);
  });

  it('an unknown keyword is named, with the supported ones listed', () => {
    const m = error('t:elf wibble:3');
    expect(m).toMatch(/Unknown search keyword "wibble"/);
    for (const k of ['c/color', 'o/oracle', 'mv/cmc', 'f/format/legal', 'is']) expect(m).toContain(k);
    expect(m).toContain('https://scryfall.com/docs/syntax');
    // Typed text that happens to be a property of Object is not a keyword either.
    expect(error('constructor:x')).toMatch(/Unknown search keyword "constructor"/);
    expect(error('toString:x')).toMatch(/Unknown search keyword "tostring"/);
    expect(error('is:constructor')).toMatch(/not a supported property/);
  });

  it('an unsupported keyword anywhere in the query rejects the whole query (never a partial answer)', () => {
    expect(error('t:creature (c:g or r:rare)')).toMatch(/"r:" \(rarity\)/);
    expect(error('-st:core')).toMatch(/"st:" \(set type\)/);
    expect(error('t:elf or usd<1')).toMatch(/"usd<"/);
  });

  it('the help lists exist', () => {
    expect(SUPPORTED_KEYWORDS.length).toBeGreaterThan(15);
    expect(IS_VALUES).toEqual(expect.arrayContaining(['commander', 'permanent', 'spell', 'historic', 'vanilla', 'frenchvanilla', 'split', 'transform', 'mdfc', 'dfc']));
  });
});

describe('the scry search parameter', () => {
  it('parseSearch ANDs the Scryfall query with the other parameters and reports its errors as the 400 message', () => {
    const parsed = parseSearch({ scry: 't:creature c:g', mv: '<=1' });
    expect(typeof parsed).not.toBe('string');
    const p = parsed as Exclude<typeof parsed, string>;
    expect(ROWS.filter((r) => p.tests.every((t) => t(r))).map((r) => r.card.name)).toEqual(['Llanowar Elves']);
    expect(p.scryFormats).toEqual([]);
    expect((parseSearch({ scry: 'f:EDH' }) as Exclude<ReturnType<typeof parseSearch>, string>).scryFormats).toEqual(['commander']);
    expect(parseSearch({ scry: 'r:rare' })).toMatch(/"r:" \(rarity\)/);
    expect(parseSearch({ scry: '' })).not.toBeTypeOf('string');
    expect(parseSearch({ scry: 'x'.repeat(501) })).toMatch(/too long/);
  });

  it('the known formats are what the handler checks scryFormats against', () => {
    expect(FORMATS).toContain('modern');
  });
});
