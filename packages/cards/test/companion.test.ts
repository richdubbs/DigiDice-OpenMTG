/**
 * CMP1: companion deck conditions (CR 702.139a-b) as data (formats/companion.ts) and their place in validateDeck. The first part reads the real card index
 * (git-ignored; skipped when absent; in a worktree the main checkout's cache is found, or set OPENMTG_CACHE_DIR): the recorded conditions are the Oracle ones,
 * and each condition is checked on real cards. The second part checks the validator with synthetic cards.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { OracleCard } from '@openmtg/engine';
import { CardDatabase } from '../src/database';
import { COMPANION_RULES, checkCompanion, companionRuleOf, hasCompanion, validateDeck, type DeckEntry, type FormatProblem, type FormatReport } from '../src/formats';
import { cacheFiles } from '../src/paths';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function cacheDir(): string | undefined {
  const env = process.env.OPENMTG_CACHE_DIR?.trim();
  const roots = [REPO];
  const dotGit = path.join(REPO, '.git');
  if (existsSync(dotGit) && statSync(dotGit).isFile()) {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
    if (m) roots.push(path.resolve(REPO, m[1]!.trim(), '..', '..', '..'));
  }
  const dirs = env ? [env] : roots.map((r) => path.join(r, '.cache', 'scryfall'));
  return dirs.find((d) => existsSync(cacheFiles(d).cards));
}

const dir = (() => {
  try {
    return cacheDir();
  } catch {
    return undefined;
  }
})();

const codes = (r: FormatReport, severity: FormatProblem['severity'] = 'error') => r.problems.filter((p) => p.severity === severity).map((p) => p.code);

describe.skipIf(!dir)('CR 702.139a: companion conditions on the real card index', () => {
  let db: CardDatabase;
  let cards: OracleCard[];
  const get = (name: string) => {
    const card = db.lookup(name);
    if (!card) throw new Error(`not in the index: ${name}`);
    return card;
  };
  const e = (count: number, name: string): DeckEntry => ({ count, card: get(name) });
  /** The verdict of companion `name` for a deck of one copy of each card (`n` copies with "4 Name"). */
  const verdict = (name: string, deck: (string | [number, string])[], minDeckSize = 60) =>
    checkCompanion(get(name), { entries: deck.map((d) => (typeof d === 'string' ? e(1, d) : e(d[0], d[1]))), unknown: 0, minDeckSize })?.status;

  beforeAll(async () => {
    db = await CardDatabase.open({ cacheDir: dir! });
    cards = [...db.cards()];
  }, 60_000);

  it('CR 702.139a: the ten recorded conditions are the Oracle wording of the ten companions', () => {
    expect(COMPANION_RULES).toHaveLength(10);
    for (const rule of COMPANION_RULES) expect(companionRuleOf(get(rule.name))?.name, rule.name).toBe(rule.name);
  });

  it('CR 702.139a: every sanctioned card with a companion ability has a recorded condition (the others are never called checked)', () => {
    const companions = cards.filter((c) => hasCompanion(c));
    expect(companions.length).toBeGreaterThanOrEqual(10);
    // Treizeci's "only nostalgic cards" is about printings (retro frames), which the Oracle index does not hold: a warning, never a verdict.
    expect(companions.filter((c) => !c.unsanctioned && !companionRuleOf(c)).map((c) => c.name)).toEqual(['Treizeci, Sun of Serra']);
  });

  it("CR 702.139a: Gyruda (even mana values; a land's is 0, CR 202.3a; a split card's is both halves', CR 709.4b)", () => {
    expect(verdict('Gyruda, Doom of Depths', ['Forest', 'Commit // Memory', 'Fire // Ice', 'Tarmogoyf'])).toBe('met');
    expect(verdict('Gyruda, Doom of Depths', ['Forest', 'Lightning Bolt'])).toBe('unmet');
  });

  it('CR 702.139a: Obosh (odd mana values and land cards)', () => {
    expect(verdict('Obosh, the Preypiercer', ['Forest', 'Lightning Bolt', 'Kitchen Finks'])).toBe('met');
    expect(verdict('Obosh, the Preypiercer', ['Forest', 'Tarmogoyf'])).toBe('unmet');
  });

  it("CR 702.139a, 712.8a: Keruga (mana value 3 or greater and land cards; a modal double-faced card is its front face's)", () => {
    expect(verdict('Keruga, the Macrosage', ['Forest', 'Valakut Awakening // Valakut Stoneforge', 'Kitchen Finks'])).toBe('met');
    expect(verdict('Keruga, the Macrosage', ['Forest', 'Lightning Bolt'])).toBe('unmet');
  });

  it('CR 702.139a, 715.4: Lurrus (permanent cards with mana value 2 or less; an adventurer card has its creature characteristics)', () => {
    expect(verdict('Lurrus of the Dream-Den', ['Forest', 'Tarmogoyf', 'Bonesplitter', 'Fire // Ice', 'Commit // Memory'])).toBe('met');
    expect(verdict('Lurrus of the Dream-Den', ['Forest', 'Kitchen Finks'])).toBe('unmet');
    expect(verdict('Lurrus of the Dream-Den', ['Bonecrusher Giant // Stomp'])).toBe('unmet');
  });

  it("CR 702.139a, 709.4b: Jegantha (no repeated mana symbol; Fire // Ice's {1} twice is the CR's own example)", () => {
    expect(verdict('Jegantha, the Wellspring', ['Forest', 'Lightning Bolt', 'Tarmogoyf', 'Bonecrusher Giant // Stomp'])).toBe('met');
    expect(verdict('Jegantha, the Wellspring', ['Fire // Ice'])).toBe('unmet');
    expect(verdict('Jegantha, the Wellspring', ['Counterspell'])).toBe('unmet');
  });

  it('CR 702.139a, 702.73a, 604.3: Kaheera (creature types; changeling and "is every creature type" count; noncreature cards are free)', () => {
    expect(verdict('Kaheera, the Orphanguard', ['Forest', 'Lightning Bolt', 'Wild Nacatl', 'Mistform Ultimus', 'Changeling Outcast', 'Colossal Dreadmaw'])).toBe('met');
    expect(verdict('Kaheera, the Orphanguard', ['Grizzly Bears'])).toBe('unmet');
    // CR 113.6c: Grist is a 1/1 Insect creature card outside the battlefield
    expect(verdict('Kaheera, the Orphanguard', ['Grist, the Hunger Tide'])).toBe('unmet');
  });

  it('CR 702.139a: Lutri (each nonland card has a different name; lands may repeat)', () => {
    expect(verdict('Lutri, the Spellchaser', [[10, 'Forest'], 'Lightning Bolt', 'Counterspell'])).toBe('met');
    expect(verdict('Lutri, the Spellchaser', [[2, 'Lightning Bolt']])).toBe('unmet');
  });

  it('CR 702.139a, 205.2a: Umori (the nonland cards share a card type; kindred is a card type)', () => {
    expect(verdict('Umori, the Collector', ['Forest', 'Grizzly Bears', 'Tarmogoyf', 'Dryad Arbor'])).toBe('met');
    expect(verdict('Umori, the Collector', ['Forest', 'Grizzly Bears', 'Lightning Bolt'])).toBe('unmet');
  });

  it('CR 702.139a, 100.2a, 903.5a: Yorion (twenty more cards than the minimum deck size)', () => {
    expect(verdict('Yorion, Sky Nomad', [[80, 'Forest']])).toBe('met');
    expect(verdict('Yorion, Sky Nomad', [[79, 'Forest']])).toBe('unmet');
    expect(verdict('Yorion, Sky Nomad', [[100, 'Forest']], 100)).toBe('unmet'); // a Commander deck can't (CR 903.5a, 702.139b)
  });

  it('CR 702.139a, 305.6, 702.6a: Zirda (each permanent card has an activated ability; a basic land type gives one, equip is one)', () => {
    expect(verdict('Zirda, the Dawnwaker', ['Forest', 'Taiga', 'Llanowar Elves', 'Bonesplitter', 'Lightning Bolt', 'Jace Beleren'])).toBe('met');
    expect(verdict('Zirda, the Dawnwaker', ['Grizzly Bears'])).toBe('unmet');
    expect(verdict('Zirda, the Dawnwaker', ['Tarmogoyf'])).toBe('unmet');
  });

  it('CR 702.139a: a real Arena list with Lurrus checks, and an unmet condition is an error', () => {
    const main = [e(20, 'Forest'), e(4, 'Tarmogoyf'), e(4, 'Lightning Bolt'), e(4, 'Wild Nacatl'), e(4, 'Bonesplitter'), e(24, 'Mountain')];
    const ok = validateDeck({ main, sideboard: [e(1, 'Lurrus of the Dream-Den')], companion: [e(1, 'Lurrus of the Dream-Den')] }, 'casual');
    expect(codes(ok)).toEqual([]);
    expect(codes(ok, 'warning')).toEqual([]);
    expect(ok.companion).toBe('Lurrus of the Dream-Den');
    const bad = validateDeck({ main: [...main, e(1, 'Kitchen Finks')], companion: [e(1, 'Lurrus of the Dream-Den')] }, 'casual');
    expect(codes(bad)).toEqual(['companion-condition']);
    expect(bad.problems[0]!.message).toMatch(/Kitchen Finks/);
  });
});

