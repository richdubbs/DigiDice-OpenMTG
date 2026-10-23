/** Where things live on disk. The cache is git-ignored (".cache/" in .gitignore). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** Default: <repo root>/.cache/scryfall. Override with the OPENMTG_CACHE_DIR environment variable. */
export function defaultCacheDir(env: Record<string, string | undefined> = process.env): string {
  const override = env.OPENMTG_CACHE_DIR?.trim();
  return override ? path.resolve(override) : path.join(repoRoot(), '.cache', 'scryfall');
}

export function defaultFixturesDir(): string {
  return path.join(repoRoot(), 'packages', 'engine', 'test', 'fixtures');
}

export interface CacheFiles {
  dir: string;
  meta: string;
  bulkJsonlGz: string;
  bulkJson: string;
  cards: string;
  tokens: string;
  lookups: string;
}

export function cacheFiles(dir: string): CacheFiles {
  return {
    dir,
    meta: path.join(dir, 'bulk-meta.json'),
    bulkJsonlGz: path.join(dir, 'oracle-cards.jsonl.gz'),
    bulkJson: path.join(dir, 'oracle-cards.json'),
    cards: path.join(dir, 'cards.jsonl'),
    tokens: path.join(dir, 'tokens.jsonl'),
    lookups: path.join(dir, 'lookups.json'),
  };
}
