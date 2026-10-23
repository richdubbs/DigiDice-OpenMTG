/**
 * Writes the card-automation numbers the Home screen's progress panel shows (packages/client/src/screens/coverage-stats.json): how many cards are fully
 * automated, in the whole card index, per format and per Standard set.
 *
 *   npm run stats:coverage -- --snapshot <file>                          the same as the next line
 *   npx tsx scripts/coverage-stats.ts --snapshot <file>                  write the file from a whole-index snapshot (npm run cards -- snapshot --out <file>)
 *   npx tsx scripts/coverage-stats.ts --snapshot <file> --fetch-sets     first fetch the per-set card lists that are not cached yet (Scryfall API)
 *   npx tsx scripts/coverage-stats.ts --snapshot <file> --all-sets <out> also write every set's numbers (for the coverage report)
 *
 * Levels come from the snapshot (the game path's level of each card). Formats are the card index's Scryfall legalities ("legal" or "restricted"). The
 * card index has no set membership, so the cards of each set come from the Scryfall API (one search per set, distinct cards, cached in
 * .cache/scryfall-sets, git-ignored). A card counts once per set however often it is printed there. Promo, token, art-series and digital sets are left
 * out. A Standard set is an expansion or core set at least half of whose cards in the index are Standard-legal. Run it after each merge wave and commit
 * the JSON.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const OUT_PATH = join(REPO_ROOT, 'packages/client/src/screens/coverage-stats.json');
const CACHE_DIR = process.env.OPENMTG_CACHE_DIR?.trim() ? resolve(process.env.OPENMTG_CACHE_DIR.trim()) : join(REPO_ROOT, '.cache', 'scryfall');
const SETS_DIR = join(dirname(CACHE_DIR), 'scryfall-sets');

const FORMATS = [
  ['standard', 'Standard'],
  ['pioneer', 'Pioneer'],
  ['modern', 'Modern'],
  ['pauper', 'Pauper'],
  ['legacy', 'Legacy'],
  ['commander', 'Commander'],
] as const;
/** Set types that are not sets of their own cards (reprints in promo form, tokens, art cards) and are left out. */
const SKIP_SET_TYPES = new Set(['token', 'memorabilia', 'minigame', 'promo', 'masterpiece']);
const STANDARD_SET_TYPES = new Set(['expansion', 'core']);

type Level = 'full' | 'partial' | 'manual';
export interface Counts {
  cards: number;
  full: number;
  partial: number;
  manual: number;
}
export interface SetCounts extends Counts {
  code: string;
  name: string;
  type: string;
  released: string;
  /** Cards Scryfall lists for the set that the local card index does not have yet. */
  notInIndex: number;
}
interface SetMeta {
  code: string;
  name: string;
  set_type: string;
  released_at: string;
  card_count: number;
  parent_set_code?: string;
}
/** A set that is not out yet (its cards are still being revealed), with its child sets (its Commander decks): the cards known so far. */
export interface UpcomingSet extends Counts {
  code: string;
  name: string;
  released: string;
  sets: string[];
  notInIndex: number;
}

const zero = (): Counts => ({ cards: 0, full: 0, partial: 0, manual: 0 });
const add = (c: Counts, level: Level) => {
  c.cards++;
  c[level]++;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One read-only GET on the Scryfall API with the headers it asks for; retries on rate limits and network errors, null on 404. */
async function scryfall(url: string): Promise<any | null> {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'OpenMTG/0.0 (coverage stats)', Accept: 'application/json' } });
      await sleep(150);
      if (r.status === 404) return null;
      if (r.status === 429) {
        await sleep(5000 * attempt);
        continue;
      }
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (attempt === 10) throw e;
      await sleep(5000 * attempt);
    }
  }
  return null;
}

