/**
 * Text helpers of the renderer (design 6.8 guard G6; WP2). Everything here is a pure function of strings.
 *
 * MARKED TEXT. The renderer builds English as strings that may contain ALTERNATIVE GROUPS: `alt('its', "that creature's")` encodes "either of these
 * is the same thing in the model" at one position. The groups are the "positions the renderer marks" of design 6.8 (anaphora, sentence joiners,
 * all/each, "unless" versus "may pay ... if they don't", ...). The display text takes the FIRST option of every group; the render gate accepts the
 * Oracle text if it matches ANY combination (render/equivalence.ts). Groups nest. Nothing outside a group is negotiable: that is what keeps the
 * gate exact.
 */

export const ALT_OPEN = '';
export const ALT_SEP = '';
export const ALT_CLOSE = '';

/**
 * Marks an option of a group as DISPLAY-ONLY: `firstAlt` shows it (without the mark) and the gate never matches it. For a position where the model cannot say
 * which of several Oracle words is right (an Aura's "enchanted" or an Equipment's "equipped" when the card types are unknown) the display can still be neutral
 * ("attached creature") without teaching the gate a wording Oracle does not have.
 */
export const ALT_DISPLAY = '\u0004';
export const displayFirst = (display: string, ...real: string[]): string => alt(ALT_DISPLAY + display, ...real);
export const isDisplayOnly = (option: readonly (string | object)[]): boolean => typeof option[0] === 'string' && option[0].startsWith(ALT_DISPLAY);

/** Alternative group. Duplicates are dropped; one option is returned as it is. The FIRST option is the display form. */
export function alt(...options: string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const o of options) {
    if (!seen.has(o)) {
      seen.add(o);
      unique.push(o);
    }
  }
  if (unique.length === 1) return unique[0]!;
  return ALT_OPEN + unique.join(ALT_SEP) + ALT_CLOSE;
}

/** A parsed marked text: literal strings and groups of alternatives, each alternative a sequence again. */
export type MarkedNode = string | { alts: MarkedNode[][] };

/** Parses marked text. Malformed markers (a missing close) are closed at the end of the string. */
export function parseMarked(text: string): MarkedNode[] {
  let pos = 0;
  const parseSeq = (): MarkedNode[] => {
    const out: MarkedNode[] = [];
    let lit = '';
    while (pos < text.length) {
      const ch = text[pos]!;
      if (ch === ALT_OPEN) {
        if (lit) out.push(lit);
        lit = '';
        pos++;
        const alts: MarkedNode[][] = [];
        for (;;) {
          alts.push(parseSeq());
          if (text[pos] === ALT_SEP) {
            pos++;
            continue;
          }
          if (text[pos] === ALT_CLOSE) pos++;
          break;
        }
        out.push({ alts });
      } else if (ch === ALT_SEP || ch === ALT_CLOSE) {
        break;
      } else {
        lit += ch;
        pos++;
      }
    }
    if (lit) out.push(lit);
    return out;
  };
  return parseSeq();
}

/** The display form: the first option of every group. */
export function firstAlt(text: string): string {
  if (!text.includes(ALT_OPEN)) return text;
  const flatten = (nodes: MarkedNode[]): string => nodes.map((n) => (typeof n === 'string' ? n : flatten(n.alts[0] ?? []))).join('');
  return flatten(parseMarked(text)).replace(/\u0004/g, '');
}

/** The display form of a marked fragment: the first option of every group, the card's own name for "~". */
export function shown(text: string, ctx: { selfNames: string[] }): string {
  const t = firstAlt(text);
  const name = ctx.selfNames[0];
  return name === undefined ? t : t.replace(/~/g, name).replace(/¤/g, name); // r4-static: "¤" is the outer card's name inside a quote (front/selfref.ts)
}

/** A parsed marked text printed again (the inverse of `parseMarked`). */
export function serializeMarked(nodes: MarkedNode[]): string {
  return nodes.map((n) => (typeof n === 'string' ? n : ALT_OPEN + n.alts.map(serializeMarked).join(ALT_SEP) + ALT_CLOSE)).join('');
}

/**
 * `f` applied to the last literal of every reading of a marked text (FAST5 T41): the end of a quoted ability is the end of each of its alternatives, so a
 * punctuation mark that closes it ("draw a card." -> "draw a card," before the next item of a list) is changed in every one of them.
 */
