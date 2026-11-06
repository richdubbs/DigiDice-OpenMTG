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
 * types", "it doesn't copy", a condition ("if that creature doesn't have ..."), a color with any other tail ("a 3/3 black Zombie in addition to its other types": the color would
 * be set, not added).
 * Every parse is `weak` (design 6.3 rule 2): a template that spells the exceptions out keeps its sentence, so nothing that parsed before parses differently.
 */
import type { Alt, HoleCtx, HoleFn } from './core';
import { anyPhraseAt, dedupe, multiAt, P, phraseAt } from './core';
import { basePt } from './misc';

type Num = 'it' | 'token' | 'tokens' | 'each';
type Kind = 'notLegendary' | 'types' | 'pt' | 'has' | 'name' | 'typesSet' | 'power' | 'toughness' | 'colorlessSet';
interface Clause { end: number; kind: Kind; mods: unknown[] }

const W_IN_ADDITION_ITS = P('in addition to its other types');
const W_IN_ADDITION_ITS_CREATURE = P('in addition to its other creature types');
const W_IN_ADDITION_THEIR = P('in addition to their other types');
const W_IN_ADDITION_SELF = P("in addition to ~ 's other types"); // trek-16 (Voq, Ezri Dax): the copy's own name for "its", said of "it" only
const W_IN_ADDITION_COLORS = P('in addition to its other colors and types');
const W_THIS_ABILITY = P('this ability');
const W_AND_THIS_ABILITY = P('and this ability');
const W_LEGENDARY = P('legendary');
const W_A = [P('a'), P('an')];
const W_HAS = P('has');
const W_HAVE = P('have');
const W_AND = P('and');
const W_OTHER_ABILITIES = P("~ 's other abilities");
const W_NAME = [P('its name is ~'), P("~ 's name is ~"), P('his name is ~'), P('her name is ~')];
// edh-perms-5 (CR 707.9b, 107.1a; Saw in Half): "except their power is half that creature's power and their toughness is half that creature's toughness. Round up each time."
// edh-perms-7 (CR 707.9b, 205.1a, 613.1d; Imposter Mech): "it's a Vehicle artifact with crew 3 and it loses all other card types"; "it has vanishing 3 if that creature doesn't have vanishing" (CR 707.9f; Flesh Duplicate)
const W_WITH = P('with');
const W_LOSES_OTHER_TYPES = P('and it loses all other card types');
// edh-next-57 (CR 707.9b, 205.1a; Myrkul, Lord of Bones): "it's an enchantment and loses all other card types" (the subject of the second verb left out)
const W_LOSES_OTHER_TYPES_ELIDED = P('and loses all other card types');
const W_AND_IT_HAS = P('and it has'); // edh-mana-keywords-10
const W_IF_THAT_LACKS = [P("if that creature doesn't have"), P("if that permanent doesn't have")];
// edh-next-74 (CR 707.9b-c; Hulking Metamorph): "its power and toughness are equal to ~'s power and toughness": the copy keeps its own power and toughness (`retain`), the card's own as it enters (a prototyped card's, CR 718.3c)
const W_PT_EQUAL_SELF = P("its power and toughness are equal to ~ 's power and toughness");
const W_THEIR_POWER_HALF = P('their power is half');
const W_AND_THEIR_TOUGHNESS_HALF = P('and their toughness is half');
// edh-next-122 (CR 707.9b, 613.4b, 105.2c, 205.1a; Benthic Anomaly): "except its power is equal to the total power of those creatures, its toughness is equal to the total toughness of
// those creatures, and it's a colorless Eldrazi creature": a copiable base power and a base toughness, each a number worked out as the copy is made (CR 608.2h), and the card types and
// subtypes SET with no color (ruling 2024-06-07: "an Eldrazi creature instead of its other types and subtypes and is colorless"; supertypes kept). One token only
const W_ITS_POWER_EQUAL = P('its power is equal to');
const W_ITS_TOUGHNESS_EQUAL = P('its toughness is equal to');
const W_ITS_A_COLORLESS = [P("it's a colorless"), P('it is a colorless')];
const W_ROUND_EACH_TIME = [{ phrase: P('round up each time'), op: 'ceilDiv' as const }, { phrase: P('round down each time'), op: 'floorDiv' as const }];

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
  // edhd60 (CR 707.9b, 205.4a; Echoing Equation): a group that each become a copy, "except those creatures aren't legendary" (only the negative, the one wording printed)
  each: { has: [], is: [], isnt: [P("those creatures aren't"), P('those creatures are not')] },
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
      if (num === 'it' && color === undefined) tails.push(W_IN_ADDITION_SELF);
      const l4: Record<string, unknown> = { layer: 4 };
      if (legendary) l4['supertypes'] = { add: ['Legendary'] };
      if (ty.length > 0) l4['types'] = { add: ty };
      if (run.subs.length > 0) l4['subtypes'] = { add: run.subs };
      const mods: unknown[] = [l4];
      if (pt !== undefined) mods.push({ layer: '7b', power: pt.power, toughness: pt.toughness });
      if (color !== undefined) mods.push({ layer: 5, colors: { add: [color] } });
      const end = anyPhraseAt(ctx, at, tails);
      if (end >= 0) out.push({ end, mods });
      // edh-next-57 (CR 707.9b, 105.3, 205.1b; Kaya, Intangible Slayer; precedent edh-next-30): "it's a 1/1 white Spirit creature with flying in addition to its other types": a color named
      // beside "in addition to its other types" (not "colors and types") is SET: the copy is that color only; the types are added
      if (color !== undefined && !plural && ty.length > 0) {
        const setMods: unknown[] = [l4, ...(pt !== undefined ? [{ layer: '7b', power: pt.power, toughness: pt.toughness }] : []), { layer: 5, colors: { set: [color] } }];
        const endSet = anyPhraseAt(ctx, at, [W_IN_ADDITION_ITS]);
        if (endSet >= 0) out.push({ end: endSet, mods: setMods });
        const wSet = phraseAt(ctx, at, W_WITH);
        if (wSet >= 0) {
          for (const a of ctx.call('Abilities', wSet)) {
            if (!Array.isArray(a.value) || a.value.length === 0) continue;
            const endWith = anyPhraseAt(ctx, a.end, [W_IN_ADDITION_ITS]);
            if (endWith >= 0) out.push({ end: endWith, mods: [...setMods, { layer: 6, add: a.value }] });
          }
        }
      }
      // edh-next-130 (CR 707.9b, 205.1a, 105.2, 613.4b; Dino DNA): ONE token copy that "is a 6/6 green Dinosaur creature [with trample]" with no "in addition" tail: its card types and
      // subtypes, its color and its base power and toughness are SET (the ruling 2023-11-10: it copies the card "except the characteristics it specifically modifies"); a power and
      // toughness, a color and a card type all named. Supertypes are kept (none is named)
      if (num === 'token' && color !== undefined && pt !== undefined && ty.length > 0 && run.subs.length > 0) {
        const setAll: unknown[] = [{ layer: 4, types: { set: ty }, subtypes: { set: run.subs } }, { layer: '7b', power: pt.power, toughness: pt.toughness }, { layer: 5, colors: { set: [color] } }];
        const nx = ctx.toks[at];
        if (!(nx !== undefined && nx.kind === 'WORD' && nx.norm === 'in')) out.push({ end: at, mods: setAll });
        const wAll = phraseAt(ctx, at, W_WITH);
        if (wAll >= 0) {
          for (const a of ctx.call('Abilities', wAll)) {
            if (!Array.isArray(a.value) || a.value.length === 0) continue;
            const nx2 = ctx.toks[a.end];
            if (nx2 !== undefined && nx2.kind === 'WORD' && nx2.norm === 'in') continue; // "... with flying in addition to its other types" is the reading above
            out.push({ end: a.end, mods: [...setAll, { layer: 6, add: a.value }] });
          }
        }
      }
      // edh-perms-14 (CR 707.9b, 613.1f; Will of the Temur): "it's a 4/4 Dragon creature with flying in addition to its other types": the abilities of the new type, added (layer 6) with it
      const w = ty.length > 0 && !plural && color === undefined ? phraseAt(ctx, at, W_WITH) : -1;
      if (w >= 0) {
        for (const a of ctx.call('Abilities', w)) {
          if (!Array.isArray(a.value) || a.value.length === 0) continue;
          const endWith = anyPhraseAt(ctx, a.end, tails);
          if (endWith >= 0) out.push({ end: endWith, mods: [...mods, { layer: 6, add: a.value }] });
        }
      }
    }
  }
  return out;
}


