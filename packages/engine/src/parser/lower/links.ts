/**
 * FAST5 T67: links inside one ability (CR 608.2c, 608.2d; CR 607.1 for the link id). A sentence that makes a choice as the ability resolves ("Choose a creature
 * type.", a `chooseValue` step with a `link`) is what a later sentence of the SAME ability means by "the chosen type" or "that type": the Filter hole writes
 * `{chosen: {link: '$link', quality}}` (parser/holes/filter.ts), and this pass replaces the placeholder by the link of the one earlier choice of that kind.
 * The value is read through the resolution's own choices (effects/api.ts#ExecCtx.choices), so it counts even if the source has left.
 *
 *  - Only a choice of an EARLIER step of the same step list (the main program, or the header and the bullet of one mode) is a candidate; a choice nested in a
 *    condition or a "may" is not (it may not have been made).
 *  - "that type" (`quality: '$type'`) is a creature, card or land type, whichever kind the earlier choice was; so is "the chosen type" (`'$chosenType'`,
 *    CLOUD C5; parser/holes/filter.ts#CHOSEN).
 *  - Zero or several candidates: nothing is replaced, so the placeholder survives and normalize makes the sentence manual (never a guess, design 6.4).
 *  - Target specs are never touched: targets are chosen before the ability resolves (CR 601.2c), so no choice of the resolution can be read there.
 */
import type { Draft, Rec, Unit } from './types';
import { THAT_COLOR_QUALITY } from '../holes/core';
import { cloneDraft, isRec, MANA_COLOR_MARKER, QUOTED_LINK, rewrite, sequences } from './util';

/** The kinds "that type" may name (CR 205.3, 205.2a, 205.3i). */
const TYPE_KINDS: ReadonlySet<string> = new Set(['creatureType', 'cardType', 'landType', 'planeswalkerType' /* edh-d-94: CR 205.3j */]);

/** edh-zones-26 (CR 608.2c-d; Tibalt's Trickery): a template's "that many" naming the number the one earlier choice of the sequence picked (a build string cannot start with `$`). */
export const NUMBER_OF_EARLIER_CHOICE = '@producerNumber';

export interface Producer { link: string; what: string }

/** The choice a top-level step makes, if it is one with a link. */
function producerOf(step: Rec): Producer | null {
  return step['op'] === 'chooseValue' && typeof step['link'] === 'string' && typeof step['what'] === 'string' && step['guard'] === undefined
    ? { link: step['link'], what: step['what'] } : null;
}

/** Replace each `{link:'$link', quality}` of a `chosen` filter field whose kind has exactly one earlier producer. */
function resolveIn(step: Rec, producers: readonly Producer[]): Rec {
  return rewrite(step, (n) => {
    // CLOUD std-misc (CR 608.2c-d): "the chosen number" (`{q:'chosenNumber', link:'$link'}`) is the one earlier number choice of the sequence
    if (n['q'] === 'chosenNumber' && (n['link'] === '$link' || n['link'] === NUMBER_OF_EARLIER_CHOICE)) {
      const links = [...new Set(producers.filter((p) => p.what === 'number').map((p) => p.link))];
      return links.length === 1 ? { ...n, link: links[0] } : undefined;
    }
    // edh-players-8 (CR 607.2d, 608.2c; Skrelv): "hexproof from that color" is the color the one earlier "Choose a color." of the sequence chose (the quality `chosen:<link>` of
    // "the chosen color", read as the effect is created: effects/handlers/lasting-fix.ts#fixChosen)
    if (n['kind'] === 'keyword' && n['quality'] === THAT_COLOR_QUALITY) {
      const links = [...new Set(producers.filter((p) => p.what === 'color').map((p) => p.link))];
      return links.length === 1 ? { ...n, quality: `chosen:${links[0]}` } : undefined;
    }
    const c = n['chosen'];
    if (!isRec(c) || c['link'] !== '$link' || typeof c['quality'] !== 'string') return undefined;
    const q = c['quality'];
    // CLOUD C5 (CR 607.2d): "the chosen type" (`'$chosenType'`) is whichever type the linked choice chose: creature type ("choose a creature type"), card type
    // (Umori, "choose a card type") or land type
    // edh-d-95 (CR 208.1, 607.2d): "with power of the chosen quality" (`oddEvenPower`) reads the parity an "odd or even" choice chose, of the power
    const fits = producers.filter((p) => (q === '$type' || q === '$chosenType' ? TYPE_KINDS.has(p.what) : q === 'oddEvenPower' ? p.what === 'oddEven' : p.what === q));
    const links = [...new Set(fits.map((p) => p.link))];
    if (links.length !== 1) return undefined;
    const kind = q === 'oddEvenPower' ? q : fits[0]!.what;
    const out: Rec = {};
    for (const [k, v] of Object.entries(n)) out[k] = k === 'chosen' ? { link: links[0], quality: kind } : rewrite(v, () => undefined);
    // the rest of the node may hold another placeholder (a nested filter): resolve it too
    return resolveIn(out, producers);
  }) as Rec;
}

