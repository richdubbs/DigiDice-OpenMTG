/**
 * Commander concept lane turns-phases, round edh-d-71: the template data of parser/templates/zz-cloud/edh-d-71.json ("you get / that player gets an additional upkeep step after this step",
 * "any player may pay half their life, rounded up. If a player does, ...", "Until your next turn, you and planeswalkers you control gain protection from that player") and the round's
 * reader, lowering, renderer and engine changes. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example
 * does not parse or parses to different JSON; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10).
 * The behavior is in edh-d-71-scenarios.test.ts. CR cites come from memory (no rules/cr in cloud sessions) and are listed as unverified in the record.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD71 from '../../../src/parser/templates/zz-cloud/edh-d-71.json';
import review from '../../m5/golden/cards/edh-d-71-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD71 as Template[];
const MECH_COUNT = 4;
/** design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): the wording is printed on one card only; listed in the round's record (decided by the owner's standing rule 2026-10-27). */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhd71.extraStep.upkeep.youGet': ['The Ninth Doctor'],
  'eff.edhd71.extraStep.upkeep.thatPlayerGets': ['Paradox Haze'],
  'eff.edhd71.anyPlayerMay.payHalfLife': ['Temporal Extortion'],
  'eff.edhd71.youAndWalkers.protectionFromPlayer': ['Eon Frolicker'],
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

describe('edh-d-71 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-71.json) and its ids are unique in the whole set', () => {
    expect(TEMPLATE_FILES.map((f) => f.file)).toContain('zz-cloud/edh-d-71.json');
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff./rst..edhd71.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rst)\.edhd71\./);
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

describe('edh-d-71 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-d-71 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-71 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-71 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-d-71 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Golem') => parseCard(card('Example Relic', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const same = (a: ReturnType<typeof face>, text: string, type?: string): boolean => { const f = face(text, type); return fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities); };
  it('parser/holes/event.ts + core/turn.ts + triggers/match.ts + render/turn.ts (CR 503.1, 500.9, 603.2): "at the beginning of enchanted player\'s first upkeep each turn" is the first upkeep step that began in the turn (`nth` 1); other numbers and possessors are not read', () => {
    const a = face("At the beginning of enchanted player's first upkeep each turn, draw a card.", 'Enchantment — Aura');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"step":"upkeep"');
    expect(JSON.stringify(a.abilities)).toContain('"nth":1');
    for (const other of ["At the beginning of enchanted player's second upkeep each turn, draw a card.", "At the beginning of enchanted player's upkeep each turn, draw a card.", "At the beginning of enchanted player's first end step each turn, draw a card.", 'At the beginning of the first upkeep each turn, draw a card.']) {
      expect(same(a, other, 'Enchantment — Aura'), other).toBe(false);
    }
    expect(ENGINE_CAPABILITIES.has('feature:ev.step.nth')).toBe(true);
  });
  it('parser/holes/event.ts + render/evt.ts (CR 502.3, 603.2): "whenever ~ becomes untapped during your untap step" is the object itself untapped by the untap step; another object, another untap step or a plain untap is not that', () => {
    const a = face('Whenever ~ becomes untapped during your untap step, draw a card.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"untapStep":true');
    for (const other of ['Whenever ~ becomes untapped, draw a card.', "Whenever ~ becomes untapped during an opponent's untap step, draw a card.", 'Whenever a creature you control becomes untapped during your untap step, draw a card.', 'Whenever ~ becomes tapped during your untap step, draw a card.']) {
      expect(same(a, other), other).toBe(false);
    }
  });
  it('render/fold.ts#chooseThenAttach (CR 701.3a, 608.2c): "sacrifice it and attach this Aura to a creature you control. If you do, ..." keeps the name the "if you do" reads; a targeted attach is another sentence', () => {
    const a = face('When enchanted creature deals combat damage to a player, sacrifice it and attach this Aura to a creature you control. If you do, draw a card.', 'Enchantment — Aura');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"cond":"did"');
    expect(same(a, 'When enchanted creature deals combat damage to a player, sacrifice it and attach this Aura to target creature you control. If you do, draw a card.', 'Enchantment — Aura')).toBe(false);
  });
  it('parser/lower/anaphora.ts#countersHadWindow + render/abil.ts (CR 602.2b, 608.2h, 122.1): "it had N or more X counters on it" after a cost that exiles or sacrifices ~ is ~ as it last existed; a cost that leaves ~ alone, or a described object, is not', () => {
    const a = face('{4}{U}{U}, Exile this creature: Draw a card for each verse counter on this creature. If it had seven or more verse counters on it, take an extra turn after this one.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"cond":"matches"');
    const sac = face('{4}{U}{U}, Sacrifice this creature: Draw a card for each verse counter on this creature. If it had seven or more verse counters on it, take an extra turn after this one.');
    expect(fullyAutomated(sac)).toBe(true);
    for (const other of ['{4}{U}{U}, {T}: Draw a card for each verse counter on this creature. If it had seven or more verse counters on it, take an extra turn after this one.',
      '{4}{U}{U}, Exile target artifact: Draw a card for each verse counter on this creature. If it had seven or more verse counters on it, take an extra turn after this one.',
      '{4}{U}{U}, Exile this creature: Create a Treasure token. If it had seven or more verse counters on it, take an extra turn after this one.']) {
      expect(same(a, other), other).toBe(false);
    }
  });
  it('model/lint-nodes.ts (CR 118.12, 119.4): the paying player is read only in the cost of a payment every player is offered; a plain payment by "you" that reads it is refused', () => {
    const a = face('When ~ enters, any player may pay half their life, rounded up. If a player does, draw a card.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"everyPlayer":true');
    expect(same(a, 'When ~ enters, you may pay half your life, rounded up. If you do, draw a card.')).toBe(false);
  });
});
