/**
 * The word filter on display names and table titles (design 4.2, 11; package M13-8): the tables layer's `ModerationHook`, on the filter of
 * `@openmtg/accounts` (milestone 14's `createListNameFilter`) instead of a second list.
 *
 * - **The list** is `MODERATION_WORDS_FILE`'s text (the file the accounts package reads for account names too), or accounts' short built-in list
 *   (`DEFAULT_MODERATION_WORDS`) when none is set. One entry per line; a plain word matches anywhere in the text, `=word` only the whole text, `!word`
 *   is an exception (the Scunthorpe problem: it counts only inside one word of what was typed); `#` starts a comment.
 * - **What is compared** is the text's canonical key (accounts' `NameRules.key`: Unicode normalization, case folding, look-alike letters of other
 *   scripts to Latin, accents and separators dropped) and the key of its "leet" form (4 3 5 7 read as a e s t), both of every entry too. Hosted names and
 *   titles may hold what an account name may not (digits, punctuation, symbols, emoji), so two more steps come first: every run of characters that are
 *   not letters, marks or digits is a word break ("f,u,c,k", "f/u/c/k" and "f.u.c.k" are read as "f u c k"), and the symbols that stand for letters are
 *   read as those letters ("@" a, "$" s; then also "!" i and "|" l, which an honest title uses as punctuation too, so the text is checked both ways).
 *   Before both, the text is NFKC'd and the boxed capitals NFKC keeps are read as letters, so letters written as symbols ("Ⓕⓤⓒⓚ", "🄵🅄🄲🄺", "🅵🆄🅲🅺")
 *   are read as the letters they are, not as word breaks (M13-8 review, finding 1).
 *   The text is checked as a whole and, when it has several words, each word alone (a `=word` entry is about one word).
 * - **What it cannot do**: a letter swapped for a symbol that is nobody's look-alike ("f*ck"), misspellings and words in a language the list does not
 *   have. Because the key has no separators, a refused word may also be spelled across two words ("Bit Chat" holds "bitch"): the player rewords it.
 *   The list is the operator's to grow; a filter is a speed bump in front of the Report button (design 4.2), not a judge.
 * - **A refusal says nothing of the word** that matched (`That title is not allowed`); a text longer than any name or title (256 UTF-16 units, the
 *   filter's own bound) is refused, never passed unchecked.
 */
import { readFile, stat } from 'node:fs/promises';
import { createListNameFilter, createNameRules, type NameFilter, type NameRules } from '@openmtg/accounts';
import type { ModerationHook } from '../tables/hooks';

/** Longer text is refused without a look: accounts' key of a longer one is empty, and an empty key matches nothing. */
const TEXT_MAX_UNITS = 256;
/** A list file larger than this is a mistake (the built-in list is 14 lines). */
export const WORDS_FILE_MAX_BYTES = 1024 * 1024;

export const NAME_REFUSED = 'That name is not allowed; please pick another.';
export const TITLE_REFUSED = 'That title is not allowed; please reword it.';

/** Every run of characters that are not letters, marks or digits as one space (a word break for the filter), and no space at either end. */
const wordBreaks = (s: string): string => s.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
/** The boxed capitals NFKC leaves alone (negative circled, negative squared, regional indicators), each block A to Z: read as plain letters. */
const BOXED_BLOCKS: readonly number[] = [0x1f150, 0x1f170, 0x1f1e6];
const BOXED = /[\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}\u{1F1E6}-\u{1F1FF}]/gu;
/**
 * The letters a text spells with symbols: NFKC first, before the word breaks see it (circled, parenthesized, squared and full-width letters are
 * symbols, category So, which the word breaks would otherwise turn into spaces: "Ⓕⓤⓒⓚ" would vanish), then the boxed capitals NFKC does not map.
 */
const unboxed = (s: string): string =>
  s.normalize('NFKC').replace(BOXED, (c) => {
    const cp = c.codePointAt(0) ?? 0;
    const block = BOXED_BLOCKS.find((b) => cp >= b && cp < b + 26) ?? cp;
    return String.fromCharCode(0x61 + cp - block);
  });
/** Symbols read as the letters they stand for: accounts' own fold (4 3 5 7) does not have them, since an account name cannot hold them. */
const READINGS: readonly Readonly<Record<string, string>>[] = [{}, { '@': 'a', $: 's' }, { '@': 'a', $: 's', '!': 'i', '|': 'l' }];
const symbolsRead = (s: string, reading: Readonly<Record<string, string>>): string => s.replace(/[@$!|]/g, (c) => reading[c] ?? c);

export class WordModeration implements ModerationHook {
  private readonly rules: NameRules;
  private readonly filter: NameFilter;

  /** `wordsText`: the list file's text; null: the built-in list. */
  constructor(wordsText: string | null = null) {
    this.rules = createNameRules({ reservedNamesText: null });
    this.filter = createListNameFilter(wordsText, this.rules);
  }

  nameProblem(name: string): string | null {
    return this.refused(name) ? NAME_REFUSED : null;
  }

  titleProblem(title: string): string | null {
    return this.refused(title) ? TITLE_REFUSED : null;
  }

  private refused(text: unknown): boolean {
    if (typeof text !== 'string' || text.length > TEXT_MAX_UNITS) return true;
    // NFKC may lengthen a text ("⒡" is "(f)"): one that grows past the filter's bound is refused too, never passed unchecked
    const plain = unboxed(text);
    if (plain.length > TEXT_MAX_UNITS) return true;
    for (const form of new Set(READINGS.map((r) => wordBreaks(symbolsRead(plain, r))))) {
      if (form === '') continue;
      if (!this.allows(form)) return true;
      // each word alone too: `=word` entries are about one word (they keep "Yoshito" apart from "shit"), so a word of a title that is one is refused
      // just as a name that is one is ("Shit happens")
      if (form.includes(' ') && [...new Set(form.split(' '))].some((word) => !this.allows(word))) return true;
    }
    return false;
  }

  private allows(display: string): boolean {
    return this.filter.check({ display, key: this.rules.key(display) }).ok;
  }
}

/**
 * The filter on `MODERATION_WORDS_FILE`'s list (null: the built-in one). A file that is set and cannot be read, or is far too big, is an error that stops
 * the start (an operator who named a list wants it, not a silent default); the message has the path and the reason code, never the file's text.
 */
export async function moderationFromFile(file: string | null): Promise<WordModeration> {
  if (file === null) return new WordModeration(null);
  let text: string;
  try {
    const size = (await stat(file)).size;
    if (size > WORDS_FILE_MAX_BYTES) throw new RangeError('too large');
    // an editor's byte order mark is not part of the first line
    text = (await readFile(file, 'utf8')).replace(/^﻿/, '');
  } catch (e) {
    const why = e instanceof RangeError ? e.message : ((e as NodeJS.ErrnoException).code ?? 'unreadable');
    throw new Error(`MODERATION_WORDS_FILE: cannot use ${file} (${why}).`);
  }
  return new WordModeration(text);
}
