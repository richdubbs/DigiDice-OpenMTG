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
import { cloneDraft, isRec, MANA_COLOR_MARKER, QUOTED_LINK, rewrite, sequences } from './util';

/** The kinds "that type" may name (CR 205.3, 205.2a, 205.3i). */
const TYPE_KINDS: ReadonlySet<string> = new Set(['creatureType', 'cardType', 'landType']);

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
    if (n['q'] === 'chosenNumber' && n['link'] === '$link') {
      const links = [...new Set(producers.filter((p) => p.what === 'number').map((p) => p.link))];
      return links.length === 1 ? { ...n, link: links[0] } : undefined;
    }
    const c = n['chosen'];
    if (!isRec(c) || c['link'] !== '$link' || typeof c['quality'] !== 'string') return undefined;
    const q = c['quality'];
    // CLOUD C5 (CR 607.2d): "the chosen type" (`'$chosenType'`) is whichever type the linked choice chose: creature type ("choose a creature type"), card type
    // (Umori, "choose a card type") or land type
    const fits = producers.filter((p) => (q === '$type' || q === '$chosenType' ? TYPE_KINDS.has(p.what) : p.what === q));
    const links = [...new Set(fits.map((p) => p.link))];
    if (links.length !== 1) return undefined;
    const kind = fits[0]!.what;
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

function resolveSeq(units: Unit[], before: readonly Producer[]): void {
  const producers = [...before];
  for (const u of units) {
    if (u.manual) continue;
    u.steps = u.steps.map((s) => {
      const r0 = resolveIn(s, producers);
      const r = r0['op'] === 'createEmblem' ? resolveEmblemChoices(r0, producers) : r0;
      const p = producerOf(r);
      if (p) producers.push(p);
      return r;
    });
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
    if (n['q'] === 'chosenNumber' && n['link'] === '$link') return resolveIn(n, choices);
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

/** Pass 5b (after quantities): resolve the in-ability links, then (CLOUD C5) the ones another ability of the face makes as the object enters. Pure. */
export function lowerLinks(d: Draft): Draft {
  const out = cloneDraft(d);
  const seqs = sequences(out);
  for (const seq of seqs) resolveManaColor(seq); // std-mana-12
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
