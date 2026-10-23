/**
 * std-rx15 (wave 2, slice s12): the template data of parser/templates/zz-cloud/std-rx15.json and the round's parser, renderer and engine support: the keyword
 * quality "protection from each of your opponents" (parser/holes/misc.ts#qualityAt, rules/quality.ts, rules/protection.ts, render/kw.ts); the keyword devour with
 * an optional permanent type (keywords/data/devour.json, parser/holes/misc.ts#paramParses, effects/bodies/m5.ts#devour); an event object described as "nontoken" is
 * never "that token" (parser/lower/scope.ts); render families becomes-with-base-and (render/mods.ts) and self-keyword-abilities-possessive (render/stat.ts). Guard G9
 * (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-rx15-scenarios.test.ts. CR cites from memory, unverified (rules/cr/
 * is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { parseQuality, qualityText } from '../../../src/rules/quality';
import stdRx15 from '../../../src/parser/templates/zz-cloud/std-rx15.json';
import review from '../../m5/golden/cards/cloud-std-rx15-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX15 = stdRx15 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'eff.stdrx15.becomes.subtype.basept.permanent': 'Creature — Elf',
  'eff.stdrx15.becomes.subtype.basept.with.permanent': 'Creature — Elf',
  'sta.stdrx15.self.equipAbilities.costLess': 'Artifact — Equipment',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, pt?: [string, string]) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const level = (type: string, text: string, pt?: [string, string]): string => compiled(type, text, pt).automation.level;

describe('std-rx15 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx15.json, after zz-cloud/std-rw6.json, before zz-cloud/std-rx9.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx15.json');
    expect(files.indexOf('zz-cloud/std-rx15.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rw6.json'));
    expect(files.indexOf('zz-cloud/std-rx15.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX15.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of RX15) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdrx15\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (one or two Oracle cards each in the whole index): stable on one hand-verified golden card plus these tests and the scenarios, a 6.9
    // deviation named in the round record and the PR
    expect(goldenUsing('eff.stdrx15.becomes.subtype.basept.permanent')).toEqual(['Figure of Fable']);
    expect(goldenUsing('eff.stdrx15.becomes.subtype.basept.with.permanent')).toEqual(['Figure of Fable']);
    expect(goldenUsing('sta.stdrx15.self.equipAbilities.costLess')).toEqual(['Firion, Wild Rose Warrior']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX15) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx15 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX15) {
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
  const out = [`${body} unless it is blue.`, `${body} twice.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bbase power and toughness\b/, 'power and toughness'], [/\bwith base\b/, 'without base'], [/\bequip abilities\b/, 'crew abilities'],
    [/\bless to activate\b/, 'more to activate'], [/ and trample\b/, ' and loses trample'], [/\bprotection from each of your opponents\b/, 'protection from each opponent'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx15 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX15) {
    it(`${t.id}: an appended condition or duration, or a swapped key word, never gives the example's JSON`, () => {
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

describe('std-rx15 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX15) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword or another ability of the card)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx15 keyword quality "protection from each of your opponents" (CR 702.16b-f)', () => {
  it('is read on a keyword line, in a granted list and in a "with" list, as the quality player:opponents, and said back in the same words', () => {
    expect(parseQuality('each of your opponents')).toBe('player:opponents');
    expect(qualityText('player:opponents')).toBe('each of your opponents');
    for (const [type, text] of [
      ['Creature — Elf', 'Protection from each of your opponents'],
      ['Instant', 'Target creature you control gains protection from each of your opponents until end of turn.'],
    ] as const) {
      const d = compiled(type, text, type.startsWith('Creature') ? ['2', '2'] : undefined);
      expect(d.automation.level, text).toBe('full');
      expect(JSON.stringify(d.faces), text).toContain('"keyword":"protection","quality":"player:opponents"');
    }
  });
  it('fails closed: protection from one opponent, from a named player or from "each opponent" is no such quality', () => {
    expect(parseQuality('an opponent')).toBeNull();
    expect(parseQuality('each opponent')).toBeNull();
    expect(level('Creature — Elf', 'Protection from the chosen player', ['2', '2'])).not.toBe('full');
  });
});

describe('std-rx15 keyword devour (CR 702.82a-b)', () => {
  const keywordOf = (text: string) => JSON.stringify(compiled('Creature — Beast', text, ['1', '1']).faces);
  it('"Devour N" devours creatures; "Devour <type> N" a card type or a subtype; each expands to one entering replacement', () => {
    expect(level('Creature — Beast', 'Devour 2', ['1', '1'])).toBe('full');
    expect(keywordOf('Devour 2')).toContain('"keyword":"devour","amount":2');
    expect(level('Creature — Beast', 'Devour land 3', ['1', '1'])).toBe('full');
    expect(keywordOf('Devour land 3')).toContain('"keyword":"devour","filter":{"types":["Land"]},"amount":3');
    expect(keywordOf('Devour artifact 1')).toContain('"filter":{"types":["Artifact"]},"amount":1');
    expect(keywordOf('Devour Treasure 2')).toContain('"filter":{"subtypes":["Treasure"]},"amount":2');
  });
  it('fails closed: "Devour X, where X is ..." (a count of what it devoured) and a devour with no amount stay manual', () => {
    expect(level('Creature — Beast', 'Devour X, where X is the number of creatures devoured this way', ['1', '1'])).not.toBe('full');
    expect(level('Creature — Beast', 'Devour land', ['1', '1'])).not.toBe('full');
  });
});

describe('std-rx15 parser: an event object described as "nontoken" is never "that token" (CR 111.1, 608.2c, design 6.4)', () => {
  it('after a copy of the entering nontoken permanent, "that token" is the copy', () => {
    for (const sub of ['Equipment', 'Aura', 'artifact']) {
      const text = `Whenever a nontoken ${sub} you control enters, create a token that's a copy of it, except it has haste. Sacrifice that token at the beginning of the next end step.`;
      expect(level('Enchantment', text), text).toBe('full');
    }
  });
  it('fails closed: with no token created, "that token" after a nontoken event object names nothing', () => {
    expect(level('Enchantment', 'Whenever a nontoken Equipment you control enters, sacrifice that token.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx15 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx15 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // (a line that is only a keyword ability, "Equip {3}", gives the example its card type and is not the template's)
    const context = /^(Flying|Reach|Trample|Vigilance|Equip \{\d\})$/;
    const verbatim = RX15.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
