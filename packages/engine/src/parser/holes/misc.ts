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
import { P, anyPhraseAt, dedupe, multiAt, numberAt, phraseAt, spanOf } from './core';
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
const W_EACH_OF_YOUR_OPPONENTS_Q = P('each of your opponents'); // std-rx15

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
  const ty = ctx.vocab.types.get(t.norm);
  if (ty !== undefined && ty.plural) out.push({ end: pos + 1, quality: `type:${ty.name}` });
  const st = ctx.vocab.supertypes.get(t.norm);
  if (st !== undefined) out.push({ end: pos + 1, quality: `supertype:${st.name}` });
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

function costAt(ctx: HoleCtx, pos: number, choice = false): { end: number; cost: CostDef }[] {
  const out: { end: number; cost: CostDef }[] = [];
  for (const m of ctx.call('ManaCost', pos)) out.push({ end: m.end, cost: { mana: m.value as ManaCost } });
  const d = phraseAt(ctx, pos, DASH);
  if (d >= 0) {
    for (const c of ctx.call('Cost', d)) out.push({ end: c.end, cost: c.value as CostDef });
    if (choice) out.push(...choiceCosts(ctx, d));
  }
  return out;
}

const W_PAY = P('pay');

/**
 * FAST5X E27 (CR 702.21a, 702.6a, 118.12a): the cost of a keyword after its dash may be a choice between two costs, "Discard a card or pay {2}", "Pay {3} or
 * discard a card": a `oneOf` part whose options are whole costs. A mana option is written "pay {M}" there (only in this position: elsewhere the Cost hole
 * keeps its forms, so no other sentence gets a second reading). Each option is one cost of the Cost hole or "pay {M}".
 */
function choiceCosts(ctx: HoleCtx, pos: number): { end: number; cost: CostDef }[] {
  const options = (p: number): { end: number; cost: CostDef }[] => {
    const o: { end: number; cost: CostDef }[] = ctx.call('Cost', p).map((c) => ({ end: c.end, cost: c.value as CostDef }));
    const pay = phraseAt(ctx, p, W_PAY);
    if (pay >= 0) for (const m of ctx.call('ManaCost', pay)) o.push({ end: m.end, cost: { mana: m.value as ManaCost } });
    return o;
  };
  const out: { end: number; cost: CostDef }[] = [];
  for (const a of options(pos)) {
    const or = phraseAt(ctx, a.end, W_OR);
    if (or < 0) continue;
    for (const b of options(or)) out.push({ end: b.end, cost: { other: [{ kind: 'oneOf', options: [a.cost, b.cost] }] } });
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
const CHOICE_COST_KEYWORDS: ReadonlySet<string> = new Set(['ward']);

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
      if (prm === 'amount') for (const a of amountAt(ctx, s.end)) next.push({ end: a.end, fields: { ...s.fields, amount: a.amount } });
      else if (prm === 'cost') {
        const choice = CHOICE_COST_KEYWORDS.has(keyword);
        for (const c of costAt(ctx, s.end, choice)) next.push({ end: c.end, fields: { ...s.fields, cost: c.cost } });
        if (dashSkip >= 0) for (const c of costAt(ctx, dashSkip, choice)) next.push({ end: c.end, fields: { ...s.fields, cost: c.cost } });
      } else if (prm === 'quality') {
        const f = phraseAt(ctx, s.end, P('from'));
        if (f >= 0) for (const q of qualityAt(ctx, f)) if (q.quality !== OWN_COLORS || keyword === 'hexproof') next.push({ end: q.end, fields: { ...s.fields, quality: q.quality } });
      } else if (prm === 'filter') {
        if ((inList && OPTIONAL_PARAMS[keyword]?.includes(prm)) || LEADING_OPTIONAL_PARAMS[keyword]?.includes(prm)) next.push(s);
        const lead = phraseAt(ctx, s.end, P('for'));
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
    if (PARAMETER_REQUIRED.has(entry.name)) continue;
    if (entry.params.length === 0 || !out.some((o) => o.entry === entry && o.end > m.end)) out.push({ end: m.end, entry, ability: { ...base, text: spanOf(ctx, pos, m.end) } });
  }
  if (inList) out.push(...landwalkAlts(ctx, pos)); // keyword lines read landwalk with the kw.walk.* templates and cards/keywords.ts
  return out;
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
    const elems: { end: number; items: unknown[]; weak?: number }[] = [];
    for (const k of keywordAlts(ctx, p, true)) elems.push({ end: k.end, items: [k.ability], ...(k.weak ? { weak: k.weak } : {}) }); // Cloud C3: a landwalk's weakness carries to the list
    if (t?.kind === 'QUOTE' && t.sub !== undefined && ctx.subParser !== undefined) {
      // FAST5 T41: in a list of three or more, the comma that follows a quoted ability goes inside its closing quote (`reach, "A," and "B."`): it separates, it is no part of the ability
      const closing = t.sub[t.sub.length - 1];
      const listComma = closing?.kind === 'PUNCT' && closing.norm === ',' && ctx.toks[p + 1]?.kind === 'WORD' && ctx.toks[p + 1]!.norm === 'and';
      const inside = listComma ? t.sub.slice(0, -1) : t.sub;
      const sub = ctx.subParser(selfName !== undefined && rename !== undefined ? rename(inside, selfName) : inside);
      if (sub !== null && sub.length > 0) elems.push({ end: p + 1, items: sub });
    }
    // "from <quality>" continuing the previous quality keyword: "protection from red and from blue"
    const prev = acc[acc.length - 1] as Record<string, unknown> | undefined;
    if (prev !== undefined && prev['quality'] !== undefined && phraseAt(ctx, p, P('from')) >= 0) {
      for (const q of qualityAt(ctx, p + 1)) if (q.quality !== OWN_COLORS || prev['keyword'] === 'hexproof') elems.push({ end: q.end, items: [{ ...prev, quality: q.quality, text: `${prev['keyword'] as string} ${spanOf(ctx, p, q.end)}` }] });
    }
    for (const e of elems) {
      const items = [...acc, ...e.items];
      const w = weak + (e.weak ?? 0);
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
