/** Deck text export/import round trip through the real decklist parser (packages/cards/src/decklist.ts), and the pure deck helpers. */
import { describe, expect, it } from 'vitest';
import { parseDecklist } from '../../cards/src/decklist';
import { findFormatId } from '../src/decks/formats';
import { addCard, duplicateDeck, isDeck, moveCard, sectionCount, toDeckList, type Deck } from '../src/decks/model';
import { MemoryDeckStore } from '../src/decks/store';
import { deckFromResolve, exportDeck, exportFileName, looksLikeLink, readDeckHeader, type ExportFormat } from '../src/decks/textio';
import { deckFixture, fakeResolve } from './decks-fixtures';

const NOW = '2026-10-12T10:00:00.000Z';
const strip = (d: Deck) => ({ main: d.main, sideboard: d.sideboard, commander: d.commander, companion: d.companion });

/** Export, then read back the way the app does: resolve (parser + lookup) and deckFromResolve, with the name and format from the text. */
function roundTrip(deck: Deck, format: ExportFormat): Deck {
  const text = exportDeck(deck, format);
  const header = readDeckHeader(text);
  return deckFromResolve(fakeResolve(text), { name: header.name ?? 'unnamed', format: header.format ?? 'casual', now: NOW, id: deck.id });
}

const companionDeck = deckFixture({
  main: [
    { name: 'Lightning Bolt', count: 4, oracleId: 'oid-lightning-bolt' },
    { name: 'Fire // Ice', count: 2, oracleId: 'oid-fire-ice' },
    { name: 'Mountain', count: 20, oracleId: 'oid-mountain' },
  ],
  companion: [{ name: 'Lurrus of the Dream-Den', count: 1, oracleId: 'oid-lurrus-of-the-dream-den' }],
});

describe('export / import round trip', () => {
  it.each(['arena', 'mtgo', 'plain'] as const)('%s text reads back to the same main deck and sideboard', (fmt) => {
    const deck = deckFixture();
    const back = roundTrip(deck, fmt);
    expect(strip(back)).toEqual(strip(deck));
    expect(parseDecklist(exportDeck(deck, fmt)).errors).toEqual([]);
  });

  it('Arena keeps the deck name, the companion block and split-card names ("Fire // Ice" is not a comment)', () => {
    const text = exportDeck(companionDeck, 'arena');
    expect(text).toBe(
      ['About', 'Name Gruul Test', '', 'Companion', '1 Lurrus of the Dream-Den', '', 'Deck', '4 Lightning Bolt', '2 Fire // Ice', '20 Mountain', '', 'Sideboard', '2 Ancient Grudge', ''].join(
        '\n',
      ),
    );
    const back = roundTrip(companionDeck, 'arena');
    expect(back.name).toBe('Gruul Test');
    expect(strip(back)).toEqual(strip(companionDeck));
  });

  it('plain text keeps the name, the format and every section, commander included', () => {
    const deck = deckFixture({ format: 'commander', commander: [{ name: 'Grizzly Bears', count: 1, oracleId: 'oid-grizzly-bears' }], main: [{ name: 'Forest', count: 99, oracleId: 'oid-forest' }], sideboard: [] });
    const text = exportDeck(deck, 'plain');
    expect(text.split('\n').slice(0, 5)).toEqual(['// Gruul Test', '// Format: Commander', '', 'Commander', '1 Grizzly Bears']);
    const back = roundTrip(deck, 'plain');
    expect(back.name).toBe('Gruul Test');
    expect(back.format).toBe('commander');
    expect(strip(back)).toEqual(strip(deck));
  });

  it('MTGO has no commander or companion block, so they come back in the sideboard (as MTGO and deck sites write them)', () => {
    const text = exportDeck(companionDeck, 'mtgo');
    expect(text).toBe(['4 Lightning Bolt', '2 Fire // Ice', '20 Mountain', '', '1 Lurrus of the Dream-Den', '2 Ancient Grudge', ''].join('\n'));
    const back = roundTrip(companionDeck, 'mtgo');
    expect(back.main).toEqual(companionDeck.main);
    expect(back.sideboard.map((e) => e.name)).toEqual(['Lurrus of the Dream-Den', 'Ancient Grudge']);
  });

  it('MTGO with an empty main deck marks sideboard lines with "SB:" so they stay in the sideboard', () => {
    const deck = deckFixture({ main: [] });
    expect(exportDeck(deck, 'mtgo')).toBe('SB: 2 Ancient Grudge\n');
    expect(strip(roundTrip(deck, 'mtgo'))).toEqual(strip(deck));
  });

  it('an empty deck exports to text that reads back empty, without parse errors', () => {
    const deck = deckFixture({ main: [], sideboard: [] });
    for (const f of ['arena', 'mtgo', 'plain'] as const) {
      expect(parseDecklist(exportDeck(deck, f)).errors).toEqual([]);
      expect(strip(roundTrip(deck, f))).toEqual(strip(deck));
    }
  });

  it('file names drop characters Windows forbids', () => {
    expect(exportFileName(deckFixture({ name: 'R/G: "Aggro"?' }), 'mtgo')).toBe('R G Aggro (mtgo).txt');
    expect(exportFileName(deckFixture({ name: '' }), 'plain')).toBe('deck (text).txt');
  });
});

