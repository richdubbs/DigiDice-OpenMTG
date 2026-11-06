/**
 * Small hole grammars: `Color`, `CounterKind`, `ManaCost`, `PT`, `Name`, `ChoiceKind`, `Keyword`, `Abilities`. Owner: WP6.
 *
 * Open classes are the only places where an arbitrary word is accepted, and only in a fixed frame: a card name after the words the template gives
 * (`Name`, weak), a counter kind directly before "counter(s)" (`CounterKind`, weak when it is not in the lexicon). Everything else is closed vocabulary.
 */
import type { CostDef, Quantity } from '../../types/ability';
import { parseManaSymbol } from '../../types/mana';
import type { ManaCost, ManaType } from '../../types/mana';
import type { Alt, HoleCtx, HoleFn } from './core';
import { P, THAT_COLOR_QUALITY, anyPhraseAt, dedupe, multiAt, numberAt, phraseAt, spanOf } from './core';
import { isSignedPair } from './tok';
import type { Tok } from './tok';
import type { KeywordEntry } from './vocab';

// ---- Color -----------------------------------------------------------------

export const color: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos];
  if (t === undefined || t.kind !== 'WORD') return [];
  const c = ctx.vocab.colors.get(t.norm);
  return c === undefined ? [] : [{ end: pos + 1, value: c }];
};

// ---- CounterKind -----------------------------------------------------------

const W_COUNTER = [P('counter'), P('counters')];
const NOT_A_KIND = new Set(['a', 'an', 'the', 'of', 'on', 'each', 'no', 'any', 'that', 'those', 'target', 'another', 'other', 'this', 'and', 'or', 'one', 'more', 'its', 'their']);

/** "+1/+1", "-1/-1", "charge", "time": the word(s) in front of "counter(s)" (which stays in the pattern). */
export const counterKind: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos];
  if (t === undefined) return [];
  const out: Alt[] = [];
  if (isSignedPair(t) && anyPhraseAt(ctx, pos + 1, W_COUNTER) >= 0) out.push({ end: pos + 1, value: t.norm });
  if (t.kind === 'WORD' && !NOT_A_KIND.has(t.norm) && anyPhraseAt(ctx, pos + 1, W_COUNTER) >= 0) {
    // keyword counters ("flying counter") and every ordinary word: kind = the word; unlisted words are weak
    const listed = ctx.vocab.counterKinds.has(t.norm) || ctx.vocab.keywords.has(t.norm);
    out.push({ end: pos + 1, value: t.norm, ...(listed ? {} : { weak: 1 }) });
  }
  // FAST4 T28 (CR 122.1b): a two-word keyword counter ("a double strike counter", "a first strike counter"); only a listed kind or keyword, never two
  // arbitrary words, so "double the number of ... counters" or "a +1/+1 counter" keep their one reading
  const t2 = ctx.toks[pos + 1];
  if (t.kind === 'WORD' && t2?.kind === 'WORD' && !NOT_A_KIND.has(t.norm) && anyPhraseAt(ctx, pos + 2, W_COUNTER) >= 0) {
    const two = `${t.norm} ${t2.norm}`;
    if (ctx.vocab.counterKinds.has(two) || ctx.vocab.keywords.has(two)) out.push({ end: pos + 2, value: two });
  }
  return out;
};

// ---- ManaCost --------------------------------------------------------------

/** A run of mana symbols ("{2}{W}{W}"). One lexical unit (CR 107.4): only the maximal run is returned. {T}, {Q} and {E} are not mana symbols of a cost. */
export const manaCost: HoleFn = (ctx, pos) => {
  const syms: ManaCost = [];
  let p = pos;
  while (ctx.toks[p]?.kind === 'MANA' && ctx.toks[p]!.norm !== '{e}') {
    try { syms.push(parseManaSymbol(ctx.toks[p]!.norm.slice(1, -1))); } catch { return []; }
    p++;
  }
  return syms.length === 0 ? [] : [{ end: p, value: syms }];
};

/** std-mana-12: `ColoredManaCost`, a ManaCost reading with at least one symbol that is not generic (types.ts#HoleType). */
export const coloredManaCost: HoleFn = (ctx, pos) => manaCost(ctx, pos).filter((a) => (a.value as ManaCost).some((m) => m.kind !== 'generic'));

// ---- ManaUnits -------------------------------------------------------------

/** The one-type mana symbols a unit of produced mana can be (CR 106.1, 106.1b): five colors and colorless. */
const UNIT_TYPES: Readonly<Record<string, ManaType>> = { '{w}': 'W', '{u}': 'U', '{b}': 'B', '{r}': 'R', '{g}': 'G', '{c}': 'C' };
const W_OR = P('or');

/** A run of one-type mana symbols ("{G}", "{B}{G}", "{C}{C}"), or null. Generic, hybrid, Phyrexian and snow symbols are not mana a source adds. */
function unitRun(ctx: HoleCtx, pos: number): { end: number; types: ManaType[] } | null {
  const types: ManaType[] = [];
  let p = pos;
  for (let t = ctx.toks[p]; t?.kind === 'MANA' && UNIT_TYPES[t.norm] !== undefined; t = ctx.toks[++p]) types.push(UNIT_TYPES[t.norm]!);
  return types.length === 0 ? null : { end: p, types };
}

/**
 * FAST1 T4 ADDITION (INTERFACE CHANGE: a new hole type): the mana an instruction adds, as `addMana.units` (one entry per unit, each the types it may be;
 * CR 106.1, 106.4, 605.1a). Three printed shapes, each read exactly:
 *   - a run of symbols, every unit fixed: "{G}", "{B}{G}", "{U}{B}{R}";
 *   - one unit chosen from a list: "{R} or {G}", "{W}, {U}, or {B}" (two items take no comma, three or more take the Oxford comma; no type twice);
 *   - the filter lands' "{W}{W}, {W}{B}, or {B}{B}": two units of the same two types (the pool has no order, CR 106.4: {W}{B} is {B}{W}).
 * Anything else ("{R}{R} or {G}{G}", a list without "or") has no reading. The renderer prints all three (render/steps-cards.ts#manaUnits).
 */
export const manaUnits: HoleFn = (ctx, pos) => {
  const first = unitRun(ctx, pos);
  if (first === null) return [];
  const out: Alt[] = [{ end: first.end, value: first.types.map((t) => [t]) }];
  const items = [first];
  let p = first.end;
  for (;;) {
    let q = p;
    const comma = ctx.toks[q]?.kind === 'PUNCT' && ctx.toks[q]!.norm === ',';
    if (comma) q++;
    const or = phraseAt(ctx, q, W_OR);
    if (or >= 0) q = or;
    if (!comma && or < 0) break;
    const next = unitRun(ctx, q);
    if (next === null) break;
    items.push(next);
    p = next.end;
    if (or < 0) continue;
    // the list ends at "or": "A or B" has no comma, "A, B, or C" has one before "or"
    if ((items.length === 2) === comma) break;
    if (items.every((i) => i.types.length === 1)) {
      const types = items.map((i) => i.types[0]!);
      if (new Set(types).size === types.length) out.push({ end: p, value: [types] });
    } else if (items.length === 3 && items.every((i) => i.types.length === 2)) {
      const [[a, a2], [x, y], [b, b2]] = items.map((i) => i.types) as [[ManaType, ManaType], [ManaType, ManaType], [ManaType, ManaType]];
      if (a === a2 && b === b2 && a !== b && x === a && y === b) out.push({ end: p, value: [[a, b], [a, b]] });
    }
    break;
  }
  return out;
};

// ---- ManaSym ---------------------------------------------------------------

