/**
 * M6-2 (m6 design 3.3, 4.1: an additive renderer entry): the Oracle wording of copy exceptions (CR 707.9b), "except it isn't legendary", "except it's an
 * artifact in addition to its other types", "except it has haste", "except it's 1/1", joined the way Oracle joins them ("it's 1/1, it's a Spirit in addition
 * to its other types, and it has flying"). An exception with no wording here is rendered as the continuous effect it is (the milestone 5 text), so nothing that
 * rendered before renders differently, and an exception that retains a value or depends on a condition has no renderer (CR 707.9c, 707.9f: no template yet).
 */
import type { AbilityDef, CopyExcept, Modification } from '../types/ability';
import { alt, joinList, NoRenderer, withArticle } from './text';

const lower = (s: string): string => s.toLowerCase();

/** The copy-specific wording of one exception, or null when it has none. */
function phrase(m: Modification, quote?: (a: AbilityDef) => string, plural = false, elide = false, self = false): string | null {
  // r3-copy: `elide`, the words after the subject ("is a Mutant in addition to its other types", "has haste"), for a later exception of a list
  const it = (full: string, bare: string): string => (elide ? bare : full);
  switch (m.layer) {
    case 4: {
      const keys = Object.keys(m).filter((k) => k !== 'layer');
      if (keys.length === 1 && m.supertypes && !m.supertypes.add && !m.supertypes.set && m.supertypes.remove?.length === 1 && m.supertypes.remove[0] === 'Legendary') {
        // FAST5 T64: several tokens are copies at once, "except the tokens aren't legendary" (The Notary Hobbits)
        if (elide) return "isn't legendary"; // CR 205.4a
        return plural ? alt("the tokens aren't legendary", 'the tokens are not legendary') : alt("it isn't legendary", "it's not legendary"); // CR 205.4a
      }
      const onlyAdds = (t: typeof m.types): boolean => t === undefined || (t.set === undefined && t.remove === undefined && t.chosen === undefined && t.all === undefined && (t.add?.length ?? 0) > 0);
      if (keys.every((k) => k === 'types' || k === 'subtypes') && onlyAdds(m.types) && onlyAdds(m.subtypes)) {
        const words = [...(m.subtypes?.add ?? []), ...(m.types?.add ?? []).map(lower)];
        const isA = `${it("it's", 'is')} ${withArticle(words.join(' '))} in addition to its other`;
        // FAST5 T64 (CR 205.1b, 205.3m): only creature subtypes added, "in addition to its other creature types" (Mirror Room); a land or artifact subtype says "types"
        if (m.types === undefined && (m.subtypes?.add ?? []).length > 0) return alt(`${isA} types`, `${isA} creature types`);
        return `${isA} types`; // CR 205.1b
      }
      return null;
    }
    case '7b':
      return typeof m.power === 'number' && typeof m.toughness === 'number' ? `${it("it's", 'is')} ${m.power}/${m.toughness}` : null; // CR 613.4b
    case 6: {
      if (m.removeAll || m.remove || m.cantHave || !m.add || m.add.length === 0 || (!quote && m.add.some((a) => a.kind !== 'keyword'))) return null;
      // M6-10 (CR 707.9b, 113.1a): a quoted ability, `it has "When this creature becomes the target of a spell or ability, sacrifice it."` (Phantasmal Image)
      // r3-copy (CR 707.9a, 201.5): the object that becomes the copy is the card itself, which Oracle names "~" (a planeswalker's "he"): "except ~ has hexproof" (Oko, the Ringleader)
      return `${it(self ? alt('it has', '~ has') : 'it has', 'has')} ${joinList(m.add.map((a) => (a.kind === 'keyword' ? lower(a.text) : quote!(a))))}`;
    }
    default:
      return null;
  }
}

/**
 * CLOUD std-misc (CR 707.9b, 707.10): the text after "except" of a SPELL copy's exceptions, said of "the copy": "the copy isn't legendary", "the copy is an artifact in
 * addition to its other types", "the copy is a 1/1 Spirit in addition to its other types". Null for any other exception (the caller keeps the general wording).
 */
