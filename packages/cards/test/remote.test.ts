import { describe, expect, it, vi } from 'vitest';
import { CardDatabase } from '../src/database';
import { card, clientWith, json, rawCard, scryfallCollection, type RecordedCall } from './helpers';

const COPTER = rawCard("Smuggler's Copter", { type_line: 'Artifact — Vehicle', mana_cost: '{2}' });
const bodies = (calls: RecordedCall[]) => calls.map((c) => (JSON.parse(c.body!) as { identifiers: Array<{ name: string }> }).identifiers.map((i) => i.name));

describe('names that differ from the real name only by punctuation', () => {
  it('resolves "Smugglers Copter" from the local index without any request', async () => {
    const { client, calls } = clientWith(scryfallCollection([]));
    const db = CardDatabase.fromCards([card("Smuggler's Copter"), card('Jötun Grunt'), card("Urza's Tower")], { client });
    const r = await db.resolveNames(['Smugglers Copter', 'Jotun Grunt', 'Urzas Tower', "URZA'S TOWER"], { fetchMissing: true });
    expect(r.resolved.map((x) => [x.card?.name, x.source])).toEqual([["Smuggler's Copter", 'local'], ['Jötun Grunt', 'local'], ["Urza's Tower", 'local'], ["Urza's Tower", 'local']]);
    expect(calls).toHaveLength(0);
  });

  it('keeps two cards that differ only by a comma apart (exact name first)', async () => {
    const a = card('Glimpse the Unthinkable');
    const b = card('Glimpse, the Unthinkable');
    const db = CardDatabase.fromCards([a, b]);
    expect(db.lookup('Glimpse the Unthinkable')).toBe(a);
    expect(db.lookup('Glimpse, the Unthinkable')).toBe(b);
    expect(db.lookup('glimpse, the unthinkable')).toBe(b);
    // Neither spelling matches exactly: ambiguous, not a silent guess.
    expect(db.lookup('Glimpse the, Unthinkable')).toBeUndefined();
    const r = await db.resolveNames(['Glimpse the, Unthinkable']);
    expect(r.resolved[0]).toMatchObject({ card: null, ambiguous: ['Glimpse the Unthinkable', 'Glimpse, the Unthinkable'] });
  });

  it('a name Scryfall resolves under its real name is requested once and then served from the cache', async () => {
    const { client, calls } = clientWith(scryfallCollection([COPTER]));
    const db = CardDatabase.fromCards([], { client });
    for (let i = 0; i < 3; i++) {
      const r = await db.resolveNames(['Smugglers Copter'], { fetchMissing: true });
      expect(r.resolved[0]!.card?.name).toBe("Smuggler's Copter");
    }
    expect(calls).toHaveLength(1);
    expect(bodies(calls)).toEqual([['Smugglers Copter']]);
    expect(db.lookup("smuggler's copter")?.name).toBe("Smuggler's Copter");
  });

  it('if Scryfall returns a card under a name we cannot match, a single unmatched name is paired with the single unclaimed card', async () => {
    const { client, calls } = clientWith(() => json({ object: 'list', not_found: [], data: [rawCard('Totally Different Name')] }));
    const db = CardDatabase.fromCards([], { client });
    await db.resolveNames(['Zork'], { fetchMissing: true });
    expect(db.lookup('Zork')?.name).toBe('Totally Different Name');
    await db.resolveNames(['Zork'], { fetchMissing: true });
    expect(calls).toHaveLength(1);
  });

  it('an answer that cannot be matched at all is cached as unmatched for 24 h and never re-requested', async () => {
    const { client, calls } = clientWith(() => json({ object: 'list', not_found: [], data: [] }));
    const messages: string[] = [];
    const db = CardDatabase.fromCards([], { client, log: (m) => messages.push(m) });
    for (let i = 0; i < 3; i++) await db.resolveNames(['Mystery A', 'Mystery B'], { fetchMissing: true });
    expect(calls).toHaveLength(1);
    expect(messages.some((m) => /no returned card matches/.test(m))).toBe(true);
  });
});

describe('not-found answers for names written with a single slash', () => {
  it('"Foo/Bar" is requested once, whatever the spacing of the repeats', async () => {
    const { client, calls } = clientWith(scryfallCollection([]));
    const db = CardDatabase.fromCards([], { client });
    await db.resolveNames(['Foo/Bar'], { fetchMissing: true });
    await db.resolveNames(['Foo/Bar'], { fetchMissing: true });
    await db.resolveNames(['foo / bar'], { fetchMissing: true });
    await db.resolveNames(['Foo // Bar'], { fetchMissing: true });
    expect(calls).toHaveLength(1);
    expect(bodies(calls)).toEqual([['Foo // Bar']]);
  });
});

