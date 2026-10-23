/**
 * p2-copy-perm-1 ADDITION: the copy-exception list holes (CR 707.9a-b), the words after "except" of a copy effect, as the `except` list of the copy model
 * (types/ability.ts#CopyExcept): one exception per clause, in Oracle's order.
 *   - `CopyExcept`: a copy said of "it" (a permanent entering as a copy, a permanent becoming one); `CopyExceptToken`: one token, "it" or "the token";
 *     `CopyExceptTokens`: several tokens, "they" or "the tokens".
 *   - Clauses: "it isn't legendary" / "it's not legendary" (CR 205.4a: the supertype removed); "it's a [legendary] [N/N] [<subtypes>] [<card types>] in
 *     addition to its other types" and "it's legendary in addition to its other types" (CR 205.1b: added, never set), with one color word only before
 *     "in addition to its other colors and types" (CR 105.3); "it's N/N" (CR 613.4b: a base power and toughness); "it has <keywords, quoted abilities>"
 *     (CR 613.1f), "[and] this ability" (CR 707.9a, one object only); "its name is ~" (CR 707.9b: the card's own name, as FAST5 T64 reads it).
 *   - A list: two clauses joined by "and" (", and" too), three or more with commas and ", and" before the last; a later clause may leave its subject out
 *     ("it isn't legendary, is a Spirit in addition to its other types, and has haste"); no kind of clause twice.
 * Everything else fails closed (no parse): a bare "it's an artifact" (CR 205.1a: the new type REPLACES the old ones, guide section 9), "loses all other card
 * types", "it doesn't copy", a condition ("if that creature doesn't have ..."), "it has ~'s other abilities", a color with any other tail ("a 3/3 black Zombie in addition to its other types": the color would
 * be set, not added).
 * Every parse is `weak` (design 6.3 rule 2): a template that spells the exceptions out keeps its sentence, so nothing that parsed before parses differently.
 */
import type { Alt, HoleCtx, HoleFn } from './core';
import { anyPhraseAt, dedupe, multiAt, P, phraseAt } from './core';
import { basePt } from './misc';

type Num = 'it' | 'token' | 'tokens';
type Kind = 'notLegendary' | 'types' | 'pt' | 'has' | 'name';
interface Clause { end: number; kind: Kind; mods: unknown[] }

const W_IN_ADDITION_ITS = P('in addition to its other types');
const W_IN_ADDITION_ITS_CREATURE = P('in addition to its other creature types');
const W_IN_ADDITION_THEIR = P('in addition to their other types');
const W_IN_ADDITION_COLORS = P('in addition to its other colors and types');
const W_THIS_ABILITY = P('this ability');
const W_AND_THIS_ABILITY = P('and this ability');
const W_LEGENDARY = P('legendary');
const W_A = [P('a'), P('an')];
const W_HAS = P('has');
const W_HAVE = P('have');
const W_AND = P('and');
const W_NAME = [P('its name is ~'), P("~ 's name is ~"), P('his name is ~'), P('her name is ~')];

/**
 * The subject and the verb "is" of a clause, each way Oracle spells them, by number, whether the subject is left out (a later clause), and the verb: `has` (the
 * subject alone, "it has"), `is` ("it's", "it is"), `isnt` ("it isn't", "it's not", "it is not"). The contractions are one word token each.
 */
const SUBJ: Record<Num, Record<'has' | 'is' | 'isnt', string[][]>> = {
  it: {
    has: [P('it'), P('~')],
    is: [P("it's"), P('it is'), P('~ is')],
    isnt: [P("it isn't"), P("it's not"), P('it is not'), P("~ isn't"), P('~ is not')],
  },
  token: {
    has: [P('it'), P('the token')],
    is: [P("it's"), P('it is'), P('the token is')],
    isnt: [P("it isn't"), P("it's not"), P('it is not'), P("the token isn't"), P('the token is not')],
  },
  tokens: {
    has: [P('they'), P('the tokens')],
    is: [P("they're"), P('they are'), P('the tokens are')],
    isnt: [P("they aren't"), P("they're not"), P('they are not'), P("the tokens aren't"), P('the tokens are not')],
  },
};
const ELIDED: Record<'one' | 'many', Record<'is' | 'isnt', string[][]>> = {
  one: { is: [P('is')], isnt: [P("isn't"), P('is not')] },
  many: { is: [P('are')], isnt: [P("aren't"), P('are not')] },
};

/** Positions where the predicate of a clause starts. */
function subjects(ctx: HoleCtx, pos: number, num: Num, elided: boolean, be: boolean, neg: boolean): number[] {
  if (elided && !be) return [pos];
  const verb = !be ? 'has' : neg ? 'isnt' : 'is';
  const phrases = elided ? ELIDED[num === 'tokens' ? 'many' : 'one'][verb as 'is' | 'isnt'] : SUBJ[num][verb];
  return phrases.map((ws) => phraseAt(ctx, pos, ws)).filter((e) => e >= 0);
}