export function spellCopyExceptText(except: readonly CopyExcept[]): string | null {
  const mods = except.filter((x): x is Modification => 'layer' in x);
  if (mods.length !== except.length || mods.length === 0) return null;
  const only4 = mods.length === 1 && mods[0]!.layer === 4 ? mods[0] as Extract<Modification, { layer: 4 }> : null;
  if (only4 && only4.supertypes?.remove?.length === 1 && only4.supertypes.remove[0] === 'Legendary' && Object.keys(only4).length === 2 && Object.keys(only4.supertypes).length === 1) return "the copy isn't legendary"; // CR 205.4a
  const l4 = mods.filter((m): m is Extract<Modification, { layer: 4 }> => m.layer === 4);
  const l7 = mods.filter((m): m is Extract<Modification, { layer: '7b' }> => m.layer === '7b');
  if (l4.length !== 1 || l4.length + l7.length !== mods.length || l7.length > 1) return null;
  const m = l4[0]!;
  const adds = (t: typeof m.types): boolean => t === undefined || (Object.keys(t).length === 1 && (t.add?.length ?? 0) > 0);
  if (m.supertypes !== undefined || m.named !== undefined || !adds(m.types) || !adds(m.subtypes) || (m.types === undefined && m.subtypes === undefined)) return null;
  const p = l7[0];
  if (p !== undefined && (typeof p.power !== 'number' || typeof p.toughness !== 'number')) return null;
  const words = [...(p ? [`${p.power as number}/${p.toughness as number}`] : []), ...(m.subtypes?.add ?? []), ...(m.types?.add ?? []).map(lower)];
  return `the copy is ${withArticle(words.join(' '))} in addition to its other types`; // CR 205.1b
}

/**
 * The text after "except" of a token copy's exceptions (CR 707.9b): the copy wording when every exception has one (or the general continuous-effect wording
 * as an alternative), else the general wording alone. `general` renders a list of plain modifications as a continuous effect.
 */
function copyExceptTextM6(except: readonly CopyExcept[], general: (mods: Modification[]) => string, quote?: (a: AbilityDef) => string, noun?: string, plural = false, generalFirst = false, self = false): string {
  // MX2 (additive): "it doesn't copy that creature's color" and "it has this ability" (CR 707.9a, 707.9c), when the caller knows what the copied object is called
  if (except.some((x) => 'retain' in x || 'thisAbility' in x)) {
    const own = noun !== undefined ? retainThisText(except, noun, quote) : null;
    if (own === null) throw new NoRenderer('a copy exception that retains a value other than the color, or depends on a condition');
    return own;
  }
  const plainMods = except.filter((x): x is Modification => 'layer' in x);
  if (plainMods.length !== except.length) throw new NoRenderer('a copy exception that retains a value or depends on a condition');
  const creature = ptColorSubtype(plainMods);
  if (creature !== null) return creature;
  const added = ptColorTypesAdded(plainMods, quote);
  if (added !== null) return added;
  // r4-copy (CR 707.9b, 205.4a, 205.1b, 613.4b): "except it's not legendary and it's a 4/4 Hero in addition to its other types" (Ember Island Production): not legendary,
  // then a base power and toughness and added subtypes said as one noun phrase
  const notLegendary = plainMods.length === 3 && !plural ? plainMods.findIndex((m) => m.layer === 4 && Object.keys(m).length === 2 && m.supertypes !== undefined && Object.keys(m.supertypes).length === 1
    && m.supertypes.remove?.length === 1 && m.supertypes.remove[0] === 'Legendary') : -1;
  if (notLegendary >= 0) {
    const rest = plainMods.filter((_, i) => i !== notLegendary);
    const id = rest.some((m) => m.layer === '7b') && rest.some((m) => m.layer === 4) ? identityText(rest, 'it') : null;
    if (id !== null) return `${alt("it isn't legendary", "it's not legendary")} and ${id}`;
  }
  const phrases = plainMods.map((m) => phrase(m, quote, plural, false, self));
  if (phrases.some((p) => p === null)) return general(plainMods);
  // r3-copy (CR 707.9b): Oracle says the subject of a list of exceptions once, "except it isn't legendary, is a Reflection in addition to its other types, and has
  // haste" (The Apprentice's Folly, The Cloning of Shredder): the same exceptions, the later ones without "it"
  const elided = !plural && phrases.length > 1 ? plainMods.map((m, i) => (i === 0 ? phrase(m, quote) : phrase(m, quote, false, true))) : null;
  const own = elided !== null && elided.every((p) => p !== null) ? alt(joinList(phrases as string[]), joinList(elided as string[])) : joinList(phrases as string[]);
  let other: string;
  try {
    other = general(plainMods);
  } catch (e) {
    if (e instanceof NoRenderer) return own; // "it isn't legendary" has no general wording
    throw e;
  }
  // std-sos (CR 707.9b, 205.1b, 613.4b): a base power and toughness and added types said as one noun phrase, "except it's a 0/0 Fractal creature in addition to its other types" (Applied Geometry)
  const identity = plainMods.length === 2 && plainMods.some((m) => m.layer === '7b') && plainMods.some((m) => m.layer === 4) ? identityText(plainMods, 'it') : null;
  return alt(...(generalFirst ? [other, own] : [own, other]), ...(identity !== null ? [identity] : []));
}

