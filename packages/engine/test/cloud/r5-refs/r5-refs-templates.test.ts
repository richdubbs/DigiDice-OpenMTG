/**
 * Standard round 5, slice r5-refs (references and durations: the mechanisms r4-refs skipped): the template data of parser/templates/zz-cloud/r5-refs.json and the
 * parser, lowering, renderer and engine support they needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * r5-refs-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { CRITICAL_WORDS } from '../../../src/parser/lower/units';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r5Refs from '../../../src/parser/templates/zz-cloud/r5-refs.json';
import review from '../../m5/golden/cards/cloud-r5-refs-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R5 = r5Refs as Template[];
/** The number of templates in zz-cloud/r5-refs.json. */
const R5_COUNT = 15;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell (or a rider of one) on a sorcery, an "As this artifact enters" on an artifact, anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (/\bthis artifact\b/.test(text)) return card('Example Relic', 'Artifact', text);
  if ((t.kind === 'effect' || t.kind === 'rider') && !text.includes(':') && !text.includes('~') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('r5-refs template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r5-refs.json, after r4-refs.json, before std-blb.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r5-refs.json');
    expect(files.indexOf('zz-cloud/r5-refs.json')).toBeGreaterThan(files.indexOf('zz-cloud/r4-refs.json'));
    expect(files.indexOf('zz-cloud/r5-refs.json')).toBeLessThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/r5-refs.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.r5refs.* or rid.r5refs.*', () => {
    expect(R5.length).toBe(R5_COUNT);
    for (const t of R5) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.r5refs\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (full, or partial with the reviewed abilities only)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of R5.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    // A card without `expect` is partial: its entry holds only the abilities the parser understands, and says so.
    for (const g of golden) {
      if (g.expect === undefined) expect(g.verified, g.card).toMatch(/the abilities the parser understands/);
      else expect(g.expect, g.card).toBe('full');
    }
  });
  it('guard G3: a critical word or phrase a pattern spells out (parser/lower/units.ts#CRITICAL_WORDS) is listed in `consumes`', () => {
    for (const t of R5) {
      const literal = ` ${t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `;
      for (const w of CRITICAL_WORDS) if (literal.includes(` ${w} `)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('r5-refs guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R5) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // an experimental template whose wording the stable templates also lower to the same result gives way to them (design 6.9, G10: the "experimental" info
        // diagnostic names it)
        const fellBack = t.status === 'experimental' && f.diagnostics.some((d) => d.code === 'experimental' && d.message.includes(t.id));
        expect(f.templatesUsed.includes(t.id) || fellBack, `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = text.includes('\n') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bopponent\b/, 'player'], [/\bany number of\b/, 'two'], [/\buntil end of turn\b/i, 'until your next turn'], [/\bgains\b/, 'loses'], [/\bmay\b/, 'must'],
    [/\bsecond from the top\b/, 'third from the top'], [/\bor fewer\b/, 'or more'], [/\band\/or library\b/, 'and/or exile'], [/\btapped\b/, 'untapped'],
    [/\bmore times\b/, 'times'], [/\bdon't share\b/, 'share'], [/\bowner's hand\b/, 'controller\'s hand'], [/\badditional combat phase\b/, 'additional main phase'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('r5-refs guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R5) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    }, 60_000);
  }
});

describe('r5-refs guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R5) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n')) return;
          // the word before "counter(s)" is an open class (a counter kind, CR 122.1; as test/m5/templates-e/wp22-mutation.test.ts)
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,:"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 60_000);
  }
});

const index = localIndex();

describe.skipIf(index === null)('r5-refs design 6.10 (local index): synthetic examples', () => {
  it('no r5-refs line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = R5.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
