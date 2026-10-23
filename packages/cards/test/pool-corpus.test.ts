/**
 * WP24 corpus checks on the local index (git-ignored; skipped when absent; set OPENMTG_CACHE_DIR in a worktree): every card has image slots with unique
 * keys and every one of its names resolves to exactly one slot (design 12.2); every token variant of the index has its own key, and the key the engine
 * gives the compiled token equals the key computed from the index object. Run by hand when WP24 was written: 34,473 cards and 1,110 token variants, no
 * problem; the default index rebuilt from the cached bulk file was identical to the milestone 2 index apart from `legalities` (cards.jsonl 25.4 -> 42.6 MB).
 * After the WP24 review (index schema 2) it also flags the 810 playtest cards (CR 100.7) and indexes the few named like another card as "Name (SET number)",
 * so they no longer hide the tournament card (Pick Your Poison, Red Herring, Fast // Furious); the token keys are written the same way for the engine's
 * tokens and the printed ones (reminder text, self-reference, comma-joined keywords), checked on every predefined token and on the inline tokens.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileCard, noAbilityCompiler, oracleTokenVariantKeys, imageSlots, tokenBaseName, tokenDefFor } from '@openmtg/engine';
import { CardDatabase } from '../src/database';
import { slotsOfCard, tokenVariantsFor } from '../src/images';
import { buildIndexData, bulkLines, readIndexFiles } from '../src/index-store';
import { isUnsanctioned } from '../src/legalities';
import { cacheFiles } from '../src/paths';
import { SLOW, slowTitle } from '../../engine/test/slow';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The cache directory holding the index: OPENMTG_CACHE_DIR, this checkout's, or (in a git worktree) the main checkout's. */
function cacheDir(): string | undefined {
  const env = process.env.OPENMTG_CACHE_DIR?.trim();
  const roots = [REPO];
  const dotGit = path.join(REPO, '.git');
  if (existsSync(dotGit) && statSync(dotGit).isFile()) { // a worktree's .git is a file; the main checkout's is a directory (W3 integration: it threw, so the corpus skipped)
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8').toString());
    if (m) roots.push(path.resolve(REPO, m[1]!.trim(), '..', '..', '..'));
  }
  const dirs = env ? [env] : roots.map((r) => path.join(r, '.cache', 'scryfall'));
  return dirs.find((d) => existsSync(cacheFiles(d).cards) && existsSync(cacheFiles(d).tokens));
}

const dir = (() => {
  try {
    return cacheDir();
  } catch {
    return undefined;
  }
})();

/** The index on disk, read once for every test of this file (it is large). */
let loaded: ReturnType<typeof readIndexFiles> | undefined;
const index = () => (loaded ??= readIndexFiles(cacheFiles(dir!)));

// QT: whole-index checks; slow suites (npm run test:all)
describe.skipIf(!SLOW || dir === undefined)(slowTitle('WP24 corpus (local index)'), () => {
  it('image slots of every card: at least one, unique keys, each name resolves to exactly one slot', async () => {
    const all = await index();
    const problems: string[] = [];
    let cards = 0;
    for (const card of all.cards()) {
      cards++;
      const slots = slotsOfCard(card);
      const names = new Set([card.name, ...(card.card_faces ?? []).map((f) => f.name)]);
      if (slots.length === 0 || new Set(slots.map((s) => s.key)).size !== slots.length) problems.push(`${card.name}: ${JSON.stringify(slots)}`);
      for (const n of names) if (slots.filter((s) => s.names.includes(n)).length !== 1) problems.push(`${card.name}: "${n}"`);
    }
    expect(cards).toBeGreaterThan(30000);
    expect(problems.slice(0, 10)).toEqual([]);
  }, 120_000);

  it('token variants: one key per variant, the same from the compiled token and from the index object', async () => {
    const tokens = (await index()).allTokens();
    const problems: string[] = [];
    const keysByName = new Map<string, string[]>();
    for (const t of tokens) {
      const fromIndex = oracleTokenVariantKeys(t);
      let fromDef: string[];
      try {
        fromDef = imageSlots(compileCard(t, noAbilityCompiler)).map((s) => s.key);
      } catch {
        continue; // a token the engine can't compile is not created by the engine either
      }
      if (JSON.stringify(fromDef) !== JSON.stringify(fromIndex)) problems.push(`${t.name}: ${fromDef.join(' | ')} != ${fromIndex.join(' | ')}`);
      keysByName.set(t.name, [...(keysByName.get(t.name) ?? []), fromIndex.join(' | ')]);
    }
    for (const [name, keys] of keysByName) if (new Set(keys).size !== keys.length) problems.push(`${name}: variants share a key`);
    expect(tokens.length).toBeGreaterThan(500);
    expect(problems.slice(0, 10)).toEqual([]);
  }, 120_000);

  it('CR 111.10, contract C5: every predefined token the interpreter creates finds its printed variant in the index', async () => {
    const db = CardDatabase.fromCards([], { tokens: (await index()).allTokens() });
    const table = JSON.parse(readFileSync(path.join(REPO, 'packages/engine/src/effects/predefined-tokens.json'), 'utf8')) as { tokens: Array<{ name: string }> };
    const missing: string[] = [];
    let found = 0;
    for (const { name } of table.tokens) {
      const def = tokenDefFor(name)!;
      if (db.lookupTokens(tokenBaseName(def.name)).length === 0) continue; // the index has no printed token of that name at all
      if (tokenVariantsFor(db, def).length === 0) missing.push(`${name}: ${imageSlots(def).map((s) => s.key).join(' | ')}`);
      else found++;
    }
    expect(missing).toEqual([]);
    expect(found).toBeGreaterThan(15);
    // The ones whose printed text says "this artifact" / "this enchantment" / "this Aura" or adds reminder text (WP24 review).
    for (const name of ['Map', 'Junk', 'Shard', 'Incubator', 'Royal Role', 'Wicked Role']) expect(tokenVariantsFor(db, tokenDefFor(name)!).length, name).toBeGreaterThan(0);
  }, 120_000);

  it('CR 111.3, contract C5: an inline token the interpreter creates (characteristics and keywords) finds its printed variant in the index', async () => {
    const tokens = (await index()).allTokens();
    const db = CardDatabase.fromCards([], { tokens });
    const missing: string[] = [];
    let tried = 0;
    for (const t of tokens) {
      // One-faced creature tokens whose rules text is nothing but keywords (reminder text aside): exactly what "create a 4/4 white Angel creature token
      // with flying and vigilance" makes.
      if (t.layout !== 'token' || t.card_faces || !/^Token (Legendary )?(Artifact )?Creature — /.test(t.type_line ?? '')) continue;
      if (!/^\d+$/.test(t.power ?? '') || !/^\d+$/.test(t.toughness ?? '')) continue;
      const keywords = (t.keywords ?? []).map((k) => k.toLowerCase());
      const textWords = (t.oracle_text ?? '').replace(/\s*\([^()]*\)/g, '').split(/\n|,\s*/).map((w) => w.trim().toLowerCase()).filter(Boolean);
      if (textWords.length !== keywords.length || !textWords.every((w) => keywords.includes(w))) continue;
      const [, supers, types, subtypes] = /^Token ((?:Legendary )?)((?:Artifact )?Creature) — (.+)$/.exec(t.type_line!)!;
      const def = tokenDefFor({
        ...(t.name !== subtypes ? { name: t.name } : {}),
        colors: (t.colors ?? []) as never,
        ...(supers ? { supertypes: ['Legendary'] } : {}),
        types: types!.split(' '),
        subtypes: subtypes!.split(' '),
        power: Number(t.power),
        toughness: Number(t.toughness),
        keywords: textWords,
      });
      if (!def) continue;
      tried++;
      if (!tokenVariantsFor(db, def).includes(t)) missing.push(`${t.name}: ${imageSlots(def).map((s) => s.key).join(' | ')} vs ${oracleTokenVariantKeys(t).join(' | ')}`);
    }
    expect(missing.slice(0, 10)).toEqual([]);
    expect(tried).toBeGreaterThan(300);
  }, 120_000);
});

