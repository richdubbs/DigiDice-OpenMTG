/** Deck submission: resolution with the host's card data, construction rules (CR 100.2a, 100.4a) and Scryfall legality data (milestone 7's validateDeck). */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '@openmtg/engine';
import { deckFromText, formatValidator, prepareDeck, type ResolvedDeck } from '../src/game/deck';
import { checkAction, checkDeckSubmission, parseGuestMessage, PROTOCOL_VERSION } from '../src/protocol/messages';
import { compareVersions, localVersions } from '../src/protocol/versions';
import { deck, fixtureDb } from './helpers';

const card = (name: string, extra: Partial<OracleCard> & { legalities?: Record<string, string> } = {}): OracleCard => ({ name, layout: 'normal', type_line: 'Creature — Bear', oracle_text: '', ...extra }) as OracleCard;
const forest = card('Forest', { type_line: 'Basic Land — Forest', legalities: { modern: 'legal' } });
const bear = card('Bear', { legalities: { modern: 'legal', vintage: 'legal' } });
const one = (c: OracleCard, count: number) => ({ card: c, count });
const resolved = (main: ResolvedDeck['main'], sideboard: ResolvedDeck['sideboard'] = []): ResolvedDeck => ({ main, sideboard });

describe('construction rules (milestone 7 validateDeck through formatValidator)', () => {
  it('CR 100.2a: at least 60 cards and at most four copies, basic lands unlimited', () => {
    expect(formatValidator(resolved([one(forest, 56), one(bear, 4)]), 'modern').errors).toEqual([]);
    expect(formatValidator(resolved([one(forest, 55), one(bear, 4)]), 'modern').errors.join()).toMatch(/59 cards.*CR 100.2a/);
    expect(formatValidator(resolved([one(forest, 55), one(bear, 5)]), 'modern').errors.join()).toMatch(/5 copies of Bear/);
  });

  it('CR 100.4a: sideboard of at most 15, and the four-copy limit counts deck and sideboard together', () => {
    const errs = formatValidator(resolved([one(forest, 57), one(bear, 3)], [one(bear, 2), one(forest, 14)]), 'modern').errors.join(' ');
    expect(errs).toMatch(/Sideboard has 16 cards.*CR 100.4a/);
    expect(errs).toMatch(/5 copies of Bear/);
  });

  it('"A deck can have any number of cards named ~" and "up to seven" (CR 100.2a exceptions printed on cards)', () => {
    const rats = card('Rats', { oracle_text: 'A deck can have any number of cards named Rats.', legalities: { modern: 'legal' } });
    const dwarves = card('Dwarves', { oracle_text: 'A deck can have up to seven cards named Dwarves.', legalities: { modern: 'legal' } });
    expect(formatValidator(resolved([one(rats, 60)]), 'modern').errors).toEqual([]);
    expect(formatValidator(resolved([one(dwarves, 7), one(forest, 53)]), 'modern').errors).toEqual([]);
    expect(formatValidator(resolved([one(dwarves, 8), one(forest, 52)]), 'modern').errors.join()).toMatch(/8 copies of Dwarves; at most 7/);
  });

  it('banned, restricted and not-legal cards come from the legality data; missing data is only a warning', () => {
    const banned = card('Banned One', { legalities: { modern: 'banned' } });
    const restricted = card('Restricted One', { legalities: { vintage: 'restricted' } });
    const unknown = card('No Data');
    const r = formatValidator(resolved([one(forest, 50), one(banned, 1), one(unknown, 1), one(card('Old', { legalities: { modern: 'not_legal' } }), 1), one(bear, 4), one(forest, 3)]), 'modern');
    expect(r.errors.join(' ')).toMatch(/Banned One is banned in Modern.*Old is not legal in Modern/);
    expect(r.warnings.join(' ')).toMatch(/No Data: no Modern legality data/);
    const v = formatValidator(resolved([one(forest, 58), one(restricted, 2)]), 'vintage');
    expect(v.errors.join(' ')).toMatch(/Restricted One is restricted/);
  });

  it('casual has no restrictions but a deck must have cards; a command-zone format needs a commander (CR 903.3; M11-3, test/m11/ for the rest)', () => {
    expect(formatValidator(resolved([one(bear, 9)]), 'casual')).toEqual({ errors: [], warnings: [] });
    expect(formatValidator(resolved([]), 'casual').errors).toEqual(['The deck is empty.']);
    expect(formatValidator(resolved([one(forest, 100)]), 'commander').errors.join()).toMatch(/No commander.*CR 903.3/);
    expect(formatValidator(resolved([one(forest, 100)]), 'Duel Commander').errors.join()).toMatch(/No commander.*CR 903.3/);
  });
});

