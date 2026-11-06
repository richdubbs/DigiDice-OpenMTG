/**
 * Pass 4, riders (design 6.5): a sentence parsed by a `rider` template (`{"$patchPrevious": {...}}`, parser/types.ts#Template.build) merges into the step
 * it modifies: "They can't be regenerated" sets `regeneration: 'cant'` on the destroy (CR 701.19c); "If that spell is countered this way, put it on top of
 * its owner's library instead of into that player's graveyard" sets `counter.to` (CR 608.2c, 614.15 self-replacement); "It's still a land" turns a type
 * change from `set` into `add` (CR 205.1b). Owner: WP17.
 *
 * The previous step is the LAST top-level step of the previous sentence of the same ability (or bullet). It must exist, must not be manual, and must have
 * the op the template names in `attachTo`. A rider without a mergeable predecessor is manual: this is what makes CR 608.2c ("instructions are followed in
 * the order written" and a later sentence may modify an earlier one) a compile-time property instead of a guess.
 *
 * Merge semantics (the only thing a patch can do; templates contain no code): objects merge key by key, recursively; an array of objects merges element
 * by element (a shorter patch leaves the remaining elements alone); any other value replaces; `null` deletes the key.
 *
 * Three references to the step being modified (WP23, templates E; still data, no code). Each one fails closed: a rider whose reference cannot be honored
 * is manual, never merged half-way.
 *   - `"@previous"` (a string anywhere in the patch) is a copy of the previous step; `"@previous.a.b.0"` is the value at that path inside it. A path that
 *     does not exist refuses the rider. "It's still a land" moves `types.set` to `types.add` (CR 205.1b) without knowing which types were set, and (w8-followups,
 *     `{"@concat": [...]}`) `subtypes.set` to `subtypes.add` beside the subtypes it already adds: the object keeps all its prior subtypes (CR 205.1b).
 *   - `{"@new": X}` as a value sets the key only when the previous step does not have it ("Otherwise, ..." gives an `if` its `else`, CR 608.2c; a second
 *     "Otherwise" is refused instead of being merged into the first).
 *   - `"@replace": true` at the top of the patch replaces the previous step by the patch instead of merging into it. It is the self-replacement fold of
 *     CR 614.15 ("If [condition], [effect] instead." becomes `if` with the previous step as `else`), so it is accepted only when the previous sentence is
 *     that ONE step: with several, which instruction "instead" replaces would be a guess. And only when the new instruction replaces that step as a whole
 *     (render/self-replacement.ts, WP23 review): the same op on the same player and objects, another amount or destination. "You may X instead", a
 *     subset of a group, another target (CR 601.2c) or another instruction are refused, so the sentence stays manual.
 *   - r5-refs INTERFACE CHANGE (additive, opt-in): `{"@append": [X]}` as a value appends to the list the previous step has at that key (mergePatch).
 *   - edh-d-43 INTERFACE CHANGE (additive, opt-in): `"@after": [steps]` at the top of the patch puts those instructions right after the modified step (see the merge below).
 *   - M6-8 INTERFACE CHANGE (additive, opt-in): `"@step": -n` at the top of the patch names the n-th top-level step from the END of the previous sentence
 *     instead of its last one (-1, the default): "The new creature type can't be Wall." restricts the second of the two choices of Artificial Evolution's
 *     first sentence, whose last step is the effect (CR 612.2, 608.2d). The named step must have the op of `attachTo`; a step that does not exist refuses.
 */
import type { Quantity } from '../../types/ability';
import type { Draft, Rec, Unit } from './types';
import { canonicalJson } from '../holes';
import { isCastChoice, keywordChoiceGrant, notWideReplacement, sameGrantTarget } from '../../render/self-replacement';
import { clone, cloneDraft, freshName, isRec, rewrite, sequences, setManual } from './util';

/** A rider whose patch cannot be applied as written (a reference that does not exist, a key that is already set). */
class RiderRefused extends Error {}

const PREVIOUS = '@previous';

/** The value at a dotted path inside the previous step ("effects.0.mods.0.types.set"), or a refusal. */
function lookupPrevious(prev: Rec, path: string): unknown {
  let v: unknown = prev;
  for (const part of path.split('.')) {
    if (Array.isArray(v) && /^\d+$/.test(part)) v = v[Number(part)];
    else if (isRec(v)) v = v[part];
    else v = undefined;
    if (v === undefined) throw new RiderRefused(`the previous step has no ${path}`);
  }
  return clone(v);
}

/** Replace every "@previous" / "@previous.<path>" string of a patch by what it names in the previous step. */
/** edh-d-90: the instructions after an `addMana` that a "this mana" rider looks past (they add no mana: CR 106.4). */
const MANA_RIDER_SKIPS: ReadonlySet<string> = new Set(['gainLife', 'loseLife', 'draw']);

export function resolvePrevious(patch: unknown, prev: Rec): unknown {
  if (typeof patch === 'string') {
    if (patch === PREVIOUS) return clone(prev);
    if (patch.startsWith(`${PREVIOUS}.`)) return lookupPrevious(prev, patch.slice(PREVIOUS.length + 1));
    return patch;
  }
  if (Array.isArray(patch)) return patch.map((x) => resolvePrevious(x, prev));
  if (!isRec(patch)) return patch;
  // r4-repl INTERFACE CHANGE (additive, opt-in): `{"@previousWith": {...}}` is a copy of the previous step with those top-level keys set to these values (each
  // replaced as a whole, not merged): "Create a token that's a copy of target creature. If C, create five of those tokens instead." restates the previous
  // instruction with another `count` only (CR 614.15), whatever else it says
  if (Object.keys(patch).length === 1 && isRec(patch['@previousWith'])) return { ...clone(prev), ...(resolvePrevious(patch['@previousWith'], prev) as Rec) };
  // r4-repl INTERFACE CHANGE (additive, opt-in): `{"@previousMerged": {...}}` is a copy of the previous step with that patch merged into it (the merge semantics
  // below: objects key by key, arrays of objects element by element): "Until end of turn, target creature becomes an artifact creature with base power and
  // toughness 4/3. If C, it has base power and toughness 1/1 until end of turn instead." changes only the numbers of the second modification
  if (Object.keys(patch).length === 1 && isRec(patch['@previousMerged'])) return mergePatch(prev, resolvePrevious(patch['@previousMerged'], prev));
  // w8-followups INTERFACE CHANGE (additive, opt-in): `{"@concat": [...]}` (concatOf)
  if (Object.keys(patch).length === 1 && '@concat' in patch) return concatOf(patch['@concat'], prev);
  const out: Rec = {};
  for (const [k, v] of Object.entries(patch)) {
    const r = resolvePrevious(v, prev);
    if (r !== OMIT) out[k] = r;
  }
  return out;
}

/** w8-followups: the value of a `@concat` that has nothing in it: its key is left out of the patch. */
const OMIT = Symbol('omit');

/**
 * w8-followups INTERFACE CHANGE (additive, opt-in): `{"@concat": [a, b, ...]}` as a value is the list of the values of its items, in order and each once: an item
 * that is a list adds its elements, any other value itself, and a `"@previous.<path>"` the previous step does not have adds nothing (inside `@concat` a missing
 * path does not refuse the rider). With nothing in it the key is left out of the patch. "It's still a land" moves the subtypes the type change sets to the ones
 * it adds, beside the ones it already adds (CR 205.1b: the object keeps all its prior subtypes, so the new ones replace none).
 */
function concatOf(items: unknown, prev: Rec): unknown {
  if (!Array.isArray(items)) throw new RiderRefused('"@concat" is not a list');
  const out: unknown[] = [];
  const push = (x: unknown): void => { if (!out.some((y) => canonicalJson(y) === canonicalJson(x))) out.push(x); };
  for (const item of items) {
    let v: unknown;
    try {
      v = resolvePrevious(item, prev);
    } catch (e) {
      if (e instanceof RiderRefused && typeof item === 'string' && item.startsWith(`${PREVIOUS}.`)) continue;
      throw e;
    }
    if (v === OMIT) continue;
    if (Array.isArray(v)) v.forEach(push);
    else push(v);
  }
  return out.length === 0 ? OMIT : out;
}