/** edh-perms-7: "[legendary] <subtypes> <card types> [with <abilities>] and it loses all other card types" after "it's a" (the types are SET, CR 205.1a). */
function typesSetAt(ctx: HoleCtx, pos: number, spelledOnly = false): { end: number; mods: unknown[] }[] {
  const out: { end: number; mods: unknown[] }[] = [];
  const walk = (q: number, subs: string[]): void => {
    for (const m of multiAt(ctx, q, ctx.vocab.subtypes)) {
      if (m.entry.plural && !m.entry.both) continue;
      if (subs.length < 3) walk(m.end, [...subs, m.entry.name]);
      afterSubs(m.end, [...subs, m.entry.name]);
    }
  };
  const afterSubs = (q: number, subs: string[]): void => {
    const types: string[] = [];
    let e = q;
    for (;;) {
      const t = ctx.toks[e];
      const ent = t !== undefined && t.kind === 'WORD' ? ctx.vocab.types.get(t.norm) : undefined;
      if (ent === undefined || (ent.plural && !ent.both)) break;
      types.push(ent.name);
      e++;
    }
    for (let n = 1; n <= types.length; n++) {
      const at = q + n;
      const base: unknown[] = [{ layer: 4, types: { set: types.slice(0, n) }, subtypes: { set: subs } }];
      if (spelledOnly) { // edh-next-132: a token copy's one reading, no subtype and the spelled-out tail only
        const e = subs.length === 0 ? phraseAt(ctx, at, W_LOSES_OTHER_TYPES) : -1;
        if (e >= 0) out.push({ end: e, mods: [{ layer: 4, types: { set: types.slice(0, n) } }] });
        continue;
      }
      // edh-mana-keywords-10: with no subtype named only the "and it has <abilities>" tail below is a reading (a bare "it's an artifact and it loses all other card types" is not changed)
      const bare = subs.length === 0 ? -1 : phraseAt(ctx, at, W_LOSES_OTHER_TYPES);
      if (bare >= 0) out.push({ end: bare, mods: base });
      // edh-next-57 (CR 707.9b, 205.1a, 205.3d; Myrkul, Lord of Bones, Espers to Magicite): "it's an enchantment and loses all other card types" / "... and it loses all other card
      // types" with no subtype named: the card type is SET and the subtypes the new type does not allow go with the old types (statics/mods.ts#layer4, CR 205.3d); "and loses" leaves
      // the subject of the second verb out. The tail is what makes it a reading: a bare "it's an artifact" is still no reading (the new type would not be said to replace the old ones)
      if (subs.length === 0) {
        const e = anyPhraseAt(ctx, at, [W_LOSES_OTHER_TYPES, W_LOSES_OTHER_TYPES_ELIDED]);
        if (e >= 0) out.push({ end: e, mods: [{ layer: 4, types: { set: types.slice(0, n) } }] });
      } else {
        const e = phraseAt(ctx, at, W_LOSES_OTHER_TYPES_ELIDED);
        if (e >= 0) out.push({ end: e, mods: base });
      }
      const w = subs.length === 0 ? -1 : phraseAt(ctx, at, W_WITH);
      if (w >= 0) {
        for (const a of ctx.call('Abilities', w)) {
          if (!Array.isArray(a.value) || a.value.length === 0) continue;
          const end = phraseAt(ctx, a.end, W_LOSES_OTHER_TYPES);
          if (end >= 0) out.push({ end, mods: [...base, { layer: 6, add: a.value }] });
        }
      }
      // edh-mana-keywords-10 (CR 205.1a, 707.9b, 613.1f; Machine God's Effigy): "it's an artifact and it has "{T}: Add {U}."": no subtype named, no "loses all other card types", but
      // the copy gains abilities in the same exception: the card type is SET all the same (Oracle's reminder: "It's not a creature."; ruling 2022-10-14: it copies no card types and no
      // non-artifact subtypes). The abilities clause is part of this reading; the bare "it's an artifact" with no tail stays unparsed
      const has = subs.length === 0 ? phraseAt(ctx, at, W_AND_IT_HAS) : -1;
      if (has >= 0) {
        for (const a of ctx.call('Abilities', has)) {
          if (!Array.isArray(a.value) || a.value.length === 0) continue;
          out.push({ end: a.end, mods: [{ layer: 4, types: { set: types.slice(0, n) } }, { layer: 6, add: a.value }] });
        }
      }
    }
  };
  walk(pos, []);
  afterSubs(pos, []); // edh-mana-keywords-10: no subtype named
  return out;
}