/**
 * std-rx9 (CR 114.2, 607.2d, 608.2c): "the chosen type" inside the emblem an ability creates ("-6: Choose a creature type. You get an emblem with \"Creatures you
 * control of the chosen type get +3/+3.\"") is the choice an earlier instruction of the same ability made. The `createEmblem` handler stores that choice on the
 * emblem under its link (effects/handlers/game.ts), and the emblem's own abilities read their source's links (statics/match.ts#hasChosen). So every `chosen` of
 * the emblem's abilities must name such a choice: one that names none (the quoted placeholder of lower/quoted.ts, or a template's link of the object's own
 * entering choice, which an emblem never makes) becomes the one earlier choice of its kind; with zero or several, the quoted placeholder stays and the sentence
 * is manual (lower/normalize.ts). A `chosen` condition naming no earlier choice gets the placeholder too.
 */
function resolveEmblemChoices(step: Rec, producers: readonly Producer[]): Rec {
  const own = new Set(producers.map((p) => p.link));
  const walk = (v: unknown): unknown => rewrite(v, (n) => {
    if (n['cond'] === 'chosen' && typeof n['link'] === 'string' && !own.has(n['link'])) return { ...n, link: QUOTED_LINK };
    const c = n['chosen'];
    if (!isRec(c) || typeof c['link'] !== 'string' || typeof c['quality'] !== 'string' || own.has(c['link'])) return undefined;
    const q = c['quality'];
    const fits = producers.filter((p) => (q === '$type' || q === '$chosenType' ? TYPE_KINDS.has(p.what) : p.what === q));
    const links = [...new Set(fits.map((p) => p.link))];
    const chosen = links.length === 1 ? { link: links[0], quality: fits[0]!.what } : { link: QUOTED_LINK, quality: q };
    const out: Rec = {};
    for (const [k, x] of Object.entries(n)) out[k] = k === 'chosen' ? chosen : walk(x);
    return out;
  });
  return { ...step, abilities: walk(step['abilities']) };
}

/**
 * edh-c-65 (CR 608.2c-d; Dromar, the Banisher): a step list nested in a step ("You may pay {2}{U}. If you do, choose a color, then return all creatures of that color to
 * their owners' hands." is the `then` of the payment) is a sequence of its own: a choice in it is what a LATER step of the same nested list means by "that color". The choice
 * is never offered to steps outside the list (the branch may not run), as the top-level rule says of a choice nested in a condition.
 */
function resolveNested(value: unknown): unknown {
  if (Array.isArray(value)) {
    const isSteps = value.length > 1 && value.every((x) => isRec(x) && typeof x['op'] === 'string');
    const local: Producer[] = [];
    return value.map((x) => {
      const inner = resolveNested(x);
      if (!isSteps) return inner;
      const r = resolveIn(inner as Rec, local);
      const p = producerOf(r);
      if (p) local.push(p);
      return r;
    });
  }
  if (!isRec(value)) return value;
  const out: Rec = {};
  for (const [k, x] of Object.entries(value)) out[k] = resolveNested(x);
  return out;
}

function resolveSeq(units: Unit[], before: readonly Producer[]): void {
  const producers = [...before];
  for (const u of units) {
    if (u.manual) continue;
    u.steps = u.steps.map((s) => {
      const r0 = resolveNested(resolveIn(s, producers)) as Rec;
      const r = r0['op'] === 'createEmblem' ? resolveEmblemChoices(r0, producers) : r0;
      const p = producerOf(r);
      if (p) producers.push(p);
      return r;
    });
    // edh-zones-26: "that many" naming the number of a choice no earlier instruction of the sequence made reads nothing
    if (JSON.stringify(u.steps).includes(NUMBER_OF_EARLIER_CHOICE)) u.manual = { code: 'unbound-reference', reason: '"that many" names a number no earlier instruction chose (CR 608.2c)', unresolved: true };
  }
}

