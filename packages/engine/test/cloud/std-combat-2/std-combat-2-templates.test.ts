/**
 * std-combat-2 (lane std-combat): the template data of parser/templates/zz-cloud/std-combat-2.json ("Do the same for <keywords>", "Until end of turn, X gains A and
 * has base power and toughness N/M", "you may pay {1} up to N times") and the round's parser, lowering and renderer changes: "another <own subtype>" in a
 * you-control test (lower/anaphora.ts#withoutKindredOther), the condition "X has <keyword> and ~ doesn't" (parser/holes/cond.ts), tiered modes that are each "the
 * chosen base power and toughness" (lower/ability.ts#chosenBasePtModes, render/program.ts#chosenBasePt), "When you do, choose up to that many --" after a payment
 * up to N times (lower/ability.ts#reflexiveModes) and the capability walker's reflexive mode count (model/cap-walk.ts#reflexiveBakedModes).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-combat-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import combat2 from '../../../src/parser/templates/zz-cloud/std-combat-2.json';
import review from '../../m5/golden/cards/std-combat-2-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = combat2 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because the index prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdcombat2.sameFor': 'Super-Adaptoid',
  'eff.stdcombat2.durFirst.gains.basept': "Vincent's Limit Break",
  'eff.stdcombat2.mayPay.upToTimes': 'Hawkeye, Master Marksman',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
/** An example as an ability of a creature, or of an instant when it begins with "Until end of turn". */
const parsedWith = (_t: Template, text: string) => (/^Until end of turn|^Tap up to/.test(text) ? face('Instant', text) : face('Creature — Lizard Robot', text, ['2', '2']));
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-combat-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-combat-2.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-combat-2.json');
    expect(files.indexOf('zz-cloud/std-combat-2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-combat-2.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdcombat2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdcombat2\./);
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
      const cards = golden.filter((g) => g.verified.includes(`(${t.id};`) || g.verified.includes(`(${t.id})`) || g.verified.includes(` ${t.id},`) || g.verified.includes(`(${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'when', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-combat-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
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
  const swaps: [RegExp, string][] = [[/\bmay pay\b/, 'must pay'], [/\bup to (two|three) times\b/, '$1 times'], [/\bup to that many\b/, 'one'], [/\bDo the same for\b/, 'Do the opposite for'],
    [/\band ~ doesn't\b/, 'and ~ does'], [/\bgains\b/, 'loses'], [/\bhas base power and toughness\b/, 'gets'], [/^Until end of turn, /, '']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-combat-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-combat-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated (a mode's name, a flavor word, aside)`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '—' || /^\{/.test(w) || /^•/.test(w) || words[i + 1] === '—' || w.endsWith('\n•')) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-combat-2 design 6.10 (local index): synthetic examples', () => {
  it('no std-combat-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- lower/anaphora.ts: "another <own subtype>" in a you-control test --------------------------------------------------------------------------------------

describe('std-combat-2 lowering (CR 109.2, 608.2c; design 6.4): "if you control another Lizard" on a Lizard is other than ~', () => {
  const text = (kind: string): string => `When this creature enters, choose target creature. If that creature's power is 2 or less or if you control another ${kind}, gain control of that creature until end of turn.`;
  it('on a Lizard, the condition is a Lizard you control other than the source, and the card is full', () => {
    const f = face('Creature — Lizard Warrior', text('Lizard'), ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"subtypes":["Lizard"],"controller":"you","other":true}');
  });
  it('a subtype the source does not have stays manual (two candidates, fail closed)', () => {
    expect(fullFace(face('Creature — Goblin Warrior', text('Lizard'), ['2', '2']))).toBe(false);
  });
  it('"another creature" (a card type, not the source\'s subtype) stays manual', () => {
    expect(fullFace(face('Creature — Lizard Warrior', text('creature'), ['2', '2']))).toBe(false);
  });
  it('"another Lizard" beside another "other" group of the sentence stays manual', () => {
    expect(fullFace(face('Creature — Lizard Warrior', "When this creature enters, choose target creature. If you control another Lizard, other creatures you control get +1/+1 until end of turn and that creature can't block this turn.", ['2', '2']))).toBe(false);
  });
});

// ---- parser/holes/cond.ts + render/cond.ts: "X has <keyword> and ~ doesn't" ---------------------------------------------------------------------------------

describe('std-combat-2 parser (CR 702.2, 122.1b): "that creature has flying and ~ doesn\'t"', () => {
  it('is the target having the keyword and the source not having it, rendered back with the elided "have flying"', () => {
    const f = face('Creature — Robot', "Whenever this creature attacks, choose another target creature. If that creature has flying and this creature doesn't, put a flying counter on this creature.", ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"cond":"all","of":[{"cond":"matches","object":{"ref":"target","id":"t0"},"filter":{"keyword":"flying"}},{"cond":"not","of":{"cond":"matches","object":{"ref":"self"},"filter":{"keyword":"flying"}}}]}');
  });
  it('"and ~ does" is no reading of it', () => {
    expect(fullFace(face('Creature — Robot', "Whenever this creature attacks, choose another target creature. If that creature has flying and this creature does, put a flying counter on this creature.", ['2', '2']))).toBe(false);
  });
});

// ---- lower/same-for.ts: "Do the same for <keywords>" ----------------------------------------------------------------------------------------------------------

describe('std-combat-2 lowering (CR 608.2c, 122.1b): "Do the same for <keywords>" repeats the sentence before it for each keyword, in order', () => {
  const lead = "Whenever this creature attacks, choose another target creature. If that creature has haste and this creature doesn't, put a haste counter on this creature.";
  it('ten keywords (a list longer than the Abilities hole read before) make eleven steps in the printed order', () => {
    const f = face('Creature — Robot', `${lead} Do the same for flying, first strike, double strike, deathtouch, indestructible, lifelink, menace, reach, trample, and vigilance.`, ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const kinds = [...JSON.stringify(f.abilities).matchAll(/"op":"putCounters","on":\{"ref":"self"\},"kind":"([a-z ]+)"/g)].map((m) => m[1]);
    expect(kinds).toEqual(['haste', 'flying', 'first strike', 'double strike', 'deathtouch', 'indestructible', 'lifelink', 'menace', 'reach', 'trample', 'vigilance']);
  });
  it('a listed keyword that is no keyword counter (ward 2, protection) stays manual', () => {
    expect(fullFace(face('Creature — Robot', `${lead} Do the same for flying and ward 2.`, ['2', '2']))).toBe(false);
    expect(fullFace(face('Creature — Robot', `${lead} Do the same for flying and protection from red.`, ['2', '2']))).toBe(false);
  });
  it('a keyword listed twice, or the keyword of the sentence before, stays manual', () => {
    expect(fullFace(face('Creature — Robot', `${lead} Do the same for flying and flying.`, ['2', '2']))).toBe(false);
    expect(fullFace(face('Creature — Robot', `${lead} Do the same for haste and flying.`, ['2', '2']))).toBe(false);
  });
  it('after a sentence that names no keyword, or two, it stays manual', () => {
    expect(fullFace(face('Creature — Robot', 'Whenever this creature attacks, put a +1/+1 counter on this creature. Do the same for flying.', ['2', '2']))).toBe(false);
    expect(fullFace(face('Creature — Robot', "Whenever this creature attacks, choose another target creature. If that creature has flying and this creature doesn't, put a reach counter on this creature. Do the same for trample.", ['2', '2']))).toBe(false);
  });
});

// ---- lower/ability.ts + render/program.ts: tiered modes that are each "the chosen base power and toughness" ------------------------------------------------

describe('std-combat-2 parser (CR 702.183a, 613.4b): tiered modes that are each a base power and toughness', () => {
  const spell = (modes: string): string => `Tiered (Choose one additional cost.)\nUntil end of turn, target creature you control gains vigilance and has the chosen base power and toughness.\n${modes}`;
  it('each mode is the instruction with its own size; the card is full and each mode says its size', () => {
    const f = face('Instant', spell('• Calm — {0} — 2/2.\n• Fury — {2} — 4/4.'));
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const s = JSON.stringify(f.abilities);
    expect(s).toContain('{"layer":"7b","power":2,"toughness":2}');
    expect(s).toContain('{"layer":"7b","power":4,"toughness":4}');
    expect(s).toContain('has base power and toughness 4/4.');
  });
  it('a mode that is more than a size, or two modes of one size, stays manual', () => {
    expect(fullFace(face('Instant', spell('• Calm — {0} — 2/2. Draw a card.\n• Fury — {2} — 4/4.')))).toBe(false);
    expect(fullFace(face('Instant', spell('• Calm — {0} — 2/2.\n• Fury — {2} — 2/2.')))).toBe(false);
  });
  it('without "the chosen base power and toughness" the shared instruction stays unsupported', () => {
    expect(fullFace(face('Instant', 'Tiered (Choose one additional cost.)\nUntil end of turn, target creature you control gains vigilance.\n• Calm — {0} — 2/2.\n• Fury — {2} — 4/4.'))).toBe(false);
  });
});

// ---- lower/ability.ts#reflexiveModes + model/cap-walk.ts: "When you do, choose up to that many --" ---------------------------------------------------------

describe('std-combat-2 parser (CR 603.12, 700.2, 608.2h): "When you do, choose up to that many --"', () => {
  const modes = '\n• Gain — You gain 3 life.\n• Draw — Draw a card.';
  it('after "you may pay {1} up to two times", none up to the times paid (the payment\'s count); the capability walker accepts the count a reflexive trigger fixes', () => {
    const f = face('Creature — Human Archer', `Whenever this creature attacks, you may pay {1} up to two times. When you do, choose up to that many —${modes}`, ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"modes":{"min":0,"max":{"q":"resultCount","step":"paid"}');
    expect(JSON.stringify(f.abilities)).toContain('"upTo":2');
  });
  it('after a payment of one time, or an optional instruction, "that many" has no reading (manual)', () => {
    expect(fullFace(face('Creature — Human Archer', `Whenever this creature attacks, you may pay {1}. When you do, choose up to that many —${modes}`, ['1', '1']))).toBe(false);
    expect(fullFace(face('Creature — Human Archer', `Whenever this creature attacks, you may draw a card. When you do, choose up to that many —${modes}`, ['1', '1']))).toBe(false);
  });
});
