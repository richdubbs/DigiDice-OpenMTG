/**
 * FAST5X E23: the grammar of a mana spending restriction (CR 106.6), the holes `ManaSpend` and `SpellsCast`. Owner: FAST5X E23.
 *
 *   ManaSpend  ::= Clause ( Sep Clause )*            "spend this mana only to <ManaSpend>"
 *   Sep        ::= "or" | "or to" | "and"             (two clauses)   |   "," ... ", or" | ", or to" | ", and"   (three or more)
 *   Clause     ::= "cast" SpellsCast                                   spells (CR 601.2)
 *               | "activate" Abilities                                 activated abilities of sources (CR 602.1)
 *               | "turn" ("a permanent" | "permanents" | "a creature" | "creatures") "face up"     the special action (CR 116.2b, 702.37e, 708.7)
 *               | "unlock" ("a door" | "doors")                        the special action (CR 709.5e, 116.2m)
 *   SpellsCast ::= SpellNP ( "or" SpellNP )*                           "this mana can't be spent to cast <SpellsCast>"
 *   SpellNP    ::= a `Filter` noun phrase with the head "spell"/"spells" ("a"/"an" + singular, or a bare plural), then optionally
 *                  "with {X} in its mana cost" / "with {X} in their mana costs" (CR 107.3). A "from <zone>" post-modifier is the zone the spell is cast from
 *                  (CR 601.2a: `castFrom`).
 *   Abilities  ::= "abilities" | "an ability" | "an equip ability" | "equip abilities" (CR 702.6a)
 *               | "abilities of" SourceNP(plural) | "an ability of" SourceNP(singular)
 *   SourceNP   ::= a type noun phrase ("artifacts", "a creature", "an Elemental") | a type run + "source(s)" + post-modifiers ("a creature source of the chosen
 *                  type") | "a source" / "sources" + post-modifiers ("a source of the chosen type")
 *
 * The value of `ManaSpend` is a `ManaRestriction`; of `SpellsCast`, the spells' `ObjectFilter` (several descriptions are an `anyOf`). A spell description is
 * stored as the existing restrictions store it (no stack kind, no zone: the payment checks the spell being cast, rules/sources.ts#spendAllows), so a sentence a
 * fixed template of effect/mana.json also reads gives the same JSON (no ambiguity, guard G5). "a ... spell" and "... spells" describe the same spells. A
 * singular description coordinated with "and" ("an instant and sorcery spell") is not English for a set of spells and is refused.
 *
 * FAST5X E23 reconciled with FAST5 T48 (CR 106.6): the whole restriction is in one grammatical number, as Oracle prints every one ("cast an artifact spell or
 * activate an ability of an artifact source", "cast artifact spells or activate abilities of artifacts"; never "an artifact spell or activate abilities of
 * ..."), and clauses are joined by "and" only in the plural ("cast Elf spells and activate abilities of Elf sources", Woodland Weavemaster; "cast Room
 * spells and unlock doors", Smoky Lounge). A mixed or singular-"and" sentence is refused: Oracle prints none, and T48's reviewed guards keep them out.
 */
import type { ManaRestriction, ObjectFilter } from '../../types/ability';
import type { Alt, HoleCtx, HoleFn } from './core';
import { P, dedupe, mergeFilter, phraseAt } from './core';
import { npAlts, postModAt } from './filter';

const W_X_ITS = P('with {x} in its mana cost');
const W_X_THEIR = P('with {x} in their mana costs');
const W_FACE_UP = P('face up');
const W_NOT_FROM_HAND = P('from anywhere other than your hand');
const W_ABILITIES_OF = P('abilities of');
const W_AN_ABILITY_OF = P('an ability of');
const W_EQUIP_ONE = P('an equip ability');
const W_EQUIP_MANY = P('equip abilities');
const W_AN_ABILITY = P('an ability');
const W_ABILITIES = P('abilities');
const W_UNLOCK: [string[], boolean][] = [[P('unlock a door'), false], [P('unlock doors'), true]];
const W_FACE_UP_WHAT: [string[], ObjectFilter, boolean][] = [[P('a permanent'), {}, false], [P('permanents'), {}, true], [P('a creature'), { types: ['Creature'] }, false], [P('creatures'), { types: ['Creature'] }, true]];
P('source'); P('sources'); P('turn'); P('activate'); P('cast'); P('to'); P('or'); P('and'); P(',');

type Val<T> = { end: number; value: T };
/** A clause or a spell description with its grammatical number (true: plural). */
type NVal<T> = Val<T> & { plural: boolean };

const empty = (f: ObjectFilter): boolean => Object.values(f).every((v) => v === undefined);

/** "the chosen type" of a mana restriction is the creature type its source chose as it entered (link `type`, effect/replace.json; CR 607.2a). */
function linkChosen(f: ObjectFilter): ObjectFilter | null {
  if (f.chosen === undefined || (f.chosen.link as string) !== '$link') return f;
  // CLOUD C5: "the chosen type" is the '$chosenType' placeholder (parser/holes/filter.ts#CHOSEN); here it is the creature type the source chose
  if (f.chosen.quality !== 'creatureType' && (f.chosen.quality as string) !== '$chosenType') return null;
  return { ...f, chosen: { link: 'type', quality: 'creatureType' } };
}

