/**
 * std-rx5 (wave-2 slice s22): the template data of parser/templates/zz-cloud/std-rx5.json and the round's parser and renderer support (the Filter post-modifier
 * "exiled with ~", parser/holes/filter.ts, and its linked producer, parser/parse.ts#linkExiled; "with mana value, power, or toughness <cmp>"; the cost "Remove any
 * number of <kind> counters from ~", parser/holes/cost.ts, parser/lower/ability.ts#anyNumberMentions, render family any-number-that-many; "the chosen number" of
 * an "As ~ enters, choose a number between N and M", parser/parse.ts#faceChoices, parser/lower/links.ts). Guard G9 (design 6.8): every example lowers with its
 * template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the
 * local index when it is present. The behavior is in std-rx5-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx5 from '../../../src/parser/templates/zz-cloud/std-rx5.json';
import review from '../../m5/golden/cards/cloud-std-rx5-review.json';
import r3repl from '../../m5/golden/cards/cloud-r3-repl-review.json'; // The Darkness Crystal's entry (an earlier round's, updated: guide section 6)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX5 = stdRx5 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'eff.stdrx5.put.bf.tapped.yours.additionalCounters': 'Artifact',
  'eff.stdrx5.becomes.pt.subtype.artifactcreature.noDuration': 'Artifact',
  'rep.stdrx5.enters.choose.numberBetween': 'Creature — Faerie',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? (/this artifact/.test(text) ? 'Artifact' : TYPE[id] ?? 'Sorcery');
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-rx5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx5.json, after zz-cloud/std-rp.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx5.json');
    expect(files.indexOf('zz-cloud/std-rx5.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rx5.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX5.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of RX5) {
      expect(t.id, t.id).toMatch(/^(eff|rep)\.stdrx5\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (one Standard card each in the index): stable on one hand-verified golden card plus these tests and played scenarios, a 6.9 deviation
    // named in the round record and the PR
    expect(goldenUsing('eff.stdrx5.put.bf.tapped.yours.additionalCounters', r3repl as Golden)).toEqual(['The Darkness Crystal']);
    expect(goldenUsing('eff.stdrx5.becomes.pt.subtype.artifactcreature.noDuration')).toEqual(['Tezzeret, Cruel Captain']);
    expect(goldenUsing('rep.stdrx5.enters.choose.numberBetween')).toEqual(['Talion, the Kindly Lord']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX5) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx5 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX5) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.id, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(t.id, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(t.id, c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\btapped\b/, 'untapped'], [/\byour control\b/, "its owner's control"], [/\badditional\b/, 'fewer'], [/\bartifact creature\b/, 'enchantment creature'],
    [/\bbetween\b/, 'above'], [/\bchoose a number\b/, 'choose a color'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX5) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(t.id, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(t.id, m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rx5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX5) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const at = lines.findIndex((l) => l !== 'Flying'); // the line of the template (a keyword line only gives the card its type)
        const words = lines[at]!.split(' ');
        words.forEach((w, i) => {
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          if (/^(artifact|creature)$/.test(words[i + 1] ?? '') && /^[A-Z]/.test(w)) return; // a creature type is any name (CR 205.3m)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, at), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' '), ...lines.slice(at + 1)].join('\n');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx5 parser support', () => {
  it('CR 607.2a: "target creature card exiled with ~" is one of the cards the linked instruction exiled (a replacement effect\'s exile is that instruction)', () => {
    const f = face('x', 'If a creature an opponent controls would die, instead exile it and you gain 1 life.\n{2}, {T}: Put target creature card exiled with ~ onto the battlefield tapped under your control with two additional +1/+1 counters on it.', 'Artifact');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"types":["Creature"],"zone":"exile","is":{"ref":"linked","link":"exiled"},"isCard":true}');
    expect(JSON.stringify(f.abilities)).toContain('"link":"exiled"}');
  });
  it('CR 607.2a: with no instruction of the face that exiles, "exiled with ~" links to nothing: not automated (fails closed)', () => {
    const f = face('x', '{2}, {T}: Put target creature card exiled with ~ onto the battlefield tapped under your control with two additional +1/+1 counters on it.', 'Artifact');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('CR 107.1c, 602.2b: "Remove any number of +1/+1 counters from ~" is the X of the ability, and "that many" is that X', () => {
    const f = face('x', '{1}, Remove any number of +1/+1 counters from this creature: Create that many 1/1 green Insect creature tokens.', 'Creature — Human');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"kind":"removeCounters","counter":"+1/+1","count":{"q":"X"},"self":true,"anyNumber":true}');
    expect(JSON.stringify(f.abilities)).toContain('"count":{"q":"X"},"token"');
  });
  it('design 6.4: "that many" after "Remove any number of ..." with another number in the sentence before stays manual (two candidates)', () => {
    const f = face('x', '{1}, Remove any number of +1/+1 counters from this creature: Draw two cards. Create that many 1/1 green Insect creature tokens.', 'Creature — Human');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('the counters removed only from ~: "Remove any number of +1/+1 counters from a creature you control" is not read', () => {
    const f = face('x', '{1}, Remove any number of +1/+1 counters from a creature you control: Create that many 1/1 green Insect creature tokens.', 'Artifact');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('CR 202.3, 208.1: "with mana value, power, or toughness 3 or greater" is any of the three statistics', () => {
    const f = face('x', 'Destroy each creature with mana value, power, or toughness 3 or greater.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"anyOf":[{"manaValue":{"op":">=","value":3}},{"power":{"op":">=","value":3}},{"toughness":{"op":">=","value":3}}]');
  });
  it('CR 607.2d: "the chosen number" of another ability needs exactly one "As ~ enters, choose a number between N and M" (none, a color choice, or two: manual)', () => {
    const trigger = 'Whenever an opponent casts a spell with mana value equal to the chosen number, that player loses 2 life.';
    expect(fullyAutomated(face('x', `As ~ enters, choose a number between 1 and 10.\n${trigger}`, 'Creature — Faerie'))).toBe(true);
    expect(fullyAutomated(face('x', `Flying\n${trigger}`, 'Creature — Faerie'))).toBe(false);
    expect(fullyAutomated(face('x', `As ~ enters, choose a color.\n${trigger}`, 'Creature — Faerie'))).toBe(false);
    expect(fullyAutomated(face('x', `As ~ enters, choose a number between 1 and 10.\nAs ~ enters, choose a number between 2 and 4.\n${trigger}`, 'Creature — Faerie'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx5 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const context = /^(Flying|Reach|Trample|Vigilance)$/;
    const verbatim = RX5.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
