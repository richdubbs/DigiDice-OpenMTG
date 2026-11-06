/**
 * Commander lane edh-misc, round edh-misc-4: the template data of parser/templates/zz-cloud/edh-misc-4.json ("~ is every nonbasic land type", "double the amount of each
 * type of unspent mana you have", "proliferate, then choose any number of permanents you control that had a counter put on them this way") and the promotion of
 * eff.put.bf.owner (the owner's standing rule 2026-10-27). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate
 * (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * edh-misc-4-scenarios.test.ts. CR cites from the Comprehensive Rules of 2026-09-25 (checked) unless noted.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/edh-misc-4.json';
import review from '../../m5/golden/cards/edh-misc-4-review.json';
import misc1Review from '../../m5/golden/cards/edh-misc-1-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
/** The synthetic card an example is an ability of: a land, an artifact with an activated ability, or an instant. */
const cardOf = (id: string, text: string) => {
  if (id === 'sta.edhx4.self.everyNonbasicLandType') return card('Example Crossing', 'Land', text);
  if (id === 'eff.edhx4.double.unspentMana') return card('Example Die', 'Artifact', text);
  return card('Example Ripple', 'Instant', text, { mana_cost: '{1}{U}' });
};
const parse = (id: string, text: string) => parseCard(cardOf(id, text), OPTS).faces[0]!;
type Golden = { card: string; verified: string; expect?: string }[];
const golden = review as Golden;

describe('edh-misc-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-misc-4.json, after edh-misc-3, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-misc-4.json');
    expect(files.indexOf('zz-cloud/edh-misc-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-misc-3.json'));
    expect(files.indexOf('zz-cloud/edh-misc-4.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhx4.*', () => {
    expect(MECH.map((t) => t.id)).toEqual(['sta.edhx4.self.everyNonbasicLandType', 'eff.edhx4.double.unspentMana', 'eff.edhx4.proliferate.thenChoose.permanents']);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.edhx4\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 deviation (guide section 5, "Narrow wordings"): each template is stable on the one card that prints its wording, golden and played', () => {
    const by = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id})`) || g.verified.includes(`(${id},`) || g.verified.includes(` ${id},`) || g.verified.includes(` ${id})`)).map((g) => g.card).sort();
    expect(by('sta.edhx4.self.everyNonbasicLandType')).toEqual(['Planar Nexus']);
    expect(by('eff.edhx4.double.unspentMana')).toEqual(['Doubling Cube']);
    expect(by('eff.edhx4.proliferate.thenChoose.permanents')).toEqual(['Ripples of Potential']);
    for (const t of MECH) expect(t.status, t.id).toBe('stable');
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('the promotion of this round (owner\'s standing rule 2026-10-27): eff.put.bf.owner is stable on its two golden cards, Kenrith and Bilbo (6.9 narrow wording, named in the record)', () => {
    expect(TEMPLATE_SET.find((x) => x.id === 'eff.put.bf.owner')?.status).toBe('stable');
    expect((misc1Review as Golden).filter((g) => g.verified.includes('eff.put.bf.owner')).map((g) => g.card).sort()).toEqual(['Bilbo, Unexpected Adventurer', 'Kenrith, the Returned King']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'every', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'double']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-misc-4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.id, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(t.id, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(t.id, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bnonbasic\b/, 'basic'], [/\bevery\b/, 'a'], [/\beach type\b/, 'one type'], [/\byou have\b/, 'your opponents have'], [/\bDouble\b/, 'Triple'], [/\bany number\b/, 'up to two'],
    [/\bpermanents you control\b/, 'permanents your opponents control'], [/\bhad a counter\b/, 'had two counters'], [/\bProliferate\b/, 'Investigate'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}
describe('edh-misc-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(t.id, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(t.id, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-misc-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        const reminder = words.findIndex((w) => w.startsWith('(')); // the reminder text is no rules text (CR 207.2): a nonsense word in it changes nothing
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w) || (reminder >= 0 && i >= reminder)) return;
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-misc-4 design 6.10 (local index): synthetic examples', () => {
  it('no edh-misc-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