describe('prepareDeck', () => {
  it('resolves names with the host\'s card data and compiles one definition per card', async () => {
    const r = await prepareDeck(deck({ Forest: 10, 'grizzly bears': 4 }, { 'Hill Giant': 2 }), { cards: fixtureDb(), format: 'casual' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deck.main).toHaveLength(14);
    expect(r.deck.main.filter((x) => x === 'Grizzly Bears')).toHaveLength(4);
    expect(r.deck.sideboard).toEqual(['Hill Giant', 'Hill Giant']);
    expect(r.deck.defs.map((d) => d.id).sort()).toEqual(['Forest', 'Grizzly Bears', 'Hill Giant']);
  });

  it('reports unknown names with suggestions instead of failing', async () => {
    const r = await prepareDeck(deck({ Forrest: 10 }), { cards: fixtureDb(), format: 'casual' });
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/Unknown card "Forrest" \(did you mean Forest/);
  });

  it('reads decklist text', () => {
    const { deck: d, errors } = deckFromText('4 Grizzly Bears\n20 Forest\n\nSideboard\n2 Hill Giant\n');
    expect(errors).toEqual([]);
    expect(d).toEqual({ main: [{ name: 'Grizzly Bears', count: 4 }, { name: 'Forest', count: 20 }], sideboard: [{ name: 'Hill Giant', count: 2 }] });
  });
});

describe('message checks (nothing from the network is trusted)', () => {
  const hello = { v: PROTOCOL_VERSION, type: 'hello', versions: localVersions(null), name: 'Gus', deck: deck({ Forest: 1 }), proof: 'a'.repeat(64) };

  it('accepts a well-formed hello and refuses other protocol versions', () => {
    expect(parseGuestMessage(hello).ok).toBe(true);
    expect(parseGuestMessage({ ...hello, v: 99 })).toMatchObject({ ok: false, version: true });
    expect(parseGuestMessage({ ...hello, type: 'view' }).ok).toBe(false); // a guest never sends views
    expect(parseGuestMessage({ ...hello, deck: { main: [{ name: 'Forest', count: 1e9 }], sideboard: [] } }).ok).toBe(false);
  });

  it('checks action shapes; startGame and unknown types are refused', () => {
    expect(checkAction({ type: 'pass', player: 'p2' })).toBeNull();
    expect(checkAction({ type: 'startGame' })).not.toBeNull();
    expect(checkAction({ type: 'hack', player: 'p2' })).not.toBeNull();
    expect(checkAction({ type: 'setStops', player: 'p2', stops: { ownTurn: [], opponentTurn: [], fullControl: true } })).toBeNull();
    expect(checkAction({ type: 'setStops', player: 'p2', stops: { ownTurn: [], opponentTurn: [], fullControl: true, extra: 1 } })).not.toBeNull();
    expect(checkAction({ type: 'answer', player: 'p2', decisionId: 'd1', answer: 'yes' })).not.toBeNull();
    expect(checkDeckSubmission({ main: [], sideboard: Array(400).fill({ name: 'x', count: 1 }) })).toMatch(/too long/);
  });

  it('compares versions: engine must match, rules pack only on request', () => {
    const h = localVersions('2026.10.11-1');
    expect(compareVersions(h, { ...h, engine: 'other' }).fatal?.code).toBe('version');
    expect(compareVersions(h, { ...h, rulesPack: null }).warnings).toHaveLength(1);
    expect(compareVersions(h, { ...h, rulesPack: null }, true).fatal?.code).toBe('rulesPack');
    expect(compareVersions(h, h)).toEqual({ warnings: [] });
  });
});

describe('format names', () => {
  it('refuses a format name it does not know instead of half-checking it; ids, display names and aliases are accepted', () => {
    const r = formatValidator(resolved([one(forest, 56), one(bear, 4)]), 'modrn');
    expect(r.errors.join(' ')).toMatch(/Unknown format "modrn"/);
    expect(formatValidator(resolved([one(forest, 56), one(bear, 4)]), 'Modern').errors).toEqual([]);
    expect(formatValidator(resolved([one(bear, 9)]), 'kitchen table').errors).toEqual([]);
  });

  it('caps every deck, casual included: 250 cards in the deck, 15 in the sideboard', async () => {
    expect((await prepareDeck(deck({ Forest: 251 }), { cards: fixtureDb(), format: 'casual' })).ok).toBe(false);
    const r = await prepareDeck(deck({ Forest: 60 }, { 'Hill Giant': 16 }), { cards: fixtureDb(), format: 'casual' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/sideboard has 16/);
  });

  it('the default validator is milestone 7 validateDeck: prepareDeck refuses a 10-card Modern deck (CR 100.2a)', async () => {
    const r = await prepareDeck(deck({ Forest: 10 }), { cards: fixtureDb(), format: 'modern' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/10 cards in the main deck; Modern needs at least 60/);
  });
});