/** A spell's filter as a restriction stores it: no stack kind and no zone; "from <zone>" is where it is cast from (CR 601.2a). */
function spellFilter(f: ObjectFilter): ObjectFilter | null {
  const { stackKind, zone, ...rest } = f;
  if (stackKind !== 'spell') return null;
  if (rest.not !== undefined || rest.controller !== undefined || rest.targets !== undefined) return null;
  // pc-keywords-mana-1 (CR 205.2a, 205.3, 106.6): "instant, sorcery, Demon, and Spirit spells" (Séance Board): the any-of of card types and subtypes a list of mixed names
  // is (holes/filter.ts#shape), nothing else beside it; any other any-of is a coordination of spell descriptions this function does not build (spellsCast does)
  if (rest.anyOf !== undefined && !(Object.keys(rest).length === 1 && rest.anyOf.every((a) => Object.keys(a).every((k) => k === 'types' || k === 'subtypes')))) return null;
  let out: ObjectFilter = rest;
  if (zone !== undefined && zone !== 'stack') {
    if (typeof zone !== 'string' || zone === 'any' || zone === 'battlefield' || zone === 'library') return null;
    if (zone === 'exile' ? rest.owner !== undefined : rest.owner !== 'you') return null; // "from exile", "from your hand", "from your graveyard"
    out = { ...rest, castFrom: zone };
  } else if (rest.owner !== undefined) return null;
  return linkChosen(out);
}

/** One spell description at `pos` (see SpellNP). */
function spellNp(ctx: HoleCtx, pos: number): NVal<ObjectFilter>[] {
  const out: NVal<ObjectFilter>[] = [];
  const art = ctx.toks[pos]?.norm;
  const singular = art === 'a' || art === 'an';
  const start = singular ? pos + 1 : pos;
  for (const n of npAlts(ctx, start)) {
    if (n.head !== 'spell' || n.number !== (singular ? 'singular' : 'plural')) continue;
    if (singular && ctx.toks.slice(start, n.end).some((t) => t.norm === 'and' || t.norm === 'and/or')) continue; // "an instant and sorcery spell"
    const f = spellFilter(n.filter);
    if (f === null) continue;
    out.push({ end: n.end, value: f, plural: !singular });
    // r3-cost (CR 601.2a, 106.6): "a spell from anywhere other than your hand" (Mm'menon, the Right Hand): a spell not cast from its caster's hand
    const elsewhere = f.castFrom === undefined && f.not === undefined ? phraseAt(ctx, n.end, W_NOT_FROM_HAND) : -1;
    if (elsewhere >= 0) out.push({ end: elsewhere, value: { ...f, not: { castFrom: 'hand' } }, plural: !singular });
    const x = phraseAt(ctx, n.end, singular ? W_X_ITS : W_X_THEIR);
    if (x >= 0 && f.manaCostHasX === undefined) out.push({ end: x, value: { ...f, manaCostHasX: true }, plural: !singular }); // CR 107.3
  }
  return out;
}

/**
 * SpellsCast: one or more spell descriptions joined by "or", all in one number ("a Dragon spell or an Omen spell", "spells with mana value 5 or greater or
 * spells with {X} in their mana costs").
 */
function spellsCast(ctx: HoleCtx, pos: number): NVal<ObjectFilter>[] {
  return ctx.memo('e23-spells', pos, () => {
    const out: NVal<ObjectFilter>[] = [];
    const walk = (p: number, acc: ObjectFilter[], plural: boolean | null): void => {
      for (const s of spellNp(ctx, p)) {
        if (plural !== null && s.plural !== plural) continue;
        const list = [...acc, s.value];
        out.push({ end: s.end, value: list.length === 1 ? list[0]! : { anyOf: list }, plural: s.plural });
        const or = phraseAt(ctx, s.end, P('or'));
        if (or >= 0 && list.length < 4) walk(or, list, s.plural);
      }
    };
    walk(pos, [], null);
    return out;
  });
}

/** A source description after "abilities of" / "an ability of" (see SourceNP). */
function sourceNp(ctx: HoleCtx, pos: number, singular: boolean): Val<ObjectFilter>[] {
  const out: Val<ObjectFilter>[] = [];
  const art = ctx.toks[pos]?.norm;
  if (singular !== (art === 'a' || art === 'an')) return out;
  const start = singular ? pos + 1 : pos;
  const noun = singular ? 'source' : 'sources';
  const withPost = (end: number, f: ObjectFilter, depth: number): void => {
    const linked = linkChosen(f);
    if (linked !== null) out.push({ end, value: linked });
    if (depth >= 2) return;
    for (const pm of postModAt(ctx, end)) {
      if (pm.frag.zone !== undefined) continue;
      const merged = mergeFilter(f, pm.frag);
      if (merged !== null) withPost(pm.end, merged, depth + 1);
    }
  };
  // "a source of the chosen type", "sources"
  if (ctx.toks[start]?.norm === noun) withPost(start + 1, {}, 0);
  for (const n of npAlts(ctx, start)) {
    if (n.head !== 'type' || n.filter.zone !== undefined) continue;
    // "an artifact", "creatures", "Elementals": the noun phrase is the source
    if (n.number === (singular ? 'singular' : 'plural')) { const linked = linkChosen(n.filter); if (linked !== null) out.push({ end: n.end, value: linked }); }
    // "an artifact source", "Elf sources", "a creature source of the chosen type": the type words describe the source
    if (ctx.toks[n.end]?.norm === noun && Object.keys(n.filter).every((k) => k === 'types' || k === 'subtypes' || k === 'supertypes' || k === 'colorless' || k === 'colors')) withPost(n.end + 1, n.filter, 0);
  }
  return out;
}

