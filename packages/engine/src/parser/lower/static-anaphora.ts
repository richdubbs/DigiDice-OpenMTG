/**
 * FAST2 T7 ADDITION (lowering, design 6.4 "the unique-candidate rule" applied to a one-sentence static ability): a plain "it" in a static ability refers to
 * the one object the sentence names. "~ has first strike as long as it's attacking", "~ has flying as long as it has a +1/+1 counter on it", "As long as
 * ~ is equipped, it gets +1/+1 and has flying", "As long as enchanted creature is red, it gets +1/+1 and has haste" (CR 611.3a: the effect applies to
 * that object while the condition holds). The effect passes of lower/index.ts resolve pronouns of instructions; a static template's value had none, so
 * such a sentence stayed manual with an unresolved `$anaphor` marker.
 *
 * The rule, conservative on purpose (a pronoun it cannot resolve leaves the sentence manual, never a guess):
 *   - only the pronoun "it" (singular object, no head noun: "that creature" or "the exiled card" stay with the effect passes);
 *   - the candidates are the object references the value names outside its nested abilities (a granted quoted ability has its own "it", CR 113.7):
 *     `{ref:'self'}` (~) and `{ref:'attachedTo'}` ("enchanted creature", "equipped creature"); a sentence that names any other object reference
 *     ("target creature", a group, a linked object) has no unique candidate;
 *   - exactly one distinct candidate must be named; every "it" then becomes that reference. std-ry8: "You may exert ~ as it attacks" names ~ (its rule
 *     `mayExertAsAttacks` has no reference of its own), so "When you do, it gets +1/+1" is ~.
 */
import type { AnaphorInfo } from '../holes/core';
import { canonicalJson } from '../holes';
import { clone, isRec } from './util';
import type { Rec } from './types';

const ABILITY_KINDS: ReadonlySet<string> = new Set(['spell', 'activated', 'triggered', 'static', 'keyword', 'chapter', 'classLevel', 'levelBracket', 'manual']);
const CANDIDATE_REFS: ReadonlySet<string> = new Set(['self', 'attachedTo']);

const isAnaphor = (v: Rec): boolean => isRec(v['$anaphor']);
/** std-rx34: a group filter that is only "<Equipment | Aura> attached to <a candidate reference>" (parser/holes/cond.ts#matches, "~ is equipped"). */
const attachmentsOfCandidate = (f: unknown): boolean => {
  if (!isRec(f) || !isRec(f['attachedToObject']) || !CANDIDATE_REFS.has(String((f['attachedToObject'] as Rec)['ref']))) return false;
  const sub = f['subtypes'];
  return Object.keys(f).every((k) => k === 'attachedToObject' || k === 'subtypes') && Array.isArray(sub) && sub.length === 1 && (sub[0] === 'Equipment' || sub[0] === 'Aura');
};
const plainIt = (v: Rec): boolean => {
  const a = v['$anaphor'] as unknown as AnaphorInfo;
  return a.sort === 'object' && a.number === 'singular' && a.text === 'it' && a.head === undefined && a.participle === undefined;
};

/**
 * The value with every plain "it" replaced by the one object reference it names, or null when the sentence has no pronoun to resolve this way, another
 * marker, or not exactly one candidate. `value` is a static template's value (an ability-level `{kind:'static', ...}` or one or more static effects).
 */