/**
 * FAST2 T7 ADDITION (INTERFACE CHANGE: a new hole type): ONE one-type mana symbol standing alone ("{G}", "{C}"), value the `ManaType` ('G', 'C'): the type
 * of mana a dynamic production adds ("Add {G} for each creature you control", "Add an amount of {G} equal to ~'s power", CR 106.1, 106.4). A run of
 * symbols ("{G}{G}") is not one type with an amount, so it has no reading here (the ManaUnits hole reads runs).
 */
export const manaSym: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos];
  if (t?.kind !== 'MANA') return [];
  const type = UNIT_TYPES[t.norm];
  if (type === undefined || ctx.toks[pos + 1]?.kind === 'MANA') return [];
  return [{ end: pos + 1, value: type }];
};

// ---- PT --------------------------------------------------------------------

const PT_RE = /^([+-]?)(\d+|x)\/([+-]?)(\d+|x)$/;

function ptSide(sign: string, body: string): Quantity {
  const base: Quantity = body === 'x' ? { q: 'X' } : Number(body);
  if (sign !== '-') return base;
  return typeof base === 'number' ? -base : { q: 'math', op: '*', args: [-1, base] };
}

/** `+2/+2`, `-1/-1`, `+X/+X`, `+1/-1`, `+0/+3`: both halves signed, as a power/toughness modification `{p, t}`. */
export const pt: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos];
  // edh-players-5 (CR 107.1, 613.4c; Nuclear Fallout): "twice -X/-X" is each half twice what it says; weak (design 6.3 rule 2), a template that spells the words out keeps its sentence
  if (t?.kind === 'WORD' && t.norm === 'twice') {
    const n = ctx.toks[pos + 1];
    const m = n !== undefined && isSignedPair(n) ? PT_RE.exec(n.norm) : null;
    if (m === null || m[1] === '' || m[3] === '') return [];
    const twice = (q: Quantity): Quantity => (typeof q === 'number' ? q * 2 : { q: 'math', op: '*', args: [2, q] });
    return [{ end: pos + 2, value: { p: twice(ptSide(m[1]!, m[2]!)), t: twice(ptSide(m[3]!, m[4]!)) }, weak: 1 }];
  }
  if (t === undefined || !isSignedPair(t)) return [];
  const m = PT_RE.exec(t.norm);
  if (m === null || m[1] === '' || m[3] === '') return [];
  return [{ end: pos + 1, value: { p: ptSide(m[1]!, m[2]!), t: ptSide(m[3]!, m[4]!) } }];
};

/** Printed power/toughness of a token ("1/1", "X/X"), unsigned: `{power, toughness}`. Not a hole type of its own; the token grammar uses it. */
export function basePt(ctx: HoleCtx, pos: number): { end: number; power: Quantity; toughness: Quantity }[] {
  const t = ctx.toks[pos];
  if (t === undefined || t.kind !== 'PT') return [];
  const m = PT_RE.exec(t.norm);
  if (m === null || m[1] !== '' || m[3] !== '') return [];
  return [{ end: pos + 1, power: ptSide('', m[2]!), toughness: ptSide('', m[4]!) }];
}

/**
 * WP22 ADDITION (INTERFACE CHANGE): the `BasePT` hole, printed (unsigned) power/toughness as a value `{p, t}` (same shape as `PT`): "base power and
 * toughness 3/3", "becomes a 2/2 creature" (CR 613.4b sets base power and toughness; CR 208.1). A signed pair ("+1/+1") is never a base P/T.
 */
export const basePT: HoleFn = (ctx, pos) => basePt(ctx, pos).map((b) => ({ end: b.end, value: { p: b.power, t: b.toughness } }));

// ---- Subtypes --------------------------------------------------------------

/**
 * WP22 ADDITION (INTERFACE CHANGE): the `Subtypes` hole, a run of one or more singular subtype words as they appear in a type description ("Elk",
 * "Elemental", "Human Soldier"), value: the subtype names (string[], CR 205.3). Closed vocabulary (the generated lexicon); a plural, a color or a card
 * type is not a subtype and ends the run. Every run length is returned; the template's next literal ("creature", "artifact creature") decides.
 */
export const subtypes: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const walk = (p: number, acc: string[]): void => {
    for (const m of multiAt(ctx, p, ctx.vocab.subtypes)) {
      if (m.entry.plural) continue;
      const names = [...acc, m.entry.name];
      out.push({ end: m.end, value: names });
      if (names.length < 4) walk(m.end, names);
    }
  };
  walk(pos, []);
  return dedupe(out);
};

// ---- CardTypes ---------------------------------------------------------------

/**
 * FAST5 T60 ADDITION: the `CardTypes` hole, one PLURAL card type word ("lands", "artifacts", "creatures", "enchantments"), value: the type names (string[], CR 205.2a).
 * What a type-adding static ability adds ("Nontoken artifacts you control are lands in addition to their other types", CR 205.1b); closed vocabulary (the lexicon's
 * card types). A subtype ("Foods", "Forest lands") or a run of words is not one.
 */
export const cardTypes: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos];
  if (t === undefined || t.kind !== 'WORD') return [];
  const e = ctx.vocab.types.get(t.norm);
  return e !== undefined && e.plural ? [{ end: pos + 1, value: [e.name] }] : [];
};

/**
 * std-rD ADDITION: the `TypeChoices` hole, a list of two or more SINGULAR card type words to choose among ("artifact or enchantment", "artifact, creature, or
 * land", CR 205.2a), value: the type names (string[], capitalized as the choice handler offers them, effects/handlers/choose.ts). Oracle's list form only: two
 * words joined by "or", or three or more with commas and ", or" before the last; no word twice. "land or nonland" is not a list of card types (no type
 * "nonland"), so it never reads here.
 */
export const typeChoices: HoleFn = (ctx, pos) => {
  const typeAt = (p: number): string | undefined => {
    const t = ctx.toks[p];
    if (t === undefined || t.kind !== 'WORD') return undefined;
    const e = ctx.vocab.types.get(t.norm);
    return e !== undefined && !e.plural ? e.name : undefined;
  };
  const first = typeAt(pos);
  if (first === undefined) return [];
  const names = [first];
  let p = pos + 1;
  // ", <type>" runs, then ", or <type>" (three or more) or " or <type>" (two)
  while (ctx.toks[p]?.norm === ',' && typeAt(p + 1) !== undefined) { names.push(typeAt(p + 1)!); p += 2; }
  const comma = ctx.toks[p]?.norm === ',';
  if (comma !== names.length > 1) return [];
  if (comma) p++;
  if (ctx.toks[p]?.norm !== 'or') return [];
  const last = typeAt(p + 1);
  if (last === undefined) return [];
  names.push(last);
  return new Set(names).size === names.length ? [{ end: p + 2, value: names }] : [];
};

// ---- Name ------------------------------------------------------------------

/**
 * edh-d-85 (CR 201.2, 201.5; Galactus, Devourer of Worlds): a card name that contains the name of the card that prints it, which preprocessing has turned into "~"
 * ("a creature named Silver Surfer, Galactus's Herald" on Galactus): the one index name that the words spell with any run of capitalized words at the "~" (and
 * "'s" right after it). Only one name of the index may fit, the name must contain a comma (a full card name with an epithet) and the "~" must not be its first word.
 */
function nameWithSelf(ctx: HoleCtx, pos: number, names: ReadonlySet<string>): Alt[] {
  const out: Alt[] = [];
  if (ctx.toks[pos]?.kind === 'SELF') return out;
  const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re = '';
  let self = false;
  for (let p = pos; p < Math.min(ctx.toks.length, pos + 8); p++) {
    const n = ctx.toks[p]!;
    if (n.kind === 'SELF') { re = `${re} [A-Z][^,]*?`; self = true; }
    else if (n.norm === ',') re = `${re},`;
    else if (n.text === "'s" && ctx.toks[p - 1]?.kind === 'SELF') re = `${re}'s`;
    else if (n.kind === 'WORD' && /^[A-Z]/.test(n.text)) re = `${re} ${esc(n.text)}`;
    else break;
    if (!self || !re.includes(',')) continue;
    const r = new RegExp(`^${re.trim()}$`);
    const hits: string[] = [];
    for (const nm of names) if (r.test(nm)) { hits.push(nm); if (hits.length > 1) break; }
    if (hits.length === 1) out.push({ end: p + 1, value: hits[0]!, weak: 1 });
  }
  return out;
}

