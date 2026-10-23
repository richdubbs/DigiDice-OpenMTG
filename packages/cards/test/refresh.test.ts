import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { refreshBulk } from '../src/bulk';
import { CardDatabase } from '../src/database';
import { fileExists } from '../src/fsutil';
import { cacheFiles } from '../src/paths';
import { clientWith, fakeClock, json, makeCache, rawCard, scryfallCollection, tempDir, type RecordedCall } from './helpers';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const HOUR = 3600_000;
const BULK_LIST = 'https://api.scryfall.com/bulk-data';
const FILE_URL = 'https://data.scryfall.io/oracle-cards/oracle-cards-3.jsonl.gz';
const jsonl = (objs: unknown[]) => `${objs.map((o) => JSON.stringify(o)).join('\n')}\n`;

function server(body: () => Response, state = { updated_at: '2026-10-11T09:00:00Z' }) {
  return (c: RecordedCall): Response => {
    if (c.url === BULK_LIST) return json({ data: [{ type: 'oracle_cards', updated_at: state.updated_at, jsonl_download_uri: FILE_URL }] });
    if (c.url === FILE_URL) return body();
    return json({ code: 'not_found' }, 404);
  };
}

describe('a failed index build still counts as a download (24 h rule)', () => {
  it('writes bulk-meta.json right after the download, so a failed index build never triggers a second download', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const { client, calls } = clientWith(server(() => new Response(Buffer.from('this is not gzip data'))), clock);
    await expect(refreshBulk({ client, cacheDir: dir, clock })).rejects.toThrow();
    expect(calls.map((c) => c.url)).toEqual([BULK_LIST, FILE_URL]);

    const files = cacheFiles(dir);
    const meta = JSON.parse(await readFile(files.meta, 'utf8'));
    expect(meta).toMatchObject({ updated_at: '2026-10-11T09:00:00Z', downloaded_at: new Date(NOW).toISOString(), source_uri: FILE_URL, format: 'jsonl.gz' });
    expect(meta.index).toBeUndefined();

    // Later refreshes within 24 h, and after it with nothing newer, send no download request.
    for (const later of [0, 2 * HOUR, 20 * HOUR]) {
      clock.t = NOW + later;
      await expect(refreshBulk({ client, cacheDir: dir, clock })).rejects.toThrow(); // still the same broken file
    }
    expect(calls.map((c) => c.url)).toEqual([BULK_LIST, FILE_URL]);
    clock.t = NOW + 30 * HOUR;
    await expect(refreshBulk({ client, cacheDir: dir, clock })).rejects.toThrow();
    expect(calls.filter((c) => c.url === FILE_URL)).toHaveLength(1); // /bulk-data is asked, the file (not newer) is not
  });

  it('recovers without network once the file is readable: refresh rebuilds the missing index', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const { client, calls } = clientWith(server(() => new Response(Buffer.from('broken'))), clock);
    await expect(refreshBulk({ client, cacheDir: dir, clock })).rejects.toThrow();
    await writeFile(cacheFiles(dir).bulkJsonlGz, gzipSync(jsonl([rawCard('Lightning Bolt')])));
    calls.length = 0;
    clock.t = NOW + HOUR;
    const r = await refreshBulk({ client, cacheDir: dir, clock });
    expect(r.action).toBe('rebuilt');
    expect(r.meta.index?.cards).toBe(1);
    expect(calls).toHaveLength(0);
    const db = await CardDatabase.open({ cacheDir: dir });
    expect(db.lookup('lightning bolt')?.name).toBe('Lightning Bolt');
  });
});

describe('download clean-up', () => {
  it('removes the .part file when the download breaks off, and keeps the previous data', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const state = { updated_at: '2026-10-11T09:00:00Z' };
    let broken = false;
    const { client } = clientWith(
      server(() => {
        if (!broken) return new Response(gzipSync(jsonl([rawCard('Lightning Bolt')])));
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.error(new Error('connection reset'));
          },
        });
        return new Response(stream);
      }, state),
      clock,
    );
    await refreshBulk({ client, cacheDir: dir, clock });
    const files = cacheFiles(dir);
    const before = await readFile(files.bulkJsonlGz);

    broken = true;
    state.updated_at = '2026-10-13T09:00:00Z';
    clock.t = NOW + 30 * HOUR;
    await expect(refreshBulk({ client, cacheDir: dir, clock })).rejects.toThrow(/connection reset/);
    expect(await fileExists(`${files.bulkJsonlGz}.part`)).toBe(false);
    expect(Buffer.compare(await readFile(files.bulkJsonlGz), before)).toBe(0); // the old file is untouched
    expect(JSON.parse(await readFile(files.meta, 'utf8')).updated_at).toBe('2026-10-11T09:00:00Z');
    const db = await CardDatabase.open({ cacheDir: dir });
    expect(db.has('Lightning Bolt')).toBe(true);
  });

  it('deletes the bulk file of the other format after a successful refresh', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const files = cacheFiles(dir);
    await makeCache(dir, [rawCard('Old Card')]);
    await writeFile(files.bulkJson, '[]'); // a leftover plain-JSON file from the old API
    const { client } = clientWith(server(() => new Response(gzipSync(jsonl([rawCard('New Card')])))), clock);
    const r = await refreshBulk({ client, cacheDir: dir, clock, force: true });
    expect(r.action).toBe('downloaded');
    expect(await fileExists(files.bulkJson)).toBe(false);
    expect(await fileExists(files.bulkJsonlGz)).toBe(true);
  });
});

describe('CardDatabase.refresh and reindex keep one-off lookups', () => {
  it('merges earlier one-off cards (and the names they were found under) into the reloaded index', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const extra = rawCard('Extra Card', { type_line: 'Creature — Extra' });
    const { client, calls } = clientWith((c) => {
      if (c.url === BULK_LIST || c.url === FILE_URL) return server(() => new Response(gzipSync(jsonl([rawCard('Lightning Bolt')]))))(c);
      return scryfallCollection([extra])(c);
    }, clock);
    const db = await CardDatabase.open({ cacheDir: dir, client, clock, allowEmpty: true });
    await db.refresh();
    await db.resolveNames(['Extra Card'], { fetchMissing: true });
    expect(db.has('Extra Card')).toBe(true);

    await db.refresh({ force: true });
    expect(db.has('Lightning Bolt')).toBe(true);
    expect(db.has('Extra Card')).toBe(true); // not in the bulk file, kept from the lookup cache

    calls.length = 0;
    const meta = await db.reindex();
    expect(meta.index?.cards).toBe(1);
    expect(db.has('Extra Card')).toBe(true);
    expect(calls).toHaveLength(0); // reindex needs no network

    const reopened = await CardDatabase.open({ cacheDir: dir, client });
    expect(reopened.lookup('extra card')?.name).toBe('Extra Card');
  });

  it('remembers a name Scryfall resolved to a card with a different name across reopens', async () => {
    const dir = await tempDir();
    await makeCache(dir, [rawCard('Placeholder')]);
    const odd = clientWith(() => json({ object: 'list', not_found: [], data: [rawCard('Real Name')] }));
    const db = await CardDatabase.open({ cacheDir: dir, client: odd.client });
    await db.resolveNames(['Typed Name'], { fetchMissing: true });
    expect(db.lookup('typed name')?.name).toBe('Real Name');

    const never = clientWith(() => {
      throw new Error('network must not be used');
    });
    const again = await CardDatabase.open({ cacheDir: dir, client: never.client });
    expect(again.lookup('Typed Name')?.name).toBe('Real Name');
    expect(never.calls).toHaveLength(0);
  });
});
