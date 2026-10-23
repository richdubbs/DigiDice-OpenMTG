import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { canSkipWithoutNetwork, REFRESH_WINDOW_MS, refreshBulk, shouldDownload, type BulkMeta } from '../src/bulk';
import { CardDatabase } from '../src/database';
import { buildIndexData, bulkLines } from '../src/index-store';
import { cacheFiles } from '../src/paths';
import { clientWith, fakeClock, json, rawCard, tempDir, type RecordedCall } from './helpers';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const meta = (over: Partial<BulkMeta> = {}): BulkMeta => ({
  type: 'oracle_cards',
  updated_at: '2026-10-10T21:00:00.000+00:00',
  downloaded_at: iso(NOW - 48 * HOUR),
  source_uri: 'https://data.scryfall.io/oracle-cards/x.jsonl.gz',
  format: 'jsonl.gz',
  size: 100,
  file: 'oracle-cards.jsonl.gz',
  ...over,
});

describe('bulk refresh decision logic', () => {
  it('downloads when there is no local copy or the refresh is forced', () => {
    expect(shouldDownload(undefined, '2026-10-11T00:00:00Z', NOW, false, false).download).toBe(true);
    expect(shouldDownload(meta(), '2026-10-11T00:00:00Z', NOW, false, false).download).toBe(true); // file missing
    expect(shouldDownload(meta({ updated_at: '2026-10-11T00:00:00Z' }), '2026-10-11T00:00:00Z', NOW, true, true)).toEqual({ download: true, reason: 'forced' });
  });

  it('downloads when Scryfall is newer AND the last download is older than 24 h', () => {
    expect(shouldDownload(meta(), '2026-10-11T09:00:00Z', NOW, false, true).download).toBe(true);
    expect(shouldDownload(meta({ downloaded_at: iso(NOW - 24 * HOUR) }), '2026-10-11T09:00:00Z', NOW, false, true).download).toBe(true); // exactly 24 h
  });

  it('skips when Scryfall is newer but the last download is under 24 h old', () => {
    const r = shouldDownload(meta({ downloaded_at: iso(NOW - 23 * HOUR) }), '2026-10-11T09:00:00Z', NOW, false, true);
    expect(r.download).toBe(false);
    expect(r.reason).toMatch(/24 h/);
  });

  it('skips when the data is older than 24 h but Scryfall has nothing newer', () => {
    expect(shouldDownload(meta(), '2026-10-10T21:00:00.000+00:00', NOW, false, true).download).toBe(false);
    expect(shouldDownload(meta(), '2026-10-09T00:00:00Z', NOW, false, true).download).toBe(false);
  });

  it('needs no network at all to skip within 24 h of the last download', () => {
    expect(canSkipWithoutNetwork(meta({ downloaded_at: iso(NOW - 1 * HOUR) }), NOW, false, true)).toBe(true);
    expect(canSkipWithoutNetwork(meta({ downloaded_at: iso(NOW - 25 * HOUR) }), NOW, false, true)).toBe(false);
    expect(canSkipWithoutNetwork(meta({ downloaded_at: iso(NOW - 1 * HOUR) }), NOW, true, true)).toBe(false); // --force
    expect(canSkipWithoutNetwork(undefined, NOW, false, true)).toBe(false);
    expect(canSkipWithoutNetwork(meta({ downloaded_at: iso(NOW - 1 * HOUR) }), NOW, false, false)).toBe(false); // file missing
    expect(REFRESH_WINDOW_MS).toBe(24 * HOUR);
  });
});

const jsonl = (objs: unknown[]) => `${objs.map((o) => JSON.stringify(o)).join('\n')}\n`;

