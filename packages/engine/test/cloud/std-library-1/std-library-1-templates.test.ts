/**
 * std-library-1 (account B lane std-library: library and graveyard sequences): the template data of parser/templates/zz-cloud/std-library-1.json and the round's
 * other parser, lowering, renderer and engine changes:
 *  - `chooseObjects.distinct` (types/ability.ts, effects/handlers/choose.ts#pickDistinct; CR 208.1, 608.2d): "put any number of <cards> with different powers from
 *    among them into your hand", rendered by render/fold.ts#putAnyFromGroup (a property of the set, said like FAST5 T66's total);
 *  - Obj (parser/holes/object.ts): a target group limit ("with total mana value X or less") followed by "from that player's graveyard" (CR 115.1, 404.1);
 *  - lowering (parser/lower/targets.ts#STEP_DELAY_LEADS, parser/lower/conditions.ts#lowerDelayTargets; CR 603.7, 603.3d): a step-timed delayed trigger written
 *    with a lead template takes its own targets, chosen when it triggers; the lead "At the beginning of the next combat phase this turn," (render/steps-lasting.ts);
 *  - promotions (design 6.9 deviations, narrow wordings, named in the round record): eff.r4dig.reveal.top.whereX (6 index cards print it; golden Rip, Spawn Hunter
 *    and Majestic Genesis) and eff.t43.dig.exile (4 index cards; golden Feral Encounter).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-library-1-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdLibrary1 from '../../../src/parser/templates/zz-cloud/std-library-1.json';
import review from '../../m5/golden/cards/cloud-std-library-1-review.json';
import r4DigReview from '../../m5/golden/cards/cloud-r4-dig-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const LIB1 = stdLibrary1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|this creature|^\{/m.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);

const IDS = ['eff.stdlib1.dig.anyNumber.differentPowers.hand', 'dl.stdlib1.nextCombat.thisTurn.lead'];

describe('std-library-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-library-1.json, after zz-cloud/std-lci.json, before zz-cloud/std-misc.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-library-1.json');
    expect(files.indexOf('zz-cloud/std-library-1.json')).toBe(files.indexOf('zz-cloud/std-lci.json') + 1);
    expect(files.indexOf('zz-cloud/std-library-1.json')).toBeLessThan(files.indexOf('zz-cloud/std-misc.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(LIB1.map((t) => t.id)).toEqual(IDS);
    for (const t of LIB1) {
      expect(t.id, t.id).toMatch(/^(eff|dl)\.stdlib1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
    // narrow wordings (one Standard card each prints them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named
    // in the round record
    expect(goldenUsing('eff.stdlib1.dig.anyNumber.differentPowers.hand')).toEqual(['Rip, Spawn Hunter']);
    expect(goldenUsing('dl.stdlib1.nextCombat.thisTurn.lead')).toEqual(['Feral Encounter']);
  });
  it('design 6.9 promotions (narrow wordings, a deviation named in the round record): eff.r4dig.reveal.top.whereX and eff.t43.dig.exile are stable with their golden cards', () => {
    const status = (id: string) => TEMPLATE_SET.find((t) => t.id === id)?.status;
    expect(status('eff.r4dig.reveal.top.whereX')).toBe('stable');
    // evidence in the template's own round's review file (guide section 6), and Rip, Spawn Hunter in this round's
    expect(goldenUsing('eff.r4dig.reveal.top.whereX', r4DigReview as Golden)).toEqual(['Majestic Genesis']);
    expect(goldenUsing('eff.r4dig.reveal.top.whereX')).toEqual(['Rip, Spawn Hunter']);
    expect(status('eff.t43.dig.exile')).toBe('stable');
    expect(goldenUsing('eff.t43.dig.exile')).toEqual(['Feral Encounter']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of LIB1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'different']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-library-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of LIB1) {
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
        const f = face(c, typeOf(t.examples[0]!.text));
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
    [/\bwith different powers\b/, 'with different toughnesses'], [/\bwith different powers\b/, 'with the same power'], [/\binto your hand\b/, 'into your graveyard'],
    [/\bany number of\b/, 'up to two'], [/\bthe next combat phase this turn\b/, 'the next combat phase'], [/\bthe next combat phase this turn\b/, 'each combat phase this turn'],
    [/\bthe next combat phase\b/, 'the next end step'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-library-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of LIB1) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-library-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of LIB1) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-library-1 Obj (parser/holes/object.ts): a target group limit, then "from <another player>\'s graveyard" (CR 115.1, 404.1, 400.3)', () => {
  const TRIGGER = 'Whenever this creature deals combat damage to a player, you may pay {X}. When you do, put any number of target creature cards with total mana value X or less';
  it('"from that player\'s graveyard": the graveyard of the damaged player, the total read from the X paid', () => {
    const text = `${TRIGGER} from that player's graveyard onto the battlefield under your control.`;
    expect(level('Creature — Human', text)).toBe('full');
    const j = json('Creature — Human', text);
    expect(j).toContain('"zone":"graveyard","owner":{"ref":"event","role":"recipient"}');
    expect(j).toContain('"groupLimit":{"stat":"manaValue","cmp":{"op":"<=","value":{"q":"X"}}}');
  });
  it('"from your graveyard" keeps its own (Cloud std-eoe) reading; a zone that is not a graveyard, or a graveyard of no player, is not read', () => {
    expect(json('Sorcery', 'Return up to three target creature cards with total mana value 3 or less from your graveyard to the battlefield.')).toContain('"zone":"graveyard","owner":"you"');
    expect(level('Creature — Human', `${TRIGGER} from that player's hand onto the battlefield under your control.`)).not.toBe('full');
    expect(level('Creature — Human', `${TRIGGER} from a graveyard onto the battlefield under your control.`)).not.toBe('full');
  });
});

describe('std-library-1 lowering (CR 603.7, 603.3d): the delayed trigger of the next combat phase takes its own targets', () => {
  it('"At the beginning of the next combat phase this turn, target creature ...": the targets are the delay\'s, none is announced with the spell', () => {
    const f = compiled('Sorcery', "Draw a card. At the beginning of the next combat phase this turn, target creature you control deals damage equal to its power to up to one target creature you don't control.");
    expect(f.automation.level).toBe('full');
    const spell = f.faces[0]!.abilities[0] as { effect: { targets: unknown[]; steps: { op: string; targets?: unknown[] }[] } };
    expect(spell.effect.targets).toEqual([]);
    expect(spell.effect.steps.find((s) => s.op === 'delay')?.targets).toHaveLength(2);
  });
  it('the end step leads keep their reading: a target in the delayed sentence stays manual (train-1 bounce, Swooping Pteranodon); the tail form announces it with the spell', () => {
    expect(level('Sorcery', 'Draw a card. At the beginning of the next end step, target player draws a card.')).not.toBe('full');
    const tail = compiled('Sorcery', 'Target player draws three cards at the beginning of the next end step.');
    expect((tail.faces[0]!.abilities[0] as { effect: { targets: unknown[] } }).effect.targets).toHaveLength(1);
  });
  it('a target used both inside and outside the delayed trigger stays manual', () => {
    expect(level('Sorcery', 'Tap target creature. At the beginning of the next end step, untap that creature and target creature.')).not.toBe('full');
  });
});

describe('std-library-1 renderer support (G6: the render gate is exact)', () => {
  it('render/fold.ts#putAnyFromGroup: "with different powers" is said; a choice without the words never passes for one with them', () => {
    expect(level('Sorcery', 'Reveal the top six cards of your library. Put any number of creature cards with different powers from among them into your hand. Put the rest into your graveyard.')).toBe('full');
    expect(level('Sorcery', 'Reveal the top six cards of your library. Put any number of creature cards from among them into your hand. Put the rest into your graveyard.')).not.toBe('full');
  });
  it('render/steps-lasting.ts: only the next combat phase of this turn, once (not "each combat this turn", which keeps its own lead)', () => {
    expect(json('Sorcery', 'Draw a card. At the beginning of each combat this turn, creatures you control get +1/+0 until end of turn.')).not.toContain('"once":true');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-library-1 design 6.10 (local index): synthetic examples', () => {
  it('no std-library-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = LIB1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
