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
  if (!isRec(f) || !isRec(f['attachedToObject'])) return false;
  const host = f['attachedToObject'] as Rec;
  // edh-perms-2 (CR 301.5, 303.4; Thran Power Suit): "for each Aura and Equipment attached to it" of an Aura or Equipment's own static ability: the "it" is the host
  // (the one candidate, `attachedTo`), and the group may be Auras and Equipment together (any of the two subtypes)
  // edh-combat-2 (Merry, Esquire of Rohan): "~ has first strike as long as it's equipped": the host is the "it" of the condition itself, still a pronoun here
  if (!CANDIDATE_REFS.has(String(host['ref'])) && !(isAnaphor(host) && plainIt(host))) return false;
  const sub = f['subtypes'];
  return Object.keys(f).every((k) => k === 'attachedToObject' || k === 'subtypes') && Array.isArray(sub) && sub.length >= 1 && sub.length <= 2 && new Set(sub).size === sub.length
    && sub.every((x) => x === 'Equipment' || x === 'Aura');
};
const plainIt = (v: Rec): boolean => {
  const a = v['$anaphor'] as unknown as AnaphorInfo;
  return a.sort === 'object' && a.number === 'singular' && a.text === 'it' && a.head === undefined && a.participle === undefined;
};

/**
 * The value with every plain "it" replaced by the one object reference it names, or null when the sentence has no pronoun to resolve this way, another
 * marker, or not exactly one candidate. `value` is a static template's value (an ability-level `{kind:'static', ...}` or one or more static effects).
 */
export function resolveStaticIt(value: unknown, siblings: readonly unknown[] = []): unknown | null {
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
    // edh-replace-7 (CR 614.1a, 615.1; Khârn the Betrayer): "If damage would be dealt to ~, prevent that damage and an opponent of your choice gains control of it": the sentence names ~ as the
    // object the damage would be dealt to (the replaced event's recipient), so the "it" after it is ~
    if (v['ev'] === 'damage' && isRec(v['recipient']) && isRec(v['recipient']['object']) && v['recipient']['object']['self'] === true && Object.keys(v['recipient']['object']).length === 1 && Object.keys(v['recipient']).length === 1) {
      candidates.set(canonicalJson({ ref: 'self' }), { ref: 'self' });
    }
    // edh-d-40 (CR 120.1, 400.7; Ratonhnhaké꞉ton): "As long as ~ hasn't dealt damage yet, it has hexproof and can't be blocked": the damage the object itself dealt (the event's source is the
    // object itself) names ~ as the object, so the "it" after it is ~ (mentions.ts#namedIn says the same for the lowering of steps)
    if (v['ev'] === 'damage' && isRec(v['source']) && v['source']['self'] === true && Object.keys(v['source']).length === 1) candidates.set(canonicalJson({ ref: 'self' }), { ref: 'self' });
    // edh-c-23 (CR 611.3a, 608.2c; Snow Devil): "as long as it's blocking and you control a snow land": the group an existence condition looks for ("you control a snow land") is not
    // something "it" can mean; only the references inside its filter are read
    if (v['cond'] === 'exists' && isRec(v['of']) && v['of']['ref'] === 'each') {
      scan(v['of']['filter'], false);
      for (const [k, x] of Object.entries(v)) if (k !== 'of') scan(x, false);
      return;
    }
    // edh-combat-4 (CR 107.3; Elturel Survivors): the group a quantity counts ("the number of lands defending player controls") is not something "it" can mean; only the
    // references inside its filter are read
    if (v['q'] === 'count' && isRec(v['of']) && v['of']['ref'] === 'each') {
      scan(v['of']['filter'], false);
      for (const [k, x] of Object.entries(v)) if (k !== 'of') scan(x, false);
      return;
    }
    // edh-c-9 (CR 509.1c; Gift of the Deity): "... and all creatures able to block it do so": every creature able to block is the group that must, no candidate for the "it"; only the
    // object they must block is read
    if (v['s'] === 'restrict' && v['mode'] === 'mustIfAble' && v['action'] === 'block' && isRec(v['subject']) && v['subject']['ref'] === 'each') {
      for (const [k, x] of Object.entries(v)) if (k !== 'subject') scan(x, false);
      return;
    }
    if (typeof v['ref'] === 'string') {
      const ref = v['ref'];
      // std-rx34 (CR 301.5, 303.4): the Equipment or Auras attached to a candidate ("As long as ~ is equipped, it has haste": the condition CLOUD std-msh
      // reads, an Equipment attached to ~) are a group no singular "it" names; the object they are attached to is still a candidate
      if (ref === 'each' && attachmentsOfCandidate(v['filter'])) { scan(v['filter'], false); return; }
      if (CANDIDATE_REFS.has(ref)) candidates.set(canonicalJson(v), v);
      else if (ref !== 'you' && ref !== 'controllerOf' && ref !== 'ownerOf' && ref !== 'defending' && ref !== 'anOpponent' /* edh-replace-7: a player the controller picks */) blocked = true; // another object or a group: no unique candidate (edh-combat-4: the defending player, CR 506.2, is a player)
    }
    // edh-combat-2 (CR 509.1g-h; Sting, the Glinting Dagger): "as long as it's blocking or blocked by a Goblin": the creature described in the other role is a group of its own, no
    // candidate for the "it" of the condition
    // edh-zones-20 (CR 613.1f; Necrotic Ooze): the objects whose activated abilities are copied ("as long as ~ is on the battlefield, it has all activated abilities of all creature cards
    // in all graveyards") are a group the same way: only the references inside its filter are read
    for (const [k, x] of Object.entries(v)) {
      if (k === 'addActivatedOf' && isRec(x) && x['ref'] === 'each') { scan(x['filter'], false); continue; }
      if (!(k === 'blockingOrBlockedBy' && isRec(x) && x['ref'] === 'each')) scan(x, false); // only the described group; a pronoun there is still checked
    }
  };
  scan(value, true);
  const own = anaphors;
  // edh-d-29 (Tenza, Godo's Maul): the sentences beside this one in the paragraph name objects too; their own pronouns are theirs (not counted here)
  for (const sib of siblings) scan(sib, true);
  anaphors = own;
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
 * edh-d-72 (CR 611.3a, 613.1f; Radiant Destiny): "Creatures you control of the chosen type get +1/+1. As long as you have the city's blessing, they also have vigilance.": the plural
 * "they" of a conditional static sentence is the group the OTHER sentences of the paragraph affect (design 6.4, the unique-candidate rule): exactly one distinct group (a continuous
 * effect on `{ref:'each', filter}`) among the sibling sentences. The value without the pronoun, or null when it has no plural "they", another pronoun or marker, or the siblings do not
 * name exactly one group.
 */
