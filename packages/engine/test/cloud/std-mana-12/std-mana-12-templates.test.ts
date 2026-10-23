/**
 * std-mana-12 (lane std-mana, account B: colored cost reductions, a mana ability that also colors its source, the four bending actions): the template data of
 * parser/templates/zz-cloud/std-mana-12.json and the round's parser, lowering and renderer support (the ColoredManaCost hole, the "@manaColor" link of
 * lower/links.ts#resolveManaColor, "you've done all N this turn" of lower/conditions.ts#resolveDoneAll, the reportAction step of earthbend and firebending, and the
 * render families done-all-trigger-actions and verb-list-or). Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-mana-12-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdMana12 from '../../../src/parser/templates/zz-cloud/std-mana-12.json';
import review from '../../m5/golden/cards/std-mana-12-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T = stdMana12 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card).sort();

const TYPE = 'Creature — Elf';
const face = (text: string) => parseCard(card('Example Relic', TYPE, text), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (text: string) => compileCard(card('Example Relic', TYPE, text));
const full = (text: string): boolean => {
  const d = compiled(text);
  return d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
};

describe('std-mana-12 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-mana-12.json, after zz-cloud/std-lci.json, before zz-cloud/std-misc.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files.indexOf('zz-cloud/std-mana-12.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-lci.json'));
    expect(files.indexOf('zz-cloud/std-mana-12.json')).toBeLessThan(files.indexOf('zz-cloud/std-misc.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(T.map((t) => t.id)).toEqual(['cm.stdmana12.spells.less.you.colored', 'eff.stdmana12.becomesManaColor', 'trg.stdmana12.youBendAny']);
    for (const t of T) {
      expect(t.id, t.id).toMatch(/^(cm|eff|trg)\.stdmana12\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings, each printed on one Standard card: stable on that hand-verified golden card plus these tests and the scenarios (a 6.9 deviation named in the
    // round record)
    expect(goldenUsing('cm.stdmana12.spells.less.you.colored')).toEqual(['Avatar Aang // Aang, Master of Elements']);
    expect(goldenUsing('trg.stdmana12.youBendAny')).toEqual(['Avatar Aang // Aang, Master of Elements']);
    expect(goldenUsing('eff.stdmana12.becomesManaColor')).toEqual(['Foraging Wickermaw']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'whenever', 'also', 'additional']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-mana-12 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const out = [`${text.replace(/\.$/, '')} unless it is blue.`];
  const swaps: [RegExp, string][] = [
    [/\bless to cast\b/, 'more to cast'], [/\byou cast\b/, 'your opponents cast'], [/\{W\}\{U\}/, '{2}'], [/\{1\}\{G\}/, '{2}'],
    [/\bone mana of any color\b/, 'two mana of any one color'], [/\bthat color\b/, 'blue'], [/\buntil end of turn\b/, 'until your next turn'],
    [/\bWhenever you\b/, 'Whenever an opponent'], [/\bearthbend, /, ''], [/\bdone all four\b/, 'done all three'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-mana-12 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-mana-12 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of T) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-mana-12 parser, lowering and lint support (fail closed)', () => {
  it('CR 601.2f, 118.7c (hole ColoredManaCost): a reduction of generic mana only is the older template, a colored one this one', () => {
    expect(face('Spells you cast cost {2} less to cast.').templatesUsed).not.toContain('cm.stdmana12.spells.less.you.colored');
    expect(full('Spells you cast cost {2} less to cast.')).toBe(true);
    const f = face('Spells you cast cost {W}{U}{B}{R}{G} less to cast.');
    expect(f.templatesUsed).toContain('cm.stdmana12.spells.less.you.colored');
    expect(JSON.stringify(f.abilities)).toMatch(/"kind":"reduce"/);
    expect(JSON.stringify(f.abilities)).toMatch(/"floor":"zero"/);
  });
  it('CR 106.1, 605.3b (lower/links.ts#resolveManaColor): "that color" needs one mana of one color added just before it', () => {
    expect(full('{1}: Add one mana of any color. ~ becomes that color until end of turn.')).toBe(true);
    expect(JSON.stringify(compiled('{1}: Add one mana of any color. ~ becomes that color until end of turn.').faces)).toContain('"link":"manaColor"');
    // colorless mana, two mana, two colors, or no mana at all: no color to take, never automated
    expect(full('{1}: Add {C}. ~ becomes that color until end of turn.')).toBe(false);
    expect(full('{1}: Add {R}{G}. ~ becomes that color until end of turn.')).toBe(false);
    expect(full('{1}: Add two mana of any one color. ~ becomes that color until end of turn.')).toBe(false);
    expect(full('When ~ enters, ~ becomes that color until end of turn.')).toBe(false);
  });
  it('CR 603.4, 608.2c (lower/conditions.ts#resolveDoneAll): "you\'ve done all N this turn" counts the distinct actions of its own trigger', () => {
    expect(full('Whenever you waterbend, earthbend, firebend, or airbend, scry 1. Then if you\'ve done all four this turn, draw two cards.')).toBe(true);
    // a trigger of one action, a count that is not the trigger's, or no trigger at all: never automated
    expect(full('Whenever you earthbend, scry 1. Then if you\'ve done all four this turn, draw two cards.')).toBe(false);
    expect(full('Whenever you waterbend, earthbend, firebend, or airbend, scry 1. Then if you\'ve done all three this turn, draw two cards.')).toBe(false);
    expect(full('When ~ enters, if you\'ve done all four this turn, draw two cards.')).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-mana-12 design 6.10 (local index): synthetic examples', () => {
  it('no std-mana-12 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
