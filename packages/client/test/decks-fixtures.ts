/** Fixture cards and a fake local server for the deck screens (no network: answers come from these tables through a stubbed fetch). */
import type { AutomationLevel, Color } from '@openmtg/engine';
import type { CardDetailResponse, CardSummary, ResolveResponse, SearchResponse, SetSummary, ValidateResponse } from '@openmtg/server/api';
import { parseDecklist } from '../../cards/src/decklist';
import type { Deck } from '../src/decks/model';
import { stubFetch } from './helpers';

export function card(
  name: string,
  o: { cost?: string | null; type?: string; text?: string; mv?: number; colors?: Color[]; automation?: AutomationLevel; pt?: [string, string]; layout?: string } = {},
): CardSummary {
  const colors = o.colors ?? [];
  return {
    name,
    oracleId: `oid-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    layout: o.layout ?? 'normal',
    manaValue: o.mv ?? 0,
    colors,
    colorIdentity: colors,
    faces: [
      {
        name,
        manaCost: o.cost ?? null,
        typeLine: o.type ?? 'Creature — Test',
        oracleText: o.text ?? '',
        colors,
        ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
      },
    ],
    legalities: { modern: 'legal', standard: 'not_legal' },
    automation: o.automation ?? 'full',
  };
}

export const CARDS: CardSummary[] = [
  card('Lightning Bolt', { cost: '{R}', type: 'Instant', text: 'Lightning Bolt deals 3 damage to any target.', mv: 1, colors: ['R'] }),
  card('Grizzly Bears', { cost: '{1}{G}', type: 'Creature — Bear', mv: 2, colors: ['G'], pt: ['2', '2'] }),
  card('Mountain', { type: 'Basic Land — Mountain', text: '({T}: Add {R}.)' }),
  card('Forest', { type: 'Basic Land — Forest', text: '({T}: Add {G}.)' }),
  card('Stomping Ground', { type: 'Land — Mountain Forest', text: '({T}: Add {R} or {G}.)\nAs Stomping Ground enters, you may pay 2 life.' }),
  card('Ancient Grudge', { cost: '{1}{R}', type: 'Instant', text: 'Destroy target artifact.\nFlashback {G}', mv: 2, colors: ['R'], automation: 'partial' }),
  card('Boros Charm', { cost: '{R}{W}', type: 'Instant', text: 'Choose one —', mv: 2, colors: ['R', 'W'], automation: 'manual' }),
  card('Lurrus of the Dream-Den', { cost: '{1}{W/B}{W/B}', type: 'Legendary Creature — Cat Nightmare', text: 'Companion — Each permanent card in your starting deck has mana value 2 or less.', mv: 3, colors: ['W', 'B'] }),
  card('Jegantha, the Wellspring', { cost: '{4}{R/G}', type: 'Legendary Creature — Elemental Elk', text: 'Companion — No card in your starting deck has more than one of the same mana symbol in its mana cost.', mv: 5, colors: ['R', 'G'] }),
  card('Fire // Ice', { cost: '{1}{R}', type: 'Instant', mv: 4, colors: ['R', 'U'], layout: 'split' }),
];

export const byName = new Map(CARDS.map((c) => [c.name, c]));

export function detail(c: CardSummary): CardDetailResponse {
  return {
    card: c,
    compiled: { faces: [{ name: c.name, abilities: 1, manual: c.automation === 'full' ? 0 : 1 }], compilerVersion: 'test' },
    manualParts: c.automation === 'full' ? [] : [{ face: 0, text: c.faces[0]!.oracleText.split('\n').pop()!, reason: 'no template', impact: 'ability', category: 'not-understood' as const, summary: 'This ability is done by hand.' }],
  };
}

/** What the real server does with decklist text: the cards package parser, then a name lookup in the fixture table. */
export function fakeResolve(text: string): ResolveResponse {
  const parsed = parseDecklist(text);
  const res: ResolveResponse = { cards: [], unknown: [], errors: parsed.errors, links: [], ignored: parsed.maybeboard.length };
  for (const section of ['main', 'sideboard', 'commander', 'companion'] as const) {
    for (const l of parsed[section]) {
      const c = byName.get(l.name);
      if (c) res.cards.push({ section, count: l.count, name: c.name, oracleId: c.oracleId, automation: c.automation });
      else res.unknown.push({ section, name: l.name, count: l.count, line: l.line, suggestions: [] });
    }
  }
  return res;
}

export interface FakeServer {
  search?: (params: URLSearchParams) => SearchResponse;
  /** A search the server refuses (HTTP 400): the message, or null to let `search` answer. */
  searchError?: (params: URLSearchParams) => string | null;
  resolve?: (text: string) => ResolveResponse | { status: number; body: unknown };
  validate?: (body: { deck: Deck; format: string }) => ValidateResponse;
  /** 'down': card lookups fail with HTTP 502 (as when the local server is not running). */
  cards?: 'down';
  /** GET /api/sets (absent: 404, as an older server). */
  sets?: SetSummary[];
}

/** Stub fetch with a fake server; unknown cards are 404, unanswered endpoints 501 (like the C0 stubs). */
export function fakeServer(s: FakeServer = {}) {
  return stubFetch((url, init) => {
    const u = new URL(url, 'http://127.0.0.1');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (u.pathname === '/api/cards/search') {
      const refused = s.searchError?.(u.searchParams);
      if (refused) return { status: 400, body: { error: refused } };
    }
    if (u.pathname === '/api/sets') return s.sets ? { status: 200, body: { sets: s.sets } } : { status: 404, body: { error: 'no route /api/sets' } };
    if (u.pathname === '/api/cards/search') return s.search ? { status: 200, body: s.search(u.searchParams) } : { status: 501, body: { error: 'not implemented' } };
    if (u.pathname.startsWith('/api/cards/')) {
      if (s.cards === 'down') return { status: 502, body: null };
      const c = byName.get(decodeURIComponent(u.pathname.slice('/api/cards/'.length)));
      return c ? { status: 200, body: detail(c) } : { status: 404, body: { error: 'Unknown card' } };
    }
    if (u.pathname === '/api/decks/resolve') {
      const r = (s.resolve ?? fakeResolve)(String(body.text));
      return 'status' in r ? r : { status: 200, body: r };
    }
    if (u.pathname === '/api/decks/validate')
      return s.validate ? { status: 200, body: s.validate(body as unknown as { deck: Deck; format: string }) } : { status: 200, body: { format: String(body.format), checkedAs: String(body.format), valid: true, status: 'legal', problems: [] } };
    return { status: 404, body: { error: `no route ${u.pathname}` } };
  });
}

export function deckFixture(over: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Gruul Test',
    format: 'modern',
    main: [
      { name: 'Lightning Bolt', count: 4, oracleId: 'oid-lightning-bolt' },
      { name: 'Grizzly Bears', count: 4, oracleId: 'oid-grizzly-bears' },
      { name: 'Mountain', count: 10, oracleId: 'oid-mountain' },
      { name: 'Stomping Ground', count: 2, oracleId: 'oid-stomping-ground' },
    ],
    sideboard: [{ name: 'Ancient Grudge', count: 2, oracleId: 'oid-ancient-grudge' }],
    commander: [],
    companion: [],
    notes: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...over,
  };
}
