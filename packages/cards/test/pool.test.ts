/**
 * WP24 (design 12, docs/design/decks-and-formats.md): legalities kept in the local index, the opt-in --include-unsanctioned index, the decklist stub hook
 * and image-name resolution. No network: every Scryfall object is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGame, imageSlots, tokenDefFor, type CardDef, type OracleCard } from '@openmtg/engine';
import { refreshBulk, readMeta } from '../src/bulk';
import { main, type Io } from '../src/commands';
import { compileCardsSafe } from '../src/compile';
import { CardDatabase } from '../src/database';
import { matchImageName, tokenVariantsFor } from '../src/images';
import { buildIndexData, INDEX_SCHEMA, readIndexFiles, type IndexOptions } from '../src/index-store';
import { isUnsanctioned, legalitiesOf, legalityIn } from '../src/legalities';
import { cacheFiles } from '../src/paths';
import { compileDeckWithStubs } from '../src/stubs';
import { clientWith, fakeClock, json, makeCache, rawCard, tempDir } from './helpers';

/** Scryfall's legalities object as the bulk file has it (23 formats, 2026-10). */
const LEGALITIES = {
  standard: 'not_legal', future: 'not_legal', historic: 'legal', timeless: 'legal', gladiator: 'legal', pioneer: 'not_legal', modern: 'legal', legacy: 'legal',
  pauper: 'legal', vintage: 'restricted', penny: 'not_legal', commander: 'legal', oathbreaker: 'legal', standardbrawl: 'not_legal', brawl: 'legal',
  competitivebrawl: 'legal', alchemy: 'not_legal', paupercommander: 'legal', duel: 'legal', oldschool: 'not_legal', premodern: 'not_legal', predh: 'legal',
  tlr: 'banned',
} as const;

const NOT_LEGAL = Object.fromEntries(Object.keys(LEGALITIES).map((k) => [k, 'not_legal']));

const raws = () => [
  rawCard('Lightning Bolt', { legalities: LEGALITIES }),
  rawCard('Fire // Ice', {
    layout: 'split', mana_cost: '{1}{R} // {1}{U}',
    card_faces: [{ name: 'Fire', mana_cost: '{1}{R}', type_line: 'Instant', oracle_text: 'Fire deals 2 damage divided as you choose among one or two targets.' }, { name: 'Ice', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Tap target permanent.\nDraw a card.' }],
  }),
  rawCard('Spirit', { layout: 'token', type_line: 'Token Creature — Spirit', oracle_text: 'Flying', power: '1', toughness: '1', colors: ['W'], set_type: 'token', oracle_id: 'tok1', legalities: NOT_LEGAL }),
  rawCard('Spirit', { layout: 'token', type_line: 'Token Creature — Spirit', oracle_text: '', power: '2', toughness: '2', colors: ['R', 'W'], set_type: 'token', oracle_id: 'tok2' }),
  rawCard('Treasure', { layout: 'token', type_line: 'Token Artifact — Treasure', oracle_text: '{T}, Sacrifice this token: Add one mana of any color.', colors: [], set_type: 'token' }),
  rawCard('Lightning Bolt // Lightning Bolt', { layout: 'art_series', type_line: 'Card // Card' }),
  rawCard('Wall of Fortune', { set_type: 'funny', border_color: 'silver', type_line: 'Creature — Wall', oracle_text: 'Defender', power: '0', toughness: '4', legalities: NOT_LEGAL }),
  rawCard('Acorn Thing', { set_type: 'funny', border_color: 'black', security_stamp: 'acorn', type_line: 'Instant', oracle_text: 'Draw a card.' }),
  rawCard('Deck Type Card', { layout: 'front_card', set_type: 'memorabilia' }),
];

const build = (options?: IndexOptions) => buildIndexData(Readable.from(raws().map((r) => JSON.stringify(r))), 'jsonl.gz', options);

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), readStdin: async () => '' };
  return { io, out, err };
}

