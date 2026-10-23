/**
 * The index of the replacement and prevention effects of OTHER objects (m6 design E1, D2; CR 614, 615, 616). Owner: M6-1 (new file of W1).
 *
 * A replacement effect of a static ability that is not about its own object (`feature:replace.foreign`: Leyline of the Void, Rest in Peace, Doubling Season,
 * Orb of Dreams, Furnace of Rath) applies to every event its pattern matches while the ability functions, i.e. while its object is in a zone the ability
 * functions in (CR 113.6, 604.1: the battlefield by default; dredge in the graveyard, madness in the hand). The proposal pipeline asks for these per proposal,
 * so this module keeps them in an index bucketed by the pattern's event kind (`replaces.ev`) instead of walking every object's abilities for every event:
 *
 *  - on the LAYERED path (a continuous effect or another layer source exists: abilities may be granted or removed) the index is a pure function of the Map
 *    `allChars(s)` returns, memoized in a WeakMap keyed by that Map: the characteristics cache hands out the same Map exactly when nothing the layers read has
 *    changed (rules/characteristics.ts), so the key is exact;
 *  - on the INTRINSIC path (no layer source: every object's abilities are its definition's own) it joins a per-definition precomputation (does any face of the
 *    definition have such an ability? a WeakMap keyed by the immutable `CardDef`) with the objects, memoized (one entry) by the definitions map and a snapshot
 *    of (id, definition, zone, face, face-down, phased-out, flipped) of the objects whose definition has one, usually none: exactly what the entries are made of.
 *
 * Both are process-wide memos of pure functions of exactly the data they compare, with frozen results (docs/ARCHITECTURE.md lists them); `scanReplacements`
 * is the same answer computed without any memo, which the indexed-versus-scanned property test (test/m6/replace/foreign.test.ts) compares with it.
 *
 * Whether an entry APPLIES to a proposed event (its pattern, its conditions, the body) is decided by effects/replacements.ts#foreignCandidates: this module
 * only says which effects exist and where.
 */
import type { AbilityDef, EventPattern, ReplacementDef, StaticAbilityDef } from '../types/ability';
import { expansionOf } from '../statics/abilities';
import type { CardDef } from '../types/card';
import type { ObjectId } from '../types/ids';
import type { GameObject, GameState, ZoneKind } from '../types/state';
import { allChars, charsOfObject, faceChars, type Chars } from '../rules/characteristics';
import { layerSourcesPresent } from '../statics/live';

/** One replacement effect of a static ability of an object, in a zone where that ability functions. */
export interface IndexedReplacement {
  object: ObjectId;
  zone: ZoneKind;
  /** The ability's key (statics/abilities.ts: `p:` printed, `k:` keyword expansion, `g:` granted). */
  key: string;
  ability: StaticAbilityDef;
  /** Index of the effect in `ability.effects`. */
  index: number;
  effect: ReplacementDef;
}

export type ReplacementBuckets = ReadonlyMap<EventPattern['ev'], readonly IndexedReplacement[]>;

/**
 * Is this replacement effect "about its own object" (`feature:replace.self`, CR 614.12, 614.15)? Those are consulted from the objects an event involves
 * (effects/replacements.ts#selfCandidates); every other one is a foreign effect and is in this index. The same test as the capability walker's
 * (model/cap-walk.ts), so what is indexed is exactly what `feature:replace.foreign` promises.
 */
export function aboutSelf(p: EventPattern): boolean {
  switch (p.ev) {
    case 'zoneChange': return p.subject.self === true;
    case 'damage': return p.recipient?.object?.self === true || p.source?.self === true;
    case 'counters': return 'self' in p.on && p.on.self === true;
    case 'becomes': return p.object.self === true;
    default: return false;
  }
}

/** A foreign replacement effect (not a shield, not a self-replacement, not about its own object). */
export const isForeign = (r: ReplacementDef): boolean => r.shield === undefined && r.selfReplacement !== true && !aboutSelf(r.replaces);

/** The zones a static ability functions in (CR 113.6, 604.1): the battlefield unless it says otherwise. */
const functionsIn = (a: StaticAbilityDef, zone: ZoneKind): boolean => (a.zone ?? ['battlefield']).includes(zone);

