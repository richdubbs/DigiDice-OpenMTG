/**
 * Continuous effects as sentences (WP2): "Target creature gets +3/+3 until end of turn", "Creatures you control get +1/+1", "Enchanted creature gets +2/+0
 * and has trample", "All creatures lose all abilities and have base power and toughness 1/1", "~ becomes a 2/2 creature with all creature types until end
 * of turn. It's still a land." (design 2.3 `ContinuousEffectDef`, CR 613, 611).
 *
 * The verb phrases are ordered the way Oracle orders them (loses abilities, becomes/is, base power and toughness, gets +X/+Y, gains/has abilities), whatever
 * the order of the modifications in the JSON, because the layers order the effect, not the text. A modification this file cannot print is a NoRenderer
 * error: the effect is never printed with a layer silently left out.
 */
import type { AbilityDef, ContinuousEffectDef, Duration, Modification, ObjectFilter, ObjRef, PlayerRef, Quantity, TypeChange } from '../types/ability';
import { K } from './kernel';
import { hasDashCost, keywordList, keywordWords } from './kw';
import { countParts } from './qty';
import { eachSubjects, identityOf, isPlayerRef } from './refs';
import { quotedAbility, quotedListItem } from './quote';
import { copyExceptText, retainThisText } from './copy-except';
import { cloneState, objKey, type RenderState } from './state';
import { alt, article, COLOR_WORD, conj, firstAlt, joinList, mapEnds, parseMarked, lowerType, NoRenderer, numWord, pluralize, signed, withArticle } from './text';

type ModOf<L extends Modification['layer']> = Extract<Modification, { layer: L }>;

const find = <L extends Modification['layer']>(mods: Modification[], layer: L): ModOf<L>[] => mods.filter((m): m is ModOf<L> => m.layer === layer);

/** MX2: what "that <noun>'s color" calls the copied object: a target's or an `each` filter's first noun; '' when the text can't say (the wording is refused). */
function copiedNoun(ref: ObjRef, st: RenderState): string {
  const f = ref.ref === 'target' ? st.specs.get(ref.id)?.filter : ref.ref === 'each' ? ref.filter : undefined;
  return f ? K.nounsOf(f)[0] ?? '' : '';
}

/**
 * MX2: the object a copy effect copies, named while the affected object is no antecedent of it (an object never becomes a copy of itself, CR 707.2): in
 * "Whenever another creature enters, ~ becomes a copy of that creature" "that creature" is the one that entered, never ~.
 */
function copiedText(of: ObjRef, affects: ObjRef | PlayerRef, st: RenderState): string {
  const key = objKey(affects as ObjRef);
  const saved = st.notAntecedent;
  if (key !== null) st.notAntecedent = identityOf(st, key);
  try {
    return K.obj(of, st, 'object').text;
  } finally {
    if (saved === undefined) delete st.notAntecedent;
    else st.notAntecedent = saved;
  }
}

const isNum = (q: Quantity | undefined): q is number => typeof q === 'number';
const unlive = (q: Quantity): Quantity => (typeof q === 'object' && q.q === 'live' ? unlive(q.value) : q);
const same = (a: Quantity | undefined, b: Quantity | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);
/** std-rr: the one object whose power and toughness these are ("~'s power and toughness"), read once (never `live`); null for any other pair of values. */
function objectPT(p: Quantity, t: Quantity): ObjRef | null {
  if (typeof p !== 'object' || typeof t !== 'object' || p.q !== 'stat' || t.q !== 'stat' || p.stat !== 'power' || t.stat !== 'toughness') return null;
  if (Object.keys(p).length !== 3 || Object.keys(t).length !== 3 || JSON.stringify(p.of) !== JSON.stringify(t.of)) return null;
  return p.of;
}

/** "+2/+0", "+X/+X", "-1/-1" with the "where X is ..." clauses; and the "for each" wording when one counted quantity drives it. */
/** r4-static: N of `min(N, the number of creature types of the modified object itself)`, else null. */
function ownCreatureTypesCap(q: Quantity): number | null {
  if (typeof q !== 'object' || q.q !== 'math' || q.op !== 'min' || q.args.length !== 2) return null;
  const [n, d] = q.args;
  if (typeof n !== 'number' || typeof d !== 'object' || d.q !== 'distinct' || d.what !== 'creatureTypes' || d.among.ref !== 'subject') return null;
  return n;
}

function powerToughness(power: Quantity | undefined, toughness: Quantity | undefined, st: RenderState): { text: string; where: string[]; forEach?: string } {
  const p = power === undefined ? 0 : unlive(power);
  const t = toughness === undefined ? 0 : unlive(toughness);
  if (isNum(p) && isNum(t)) return { text: `${signed(p)}/${signed(t)}`, where: [] };
  // PUSH1 T2: the X of the cost itself (CR 107.3a, the PT hole's "+X" and "-X") is printed as it is: "+X/+0", "-X/-X" need no "where X is ..." clause
  const costX = (q: Quantity): string | null => {
    if (typeof q !== 'object') return null;
    if (q.q === 'X') return '+X';
    if (q.q === 'math' && q.op === '*' && q.args.length === 2 && q.args[0] === -1 && typeof q.args[1] === 'object' && q.args[1].q === 'X') return '-X';
    return null;
  };
  if ((isNum(p) || costX(p) !== null) && (isNum(t) || costX(t) !== null)) return { text: `${isNum(p) ? signed(p) : costX(p)!}/${isNum(t) ? signed(t) : costX(t)!}`, where: [] };
  const summed = sumForEach(p, t, st);
  if (summed !== null) return { text: summed, where: [] };
  // r4-static (CR 205.3m, 613.4c): "+1/+1 for each of its creature types, to a maximum of 10" (Diligent Zookeeper): each modified object counts its own creature
  // types, at most N
  const cap = ownCreatureTypesCap(p);
  if (cap !== null && same(p, t)) return { text: '+X/+X', where: [`X is ${K.qty(p, st)}`], forEach: `+1/+1 for each of its creature types, to a maximum of ${numWord(cap)}` };
  // FAST2 T9: a negated calculated quantity reads "-X" with "where X is" the quantity itself ("gets -X/-X until end of turn, where X is the number of cards in
  // your hand"): `-1 * q` is the meaning of the minus sign (the PT hole writes -X as that product, and "where X is" puts the quantity in for X, CR 107.3, 608.2h)
  const mag = (q: Quantity): Quantity => negated(q) ?? q;
  const dynamic: Quantity[] = [];
  for (const q of [p, t]) if (!isNum(q) && !dynamic.some((d) => same(d, mag(q)))) dynamic.push(mag(q));
  const letter = (q: Quantity): string => (dynamic.findIndex((d) => same(d, mag(q))) === 0 ? 'X' : 'Y');
  const part = (q: Quantity): string => (isNum(q) ? signed(q) : `${negated(q) ? '-' : '+'}${letter(q)}`);
  const where = dynamic.map((q) => `${letter(q)} is ${K.qty(q, st)}`);
  // "+1/+1 for each Elf you control"; FAST2 T9: also a whole multiple of one count ("+2/+0 for each other attacking Goblin" is `2 * count`, "-1/-1 for each"
  // is `-1 * count`), the other value 0
  let forEach: string | undefined;
  const up = perUnit(p);
  const ut = perUnit(t);
  const inner = up.inner ?? ut.inner;
  const fits = (u: { k: number; inner: Quantity | null }): boolean => (u.inner === null ? u.k === 0 : inner !== null && same(u.inner, inner));
  if (inner !== null && fits(up) && fits(ut)) {
    const per = countParts(inner, st);
    if (per) forEach = `${signed(up.inner === null ? 0 : up.k)}/${signed(ut.inner === null ? 0 : ut.k)} for each ${per.singular}${onBattlefield(inner)}`;
  }
  // FAST2 T7: "+4/+4 for each other Giant you control", "+2/+0 for each ...": each side a fixed multiple of one count (CR 613.4c)
  if (forEach === undefined) {
    const scaled = (q: Quantity): { n: number; c: Quantity | null } | null => {
      if (isNum(q)) return q === 0 ? { n: 0, c: null } : null;
      if (q.q === 'math' && q.op === '*' && q.args.length === 2 && isNum(q.args[0]) && q.args[0] >= 0 && q.args[1] !== undefined && !isNum(q.args[1])) return { n: q.args[0], c: unlive(q.args[1]) };
      return null;
    };
    const a = scaled(p);
    const b = scaled(t);
    const counted = [a?.c, b?.c].filter((c): c is Quantity => c !== null && c !== undefined);
    if (a && b && counted.length > 0 && counted.every((c) => same(c, counted[0]))) {
      const c0 = counted[0]!;
      // r4-static (CR 613.4c): "+2/+0 for every seven cards in your graveyard": a fixed multiple of a count divided by N, rounded down
      const every = typeof c0 === 'object' && c0.q === 'math' && c0.op === 'floorDiv' && c0.args.length === 2 && isNum(c0.args[1]) && c0.args[1] >= 2 ? c0 : null;
      const per = countParts(every !== null ? every.args[0]! : c0, st);
      if (per && every !== null) forEach = `+${a.n}/+${b.n} for every ${numWord(every.args[1] as number)} ${per.plural}${onBattlefield(every.args[0]!)}`;
      else if (per) forEach = `+${a.n}/+${b.n} for each ${per.singular}${onBattlefield(c0)}`;
    }
  }
  return { text: `${part(p)}/${part(t)}`, where, forEach };
}

/**
 * FAST4 T29 (family on-the-battlefield): "for each other enchantment" also reads "for each other enchantment on the battlefield" (CR 110.1): a count of a
 * filter that names no controller, owner or other zone counts the permanents of every player. '' for any other quantity.
 */
function onBattlefield(q: Quantity): string {
  if (typeof q !== 'object' || q.q !== 'count' || q.of.ref !== 'each') return '';
  const f = q.of.filter;
  return f.controller === undefined && f.owner === undefined && (f.zone === undefined || f.zone === 'battlefield') ? alt('', ' on the battlefield') : '';
}

/**
 * FAST4 T29: "+1/+1 for each creature you control and each creature card in your graveyard" (CR 613.4c, 107.1): each side a whole multiple of ONE sum of
 * two counts of things (or 0). The sum has no "where X is ..." wording (render/qty.ts#checkGrouping refuses a sum inside a product), so this is the only
 * reading; the two counts in either order (model/canonical.ts sorts the operands of a sum). Null for anything else.
 */
function sumForEach(p: Quantity, t: Quantity, st: RenderState): string | null {
  const side = (q: Quantity): { n: number; s: Extract<Quantity, { q: 'math' }> | null } | null => {
    if (isNum(q)) return q === 0 ? { n: 0, s: null } : null;
    if (q.q !== 'math' || q.op !== '*' || q.args.length !== 2 || !isNum(q.args[0]) || q.args[0] < 0) return null;
    const s = unlive(q.args[1]!);
    return typeof s === 'object' && s.q === 'math' && s.op === '+' && s.args.length === 2 ? { n: q.args[0], s } : null;
  };
  const a = side(p);
  const b = side(t);
  if (a === null || b === null) return null;
  const sums = [a.s, b.s].filter((s): s is Extract<Quantity, { q: 'math' }> => s !== null);
  if (sums.length === 0 || !sums.every((s) => same(s, sums[0]))) return null;
  const terms = sums[0]!.args;
  if (!terms.every((x) => typeof x === 'object' && x.q === 'count' && x.of.ref === 'each')) return null;
  const [x, y] = terms.map((q) => countParts(q, st)!.singular);
  return `+${a.n}/+${b.n} for each ${alt(`${x} and each ${y}`, `${y} and each ${x}`)}`;
}

/**
 * FAST3 T12: the words of a count under an attached-to subject. In "Enchanted creature gets +1/+1 for each other creature you control" the word "other"
 * excludes the enchanted creature, which the model says with `attachedToSource: false` (not the object the source is attached to); `other: true` would
 * exclude the Aura. Only the rendering is changed, and only where the subject of the sentence is that attached-to object.
 */
function otherThanHost<T>(q: T): T {
  if (Array.isArray(q)) return q.map(otherThanHost) as T;
  if (q === null || typeof q !== 'object') return q;
  const o = q as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = otherThanHost(v);
  if (out['attachedToSource'] === false && out['other'] === undefined && out['self'] === undefined) {
    delete out['attachedToSource'];
    out['other'] = true;
  }
  return out as T;
}

/**
 * FAST3 T12: on an Aura (its own text, not a quoted ability it grants), "other creatures" are the creatures other than the enchanted one (Vampirism:
 * "Other creatures you control get -1/-1" spares the enchanted creature). The Aura itself is not a creature, so `other: true` (not the source) would say
 * nothing: such a filter has no words there and is refused (design 6.8: never a wrong reading). Equipment is left as it was (no Oracle text uses the
 * wording; the template examples of FAST1 T5 render "other creatures" on a synthetic Equipment).
 */
function hostOther(f: ObjectFilter, st: RenderState): boolean {
  const own = (st.ctx.selfTypes ?? []).map((t) => t.toLowerCase());
  return st.depth === 0 && own.includes('aura') && f.other === true && (f.types ?? []).includes('Creature') && !own.includes('creature');
}
function hasHostOther(v: unknown, st: RenderState): boolean {
  if (Array.isArray(v)) return v.some((x) => hasHostOther(x, st));
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (o['ref'] === 'each' && o['filter'] !== undefined && hostOther(o['filter'] as ObjectFilter, st)) return true;
  return Object.values(o).some((x) => hasHostOther(x, st));
}

/** FAST2 T9: `-1 * q` (q calculated) is q negated; null for anything else. */
function negated(q: Quantity): Quantity | null {
  if (typeof q !== 'object' || q.q !== 'math' || q.op !== '*' || q.args.length !== 2 || q.args[0] !== -1) return null;
  const inner = q.args[1]!;
  return isNum(inner) ? null : inner;
}

/** FAST2 T9: a P/T change as a whole multiple of a calculated quantity: `k * q` is {k, q}, a lone q is {1, q}, a number is {k: the number, inner: null}. */
function perUnit(q: Quantity): { k: number; inner: Quantity | null } {
  if (isNum(q)) return { k: q, inner: null };
  if (q.q === 'math' && q.op === '*' && q.args.length === 2 && isNum(q.args[0]) && q.args[0] !== 0 && !isNum(q.args[1]!)) return { k: q.args[0], inner: q.args[1]! };
  return { k: 1, inner: q };
}

/** "base power and toughness 1/1" or "base power and base toughness each equal to its mana value". */
function baseText(power: Quantity | undefined, toughness: Quantity | undefined, st: RenderState): string {
  const p = power === undefined ? undefined : unlive(power);
  const t = toughness === undefined ? undefined : unlive(toughness);
  if (p !== undefined && t !== undefined && isNum(p) && isNum(t)) return `base power and toughness ${p}/${t}`;
  // FAST5 T60 (family base-pt-x-over-x): "base power and toughness each equal to the number of creatures you control", "base power and toughness X/X, where X is your life total"
  if (p !== undefined && t !== undefined && same(p, t)) {
    const q = K.qty(p, st);
    // std-rx12 (CR 107.3a, 613.4b): of the announced X itself, also "base power and toughness X/X" (no "where" clause: X is the value announced)
    const announced = typeof p === 'object' && p.q === 'X' ? ['base power and toughness X/X'] : [];
    return alt(`base power and base toughness each equal to ${q}`, `base power and toughness each equal to ${q}`, `base power and toughness X/X, where X is ${q}`, ...announced);
  }
  const bits: string[] = [];
  if (p !== undefined) bits.push(`base power ${isNum(p) ? p : `equal to ${K.qty(p, st)}`}`);
  if (t !== undefined) bits.push(`base toughness ${isNum(t) ? t : `equal to ${K.qty(t, st)}`}`);
  return joinList(bits);
}

function typeWords(c: TypeChange | undefined, kind: 'types' | 'subtypes' | 'supertypes'): { add: string[]; set: string[] } {
  const fmt = (x: string): string => (kind === 'subtypes' ? x : lowerType(x));
  return { add: (c?.add ?? []).map(fmt), set: (c?.set ?? []).map(fmt) };
}

