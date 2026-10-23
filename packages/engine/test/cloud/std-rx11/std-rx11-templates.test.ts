/**
 * Card wave 2, slice s16 (std-rx11): the template data of parser/templates/zz-cloud/std-rx11.json ("whenever <obj> deals combat damage this turn, X", a delayed trigger
 * with any recipient) and the parser and renderer changes of the round ("with power greater than its base power", "one or more <creatures> each with <feature> deals",
 * "If you do, X" inside an event-timed delayed trigger, the target of a delayed trigger's event in the object's own enters trigger).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx11-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { compileCard } from '../../../src/index';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx11 from '../../../src/parser/templates/zz-cloud/std-rx11.json';
import review from '../../m5/golden/cards/cloud-std-rx11-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx11 as Template[];
const MECH_COUNT = 1;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdrx11.whenever.thatCreature.combatDamage.any.thisTurn': 'Long River Lurker',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a sorcery (the examples are spell instructions). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Charge', 'Sorcery', text), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx11 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx11.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx11.json');
    expect(files.indexOf('zz-cloud/std-rx11.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx11.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrx11.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdrx11\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx11 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\bcombat damage\b/, 'damage'], [/ this turn,/, ','], [/\bdeals combat damage\b/, 'is dealt combat damage'], [/\bthis turn\b/, 'next turn'], [/\bdraw a card\b/, 'discard a card'], [/\b2 life\b/, '3 life']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx11 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rx11 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rx11 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx11 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- parser/holes/filter.ts + rules/filter.ts: "with power greater than its base power" ---------------------------------------------------------------------------

describe('std-rx11 parser (CR 208.1, 613.4): "with power greater than its base power" is the filter field powerGreaterThanBase (parser/holes/filter.ts#featureAt)', () => {
  it('after a singular noun ("its") and a plural one ("their"), in a trigger and in an intervening "if"', () => {
    for (const text of [
      'Whenever a creature you control with power greater than its base power attacks, you gain 1 life.',
      'At the beginning of your upkeep, if you control a creature with power greater than its base power, you gain 1 life.',
      'Whenever one or more creatures you control with power greater than their base power attack, you gain 1 life.',
    ]) {
      const f = face('Enchantment', text);
      expect(fullFace(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain('"powerGreaterThanBase":true');
    }
  });
  it('"without ...", toughness, or "power greater than its power" is not this reading', () => {
    expect(fullFace(face('Enchantment', 'Whenever a creature you control without power greater than its base power attacks, you gain 1 life.'))).toBe(false);
    expect(JSON.stringify(face('Enchantment', 'Whenever a creature you control with toughness greater than its base power attacks, you gain 1 life.').abilities)).not.toContain('powerGreaterThanBase');
    expect(JSON.stringify(face('Enchantment', 'Whenever a creature you control with power greater than its power attacks, you gain 1 life.').abilities)).not.toContain('powerGreaterThanBase');
  });
  it('a static ability does not read it (statics/match.ts): "Creatures you control with power greater than their base power have trample" stays not full', () => {
    const d = compileCard(card('Example Banner', 'Enchantment', 'Creatures you control with power greater than their base power have trample.'));
    expect(d.automation.level).not.toBe('full');
    expect(JSON.stringify(d.automation)).toContain('sfilter:powerGreaterThanBase');
  });
});

// ---- render/evt.ts + render/np.ts: "one or more <creatures> each with <feature> deals" -----------------------------------------------------------------------------

describe('std-rx11 renderer (CR 603.2c; family each-with-singular): "one or more creatures you control each with <feature> deals combat damage to a player"', () => {
  it('the singular "each with ... its ... deals" and the plural "with ... their ... deal" are the same trigger', () => {
    const a = face('Enchantment', 'Whenever one or more creatures you control each with power greater than its base power deals combat damage to a player, draw a card.');
    const b = face('Enchantment', 'Whenever one or more creatures you control with power greater than their base power deal combat damage to a player, draw a card.');
    expect(fullFace(a), JSON.stringify(a.diagnostics)).toBe(true);
    expect(fullFace(b), JSON.stringify(b.diagnostics)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    expect(fullFace(face('Enchantment', 'Whenever one or more creatures you control each with flying deals combat damage to a player, draw a card.'))).toBe(true);
  });
  it('the singular feature with the plural verb, or "each with" and no feature, is not written so', () => {
    expect(fullFace(face('Enchantment', 'Whenever one or more creatures you control each with power greater than its base power deal combat damage to a player, draw a card.'))).toBe(false);
    expect(fullFace(face('Enchantment', 'Whenever one or more creatures you control each deals combat damage to a player, draw a card.'))).toBe(false);
  });
});

// ---- parser/lower/anaphora.ts#resolveInDelay, Mention.forTarget; render/refs.ts RenderState.inOwnEnters ---------------------------------------------------------

type Step = { op: string; do?: Step[]; then?: Step[]; what?: unknown };
const delayOf = (f: ReturnType<typeof face>): Step => {
  const steps = (bare(f.abilities) as { effect: { steps: Step[] } }[])[0]!.effect.steps;
  return steps.find((x) => x.op === 'delay')!;
};

describe('std-rx11 anaphora (CR 603.7, 400.7, 608.2c): "If you do, X." after an event-timed delayed trigger is read inside it', () => {
  it('"you may exile it. If you do, return it ...": the return acts on the exiled card (the binding of the exile), not on the target the trigger waits for', () => {
    const f = face('Sorcery', "Target creature gets +2/+0 until end of turn. Whenever that creature deals combat damage to a player this turn, you may exile it. If you do, return it to the battlefield under its owner's control.");
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const d = delayOf(f);
    expect(d.do!.map((x) => x.op)).toEqual(['may', 'if']);
    const exile = d.do![0]!.do![0] as Step & { as?: string };
    expect(exile.what).toEqual({ ref: 'event', role: 'source' });
    expect(d.do![1]!.then![0]!.what).toEqual({ ref: 'bound', name: exile.as });
  });
  it('with nothing moved inside the trigger, "it" is the object of the trigger\'s own event (the creature that dealt the damage)', () => {
    const f = face('Sorcery', 'Target creature gets +2/+0 until end of turn. Whenever that creature deals combat damage to a player this turn, you may draw a card. If you do, return it to its owner\'s hand.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(delayOf(f).do![1]!.then![0]!.what).toEqual({ ref: 'event', role: 'source' });
  });
});

describe('std-rx11 anaphora (CR 201.5, 603.6a, 603.7c): in the object\'s own enters trigger, "it" inside the delayed trigger for the target is the target, not the object', () => {
  const TOAD = "When this creature enters, target creature you control can't be blocked this turn. Whenever that creature deals combat damage this turn, you may exile it. If you do, return it to the battlefield under its owner's control.";
  it('on a creature: full, the exile is of the creature that dealt the damage', () => {
    const f = face('Creature — Frog Scout', TOAD, ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect((delayOf(f).do![0]!.do![0]!).what).toEqual({ ref: 'event', role: 'source' });
  });
  it('with no target ("When this creature enters, whenever another creature you control deals ...") the rule does not apply', () => {
    const f = face('Creature — Frog Scout', 'When this creature enters, until end of turn, whenever a creature you control deals combat damage to a player, you may exile it.', ['1', '1']);
    expect(JSON.stringify(f.abilities)).not.toContain('"forTarget"');
  });
});