/**
 * MX2 (additive; CR 707.9a, 707.9c): the exceptions "it doesn't copy that <noun>'s color" (`retain: ['colors']`) and "it has <keywords, quoted abilities> and
 * this ability" (`thisAbility`, granted keywords and quoted abilities of layer 6), in Oracle's order (Vesuvan Doppelganger, Cryptoplasm, Likeness Looter).
 * Null for any other exception, so the caller refuses the wording.
 */
export function retainThisText(except: readonly CopyExcept[], noun: string, quote?: (a: AbilityDef) => string): string | null {
  let color = false;
  let self = false;
  let keepName = false;
  const identity: Modification[] = [];
  const has: string[] = [];
  for (const x of except) {
    if ('retain' in x) {
      // FAST5 T64 (CR 707.9b-c): "except its name is X" keeps the copy's own name; the name is the card's own, said "~", with the pronoun of the object ("his name", "its name")
      if (x.retain.length === 1 && x.retain[0] === 'name') {
        if (keepName) return null;
        keepName = true;
        continue;
      }
      if (x.retain.length !== 1 || x.retain[0] !== 'colors' || color || noun === '') return null;
      color = true;
    } else if ('thisAbility' in x) {
      if (self) return null;
      self = true;
    } else if ('layer' in x && (x.layer === 4 || x.layer === '7b')) {
      identity.push(x); // FAST5 T64: "~ is a legendary 4/4 Human Villain creature in addition to ~'s other types"
    } else if ('layer' in x && x.layer === 6 && !x.removeAll && !x.remove && !x.cantHave && (x.add?.length ?? 0) > 0) {
      for (const a of x.add!) {
        if (a.kind === 'keyword') has.push(lower(a.text));
        else if (quote) has.push(quote(a));
        else return null;
      }
    } else return null;
  }
  if (self) has.push('this ability');
  // std-cardcopy-3 (CR 707.9b, 707.9a): "except it's 0/0 and has this ability" (Mimeoplasm, Revered One): a base power and toughness alone, then what it has, said
  // with one subject
  const only = identity.length === 1 && identity[0]!.layer === '7b' ? identity[0] as Extract<Modification, { layer: '7b' }> : undefined;
  if (only !== undefined && typeof only.power === 'number' && typeof only.toughness === 'number' && !keepName && !color && has.length > 0) {
    return `it's ${only.power}/${only.toughness} and has ${joinList(has)}`;
  }
  const who = keepName || identity.length > 0 ? alt('~', 'it') : 'it'; // a character card says "he" (Oracle's pronoun is read as "~", parser/front/selfref.ts), anything else "it"
  const id = identity.length > 0 ? identityText(identity, who) : null;
  if (identity.length > 0 && id === null) return null;
  const parts = [
    ...(keepName ? [alt("its name is ~", "~'s name is ~", "his name is ~", "her name is ~")] : []),
    ...(id !== null ? [id] : []),
    ...(color ? [`it doesn't copy that ${noun}'s color`] : []),
    ...(has.length > 0 ? [`${who} has ${joinList(has)}`] : []),
  ];
  return parts.length === 0 ? null : joinList(parts);
}

/**
 * FAST5 T64 (CR 707.9b, 205.1b): the copy exception that gives the copy an identity, "~ is a legendary Human Mercenary Villain creature" (every supertype, card
 * type and subtype set, Taskmaster) or "~ is a legendary 4/4 Human Villain creature in addition to ~'s other types" (all added, a base power and toughness
 * beside them, Absorbing Man). One way of the two (set or add) per exception, and exactly the layer 4 and 7b changes of those words; null for any other.
 */