/** Abilities granted or listed: keywords as words ("flying and vigilance", "protection from red and from blue"), others in quotes. */
export function abilityList(abilities: AbilityDef[], st: RenderState, noun: string): string {
  // CLOUD std-dft (CR 702.21a, 702.24a): a keyword whose cost is not only mana is a line of its own that ends with a period ("Ward--Pay 2 life."); granted,
  // Oracle quotes it like any other ability ('Artifacts you control have "Ward--Pay 2 life."', 'Enchanted creature has "Cumulative upkeep--Pay 1 life."')
  const quotedKeyword = (a: AbilityDef): boolean => a.kind === 'keyword' && hasDashCost(a);
  const kw = abilities.filter((a) => a.kind === 'keyword' && !quotedKeyword(a));
  const other = abilities.filter((a) => a.kind !== 'keyword' || quotedKeyword(a));
  const bits: string[] = [];
  if (kw.length > 0) bits.push(keywordList(kw as never, st));
  // FAST5 T41: only the last item of the list ends with the full stop inside its quotes; the others end "A" and, from three items on, "A," (the comma
  // of the list is inside the quote: no second comma follows it)
  const items = bits.length + other.length;
  const commaInside = items >= 3 && other.length > 1;
  const first = bits.length;
  other.forEach((a, i) => {
    const q = quotedAbility(a, st, noun);
    const item = i < other.length - 1 ? quotedListItem(q, items >= 3 ? 'comma' : 'none') : q;
    // FAST5X E14: of two quoted abilities, Oracle mostly ends the first without its period ('has "You may look at the top card of your library any time"
    // and "Whenever this creature attacks, it explores."'), sometimes with it; both readings are the same ability (family quoted-ability-period)
    bits.push(item !== q && items < 3 && q.endsWith('."') ? alt(item, q) : item);
  });
  const plain = !commaInside ? joinList(bits) : bits.map((b, i) => (i === bits.length - 1 ? `and ${b}` : i >= first ? `${b} ` : `${b}, `)).join('');
  // cmd1 (CR 702.21a, 113.1a): from three items on, with more than one quoted (std-dft's quoted dash-cost keywords among them), Oracle lists each keyword as an
  // item of its own: 'have menace, deathtouch, "Ward--Pay 2 life," and "At the beginning of your upkeep, ..."' (Cultist of the Absolute) grants the same
  // abilities as 'have menace and deathtouch, "Ward--Pay 2 life," and "..."' (family quoted-dash-keyword-grant)
  const qualified = kw.some((k) => k.kind === 'keyword' && k.keyword === 'protection' && k.quality !== undefined);
  // std-r8 (CR 702.1, 113.1a; family keyword-list-quoted): two or more keywords and ONE quoted ability are also one list, each keyword an item of its own:
  // 'has first strike, trample, indestructible, haste, and "Whenever ..."' grants the same abilities as 'has first strike, trample, indestructible, and haste and "..."'
  if (!commaInside && kw.length >= 2 && other.length === 1 && !qualified) return alt(plain, [...kw.map((k) => `${keywordWords(k as never, st)}, `), `and ${bits[first]!}`].join(''));
  if (!commaInside || kw.length < 2 || qualified) return plain;
  const each = [...kw.map((k) => `${keywordWords(k as never, st)}, `), ...bits.slice(first).map((b, i) => (i === other.length - 1 ? `and ${b}` : `${b} `))].join('');
  return alt(plain, each);
}

/**
 * std-mkm (CR 205.1b, 613.1d, 613.1f, 613.4b): "<subject> is a 4/4 Gorgon creature with deathtouch and lifelink in addition to its other types" for a continuous
 * effect of exactly three modifications: the creature type and creature types ADDED (layer 4, nothing set or removed), abilities given (layer 6, nothing taken
 * away) and numeric base power and toughness (layer 7b). Null for anything else.
 */
function sizedCreatureWith(e: ContinuousEffectDef, st: RenderState, subject: string): string | null {
  if (e.mods.length !== 3 || e.cda === true) return null;
  const m4 = e.mods.find((m): m is Extract<Modification, { layer: 4 }> => m.layer === 4);
  const m6 = e.mods.find((m): m is Extract<Modification, { layer: 6 }> => m.layer === 6);
  const m7 = e.mods.find((m): m is Extract<Modification, { layer: '7b' }> => m.layer === '7b');
  if (m4 === undefined || m6 === undefined || m7 === undefined) return null;
  const onlyAdd = (c: TypeChange | undefined): string[] | null => (c !== undefined && Object.keys(c).every((k) => k === 'add') && (c.add?.length ?? 0) > 0 ? c.add! : null);
  const types = onlyAdd(m4.types);
  const subs = onlyAdd(m4.subtypes);
  if (Object.keys(m4).some((k) => !['layer', 'types', 'subtypes'].includes(k)) || types === null || types.length !== 1 || types[0] !== 'Creature' || subs === null) return null;
  if (Object.keys(m6).some((k) => k !== 'layer' && k !== 'add') || (m6.add?.length ?? 0) === 0) return null;
  const p = m7.power === undefined ? undefined : unlive(m7.power);
  const t = m7.toughness === undefined ? undefined : unlive(m7.toughness);
  if (!isNum(p) || !isNum(t) || Object.keys(m7).some((k) => !['layer', 'power', 'toughness'].includes(k))) return null;
  const list = abilityList(m6.add!, cloneState(st), granteeNoun(subject, e, st));
  return `${subject} is ${article(`${p}/${t}`)} ${p}/${t} ${subs.join(' ')} creature with ${list} in addition to its other types`;
}

const GRANTEE_NOUNS = ['creature', 'land', 'artifact', 'enchantment', 'planeswalker', 'permanent', 'battle'];

/**
 * FXC (audit m2): the noun a granted quoted ability calls the object that gets it ("this creature"). It is the card-type noun of the subject the
 * sentence names ("enchanted land" -> "this land", "Sliver creatures you control" -> "this creature", "equipped creature" -> "this creature"); for the
 * object itself ("~ has ...") its own card type, creature first; "creature" when neither says one. The render gate reads every "this <noun>" as "~", so
 * the noun changes only the display.
 */
function granteeNoun(subject: string, e: ContinuousEffectDef, st: RenderState): string {
  const named = nounIn(subject);
  if (named !== null) return named;
  if (e.affects.ref === 'self') {
    const own = (st.ctx.selfTypes ?? []).map(lowerType).filter((t) => GRANTEE_NOUNS.includes(t));
    if (own.length > 0) return own.includes('creature') ? 'creature' : own[0]!;
  }
  return 'creature';
}

/** The card-type noun of the display form of a subject phrase: "artifact creatures" -> creature, "enchanted land" -> land; null when it names none. */
function nounIn(subject: string): string | null {
  const named = firstAlt(subject).toLowerCase().split(/[^a-z]+/).map((w) => (w.endsWith('s') ? w.slice(0, -1) : w)).filter((w) => GRANTEE_NOUNS.includes(w));
  if (named.length === 0) return null;
  return named.includes('creature') ? 'creature' : named[named.length - 1]!;
}

/**
 * FXC (audit m2): a subject whose words the renderer can't pin down is one alternative group ("enchanted creature" | "enchanted land" | ... for an Aura,
 * render/refs.ts#attachedOptions). When the effect grants a quoted ability, the quoted "this <noun>" must follow the subject the reading chose, so the
 * sentence is built once per subject option (the options as an alternative group of whole sentences). Null when there is nothing to split.
 */
function grantSubjects(subject: string, e: ContinuousEffectDef): string[] | null {
  if (!e.mods.some((m) => m.layer === 6 && (m.add ?? []).some((a) => a.kind !== 'keyword'))) return null;
  const nodes = parseMarked(subject);
  const group = nodes.length === 1 ? nodes[0]! : null;
  if (group === null || typeof group === 'string') return null;
  const options = group.alts.map((a) => (a.length === 1 && typeof a[0] === 'string' ? a[0] : null));
  if (options.some((o) => o === null)) return null;
  return new Set(options.map((o) => nounIn(o!))).size > 1 ? (options as string[]) : null;
}

interface Pieces {
  preds: string[];
  where: string[];
  rider?: string;
  /** std-rh: the same rider said inside the sentence, "becomes a 3/3 Elemental creature with haste that's still a land" (Brave the Wilds). */
  riderInline?: string;
  /**
   * WP22 FIX: the "+1/+1 for each X" reading of one counted P/T change (preds[index] replaced by `text`). It states the count itself, so it must not
   * also carry that change's "where X is ..." clause; before this fix the clause was appended to both readings and the "for each" reading never matched.
   */
  forEach?: { index: number; text: string; where: string[]; head: string; tail: string };
  /** FAST2 T9: the "becomes a 3/3 Cat creature" reading of the identity (preds[index]) when the base P/T is said in front of the type words. */
  sized?: { index: number; text: string; suffix?: string };
  /**
   * FAST5 T47: the same reading when the effect also gives every creature type, without those words ("becomes a 3/3 creature"): the granted abilities then
   * come before them, "becomes a 3/3 creature with vigilance and all creature types" (CR 702.73a, 613.1f).
   */
  sizedAll?: { index: number; text: string; suffix?: string };
  /** FAST5 T47: preds[typeOnly] is "becomes an enchantment", the one change of the effect (a card type set, nothing else). */
  typeOnly?: number;
  /** FAST2 T9: the abilities a resolved effect grants (preds[index] is "gains <list>"), for the "becomes a 2/2 Bird creature with flying" reading. */
  granted?: { index: number; list: string };
  /**
   * Cloud std-woe: a static ability's identity with its base power and toughness (preds[index] is "is a Dragon with base power and toughness 4/4") and the abilities it
   * has (preds[grant.index] is "has <list>"; `items` are the list's items), for the one "with" list Oracle also writes: "is a Dragon with base power and toughness 4/4,
   * flying, and "{R}: ..."" (Goddric, Cloaked Reveler).
   */
  withBase?: { index: number; text: string };
  staticGrant?: { index: number; items: string[] };
  /** FAST4 T29: a static ability's "is a Samurai in addition to its other types" (preds[index]), which Oracle may say after the other changes. */
  typeAdd?: number;
  /**
   * FAST5 T69: the predicates of a named identity say their subject again, "it becomes a legendary creature named Mileva, the Stalwart, it has base power and
   * toughness 5/5, and it gains ..." (CR 201.2, 613.1d): each one after the first begins "it".
   */
  itJoin?: boolean;
  /**
   * FAST5 T69 (CR 205.1a): preds[index] is "becomes a Treasure artifact" for a card type SET by a resolved effect with no duration; `text` is its "is a Treasure
   * artifact" form. Oracle may say the same effect "It's a Treasure artifact with "...," and it loses all other card types" (a set type replaces the others).
   */
  loseOthers?: { index: number; text: string; plural?: true };
  /** FAST5 T41: "loses all creature types" (preds[index]), which Oracle may also say before the other changes. */
  typeLoss?: number;
  /** cloud std-spm (CR 105.2c, 613.1e): preds[index] is a color set alone ("becomes colorless", "becomes blue"), which Oracle may say after a grant. */
  colorOnly?: number;
  /**
   * CLOUD C8 (CR 107.3, 608.2h, 613.4b): the "becomes an X/X Cat artifact creature" reading of preds[index], a resolved identity whose base power and toughness are
   * one computed number `q`, said with its own "where X is" clause after the duration.
   */
  sizedX?: { index: number; text: string; q: string };
  /**
   * FAST5 T77 (CR 205.1b, 611.2a): preds[0] of a resolved effect that only ADDS types ("becomes a Bear in addition to its other types"); `inAddition` is that
   * predicate with "in addition to its (their) other types", which Oracle says with "is" ("It's a Demon in addition to its other types", "They are 5/5 Elemental
   * creatures in addition to their other types") when the effect has no duration (it lasts for good), and without the rider "It's still a land".
   */
  inAddition?: string;
  /** p2-typechange-1: the sized identity of a land that ADDS the artifact and creature types, said with "It's still a land." after the sentence (family still-land-artifact-creature). */
  stillLand?: string;
  /** FAST5 T77 (CR 613.4b, 205.1b): a static ability's "is a Construct creature with base power and toughness 5/5 in addition to its other types" (Puppet Crafting), said in one phrase. */
  baseAdd?: string;
  /** FAST5 T64 (CR 707.9b, 611.2a): a copy effect's exceptions (`tail`, ", except it isn't legendary") said after its duration: preds[index] is `head` + `tail`. */
  copyExcept?: { index: number; head: string; tail: string };
}

const THE_CARD_TYPES = ['land', 'artifact', 'enchantment', 'planeswalker', 'creature', 'battle'];

/** "It's still a land." The type word is the object's own when the renderer knows it (RenderContext.selfTypes), otherwise any card type. */
function riderText(st: RenderState, e: ContinuousEffectDef, kept: readonly string[] = []): string {
  const own = e.affects.ref === 'self' ? st.ctx.selfTypes?.map(lowerType).filter((t) => THE_CARD_TYPES.includes(t)) : undefined;
  const types = own && own.length > 0 ? [own.join(' ')] : THE_CARD_TYPES;
  // FAST5 T47 (CR 205.1b): "It's still a Cave land": the object keeps its land type and the land types named with it (the effect lists them in `subtypes.add`)
  const words = types.map((t) => (kept.length > 0 ? `${kept.join(' ')} ${t}` : t));
  return alt(...words.flatMap((t) => [`it's still ${article(t)} ${t}`, `that permanent is still ${article(t)} ${t}`, `that ${t} is still ${article(t)} ${t}`]));
}

/** std-rh (CR 205.1b, 613.1d): the rider inside the sentence of the change, "... creature with haste that's still a land" (Brave the Wilds). */
function riderInlineText(st: RenderState, e: ContinuousEffectDef, kept: readonly string[] = []): string {
  const own = e.affects.ref === 'self' ? st.ctx.selfTypes?.map(lowerType).filter((t) => THE_CARD_TYPES.includes(t)) : undefined;
  const types = own && own.length > 0 ? [own.join(' ')] : THE_CARD_TYPES;
  const words = types.map((t) => (kept.length > 0 ? `${kept.join(' ')} ${t}` : t));
  return alt(...words.map((t) => `that's still ${article(t)} ${t}`));
}

