/**
 * CMP1 (CR 702.139a): the server's part of companion. The browser's `host` and `join` commands carry the deck's companion section on to packages/net (a deck
 * without one is passed on exactly as before), and POST /api/decks/validate reports the companion it checked and its condition problems.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cardStore, closeCardStores, type CardStore } from '../../src/cache';
import { parseClientMessage } from '../../src/online/messages';
import { validateDeck } from '../../src/validate';
import { makeFixtureCache, req, type FixtureCache } from '../fixture-cache';

vi.setConfig({ testTimeout: 60_000 });

const parse = (m: unknown) => parseClientMessage(JSON.stringify(m));
const LURRUS = 'Lurrus of the Dream-Den';
const DECK = { main: [{ name: 'Forest', count: 60 }], sideboard: [{ name: LURRUS, count: 1 }], companion: [{ name: LURRUS, count: 1 }] };

describe('CR 702.139a: the companion section from the browser', () => {
  it('host and join keep it, names and counts only', () => {
    const host = parse({ t: 'host', id: 1, name: 'Hana', deck: { ...DECK, companion: [{ name: LURRUS, count: 1, x: 1 }] }, format: 'casual' });
    expect(host).toEqual({ ok: true, message: { t: 'host', id: 1, name: 'Hana', deck: DECK, format: 'casual' } });
    const join = parse({ t: 'join', id: 2, address: '203.0.113.5:47620', code: '7KQ2-M9XD-4TRB-HC8P', name: 'Gus', deck: DECK });
    expect(join.ok && join.message.t === 'join' && join.message.deck).toEqual(DECK);
  });

  it('refuses a malformed section and more than one companion; a deck without one stays without one', () => {
    expect(parse({ t: 'host', id: 1, name: 'H', deck: { ...DECK, companion: LURRUS } })).toMatchObject({ ok: false, id: 1 });
    expect(parse({ t: 'host', id: 1, name: 'H', deck: { ...DECK, companion: [{ name: LURRUS, count: 2 }] } })).toMatchObject({ ok: false, id: 1 });
    const plain = parse({ t: 'host', id: 1, name: 'H', deck: { main: DECK.main, sideboard: [] } });
    expect(plain.ok && plain.message.t === 'host' && plain.message.deck).toEqual({ main: DECK.main, sideboard: [] });
  });
});

describe('CR 702.139a: POST /api/decks/validate and the companion', () => {
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

  it('names the companion it checked; an unmet condition is a companion error', async () => {
    expect(store).toBeDefined();
    const ok = await validateDeck(req({ body: { format: 'casual', deck: DECK } }), fx.ctx);
    expect(ok.status === 200 && ok.body).toMatchObject({ status: 'legal', companion: LURRUS });
    const bad = await validateDeck(req({ body: { format: 'casual', deck: { ...DECK, main: [...DECK.main, { name: 'Kitchen Finks', count: 1 }] } } }), fx.ctx);
    expect(bad.status).toBe(200);
    if (bad.status !== 200) return;
    expect(bad.body.status).toBe('illegal');
    expect(bad.body.problems).toEqual([expect.objectContaining({ kind: 'companion', severity: 'error', card: LURRUS, rules: ['CR 702.139a'] })]);
  });

  it('reads the companion of an MTGO list from the sideboard (a note) and reports it', async () => {
    const r = await validateDeck(req({ body: { format: 'casual', deck: { main: DECK.main, sideboard: DECK.sideboard } } }), fx.ctx);
    expect(r.status === 200 && r.body.companion).toBe(LURRUS);
    expect(r.status === 200 && r.body.problems.map((p) => [p.kind, p.severity])).toEqual([['companion', 'note']]);
  });
});
