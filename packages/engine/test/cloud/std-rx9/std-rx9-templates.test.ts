/**
 * std-rx9 (wave 2, slice s18): the template data of parser/templates/zz-cloud/std-rx9.json and the round's parser, renderer and engine support: "the chosen type"
 * inside an emblem the same ability creates (parser/lower/quoted.ts, lower/links.ts#resolveEmblemChoices, effects/handlers/game.ts#emblemLinks, core/emblems.ts);
 * render families enters-choose-then-pay (render/stat.ts), chosen-basic-land-type-words and cast-spells-or-cards-using-their (render/mods.ts). Guard G9
 * (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx9-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx9 from '../../../src/parser/templates/zz-cloud/std-rx9.json';
import review from '../../m5/golden/cards/cloud-std-rx9-review.json';
import ecl from '../../m5/golden/cards/cloud-std-ecl-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX9 = stdRx9 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'rep.stdrx9.enters.choose.landtype.tappedUnlessPay': 'Land',
  'sta.stdrx9.self.chosenLandType': 'Land',
  'sta.stdrx9.cast.graveyard.usingTheir.sneak': 'Enchantment',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const level = (type: string, text: string, loyalty?: string): string =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(loyalty ? { loyalty } : {}) } as OracleCard).automation.level;

describe('std-rx9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx9.json, after zz-cloud/std-rp.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx9.json');
    expect(files.indexOf('zz-cloud/std-rx9.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rx9.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX9.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of RX9) {
      expect(t.id, t.id).toMatch(/^(rep|sta)\.stdrx9\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (one Oracle card each in the whole index): stable on one hand-verified golden card plus these tests and the scenarios, a 6.9
    // deviation named in the round record and the PR
    expect(goldenUsing('rep.stdrx9.enters.choose.landtype.tappedUnlessPay')).toEqual(['Multiversal Passage']);
    expect(goldenUsing('sta.stdrx9.self.chosenLandType')).toEqual(['Multiversal Passage']);
    expect(goldenUsing('sta.stdrx9.cast.graveyard.usingTheir.sneak')).toEqual(['Ninja Teen']);
    // the emblem fix made Oko full: its std-ecl golden entry was updated, not duplicated (CONTRIBUTING, design 6.12)
    expect(goldenUsing('eff.e27.emblem.you', ecl as Golden)).toEqual(['Oko, Lorwyn Liege // Oko, Shadowmoor Scion']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX9) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx9 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX9) {
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
    [/\bdon't\b/, 'do'], [/\bbasic land type\b/, 'creature type'], [/\bgraveyard using\b/, 'hand using'], [/\bsneak abilities\b/, 'warp abilities'],
    [/\bThen you may\b/, 'Then'], [/\bcreature cards from\b/, 'artifact cards from'], [/\bchosen basic land type\.$/, 'chosen basic land type until end of turn.'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX9) {
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

describe('std-rx9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX9) {
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

describe('std-rx9 parser and engine support: "the chosen type" inside an emblem (CR 114.2, 607.2d, 608.2c)', () => {
  const PW = 'Legendary Planeswalker — Testwalker';
  it('the emblem\'s "chosen type" is the choice an earlier instruction of the same ability made (its link), never the source\'s entering choice', () => {
    for (const text of [
      '-6: Choose a creature type. You get an emblem with "Creatures you control of the chosen type get +3/+3."',
      '-6: Choose a creature type. You get an emblem with "Creatures you control of the chosen type get +3/+3 and have vigilance."',
      '-6: Choose a creature type. You get an emblem with "Creatures you control of the chosen type have hexproof."',
    ]) {
      const f = face('x', text, PW);
      expect(fullyAutomated(f), text).toBe(true);
      const s = JSON.stringify(f.abilities);
      expect(s, text).toContain('"op":"chooseValue","who":{"ref":"you"},"what":"creatureType","as":"chosenCreatureType","link":"chosenCreatureType"');
      expect(s, text).toContain('"chosen":{"link":"chosenCreatureType","quality":"creatureType"}');
      expect(s, text).not.toContain('"link":"type"');
    }
  });
  it('fails closed: an emblem with "the chosen type" and no choice of that kind before it, a choice of another kind, or a quoted ability granted to a creature', () => {
    expect(level(PW, '-6: You get an emblem with "Creatures you control of the chosen type get +3/+3."', '3')).not.toBe('full');
    expect(level(PW, '-6: Choose a color. You get an emblem with "Creatures you control of the chosen type have vigilance."', '3')).not.toBe('full');
    expect(level('Sorcery', 'Choose a creature type. Creatures you control gain "Creatures you control of the chosen type have vigilance." until end of turn.')).toBe('manual');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx9 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const context = /^(Flying|Reach|Trample|Vigilance|Enchant creature|Equip \{\d\}|~ enters tapped\.|As ~ enters, choose a basic land type\.)$/;
    const verbatim = RX9.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