/** The producers of a step list (for the header of a modal ability). */
function producersOf(units: readonly Unit[]): Producer[] {
  return units.filter((u) => !u.manual).flatMap((u) => u.steps.map(producerOf).filter((p): p is Producer => p !== null));
}

/**
 * CLOUD C5 (CR 607.2d, 614.12a): "the chosen color" / "the chosen type" in an ability whose OWN steps make no choice of that kind is the value another ability of
 * the face chose: the one "As ~ enters, choose a color." of the face (`FaceInfo.choices`, set by parser/parse.ts#faceChoices from the face's other abilities).
 * Only a placeholder of a kind with exactly one such producer is replaced, and never "that type" (`'$type'`, an earlier sentence of the same ability). The
 * face pass checks afterwards that the producer really lowered with that link (parser/parse.ts#linkChosen); otherwise the reader is made manual.
 */
export function resolveFaceChoices<T>(value: T, choices: readonly Producer[] | undefined): T {
  if (choices === undefined || choices.length === 0) return value;
  return rewrite(value, (n) => {
    // std-rx5 (CR 607.2d, 614.12a): "the chosen number" of "As ~ enters, choose a number between 1 and 10."
    if (n['q'] === 'chosenNumber' && (n['link'] === '$link' || n['link'] === NUMBER_OF_EARLIER_CHOICE)) return resolveIn(n, choices);
    // edh-next-146 (CR 607.2d, 614.12a; Dauntless Bodyguard): "the chosen creature" (`{ref:'linked', link:'$link'}`) of the one "As ~ enters, choose another creature you control." of the face
    if (n['ref'] === 'linked' && n['link'] === '$link' && Object.keys(n).length === 2) {
      const objs = choices.filter((c) => c.what === 'object');
      return objs.length === 1 ? { ref: 'linked', link: objs[0]!.link } : undefined;
    }
    const c = n['chosen'];
    if (!isRec(c) || c['link'] !== '$link' || c['quality'] === '$type') return undefined;
    return resolveIn(n, choices);
  }) as T;
}

/** std-mana-12: the link of the color of the one mana of any color an `addMana` step added (`AddMana.link`), read as "that color". */
export const MANA_COLOR_LINK = 'manaColor';

/**
 * std-mana-12 (CR 106.1, 608.2c): "~ becomes that color until end of turn" after "Add one mana of any color." (template eff.stdmana12.self.becomesManaColor.eot writes
 * `colors: {chosen: '@manaColor'}`): "that color" is the color of that mana, so the `addMana` step right before it (one mana of any color, no condition) gets the link
 * MANA_COLOR_LINK and the marker becomes it. Anything else (colorless or fixed mana, several mana, no such step right before) leaves the marker, and normalize makes the
 * sentence manual.
 */
function resolveManaColor(units: Unit[]): void {
  let prev: Rec | undefined;
  for (const u of units) {
    if (u.manual) { prev = undefined; continue; }
    u.steps = u.steps.map((s) => {
      const uses = JSON.stringify(s).includes(JSON.stringify(MANA_COLOR_MARKER));
      const d = isRec(prev?.['dynamic']) ? prev!['dynamic'] : undefined;
      const units = Array.isArray(prev?.['units']) ? (prev!['units'] as unknown[]) : undefined;
      // one mana: one unit of colors only ("one mana of any color" is the unit [W, U, B, R, G]), or one mana of any color decided as it resolves
      const oneUnit = units !== undefined && units.length === 1 && Array.isArray(units[0]) && (units[0] as unknown[]).length > 0 && (units[0] as unknown[]).every((t) => typeof t === 'string' && 'WUBRG'.includes(t) && t.length === 1);
      const oneDynamic = d !== undefined && d['kind'] === 'anyColor' && d['count'] === 1 && d['from'] === undefined;
      const one = prev !== undefined && prev['op'] === 'addMana' && (oneUnit || oneDynamic) && prev['guard'] === undefined;
      let out = s;
      if (uses && one) {
        prev!['link'] = MANA_COLOR_LINK;
        out = rewrite(s, (n) => (isRec(n['colors']) && n['colors']['chosen'] === MANA_COLOR_MARKER ? { ...n, colors: { ...n['colors'], chosen: MANA_COLOR_LINK } } : undefined)) as Rec;
      }
      prev = out;
      return out;
    });
  }
}

