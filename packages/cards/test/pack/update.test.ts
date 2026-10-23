/** WP27: `update` (Scryfall refresh + rules pack + summary) and `build-pack` through the CLI, with injected I/O (no network). */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ABILITY_MODEL_VERSION, defaultParseOptions, type CompiledCardEntry, type OracleCard } from '@openmtg/engine';
import type { Io } from '../../src/commands';
import { fixtureCards } from '../../src/coverage/corpus';
import { LlmCache } from '../../src/llm/cache';
import { faceViews } from '../../src/llm/face-lines';
import { runGates } from '../../src/llm/gates';
import { cardWork } from '../../src/llm/work';
import { buildPack } from '../../src/pack/build';
import { coverageDelta } from '../../src/pack/delta';
import { packCommand } from '../../src/pack/cli';
import { MANIFEST_FILE, PACK_FILE, loadInstalledPack } from '../../src/pack/install';
import { sourcesWith } from '../../src/pack/sources';
import { runUpdate } from '../../src/pack/update';
import { tempDir } from '../helpers';
import { bareSources, fixture, goodReply } from '../llm/support';

const NOW = new Date('2026-10-12T10:00:00Z');

function entryFor(name: string): CompiledCardEntry {
  const card = fixture(name);
  const work = cardWork(card, bareSources())!;
  const g = runGates({ work, sources: bareSources(), views: faceViews(card) }, goodReply(work));
  if (!g.ok) throw new Error(g.message);
  return { oracleId: card.oracle_id!, textHash: work.report.textHash, modelVersion: ABILITY_MODEL_VERSION, faces: g.faces, review: 'reviewed', source: 'llm', flags: [] };
}

async function packFiles(requiresEngine: Record<string, string[]> = {}): Promise<{ file: string; dir: string }> {
  const cards = [fixture('Lightning Bolt'), fixture('Giant Growth')];
  const r = buildPack({ llm: [entryFor('Lightning Bolt'), entryFor('Giant Growth')], overrides: [], cardsById: new Map(cards.map((c) => [c.oracle_id!, c])), sources: bareSources(), packVersion: '2026.10.12-1', createdAt: NOW.toISOString() });
  const pack = { ...r.pack, requiresEngine };
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  const { sha256 } = await import('../../src/pack/install');
  const dir = await tempDir();
  await writeFile(path.join(dir, PACK_FILE), bytes);
  await writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify({ ...r.manifest, sha256: sha256(bytes), size: bytes.length }));
  return { file: path.join(dir, PACK_FILE), dir };
}

function io(): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l), readStdin: async () => '' };
}

