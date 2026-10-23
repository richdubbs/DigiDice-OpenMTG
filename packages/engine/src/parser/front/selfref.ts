/**
 * Self reference (design 6.2 step 3, CR 201.5): the object's own names and "this <noun>" become "~" before anything else is parsed.
 *
 * In order of precedence: the literal CARDNAME; the face's full name; its shortened names (CR 201.5c, below); the names of the other faces of the same card
 * (CR 201.5b); "this <noun>" where noun is one of the face's types or subtypes. Only whole-word matches, case-sensitive for names. Names are compared as
 * normalized text (CR 201.2): the face name and the other faces' names go through the same normalization as the Oracle text.
 *
 * Shortened names (CR 201.5c). A legendary card or a planeswalker is known by the part of its name before the comma ("Bruna, the Fading Light" -> "Bruna"),
 * before " the " / " of " ("Acererak the Archlich" -> "Acererak"), by its first word ("Ajani Vengeant" -> "Ajani") or by a title and its last word
 * ("Captain James T. Kirk" -> "Captain Kirk"). Any other card is known by the part before a comma only. A short name that is followed by another capitalized
 * word ("Marit Lage", "Syr Saxon") or by "the" / "of" and one ("Tuktuk the Returned") is the start of a different name and stays as it is. A short name is never a word the rules already use
 * (card type, subtype, color, keyword), except a planeswalker's own planeswalker type, and it is not taken where it starts a longer card name of the index
 * ("meld them into Mishra, Lost to Phyrexia" is not "~, Lost to Phyrexia").
 *
 * A name that is also a creature type ("Aurochs", "Coward", "Assembly-Worker") is a type word, not the object, where the text puts it in a type position
 * ("each other attacking Aurochs", "becomes a Coward", "target Assembly-Worker creature"): those occurrences are left as they are (CR 205.3m vs 201.5).
 *
 * Scopes (CR 201.5a): outside quotes everything above applies. Inside a quoted ability `this <noun>` is the object that HAS the quoted ability (a sub-stream
 * with a fresh self scope), so any object noun counts; the OUTER card's name is left alone there, because inside the quote it names a different object.
 * "named X" is never a self reference: it compares names (CR 201.2).
 *
 * Pronouns of a named character (FAST5 T49): a legendary creature or planeswalker is written about as a person ("When Jet enters, he deals ...", "put a +1/+1
 * counter on him", "his power"). "he" / "him" / "his" outside quotes is the object itself when the SAME LINE already named it (a name, a short name, "this
 * <noun>") earlier, because then the line has no other candidate the Oracle wording could mean; it becomes "~" ("his" becomes "~'s"). A line that has not named the
 * object yet, and a quoted ability, keep the word (it stays an unknown word and the sentence is manual). Since FAST5X E24 a whole face first uses E24's
 * unique-candidate rule (pronounRefs below, design 6.4); this rule then reads what that leaves, on a line with no second candidate (findSelfRefs).
 */
import type { LexiconIndex } from './lexicon-index';
import { firstWordOf, nameIndex, normalizeName } from './names';
import { insideAny, type QuoteSpan } from './quotes';
import type { FaceContext, SelfRef, SelfVia } from './types';

/** The word after "this <noun>" that makes it something else ("this turn", "this combat phase", "this ability"). Design 6.2. */
const NOT_SELF_NEXT = new Set(['turn', 'way', 'combat', 'game', 'step', 'phase', 'ability']);

/** Nouns that are never an object ("this turn" has no noun in this table anyway, but "this mana", "this effect" must stay words). The emblem has the quoted ability (CR 114). */
const GENERIC_OBJECT_NOUNS = ['permanent', 'token', 'card', 'spell', 'emblem'];

/** Words before a name that make a type word of it ("a Coward", "each other attacking Aurochs", "target Assembly-Worker", "a red Lizard"). */
const TYPE_BEFORE = new Set(['a', 'an', 'other', 'another', 'each', 'attacking', 'blocking', 'target', 'all', 'every', 'no', 'any', 'tapped', 'untapped']);
/** Words after a name that make a type word of it ("Coward creature", "Aurochs cards", "Coward you control"). */
const TYPE_AFTER = new Set(['creature', 'creatures', 'card', 'cards', 'token', 'tokens', 'permanent', 'permanents', 'spell', 'spells', 'you', 'your', 'planeswalker', 'planeswalkers']);

