/** `npm run cards -- deck <file> --format <fmt>` on a synthetic cache (no network). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { main, USAGE, type Io } from '../src/commands';
import { makeCache, rawCard, tempDir } from './helpers';

function makeIo(stdin = '') {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), readStdin: async () => stdin };
  return { io, out, err };
}

const legal = { standard: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal', commander: 'legal', duel: 'legal' };

let saved: string | undefined;
let dir: string;
beforeEach(async () => {
  saved = process.env.OPENMTG_CACHE_DIR;
  dir = await tempDir();
  process.env.OPENMTG_CACHE_DIR = dir;
  await makeCache(dir, [
    rawCard('Lightning Bolt', { legalities: { ...legal, standard: 'not_legal' } }),
    rawCard('Mountain', { type_line: 'Basic Land — Mountain', mana_cost: '', legalities: legal }),
    rawCard('Black Lotus', { legalities: { ...legal, modern: 'not_legal', legacy: 'banned', vintage: 'restricted' } }),
    rawCard('Krenko, Mob Boss', { type_line: 'Legendary Creature — Goblin Warrior', legalities: legal }),
  ]);
});
afterEach(() => {
  if (saved === undefined) delete process.env.OPENMTG_CACHE_DIR;
  else process.env.OPENMTG_CACHE_DIR = saved;
});

async function deckFile(text: string): Promise<string> {
  const f = path.join(dir, 'deck.txt');
  await writeFile(f, text);
  return f;
}

describe('cli: deck --format', () => {
  it('prints "legal" and exits 0 for a legal Modern deck', async () => {
    const f = await deckFile('4 Lightning Bolt\n56 Mountain\n');
    const { io, out } = makeIo();
    expect(await main(['deck', f, '--no-fetch', '--format', 'modern'], io)).toBe(0);
    expect(out.join('\n')).toContain('Format Modern: legal; 60 main, 0 sideboard.');
  });

  it('lists each problem with its rule and exits 1 when the deck is not legal', async () => {
    const f = await deckFile('4 Lightning Bolt\n50 Mountain\n2 Black Lotus\n');
    const { io, out } = makeIo();
    expect(await main(['deck', f, '--no-fetch', '--format=vintage'], io)).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('Format Vintage: NOT LEGAL (2 errors)');
    expect(text).toContain('ERROR [CR 100.2a] 56 cards in the main deck; Vintage needs at least 60.');
    expect(text).toMatch(/ERROR \[Vintage restricted list .*\] Black Lotus is restricted in Vintage: at most 1 copy \(2 found\)\./);
  });

  it('reads banned / not legal from the index legalities', async () => {
    const f = await deckFile('4 Lightning Bolt\n55 Mountain\n1 Black Lotus\n');
    const { io, out } = makeIo();
    expect(await main(['deck', f, '--no-fetch', '--format', 'Standard'], io)).toBe(1);
    expect(out.join('\n')).toContain('ERROR [Scryfall legalities (standard: not_legal)] Lightning Bolt is not legal in Standard.');
    const legacy = makeIo();
    expect(await main(['deck', f, '--no-fetch', '--format', 'legacy'], legacy.io)).toBe(1);
    expect(legacy.out.join('\n')).toContain('Black Lotus is banned in Legacy.');
  });

  it('checks a Commander deck (MTGO export: the commander in the sideboard)', async () => {
    const f = await deckFile('1 Lightning Bolt\n98 Mountain\n\n1 Krenko, Mob Boss\n');
    const { io, out } = makeIo();
    expect(await main(['deck', f, '--no-fetch', '--format', 'commander'], io)).toBe(0);
    expect(out.join('\n')).toContain('Format Commander: legal; 100 cards with Krenko, Mob Boss.');
    expect(out.join('\n')).toContain('NOTE [CR 903.3] Read the sideboard as the commander');
  });

  it('exits 2 for an unknown or missing format, listing the formats', async () => {
    const f = await deckFile('4 Lightning Bolt\n');
    const bad = makeIo();
    expect(await main(['deck', f, '--no-fetch', '--format', 'oathbreaker'], bad.io)).toBe(2);
    expect(bad.err.join('\n')).toMatch(/Unknown format "oathbreaker"\. Formats:[\s\S]*duel +Duel Commander/);
    const missing = makeIo();
    expect(await main(['deck', f, '--format'], missing.io)).toBe(2);
    expect(missing.err.join('\n')).toContain('Missing format name after --format');
  });

  it('documents --format in the usage text', () => {
    expect(USAGE).toContain('--format <format>');
  });
});