describe('plain-text backup keeps the deck notes and cover', () => {
  it('writes the cover and notes as leading comments and reads them back; the parser still reads every card', () => {
    const deck = deckFixture({ cover: 'Ancient Grudge', notes: 'Side in Grudge vs. affinity\n\n// odd line: Format: Legacy' });
    const text = exportDeck(deck, 'plain');
    expect(text.split('\n').slice(0, 6)).toEqual(['// Gruul Test', '// Format: Modern', '// Cover: Ancient Grudge', '// Notes: Side in Grudge vs. affinity', '//', '// // odd line: Format: Legacy']);
    expect(readDeckHeader(text)).toEqual({ name: 'Gruul Test', format: 'modern', cover: 'Ancient Grudge', notes: deck.notes });
    expect(parseDecklist(text).errors).toEqual([]);
    expect(strip(roundTrip(deck, 'plain'))).toEqual(strip(deck));
  });

  it('a deck without notes or cover writes neither line', () => {
    expect(exportDeck(deckFixture(), 'plain').split('\n').slice(0, 3)).toEqual(['// Gruul Test', '// Format: Modern', '']);
    expect(readDeckHeader(exportDeck(deckFixture(), 'plain'))).toEqual({ name: 'Gruul Test', format: 'modern' });
  });

  it('deckFromResolve takes the notes and cover', () => {
    const d = deckFromResolve(fakeResolve('4 Lightning Bolt'), { name: 'X', format: 'casual', now: NOW, notes: 'n', cover: 'Lightning Bolt' });
    expect(d).toMatchObject({ notes: 'n', cover: 'Lightning Bolt' });
  });
});

describe('reading the text header', () => {
  it('finds the Arena name and the plain-text name and format; other lists have none', () => {
    expect(readDeckHeader('About\nName Mono Red\n\nDeck\n4 Lightning Bolt')).toEqual({ name: 'Mono Red' });
    expect(readDeckHeader('// Burn\n// Format: Modern\n4 Lightning Bolt')).toEqual({ name: 'Burn', format: 'modern' });
    expect(readDeckHeader('4 Lightning Bolt\n// not a header')).toEqual({});
  });

  it('knows format names and aliases', () => {
    expect(findFormatId('EDH')).toBe('commander');
    expect(findFormatId('Casual (no restrictions)')).toBe('casual');
    expect(findFormatId('Duel Commander')).toBe('duel');
    expect(findFormatId('Mystery')).toBeUndefined();
  });

  it('recognizes a pasted link', () => {
    expect(looksLikeLink(' https://www.moxfield.com/decks/abc123 ')).toBe(true);
    expect(looksLikeLink('4 Lightning Bolt')).toBe(false);
  });
});

describe('deck helpers', () => {
  it('adds, removes and moves cards, keeping order and Oracle ids', () => {
    let d = deckFixture();
    d = addCard(d, 'main', { name: 'Lightning Bolt' }, -1);
    expect(d.main[0]).toEqual({ name: 'Lightning Bolt', count: 3, oracleId: 'oid-lightning-bolt' });
    d = addCard(d, 'main', { name: 'Forest', oracleId: 'oid-forest' }, 2);
    expect(d.main.at(-1)).toEqual({ name: 'Forest', count: 2, oracleId: 'oid-forest' });
    d = moveCard(d, 'sideboard', 'main', 'Ancient Grudge');
    expect(d.sideboard).toEqual([]);
    expect(d.main.at(-1)).toEqual({ name: 'Ancient Grudge', count: 2, oracleId: 'oid-ancient-grudge' });
    d = addCard(d, 'main', { name: 'Ancient Grudge' }, -5);
    expect(d.main.some((e) => e.name === 'Ancient Grudge')).toBe(false);
    expect(sectionCount(d, 'main')).toBe(3 + 4 + 10 + 2 + 2);
  });

  it('duplicates under a new id and name; the copy does not share lists with the original', () => {
    const d = deckFixture();
    const copy = duplicateDeck(d, NOW, 'deck-2');
    expect(copy).toMatchObject({ id: 'deck-2', name: 'Copy of Gruul Test', createdAt: NOW, updatedAt: NOW, format: 'modern' });
    copy.main[0]!.count = 1;
    expect(d.main[0]!.count).toBe(4);
  });

  it('sends only filled commander/companion sections to validation', () => {
    expect(Object.keys(toDeckList(deckFixture()))).toEqual(['main', 'sideboard']);
    expect(toDeckList(companionDeck).companion).toHaveLength(1);
  });

  it('rejects damaged records', () => {
    expect(isDeck(deckFixture())).toBe(true);
    expect(isDeck({ ...deckFixture(), main: [{ name: 'X' }] })).toBe(false);
    expect(isDeck(null)).toBe(false);
  });

  it('the memory store lists newest first and hands out copies', async () => {
    const store = new MemoryDeckStore([deckFixture({ id: 'a', updatedAt: '2026-01-01' }), deckFixture({ id: 'b', updatedAt: '2026-02-01' })]);
    expect((await store.list()).map((d) => d.id)).toEqual(['b', 'a']);
    const a = (await store.get('a'))!;
    a.name = 'changed';
    expect((await store.get('a'))!.name).toBe('Gruul Test');
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });
});