describe('WP24 legalities in the local index (decks-and-formats.md: format validation, milestone 7)', () => {
  it('round trip: Scryfall legalities -> trimmed index card -> cards.jsonl on disk -> lookup', async () => {
    const dir = await tempDir();
    await makeCache(dir, raws());
    const index = await readIndexFiles(cacheFiles(dir));
    const bolt = index.get('lightning bolt');
    expect(legalitiesOf(bolt)).toEqual(LEGALITIES);
    expect(Object.keys(legalitiesOf(bolt)!)).toEqual(Object.keys(LEGALITIES)); // Scryfall's order kept
    expect(legalityIn(bolt, 'Modern')).toBe('legal');
    expect(legalityIn(bolt, 'vintage')).toBe('restricted');
    expect(legalityIn(bolt, 'tlr')).toBe('banned');
    expect(legalityIn(bolt, 'no-such-format')).toBeUndefined();
    const db = await CardDatabase.open({ cacheDir: dir });
    expect(legalitiesOf(db.lookup('Lightning Bolt'))).toEqual(LEGALITIES);
  });

  it('keeps only known values; tokens keep no legalities', async () => {
    const built = await buildIndexData(Readable.from([JSON.stringify(rawCard('Odd', { legalities: { modern: 'legal', weird: 'maybe', standard: 3, '': 'legal' } }))]), 'jsonl.gz');
    expect(legalitiesOf(built.cards[0])).toEqual({ modern: 'legal' });
    expect((await build()).tokens.every((t) => !('legalities' in t))).toBe(true);
  });

  it('a card cached before WP24 (no legalities) reads as "no data", never as "not legal"', () => {
    const old: OracleCard = { name: 'Old', layout: 'normal' };
    expect(legalitiesOf(old)).toBeUndefined();
    expect(legalityIn(old, 'modern')).toBeUndefined();
  });
});

describe('WP24 the default index is unchanged apart from legalities (and the CR 100.7 flags, see the review block below)', () => {
  it('same cards, tokens, fields and stats as milestone 2 defined; legalities and each picture artist (2026-10-14) are the only new keys', async () => {
    const built = await build();
    expect(built.cards.map((c) => c.name)).toEqual(['Fire // Ice', 'Lightning Bolt']);
    expect(built.tokens.map((c) => c.name)).toEqual(['Spirit', 'Spirit', 'Treasure']);
    // The stats object has exactly the milestone 2 keys (no `includedUnsanctioned` in a default index).
    expect(built.stats).toEqual({ schema: INDEX_SCHEMA, lines: 9, parseErrors: 0, cards: 2, tokenVariants: 3, excludedArtSeries: 1, excludedFrontCard: 1, excludedFunny: 2 });
    const bolt = built.cards[1]!;
    expect(Object.keys(bolt)).toEqual(['oracle_id', 'name', 'layout', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'colors', 'color_identity', 'keywords', 'set_type', 'border_color', 'legalities', 'image_uris', 'artist']);
    expect(built.cards.some((c) => 'unsanctioned' in c)).toBe(false);
  });

  it('the opt-in index is the default index plus the unsanctioned cards, nothing else changes', async () => {
    const plain = await build();
    const wide = await build({ includeUnsanctioned: true });
    expect(wide.cards.filter((c) => !isUnsanctioned(c))).toEqual(plain.cards);
    expect(wide.tokens).toEqual(plain.tokens);
    expect(wide.stats).toEqual({ ...plain.stats, cards: 4, excludedFunny: 0, includedUnsanctioned: 2 });
  });
});