/** Titles that a name may start with and that are kept in its short form ("Captain Kirk"). */
const TITLES = new Set(['Dr.', 'Captain', 'Commander', 'Lord', 'Lady', 'King', 'Queen', 'General', 'Admiral', 'Doctor', 'Professor', 'Sir', 'Chief', 'Agent']);
/** First words that are not a name. */
const NOT_A_NAME = new Set(['The', 'A', 'An', 'Of', 'And', 'Or', 'To', 'In', 'On']);

/** The short name before the comma of a name ("Bruna, the Fading Light" -> "Bruna"). */
export function shortName(full: string): string | undefined {
  const i = full.indexOf(', ');
  return i > 0 ? full.slice(0, i) : undefined;
}

/** Nouns that "this <noun>" may have in the OUTER scope: the types and subtypes of this face (design 6.2). */
export function outerNouns(ctx: FaceContext): Set<string> {
  const nouns = new Set<string>();
  for (const t of ctx.types) nouns.add(t);
  for (const t of ctx.subtypes) nouns.add(t);
  nouns.add('card'); // "discard this card", "return this card from your graveyard"
  nouns.add('spell'); // "this spell costs {1} less": 442 permanent faces say it, and it is always the spell that is this card (deviation from design 6.2, see the report)
  if (ctx.types.some((t) => t !== 'instant' && t !== 'sorcery')) nouns.add('permanent');
  if (ctx.isToken) nouns.add('token');
  if (ctx.subtypes.includes('room')) nouns.add('door'); // a Room's halves say "this door" (CR 709.5? 721)
  return nouns;
}

/** Nouns that "this <noun>" may have INSIDE a quoted ability: any kind of object. */
export function quoteNouns(ix: LexiconIndex): ReadonlySet<string> {
  let nouns = quoteNounCache.get(ix);
  if (!nouns) {
    const set = new Set<string>(GENERIC_OBJECT_NOUNS);
    for (const t of ix.cardTypes) set.add(t);
    for (const t of ix.nonCreatureSubtypes) set.add(t);
    quoteNounCache.set(ix, (nouns = set));
  }
  return nouns;
}
const quoteNounCache = new WeakMap<LexiconIndex, ReadonlySet<string>>();

/** A word the rules already use: a name that is one of these is not a short name (a type word, a color, a keyword). */
function isRulesWord(ix: LexiconIndex, word: string): boolean {
  const w = word.toLowerCase();
  return ix.cardTypes.has(w) || ix.supertypes.has(w) || ix.colors.has(w) || ix.subtypes.has(w) || ix.keywordNames.has(w) || NOT_A_NAME.has(word);
}

/** Lower-case planeswalker types (CR 205.3j) that are no other kind of subtype, card type, supertype, color or keyword. */
function pureCharacterTypes(ix: LexiconIndex): ReadonlySet<string> {
  let set = characterTypeCache.get(ix);
  if (!set) {
    const pw = new Set<string>();
    const other = new Set<string>();
    for (const s of ix.lexicon.subtypes) for (const w of [s.singular, s.plural]) (s.class === 'planeswalker' ? pw : other).add(w.toLowerCase());
    set = new Set([...pw].filter((w) => !other.has(w) && !ix.cardTypes.has(w) && !ix.supertypes.has(w) && !ix.colors.has(w) && !ix.keywordNames.has(w)));
    characterTypeCache.set(ix, set);
  }
  return set;
}
const characterTypeCache = new WeakMap<LexiconIndex, ReadonlySet<string>>();