const isNew = (v: unknown): v is { '@new': unknown } => isRec(v) && Object.keys(v).length === 1 && '@new' in v;
/** r5-refs: `{"@append": [X, ...]}`, see mergePatch. */
const isAppend = (v: unknown): v is { '@append': unknown[] } => isRec(v) && Object.keys(v).length === 1 && Array.isArray(v['@append']);

/** Deep merge of a rider patch into a step (returns a new value). Throws RiderRefused for an `@new` key that is already set. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRec(patch)) return clone(patch);
  const base: Rec = isRec(target) ? clone(target) : {};
  for (const [k, pv] of Object.entries(patch)) {
    if (pv === null) { delete base[k]; continue; }
    const tv = base[k];
    if (isNew(pv)) {
      if (tv !== undefined) throw new RiderRefused(`the previous step already has ${k}`);
      base[k] = clone(pv['@new']);
    } else if (isAppend(pv)) {
      // Standard round 5, r5-refs INTERFACE CHANGE (additive, opt-in): `{"@append": [X]}` adds instructions after the ones a list of the previous step already
      // has ("Each player may shuffle their hand and graveyard into their library. Each player who does draws seven cards.": the draw is one more instruction
      // of the `may` of each player, CR 608.2c, 608.2d); a key that is not a list refuses the rider
      if (!Array.isArray(tv)) throw new RiderRefused(`the previous step has no list ${k} to add to`);
      base[k] = [...tv.map((x) => clone(x)), ...pv['@append'].map((x) => clone(x))];
    } else if (isRec(pv)) {
      // w8-followups: a patch that only deletes keys of something the step does not have changes nothing (no empty object is made)
      if (tv === undefined && Object.keys(pv).length > 0 && Object.values(pv).every((x) => x === null)) continue;
      base[k] = mergePatch(tv, pv);
    }
    else if (Array.isArray(pv) && Array.isArray(tv) && pv.length <= tv.length && pv.every(isRec)) base[k] = tv.map((x, i) => (i < pv.length ? mergePatch(x, pv[i]) : x));
    else base[k] = clone(pv);
  }
  return base;
}

/**
 * FAST5 T56 INTERFACE CHANGE (additive, opt-in): `"@require": {"a.b.0": value}` at the top of a patch lists values the previous step must have at those dotted paths
 * (a `null` value: nothing there) or the rider is refused. "The flashback cost is equal to its mana cost" sets a flag on the keyword the previous sentence granted,
 * and only the keyword flashback has it (a patch merges, it does not check what it merges into).
 */
function checkRequired(prev: Rec, require: unknown): void {
  if (require === undefined) return;
  if (!isRec(require)) throw new RiderRefused('"@require" is not an object');
  for (const [path, want] of Object.entries(require)) {
    let v: unknown = prev;
    for (const part of path.split('.')) v = Array.isArray(v) && /^\d+$/.test(part) ? v[Number(part)] : isRec(v) ? v[part] : undefined;
    // std-cardcopy-7: `{"@oneOf": [values]}`: any of those values ("Copy them." of what this resolution exiled, or "Copy those exiled cards." of what the cost exiled)
    const options = isRec(want) && Array.isArray(want['@oneOf']) ? (want['@oneOf'] as unknown[]) : [want];
    if (!options.some((w) => (w === null ? v === undefined : canonicalJson(v) === canonicalJson(w)))) throw new RiderRefused(`the previous step does not have ${canonicalJson(want)} at ${path}`);
  }
}

/**
 * The step the rider makes of the previous step `last` (the previous sentence has `count` top-level steps). Throws RiderRefused.
 * CLOUD C9: `sentence` is the previous sentence's steps when the rider would act on its last top-level step (`last` is its last element); an "instead" fold
 * (`@replace`) after a sentence of several instructions then replaces the whole sentence (the caller puts the returned `if` in place of all of it), but only when
 * the instead sentence restates it instruction for instruction (render/self-replacement.ts#notWideReplacement).
 */
