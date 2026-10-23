/**
 * Helpers for the parser front-end tests (WP5): synthetic faces, the fixture cards, and the local Oracle index when it exists on this machine.
 *
 * Corpus tests read `.cache/scryfall/cards.jsonl` (git-ignored, Scryfall data) and are skipped when it is absent. In a git worktree the cache lives in the
 * main checkout, so the lookup also follows the ".git" file of the worktree; OPENMTG_CACHE_DIR overrides everything.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OracleCard } from '../../../src/index';
import { faceContexts, preprocessFace, type FaceContext, type FrontEndOptions } from '../../../src/parser/preprocess';
import { frontEnd, type SegmentedFace } from '../../../src/parser/segment';
import { GENERATED_LEXICON } from '../../../src/parser/front/lexicon-index';
import { halfOfKey } from '../../../src/parser/metrics';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** The checkout that owns the git-ignored data: this repository, or the main checkout when this one is a worktree. */
function dataRoots(): string[] {
  const roots = [REPO_ROOT];
  const dotGit = join(REPO_ROOT, '.git');
  if (existsSync(dotGit)) {
    try {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8')); // only a worktree's .git is a file
      if (m) roots.push(resolve(REPO_ROOT, m[1]!.trim(), '..', '..', '..'));
    } catch {
      /* ".git" is a directory */
    }
  }
  return roots;
}

/** Path of cards.jsonl (the local Oracle index) or undefined. */
export function localIndexPath(): string | undefined {
  const env = process.env['OPENMTG_CACHE_DIR']?.trim();
  const candidates = env ? [join(env, 'cards.jsonl')] : dataRoots().map((r) => join(r, '.cache', 'scryfall', 'cards.jsonl'));
  return candidates.find((p) => existsSync(p));
}

let indexCache: OracleCard[] | null | undefined;

/** Every card of the local index, or null when there is none. */
export function localIndex(): OracleCard[] | null {
  if (indexCache !== undefined) return indexCache;
  const path = localIndexPath();
  indexCache = path ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as OracleCard) : null;
  return indexCache;
}

/** Scryfall's Standard legality of an index card (the index keeps `legalities`; a token, or a card cached before WP24, has none and counts as not legal). */
export function standardLegal(c: OracleCard): boolean {
  const l = (c as { legalities?: Record<string, string> }).legalities?.['standard'];
  return l === 'legal' || l === 'restricted';
}

/**
 * Design 6.12 and docs/CARD_AUTOMATION.md section 4: the cards a template may be written against and that count as its evidence. The tuning half (the cards
 * whose key hashes even, parser/metrics.ts#halfOfKey, the split of cards/coverage/corpus.ts#halvesOf; a property of the card, so a Scryfall refresh moves no
 * card) and every Standard-legal card (both halves open, owner decision 2026-10-17). A held-out non-Standard card is never read or used as evidence.
 */
export const openToTuning = (c: OracleCard): boolean => halfOfKey(c.oracle_id ?? `name:${c.name}`) === 'tuning' || standardLegal(c);
export const openCards = (all: readonly OracleCard[]): OracleCard[] => all.filter(openToTuning);

/** A synthetic one-face card (invented wording: committed tests never carry Wizards text, design 6.10). */
export function face(name: string, typeLine: string, text: string, extra: Partial<FaceContext> = {}): FaceContext {
  const [left = '', right = ''] = typeLine.split(' — ');
  const supers = new Set(GENERATED_LEXICON.supertypes.map((s) => s.toLowerCase()));
  const words = left.toLowerCase().split(/\s+/).filter(Boolean);
  return {
    name,
    typeLine,
    types: words.filter((w) => !supers.has(w)),
    supertypes: words.filter((w) => supers.has(w)),
    subtypes: right.toLowerCase().split(/\s+/).filter(Boolean),
    layout: 'normal',
    text,
    otherNames: [],
    isToken: false,
    ...extra,
  };
}

export const segment = (ctx: FaceContext, opts: FrontEndOptions = {}): SegmentedFace => frontEnd(ctx, opts);
export const pre = (ctx: FaceContext, opts: FrontEndOptions = {}) => preprocessFace(ctx, opts);
export { faceContexts };

/** A synthetic OracleCard with the given faces (layout decides whether the faces are separate). */
export function oracle(layout: string, faces: { name: string; type_line: string; oracle_text: string }[]): OracleCard {
  const first = faces[0]!;
  return {
    name: faces.length > 1 ? faces.map((f) => f.name).join(' // ') : first.name,
    layout,
    type_line: first.type_line,
    oracle_text: first.oracle_text,
    ...(faces.length > 1 ? { card_faces: faces } : {}),
  };
}