/** Layers 4 and 5 (types, subtypes, supertypes, colors), together with the base power and toughness of 7b when the text says them in one phrase. */
function identity(e: ContinuousEffectDef, pl: boolean, st: RenderState, isStatic: boolean, out: Pieces): void {
  const mods = e.mods;
  const t4 = find(mods, 4)[0];
  const c5 = find(mods, 5)[0];
  const b7 = find(mods, '7b')[0];
  const types = typeWords(t4?.types, 'types');
  const subs = typeWords(t4?.subtypes, 'subtypes');
  const supers = typeWords(t4?.supertypes, 'supertypes');
  const allTypes = t4?.subtypes?.all === true || t4?.types?.all === true;
  const colorSet = c5?.colors.set !== undefined ? (c5.colors.set.length === 0 ? ['colorless'] : [joinList(c5.colors.set.map((c) => COLOR_WORD[c]!))]) : [];
  const colorAdd = c5?.colors.add && c5.colors.add.length > 0 ? joinList(c5.colors.add.map((c) => COLOR_WORD[c]!)) : '';
  if (c5 && colorSet.length === 0 && colorAdd === '' && c5.colors.chosen === undefined && !(c5.colors.remove && c5.colors.remove.length > 0)) throw new NoRenderer('layer 5 without a color change');
  if (c5?.colors.remove && c5.colors.remove.length > 0) throw new NoRenderer('layer 5 color removal');
  const be = pl ? 'are' : 'is';
  const verbBe = isStatic ? be : pl ? 'become' : 'becomes';
  const have = pl ? 'have' : 'has';
  // FAST5 T47: with creature types set, the land types added beside them are the ones the object keeps ("It's still a Cave land", said by the rider)
  const keptSubs = !isStatic && subs.set.length > 0 && types.set.length === 0 && types.add.length > 0 ? subs.add : [];
  const noun = [...subs.set, ...(keptSubs.length > 0 ? [] : subs.add), ...types.set, ...types.add].join(' ');
  const hasNoun = noun !== '';
  // FAST2 T7: "~ isn't a creature" (a Theros god below its devotion): exactly one card type removed and nothing else said about its identity (CR 205.1a,
  // 613.1d; the object keeps its other types)
  const removed = t4?.types?.remove;
  if (t4 && removed?.length === 1 && Object.keys(t4.types!).length === 1 && t4.subtypes === undefined && t4.supertypes === undefined && !c5 && !b7) {
    const word = lowerType(removed[0]!);
    if (!THE_CARD_TYPES.includes(word)) throw new NoRenderer('layer 4 removal of a type that is not a card type');
    out.preds.push(pl ? `aren't ${pluralize(word)}` : alt(`isn't ${article(word)} ${word}`, `is not ${article(word)} ${word}`));
    return;
  }
  // FAST3 T13: "becomes the creature type of your choice", "becomes the basic land type of your choice" (CR 205.1a, 305.7): the subtypes set to the value
  // chosen as the ability resolves (render/fold.ts#choiceThenEffect), and nothing else in layers 4, 5 and 7b
  const ch = t4?.subtypes;
  if (t4 && ch?.chosen !== undefined && ch.chosenSets === true && Object.keys(ch).length === 2 && t4.types === undefined && t4.supertypes === undefined && !c5 && !b7 && !isStatic) {
    const w = st.choiceWords?.get(ch.chosen);
    if (w !== undefined && (w.quality === 'creatureType' || w.quality === 'landType')) {
      w.used++;
      out.preds.push(`${verbBe} the ${w.words} of your choice`);
      return;
    }
  }
  // CLOUD C5 (CR 205.1b, 607.2d): "~ is the chosen type in addition to its other types" (Adaptive Automaton): a static ability adds the creature type its
  // object's "As ~ enters, choose a creature type." chose, and nothing else in layers 4, 5 and 7b
  if (t4 && isStatic && ch?.chosen !== undefined && Object.keys(ch).length === 1 && t4.types === undefined && t4.supertypes === undefined && t4.named === undefined && !c5 && !b7) {
    // std-r9b (CR 205.3m, 607.2d): Oracle also says "the chosen creature type" when the linked choice was a creature type ("Vehicle creatures you control are the
    // chosen creature type in addition to their other types", Lifecraft Engine); never when the choice is known to be a land type
    const own = `${be} the chosen type in addition to ${pl ? 'their' : 'its'} other types`;
    const quality = st.choiceWords?.get(ch.chosen)?.quality;
    out.preds.push(quality === undefined || quality === 'creatureType' ? alt(own, `${be} the chosen creature type in addition to ${pl ? 'their' : 'its'} other types`) : own);
    return;
  }
  // std-rx9 (CR 305.7, 607.2d): "~ is the chosen type" (Multiversal Passage): a static ability SETS the basic land type its object's "As ~ enters, choose a basic
  // land type." chose (`chosenSets`), and nothing else in layers 4, 5 and 7b; never when the choice is known to be of another kind
  if (t4 && isStatic && ch?.chosen !== undefined && ch.chosenSets === true && Object.keys(ch).length === 2 && t4.types === undefined && t4.supertypes === undefined
    && t4.named === undefined && !c5 && !b7) {
    const quality = st.choiceWords?.get(ch.chosen)?.quality;
    if (quality !== undefined && quality !== 'landType') throw new NoRenderer('a chosen type set that is not a land type');
    out.preds.push(alt(`${be} the chosen type`, `${be} the chosen basic land type`)); // family chosen-basic-land-type-words
    return;
  }
  // design 3.3: a layer-4 change that this function has no words for (removal, a chosen type, nothing at all) is refused, never left out of the sentence
  for (const tc of [t4?.types, t4?.subtypes, t4?.supertypes]) {
    if (tc && ((tc.remove?.length ?? 0) > 0 || tc.chosen !== undefined)) throw new NoRenderer('layer 4 removal or chosen type');
  }
  if (t4 && !hasNoun && !allTypes && supers.add.length === 0 && supers.set.length === 0) throw new NoRenderer('layer 4 without a type change');
  const desc = [...supers.add, ...supers.set, ...colorSet, noun].filter((w) => w !== '').join(' ');
  const addOnly = types.set.length === 0 && subs.set.length === 0 && colorSet.length === 0 && supers.set.length === 0;
  const withTypes = allTypes ? ' with all creature types' : '';
  const art = (w: string): string => (pl ? '' : `${article(w)} `);
  const plural = (w: string): string => (pl ? pluralize(w) : w);
  const bp = b7 && !find(mods, '7a')[0] ? b7 : undefined;
  const combined = bp !== undefined && hasNoun && (!isStatic || !addOnly);
  // FAST5 T69 (CR 201.2, 613.1d): "... with base power and toughness 1/1 named Legitimate Businessperson" is how Oracle says a name set beside a changed identity
  // (Witness Protection); in any other shape the name has no words here and the effect is refused, never printed without it
  const named = t4?.named;
  // r3-refs (CR 201.2, 205.1a, 613.1d): "you may have ~ become a legendary Equipment artifact named Everflame, Heroes' Legacy": a resolved change of types and name
  // alone (no base power and toughness, no color), said as one predicate
  if (named !== undefined && !isStatic && b7 === undefined && !c5 && hasNoun && !allTypes && types.set.length > 0 && colorAdd === '') {
    out.preds.push(`${verbBe} ${art(desc)}${plural(desc)} named ${named}`);
    return;
  }
  if (named !== undefined && !(combined && !allTypes && bp?.power !== undefined && bp.toughness !== undefined && isNum(unlive(bp.power)) && isNum(unlive(bp.toughness)))) {
    throw new NoRenderer('a name set outside "is a ... with base power and toughness N/N named X" or "becomes a ... named X, it has base power and toughness N/N"');
  }
  // CLOUD std-ecl (CR 205.1b, 613.4b, 611.2a): a resolved effect that only ADDS subtypes beside a base power and toughness says the two apart, "loses all abilities,
  // becomes a Coward in addition to its other types, and has base power and toughness 1/1" (Curious Colossus): the object keeps its types, so no "still a land" rider
  if (combined && !isStatic && named === undefined && !allTypes && types.set.length === 0 && types.add.length === 0 && subs.set.length === 0 && subs.add.length > 0
    && colorSet.length === 0 && colorAdd === '' && supers.set.length === 0 && supers.add.length === 0) {
    out.typeAdd = out.preds.length;
    out.preds.push(`${verbBe} ${art(desc)}${plural(desc)} in addition to ${pl ? 'their' : 'its'} other types`);
    out.preds.push(`${have} ${baseText(bp.power, bp.toughness, st)}`);
    return;
  }
  if (combined) {
    const p = bp.power === undefined ? undefined : unlive(bp.power);
    const t = bp.toughness === undefined ? undefined : unlive(bp.toughness);
    if (named !== undefined) {
      if (isStatic) out.preds.push(`${verbBe} ${art(desc)}${plural(desc)} with base power and toughness ${p}/${t} named ${named}`);
      else {
        out.preds.push(`${verbBe} ${art(desc)}${plural(desc)} named ${named}`, `${have} base power and toughness ${p}/${t}`);
        out.itJoin = true;
      }
      return;
    }
    if (p !== undefined && t !== undefined && isNum(p) && isNum(t)) {
      const withBase = `${verbBe} ${art(desc)}${plural(desc)}${withTypes} with base power and toughness ${p}/${t}`;
      const sized = `${verbBe} ${pl ? '' : `${article(`${p}/${t}`)} `}${p}/${t} ${plural(desc)}${withTypes}`;
      // cmd1 (CR 105.3, 205.1b, 613.1d-e): a resolved effect that ADDS a color, the creature type and creature types, "target token you control becomes a green Bear
      // creature with base power and toughness 4/4 in addition to its other colors and types": the object keeps its colors and types, so there is no rider
      if (!isStatic && !allTypes && !pl && types.set.length === 0 && types.add.length === 1 && types.add[0] === 'creature' && subs.set.length === 0 && subs.add.length > 0
        && colorSet.length === 0 && colorAdd !== '' && supers.set.length === 0 && supers.add.length === 0) {
        const colored = `${colorAdd} ${desc}`;
        out.preds.push(`${verbBe} ${article(colored)} ${colored} with base power and toughness ${p}/${t} in addition to its other colors and types`);
        return;
      }
      // FAST5 T47 (CR 205.1b): a resolved effect that ADDS the creature type and creature types, "~ becomes a 7/7 Beast creature in addition to its other types":
      // that is the only wording (not "base power and toughness", which says nothing about keeping the object's types, and no "still a land" rider, which the
      // JSON of a SET type change has)
      if (!isStatic && !allTypes && !pl && types.set.length === 0 && types.add.length === 1 && types.add[0] === 'creature' && subs.set.length === 0 && subs.add.length > 0
        && colorSet.length === 0 && supers.set.length === 0 && supers.add.length === 0) {
        out.sized = { index: out.preds.length, text: sized, suffix: ' in addition to its other types' };
        out.preds.push(`${sized} in addition to its other types`);
        out.inAddition = `${sized} in addition to its other types`; // FAST5 T77
        return;
      }
      // FAST5 T77 (CR 205.1b, 613.4b): the same for a group, "They are 5/5 Elemental creatures in addition to their other types" (Relive the Past); the readings it had
      // before stay (with the rider), and this is one more
      if (!isStatic && !allTypes && pl && types.set.length === 0 && types.add.length === 1 && types.add[0] === 'creature' && subs.set.length === 0 && subs.add.length > 0
        && colorSet.length === 0 && supers.set.length === 0 && supers.add.length === 0) {
        out.inAddition = `${sized} in addition to their other types`;
      }
      // FAST5 T72 (CR 205.1b, 613.4b): a resolved effect that ADDS the artifact and creature types and a creature subtype, "becomes a Dinosaur artifact creature with
      // base power and toughness 4/3 in addition to its other types": the words say the object keeps its types, so there is no rider
      if (!isStatic && !allTypes && !pl && types.set.length === 0 && types.add.length === 2 && types.add.includes('artifact') && types.add.includes('creature') && subs.set.length === 0
        && subs.add.length > 0 && colorSet.length === 0 && supers.set.length === 0 && supers.add.length === 0) {
        // p2-typechange-1 (family still-land-artifact-creature; CR 205.1b, 613.1d): of a land itself, the same change is also "~ becomes a 2/2 Assembly-Worker artifact
        // creature until end of turn. It's still a land." (Mishra's Factory): the rider restates what "artifact creature" already says (it keeps its types)
        if (e.affects.ref === 'self' && (st.ctx.selfTypes ?? []).some((x) => x.toLowerCase() === 'land')) out.stillLand = sized;
        out.preds.push(`${withBase} in addition to its other types`);
        return;
      }
      if (!allTypes) out.sized = { index: out.preds.length, text: sized };
      else out.sizedAll ={ index: out.preds.length, text: `${verbBe} ${pl ? '' : `${article(`${p}/${t}`)} `}${p}/${t} ${plural(desc)}` };
      // std-rx15: also of a resolved effect, for "becomes a Kithkin Avatar with base power and toughness 7/8 and protection from ..." (family becomes-with-base-and)
      if (!allTypes && (isStatic || !pl)) out.withBase = { index: out.preds.length, text: withBase };
      out.preds.push(allTypes ? alt(sized, withBase) : alt(withBase, sized));
    } else {
      // CLOUD C8: "becomes an X/X Cat artifact creature until end of turn, where X is ..." (family becomes-x-over-x), read before `base` names the quantity's objects
      if (!isStatic && !pl && !allTypes && p !== undefined && t !== undefined && same(p, t)) out.sizedX = { index: out.preds.length, text: `${verbBe} an X/X ${plural(desc)}${withTypes}`, q: K.qty(p, cloneState(st)) };
      const base = `${verbBe} ${art(desc)}${plural(desc)}${withTypes} with ${baseText(bp.power, bp.toughness, st)}`;
      // FAST3 T13: a resolved effect says "with power and toughness each equal to its mana value" for the base values it sets (CR 613.4b, 608.2h)
      out.preds.push(!isStatic && p !== undefined && t !== undefined && same(p, t) ? alt(base, `${verbBe} ${art(desc)}${plural(desc)}${withTypes} with power and toughness each equal to ${K.qty(p, st)}`) : base);
    }
    // FAST2 T9: card types added (not set) while the subtypes are set ("It becomes a 5/5 Elemental creature with haste. It's still a land.") need the rider
    // too; "artifact creature" says by itself that the object keeps its other types (CR 205.1b), so that wording has none
    const typesAddOnly = types.set.length === 0 && types.add.length > 0;
    const keepsTypes = typesAddOnly && types.add.length === 2 && types.add.includes('artifact') && types.add.includes('creature');
    // FAST3 T13: "becomes an artifact creature with ..." with no subtype keeps its types by the wording alone too (CR 205.1b): no rider
    if (((addOnly && !(keepsTypes && subs.add.length === 0 && colorSet.length === 0 && supers.add.length === 0)) || (typesAddOnly && !keepsTypes)) && !isStatic) { out.rider = riderText(st, e, keptSubs); out.riderInline = riderInlineText(st, e, keptSubs); }
    // std-ry8 (CR 205.1b, 303.4, 613.1d): an Aura's static "Enchanted land is a 3/3 black Ooze creature. It's still a land." (the Zendikons): the creature type and
    // the subtypes are ADDED to the enchanted land, said with the rider; only for the land an Aura enchants
    else if (isStatic && e.affects.ref === 'attachedTo' && !pl && !allTypes && types.set.length === 0 && types.add.length === 1 && types.add[0] === 'creature' && subs.set.length === 0
      && subs.add.length > 0 && supers.set.length === 0 && supers.add.length === 0 && (st.ctx.selfTypes ?? []).some((t) => t.toLowerCase() === 'aura')) out.rider = "it's still a land";
    return;
  }
  if (hasNoun) {
    if (addOnly && isStatic) {
      const text = `${verbBe} ${art(desc)}${plural(desc)}${withTypes} in addition to ${pl ? 'their' : 'its'} other types`;
      // FAST5 T77 (CR 613.4b): "is a Construct creature with base power and toughness 5/5 in addition to its other types" (Puppet Crafting, Zoetic Glyph)
      if (bp !== undefined && !pl && !allTypes && types.set.length === 0 && subs.set.length === 0) {
        out.baseAdd = `${verbBe} ${art(desc)}${plural(desc)} with ${baseText(bp.power, bp.toughness, st)} in addition to its other types`;
      }
      // M6-10 (CR 305.6-305.7, 205.1b): only basic land types added: "each land is a Swamp in addition to its other land types" (Urborg, Tomb of Yawgmoth)
      const landTypesOnly = types.add.length === 0 && supers.add.length === 0 && colorAdd === '' && (t4?.subtypes?.add ?? []).length > 0
        && (t4?.subtypes?.add ?? []).every((x) => ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(x));
      if (!landTypesOnly) out.typeAdd = out.preds.length;
      // FAST5 T77 (CR 205.3i, 305.6): all five basic land types are "every basic land type" (Leyline of the Guildpact)
      const everyBasic = landTypesOnly && ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].every((x) => (t4?.subtypes?.add ?? []).includes(x))
        ? [`${verbBe} every basic land type in addition to ${pl ? 'their' : 'its'} other types`] : [];
      // p2-typechange-2 (CR 105.3, 205.1b, 613.1d-e): a color ADDED with the creature types, "Enchanted creature gets -1/-1 and is a black Zombie in addition to its
      // other colors and types" (Ghoulflesh, Angelic Armaments, Blade of the Oni): the object keeps its colors and types
      const colorTypes = colorAdd !== '' && !pl && !allTypes && bp === undefined && types.add.length === 0 && subs.set.length === 0 && subs.add.length > 0 && supers.add.length === 0
        ? `${verbBe} ${article(`${colorAdd} ${desc}`)} ${colorAdd} ${desc} in addition to its other colors and types` : undefined;
      out.preds.push(colorTypes ?? (landTypesOnly ? alt(text, `${text.slice(0, -' types'.length)} land types`, ...everyBasic) : text));
    }
    else if (addOnly && !allTypes && !bp && types.add.length === 0 && supers.add.length === 0 && colorAdd === '' && c5 === undefined && (t4?.subtypes?.add ?? []).length === 5
      && ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].every((x) => (t4?.subtypes?.add ?? []).includes(x))) {
      // std-tla (CR 205.3i, 305.6, 205.1b): a resolved effect that adds the five basic land types and nothing else in layers 4 and 5, "Lands you control gain all
      // basic land types until end of turn": the lands keep their other types and have each basic land type's mana ability (Energybending)
      out.preds.push(`${pl ? 'gain' : 'gains'} all basic land types`);
    }
    // Standard round 4, r4-refs (CR 105.3, 205.1b, 613.1d-e): a resolved effect that ADDS a color and creature types and nothing else, "it becomes a black Demon in
    // addition to its other colors and types": the object keeps its colors and types
    // p2-typechange-2: or a card type, "target creature you control becomes a blue artifact in addition to its other colors and types" (Unctus, Grand Metatect)
    else if (addOnly && !isStatic && !pl && !allTypes && !bp && colorAdd !== '' && (types.add.length === 0 ? subs.add.length > 0 : subs.add.length === 0) && supers.add.length === 0) {
      const colored = `${colorAdd} ${desc}`;
      out.preds.push(`${verbBe} ${article(colored)} ${colored} in addition to its other colors and types`);
    }
    else if (addOnly) {
      out.typeAdd = out.preds.length; // FAST5 T41: a resolved effect says it last too ("gets +3/+1 and becomes a Dinosaur in addition to its other types")
      // r4-fxb (family self-by-name, CR 201.5): of the object itself a character card says "in addition to his other types", which the front end reads as "~'s"
      const selfTypes = (e.affects as { ref?: string }).ref === 'self' ? [`${verbBe} ${art(desc)}${plural(desc)}${withTypes} in addition to ~'s other types`] : [];
      out.preds.push(alt(`${verbBe} ${art(desc)}${plural(desc)}${withTypes} in addition to its other types`, `${verbBe} ${art(desc)}${plural(desc)}${withTypes}`, ...selfTypes));
      out.inAddition = `${verbBe} ${art(desc)}${plural(desc)}${withTypes} in addition to ${pl ? 'their' : 'its'} other types`; // FAST5 T77
    }
    else {
      // FAST5 T47 (CR 205.1a): a lone card type set by a resolved effect, "It's an enchantment" (Enduring Courage): reads "is" as well as "becomes" when it lasts for good
      if (!isStatic && !pl && types.set.length === 1 && types.add.length === 0 && subs.set.length === 0 && subs.add.length === 0 && supers.set.length === 0 && supers.add.length === 0 && colorSet.length === 0 && colorAdd === '' && !allTypes && !bp) out.typeOnly = out.preds.length;
      if (!isStatic && types.set.length > 0 && !allTypes && !bp && colorSet.length === 0 && colorAdd === '' && supers.set.length === 0 && supers.add.length === 0) {
        // r5-fxz: several objects too, "They are Food artifacts with "..."" (Supper for Spiders)
        out.loseOthers = pl ? { index: out.preds.length, text: `are ${plural(desc)}`, plural: true } : { index: out.preds.length, text: `is ${art(desc)}${desc}` };
      }
      out.preds.push(`${verbBe} ${art(desc)}${plural(desc)}${withTypes}`);
    }
  } else if (colorSet.length > 0) {
    // FAST5 T77 (CR 105.2c, 105.1): all five colors are "all colors" (Leyline of the Guildpact: "Each nonland permanent you control is all colors")
    const everyColor = c5?.colors.set?.length === 5 && colorSet.length === 1;
    if (!bp) out.colorOnly = out.preds.length; // cloud std-spm
    out.preds.push(`${verbBe} ${everyColor ? alt(colorSet[0]!, 'all colors') : colorSet[0]}`);
  } else if (colorAdd !== '') {
    out.preds.push(`${verbBe} ${colorAdd} in addition to its other colors`);
  } else if (c5?.colors.chosen === 'manaColor') {
    // std-mana-12 (CR 106.1): the color of the mana an addMana step of the ability recorded (AddMana.link; the parser's lower/links.ts#resolveManaColor), "that color"
    out.preds.push(`${verbBe} that color`);
  } else if (c5?.colors.chosen !== undefined) {
    out.preds.push(`${verbBe} the chosen color`);
  } else if (supers.add.length > 0 || supers.set.length > 0) {
    out.preds.push(`${verbBe} ${[...supers.add, ...supers.set].join(' ')}`);
  } else if (allTypes) {
    // CLOUD std-ecl (CR 205.3m, 613.1d, 611.2a; family gains-all-creature-types): a resolved effect that gives the object every creature type also reads "gains all
    // creature types" ("Up to one target creature gains all creature types"), said last too ("has base power and toughness 4/4 and gains all creature types")
    const gains = !isStatic && types.set.length === 0 && types.add.length === 0 && subs.set.length === 0 && subs.add.length === 0;
    if (gains) out.typeAdd = out.preds.length;
    // r4-static (CR 205.3m, 613.1d; families gains-all-creature-types, type-add-last): a static ability "is all creature types" ("Equipped creature gets +1/+1 and is
    // all creature types"), said after the other changes as an added type is
    const isAll = isStatic && types.set.length === 0 && types.add.length === 0 && subs.set.length === 0 && subs.add.length === 0;
    if (isAll) out.typeAdd = out.preds.length;
    out.preds.push(alt(`${have} all creature types`, `${be} every creature type`, ...(gains ? [`${pl ? 'gain' : 'gains'} all creature types`] : []), ...(isAll ? [`${be} all creature types`] : [])));
  }
  if (bp) out.preds.push(`${have} ${baseText(bp.power, bp.toughness, st)}`);
}