export function applyRider(last: Rec, patch: Rec, count: number, spell = false, sentence?: readonly Rec[]): Rec {
  const resolved = resolvePrevious(patch, last) as Rec;
  if (resolved['@replace'] === true) {
    // CR 614.15: "instead" replaces ONE instruction; with several in the previous sentence the one it replaces is not known, unless the "instead" sentence restates
    // all of them (CLOUD C9: then it replaces the sentence)
    const whole = count !== 1 && sentence !== undefined && sentence.length === count && sentence[count - 1] === last;
    // std-costs-2 INTERFACE CHANGE (additive, opt-in): `"@names": true`, the rider names the instruction it replaces ("put that card onto the battlefield instead of
    // putting it into your hand"): the template's `attachTo`, `@step` and `@require` pick that one instruction among several (CR 614.15)
    const named = resolved['@names'] === true;
    // edh-next-141 (CR 614.15, 608.2c, 702.2, 702.20; Éowyn, Lady of Rohan): "target creature gains your choice of first strike or vigilance until end of turn. If that creature is
    // equipped, it gains first strike and vigilance until end of turn instead.": the choice and its two grants (eff.t41.gains.choice2) are ONE instruction, a grant of one of two
    // keywords; one grant of keywords to the same object for the same duration replaces all of it (the choice is not made when the condition holds)
    if (count !== 1 && !named && sentence !== undefined && sentence.length === count && sentence[count - 1] === last && rest0IsIf(resolved)) {
      const grant = keywordChoiceGrant(sentence);
      const then = resolved['then'];
      if (grant !== null && Array.isArray(then) && then.length === 1 && isRec(then[0]) && sameGrantTarget(then[0], grant)) {
        const { '@replace': _r, '@names': _n, ...rest } = resolved;
        if (Array.isArray(rest['else']) && rest['else'].length === 1 && canonicalJson(rest['else'][0]) === canonicalJson(last)) return { ...rest, else: clone(sentence) };
      }
    }
    if (count !== 1 && !whole && !named) throw new RiderRefused('"instead" after a sentence with several instructions (CR 614.15)');
    const { '@replace': _drop, '@names': _named, ...rest } = resolved;
    // the only replacement fold: if C then [X] else [Y], with Y the previous step (flow.json#fl.instead)
    if (rest['op'] !== 'if' || !Array.isArray(rest['else']) || rest['else'].length !== 1 || canonicalJson(rest['else'][0]) !== canonicalJson(last)) {
      throw new RiderRefused('"@replace" builds only "if C then X else the previous step" (CR 614.15)');
    }
    if (whole) {
      // CLOUD C9 (CR 608.2c, 614.15): "Search ..., reveal it, put it into your hand, then shuffle. If C, instead search ..., put it into your hand, then shuffle."
      const castChoice = spell && isCastChoice(rest['cond']);
      const then = Array.isArray(rest['then']) && rest['then'].every(isRec) ? alignNames(sentence!, rest['then'] as Rec[]) : null;
      const why = then !== null ? notWideReplacement(sentence!, then, rest['cond'], castChoice) : 'no instructions';
      const only = why !== null && then !== null ? movesTheOnlyMoved(sentence!, last, then) : null;
      if (only !== null) return { ...rest, then: only, else: [clone(last)] };
      if (why !== null) throw new RiderRefused(`"instead" after a sentence with several instructions: ${why} (CR 614.15)`);
      return { ...rest, then, else: clone(sentence!) };
    }
    // CR 614.15, 608.2d, 601.2c: X must replace the previous instruction as a whole (render/self-replacement.ts; WP23 review)
    // STD-OTJ (CR 614.15, 608.2c): "Return target permanent card ... to your hand. Return that card to the battlefield instead if you control a Mount.": "that card" of the replacing
    // move is the card the previous move moved (the name its `as` gave it); in the branch that replaces the move that name is not bound, so the branch moves the
    // same target the replaced move names. Only a move of the target of the previous move to somewhere else, step for step the same otherwise.
    // CLOUD C9 (CR 701.8a, 400.7): the same for a replaced destroy: "Destroy target attacking creature. If that creature is a Demon, exile it instead." ("it" is the card
    // the destroy put into the graveyard; in the branch that exiles instead, it is the target)
    const retargetAgainst = (prev: Rec) => (x: unknown): unknown =>
      isRec(x) && (x['op'] === 'move' || (x['op'] === 'destroy' && prev['op'] === 'destroy' /* edh-replace-4: a guarded destroy by another guarded destroy (Fatal Push) */) || (x['op'] === 'counter' && prev['op'] === 'counter' /* edh-next-93 (Bane's Contingency): "instead counter that spell, scry 2, then draw a card" */)) && (prev['op'] === 'move' || prev['op'] === 'destroy' || prev['op'] === 'counter') && typeof prev['as'] === 'string' && isRec(x['what']) && x['what']['ref'] === 'bound'
        && x['what']['name'] === prev['as'] && isRec(prev['what']) && prev['what']['ref'] === 'target' ? { ...x, what: prev['what'], as: prev['as'] } : x;
    // edh-replace-7 (CR 614.15, 608.2d; Emeria Shepherd): "You may return target ... to your hand. If C, you may return that card to the battlefield instead.": the same, inside the one instruction of
    // each of the two choices
    const retarget = (x: unknown): unknown =>
      isRec(x) && x['op'] === 'may' && last['op'] === 'may' && Array.isArray(x['do']) && Array.isArray(last['do']) && x['do'].length === 1 && last['do'].length === 1 && isRec(last['do'][0])
        ? { ...x, do: [retargetAgainst(last['do'][0])(x['do'][0])] } : retargetAgainst(last)(x);
    // edh-replace-1 (CR 614.15, 118.12a; Stubborn Denial): "Counter target noncreature spell unless its controller pays {1}. If C, counter that spell instead.": "that spell" of the
    // replacing counter is the spell the counter of the payment offer names (`as`); in the branch that replaces the offer that name is not bound, so the branch counts the
    // same target spell (the very counter step the offer is about)
    const offered = last['op'] === 'pay' && Array.isArray(last['else']) && last['else'].length === 1 && isRec(last['else'][0]) ? last['else'][0] : undefined;
    const retargetOffer = (x: unknown): unknown =>
      offered !== undefined && isRec(x) && x['op'] === 'counter' && offered['op'] === 'counter' && typeof offered['as'] === 'string' && isRec(x['what']) && x['what']['ref'] === 'bound'
        && x['what']['name'] === offered['as'] && Object.keys(x).length === 2 ? clone(offered) : x;
    const then = Array.isArray(rest['then']) ? rest['then'].map(retarget).map(retargetOffer) : rest['then'];
    if (Array.isArray(then)) rest['then'] = then;
    // FAST5X E1: with a condition decided at announcement ("if this spell was bargained", "if the gift was promised"), any one instruction (render/self-replacement.ts#isCastChoice)
    // FAST5X E19: ... and with the mana spent to cast the triggering spell, fixed before the ability triggered (opus; render/self-replacement.ts#isFixedChoice)
    // FAST5X E11 (CR 614.15, 702.194c): with a condition decided at announcement, "If this spell was cast using teamwork, instead exile target creature and you
    // gain 3 life": the new instructions replace the previous one as a whole, each one instruction (the choice is made as the spell is cast, CR 601.2b-c)
    const castChoice = spell && isCastChoice(rest['cond']);
    // CLOUD C9: also another instruction on the same objects, a search by a search, several instructions on the same objects (render/self-replacement.ts)
    const why = !Array.isArray(then) || then.length === 0 ? '"instead" with several instructions' : notWideReplacement([last], then, rest['cond'], castChoice);
    if (why !== null) throw new RiderRefused(`"instead": ${why} (CR 614.15)`);
    return rest;
  }
  return mergePatch(last, resolved) as Rec;
}

const rest0IsIf = (r: Rec): boolean => r['op'] === 'if' && Array.isArray(r['else']) && r['else'].length === 1;

/**
 * r4-repl (CR 614.15, 608.2c, 701.23a): "Search your library for a Vehicle card, reveal it, and put it into your hand. If C, put that card onto the battlefield
 * instead." The "instead" sentence is one move of the card the previous sentence's LAST instruction moves, to another zone, and that is the only move of the
 * sentence: it can replace nothing but that move (the search and the reveal are done either way), so it replaces it alone (the caller keeps the earlier
 * instructions). Anything else (another object, a second move, several instructions) stays refused. Returns the replacing instructions, or null.
 */
function movesTheOnlyMoved(sentence: readonly Rec[], last: Rec, then: readonly Rec[]): Rec[] | null {
  if (then.length !== 1 || last['op'] !== 'move' || sentence.filter((x) => x['op'] === 'move').length !== 1) return null;
  let x = then[0]!;
  // "that card" was read as the card the replaced move moved (its `as`); in the branch that replaces the move it is the card that move would have moved
  const w = x['what'];
  if (isRec(w) && w['ref'] === 'bound' && typeof last['as'] === 'string' && w['name'] === last['as']) x = { ...x, what: clone(last['what']) };
  // and it binds the name the replaced move binds, so a later sentence reads either branch's card
  if (typeof last['as'] === 'string' && x['as'] === undefined) x = { ...x, as: last['as'] };
  if (x['op'] !== 'move' || canonicalJson(x['what']) !== canonicalJson(last['what']) || notWideReplacement([last], [x], undefined) !== null) return null;
  return [x];
}

/**
 * CLOUD C9 (CR 608.2c, 400.7j): the names of a sentence that restates the replaced sentence `ys` instruction for instruction. Its "it" may have been read as the
 * object a move of `ys` moved ("Search ..., reveal it, put it into your hand, then shuffle. If C, instead search ..., put it into your hand, then shuffle.": the
 * second "put it" names the card the first sentence put into the hand); in the branch that replaces `ys` that name is not bound, and the object meant is the one
 * the move would have moved, named in this branch by the instruction at the same place (the second search). And each instruction of `xs` binds the name its
 * counterpart in `ys` binds, so a later sentence reads either branch's object. A reference that cannot be mapped so stays as it is (the lint refuses it).
 */
function alignNames(ys: readonly Rec[], xs: readonly Rec[]): Rec[] {
  const bound = new Set<string>();
  return xs.map((x0, i) => {
    let x = rewrite(x0, (node) => {
      if (node['ref'] !== 'bound' || typeof node['name'] !== 'string' || bound.has(node['name'])) return undefined;
      const y = ys.find((s) => s['as'] === node['name']);
      const what = y !== undefined && y['op'] === 'move' && isRec(y['what']) ? y['what'] : undefined;
      return what !== undefined && what['ref'] === 'bound' && typeof what['name'] === 'string' && bound.has(what['name']) ? clone(what) : undefined;
    }) as Rec;
    const y = ys[i];
    if (y !== undefined && typeof y['as'] === 'string' && x['op'] === y['op'] && x['as'] === undefined) x = { ...x, as: y['as'] };
    if (typeof x['as'] === 'string') bound.add(x['as']);
    return x;
  });
}

/**
 * r5-repl INTERFACE CHANGE (additive, opt-in): `"@byOp": {"<op>": {...}, ...}` at the top of a patch holds one patch per op the template's `attachTo` lists, and
 * the one for the previous step's op is merged with the rest of the patch (it may carry its own `@require`). One wording that modifies different instructions in
 * different places: "If that spell would be put into a graveyard, exile it instead." after "you may cast target instant card from your graveyard" (the cast
 * step's `graveyardInstead`) and after "You may cast it this turn" (the permission's, `effects.0.graveyardInstead`), CR 614.1a. Two templates with the same
 * words would be ambiguous (G5). An op with no patch refuses the rider.
 */
