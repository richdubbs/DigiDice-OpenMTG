/** Format validation (milestone 7) on synthetic cards with fixture-like legality data. */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '@openmtg/engine';
import { CardDatabase } from '../src/database';
import { FORMATS, findFormat, formatById, validateDeck, type DeckEntry, type FormatProblem, type FormatReport } from '../src/formats';
import { canBeCommander, canPartner } from '../src/formats/commander';
import { deckLimitText, isBasicLand } from '../src/formats/card-rules';
import { takeOption } from '../src/formats/report';
import type { Legalities } from '../src/legalities';

const ALL: Record<string, string> = Object.fromEntries(
  ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'duel', 'brawl', 'standardbrawl', 'historic', 'timeless'].map((f) => [f, 'legal']),
);

function c(name: string, extra: Partial<OracleCard> & { legalities?: Legalities | null } = {}): OracleCard {
  const { legalities, ...rest } = extra;
  const card: OracleCard & { legalities?: Legalities } = { name, layout: 'normal', type_line: 'Instant', oracle_text: '', color_identity: ['R'], ...rest };
  if (legalities !== null) card.legalities = { ...(ALL as Legalities), ...(legalities ?? {}) };
  return card;
}
const basic = (name: string, type: string, color: string) => c(name, { type_line: `Basic Land — ${type}`, color_identity: [color] });
const legend = (name: string, ids: string[], extra: Partial<OracleCard> = {}) => c(name, { type_line: 'Legendary Creature — Human', color_identity: ids, ...extra });

const e = (count: number, card: OracleCard): DeckEntry => ({ count, card });
/** n distinct one-ofs (red instants by default). */
const fillers = (n: number, prefix = 'Filler', extra: Partial<OracleCard> = {}) => Array.from({ length: n }, (_, i) => e(1, c(`${prefix} ${i + 1}`, extra)));
/** A legal 60-card constructed main deck: 15 playsets. */
const sixty = () => Array.from({ length: 15 }, (_, i) => e(4, c(`Spell ${i + 1}`)));

const codes = (r: FormatReport, severity: FormatProblem['severity'] = 'error') => r.problems.filter((p) => p.severity === severity).map((p) => p.code);

