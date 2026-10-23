/**
 * WP20, guard G9's near-miss mutations and guard G2 (design 6.8): for every example of every WP20 template, a wording that differs in a way that matters
 * must never be read as the original. The mutations: append "unless ...", append "instead", swap "target" for "each" / "all", insert "up to two" before
 * "target", change a number, and insert an invented word anywhere (closed vocabulary). The result must fail to parse (a manual unit) or parse to a
 * different meaning; it may never be automated with the meaning of the original.
 */
import { describe, expect, it } from 'vitest';
import { NEIGHBORS, WP20, automated, meaning, options, parseExample } from './support';

const NONSENSE = 'zzzblorp';
const opts = options(NEIGHBORS);

/** Insert `words` before the final period of the text. */
const beforeEnd = (text: string, words: string): string => text.replace(/\.$/, ` ${words}.`);

/** Near-miss mutations of one example (design 6.8 G9), each different from the original. */
export function nearMisses(text: string): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [
    { name: 'append unless', text: beforeEnd(text, 'unless it is blue') },
    { name: 'append instead', text: beforeEnd(text, 'instead') },
    { name: 'append this turn', text: beforeEnd(text, 'this turn') },
  ];
  if (/\btarget\b/.test(text)) {
    out.push({ name: 'target -> each', text: text.replace(/\btarget\b/, 'each') });
    out.push({ name: 'target -> all', text: text.replace(/\btarget\b/, 'all') });
    out.push({ name: 'insert up to two', text: text.replace(/\btarget\b/, 'up to two target') });
  }
  const num = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|[1-9]\d*)\b(?![^{]*\})/.exec(text);
  if (num) {
    const other = num[1] === 'two' ? 'three' : /\d/.test(num[1]!) ? String(Number(num[1]) + 1) : 'two';
    out.push({ name: `number ${num[1]} -> ${other}`, text: text.slice(0, num.index) + other + text.slice(num.index + num[1]!.length) });
  }
  return out.filter((m) => m.text !== text);
}

/** The text with an invented word inserted before word `i` (G2: an unknown word is never skipped). */
function insertions(text: string): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  for (let i = 0; i <= words.length; i++) out.push([...words.slice(0, i), NONSENSE, ...words.slice(i)].join(' '));
  return out;
}

describe('WP20 guard G9: near-miss mutations of every example never keep its meaning', () => {
  for (const t of WP20) {
    it(`${t.id}: appended "unless"/"instead"/"this turn", target/each/all swaps, "up to two", changed numbers`, () => {
      for (const e of t.examples) {
        const original = parseExample(e.text, opts);
        expect(automated(original.abilities), e.text).toBe(true);
        for (const m of nearMisses(e.text)) {
          const f = parseExample(m.text, opts);
          expect(automated(f.abilities) && meaning(f.abilities) === meaning(original.abilities), `${m.name}: ${m.text}`).toBe(false);
        }
      }
    });
  }
});

describe('WP20 guard G2: an invented word anywhere in an example leaves no automated reading', () => {
  for (const t of WP20) {
    it(`${t.id}: "${NONSENSE}" inserted before every word`, () => {
      for (const e of t.examples) {
        for (const text of insertions(e.text)) {
          const f = parseExample(text, opts);
          expect(automated(f.abilities), text).toBe(false);
        }
      }
    });
  }
});