/**
 * A card name (after "named"). With the card-name index: only names in it (a single name token, or a run of words that spells one). Without the index:
 * every run of capitalized words, all prefixes (the chart's whole-unit rule picks), each weak.
 */
export const name: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const t = ctx.toks[pos];
  if (t === undefined) return out;
  const names = ctx.cardNames;
  if (names !== undefined) {
    if (names.has(t.text)) out.push({ end: pos + 1, value: t.text, weak: 1 });
    let s = t.text;
    for (let p = pos + 1; p < Math.min(ctx.toks.length, pos + 8); p++) {
      const n = ctx.toks[p]!;
      s = n.norm === ',' ? `${s},` : `${s} ${n.text}`;
      if (names.has(s)) out.push({ end: p + 1, value: s, weak: 1 });
    }
    out.push(...nameWithSelf(ctx, pos, names));
    return out;
  }
  let s = '';
  for (let p = pos; p < ctx.toks.length; p++) {
    const n = ctx.toks[p]!;
    // FAST3 T17: a lower-case "of" inside a name ("Kobolds of Kher Keep", CR 111.4: a token's given name) between capitalized words; never at either end
    const capital = (t: typeof n | undefined): boolean => t !== undefined && t.kind === 'WORD' && /^[A-Z]/.test(t.text);
    if (s !== '' && n.kind === 'WORD' && n.text === 'of' && capital(ctx.toks[p + 1])) {
      s = `${s} of`;
      continue;
    }
    // r4-mech (CR 111.4): "of the" inside a token's given name ("Scion of the Deep"), only between capitalized words, never at either end
    if (s !== '' && n.kind === 'WORD' && n.text === 'of' && ctx.toks[p + 1]?.text === 'the' && capital(ctx.toks[p + 2])) {
      s = `${s} of the`;
      p++;
      continue;
    }
    // T55 (CR 111.4): a possessive inside a token's name ("Koma's Coil", "Ajani's Pridemate"): the name goes on after the 's, but never ends at it
    if (s !== '' && n.kind === 'WORD' && n.text === "'s" && capital(ctx.toks[p + 1]) && ctx.toks[p - 1]!.end === n.start) {
      s = `${s}'s`;
      continue;
    }
    // r3-static (CR 201.2): a name with a comma ("A deck can have any number of cards named Cid, Timeless Artificer."): a capitalized run after the comma, read
    // only when it ends the sentence (a list of names goes on with "and" or "or", never so)
    // std-library-1 (CR 201.2): an epithet after the comma, "a card named Altanak, the Thrice-Called and put it onto the battlefield" (Say Its Name): "the" and a
    // capitalized run; the article tells it from a list of names, so it may go on with the sentence
    if (s !== '' && n.kind === 'PUNCT' && n.norm === ',' && ctx.toks[p + 1]?.kind === 'WORD' && ctx.toks[p + 1]!.text === 'the' && capital(ctx.toks[p + 2])) {
      let q = p + 2;
      let joined = `${s}, the`;
      while (q < ctx.toks.length && capital(ctx.toks[q])) joined = `${joined} ${ctx.toks[q++]!.text}`;
      out.push({ end: q, value: joined, weak: 1 });
      break;
    }
    if (s !== '' && n.kind === 'PUNCT' && n.norm === ',' && capital(ctx.toks[p + 1])) {
      let q = p + 1;
      let joined = `${s},`;
      while (q < ctx.toks.length && capital(ctx.toks[q])) joined = `${joined} ${ctx.toks[q++]!.text}`;
      const after = ctx.toks[q];
      if (after === undefined || (after.kind === 'PUNCT' && after.norm === '.')) out.push({ end: q, value: joined, weak: 1 });
      break;
    }
    if (!capital(n)) break;
    s = s === '' ? n.text : `${s} ${n.text}`;
    out.push({ end: p + 1, value: s, weak: 1 });
  }
  return out;
};

// ---- ChoiceKind ------------------------------------------------------------

const CHOICES: [string[], string][] = [
  [P('color'), 'color'], [P('creature type'), 'creatureType'], [P('card type'), 'cardType'], [P('land type'), 'landType'], [P('basic land type'), 'landType'],
  [P('card name'), 'cardName'], [P('number'), 'number'], [P('player'), 'player'], [P('opponent'), 'opponent'], [P('odd or even'), 'oddEven'],
];

export const choiceKind: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const [ws, v] of CHOICES) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: v }); }
  return out;
};

// ---- Keyword and Abilities -------------------------------------------------

const DASH = P('--');
const W_THE_CHOSEN_COLOR = P('the chosen color'); // MX2
const W_THE_CHOSEN_CARD_TYPE = P('the chosen card type'); // edht4
const W_THE_CHOSEN_PLAYER = P('the chosen player'); // edh-d-11
const W_OF_THE_CHOSEN_TYPE = P('of the chosen type'); // edh-d-72
const W_CREATURES_OF_THE_CHOSEN_TYPE = P('creatures of the chosen type'); // edh-d-12
const W_THAT_COLOR = P('that color'); // edh-players-8
const W_EACH_OF_YOUR_OPPONENTS_Q = P('each of your opponents'); // std-rx15
const W_COLORS_OUTSIDE_IDENTITY = P("each color that's not in your commander 's color identity"); // edh-perms-2

/** std-rg: the quality "each of its colors" of hexproof (rules/protection.ts#canBeTargeted). */
const OWN_COLORS = 'ownColors';

