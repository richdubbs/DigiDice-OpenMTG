/**
 * "This creature enters with X +1/+1 counters on it." (CR 614.1c): the simple, unconditional forms are compiled into a static ability with a
 * self replacement effect (`body: {b: 'enters', counters}`) that core/zones.ts applies as the permanent enters, before any state-based action (a 0/0 creature
 * that enters with counters must not die first, CR 704.5f). Any other "enters with ... counters" text is not understood here; the
 * compiler flags it so the controller is asked for the counters by hand instead (docs/ARCHITECTURE.md, "Abilities are data").
 */
import type { CounterSpec, StaticAbilityDef } from '../types/ability';

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text mentions entering with counters in some form the engine does not evaluate. */
export const MENTIONS_ENTERS_WITH_COUNTERS = /\benters(?: the battlefield)? with\b[^.]*\bcounters?\b/i;

/** Compile a line of the form "<this permanent> enters with <N|X|a|an> <kind> counter(s) on it." or return null. */
export function parseEntersWithCounters(line: string, faceName: string): StaticAbilityDef | null {
  if (!line.includes(' enters') || !line.includes(' counter')) return null; // P1: both are in every line the pattern below matches; most lines have neither
  const subject = `(?:This [A-Za-z ]+?|~|${escapeRegExp(faceName)})`;
  const re = new RegExp(`^${subject} enters(?: the battlefield)? with (X|\\d+|[A-Za-z]+) (\\+\\d+/\\+\\d+|-\\d+/-\\d+|[A-Za-z]+) counters? on (?:it|him|her|them)\\.?$`);
  const m = re.exec(line.trim());
  if (!m) return null;
  const word = m[1]!;
  const count = word === 'X' ? 'X' : /^\d+$/.test(word) ? Number(word) : WORDS[word.toLowerCase()];
  if (count === undefined) return null;
  // Model form (design D9): a self replacement effect with an `enters` body that puts counters on the permanent as it enters (CR 614.1c, 614.15).
  const counters: CounterSpec[] = [{ kind: m[2]!.toLowerCase(), count: count === 'X' ? { q: 'X' } : count }];
  return {
    kind: 'static',
    text: line.trim(),
    effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters }, selfReplacement: true }],
  };
}

/**
 * The counters a static ability says its permanent enters with, when it has exactly the simple shape `parseEntersWithCounters` produces
 * (counter kind and a fixed number or X); null for every other static ability. `count` is `'X'` for the announced X of the spell.
 */
export function simpleEntersCounters(def: StaticAbilityDef): { counter: string; count: number | 'X' } | null {
  const [e, ...rest] = def.effects;
  if (!e || rest.length > 0 || e.s !== 'replace' || e.body.b !== 'enters') return null;
  const { counters, ...others } = e.body;
  if (!counters || counters.length !== 1 || Object.keys(others).length !== 1) return null; // only `b` besides `counters`: nothing else to apply
  const [c] = counters;
  if (!c) return null;
  if (typeof c.count === 'number') return { counter: c.kind, count: c.count };
  return typeof c.count === 'object' && c.count.q === 'X' ? { counter: c.kind, count: 'X' } : null;
}
