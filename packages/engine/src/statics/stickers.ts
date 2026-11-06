/**
 * edh-next-147 (CR 123.6, 123.6a-c, 613.1c; _____ Goblin): the name of an object with name stickers on it. A name sticker's words are added to the object's name (a
 * text-changing effect, layer 3): start from the name the object has after layers 1 and 2 (its copiable values), then put each sticker's words, in timestamp order (the
 * order of `GameObject.nameStickers`), after the number of words that were before it when it was placed (`at`), or at the end when the name now has fewer words. A word
 * is a run of non-space characters; a blank line ("_____") is not a word (CR 123.6a). Name stickers never change or remove the other words; an object with no name gets
 * the sticker's words as its name (CR 123.6b). Pure: it reads only the object's own record.
 */
import type { Chars } from '../rules/characteristics';
import type { GameObject } from '../types/state';

const isWord = (t: string): boolean => !/^_+$/.test(t);

/** The name `name` with the words `text` put after `at` of its words (at the end when it has fewer; at the beginning for 0). */
export function stickeredName(name: string, text: string, at: number): string {
  const toks = name.split(' ').filter((t) => t.length > 0);
  let index = 0; // the token the sticker's words go before
  if (at > 0) {
    let words = 0;
    index = toks.length;
    for (let i = 0; i < toks.length; i++) {
      if (!isWord(toks[i]!)) continue;
      words++;
      if (words === at) { index = i + 1; break; }
    }
  }
  return [...toks.slice(0, index), ...text.split(' ').filter((t) => t.length > 0), ...toks.slice(index)].join(' ');
}

/** The number of words in a name (CR 123.6a). */
export const nameWords = (name: string): number => name.split(' ').filter((t) => t.length > 0 && isWord(t)).length;

/** CR 123.6e: the number of different vowels (A, E, I, O, U and Y, either case) on a sticker. */
export const uniqueVowels = (text: string): number => new Set([...text.toLowerCase()].filter((ch) => 'aeiouy'.includes(ch))).size;

/** `c` with the name stickers of `o` applied (in place, as the other per-object parts are); unchanged without stickers. */
export function withNameStickers(o: GameObject, c: Chars): Chars {
  const stickers = o.nameStickers;
  if (stickers === undefined || stickers.length === 0) return c;
  let name = c.name;
  for (const st of stickers) name = stickeredName(name, st.text, st.at);
  c.name = name;
  if (c.names.length <= 1) c.names = [name];
  return c;
}