function identityText(mods: readonly Modification[], who: string): string | null {
  const supers: string[] = [];
  const types: string[] = [];
  const subs: string[] = [];
  let pt: string | undefined;
  let how: 'set' | 'add' | undefined;
  for (const m of mods) {
    if (m.layer === '7b') {
      if (typeof m.power !== 'number' || typeof m.toughness !== 'number' || pt !== undefined) return null;
      pt = `${m.power}/${m.toughness}`;
    } else if (m.layer === 4) {
      for (const k of Object.keys(m)) {
        if (k === 'layer') continue;
        if (k !== 'supertypes' && k !== 'types' && k !== 'subtypes') return null;
        const tc = m[k]!;
        const kind = tc.set !== undefined ? 'set' : tc.add !== undefined ? 'add' : null;
        if (kind === null || Object.keys(tc).length !== 1 || (how !== undefined && how !== kind)) return null;
        how = kind;
        (k === 'supertypes' ? supers : k === 'types' ? types : subs).push(...(tc[kind] as string[]));
      }
    } else return null;
  }
  if (how === undefined) return null;
  const words = [...supers.map(lower), ...(pt !== undefined ? [pt] : []), ...subs, ...types.map(lower)];
  if (words.length === 0) return null;
  // p2-copy-perm-1 (CR 205.4a, 205.1b): a supertype alone is an adjective, "it's legendary in addition to its other types" (Sakashima the Impostor), no article
  const onlySupers = supers.length > 0 && types.length === 0 && subs.length === 0 && pt === undefined;
  const isA = onlySupers ? `${who} is ${words.join(' ')}` : `${who} is ${withArticle(words.join(' '))}`;
  if (how === 'set') return isA;
  const poss = alt("~'s", 'its');
  return types.length === 0 && pt === undefined ? alt(`${isA} in addition to ${poss} other types`, `${isA} in addition to ${poss} other creature types`) : `${isA} in addition to ${poss} other types`;
}

const COLOR_WORD: Readonly<Record<string, string>> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/**
 * M6-10 (CR 707.9b, 205.1b, 105.3): "except it's a 1/1 green Frog" (Croaking Counterpart): a base P/T, one color and one creature type that replace the copied ones,
 * said as one noun phrase. Exactly those three exceptions, or null.
 */
function ptColorSubtype(mods: readonly Modification[]): string | null {
  if (mods.length !== 3) return null;
  const pt = mods.find((m) => m.layer === '7b');
  const color = mods.find((m) => m.layer === 5);
  const type = mods.find((m) => m.layer === 4);
  if (!pt || !color || !type || pt.layer !== '7b' || color.layer !== 5 || type.layer !== 4) return null;
  if (typeof pt.power !== 'number' || typeof pt.toughness !== 'number') return null;
  const c = color.colors;
  if (Object.keys(c).length !== 1 || c.set?.length !== 1 || !COLOR_WORD[c.set[0]!]) return null;
  if (Object.keys(type).length !== 2 || !type.subtypes || Object.keys(type.subtypes).length !== 1 || type.subtypes.set?.length !== 1) return null;
  return `it's a ${pt.power}/${pt.toughness} ${COLOR_WORD[c.set[0]!]} ${type.subtypes.set[0]}`;
}

/**
 * r4-copy (CR 707.9b, 105.3, 205.1b, 613.4b): "except it's a 1/1 red Balloon creature in addition to its other colors and types and it has flying and haste" (The Jolly
 * Balloon Man): a base power and toughness, ONE color added, card types and subtypes added (said as one noun phrase, "in addition to its other colors and types"),
 * and optionally granted abilities. Exactly those exceptions, each once, or null.
 */
function ptColorTypesAdded(mods: readonly Modification[], quote?: (a: AbilityDef) => string): string | null {
  const pt = mods.filter((m) => m.layer === '7b');
  const color = mods.filter((m) => m.layer === 5);
  const type = mods.filter((m) => m.layer === 4);
  const has = mods.filter((m) => m.layer === 6);
  if (pt.length !== 1 || color.length !== 1 || type.length !== 1 || has.length > 1 || mods.length !== 3 + has.length) return null;
  const p = pt[0]!;
  const c = color[0]!;
  const t = type[0]!;
  if (p.layer !== '7b' || c.layer !== 5 || t.layer !== 4 || typeof p.power !== 'number' || typeof p.toughness !== 'number') return null;
  if (Object.keys(c).length !== 2 || Object.keys(c.colors).length !== 1 || c.colors.add?.length !== 1 || !COLOR_WORD[c.colors.add[0]!]) return null;
  const adds = (x: { add?: readonly string[] } | undefined): boolean => x !== undefined && Object.keys(x).length === 1 && (x.add?.length ?? 0) > 0;
  if (Object.keys(t).some((k) => k !== 'layer' && k !== 'types' && k !== 'subtypes') || !adds(t.types) || !adds(t.subtypes)) return null;
  const head = `it's ${withArticle(`${p.power}/${p.toughness} ${COLOR_WORD[c.colors.add[0]!]} ${[...t.subtypes!.add!, ...t.types!.add!.map(lower)].join(' ')}`)} in addition to its other colors and types`;
  if (has.length === 0) return head;
  const h = phrase(has[0]!, quote);
  return h === null ? null : `${head} and ${h}`;
}