function byOp(patch: Rec, last: Rec): Rec {
  const by = patch['@byOp'];
  if (by === undefined) return patch;
  const { '@byOp': _by, ...rest } = patch;
  const own = isRec(by) ? by[String(last['op'])] : undefined;
  if (!isRec(own)) throw new RiderRefused(`"@byOp" has no patch for a ${String(last['op'])} step`);
  return { ...rest, ...own };
}

/**
 * std-exile-play-2-1 INTERFACE CHANGE (additive, opt-in): `"@oneOf": [patch, ...]` at the top of a patch lists patches for different shapes of the previous step,
 * each with its own `@require`; the first whose `@require` holds is merged with the rest of the patch. One wording that modifies different instructions:
 * "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost." after "You may look at the top card of your library any time. You
 * may play lands and cast spells from the top of your library." (the top-card permission's cost) and after "You may play those cards this turn." (the permission for
 * the named cards), CR 118.9. Two templates with the same words would be ambiguous (G5). None holding refuses the rider.
 */
function oneOf(patch: Rec, last: Rec): Rec {
  const alts = patch['@oneOf'];
  if (alts === undefined) return patch;
  const { '@oneOf': _alts, ...rest } = patch;
  if (!Array.isArray(alts)) throw new RiderRefused('"@oneOf" is not a list');
  for (const a of alts) {
    if (!isRec(a)) throw new RiderRefused('"@oneOf" holds a patch that is not an object');
    try {
      checkRequired(last, a['@require']);
    } catch (e) {
      if (e instanceof RiderRefused) continue;
      throw e;
    }
    return { ...rest, ...a };
  }
  throw new RiderRefused('no shape of "@oneOf" fits the previous step');
}

/** edh-zones-25: how many sentences with steps a rider's `"@unit": -n` skips before the one it modifies (0 without it; a value that is not an integer below -1 skips more than there are: no sentence). */
function unitBack(patch: Rec): number {
  const v = patch['@unit'];
  if (v === undefined) return 0;
  return typeof v === 'number' && Number.isInteger(v) && v < -1 ? -v - 1 : Number.MAX_SAFE_INTEGER;
}

/** M6-8: the step a patch names, counted from the end of the previous sentence (-1: the last); null for a value that is not a negative integer. */
function stepBack(patch: Rec): number | null {
  const v = patch['@step'];
  if (v === undefined) return -1;
  return typeof v === 'number' && Number.isInteger(v) && v < 0 ? v : null;
}

/**
 * FAST5 T45 INTERFACE CHANGE (additive, opt-in): `"@into": true` at the top of a patch lets a rider whose `attachTo` op is not the previous step's own op
 * reach the instruction inside a wrapper that only decides whether or when it happens: "you may copy it. You may choose new targets for the copy."
 * (`may.do`), "when you next cast a spell this turn, copy it. You may choose new targets for the copy." (`delay.do`), "you may pay {1}. If you do, copy
 * that spell. You may choose new targets for the copy." (`pay.then`), "if C, copy it. ..." (`if.then`). The instruction must be the LAST one of that
 * branch and the wrapper must have no other branch (an `else` / `otherwise` would leave it unknown which branch the sentence speaks of).
 * Returns the list holding the instruction and its index, or null (the rider is then manual as before).
 */
/** edh-next-65: the last instruction of a delayed trigger's `do` when it is of the op `op` (and the delayed trigger has no other shape): where a rider after an "instead" fold of delayed copies acts. */
function delayedInner(step: Rec, op: string): { holder: Rec[]; at: number } | null {
  if (step['op'] !== 'delay' || !Array.isArray(step['do']) || step['do'].length === 0) return null;
  const list = step['do'] as unknown[];
  const inner = list[list.length - 1];
  return isRec(inner) && inner['op'] === op ? { holder: list as Rec[], at: list.length - 1 } : null;
}

function innerStep(step: Rec, op: string): { holder: Rec[]; at: number } | null {
  let cur = step;
  for (let depth = 0; depth < 4; depth++) {
    // edh-cast-15 (CR 106.6, 707.10c; Sunken Palace): "Add {U}. When you spend this mana to cast a spell or activate an ability, copy that spell or ability. You may choose new targets for the copy.":
    // the instructions of the triggered ability the mana carries (`addMana.whenSpent.do`) are such a wrapper
    const spent = cur['op'] === 'addMana' && isRec(cur['whenSpent']) ? cur['whenSpent']['do'] : undefined;
    const key = cur['op'] === 'may' || cur['op'] === 'delay' ? 'do' : cur['op'] === 'pay' || cur['op'] === 'if' ? 'then' : spent !== undefined ? 'whenSpent' : null;
    if (key === null || cur['else'] !== undefined || cur['otherwise'] !== undefined) return null;
    const list = key === 'whenSpent' ? spent : cur[key];
    if (!Array.isArray(list) || list.length === 0 || !isRec(list[list.length - 1])) return null;
    const inner = list[list.length - 1] as Rec;
    if (inner['op'] === op) return { holder: list as Rec[], at: list.length - 1 };
    cur = inner;
  }
  return null;
}

/**
 * FAST5X E1 (CR 601.2c, 702.166d, 702.174m): "Counter target creature spell. If the gift was promised, instead counter target spell." The targets of the
 * replaced instruction Y are chosen only when the condition decided at announcement does NOT hold (Y is not done otherwise), as the targets of X are chosen
 * only when it does (lower/targets.ts gives them `onlyIf`). A target used by both branches is required either way.
 */
function onlyIfOfReplaced(d: Draft, step: Rec): void {
  if (step['op'] !== 'if' || !isCastChoice(step['cond']) || !Array.isArray(step['else'])) return;
  const ids = (v: unknown, out: Set<string> = new Set()): Set<string> => {
    if (Array.isArray(v)) for (const x of v) ids(x, out);
    else if (isRec(v)) {
      if (v['ref'] === 'target' && typeof v['id'] === 'string') out.add(v['id']);
      for (const x of Object.values(v)) ids(x, out);
    }
    return out;
  };
  const inThen = ids(step['then']);
  const neg = { cond: 'not', of: clone(step['cond']) } as unknown as NonNullable<Draft['targets'][number]['onlyIf']>;
  for (const id of ids(step['else'])) {
    if (inThen.has(id)) continue;
    const spec = d.targets.find((t) => t.id === id);
    if (spec === undefined) continue;
    spec.onlyIf = spec.onlyIf === undefined ? neg : { cond: 'all', of: [spec.onlyIf, neg] };
  }
}

/** std-rx31: every object node of a value, depth first. */
function visitRecs(v: unknown, f: (n: Rec) => void): void {
  if (Array.isArray(v)) { for (const x of v) visitRecs(x, f); return; }
  if (!isRec(v)) return;
  f(v);
  for (const x of Object.values(v)) visitRecs(x, f);
}

/** CLOUD std-msh: a patch that only adds the `else` branch of an `if` step (`{"else": {"@new": [...]}}`, the rider fl.otherwise). */
function isOtherwisePatch(patch: Rec): boolean {
  const keys = Object.keys(patch);
  const e = patch['else'];
  return keys.length === 1 && keys[0] === 'else' && isRec(e) && Object.keys(e).length === 1 && Array.isArray(e['@new']);
}

/**
 * Cloud std-woe (CR 614.15, 608.2c): "Look at the top four cards of your library. If this spell was bargained, look at the top eight cards of your library instead. Put two
 * of them into your hand ...". The anaphora pass (before this one) bound "them" to the replaced instruction, the only one it saw; once the self-replacement makes it
 * `if C then [X] else [Y]`, the later sentence means what was done either way, so X (the same instruction with another amount, one step, no name of its own) gets Y's
 * name. Only when a later sentence of the same sequence uses that name: otherwise the program stays as it was.
 */