/** The quality of "protection from X" / "hexproof from X" in the canonical string form of rules/quality.ts (milestone 4). */
export function qualityAt(ctx: HoleCtx, pos: number): { end: number; quality: string }[] {
  const out: { end: number; quality: string }[] = [];
  const t = ctx.toks[pos];
  if (t === undefined || t.kind !== 'WORD') return out;
  const c = ctx.vocab.colors.get(t.norm);
  if (c !== undefined) out.push({ end: pos + 1, quality: `color:${c}` });
  if (t.norm === 'multicolored' || t.norm === 'monocolored' || t.norm === 'colorless' || t.norm === 'everything') out.push({ end: pos + 1, quality: t.norm });
  const all = anyPhraseAt(ctx, pos, [P('all colors'), P('each color')]);
  if (all >= 0) out.push({ end: all, quality: 'color:any' });
  // std-rg (CR 702.11d, 105.2): "hexproof from each of its colors" (Tam, Mindful First-Year): from sources that are any color the permanent itself is (rules/protection.ts#canBeTargeted);
  // only hexproof reads it (the callers drop it for any other keyword)
  const own = phraseAt(ctx, pos, P('each of its colors'));
  if (own >= 0) out.push({ end: own, quality: OWN_COLORS });
  // MX2 (CR 702.16a, 607.2d): "the chosen color", the color chosen by the linked "choose a color" ability (link `color`). The layers read the choice of the
  // granting effect's source when they grant the keyword (statics/mods.ts); a resolved effect stores the color itself (effects/handlers/lasting-fix.ts#fixChosen)
  const chosen = phraseAt(ctx, pos, W_THE_CHOSEN_COLOR);
  if (chosen >= 0) out.push({ end: chosen, quality: 'chosen:color' });
  // edht4 (CR 702.16a, 607.2d; Serra's Emissary): "the chosen card type", the card type chosen by the linked "choose a card type" ability (link `cardType`); read like the color
  const chosenType = phraseAt(ctx, pos, W_THE_CHOSEN_CARD_TYPE);
  if (chosenType >= 0) out.push({ end: chosenType, quality: 'chosen:cardType' });
  // edh-d-11 (CR 702.16j-k, 607.2d; True-Name Nemesis): "protection from the chosen player", the player chosen by the linked "As ~ enters, choose a player" (link `opponent`,
  // parser/parse.ts#CHOSEN_OPPONENT_LINK): the layers turn the quality into `player:<id>` when they grant the keyword (statics/mods.ts#withChosenQualities); rules/protection.ts
  // reads the controller of the source
  const chosenPlayer = phraseAt(ctx, pos, W_THE_CHOSEN_PLAYER);
  if (chosenPlayer >= 0) out.push({ end: chosenPlayer, quality: 'chosen:player' });
  // edh-d-12 (CR 702.16a, 607.2d, 205.3m; Riders of Gavony): "creatures of the chosen type", the creature type chosen by the linked "choose a creature type" ability (link `creatureType`):
  // protection from creatures that have it, read like the chosen color (statics/mods.ts#withChosenQualities)
  const chosenCreatureType = phraseAt(ctx, pos, W_CREATURES_OF_THE_CHOSEN_TYPE);
  if (chosenCreatureType >= 0) out.push({ end: chosenCreatureType, quality: 'chosen:creatureType' });
  // edh-players-8 (CR 607.2d, 608.2c; Skrelv): "hexproof from that color", the color an earlier "Choose a color." of the same ability chose: the placeholder is replaced by the
  // chosen quality of that one choice (parser/lower/links.ts) or stays and makes the sentence manual
  const thatColor = phraseAt(ctx, pos, W_THAT_COLOR);
  if (thatColor >= 0) out.push({ end: thatColor, quality: THAT_COLOR_QUALITY });
  // edh-perms-2 (CR 702.16a, 903.4, 105.1; Commander's Plate): "each color that's not in your commander's color identity": the colors outside the identity of the
  // granting effect's controller's commander(s), worked out when the layers grant the keyword (statics/mods.ts#withChosenQualities, quality `identity:outside`)
  const outside = phraseAt(ctx, pos, W_COLORS_OUTSIDE_IDENTITY);
  if (outside >= 0) out.push({ end: outside, quality: 'identity:outside' });
  // std-rx15 (CR 702.16b-f, protection from a player; unverified 702.16k): "protection from each of your opponents": from everything the protected permanent's
  // controller's opponents control (rules/protection.ts#protectedFromPlayers reads the controllers)
  const opps = phraseAt(ctx, pos, W_EACH_OF_YOUR_OPPONENTS_Q);
  if (opps >= 0) out.push({ end: opps, quality: 'player:opponents' });
  // pc-statics-1 (CR 702.16a, 202.3): "protection from mana value 3 or less / 3 or greater": from sources whose mana value is so (rules/quality.ts `mv:`)
  const mvEnd = phraseAt(ctx, pos, P('mana value'));
  const mvN = mvEnd >= 0 ? ctx.toks[mvEnd] : undefined;
  if (mvN !== undefined && mvN.kind === 'NUM' && /^\d+$/.test(mvN.norm) && ctx.toks[mvEnd + 1]?.norm === 'or') {
    const w = ctx.toks[mvEnd + 2]?.norm;
    if (w === 'less') out.push({ end: mvEnd + 3, quality: `mv:le:${mvN.norm}` });
    else if (w === 'greater') out.push({ end: mvEnd + 3, quality: `mv:ge:${mvN.norm}` });
  }
  // edh-mana-keywords-10 (CR 702.16a, 111.1, 601.2a; Emrakul, the World Anew): "protection from spells and from permanents that were cast this turn": sources that are spells,
  // and permanents whose cast was this turn (rules/quality.ts `spell`, `castThisTurn`; statics/layers.ts#withObjectFlags)
  if (t.norm === 'spells') out.push({ end: pos + 1, quality: 'spell' });
  // edh-c-54 (CR 702.16a, 111.1, 205.2; Devoted Caretaker): "protection from instant spells": sources that are spells with that card type (rules/quality.ts, the composite `spell&type:X`)
  const spellTy = ctx.vocab.types.get(t.norm);
  if (spellTy !== undefined && !spellTy.plural && ctx.toks[pos + 1]?.norm === 'spells') out.push({ end: pos + 2, quality: `spell&type:${spellTy.name}` });
  // edh-replace-6 (CR 701.54e, 702.16a; Lord of the Nazgûl): "protection from Ring-bearers": sources that are a player's Ring-bearer (rules/quality.ts `ringBearer`)
  if (t.norm === 'ring-bearers') out.push({ end: pos + 1, quality: 'ringBearer' });
  // edh-top-9 (CR 702.11d, 113.1; Volatile Stormdrake): "hexproof from activated and triggered abilities": sources that are abilities (rules/quality.ts `ability`)
  const abilities = phraseAt(ctx, pos, P('activated and triggered abilities'));
  if (abilities >= 0) out.push({ end: abilities, quality: 'ability' });
  const castTurn = phraseAt(ctx, pos, P('permanents that were cast this turn'));
  if (castTurn >= 0) out.push({ end: castTurn, quality: 'castThisTurn' });
  // edh-next-88 (CR 122.1, 702.16a; Geyadrone Dihada): "protection from permanents with corruption counters on them": sources that have a counter of that kind on them now (rules/quality.ts `counter:<kind>`)
  const withPerm = phraseAt(ctx, pos, P('permanents with'));
  if (withPerm >= 0) for (const k of ctx.call('CounterKind', withPerm)) { const on = phraseAt(ctx, k.end, P('counters on them')); if (on >= 0 && typeof k.value === 'string' && /^[a-z]+$/.test(k.value)) out.push({ end: on, quality: `counter:${k.value}` }); }
  const ty = ctx.vocab.types.get(t.norm);
  if (ty !== undefined && ty.plural) out.push({ end: pos + 1, quality: `type:${ty.name}` });
  // edh-c-49 (CR 702.16a, 108.4; Crypsis): "protection from creatures your opponents control": sources of that type controlled by an opponent of the protected permanent's controller (rules/protection.ts, quality `opp:type:Creature`)
  if (ty !== undefined && ty.plural) {
    const oppEnd = phraseAt(ctx, pos + 1, P('your opponents control'));
    if (oppEnd >= 0) out.push({ end: oppEnd, quality: `opp:type:${ty.name}` });
  }
  const st = ctx.vocab.supertypes.get(t.norm);
  if (st !== undefined) out.push({ end: pos + 1, quality: `supertype:${st.name}` });
  // edhv31 (CR 702.16a; Tsabo Tavoc, Harbinger of Spring): "protection from legendary creatures", "protection from non-Spirit creatures" (rules/quality.ts, `A&!B`)
  if (t.norm === 'legendary' && ctx.toks[pos + 1]?.norm === 'creatures') out.push({ end: pos + 2, quality: 'type:Creature&supertype:Legendary' });
  const nonSub = /^non-([a-z]+)$/.exec(t.norm);
  if (nonSub !== null && ctx.toks[pos + 1]?.norm === 'creatures' && ctx.vocab.subtypes.has(`${nonSub[1]}s`)) out.push({ end: pos + 2, quality: `type:Creature&!subtype:${nonSub[1]}s` });
  // edh-d-5 (CR 702.16a, 205.3m; Sigrid, God-Favored): "protection from God creatures": a creature that has the creature type (rules/quality.ts, `type:Creature&subtype:gods`)
  for (const s of multiAt(ctx, pos, ctx.vocab.subtypes)) {
    if (s.entry.plural || ctx.toks[s.end]?.norm !== 'creatures') continue;
    const one = ctx.toks.slice(pos, s.end).map((x) => x.norm).join(' ');
    if (one === s.entry.name.toLowerCase() && /^[a-z]+$/.test(one) && ctx.vocab.subtypes.has(`${one}s`)) out.push({ end: s.end + 1, quality: `type:Creature&subtype:${one}s` });
  }
  for (const s of multiAt(ctx, pos, ctx.vocab.subtypes)) {
    if (!s.entry.plural && !s.entry.both) continue;
    const printed = ctx.toks.slice(pos, s.end).map((x) => x.norm).join(' ');
    // W3 integration: an irregular one-word plural of the lexicon ("Oxen") is recognized by rules/quality.ts since WP21 (IRREGULAR_PLURALS; its review test
    // checks that table against every such plural of the generated lexicon), so it is a quality here too
    const lexiconPlural = s.entry.plural && s.end === pos + 1 && /^[a-z]+$/.test(printed);
    if (regularPlurals(s.entry.name).includes(printed) || lexiconPlural) out.push({ end: s.end, quality: `subtype:${printed}` });
  }
  return out;
}

