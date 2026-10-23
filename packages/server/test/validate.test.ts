/**
 * POST /api/decks/validate: request checks, name / Oracle id resolution, and the adapter to the format validator of @openmtg/cards (F1, built in parallel:
 * a fake validator stands in for it here; the endpoint test accepts both builds, with and without F1).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ValidateRequest } from '../src/api';
import { cardStore, closeCardStores, type CardStore } from '../src/cache';
import { f1Adapter, formatLegalityKey, type AdapterDeck, type FormatAdapter } from '../src/formats-adapter';
import { parseValidateRequest, resolveDeck, validateDeck, validateWith } from '../src/validate';
import { makeFixtureCache, req, type FixtureCache } from './fixture-cache';

// Compiling fixture cards (search pages, definitions, the classification index) takes seconds on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

let fx: FixtureCache;
let store: CardStore;

beforeAll(async () => {
  fx = makeFixtureCache();
  const opened = await cardStore(fx.ctx);
  if (!opened.ok) throw new Error(opened.error);
  store = opened.store;
});

afterAll(async () => {
  await closeCardStores();
  fx.cleanup();
});

const deck = (main: [string, number][], sideboard: [string, number][] = []): ValidateRequest['deck'] => ({
  main: main.map(([name, count]) => ({ name, count })),
  sideboard: sideboard.map(([name, count]) => ({ name, count })),
});

/** A stand-in for F1: a 60-card minimum (CR 100.2a) and four copies, reporting what it was given. */
function fakeAdapter(seen: AdapterDeck[] = []): FormatAdapter {
  return {
    validate(d, format) {
      seen.push(d);
      if (format !== 'modern' && format !== 'casual') return { unknownFormat: true, known: ['modern', 'casual'] };
      const size = d.main.reduce((n, e) => n + e.count, 0) + d.unresolved.filter((u) => u.section === 'main').reduce((n, e) => n + e.count, 0);
      const problems = [];
      if (format === 'modern' && size < 60) problems.push({ severity: 'error' as const, code: 'deck-too-small', rule: 'CR 100.2a', message: `The deck has ${size} cards; it needs at least 60.` });
      for (const u of d.unresolved) problems.push({ severity: 'warning' as const, code: 'unresolved-card', rule: 'CR 100.2a', message: `${u.name} is not in the card index.`, card: u.name });
      problems.push({ severity: 'note' as const, code: 'some-future-code', rule: '', message: 'Something new.' });
      return { formatId: format, valid: !problems.some((p) => p.severity === 'error'), problems };
    },
  };
}

describe('request checks', () => {
  it('accepts a DeckList and a format, and rejects malformed bodies with a reason', () => {
    expect(parseValidateRequest({ deck: { main: [{ name: 'Shock', count: 4 }] }, format: 'modern' })).toEqual({ format: 'modern', deck: { main: [{ name: 'Shock', count: 4 }], sideboard: [] } });
    for (const body of [null, {}, { deck: {}, format: 3 }, { deck: { main: 'x' }, format: 'modern' }, { deck: { main: [{ name: 'Shock', count: 0 }] }, format: 'modern' }, { deck: { main: [{ name: 'Shock', count: 1.5 }] }, format: 'modern' }, { deck: { main: [{ count: 1 }] }, format: 'modern' }]) {
      expect(typeof parseValidateRequest(body), JSON.stringify(body)).toBe('string');
    }
  });
});

describe('deck resolution', () => {
  it('finds cards by Oracle id first, then by name (any spelling), merges duplicates and keeps unknown names', () => {
    const bolt = fx.cards.find((c) => c.name === 'Lightning Bolt')!;
    const d = resolveDeck(store, {
      main: [{ name: 'Old Name Of A Card', count: 2, oracleId: bolt.oracle_id! }, { name: 'lightning bolt', count: 2 }, { name: 'Nonexistent Card', count: 3 }],
      sideboard: [{ name: 'Counterspell', count: 1 }],
    });
    expect(d.main.map((e) => [e.card.name, e.count])).toEqual([['Lightning Bolt', 4]]);
    expect(d.sideboard.map((e) => [e.card.name, e.count])).toEqual([['Counterspell', 1]]);
    expect(d.unresolved).toEqual([{ section: 'main', name: 'Nonexistent Card', count: 3 }]);
  });
});