function sameNameInBoth(last: Rec, merged: Rec, later: readonly Unit[]): void {
  const name = last['as'];
  const then = merged['then'];
  if (merged['op'] !== 'if' || typeof name !== 'string' || !Array.isArray(then) || then.length !== 1 || !isRec(then[0])) return;
  const x = then[0];
  if (x['op'] !== last['op'] || x['as'] !== undefined) return;
  const uses = (v: unknown): boolean => (Array.isArray(v) ? v.some(uses) : isRec(v) && ((v['ref'] === 'bound' && v['name'] === name) || Object.values(v).some(uses)));
  if (later.some((u) => uses(u.steps) || (u.rider !== undefined && uses(u.rider.patch)))) x['as'] = name;
}

/** Pass 4. */
export function lowerRiders(input: Draft): Draft {
  const d = cloneDraft(input);
  for (const seq of sequences(d)) {
    // CLOUD C9: the `if` each "instead" sentence was folded into, by the index of that sentence's unit
    const folds = new Map<number, Rec>();
    seq.forEach((u, i) => {
      if (u.manual || !u.rider) return;
      // edh-zones-25 INTERFACE CHANGE (additive, opt-in): `"@unit": -n` (n >= 2) names the n-th sentence back that has steps, when the sentences between are plain
      // automated instructions ("Search ..., reveal those cards, and put one onto the battlefield tapped and the rest into your hand. Then shuffle. If C, search ... instead
      // of two." modifies the search of the first sentence, over the continuation "Then shuffle." that is a sentence of its own, CR 608.2c, 614.15); a rider or a manual sentence
      // in between refuses
      const eligible = seq.slice(0, i).reverse().filter((p) => p.manual !== undefined || p.steps.length > 0);
      const skip = unitBack(u.rider.patch);
      const prev = skip === 0 ? eligible[0] : eligible.slice(0, skip).every((p) => p.manual === undefined && p.rider === undefined) ? eligible[skip] : undefined;
      const back = stepBack(u.rider.patch); // M6-8: "@step" (file comment); -1 is the last step
      let at = prev && !prev.manual && back !== null ? prev.steps.length + back : -1;
      // edh-cast-1 INTERFACE CHANGE (additive, opt-in): `"@alsoStep": -2` lets a rider whose `attachTo` op is not the previous sentence's last step reach the step before it, when that
      // one is of the op: "Copy target instant or sorcery spell, then return it to its owner's hand. You may choose new targets for the copy." (the copy comes first, the return of
      // the original after it, CR 608.2c, 707.10c). Only when the last step is not of the op; the rider's own checks (`@require`) still apply.
      const also = u.rider.patch['@alsoStep'];
      if (prev && !prev.manual && back === -1 && at >= 0 && typeof also === 'number' && Number.isInteger(also) && also < -1 && u.rider.attachTo !== undefined) {
        const ops = u.rider.attachTo.split('|');
        const cur = prev.steps[at];
        const other = prev.steps[prev.steps.length + also];
        if (cur !== undefined && !ops.includes(String(cur['op'])) && other !== undefined && ops.includes(String(other['op']))) at = prev.steps.length + also;
      }
      let holder: Rec[] = prev?.steps ?? [];
      let hat = at;
      let last = at >= 0 ? prev!.steps[at] : undefined;
      let unlessElse = false;
      let elseBranch: { holder: Rec[]; at: number } | undefined; // edh-cast-12: the other branch of an "instead" fold a rider with `@eachBranch` modifies too
      // FAST5 T47 (CR 608.2c, 608.2d): a rider after "you may [do X]" modifies X, the one instruction inside the choice ("Then you may have it become a 0/0
      // Elemental creature until end of turn. It's still a land."); it is applied there when the `may` itself is not what the template attaches to
      const through = last !== undefined && u.rider.attachTo !== undefined && last['op'] === 'may' && u.rider.attachTo !== 'may' && Array.isArray(last['do'])
        && last['do'].length === 1 && isRec(last['do'][0]) && last['do'][0]['op'] === u.rider.attachTo;
      // r3-static (CR 608.2c, 608.2h): a rider after "..., where X is ..." modifies the one instruction the "where X is" intermediate holds (lowered by a later pass,
      // lower/where-x.ts): "Create X 1/1 Pilot creature tokens, where X is .... The tokens have "..."" gives the tokens the abilities
      const whereX = last !== undefined && !through && u.rider.attachTo !== undefined && last['lower'] === 'whereX' && last['op'] === undefined && Array.isArray(last['steps'])
        && last['steps'].length === 1 && isRec(last['steps'][0]) && last['steps'][0]['op'] === u.rider.attachTo && u.rider.patch['@replace'] === undefined;
      // edh-d-90 (CR 106.4, 500.5, 608.2c; Colossal Plow): "Whenever ~ attacks, add {W}{W}{W} and you gain 3 life. Until end of turn, you don't lose this mana as steps and phases end.": "this mana"
      // is the mana of the sentence's ONE `addMana` step, followed only by a gain or loss of life or a draw (which add no mana): the rider modifies that step
      const manaAt = !through && !whereX && last !== undefined && u.rider.attachTo === 'addMana' && last['op'] !== 'addMana' && holder !== undefined && hat === holder.length - 1 ? holder.findIndex((x) => isRec(x) && x['op'] === 'addMana') : -1;
      const manaBack = manaAt >= 0 && JSON.stringify(holder!).split('"addMana"').length === 2 && holder!.slice(manaAt + 1).every((x) => isRec(x) && MANA_RIDER_SKIPS.has(String(x['op'])) && x['guard'] === undefined);
      if (through) { holder = last!['do'] as Rec[]; hat = 0; last = holder[0]; }
      else if (whereX) { holder = last!['steps'] as Rec[]; hat = 0; last = holder[0]; }
      else if (manaBack) { hat = manaAt; last = holder![hat]; }
      // std-rg (CR 603.12, 608.2c): a rider after "When you do, you may cast target ... without paying its mana cost." modifies the instruction the reflexive trigger
      // carries out ("If that spell would be put into your graveyard, exile it instead."): the last instruction of its `do`, when that is what the template attaches to
      else if (last !== undefined && u.rider.attachTo !== undefined && last['op'] === 'reflexive' && u.rider.patch['@replace'] === undefined && Array.isArray(last['do']) && last['do'].length > 0
        && isRec(last['do'][last['do'].length - 1]) && u.rider.attachTo.split('|').includes(String((last['do'][last['do'].length - 1] as Rec)['op']))) {
        holder = last['do'] as Rec[]; hat = holder.length - 1; last = holder[hat];
      }
      else if (last !== undefined && u.rider.attachTo !== undefined && last['op'] !== u.rider.attachTo && u.rider.patch['@into'] === true && innerStep(last, u.rider.attachTo) !== null) {
        const inner = innerStep(last, u.rider.attachTo)!;
        holder = inner.holder; hat = inner.at; last = inner.holder[inner.at]; // T45: through "may" / "pay" / "if"
      } else if (last !== undefined && u.rider.patch['@replace'] === true && (last['op'] === 'pay' || last['op'] === 'if') && last['else'] === undefined && Array.isArray(last['then']) && last['then'].length === 1
        && isRec(last['then'][0]) && !['pay', 'may', 'if'].includes(String(last['then'][0]['op']))
        && !(holder === prev?.steps && at === holder.length - 1 && keywordChoiceGrant(holder) !== null) /* edh-next-141: the last grant of a keyword choice is not an "if you do" branch (applyRider) */) {
        // edh-replace-2 (CR 614.15, 608.2c): "You may pay {G/W}. If you do, put a +1/+1 counter on it. If it's a Unicorn, put two +1/+1 counters on it instead.": the
        // consequence of "if you do" (an `if` on the payment, which a later pass folds into the payment's `then`) is the one instruction the "instead" sentence replaces:
        // X replaces Y only where Y would happen (CR 614.15), so the replacement sits inside that branch. With several consequences which one is replaced would be a
        // guess, so only a branch with ONE
        holder = last['then'] as Rec[]; hat = 0; last = holder[0];
      } else if (last !== undefined && u.rider.attachTo !== undefined && last['op'] === 'pay' && !u.rider.attachTo.split('|').includes('pay') && u.rider.patch['@replace'] === undefined /* edh-d-5: attachTo may list several ops */
        && last['then'] === undefined && Array.isArray(last['else']) && last['else'].length === 1 && isRec(last['else'][0]) && u.rider.attachTo.split('|').includes(String(last['else'][0]['op']))) {
        // FAST5 T56 (CR 118.12a, 608.2c): "Counter target spell unless its controller pays {3}. If that spell is countered this way, exile it instead ...": the rider
        // modifies the instruction the "unless" wrapper (a `pay` whose `else` is that ONE instruction) carries out when the payer does not pay; `@replace` stays out
        holder = last['else'] as Rec[]; hat = 0; last = holder[0]; unlessElse = true;
      } else if (last !== undefined && u.rider.attachTo !== undefined && last['op'] === 'if' && last['op'] !== u.rider.attachTo && u.rider.patch['@replace'] === undefined
        // edh-players-18 (CR 608.2c; Neheb, Dreadhorde Champion): or an "If you do" sentence (a `did` condition, no `else`): "If you do, draw that many cards and add that much {R}. Until end of
        // turn, you don't lose this mana as steps and phases end." modifies the mana the branch added
        && (folds.get(i - 1) === last || ((u.rider.attachTo === 'addMana' || u.rider.attachTo === 'copy' /* edh-next-131 (CR 707.12, 608.2c; Blue Mage's Cane, Jacob Frye): "If you do, copy it. You may cast the copy." */) && isRec(last['cond']) && last['cond']['cond'] === 'did' && last['else'] === undefined)) && Array.isArray(last['then']) && last['then'].length > 0 && isRec(last['then'][last['then'].length - 1])
        && ((last['then'][last['then'].length - 1] as Rec)['op'] === u.rider.attachTo || delayedInner(last['then'][last['then'].length - 1] as Rec, u.rider.attachTo) !== null)) {
        // CLOUD C9 (CR 608.2c): a rider right after an "instead" sentence modifies that sentence's last instruction, in the branch that replaces the earlier one:
        // "If there are seven or more cards in your graveyard, instead destroy that creature. It can't be regenerated." (CR 701.19c)
        // edh-cast-12 INTERFACE CHANGE (additive, opt-in): `"@eachBranch": true` at the top of a patch makes such a rider modify the last instruction of the `else` branch too, when that
        // is also of the op the template attaches to: "Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead. You may
        // choose new targets for the copies." (CR 707.10c) speaks of the copies of either branch
        const fold = last;
        holder = last['then'] as Rec[]; hat = holder.length - 1; last = holder[hat];
        // edh-next-65 (CR 603.7b, 707.10c; Sea Gate Stormcaller): the instruction that replaces is a delayed trigger whose copy the rider modifies ("copy the next ... spell you cast this turn when you cast it.
        // If ~ was kicked, copy that spell twice instead. You may choose new targets for the copies.")
        const viaThen = last !== undefined && last['op'] !== u.rider.attachTo ? delayedInner(last, u.rider.attachTo) : null;
        if (viaThen !== null) { holder = viaThen.holder; hat = viaThen.at; last = holder[hat]; }
        const other = fold['else'];
        const otherLast = Array.isArray(other) && other.length > 0 && isRec(other[other.length - 1]) ? (other[other.length - 1] as Rec) : undefined;
        if (u.rider.patch['@eachBranch'] === true && Array.isArray(other) && otherLast !== undefined && otherLast['op'] === u.rider.attachTo) elseBranch = { holder: other as Rec[], at: other.length - 1 };
        else if (u.rider.patch['@eachBranch'] === true && otherLast !== undefined && delayedInner(otherLast, u.rider.attachTo) !== null) elseBranch = delayedInner(otherLast, u.rider.attachTo)!;
      }
      // CLOUD std-msh (CR 608.2c): "Create a tapped 2/1 Villain token if there are two or more creature cards in your graveyard. Otherwise, mill two cards.": a
      // guarded instruction ("X if C", the step's `guard`) is "if C, X", an `if` step whose one instruction is X, which "Otherwise, Y" completes with its `else`
      // (only a rider that attaches to `if` and adds nothing but a new `else`, fl.otherwise)
      if (last !== undefined && u.rider.attachTo === 'if' && last['op'] !== 'if' && isRec(last['guard']) && isOtherwisePatch(u.rider.patch)) {
        const { guard, ...bare } = last;
        last = { op: 'if', cond: guard, then: [bare] };
        // std-rx31 (CR 608.2c, 400.7): "Return it to the battlefield if it's an artifact creature card. Otherwise, return it to the battlefield and ...": in the branch
        // where the guarded move of a target did not happen, "it" (the name that move gives the card it moved) is that target itself, as for an "instead" fold (applyRider)
        // edh-next-144 (CR 608.2c, 400.7; Loyal Inventor): "Put that card into your hand if you control an Assassin. Otherwise, put that card on top of your library.": the same
        // holds for a card a step before named (a searched card, `{"ref": "bound"}`): where it was not moved, "that card" is still the card that step named
        const moved = bare['op'] === 'move' && typeof bare['as'] === 'string' && isRec(bare['what']) && (bare['what']['ref'] === 'target' || (bare['what']['ref'] === 'bound' && typeof bare['what']['name'] === 'string' && bare['what']['name'] !== bare['as'])) ? bare['as'] : null;
        if (moved !== null) {
          const target = bare['what'];
          u.rider.patch = rewrite(u.rider.patch, (n) => (n['ref'] === 'bound' && n['name'] === moved ? clone(target) : undefined)) as Rec;
        }
      }
      // std-rx31 INTERFACE CHANGE (additive, opt-in): `{"@before": [steps], "@require"?: {...}}` puts the rider's instructions right BEFORE the previous step instead of
      // merging into it: "Return up to two target creature cards from your graveyard to your hand. If this spell was bargained, you may put one of those cards with mana
      // value 4 or less onto the battlefield instead of putting it into your hand." (CR 608.2c, 614.15): the card put onto the battlefield instead is no longer in the
      // graveyard when the return runs (a new object, CR 400.7), so it alone is not returned. Only after the previous sentence's last step, of the op `attachTo`
      // names; a filter of the new steps that names the previous step's target ({"is": "@previous.what"}) must look in the zone that target's own description names
      if (u.rider.patch['@before'] !== undefined) {
        const refuse = (why: string): void => setManual(u, { code: 'no-template', reason: `the rider ${u.rider!.template} cannot modify the previous step: ${why} (CR 608.2c)` });
        if (last === undefined || prev === undefined || holder !== prev.steps || (hat !== prev.steps.length - 1 && !(typeof also === 'number' && hat === prev.steps.length + also /* edh-next-90: `@alsoStep` reached the step before the last ("..., put it into your hand, then shuffle.") */)) || (u.rider.attachTo !== undefined && !u.rider.attachTo.split('|').includes(String(last['op'])))) {
          refuse('it acts before the last instruction of the sentence before, which is not of its kind');
          return;
        }
        let before: unknown;
        try {
          checkRequired(last, u.rider.patch['@require']);
          before = resolvePrevious(u.rider.patch['@before'], last);
        } catch (e) {
          if (!(e instanceof RiderRefused)) throw e;
          refuse(e.message);
          return;
        }
        const what = last['what'];
        const spec = isRec(what) && what['ref'] === 'target' ? d.targets.find((t) => t.id === what['id']) : undefined;
        let zoneOk = Array.isArray(before) && before.every(isRec);
        visitRecs(before, (n) => {
          if (n['is'] === undefined || canonicalJson(n['is']) !== canonicalJson(what)) return;
          if (spec === undefined || n['zone'] === undefined || canonicalJson(n['zone']) !== canonicalJson(spec.filter?.zone)) zoneOk = false;
        });
        if (!zoneOk) { refuse('its group is not the zone the previous instruction moves its targets from'); return; }
        // edh-next-90 INTERFACE CHANGE (additive, opt-in): `"@guardPrevious": "unlessDid"` makes the previous step run only when the optional instruction the rider put before it
        // was not carried out ("You may put that card onto the battlefield instead of putting it into your hand if C", CR 614.15, 608.2d): the `may` of the inserted `if` records
        // whether it was done (`as`) and the previous step, which would move the same card a second time (the engine follows a card that moved), has the guard "if that was not done"
        if (u.rider.patch['@guardPrevious'] === 'unlessDid') {
          const inserted = (before as Rec[]).length === 1 ? (before as Rec[])[0] : undefined;
          if (inserted === undefined || inserted['op'] !== 'may' || inserted['as'] !== undefined || last['guard'] !== undefined) { refuse('the optional instruction it puts before the previous step cannot be told apart'); return; }
          const name = freshName(d, 'did');
          inserted['as'] = name;
          holder[hat] = { ...last, guard: { cond: 'did', step: name, not: true } };
        }
        holder.splice(hat, 0, ...(before as Rec[]));
        delete u.rider;
        u.steps = [];
        return;
      }
      // std-rx31 (CR 608.2c, 608.2d): "You may cast that card without paying its mana cost if .... Otherwise, put it into your hand.": after an optional cast of yours
      // (the last instruction of the sentence before, no condition of its own), "Otherwise" is "If you don't": the cast was declined or could not be made (a spell
      // over the mana value cap is not cast, effects/handlers/tokens-cast.ts). The sentence becomes an `if` on the cast's result; nothing is merged into the cast
      if (last !== undefined && u.rider.attachTo === 'if' && last['op'] === 'cast' && last['optional'] === true && last['guard'] === undefined
        && last['who'] !== undefined && isRec(last['who']) && last['who']['ref'] === 'you' && isOtherwisePatch(u.rider.patch) && holder === prev!.steps && hat === prev!.steps.length - 1) {
        const name = typeof last['as'] === 'string' ? last['as'] : freshName(d, 'did');
        holder[hat] = { ...last, as: name };
        u.steps = [{ op: 'if', cond: { cond: 'did', step: name, not: true }, then: clone((u.rider.patch['else'] as Rec)['@new']) }];
        delete u.rider;
        return;
      }
      // r4-repl (additive): `attachTo` may list alternatives, "createToken|copy" (one template for one wording; two templates with the same words would be ambiguous)
      if (last === undefined || (u.rider.attachTo !== undefined && !u.rider.attachTo.split('|').includes(String(last['op'])))) {
        setManual(u, {
          code: 'no-template',
          reason: last === undefined
            ? 'a rider sentence with no automated sentence before it to modify (CR 608.2c)'
            : `the rider ${u.rider.template} modifies a ${u.rider.attachTo} step, the previous step is ${String(last['op'])} (CR 608.2c)`,
        });
        return;
      }
      let merged: Rec;
      let sibling: Rec | undefined;
      let afterSteps: unknown;
      try {
        // edh-d-95 (CR 608.2c, 611.2): the instructions `"@after"` puts after the modified step may name parts of it too ("@previous.filter": "That spell can't be countered." after "The next
        // creature spell you cast this turn can be cast as though it had flash" is a second rider on the same next spell)
        afterSteps = u.rider.patch['@after'] === undefined ? undefined : resolvePrevious(u.rider.patch['@after'], last);
        const { '@step': _step, '@unit': _unit, '@alsoStep': _also, '@into': _into, '@eachBranch': _each, '@withPrevious': withPrevious, '@require': require, '@after': _after, ...patch } = byOp(oneOf(u.rider.patch, last), last);
        checkRequired(last, require);
        // edh-next-53 (CR 614.15, 608.2c; The Destined Black Mage): "~ deals 1 damage to each opponent. If C, it deals 3 damage to each opponent instead.": the "it" of the sentence that says what is
        // done instead is the source of the damage it replaces (the same damage is dealt, with another amount), not the event's subject the pronoun resolved to (a cast spell, a creature that died)
        const thenSteps = patch['then'];
        if (u.rider.patch['@replace'] === true && /\bit deals\b/i.test(u.text) && last['op'] === 'damage' && isRec(last['source']) && Array.isArray(thenSteps) && thenSteps.length === 1
          && isRec(thenSteps[0]) && thenSteps[0]['op'] === 'damage' && isRec(thenSteps[0]['source']) && thenSteps[0]['source']['ref'] === 'event') {
          patch['then'] = [{ ...thenSteps[0], source: clone(last['source']) }];
        }
        // CLOUD C9: the whole previous sentence when the rider acts on its last top-level step itself (an "instead" fold may then replace all of it)
        const sentence = holder === prev!.steps && hat === prev!.steps.length - 1 ? prev!.steps : undefined;
        merged = applyRider(last, patch, prev!.steps.length, d.spell === true, sentence);
        // edh-cast-15 INTERFACE CHANGE (additive, opt-in): `"@withPrevious": true` makes the same patch modify the instruction right before the step too, when it is of the same op ("copy all spells you
        // control, then copy all other activated and triggered abilities you control. You may choose new targets for the copies." speaks of the copies of both instructions, CR 707.10c)
        if (withPrevious === true) {
          const before = hat > 0 ? holder[hat - 1] : undefined;
          if (!isRec(before) || before['op'] !== last['op']) throw new RiderRefused('there is no instruction of the same kind right before it');
          sibling = applyRider(before, patch, prev!.steps.length, d.spell === true);
        }
        if (elseBranch !== undefined) {
          const e = elseBranch.holder[elseBranch.at]!;
          // (an instruction with no count has none to carry over: one copy)
          const own: Rec = { ...patch };
          if (own['count'] === '@previous.count' && e['count'] === undefined) delete own['count'];
          elseBranch.holder[elseBranch.at] = applyRider(e, own, prev!.steps.length, d.spell === true);
        }
      } catch (e) {
        if (!(e instanceof RiderRefused)) throw e;
        setManual(u, { code: 'no-template', reason: `the rider ${u.rider.template} cannot modify the previous step: ${e.message} (CR 608.2c)` });
        return;
      }
      // edh-misc-4 (CR 608.2c, 608.2d; Treasure Chest, Fecund Greenshell, Aid from the Cowl rulings; owner's standing rule 2026-10-27, a recorded G10 change): "If C, you may
      // put it onto the battlefield. Otherwise, put it into your hand.": "Otherwise" is whether the card was put onto the battlefield, so the second instruction also
      // happens when you decline the first. The `may` (the last instruction of the branch; yours, one move) gets the other instruction as its `otherwise`, which runs when
      // the option was declined or could not be carried out; the `else` stays for the condition not holding. Said once again by the renderer (render/steps-flow.ts#otherwiseEcho).
      if (isOtherwisePatch(u.rider.patch) && merged['op'] === 'if' && Array.isArray(merged['then']) && Array.isArray(merged['else'])) {
        const may = merged['then'][merged['then'].length - 1];
        if (isRec(may) && may['op'] === 'may' && isRec(may['who']) && may['who']['ref'] === 'you' && Object.keys(may['who']).length === 1 && may['otherwise'] === undefined
          && may['anyOne'] === undefined && may['villainous'] === undefined && Array.isArray(may['do']) && may['do'].length === 1 && isRec(may['do'][0]) && may['do'][0]['op'] === 'move'
          && isRec(merged['cond']) && merged['cond']['cond'] === 'matches' && isRec(may['do'][0]['what']) && JSON.stringify(may['do'][0]['what']) === JSON.stringify(merged['cond']['object']) // (a test of the very card the option moves, as in the rulings)
          && !JSON.stringify(merged['else']).includes('"ref":"target"')) {
          merged['then'][merged['then'].length - 1] = { ...may, otherwise: clone(merged['else']) };
        }
      }
      // edh-replace-2 (CR 614.15, 608.2c; review): a swap of one instruction of you by another of you ("Scry 1. If C, draw a card instead.") is read only when nothing before the replaced
      // sentence is an instruction of that kind: "Draw a card. You gain 2 life. If C, draw two cards instead." replaces the draw, not the life gain
      const youOps = ['scry', 'surveil', 'draw', 'mill', 'gainLife', 'loseLife'];
      const thenOp = Array.isArray(merged['then']) && isRec(merged['then'][0]) ? merged['then'][0]['op'] : undefined;
      if (u.rider.patch['@replace'] === true && merged['op'] === 'if' && merged['then'] !== undefined && Array.isArray(merged['else']) && merged['else'].length === 1 && isRec(merged['else'][0])
        && thenOp !== merged['else'][0]['op'] && youOps.includes(String(thenOp)) && youOps.includes(String(merged['else'][0]['op']))
        && (seq.slice(0, i).some((p) => p !== prev && p.steps.some((x) => youOps.includes(String(x['op'])))) || (prev !== undefined && prev.steps.slice(0, -1).some((x) => youOps.includes(String(x['op'])))))) {
        setManual(u, { code: 'no-template', reason: `the rider ${u.rider.template} cannot modify the previous step: an earlier instruction of the same kind makes it unclear which one "instead" replaces (CR 614.15, 608.2c)` });
        return;
      }
      sameNameInBoth(last, merged, seq.slice(i + 1));
      // CLOUD C9 (CR 608.2c, 614.15): an "instead" fold after a sentence of several instructions replaces all of them by the one `if`
      // r4-repl: unless it replaces only the last instruction (`else` is that one step, riders.ts#movesTheOnlyMoved)
      if (u.rider.patch['@replace'] === true && holder === prev!.steps && prev!.steps.length > 1 && !(Array.isArray(merged['else']) && merged['else'].length === 1)) prev!.steps.splice(0, prev!.steps.length, merged);
      else holder[hat] = merged;
      // edh-d-43 INTERFACE CHANGE (additive, opt-in): `"@after": [steps]` also puts instructions right AFTER the modified step, in the same holder: "If that spell is countered this way, exile it
      // instead of putting it into its owner's graveyard, then you may cast it without paying its mana cost." (CR 608.2c, 614.15) changes where the spell goes, then the cast follows
      const after = afterSteps;
      if (Array.isArray(after) && after.every(isRec) && u.rider.patch['@replace'] === undefined) holder.splice(hat + 1, 0, ...(clone(after) as Rec[]));
      if (sibling !== undefined) holder[hat - 1] = sibling;
      if (u.rider.patch['@replace'] === true && holder === prev!.steps) folds.set(i, merged);
      if (d.spell === true && !unlessElse) onlyIfOfReplaced(d, merged);
      delete u.rider;
      u.steps = [];
    });
  }
  // edh-replace-2 (CR 614.6, 700.4; review of Burn from Within): "If that creature would die this turn, exile it instead." after "If a creature is dealt damage this way, ..." is about the
  // creature the damage step really dealt damage to, not about its target: the shield is made for the objects the step bound (`as`), so it does nothing for damage that was prevented
  for (const seq of sequences(d)) {
    const damaged = new Map<string, Rec>();
    const armed = new Set<string>();
    for (const u of seq) {
      for (const st of u.steps) {
        if (st['op'] === 'damage' && typeof st['as'] === 'string' && isRec(st['to']) && st['to']['ref'] === 'target') damaged.set(st['as'], st['to']);
        if (st['op'] === 'if' && isRec(st['cond']) && st['cond']['cond'] === 'exists') {
          const of = st['cond']['of'];
          const is = isRec(of) && isRec(of['filter']) ? of['filter']['is'] : undefined;
          if (isRec(is) && is['ref'] === 'bound' && typeof is['name'] === 'string' && damaged.has(is['name'])) armed.add(is['name']);
        }
        if (st['op'] === 'effect' && Array.isArray(st['effects'])) {
          for (const e of st['effects']) {
            const subject = isRec(e) && e['s'] === 'replace' && isRec(e['replaces']) ? e['replaces']['subject'] : undefined;
            if (!isRec(subject) || !isRec(subject['is'])) continue;
            const name = [...armed].find((n) => canonicalJson(damaged.get(n)) === canonicalJson(subject['is']));
            if (name !== undefined) subject['is'] = { ref: 'bound', name };
          }
        }
      }
    }
  }
  fixDividedTotals(d);
  return d;
}