/** "[legendary] [N/N] [<subtypes>] [<card types>] in addition to its other types" after "it's a": the layer 4 exception, and a 7b one for N/N. */
function typesAt(ctx: HoleCtx, pos: number, num: Num): { end: number; mods: unknown[] }[] {
  const out: { end: number; mods: unknown[] }[] = [];
  const plural = num === 'tokens';
  let p = pos;
  const legendary = !plural && phraseAt(ctx, p, W_LEGENDARY) >= 0;
  if (legendary) p++;
  const pts = basePt(ctx, p);
  const pt = pts[0];
  if (pt !== undefined) p = pt.end;
  // CR 105.3: one color word, which Oracle adds with "in addition to its other colors and types" (any other tail fails closed: the color would be set)
  const colorTok = ctx.toks[p];
  const color = !plural && colorTok?.kind === 'WORD' ? ctx.vocab.colors.get(colorTok.norm) : undefined;
  if (color !== undefined) p++;
  // every split of the run into singular subtypes, then card types (the last word is plural for several tokens)
  const subRuns: { end: number; subs: string[] }[] = [{ end: p, subs: [] }];
  const walkSubs = (q: number, acc: string[]): void => {
    for (const m of multiAt(ctx, q, ctx.vocab.subtypes)) {
      if (m.entry.plural && !m.entry.both) continue;
      const subs = [...acc, m.entry.name];
      subRuns.push({ end: m.end, subs });
      if (subs.length < 4) walkSubs(m.end, subs);
    }
  };
  walkSubs(p, []);
  for (const run of subRuns) {
    const types: string[] = [];
    let q = run.end;
    for (;;) {
      const t = ctx.toks[q];
      const e = t !== undefined && t.kind === 'WORD' ? ctx.vocab.types.get(t.norm) : undefined;
      if (e === undefined) break;
      types.push(e.name);
      q++;
      if (e.plural !== plural && !e.both) break;
    }
    // the type words: none, or a run whose last word agrees in number (a plural noun ends the description of several tokens)
    const lastOk = (n: number): boolean => {
      if (n === 0) return !plural;
      const e = ctx.vocab.types.get(ctx.toks[run.end + n - 1]!.norm)!;
      const inner = Array.from({ length: n - 1 }, (_, k) => ctx.vocab.types.get(ctx.toks[run.end + k]!.norm)!);
      return (e.plural === plural || e.both === true) && inner.every((x) => !x.plural || x.both === true);
    };
    for (let n = 0; n <= types.length; n++) {
      if (!lastOk(n)) continue;
      const ty = types.slice(0, n);
      if (ty.length === 0 && run.subs.length === 0 && !legendary) continue;
      if (ty.length === 0 && run.subs.length === 0 && pt !== undefined) continue; // "it's a legendary 3/3 in addition" is no Oracle wording
      const at = run.end + n;
      if (color !== undefined && ty.length + run.subs.length === 0) continue;
      const tails = color !== undefined ? [W_IN_ADDITION_COLORS] : plural ? [W_IN_ADDITION_THEIR] : ty.length === 0 && run.subs.length > 0 && !legendary ? [W_IN_ADDITION_ITS, W_IN_ADDITION_ITS_CREATURE] : [W_IN_ADDITION_ITS];
      const end = anyPhraseAt(ctx, at, tails);
      if (end < 0) continue;
      const l4: Record<string, unknown> = { layer: 4 };
      if (legendary) l4['supertypes'] = { add: ['Legendary'] };
      if (ty.length > 0) l4['types'] = { add: ty };
      if (run.subs.length > 0) l4['subtypes'] = { add: run.subs };
      const mods: unknown[] = [l4];
      if (pt !== undefined) mods.push({ layer: '7b', power: pt.power, toughness: pt.toughness });
      if (color !== undefined) mods.push({ layer: 5, colors: { add: [color] } });
      out.push({ end, mods });
    }
  }
  return out;
}