/** The shortened forms of the face's name that CR 201.5c lets the card use for itself, most specific first. */
export function shortNames(ctx: FaceContext, ix: LexiconIndex): string[] {
  const full = normalizeName(ctx.name);
  const known = ctx.supertypes.includes('legendary') || ctx.types.includes('planeswalker');
  const out: string[] = [];
  // FAST5 T58: a planeswalker type is the name of a character (CR 205.3j). On a legendary card without a comma in its name ("Kiora of Fire and Ashes",
  // "Gideon the Oathless") the short name before " the " / " of ", or the first word, that is such a type is the character, the card itself (CR 201.5c),
  // as E24 already reads it before a comma. Type positions ("Gideon planeswalker", "another Kiora") stay types (typePosition). Creature types are not
  // taken here: without a comma ("Sliver Queen") the first word is the type the card is about.
  const characterType = (cand: string): boolean => known && pureCharacterTypes(ix).has(cand.toLowerCase());
  const add = (cand: string | undefined, ownPlaneswalkerType = false): void => {
    if (!cand || cand === full || cand.length < 3 || !/^\p{Lu}/u.test(cand) || out.includes(cand)) return;
    if (isRulesWord(ix, cand) && !(ownPlaneswalkerType && ((ctx.types.includes('planeswalker') && ctx.subtypes.includes(cand.toLowerCase())) || characterType(cand)))) return;
    out.push(cand);
  };
  const comma = shortName(full);
  // FAST5X E24: a legendary character's short name that is also a subtype ("Huatli, Poet of Unity", "Kaito, Bane of Nightmares", "Wolverine, Fierce
  // Fighter") is the character (CR 201.5c); its type positions ("a Wolverine", "Huatli planeswalker") stay types (typePosition, CR 205.3m)
  if (comma && known && ix.subtypes.has(comma.toLowerCase()) && !ix.cardTypes.has(comma.toLowerCase()) && !ix.keywordNames.has(comma.toLowerCase())) {
    if (comma.length >= 3 && /^\p{Lu}/u.test(comma) && !out.includes(comma)) out.push(comma);
  } else add(comma);
  if (!known || comma) return out;
  // No comma: "Acererak the Archlich", "Ajani Vengeant", "Captain James T. Kirk".
  const words = full.split(' ');
  const cut = words.findIndex((w, i) => i > 0 && (w === 'the' || w === 'of'));
  if (cut > 0) add(words.slice(0, cut).join(' '), true);
  if (words.length >= 2 && TITLES.has(words[0]!)) {
    if (words.length >= 3) add(`${words[0]} ${words[words.length - 1]}`);
  } else if (words.length >= 2 && !full.includes("'")) {
    add(words[0], true); // not for "Marit Lage's Slumber": a thing of Marit Lage, not a person called Marit
  }
  return out;
}

interface Candidate {
  start: number;
  end: number;
  via: SelfVia;
  scope: 'face' | 'quote';
  as?: string;
  mark?: '¤';
}

/*
 * Gendered pronouns (FAST5X E24; CR 201.5, design 6.4). Characters printed on legendary cards are "he" or "she" in Oracle text ("Put a +1/+1 counter on
 * Abomination. He fights up to one target creature"; "return her to the battlefield under her owner's control"). Such a pronoun means the object itself,
 * exactly as the card's name does (CR 201.5), when the card has ONE candidate antecedent. Design 6.4's unique-candidate rule decides it for the whole face:
 *   - the face is legendary (every one of the 150 faces of the index whose Oracle text uses such a pronoun outside reminder text is a legendary character;
 *     the 5 other cards use them for a player or another object: "he or she controls", "her controller" of a Liliana);
 *   - the face refers to itself outside quotes (its name, short name, another face's name or "this card", CR 201.5), and its name is one character
 *     (not "Raph & Leo");
 *   - nothing else in the face's text can be a character: no capitalized word outside a sentence start, a label, a quote or a self reference that is not
 *     a rules word (type, subtype, color, keyword, ability word), so "Raph and Leo", "Her Majesty" or "a card named Monk of the Open Hand" make the face
 *     keep its pronouns (they stay unknown words, manual);
 *   - the pronouns agree in gender (both genders: two characters), and the old player wordings "he or she", "his or her", "him or her" are not there.
 * Inside a quoted ability the pronoun is left alone (the quote is a sub-stream with its own scope, CR 201.5a): it stays manual.
 * What the parse text gets (same length, so offsets do not move): he, she, him and object her -> "~"; his and possessive her -> "~'s" ("her power",
 * "his owner's"); he's -> "~ is", she's -> " ~ is". "himself", "herself" and "hers" are never replaced.
 */