describe('WP24 --include-unsanctioned (design 12.3)', () => {
  it('keeps silver-border and acorn cards flagged unsanctioned, with their legalities', async () => {
    const wide = await build({ includeUnsanctioned: true });
    const funny = wide.cards.filter(isUnsanctioned).map((c) => c.name);
    expect(funny).toEqual(['Acorn Thing', 'Wall of Fortune']);
    expect(legalityIn(wide.cards.find((c) => c.name === 'Wall of Fortune'), 'commander')).toBe('not_legal');
  });

  it('an unsanctioned card compiles manual-only and flagged, whatever the compiler understood', async () => {
    const wide = await build({ includeUnsanctioned: true });
    const { defs, failures } = compileCardsSafe(wide.cards);
    expect(failures).toEqual([]);
    const acorn = defs.find((d) => d.name === 'Acorn Thing')!;
    expect(acorn.unsanctioned).toBe(true);
    expect(acorn.automation.level).toBe('manual');
    expect(acorn.faces[0]!.abilities.every((a) => a.kind === 'manual')).toBe(true);
    expect(defs.find((d) => d.name === 'Lightning Bolt')!.unsanctioned).toBeUndefined();
  });

  it('a silver-border card fetched by name (one-off lookup) is flagged too', async () => {
    const { trimCard } = await import('../src/trim');
    expect(isUnsanctioned(trimCard(rawCard('Silver Thing', { border_color: 'silver' })))).toBe(true);
    expect(isUnsanctioned(trimCard(rawCard('Black Thing')))).toBe(false);
  });

  it('recognizable in decklists only in the opt-in index', async () => {
    const plain = CardDatabase.fromCards((await build()).cards);
    const wide = CardDatabase.fromCards((await build({ includeUnsanctioned: true })).cards);
    expect((await plain.resolveDecklist('1 Wall of Fortune')).unknown.map((u) => u.name)).toEqual(['Wall of Fortune']);
    expect((await wide.resolveDecklist('1 Wall of Fortune')).main.map((e) => e.card.name)).toEqual(['Wall of Fortune']);
  });

  it('refresh: an index built with other options is rebuilt from the cached file, without network; the default comes back without the flag', async () => {
    const dir = await tempDir();
    await makeCache(dir, raws()); // downloaded 2026-01-01T00:00:00Z
    const clock = fakeClock(Date.parse('2026-01-01T02:00:00Z'));
    const { client, calls } = clientWith(() => json({ code: 'no network in this test' }, 500), clock);
    const files = cacheFiles(dir);

    const r1 = await refreshBulk({ client, cacheDir: dir, clock, index: { includeUnsanctioned: true } });
    expect(r1.action).toBe('rebuilt');
    expect((await readMeta(files))!.index!.includedUnsanctioned).toBe(2);
    expect((await readIndexFiles(files)).get('Wall of Fortune')).toBeDefined();

    const r2 = await refreshBulk({ client, cacheDir: dir, clock, index: { includeUnsanctioned: true } });
    expect(r2.action).toBe('skipped');

    const r3 = await refreshBulk({ client, cacheDir: dir, clock });
    expect(r3.action).toBe('rebuilt');
    expect((await readMeta(files))!.index!.includedUnsanctioned).toBeUndefined();
    expect((await readIndexFiles(files)).get('Wall of Fortune')).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('cli: refresh --reindex --include-unsanctioned, and stats reports the kept cards', async () => {
    const saved = process.env.OPENMTG_CACHE_DIR;
    const dir = await tempDir();
    process.env.OPENMTG_CACHE_DIR = dir;
    try {
      await makeCache(dir, raws());
      const r = makeIo();
      expect(await main(['refresh', '--reindex', '--include-unsanctioned'], r.io)).toBe(0);
      expect(r.out.join('\n')).toMatch(/Index: 4 cards/);
      const s = makeIo();
      expect(await main(['stats'], s.io)).toBe(0);
      expect(s.out.join('\n')).toMatch(/0 silver-border\/acorn \(2 kept as unsanctioned\)/);
      expect(s.out.join('\n')).toMatch(new RegExp(`Index schema ${INDEX_SCHEMA};`));
    } finally {
      if (saved === undefined) delete process.env.OPENMTG_CACHE_DIR;
      else process.env.OPENMTG_CACHE_DIR = saved;
    }
  });
});

describe('WP24 decklist stub hook (contract C4)', () => {
  const deckText = ['4 Lightning Bolt', '2 Brand New Card', '1 brand new card', '1 Unconfirmed Thing', '', 'Sideboard', '3 Brand New Card'].join('\n');

  it('resolveDecklist still reports unknown names, and lists them per section with counts', async () => {
    const db = CardDatabase.fromCards((await build()).cards);
    const d = await db.resolveDecklist(deckText);
    expect(d.unknown.map((u) => u.name)).toEqual(['Brand New Card', 'brand new card', 'Unconfirmed Thing']);
    expect(d.unresolved).toEqual([
      { section: 'main', name: 'Brand New Card', count: 2 },
      { section: 'main', name: 'brand new card', count: 1 },
      { section: 'main', name: 'Unconfirmed Thing', count: 1 },
      { section: 'sideboard', name: 'Brand New Card', count: 3 },
    ]);
  });

  it('confirmed names become one stub each (spellings merged), with their counts; the rest is skipped', async () => {
    const db = CardDatabase.fromCards((await build()).cards);
    const d = await db.resolveDecklist(deckText);
    const deck = compileDeckWithStubs(d, new Set(['Brand New Card', 'brand new card']));
    expect(deck.stubs.map((s) => [s.id, s.stub])).toEqual([['stub:Brand New Card', { origin: 'decklist' }]]);
    expect(deck.main.filter((id) => id === 'stub:Brand New Card')).toHaveLength(3);
    expect(deck.main.filter((id) => id === 'Lightning Bolt')).toHaveLength(4);
    expect(deck.sideboard).toEqual(['stub:Brand New Card', 'stub:Brand New Card', 'stub:Brand New Card']);
    expect(deck.skipped.map((u) => u.name)).toEqual(['Unconfirmed Thing']);
    expect(deck.defs.map((x) => x.id).sort()).toEqual(['Lightning Bolt', 'stub:Brand New Card']);
  });

  it('a face name several cards share is never stubbed (the player picks the full name)', async () => {
    const twins = ['A', 'B'].map((x) => rawCard(`${x} Front // Shared Back`, { layout: 'transform', card_faces: [{ name: `${x} Front` }, { name: 'Shared Back' }] }));
    const built = await buildIndexData(Readable.from(twins.map((r) => JSON.stringify(r))), 'jsonl.gz');
    const d = await CardDatabase.fromCards(built.cards).resolveDecklist('1 Shared Back');
    const deck = compileDeckWithStubs(d, () => true);
    expect(deck.stubs).toEqual([]);
    expect(deck.skipped[0]!.ambiguous).toBeDefined();
  });

  it('a deck with stubs starts a game (the stub is a playable definition)', async () => {
    const db = CardDatabase.fromCards((await build()).cards);
    const d = await db.resolveDecklist(['56 Lightning Bolt', '4 Brand New Card'].join('\n'));
    const deck = compileDeckWithStubs(d, () => true);
    const s = createGame({ seed: 'wp24', players: [{ name: 'A', deck: deck.main }, { name: 'B', deck: deck.main }], defs: deck.defs, options: { skipMulligans: true } });
    expect(s.defs['stub:Brand New Card']!.stub).toEqual({ origin: 'decklist' });
    expect(Object.values(s.objects).filter((o) => o.defId === 'stub:Brand New Card')).toHaveLength(8);
  });
});

describe('WP24 image names (design 12.2)', () => {
  const db = async () => {
    const b = await build();
    return CardDatabase.fromCards(b.cards, { tokens: b.tokens });
  };

  it('a face name of a split card binds to the card\'s one picture', async () => {
    expect((await db()).lookup('Ice')).toBeDefined();
    expect(matchImageName(await db(), 'Ice')).toEqual([{ key: 'Fire // Ice', label: 'Fire // Ice', card: 'Fire // Ice', via: 'card' }]);
  });

  it('a token name gives every variant; a full token slot key gives exactly one', async () => {
    const all = matchImageName(await db(), 'Spirit');
    expect(all.map((m) => m.key).sort()).toEqual(['Spirit (1/1 W Creature — Spirit; Flying)', 'Spirit (2/2 WR Creature — Spirit)']);
    expect(matchImageName(await db(), 'Spirit (1/1 W Creature — Spirit; Flying)').map((m) => m.key)).toEqual(['Spirit (1/1 W Creature — Spirit; Flying)']);
  });

  it('an Art Series name resolves to the card it depicts (Art Series cards are not in the index)', async () => {
    expect((await db()).lookup('Lightning Bolt // Lightning Bolt')).toBeUndefined();
    expect(matchImageName(await db(), 'Lightning Bolt // Lightning Bolt')).toEqual([{ key: 'Lightning Bolt', label: 'Lightning Bolt', card: 'Lightning Bolt', via: 'artSeries' }]);
  });

  it('an unknown name matches nothing (the client may offer a stub, whose slot is the name as given)', async () => {
    expect(matchImageName(await db(), 'Brand New Card')).toEqual([]);
    expect(matchImageName(await db(), '   ')).toEqual([]);
  });

  it('a card the engine cannot compile (an unknown mana symbol) still gets its image slots (contract C3)', async () => {
    const odd = await buildIndexData(Readable.from([JSON.stringify(rawCard('Little Odd // Other Side', {
      layout: 'transform', mana_cost: '{HW}', card_faces: [{ name: 'Little Odd', mana_cost: '{HW}' }, { name: 'Other Side' }],
    }))]), 'jsonl.gz');
    const db = CardDatabase.fromCards(odd.cards);
    expect(matchImageName(db, 'Other Side')).toEqual([{ key: 'Other Side', label: 'Other Side (back)', card: 'Little Odd // Other Side', via: 'card' }]);
  });

  it('token variant lookup: the predefined Treasure (CR 111.10a) finds the index\'s Treasure token', async () => {
    const treasure = tokenDefFor('Treasure') as CardDef;
    const found = tokenVariantsFor(await db(), treasure);
    expect(found.map((t) => t.name)).toEqual(['Treasure']);
    expect(imageSlots(treasure)[0]!.key).toBe('Treasure (C Artifact — Treasure; {T}, Sacrifice this token: Add one mana of any color.)');
  });

  it('CR 111.10: the predefined Map ("Sacrifice this token") finds the printed Map ("this artifact", explore reminder text)', async () => {
    const map = rawCard('Map', {
      layout: 'token', set_type: 'token', type_line: 'Token Artifact — Map', colors: [],
      oracle_text: '{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery. (Reveal the top card of your library. Put that card into your hand if it\'s a land. Otherwise, put a +1/+1 counter on that creature, then put the card back or put it into your graveyard.)',
    });
    const b = await buildIndexData(Readable.from([JSON.stringify(map)]), 'jsonl.gz');
    expect(tokenVariantsFor(CardDatabase.fromCards([], { tokens: b.tokens }), tokenDefFor('Map')!).map((t) => t.name)).toEqual(['Map']);
  });

  it('CR 111.10i: the predefined Incubator (a double-faced token) finds the printed Incubator // Phyrexian', async () => {
    const incubator = rawCard('Incubator // Phyrexian', {
      layout: 'double_faced_token', set_type: 'token', type_line: 'Token Artifact — Incubator // Token Artifact Creature — Phyrexian',
      card_faces: [
        { name: 'Incubator', mana_cost: '', type_line: 'Token Artifact — Incubator', oracle_text: '{2}: Transform this artifact.', colors: [] },
        { name: 'Phyrexian', mana_cost: '', type_line: 'Token Artifact Creature — Phyrexian', oracle_text: '', power: '0', toughness: '0', colors: [] },
      ],
    });
    const b = await buildIndexData(Readable.from([JSON.stringify(incubator)]), 'jsonl.gz');
    expect(tokenVariantsFor(CardDatabase.fromCards([], { tokens: b.tokens }), tokenDefFor('Incubator')!).map((t) => t.name)).toEqual(['Incubator // Phyrexian']);
  });

  it('an Art Series name showing a token resolves to that token\'s variants ("Spirit // Spirit")', async () => {
    const m = matchImageName(await db(), 'Spirit // Spirit');
    expect(m.map((x) => [x.key, x.via]).sort()).toEqual([['Spirit (1/1 W Creature — Spirit; Flying)', 'artSeries'], ['Spirit (2/2 WR Creature — Spirit)', 'artSeries']]);
  });
});

describe('WP24 review: casual-play cards (CR 100.7) and same-name variants', () => {
  /** Mystery Booster 2 playtest card: black border, promo_types playtest, listed before the real card (as in the bulk file). */
  const playtestPoison = rawCard('Pick Your Poison', { set: 'cmb2', collector_number: '97', set_type: 'funny', promo_types: ['playtest'], oracle_text: 'Choose any number of modes that total exactly 4.', legalities: NOT_LEGAL });
  const realPoison = rawCard('Pick Your Poison', { set: 'mkm', collector_number: '170', oracle_text: 'Choose one —\n• Each opponent sacrifices an artifact.', legalities: LEGALITIES });
  const split = (set: string, extra: Record<string, unknown>) => rawCard('Fast // Furious', {
    layout: 'split', set, oracle_text: undefined, card_faces: [{ name: 'Fast', mana_cost: '{2}{R}', type_line: 'Instant', oracle_text: set === 'unk' ? 'Target creature gains haste.' : 'Fast text.' }, { name: 'Furious', mana_cost: '{3}{R}{R}', type_line: 'Sorcery', oracle_text: 'Furious text.' }], ...extra,
  });
  const playtestFast = split('unk', { collector_number: 'CR15a', set_type: 'funny', promo_types: ['playtest'], legalities: NOT_LEGAL });
  const realFast = split('mh2', { collector_number: '123', legalities: LEGALITIES });
  const garbage = ['82a', '82b', '82c'].map((n, i) => rawCard('Garbage Elemental', { set: 'ust', collector_number: n, set_type: 'funny', border_color: 'silver', oracle_text: `Variant ${i}.`, type_line: 'Creature — Elemental', power: String(i + 1), toughness: '3', legalities: NOT_LEGAL }));
  const buildFrom = (rs: Array<Record<string, unknown>>, options?: IndexOptions) => buildIndexData(Readable.from(rs.map((r) => JSON.stringify(r))), 'jsonl.gz', options);

  it('CR 100.7: a Mystery Booster playtest card never hides the tournament card of the same name (default index)', async () => {
    const built = await buildFrom([playtestPoison, realPoison, playtestFast, realFast]);
    const db = CardDatabase.fromCards(built.cards);
    expect(db.lookup('Pick Your Poison')!.oracle_text).toMatch(/^Choose one/);
    expect(db.lookup('Fast // Furious')!.card_faces![0]!.oracle_text).toBe('Fast text.');
    expect(db.lookup('Fast')!.card_faces![0]!.oracle_text).toBe('Fast text.');
    const d = await db.resolveDecklist('4 Pick Your Poison\n2 Fast // Furious');
    expect(d.main.map((e) => [e.count, e.card.oracle_text ?? e.card.card_faces![0]!.oracle_text])).toEqual([[4, realPoison.oracle_text], [2, 'Fast text.']]);
    // The playtest versions are kept, flagged, under a name of their own.
    const pt = db.lookup('Pick Your Poison (CMB2 97)')!;
    expect(pt.oracle_text).toBe(playtestPoison.oracle_text);
    expect(isUnsanctioned(pt)).toBe(true);
    expect(isUnsanctioned(db.lookup('Fast // Furious (UNK CR15a)'))).toBe(true);
  });

  it('CR 100.7: a playtest card is flagged unsanctioned and compiles manual-only, also when it shares no name', async () => {
    const lone = rawCard('Biting Remark', { set: 'unk', collector_number: '1', set_type: 'funny', promo_types: ['playtest'], oracle_text: 'Biting Remark deals 3 damage to any target.', legalities: NOT_LEGAL });
    const built = await buildFrom([lone]);
    expect(built.cards.map((c) => c.name)).toEqual(['Biting Remark']);
    expect(isUnsanctioned(built.cards[0])).toBe(true);
    const { defs } = compileCardsSafe(built.cards);
    expect(defs[0]!.unsanctioned).toBe(true);
    expect(defs[0]!.automation.level).toBe('manual');
  });

  it('CR 201.2: same-name Unstable variants are distinct cards; the bare name is ambiguous, never silently the first variant', async () => {
    const built = await buildFrom(garbage, { includeUnsanctioned: true });
    expect(built.cards.map((c) => c.name)).toEqual(['Garbage Elemental (UST 82a)', 'Garbage Elemental (UST 82b)', 'Garbage Elemental (UST 82c)']);
    expect(built.stats.unsanctionedVariants).toBe(3);
    const db = CardDatabase.fromCards(built.cards);
    expect(db.lookup('Garbage Elemental')).toBeUndefined();
    const d = await db.resolveDecklist('4 Garbage Elemental');
    expect(d.main).toEqual([]);
    expect(d.unknown[0]!.ambiguous).toEqual(['Garbage Elemental (UST 82a)', 'Garbage Elemental (UST 82b)', 'Garbage Elemental (UST 82c)']);
    expect((await db.resolveDecklist('4 Garbage Elemental (UST 82b)')).main.map((e) => e.card.power)).toEqual(['2']);
    // Each variant has its own definition and its own image slot.
    const { defs } = compileCardsSafe(built.cards);
    expect(defs.map((x) => x.id)).toHaveLength(3);
    expect(new Set(built.cards.flatMap((c) => matchImageName(db, c.name).map((m) => m.key))).size).toBe(3);
  });

  it('a silver-border card cached by a one-off lookup before WP24 (no flag) is still unsanctioned', () => {
    const old: OracleCard = { name: 'Chicken à la King', layout: 'normal', type_line: 'Creature — Bird', oracle_text: 'Whenever a 6 is rolled, put a +1/+1 counter on each Bird.', power: '2', toughness: '2', set_type: 'funny', border_color: 'silver' };
    expect(isUnsanctioned(old)).toBe(true);
    expect(compileCardsSafe([old]).defs[0]!.unsanctioned).toBe(true);
    // An acorn card cached before WP24: black border, set_type funny and no legalities (every card fetched since WP24 has them): manual, to be safe.
    expect(isUnsanctioned({ name: 'Old Acorn', layout: 'normal', set_type: 'funny', border_color: 'black' })).toBe(true);
    expect(isUnsanctioned({ name: 'New Legal Unfinity', layout: 'normal', set_type: 'funny', border_color: 'black', legalities: { legacy: 'legal' } } as OracleCard)).toBe(false);
  });

  it('refresh: an index built before legalities were kept (older schema) is rebuilt from the cached file, without network', async () => {
    const dir = await tempDir();
    await makeCache(dir, raws());
    const files = cacheFiles(dir);
    const meta = (await readMeta(files))!;
    expect(meta.index!.schema).toBe(INDEX_SCHEMA);
    const { schema: _schema, ...oldStats } = meta.index!;
    await writeFile(files.meta, JSON.stringify({ ...meta, index: oldStats }));
    const clock = fakeClock(Date.parse('2026-01-01T02:00:00Z'));
    const { client, calls } = clientWith(() => json({ code: 'no network in this test' }, 500), clock);
    const r = await refreshBulk({ client, cacheDir: dir, clock });
    expect(r.action).toBe('rebuilt');
    expect((await readMeta(files))!.index!.schema).toBe(INDEX_SCHEMA);
    expect(calls).toEqual([]);
    const later = fakeClock(Date.parse('2026-03-01T00:00:00Z'));
    const up = clientWith(() => json({ data: [{ type: 'oracle_cards', updated_at: '2026-01-01T00:00:00Z', jsonl_download_uri: 'https://x/y.jsonl.gz' }] }), later);
    await writeFile(files.meta, JSON.stringify({ ...meta, index: oldStats }));
    expect((await refreshBulk({ client: up.client, cacheDir: dir, clock: later })).action).toBe('rebuilt');
  });
});