describe('formats: definitions', () => {
  it('has the thirteen formats of the design, each findable by id, name and alias', () => {
    expect(FORMATS.map((f) => f.id)).toEqual(['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'duel', 'brawl', 'standardbrawl', 'historic', 'timeless', 'casual']);
    for (const f of FORMATS) expect(findFormat(f.id)).toBe(f);
    expect(findFormat('Duel Commander')?.id).toBe('duel');
    expect(findFormat('EDH')?.id).toBe('commander');
    expect(findFormat('standard brawl')?.id).toBe('standardbrawl');
    expect(findFormat('Historic Brawl')?.id).toBe('brawl');
    expect(findFormat('  MODERN ')?.id).toBe('modern');
    expect(findFormat('oathbreaker')).toBeUndefined();
  });

  it('CR 903.5a / 903.12d: Commander-style deck sizes and starting life', () => {
    expect(formatById('commander').deckSize).toMatchObject({ min: 100, max: 100 });
    expect(formatById('duel')).toMatchObject({ deckSize: { min: 100, max: 100 }, startingLife: 20 });
    expect(formatById('standardbrawl').deckSize).toMatchObject({ min: 60, max: 60, rule: 'CR 903.12d' });
    expect(formatById('brawl').deckSize).toMatchObject({ min: 100, max: 100 });
    expect(formatById('casual').deckSize).toBeUndefined();
  });

  it('throws for an unknown format name', () => {
    expect(() => validateDeck({ main: [] }, 'oathbreaker')).toThrow(/Unknown format "oathbreaker"/);
  });
});

describe('formats: card rules', () => {
  it('CR 205.4c: basic lands, including snow basics; not nonbasic lands with basic types', () => {
    expect(isBasicLand(basic('Forest', 'Forest', 'G'))).toBe(true);
    expect(isBasicLand(c('Snow-Covered Island', { type_line: 'Basic Snow Land — Island' }))).toBe(true);
    expect(isBasicLand(c('Wastes', { type_line: 'Basic Land' }))).toBe(true);
    expect(isBasicLand(c('Breeding Pool', { type_line: 'Land — Forest Mountain' }))).toBe(false);
  });

  it('reads "any number" and "up to N" deck-limit sentences about the card itself only', () => {
    expect(deckLimitText(c('Relentless Rats', { oracle_text: 'A deck can have any number of cards named Relentless Rats.' }))).toBe('any');
    expect(deckLimitText(c('Seven Dwarves', { oracle_text: 'A deck can have up to seven cards named Seven Dwarves.' }))).toBe(7);
    expect(deckLimitText(c('Nazgûl', { oracle_text: 'Deathtouch\nA deck can have up to nine cards named Nazgûl.' }))).toBe(9);
    expect(deckLimitText(c('Lightning Bolt'))).toBeUndefined();
    expect(deckLimitText(c('Odd Card', { oracle_text: 'A deck can have any number of cards named Other Card.' }))).toBe('unknown');
  });
});

describe('formats: constructed (CR 100.2a, 100.4a)', () => {
  it('a 60-card deck of playsets with a 15-card sideboard is legal in Modern', () => {
    const r = validateDeck({ main: sixty(), sideboard: fillers(15, 'Side') }, 'modern');
    expect(r.valid).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.counts).toMatchObject({ main: 60, sideboard: 15, deck: 60 });
  });

  it('CR 100.2a: fewer than 60 cards is an error with the counts', () => {
    const r = validateDeck({ main: sixty().slice(1) }, 'standard');
    expect(r.valid).toBe(false);
    expect(r.problems[0]).toMatchObject({ code: 'deck-too-small', rule: 'CR 100.2a', count: 56, limit: 60 });
  });

  it('CR 100.2a: five copies is an error naming the card; more than 60 cards is fine', () => {
    const r = validateDeck({ main: [...sixty(), e(5, c('Too Many'))] }, 'pioneer');
    expect(r.problems).toEqual([expect.objectContaining({ code: 'too-many-copies', card: 'Too Many', count: 5, limit: 4, rule: 'CR 100.2a', section: 'main' })]);
  });

  it('CR 100.4a: the four-copy limit counts deck and sideboard together; sideboard at most 15', () => {
    const bolt = c('Lightning Bolt');
    const r = validateDeck({ main: [...sixty(), e(3, bolt)], sideboard: [e(2, bolt), ...fillers(14, 'Side')] }, 'legacy');
    expect(codes(r).sort()).toEqual(['sideboard-too-large', 'too-many-copies']);
    expect(r.problems.find((p) => p.code === 'sideboard-too-large')).toMatchObject({ rule: 'CR 100.4a', count: 16, limit: 15 });
  });

  it('CR 100.2a: any number of basic lands; "any number of cards named" and "up to seven" exceptions', () => {
    const rats = c('Relentless Rats', { oracle_text: 'A deck can have any number of cards named Relentless Rats.' });
    const dwarves = c('Seven Dwarves', { oracle_text: 'A deck can have up to seven cards named Seven Dwarves.' });
    const ok = validateDeck({ main: [e(30, basic('Mountain', 'Mountain', 'R')), e(23, rats), e(7, dwarves)] }, 'modern');
    expect(ok.problems).toEqual([]);
    const bad = validateDeck({ main: [e(30, basic('Mountain', 'Mountain', 'R')), e(22, rats), e(8, dwarves)] }, 'modern');
    expect(bad.problems).toEqual([expect.objectContaining({ code: 'too-many-copies', card: 'Seven Dwarves', count: 8, limit: 7, rule: "Seven Dwarves's Oracle text" })]);
  });

  it('a deck-limit sentence that cannot be read is a warning, never silently passed', () => {
    const odd = c('Odd Card', { oracle_text: 'A deck can have any number of cards named Other Card.' });
    const r = validateDeck({ main: [...sixty(), e(9, odd)] }, 'modern');
    expect(r.valid).toBe(true);
    expect(codes(r, 'warning')).toEqual(['copy-limit-unknown']);
  });

  it('Scryfall legalities: banned and not_legal are errors, one per card name, citing the data', () => {
    const banned = c('Banned Thing', { legalities: { modern: 'banned' } });
    const old = c('Old Thing', { legalities: { modern: 'not_legal' } });
    const r = validateDeck({ main: [...sixty().slice(2), e(4, banned), e(2, old), e(2, c('Pad'))], sideboard: [e(2, old)] }, 'modern');
    expect(r.problems).toEqual([
      expect.objectContaining({ code: 'banned', card: 'Banned Thing', rule: 'Scryfall legalities (modern: banned)' }),
      expect.objectContaining({ code: 'not-legal', card: 'Old Thing', rule: 'Scryfall legalities (modern: not_legal)', section: 'main' }),
    ]);
  });

  it('Vintage restricted list: one copy is fine, two is an error; the same card is fine with 4 in Legacy', () => {
    const lotus = c('Black Lotus', { legalities: { vintage: 'restricted', legacy: 'legal' } });
    expect(validateDeck({ main: [...sixty(), e(1, lotus)] }, 'vintage').valid).toBe(true);
    const r = validateDeck({ main: [...sixty(), e(1, lotus)], sideboard: [e(1, lotus)] }, 'vintage');
    expect(r.problems).toEqual([expect.objectContaining({ code: 'restricted', card: 'Black Lotus', count: 2, limit: 1 })]);
    expect(validateDeck({ main: [...sixty(), e(4, lotus)] }, 'legacy').valid).toBe(true);
  });

  it('Timeless reads its own restricted list', () => {
    const r = validateDeck({ main: [...sixty(), e(2, c('Arena Restricted', { legalities: { timeless: 'restricted' } }))] }, 'timeless');
    expect(codes(r)).toEqual(['restricted']);
  });

  it('a card without legality data is a warning ("no data"), never "not legal"', () => {
    const r = validateDeck({ main: [...sixty(), e(1, c('Pre-WP24 Card', { legalities: null }))] }, 'standard');
    expect(r.valid).toBe(true);
    expect(r.problems).toEqual([expect.objectContaining({ severity: 'warning', code: 'no-legality-data', card: 'Pre-WP24 Card' })]);
  });

  it('unknown names count toward the deck size and are warnings', () => {
    const r = validateDeck({ main: sixty().slice(1), unresolved: [{ section: 'main', name: 'Mystery Card', count: 4 }] }, 'modern');
    expect(r.counts.main).toBe(60);
    expect(r.valid).toBe(true);
    expect(r.problems).toEqual([expect.objectContaining({ severity: 'warning', code: 'unresolved-card', card: 'Mystery Card' })]);
  });

  it('a Commander section in a constructed format is an error', () => {
    const r = validateDeck({ main: sixty(), commander: [e(1, legend('Someone', ['R']))] }, 'modern');
    expect(codes(r)).toEqual(['commander-not-allowed']);
  });
});

describe('formats: companion (CR 702.139a)', () => {
  const lurrus = c('Lurrus of the Dream-Den', { type_line: 'Legendary Creature — Cat Nightmare', keywords: ['Companion'], oracle_text: 'Companion — Each permanent card in your starting deck has mana value 2 or less.' });

  it('in constructed the companion comes from the sideboard: counted there once (Arena lists it in both)', () => {
    const both = validateDeck({ main: sixty(), sideboard: [e(1, lurrus), ...fillers(14, 'Side')], companion: [e(1, lurrus)] }, 'modern');
    expect(both.counts.sideboard).toBe(15);
    expect(codes(both)).toEqual([]);
    expect(codes(both, 'warning')).toEqual([]); // CMP1: Lurrus's condition is checked (formats/companion.ts) and met by sixty instants
    const only = validateDeck({ main: sixty(), sideboard: fillers(15, 'Side'), companion: [e(1, lurrus)] }, 'modern');
    expect(codes(only)).toEqual(['sideboard-too-large']);
  });

  it('a card without a companion ability, or two companions, is an error', () => {
    const r = validateDeck({ main: sixty(), companion: [e(1, lurrus), e(1, c('Not A Companion'))] }, 'legacy');
    expect(codes(r).sort()).toEqual(['not-a-companion', 'too-many-companions']);
  });
});

describe('formats: Commander (CR 903)', () => {
  const krenko = legend('Krenko, Mob Boss', ['R']);
  const mountain = basic('Mountain', 'Mountain', 'R');
  /** A 99-card red main deck: 60 one-ofs and 39 Mountains. */
  const ninetyNine = () => [...fillers(60), e(39, mountain)];

  it('a 100-card singleton deck with its commander is legal; counts include the commander', () => {
    const r = validateDeck({ main: ninetyNine(), commander: [e(1, krenko)] }, 'commander');
    expect(r.problems).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.counts).toMatchObject({ main: 99, commander: 1, deck: 100 });
    expect(r.commanders).toEqual(['Krenko, Mob Boss']);
  });

  it('CR 903.5a: exactly 100 (99 and 101 are errors)', () => {
    expect(validateDeck({ main: ninetyNine().slice(1), commander: [e(1, krenko)] }, 'commander').problems[0]).toMatchObject({ code: 'deck-too-small', rule: 'CR 903.5a', count: 99, limit: 100 });
    expect(validateDeck({ main: [...ninetyNine(), e(1, c('Extra'))], commander: [e(1, krenko)] }, 'commander').problems[0]).toMatchObject({ code: 'deck-too-large', count: 101 });
  });

  it('CR 903.5b: singleton except basic lands and "any number" cards; the commander counts', () => {
    const rats = c('Shadowborn Apostle', { color_identity: ['B'], oracle_text: 'A deck can have any number of cards named Shadowborn Apostle.' });
    const deck = [...fillers(58), e(2, c('Twice')), e(1, krenko), e(38, mountain)];
    const r = validateDeck({ main: deck, commander: [e(1, krenko)] }, 'commander');
    expect(r.problems.map((p) => [p.code, p.card, p.rule])).toEqual([
      ['too-many-copies', 'Twice', 'CR 903.5b'],
      ['too-many-copies', 'Krenko, Mob Boss', 'CR 903.5b'],
    ]);
    const ratsDeck = validateDeck({ main: [e(60, rats), e(39, basic('Swamp', 'Swamp', 'B'))], commander: [e(1, legend('Black Legend', ['B']))] }, 'commander');
    expect(ratsDeck.problems).toEqual([]);
  });

  it('CR 903.5c: a card outside the commander color identity is an error naming it', () => {
    const r = validateDeck({ main: [...ninetyNine().slice(1), e(1, c('Counterspell', { color_identity: ['U'] }))], commander: [e(1, krenko)] }, 'commander');
    expect(r.problems).toEqual([expect.objectContaining({ code: 'color-identity', rule: 'CR 903.5c', card: 'Counterspell', section: 'main' })]);
  });

  it('CR 903.5d (via color identity): a land with a basic land type outside the identity is an error', () => {
    const r = validateDeck({ main: [...ninetyNine().slice(1), e(1, c('Breeding Pool', { type_line: 'Land — Forest Mountain', color_identity: ['G', 'R'] }))], commander: [e(1, krenko)] }, 'commander');
    expect(codes(r)).toEqual(['color-identity']);
  });

  it('CR 903.5e: no sideboard (Duel Commander too)', () => {
    for (const f of ['commander', 'duel']) {
      const r = validateDeck({ main: ninetyNine(), commander: [e(1, krenko)], sideboard: fillers(3, 'Side') }, f);
      expect(r.problems).toEqual([expect.objectContaining({ code: 'sideboard-not-allowed', rule: 'CR 903.5e', count: 3 })]);
    }
  });

  it('CR 903.3: no commander, a non-legendary or non-creature commander, more than two', () => {
    expect(codes(validateDeck({ main: [...ninetyNine(), e(1, c('One More'))] }, 'commander'))).toEqual(['no-commander']);
    expect(codes(validateDeck({ main: ninetyNine(), commander: [e(1, c('Goblin', { type_line: 'Creature — Goblin' }))] }, 'commander'))).toEqual(['not-a-commander']);
    expect(codes(validateDeck({ main: ninetyNine(), commander: [e(1, legend('Jace', ['R'], { type_line: 'Legendary Planeswalker — Jace' }))] }, 'commander'))).toEqual(['not-a-commander']);
    const three = validateDeck({ main: ninetyNine().slice(2), commander: [e(1, krenko), e(1, legend('B', ['R'])), e(1, legend('C', ['R']))] }, 'commander');
    expect(codes(three)).toEqual(['too-many-commanders']);
  });

  it('CR 903.3 / 903.3a: Vehicles, Spacecraft with P/T, and "can be your commander" cards can be commanders', () => {
    expect(canBeCommander(legend('Parhelion II', ['W'], { type_line: 'Legendary Artifact — Vehicle' }), 'commander')).toBe(true);
    expect(canBeCommander(legend('Ship', ['W'], { type_line: 'Legendary Artifact — Spacecraft', power: '5', toughness: '5' }), 'commander')).toBe(true);
    expect(canBeCommander(legend('Station', ['W'], { type_line: 'Legendary Artifact — Spacecraft' }), 'commander')).toBe(false);
    expect(canBeCommander(legend('Teferi', ['U'], { type_line: 'Legendary Planeswalker — Teferi', oracle_text: '+1: Draw.\nTeferi can be your commander.' }), 'commander')).toBe(true);
    expect(canBeCommander(c('Saga Legend', { type_line: 'Legendary Enchantment — Saga' }), 'commander')).toBe(false);
  });

  it('CR 712.8a: a double-faced commander is judged by its front face', () => {
    const dfc = c('Front // Back', { layout: 'transform', type_line: 'Legendary Creature — Human // Legendary Planeswalker — X', card_faces: [{ name: 'Front', type_line: 'Legendary Creature — Human' }, { name: 'Back', type_line: 'Legendary Planeswalker — X' }] });
    expect(canBeCommander(dfc, 'commander')).toBe(true);
    const back = c('Plain // Legend', { layout: 'transform', type_line: 'Creature — Human // Legendary Creature — X', card_faces: [{ name: 'Plain', type_line: 'Creature — Human' }, { name: 'Legend', type_line: 'Legendary Creature — X' }] });
    expect(canBeCommander(back, 'commander')).toBe(false);
  });

  it('CR 702.124: partner pairs; different partner abilities never combine (702.124f)', () => {
    const p = (n: string, text: string) => legend(n, ['R'], { oracle_text: text });
    expect(canPartner(p('A', 'Partner (You can have two commanders if both have partner.)'), p('B', 'Flying\nPartner'))).toBe(true);
    expect(canPartner(p('A', 'Partner—Friends forever'), p('B', 'Partner—Friends forever'))).toBe(true);
    expect(canPartner(p('A', 'Partner—Friends forever'), p('B', 'Partner—Survivors'))).toBe(false);
    expect(canPartner(p('Pir, Imaginative Rascal', 'Partner with Toothy, Imaginary Friend (When this creature enters, ...)'), p('Toothy, Imaginary Friend', 'Partner with Pir, Imaginative Rascal'))).toBe(true);
    expect(canPartner(p('Pir, Imaginative Rascal', 'Partner with Toothy, Imaginary Friend'), p('B', 'Partner'))).toBe(false);
    const bg = c('Agent', { type_line: 'Legendary Enchantment — Background', color_identity: ['B'] });
    expect(canPartner(p('A', 'Choose a Background'), bg)).toBe(true);
    expect(canPartner(p('A', 'Partner'), bg)).toBe(false);
    const doctor = legend('The Doctor', ['U'], { type_line: 'Legendary Creature — Time Lord Doctor' });
    const rogueDoctor = legend('Rogue', ['U'], { type_line: 'Legendary Creature — Time Lord Rogue Doctor' });
    expect(canPartner(p('Companion', "Doctor's companion"), doctor)).toBe(true);
    expect(canPartner(p('Companion', "Doctor's companion"), rogueDoctor)).toBe(false);
  });

  it('CR 702.124c: two partner commanders: 98 + 2 cards, combined color identity', () => {
    const a = legend('Partner A', ['R'], { oracle_text: 'Partner' });
    const b = legend('Partner B', ['U'], { oracle_text: 'Partner' });
    const main = [...fillers(59), e(1, c('Blue Card', { color_identity: ['U'] })), e(38, mountain)];
    const r = validateDeck({ main, commander: [e(1, a), e(1, b)] }, 'commander');
    expect(r.problems).toEqual([]);
    expect(r.counts.deck).toBe(100);
    const bad = validateDeck({ main, commander: [e(1, a), e(1, legend('Not Partner', ['U']))] }, 'commander');
    expect(codes(bad)).toEqual(['invalid-partners']);
  });

  it('a Background is a commander only beside "Choose a Background" (CR 702.124k)', () => {
    const bg = c('Agent', { type_line: 'Legendary Enchantment — Background', color_identity: ['R'] });
    const chooser = legend('Chooser', ['R'], { oracle_text: 'Choose a Background' });
    expect(validateDeck({ main: ninetyNine().slice(1), commander: [e(1, chooser), e(1, bg)] }, 'commander').problems).toEqual([]);
    expect(codes(validateDeck({ main: ninetyNine(), commander: [e(1, bg)] }, 'commander'))).toEqual(['not-a-commander']);
  });

  it('MTGO exports: a commander deck with no Commander section reads a one-card sideboard as the commander (note)', () => {
    const r = validateDeck({ main: ninetyNine(), sideboard: [e(1, krenko)] }, 'commander');
    expect(r.valid).toBe(true);
    expect(r.problems).toEqual([expect.objectContaining({ severity: 'note', code: 'commander-from-sideboard' })]);
    expect(r.commanders).toEqual(['Krenko, Mob Boss']);
    expect(r.counts).toMatchObject({ deck: 100, sideboard: 0 });
    // A sideboard that cannot be a commander stays a sideboard.
    expect(codes(validateDeck({ main: ninetyNine(), sideboard: [e(1, c('Bolt'))] }, 'commander')).sort()).toEqual(['deck-too-small', 'no-commander', 'sideboard-not-allowed']);
  });

  it('CR 903.11a: a Commander companion must be within the color identity and not also in the deck', () => {
    const blueComp = c('Blue Companion', { type_line: 'Legendary Creature — Bird', color_identity: ['U'], oracle_text: 'Companion — Something.' });
    const r = validateDeck({ main: ninetyNine(), commander: [e(1, krenko)], companion: [e(1, blueComp)] }, 'commander');
    expect(codes(r)).toEqual(['color-identity']);
    const redComp = c('Red Companion', { type_line: 'Legendary Creature — Bird', color_identity: ['R'], oracle_text: 'Companion — Something.' });
    const dup = validateDeck({ main: [...ninetyNine().slice(1), e(1, redComp)], commander: [e(1, krenko)], companion: [e(1, redComp)] }, 'commander');
    expect(codes(dup)).toEqual(['companion-in-deck']);
    expect(dup.counts.deck).toBe(100); // the companion is outside the deck
  });

  it('banned in Commander, legal in Duel Commander (each format reads its own list)', () => {
    const card = c('Sol Ring-ish', { legalities: { commander: 'legal', duel: 'banned' } });
    const deck = { main: [...ninetyNine().slice(1), e(1, card)], commander: [e(1, krenko)] };
    expect(validateDeck(deck, 'commander').valid).toBe(true);
    expect(validateDeck(deck, 'duel').problems).toEqual([expect.objectContaining({ code: 'banned', card: 'Sol Ring-ish', rule: 'Scryfall legalities (duel: banned)' })]);
  });

  it('CR 903.4: an unknown commander: color identity not checked (warning), never assumed', () => {
    const r = validateDeck({ main: ninetyNine(), unresolved: [{ section: 'commander', name: 'Who Knows', count: 1 }] }, 'commander');
    expect(r.valid).toBe(true);
    expect(codes(r, 'warning').sort()).toEqual(['no-color-identity', 'unresolved-card']);
    expect(r.problems).toContainEqual(expect.objectContaining({ code: 'no-color-identity', rule: 'CR 903.4', section: 'commander' }));
    expect(r.counts.deck).toBe(100);
  });

  describe('Duel Commander banned-as-commander list (Scryfall legalities: duel restricted)', () => {
    const edgar = c('Edgar-ish', { type_line: 'Legendary Creature — Vampire', color_identity: ['R'], legalities: { duel: 'restricted' } });

    it('a duel "restricted" card is an error as the commander; legal as the commander in Commander', () => {
      const r = validateDeck({ main: ninetyNine(), commander: [e(1, edgar)] }, 'duel');
      expect(r.valid).toBe(false);
      expect(r.problems).toEqual([
        expect.objectContaining({ code: 'banned-as-commander', card: 'Edgar-ish', section: 'commander', rule: 'Duel Commander banned-as-commander list (Scryfall legalities: duel restricted)' }),
      ]);
      expect(validateDeck({ main: ninetyNine(), commander: [e(1, edgar)] }, 'commander').problems).toEqual([]);
    });

    it('a duel "restricted" card in the 99 is legal; two copies break CR 903.5b, not a restricted list', () => {
      expect(validateDeck({ main: [...ninetyNine().slice(1), e(1, edgar)], commander: [e(1, krenko)] }, 'duel').problems).toEqual([]);
      const two = validateDeck({ main: [...ninetyNine().slice(2), e(2, edgar)], commander: [e(1, krenko)] }, 'duel');
      expect(two.problems).toEqual([expect.objectContaining({ code: 'too-many-copies', rule: 'CR 903.5b', card: 'Edgar-ish' })]);
    });

    it('a duel "restricted" commander read from an MTGO sideboard is an error too', () => {
      const r = validateDeck({ main: ninetyNine(), sideboard: [e(1, edgar)] }, 'duel');
      expect(codes(r)).toEqual(['banned-as-commander']);
      expect(codes(r, 'note')).toEqual(['commander-from-sideboard']);
    });

    it('a "restricted" value in a format with no defined meaning for it is a warning, never ignored', () => {
      const odd = c('Odd Restricted', { legalities: { modern: 'restricted' } });
      const r = validateDeck({ main: [...sixty().slice(1), e(4, odd)] }, 'modern');
      expect(codes(r)).toEqual([]);
      expect(codes(r, 'warning')).toEqual(['restricted-unknown']);
    });
  });

  describe('CR 903.3 + 113.6c: a legendary card that is a creature card outside the battlefield can be a commander', () => {
    const grist = c('Grist, the Hunger Tide', {
      type_line: 'Legendary Planeswalker — Grist',
      color_identity: ['B', 'G'],
      oracle_text:
        "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.\n+1: Create a 1/1 black and green Insect creature token, then mill a card.",
    });
    const golgari = () => [...fillers(60, 'BG', { color_identity: ['B', 'G'] }), e(39, basic('Swamp', 'Swamp', 'B'))];

    it('CR 113.6c: Grist can be a Commander and Duel Commander commander', () => {
      expect(canBeCommander(grist, 'commander')).toBe(true);
      for (const f of ['commander', 'duel']) expect(validateDeck({ main: golgari(), commander: [e(1, grist)] }, f).problems).toEqual([]);
    });

    it('CR 113.6c: Grist in an MTGO-style one-card sideboard is read as the commander', () => {
      const r = validateDeck({ main: golgari(), sideboard: [e(1, grist)] }, 'commander');
      expect(r.valid).toBe(true);
      expect(r.commanders).toEqual(['Grist, the Hunger Tide']);
    });

    it('CR 903.3: a planeswalker that is not a creature card outside the battlefield is still not a commander', () => {
      const other = c('Other Walker', { type_line: 'Legendary Planeswalker — X', oracle_text: "As long as it's your turn, Other Walker is a creature." });
      expect(canBeCommander(other, 'commander')).toBe(false);
      const plain = c('Plain Walker', { type_line: 'Planeswalker — X', oracle_text: "As long as Plain Walker isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types." });
      expect(canBeCommander(plain, 'commander')).toBe(false);
    });
  });

  describe('CR 702.139a / 903.11a: a commander-format companion listed in the sideboard too', () => {
    const kenrith = legend('Kenrith-ish', ['W', 'U', 'B', 'R', 'G']);
    const jegantha = c('Jegantha-ish', {
      type_line: 'Legendary Creature — Elemental Elk',
      color_identity: ['R', 'G'],
      keywords: ['Companion'],
      oracle_text: 'Companion — No card in your starting deck has more than one of the same mana symbol in its mana cost.',
    });

    it('CR 702.139a: Arena Brawl export (Companion section and the same card in the sideboard): not a sideboard', () => {
      const r = validateDeck({ main: ninetyNine(), commander: [e(1, kenrith)], companion: [e(1, jegantha)], sideboard: [e(1, jegantha)] }, 'brawl');
      expect(codes(r)).toEqual([]);
      expect(codes(r, 'warning')).toEqual(['companion-unchecked']);
      expect(r.counts).toMatchObject({ sideboard: 0, companion: 1, deck: 100 });
    });

    it('CR 903.5e: a sideboard card beyond the companion copy is still a sideboard', () => {
      const r = validateDeck({ main: ninetyNine(), commander: [e(1, kenrith)], companion: [e(1, jegantha)], sideboard: [e(2, jegantha), e(1, c('Side'))] }, 'brawl');
      expect(codes(r)).toEqual(['sideboard-not-allowed']);
      expect(r.counts.sideboard).toBe(2);
    });

    it('CR 702.139a: MTGO export with the commander and the companion in the sideboard reads both (notes)', () => {
      const r = validateDeck({ main: ninetyNine(), sideboard: [e(1, kenrith), e(1, jegantha)] }, 'commander');
      expect(codes(r)).toEqual([]);
      expect(codes(r, 'warning')).toEqual(['companion-unchecked']);
      expect(codes(r, 'note')).toEqual(['commander-from-sideboard', 'companion-from-sideboard']);
      expect(r.commanders).toEqual(['Kenrith-ish']);
      expect(r.counts).toMatchObject({ deck: 100, sideboard: 0, companion: 1 });
    });

    it('CR 702.139a: MTGO export with partner commanders and a companion (three sideboard cards)', () => {
      const a = legend('Partner A', ['R', 'G'], { oracle_text: 'Partner' });
      const b = legend('Partner B', ['R'], { oracle_text: 'Partner' });
      const r = validateDeck({ main: ninetyNine().slice(1), sideboard: [e(1, a), e(1, jegantha), e(1, b)] }, 'commander');
      expect(codes(r)).toEqual([]);
      expect(r.commanders).toEqual(['Partner A', 'Partner B']);
      expect(r.counts).toMatchObject({ deck: 100, sideboard: 0, companion: 1 });
    });

    it('CR 702.139a: an MTGO sideboard with two possible companions is not guessed', () => {
      const lurrus = c('Lurrus-ish', { type_line: 'Legendary Creature — Cat Nightmare', color_identity: ['W', 'B'], keywords: ['Companion'], oracle_text: 'Companion — Something.' });
      const r = validateDeck({ main: ninetyNine(), sideboard: [e(1, lurrus), e(1, jegantha)] }, 'commander');
      expect(codes(r)).toContain('no-commander');
      expect(codes(r, 'note')).toEqual([]);
    });
  });
});