/**
 * The text after "except" of a copy's exceptions (CR 707.9b): the wordings above, and (p2-copy-perm-1) the clause list that parser/holes/p2copyperm1.ts reads as an
 * alternative (`listText`), so a list of any of its clauses renders the way Oracle joins them.
 */
export function copyExceptText(except: readonly CopyExcept[], general: (mods: Modification[]) => string, quote?: (a: AbilityDef) => string, noun?: string, plural = false, generalFirst = false, self = false, listQuote = quote): string {
  // `listQuote`: how the clause list says a quoted ability, when the caller gives the wordings above none (a token copy, render/steps-zones.ts)
  const listed = listText(except, plural, listQuote, self);
  let base: string;
  try {
    base = copyExceptTextM6(except, general, quote, noun, plural, generalFirst, self);
  } catch (e) {
    if (e instanceof NoRenderer && listed !== null) return listed;
    throw e;
  }
  return listed === null ? base : alt(base, listed);
}

const TYPE_PLURAL: Readonly<Record<string, string>> = { sorcery: 'sorceries' };

/**
 * p2-copy-perm-1 (CR 707.9b): the exceptions as the clause list of parser/holes/p2copyperm1.ts, the inverse of that grammar: "its name is ~" (`retain: ['name']`,
 * first), "it isn't legendary" (CR 205.4a), "it's a [legendary] [N/N] [<subtypes>] [<card types>] in addition to its other types" (one layer 4 change of adds,
 * with the base power and toughness after it, CR 205.1b, 613.4b), "it's N/N", "it has <abilities>" [and this ability]; said of "it" or "~" (one object) or "they"
 * / "the tokens" (`plural`), a later clause with or without its subject, joined as Oracle joins a list. Null for any other exception.
 */