export function resolveStaticIt(value: unknown): unknown | null {
  const candidates = new Map<string, Rec>();
  let anaphors = 0;
  let blocked = false;
  const scan = (v: unknown, top: boolean): void => {
    if (blocked) return;
    if (Array.isArray(v)) { v.forEach((x) => scan(x, false)); return; }
    if (!isRec(v)) return;
    if (!top && typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return; // a nested ability's pronouns are its own
    if (isAnaphor(v)) {
      if (!plainIt(v)) blocked = true;
      anaphors++;
      return;
    }
    for (const k of Object.keys(v)) if (k.startsWith('$')) { blocked = true; return; } // another marker: not this pass's business
    // std-ry8 (CR 701.43a, 603.12): "You may exert ~ as it attacks. When you do, it gets +1/+1 ...": the sentence names ~ as the creature exerted
    if (v['s'] === 'rule' && v['rule'] === 'mayExertAsAttacks') candidates.set(canonicalJson({ ref: 'self' }), { ref: 'self' });
    if (typeof v['ref'] === 'string') {
      const ref = v['ref'];
      // std-rx34 (CR 301.5, 303.4): the Equipment or Auras attached to a candidate ("As long as ~ is equipped, it has haste": the condition CLOUD std-msh
      // reads, an Equipment attached to ~) are a group no singular "it" names; the object they are attached to is still a candidate
      if (ref === 'each' && attachmentsOfCandidate(v['filter'])) { scan(v['filter'], false); return; }
      if (CANDIDATE_REFS.has(ref)) candidates.set(canonicalJson(v), v);
      else if (ref !== 'you' && ref !== 'controllerOf' && ref !== 'ownerOf') blocked = true; // another object or a group: no unique candidate
    }
    for (const x of Object.values(v)) scan(x, false);
  };
  scan(value, true);
  if (blocked || anaphors === 0 || candidates.size !== 1) return null;
  const only = [...candidates.values()][0]!;
  const replace = (v: unknown, top: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => replace(x, false));
    if (!isRec(v)) return v;
    if (!top && typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return v;
    if (isAnaphor(v)) return clone(only);
    const out: Rec = {};
    for (const [k, x] of Object.entries(v)) out[k] = replace(x, false);
    return out;
  };
  return replace(value, true);
}

/**
 * FAST5 T51 (CR 614.12, 601.2h): the `$self` marker of a cast-history condition in the replacement of the object itself entering ("~ enters with two +1/+1
 * counters on it if it wasn't cast or no mana was spent to cast it"): the "it" of such a sentence is the object entering, ~, which is also what the cast
 * record the condition reads (`selfManaSpent`, `wasCast`) belongs to. The value without those markers, or null when it has none, has another marker or
 * pronoun, or is not the entering replacement of the object itself (a pronoun anywhere else is not this pass's business).
 */
export function resolveEntersSelfMarker(value: unknown): unknown | null {
  let enters = false;
  let markers = 0;
  let other = false;
  const marker = (x: unknown): boolean => isRec(x) && isAnaphor(x) && plainIt(x);
  const scan = (v: unknown, top: boolean): void => {
    if (other) return;
    if (Array.isArray(v)) { v.forEach((x) => scan(x, false)); return; }
    if (!isRec(v)) return;
    if (!top && typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return;
    if (isAnaphor(v)) { other = true; return; }
    const rep = v['replaces'];
    if (v['s'] === 'replace' && isRec(rep) && rep['ev'] === 'zoneChange' && isRec(rep['subject']) && rep['subject']['self'] === true) enters = true;
    for (const [k, x] of Object.entries(v)) {
      if (k === '$self' && marker(x)) { markers++; continue; }
      if (k.startsWith('$')) { other = true; return; }
      scan(x, false);
    }
  };
  scan(value, true);
  if (!enters || markers === 0 || other) return null;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (!isRec(v)) return v;
    const out: Rec = {};
    for (const [k, x] of Object.entries(v)) if (!(k === '$self' && marker(x))) out[k] = strip(x);
    return out;
  };
  return strip(value);
}

/**
 * Cloud std-spm (CR 615.5): "If damage would be dealt to ~, prevent that damage and put that many +1/+1 counters on him" (Anti-Venom): "that many" / "that much"
 * in a prevention effect's additional steps (`prevent.then`) is the damage that application prevented (`{q:'preventedAmount'}`, effects/bodies/m5.ts). The value
 * with those markers replaced (other markers are left for the passes after it), or null when it has none. A nested ability's numbers are its own.
 */
export function resolvePreventedAmount(value: unknown): unknown | null {
  let found = 0;
  const thatMany = (v: Rec): boolean => {
    const a = v['$anaphor'] as unknown as AnaphorInfo;
    return a.sort === 'number' && (a.text === 'that many' || a.text === 'that much') && v['q'] === 'eventAmount' && Object.keys(v).length === 2;
  };
  const replace = (v: unknown, inThen: boolean, top: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => replace(x, inThen, false));
    if (!isRec(v)) return v;
    if (!top && typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return v;
    if (inThen && isAnaphor(v) && thatMany(v)) {
      found++;
      return { q: 'preventedAmount' };
    }
    const out: Rec = {};
    for (const [k, x] of Object.entries(v)) out[k] = replace(x, inThen || (k === 'then' && v['b'] === 'prevent'), false);
    return out;
  };
  const out = replace(value, false, true);
  return found > 0 ? out : null;
}

/**
 * The event patterns whose replaced event has an amount "that many" can name (effects/instead.ts#eventAmount): damage, life, counters, tokens, a mill, a payment of life;
 * p2-replace-events-3: a scry of a number of cards (effects/proposal-kinds/scry.ts).
 */
const AMOUNT_PATTERN = (r: Rec): boolean => ['damage', 'life', 'counters', 'createToken'].includes(String(r['ev']))
  || (r['ev'] === 'action' && (r['verb'] === 'mill' || r['verb'] === 'payLife' || r['verb'] === 'scry'));

/**
 * std-library-4 (CR 614.1a, 614.6): "If you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library
 * instead." (Ashiok, Wicked Manipulator): "that many" / "that much" in a replacement effect's own condition or in its `instead` steps is the amount of the event it
 * replaces (`{q:'eventAmount'}`: effects/instead.ts#replacementCtx, effects/replacements.ts#holdsFor). Only for a replacement of an event that has an amount, and only
 * in those two places; the value with those markers replaced, or null when it has none. A nested ability's numbers are its own.
 */
export function resolveReplacedAmount(value: unknown): unknown | null {
  let found = 0;
  const thatMany = (v: Rec): boolean => {
    const a = v['$anaphor'] as unknown as AnaphorInfo;
    return a.sort === 'number' && (a.text === 'that many' || a.text === 'that much') && v['q'] === 'eventAmount' && Object.keys(v).length === 2;
  };
  const replace = (v: unknown, inside: boolean, top: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => replace(x, inside, false));
    if (!isRec(v)) return v;
    if (!top && typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return v;
    if (inside && isAnaphor(v) && thatMany(v)) {
      found++;
      return { q: 'eventAmount' };
    }
    const amounted = v['s'] === 'replace' && isRec(v['replaces']) && AMOUNT_PATTERN(v['replaces'] as Rec);
    const out: Rec = {};
    for (const [k, x] of Object.entries(v)) {
      const here = inside || (amounted && k === 'condition');
      if (amounted && k === 'body' && isRec(x) && x['b'] === 'instead') out[k] = { ...x, do: replace(x['do'], true, false) };
      else out[k] = replace(x, here, false);
    }
    return out;
  };
  const out = replace(value, false, true);
  return found > 0 ? out : null;
}