/** Abilities after "activate". */
function abilities(ctx: HoleCtx, pos: number): NVal<ManaRestriction>[] {
  const out: NVal<ManaRestriction>[] = [];
  for (const [ws, plural] of [[W_EQUIP_ONE, false], [W_EQUIP_MANY, true]] as const) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { abilities: {}, abilityKeyword: 'equip' }, plural }); } // CR 702.6a
  for (const [ws, plural] of [[W_AN_ABILITY, false], [W_ABILITIES, true]] as const) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { abilities: {} }, plural }); }
  for (const [ws, singular] of [[W_AN_ABILITY_OF, true], [W_ABILITIES_OF, false]] as const) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) for (const s of sourceNp(ctx, e, singular)) if (!empty(s.value)) out.push({ end: s.end, value: { abilities: s.value }, plural: !singular });
  }
  return out;
}

/** One clause (see Clause). */
function clause(ctx: HoleCtx, pos: number): NVal<ManaRestriction>[] {
  const out: NVal<ManaRestriction>[] = [];
  const w = ctx.toks[pos]?.norm;
  if (w === 'cast') for (const s of spellsCast(ctx, pos + 1)) out.push({ end: s.end, value: { spells: s.value }, plural: s.plural });
  if (w === 'activate') out.push(...abilities(ctx, pos + 1));
  if (w === 'turn') {
    for (const [ws, f, plural] of W_FACE_UP_WHAT) {
      const e = phraseAt(ctx, pos + 1, ws);
      const up = e >= 0 ? phraseAt(ctx, e, W_FACE_UP) : -1;
      if (up >= 0) out.push({ end: up, value: { turnFaceUp: f }, plural });
    }
  }
  for (const [ws, plural] of W_UNLOCK) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { unlock: true }, plural }); }
  return out;
}

/** Merge the clauses of one restriction: each kind of clause at most once (a second "cast ..." clause is not a shape Oracle uses). */
function mergeClauses(list: readonly ManaRestriction[]): ManaRestriction | null {
  const out: ManaRestriction = {};
  for (const r of list) {
    for (const [k, v] of Object.entries(r)) {
      if ((out as Record<string, unknown>)[k] !== undefined) return null;
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

const SEP_TWO = [P('or to'), P('or'), P('and')];
const SEP_LAST = [P(', or to'), P(', or'), P(', and')];
/** "and" joins clauses only in the plural (see the file comment). */
const joins = (sep: readonly string[], plural: boolean): boolean => plural || sep[sep.length - 1] !== 'and';

/** ManaSpend: the clauses with their separators (two: "or" / "or to" / "and"; three or more: commas, then ", or" / ", and"), all in one number. */
export const manaSpend: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const c1 of clause(ctx, pos)) {
    out.push({ end: c1.end, value: c1.value });
    for (const sep of SEP_TWO) {
      const s = phraseAt(ctx, c1.end, sep);
      if (s < 0 || !joins(sep, c1.plural)) continue;
      for (const c2 of clause(ctx, s)) { if (c2.plural !== c1.plural) continue; const m = mergeClauses([c1.value, c2.value]); if (m) out.push({ end: c2.end, value: m }); }
    }
    // three or more clauses: "cast an enchantment spell, unlock a door, or turn a permanent face up"
    const more = (p: number, acc: ManaRestriction[]): void => {
      if (acc.length > 4) return;
      const comma = phraseAt(ctx, p, P(','));
      if (comma < 0) return;
      for (const sep of SEP_LAST) {
        const s = phraseAt(ctx, p, sep);
        if (s < 0 || acc.length < 2 || !joins(sep, c1.plural)) continue;
        for (const c of clause(ctx, s)) { if (c.plural !== c1.plural) continue; const m = mergeClauses([...acc, c.value]); if (m) out.push({ end: c.end, value: m }); }
      }
      for (const c of clause(ctx, comma)) if (c.plural === c1.plural) more(c.end, [...acc, c.value]);
    };
    more(c1.end, [c1.value]);
  }
  return dedupe(out);
};

/** SpellsCast: the spells "this mana can't be spent to cast" (CR 106.6). */
export const spellsCastHole: HoleFn = (ctx, pos) => dedupe(spellsCast(ctx, pos).map((s) => ({ end: s.end, value: s.value })));
