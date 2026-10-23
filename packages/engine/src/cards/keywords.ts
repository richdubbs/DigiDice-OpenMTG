/**
 * The keyword-line compiler (milestone 4, folded into the general parser in milestone 5).
 *
 * A line of Oracle text that consists only of keywords ("Flying", "First strike, lifelink", "Protection from black and from red",
 * "Toxic 1", "Enchant creature you control") compiles into KeywordAbilityDefs that the rules code reads through getChars(...).keywords.
 * The engine never inspects Oracle text at runtime.
 *
 * Only keywords the engine really implements are compiled (AUTOMATED_KEYWORDS). A keyword it recognizes from the official list
 * (CR 702, keyword-list.ts) but does not implement yet, or one with a parameter it cannot test, is left in the line as text:
 * the compiler returns it as `leftover`, so the card stays `partial` / `manual` and the game warns about it. A card is
 * therefore `full` only when every line compiled, never because a keyword was recognized.
 */
import type { KeywordAbilityDef, ObjectFilter } from '../types/ability';
import type { Color } from '../types/mana';
import type { CardType } from '../types/card';
import { CARD_TYPES } from '../types/card';
import { parseQuality, pluralForms } from '../rules/quality';
import { GENERATED_LEXICON } from '../parser/preprocess';
import { KEYWORD_RULES } from './keyword-list';

/** Keywords the engine implements. Kept next to the parser so the two cannot drift apart. */
export const AUTOMATED_KEYWORDS: ReadonlySet<string> = new Set([
  // Timing and casting (milestone 3): CR 702.8, 702.10, 702.61, 702.102, 702.127.
  'flash', 'haste', 'split second', 'fuse', 'aftermath',
  // Combat and damage (milestone 4): CR 702.2-702.4, 702.7, 702.9, 702.12-702.17, 702.19, 702.20, 702.28, 702.31, 702.36, 702.80, 702.90, 702.111, 702.118, 702.164.
  'deathtouch', 'defender', 'double strike', 'first strike', 'flying', 'indestructible', 'intimidate', 'landwalk', 'lifelink', 'protection',
  'reach', 'trample', 'vigilance', 'shadow', 'horsemanship', 'fear', 'wither', 'infect', 'menace', 'skulk', 'toxic',
  // Targeting and attachment: CR 702.11, 702.16b-d, 702.18, 702.5.
  'hexproof', 'shroud', 'enchant',
]);

const PLAIN = new Set([
  'flash', 'haste', 'split second', 'fuse', 'aftermath', 'deathtouch', 'defender', 'double strike', 'first strike', 'flying', 'hexproof',
  'indestructible', 'intimidate', 'lifelink', 'reach', 'shroud', 'trample', 'vigilance', 'shadow', 'horsemanship', 'fear', 'wither',
  'infect', 'menace', 'skulk',
]);

export interface KeywordLine {
  /** The compiled keywords of the line, in order. */
  abilities: KeywordAbilityDef[];
  /** Pieces of the line that are not compiled (an unimplemented keyword, a parameter the engine can't test): they stay manual text. */
  leftover: string[];
}

const titleCase = (s: string): string => s.replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase());

/** Land words a landwalk can have (CR 702.14a): land subtypes, supertypes and the card type artifact. */
const LAND_SUBTYPES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'desert', 'gate', 'lair', 'locus', 'cave', 'sphere', 'mine', 'tower', 'town']);
const LAND_QUALIFIERS = new Set(['snow', 'legendary', 'basic', 'nonbasic', 'artifact']);

/** "Swampwalk", "Snow forestwalk", "Nonbasic landwalk" -> the words that describe the land ("swamp", "snow forest", "nonbasic"). */
export function parseLandwalk(text: string): string | null {
  const lower = text.toLowerCase().trim();
  if (!lower.endsWith('walk')) return null;
  const words = lower.slice(0, -4).trim().split(/\s+/).filter(Boolean);
  if (words[words.length - 1] === 'land') words.pop();
  if (words.length === 0 || !words.every((w) => LAND_SUBTYPES.has(w) || LAND_QUALIFIERS.has(w))) return null;
  return words.join(' ');
}