describe('formats: Brawl (CR 903.12)', () => {
  const forest = basic('Forest', 'Forest', 'G');
  const island = basic('Island', 'Island', 'U');

  it('CR 903.12c: a planeswalker can be a Brawl commander', () => {
    const pw = legend('Nissa', ['G'], { type_line: 'Legendary Planeswalker — Nissa' });
    const r = validateDeck({ main: [...fillers(30, 'G', { color_identity: ['G'] }), e(29, forest)], commander: [e(1, pw)] }, 'standardbrawl');
    expect(r.problems).toEqual([]);
    expect(r.counts.deck).toBe(60);
  });

  it('CR 903.12d: Standard Brawl is exactly 60; Brawl (Arena) is 100', () => {
    const pw = legend('Nissa', ['G'], { type_line: 'Legendary Planeswalker — Nissa' });
    const deck = { main: [...fillers(30, 'G', { color_identity: ['G'] }), e(29, forest)], commander: [e(1, pw)] };
    expect(codes(validateDeck(deck, 'brawl'))).toEqual(['deck-too-small']);
  });

  it('CR 903.12e: a colorless commander allows basic lands of one basic land type', () => {
    const karn = legend('Karn', [], { type_line: 'Legendary Artifact Creature — Golem' });
    const colorless = fillers(30, 'Artifact', { color_identity: [] });
    expect(validateDeck({ main: [...colorless, e(29, forest)], commander: [e(1, karn)] }, 'standardbrawl').problems).toEqual([]);
    const two = validateDeck({ main: [...colorless, e(20, forest), e(9, island)], commander: [e(1, karn)] }, 'standardbrawl');
    expect(two.problems).toEqual([expect.objectContaining({ code: 'color-identity', rule: 'CR 903.12e', card: 'Island' })]);
    // Not in Commander: there a Forest is outside a colorless identity (903.5c).
    const cmdr = validateDeck({ main: [...fillers(70, 'A', { color_identity: [] }), e(29, forest)], commander: [e(1, karn)] }, 'commander');
    expect(cmdr.problems).toEqual([expect.objectContaining({ code: 'color-identity', rule: 'CR 903.5c', card: 'Forest' })]);
  });
});

