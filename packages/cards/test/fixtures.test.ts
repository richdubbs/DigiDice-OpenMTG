import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CardDatabase } from '../src/database';
import { buildFixture, generateFixtures, parseCardList, readCardLists } from '../src/fixtures';
import { defaultFixturesDir } from '../src/paths';
import { card, tempDir } from './helpers';

const names = (text: string) => parseCardList(text).map((n) => n.name);

describe('parseCardList', () => {
  it('ignores blank lines, comments and trailing comments, and strips a BOM', () => {
    const list = parseCardList('﻿# heading\n\nLightning Bolt\r\n  Fire // Ice  # split card\n#another\nCounterspell\n', 'x.txt');
    expect(list).toEqual([
      { name: 'Lightning Bolt', file: 'x.txt', line: 3 },
      { name: 'Fire // Ice', file: 'x.txt', line: 4 },
      { name: 'Counterspell', file: 'x.txt', line: 6 },
    ]);
    expect(names('')).toEqual([]);
  });
});

const spirit = (id: string, creator?: string) => card('Spirit', { oracle_id: id, type_line: 'Token Creature — Spirit', all_parts: creator ? [{ component: 'combo_piece', name: creator }] : undefined });
const fireIce = card('Fire // Ice', { layout: 'split', card_faces: [{ name: 'Fire' }, { name: 'Ice' }], set_type: 'expansion', color_identity: ['R', 'U'] });

describe('buildFixture', () => {
  it('rejects face aliases, unknown names and wrong spellings, and suggests the full name', () => {
    const db = CardDatabase.fromCards([fireIce, card('Lightning Bolt'), card("Smuggler's Copter")]);
    const r = buildFixture(db, parseCardList('Fire\nLightning Bolt\nLightning Blot\nSmugglers Copter\nlightning bolt\n'));
    expect(r.problems.map((p) => [p.name, p.message, p.line])).toEqual([
      ['Fire', 'use the full Scryfall name "Fire // Ice"', 1],
      ['Lightning Blot', 'unknown card name', 3],
      ['Smugglers Copter', `use the full Scryfall name "Smuggler's Copter"`, 4],
    ]); // a different case alone is accepted; the card is written under its real name
    expect(r.problems[1]!.suggestions).toContain('Lightning Bolt');
  });

  it('writes cards sorted by name, deduplicated, with rules fields only', () => {
    const db = CardDatabase.fromCards([card('Zebra'), fireIce, card('Alpha')]);
    const r = buildFixture(db, parseCardList('Zebra\nFire // Ice\nAlpha\nZebra\n'));
    expect(r.problems).toEqual([]);
    expect(r.fixture.cards.map((c) => c.name)).toEqual(['Alpha', 'Fire // Ice', 'Zebra']);
    const fi = r.fixture.cards[1]!;
    expect(fi).not.toHaveProperty('image_uris');
    expect(fi).not.toHaveProperty('set_type');
    // M11-4 (m11 design D5): the color identity is a rules field (CR 903.4) the compiler copies into CardDef.colorIdentity, so fixtures keep it
    expect(fi.color_identity).toEqual(['R', 'U']);
    expect(fi.card_faces).toEqual([{ name: 'Fire' }, { name: 'Ice' }]);
  });

  it('picks the token variant that names the card as its creator, and keeps only the creator link', () => {
    const doomed = card('Doomed Traveler', { all_parts: [{ component: 'token', name: 'Spirit', type_line: 'Token Creature — Spirit' }, { component: 'self', name: 'Doomed Traveler' }] });
    const db = CardDatabase.fromCards([doomed], {
      tokens: [spirit('b', 'Strife Scholar // Awaken the Ages'), spirit('a', 'Doomed Traveler'), spirit('c')],
    });
    const r = buildFixture(db, parseCardList('Doomed Traveler'));
    expect(r.warnings).toEqual([]);
    expect(r.fixture.tokens.map((t) => t.oracle_id)).toEqual(['a']);
    expect(r.fixture.tokens[0]!.all_parts).toEqual([{ component: 'combo_piece', name: 'Doomed Traveler' }]);
  });

  it('falls back to every variant of the token name when none records the creator, and warns when there is none', () => {
    const maker = card('Maker', { all_parts: [{ component: 'token', name: 'Spirit', type_line: 'Token Creature — Spirit' }, { component: 'token', name: 'Ghost', type_line: 'Token Creature — Ghost' }] });
    const db = CardDatabase.fromCards([maker], { tokens: [spirit('b'), spirit('a')] });
    const r = buildFixture(db, parseCardList('Maker'));
    expect(r.fixture.tokens.map((t) => t.oracle_id)).toEqual(['a', 'b']); // sorted by name, then oracle_id
    expect(r.warnings).toEqual(['Maker: token "Ghost" (Token Creature — Ghost) is not in the token index']);
    expect(r.fixture.tokens.every((t) => t.all_parts === undefined)).toBe(true);
  });
});

describe('generateFixtures', () => {
  it('reads every *.txt in the directory (sorted) and writes cards.json', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'b.txt'), 'Beta\n');
    await writeFile(path.join(dir, 'a.txt'), '# first\nAlpha\n');
    await writeFile(path.join(dir, 'notes.md'), 'Not a list');
    const db = CardDatabase.fromCards([card('Alpha'), card('Beta')]);
    const r = await generateFixtures(db, dir);
    expect(r.listFiles).toEqual(['a.txt', 'b.txt']);
    const written = JSON.parse(await readFile(path.join(dir, 'cards.json'), 'utf8')) as { cards: Array<{ name: string }>; tokens: unknown[] };
    expect(written.cards.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
    // Deterministic output: a second run gives the same bytes.
    const first = await readFile(path.join(dir, 'cards.json'), 'utf8');
    await generateFixtures(db, dir);
    expect(await readFile(path.join(dir, 'cards.json'), 'utf8')).toBe(first);
  });

  it('writes nothing when a name is unknown, and leaves an existing cards.json alone', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'a.txt'), 'Alpha\nMissing Card\n');
    const db = CardDatabase.fromCards([card('Alpha')]);
    const r = await generateFixtures(db, dir);
    expect(r.problems).toHaveLength(1);
    await expect(readFile(path.join(dir, 'cards.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(path.join(dir, 'cards.json'), '{"keep":true}');
    await generateFixtures(db, dir);
    expect(await readFile(path.join(dir, 'cards.json'), 'utf8')).toBe('{"keep":true}');
  });

  it('fails when the lists are empty', async () => {
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'a.txt'), '# nothing\n');
    await expect(generateFixtures(CardDatabase.fromCards([]), dir)).rejects.toThrow(/No card names/);
  });
});

describe('the committed engine fixture', () => {
  it('lists exactly the cards in cards.json (the .txt lists and the generated file agree)', async () => {
    const dir = defaultFixturesDir();
    const { names: listed } = await readCardLists(dir);
    const fixture = JSON.parse(await readFile(path.join(dir, 'cards.json'), 'utf8')) as { cards: Array<{ name: string }> };
    const fromList = [...new Set(listed.map((l) => l.name))].sort();
    const fromJson = fixture.cards.map((c) => c.name).sort();
    expect(fromJson).toEqual(fromList);
    expect(listed.length).toBe(fromList.length); // no duplicate lines in the lists
  });
});
