/**
 * Can anything in this game have a triggered ability? Owner: WP32 (performance; design 8.4 is unchanged).
 *
 * Collecting triggers looks at every object that may have one (collect.ts#candidatesFor computes the characteristics of every permanent, spell and emblem), and
 * the collection runs before every state-based action pass and every time a player would receive priority; state triggers (CR 603.8) are checked as often. A
 * game in which no card definition contains a triggered ability anywhere (printed, a Saga chapter, granted by an effect or a static ability, the expansion of a
 * keyword such as prowess or ward, an emblem's) cannot trigger anything but delayed and reflexive triggers, which are not looked for on objects (delayed.ts,
 * stack.ts). Every ability an object can have is written in a definition of the game or in the keyword library, so the answer "no" is certain; it skips the
 * object scan only, never the delayed triggers or the history.
 *
 * Definitions and keyword data are immutable (ARCHITECTURE.md, structural sharing; the registry hands out frozen data), so answers are remembered by identity;
 * the `defs` map only grows (a token's definition, CR 111.4), so its answer is remembered with its size, and a "yes" stays true (the same rule as
 * statics/rule-sources.ts#defsHaveRuleEffects).
 *
 * Accepted deviation from design 8.8 rule 3 ("no caching across actions outside the state"), declared in the WP32 review: `DEF_HAS`, `KW_HAS` and `DEFS_HAVE`
 * outlive an action, but each answer is a pure function of immutable data compared by identity (a definition, a keyword's data, a `defs` map with its size),
 * so it can't go stale; a game's state never depends on them, only how fast the same answer is found. The walk has no depth limit (a tree is finite; the
 * definitions are JSON), and a keyword's answer is remembered only when it is exact: a keyword met again inside its own expansion (a cycle) adds nothing new
 * on that path, so a "no" computed while such a cycle was cut is not remembered, except for the outermost keyword, whose walk saw the whole cycle.
 */
import { FACE_DOWN_DEF_IDS, type CardDef } from '../types/card';
import type { GameState } from '../types/state';
import { keywordRegistry } from '../keywords/registry';
import type { KeywordDefData } from '../keywords/types';

const DEF_HAS = new WeakMap<CardDef, boolean>();
const KW_HAS = new WeakMap<KeywordDefData, boolean>();
const DEFS_HAVE = new WeakMap<GameState['defs'], { v: boolean; n: number }>();

/** Does this JSON tree contain a triggered ability (or a Saga chapter, CR 714.2), directly or through a keyword's expansion? */
export function containsTrigger(v: unknown): boolean {
  return walk(v, { visiting: new Set(), cut: false });
}

interface Walk {
  /** The keywords whose expansion is being walked, outermost first. */
  visiting: Set<KeywordDefData>;
  /** A keyword already in `visiting` was met again (a cycle was cut): a "no" found since is not exact for the inner keywords. */
  cut: boolean;
}

function walk(v: unknown, w: Walk): boolean {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some((x) => walk(x, w));
  const r = v as Record<string, unknown>;
  if (r['kind'] === 'triggered' || r['kind'] === 'chapter' || r['kind'] === 'case') return true; // M6-6: a Case's "To solve" is a triggered ability (CR 719.3a)
  if (r['kind'] === 'keyword' && typeof r['keyword'] === 'string') {
    const data = keywordRegistry.get(r['keyword']);
    if (data && keywordHasTrigger(data, w)) return true;
  }
  for (const k in r) if (walk(r[k], w)) return true;
  return false;
}

function keywordHasTrigger(data: KeywordDefData, w: Walk): boolean {
  const known = KW_HAS.get(data);
  if (known !== undefined) return known;
  if (w.visiting.has(data)) {
    w.cut = true;
    return false;
  }
  const outermost = w.visiting.size === 0;
  const cutBefore = w.cut;
  w.cut = false;
  w.visiting.add(data);
  const v = walk(data.expand ?? null, w);
  w.visiting.delete(data);
  if (v || !w.cut || outermost) KW_HAS.set(data, v); // "yes" is always exact; "no" only when no cycle was cut below an inner keyword
  w.cut = cutBefore || w.cut;
  return v;
}

function defHasTrigger(def: CardDef): boolean {
  let v = DEF_HAS.get(def);
  if (v === undefined) {
    v = containsTrigger(def.faces);
    DEF_HAS.set(def, v);
  }
  return v;
}

/** Can any object of this game have a triggered ability (see the file comment)? False is certain. */
export function triggersPossible(s: GameState): boolean {
  const defs = s.defs;
  const hit = DEFS_HAVE.get(defs);
  if (hit?.v) return true;
  let n = 0;
  for (const _k in defs) n++;
  if (hit && hit.n === n) return false;
  let v = false;
  // M6-0: the face-down pseudo-definitions (types/card.ts#FACE_DOWN_DEF_IDS) are no object's definition: ward {2} of the `ward2` profile (CR 702.168a) is had by
  // a face-down permanent through its 1b profile, which M6-3 (statics/face-down.ts) must make visible here; until then no object can be face down with it.
  for (const k in defs) if (!PSEUDO_DEFS.has(k) && defHasTrigger(defs[k]!)) { v = true; break; }
  DEFS_HAVE.set(defs, { v, n });
  return v;
}

const PSEUDO_DEFS: ReadonlySet<string> = new Set(Object.values(FACE_DOWN_DEF_IDS));
