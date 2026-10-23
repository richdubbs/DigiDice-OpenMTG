/**
 * Format validation on real cards from the local index (git-ignored; skipped when absent; in a worktree the main checkout's cache is found, or set
 * OPENMTG_CACHE_DIR). Checks the card-text readers on every card that has the text they read, and a few real decks.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { OracleCard } from '@openmtg/engine';
import { CardDatabase } from '../src/database';
import { canBeCommander, canPartner, deckLimitText, hasCompanion, isBasicLand, partnerAbilities, validateDeck, type DeckEntry } from '../src/formats';
import { legalityIn } from '../src/legalities';
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

describe.skipIf(!dir)('formats on the real card index', () => {
  let db: CardDatabase;
  let cards: OracleCard[];
  const get = (name: string) => {
    const card = db.lookup(name);
    if (!card) throw new Error(`not in the index: ${name}`);
    return card;
  };
  const e = (count: number, name: string): DeckEntry => ({ count, card: get(name) });

  beforeAll(async () => {
    db = await CardDatabase.open({ cacheDir: dir! });
    cards = [...db.cards()];
  }, 60_000);

  it('every "A deck can have ..." sentence is read (none left "unknown")', () => {
    const withText = cards.filter((c) => deckLimitText(c) !== undefined);
    expect(withText.length).toBeGreaterThanOrEqual(13);
    expect(withText.filter((c) => deckLimitText(c) === 'unknown').map((c) => c.name)).toEqual([]);
    expect(deckLimitText(get('Relentless Rats'))).toBe('any');
    expect(deckLimitText(get('Seven Dwarves'))).toBe(7);
    expect(deckLimitText(get('Nazgûl'))).toBe(9);
  });

  it('CR 205.4c: the basic lands are the Basic Land cards, all exempt from copy limits', () => {
    const basics = cards.filter(isBasicLand).map((c) => c.name);
    for (const n of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes', 'Snow-Covered Island']) expect(basics).toContain(n);
    expect(basics).not.toContain('Breeding Pool');
  });

  it('CR 702.124: every card with a partner-type keyword has a partner ability read from its text', () => {
    const kw = new Set(['Partner', 'Partner with', 'Choose a background', "Doctor's companion"]);
    const missed = cards.filter((c) => c.keywords?.some((k) => kw.has(k)) && partnerAbilities(c).length === 0).map((c) => c.name);
    expect(missed).toEqual([]);
  });

  it('CR 702.139a: every card with the Companion keyword is a companion', () => {
    const companions = cards.filter((c) => c.keywords?.includes('Companion'));
    expect(companions.length).toBeGreaterThanOrEqual(10);
    expect(companions.filter((c) => !hasCompanion(c)).map((c) => c.name)).toEqual([]);
  });

  it('real commanders and partner pairs (CR 903.3, 702.124h/j/k/m)', () => {
    expect(canBeCommander(get('Krenko, Mob Boss'), 'commander')).toBe(true);
    expect(canBeCommander(get('Lightning Bolt'), 'commander')).toBe(false);
    expect(canPartner(get('Tymna the Weaver'), get('Thrasios, Triton Hero'))).toBe(true);
    expect(canPartner(get('Pir, Imaginative Rascal'), get('Toothy, Imaginary Friend'))).toBe(true);
    expect(canPartner(get('Pir, Imaginative Rascal'), get('Tymna the Weaver'))).toBe(false);
    expect(canPartner(get('Wilson, Refined Grizzly'), get('Agent of the Iron Throne'))).toBe(true);
    expect(canPartner(get('Rose Tyler'), get('The Eleventh Doctor'))).toBe(true);
  });

  it('Scryfall legalities on real cards: Black Lotus restricted in Vintage, banned in Legacy, legal in Commander', () => {
    const lotus = get('Black Lotus');
    expect(legalityIn(lotus, 'vintage')).toBe('restricted');
    const sixty = [e(4, 'Lightning Bolt'), e(4, 'Counterspell'), e(1, 'Black Lotus'), e(51, 'Island')];
    expect(validateDeck({ main: sixty }, 'vintage').problems).toEqual([]);
    expect(validateDeck({ main: [...sixty.slice(0, 3), e(1, 'Black Lotus'), e(50, 'Island')] }, 'vintage').problems.map((p) => p.code)).toEqual(['restricted']);
    expect(validateDeck({ main: sixty }, 'legacy').problems.map((p) => [p.code, p.card])).toEqual([['banned', 'Black Lotus']]);
    expect(validateDeck({ main: sixty }, 'modern').problems.map((p) => [p.code, p.card])).toEqual([['not-legal', 'Black Lotus']]);
  });

  it('a real mono-red Commander deck is legal; an off-color card and a duplicate are reported', () => {
    const red = cards.filter(
      (c) =>
        c.color_identity?.length === 1 && c.color_identity[0] === 'R' && !isBasicLand(c) && !/Land/.test(c.type_line ?? '') && legalityIn(c, 'commander') === 'legal' && c.name !== 'Krenko, Mob Boss',
    );
    const main: DeckEntry[] = [...red.slice(0, 63).map((card) => ({ count: 1, card })), e(36, 'Mountain')];
    const deck = { main, commander: [e(1, 'Krenko, Mob Boss')] };
    const r = validateDeck(deck, 'commander');
    expect(r.problems).toEqual([]);
    expect(r.counts.deck).toBe(100);
    const bad = validateDeck({ ...deck, main: [...main.slice(2), e(1, 'Counterspell'), { count: 1, card: main[2]!.card }] }, 'commander');
    expect(bad.problems.map((p) => [p.code, p.card])).toEqual([
      ['too-many-copies', main[2]!.card.name],
      ['color-identity', 'Counterspell'],
    ]);
  });

  /** n nonland one-ofs within a color identity, legal (not banned, not restricted) in every given format, other than the excluded names. */
  const oneOfs = (identity: string[], formats: string[], n: number, exclude: string[] = []) =>
    cards
      .filter(
        (c) =>
          c.color_identity !== undefined &&
          c.color_identity.every((x) => identity.includes(x)) &&
          !/Land/.test(c.type_line ?? '') &&
          formats.every((f) => legalityIn(c, f) === 'legal') &&
          !exclude.includes(c.name),
      )
      .slice(0, n)
      .map((card): DeckEntry => ({ count: 1, card }));

  it('Duel Commander banned-as-commander list (Scryfall duel: restricted): Edgar Markov as the commander is an error, in the 99 it is fine', () => {
    const edgar = get('Edgar Markov');
    expect(legalityIn(edgar, 'duel')).toBe('restricted');
    const mardu = ['R', 'W', 'B'];
    const main = [...oneOfs(mardu, ['duel', 'commander'], 63, ['Edgar Markov']), e(36, 'Plains')];
    const r = validateDeck({ main, commander: [e(1, 'Edgar Markov')] }, 'duel');
    expect(r.problems.map((p) => [p.code, p.card, p.rule])).toEqual([['banned-as-commander', 'Edgar Markov', 'Duel Commander banned-as-commander list (Scryfall legalities: duel restricted)']]);
    expect(validateDeck({ main, commander: [e(1, 'Edgar Markov')] }, 'commander').problems).toEqual([]);
    const fiveColor = cards.find((c) => c.color_identity?.length === 5 && canBeCommander(c, 'commander') && legalityIn(c, 'duel') === 'legal' && legalityIn(c, 'commander') === 'legal');
    expect(fiveColor).toBeDefined();
    const inThe99 = validateDeck({ main: [...main.slice(1), e(1, 'Edgar Markov')], commander: [{ count: 1, card: fiveColor! }] }, 'duel');
    expect(inThe99.problems).toEqual([]);
  });

  it('every Duel Commander "restricted" card can be a commander (the data is the banned-as-commander list)', () => {
    const restricted = cards.filter((c) => legalityIn(c, 'duel') === 'restricted');
    expect(restricted.length).toBeGreaterThanOrEqual(20);
    expect(restricted.filter((c) => !canBeCommander(c, 'commander')).map((c) => c.name)).toEqual([]);
  });

  it('CR 903.3 + 113.6c: Grist, the Hunger Tide can be a Commander commander, also from an MTGO-style sideboard', () => {
    const grist = get('Grist, the Hunger Tide');
    expect(canBeCommander(grist, 'commander')).toBe(true);
    const main = [...oneOfs(['B', 'G'], ['commander'], 63, [grist.name]), e(18, 'Forest'), e(18, 'Swamp')];
    expect(validateDeck({ main, commander: [e(1, grist.name)] }, 'commander').problems).toEqual([]);
    const mtgo = validateDeck({ main, sideboard: [e(1, grist.name)] }, 'commander');
    expect(mtgo.problems.map((p) => p.code)).toEqual(['commander-from-sideboard']);
    expect(mtgo.commanders).toEqual([grist.name]);
  });

  it('CR 903.3: Grist is the only legendary noncreature card the outside-the-battlefield rule adds', () => {
    const added = cards.filter((c) => canBeCommander(c, 'commander') && !/Creature|Vehicle|Spacecraft/.test(c.card_faces?.[0]?.type_line ?? c.type_line ?? '') && !/can be your commander/i.test(c.card_faces?.[0]?.oracle_text ?? c.oracle_text ?? ''));
    expect(added.map((c) => c.name)).toEqual(['Grist, the Hunger Tide']);
  });

  it('CR 702.139a: MTGO export with the commander and the companion in the sideboard (Kenrith + Jegantha)', () => {
    const wubrg = ['W', 'U', 'B', 'R', 'G'];
    const exclude = ['Kenrith, the Returned King', 'Jegantha, the Wellspring'];
    const main = [...oneOfs(wubrg, ['commander', 'brawl'], 63, exclude), e(36, 'Plains')];
    const r = validateDeck({ main, sideboard: [e(1, 'Kenrith, the Returned King'), e(1, 'Jegantha, the Wellspring')] }, 'commander');
    // CMP1: Jegantha's condition is checked now (formats/companion.ts): these random one-ofs repeat mana symbols, so it is an error (CR 702.139a)
    expect(r.problems.map((p) => [p.severity, p.code])).toEqual([
      ['error', 'companion-condition'],
      ['note', 'commander-from-sideboard'],
      ['note', 'companion-from-sideboard'],
    ]);
    expect(r.commanders).toEqual(['Kenrith, the Returned King']);
    const arena = validateDeck({ main, commander: [e(1, 'Kenrith, the Returned King')], companion: [e(1, 'Jegantha, the Wellspring')], sideboard: [e(1, 'Jegantha, the Wellspring')] }, 'brawl');
    expect(arena.problems.map((p) => p.code)).toEqual(['companion-condition']);
  });

  it('Lurrus as a Modern companion: banned there (Scryfall); CMP1: its condition is checked and met (CR 702.139a)', () => {
    const r = validateDeck({ main: [e(4, 'Lightning Bolt'), e(56, 'Mountain')], sideboard: [e(1, 'Lurrus of the Dream-Den')], companion: [e(1, 'Lurrus of the Dream-Den')] }, 'modern');
    expect(r.problems.map((p) => [p.severity, p.code])).toEqual([
      ['error', 'banned'],
    ]);
    expect(r.companion).toBe('Lurrus of the Dream-Den');
  });
});