function listText(except: readonly CopyExcept[], plural: boolean, quote?: (a: AbilityDef) => string, self = false): string | null {
  type Clause = { kind: string; be?: string; neg?: string; has?: string; name?: true };
  const clauses: Clause[] = [];
  const seen = new Set<string>();
  const add = (c: Clause): boolean => { if (seen.has(c.kind)) return false; seen.add(c.kind); clauses.push(c); return true; };
  for (let i = 0; i < except.length; i++) {
    const x = except[i]!;
    if ('retain' in x) {
      if (plural || i !== 0 || x.retain.length !== 1 || x.retain[0] !== 'name' || !add({ kind: 'name', name: true })) return null;
      continue;
    }
    if ('thisAbility' in x) {
      // "has this ability" alone, or after/before the abilities of the clause next to it
      const prev = clauses[clauses.length - 1];
      if (prev !== undefined && prev.kind === 'has' && !seen.has('this')) { seen.add('this'); prev.has = `${prev.has!} and this ability`; continue; }
      if (!add({ kind: 'has', has: 'this ability' })) return null;
      seen.add('this');
      continue;
    }
    if (!('layer' in x)) return null;
    if (x.layer === 4) {
      const keys = Object.keys(x).filter((k) => k !== 'layer');
      const sup = x.supertypes;
      if (keys.length === 1 && sup !== undefined && Object.keys(sup).length === 1 && sup.remove?.length === 1 && sup.remove[0] === 'Legendary') {
        if (!add({ kind: 'notLegendary', neg: 'legendary' })) return null;
        continue;
      }
      const adds = (t: { add?: readonly string[] } | undefined): string[] | null => (t === undefined ? [] : Object.keys(t).length === 1 && (t.add?.length ?? 0) > 0 ? [...t.add!] : null);
      if (keys.some((k) => k !== 'supertypes' && k !== 'types' && k !== 'subtypes')) return null;
      const supers = adds(sup);
      const types = adds(x.types);
      const subs = adds(x.subtypes);
      if (supers === null || types === null || subs === null || supers.some((s) => s !== 'Legendary') || supers.length > 1) return null;
      if (supers.length + types.length + subs.length === 0) return null;
      const next = except[i + 1];
      const pt = next !== undefined && 'layer' in next && next.layer === '7b' && typeof next.power === 'number' && typeof next.toughness === 'number' ? `${next.power}/${next.toughness}` : null;
      if (pt !== null) i++;
      // CR 105.3: one color added, said in the noun phrase, "in addition to its other colors and types"
      const after = except[i + 1];
      const color = after !== undefined && 'layer' in after && after.layer === 5 && Object.keys(after).length === 2 && Object.keys(after.colors).length === 1 && after.colors.add?.length === 1 && COLOR_WORD[after.colors.add[0]!] ? COLOR_WORD[after.colors.add[0]!]! : null;
      if (color !== null) i++;
      if (color !== null && (plural || types.length + subs.length === 0)) return null;
      if (plural && (supers.length > 0 || types.length === 0)) return null;
      const typeWords = types.map(lower).map((t, k) => (plural && k === types.length - 1 ? TYPE_PLURAL[t] ?? `${t}s` : t));
      const words = [...supers.map(lower), ...(pt !== null ? [pt] : []), ...(color !== null ? [color] : []), ...subs, ...typeWords].join(' ');
      if (supers.length > 0 && types.length + subs.length === 0 && pt !== null) return null;
      const noun = plural || (supers.length > 0 && types.length + subs.length === 0) ? words : withArticle(words);
      const tail = color !== null ? 'in addition to its other colors and types' : plural ? 'in addition to their other types' : types.length === 0 && subs.length > 0 && supers.length === 0 ? alt('in addition to its other types', 'in addition to its other creature types') : 'in addition to its other types';
      if (!add({ kind: 'types', be: `${noun} ${tail}` })) return null;
      continue;
    }
    if (x.layer === '7b') {
      if (typeof x.power !== 'number' || typeof x.toughness !== 'number' || !add({ kind: 'pt', be: `${x.power}/${x.toughness}` })) return null;
      continue;
    }
    if (x.layer === 6) {
      if (x.removeAll || x.remove || x.cantHave || !x.add || x.add.length === 0) return null;
      const items: string[] = [];
      for (const a of x.add) {
        if (a.kind === 'keyword') items.push(lower(a.text));
        else if (quote) items.push(quote(a));
        else return null;
      }
      const prev = clauses[clauses.length - 1];
      if (prev !== undefined && prev.kind === 'has' && prev.has === 'this ability' && !seen.has('has+')) { seen.add('has+'); prev.has = `this ability and ${joinList(items)}`; continue; }
      if (!add({ kind: 'has', has: joinList(items) })) return null;
      continue;
    }
    return null;
  }
  if (clauses.length === 0) return null;
  // merge train 20261021T1953 (CR 707.9a, 201.5): "~" names the card itself, so it is a subject only when the card is what becomes the copy (`self`)
  const subj = plural ? ['they', 'the tokens'] : self ? ['it', '~', 'the token'] : ['it', 'the token'];
  const be = plural ? 'are' : 'is';
  const say = (c: Clause, first: boolean): string => {
    if (c.name) return alt('its name is ~', "~'s name is ~", 'his name is ~', 'her name is ~');
    const s = alt(...subj);
    if (c.neg !== undefined) {
      const isnt = plural ? "aren't" : "isn't";
      return first ? alt(`${s} ${isnt} ${c.neg}`, `${s} ${be} not ${c.neg}`) : alt(`${s} ${isnt} ${c.neg}`, `${s} ${be} not ${c.neg}`, `${isnt} ${c.neg}`, `${be} not ${c.neg}`);
    }
    if (c.has !== undefined) {
      const h = plural ? 'have' : 'has';
      return first ? `${s} ${h} ${c.has}` : alt(`${s} ${h} ${c.has}`, `${h} ${c.has}`);
    }
    return first ? `${s} ${be} ${c.be!}` : alt(`${s} ${be} ${c.be!}`, `${be} ${c.be!}`);
  };
  const parts = clauses.map((c, k) => say(c, k === 0));
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return alt(`${parts[0]} and ${parts[1]}`, `${parts[0]}, and ${parts[1]}`);
  return joinList(parts);
}
