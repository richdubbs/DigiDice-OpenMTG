/**
 * Card wave 2 round std-rw8 (slice s8): the template data of parser/templates/zz-cloud/std-rw8.json (an activation cost part that is a choice between two costs) and
 * the parser, lint, engine and renderer changes of the round: "that creature" for what an optional payment sacrificed, read inside the reflexive trigger that waits
 * for it; "If excess damage was dealt this way" after a reflexive trigger's damage; "When you do" after a payment of one of two costs. Guard G9 (design 6.8): every
 * example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. The behavior is in std-rw8-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRw8 from '../../../src/parser/templates/zz-cloud/std-rw8.json';
import review from '../../m5/golden/cards/cloud-std-rw8-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRw8 as Template[];
const MECH_COUNT = 1;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** An example of a cost template is a whole activated ability, or one cost part put in front of "Draw a card." (CR 602.1a). */
const abilityText = (t: Template, text: string): string => (t.kind === 'cost' && !text.includes(':') ? `{1}, ${text}: Draw a card.` : text);
/** Fully automated, a manual cost part included (support.ts#fullyAutomated looks at effects and abilities only). */
const noManualCost = (f: ReturnType<typeof parseCard>['faces'][number]): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
const parsedWith = (t: Template, text: string) => parseCard(card('Example Brute', 'Creature — Elf Warrior', abilityText(t, text), { power: '3', toughness: '3' }), OPTS).faces[0]!;

describe('std-rw8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rw8.json, after std-rp.json, before std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rw8.json');
    expect(files.indexOf('zz-cloud/std-rw8.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rw8.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are cost.stdrw8.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^cost\.stdrw8\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, a hand-verified golden card that uses it (narrow wording: one printed card; a 6.9 deviation named in the record)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
});

