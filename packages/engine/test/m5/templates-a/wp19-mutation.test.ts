/**
 * WP19 mutation tests (design 6.8 guards G2 and G9, design 15.4 "per template: examples, counterExamples, near-miss mutations, nonsense word").
 *
 *  - Near misses (G9): every example of every WP19 template is mutated the six ways design 6.8 lists (append "unless ...", swap target/each/all, add
 *    "instead", insert "up to", negate with "don't"/"doesn't", drop the duration). A mutation must not parse to the example's meaning: it fails (manual) or
 *    it means something else. A template that silently ignores the words a mutation adds would read the mutated text as the original.
 *  - Nonsense word (G2): replacing any single word of an example by an invented word never leaves a fully automated ability (no stemming, no skipping,
 *    closed vocabulary). Open classes (a counter's kind in front of "counter(s)", design 6.11) are skipped.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { automated, exampleCard, face, options, parsedMeaning, WP19_TEMPLATES } from './support';

const opts = options();

/** Insert `words` before the final period of the first sentence (or at the end of a line without one). */
function beforePeriod(text: string, words: string): string {
  const i = text.indexOf('.');
  return i < 0 ? `${text} ${words}` : `${text.slice(0, i)} ${words}${text.slice(i)}`;
}

const NEGATE: [RegExp, string][] = [
  [/\battacks\b/, "doesn't attack"], [/\bdies\b/, "doesn't die"], [/\bdie\b/, "don't die"], [/\benters\b/, "doesn't enter"], [/\benter\b/, "don't enter"],
  [/\bcasts\b/, "doesn't cast"], [/\bgets\b/, "doesn't get"], [/\bget\b/, "don't get"], [/\bgains\b/, "doesn't gain"], [/\bgain\b/, "don't gain"],
  [/\bhave\b/, "don't have"], [/\bhas\b/, "doesn't have"], [/\bdraws\b/, "doesn't draw"], [/\bdiscards\b/, "doesn't discard"], [/\bdiscard\b/, "don't discard"],
  [/\bsacrifice\b/, "don't sacrifice"], [/\bscry\b/, "don't scry"], [/\bsurveil\b/, "don't surveil"], [/\bcycle\b/, "don't cycle"], [/\bcycles\b/, "doesn't cycle"],
  [/\bactivate\b/, "don't activate"], [/\bactivates\b/, "doesn't activate"], [/\bproliferate\b/, "don't proliferate"], [/\bcontrol\b/, "don't control"],
  [/\bdeals\b/, "doesn't deal"], [/\bbecomes\b/, "doesn't become"], [/\bdraw\b/, "don't draw"], [/^(\w+)/, "Don't $1"],
];

const DURATIONS = [/until end of turn,?\s*/i, /until your next turn,?\s*/i, /\s*this turn/i];

/** The near-miss mutations of design 6.8 that apply to `text`. */
export function nearMisses(text: string): { kind: string; text: string }[] {
  const out: { kind: string; text: string }[] = [];
  out.push({ kind: 'append unless', text: beforePeriod(text, 'unless it is blue') });
  out.push({ kind: 'add instead', text: beforePeriod(text, 'instead') });
  for (const [from, to] of [['target', 'each'], ['each', 'target'], ['all', 'each'], ['another', 'each']] as const) {
    const re = new RegExp(`\\b${from}\\b`, 'i');
    if (re.test(text)) out.push({ kind: `swap ${from}/${to}`, text: text.replace(re, to) });
  }
  const upto = /\b(target|two|three|four|a|an)\b/i.exec(text);
  if (upto) out.push({ kind: 'insert up to', text: `${text.slice(0, upto.index)}up to ${/^(a|an)$/i.test(upto[1]!) ? 'one' : upto[1]}${text.slice(upto.index + upto[1]!.length)}` });
  for (const [re, to] of NEGATE) {
    if (!re.test(text)) continue;
    out.push({ kind: 'negate', text: text.replace(re, to) });
    break;
  }
  for (const d of DURATIONS) {
    if (!d.test(text)) continue;
    const dropped = text.replace(d, '');
    out.push({ kind: 'drop the duration', text: dropped.charAt(0).toUpperCase() + dropped.slice(1) });
  }
  return out;
}

/** Positions of an open class (design 6.11): the word in front of "counter(s)". */
const openClass = (words: string[], i: number): boolean => /^counters?$/i.test(words[i + 1] ?? '');

/** Every single-word replacement by an invented word (guard G2). Only alphabetic words are replaced; "~", mana symbols and P/T stay. */
export function nonsense(text: string): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  words.forEach((w, i) => {
    const m = /^([A-Za-z][A-Za-z'-]*)([.,]?)$/.exec(w);
    if (m === null || openClass(words, i)) return;
    out.push([...words.slice(0, i), `zorblax${m[2]}`, ...words.slice(i + 1)].join(' '));
  });
  return out;
}

describe('WP19 near-miss mutations (design 6.8 G9): a mutated example fails or means something else', () => {
  for (const t of WP19_TEMPLATES) {
    it(`${t.id} (${t.cr.join(', ')}): append unless, swap target/each/all, add instead, insert up to, negate, drop the duration`, () => {
      for (const e of t.examples) {
        const original = parsedMeaning(t, e.text, opts);
        expect(original, e.text).not.toBeNull();
        for (const m of nearMisses(e.text)) {
          const got = parsedMeaning(t, m.text, opts);
          expect(got === null || got !== original, `${t.id} ${m.kind}: "${m.text}" reads as "${e.text}"`).toBe(true);
        }
      }
    });
  }
});

describe('WP19 nonsense-word mutation (design 6.8 G2): an unknown word never leaves a fully automated ability', () => {
  for (const t of WP19_TEMPLATES) {
    it(`${t.id}: each word of each example replaced by an invented word makes the ability manual (closed vocabulary)`, () => {
      for (const e of t.examples) {
        for (const text of nonsense(e.text)) {
          const f = face(exampleCard(t as Template, text), opts);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok), `${t.id}: "${text}"`).toBe(false);
        }
      }
    });
  }
});

describe('the mutation generators themselves', () => {
  it('produce the six kinds of design 6.8 where they apply', () => {
    const kinds = nearMisses('Until end of turn, target creature gets +1/+1.').map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(['append unless', 'add instead', 'swap target/each', 'insert up to', 'negate', 'drop the duration']));
    expect(nearMisses('Whenever ~ attacks, draw two cards.').find((m) => m.kind === 'negate')?.text).toBe("Whenever ~ doesn't attack, draw two cards.");
    expect(nonsense('Equip {4}')).toEqual(['zorblax {4}']);
    expect(nonsense('Remove a charge counter from ~')).not.toContain('Remove a zorblax counter from ~');
  });
});