export function resolveStaticThey(value: unknown, siblings: readonly unknown[]): unknown | null {
  const isThey = (v: Rec): boolean => {
    const a = v['$anaphor'] as unknown as AnaphorInfo;
    return a.number === 'plural' && a.text === 'they' && a.head === undefined && a.participle === undefined;
  };
  let they = 0;
  let other = false;
  const scan = (v: unknown, top: boolean): void => {
    if (other) return;
    if (Array.isArray(v)) { v.forEach((x) => scan(x, false)); return; }
    if (!isRec(v)) return;
    if (!top && typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return;
    if (isAnaphor(v)) { if (isThey(v)) they++; else other = true; return; }
    for (const [k, x] of Object.entries(v)) {
      if (k.startsWith('$')) { other = true; return; }
      scan(x, false);
    }
  };
  scan(value, true);
  if (other || they === 0) return null;
  const groups = new Map<string, Rec>();
  const collect = (v: unknown, top: boolean): void => {
    if (Array.isArray(v)) { v.forEach((x) => collect(x, false)); return; }
    if (!isRec(v)) return;
    if (!top && typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return;
    if (v['s'] === 'continuous' && isRec(v['affects']) && v['affects']['ref'] === 'each') groups.set(canonicalJson(v['affects']), v['affects']);
    for (const x of Object.values(v)) collect(x, false);
  };
  for (const sib of siblings) collect(sib, true);
  if (groups.size !== 1) return null;
  const only = [...groups.values()][0]!;
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
 * edh-next-85 (CR 601.2i, 400.7d, 604.1; The Tarrasque): "~ has haste and ward {10} as long as it was cast": the `$self` marker of a `wasCast` condition in a static ability of
 * which EVERY continuous effect affects the source itself, so the "it" of the condition is the one object the sentence names, ~ (the unique candidate, design 6.4), whose own
 * cast record `wasCast` reads. The value without the markers, or null when it has none, has another marker or pronoun, a marker outside a `wasCast`, or an effect on anything else.
 */
export function resolveStaticSelfCastMarker(value: unknown): unknown | null {
  let markers = 0;
  let other = false;
  let selfOnly = true;
  let effects = 0;
  const marker = (x: unknown): boolean => isRec(x) && isAnaphor(x) && plainIt(x);
  const scan = (v: unknown, top: boolean): void => {
    if (other) return;
    if (Array.isArray(v)) { v.forEach((x) => scan(x, false)); return; }
    if (!isRec(v)) return;
    if (!top && typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return;
    if (isAnaphor(v)) { other = true; return; }
    if (v['s'] === 'continuous') {
      effects++;
      const a = v['affects'];
      if (!(isRec(a) && a['ref'] === 'self' && Object.keys(a).length === 1)) selfOnly = false;
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === '$self' && marker(x) && v['cond'] === 'wasCast') { markers++; continue; }
      if (k.startsWith('$')) { other = true; return; }
      scan(x, false);
    }
  };
  scan(value, true);
  if (markers === 0 || other || !selfOnly || effects === 0) return null;
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

/**
 * edh-zones-16 (CR 608.2c, 701.20a; Abundance): "If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you
 * reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in any order." The sentence after
 * the reveal names its cards inside the replacement's own steps: "that card" is the card the reveal stopped at (the `as` of the `revealUntil` before it) and "all other
 * cards revealed this way" the other cards it revealed that are still in the library (the same pair of names parser/lower/mentions.ts#revealedRestOf writes for a spell).
 * Only the pronouns of an `instead` body's steps that follow a single-card reveal; the value with them replaced, or null when there is none to replace.
 */
export function resolveInsteadReveal(value: unknown): unknown | null {
  let found = 0;
  const fix = (steps: unknown[]): unknown[] => {
    let reveal: Rec | undefined;
    return steps.map((s) => {
      if (!isRec(s)) return s;
      if (s['op'] === 'revealUntil' && s['count'] === undefined && typeof s['as'] === 'string' && typeof s['revealed'] === 'string') { reveal = s; return s; }
      const what = s['what'];
      if (reveal === undefined || s['op'] !== 'move' || !isRec(what) || !isAnaphor(what)) return s;
      const a = what['$anaphor'] as unknown as AnaphorInfo;
      if (Object.keys(what).some((k) => k !== '$anaphor' && k !== 'ref' && k !== 'name')) return s;
      if (a.sort === 'object' && a.number === 'singular' && a.text === 'that card' && a.head === 'card') { found++; return { ...s, what: { ref: 'bound', name: reveal['as'] } }; }
      if (a.sort === 'set' && a.number === 'plural' && a.head === 'rest' && a.text === 'all other cards revealed this way') {
        found++;
        return { ...s, what: { ref: 'each', filter: { is: { ref: 'bound', name: reveal['revealed'] }, not: { is: { ref: 'bound', name: reveal['as'] } }, zone: 'library' } } };
      }
      return s;
    });
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isRec(v)) return v;
    const out: Rec = {};
    for (const [k, x] of Object.entries(v)) out[k] = k === 'do' && v['b'] === 'instead' && Array.isArray(x) ? fix(x) : walk(x);
    return out;
  };
  const out = walk(value);
  return found > 0 ? out : null;
}

/**
 * edh-cast-11 (CR 601.3, 101.2, 109.5; Lavinia, Azorius Renegade): "Each opponent can't cast noncreature spells with mana value greater than the number of lands that player
 * controls.": the "that player" of the count inside the description of the spells a `cant` `cast` restriction forbids is the player who casts (the subject asked about, one
 * opponent at a time), not any other player. The value with each such pronoun made the controller `you` and the restriction `relativeToSubject` (statics/hooks.ts#verdict reads the
 * description with the casting player as `you`), or null when the value is not exactly one such restriction of each opponent / each player, has another marker or pronoun, or
 * the description says "you" / "opponent" anywhere else (that would shift with the casting player).
 */
export function resolveStaticThatPlayer(value: unknown): unknown | null {
  const one = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
  if (!isRec(one) || one['s'] !== 'restrict' || one['mode'] !== 'cant' || one['action'] !== 'cast' || !isRec(one['subject']) || one['subject']['ref'] !== 'each'
    || !(one['subject']['who'] === 'opponent' || one['subject']['who'] === 'player') || Object.keys(one['subject']).length !== 2 || !isRec(one['other'])) return null;
  if (Object.keys(one).some((k) => !['s', 'subject', 'mode', 'action', 'other'].includes(k))) return null;
  let found = 0;
  let bad = false;
  const isThatPlayer = (x: unknown): boolean => {
    if (!isRec(x) || !isAnaphor(x)) return false;
    const a = x['$anaphor'] as unknown as AnaphorInfo;
    return a.sort === 'player' && a.number === 'singular' && a.text === 'that player' && a.head === 'player' && a.participle === undefined;
  };
  const rewrite = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rewrite);
    if (!isRec(v)) return v;
    const out: Rec = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'controller' && isThatPlayer(x)) { found++; out[k] = 'you'; continue; }
      if (k.startsWith('$') || isAnaphor(v)) { bad = true; continue; }
      if (k === 'controller' || k === 'owner') { bad = true; continue; } // another "you" / "opponent" in the description would shift with the casting player
      if (k === 'ref' && x !== 'each' && x !== 'bound') bad = true;
      out[k] = rewrite(x);
    }
    return out;
  };
  const other = rewrite(one['other']);
  if (bad || found === 0) return null;
  return { ...one, other, relativeToSubject: true };
}
