/**
 * std-rx2 (wave 2 slice s25): the template data of parser/templates/zz-cloud/std-rx2.json ("If a creature attacking causes a triggered ability of a permanent you
 * control to trigger, that ability triggers an additional time", CR 603.2d, 508.1m) and its renderer reading (render/stat.ts#causeText, "<creature> attacking").
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-rx2-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is
 * not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOf } from '../../../src/index';
import stdRx2 from '../../../src/parser/templates/zz-cloud/std-rx2.json';
import review from '../../m5/golden/cards/cloud-std-rx2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX2 = stdRx2 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'sta.stdrx2.triggerMod.attacking': 'Enchantment',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? (/^Equipped creature/.test(text) || /Equip \{/.test(text) ? 'Artifact — Equipment' : TYPE[id] ?? 'Sorcery');
  return parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-rx2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx2.json, after zz-cloud/std-rp.json, before zz-cloud/std-sos.json; after std-rx19, before std-rx21) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx2.json');
    expect(files.indexOf('zz-cloud/std-rx2.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rx2.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX2.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of RX2) {
      expect(t.id, t.id).toMatch(/^sta\.stdrx2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // a narrow wording (Windcrag Siege, Standard; the other two index cards that print it, Isshin, Two Heavens as One and Wulfgar of Icewind Dale, are held out
    // and were opened for verification only): stable on one hand-verified golden card plus these tests and the scenarios, a 6.9 deviation named in the round record
    expect(goldenUsing('sta.stdrx2.triggerMod.attacking')).toEqual(['Windcrag Siege']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX2) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX2) {
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
    [/\+X\/\+X/, '+X/+0'], [/-X\/-X/, '-X/-0'], [/\btapped\b/, 'untapped'], [/\bonly if\b/, 'unless'], [/\bthis turn as though\b/, 'as though'],
    [/\bdefender\.$/, 'flying.'], [/\btheir library\b/, 'your library'], [/\bgraveyard\.$/, 'hand.'], [/\bequal to\b/, 'for each'], [/\bcopies\b/, 'tokens'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX2) {
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

describe('std-rx2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX2) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword or a reminder of the card type)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx2 capability (model/cap-walk.ts, triggers/collect.ts)', () => {
  it('CR 603.2d, 508.1m: a creature attacking is `feature:triggerMod.attacks`, registered; an attack cause with a defender or "alone" is not', () => {
    const f = face('sta.stdrx2.triggerMod.attacking', RX2[0]!.examples[0]!.text);
    expect(capabilitiesOf(f.abilities[0]!)).toContain('feature:triggerMod.attacks');
    expect(ENGINE_CAPABILITIES.has('feature:triggerMod.attacks')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:triggerMod.cause.attacks')).toBe(false);
  });
  it('design 6.3: the entering templates of M6-12 keep their sentences', () => {
    const f = face('x', 'If an artifact entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', 'Artifact');
    expect(f.templatesUsed).toContain('sta.m6.triggerMod.entering');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx2 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // (a line that is only a keyword ability, "Flying", "Enchant creature", "Equip {3}", gives the example its card type and is not the template's)
    const context = /^(Flying|Reach|Trample|Vigilance|Enchant creature|Equip \{\d\})$/;
    const verbatim = RX2.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