describe('formats: casual', () => {
  it('has no restrictions: any size, copies, banned cards, no warnings for missing data', () => {
    const r = validateDeck({ main: [e(12, c('Anything', { legalities: { standard: 'banned' } })), e(1, c('No Data', { legalities: null }))], sideboard: fillers(40) }, 'casual');
    expect(r.valid).toBe(true);
    expect(r.problems).toEqual([]);
  });
});

describe('formats: with CardDatabase.resolveDecklist', () => {
  it('validates a resolved decklist directly (sections, merged lines, unknown names)', async () => {
    const db = CardDatabase.fromCards([c('Lightning Bolt'), basic('Mountain', 'Mountain', 'R'), c('Banned Thing', { legalities: { modern: 'banned' } })]);
    const d = await db.resolveDecklist('4 Lightning Bolt\n52 Mountain\n2 Banned Thing\n1 Nonexistent Card\n1 Lightning Bolt\n\n15 Mountain');
    const r = validateDeck(d, 'modern');
    expect(r.counts).toMatchObject({ main: 60, sideboard: 15 });
    expect(r.problems.map((p) => p.code)).toEqual(['too-many-copies', 'banned', 'unresolved-card']);
    expect(r.problems[0]).toMatchObject({ card: 'Lightning Bolt', count: 5 });
  });
});

describe('formats: --format option parsing', () => {
  it('takes "--format x" and "--format=x" and leaves the rest', () => {
    expect(takeOption(['a.txt', '--format', 'modern', '--no-fetch'], '--format')).toEqual({ rest: ['a.txt', '--no-fetch'], present: true, value: 'modern' });
    expect(takeOption(['--format=duel commander', 'a.txt'], '--format')).toEqual({ rest: ['a.txt'], present: true, value: 'duel commander' });
    expect(takeOption(['a.txt', '--format'], '--format')).toEqual({ rest: ['a.txt'], present: true });
    expect(takeOption(['a.txt'], '--format')).toEqual({ rest: ['a.txt'], present: false });
  });
});