/**
 * WP22 review (INTERFACE CHANGE, CR 702.16a): the printed plurals rules/quality.ts#hasQuality recognizes for a subtype (it tests a quality against the regular
 * plural forms of each subtype the object has: +s, +es, y -> ies, f/fe -> ves). An irregular plural of the lexicon ("Oxen", "Mice", "Fungi") would never
 * match, so it is no quality here and the keyword stays manual instead of silently never applying (the parser may not import rules/, design 5.4).
 */
function regularPlurals(singular: string): string[] {
  const s = singular.toLowerCase();
  const out = [s, `${s}s`, `${s}es`];
  if (s.endsWith('y')) out.push(`${s.slice(0, -1)}ies`);
  if (s.endsWith('f')) out.push(`${s.slice(0, -1)}ves`);
  if (s.endsWith('fe')) out.push(`${s.slice(0, -2)}ves`);
  return out;
}

/** Keywords that are nothing without their parameter: a bare "landwalk" is no landwalk the engine can test (CR 702.14a-c: it is "[type]walk"). */
const PARAMETER_REQUIRED: ReadonlySet<string> = new Set(['landwalk', 'partner with' /* M11-4: CR 702.124j, the partner's name */]);

interface KwAlt { end: number; ability: Record<string, unknown>; entry: KeywordEntry; weak?: number }

/**
 * wave-4 cmd1 review (guard G2, design 6.8): the [text]s of "Partner--[text]" Oracle prints (CR 702.124i): a closed list, so a word the parser does not know
 * ("Partner--Blorfty") leaves the keyword line manual instead of a full card. A newly printed variant is one more entry here (until then the line is manual,
 * which is never wrong). The deck validator does not read this list: it pairs any two equal texts (packages/cards/src/formats/commander.ts#canPartner).
 */
const PARTNER_VARIANTS: ReadonlySet<string> = new Set(['friends forever', 'character select', 'survivors', 'father & son']);

/**
 * cmd1 (CR 702.124i, 702.124f): the [text] of "Partner--[text]" ("Partner--Friends forever", "Partner--Father & son"): every word after the dash to the end of the
 * keyword line, "&" allowed between two words, in lower case. The text has no rules meaning except that two commanders pair only when each has the same
 * "partner--[text]" ability (a deck-construction rule, CR 702.124a, packages/cards/src/formats/commander.ts#canPartner reads the Oracle line). Null when no dash
 * follows, the rest of the line is not such words, or the words are not one of the printed variants (PARTNER_VARIANTS).
 */