/** std-typechange-1: the objects of "creatures you control ... The same is true for creature spells you control and creature cards you own that aren't on the battlefield". */
/** p2-typechange-1: the permanent card types as the Filter hole writes "permanent" (CR 110.4). */
const PERMANENT_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];
const NOT_ON_BATTLEFIELD = ['hand', 'graveyard', 'library', 'exile', 'command', 'stack'];
/** p2-typechange-1: the other "the same is true for ..." groups (see the use in continuous), with their words; `tail` absent: the group and its spells said as one list. */
const SAME_IS_TRUE_GROUPS: readonly { union: string; subject: string; tail?: string }[] = [
  {
    union: JSON.stringify({ ref: 'union', of: [
      { ref: 'each', filter: { notTypes: ['Land'], controller: 'you' } },
      { ref: 'each', filter: { types: PERMANENT_TYPES, controller: 'you', zone: ['stack'] } },
      { ref: 'each', filter: { types: PERMANENT_TYPES, notTypes: ['Land'], owner: 'you', isCard: true, zone: NOT_ON_BATTLEFIELD } },
    ] }),
    subject: 'nonland permanents you control',
    tail: 'permanent spells you control and nonland permanent cards you own',
  },
  {
    union: JSON.stringify({ ref: 'union', of: [
      { ref: 'each', filter: { notTypes: ['Land'], controller: 'you' } },
      { ref: 'each', filter: { types: PERMANENT_TYPES, controller: 'you', zone: ['stack'] } },
    ] }),
    subject: 'nonland permanents you control and permanent spells you control',
  },
];

const SAME_IS_TRUE_UNION = JSON.stringify({
  ref: 'union',
  of: [
    { ref: 'each', filter: { types: ['Creature'], controller: 'you' } },
    { ref: 'each', filter: { types: ['Creature'], controller: 'you', zone: ['stack'] } },
    { ref: 'each', filter: { types: ['Creature'], owner: 'you', isCard: true, zone: ['hand', 'graveyard', 'library', 'exile', 'command', 'stack'] } },
  ],
});

/**
 * std-typechange-1: the parts of exactly a layer-4 change that sets the creature types and the name (no card type, supertype or chosen type), a layer-6 change that
 * removes every ability and adds some, and a numeric base power and toughness, in that order (sta.stdtc1.loseall.isSubtype.basept.has.named); null otherwise.
 */
function namedIdentity(e: ContinuousEffectDef): { subtypes: string[]; name: string; add: AbilityDef[]; p: number; t: number } | null {
  const [m4, m6, m7] = e.mods as unknown as [Record<string, unknown>?, Record<string, unknown>?, Record<string, unknown>?];
  if (e.mods.length !== 3 || m4?.['layer'] !== 4 || m6?.['layer'] !== 6 || m7?.['layer'] !== '7b') return null;
  if (Object.keys(m4).sort().join(',') !== 'layer,named,subtypes' || typeof m4['named'] !== 'string') return null;
  const subs = m4['subtypes'] as Record<string, unknown>;
  if (Object.keys(subs).join(',') !== 'set' || !Array.isArray(subs['set']) || subs['set'].length === 0) return null;
  if (Object.keys(m6).sort().join(',') !== 'add,layer,removeAll' || m6['removeAll'] !== true || !Array.isArray(m6['add']) || m6['add'].length === 0) return null;
  if (Object.keys(m7).sort().join(',') !== 'layer,power,toughness' || typeof m7['power'] !== 'number' || typeof m7['toughness'] !== 'number') return null;
  return { subtypes: subs['set'] as string[], name: m4['named'], add: m6['add'] as AbilityDef[], p: m7['power'], t: m7['toughness'] };
}

/**
 * std-typechange-2: the parts of exactly a layer-4 change that adds the creature type and creature subtypes (nothing else), a layer-6 change that only adds
 * abilities, and a numeric base power and toughness, in that order (sta.stdtc2.duringTurn.aslong.self.is.sized.creature.has); null otherwise.
 */
function walkerCreature(e: ContinuousEffectDef): { subtypes: string[]; add: AbilityDef[]; p: number; t: number } | null {
  const [m4, m6, m7] = e.mods as unknown as [Record<string, unknown>?, Record<string, unknown>?, Record<string, unknown>?];
  if (e.mods.length !== 3 || m4?.['layer'] !== 4 || m6?.['layer'] !== 6 || m7?.['layer'] !== '7b') return null;
  if (Object.keys(m4).sort().join(',') !== 'layer,subtypes,types' || JSON.stringify(m4['types']) !== JSON.stringify({ add: ['Creature'] })) return null;
  const subs = m4['subtypes'] as Record<string, unknown>;
  if (Object.keys(subs).join(',') !== 'add' || !Array.isArray(subs['add']) || subs['add'].length === 0) return null;
  if (Object.keys(m6).sort().join(',') !== 'add,layer' || !Array.isArray(m6['add']) || m6['add'].length === 0) return null;
  if (Object.keys(m7).sort().join(',') !== 'layer,power,toughness' || typeof m7['power'] !== 'number' || typeof m7['toughness'] !== 'number') return null;
  return { subtypes: subs['add'] as string[], add: m6['add'] as AbilityDef[], p: m7['power'], t: m7['toughness'] };
}

