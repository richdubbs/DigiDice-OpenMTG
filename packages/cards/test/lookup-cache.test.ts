import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { CardDatabase } from '../src/database';
import { ScryfallClient } from '../src/http';
import { cacheFiles } from '../src/paths';
import { rebuildIndex } from '../src/bulk';
import { card, clientWith, fakeClock, json, rawCard, tempDir, type RecordedCall } from './helpers';

/** A fake /cards/collection that knows a few names (and reports the rest in not_found). */
function collectionHandler(known: Record<string, Record<string, unknown>>) {
  return (c: RecordedCall) => {
    const ids = (JSON.parse(c.body ?? '{}') as { identifiers: Array<{ name: string }> }).identifiers;
    const data: unknown[] = [];
    const not_found: unknown[] = [];
    for (const { name } of ids) {
      const hit = known[name.toLowerCase()];
      if (hit) data.push(hit);
      else not_found.push({ name });
    }
    return json({ object: 'list', not_found, data });
  };
}

const COLLECTION = 'https://api.scryfall.com/cards/collection';

describe('one-off lookups: collection API and on-disk cache', () => {
  it('fetches unknown names in one POST /cards/collection and merges the cards into lookup()', async () => {
    const { client, calls } = clientWith(collectionHandler({ 'lightning bolt': rawCard('Lightning Bolt') }));
    const db = CardDatabase.fromCards([card('Grizzly Bears')], { client });
    expect(db.has('Lightning Bolt')).toBe(false);
    const r = await db.resolveNames(['Grizzly Bears', 'lightning bolt', 'Not A Card'], { fetchMissing: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(COLLECTION);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ identifiers: [{ name: 'lightning bolt' }, { name: 'Not A Card' }] });
    expect(r.resolved.map((x) => [x.card?.name ?? null, x.source])).toEqual([['Grizzly Bears', 'local'], ['Lightning Bolt', 'fetched'], [null, 'none']]);
    expect(db.lookup('Lightning Bolt')?.oracle_id).toBe('oid-Lightning Bolt');
    // Trimmed: rules fields plus display-only normal/large image URLs; never prices.
    expect(db.lookup('Lightning Bolt')).not.toHaveProperty('prices');
    expect(db.lookup('Lightning Bolt')?.image_uris).toEqual({ normal: 'https://cards.scryfall.io/normal/x.jpg', large: 'https://cards.scryfall.io/large/x.jpg' });
  });

  it('a second lookup of the same name makes no network request (found and not found)', async () => {
    const { client, calls } = clientWith(collectionHandler({ 'lightning bolt': rawCard('Lightning Bolt') }));
    const db = CardDatabase.fromCards([], { client });
    await db.resolveNames(['Lightning Bolt', 'Nonexistent Card'], { fetchMissing: true });
    expect(calls).toHaveLength(1);
    await db.resolveNames(['Lightning Bolt', 'Nonexistent Card'], { fetchMissing: true });
    await db.resolveNames(['  lightning   BOLT ', 'NONEXISTENT card'], { fetchMissing: true });
    expect(calls).toHaveLength(1);
  });

  it('persists found and not-found results across opens (disk cache), still without requests', async () => {
    const dir = await tempDir();
    const { client, calls } = clientWith(collectionHandler({ 'lightning bolt': rawCard('Lightning Bolt') }));
    const db1 = await openEmpty(dir, client);
    await db1.resolveNames(['Lightning Bolt', 'Nonexistent Card'], { fetchMissing: true });
    expect(calls).toHaveLength(1);

    const second = clientWith(() => {
      throw new Error('network must not be used');
    });
    const db2 = await openEmpty(dir, second.client);
    expect(db2.lookup('Lightning Bolt')?.name).toBe('Lightning Bolt'); // positive result merged at open
    const r = await db2.resolveNames(['Lightning Bolt', 'Nonexistent Card'], { fetchMissing: true });
    expect(r.resolved.map((x) => x.card?.name ?? null)).toEqual(['Lightning Bolt', null]);
    expect(second.calls).toHaveLength(0);
  });

  it('retries a not-found name only after 24 hours', async () => {
    const clock = fakeClock();
    const dir = await tempDir();
    const { client, calls } = clientWith(collectionHandler({}), clock);
    const db = await CardDatabase.open({ cacheDir: dir, client, clock, allowEmpty: true });
    await db.resolveNames(['Nonexistent Card'], { fetchMissing: true });
    clock.t += 23 * 3600_000;
    await db.resolveNames(['Nonexistent Card'], { fetchMissing: true });
    expect(calls).toHaveLength(1);
    clock.t += 2 * 3600_000;
    await db.resolveNames(['Nonexistent Card'], { fetchMissing: true });
    expect(calls).toHaveLength(2);
  });

  it('batches at most 75 identifiers per request', async () => {
    const { client, calls } = clientWith(collectionHandler({}));
    const db = CardDatabase.fromCards([], { client });
    const names = Array.from({ length: 160 }, (_, i) => `Missing Card ${i}`);
    await db.resolveNames(names, { fetchMissing: true });
    expect(calls.map((c) => (JSON.parse(c.body!) as { identifiers: unknown[] }).identifiers.length)).toEqual([75, 75, 10]);
    // The 600 ms spacing applies between the batches.
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(600);
    expect(calls[2]!.at - calls[1]!.at).toBeGreaterThanOrEqual(600);
  });

  it('does not ask for names that the local index has (including face aliases)', async () => {
    const { client, calls } = clientWith(collectionHandler({}));
    const fire = card('Fire // Ice', { layout: 'split', card_faces: [{ name: 'Fire' }, { name: 'Ice' }] });
    const db = CardDatabase.fromCards([fire], { client });
    await db.resolveNames(['Fire', 'Ice', 'fire // ice'], { fetchMissing: true });
    expect(calls).toHaveLength(0);
  });

  it('never fetches when fetchMissing is off', async () => {
    const { client, calls } = clientWith(collectionHandler({}));
    const db = CardDatabase.fromCards([], { client });
    const r = await db.resolveNames(['Whatever'], {});
    expect(r.resolved[0]!.card).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('reports a network failure as fetchError and still returns local results', async () => {
    const { client } = clientWith(() => json({ details: 'boom' }, 500));
    const db = CardDatabase.fromCards([card('Grizzly Bears')], { client });
    const r = await db.resolveDecklist('4 Grizzly Bears\n2 Mystery Card', { fetchMissing: true });
    expect(r.main.map((e) => e.card.name)).toEqual(['Grizzly Bears']);
    expect(r.unknown.map((u) => u.name)).toEqual(['Mystery Card']);
    expect(r.fetchError).toMatch(/500/);
  });

  it('treats tokens returned by name lookups as not found (out of scope) and caches that', async () => {
    const { client, calls } = clientWith(collectionHandler({ treasure: rawCard('Treasure', { layout: 'token' }) }));
    const db = CardDatabase.fromCards([], { client });
    await db.resolveNames(['Treasure'], { fetchMissing: true });
    await db.resolveNames(['Treasure'], { fetchMissing: true });
    expect(db.has('Treasure')).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('resolves a face-name request that Scryfall answers with the whole split card', async () => {
    const fireIce = rawCard('Fire // Ice', { layout: 'split', card_faces: [{ name: 'Fire', mana_cost: '{1}{R}' }, { name: 'Ice', mana_cost: '{1}{U}' }] });
    const { client } = clientWith(collectionHandler({ fire: fireIce }));
    const db = CardDatabase.fromCards([], { client });
    await db.resolveNames(['Fire'], { fetchMissing: true });
    expect(db.lookup('Fire')?.name).toBe('Fire // Ice');
    expect(db.lookup('Ice')?.name).toBe('Fire // Ice');
  });
});

async function openEmpty(dir: string, client: ScryfallClient) {
  // An (empty) index on disk, as after a refresh.
  const files = cacheFiles(dir);
  await mkdir(dir, { recursive: true });
  await writeFile(files.bulkJsonlGz, gzipSync(`${JSON.stringify(rawCard('Placeholder Card'))}\n`));
  await rebuildIndex(files, { type: 'oracle_cards', updated_at: '2026-01-01T00:00:00Z', downloaded_at: '2026-01-01T00:00:00Z', source_uri: 'x', format: 'jsonl.gz', size: 1, file: path.basename(files.bulkJsonlGz) });
  return CardDatabase.open({ cacheDir: dir, client });
}
