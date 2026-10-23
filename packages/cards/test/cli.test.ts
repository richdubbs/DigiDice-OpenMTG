import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { main, USAGE, type Io } from '../src/commands';
import { decodeText } from '../src/text';
import { makeCache, rawCard, tempDir } from './helpers';

function makeIo(stdin = '') {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), readStdin: async () => stdin };
  return { io, out, err };
}

const suture = (front: string) => rawCard(`${front} // Seed Suture`, { layout: 'prepare', card_faces: [{ name: front, mana_cost: '{1}{G}' }, { name: 'Seed Suture', mana_cost: '{G}' }] });

let saved: string | undefined;
let dir: string;
beforeEach(async () => {
  saved = process.env.OPENMTG_CACHE_DIR;
  dir = await tempDir();
  process.env.OPENMTG_CACHE_DIR = dir;
  await makeCache(dir, [rawCard('Lightning Bolt'), rawCard('Counterspell'), rawCard("Smuggler's Copter"), suture('Vigorbloom Vanguard'), suture('Emergency Phytomedic')]);
});
afterEach(() => {
  if (saved === undefined) delete process.env.OPENMTG_CACHE_DIR;
  else process.env.OPENMTG_CACHE_DIR = saved;
});

describe('cli: lookup', () => {
  it('prints a local card and exits 0 (no network with --no-fetch)', async () => {
    const { io, out } = makeIo();
    expect(await main(['lookup', '--no-fetch', 'lightning', 'bolt'], io)).toBe(0);
    expect(out[0]).toBe('(local index)');
    expect(out.join('\n')).toContain('Lightning Bolt');
  });

  it('finds a card typed without its apostrophe', async () => {
    const { io, out } = makeIo();
    expect(await main(['lookup', '--no-fetch', 'Smugglers Copter'], io)).toBe(0);
    expect(out.join('\n')).toContain("Smuggler's Copter");
  });

  it('exits 1 with suggestions for an unknown card', async () => {
    const { io, err } = makeIo();
    expect(await main(['lookup', '--no-fetch', 'Lightening Bolt'], io)).toBe(1);
    expect(err.join('\n')).toMatch(/Unknown card "Lightening Bolt".*Did you mean: Lightning Bolt/);
  });

  it('reports an ambiguous face name with its candidates instead of picking one', async () => {
    const { io, err } = makeIo();
    expect(await main(['lookup', '--no-fetch', 'Seed Suture'], io)).toBe(1);
    expect(err.join('\n')).toMatch(/Ambiguous face name "Seed Suture".*Emergency Phytomedic \/\/ Seed Suture; Vigorbloom Vanguard \/\/ Seed Suture/);
  });

  it('exits 2 for a missing name or an unknown option', async () => {
    expect(await main(['lookup'], makeIo().io)).toBe(2);
    const bad = makeIo();
    expect(await main(['lookup', '--nope', 'x'], bad.io)).toBe(2);
    expect(bad.err.join('\n')).toMatch(/Unknown option\(s\): --nope/);
  });
});