describe('update (updates.md: one button, two sources)', () => {
  it('refreshes the card data, installs the pack from a local file (manifest verified) and prints the summary', async () => {
    const { file } = await packFiles({ [fixture('Giant Growth').oracle_id!]: ['feature:not-in-this-build'] });
    const packsDir = await tempDir();
    let cards: OracleCard[] = [fixture('Lightning Bolt'), fixture('Doom Blade')];
    const lines: string[] = [];
    const { code, summary } = await runUpdate({
      refresh: async () => {
        cards = [...cards, fixture('Giant Growth')];
        return { action: 'downloaded', reason: 'Scryfall has newer data' };
      },
      listCards: async () => cards, source: { file }, packsDir, base: bareSources(), now: NOW, out: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    const text = lines.join('\n');
    expect(text).toMatch(/Card data: downloaded/);
    expect(text).toMatch(/New cards known: 1 \(Giant Growth\)/);
    expect(text).toMatch(/Rules pack 2026.10.12-1 installed \(SHA-256 verified against its manifest\): 2 card entries/);
    expect(text).toMatch(/Pack entries for your cards: 2 apply/);
    expect(summary).toMatchObject({ newlyAutomated: 2, lessAutomated: 0, stillManual: 0 });
    expect(text).toMatch(/1 card\(s\) need a newer OpenMTG .*Giant Growth \(feature:not-in-this-build\)/);
    expect((await loadInstalledPack(packsDir))!.record.verifiedBy).toBe('manifest');
  });

  it('refuses a tampered pack file and keeps the installed one', async () => {
    const { file } = await packFiles();
    const packsDir = await tempDir();
    const deps = { listCards: async () => [fixture('Lightning Bolt')], packsDir, base: bareSources(), now: NOW };
    expect((await runUpdate({ ...deps, source: { file }, out: () => {} })).code).toBe(0);
    await writeFile(file, (await readFile(file, 'utf8')).replace('"reviewed"', '"autoverified"'));
    const lines: string[] = [];
    expect((await runUpdate({ ...deps, source: { file }, out: (l) => lines.push(l) })).code).toBe(1);
    expect(lines.join('\n')).toMatch(/Rules pack NOT installed: .*tampered.*\(keeping 2026.10.12-1\)/);
    expect((await loadInstalledPack(packsDir))!.record.packVersion).toBe('2026.10.12-1');
  });

  it('downloads from OPENMTG_PACK_URL (the manifest), through the CLI', async () => {
    const { file, dir } = await packFiles();
    const bytes = await readFile(file);
    const manifest = await readFile(path.join(dir, MANIFEST_FILE));
    const fetchMock = (async (u: URL | string) => new Response(String(u).endsWith('manifest.json') ? manifest : bytes)) as unknown as typeof fetch;
    const o = io();
    const packsDir = await tempDir();
    const code = await packCommand('update', ['--no-refresh'], o, {
      env: { OPENMTG_PACK_URL: 'https://packs.example.test/openmtg/manifest.json' }, fetch: fetchMock, cards: [fixture('Lightning Bolt')], packsDir, compiledDir: await tempDir(), now: () => NOW,
    });
    expect(code).toBe(0);
    expect(o.lines.join('\n')).toMatch(/not refreshed[\s\S]*installed \(SHA-256 verified/);
  });

  it('a failed Scryfall refresh never blocks "Load update file" (offline): the pack is installed and the error reported', async () => {
    const { file } = await packFiles();
    const packsDir = await tempDir();
    const o = io();
    const code = await packCommand('update', ['--file', file], o, {
      env: {}, cards: [fixture('Lightning Bolt')], packsDir, compiledDir: await tempDir(), now: () => NOW,
      refresh: async () => { throw new Error('getaddrinfo ENOTFOUND api.scryfall.com'); },
    });
    expect(code).toBe(0);
    expect(o.lines.join('\n')).toMatch(/Card data: not refreshed \(getaddrinfo ENOTFOUND api.scryfall.com\)[\s\S]*Rules pack 2026.10.12-1 installed/);
    expect(await loadInstalledPack(packsDir)).not.toBeNull();
  });
  it('pack templates reach every card: when they change, the summary compiles every card (newly automated counts them)', async () => {
    const damage = defaultParseOptions().templates.find((t) => t.id === 'eff.damage');
    expect(damage).toBeDefined();
    const all = fixtureCards();
    const r = buildPack({ llm: [], overrides: [], cardsById: new Map(all.map((c) => [c.oracle_id!, c])), sources: bareSources(), packVersion: 'tpl-1', createdAt: NOW.toISOString(), templates: [{ ...damage!, id: 'pack.eff.damage' }] });
    expect(r.delta.cards).toBe(all.length);
    expect(r.delta.up.map((u) => u.name)).toContain('Lightning Bolt');
    const dir = await tempDir();
    const file = path.join(dir, PACK_FILE);
    await writeFile(file, r.bytes);
    await writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify(r.manifest));
    const lines: string[] = [];
    // the summary line names the first ten cards up in the order listCards gives them, so Lightning Bolt goes first (std-ry4's cards pushed it past ten)
    const boltFirst = [...all.filter((c) => c.name === 'Lightning Bolt'), ...all.filter((c) => c.name !== 'Lightning Bolt')];
    const { summary } = await runUpdate({ listCards: async () => boltFirst, source: { file }, packsDir: await tempDir(), base: bareSources(), now: NOW, out: (l) => lines.push(l) });
    expect(summary.templatesChanged).toBe(true);
    expect(summary.newlyAutomated).toBe(r.delta.up.length);
    expect(lines.join('\n')).toMatch(/Pack templates changed \(0 -> 1\): every card is compiled again[\s\S]*Newly automated: \d+ \(.*Lightning Bolt manual -> partial/);
  }, 60_000); // compiles the 961 fixture cards twice (the pack's delta, the update's summary): 5.7-7.4 s in a cloud container with about 1,785 templates (Standard merge wave 4; over the 5 s default on its base 389390a4 too); assertions unchanged
  it('a first card download (empty local index) with a slice: yields between cards, reports progress, and sums up as the full delta would', async () => {
    // UPD1 review: the server runs this on its own event loop, and a first download makes every card "new"; with `slice` it never blocks for long
    const { file } = await packFiles();
    const all = fixtureCards();
    let cards: OracleCard[] = [];
    const pauses: number[] = [];
    const progress: [number, number][] = [];
    const packsDir = await tempDir();
    const lines: string[] = [];
    const { code, summary } = await runUpdate({
      refresh: async () => {
        cards = all;
        return { action: 'downloaded', reason: 'no local data' };
      },
      listCards: async () => cards, source: { file }, packsDir, base: bareSources(), now: NOW, out: (l) => lines.push(l),
      slice: { ms: 0, pause: async () => void pauses.push(progress.length), progress: (done, total) => progress.push([done, total]) },
    });
    expect(code).toBe(0);
    expect(summary.newCards.length).toBe(all.length);
    const pack = (await loadInstalledPack(packsDir))!;
    const total = all.length + pack.entries.size;
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.every(([, t]) => t === total)).toBe(true);
    expect(progress.at(-1)).toEqual([total, total]);
    expect(pauses.length).toBeGreaterThanOrEqual(all.length); // ms 0: a pause after every card
    // the same counts as compiling every card with both sources
    const full = coverageDelta(all, sourcesWith({ pack: null }, bareSources()), sourcesWith({ pack }, bareSources()));
    expect(summary).toMatchObject({ newlyAutomated: full.up.length, lessAutomated: full.down.length, stillManual: full.after.manual });
    expect(full.up.map((u) => u.name).sort()).toEqual(['Giant Growth', 'Lightning Bolt']);
  }, 60_000); // compiles every fixture card twice (in slices, then the full delta): 4.5-4.9 s alone with ~1,700 fixture cards (main 348cb82), over the 5 s default under load
  it('without a pack source it says how to configure one', async () => {
    const o = io();
    expect(await packCommand('update', ['--no-refresh'], o, { env: {}, cards: [fixture('Lightning Bolt')], packsDir: await tempDir(), compiledDir: await tempDir(), now: () => NOW })).toBe(0);
    expect(o.lines.join('\n')).toMatch(/no source configured \(set OPENMTG_PACK_URL/);
  });

  it('a local file without a manifest installs with a warning', async () => {
    const { file, dir } = await packFiles();
    const lone = path.join(await tempDir(), 'my-pack.json');
    await writeFile(lone, await readFile(file));
    expect(dir).not.toBe(path.dirname(lone));
    const o = io();
    expect(await packCommand('update', ['--no-refresh', '--file', lone], o, { env: {}, cards: [fixture('Lightning Bolt')], packsDir: await tempDir(), compiledDir: await tempDir(), now: () => NOW })).toBe(0);
    expect(o.lines.join('\n')).toMatch(/warning: no manifest[\s\S]*not verified: no manifest/);
  });
});

describe('build-pack through the CLI', () => {
  it('writes the pack and its manifest from the reviewed LLM entries', async () => {
    const compiledDir = await tempDir();
    const cache = new LlmCache(compiledDir);
    await cache.putEntry(entryFor('Lightning Bolt'), { promptVersion: 1, model: 'm', requiresEngine: [], updatedAt: 'x' });
    await cache.putEntry({ ...entryFor('Giant Growth'), review: 'unreviewed' }, { promptVersion: 1, model: 'm', requiresEngine: [], updatedAt: 'x' });
    const out = await tempDir();
    const o = io();
    const code = await packCommand('build-pack', ['--out', out, '--overrides', path.join(out, 'none'), '--pack-version', '2026.10.12-7'], o, {
      cards: [fixture('Lightning Bolt'), fixture('Giant Growth')], compiledDir, now: () => NOW,
    });
    expect(code).toBe(0);
    expect(o.lines[0]).toMatch(/pack 2026.10.12-7, 1 card entries/);
    const manifest = JSON.parse(await readFile(path.join(out, MANIFEST_FILE), 'utf8')) as { sha256: string };
    const { sha256 } = await import('../../src/pack/install');
    expect(sha256(await readFile(path.join(out, PACK_FILE)))).toBe(manifest.sha256);
  });
  it('override files are read like every text file of the tool (UTF-8 BOM); a broken one is reported by name and skipped, never fatal', async () => {
    const overrides = await tempDir();
    const hand = { ...entryFor('Lightning Bolt'), source: 'hand' };
    await writeFile(path.join(overrides, 'bolt.json'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify([hand]))]));
    await writeFile(path.join(overrides, 'broken.json'), '[{"oracleId": ');
    const out = await tempDir();
    const o = io();
    const code = await packCommand('build-pack', ['--out', out, '--overrides', overrides, '--pack-version', 'bom-1'], o, { cards: [fixture('Lightning Bolt')], compiledDir: await tempDir(), now: () => NOW });
    expect(code).toBe(0);
    const text = o.lines.join('\n');
    expect(text).toMatch(/pack bom-1, 1 card entries/);
    expect(text).toMatch(/excluded override file .*broken\.json: /);
  });
});