/**
 * edh-top-3 (CR 601.2d, 107.3, 614.15): "~ deals X damage divided as you choose among up to two target creatures and/or planeswalkers. If X is 6 or more, ~ deals twice X damage
 * divided as you choose among them instead." The division is announced with the targets, so its total is read from the X announced: the total of the spec (which lowerTargets set
 * from the first sentence's amount, X) is the amount of the branch that applies, `then` when X meets the number, else the amount of the previous sentence. Written with the
 * arithmetic the announcement reads (actions/announce-cond.ts#announceQty): B + (A - B) * min(1, floor(X / N)), exact for a whole number N of 1 or more and X of 0 or more.
 * Only an `if` step comparing the announced X with a number (`>=`) whose two branches are ONE divided-announced damage step each to the same target; any other shape is left as it
 * was (the lint, model/lint-nodes.ts, refuses a division that does not match a damage step).
 */
function fixDividedTotals(d: Draft): void {
  const dividedDamage = (steps: unknown): Rec | undefined => (Array.isArray(steps) && steps.length === 1 && isRec(steps[0]) && steps[0]['op'] === 'damage' && steps[0]['divided'] === 'announced' ? steps[0] : undefined);
  for (const seq of sequences(d)) for (const u of seq) {
    if (u.manual) continue;
    rewrite(u.steps, (node) => {
      if (node['op'] !== 'if' || !isRec(node['cond'])) return undefined;
      const c = node['cond'];
      const th = dividedDamage(node['then']);
      const el = dividedDamage(node['else']);
      if (th === undefined || el === undefined) return undefined;
      const to = th['to'];
      if (!isRec(to) || to['ref'] !== 'target' || JSON.stringify(to) !== JSON.stringify(el['to'])) return undefined;
      const spec = d.targets.find((s) => s.id === to['id']);
      if (spec?.divide === undefined || spec.divide.what !== 'damage') return undefined;
      // two divided-damage branches of one target whose condition is not "X is N or more" (N a whole number of 1 or more): the total announced would be X while a branch deals more,
      // so the sentence is manual (fail closed; review of edh-top-3: "If X is 0 or more, ...")
      if (c['cond'] !== 'compare' || c['op'] !== '>=' || !isRec(c['left']) || c['left']['q'] !== 'X' || typeof c['right'] !== 'number' || !Number.isInteger(c['right']) || c['right'] < 1) {
        setManual(u, { code: 'ambiguous', reason: 'the amount divided among the targets depends on a condition the announcement cannot read (CR 601.2d)' });
        return undefined;
      }
      const a = th['amount'] as Quantity;
      const b = el['amount'] as Quantity;
      const reaches = { q: 'math', op: 'min', args: [1, { q: 'math', op: 'floorDiv', args: [{ q: 'X' }, c['right']] }] };
      spec.divide = { what: 'damage', total: clone({ q: 'math', op: '+', args: [b, { q: 'math', op: '*', args: [{ q: 'math', op: '-', args: [a, b] }, reaches] }] }) as Quantity };
      return undefined;
    });
  }
}