const COLOR_NAMES: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const TYPE_WORDS: Record<string, CardType> = {};
for (const t of CARD_TYPES) TYPE_WORDS[t.toLowerCase()] = t;

/**
 * "Enchant creature", "Enchant land you control", "Enchant artifact or creature", "Enchant Forest", "Enchant player": the restriction on
 * what an Aura can be attached to (CR 702.5a). Returns null for restrictions that can't be expressed as an ObjectFilter (they stay manual text).
 */
export function parseEnchant(text: string): { filter: ObjectFilter; player?: 'any' | 'opponent' } | null {
  let t = text.trim().replace(/\.$/, '');
  if (t === 'player') return { filter: {}, player: 'any' };
  if (t === 'opponent') return { filter: {}, player: 'opponent' };
  const filter: ObjectFilter = {};
  const control = /^(.*?)\s+(you control|an opponent controls|you don't control|your opponents control)$/.exec(t);
  if (control) {
    t = control[1]!;
    filter.controller = control[2] === 'you control' ? 'you' : 'opponent';
  }
  // Leading adjectives: a color list ("red or green"), "nonland", "nonblack", "legendary", "snow", "basic", "nonbasic", "tapped".
  for (;;) {
    const m = /^(white|blue|black|red|green)((?: or (?:white|blue|black|red|green))*)\s+(.+)$/.exec(t);
    if (m) {
      filter.colors = [m[1]!, ...(m[2] ? m[2].split(' or ').filter(Boolean) : [])].map((c) => COLOR_NAMES[c]!);
      t = m[3]!;
      continue;
    }
    const adj = /^(nonland|nonblack|nonwhite|nonblue|nonred|nongreen|nonartifact|noncreature|legendary|snow|basic|nonbasic|tapped)\s+(.+)$/.exec(t);
    if (!adj) break;
    const w = adj[1]!;
    if (w === 'tapped') filter.tapped = true;
    else if (w === 'legendary' || w === 'snow' || w === 'basic') (filter.supertypes ??= []).push(titleCase(w));
    else if (w === 'nonbasic') (filter.notSupertypes ??= []).push('Basic');
    else if (w.startsWith('non') && COLOR_NAMES[w.slice(3)]) (filter.notColors ??= []).push(COLOR_NAMES[w.slice(3)]!);
    else (filter.notTypes ??= []).push(TYPE_WORDS[w.slice(3)]!);
    t = adj[2]!;
  }
  if (t === 'permanent') return { filter };
  if (t === 'artifact creature') return { filter: { ...filter, allTypes: ['Artifact', 'Creature'] } };
  const terms = t.split(/,\s*or\s+|,\s*|\s+or\s+/).filter(Boolean);
  const types: CardType[] = [];
  const subtypes: string[] = [];
  for (const term of terms) {
    const type = TYPE_WORDS[term.toLowerCase()];
    if (type && term === term.toLowerCase()) types.push(type);
    else if (/^[A-Z][a-z]+$/.test(term)) subtypes.push(term);
    else return null;
  }
  if (types.length > 0 && subtypes.length > 0) return null; // a type OR a subtype can't be expressed as one filter
  if (types.length > 0) filter.types = types;
  if (subtypes.length > 0) filter.subtypes = subtypes;
  return types.length + subtypes.length === 0 ? null : { filter };
}

/** Split a keyword line at commas and semicolons, keeping "Protection from red, from blue" together. */
function splitSegments(clean: string): string[] {
  const out: string[] = [];
  for (const seg of clean.split(/\s*[,;]\s*/).filter(Boolean)) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /^(?:and\s+)?from\s/i.test(seg) && /^(?:protection|hexproof)\b/i.test(prev)) out[out.length - 1] = `${prev}, ${seg}`;
    else out.push(seg);
  }
  return out;
}

function keywordDef(text: string, keyword: string, extra: Partial<KeywordAbilityDef> = {}): KeywordAbilityDef {
  return { kind: 'keyword', text, keyword, ...extra };
}