function partnerText(ctx: HoleCtx, pos: number): string | null {
  const d = phraseAt(ctx, pos, DASH);
  if (d < 0 || d >= ctx.toks.length) return null;
  const words: string[] = [];
  for (let i = d; i < ctx.toks.length; i++) {
    const t = ctx.toks[i]!;
    const amp = t.kind === 'PUNCT' && t.norm === '&';
    if (t.kind !== 'WORD' && !amp) return null;
    if (amp && (i === d || i === ctx.toks.length - 1 || ctx.toks[i + 1]!.kind !== 'WORD' || ctx.toks[i - 1]!.kind !== 'WORD')) return null;
    if (!amp && !/^[a-z][a-z'-]*$/.test(t.norm)) return null;
    words.push(t.norm);
  }
  const label = words.join(' ');
  return PARTNER_VARIANTS.has(label) ? label : null;
}

function amountAt(ctx: HoleCtx, pos: number): { end: number; amount: Quantity }[] {
  const t = ctx.toks[pos];
  if (t === undefined) return [];
  if (t.kind === 'X') return [{ end: pos + 1, amount: { q: 'X' } }];
  const n = numberAt(ctx, pos);
  return n === undefined ? [] : [{ end: pos + 1, amount: n }];
}

function costAt(ctx: HoleCtx, pos: number, choice = false, keyword = ''): { end: number; cost: CostDef }[] {
  const out: { end: number; cost: CostDef }[] = [];
  for (const m of ctx.call('ManaCost', pos)) out.push({ end: m.end, cost: { mana: m.value as ManaCost } });
  const d = phraseAt(ctx, pos, DASH);
  if (d >= 0) {
    for (const c of ctx.call('Cost', d)) out.push({ end: c.end, cost: c.value as CostDef });
    if (choice) out.push(...choiceCosts(ctx, d));
    if (keyword === 'cumulative upkeep') out.push(...addManaCost(ctx, d), ...drawCost(ctx, d), ...opponentGainsLifeCost(ctx, d));
  }
  return out;
}

const W_ADD = P('add');
/**
 * edh-mana-keywords-12 (CR 702.24a, 106.4, 118.1; Braid of Fire): the cost of a cumulative upkeep may be adding mana, "Cumulative upkeep--Add {R}.": the player adds that mana to
 * their pool once for each age counter. Only here (a cumulative upkeep's cost): an activated ability's cost never reads "add", so no other sentence gets a second reading. Plain
 * symbols of colors and {C}, in a row.
 */
function addManaCost(ctx: HoleCtx, pos: number): { end: number; cost: CostDef }[] {
  const a = phraseAt(ctx, pos, W_ADD);
  if (a < 0) return [];
  const run = unitRun(ctx, a);
  return run === null ? [] : [{ end: run.end, cost: { other: [{ kind: 'addMana', mana: run.types }] } }];
}

const W_AN_OPPONENT_GAINS = P('an opponent gains');
/**
 * edh-d-74 (CR 702.24a, 118.3, 119.3; Wall of Shards): the cost of a cumulative upkeep may be "An opponent gains 1 life.": the cost part `opponentGainsLife` (edh-cast-14: the payer chooses an
 * opponent who gains the life; ruling 2006-07-15: a different opponent for each age counter). Only here (a cumulative upkeep's cost): an activated ability's cost never reads it, so
 * no other sentence gets a second reading. A fixed number of life.
 */
function opponentGainsLifeCost(ctx: HoleCtx, pos: number): { end: number; cost: CostDef }[] {
  const a = phraseAt(ctx, pos, W_AN_OPPONENT_GAINS);
  if (a < 0) return [];
  const n = numberAt(ctx, a);
  if (typeof n !== 'number' || n < 1) return [];
  const e = phraseAt(ctx, a + 1, P('life'));
  return e < 0 ? [] : [{ end: e, cost: { other: [{ kind: 'opponentGainsLife', amount: n }] } }];
}

const W_DRAW_A_CARD = P('draw a card');
/**
 * edh-c-48 (CR 702.24a, 121.2; Psychic Vortex): the cost of a cumulative upkeep may be drawing a card, "Cumulative upkeep--Draw a card.": the player draws that many cards, one for each age
 * counter. Only here (a cumulative upkeep's cost): an activated ability's cost never reads "draw", so no other sentence gets a second reading.
 */
function drawCost(ctx: HoleCtx, pos: number): { end: number; cost: CostDef }[] {
  const e = phraseAt(ctx, pos, W_DRAW_A_CARD);
  return e < 0 ? [] : [{ end: e, cost: { other: [{ kind: 'draw', count: 1 }] } }];
}

const W_PAY = P('pay');

/**
 * FAST5X E27 (CR 702.21a, 702.6a, 118.12a): the cost of a keyword after its dash may be a choice between two costs, "Discard a card or pay {2}", "Pay {3} or
 * discard a card": a `oneOf` part whose options are whole costs. A mana option is written "pay {M}" there (only in this position: elsewhere the Cost hole
 * keeps its forms, so no other sentence gets a second reading). Each option is one cost of the Cost hole or "pay {M}".
 */
function choiceCosts(ctx: HoleCtx, pos: number): { end: number; cost: CostDef }[] {
  const paid = new Set<CostDef>(); // edh-d-88: the options written "pay {M}"
  const options = (p: number): { end: number; cost: CostDef }[] => {
    const o: { end: number; cost: CostDef }[] = ctx.call('Cost', p).map((c) => ({ end: c.end, cost: c.value as CostDef }));
    const pay = phraseAt(ctx, p, W_PAY);
    if (pay >= 0) for (const m of ctx.call('ManaCost', pay)) { const cost: CostDef = { mana: m.value as ManaCost }; paid.add(cost); o.push({ end: m.end, cost }); }
    return o;
  };
  const out: { end: number; cost: CostDef }[] = [];
  for (const a of options(pos)) {
    const or = phraseAt(ctx, a.end, W_OR);
    if (or < 0) continue;
    for (const b of options(or)) out.push({ end: b.end, cost: { other: [{ kind: 'oneOf', options: [a.cost, b.cost] }] } });
    // edh-d-88 (CR 107.14, 702.151a, 118.12a; Razorfield Ripper, "Reconfigure--Pay {2} or {E}{E}{E}"): after "pay {M} or", a bare run of energy symbols is the second option, paid
    // with the same verb ("pay {E}{E}{E}"); only after a first option that says "pay"
    if (paid.has(a.cost) && ctx.toks[or]?.norm === '{e}') {
      let e = or;
      while (ctx.toks[e]?.norm === '{e}') e++;
      out.push({ end: e, cost: { other: [{ kind: 'oneOf', options: [a.cost, { other: [{ kind: 'payEnergy', amount: e - or }] }] }] } });
    }
  }
  return out;
}

/**
 * T55 (CR 702.6a, 702.6c): the parameters a keyword may leave out. "Equip {2}" is the keyword with a cost and no quality ("equip Wizard {1}" is the one with
 * a filter, the template kw.t7.equip.subtype): the registry lists `filter` among equip's parameters (optional there), so a bare "equip {2}" in a list
 * ("with \"Equipped creature gets +1/+0\" and equip {2}") needs it to be skippable. Only in a list of abilities (`Abilities`): a keyword line of its own
 * ("Equip {2}") is read by the keyword templates, as before.
 */
const OPTIONAL_PARAMS: Readonly<Record<string, readonly string[]>> = { equip: ['filter'] };
/** edh-next-127 (CR 702.54b, 120.3): the X of "Bloodthirst X", the total damage dealt to the controller's opponents this turn (the history's damage entries, added up). */
export const BLOODTHIRST_X = { q: 'happenedCount', event: { ev: 'damage', recipient: { player: 'opponent' } }, scope: 'turn', sum: 'amount' } as const;
/** std-rx15 (CR 702.82b): parameters a keyword may leave out wherever it stands: "Devour 1" has no filter ("Devour land 3", "Devour Food 3" have one). */
const LEADING_OPTIONAL_PARAMS: Readonly<Record<string, readonly string[]>> = { devour: ['filter'] };

/**
 * trek-7: parameters of a keyword that only a grant gives and its words never write: a granted beam me up's `filter` (the creatures it may return, "Scotty can't be
 * beamed up to cast a spell this way", template sta.trek7.duringMain.each.beamMeUp.manaCost.selfCantBeamedUp), so "Beam me up {2}{W}" stays a keyword with a cost only.
 */
const GRANT_ONLY_PARAMS: Readonly<Record<string, readonly string[]>> = { 'beam me up': ['filter'] };

/**
 * FAST5X E27: the keywords whose cost may be a choice between costs here: ward, whose cost is paid as its trigger resolves (CR 702.21a, 118.12a; the `pay` op
 * resolves the choice). A cost paid while casting or activating has its cost changes applied to the total before the choice could be made, so no other keyword
 * reads one (equip's "Pay {3} or discard a card" is a template of its own, zz-fast5x/e27.json, with no cost change to apply).
 */
// edh-d-88 (CR 702.151a, 602.2b, 118.12a; Razorfield Ripper, "Reconfigure--Pay {2} or {E}{E}{E}"): and reconfigure, whose two activated abilities take the cost as it is; an activation whose
// cost is a choice is not offered at all while any cost change applies to it (actions/activate.ts#costChangeOf, FAST5X E27), so no wrong amount is charged
const CHOICE_COST_KEYWORDS: ReadonlySet<string> = new Set(['ward', 'reconfigure']);

/**
 * Parameter parses of a keyword, in the order of `params`; every param must parse (all or nothing), except those `OPTIONAL_PARAMS` lists for the keyword when
 * it stands in a list of abilities (`inList`).
 */
function paramParses(ctx: HoleCtx, pos: number, params: string[], keyword = '', inList = false): { end: number; fields: Record<string, unknown> }[] {
  let states: { end: number; fields: Record<string, unknown> }[] = [{ end: pos, fields: {} }];
  for (const prm of params) {
    const next: typeof states = [];
    for (const s of states) {
      if (GRANT_ONLY_PARAMS[keyword]?.includes(prm)) { next.push(s); continue; }
      const dashSkip = phraseAt(ctx, s.end, DASH);
      // edh-next-127 (CR 702.54b; Indoraptor, the Perfect Hybrid): "Bloodthirst X" means "enters with X +1/+1 counters on it, where X is the total damage your opponents have been dealt this turn":
      // the keyword's expansion (keywords/data/bloodthirst.json) with that total as its amount (its condition, an opponent was dealt damage, holds whenever the total is above 0)
      if (prm === 'amount' && keyword === 'bloodthirst') {
        for (const a of amountAt(ctx, s.end)) next.push({ end: a.end, fields: { ...s.fields, amount: JSON.stringify(a.amount) === '{"q":"X"}' ? BLOODTHIRST_X : a.amount } });
        continue;
      }
      if (prm === 'amount') for (const a of amountAt(ctx, s.end)) next.push({ end: a.end, fields: { ...s.fields, amount: a.amount } });
      else if (prm === 'cost') {
        const choice = CHOICE_COST_KEYWORDS.has(keyword);
        for (const c of costAt(ctx, s.end, choice, keyword)) next.push({ end: c.end, fields: { ...s.fields, cost: c.cost } });
        if (dashSkip >= 0) for (const c of costAt(ctx, dashSkip, choice, keyword)) next.push({ end: c.end, fields: { ...s.fields, cost: c.cost } });
      } else if (prm === 'quality') {
        const f = phraseAt(ctx, s.end, P('from'));
        // edh-next-127 (CR 702.119a-b; Crabomination): "Emerge {cost}" has no quality; "Emerge from artifact {cost}" (the variant "emerge from [quality]") names the kind of permanent to
        // sacrifice with a singular card type: only "artifact" (keywords/data/emerge.json has its branch; any other quality is no reading, so the line stays manual)
        if (keyword === 'emerge') {
          if (f < 0) next.push(s);
          else if (ctx.toks[f]?.norm === 'artifact') next.push({ end: f + 1, fields: { ...s.fields, quality: 'type:Artifact' } });
          continue;
        }
        if (f >= 0) for (const q of qualityAt(ctx, f)) if (q.quality !== OWN_COLORS || keyword === 'hexproof') next.push({ end: q.end, fields: { ...s.fields, quality: q.quality } });
      } else if (prm === 'filter') {
        if ((inList && OPTIONAL_PARAMS[keyword]?.includes(prm)) || LEADING_OPTIONAL_PARAMS[keyword]?.includes(prm)) next.push(s);
        // edh-next-69 (CR 702.47a): "Splice onto Arcane {1}{R}": the filter after "onto"
        const lead = keyword === 'splice' ? phraseAt(ctx, s.end, P('onto')) : phraseAt(ctx, s.end, P('for'));
        const at = lead >= 0 ? lead : s.end;
        for (const f of ctx.call('Filter', at)) next.push({ end: f.end, fields: { ...s.fields, filter: f.value } });
        const pl = ctx.toks[at]?.norm;
        if (pl === 'player') next.push({ end: at + 1, fields: { ...s.fields, player: 'any' } });
        if (pl === 'opponent') next.push({ end: at + 1, fields: { ...s.fields, player: 'opponent' } });
      }
    }
    states = next;
    if (states.length === 0) break;
  }
  return states;
}

/**
 * trek-20 (CR 702.14a, 608.2c; Concerted Effort): is the position inside the list of "The same is true for fear, first strike, ..., landwalk, protection, ..." (no sentence end
 * between "the same is true for" and here)? Only there a bare "landwalk" is read: every landwalk the creatures have, not a landwalk the engine can test alone.
 */
function inSameIsTrueFor(ctx: HoleCtx, pos: number): boolean {
  for (let i = pos - 1; i >= 3; i--) {
    const t = ctx.toks[i]!;
    if (t.kind === 'PUNCT' && t.norm === '.') return false;
    if (t.norm === 'for' && ctx.toks[i - 1]?.norm === 'true' && ctx.toks[i - 2]?.norm === 'is' && ctx.toks[i - 3]?.norm === 'same') return true;
  }
  return false;
}

function keywordAlts(ctx: HoleCtx, pos: number, inList = false): KwAlt[] {
  const out: KwAlt[] = [];
  for (const found of multiAt(ctx, pos, ctx.vocab.keywords)) {
    const entry = found.entry;
    // FAST5X-4 (CR 702.179): "Start your engines!" is written with its "!" (a punctuation token after the words)
    let m = found;
    if (entry.name.endsWith('!')) {
      const bang = ctx.toks[found.end];
      if (bang?.kind !== 'PUNCT' || bang.norm !== '!') continue;
      m = { ...found, end: found.end + 1 };
    }
    const base = { kind: 'keyword', keyword: entry.name };
    if (entry.params.length > 0) {
      for (const p of paramParses(ctx, m.end, entry.params, entry.name.toLowerCase(), inList)) out.push({ end: p.end, entry, ability: { ...base, ...p.fields, text: spanOf(ctx, pos, p.end) } });
    }
    // cmd1 (CR 702.124i): "Partner--Friends forever", a partner ability of its own whose text is its label (`quality`); a keyword line only
    if (entry.name === 'partner' && !inList) {
      const label = partnerText(ctx, m.end);
      if (label !== null) out.push({ end: ctx.toks.length, entry, ability: { ...base, quality: label, text: spanOf(ctx, pos, ctx.toks.length) } });
    }
    // a keyword without its parameters (hexproof; or a parameter the registry lists but the text does not give): only when no parameter parse exists,
    // and never for a keyword that is nothing without it (WP22 review, INTERFACE CHANGE)
    if (PARAMETER_REQUIRED.has(entry.name) && !(entry.name === 'landwalk' && (inSameIsTrueFor(ctx, pos) || (ctx.toks[pos - 2]?.norm === 'loses' && ctx.toks[pos - 1]?.norm === 'all' && ctx.toks[m.end]?.norm === 'abilities')))) continue; /* edh-next-24 (CR 702.14c; Hammerheim): "loses all landwalk abilities" */ // trek-20: "The same is true for ..., landwalk, ..." names the family (every landwalk the creatures have)
    if (entry.params.length === 0 || !out.some((o) => o.entry === entry && o.end > m.end)) out.push({ end: m.end, entry, ability: { ...base, text: spanOf(ctx, pos, m.end) } });
  }
  if (inList) out.push(...landwalkAlts(ctx, pos)); // keyword lines read landwalk with the kw.walk.* templates and cards/keywords.ts
  if (inList && pos > 0) out.push(...typecyclingAlts(ctx, pos)); // edh-next-142: keyword lines read typecycling with the kw.typecycling.* templates
  if (inList) out.push(...equipSubtypeAlts(ctx, pos));
  return out;
}

/**
 * edh-next-139 (CR 702.6a, 702.6c; Gemcutter Buccaneer): "equip Pirate {1}" in a list of abilities (only there: `inList`): the equip with a quality, its filter a creature of
 * those subtypes you control, as the keyword line's template kw.t7.equip.subtype reads it ("Equip Dwarf {2}"; a keyword line of its own is read by that template, as before).
 */
function equipSubtypeAlts(ctx: HoleCtx, pos: number): KwAlt[] {
  if (ctx.toks[pos]?.kind !== 'WORD' || ctx.toks[pos]!.norm !== 'equip') return [];
  const entry = ctx.vocab.keywords.get('equip');
  if (entry === undefined) return [];
  const out: KwAlt[] = [];
  for (const s of ctx.call('Subtypes', pos + 1)) {
    for (const m of ctx.call('ManaCost', s.end)) {
      const filter = { types: ['Creature'], subtypes: s.value as string[], controller: 'you' };
      out.push({ end: m.end, entry, ability: { kind: 'keyword', keyword: entry.name, cost: { mana: m.value as ManaCost }, filter, text: spanOf(ctx, pos, m.end) } });
    }
  }
  return out;
}

/**
 * edh-next-142 (CR 702.29a, 702.29e; Homing Sliver): a typecycling in a list of abilities a static ability grants ("Each Sliver card in each player's hand has slivercycling {3}"): the one word
 * "<subtype>cycling" (a subtype the vocabulary knows, singular) and its mana cost, read as the keyword line's kw.typecycling.* templates read it (a library card of that subtype). Only inside
 * a list (`inList`, never a keyword line of its own), and never "landcycling" (a card type, with words of its own before it).
 */
function typecyclingAlts(ctx: HoleCtx, pos: number): KwAlt[] {
  const t = ctx.toks[pos];
  const m = t?.kind === 'WORD' ? /^([a-z]+)cycling$/.exec(t.norm) : null;
  const sub = m !== null && m[1] !== 'land' ? ctx.vocab.subtypes.get(m[1]!) : undefined;
  const entry = ctx.vocab.keywords.get('typecycling');
  if (sub === undefined || sub.plural || entry === undefined) return [];
  return manaCost(ctx, pos + 1).map((c) => ({ end: c.end, entry, ability: { kind: 'keyword', keyword: entry.name, cost: { mana: c.value }, filter: { zone: 'library', subtypes: [sub.name] }, text: spanOf(ctx, pos, c.end) } }));
}

/** Cloud C3 (CR 702.14a): the land words a landwalk can have (the keyword line's cards/keywords.ts#parseLandwalk, which the parser may not import). */
const WALK_LAND_SUBTYPES: ReadonlySet<string> = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'desert', 'gate', 'lair', 'locus', 'cave', 'sphere', 'mine', 'tower', 'town']);
const WALK_QUALIFIERS: ReadonlySet<string> = new Set(['snow', 'legendary', 'basic', 'nonbasic', 'artifact']);