/** edh-next-143: the instructions "each friend" / "each foe" may be the players of (see checkChoseWords). */
const FRIEND_OR_FOE_OPS: ReadonlySet<string> = new Set(['search', 'move', 'shuffle', 'sacrificeChoice', 'discard', 'draw', 'damage', 'loseLife', 'gainLife']);

/**
 * edh-players-13 (CR 608.2d): "For each player who chose fame" names a word that an EARLIER "Each opponent chooses fame or fortune." of the same ability offered: a `chose` reference
 * whose link no earlier choice among words made, or whose word it did not offer, keeps an `$chose` marker and the sentence stays manual (never a loop over nobody).
 */
function checkChoseWords(units: Unit[]): void {
  const offered = new Map<string, string[]>();
  for (const u of units) {
    if (u.manual) continue;
    u.steps = u.steps.map((s) => {
      // edh-next-143 (CR 608.2d, 101.4): "each friend" / "each foe" (the players "For each player, choose friend or foe." chose a word for) acts as a group only in the instructions
      // whose handlers do it for each player of the group, each with their own cards (a search, the move of what they found, a shuffle, a sacrifice, a discard, a draw, a life change,
      // damage to each of them: edh-next-143-scenarios.test.ts); in any other instruction (a choice of objects, ...) the sentence stays manual
      const friendOk = typeof s['op'] !== 'string' || FRIEND_OR_FOE_OPS.has(s['op']);
      const out = rewrite(s, (n) => {
        if (n['ref'] !== 'chose' || typeof n['link'] !== 'string') return undefined;
        if (n['link'] === 'friendOrFoe' && !friendOk) return { ...n, $chose: 'unoffered' };
        const words = offered.get(n['link']);
        return words !== undefined && typeof n['value'] === 'string' && words.includes(n['value']) ? undefined : { ...n, $chose: 'unoffered' };
      }) as Rec;
      if (out['op'] === 'chooseValue' && typeof out['link'] === 'string' && Array.isArray(out['options'])) offered.set(out['link'], (out['options'] as unknown[]).map(String));
      return out;
    });
  }
}

/** Pass 5b (after quantities): resolve the in-ability links, then (CLOUD C5) the ones another ability of the face makes as the object enters. Pure. */
export function lowerLinks(d: Draft): Draft {
  const out = cloneDraft(d);
  // edh-players-15 (CR 208.1; Éowyn, Fearless Knight): "with greater power" with nothing after it is more power than the creature whose triggered ability it is (the marker of
  // parser/holes/filter.ts); in an ability of anything else (a spell, an Aura or Equipment, an activated ability) it names no object, so the marker stays and the sentence is manual
  if (out.trigger !== undefined && out.selfHeads.includes('creature')) {
    const strip = (v: unknown): unknown => rewrite(v, (n) => {
      if (n['$greaterBare'] !== true) return undefined;
      const { $greaterBare: _m, ...rest } = n;
      return rest;
    });
    for (const u of out.units) if (!u.manual) u.steps = u.steps.map((s) => strip(s) as Rec);
    out.targets = out.targets.map((t) => strip(t) as typeof t);
  }
  const seqs = sequences(out);
  for (const seq of seqs) resolveManaColor(seq); // std-mana-12
  for (const seq of seqs) checkChoseWords(seq); // edh-players-13
  resolveSeq(seqs[0]!, []);
  const header = producersOf(out.units);
  for (const seq of seqs.slice(1)) resolveSeq(seq, header);
  // CLOUD C5: a kind the ability chooses itself is never read from another ability (the in-ability reading above decided it, or the sentence stays manual)
  const own = new Set(seqs.flatMap((seq) => producersOf(seq)).map((p) => p.what));
  const face = (out.faceChoices ?? []).filter((p) => !own.has(p.what));
  if (face.length > 0) {
    for (const seq of seqs) for (const u of seq) if (!u.manual) u.steps = u.steps.map((s) => resolveFaceChoices(s, face));
    // targets are chosen as the ability is put on the stack (CR 601.2c, 602.2b), after the object entered: the choice it made then can be read there
    out.targets = out.targets.map((t) => resolveFaceChoices(t, face));
  }
  return out;
}