describe('std-rw8 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect((bare(f.abilities) as { cost: { other: unknown } }[])[0]!.cost.other, e.text).toEqual((e.expect as { other: unknown }).other);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(noManualCost(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const out = [`${text} unless it is blue`, `${text} at random`, `${text} twice`, `${text} or pay 2 life`];
  const swaps: [RegExp, string][] = [[/\bor\b/, 'and'], [/\bcreature\b/, 'artifact'], [/\bnonland\b/, 'land'], [/\bdiscard\b/, 'exile']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rw8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/at random/twice/or <cost>" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const cost = e.text.includes(':') ? e.text.slice(e.text.indexOf(' ', e.text.lastIndexOf('}')) + 1, e.text.indexOf(':')) : e.text;
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(cost)) {
          const f = parsedWith(t, e.text.includes(':') ? e.text.replace(cost, m) : m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rw8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const text = abilityText(t, e.text);
        const words = text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(noManualCost(parseCard(card('Example Brute', 'Creature — Elf Warrior', mutated, { power: '3', toughness: '3' }), OPTS).faces[0]!), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rw8 design 6.10 (local index): synthetic examples', () => {
  it('no std-rw8 example, counter-example or test sentence is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const texts = [...MECH.flatMap((t) => [...t.examples.map((e) => abilityText(t, e.text)), ...t.counterExamples.map((c) => abilityText(t, c))]), ...SENTENCES];
    expect(texts.filter((x) => x.split('\n').some((l) => lines.has(l.trim()) || lines.has(l.replace(/\bthis creature\b/g, '~').trim())))).toEqual([]);
  }, 120_000);
});

// ---- the parser, lint, engine and renderer changes of the round, one test each ---------------------------------------------------------------------------------

const creature = (text: string) => parseCard(card('Example Brute', 'Creature — Elf Warrior', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const isFull = (f: ReturnType<typeof creature>): boolean => noManualCost(f);
const json = (f: ReturnType<typeof creature>): string => JSON.stringify(bare(f.abilities));

const SAC_THAT = "When this creature enters, you may sacrifice another creature. When you do, this creature deals damage equal to that creature's power to target player.";
const SAC_THE = "When this creature enters, you may sacrifice another creature. When you do, this creature deals damage equal to the sacrificed creature's power to target creature.";
const SAC_IF = "When this creature enters, you may sacrifice another creature. If you do, you gain life equal to that creature's power.";
const SAC_OTHER_WAIT = "When this creature enters, you may sacrifice another creature. Then you may discard a card. When you do, this creature deals damage equal to the sacrificed creature's power to any target.";
const SAC_IT = 'When this creature enters, you may sacrifice another creature. When you do, this creature deals damage equal to its power to any target.';
const EXCESS = 'When this creature enters, you may sacrifice another creature. When you do, this creature deals 3 damage to another target creature. If excess damage was dealt this way, draw a card.';
const EXCESS_TARGET = 'When this creature enters, you may sacrifice another creature. When you do, this creature deals 3 damage to another target creature. If excess damage was dealt this way, this creature deals 1 damage to target player.';
const EITHER = 'When this creature enters, you may sacrifice an artifact or discard a card. When you do, this creature deals 2 damage to any target.';
const EITHER_DONT = "When this creature enters, you may sacrifice an artifact or discard a card. When you don't, this creature deals 2 damage to any target.";
const COST = '{2}, {T}, Exile a card from your graveyard or sacrifice a creature: Draw a card.';
const COST_AND = '{2}, {T}, Exile a card from your graveyard and sacrifice a creature: Draw a card.';
const SENTENCES = [SAC_THAT, SAC_THE, SAC_IF, SAC_OTHER_WAIT, SAC_IT, EXCESS, EXCESS_TARGET, EITHER, EITHER_DONT, COST, COST_AND];

describe('std-rw8 anaphora (CR 608.2h, 118.12; design 6.4): "that creature" names what an optional payment sacrificed (Mention.demonstrative)', () => {
  it('"that creature\'s power" after "you may sacrifice another creature" is the sacrificed creature (costSacrificed), in the reflexive trigger and in "if you do"', () => {
    for (const text of [SAC_THAT, SAC_IF]) {
      const f = creature(text);
      expect(isFull(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(json(f), text).toContain('"of":{"ref":"costSacrificed"}');
    }
  });
  it('a bare "its power" is still never the sacrificed creature (it is the object itself, which the gate then refuses)', () => {
    expect(json(creature(SAC_IT))).not.toContain('costSacrificed');
  });
});

describe('std-rw8 lint (CR 603.12, 608.2h): a reflexive trigger reads what the payment it waits for sacrificed', () => {
  it('"When you do, ... the sacrificed creature\'s power" right after the payment is accepted', () => {
    const f = creature(SAC_THE);
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"op":"reflexive"');
  });
  it('a reflexive trigger that waits for another instruction (a discard after the sacrifice) does not read it: not automated', () => {
    expect(isFull(creature(SAC_OTHER_WAIT))).toBe(false);
  });
});

describe('std-rw8 lowering (CR 603.12, 120.4a, 608.2c): "If excess damage was dealt this way" after a reflexive trigger\'s damage is an instruction of that trigger', () => {
  it('the sentence moves into the reflexive trigger\'s `do`, after the damage it reads', () => {
    const f = creature(EXCESS);
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (bare(f.abilities) as { effect: { steps: { op: string; do?: { op: string }[] }[] } }[])[0]!.effect.steps;
    expect(steps.map((s) => s.op)).toEqual(['pay', 'reflexive']);
    expect(steps[1]!.do!.map((s) => s.op)).toEqual(['damage', 'if']);
  });
  it('a sentence that announces a target of its own is not moved (and stays not automated)', () => {
    expect(isFull(creature(EXCESS_TARGET))).toBe(false);
  });
});

describe('std-rw8 lowering and renderer (CR 118.12, 603.12): "When you do" after a payment of one of two costs', () => {
  it('waits for the payment step, which is either payment (effects/handlers/pay.ts), and renders as Oracle words it', () => {
    const f = creature(EITHER);
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (bare(f.abilities) as { effect: { steps: Record<string, unknown>[] } }[])[0]!.effect.steps;
    expect(steps[0]!['op']).toBe('pay');
    expect(steps[0]!['else']).toBeDefined();
    expect(steps[1]).toMatchObject({ op: 'reflexive', when: { did: steps[0]!['as'] } });
  });
  it('"When you don\'t" is not read', () => {
    expect(isFull(creature(EITHER_DONT))).toBe(false);
  });
});

describe('std-rw8 cost (CR 601.2b, 602.2b): a choice between two costs is one cost part, each option one part', () => {
  it('"{2}, {T}, Exile a card from your graveyard or sacrifice a creature" keeps {2} and {T} outside the choice', () => {
    const f = creature(COST);
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    const cost = (bare(f.abilities) as { cost: { mana?: unknown; tap?: boolean; other: { kind: string; options: { other: unknown[] }[] }[] } }[])[0]!.cost;
    expect(cost.mana).toBeDefined();
    expect(cost.tap).toBe(true);
    expect(cost.other).toHaveLength(1);
    expect(cost.other[0]!.kind).toBe('oneOf');
    for (const o of cost.other[0]!.options) expect(Object.keys(o)).toEqual(['other']);
  });
  it('"... and sacrifice a creature" is no choice', () => {
    expect(json(creature(COST_AND))).not.toContain('oneOf');
  });
});