/**
 * The printed forms of every subtype of the generated lexicon (CR 205.3), lowercase: its plural, and the forms rules/quality.ts#hasQuality tests a subtype
 * quality against (the singular "Kavu" of "Protection from Kavu", the regular plurals): the closed vocabulary of a subtype quality ("protection from Goblins",
 * CR 702.16a; guard G2, W3b). A word outside it is no quality, so the keyword stays manual text.
 */
export const SUBTYPE_QUALITY_WORDS: ReadonlySet<string> = new Set(GENERATED_LEXICON.subtypes.flatMap((s) => [s.plural.toLowerCase(), ...pluralForms(s.singular)]));

/** Compile one segment ("Flying", "Toxic 2", "Protection from red and from blue"). Null = not a keyword the engine implements. */
function parseSegment(seg: string): KeywordAbilityDef[] | null {
  const lower = seg.toLowerCase().trim();
  const display = titleCase(lower);
  if (PLAIN.has(lower)) return [keywordDef(display, lower)];
  const toxic = /^toxic (\d+)$/.exec(lower);
  if (toxic) return [keywordDef(`Toxic ${toxic[1]}`, 'toxic', { amount: Number(toxic[1]) })];
  const prot = /^(protection|hexproof) from (.+)$/i.exec(seg.trim());
  if (prot) {
    const kw = prot[1]!.toLowerCase();
    // "from red and from blue", "from Vampires, from Werewolves, and from Zombies": one ability per quality (CR 702.16g).
    const parts = prot[2]!.split(/,?\s*(?:and\s+)?from\s+/).filter(Boolean);
    if (kw === 'hexproof' && parts.length !== 1) return null;
    const out: KeywordAbilityDef[] = [];
    for (const p of parts) {
      const quality = parseQuality(p, SUBTYPE_QUALITY_WORDS);
      if (quality === null) return null;
      out.push(keywordDef(`${titleCase(kw)} from ${p.trim()}`, kw, { quality }));
    }
    return out;
  }
  const walk = parseLandwalk(lower);
  if (walk !== null) return [keywordDef(display, 'landwalk', { quality: walk })];
  return null;
}

/**
 * Compile a line (reminder text already removed). Returns null when the line holds no keyword the engine implements, so the caller
 * keeps it as manual text exactly as before.
 */
export function parseKeywordLine(clean: string): KeywordLine | null {
  const line = clean.trim();
  const ench = /^enchant\s+(.+)$/i.exec(line);
  if (ench) {
    const r = parseEnchant(ench[1]!);
    if (!r) return null;
    return { abilities: [keywordDef(line.replace(/\.$/, ''), 'enchant', { quality: ench[1]!.replace(/\.$/, ''), filter: r.filter, ...(r.player ? { player: r.player } : {}) })], leftover: [] };
  }
  if (/[:."]/.test(line)) return null; // sentences and activated abilities are not keyword lines
  const abilities: KeywordAbilityDef[] = [];
  const leftover: string[] = [];
  for (const seg of splitSegments(line)) {
    if (seg.split(/\s+/).length > 14) return null;
    const parsed = parseSegment(seg);
    if (parsed) abilities.push(...parsed);
    else leftover.push(seg);
  }
  return abilities.length > 0 ? { abilities, leftover } : null;
}

/** "Persist (CR 702.79)": names the rule for a leftover piece that is a keyword from the official list but not implemented yet. */
export function describeUnautomated(piece: string): string {
  const lower = piece.toLowerCase().trim();
  if (/[:."]/.test(lower) || lower.split(/\s+/).length > 10) return piece.trim(); // a sentence, not a keyword line
  let best: string | undefined;
  for (const name of KEYWORD_RULES.keys()) {
    if ((lower === name || lower.startsWith(`${name} `) || lower.startsWith(`${name}—`)) && (!best || name.length > best.length)) best = name;
  }
  return best ? `${piece.trim()} (CR ${KEYWORD_RULES.get(best)}) is not automated yet` : piece.trim();
}
