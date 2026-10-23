/**
 * p2-counters-state-1 (lane p2-counters-state): the template data of parser/templates/zz-cloud/p2-counters-state-1.json ("exile <obj> with N <kind> counters on
 * it", "~ gets <pt> for each <kind> counter on it", "If ~ was kicked with its {M} kicker, it enters with ... and with ...") and the round's parser and renderer
 * changes: the Cond readings "there are no <kind> counters on ~" and "~/it was kicked with its {M} kicker" (parser/holes/cond.ts, parser/holes/p2cs1.ts, the
 * face's kicker names in parser/parse.ts#resolveKickerCosts), strict counter comparisons ("fewer than three +1/+1 counters on it", render/cond.ts, render/np.ts),
 * "on them" of a counted plural, and the enters-with fold with a quoted grant (render/abil.ts#entersWithFold).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2), except
 * the counter kind itself, which is data (the `CounterKind` hole reads any word before "counter(s)", CR 122.1). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. The behavior is in p2-counters-state-1-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { faceKickerCosts, kickerNameOf } from '../../../src/parser/holes/p2cs1';
import p2cs1 from '../../../src/parser/templates/zz-cloud/p2-counters-state-1.json';
import review from '../../m5/golden/cards/p2-counters-state-1-review.json';
import m65 from '../../m5/golden/cards/m6-5-review.json'; // Cetavolver's entry is M6-5's, updated in place (guide section 6)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2cs1 as Template[];
const MECH_COUNT = 3;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Codex', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const typeOf = (t: Template, text: string): [string, [string, string] | undefined] =>
  t.id.startsWith('eff.') ? (/^(When|Whenever|At)\b/.test(text) ? ['Creature — Beast', ['2', '2']] : ['Sorcery', undefined]) : ['Creature — Beast', ['2', '2']];
const parsedWith = (t: Template, text: string) => { const [type, pt] = typeOf(t, text); return face(type, text, pt); };
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const abilitiesJson = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('p2-counters-state-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-counters-state-1.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-counters-state-1.json');
    expect(files.indexOf('zz-cloud/p2-counters-state-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-counters-state-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.p2cs1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|abl)\.p2cs1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has three or more hand-verified golden cards (tuning half)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    const evidence = [...golden, ...(m65 as { card: string; verified: string }[]).filter((g) => g.verified.includes('p2-counters-state-1 review'))];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = evidence.filter((g) => g.verified.includes(`(${t.id};`) || g.verified.includes(`(${t.id})`) || g.verified.includes(`(${t.id},`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'when']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-counters-state-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [[/ on it\b/, ' on target creature'], [/two /, 'three '], [/three /, 'four '], [/\+1\/\+1 for/, '+2/+2 for'], [/with its \{2\}\{G\} kicker/, 'with its {1}{G} kicker'], [/with its \{B\} kicker/, 'with its {W} kicker'], [/and with reach/, 'and with flying'], [/^Exile/, 'Destroy']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-counters-state-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('p2-counters-state-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example (not the counter kind, which is data) by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1;
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^\{/.test(w) || /^(counters?)$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-counters-state-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-counters-state-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment|permanent)\b/gi, '~').trim());
        }
      }
    }
    // the kicker line of a two-kicker example ("Kicker {2}{G} and/or {U}") is the keyword itself, not a sentence of a card
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !/^Kicker /.test(l) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- parser and renderer changes ------------------------------------------------------------------------------------------------------------------------

describe('p2-counters-state-1 render (CR 122.1): strict comparisons of the counters on an object', () => {
  it('"if ~ has fewer than three +1/+1 counters on it" is rendered with its comparison (it was rendered as a bare "3", which the gate refused)', () => {
    const f = face('Creature — Elemental', 'Whenever you cast a red spell, if ~ has fewer than three +1/+1 counters on it, put a +1/+1 counter on ~.', ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
    expect(abilitiesJson(f)).toContain('"counters":{"kind":"+1/+1","cmp":{"op":"<","value":3}}');
  });
  it('"more than two gloom counters on it" is "more than", and never the same JSON as "fewer than"', () => {
    const more = face('Creature — Elemental', 'Whenever you cast a red spell, if ~ has more than two gloom counters on it, you gain 1 life.', ['1', '1']);
    const fewer = face('Creature — Elemental', 'Whenever you cast a red spell, if ~ has fewer than two gloom counters on it, you gain 1 life.', ['1', '1']);
    expect(fullFace(more), JSON.stringify(more.gate)).toBe(true);
    expect(abilitiesJson(more)).toContain('"op":">","value":2');
    expect(jsonKey(more.abilities)).not.toBe(jsonKey(fewer.abilities));
  });
  it('a counted plural says "on them": "creatures you control with three or more +1/+1 counters on them have haste"', () => {
    const f = face('Enchantment', 'Creatures you control with three or more +1/+1 counters on them have haste.');
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
  });
});

describe('p2-counters-state-1 fail closed (CR 115.1, 122.1): "exile target creature with a gloom counter on it" has no template of this round', () => {
  it('the singular is also a description of the target (a creature that has a gloom counter), so this round reads only a counted plural ("with two ... counters")', () => {
    expect(abilitiesJson(face('Sorcery', 'Exile target creature with a gloom counter on it.'))).not.toContain('"counters":[{"kind":"gloom","count":1}]');
  });
});

describe('p2-counters-state-1 Cond (CR 122.1): "there are no <kind> counters on ~"', () => {
  it('reads as the counters of that kind on the object itself compared with 0, and renders back', () => {
    const f = face('Artifact', '{T}: Draw a card. If there are no gloom counters on ~, sacrifice it.');
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
    expect(abilitiesJson(f)).toContain('"cond":"compare","left":{"q":"counters","on":{"ref":"self"},"kind":"gloom"},"op":"==","right":0');
  });
  it('"there are no gloom counters on target artifact" is not this reading (only the object itself)', () => {
    expect(abilitiesJson(face('Artifact', '{T}: Draw a card. If there are no gloom counters on target artifact, sacrifice ~.'))).not.toContain('"kind":"gloom"},"op":"==","right":0');
  });
});

describe('p2-counters-state-1 kicker names (CR 702.33b, 702.33f): "kicked with its {M} kicker"', () => {
  it('the face\'s kicker costs are read in order, from one "and/or" line or from two lines; a multikicker line is not one of them', () => {
    expect(faceKickerCosts('Kicker {1}{R} and/or {G} (You may pay an additional {1}{R} and/or {G} as you cast this spell.)\nFlying')).toEqual(['{1}{r}', '{g}']);
    expect(faceKickerCosts('Kicker {1}{G}\nKicker {2}{U}\nWhen ~ enters, draw a card.')).toEqual(['{1}{g}', '{2}{u}']);
    expect(faceKickerCosts('Multikicker {1}{G}')).toEqual([]);
    expect(kickerNameOf(['{1}{r}', '{g}'], '{g}')).toBe('kicker:2');
    expect(kickerNameOf(['{1}{r}', '{g}'], '{1}{r}')).toBe('kicker');
    expect(kickerNameOf(['{1}{r}', '{g}'], '{u}')).toBeUndefined();
  });
  it('"When ~ enters, if it was kicked with its {G} kicker, ..." names the second kicker cost of the face (kicker:2)', () => {
    const f = face('Creature — Human Wizard', 'Kicker {1}{R} and/or {G}\nWhen ~ enters, if it was kicked with its {G} kicker, you gain 3 life.', ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilitiesJson(f)).toContain('"kicked":"kicker:2"');
  });
  it('fail closed: a kicker cost the face does not print stays manual (the marker is left over and the renderer refuses it)', () => {
    const f = face('Creature — Human Wizard', 'Kicker {1}{R} and/or {G}\nWhen ~ enters, if it was kicked with its {U} kicker, you gain 3 life.', ['2', '2']);
    expect(fullFace(f)).toBe(false);
    expect(abilitiesJson(f)).not.toContain('"kicked":"kicker@');
  });
  it('fail closed: a face with one kicker cost does not say "with its {G} kicker" (the wording names one of two costs)', () => {
    expect(fullFace(face('Creature — Human Wizard', 'Kicker {G}\nWhen ~ enters, if it was kicked with its {G} kicker, you gain 3 life.', ['2', '2']))).toBe(false);
  });
});

describe('p2-counters-state-1 render (CR 613.1f): the enters-with fold with a quoted grant', () => {
  it('"If ~ was kicked, it enters with two +1/+1 counters on it and with "Pay 2 life: ..."" (a non-keyword grant in quotes)', () => {
    const f = face('Creature — Beast', 'Kicker {2}{B}\nIf ~ was kicked, it enters with two +1/+1 counters on it and with "{T}: You gain 1 life."', ['2', '2']);
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
  });
});