/** r4-static: a card name that reads as a plural noun phrase ("The Neutrinos", "The Ozolith" is not): "The" and a last word in -s, not -ss or -'s. */
function pluralName(st: RenderState): boolean {
  const name = st.ctx.selfNames[0] ?? '';
  return /^The /.test(name) && !name.includes(',') && /[^s']s$/.test(name);
}

function pieces(e: ContinuousEffectDef, pl: boolean, st: RenderState, isStatic: boolean, subject: string): Pieces {
  const mods = e.mods;
  const preds: string[] = [];
  const out: Pieces = { preds, where: [] };
  const have = pl ? 'have' : 'has';
  const get = pl ? 'get' : 'gets';
  const lose = pl ? 'lose' : 'loses';
  const be = pl ? 'are' : 'is';
  const becomes = pl ? 'become' : 'becomes';
  const l6 = find(mods, 6);
  const b7 = find(mods, '7b')[0];

  // layers 1a, 1b and 3 (copy effects, face-down, text-changing; milestone 6 executes them, the words are the same today)
  for (const m of mods) {
    if (m.layer === '1a' && m.choose !== undefined) {
      // FAST5 T64 (CR 607.2a, 608.2d): "~ becomes a copy of a creature card exiled with it" (Lazav): one of the cards the linked ability exiled, picked as the effect begins
      const only = Object.keys(m.choose).filter((k) => (m.choose as Record<string, unknown>)[k] !== undefined);
      // r4-copy (CR 608.2d, 707.4): "you may have it become a copy of another creature you control until end of turn" (Deepfathom Echo): one permanent of the
      // group, chosen as the effect begins (no target, no further description of the choice)
      if (m.copyOf.ref === 'each' && 'filter' in m.copyOf && only.length === 0 && (m.except ?? []).length === 0) {
        preds.push(`${isStatic ? be : becomes} a copy of ${K.np(m.copyOf.filter, st, { det: 'a' })}`);
        continue;
      }
      if (m.copyOf.ref !== 'linked' || m.copyOf.link !== 'exiled' || (m.except ?? []).length > 0 || only.join() !== 'types' || m.choose.types?.length !== 1) {
        throw new NoRenderer('a copy of a chosen object other than a card of one type exiled by the linked ability');
      }
      preds.push(`${isStatic ? be : becomes} a copy of ${withArticle(`${m.choose.types[0]!.toLowerCase()} card`)} exiled with ${alt('it', '~')}`);
      continue;
    }
    if (m.layer === '1a') {
      // MX2 (additive): "except it doesn't copy that creature's color and it has this ability" (CR 707.9a, 707.9c; render/copy-except.ts#retainThisText)
      if ((m.except ?? []).some((x) => 'retain' in x || 'thisAbility' in x)) {
        const own = retainThisText(m.except!, copiedNoun(m.copyOf, st), (a) => quotedAbility(a, st, 'creature'));
        // p2-copy-perm-1 (CR 707.9b): or the clause list of render/copy-except.ts#copyExceptText ("its name is ~ and it's legendary in addition to its other
        // types"), with the duration before "except" as well (the alternative below, FAST5 T64)
        let listed: string | null = null;
        try {
          listed = copyExceptText(m.except!, () => { throw new NoRenderer('no general wording'); }, (a) => quotedAbility(a, st, 'creature'));
        } catch (err) {
          if (!(err instanceof NoRenderer)) throw err;
        }
        if (own === null && listed === null) throw new NoRenderer('a copy exception that retains a value other than the color, or depends on a condition');
        const words = own === null ? listed! : listed === null ? own : alt(own, listed);
        const head = `${isStatic ? be : becomes} a copy of ${copiedText(m.copyOf, e.affects, st)}`;
        if (listed !== null) out.copyExcept = { index: preds.length, head, tail: `, except ${words}` };
        preds.push(`${head}, except ${words}`);
        continue;
      }
      // M6-0: the exceptions that are modifications are worded as before; a retained value (CR 707.9c) or a conditional exception (CR 707.9f) is M6-2's
      const plainExcept = (m.except ?? []).filter((x): x is Modification => 'layer' in x);
      if (plainExcept.length !== (m.except ?? []).length) throw new NoRenderer('a copy exception that retains a value or depends on a condition (M6-2)');
      // FAST5 T64 (CR 707.9b): the copy wording of the exceptions ("it isn't legendary", "it's a Spirit in addition to its other types", "it has haste"), beside the general one
      const except = plainExcept.length > 0
        ? `, except ${copyExceptText(plainExcept, (xs) => continuous({ s: 'continuous', affects: { ref: 'subject' }, mods: xs }, st, undefined, true), (a) => quotedAbility(a, st, 'creature'), undefined, false, true, e.affects.ref === 'self')}`
        : '';
      // r3-copy (CR 707.2, 611.2c): several objects each become a copy of the same object, "Shards you control become copies of it" (Niko, Light of Hope)
      const head = `${isStatic ? be : becomes} ${pl ? alt('a copy', 'copies') : 'a copy'} of ${copiedText(m.copyOf, e.affects, st)}`;
      if (except !== '') out.copyExcept = { index: preds.length, head, tail: except };
      preds.push(`${head}${except}`);
    } else if (m.layer === '1b') preds.push(`${isStatic ? be : becomes} face down`);
    else if (m.layer === 3) {
      // M6-8: a word chosen as the spell resolved is said by the text-change fold (render/fold.ts#textChange) with its choices, never here
      const { from, to } = m.changeWord;
      if (typeof from !== 'string' || typeof to !== 'string') throw new NoRenderer('a text change whose words are chosen, outside its choices (M6-8)');
      preds.push(`${pl ? 'have' : 'has'} its text changed so that each instance of the ${m.changeWord.kind === 'color' ? 'color' : m.changeWord.kind === 'landType' ? 'basic land type' : 'creature type'} word ${from} is replaced by ${to}`);
    }
  }

  // layer 6: losing abilities comes first
  // std-mana-1 (CR 205.3i, 305.7, 613.1d, 613.1f): "loses all land types and abilities", one predicate for the layer 4 and layer 6 losses (alone in layer 4)
  const t4land = find(mods, 4)[0];
  const landLoss = t4land?.subtypes?.removeAll === 'land';
  if (landLoss && (Object.keys(t4land).some((k) => k !== 'layer' && k !== 'subtypes') || Object.keys(t4land.subtypes!).length !== 1 || find(mods, 4).length !== 1 || find(mods, 5)[0] || b7
    || !l6.some((m) => m.removeAll === true))) throw new NoRenderer('losing all land types beside another identity change or without losing all abilities');
  for (const m of l6) {
    if (m.removeAll === true && landLoss) preds.push(`${lose} all land types and abilities`);
    else if (m.removeAll === true) preds.push(`${lose} all abilities`);
    if (m.remove && m.remove.length > 0) preds.push(`${lose} ${joinList(m.remove)}`);
    if (m.cantHave && m.cantHave.length > 0) preds.push(`can't have or gain ${joinList(m.cantHave)}`);
  }
  // layers 4, 5 and the base power and toughness
  // FAST5 T41 (CR 205.3m, 613.1d): "loses all creature types", alone in layer 4; Oracle says it after the P/T change ("gets +3/-3 and loses all creature types")
  const t4 = find(mods, 4)[0];
  let typeLoss: string | null = null;
  if (t4?.subtypes?.removeAll === 'creature') {
    if (Object.keys(t4).some((k) => k !== 'layer' && k !== 'subtypes') || Object.keys(t4.subtypes).length !== 1 || find(mods, 5)[0] || b7) throw new NoRenderer('losing all creature types beside another identity change');
    typeLoss = `${lose} all creature types`;
  } else if (landLoss) {
    // std-mana-1: said with the abilities above
  } else if (find(mods, 4)[0] || find(mods, 5)[0]) identity(e, pl, st, isStatic, out);
  else if (b7 && !find(mods, '7a')[0]) preds.push(`${have} ${baseText(b7.power, b7.toughness, st)}`);
  if (find(mods, '7a').length > 0) throw new NoRenderer('layer 7a outside a characteristic-defining ability');
  // layer 7c: counters of power and toughness
  for (const m of find(mods, '7c')) {
    // FAST3 T12: under "enchanted creature", "for each other creature you control" excludes the enchanted creature (`attachedToSource: false`)
    const host = e.affects.ref === 'attachedTo';
    if (host && hasHostOther(m, st)) throw new NoRenderer('"for each other creature" under an attached-to subject excludes that creature, not the source');
    const pt = powerToughness(host ? otherThanHost(m.power) : m.power, host ? otherThanHost(m.toughness) : m.toughness, st);
    if (pt.forEach && out.forEach === undefined) {
      const at = pt.forEach.indexOf(' for each ');
      out.forEach = { index: preds.length, text: `${get} ${pt.forEach}`, where: pt.where, head: `${get} ${pt.forEach.slice(0, at)}`, tail: pt.forEach.slice(at + 1) };
    }
    // FAST5X E17 (CR 613.4c): a resolved change of power and toughness adds to the others, so "that creature gets an additional -3/-3" is "gets -3/-3" (only
    // when it is the effect's one change: the folds of two changes below read the plain predicate)
    preds.push(!isStatic && mods.length === 1 && pt.forEach === undefined && pt.where.length === 0 ? alt(`${get} ${pt.text}`, `${get} an additional ${pt.text}`) : `${get} ${pt.text}`);
    out.where.push(...pt.where);
  }
  if (find(mods, '7d').length > 0) preds.push(`${have} ${pl ? 'their' : 'its'} power and toughness switched`);
  if (typeLoss !== null) {
    out.typeLoss = preds.length;
    preds.push(typeLoss);
  }
  // abilities that are granted come last
  for (const m of l6) {
    if (m.add && m.add.length > 0) {
      // FAST5 T56 (CR 702.34a, 118.9): "gains flashback until end of turn. The flashback cost is equal to its mana cost." is one granted flashback whose cost is the card's
      // own mana cost; the second sentence is its rider. Only that one keyword alone: the sentence names "the flashback cost", so it says nothing about another ability.
      if (m.add.some((a) => a.kind === 'keyword' && a.costIsManaCost === true)) {
        // cloud r3-mech (CR 702.187b): "has mayhem. The mayhem cost is equal to its mana cost." the same way; r5-cost (CR 702.180a, 702.128a): and harmonize and
        // embalm, "Its harmonize cost is equal to its mana cost", "The embalm cost is equal to its mana cost"
        const kw = m.add[0]?.kind === 'keyword' ? m.add[0].keyword : undefined;
        const only = m.add.length === 1 && (kw === 'flashback' || kw === 'mayhem' || kw === 'harmonize' || kw === 'embalm') && (m.add[0] as { cost?: unknown }).cost === undefined;
        // std-tla (CR 702.34a, 604.1): a static ability grants it the same way, "During your turn, each non-Lesson instant and sorcery card in your graveyard has flashback.
        // The flashback cost is equal to that card's mana cost." (the rider sentence follows the static sentence, as it follows a resolved one)
        if (!only || out.rider !== undefined) throw new NoRenderer('a cost equal to its mana cost beside other changes');
        out.rider = kw === 'flashback' || kw === 'mayhem'
          ? alt(`the ${kw} cost is equal to its mana cost`, `the ${kw} cost is equal to that card's mana cost`)
          : alt(`${alt('its', 'the')} ${kw!} cost is equal to its mana cost`, `${alt('its', 'the')} ${kw!} cost is equal to that card's mana cost`);
      }
      const list = abilityList(m.add, st, granteeNoun(subject, e, st));
      if (!isStatic && out.granted === undefined && l6.filter((x) => x.add && x.add.length > 0).length === 1) out.granted = { index: preds.length, list };
      if (isStatic && out.staticGrant === undefined && l6.filter((x) => x.add && x.add.length > 0).length === 1) {
        // Cloud std-woe: each ability its own item (keywords one by one, quoted abilities as quoted), for the "with" list of the identity (`withBase`)
        const noun = granteeNoun(subject, e, st);
        const items = m.add.map((a) => (a.kind === 'keyword' ? keywordList([a] as never, cloneState(st)) : quotedAbility(a, cloneState(st), noun)));
        out.staticGrant = { index: preds.length, items };
      }
      preds.push(isStatic ? `${have} ${list}` : alt(`${pl ? 'gain' : 'gains'} ${list}`, `${have} ${list}`));
    }
  }
  for (const m of mods) {
    if (m.layer === 2) throw new NoRenderer('layer 2 together with other modifications');
  }
  return out;
}

/** Verbless effects: "gain control of X", "switch X's power and toughness". Null when the effect is an ordinary "subject verb ..." sentence. */
function imperative(e: ContinuousEffectDef, st: RenderState, duration: string, isStatic: boolean): string | null {
  const mods = e.mods;
  const control = find(mods, 2)[0];
  if (control && mods.length === 1) {
    // FAST4 T25 (CR 108.3, 613.1b, 611.2c): "each player gains control of all creatures they own": every object of the set is controlled by its own owner; a
    // resolved effect with no duration only (the set was locked as it began)
    const c = control.controller;
    if (c.ref === 'ownerOf' && c.object.ref === 'subject' && e.affects.ref === 'each' && 'filter' in e.affects) {
      if (isStatic || duration !== '') throw new NoRenderer('control by owner in a static ability or with a duration');
      return `each player gains control of ${K.np(e.affects.filter, st, { det: 'all', plural: true })} they own`;
    }
    const who = K.player(control.controller, st, 'subject');
    const what = K.obj(e.affects as ObjRef, st, 'object').text;
    if (isStatic) return `${who.text} ${conj('control', who.person)} ${what}`;
    const tail = duration ? ` ${duration}` : '';
    // "Gain control of target creature until end of turn." (the controller of the ability is the subject of the sentence)
    return who.person === 'you' ? alt(`gain control of ${what}${tail}`, `you gain control of ${what}${tail}`) : `${who.text} ${conj('gain', who.person)} control of ${what}${tail}`;
  }
  if (find(mods, '7d').length === 1 && mods.length === 1) {
    const what = K.obj(e.affects as ObjRef, st, 'possessive').text;
    return `switch ${what} power and toughness${duration ? ` ${duration}` : ''}`;
  }
  return null;
}

/**
 * FAST2 T7 (family on-the-battlefield): the number of permanents of every player is also said "... on the battlefield" ("the number of Clerics on the
 * battlefield", CR 110.1, 208.2a): a count of a filter that names no controller, owner or other zone.
 */
function cdaQty(q: Quantity, st: RenderState): string {
  const base = K.qty(q, st);
  if (typeof q !== 'object' || q.q !== 'count' || q.of.ref !== 'each' || !/^the number of /.test(base)) return base;
  const f = q.of.filter;
  const everywhere = f.controller === undefined && f.owner === undefined && (f.zone === undefined || f.zone === 'battlefield');
  return everywhere ? alt(base, `${base} on the battlefield`) : base;
}

/** A characteristic-defining ability (CR 604.3): "~'s power is equal to X and its toughness is equal to Y". */
function cdaSentence(e: ContinuousEffectDef, st: RenderState): string | null {
  const a7 = find(e.mods, '7a')[0];
  if (!a7) return null;
  if (e.cda !== true || e.mods.length !== 1) throw new NoRenderer('layer 7a that is not a lone characteristic-defining ability');
  const poss = K.obj(e.affects as ObjRef, st, 'possessive').text;
  const p = a7.power === undefined ? undefined : unlive(a7.power);
  const t = a7.toughness === undefined ? undefined : unlive(a7.toughness);
  if (p !== undefined && t !== undefined && same(p, t)) return `${poss} power and toughness are each equal to ${cdaQty(p, st)}`;
  // FAST3 T12: "~'s power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1" (CR 604.3,
  // 613.4a): the toughness is the power's quantity plus a number
  // (the sum in either order: model/canonical.ts sorts the operands of a commutative sum)
  const n = p !== undefined && t !== undefined && typeof t === 'object' && t.q === 'math' && t.op === '+' && t.args.length === 2
    ? (same(t.args[0], p) && isNum(t.args[1]) ? t.args[1] : same(t.args[1], p) && isNum(t.args[0]) ? t.args[0] : null)
    : null;
  if (p !== undefined && t !== undefined && n !== null && n > 0) {
    const plus = `${poss} power is equal to ${cdaQty(p, st)} and its toughness is equal to that number plus ${n}`;
    return alt(`${poss} power is equal to ${cdaQty(p, st)} and its toughness is equal to ${cdaQty(t, st)}`, plus);
  }
  const bits: string[] = [];
  if (p !== undefined) bits.push(`${poss} power is equal to ${cdaQty(p, st)}`);
  if (t !== undefined) bits.push(`${t !== undefined && p !== undefined ? 'its' : poss} toughness is equal to ${cdaQty(t, st)}`);
  return bits.join(' and ');
}

/**
 * FAST2 T9: the "have ... do" form of a resolved P/T change or ability change of one object, what follows "you may" ("you may have target creature get +2/+0
 * until end of turn", CR 608.2d); null when the effect has another modification or its subject is a set or a player.
 */
export function continuousHave(e: ContinuousEffectDef, st: RenderState, duration: Duration): string | null {
  // MX2 (additive): a copy effect too, "you may have ~ become a copy of target creature, except ..." (CR 707.4, 608.2d)
  if (e.cda === true || e.mods.length === 0) return null;
  // FAST5 T47: "you may have it become a 0/0 Elemental creature until end of turn" (CR 205.1a, 613.1d, 613.4b, 608.2d): a change of types, colors and base power
  // and toughness only, in the singular "become" (the have form of the plural "become" would also pluralize the type words)
  const identityOnly = e.mods.some((m) => m.layer === 4) && e.mods.every((m) => m.layer === 4 || m.layer === 5 || m.layer === '7b');
  // r4-static (CR 613.4b, 608.2h): "you may have ~'s base power become equal to that creature's power until end of turn" (Belligerent Yearling): the base power
  // alone of one object, one value read as the effect begins
  if (e.affects.ref !== 'each' && !isPlayerRef(e.affects as ObjRef | PlayerRef, st) && e.mods.length === 1 && e.mods[0]!.layer === '7b') {
    const b = e.mods[0] as { power?: Quantity; toughness?: Quantity };
    if (b.power !== undefined && b.toughness === undefined && !isNum(b.power)) {
      const subj = K.obj(e.affects as ObjRef, st, 'subject');
      if (subj.plural) return null;
      const dur = duration ? K.dur(duration, st) : '';
      return `${subj.text}'s base power become equal to ${K.qty(b.power, st)}${dur ? ` ${dur}` : ''}`;
    }
  }
  // FAST5 T69: "you may have ~'s base power and toughness become 4/2 until end of turn" (CR 613.4b, 608.2d): a base power and toughness alone, no other change
  if (e.affects.ref !== 'each' && !isPlayerRef(e.affects as ObjRef | PlayerRef, st) && e.mods.length === 1 && e.mods[0]!.layer === '7b') {
    const b = e.mods[0] as { power?: Quantity; toughness?: Quantity };
    if (b.power === undefined || b.toughness === undefined || !isNum(b.power) || !isNum(b.toughness)) return null;
    const subj = K.obj(e.affects as ObjRef, st, 'subject');
    if (subj.plural) return null;
    const dur = duration ? K.dur(duration, st) : '';
    return `${subj.text}'s base power and toughness become ${b.power}/${b.toughness}${dur ? ` ${dur}` : ''}`;
  }
  // CLOUD std-dft (CR 613.4b, 608.2h, 611.2c): "you may have the base power and toughness of each other creature you control become equal to ~'s power until end of
  // turn": a set's base power and toughness alone, both one value that is not a number (fixed as the effect begins)
  if (e.affects.ref === 'each' && e.mods.length === 1 && e.mods[0]!.layer === '7b') {
    const b = e.mods[0] as { power?: Quantity; toughness?: Quantity };
    if (b.power === undefined || b.toughness === undefined || isNum(b.power) || !same(b.power, b.toughness)) return null;
    const subj = K.obj(e.affects as ObjRef, st, 'subject');
    const dur = duration ? K.dur(duration, st) : '';
    return `the base power and toughness of ${subj.text} become equal to ${K.qty(b.power, st)}${dur ? ` ${dur}` : ''}`;
  }
  // r4-copy (CR 108.4, 613.1b, 608.2d): "you may have target opponent gain control of target permanent you control" (Iroh, Tea Master): another player gains control of
  // one object
  if (e.mods.length === 1 && e.mods[0]!.layer === 2 && e.affects.ref !== 'each' && !isPlayerRef(e.affects as ObjRef | PlayerRef, st)) {
    const who = K.player((e.mods[0] as { controller: PlayerRef }).controller, st, 'subject');
    if (who.person === 'you') return null;
    const dur = duration ? K.dur(duration, st) : '';
    return `${who.text} gain control of ${K.obj(e.affects as ObjRef, st, 'object').text}${dur ? ` ${dur}` : ''}`;
  }
  if (!identityOnly && !e.mods.every((m) => m.layer === '7c' || m.layer === 6 || m.layer === '1a')) return null;
  // std-ry4 (CR 608.2d, 611.2c, 613.1f): "you may have Ally creatures you control gain vigilance until end of turn" (Joraga Bard): a set gains abilities, nothing
  // else; the plural predicate "gain" is already the bare verb the have form needs
  if (e.affects.ref === 'each' && e.mods.every((m) => m.layer === 6)) return continuous(e, st, duration, false, true);
  if (e.affects.ref === 'each' || isPlayerRef(e.affects as ObjRef | PlayerRef, st)) return null;
  if (identityOnly) return continuous(e, st, duration, false, false).replace(/\bbecomes\b/g, 'become');
  return continuous(e, st, duration, false, true);
}

/**
 * Cloud std-eoe: the predicate of a resolved P/T change of one object without its subject, "has base power and toughness 1/1" / "gets +1/+1", for a sentence that
 * names the subject before another effect of the same instruction ("That creature can't be blocked this turn and has base power and toughness 1/1 until end of
 * turn", render/stat.ts#sharedEffectSubject). Null for any other change (more than one modification, a "where", a rider, a count).
 */
export function ptPredicate(e: ContinuousEffectDef, st: RenderState, plural: boolean): string | null {
  if (e.cda === true || e.mods.length !== 1 || (e.mods[0]!.layer !== '7c' && e.mods[0]!.layer !== '7b')) return null;
  const p = pieces(e, plural, st, false, '');
  if (p.preds.length !== 1 || p.where.length > 0 || p.rider !== undefined || p.forEach !== undefined || p.sized !== undefined) return null;
  return p.preds[0]!;
}

/**
 * w8-followups (CR 205.1b): a resolved type change that ADDS card types and subtypes (sets none) is said "becomes a 4/4 Elemental creature in addition to its
 * other types" or, of a land, "becomes a 4/4 Elemental creature. It's still a land.": a "still a [type]" effect keeps all the object's prior card types,
 * supertypes and subtypes, so the new subtypes replace none (rid.stillLand moves the set subtypes to the added ones). The second wording is the one the
 * renderer already has for the same change with the subtypes set (the rider follows a set subtype change), so it is rendered from that. Not "artifact
 * creature": "becomes a [creature type] artifact creature" replaces the creature types (CR 205.1b), its JSON sets them.
 */
function stillVariant(e: ContinuousEffectDef, isStatic: boolean): ContinuousEffectDef | null {
  if (isStatic) return null;
  const fours = e.mods.filter((m) => m.layer === 4);
  if (fours.length !== 1) return null;
  const m = fours[0] as Extract<Modification, { layer: 4 }>;
  const ty = m.types;
  const sub = m.subtypes;
  if (!ty || ty.set !== undefined || !ty.add || ty.add.length === 0 || (ty.add.length === 2 && ty.add.includes('Artifact') && ty.add.includes('Creature'))) return null;
  if (!sub || sub.set !== undefined || !sub.add || sub.add.length === 0 || Object.keys(sub).length !== 1) return null;
  return { ...e, mods: e.mods.map((x) => (x === m ? { ...m, subtypes: { set: sub.add! } } : x)) };
}

/** The sentence of a continuous effect. `duration` is the effect's duration (undefined for a static ability, which is never "until ..."). */
/**
 * r5-static (CR 613.1f): "Marvin has all activated abilities of creatures you control that don't have the same name as this creature", "Thranduil has all activated
 * abilities of all Elf cards in your graveyard": one object, a static ability, the objects copied from a plural noun phrase with or without "all" (family
 * all-activated-abilities-of).
 */
function activatedOfSentence(e: ContinuousEffectDef, st: RenderState, duration: Duration | undefined, isStatic: boolean): string | null {
  const m = e.mods.find((x): x is Extract<Modification, { layer: 6 }> => x.layer === 6 && x.addActivatedOf !== undefined);
  if (m === undefined) return null;
  // std-rx32 (CR 613.1f): a group too, "Creatures you control with +1/+1 counters on them have all activated abilities of all creature cards exiled with ~" (Agatha's Soul Cauldron)
  const group = e.affects.ref === 'each' && 'filter' in e.affects ? e.affects.filter : undefined;
  const limited = m.activatedOfLimit !== undefined;
  const triggered = m.alsoTriggered === true;
  if (!isStatic || duration !== undefined || e.mods.length !== 1 || Object.keys(m).length !== 2 + (limited ? 1 : 0) + (triggered ? 1 : 0) || (limited && triggered) || (e.affects.ref === 'each' && group === undefined) || isPlayerRef(e.affects as ObjRef | PlayerRef, st)) {
    throw new NoRenderer('"has all activated abilities of" beside other changes, for a group of players or with a duration');
  }
  const of = m.addActivatedOf!;
  // std-cardcopy-9 (CR 607.2d, 613.1f): "Koh has all activated and triggered abilities of the last chosen card": the card the linked choice kept last, the object itself
  if (triggered) {
    if (of.ref !== 'linked' || of.link !== 'lastChosen' || group !== undefined) throw new NoRenderer('"all activated and triggered abilities of" anything but the last chosen card, or for a group');
    return `${K.obj(e.affects as ObjRef, st, 'subject').text} has all activated and triggered abilities of the last chosen card`;
  }
  // std-craft-2 (CR 702.167c, 602.5b, 613.1f): "Locus of Enlightenment has each activated ability of the exiled cards used to craft it. You may activate each of those
  // abilities only once each turn.": the cards the craft cost exiled, each granted ability limited to once each turn (only that limit, only of one object)
  if (limited) {
    if (of.ref !== 'linked' || of.link !== 'craft' || group !== undefined || m.activatedOfLimit!.per !== 'turn' || m.activatedOfLimit!.max !== 1) throw new NoRenderer('a limit on activated abilities granted from other than the craft link');
    return `${K.obj(e.affects as ObjRef, st, 'subject').text} has each activated ability of ${K.obj(of, st, 'object').text}. you may activate each of those abilities only once each turn`;
  }
  // std-rf (CR 607.2a, 613.1f): "This artifact has all activated abilities of the exiled card." (Territory Forge): the card the linked ability exiled
  if (of.ref === 'linked' && of.link === 'exiled') return `${K.obj(e.affects as ObjRef, st, 'subject').text} has all activated abilities of ${K.obj(of, st, 'object').text}`;
  if (of.ref !== 'each' || !('filter' in of)) throw new NoRenderer('"has all activated abilities of" objects that are not a description');
  const subj = group !== undefined ? { text: K.np(group as ObjectFilter, st, { det: 'none', plural: true }), plural: true } : K.obj(e.affects as ObjRef, st, 'subject');
  const np = K.np(of.filter as ObjectFilter, cloneState(st), { det: 'none', plural: true });
  const each = K.np(of.filter as ObjectFilter, st, { det: 'each' });
  return `${subj.text} ${subj.plural ? 'have' : 'has'} all activated abilities of ${alt(np, `all ${np}`, each)}`;
}

export function continuous(e: ContinuousEffectDef, st: RenderState, duration: Duration | undefined, isStatic: boolean, have = false, extra: readonly string[] = []): string {
  const still = stillVariant(e, isStatic);
  if (still === null) return continuousOne(e, st, duration, isStatic, have, extra);
  const fork = cloneState(st); // the second wording names the objects as the first does (each starts from the same state)
  let first: string | null = null;
  try { first = continuousOne(e, st, duration, isStatic, have, extra); } catch (err) { if (!(err instanceof NoRenderer)) throw err; }
  if (first === null) return continuousOne(still, st, duration, isStatic, have, extra);
  try { return alt(first, continuousOne(still, fork, duration, isStatic, have, extra)); } catch (err) { if (!(err instanceof NoRenderer)) throw err; return first; }
}

/**
 * std-rx9 (CR 601.3, 113.6f, 613.1f): "You may cast creature spells from your graveyard using their sneak abilities" (Ninja Teen): a static ability that gives each
 * card of one card type in your graveyard the permission to be cast from there with an alternative cost of its own (the `castWith` ability a card prints as "You
 * may cast this card from your graveyard using its warp ability", actions/cast-options.ts). Exactly that grant and nothing else; null otherwise.
 */
function castUsingTheirSentence(e: ContinuousEffectDef, isStatic: boolean, duration: Duration | undefined): string | null {
  if (!isStatic || duration !== undefined || e.cda === true || e.affects.ref !== 'each' || e.mods.length !== 1) return null;
  const m = e.mods[0]!;
  if (m.layer !== 6 || Object.keys(m).length !== 2 || m.add?.length !== 1) return null;
  const a = m.add[0]!;
  if (a.kind !== 'static' || a.effects.length !== 1 || a.condition !== undefined || a.zone !== undefined) return null;
  const cw = a.effects[0]!;
  if (cw.s !== 'castWith' || cw.from !== 'graveyard' || Object.keys(cw).length !== 3) return null;
  const f = 'filter' in e.affects ? e.affects.filter : undefined;
  if (f === undefined || Object.keys(f).length !== 4 || f.zone !== 'graveyard' || f.owner !== 'you' || f.isCard !== true || f.types?.length !== 1) return null;
  return `you may cast ${f.types[0]!.toLowerCase()} ${alt('spells', 'cards')} from your graveyard using their ${cw.method} abilities`; // family cast-spells-or-cards-using-their
}

/**
 * std-cardcopy-2 (CR 611.2a, 613.1f): "It gains this card's other abilities." (Symbiote Spider-Man): a resolved grant, for good, of copies of the face's other abilities
 * (`otherAbilitiesOfCard`, written by parser/parse.ts#fillOtherAbilities) to one object, nothing else in the effect. Null for anything else.
 */
function otherAbilitiesSentence(e: ContinuousEffectDef, st: RenderState, duration: Duration | undefined, isStatic: boolean): string | null {
  const m = e.mods.find((x): x is Extract<Modification, { layer: 6 }> => x.layer === 6 && x.otherAbilitiesOfCard === true);
  if (m === undefined) return null;
  if (isStatic || (duration !== undefined && duration.d !== 'permanent') || e.mods.length !== 1 || Object.keys(m).some((k) => k !== 'layer' && k !== 'add' && k !== 'otherAbilitiesOfCard')
    || e.affects.ref === 'each' || isPlayerRef(e.affects as ObjRef | PlayerRef, st)) {
    throw new NoRenderer('"gains this card\'s other abilities" beside other changes, for a group, with a duration or as a static ability');
  }
  return `${K.obj(e.affects as ObjRef, st, 'subject').text} gains ${K.obj({ ref: 'self' }, st, 'possessive').text} other abilities`;
}

function continuousOne(e: ContinuousEffectDef, st: RenderState, duration: Duration | undefined, isStatic: boolean, have = false, extra: readonly string[] = []): string {
  const cda = cdaSentence(e, st);
  if (cda !== null) return cda;
  const others = otherAbilitiesSentence(e, st, duration, isStatic); // std-cardcopy-2
  if (others !== null) return others;
  const copied = activatedOfSentence(e, st, duration, isStatic); // r5-static
  if (copied !== null) return copied;
  const usingTheir = castUsingTheirSentence(e, isStatic, duration);
  if (usingTheir !== null) return usingTheir;
  const dur = duration ? K.dur(duration, st) : '';
  const imp = imperative(e, st, dur, isStatic);
  if (imp !== null) return imp;
  // Cloud std-fin (CR 613.4b, 611.2a, 608.2h): "Until end of turn, ~'s base power becomes equal to the number of Towns you control" (PuPu UFO): a resolved base power
  // alone (no toughness) of one object, said with the possessive and "becomes", the duration in front of it or after it; "has base power N" stays a reading
  const b7 = e.mods.length === 1 && e.mods[0]!.layer === '7b' ? (e.mods[0] as { power?: Quantity; toughness?: Quantity }) : undefined;
  if (!isStatic && b7 !== undefined && b7.power !== undefined && b7.toughness === undefined && e.affects.ref !== 'each' && !isPlayerRef(e.affects as ObjRef | PlayerRef, st)) {
    const p = unlive(b7.power);
    const val = isNum(p) ? `${p}` : `equal to ${K.qty(p, st)}`;
    const fork = cloneState(st);
    const poss = K.obj(e.affects as ObjRef, st, 'possessive').text;
    const subj = K.obj(e.affects as ObjRef, fork, 'subject');
    const core = `${poss} base power becomes ${val}`;
    const has = `${subj.text} ${subj.plural ? 'have' : 'has'} base power ${isNum(p) ? p : `equal to ${K.qty(p, fork)}`}`;
    return dur ? alt(`${dur}, ${core}`, `${core} ${dur}`, `${has} ${dur}`) : alt(core, has);
  }
  // std-rx32 (CR 613.4b, 604.3a; family static-base-power-is): a static ability's base power alone of one object, "~'s base power is equal to the number of cards in
  // your hand" (the quoted ability Ms. Marvel, Kamala Khan gains: granted, so not a characteristic-defining ability); "has base power equal to" stays a reading
  if (isStatic && e.cda !== true && b7 !== undefined && b7.power !== undefined && b7.toughness === undefined && e.affects.ref !== 'each' && !isPlayerRef(e.affects as ObjRef | PlayerRef, st)) {
    const p = b7.power;
    const fork = cloneState(st);
    const poss = K.obj(e.affects as ObjRef, st, 'possessive').text;
    const subj = K.obj(e.affects as ObjRef, fork, 'subject');
    const val = (s: RenderState): string => (isNum(p) ? `${p}` : `equal to ${K.qty(p, s)}`);
    return alt(`${poss} base power is ${val(st)}`, `${subj.text} ${subj.plural ? 'have' : 'has'} base power ${val(fork)}`);
  }
  // std-rr (CR 613.4b, 611.2a, 608.2h; family base-pt-equal-to-object-pt): "Its base power and toughness become equal to ~'s power and toughness until end of turn"
  // (Galion, Elvenking's Butler): a resolved base power and toughness of one object, the power and the toughness of ONE other object (read as the effect begins)
  const ptOf = b7 !== undefined && b7.power !== undefined && b7.toughness !== undefined ? objectPT(b7.power, b7.toughness) : null;
  if (!isStatic && ptOf !== null && dur && e.affects.ref !== 'each' && !isPlayerRef(e.affects as ObjRef | PlayerRef, st)) {
    const poss = K.obj(e.affects as ObjRef, st, 'possessive').text;
    const of = K.obj(ptOf, st, 'possessive').text;
    return `${poss} base power and toughness become equal to ${of} power and toughness ${dur}`;
  }
  const build = (subject: string, pl: boolean): string => {
    const p = pieces(e, pl || have, st, isStatic, subject);
    if (p.preds.length === 0) throw new NoRenderer('continuous effect without a modification the renderer knows');
    // FAST4 T33: more predicates of the same subject from other effects of the static ability, said last in the one list (render/stat.ts#staticEffects)
    if (extra.length > 0) {
      if (duration !== undefined || p.where.length > 0 || p.rider !== undefined) throw new NoRenderer('more predicates beside a duration, a "where" or a rider');
      p.preds.push(...extra);
    }
    const sentence = (preds: string[], whereParts: string[]): string => {
      // FAST5 T60 (family quoted-grant-then-change): a quoted grant that is followed by the last change of the sentence ends without its period, or with the
      // comma of the list inside the closing quote: 'has "A," and is a Wizard in addition to its other types', 'has "A" and is a Wizard ...'
      const kq = preds.length - 2;
      // std-combat-2: with a duration too ('Until end of turn, target creature you control gains "When this creature dies, ..." and has the chosen base power and
      // toughness', Vincent's Limit Break)
      const unpunctuated = kq >= 0 && whereParts.length === 0 ? quotedListItem(preds[kq]!, 'none') : undefined;
      const body = p.itJoin === true ? preds.map((x, i) => (i === 0 ? x : `${i === preds.length - 1 ? 'and ' : ''}it ${x}`)).join(', ') // FAST5 T69
        : unpunctuated !== undefined && unpunctuated !== preds[kq]
        ? alt(joinList(preds), joinList(preds.map((x, i) => (i === kq ? unpunctuated : x))),
          `${preds.slice(0, kq).map((x) => `${x}, `).join('')}${quotedListItem(preds[kq]!, 'comma')} and ${preds[kq + 1]!}`)
        : joinList(preds);
      const where = whereParts.length > 0 ? `, where ${joinList(whereParts)}` : '';
      const suffix = `${subject} ${body}${dur ? ` ${dur}` : ''}${where}`;
      if (!dur) return suffix;
      const lead = `${dur}, ${subject} ${body}${where}`;
      // FAST5 T47: a quoted ability said last ends the sentence inside its quotes ('Until end of turn, ~ becomes a 2/1 Cat creature with "Flying."'), so the
      // reading with the duration in front already ends there and the one with the duration behind it ends with its own period (render/clause.ts#endSentence)
      // FAST5 T69: Oracle also ends the quoted ability without its period when the duration follows it ('... with flying and "This creature gets +1/+1 for each
      // artifact you control" until end of turn.', Iron Man Armor): the period is the sentence's, after the duration
      const quoted = /[.!?](?:'?["”]|')$/.test(firstAlt(lead)); // r3-fx: also a quote that ends in ' or '"
      // r3-choose: ... also when the grant is said with "gains" or "has" (an alternative group, whose readings each end with the quoted ability: 'target creature gains
      // "Whenever this creature deals combat damage to a player or planeswalker, draw a card" until end of turn', Sygg)
      const unquotedEnd = mapEnds(body, (lit) => lit.replace(/\."$/, '"'));
      return quoted ? alt(`${suffix}.`, lead, ...(/\."$/.test(body) ? [`${subject} ${body.slice(0, -2)}" ${dur}.`] : unquotedEnd !== body ? [`${subject} ${unquotedEnd} ${dur}.`] : [])) : alt(suffix, lead);
    };
    let text = sentence(p.preds, p.where);
    // r3-refs (CR 613.1f, 611.2a): "it gains equip {3} and "Equipped creature gets +3/+3" and loses all other abilities": the abilities it gains are the ones it keeps,
    // so Oracle says the gain first and the loss of the OTHER abilities after it (one layer-6 change that removes all abilities and adds these, nothing else)
    const l6 = e.mods.length === 1 && e.mods[0]!.layer === 6 ? e.mods[0] : undefined;
    if (l6 !== undefined && l6.removeAll === true && (l6.add?.length ?? 0) > 0 && l6.remove === undefined && l6.cantHave === undefined && p.preds.length === 2 && / all abilities$/.test(p.preds[0]!)) {
      text = alt(text, sentence([p.preds[1]!, p.preds[0]!.replace(/ all abilities$/, ' all other abilities')], p.where));
    }
    // CLOUD C8 (family becomes-x-over-x, CR 107.3, 608.2h, 613.4b): the identity with one computed base power and toughness, "~ becomes an X/X Cat artifact creature until end of turn,
    // where X is the discarded card's mana value" (the number is read once, as the effect is created; render/mods.ts#Pieces.sizedX)
    const sx = p.sizedX;
    if (sx !== undefined && p.forEach === undefined && p.rider === undefined && p.granted === undefined && p.preds.length === 1) text = alt(text, sentence([sx.text], [...p.where, `X is ${sx.q}`]));
    // r5-fxz (CR 205.1a, 613.1d-f): a static ability that makes its object a colorless artifact of subtypes it sets, with abilities it grants, and takes every other
    // ability away: "Enchanted permanent is a colorless Food artifact with "{2}, {T}, Sacrifice this artifact: You gain 3 life" and loses all other card types and
    // abilities." (Sugar Coat: setting the card types is losing the others); the quoted ability ends without its period before "and"
    const [m4, m5, m6] = e.mods as unknown as [Record<string, unknown>?, Record<string, unknown>?, Record<string, unknown>?];
    if (isStatic && !dur && !pl && e.mods.length === 3 && m4?.['layer'] === 4 && m5?.['layer'] === 5 && m6?.['layer'] === 6 && m6['removeAll'] === true && Array.isArray(m6['add']) && (m6['add'] as unknown[]).length > 0
      && m6['remove'] === undefined && m6['cantHave'] === undefined && JSON.stringify(m5['colors']) === JSON.stringify({ set: [] }) && m4['supertypes'] === undefined && m4['named'] === undefined
      && ((JSON.stringify(m4['types']) === JSON.stringify({ set: ['Artifact'] }) && Array.isArray((m4['subtypes'] as { set?: unknown } | undefined)?.set) && Object.keys(m4['subtypes'] as object).length === 1)
        // std-rf (CR 205.1a, 305.7, 613.1d): "Enchanted permanent is a colorless land with "{T}: Add {C}" and loses all other card types and abilities." (Imprisoned in the Moon): a land
        // of no subtype (the same change with the land type, sets no subtypes)
        || (JSON.stringify(m4['types']) === JSON.stringify({ set: ['Land'] }) && m4['subtypes'] === undefined))) {
      const noun = JSON.stringify(m4['types']) === JSON.stringify({ set: ['Land'] }) ? 'land' : 'artifact';
      const subs = m4['subtypes'] === undefined ? '' : ((m4['subtypes'] as { set: string[] }).set).join(' ');
      const list = mapEnds(abilityList(m6['add'] as AbilityDef[], cloneState(st), noun), (lit) => lit.replace(/\."$/, '"'));
      text = alt(text, `${subject} is a colorless ${subs}${subs === '' ? '' : ' '}${noun} with ${list} and loses all other card types and abilities`);
    }
    // std-rx30 (CR 205.1a, 611.2b, 613.1d, 613.1f): a resolved effect with a duration that sets its objects' card type to artifact with one subtype, takes all their
    // abilities away and grants others: "For as long as ~ remains on the battlefield, the chosen permanents become Treasure artifacts with "{T}, Sacrifice this
    // artifact: Add one mana of any color" and lose all other abilities." (Kitesail Larcenist; the duration first, the quoted ability without its period before "and")
    if (!isStatic && dur && e.mods.length === 2 && m4?.['layer'] === 4 && m5?.['layer'] === 6 && m5['removeAll'] === true && Array.isArray(m5['add']) && (m5['add'] as unknown[]).length > 0
      && m5['remove'] === undefined && m5['cantHave'] === undefined && m4['supertypes'] === undefined && m4['named'] === undefined && JSON.stringify(m4['types']) === JSON.stringify({ set: ['Artifact'] })
      && Array.isArray((m4['subtypes'] as { set?: unknown } | undefined)?.set) && ((m4['subtypes'] as { set: string[] }).set).length === 1 && Object.keys(m4['subtypes'] as object).length === 1) {
      const sub = (m4['subtypes'] as { set: string[] }).set[0]!;
      const list = mapEnds(abilityList(m5['add'] as AbilityDef[], cloneState(st), 'artifact'), (lit) => lit.replace(/\."$/, '"'));
      text = alt(text, pl ? `${dur}, ${subject} become ${sub} artifacts with ${list} and lose all other abilities` : `${dur}, ${subject} becomes ${withArticle(sub)} artifact with ${list} and loses all other abilities`);
    }
    // FAST3 T12: "Enchanted creature gets -5/-0 and loses all abilities" (CR 613.1f, 613.4c: the layers order the two changes, not the text)
    const lose = `${pl || have ? 'lose' : 'loses'} all abilities`;
    if (p.preds.length === 2 && (p.preds[0] === lose || p.preds[0]!.startsWith(`${lose.split(' ')[0]} `)) && /^gets? /.test(p.preds[1]!) && p.forEach === undefined && p.sized === undefined && p.where.length === 0) text = alt(text, sentence([p.preds[1]!, p.preds[0]!], p.where));
    // FAST4 T33: "Enchanted creature is a Treefolk with base power and toughness 0/4 and loses all abilities" (a static ability; CR 613.1d, 613.1f, 613.4b:
    // the layers order the changes, not the text)
    else if (isStatic && p.preds.length === 2 && p.preds[0] === lose && p.forEach === undefined && p.where.length === 0 && p.rider === undefined) text = alt(text, sentence([p.preds[1]!, lose], p.where));
    // FAST4 T23: "~ has base power and toughness 5/3 until end of turn and gains trample until end of turn" (the Mimics): one duration said after each of the
    // two changes of one resolved effect (CR 611.2a, 613.4b, 613.1f); only a base power and toughness with one more change
    if (dur && !isStatic && p.preds.length === 2 && /^ha(s|ve) base power and toughness /.test(p.preds[0]!) && p.forEach === undefined && p.sized === undefined && p.where.length === 0 && p.rider === undefined) {
      text = alt(text, `${subject} ${p.preds[0]} ${dur} and ${p.preds[1]} ${dur}`);
    }
    // FAST2 T9: "~ becomes a 2/2 white and blue Bird artifact creature with flying until end of turn" (CR 205.1b, 613.1f): the granted abilities said with
    // "with" after the sized identity (a resolved effect only; one reading more, the "and gains flying" readings stay)
    const sz = p.sized ?? p.sizedAll;
    const gr = p.granted;
    // Cloud std-woe (CR 205.1b, 613.1f, 613.4b; family identity-with-list): a static ability's identity, base power and toughness and abilities in one "with" list,
    // "Goddric is a Dragon with base power and toughness 4/4, flying, and "{R}: Dragons you control get +1/+0 until end of turn."" (the serial comma before "and")
    const wb = p.withBase;
    const sg = p.staticGrant;
    const withList = wb && sg && isStatic && p.forEach === undefined && p.where.length === 0 && p.rider === undefined && sg.items.length > 0
      ? [sentence(p.preds.map((x, i) => (i === wb.index ? `${wb.text}${sg.items.length === 1 ? ` and ${sg.items[0]}` : `, ${sg.items.slice(0, -1).map((it) => quotedListItem(it, 'comma')).map((it) => (/,"$/.test(it) ? `${it} ` : `${it}, `)).join('')}and ${sg.items[sg.items.length - 1]}`}` : x)).filter((_, i) => i !== sg.index), p.where)]
      : [];
    // std-rx15 (CR 611.2a, 205.1b, 613.1f, 613.4b; family becomes-with-base-and): a resolved effect that lasts for good (no duration) and sets one object's subtypes
    // and base power and toughness and grants abilities, said in one "with" phrase: "it becomes a Kithkin Avatar with base power and toughness 7/8 and protection from
    // each of your opponents" (Figure of Fable)
    if (!isStatic && !dur && !pl && wb && gr && p.preds.length === 2 && wb.index === 0 && gr.index === 1 && p.forEach === undefined && p.where.length === 0 && p.rider === undefined) {
      text = alt(text, `${subject} ${wb.text} and ${gr.list}`);
    }
    if ((sz && gr && p.forEach === undefined) || withList.length > 0) {
      const preds = sz && gr ? p.preds.map((x, i) => (i === sz.index ? `${sz.text} with ${gr.list}${sz.suffix ?? ''}${p.sizedAll ? ' and all creature types' : ''}` : x)).filter((_, i) => i !== gr.index) : null;
      text = alt(text, ...(preds !== null && p.forEach === undefined ? [sentence(preds, p.where)] : []), ...withList);
    }
    // std-ry8 (CR 205.1b, 613.1f): an Aura's static "Enchanted land is a 2/6 white Wall creature with defender. It's still a land." (Guardian Zendikon): the abilities
    // said with "with" after the sized identity, before the rider (only with that rider, render/mods.ts#identity)
    if (isStatic && sz && sg && p.rider === "it's still a land" && p.forEach === undefined && p.where.length === 0 && sg.items.length > 0 && p.preds.length === 2) {
      text = alt(text, sentence(p.preds.map((x, i) => (i === sz.index ? `${sz.text} with ${joinList(sg.items)}` : x)).filter((_, i) => i !== sg.index), p.where));
    }
    // CLOUD std-msh (CR 613.4b, 613.1f, 611.2a): "Until end of turn, ~'s base power and toughness become 6/6 and they gain trample." (Moon Girl and Devil Dinosaur):
    // the base power and toughness of one object set by a resolved effect, said with "become" after the duration, alone or followed by the abilities it gains;
    // "they gain" only for this object, whose name may name two characters (CR 201.5)
    const b7 = e.mods.length === p.preds.length ? e.mods.find((m) => m.layer === '7b') as { power?: Quantity; toughness?: Quantity } | undefined : undefined;
    if (dur && !isStatic && !pl && !have && b7 !== undefined && isNum(b7.power) && isNum(b7.toughness) && /^has base power and toughness /.test(p.preds[0]!)
      && p.forEach === undefined && p.sized === undefined && p.where.length === 0 && p.rider === undefined && e.affects.ref !== 'each' && !isPlayerRef(e.affects as ObjRef | PlayerRef, st)) {
      const become = `${dur}, ${subject}'s base power and toughness become ${b7.power}/${b7.toughness}`;
      if (p.preds.length === 1) text = alt(text, become);
      else if (p.preds.length === 2 && gr !== undefined && gr.index === 1) text = alt(text, `${become} and ${subject === '~' ? alt('it gains', 'they gain') : 'it gains'} ${gr.list}`);
    }
    // FAST5 T69 (CR 205.1a, 613.1d): "It's a Treasure artifact with "{T}, Sacrifice this artifact: Add one mana of any color," and it loses all other card types."
    // (Vraska, the Silencer): the card types set by a resolved effect that lasts for good, with the abilities it grants said after the type words, and the types it
    // loses said out (setting the types is losing the others). The comma ends the quoted ability, which is followed by "and"
    const lo = p.loseOthers;
    if (lo !== undefined && gr !== undefined && dur === '' && !isStatic && p.forEach === undefined && p.rider === undefined && p.where.length === 0) {
      const preds2 = p.preds.map((x, i) => (i === lo.index ? `${lo.text} with ${gr.list.replace(/\."$/, ',"')}` : x)).filter((_, i) => i !== gr.index);
      // r5-fxz (CR 205.1a): several objects, "They are Food artifacts with "{2}, {T}, Sacrifice this artifact: You gain 3 life."" (Supper for Spiders: the types they
      // lose are reminder text there)
      if (preds2.length === 1 && lo.plural === true) text = alt(text, sentence(p.preds.map((x, i) => (i === lo.index ? `${lo.text} with ${gr.list}` : x)).filter((_, i) => i !== gr.index), p.where));
      else if (preds2.length === 1) text = alt(text, `${sentence(preds2, p.where)} and it loses all other card types`);
    }
    // FAST5 T47: "It's an enchantment." (CR 205.1a): the same change said with "is", only when it has no duration (the effect lasts for good, CR 611.2a)
    if (p.typeOnly !== undefined && dur === '' && p.preds.length === 1 && p.rider === undefined && p.where.length === 0) text = alt(text, sentence([p.preds[0]!.replace(/^becomes /, 'is ')], []));
    const fe = p.forEach;
    if (fe) {
      // WP22 FIX: the "for each" reading without the "where X is ..." clause of the change it states
      const preds = p.preds.map((x, i) => (i === fe.index ? fe.text : x));
      const rest = [...p.where];
      for (const w of fe.where) rest.splice(rest.indexOf(w), 1);
      const readings = [text, sentence(preds, rest)];
      // r4-static (family type-add-last, CR 613.1d, 613.4c): "Equipped creature gets +2/+2 for each artifact you control and is an Artificer in addition to its other
      // types": the counted change first, the added type said last
      const tf = p.typeAdd;
      if (isStatic && tf !== undefined && tf !== fe.index && p.preds.length === 2 && p.rider === undefined && p.sized === undefined) readings.push(sentence([preds[fe.index]!, preds[tf]!], rest));
      // Oracle's order for a resolved effect: "gets +1/+1 until end of turn for each Elf you control" (the duration before the count)
      if (dur && fe.index === p.preds.length - 1 && rest.length === 0) readings.push(`${subject} ${joinList(p.preds.map((x, i) => (i === fe.index ? fe.head : x)))} ${dur} ${fe.tail}`);
      // CLOUD std-otj (family additional-pump-for-each, CR 613.4c): a resolved effect's ONE counted change is also "it gets an additional -1/-1 until end of turn for each
      // Desert you control" (Desert's Due): it adds to the change of the sentence before, as every change of power and toughness does (the E17 reading, counted)
      if (dur && !isStatic && e.mods.length === 1 && p.preds.length === 1 && fe.index === 0 && rest.length === 0) readings.push(`${subject} ${fe.head.replace(/^(gets?) /, '$1 an additional ')} ${dur} ${fe.tail}`);
      // p2-pt-2 (family grant-then-pump-for-each, CR 611.2a, 613.1f, 613.4c): a resolved effect's grant said before its counted change, "Until end of turn, target
      // creature gains trample and gets +1/+0 for each card you've drawn this turn" (the layers order the two changes, not the words; FAST4 T29 grant-then-pump)
      const g2 = p.granted;
      if (!isStatic && g2 !== undefined && p.preds.length === 2 && g2.index === 1 && fe.index === 0 && p.sized === undefined && p.rider === undefined) readings.push(sentence([preds[1]!, preds[0]!], rest));
      // p2-counters-move-3 (family count-before-pump, CR 613.4c, 608.2h): a resolved effect's ONE counted change with the count said first, "For each counter removed this
      // way, ~ gets +1/+0 until end of turn" (Hex Parasite): the same count, read as the effect begins
      if (dur && !isStatic && e.mods.length === 1 && p.preds.length === 1 && fe.index === 0 && rest.length === 0 && /^for each /.test(fe.tail)) readings.push(`${fe.tail}, ${subject} ${fe.head} ${dur}`);
      // one alternative group, as before this fix (the counted P/T change was one group in pieces(); render/equivalence.ts#ALT_SITES is unchanged)
      text = alt(...readings);
    }
    // FAST4 T29 (family grant-then-pump): "Target creature you control gains vigilance and gets +X/+X until end of turn, where X is ..." (one resolved effect
    // of two changes, CR 611.2a, 613.1f, 613.4c: the layers order them, not the words)
    if (!isStatic && gr && p.preds.length === 2 && gr.index === 1 && /^gets? /.test(p.preds[0]!) && p.sized === undefined && p.rider === undefined) {
      text = alt(text, sentence([p.preds[1]!, p.preds[0]!], p.where));
    }
    // std-combat-2 (family grant-then-base): "Until end of turn, target creature you control gains flying and has base power and toughness 4/1" (Vincent's Limit Break):
    // a resolved effect of a base power and toughness and a grant, said in either order (CR 613.1f, 613.4b: the layers order the two changes, not the words)
    if (!isStatic && gr && p.preds.length === 2 && gr.index === 1 && /^has base power and toughness \d+\/\d+$/.test(p.preds[0]!) && p.forEach === undefined && p.sized === undefined && p.where.length === 0 && p.rider === undefined) {
      text = alt(text, sentence([p.preds[1]!, p.preds[0]!], p.where));
    }
    // cloud std-spm (family grant-then-color): "He gains hexproof and becomes colorless until end of turn" (Ultimate Spider-Man): a resolved effect of a grant and a
    // color set, said in either order (CR 613.1e, 613.1f: the layers order the two changes, not the words)
    const co = p.colorOnly;
    if (!isStatic && gr && co !== undefined && p.preds.length === 2 && gr.index !== co && p.forEach === undefined && p.sized === undefined && p.where.length === 0 && p.rider === undefined) {
      text = alt(text, sentence([p.preds[gr.index]!, p.preds[co]!], p.where));
    }
    // p2-graveyard-1 (family color-set-anywhere): "As long as there are seven or more cards in your graveyard, this creature gets +1/+1, is black, and has "..."" (Possessed
    // Nomad): a static ability's color set said anywhere in its list of three or more changes; the layers order them (CR 613.1e, 613.1f, 613.4c), not the words
    const cs = p.colorOnly;
    if (isStatic && cs !== undefined && p.preds.length > 2 && p.forEach === undefined && p.sized === undefined && p.where.length === 0 && p.rider === undefined) {
      const rest = p.preds.filter((_, i) => i !== cs);
      text = alt(text, ...rest.map((_, k) => sentence([...rest.slice(0, k), p.preds[cs]!, ...rest.slice(k)], p.where)), sentence([...rest, p.preds[cs]!], p.where));
    }
    // FAST4 T29 (family type-add-last): "Equipped creature gets +2/+2, has trample and haste, and is a Samurai in addition to its other types" (the job
    // Equipment): the layers order the changes (CR 613.1d, 613.1f, 613.4c), so the type said last is the same static ability
    const ta = p.typeAdd;
    // FAST5 T41: a resolved effect too ("Until end of turn, target creature gets +2/+2, gains flying, and becomes a Horror enchantment creature in addition to its other types")
    // FAST5 T77: ... or anywhere in that list ("Equipped creature gets +1/+1, is a Ninja in addition to its other types, and has "..."", "Equipped creature is a Shaman in addition
    // to its other types and has "..."": the Equipment of Final Fantasy say it first or second); the layers order the changes, not the words
    if (ta !== undefined && p.preds.length > 1 && p.forEach === undefined && p.sized === undefined && p.where.length === 0 && p.rider === undefined) {
      const rest = p.preds.filter((_, i) => i !== ta);
      text = alt(text, ...rest.map((_, k) => sentence([...rest.slice(0, k), p.preds[ta]!, ...rest.slice(k)], p.where)), sentence([...rest, p.preds[ta]!], p.where));
    }
    // FAST5 T57 (CR 613.1d, 613.1f, 613.4b): "Enchanted creature is a Citizen with base power and toughness 1/1. It has defender and loses all other
    // abilities." (a static ability): the identity change is one sentence, the gift of abilities with the loss of the others is the next one
    if (isStatic && !have && duration === undefined && p.forEach === undefined && p.where.length === 0 && p.rider === undefined && !pl) {
      const l6 = e.mods.filter((m): m is Extract<Modification, { layer: 6 }> => m.layer === 6);
      const one = l6[0];
      if (l6.length === 1 && one!.removeAll === true && one!.remove === undefined && one!.cantHave === undefined && (one!.add?.length ?? 0) > 0 && e.mods.length === 3
        && e.mods.some((m) => m.layer === 4) && e.mods.some((m) => m.layer === '7b') && !isPlayerRef(e.affects as ObjRef | PlayerRef, st) && e.affects.ref !== 'each') {
        const head = continuous({ ...e, mods: e.mods.filter((m) => m.layer !== 6) }, cloneState(st), undefined, true);
        const list = abilityList(one!.add!, cloneState(st), granteeNoun(subject, e, st));
        text = alt(text, `${head}. ${alt('it', subject)} has ${list} and loses all other abilities`);
      }
    }
    // FAST5 T41: "loses all creature types" is said before or after the other changes (CR 613.1d, 613.4c: the layers order them, not the words)
    const tl = p.typeLoss;
    if (tl !== undefined && p.preds.length > 1 && p.forEach === undefined && p.sized === undefined && p.where.length === 0 && p.rider === undefined) {
      text = alt(text, sentence([p.preds[tl]!, ...p.preds.filter((_, i) => i !== tl)], p.where));
    }
    // FAST5 T64: "Target artifact you control becomes a copy of a second target artifact you control until end of turn, except it isn't legendary" (Shuri)
    const ce = p.copyExcept;
    if (ce !== undefined && dur && p.preds.length === 1 && p.forEach === undefined && p.sized === undefined && p.where.length === 0 && p.rider === undefined) {
      text = alt(text, `${subject} ${ce.head} ${dur}${ce.tail}`);
    }
    // std-rh: ... or the rider inside the sentence, when the change grants abilities ("becomes a 3/3 Elemental creature with haste that's still a land")
    // p2-typechange-3: ... or after the sized change alone, when it lasts for good ("Target land becomes a 2/2 green creature that's still a land", Quirion Druid)
    const sizedAlone = gr === undefined && !dur && p.sized !== undefined && p.preds.length === 1 && p.where.length === 0 && p.forEach === undefined ? sentence([p.sized.text], []) : undefined;
    const inlineRider = p.rider === undefined || p.riderInline === undefined ? undefined
      : gr !== undefined && gr.index === p.preds.length - 1 && !/[.!?](?:"|'|'")?$/.test(firstAlt(text)) ? `${text} ${p.riderInline}`
      : sizedAlone !== undefined ? `${sizedAlone} ${p.riderInline}` : undefined;
    if (p.rider) text += /[.!?](?:"|'|'")?$/.test(firstAlt(text)) ? ` ${p.rider}` : `. ${p.rider}`; // FAST5 T47: after a quoted ability the next sentence follows a space
    if (inlineRider !== undefined) text = alt(text, inlineRider);
    // FAST5 T77 (CR 205.1b, 611.2a, 613.4b): the readings of a type ADDED to the object, whatever else the effect says: "is" for an effect without a duration ("It's a
    // Demon in addition to its other types"), the group's "They are 5/5 Elemental creatures in addition to their other types", the static base power and toughness
    // said inside the identity ("is a Construct creature with base power and toughness 5/5 in addition to its other types")
    const more: string[] = [];
    const ia = p.inAddition;
    if (ia !== undefined && p.preds.length === 1 && p.where.length === 0 && p.forEach === undefined && extra.length === 0) {
      more.push(sentence([ia], []));
      // std-rx32 (CR 611.2b): also with a duration about the object itself, "It's an Island in addition to its other types for as long as it has a flood counter on
      // it" (Eluge, the Shoreless Sea): the effect is about that object, said with "is", the duration after it
      if ((dur === '' || duration?.d === 'whileObject') && !isStatic) more.push(sentence([ia.replace(/^becomes? /, pl || have ? 'are ' : 'is ')], []));
    }
    // Standard round 3, r3-trig (family type-add-has-is; CR 205.1b, 611.2a, 613.1d, 613.1f): a resolved effect without a duration that grants abilities and ADDS
    // types to one object, said with "has" and "is": "It has flying and is an Angel in addition to its other types" (the layers order the two changes, not the words)
    if (ia !== undefined && gr && ta !== undefined && gr.index !== ta && dur === '' && !isStatic && !pl && !have && p.preds.length === 2 && p.where.length === 0
      && p.forEach === undefined && p.sized === undefined && extra.length === 0 && p.rider === undefined) {
      more.push(sentence([`has ${gr.list}`, ia.replace(/^becomes /, 'is ')], []));
    }
    // r4-static (CR 205.1b, 611.2a, 613.1f; family type-add-is): a type ADDED for good beside the loss of every ability: "It's a Skeleton in addition to its other
    // types and has no abilities" (Xu-Ifit): one resolved effect with no duration, the two changes ordered by their layers
    if (ia !== undefined && dur === '' && !isStatic && !pl && p.preds.length === 2 && p.preds[0] === lose && p.where.length === 0 && p.forEach === undefined && extra.length === 0 && p.rider === undefined) {
      more.push(sentence([ia.replace(/^becomes? /, 'is '), 'has no abilities'], []));
    }
    if (p.baseAdd !== undefined && isStatic && p.preds.length === 2 && p.where.length === 0 && p.forEach === undefined && extra.length === 0 && p.rider === undefined) more.push(sentence([p.baseAdd], []));
    // p2-typechange-1 (family still-land-artifact-creature): "~ becomes a 2/2 Assembly-Worker artifact creature until end of turn. It's still a land."
    if (p.stillLand !== undefined && !isStatic && p.preds.length === 1 && p.where.length === 0 && p.forEach === undefined && extra.length === 0 && p.rider === undefined) {
      more.push(`${sentence([p.stillLand], [])}. it's still a land`);
    }
    // std-typechange-1 (family loseall-base-add; CR 205.1b, 613.1d, 613.1f, 613.4b): the same static identity beside the loss of every ability, said first: "Enchanted
    // creature loses all abilities and is a Toy artifact creature with base power and toughness 0/2 in addition to its other types" (Unable to Scream)
    if (p.baseAdd !== undefined && isStatic && p.preds.length === 3 && p.preds[0] === lose && p.where.length === 0 && p.forEach === undefined && extra.length === 0 && p.rider === undefined) {
      more.push(sentence([lose, p.baseAdd], []));
    }
    // std-typechange-1 (family loseall-identity-with-named; CR 201.2, 205.1b, 613.1d, 613.1f, 613.4b): a static ability that takes every ability away, sets the creature
    // types, the base power and toughness and the name, and grants abilities, said in one identity with the granted abilities before the name: "Enchanted creature loses
    // all abilities and is a Citizen with base power and toughness 1/1 and "{T}: Add {C}" named Humble Merchant" (Honest Work; the quoted ability without its period)
    const named = namedIdentity(e);
    if (isStatic && named !== null && !pl && !have && duration === undefined && p.where.length === 0 && p.forEach === undefined && extra.length === 0 && p.rider === undefined) {
      const list = mapEnds(abilityList(named.add, cloneState(st), granteeNoun(subject, e, st)), (lit) => lit.replace(/\."$/, '"'));
      more.push(`${subject} ${lose} and is ${withArticle(named.subtypes.join(' '))} with base power and toughness ${named.p}/${named.t} and ${list} named ${named.name}`);
    }
    // std-mkm (CR 205.1b, 613.1d, 613.1f, 613.4b): a static ability that ADDS the creature type and creature types, with base power and toughness and abilities,
    // said in one phrase: "This Case is a 4/4 Gorgon creature with deathtouch and lifelink in addition to its other types" (Case of the Gorgon's Kiss)
    // std-typechange-2 (family planeswalker-is-creature; CR 205.1b, 306.8, 120.3c, unverified): a planeswalker's own static ability that makes it a creature
    // too, "~ is a 3/4 Ninja creature and has hexproof" (Kaito, Bane of Nightmares): it keeps its planeswalker type and loyalty abilities (the set's release notes,
    // DECIDED BY DEFAULT, owner instruction 2026-10-21), so the words say the same change as "... creature in addition to its other types"
    const walker = isStatic && !pl && !have && e.affects.ref === 'self' && (st.ctx.selfTypes ?? []).some((t) => t.toLowerCase() === 'planeswalker') ? walkerCreature(e) : null;
    if (walker !== null && p.where.length === 0 && p.forEach === undefined && extra.length === 0 && p.rider === undefined) {
      more.push(`${subject} is ${article(`${walker.p}/${walker.t}`)} ${walker.p}/${walker.t} ${walker.subtypes.join(' ')} creature and has ${abilityList(walker.add, cloneState(st), granteeNoun(subject, e, st))}`);
    }
    const sizedWith = isStatic && !pl && !have && p.where.length === 0 && p.forEach === undefined && extra.length === 0 && p.rider === undefined ? sizedCreatureWith(e, st, subject) : null;
    if (sizedWith !== null) more.push(sizedWith);
    if (more.length > 0) text = alt(text, ...more);
    return text;
  };
  const aff = e.affects;
  // std-rx28 (CR 115.9b, 608.2c): "those creatures" the cast trigger's spell targets are a group named again (render/refs.ts#obj), not a description
  if (aff.ref === 'each' && 'filter' in aff && aff.filter.targetedBy !== undefined) {
    const subj = K.obj(aff as ObjRef, st, 'subject');
    return build(subj.text, subj.plural);
  }
  if (aff.ref === 'each' && 'filter' in aff) {
    if (hostOther(aff.filter as ObjectFilter, st)) throw new NoRenderer('"other creatures" of an Aura or Equipment excludes the creature it is attached to, not the source');
    const subjects = eachSubjects(aff.filter as ObjectFilter, st);
    // FAST5 T64: every wording of the subject is rendered from the same point, so a target the clause names ("each creature you control becomes a copy of target
    // creature") is said in full in each wording, not as "it" in the later ones; what the variants mention joins the state that continues
    const before = new Set(st.mentioned);
    const after = new Set(before);
    const texts = subjects.map((s) => {
      st.mentioned = new Set(before);
      const t = build(s.text, s.plural);
      for (const k of st.mentioned) after.add(k);
      return t;
    });
    st.mentioned = after;
    return alt(...texts);
  }
  // std-typechange-1 (family same-is-true-spells-and-cards; CR 611.3a, 613.1d, 108.3, 109.4): a static ability's change of the creatures you control that also
  // reaches your creature spells and the creature cards you own elsewhere, said in a second sentence: "Creatures you control are the chosen type in addition to
  // their other types. The same is true for creature spells you control and creature cards you own that aren't on the battlefield." (Leyline of Transformation)
  if (isStatic && aff.ref === 'union' && JSON.stringify(aff) === SAME_IS_TRUE_UNION) {
    return `${build('creatures you control', true)}. the same is true for creature spells you control and creature cards you own that aren't on the battlefield`;
  }
  // p2-typechange-1 (same family): the other groups Oracle prints so, "Nonland permanents you control are artifacts in addition to their other types. The same is
  // true for permanent spells you control and nonland permanent cards you own that aren't on the battlefield." (Encroaching Mycosynth), and the plain list of a
  // group and its spells, "Nonland permanents you control and permanent spells you control are enchantments in addition to their other types." (Secret Arcade)
  const said = isStatic && aff.ref === 'union' ? SAME_IS_TRUE_GROUPS.find((g) => g.union === JSON.stringify(aff)) : undefined;
  if (said !== undefined) return said.tail === undefined ? build(said.subject, true) : `${build(said.subject, true)}. the same is true for ${said.tail} that aren't on the battlefield`;
  const subj = isPlayerRef(aff as ObjRef | PlayerRef, st) ? K.player(aff as PlayerRef, st, 'subject') : K.obj(aff as ObjRef, st, 'subject');
  const split = grantSubjects(subj.text, e);
  if (split !== null) return alt(...split.map((s) => build(s, subj.plural))); // FXC (audit m2)
  // FAST2 T9: "Up to two target creatures each get +2/+2 until end of turn": "each" after targets of one spec says what the plural says (CR 115.1, 611.2c)
  if (!isStatic && aff.ref === 'target' && subj.plural) return alt(build(subj.text, true), build(`${subj.text} each`, true));
  // r4-static (family plural-name-agreement): an object whose name is a plural noun phrase takes a plural verb, "The Neutrinos get +1/+0 until end of turn": the
  // same change of the object itself, only the verb agrees with its name
  if (aff.ref === 'self' && !subj.plural && pluralName(st)) return alt(build(subj.text, false), build(subj.text, true));
  return build(subj.text, subj.plural);
}