describe('validation through the adapter', () => {
  it('maps the validator report: problem kinds, severities, rule citations; unknown codes are kept as "unknown"', () => {
    const r = validateWith(store, { format: 'modern', deck: deck([['Lightning Bolt', 4], ['Mystery Card', 2]]) }, fakeAdapter());
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.body.format).toBe('modern');
    expect(r.body.valid).toBe(false);
    expect(r.body.status).toBe('illegal');
    expect(r.body.problems).toEqual([
      { kind: 'size', severity: 'error', message: 'The deck has 6 cards; it needs at least 60.', rules: ['CR 100.2a'] },
      { kind: 'unknown', severity: 'warning', message: 'Mystery Card is not in the card index.', card: 'Mystery Card', rules: ['CR 100.2a'] },
      { kind: 'unknown', severity: 'note', message: 'Something new.', rules: [] },
    ]);
  });

  it('status is "unchecked", never "legal", while a warning says something could not be checked (no silent pass)', () => {
    const r = validateWith(store, { format: 'casual', deck: deck([['Shock', 1], ['Lighting Bolt', 4]]) }, fakeAdapter());
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.body.valid).toBe(true); // no rule of the format is broken...
    expect(r.body.status).toBe('unchecked'); // ...but a card was not checked
    const clean = validateWith(store, { format: 'casual', deck: deck([['Shock', 1]]) }, fakeAdapter());
    expect(clean.status === 200 && clean.body.status).toBe('legal'); // notes alone do not make a deck unchecked
  });

  it('echoes the requested format and names the format it was checked as ("freeform" is checked as casual)', () => {
    const casual = validateWith(store, { format: 'freeform', deck: deck([['Shock', 1]]) }, fakeAdapter());
    expect(casual.status === 200 && casual.body.format).toBe('freeform');
    expect(casual.status === 200 && casual.body.checkedAs).toBe('casual');
    const unknown = validateWith(store, { format: 'tiny leaders', deck: deck([['Shock', 1]]) }, fakeAdapter());
    expect(unknown.status).toBe(400);
    if (unknown.status === 400) expect(unknown.body.error).toContain('known formats: modern, casual');
  });

  it('uses F1 (a plain import) and maps its UnknownFormatError to the known format ids', () => {
    const adapter = f1Adapter();
    const empty = { main: [], sideboard: [], commander: [], companion: [], unresolved: [] };
    const casual = adapter.validate(empty, 'freeform');
    expect('formatId' in casual && casual.formatId).toBe('casual');
    const unknown = adapter.validate(empty, 'tiny leaders');
    expect('unknownFormat' in unknown && unknown.known).toEqual(expect.arrayContaining(['modern', 'legacy', 'casual']));
  });

  it('the format filter of search takes the legality key from F1 (aliases included), none for casual', () => {
    expect(formatLegalityKey('EDH')).toBe('commander');
    expect(formatLegalityKey('Duel Commander')).toBe('duel');
    expect(formatLegalityKey('freeform')).toBeNull();
    expect(formatLegalityKey('casual')).toBeNull();
  });

  it('the endpoint checks with F1: deck size (CR 100.2a) and cards not legal in the format', async () => {
    const r = await validateDeck(req({ body: { format: 'modern', deck: deck([['Lightning Bolt', 4], ['Sol Ring', 1]]) } }), fx.ctx);
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.body.valid).toBe(false);
    expect(r.body.problems.some((p) => p.kind === 'size' && p.rules.includes('CR 100.2a'))).toBe(true);
    expect(r.body.problems.some((p) => p.card === 'Sol Ring' && p.kind === 'notLegal')).toBe(true);
  });
});