/** The clauses that start at `pos`. */
function clausesAt(ctx: HoleCtx, pos: number, num: Num, elided: boolean): Clause[] {
  const out: Clause[] = [];
  // CR 205.4a: "it isn't legendary"
  for (const p of subjects(ctx, pos, num, elided, true, true)) {
    const e = phraseAt(ctx, p, W_LEGENDARY);
    if (e >= 0) out.push({ end: e, kind: 'notLegendary', mods: [{ layer: 4, supertypes: { remove: ['Legendary'] } }] });
  }
  for (const p of subjects(ctx, pos, num, elided, true, false)) {
    // CR 205.1b: "it's a Spirit in addition to its other types", "it's legendary in addition to its other types", "they're 3/3 Dragon creatures in addition to ..."
    const art = num === 'tokens' ? p : anyPhraseAt(ctx, p, W_A);
    if (art >= 0) for (const t of typesAt(ctx, art, num)) out.push({ end: t.end, kind: 'types', mods: t.mods });
    if (num !== 'tokens' && phraseAt(ctx, p, W_LEGENDARY) >= 0) {
      const e = anyPhraseAt(ctx, p + 1, [W_IN_ADDITION_ITS]);
      if (e >= 0) out.push({ end: e, kind: 'types', mods: [{ layer: 4, supertypes: { add: ['Legendary'] } }] });
    }
    // CR 613.4b: "it's 1/1"
    for (const b of basePt(ctx, p)) out.push({ end: b.end, kind: 'pt', mods: [{ layer: '7b', power: b.power, toughness: b.toughness }] });
  }
  // CR 613.1f: "it has flying"
  for (const p of subjects(ctx, pos, num, elided, false, false)) {
    const h = phraseAt(ctx, p, num === 'tokens' ? W_HAVE : W_HAS);
    if (h < 0) continue;
    for (const a of ctx.call('Abilities', h)) {
      if (!Array.isArray(a.value) || a.value.length === 0) continue;
      out.push({ end: a.end, kind: 'has', mods: [{ layer: 6, add: a.value }] });
      // CR 707.9a: "it has flying and this ability" (the ability that makes the copy; a copy's own resolution stores it, effects/handlers/lasting.ts)
      const t = num === 'it' ? phraseAt(ctx, a.end, W_AND_THIS_ABILITY) : -1;
      if (t >= 0) out.push({ end: t, kind: 'has', mods: [{ layer: 6, add: a.value }, { thisAbility: true }] });
    }
    const self = num === 'it' ? phraseAt(ctx, h, W_THIS_ABILITY) : -1;
    if (self >= 0) {
      out.push({ end: self, kind: 'has', mods: [{ thisAbility: true }] });
      const and = phraseAt(ctx, self, W_AND);
      if (and >= 0) for (const a of ctx.call('Abilities', and)) if (Array.isArray(a.value) && a.value.length > 0) out.push({ end: a.end, kind: 'has', mods: [{ thisAbility: true }, { layer: 6, add: a.value }] });
    }
  }
  // CR 707.9b: "its name is ~", said once, first
  if (!elided && num === 'it') {
    const e = anyPhraseAt(ctx, pos, W_NAME);
    if (e >= 0) out.push({ end: e, kind: 'name', mods: [{ retain: ['name'] }] });
  }
  return out;
}

function exceptList(ctx: HoleCtx, pos: number, num: Num): Alt[] {
  const out: Alt[] = [];
  const isComma = (p: number): boolean => ctx.toks[p]?.kind === 'PUNCT' && ctx.toks[p]!.norm === ',';
  // the clauses after `end` of a list whose clauses so far are `kinds` (`commas` of them followed by a comma): "A and B", "A, and B", "A, B, and C"
  const step = (end: number, mods: unknown[], kinds: Kind[], commas: number): void => {
    const later = (at: number): Clause[] => [...clausesAt(ctx, at, num, false), ...clausesAt(ctx, at, num, true)].filter((c) => c.kind !== 'name' && !kinds.includes(c.kind));
    const bare = phraseAt(ctx, end, W_AND);
    const afterComma = isComma(end) ? end + 1 : -1;
    const commaAnd = afterComma >= 0 ? phraseAt(ctx, afterComma, W_AND) : -1;
    // the last clause; with three or more, Oracle writes the serial comma ("A, B, and C")
    for (const at of [commas === 0 ? bare : -1, commaAnd]) {
      if (at < 0) continue;
      for (const c of later(at)) out.push({ end: c.end, value: [...mods, ...c.mods], weak: 1 });
    }
    // a middle clause
    if (afterComma >= 0 && commaAnd < 0) for (const c of later(afterComma)) step(c.end, [...mods, ...c.mods], [...kinds, c.kind], commas + 1);
  };
  for (const c1 of clausesAt(ctx, pos, num, false)) {
    out.push({ end: c1.end, value: c1.mods, weak: 1 });
    step(c1.end, c1.mods, [c1.kind], 0);
  }
  return dedupe(out);
}

export const copyExcept: HoleFn = (ctx, pos) => exceptList(ctx, pos, 'it');
export const copyExceptToken: HoleFn = (ctx, pos) => exceptList(ctx, pos, 'token');
export const copyExceptTokens: HoleFn = (ctx, pos) => exceptList(ctx, pos, 'tokens');
