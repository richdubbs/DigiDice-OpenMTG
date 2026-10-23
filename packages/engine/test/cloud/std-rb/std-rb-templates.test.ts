/**
 * Standard round B (std-rB, slot B): the template data of parser/templates/zz-cloud/std-rb.json and the parser and renderer support of the round
 * ("each other" after the one earlier target of an instant or sorcery, parser/lower/targets.ts#otherNotSource; "if C, also <instruction>",
 * render/steps-flow.ts#alsoLead, family if-also-imperative). Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rb-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRb from '../../../src/parser/templates/zz-cloud/std-rb.json';
import review from '../../m5/golden/cards/cloud-std-rb-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RB = stdRb as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

const sorcery = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Brute', 'Creature — Giant', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
/** Of an experimental template the card is capped at partial (design 6.9), so G9 checks the abilities and the gate, not the card's level. */
const understood = (f: ReturnType<typeof sorcery>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-rb template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rb.json, after zz-cloud/std-r9.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rb.json');
    expect(files.indexOf('zz-cloud/std-rb.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-r9.json'));
    expect(files.indexOf('zz-cloud/std-rb.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RB.map((t) => t.id)).toEqual(['eff.stdrb.if.also', 'eff.stdrb.base.each']);
    for (const t of RB) {
      expect(t.id, t.id).toMatch(/^eff\.stdrb\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // a narrow wording (two cards in the index): stable on one hand-verified golden card, a 6.9 deviation named in the round record and the PR
    expect(RB.find((t) => t.id === 'eff.stdrb.if.also')!.status).toBe('stable');
    expect(goldenUsing('eff.stdrb.if.also')).toEqual(['Moment of Glory']);
    // std-rx12 (changed on purpose): with "X can't be 0" read (ActivatedAbilityDef.xMin), Katara is a hand-verified golden card, and the template is stable on it
    // alone (a narrow wording, a 6.9 deviation named in std-rx12's record and PR)
    expect(RB.find((t) => t.id === 'eff.stdrb.base.each')!.status).toBe('stable');
    expect(goldenUsing('eff.stdrb.base.each')).toEqual(["Katara, Water Tribe's Hope"]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RB) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rb guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RB) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = sorcery(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = sorcery(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        if (t.status === 'stable') expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = sorcery(c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. Dropping "also" is no near miss: "if C, X" is the
 *  same instruction (family if-also-imperative). */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bIf\b/, 'Unless'], [/\buntil end of turn\b/, 'until your next turn'], [/\bhave base\b/, 'get base'], [/\bpower and toughness\b/, 'power'],
    [/\bcreature you control\b/, 'creature an opponent controls'], [/\bkicked\b/, 'cast'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rb guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RB) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = sorcery(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = sorcery(m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rb guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RB) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1): "a blorfty counter" is a counter of that kind (eff.counters.put)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(sorcery(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rb parser support: "each other" after the one earlier target of a spell (parser/lower/targets.ts#otherNotSource)', () => {
  const TARGET_THEN_OTHERS = 'Put a +1/+1 counter on target creature you control. Put a +1/+1 counter on each other creature you control.';
  it('CR 109.2, 608.2c: in a sorcery, which is never a creature, "each other creature you control" excludes the one earlier target', () => {
    const f = sorcery(TARGET_THEN_OTHERS);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"types":["Creature"],"controller":"you","not":{"is":{"ref":"target","id":"t0"}}}');
  });
  it('CR 608.2c: the same inside "if C, also ..." (Moment of Glory\'s shape, with a kicker condition)', () => {
    const f = sorcery('Put a +1/+1 counter on target creature you control. If ~ was kicked, also put a +1/+1 counter on each other creature you control.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"if","cond":{"cond":"wasCast","kicked":true},"then":[{"op":"putCounters","on":{"ref":"each","filter":{"types":["Creature"],"controller":"you","not":{"is":{"ref":"target","id":"t0"}}}}');
  });
  it('design 6.4 (unique candidate): two earlier targets leave "other" unresolved, so the card stays manual', () => {
    expect(fullyAutomated(sorcery('Put a +1/+1 counter on target creature you control and a +1/+1 counter on target creature an opponent controls. Put a +1/+1 counter on each other creature you control.'))).toBe(false);
  });
  it('design 6.4: one target of up to two objects is not one candidate, so the card stays manual', () => {
    expect(fullyAutomated(sorcery('Put a +1/+1 counter on up to two target creatures you control. Put a +1/+1 counter on each other creature you control.'))).toBe(false);
  });
  it('CR 109.2: on a permanent "other" may mean other than the permanent itself, so the reading is not offered there (stays manual, two candidates)', () => {
    const f = creature(`When ~ enters, ${TARGET_THEN_OTHERS[0]!.toLowerCase()}${TARGET_THEN_OTHERS.slice(1)}`);
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.abilities)).not.toContain('"not":{"is":{"ref":"target"');
  });
});

describe('std-rb renderer support: "if C, also <instruction>" (render/steps-flow.ts#alsoLead, family if-also-imperative)', () => {
  it('CR 608.2c: the gate accepts "also" in front of an instruction that opens with its verb, and the plain "if C, X"', () => {
    const also = sorcery('Draw a card. If you control an Elf, also gain 2 life.');
    expect(fullyAutomated(also)).toBe(true);
    const plain = sorcery('Draw a card. If you control an Elf, you gain 2 life.');
    expect(jsonKey(plain.abilities)).toBe(jsonKey(also.abilities));
  });
  it('CR 608.2c: "also" with "instead" is a replacement, not this reading', () => {
    const f = sorcery('Draw a card. If you control an Elf, also draw two cards instead.');
    expect(JSON.stringify(f.abilities)).not.toBe(JSON.stringify(sorcery('Draw a card. If you control an Elf, also draw two cards.').abilities));
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rb design 6.10 (local index): synthetic examples', () => {
  it('no std-rb line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = RB.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
