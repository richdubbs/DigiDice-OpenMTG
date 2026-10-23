/**
 * Test-fixture generator. Reads card-name lists (packages/engine/test/fixtures/*.txt) and writes
 * cards.json with ONLY minimal Oracle fields (no images, prices, flavor text, artist or set info).
 * Fails loudly on any name the index does not know by its exact (full) Scryfall name.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OracleCard } from '@openmtg/engine';
import type { CardDatabase } from './database';
import { writeFileAtomic } from './fsutil';
import { normalizeName } from './normalize';
import { toFixtureCard } from './trim';

export interface FixtureFile {
  cards: OracleCard[];
  tokens: OracleCard[];
}

export interface FixtureProblem {
  name: string;
  file: string;
  line: number;
  message: string;
  suggestions: string[];
}

export interface FixtureResult {
  fixture: FixtureFile;
  problems: FixtureProblem[];
  /** Non-fatal notes, e.g. a token a card creates that is not in the token index. */
  warnings: string[];
  listFiles: string[];
}

export interface ListedName {
  name: string;
  file: string;
  line: number;
}

/** One name per line; blank lines and lines starting with # are ignored. */
export function parseCardList(text: string, file = '(list)'): ListedName[] {
  const out: ListedName[] = [];
  text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).forEach((raw, i) => {
    const name = raw.replace(/\s+#.*$/, '').trim();
    if (name && !name.startsWith('#')) out.push({ name, file, line: i + 1 });
  });
  return out;
}

export async function readCardLists(dir: string): Promise<{ names: ListedName[]; files: string[] }> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.txt')).sort();
  const names: ListedName[] = [];
  for (const f of files) names.push(...parseCardList(await readFile(path.join(dir, f), 'utf8'), f));
  return { names, files };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pick the token variants a card creates: same name and type line, preferring ones that list the card as a creator. */
function tokensFor(card: OracleCard, db: CardDatabase, warnings: string[]): OracleCard[] {
  const creatorNames = new Set([card.name, ...(card.card_faces ?? []).map((f) => f.name)].map(normalizeName));
  const out: OracleCard[] = [];
  for (const part of card.all_parts ?? []) {
    if (part.component !== 'token') continue;
    if (normalizeName(part.name) === normalizeName(card.name)) continue;
    let variants = db.lookupTokens(part.name);
    if (part.type_line) variants = variants.filter((v) => v.type_line === part.type_line);
    const made = variants.filter((v) => (v.all_parts ?? []).some((p) => creatorNames.has(normalizeName(p.name))));
    const chosen = made.length ? made : variants;
    if (!chosen.length) warnings.push(`${card.name}: token "${part.name}" (${part.type_line ?? '?'}) is not in the token index`);
    out.push(...chosen);
  }
  return out;
}

export function buildFixture(db: CardDatabase, listed: ListedName[]): Omit<FixtureResult, 'listFiles'> {
  const problems: FixtureProblem[] = [];
  const warnings: string[] = [];
  const cards = new Map<string, OracleCard>();
  for (const { name, file, line } of listed) {
    const card = db.lookup(name);
    if (!card) {
      problems.push({ name, file, line, message: 'unknown card name', suggestions: db.suggest(name) });
    } else if (normalizeName(card.name) !== normalizeName(name)) {
      problems.push({ name, file, line, message: `use the full Scryfall name "${card.name}"`, suggestions: [card.name] });
    } else {
      cards.set(card.name, card);
    }
  }
  const tokens = new Map<string, OracleCard>();
  for (const card of cards.values()) {
    for (const t of tokensFor(card, db, warnings)) tokens.set(t.oracle_id ?? `${t.name}|${t.type_line}`, t);
  }
  // Tokens keep which fixture cards create them (all_parts: component and name), so a test can pick the right variant.
  const creatorNames = new Set([...cards.values()].flatMap((c) => [c.name, ...(c.card_faces ?? []).map((f) => f.name)]).map(normalizeName));
  const fixture: FixtureFile = {
    cards: [...cards.values()].sort((a, b) => cmp(a.name, b.name)).map((c) => toFixtureCard(c)),
    tokens: [...tokens.values()].sort((a, b) => cmp(a.name, b.name) || cmp(a.oracle_id ?? '', b.oracle_id ?? '')).map((t) => toFixtureCard(t, true, creatorNames)),
  };
  return { fixture, problems, warnings };
}

export function serializeFixture(fixture: FixtureFile): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

/** Read the lists in `dir`, build the fixture, and write `cards.json` there unless something is wrong. */
export async function generateFixtures(db: CardDatabase, dir: string): Promise<FixtureResult> {
  const { names, files } = await readCardLists(dir);
  if (!names.length) throw new Error(`No card names found in ${dir}/*.txt`);
  const built = buildFixture(db, names);
  const result: FixtureResult = { ...built, listFiles: files };
  if (!built.problems.length) await writeFileAtomic(path.join(dir, 'cards.json'), serializeFixture(built.fixture));
  return result;
}