/**
 * Cloud C3 (CR 702.14a, 702.14c): a landwalk in a list of abilities (only there: `inList`), "Other Merfolk you control have islandwalk", "... and have swampwalk": the keyword is a
 * family the rules describe in prose ("<land>walk", "nonbasic landwalk", "snow forestwalk"), so it is no entry of the keyword vocabulary; read here as the
 * keyword line reads it (`quality`: the words that describe the land, keywords/hooks/landwalk.ts).
 */
function landwalkAlts(ctx: HoleCtx, pos: number): KwAlt[] {
  const out: KwAlt[] = [];
  // edh-d-72 (CR 702.14a, 702.14c, 607.2d; Traveler's Cloak): "landwalk of the chosen type", the land type the linked "As ~ enters, choose a land type." chose (quality `chosen:landType`,
  // read where the layers grant the keyword: statics/mods.ts#withChosenQualities)
  if (ctx.toks[pos]?.norm === 'landwalk') {
    const e = phraseAt(ctx, pos + 1, W_OF_THE_CHOSEN_TYPE);
    if (e >= 0) {
      const entry = ctx.vocab.keywords.get('landwalk') ?? { name: 'landwalk', params: ['quality'] };
      out.push({ end: e, entry, ability: { kind: 'keyword', keyword: entry.name, quality: 'chosen:landType', text: spanOf(ctx, pos, e) } });
    }
  }
  const words: string[] = [];
  for (let p = pos; p < pos + 3 && p < ctx.toks.length; p++) {
    const t = ctx.toks[p]!;
    if (t.kind !== 'WORD') break;
    if (t.norm.endsWith('walk') && t.norm !== 'planeswalk' && t.norm.length > 4) {
      const land = t.norm.slice(0, -4);
      const all = land === 'land' ? words : [...words, land];
      if (all.length > 0 && all.every((w) => WALK_LAND_SUBTYPES.has(w) || WALK_QUALIFIERS.has(w))) {
        const entry = ctx.vocab.keywords.get('landwalk') ?? { name: 'landwalk', params: ['quality'] };
        // weak (design 6.3 rule 2): a template that spells the landwalk out ("gains islandwalk", "has nonbasic landwalk") reads the same words first
        out.push({ end: p + 1, entry, ability: { kind: 'keyword', keyword: entry.name, quality: all.join(' '), text: spanOf(ctx, pos, p + 1) }, weak: 1 });
      }
      break;
    }
    if (!WALK_QUALIFIERS.has(t.norm)) break;
    words.push(t.norm);
  }
  return out;
}