export function mapEnds(text: string, f: (lastLiteral: string) => string): string {
  const go = (nodes: MarkedNode[]): MarkedNode[] => {
    const last = nodes[nodes.length - 1];
    if (last === undefined) return nodes;
    if (typeof last === 'string') return [...nodes.slice(0, -1), f(last)];
    return [...nodes.slice(0, -1), { alts: last.alts.map(go) }];
  };
  return serializeMarked(go(parseMarked(text)));
}

/**
 * A marked sentence with its closing full stop moved out of the groups: `{a.|b.}` becomes `{a|b}.` (every reading must end in "."; otherwise the text is
 * returned as it is). A quoted ability closes with the period and the quote mark side by side, whatever readings it has inside (FAST5 T41).
 */
export function hoistFinalPeriod(text: string): string {
  const strip = (nodes: MarkedNode[]): MarkedNode[] | null => {
    const last = nodes[nodes.length - 1];
    if (last === undefined) return null;
    if (typeof last === 'string') return last.endsWith('.') ? [...nodes.slice(0, -1), last.slice(0, -1)] : null;
    const alts = last.alts.map(strip);
    return alts.some((a) => a === null) ? null : [...nodes.slice(0, -1), { alts: alts as MarkedNode[][] }];
  };
  const stripped = strip(parseMarked(text));
  return stripped === null ? text : `${serializeMarked(stripped)}.`;
}

/** True when the text contains a group. */
export const hasAlt = (text: string): boolean => text.includes(ALT_OPEN);

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** The number words the normalizer maps to digits (design 6.8: "number words vs digits"). */
export const NUMBER_WORD_VALUES: Readonly<Record<string, number>> = Object.fromEntries(NUMBER_WORDS.map((w, i) => [w, i]));

/** "two" for counted things (Oracle writes small counts as words), digits above twenty. */
export function numWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 20 ? NUMBER_WORDS[n]! : String(n);
}

const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
export const ordinal = (n: number): string => ORDINALS[n] ?? `${n}th`;

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
export const roman = (n: number): string => ROMAN[n] ?? String(n);

// ---------------------------------------------------------------------------
// Articles, plurals, verbs
// ---------------------------------------------------------------------------

/** "a" or "an" for the phrase that follows (by the sound of its first word). */
export function article(phrase: string): 'a' | 'an' {
  const w = firstAlt(phrase).trim().replace(/^[^A-Za-z0-9]+/, '');
  if (/^(?:uni|use|usu|uti|uro|ura|eu|one|once)/i.test(w)) return 'a';
  if (/^(?:hour|honest|honor|heir)/i.test(w)) return 'an';
  if (/^[aeiou]/i.test(w)) return 'an';
  if (/^(?:x|[fhlmnrs])(?![a-z])/i.test(w)) return 'an'; // "X", "an N/N"
  if (/^\d/.test(w)) return /^(?:8|11|18)/.test(w) ? 'an' : 'a';
  return 'a';
}

export const withArticle = (phrase: string): string => `${article(phrase)} ${phrase}`;

const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  elf: 'elves', wolf: 'wolves', dwarf: 'dwarves', werewolf: 'werewolves', thief: 'thieves', fungus: 'fungi', mouse: 'mice', goose: 'geese', child: 'children', ox: 'oxen',
  man: 'men', woman: 'women', louse: 'lice', leaf: 'leaves', knife: 'knives', life: 'lives', half: 'halves', calf: 'calves', loaf: 'loaves', wife: 'wives', shelf: 'shelves',
  merfolk: 'merfolk', elk: 'elk', fish: 'fish', sheep: 'sheep', deer: 'deer', moonfolk: 'moonfolk', plains: 'plains', homunculus: 'homunculi', octopus: 'octopuses', cyclops: 'cyclopes',
  djinn: 'djinn', sphinx: 'sphinxes', equipment: 'equipment', spacecraft: 'spacecraft', aircraft: 'aircraft', // FAST5 T59: "Exile all creatures and Spacecraft"
  hero: 'heroes', // FAST5X E28: "other Heroes you control" (the creature type's plural, as Oracle prints it)
  kithkin: 'kithkin', // FAST5X E11: "Other Kithkin you control get +1/+1" (Oracle never writes "Kithkins")
  // Cloud C3 (CR 205.3m): the creature types whose Oracle plural is the singular (parser/lexicon.generated.json): "Treefolk you control have hexproof", "Other Myr you control"
  aetherborn: 'aetherborn', astartes: 'astartes', aurochs: 'aurochs', bison: 'bison', caribou: 'caribou', "c'tan": "c'tan", custodes: 'custodes', dauthi: 'dauthi',
  eldrazi: 'eldrazi', gith: 'gith', kor: 'kor', kree: 'kree', myr: 'myr', nephilim: 'nephilim', qu: 'qu', samurai: 'samurai', "shi'ar": "shi'ar", soltari: 'soltari',
  spawn: 'spawn', starfish: 'starfish', surrakar: 'surrakar', thalakos: 'thalakos', treefolk: 'treefolk', zubera: 'zubera', pegasus: 'pegasi',
};