describe('cli: deck', () => {
  it('resolves a decklist file and exits 0 when everything is known', async () => {
    const file = path.join(dir, 'deck.txt');
    await writeFile(file, '4 Lightning Bolt\n2 Counterspell\n\n1 Smugglers Copter\n');
    const { io, out, err } = makeIo();
    expect(await main(['deck', '--no-fetch', file], io)).toBe(0);
    expect(out).toEqual(['Main deck: 6 cards (2 distinct)', '  4 Lightning Bolt', '  2 Counterspell', 'Sideboard: 1 cards (1 distinct)', "  1 Smuggler's Copter"]);
    expect(err).toEqual([]);
  });

  it('exits 1 and lists unknown names, ambiguous names and parse errors', async () => {
    const file = path.join(dir, 'deck.txt');
    await writeFile(file, '4 Lightning Bolt\n2 Lightening Bolt\n1 Seed Suture\n0 Fog\n');
    const { io, out, err } = makeIo();
    expect(await main(['deck', '--no-fetch', file], io)).toBe(1);
    expect(out[0]).toBe('Main deck: 4 cards (1 distinct)');
    expect(err.join('\n')).toMatch(/Unknown card on line 2: "Lightening Bolt" \(main\)\. Did you mean: Lightning Bolt/);
    expect(err.join('\n')).toMatch(/Ambiguous face name on line 3: "Seed Suture"/);
    expect(err.join('\n')).toMatch(/Line 4: Count must be at least 1/);
  });

  it('reads a decklist from stdin with "-"', async () => {
    const { io, out } = makeIo('3 Counterspell\n');
    expect(await main(['deck', '--no-fetch', '-'], io)).toBe(0);
    expect(out[0]).toBe('Main deck: 3 cards (1 distinct)');
  });

  it('reads UTF-16 files (PowerShell 5.1 redirection, Notepad "Unicode") and UTF-8 files with a BOM', async () => {
    const text = '4 Lightning Bolt\r\n2 Counterspell\r\n';
    const utf16le = path.join(dir, 'le.txt');
    const utf16be = path.join(dir, 'be.txt');
    const utf8bom = path.join(dir, 'bom.txt');
    await writeFile(utf16le, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
    await writeFile(utf16be, Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]));
    await writeFile(utf8bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]));
    for (const file of [utf16le, utf16be, utf8bom]) {
      const { io, out, err } = makeIo();
      expect(await main(['deck', '--no-fetch', file], io), file).toBe(0);
      expect(out, file).toEqual(['Main deck: 6 cards (2 distinct)', '  4 Lightning Bolt', '  2 Counterspell']);
      expect(err, file).toEqual([]);
    }
  });

  it('fails with exit 1 for a file that does not exist, and 2 for a missing argument', async () => {
    const { io, err } = makeIo();
    expect(await main(['deck', '--no-fetch', path.join(dir, 'nope.txt')], io)).toBe(1);
    expect(err.join('\n')).toMatch(/ENOENT|no such file/i);
    expect(await main(['deck'], makeIo().io)).toBe(2);
  });
});

describe('cli: other commands', () => {
  it('stats shows the index counts, including shared face names', async () => {
    const { io, out } = makeIo();
    expect(await main(['stats'], io)).toBe(0);
    expect(out.join('\n')).toMatch(/Index: 5 cards, 3 face aliases \(1 shared by several cards\)/);
    expect(out.join('\n')).toMatch(/silver-border\/acorn/);
  });

  it('refresh --reindex rebuilds the index from the cached bulk file without network', async () => {
    const { io, out } = makeIo();
    expect(await main(['refresh', '--reindex'], io)).toBe(0);
    expect(out[0]).toMatch(/Rebuilt the index from oracle-cards\.jsonl\.gz \(no network\)/);
    expect(out[1]).toMatch(/Index: 5 cards/);
  });

  it('refresh --reindex without any bulk file fails with instructions', async () => {
    process.env.OPENMTG_CACHE_DIR = await tempDir();
    const { io, err } = makeIo();
    expect(await main(['refresh', '--reindex'], io)).toBe(1);
    expect(err.join('\n')).toMatch(/npm run cards -- refresh/);
  });

  it('lookup without any index explains how to get one', async () => {
    process.env.OPENMTG_CACHE_DIR = await tempDir();
    const { io, err } = makeIo();
    expect(await main(['lookup', 'x'], io)).toBe(1);
    expect(err.join('\n')).toMatch(/No card index/);
  });

  it('prints the usage for help (exit 0), for no command (exit 2) and for an unknown command (exit 2)', async () => {
    const help = makeIo();
    expect(await main(['help'], help.io)).toBe(0);
    expect(help.out[0]).toBe(USAGE);
    expect(await main([], makeIo().io)).toBe(2);
    const unknown = makeIo();
    expect(await main(['frobnicate'], unknown.io)).toBe(2);
    expect(unknown.err.join('\n')).toMatch(/Unknown command "frobnicate"/);
  });
});

describe('decodeText', () => {
  it('decodes UTF-8, UTF-8 with BOM, UTF-16 LE/BE with BOM and BOM-less UTF-16 LE', () => {
    expect(decodeText(Buffer.from('Æther Vial', 'utf8'))).toBe('Æther Vial');
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Æther', 'utf8')]))).toBe('Æther');
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Æther', 'utf16le')]))).toBe('Æther');
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('Æther', 'utf16le').swap16()]))).toBe('Æther');
    expect(decodeText(Buffer.from('4 Bolt', 'utf16le'))).toBe('4 Bolt');
    expect(decodeText(new Uint8Array())).toBe('');
  });
});
