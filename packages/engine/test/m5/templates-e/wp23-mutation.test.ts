/**
 * WP23, guards G2 and G9 (design 6.8): near-miss mutations of every automated example of every WP23 template must not parse (automated) or must parse to
 * a different meaning; a nonsense word in place of a content word must never leave an automated ability. The mutations are the ones the design lists:
 * append "unless ...", swap "target" / "each", add "instead", insert "up to", negate with "not", drop the duration or the delayed trigger's moment.
 */
import { describe, expect, it } from 'vitest';
import { automated, exampleCard, face, gated, options, parsedMeaning, WP23_TEMPLATES } from './support';

const opts = options();

/** The mutations of a text, each with a name (the ones that do not apply return the text unchanged and are skipped). */
function mutations(text: string): [string, string][] {
  const lastPeriod = text.lastIndexOf('.');
  const beforeEnd = (ins: string): string => (lastPeriod < 0 ? text : `${text.slice(0, lastPeriod)}${ins}${text.slice(lastPeriod)}`);
  return [
    ['unless', beforeEnd(' unless it is blue')],
    ['instead', /instead/.test(text) ? text : beforeEnd(' instead')],
    ['target->each', text.replace(/\btarget\b/, 'each')],
    ['each->target', text.replace(/\beach\b/, 'target')],
    ['up to', text.replace(/\btarget\b/, 'up to two target')],
    ['may not', text.replace(/\bmay\b/, 'may not')],
    ['drop duration', text.replace(/ until end of turn| at the beginning of the next end step| at end of combat| at the beginning of your next upkeep/, '')],
    ['drop lead', text.replace(/At the beginning of (the|your) next (end step|upkeep), /, '')],
    ['drop "you do"', text.replace(/When you do, /, '')],
    ['twice', beforeEnd(' twice')],
  ];
}

/** "Hill Elf" style content words a template interprets: replaced one at a time by an invented word (guard G2). */
const CONTENT = /\b(spell|creature|artifact|card|cards|library|hand|battlefield|player|opponent|counter|copy|exile|search|draw|destroy|discard|pay|turn|step|upkeep|combat|game|token|land)\b/i;

describe('WP23 guard G9 (design 6.8): near-miss mutations of the examples fail or mean something else', () => {
  for (const t of WP23_TEMPLATES.filter((x) => !gated(x))) {
    it(`${t.id} (${t.cr.join(', ')})`, () => {
      for (const e of t.examples) {
        const original = parsedMeaning(e.text, opts);
        expect(original, e.text).not.toBeNull();
        for (const [name, m] of mutations(e.text)) {
          if (m === e.text) continue;
          const got = parsedMeaning(m, opts);
          expect(got === null || got !== original, `${t.id} ${name}: "${m}" means the same as "${e.text}"`).toBe(true);
        }
      }
    });
  }
});

describe('WP23 guard G2 (design 6.8): a nonsense word in place of a content word never leaves an automated ability', () => {
  for (const t of WP23_TEMPLATES.filter((x) => !gated(x))) {
    it(`${t.id}`, () => {
      for (const e of t.examples) {
        const m = e.text.replace(CONTENT, 'blorft');
        if (m === e.text) continue;
        const f = face(exampleCard(m), opts);
        // the ability whose text holds the invented word is never automated (the other abilities of a two-line example may be)
        const hit = f.abilities.map((a, i) => ({ a, i })).filter(({ a }) => a.text.includes('blorft'));
        expect(hit.length, m).toBeGreaterThan(0);
        for (const { a, i } of hit) expect(automated([a]) && f.gate[i]!.ok, `${t.id}: "${m}" is automated: ${JSON.stringify(a)}`).toBe(false);
      }
    });
  }
});
