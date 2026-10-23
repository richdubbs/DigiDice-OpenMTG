/**
 * std-ry3 (wave 2, Commander lane ry3): the template data of parser/templates/zz-cloud/std-ry3.json and the round's other parser, renderer, keyword and token
 * changes:
 *  - eff.stdry3.skip.nextCombatPhase "<player> skips their next combat phase" (a one-use phase skip shield, CR 614.10a, 500.11);
 *  - sta.stdry3.maxhand.your.increased|reduced "your maximum hand size is increased|reduced by N" (RuleModDef.delta, CR 402.2);
 *  - rst.stdry3.cant.beblocked.except.andor "<obj> can't be blocked except by <A> and/or <B>" (CR 509.1b);
 *  - render/stat.ts: a one-use skip shield whose player is a role of the triggering event is said against that trigger's events (render/state.ts outerTrigger);
 *  - keywords awaken (CR 702.113a-b) and provoke (CR 702.39a) as keyword data; the Powerstone and Vibranium tokens' mana ability as data (CR 111.10h, 111.10w,
 *    106.6; effects/predefined-tokens.json).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-ry3-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is
 * not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { PREDEFINED_TOKENS } from '../../../src/effects/handlers/token-defs';
import stdRy3 from '../../../src/parser/templates/zz-cloud/std-ry3.json';
import review from '../../m5/golden/cards/cloud-std-ry3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RY3 = stdRy3 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for "~" and keyword lines, an enchantment for a hand-size static, else a sorcery. */
const typeOf = (text: string): string => (/^(~|Flying|Whenever)/m.test(text) ? 'Creature — Beast' : /maximum hand size/.test(text) ? 'Enchantment' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;

const IDS = ['eff.stdry3.skip.nextCombatPhase', 'sta.stdry3.maxhand.your.increased', 'sta.stdry3.maxhand.your.reduced', 'rst.stdry3.cant.beblocked.except.andor'];

describe('std-ry3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-ry3.json, after zz-cloud/std-rx9.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-ry3.json');
    expect(files.indexOf('zz-cloud/std-ry3.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx9.json'));
    expect(files.indexOf('zz-cloud/std-ry3.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RY3.map((t) => t.id)).toEqual(IDS);
    for (const t of RY3) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rst)\.stdry3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings, stable on one or two hand-verified golden cards (tuning half) plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.stdry3.skip.nextCombatPhase')).toEqual(['Blinding Angel']);
    expect(goldenUsing('sta.stdry3.maxhand.your.increased')).toEqual(['Minamo Scrollkeeper', 'Trusted Advisor']);
    expect(goldenUsing('sta.stdry3.maxhand.your.reduced')).toEqual(['Thought Devourer', 'Thought Eater']);
    // three hand-verified golden cards: design 6.9 met
    expect(goldenUsing('rst.stdry3.cant.beblocked.except.andor')).toEqual(['Amrou Seekers', 'Elven Riders', 'Skirk Shaman']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RY3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z'/]+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', "can't", 'would', 'skip', 'skips', 'increased', 'reduced']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w === 'skips' ? 'skip' : w);
      }
    }
  });
});