/**
 * The nouns after "her" that make it a possessive ("her power", "her owner's control", "her sneak cost", "her loyalty abilities"); before anything else "her"
 * is an object ("return her to", "a counter on her for each", "have her deal 2 damage"). A closed list (every possessive "her" of the index's legendary faces):
 * an unlisted noun leaves "her" an object, and the sentence then fails to parse rather than read wrong.
 */
const HER_POSSESSED = new Set([
  'power', 'toughness', 'owner', "owner's", 'controller', "controller's", 'name', 'other', 'sneak', 'additional', 'loyalty', 'mana', 'text', 'combat',
]);
const MASCULINE = new Set(['he', 'him', 'his', "he's"]);
const FEMININE = new Set(['she', 'her', "she's"]);
const PRONOUN_RE = /(?<![\p{L}\p{N}'-])(he's|she's|he|him|his|she|her)(?![\p{L}\p{N}-]|'[\p{L}])/giu;

/** A word the rules already use, in the singular or a plural form ("Heroes", "Treasures", "Dwarves"). */
function rulesWordAnyNumber(ix: LexiconIndex, word: string): boolean {
  const lower = word.toLowerCase().replace(/'s?$/, '');
  const forms = [lower, lower.replace(/s$/, ''), lower.replace(/es$/, ''), lower.replace(/ies$/, 'y'), lower.replace(/ves$/, 'f')];
  return forms.some((x) => ix.cardTypes.has(x) || ix.supertypes.has(x) || ix.colors.has(x) || ix.subtypes.has(x) || ix.keywordNames.has(x) || ix.abilityWords.has(x));
}

/** The capitalized words of `text` that could name another character (design 6.4: a second candidate antecedent). */
export function otherNameWords(text: string, ix: LexiconIndex, skip: (pos: number) => boolean): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}'-])(\p{Lu}[\p{L}\p{N}'-]*)/gu)) {
    const at = m.index!;
    if (skip(at)) continue;
    if (text[at - 1] === '{' || text[at - 1] === '/') continue; // a mana or tap symbol ("{U}", "{R/W}")
    const w = m[1]!;
    const lineStart = text.lastIndexOf('\n', at - 1) + 1;
    const nl = text.indexOf('\n', at);
    const line = text.slice(lineStart, nl < 0 ? text.length : nl);
    const before = text.slice(lineStart, at).replace(/\s+$/, '');
    // a sentence start: the start of a line, after a period, colon, dash, bullet or an opening quote
    if (before === '' || /(?:[.:•"]|--)$/.test(before)) continue;
    // an item of a cost list ("{2}, Sacrifice another creature: ...")
    if (before.endsWith(',') && !before.includes('.') && line.slice(at - lineStart).includes(':')) continue;
    // a label ("Unbreakable Skin -- ...", "Power-up -- {4}{G}: ...")
    const dash = line.indexOf('--');
    if (dash > at - lineStart && !/[.:"]/.test(line.slice(0, dash))) continue;
    if (/^(?:X|[IVX]+)$/.test(w)) continue;
    if (rulesWordAnyNumber(ix, w)) continue;
    out.push(w);
  }
  return out;
}

/**
 * The gendered pronouns of a face that mean the object itself (see the comment above), or none. `refs` are the name references already found, `text`
 * the parse text before "~" (reminder text blanked).
 */
export function pronounRefs(text: string, ctx: FaceContext, ix: LexiconIndex, quoteSpans: readonly QuoteSpan[], refs: readonly Candidate[]): Candidate[] {
  if (!ctx.supertypes.includes('legendary')) return [];
  // one character: a name with "&" or "and" is two ("Raph & Leo"); the object must be referred to outside quotes (its name or "this card")
  if (/ (?:&|and) /.test(ctx.name) || !refs.some((r) => r.scope === 'face')) return [];
  if (/\b(?:he or she|she or he|his or her|her or his|him or her|her or him)\b/i.test(text)) return [];
  const inRef = (pos: number): boolean => refs.some((r) => pos >= r.start && pos < r.end);
  const inQuote = (pos: number): boolean => insideAny(quoteSpans, pos) || quoteSpans.some((q) => pos === q.open || pos === q.close);
  const found: Candidate[] = [];
  const genders = new Set<string>();
  for (const m of text.matchAll(PRONOUN_RE)) {
    const at = m.index!;
    if (inQuote(at) || inRef(at)) continue;
    const word = m[1]!;
    const lower = word.toLowerCase();
    genders.add(MASCULINE.has(lower) ? 'm' : FEMININE.has(lower) ? 'f' : '?');
    const end = at + word.length;
    let as: string;
    if (lower === "he's") as = '~ is';
    else if (lower === "she's") as = ' ~ is';
    else if (lower === 'his') as = "~'s";
    else if (lower === 'her') {
      const next = /^ (\p{L}[\p{L}'-]*)/u.exec(text.slice(end, end + 30));
      const possessive = next !== null && HER_POSSESSED.has(next[1]!);
      as = possessive ? "~'s" : '  ~';
    } else as = `${' '.repeat(word.length - 1)}~`;
    found.push({ start: at, end, via: 'pronoun', scope: 'face', as });
  }
  if (found.length === 0 || genders.size !== 1) return [];
  // Another capitalized word that may name a character (a capitalized pronoun inside a sentence, "Whenever Her Majesty attacks", is one): two candidates.
  if (otherNameWords(text, ix, (pos) => inQuote(pos) || inRef(pos)).length > 0) return [];
  return found;
}

const PLURAL_PRONOUN_RE = /(?<![\p{L}\p{N}'-])(they're|they|them)(?![\p{L}\p{N}-]|'[\p{L}])/giu;
/** A verb of a plural subject right after the name ("When Ran and Shaw enter", "Whenever Tui and La become tapped"). */
const PLURAL_VERB_AFTER = /^ (?:enter|die|attack|leave|become|deal|are|have|get|gain|block)(?![\p{L}\p{N}'-])/u;
/** The singular form of the same verbs: a face that uses one has a name that is singular. */
const SINGULAR_VERB_AFTER = /^ (?:enters|dies|attacks|leaves|becomes|deals|is|has|gets|gains|blocks)(?![\p{L}\p{N}'-])/u;

/**
 * FAST5 T64: the plural pronouns of a face whose name is plural ("The Notary Hobbits", "Ran and Shaw"): "When Ran and Shaw enter, if you cast them" means the
 * object itself, as "he" and "she" do for a character (pronounRefs). Design 6.4's unique-candidate rule, narrowly: the face is legendary, the object is
 * referred to outside quotes, it takes a plural verb ("enter", "die") and never a singular one, no player is named anywhere (a "they" of "each opponent exiles
 * cards until they exile a nonland card" is a player, Oracle's singular they), no "their" or "themselves" stands (those stay ambiguous), and no other name
 * could be a second candidate. What the parse text gets: they, them -> "~"; they're -> "~ is" (the same length, so offsets do not move).
 */
export function pluralPronounRefs(text: string, ctx: FaceContext, ix: LexiconIndex, quoteSpans: readonly QuoteSpan[], refs: readonly Candidate[]): Candidate[] {
  if (!ctx.supertypes.includes('legendary')) return [];
  const names = refs.filter((r) => r.scope === 'face' && r.via !== 'pronoun');
  if (names.length === 0) return [];
  const inQuote = (pos: number): boolean => insideAny(quoteSpans, pos) || quoteSpans.some((q) => pos === q.open || pos === q.close);
  const verbAfter = (re: RegExp): boolean => names.some((r) => !inQuote(r.start) && re.test(text.slice(r.end, r.end + 16)));
  if (!verbAfter(PLURAL_VERB_AFTER) || verbAfter(SINGULAR_VERB_AFTER)) return [];
  const outside = text.split('').map((c, i) => (inQuote(i) ? ' ' : c)).join('');
  if (/\b(?:players?|opponents?|their|theirs|themselves|those)\b/i.test(outside)) return [];
  const inRef = (pos: number): boolean => refs.some((r) => pos >= r.start && pos < r.end);
  const found: Candidate[] = [];
  for (const m of text.matchAll(PLURAL_PRONOUN_RE)) {
    const at = m.index!;
    if (inQuote(at) || inRef(at)) continue;
    const word = m[1]!;
    found.push({ start: at, end: at + word.length, via: 'pronoun', scope: 'face', as: word.toLowerCase() === "they're" ? '   ~ is' : `${' '.repeat(word.length - 1)}~` });
  }
  if (found.length === 0) return [];
  if (otherNameWords(text, ix, (pos) => inQuote(pos) || inRef(pos)).length > 0) return [];
  return found;
}

/**
 * Finds the self references of `text` (the normalized text with reminder text already blanked). `quoteSpans` are the quoted abilities of the whole text.
 * `cardNames` (optional) lets a short name yield to a longer card name that starts with it. `opts.pronouns` (FAST5X E24) adds the gendered pronouns that
 * mean the object (pronounRefs; the whole face text only, never a reminder alone). Returns non-overlapping references ordered by position.
 */
export function findSelfRefs(text: string, ctx: FaceContext, ix: LexiconIndex, quoteSpans: readonly QuoteSpan[], cardNames?: ReadonlySet<string>, opts: { pronouns?: boolean } = {}): SelfRef[] {
  const found: Candidate[] = [];
  const named = (pos: number): boolean => /\bnamed\s+$/.test(text.slice(Math.max(0, pos - 12), pos));
  const inQuote = (pos: number): boolean => insideAny(quoteSpans, pos);
  const names = cardNames ? nameIndex(cardNames) : undefined;
  const faceName = normalizeName(ctx.name);

  const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  /** The text puts the name in a type position: it is the creature type that happens to be the name (CR 205.3m). */
  const typePosition = (at: number, end: number): boolean => {
    if (text[at - 1] === '-') return true; // "non-Coward"
    const before = /([\p{L}'-]+)\s+$/u.exec(text.slice(Math.max(0, at - 24), at));
    const after = /^\s+([\p{L}'-]+)/u.exec(text.slice(end, end + 24));
    const prev = before?.[1]!.toLowerCase();
    const next = after?.[1]!.toLowerCase();
    // std-rw9, std-ra's reading (CR 201.5c, 115.1): "Equip abilities you activate that target Cloud cost {2} less to activate": after "that", "target" is the verb,
    // and a verb's object without an article is a name, never a type word (a type would read "that target a Cloud"); "target" as an adjective ("target Goblin")
    // stays a type
    if (prev === 'target' && /\bthat\s+target\s+$/i.test(text.slice(Math.max(0, at - 16), at)) && (next === undefined || !TYPE_AFTER.has(next))) return false;
    return (prev !== undefined && (TYPE_BEFORE.has(prev) || ix.colors.has(prev))) || (next !== undefined && TYPE_AFTER.has(next));
  };
  /** A longer card name of the index (not this face's) starts here: the short name is part of it. */
  const startsLongerName = (at: number, name: string): boolean => {
    for (const n of names?.byFirstWord.get(firstWordOf(text.slice(at, at + 60))) ?? []) {
      if (n !== faceName && n.length > name.length && text.startsWith(n, at) && !isWord(text[at + n.length])) return true;
    }
    return false;
  };
  /** A capitalized word follows ("Marit Lage", "Syr Saxon") or "the" / "of" and one ("Tuktuk the Returned"): the short name is the start of another name. */
  const startsOtherName = (end: number): boolean => /^ (?:(?:the|of) )?\p{Lu}/u.test(text.slice(end, end + 8));
  const addName = (name: string | undefined, via: SelfVia, short = false): void => {
    if (!name) return;
    const asType = ix.subtypes.has(name.toLowerCase());
    for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
      const end = at + name.length;
      // Whole words only: no letter or digit on either side.
      if (isWord(text[at - 1]) || isWord(text[end])) continue;
      if (inQuote(at) || named(at)) continue;
      if (asType && typePosition(at, end)) continue;
      if (short && (startsLongerName(at, name) || startsOtherName(end))) continue;
      found.push({ start: at, end, via, scope: 'face' });
    }
  };
  addName('CARDNAME', 'cardname');
  addName(faceName, 'name');
  // r4-static (CR 201.5a): inside a quoted ability the outer card's full name is the object whose ability grants the quoted one (the
  // Equipment of "Equipped creature has "{T}, Sacrifice Blazing Torch: ..."", parser/holes/object.ts reads the GRANTOR token as `{ref:'grantor'}`); the lint
  // refuses that reference anywhere but inside an ability a static ability grants (model/lint-nodes.ts)
  if (faceName) for (let at = text.indexOf(faceName); at >= 0; at = text.indexOf(faceName, at + 1)) {
    const end = at + faceName.length;
    if (isWord(text[at - 1]) || isWord(text[end]) || !inQuote(at) || named(at)) continue;
    found.push({ start: at, end, via: 'grantor', scope: 'quote', mark: '¤' });
  }
  for (const s of shortNames(ctx, ix)) addName(s, 'short-name', true);
  for (const other of ctx.otherNames) addName(normalizeName(other), 'other-face');

  const outer = outerNouns(ctx);
  const quoted = quoteNouns(ix);
  const thisRe = /(?<![\p{L}\p{N}])[Tt]his\s+([\p{L}-]+)(?![\p{L}\p{N}-])(?=(?:\s+([\p{L}-]+))?)/gud;
  for (const m of text.matchAll(thisRe)) {
    const noun = m[1]!.toLowerCase();
    const after = (m[2] ?? '').toLowerCase();
    const start = m.index!;
    const scope: 'face' | 'quote' = inQuote(start) ? 'quote' : 'face';
    if (!(scope === 'quote' ? quoted : outer).has(noun)) continue;
    if (NOT_SELF_NEXT.has(after)) continue;
    // The reference ends with the noun, not with the following word.
    const nounEnd = m.indices![1]![1];
    found.push({ start, end: nounEnd, via: 'this-noun', scope });
  }

  // r5-fxb (CR 201.5, 201.5a): a quoted ability the object grants to ITSELF ("Iron Fist gains \"{T}: Iron Fist deals damage equal to his power to any
  // other target\" until end of turn", "Ms. Marvel gains \"Ms. Marvel's base power is ...\""): the object that has the quoted ability is the object the outer
  // name means, so inside that quote its name and short names are "~" too, and so is a "he" / "him" / "his" after one of them in the same quote
  // std-rx32 (CR 201.5a, 608.2c): also "If Kellan is a Scout, it becomes a Human Faerie Detective and gains "Whenever Kellan deals ..."" (Kellan, Planar Trailblazer):
  // in one sentence that names the object, then says "it becomes ... and gains" with no other noun phrase that "it" could be, the quote is granted to the object
  const selfQuotes = quoteSpans.filter((q) => found.some((c) => c.scope === 'face' && c.via !== 'pronoun'
    && (/^\s+(?:gains|has)\s+$/.test(text.slice(c.end, q.open)) || /^ is an? [A-Z][\p{L}-]*, it becomes an? [^.,"]* and gains $/u.test(text.slice(c.end, q.open)))));
  for (const q of selfQuotes) {
    const inside: Candidate[] = [];
    for (const name of [faceName, ...shortNames(ctx, ix)]) {
      if (!name) continue;
      for (let at = text.indexOf(name, q.open + 1); at >= 0 && at < q.close; at = text.indexOf(name, at + 1)) {
        const end = at + name.length;
        if (end > q.close || isWord(text[at - 1]) || isWord(text[end]) || named(at)) continue;
        inside.push({ start: at, end, via: 'name', scope: 'quote' });
      }
    }
    if (inside.length === 0) continue;
    const first = Math.min(...inside.map((c) => c.start));
    const span = text.slice(q.open, q.close);
    if (!/(?<![\p{L}\p{N}'-])(?:she|her|she's)(?![\p{L}\p{N}-])/iu.test(span)) {
      for (const m of span.matchAll(/(?<![\p{L}\p{N}'-])(?:[Hh]e|[Hh]im|[Hh]is)(?![\p{L}\p{N}'-])/gu)) {
        const at = q.open + m.index!;
        if (at > first) inside.push({ start: at, end: at + m[0].length, via: 'pronoun', scope: 'quote', ...(m[0].toLowerCase() === 'his' ? { as: "~'s" } : {}) });
      }
    }
    found.push(...inside);
  }

  // Gendered pronouns (FAST5 batch 5 merge of FAST5X E24 and FAST5 T49). First, on the whole face (opts.pronouns), design 6.4's unique-candidate rule of E24
  // (pronounRefs, the comment above it). Then T49's line-local rule (the header) for the pronouns E24 leaves (E24 refuses the whole face when any other
  // capitalized word could be a character, "The Ring tempts you" included), with E24's ambiguity tests applied to the LINE: no other word of the line that
  // could name a character ("Whenever Bruno or Marco attacks, he deals ..." keeps "he"), no feminine pronoun and no "he or she" wording on the line, and a
  // name that is one character (not "Raph & Leo").
  // FAST5 T64: and the plural pronouns of a named pair of characters (pluralPronounRefs)
  if (opts.pronouns) found.push(...pronounRefs(text, ctx, ix, quoteSpans, found), ...pluralPronounRefs(text, ctx, ix, quoteSpans, found));
  // Pronouns of a named character: only after the same line has named the object (see the header).
  if (ctx.supertypes.includes('legendary') && (ctx.types.includes('creature') || ctx.types.includes('planeswalker')) && !/ (?:&|and) /.test(ctx.name)) {
    const named = found.filter((c) => c.scope === 'face' && c.via !== 'pronoun').map((c) => c.start);
    const taken = new Set(found.filter((c) => c.via === 'pronoun').map((c) => c.start));
    const nameRefs = found.filter((c) => c.via !== 'pronoun');
    const inRef = (pos: number): boolean => nameRefs.some((r) => pos >= r.start && pos < r.end);
    const quoteEdge = (pos: number): boolean => inQuote(pos) || quoteSpans.some((q) => pos === q.open || pos === q.close);
    const lineOk = new Map<number, boolean>();
    const clearLine = (lineStart: number): boolean => {
      let ok = lineOk.get(lineStart);
      if (ok === undefined) {
        const nl = text.indexOf('\n', lineStart);
        const lineEnd = nl < 0 ? text.length : nl;
        const line = text.slice(lineStart, lineEnd);
        ok = !/(?<![\p{L}\p{N}'-])(?:she|her|she's)(?![\p{L}\p{N}-])/iu.test(line)
          && !/\b(?:he or she|she or he|his or her|her or his|him or her|her or him)\b/i.test(line)
          && otherNameWords(text, ix, (pos) => pos < lineStart || pos >= lineEnd || quoteEdge(pos) || inRef(pos)).length === 0;
        lineOk.set(lineStart, ok);
      }
      return ok;
    };
    for (const m of text.matchAll(/(?<![\p{L}\p{N}'-])(?:[Hh]e|[Hh]im|[Hh]is)(?![\p{L}\p{N}'-])/gu)) {
      const at = m.index!;
      if (inQuote(at) || taken.has(at)) continue;
      const lineStart = text.lastIndexOf('\n', at) + 1;
      if (!named.some((n) => n >= lineStart && n < at) || !clearLine(lineStart)) continue;
      // "his" is a possessive: "~'s" has the same length, so offsets still do not move.
      found.push({ start: at, end: at + m[0].length, via: 'pronoun', scope: 'face', ...(m[0].toLowerCase() === 'his' ? { as: "~'s" } : {}) });
    }
  }

  // Earliest first, longest first; an overlapped candidate is dropped.
  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: SelfRef[] = [];
  let last = -1;
  for (const c of found) {
    if (c.start < last) continue;
    out.push({ range: [c.start, c.end], via: c.via, scope: c.scope, text: text.slice(c.start, c.end), ...(c.as !== undefined ? { as: c.as } : {}), ...(c.mark !== undefined ? { mark: c.mark } : {}) });
    last = c.end;
  }
  return out;
}

/**
 * The parse text with every self reference replaced by "~" at the LAST character of the replaced words, spaces before it, so that offsets do not move and
 * a possessive stays attached ("This token's" becomes "         ~'s", never "~         's", which would look like an opening quote).
 */
export function applySelfRefs(text: string, refs: readonly SelfRef[]): string {
  if (refs.length === 0) return text;
  const parts: string[] = [];
  let at = 0;
  for (const r of refs) {
    parts.push(text.slice(at, r.range[0]), r.as ?? `${' '.repeat(r.range[1] - r.range[0] - 1)}${r.mark ?? '~'}`);
    at = r.range[1];
  }
  parts.push(text.slice(at));
  return parts.join('');
}