// ---- the validator, synthetic cards

const LEGAL = Object.fromEntries(['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'duel', 'brawl', 'standardbrawl', 'historic', 'timeless'].map((f) => [f, 'legal']));
function c(name: string, extra: Partial<OracleCard> = {}): OracleCard {
  return { name, layout: 'normal', type_line: 'Instant', oracle_text: '', color_identity: ['R'], cmc: 1, legalities: LEGAL, ...extra } as OracleCard;
}
const e = (count: number, card: OracleCard): DeckEntry => ({ count, card });
const lurrus = c('Lurrus of the Dream-Den', {
  type_line: 'Legendary Creature — Cat Nightmare', keywords: ['Lifelink', 'Companion'], cmc: 3, color_identity: ['W', 'B'],
  oracle_text: 'Companion — Each permanent card in your starting deck has mana value 2 or less. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.)\nLifelink',
});
const lutri = c('Lutri, the Spellchaser', {
  type_line: 'Legendary Creature — Elemental Otter', keywords: ['Companion', 'Flash'], cmc: 3, color_identity: ['U', 'R'],
  oracle_text: 'Companion — Each nonland card in your starting deck has a different name. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.)\nFlash',
});
const yorion = c('Yorion, Sky Nomad', {
  type_line: 'Legendary Creature — Bird Serpent', keywords: ['Flying', 'Companion'], cmc: 5, color_identity: ['W', 'U'],
  oracle_text: 'Companion — Your starting deck contains at least twenty cards more than the minimum deck size. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.)\nFlying',
});
const bear = c('Bear', { type_line: 'Creature — Bear', cmc: 2 });
const ogre = c('Ogre', { type_line: 'Creature — Ogre', cmc: 3 });
/** 60 different instants: Lurrus, Lutri and every other condition but Yorion's hold. */
const sixtyOnes = () => Array.from({ length: 60 }, (_, i) => e(1, c(`Spell ${i + 1}`)));

describe('CR 702.139a: companion conditions in validateDeck', () => {
  it('CR 702.139a: a met condition gives no warning; the report names the companion', () => {
    const r = validateDeck({ main: [...sixtyOnes(), e(4, bear)], sideboard: [e(1, lurrus)], companion: [e(1, lurrus)] }, 'modern');
    expect(codes(r)).toEqual([]);
    expect(codes(r, 'warning')).toEqual([]);
    expect(r.companion).toBe('Lurrus of the Dream-Den');
  });

  it('CR 702.139a: an unmet condition is an error naming the cards (in every format, casual too)', () => {
    for (const format of ['modern', 'casual']) {
      const r = validateDeck({ main: [...sixtyOnes(), e(4, ogre)], companion: [e(1, lurrus)] }, format);
      expect(codes(r), format).toEqual(['companion-condition']);
      expect(r.valid).toBe(false);
      expect(r.problems[0]).toMatchObject({ card: 'Lurrus of the Dream-Den', section: 'companion', rule: 'CR 702.139a' });
      expect(r.problems[0]!.message).toMatch(/Ogre/);
    }
  });

  it('CR 702.139a: Lutri, the Spellchaser: a singleton condition', () => {
    expect(codes(validateDeck({ main: sixtyOnes(), companion: [e(1, lutri)] }, 'legacy'))).toEqual([]);
    expect(codes(validateDeck({ main: [...sixtyOnes(), e(2, bear)], companion: [e(1, lutri)] }, 'legacy'))).toEqual(['companion-condition']);
  });

  it('CR 702.139a, 100.2a: Yorion needs twenty cards more than the format minimum (60 in constructed, 100 with the commander, CR 702.139b)', () => {
    expect(codes(validateDeck({ main: sixtyOnes(), companion: [e(1, yorion)] }, 'modern'))).toEqual(['companion-condition']);
    const eighty = [...sixtyOnes(), ...Array.from({ length: 20 }, (_, i) => e(1, c(`More ${i + 1}`)))];
    expect(codes(validateDeck({ main: eighty, companion: [e(1, yorion)] }, 'modern'))).toEqual([]);
  });

  it('CR 702.139a, 100.2a: in a format without a minimum deck size (casual), Yorion below 80 cards is a warning, never an error', () => {
    const forty = sixtyOnes().slice(0, 40);
    const r = validateDeck({ main: forty, companion: [e(1, yorion)] }, 'casual');
    expect(codes(r)).toEqual([]);
    expect(codes(r, 'warning')).toEqual(['companion-unchecked']);
    expect(r.problems[0]!.message).toMatch(/no minimum deck size.*20 cards more than the format's minimum/);
    const eighty = [...sixtyOnes(), ...Array.from({ length: 20 }, (_, i) => e(1, c(`More ${i + 1}`)))];
    expect(validateDeck({ main: eighty, companion: [e(1, yorion)] }, 'casual').problems).toEqual([]);
  });

  it('CR 702.139a: unknown cards in the starting deck leave a met condition unchecked (a warning), never met', () => {
    const r = validateDeck({ main: sixtyOnes(), companion: [e(1, lurrus)], unresolved: [{ section: 'main', name: 'Mystery', count: 1 }] }, 'modern');
    expect(codes(r)).toEqual([]);
    expect(codes(r, 'warning').sort()).toEqual(['companion-unchecked', 'unresolved-card']);
  });

  it('CR 702.139a: a companion whose Oracle wording is not recorded is not checked (a warning)', () => {
    const odd = c('Lurrus of the Dream-Den', { ...lurrus, oracle_text: 'Companion — Something else.' });
    const r = validateDeck({ main: sixtyOnes(), companion: [e(1, odd)] }, 'modern');
    expect(codes(r, 'warning')).toEqual(['companion-unchecked']);
  });

  it('CR 702.139a, 100.4: an MTGO list (no Companion section) reads the one fitting companion from the sideboard (a note)', () => {
    const r = validateDeck({ main: sixtyOnes(), sideboard: [e(1, lurrus), e(2, bear)] }, 'modern');
    expect(codes(r)).toEqual([]);
    expect(codes(r, 'note')).toEqual(['companion-from-sideboard']);
    expect(r.companion).toBe('Lurrus of the Dream-Den');
    expect(r.counts).toMatchObject({ sideboard: 3, companion: 1 }); // it stays one of the sideboard's cards
  });

  it('CR 702.139a: a sideboard companion whose condition is not met is just a sideboard card; a note says which condition failed', () => {
    const r = validateDeck({ main: [...sixtyOnes(), e(4, ogre)], sideboard: [e(1, lurrus)] }, 'modern');
    expect(codes(r)).toEqual([]);
    expect(codes(r, 'note')).toEqual(['companion-condition']);
    const note = r.problems.find((p) => p.severity === 'note')!;
    expect(note).toMatchObject({ card: 'Lurrus of the Dream-Den', section: 'sideboard', rule: 'CR 702.139a' });
    expect(note.message).toContain('Lurrus of the Dream-Den in the sideboard is not read as the companion: its companion condition is not met ("Each permanent card in your starting deck has mana value 2 or less."): ');
    expect(note.message).toMatch(/Ogre/);
    expect(r.companion).toBeUndefined();
    // a fitting one next to it is read, and the unfitting one is then only a sideboard card (no note)
    const both = validateDeck({ main: [...sixtyOnes(), e(1, ogre)], sideboard: [e(1, lurrus), e(1, lutri)] }, 'modern');
    expect(both.companion).toBe('Lutri, the Spellchaser');
    expect(codes(both, 'note')).toEqual(['companion-from-sideboard']);
  });

  it('CR 702.139a: two fitting companions in an MTGO sideboard: none is chosen for the player (a note)', () => {
    const r = validateDeck({ main: sixtyOnes(), sideboard: [e(1, lurrus), e(1, lutri)] }, 'modern');
    expect(codes(r, 'note')).toEqual(['companion-ambiguous']);
    expect(r.companion).toBeUndefined();
  });
});