/** The foreign replacement effects of one object, from its characteristics, if the ability functions where the object is. */
function entriesOf(o: GameObject, c: Chars, out: IndexedReplacement[]): void {
  if (o.phasedOut) return; // CR 702.26b: a phased-out permanent is treated as though it does not exist
  for (const a of c.abilities) {
    if (a.def.kind !== 'static' || !functionsIn(a.def, o.zone)) continue;
    const ability = a.def;
    ability.effects.forEach((effect, index) => {
      if (effect.s === 'replace' && isForeign(effect)) out.push({ object: o.id, zone: o.zone, key: a.key, ability, index, effect });
    });
  }
}

/** The entries bucketed by the event kind of their pattern; frozen (a memo hands the same value to every caller). */
const bucket = (entries: readonly IndexedReplacement[]): ReplacementBuckets => {
  const m = new Map<EventPattern['ev'], IndexedReplacement[]>();
  for (const e of entries) {
    Object.freeze(e);
    const list = m.get(e.effect.replaces.ev);
    if (list) list.push(e);
    else m.set(e.effect.replaces.ev, [e]);
  }
  for (const list of m.values()) Object.freeze(list);
  return m;
};

/** The same answer as `replacementIndex`, computed from scratch (no memo): every object's characteristics, every foreign replacement static. */
export function scanReplacements(s: GameState): IndexedReplacement[] {
  const out: IndexedReplacement[] = [];
  for (const o of Object.values(s.objects)) {
    if (o.kind === 'ability') continue;
    entriesOf(o, charsOfObject(s, o), out);
  }
  return out;
}

// ---- the memos -------------------------------------------------------------------------------------------------------------------------------------

const LAYERED = new WeakMap<ReadonlyMap<ObjectId, Chars>, ReplacementBuckets>();
const DEF_HAS = new WeakMap<CardDef, boolean>();
let INTRINSIC: { defs: GameState['defs']; key: string; value: ReplacementBuckets } | null = null;

const KW_CTX = { granted: false, faceName: '', types: [] as string[], keyPrefix: 'k:0:0' };

/** Is this ability (or, for a keyword, what the keyword library expands it into: dredge, CR 702.52a) a static with a foreign replacement effect? */
const hasForeign = (a: AbilityDef): boolean =>
  a.kind === 'static' ? a.effects.some((e) => e.s === 'replace' && isForeign(e)) : a.kind === 'keyword' ? expansionOf(a, KW_CTX).some(hasForeign) : false;

/** Does any face of the definition have a foreign replacement static (printed or a keyword's expansion)? Pure in the immutable definition. */
function defHas(def: CardDef): boolean {
  let v = DEF_HAS.get(def);
  if (v === undefined) {
    v = def.faces.some((_f, i) => faceChars(def, i).abilities.some((a) => hasForeign(a.def)));
    DEF_HAS.set(def, v);
  }
  return v;
}

/**
 * The foreign replacement effects that exist now, bucketed by the event kind of their pattern (m6 design E1). Each entry's object is in a zone where the
 * ability functions.
 */
export function replacementIndex(s: GameState): ReplacementBuckets {
  if (layerSourcesPresent(s)) {
    const all = allChars(s);
    let hit = LAYERED.get(all);
    if (hit === undefined) {
      const out: IndexedReplacement[] = [];
      for (const [id, c] of all) {
        const o = s.objects[id];
        if (o && o.kind !== 'ability') entriesOf(o, c, out);
      }
      LAYERED.set(all, (hit = bucket(out)));
    }
    return hit;
  }
  // Intrinsic path: only objects whose definition has such an ability can contribute; the key is what their entries depend on.
  const relevant: GameObject[] = [];
  let key = '';
  for (const o of Object.values(s.objects)) {
    if (o.kind === 'ability') continue;
    const def = s.defs[o.defId];
    if (!def || !defHas(def)) continue;
    relevant.push(o);
    // M6-12 fix: a flip card's flipped status chooses its half (CR 710.2, 710.4): Tok-Tok's replacement exists only once Akki Lavarunner has flipped
    key += `${o.id}:${o.defId}:${o.zone}:${o.face}:${o.faceDown ? 1 : 0}:${o.phasedOut ? 1 : 0}:${o.flipped ? 1 : 0};`;
  }
  if (INTRINSIC && INTRINSIC.defs === s.defs && INTRINSIC.key === key) return INTRINSIC.value;
  const out: IndexedReplacement[] = [];
  for (const o of relevant) entriesOf(o, charsOfObject(s, o), out);
  const value = bucket(out);
  INTRINSIC = { defs: s.defs, key, value };
  return value;
}