describe('concurrency and ambiguity', () => {
  it('simultaneous lookups of the same missing names share one request', async () => {
    const { client, calls } = clientWith(scryfallCollection([COPTER]));
    const db = CardDatabase.fromCards([], { client });
    const [a, b, c] = await Promise.all([
      db.resolveNames(['Nonexistent Card', "Smuggler's Copter"], { fetchMissing: true }),
      db.resolveNames(['Nonexistent Card'], { fetchMissing: true }),
      db.resolveNames(['smugglers copter'], { fetchMissing: true }),
    ]);
    expect(calls).toHaveLength(1);
    expect(bodies(calls)).toEqual([['Nonexistent Card', "Smuggler's Copter"]]);
    expect(a.resolved.map((x) => x.card?.name ?? null)).toEqual([null, "Smuggler's Copter"]);
    expect(b.resolved[0]!.card).toBeNull();
    expect(c.resolved[0]!.card?.name).toBe("Smuggler's Copter");
  });

  it('a failed shared request reports the error to every waiter and does not poison later calls', async () => {
    let fail = true;
    const { client, calls } = clientWith((c) => (fail ? json({ details: 'boom' }, 500) : scryfallCollection([COPTER])(c)));
    const db = CardDatabase.fromCards([], { client });
    const [a, b] = await Promise.all([db.resolveNames(['Smugglers Copter'], { fetchMissing: true }), db.resolveNames(['Smugglers Copter'], { fetchMissing: true })]);
    expect(a.fetchError).toMatch(/500/);
    expect(b.fetchError).toMatch(/500/);
    expect(calls).toHaveLength(1);
    fail = false;
    const c = await db.resolveNames(['Smugglers Copter'], { fetchMissing: true });
    expect(c.resolved[0]!.card?.name).toBe("Smuggler's Copter");
  });

  it('an ambiguous face name is reported with its candidates and never sent to Scryfall', async () => {
    const mk = (name: string) => card(`${name} // Seed Suture`, { layout: 'prepare', card_faces: [{ name }, { name: 'Seed Suture' }] });
    const { client, calls } = clientWith(scryfallCollection([]));
    const db = CardDatabase.fromCards([mk('Vigorbloom Vanguard'), mk('Blossom-Blessed Angel'), mk('Emergency Phytomedic')], { client });
    const r = await db.resolveNames(['Seed Suture', 'Vigorbloom Vanguard'], { fetchMissing: true });
    expect(r.resolved[0]).toMatchObject({ card: null, source: 'none', ambiguous: ['Blossom-Blessed Angel // Seed Suture', 'Emergency Phytomedic // Seed Suture', 'Vigorbloom Vanguard // Seed Suture'] });
    expect(r.resolved[1]!.card?.name).toBe('Vigorbloom Vanguard // Seed Suture');
    expect(calls).toHaveLength(0);
    const deck = await db.resolveDecklist('2 Seed Suture\n1 Vigorbloom Vanguard');
    expect(deck.unknown).toHaveLength(1);
    expect(deck.unknown[0]).toMatchObject({ name: 'Seed Suture', line: 1, ambiguous: expect.arrayContaining(['Emergency Phytomedic // Seed Suture']) });
    expect(deck.main.map((e) => e.card.name)).toEqual(['Vigorbloom Vanguard // Seed Suture']);
    expect((await db.stats()).sharedAliases).toBe(1);
  });

  it('a name that is the front face of one card and the back face of others resolves to the front-face card', () => {
    const front = card('Seed Suture // Other', { layout: 'adventure', card_faces: [{ name: 'Seed Suture' }, { name: 'Other' }] });
    const back = card('Angel // Seed Suture', { layout: 'prepare', card_faces: [{ name: 'Angel' }, { name: 'Seed Suture' }] });
    expect(CardDatabase.fromCards([back, front]).lookup('seed suture')).toBe(front);
    expect(CardDatabase.fromCards([front, back]).lookup('seed suture')).toBe(front);
  });
});

describe('decklists with repeated unknown names', () => {
  it('reports each unknown name once (first occurrence) and asks Scryfall once', async () => {
    const { client, calls } = clientWith(scryfallCollection([]));
    const db = CardDatabase.fromCards([card('Known Card')], { client });
    const deck = await db.resolveDecklist('2 Mystery Card\n1 Known Card\n1 mystery card\n\n3 Mystery Card\n');
    expect(deck.unknown.map((u) => [u.name, u.line, u.section])).toEqual([
      ['Mystery Card', 1, 'main'],
      ['mystery card', 3, 'main'],
    ]);
    expect(calls).toHaveLength(0); // fetchMissing is off by default
    const fetched = await db.resolveDecklist('2 Mystery Card\n1 Known Card\n\n3 Mystery Card\n', { fetchMissing: true });
    expect(fetched.unknown.map((u) => [u.name, u.line, u.section])).toEqual([['Mystery Card', 1, 'main']]);
    expect(calls).toHaveLength(1);
  });
});

describe('one request queue for the whole process', () => {
  it('two databases without their own client share one client, so their requests stay 600 ms apart', async () => {
    const times: number[] = [];
    const stub = (async (_url: unknown, init?: RequestInit) => {
      times.push(Date.now());
      const ids = (JSON.parse(String(init?.body)) as { identifiers: Array<{ name: string }> }).identifiers;
      return json({ object: 'list', not_found: ids, data: [] });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', stub);
    try {
      const a = CardDatabase.fromCards([]);
      const b = CardDatabase.fromCards([]);
      await Promise.all([a.resolveNames(['Missing One'], { fetchMissing: true }), b.resolveNames(['Missing Two'], { fetchMissing: true })]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(590);
  });
});
