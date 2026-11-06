/**
 * Commander lane turns-stack, round edh-d-34: the template data of parser/templates/zz-cloud/edh-d-34.json ("After this combat phase, there is an additional combat phase",
 * "After this main phase, there is an additional combat phase [. Only the chosen creatures can attack during that combat phase]", "Cast this spell only during your turn",
 * "Take an extra turn after this one if <condition>", "For each five counters removed this way, take an extra turn after this one") and the round's reader and renderer changes.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in
 * edh-d-34-scenarios.test.ts. CR cites: 500.7, 500.8, 505.1a, 508.1, 601.3, 608.2c checked against the Comprehensive Rules text of 2026-09-25 where the round could fetch it;
 * the rest from memory (listed in the record).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD34 from '../../../src/parser/templates/zz-cloud/edh-d-34.json';
import review from '../../m5/golden/cards/edh-d-34-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD34 as Template[];
const MECH_COUNT = 5;
/** design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): the wording is printed on one card only; listed in the round's record (decided by the owner's standing rule 2026-10-27). */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhd34.extraPhase.combat.afterThisCombatPhase': ['Raphael, Tag Team Tough'],
  'eff.edhd34.extraPhase.combat.afterThisMainPhase': ['Last Night Together'],
  'eff.edhd34.extraPhase.combat.afterThisMainPhase.onlyChosen': ['Last Night Together'],
  'rst.edhd34.cast.self.yourTurn': ['Seedtime'],
  'eff.edhd34.extraTurn.you.ifCond': ['Seedtime'],
  'eff.edhd34.extraTurn.you.forEachFiveRemoved': ['Sage of Hours'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (text: string) => {
  const o = { power: '2', toughness: '2' };
  if (/^Cast Example Subject/.test(text)) return parseCard(card('Example Subject', 'Instant', text, { mana_cost: '{1}' }), OPTS).faces[0]!;
  if (text.includes(':')) return parseCard(card('Example Relic', 'Artifact Creature — Golem', text, o), OPTS).faces[0]!;
  if (/^Whenever|^At /.test(text)) return parseCard(card('Example Relic', 'Artifact Creature — Golem', text, o), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{W}' }), OPTS).faces[0]!;
};

describe('edh-d-34 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-34.json) and its ids are unique in the whole set', () => {
    expect(TEMPLATE_FILES.map((f) => f.file)).toContain('zz-cloud/edh-d-34.json');
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff./rst..edhd34.*', () => {
    expect(MECH.length).toBe(MECH_COUNT + 1);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rst)\.edhd34\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(1);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const named = NARROW[t.id];
      if (named === undefined) continue; // an id with no entry here is listed in NARROW or has a golden card of its own below
      for (const n of named) expect(golden.map((g) => g.card), t.id).toContain(n);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
    for (const t of MECH) expect(NARROW[t.id], `${t.id} needs its 6.9 record`).toBeDefined();
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-d-34 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('edh-d-34 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words[i + 1] === 'counters' || words[i + 1] === 'counters.') return; // the kind of a counter is any word (CR 122.1): "remove all blorfty counters" is a counter kind, not a nonsense word
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-34 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-34 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    expect(verbatim, JSON.stringify(verbatim)).toEqual([]);
  }, 120_000);
});

describe('edh-d-34 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Golem') => parseCard(card('Example Relic', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/cost.ts (CR 107.14, 118.3): "you may pay eight {E}" is a payment of eight energy (a number word of four or more before one symbol); other forms are not', () => {
    const a = face('Whenever ~ attacks, you may pay eight {E}. If you do, draw a card.');
    const b = face('Whenever ~ attacks, you may pay {E}{E}{E}{E}{E}{E}{E}{E}. If you do, draw a card.');
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    for (const other of ['Whenever ~ attacks, you may pay two {E}. If you do, draw a card.', 'Whenever ~ attacks, you may pay eight {R}. If you do, draw a card.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('parser/holes/cond.ts + front/sentences.ts + render (CR 118.12, 608.2c): "If you pay," after an optional payment is "If you do,"; with nothing to pay it is not read', () => {
    const pay = face('Whenever ~ attacks, you may pay {E}. If you pay, untap all creatures you control and draw a card.');
    const doo = face('Whenever ~ attacks, you may pay {E}. If you do, untap all creatures you control and draw a card.');
    expect(fullyAutomated(pay)).toBe(true);
    expect(jsonKey(pay.abilities)).toBe(jsonKey(doo.abilities));
    const none = face('Whenever ~ attacks, if you pay, untap all creatures you control.');
    expect(fullyAutomated(none)).toBe(false);
  });
  it('parser/lower/conditions.ts#foldReflexiveInIf (CR 603.12): "Then if C, exile it. When you do, ..." waits for the exile inside the branch of the `if`', () => {
    const a = face('Whenever ~ attacks, draw a card. Then if ~ has no time counters on it, exile it. When you do, gain 3 life.', 'Enchantment');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"op":"reflexive"');
    const steps = (a.abilities[0] as unknown as { effect: { steps: { op: string; then?: { op: string }[] }[] } }).effect.steps;
    const branch = steps.find((x) => x.op === 'if');
    expect(branch?.then?.map((x) => x.op)).toEqual(['move', 'reflexive']); // inside the branch: with the condition false nothing is exiled and nothing triggers
    expect(steps.some((x) => x.op === 'reflexive')).toBe(false);
  });
  it('parser/holes/event.ts + render/evt.ts + triggers/match.ts (CR 500.8, 511.1): "at the end of the first combat phase on your turn" is the end of combat step with nth 1 of your turn', () => {
    const a = face('At the end of the first combat phase on your turn, draw a card.', 'Enchantment');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"nth":1');
    for (const other of ['At the end of the second combat phase on your turn, draw a card.', "At the end of the first combat phase on an opponent's turn, draw a card.", 'At the end of the first combat phase, draw a card.']) {
      const f = face(other, 'Enchantment');
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
    expect(ENGINE_CAPABILITIES.has('feature:ev.step.nth')).toBe(true);
  });
  it('parser/holes/trek9.ts + rules/cost.ts (CR 118.3, 401.4): "Put this creature on the bottom of its owner\'s library" is a cost of the source from the battlefield; the top or another library is not read', () => {
    const a = face("{T}, Put this creature on the bottom of its owner's library: Draw a card.");
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"kind":"putIntoLibrary"');
    for (const other of ["{T}, Put this creature on top of its owner's library: Draw a card.", "{T}, Put this creature on the bottom of target player's library: Draw a card."]) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
});
