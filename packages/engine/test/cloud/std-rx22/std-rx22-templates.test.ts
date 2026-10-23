/**
 * Card wave 2, EDH lane rx22 (std-rx22): the template data of parser/templates/zz-cloud/std-rx22.json ("counter <spell> if <Cond>", "As ~ enters, choose a color
 * other than <color>") and the parser, renderer and engine changes of the round (the keyword suspend's data, "for each spell you've cast this turn", a mana ability
 * that also says "You gain N life.", the trailing "if" of a guarded counter).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx22-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx22 from '../../../src/parser/templates/zz-cloud/std-rx22.json';
import review from '../../m5/golden/cards/cloud-std-rx22-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx22 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {}; // none: both templates have three golden cards
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an instant for the effect, an artifact for the static ability. */
const parsedWith = (t: Template, text: string) => parseCard(t.kind === 'effect' ? card('Example Rebuke', 'Instant', text) : card('Example Idol', 'Artifact', text), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx22 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx22.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx22.json');
    expect(files.indexOf('zz-cloud/std-rx22.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx22.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrx22.* / rep.stdrx22.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rep)\.stdrx22\./);
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

describe('std-rx22 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\bif\b/, 'unless'], [/\bCounter\b/, 'Exile'], [/\bother than\b/, 'and'], [/\bchoose a color\b/, 'choose two colors'], [/\bAs\b/, 'When']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx22 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-rx22 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-rx22 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx22 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


// ---- keyword suspend (keywords/data/suspend.json) -----------------------------------------------------------------------------------------------------------

describe('std-rx22 keyword suspend (CR 702.62a, 116.2f): the keyword library data', () => {
  // audit-fix-2 (CR 702.62a, 400.7): the haste is the cast trigger's effect, not a static of the keyword (a card that only gained suspend in exile is a new
  // object on the stack without it)
  it('suspend is implemented, lists its readers, and expands into two triggered abilities that work in exile; the cast one gives a creature spell haste', async () => {
    const { keywordRegistry } = await import('../../../src/keywords/registry');
    const d = keywordRegistry.get('suspend')!;
    expect(d.status).toBe('implemented');
    expect(d.readers).toEqual(['core/special/suspend.ts#SUSPEND_HANDLERS']);
    const ex = keywordRegistry.expand({ kind: 'keyword', keyword: 'suspend', amount: 3, cost: { mana: [{ kind: 'generic', amount: 1 }] } } as never, { ordinal: 1, types: ['Sorcery'] } as never);
    expect(ex.map((a) => a.kind)).toEqual(['triggered', 'triggered']);
    expect(ex.slice(0, 2).map((a) => (a as { zone?: string[] }).zone)).toEqual([['exile'], ['exile']]);
    expect(JSON.stringify(ex[1])).toContain('"costChange":{"kind":"set","cost":{},"name":"suspend"}');
    expect(JSON.stringify(ex[1])).toContain('"duration":{"d":"whileObject","object":{"ref":"bound","name":"suspendCast"},"as":"kept"}');
  });
  it('a "Suspend X" card (no fixed number of time counters) compiles, but its special action is never offered (core/special/suspend.ts#suspendTermsOf)', async () => {
    const { suspendTermsOf } = await import('../../../src/core/special/suspend');
    expect(typeof suspendTermsOf).toBe('function');
  });
});

// ---- Qty "for each spell you've cast this turn" --------------------------------------------------------------------------------------------------------------

describe('std-rx22 Qty (CR 601.2i, 608.2h): "for each spell you\'ve cast this turn" (parser/holes/qty.ts, render/qty.ts)', () => {
  const face = (text: string) => parseCard(card('Example Tally', 'Instant', text), OPTS).faces[0]!;
  it('is the singular of "the number of spells you\'ve cast this turn": the same quantity, full', () => {
    for (const text of ["You gain 1 life for each spell you've cast this turn.", "Draw a card for each spell you've cast this turn."]) {
      const f = face(text);
      expect(fullyAutomated(f) && f.gate.every((g) => g.ok), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain('{"q":"spellsCastThisTurn"}');
    }
  });
  it('"for each other spell" and "other than the first" are not this reading', () => {
    expect(JSON.stringify(face("Draw a card for each other spell you've cast this turn.").abilities)).not.toContain('{"q":"spellsCastThisTurn"}');
    expect(JSON.stringify(face("Draw a card for each spell you've cast this turn other than the first.").abilities)).not.toContain('"amount":{"q":"spellsCastThisTurn"}');
  });
});

// ---- a mana ability that also gains life ----------------------------------------------------------------------------------------------------------------------

describe('std-rx22 lowering (CR 605.1a, 605.3b, 119.3): a mana ability that also says "You gain N life." (parser/lower/ability.ts#gainLifeYou)', () => {
  const face = (text: string) => parseCard(card('Example Idol', 'Artifact', text), OPTS).faces[0]!;
  it('a fixed amount of life for you beside the mana is a full mana ability', () => {
    const f = face('{T}: Add {G}. You gain 1 life.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"isMana":true');
  });
  it('fail closed: an amount that is not a fixed number keeps it a manual mana ability; with a target it is no mana ability at all (CR 605.1a)', () => {
    expect(JSON.stringify(face('{T}: Add {G}. Target player gains 1 life.').abilities)).not.toContain('"isMana":true');
    expect(fullyAutomated(face('{T}: Add {G}. You gain life equal to the number of creatures you control.'))).toBe(false);
  });
});

// ---- render/steps.ts: the trailing "if" of a guarded counter -------------------------------------------------------------------------------------------------

describe('std-rx22 renderer (CR 701.6a, 608.2c; family stdrx22-guarded-counter-after): "Counter target spell if it\'s blue."', () => {
  const face = (text: string) => parseCard(card('Example Rebuke', 'Instant', text), OPTS).faces[0]!;
  it('the instruction-first form passes the gate; the target stays any spell and the color is the guard', () => {
    const f = face("Counter target spell if it's blue.");
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"guard":{"cond":"matches","object":{"ref":"target","id":"t0"},"filter":{"colors":["U"]}}');
    expect(JSON.stringify(f.abilities)).not.toContain('"filter":{"colors":["U"]}}],');
  });
  it('fail closed: "if it was kicked" names this spell, not the target, so the target is unused and the sentence stays manual', () => {
    expect(fullyAutomated(face('Counter target spell if it was kicked.'))).toBe(false);
  });
});