const sampleCards = () => [
  rawCard('Lightning Bolt'),
  rawCard('Fire // Ice', {
    layout: 'split',
    mana_cost: '{1}{R} // {1}{U}',
    colors: ['R', 'U'],
    card_faces: [
      { object: 'card_face', name: 'Fire', mana_cost: '{1}{R}', type_line: 'Instant', oracle_text: 'Fire deals 2 damage.', artist: 'X', image_uris: { small: 's', normal: 'https://cards.scryfall.io/normal/f.jpg', png: 'p' } },
      { object: 'card_face', name: 'Ice', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Tap target permanent.' },
    ],
    all_parts: [{ object: 'related_card', id: 'x', component: 'combo_piece', name: 'Fire // Ice', type_line: 'Instant // Instant', uri: 'https://api.scryfall.com/cards/x' }],
  }),
  rawCard('Spirit', { layout: 'token', type_line: 'Token Creature — Spirit', set_type: 'token', oracle_id: 'tok1', all_parts: [{ component: 'combo_piece', name: 'Doomed Traveler', type_line: 'Creature', uri: 'u' }] }),
  rawCard('Spirit', { layout: 'token', type_line: 'Token Creature — Spirit', set_type: 'token', oracle_id: 'tok2' }),
  rawCard('Poison Emblem', { layout: 'emblem', type_line: 'Emblem', set_type: 'token' }),
  rawCard('Lightning Bolt Art Card', { layout: 'art_series' }),
  rawCard('Unglued Thing', { set_type: 'funny', border_color: 'silver' }),
  rawCard('Silver Thing', { border_color: 'silver' }),
  rawCard('Deck Type Card', { layout: 'front_card', set_type: 'memorabilia' }),
];

describe('index building from a bulk file', () => {
  it('trims to rules fields, splits tokens, and drops art_series / funny / silver-border / front_card cards', async () => {
    const lines = Readable.from(jsonl(sampleCards()).split('\n'));
    const built = await buildIndexData(lines, 'jsonl.gz');
    expect(built.cards.map((c) => c.name)).toEqual(['Fire // Ice', 'Lightning Bolt']);
    expect(built.tokens.map((c) => c.name)).toEqual(['Poison Emblem', 'Spirit', 'Spirit']);
    expect(built.stats).toMatchObject({ cards: 2, tokenVariants: 3, excludedArtSeries: 1, excludedFunny: 2, excludedFrontCard: 1, parseErrors: 0 });

    const bolt = built.cards[1]!;
    // WP24: Scryfall's per-format legalities are kept (format validation, docs/design/decks-and-formats.md).
    expect(Object.keys(bolt).sort()).toEqual(['artist', 'border_color', 'cmc', 'color_identity', 'colors', 'image_uris', 'keywords', 'layout', 'legalities', 'mana_cost', 'name', 'oracle_id', 'oracle_text', 'set_type', 'type_line']);
    expect(bolt).toMatchObject({ legalities: { standard: 'legal' } });
    expect(bolt.image_uris).toEqual({ normal: 'https://cards.scryfall.io/normal/x.jpg', large: 'https://cards.scryfall.io/large/x.jpg' }); // display-only, opt-in hot-link

    const fire = built.cards[0]!;
    expect(fire.card_faces).toEqual([
      // The picture's artist is kept with it, so a Scryfall image is always credited.
      { name: 'Fire', mana_cost: '{1}{R}', type_line: 'Instant', oracle_text: 'Fire deals 2 damage.', image_uris: { normal: 'https://cards.scryfall.io/normal/f.jpg' }, artist: 'X' },
      { name: 'Ice', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Tap target permanent.' },
    ]);
    expect(fire.all_parts).toEqual([{ component: 'combo_piece', name: 'Fire // Ice', type_line: 'Instant // Instant' }]);
    // Token creators are kept (name only) so fixtures can pick the right token variant.
    expect(built.tokens.find((t) => t.oracle_id === 'tok1')!.all_parts).toEqual([{ component: 'combo_piece', name: 'Doomed Traveler' }]);
  });

  it('streams a gzip JSONL file from disk', async () => {
    const dir = await tempDir();
    const file = `${dir}/b.jsonl.gz`;
    await writeFile(file, gzipSync(jsonl(sampleCards())));
    const built = await buildIndexData(bulkLines(file, 'jsonl.gz'), 'jsonl.gz');
    expect(built.stats.lines).toBe(sampleCards().length);
    expect(built.cards).toHaveLength(2);
  });

  it('falls back to the old plain-JSON array format (one object per line, trailing commas)', async () => {
    const dir = await tempDir();
    const file = `${dir}/b.json`;
    const objs = sampleCards().slice(0, 2);
    await writeFile(file, `[\n${objs.map((o) => JSON.stringify(o)).join(',\n')}\n]\n`);
    const built = await buildIndexData(bulkLines(file, 'json'), 'json');
    expect(built.cards.map((c) => c.name)).toEqual(['Fire // Ice', 'Lightning Bolt']);
    expect(built.stats.parseErrors).toBe(0);
  });

  it('counts unparsable lines instead of crashing', async () => {
    const built = await buildIndexData(Readable.from(['{"name":"A","layout":"normal"}', 'not json', '{"layout":"normal"}', '[1,2]']), 'jsonl.gz');
    expect(built.cards.map((c) => c.name)).toEqual(['A']);
    expect(built.stats.parseErrors).toBe(3);
  });
});

describe('refreshBulk with mocked HTTP', () => {
  const BULK_LIST = 'https://api.scryfall.com/bulk-data';
  const FILE_URL = 'https://data.scryfall.io/oracle-cards/oracle-cards-2.jsonl.gz';

  function server(state: { updated_at: string }, cards = sampleCards()) {
    return (c: RecordedCall): Response => {
      if (c.url === BULK_LIST) {
        return json({
          object: 'list',
          has_more: false,
          data: [
            { object: 'bulk_data', type: 'default_cards', updated_at: state.updated_at, jsonl_download_uri: 'https://data.scryfall.io/default.jsonl.gz' },
            { object: 'bulk_data', type: 'oracle_cards', updated_at: state.updated_at, jsonl_download_uri: FILE_URL, compressed_size: 10 },
          ],
        });
      }
      if (c.url === FILE_URL) return new Response(gzipSync(jsonl(cards)));
      return json({ code: 'not_found' }, 404);
    };
  }

  it('downloads the oracle_cards file, records metadata and builds the index', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const { client, calls } = clientWith(server({ updated_at: '2026-10-11T09:00:00Z' }), clock);
    const r = await refreshBulk({ client, cacheDir: dir, clock });
    expect(r.action).toBe('downloaded');
    expect(calls.map((c) => c.url)).toEqual([BULK_LIST, FILE_URL]);
    expect(calls[1]!.headers['User-Agent']).toMatch(/^OpenMTG/);
    expect(r.meta).toMatchObject({ type: 'oracle_cards', updated_at: '2026-10-11T09:00:00Z', source_uri: FILE_URL, format: 'jsonl.gz', downloaded_at: iso(NOW) });
    expect(r.meta.size).toBeGreaterThan(0);
    expect(r.meta.index).toMatchObject({ cards: 2, tokenVariants: 3 });
    expect(JSON.parse(await readFile(cacheFiles(dir).meta, 'utf8')).updated_at).toBe('2026-10-11T09:00:00Z');

    const db = await CardDatabase.open({ cacheDir: dir });
    expect(db.lookup('fire')?.name).toBe('Fire // Ice');
    expect(db.lookupTokens('Spirit')).toHaveLength(2);
  });

  it('makes no request at all within 24 h of the last download', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const state = { updated_at: '2026-10-11T09:00:00Z' };
    const { client, calls } = clientWith(server(state), clock);
    await refreshBulk({ client, cacheDir: dir, clock });
    calls.length = 0;
    clock.t += 23 * HOUR;
    state.updated_at = '2026-10-12T05:00:00Z'; // newer data exists, but we are inside the window
    const r = await refreshBulk({ client, cacheDir: dir, clock });
    expect(r.action).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('after 24 h only asks /bulk-data and skips the download if updated_at is unchanged', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const state = { updated_at: '2026-10-11T09:00:00Z' };
    const { client, calls } = clientWith(server(state), clock);
    await refreshBulk({ client, cacheDir: dir, clock });
    calls.length = 0;
    clock.t += 30 * HOUR;
    const r = await refreshBulk({ client, cacheDir: dir, clock });
    expect(r.action).toBe('skipped');
    expect(r.reason).toMatch(/up to date/);
    expect(calls.map((c) => c.url)).toEqual([BULK_LIST]);
  });

  it('after 24 h downloads again when updated_at is newer', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const state = { updated_at: '2026-10-11T09:00:00Z' };
    const { client, calls } = clientWith(server(state), clock);
    await refreshBulk({ client, cacheDir: dir, clock });
    calls.length = 0;
    clock.t += 30 * HOUR;
    state.updated_at = '2026-10-12T09:00:00Z';
    const r = await refreshBulk({ client, cacheDir: dir, clock });
    expect(r.action).toBe('downloaded');
    expect(calls.map((c) => c.url)).toEqual([BULK_LIST, FILE_URL]);
    expect(r.meta.updated_at).toBe('2026-10-12T09:00:00Z');
  });

  it('--force downloads even when fresh', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const { client, calls } = clientWith(server({ updated_at: '2026-10-11T09:00:00Z' }), clock);
    await refreshBulk({ client, cacheDir: dir, clock });
    calls.length = 0;
    const r = await refreshBulk({ client, cacheDir: dir, clock, force: true });
    expect(r.action).toBe('downloaded');
    expect(calls.map((c) => c.url)).toEqual([BULK_LIST, FILE_URL]);
  });

  it('uses download_uri (plain JSON) when only the old field is offered', async () => {
    const dir = await tempDir();
    const clock = fakeClock(NOW);
    const OLD = 'https://data.scryfall.io/oracle-cards/old.json';
    const { client, calls } = clientWith((c) => {
      if (c.url === BULK_LIST) return json({ data: [{ type: 'oracle_cards', updated_at: '2026-10-11T09:00:00Z', download_uri: OLD }] });
      return new Response(`[\n${sampleCards().slice(0, 2).map((o) => JSON.stringify(o)).join(',\n')}\n]\n`);
    }, clock);
    const r = await refreshBulk({ client, cacheDir: dir, clock });
    expect(r.meta.format).toBe('json');
    expect(r.meta.index?.cards).toBe(2);
    expect(calls[1]!.headers.Accept).toContain('json');
  });

  it('fails clearly when there is no oracle_cards entry', async () => {
    const dir = await tempDir();
    const { client } = clientWith(() => json({ data: [{ type: 'rulings', updated_at: 'x' }] }));
    await expect(refreshBulk({ client, cacheDir: dir })).rejects.toThrow(/oracle_cards/);
  });
});
