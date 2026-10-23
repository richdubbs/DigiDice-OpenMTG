/**
 * std-ry6 (wave 2, Commander lane ry6): the template data of parser/templates/zz-cloud/std-ry6.json and the round's other parser and renderer changes:
 *  - templates "~ can't attack alone" / "~ can't block alone" (CR 506.5; one action of FAST5 T37's "can't attack or block alone");
 *  - render/refs.ts: what targeted the object in "becomes the target of a spell or ability" is "that spell or ability" (CR 115.1; Glyph Keeper, Lava Runner);
 *  - parser/holes/filter.ts: "target enchanted <type>" is a description (ObjectFilter.enchanted, CR 303.4b; Ramses Overdark);
 *  - parser/lower/mentions.ts and render/steps-cards.ts: "the milled card" after ONE player mills ONE card (CR 701.17a, 608.2h; Heed the Mists, Mindshrieker).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-ry6-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is
 * not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRy6 from '../../../src/parser/templates/zz-cloud/std-ry6.json';
import review from '../../m5/golden/cards/cloud-std-ry6-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RY6 = stdRy6 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

const TYPE = 'Creature — Beast';
const face = (text: string, type = TYPE) =>
  parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;
const json = (type: string, text: string): string => JSON.stringify(compiled(type, text).faces[0]!.abilities);

const IDS = ['sta.stdry6.self.cantAttackAlone', 'sta.stdry6.self.cantBlockAlone'];

describe('std-ry6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-ry6.json, after zz-cloud/std-ry10.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-ry6.json');
    expect(files.indexOf('zz-cloud/std-ry6.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-ry10.json'));
    expect(files.indexOf('zz-cloud/std-ry6.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RY6.map((t) => t.id)).toEqual(IDS);
    for (const t of RY6) {
      expect(t.id, t.id).toMatch(/^sta\.stdry6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // "can't attack alone": two hand-verified golden cards (tuning half); "can't block alone": one (a narrow wording, a 6.9 deviation named in the round record)
    expect(goldenUsing('sta.stdry6.self.cantAttackAlone')).toEqual(['Raging Kronch', 'Trusty Companion']);
    expect(goldenUsing('sta.stdry6.self.cantBlockAlone')).toEqual(['Craven Hulk']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RY6) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', "can't", 'alone']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-ry6 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RY6) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
      }
      for (const c of t.counterExamples) {
        const f = face(c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('std-ry6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RY6) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        const body = e.text.replace(/\.$/, '');
        for (const m of [`${body} unless it is blue.`, `${body} this turn.`, e.text.replace(' alone', ''), e.text.replace("can't", 'can'), e.text.replace(/attack|block/, 'tap')]) {
          if (m === e.text) continue;
          const f = face(m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-ry6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RY6) {
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

describe('std-ry6 render/refs.ts (CR 115.1): "that spell or ability" for what targeted the object', () => {
  it('"counter that spell or ability" and "that spell or ability\'s controller" are full, with the event\'s spell role', () => {
    const counter = 'Whenever this creature becomes the target of a spell or ability, counter that spell or ability.';
    expect(level(TYPE, counter)).toBe('full');
    expect(json(TYPE, counter)).toContain('"op":"counter","what":{"ref":"event","role":"spell"}');
    const loses = "Whenever this creature becomes the target of a spell or ability, that spell or ability's controller loses 2 life.";
    expect(level(TYPE, loses)).toBe('full');
    expect(json(TYPE, loses)).toContain('{"ref":"controllerOf","object":{"ref":"event","role":"spell"}}');
  });
});

describe('std-ry6 parser/holes/filter.ts (CR 303.4b): "target enchanted <type>" is a description', () => {
  it('"destroy target enchanted creature": the target is a creature with an Aura attached (`enchanted: true`), not the source\'s own host', () => {
    const text = '{T}: Destroy target enchanted creature.';
    expect(level('Creature — Human', text)).toBe('full');
    const j = json('Creature — Human', text);
    expect(j).toMatch(/"filter":\{("enchanted":true,"types":\["Creature"\]|"types":\["Creature"\],"enchanted":true)\}/);
    expect(j).not.toContain('attachedTo');
  });
  it('on an Aura, "enchanted creature" alone is still the creature it enchants (`attachedTo`)', () => {
    expect(json('Enchantment — Aura', 'Enchant creature\n{T}: Destroy enchanted creature.')).toContain('{"ref":"attachedTo"}');
  });
});

describe('std-ry6 the milled card (parser/lower/mentions.ts, render/steps-cards.ts; CR 701.17a, 608.2h)', () => {
  it('"Mill a card, then draw cards equal to the milled card\'s mana value": the stat of the mill\'s binding; also after a target player\'s mill', () => {
    const text = "Mill a card, then draw cards equal to the milled card's mana value.";
    expect(level('Sorcery', text)).toBe('full');
    expect(json('Sorcery', text)).toContain('"count":{"q":"stat","stat":"manaValue","of":{"ref":"bound","name":"them"}}');
    expect(level('Sorcery', "Target player mills a card. You gain life equal to the milled card's mana value.")).toBe('full');
  });
  it('fails closed: a mill of two cards, or by each player, has no "the milled card"', () => {
    expect(level('Sorcery', "Mill two cards, then draw cards equal to the milled card's mana value.")).not.toBe('full');
    expect(level('Sorcery', "Each player mills a card. You gain life equal to the milled card's mana value.")).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-ry6 design 6.10 (local index): synthetic examples', () => {
  it('no std-ry6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = RY6.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