/** The cached Oracle bulk file (the index rebuilt from it in memory: the cards.jsonl on disk may have been built by an older version). */
const bulkFile = dir !== undefined && existsSync(cacheFiles(dir).bulkJsonlGz) ? cacheFiles(dir).bulkJsonlGz : undefined;

describe.skipIf(!SLOW || bulkFile === undefined)(slowTitle('WP24 review corpus (index rebuilt from the cached bulk file)'), () => {
  // One build, with --include-unsanctioned: the playtest cards are in both indexes and are handled the same way in both.
  let wide: ReturnType<typeof buildIndexData> | undefined;
  const wideIndex = () => (wide ??= buildIndexData(bulkLines(bulkFile!, 'jsonl.gz'), 'jsonl.gz', { includeUnsanctioned: true }));

  it('CR 100.7: no playtest card hides a tournament card; every playtest card is flagged; a decklist gets the tournament card', async () => {
    const b = await wideIndex();
    const db = CardDatabase.fromCards(b.cards);
    expect(db.lookup('Pick Your Poison')!.oracle_text).toMatch(/^Choose one/);
    expect(db.lookup('Red Herring')!.oracle_text).toMatch(/[Hh]aste/);
    for (const name of ['Fast // Furious', 'Fast']) expect(isUnsanctioned(db.lookup(name)), name).toBe(false);
    const deck = await db.resolveDecklist('4 Pick Your Poison\n4 Red Herring\n4 Fast // Furious');
    expect(deck.main.map((e) => isUnsanctioned(e.card))).toEqual([false, false, false]);
    // Playtest cards stay in the default index, flagged; the ones named like another card under "Name (SET number)".
    expect(b.stats.flaggedPlaytest).toBeGreaterThan(800);
    expect(isUnsanctioned(db.lookup('Pick Your Poison (CMB2 97)'))).toBe(true);
    expect(b.stats.includedUnsanctioned).toBeGreaterThan(600);
  }, 180_000);

  it('CR 201.2: with --include-unsanctioned, every same-name variant is reachable and the bare name is ambiguous (Garbage Elemental)', async () => {
    const b = await wideIndex();
    const db = CardDatabase.fromCards(b.cards);
    expect(db.lookup('Garbage Elemental')).toBeUndefined();
    const deck = await db.resolveDecklist('4 Garbage Elemental');
    expect(deck.unknown[0]!.ambiguous).toHaveLength(6);
    // No flagged card is unreachable behind another card of the same name (memorabilia losing to a real card is the milestone 2 rule).
    const count = new Map<string, number>();
    for (const c of b.cards) count.set(c.name, (count.get(c.name) ?? 0) + 1);
    expect(b.cards.filter((c) => isUnsanctioned(c) && count.get(c.name)! > 1).map((c) => c.name)).toEqual([]);
    expect(b.stats.unsanctionedVariants).toBeGreaterThanOrEqual(46);
  }, 180_000);
});