/** Plural of a noun as Oracle prints it ("creature" -> "creatures", "Elf" -> "Elves", "Sorcery" -> "Sorceries"). Keeps the case of the first letter. */
export function pluralize(noun: string): string {
  const lower = noun.toLowerCase();
  const irregular = IRREGULAR_PLURALS[lower];
  const cased = (s: string): string => (noun[0] !== undefined && noun[0] === noun[0].toUpperCase() && noun[0] !== noun[0].toLowerCase() ? s[0]!.toUpperCase() + s.slice(1) : s);
  if (irregular !== undefined) return cased(irregular);
  // last word of a multi-word noun ("planeswalker card") is the one that takes the plural
  const sp = noun.lastIndexOf(' ');
  if (sp >= 0) return `${noun.slice(0, sp + 1)}${pluralize(noun.slice(sp + 1))}`;
  if (/(?:s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/** Third person singular of a verb ("draw" -> "draws", "have" -> "has", "is" for "be"). */
export function thirdPerson(verb: string): string {
  const irregular: Record<string, string> = { have: 'has', be: 'is', do: 'does', go: 'goes' };
  if (irregular[verb] !== undefined) return irregular[verb]!;
  if (/(?:s|x|z|ch|sh)$/.test(verb)) return `${verb}es`;
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
  return `${verb}s`;
}

export type Person = 'you' | 'sg' | 'pl';

/** Conjugates a base-form verb for the grammatical person of the subject ("you draw", "it draws", "they draw"). */
export function conj(verb: string, person: Person): string {
  if (verb === 'be') return person === 'you' ? 'are' : person === 'sg' ? 'is' : 'are';
  return person === 'sg' ? thirdPerson(verb) : verb;
}

/** `conj` for a verb that may be an alternative group of verbs ("put" or "return"): each option is conjugated. */
export function conjAny(verb: string, person: Person): string {
  if (person !== 'sg' || !verb.includes(ALT_OPEN)) return conj(verb, person);
  return verb.replace(/[^]+/g, (w) => conj(w, 'sg'));
}

/** "a, b, and c" / "a and b" / "a, b, or c" (Oracle uses the serial comma). */
export function joinList(items: string[], conjunction: 'and' | 'or' | 'and/or' = 'and'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

/** Upper-cases the first letter that is not part of a mana symbol, quote or bullet. */
export function capFirst(s: string): string {
  const m = /^(["'•\s]*)([a-z])/.exec(s);
  if (!m) return s;
  return m[1]! + m[2]!.toUpperCase() + s.slice(m[0].length);
}

/** Lower-cases the first letter ("Draw" -> "draw") unless the word is a proper name or a mana symbol. */
export const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/** "+2/+0", "-1/-1" with an explicit sign. */
export const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** Non-breaking helper for the colors of Magic. */
export const COLOR_WORD: Readonly<Record<string, string>> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/** Types and subtypes print capitalized in the model ("Creature", "Elf"); Oracle prints card types lower-case in running text. */
export const lowerType = (t: string): string => t.toLowerCase();

/** Error thrown by a renderer for a node it cannot print. The gate catches it (the ability fails the gate); display falls back to a bracketed marker. */
export class NoRenderer extends Error {
  constructor(readonly node: string) {
    super(`no renderer for ${node}`);
  }
}