/** A keyword ability with its parameters ("flying", "ward {2}", "protection from red", "toxic 1", "kicker {1}{G}", "enchant creature"). */
export const keyword: HoleFn = (ctx, pos) => dedupe(keywordAlts(ctx, pos).map((k) => ({ end: k.end, value: k.ability })));

const SEPARATORS = [P(', and'), P('and'), P(','), P('and/or')];

/**
 * The list after "gains", "has", "with": keywords and quoted abilities joined by commas and "and" ("flying and haste", "vigilance, and \"{T}: Add {G}.\"").
 * "protection from red and from blue" is two keyword abilities (CR 702.16b). A quoted ability needs `ctx.subParser`; without it the quote does not parse.
 * Returns every prefix of the list (the chart picks the one that ends where the template does).
 */
export const abilities: HoleFn = (ctx, pos) => abilitiesFor(ctx, pos);

/**
 * `Abilities`, for a list whose quoted abilities belong to an object that goes by `selfName` (T55: a token with a name of its own): `rename` rewrites the tokens
 * inside each quote before they are parsed (holes/token.ts#nameAsSelf), so the name there is the object itself.
 */
export function abilitiesFor(ctx: HoleCtx, pos: number, selfName?: string, rename?: (sub: readonly Tok[], name: string) => Tok[]): Alt[] {
  const out: Alt[] = [];
  const walk = (p: number, acc: unknown[], depth: number, weak = 0): void => {
    if (depth > 12) return; // std-combat-2: Super-Adaptoid lists ten keywords (was 8)
    const t = ctx.toks[p];
    const elems: { end: number; items: unknown[]; weak?: number; glued?: true }[] = [];
    for (const k of keywordAlts(ctx, p, true)) elems.push({ end: k.end, items: [k.ability], ...(k.weak ? { weak: k.weak } : {}) }); // Cloud C3: a landwalk's weakness carries to the list
    if (t?.kind === 'QUOTE' && t.sub !== undefined && ctx.subParser !== undefined) {
      // FAST5 T41: in a list of three or more, the comma that follows a quoted ability goes inside its closing quote (`reach, "A," and "B."`): it separates, it is no part of the ability
      const closing = t.sub[t.sub.length - 1];
      // edh-next-139 (Gemcutter Buccaneer): the same comma when the list goes on with a keyword (`have "A," equip Pirate {1}, and equip {3}`): the quote is glued to the next item
      const commaInside = closing?.kind === 'PUNCT' && closing.norm === ',' && ctx.toks[p + 1]?.kind === 'WORD';
      const listComma = commaInside && ctx.toks[p + 1]!.norm === 'and';
      const glued = commaInside && !listComma && keywordAlts(ctx, p + 1, true).length > 0;
      const inside = listComma || glued ? t.sub.slice(0, -1) : t.sub;
      let sub = ctx.subParser(selfName !== undefined && rename !== undefined ? rename(inside, selfName) : inside);
      // edh-next-130 (Shelob, Child of Ungoliant: `with "{2}, {T}, Sacrifice this token: You gain 3 life," and it loses ...`): the comma stands where the ability's own period would be;
      // when the ability reads only with its period, read it so (tried only after the reading without it found nothing)
      if ((sub === null || sub.length === 0) && listComma) {
        const dotted = [...inside, { ...closing!, norm: '.', text: '.' }];
        sub = ctx.subParser(selfName !== undefined && rename !== undefined ? rename(dotted, selfName) : dotted);
      }
      if (sub !== null && sub.length > 0) elems.push({ end: p + 1, items: sub, ...(glued ? { glued: true } : {}) });
    }
    // "from <quality>" continuing the previous quality keyword: "protection from red and from blue"
    const prev = acc[acc.length - 1] as Record<string, unknown> | undefined;
    if (prev !== undefined && prev['quality'] !== undefined && phraseAt(ctx, p, P('from')) >= 0) {
      for (const q of qualityAt(ctx, p + 1)) if (q.quality !== OWN_COLORS || prev['keyword'] === 'hexproof') elems.push({ end: q.end, items: [{ ...prev, quality: q.quality, text: `${prev['keyword'] as string} ${spanOf(ctx, p, q.end)}` }] });
    }
    for (const e of elems) {
      const items = [...acc, ...e.items];
      const w = weak + (e.weak ?? 0);
      // edh-next-139: a glued quote ends no list (its comma separates it from the next item, which must follow)
      if (e.glued) { walk(e.end, items, depth + 1, w); continue; }
      out.push({ end: e.end, value: items, ...(w > 0 ? { weak: w } : {}) });
      const sep = anyPhraseAt(ctx, e.end, SEPARATORS);
      if (sep >= 0) walk(sep, items, depth + 1, w);
      const sep2 = phraseAt(ctx, e.end, P(', and'));
      if (sep2 >= 0 && sep2 !== sep) walk(sep2, items, depth + 1, w);
    }
  };
  walk(pos, [], 0);
  return dedupe(out);
}