async function fetchSets(): Promise<void> {
  mkdirSync(SETS_DIR, { recursive: true });
  const sets = ((await scryfall('https://api.scryfall.com/sets'))?.data ?? []) as (SetMeta & { digital?: boolean })[];
  const meta = sets
    .filter((s) => !s.digital && !SKIP_SET_TYPES.has(s.set_type) && s.card_count > 0)
    .map((s) => ({ code: s.code, name: s.name, set_type: s.set_type, released_at: s.released_at, card_count: s.card_count, parent_set_code: s.parent_set_code }));
  writeFileSync(join(SETS_DIR, '_sets.json'), JSON.stringify(meta));
  const today = new Date().toLocaleDateString('en-CA');
  for (const m of meta) {
    const file = join(SETS_DIR, `${m.code}.json`);
    // A set that is not out yet gains cards every day of its previews: fetch it again each time.
    if (existsSync(file) && m.released_at <= today) continue;
    const ids = new Set<string>();
    let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`e:${m.code}`)}&unique=cards&include_extras=true&include_variations=true`;
    while (url) {
      const page = await scryfall(url);
      if (!page) break;
      for (const c of page.data ?? []) {
        const id = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
        if (id) ids.add(id);
      }
      url = page.has_more ? page.next_page : null;
    }
    writeFileSync(file, JSON.stringify([...ids].sort()));
  }
}

async function main() {
  const snapshotPath = arg('--snapshot');
  if (!snapshotPath) throw new Error('Usage: npx tsx scripts/coverage-stats.ts --snapshot <file> [--fetch-sets] [--all-sets <out>]');
  if (process.argv.includes('--fetch-sets')) await fetchSets();

  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as { revision?: string; cards: Record<string, { level: Level }> };
  const level = new Map(Object.entries(snapshot.cards).map(([id, c]) => [id, c.level]));

  // The whole index as the coverage report counts it: every snapshot entry (one Oracle name that appears twice in the index has a second key).
  const all = zero();
  for (const l of level.values()) add(all, l);
  const formats = new Map(FORMATS.map(([key]) => [key, zero()]));
  const legal = new Map<string, Set<string>>();
  for (const line of readFileSync(join(CACHE_DIR, 'cards.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const card = JSON.parse(line) as { oracle_id: string; legalities?: Record<string, string> };
    const l = level.get(card.oracle_id);
    if (!l) continue;
    const in_ = new Set<string>();
    for (const [key] of FORMATS) {
      const v = card.legalities?.[key];
      if (v === 'legal' || v === 'restricted') {
        add(formats.get(key)!, l);
        in_.add(key);
      }
    }
    legal.set(card.oracle_id, in_);
  }

  const meta = existsSync(join(SETS_DIR, '_sets.json')) ? (JSON.parse(readFileSync(join(SETS_DIR, '_sets.json'), 'utf8')) as SetMeta[]) : [];
  // Standard sets show the set as played in Standard: their bars count only the set's Standard-legal cards (a card banned in Standard is left out).
  const sets: (SetCounts & { standardShare: number; inStandard: Counts })[] = [];
  for (const m of meta) {
    const file = join(SETS_DIR, `${m.code}.json`);
    if (SKIP_SET_TYPES.has(m.set_type) || !existsSync(file)) continue;
    const s: SetCounts & { standardShare: number; inStandard: Counts } = { code: m.code.toUpperCase(), name: m.name, type: m.set_type, released: m.released_at, ...zero(), notInIndex: 0, standardShare: 0, inStandard: zero() };
    let standard = 0;
    for (const id of JSON.parse(readFileSync(file, 'utf8')) as string[]) {
      const l = level.get(id);
      if (!l) {
        s.notInIndex++;
        continue;
      }
      add(s, l);
      if (legal.get(id)?.has('standard')) {
        standard++;
        add(s.inStandard, l);
      }
    }
    s.standardShare = s.cards ? standard / s.cards : 0;
    if (s.cards) sets.push(s);
  }
  sets.sort((a, b) => b.released.localeCompare(a.released) || a.code.localeCompare(b.code));
  const strip = ({ standardShare: _, inStandard: __, ...s }: SetCounts & { standardShare: number; inStandard: Counts }): SetCounts => s;
  const standardSets = sets.filter((s) => STANDARD_SET_TYPES.has(s.type) && s.standardShare >= 0.5).map((s) => ({ ...strip(s), ...s.inStandard }));

  // Upcoming sets: released after today, grouped with their child sets (a Commander set's parent is its expansion); each card once per group.
  const today = new Date().toLocaleDateString('en-CA');
  const groups = new Map<string, { meta: SetMeta[]; ids: Set<string> }>();
  for (const m of meta) {
    const file = join(SETS_DIR, `${m.code}.json`);
    if (m.released_at <= today || SKIP_SET_TYPES.has(m.set_type) || !existsSync(file)) continue;
    const root = m.parent_set_code ?? m.code;
    const g = groups.get(root) ?? { meta: [], ids: new Set<string>() };
    g.meta.push(m);
    for (const id of JSON.parse(readFileSync(file, 'utf8')) as string[]) g.ids.add(id);
    groups.set(root, g);
  }
  const upcoming: UpcomingSet[] = [...groups.entries()].map(([root, g]) => {
    const main = meta.find((m) => m.code === root) ?? g.meta[0]!;
    const u: UpcomingSet = { code: main.code.toUpperCase(), name: main.name, released: main.released_at, sets: g.meta.map((m) => m.code.toUpperCase()).sort(), ...zero(), notInIndex: 0 };
    for (const id of g.ids) {
      const l = level.get(id);
      if (l) add(u, l);
      else u.notInIndex++;
    }
    return u;
  });
  upcoming.sort((a, b) => a.released.localeCompare(b.released) || a.code.localeCompare(b.code));

  const out = {
    measured: today,
    revision: (snapshot.revision ?? '').slice(0, 8),
    all,
    formats: FORMATS.map(([key, label]) => ({ key, label, ...formats.get(key)! })),
    standardSets,
    upcoming,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`Wrote ${OUT_PATH}: ${all.full} of ${all.cards} full; ${standardSets.length} Standard sets`);
  const allSets = arg('--all-sets');
  if (allSets) {
    writeFileSync(allSets, `${JSON.stringify(sets.map(strip), null, 1)}\n`);
    console.log(`Wrote ${allSets}: ${sets.length} sets`);
  }
}

await main();