/** The clauses that start at `pos`. */
function clausesAt(ctx: HoleCtx, pos: number, num: Num, elided: boolean, setTypes = false): Clause[] {
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
  // edh-perms-7 (CR 205.1a, 205.3d, 707.9b; Imposter Mech): "it's a Vehicle artifact with crew 3 and it loses all other card types": the new card type REPLACES the copied ones (so do the
  // subtypes of the old types), the optional "with <abilities>" gives the copy those abilities. Said of "it" only, never elided, and only with the "loses all other card types" tail
  // (a bare "it's an artifact" stays unparsed: that wording is not this reading)
  // edh-next-130 (CR 707.9b, 205.1a, 603.10a; Shelob, Child of Ungoliant): the same reading for ONE token copy of an object the template names as last on the battlefield ("a copy of that
  // creature", ruling 2023-06-16: "as it last existed on the battlefield"): `setTypes`, only from the hole `CopyExceptTokenSet` (never "that card", the edh-next-57 review)
  if ((num === 'it' || (num === 'token' && setTypes)) && !elided) { // edh-next-57 review: NOT for a token copy (Myrkul's "copy of that card" is read as the creature's last battlefield information, ruling 2022-06-10 wants the card: left manual)
    for (const p of subjects(ctx, pos, num, false, true, false)) {
      const art = anyPhraseAt(ctx, p, W_A);
      if (art >= 0) for (const t of typesSetAt(ctx, art)) out.push({ end: t.end, kind: 'typesSet', mods: t.mods });
    }
  }
  // edh-next-132 (CR 707.9b, 205.1a, 205.3d; Espers to Magicite): ONE token copy of a card, "except it's an artifact and it loses all other card types": the card type SET, no subtype named, the
  // second subject spelled out ("and it loses"); the elided "and loses" of a token copy stays unread (edh-next-57's review: Myrkul, Lord of Bones)
  if (num === 'token' && !elided) {
    for (const p of subjects(ctx, pos, num, false, true, false)) {
      const art = anyPhraseAt(ctx, p, W_A);
      if (art >= 0) for (const t of typesSetAt(ctx, art, true)) out.push({ end: t.end, kind: 'typesSet', mods: t.mods });
    }
  }
  // edh-perms-5 (CR 707.9b, 107.1a, 613.4b): "their power is half Q and their toughness is half Q'. Round up each time." several tokens only; the rounding is said by the sentence after
  // it (CR 107.1a: always stated), which the clause reads with it. A copiable base power and toughness (layer 7b) of two numbers worked out when the copies are made (CR 608.2h)
  if (num === 'tokens' && !elided) {
    const hp = phraseAt(ctx, pos, W_THEIR_POWER_HALF);
    for (const a of hp >= 0 ? ctx.call('Qty', hp) : []) {
      const and = phraseAt(ctx, a.end, W_AND_THEIR_TOUGHNESS_HALF);
      for (const b of and >= 0 ? ctx.call('Qty', and) : []) {
        const dot = ctx.toks[b.end];
        if (dot === undefined || dot.kind !== 'PUNCT' || dot.norm !== '.') continue;
        for (const r of W_ROUND_EACH_TIME) {
          const e = phraseAt(ctx, b.end + 1, r.phrase);
          if (e >= 0) out.push({ end: e, kind: 'pt', mods: [{ layer: '7b', power: { q: 'math', op: r.op, args: [a.value, 2] }, toughness: { q: 'math', op: r.op, args: [b.value, 2] } }] });
        }
      }
    }
  }
  // edh-next-122 (CR 707.9b, 613.4b, 608.2h; Benthic Anomaly): "its power is equal to <number>", "its toughness is equal to <number>" of one token, each its own clause (never elided)
  if (num === 'token' && !elided) {
    const pw = phraseAt(ctx, pos, W_ITS_POWER_EQUAL);
    for (const a of pw >= 0 ? ctx.call('Qty', pw) : []) if (a.value !== undefined && typeof a.value !== 'number') out.push({ end: a.end, kind: 'power', mods: [{ layer: '7b', power: a.value }] });
    const tg = phraseAt(ctx, pos, W_ITS_TOUGHNESS_EQUAL);
    for (const a of tg >= 0 ? ctx.call('Qty', tg) : []) if (a.value !== undefined && typeof a.value !== 'number') out.push({ end: a.end, kind: 'toughness', mods: [{ layer: '7b', toughness: a.value }] });
    // "it's a colorless <subtypes> <card types>": the types and subtypes SET (CR 205.1a), the colors none (CR 105.2c); a card type is required, no "in addition" tail
    const cl = anyPhraseAt(ctx, pos, W_ITS_A_COLORLESS);
    if (cl >= 0) {
      for (const m of multiAt(ctx, cl, ctx.vocab.subtypes)) {
        if (m.entry.plural && !m.entry.both) continue;
        const types: string[] = [];
        let q = m.end;
        for (;;) {
          const t = ctx.toks[q];
          const e = t !== undefined && t.kind === 'WORD' ? ctx.vocab.types.get(t.norm) : undefined;
          if (e === undefined || (e.plural && !e.both)) break;
          types.push(e.name);
          q++;
        }
        if (types.length === 0) continue;
        const next = ctx.toks[q];
        if (next !== undefined && next.kind === 'WORD' && next.norm === 'in') continue; // "... in addition to its other types" is another wording
        out.push({ end: q, kind: 'colorlessSet', mods: [{ layer: 4, types: { set: types }, subtypes: { set: [m.entry.name] } }, { layer: 5, colors: { set: [] } }] });
      }
    }
  }
  // edh-next-74 (CR 707.9c; Hulking Metamorph): "its power and toughness are equal to ~'s power and toughness": a copy of an object keeps its own power and toughness
  if (num === 'it' && !elided) {
    const e = phraseAt(ctx, pos, W_PT_EQUAL_SELF);
    if (e >= 0) out.push({ end: e, kind: 'pt', mods: [{ retain: ['power', 'toughness'] }] });
  }
  // CR 613.1f: "it has flying"
  for (const p of subjects(ctx, pos, num, elided, false, false)) {
    const h = phraseAt(ctx, p, num === 'tokens' ? W_HAVE : W_HAS);
    if (h < 0) continue;
    for (const a of ctx.call('Abilities', h)) {
      if (!Array.isArray(a.value) || a.value.length === 0) continue;
      out.push({ end: a.end, kind: 'has', mods: [{ layer: 6, add: a.value }] });
      // edh-perms-7 (CR 707.9f; Flesh Duplicate): "it has vanishing 3 if that creature doesn't have vanishing": judged on the copy without this exception
      const kw = a.value.length === 1 && (a.value[0] as { kind?: string }).kind === 'keyword' ? String((a.value[0] as { keyword?: string }).keyword) : '';
      const lacks = num === 'it' && /^[a-z]+$/.test(kw) ? anyPhraseAt(ctx, a.end, W_IF_THAT_LACKS) : -1;
      const named = lacks >= 0 ? phraseAt(ctx, lacks, P(kw)) : -1;
      if (named >= 0) out.push({ end: named, kind: 'has', mods: [{ if: { notKeyword: kw }, then: [{ layer: 6, add: a.value }] }] });
      // CR 707.9a: "it has flying and this ability" (the ability that makes the copy; a copy's own resolution stores it, effects/handlers/lasting.ts)
      const t = num === 'it' ? phraseAt(ctx, a.end, W_AND_THIS_ABILITY) : -1;
      if (t >= 0) out.push({ end: t, kind: 'has', mods: [{ layer: 6, add: a.value }, { thisAbility: true }] });
    }
    // edh-perms-3 (CR 613.1f, 707.9a; Sakashima of a Thousand Faces): "it has ~'s other abilities": copies of every other ability of the face (parser/parse.ts#fillOtherAbilities)
    const others = num === 'it' ? phraseAt(ctx, h, W_OTHER_ABILITIES) : -1;
    if (others >= 0) out.push({ end: others, kind: 'has', mods: [{ layer: 6, add: [], otherAbilitiesOfCard: true }] });
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

function exceptList(ctx: HoleCtx, pos: number, num: Num, setTypes = false): Alt[] {
  const out: Alt[] = [];
  const isComma = (p: number): boolean => ctx.toks[p]?.kind === 'PUNCT' && ctx.toks[p]!.norm === ',';
  // the clauses after `end` of a list whose clauses so far are `kinds` (`commas` of them followed by a comma): "A and B", "A, and B", "A, B, and C"
  const step = (end: number, mods: unknown[], kinds: Kind[], commas: number): void => {
    const later = (at: number): Clause[] => [...clausesAt(ctx, at, num, false, setTypes), ...clausesAt(ctx, at, num, true, setTypes)].filter((c) => c.kind !== 'name' && !kinds.includes(c.kind));
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
  for (const c1 of clausesAt(ctx, pos, num, false, setTypes)) {
    out.push({ end: c1.end, value: c1.mods, weak: 1 });
    step(c1.end, c1.mods, [c1.kind], 0);
  }
  return dedupe(out);
}

export const copyExcept: HoleFn = (ctx, pos) => exceptList(ctx, pos, 'it');
export const copyExceptToken: HoleFn = (ctx, pos) => exceptList(ctx, pos, 'token');
export const copyExceptTokens: HoleFn = (ctx, pos) => exceptList(ctx, pos, 'tokens');
export const copyExceptEach: HoleFn = (ctx, pos) => exceptList(ctx, pos, 'each'); // edhd60
/** edh-next-130 (CR 707.9b, 205.1a): one token copy whose exceptions may SET its card types ("it's a Food artifact with ... and it loses all other card types"); only after "a copy of that creature". */
// (only the lists that SET the card types: any other list is CopyExceptToken's, read by the older templates; two templates giving it would be two readings, G5)
export const copyExceptTokenSet: HoleFn = (ctx, pos) => exceptList(ctx, pos, 'token', true).filter((a) => Array.isArray(a.value) && (a.value as { layer?: unknown; types?: { set?: unknown } }[]).some((m) => m.layer === 4 && m.types?.set !== undefined));