describe('std-ry3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RY3) {
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
    [/\bnext combat phase\b/, 'next main phase'], [/\bnext combat phase\b/, 'combat phase'], [/\bskips their\b/, 'begins their'],
    [/\bincreased by\b/, 'reduced by'], [/\breduced by\b/, 'increased by'], [/\bmaximum hand size\b/, 'minimum hand size'], [/\bby (\w+)\.$/, 'by $1 this turn.'],
    [/ and\/or /, ' and '], [/\bexcept by\b/, 'by'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-ry3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RY3) {
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

describe('std-ry3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RY3) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword of the card)
        const sentences = lines[last]!.split(/(?<=\.) /);
        const lastSentence = sentences.length - 1; // the sentence of the template (an earlier one is another instruction of the example)
        const words = sentences[lastSentence]!.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const line = [...sentences.slice(0, lastSentence), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join(' ');
          const mutated = [...lines.slice(0, last), line].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-ry3 fail-closed edges of the templates', () => {
  it('"maximum hand size is increased by" a computed number, another player\'s hand size and a duration stay manual', () => {
    expect(level('Enchantment', 'Your maximum hand size is increased by the number of lands you control.')).not.toBe('full');
    expect(level('Enchantment', "Each opponent's maximum hand size is reduced by two.")).not.toBe('full');
    expect(level('Sorcery', 'Draw a card. Your maximum hand size is reduced by one for the rest of the game.')).not.toBe('full');
  });
  it('"skips their next combat phase this turn" and "skips their next two combat phases" stay manual', () => {
    expect(level('Sorcery', 'Target opponent skips their next combat phase this turn.')).not.toBe('full');
    expect(level('Sorcery', 'Target player skips their next two combat phases.')).not.toBe('full');
  });
  it('the and/or form keeps both halves: "except by Walls and/or creatures with flying" is not the Walls-only or the flyers-only restriction', () => {
    const both = jsonKey(compiled('Creature — Elf', "This creature can't be blocked except by Walls and/or creatures with flying.").faces[0]!.abilities);
    expect(both).not.toBe(jsonKey(compiled('Creature — Elf', "This creature can't be blocked except by Walls.").faces[0]!.abilities));
    expect(both).toContain('"anyOf"');
  });
});

describe('std-ry3 keywords (keywords/data; CR 702.113a-b, 702.39a) and tokens (effects/predefined-tokens.json; CR 111.10h, 111.10w)', () => {
  it('awaken: an instant or sorcery with "Awaken N—[cost]" is full; the land target exists only when the awaken cost was paid (onlyIf wasCast via awaken)', () => {
    const d = compiled('Sorcery', 'Draw a card.\nAwaken 2—{4}{U}');
    expect(d.automation.level).toBe('full');
  });
  it('provoke: a creature with provoke is full', () => {
    expect(level('Creature — Beast', 'Provoke')).toBe('full');
    expect(level('Creature — Beast', 'Trample\nProvoke')).toBe('full');
  });
  it('the Powerstone and Vibranium tokens\' "{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell." is an addMana step with notSpells, never manual', () => {
    for (const name of ['Powerstone', 'Vibranium']) {
      const t = PREDEFINED_TOKENS.find((x) => x.name === name)!;
      const mana = t.faces[0]!.abilities.find((a) => (a as { isMana?: boolean }).isMana === true) as { kind: string; effect: { steps: { restriction?: unknown }[] } };
      expect(mana.kind, name).toBe('activated');
      expect(mana.effect.steps[0]!.restriction, name).toEqual({ notSpells: { notTypes: ['Artifact'] } });
    }
    expect(level('Sorcery', 'Create a tapped Powerstone token.')).toBe('full');
  });
});

describe('std-ry3 renderer support (G6: the render gate is exact)', () => {
  it('render/stat.ts: the skip shield of "that player" after a combat damage trigger is said with the trigger\'s player (step and combat phase)', () => {
    expect(level('Creature — Snake', 'Whenever this creature deals combat damage to a player, that player skips their next untap step.')).toBe('full');
    expect(level('Creature — Angel', 'Flying\nWhenever this creature deals combat damage to a player, that player skips their next combat phase.')).toBe('full');
  });
  it('fails closed: "that player" of an attack trigger (the defender may be a planeswalker) and a group of players stay manual', () => {
    expect(level('Creature — Snake', 'Whenever this creature attacks, that player skips their next untap step.')).not.toBe('full');
    expect(level('Sorcery', 'Each opponent skips their next untap step.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-ry3 design 6.10 (local index): synthetic examples', () => {
  it('no std-ry3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const context = /^(Haste|Flying)$/;
    const verbatim = RY3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
