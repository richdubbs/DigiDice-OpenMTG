/**
 * FAST3 T12: the template data of parser/templates/zz-fast3/t12.json (static P/T, keywords and characteristic-defining counts with conditions; simple block
 * restrictions) and the renderer readings the package's shapes needed (design 6.8 G6: render/np.ts, render/qty.ts, render/cond.ts, render/mods.ts,
 * render/stat.ts). Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated ability (G2). Examples are synthetic wordings (design 6.10), except the two sentences whose wording the rules fix (below).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T12 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { canonicalize } from '../../../src/model/canonical';
import { renderGate } from '../../../src/index';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t12 from '../../../src/parser/templates/zz-fast3/t12.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T12 = t12 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T12 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast3/t12.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast3/t12.json');
    expect(files.indexOf('zz-fast3/t12.json')).toBeGreaterThan(files.indexOf('zz-fast2/t9.json'));
    expect(files.indexOf('zz-fast3/t12.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 5 (FAST3)', () => {
    expect(T12.length).toBe(10);
    for (const t of T12) {
      expect(['static'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(sta|rst)\.t12\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(5);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T12) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't"]) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T12 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T12) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
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

describe('T12 render gate (design 6.8 G6): the readings do not depend on the order of commutative operands', () => {
  const canonical = T12.filter((t) => ['sta.t12.pump.foreach.domain', 'sta.t12.cda.pt.domain', 'sta.t12.cda.power.toughnessplus'].includes(t.id));
  it.each(canonical.map((t) => [t.id, t] as const))('%s: the canonical form of every example (model/canonical.ts sorts sums) passes the gate too', (_id, t) => {
    for (const e of t.examples) {
      const card = exampleCard(t, e.text);
      const f = parsedWith(t, e.text);
      const lines = e.text.split('\n');
      const def = f.abilities[f.abilities.length - 1]!;
      const c = canonicalize(def);
      expect(JSON.stringify(c), e.text).not.toBe(JSON.stringify(def));
      expect(renderGate(c, [lines[lines.length - 1]!], { selfNames: [card.name], selfTypes: (card.type_line ?? '').split(/[ —]+/).filter(Boolean) }).ok, e.text).toBe(true);
    }
  });
});

describe('T12 fail closed (design 6.8): "other creatures" of an Aura or Equipment is never read as "other than the source"', () => {
  const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
  it('CR 303.4: an Aura\'s "Other creatures you control get -1/-1" spares the enchanted creature: no template says so, so it stays manual', () => {
    const f = face('Enchantment — Aura', 'Enchant creature\nOther creatures you control get -1/-1.');
    expect(f.abilities[1]!.kind).toBe('manual');
  });
  it('the same sentence on a creature (other than the source itself) stays automated', () => {
    const f = face('Creature — Vampire', 'Other creatures you control get -1/-1.');
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 303.4: "Enchanted creature gets +0/+2 for each other creature you control" counts every creature but the enchanted one (attachedToSource: false)', () => {
    const f = face('Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+2 for each other creature you control.');
    expect(f.templatesUsed).toContain('sta.t12.enchanted.pump.foreach.othercreature');
    expect(JSON.stringify(f.abilities[1])).toContain('"attachedToSource":false');
    expect(JSON.stringify(f.abilities[1])).not.toContain('"other":true');
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bgets\b/, 'gains'], [/\bget\b/, 'gain'], [/\bloses\b/, 'gains'], [/\bother\b/, 'another'], [/\bchosen\b/, 'named'], [/\byou control\b/, 'an opponent controls'],
    [/\bany player\b/, 'an opponent'], [/\bcan't\b/, 'can'], [/\bless than\b/, 'greater than'], [/\bor greater\b/, 'or less'], [/\bplus\b/, 'minus'],
    [/\bbasic land types?\b/, 'land type'], [/\bcharge\b/, 'time'], [/\bpower\b/, 'toughness'], [/\bequal to\b/, 'less than'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T12 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T12) {
    it(`${t.id}: an appended "unless/instead/at random/twice/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T12 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T12) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.pop()!;
        const words = last.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^~'s$/.test(w)) return;
          // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind reads an unlisted one as a weak kind), so the word before
          // "counter" is not a nonsense position
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...lines, [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ')].join('\n');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

/** Lines of other templates an example needs as they are: the producer of "the chosen color" (CR 607.2d), an Aura's enchant line, a keyword line. */
const SHARED_LINES = new Set(['As ~ enters, choose a color.', 'Enchant creature', 'Flying', 'Trample']);
/**
 * Two sentences whose words the rules fix, so no invented wording exists: domain as a characteristic-defining ability (CR 305.6, 604.3; no number, player
 * or noun in it can change) and the evasion "can't block it" of creatures with less power than the source (no number in it). Design 6.10 accepts them as
 * functional text; every other example is synthetic.
 */
const FIXED_WORDING = new Set([
  "~'s power and toughness are each equal to the number of basic land types among lands you control.",
  "Creatures with power less than ~'s power can't block it.",
]);

describe.skipIf(index === null)('T12 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T12.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => !SHARED_LINES.has(l.trim()) && !FIXED_WORDING.has(l.trim()) && lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
