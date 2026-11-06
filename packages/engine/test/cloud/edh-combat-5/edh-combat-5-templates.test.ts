/**
 * Commander lane edh-combat, round edh-combat-5: the template data of parser/templates/zz-cloud/edh-combat-5.json ("Until end of turn, target creature gains K, can attack as though it
 * didn't have defender, and assigns combat damage equal to its toughness rather than its power", "there's an additional combat phase after this phase", "At the beginning of that
 * combat, ...", "Each creature you control gets +1/+0 for each time it has attacked this turn", "The same is true for ...") and the round's reader and renderer changes ("first combat phase of
 * your turn", "attack with ~ and another legendary creature", "if a creature you control has first strike").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-combat-5-scenarios.test.ts. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (rules/cr/ is not in the cloud checkout; the text was fetched from media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCb5 from '../../../src/parser/templates/zz-cloud/edh-combat-5.json';
import review from '../../m5/golden/cards/edh-combat-5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCb5 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhcb5.dur.gains.noDefender.toughnessDamage': ['Walking Bulwark'],
  'eff.edhcb5.extraPhase.combat.theres': ['Moraug, Fury of Akoum'],
  'dl.edhcb5.thatCombat.lead': ['Moraug, Fury of Akoum'],
  'sta.edhcb5.each.pump.forEachTimeAttacked': ['Moraug, Fury of Akoum'],
  'eff.edhcb5.sameIsTrueFor': ['Odric, Lunarch Marshal'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature. */
const SPELL = new Set<string>();
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{W}' }), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-combat-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-combat-5.json, path order: after edh-combat-3, before edh-mana-keywords-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-combat-5.json');
    expect(files.indexOf('zz-cloud/edh-combat-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-combat-3.json'));
    expect(files.indexOf('zz-cloud/edh-combat-5.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta./eff./rid.edhcb5.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rid|dl)\.edhcb5\./);
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
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
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

describe('edh-combat-5 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [
    [/\bgets\b/, 'loses'], [/\btapped and attacking\b/, 'tapped and blocking'], [/\bend of combat\b/, 'end of turn'], [/\bthat's attacking\b/, "that's blocking"],
    [/\bhas\b/, 'loses'], [/\bYou control\b/, 'An opponent controls'], [/\byou control\b/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-combat-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-combat-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-combat-5 design 6.10 (local index): synthetic examples', () => {
  it('no edh-combat-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-combat-5 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Legendary Creature — Golem', name = 'Example Relic') => parseCard(card(name, type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/cond.ts + render/cond.ts (CR 500.1, 500.8): "if it\'s the first combat phase of your turn" is the first combat of the controller\'s turn; "of the turn" (no owner) is the other reading', () => {
    const mine = face("Whenever ~ attacks, if it's the first combat phase of your turn, draw a card.");
    const turn = face("Whenever ~ attacks, if it's the first combat phase of the turn, draw a card.");
    expect(fullyAutomated(mine)).toBe(true);
    expect(JSON.stringify(mine.abilities)).toContain('"yourTurn":true');
    expect(fullyAutomated(turn)).toBe(true);
    expect(JSON.stringify(turn.abilities)).not.toContain('yourTurn');
    expect(jsonKey(mine.abilities)).not.toBe(jsonKey(turn.abilities));
    for (const other of ["Whenever ~ attacks, if it's the first combat phase of an opponent's turn, draw a card.", "Whenever ~ attacks, if it's the second combat phase of your turn, draw a card."]) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(mine.abilities), other).toBe(false);
    }
  });
  it('parser/holes/event.ts + render/evt.ts + triggers/match.ts (CR 508.1, 603.2c): "whenever you attack with ~ and another <creature>" is the source\'s own attack with another declared attacker; other wordings are other things', () => {
    const a = face('Whenever you attack with ~ and another legendary creature, draw a card.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"withOther":{"supertypes":["Legendary"],"types":["Creature"]}');
    for (const other of ['Whenever you attack with ~ and another creature, draw a card.', 'Whenever you attack with ~ and two other legendary creatures, draw a card.', 'Whenever you attack with ~ or another legendary creature, draw a card.', 'Whenever you attack with ~ and a legendary creature, draw a card.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
    expect(ENGINE_CAPABILITIES.has('feature:ev.attacks.withOther')).toBe(true);
  });
  it('parser/holes/cond.ts + render/cond.ts (CR 702.1): "if a creature you control has first strike" is the existence of such a creature (one keyword; an opponent\'s creature or another keyword differ)', () => {
    const a = face('At the beginning of each combat, creatures you control gain first strike until end of turn if a creature you control has first strike.');
    const b = face('At the beginning of each combat, creatures you control gain first strike until end of turn if you control a creature with first strike.');
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    for (const other of ['At the beginning of each combat, creatures you control gain first strike until end of turn if a creature an opponent controls has first strike.', 'At the beginning of each combat, creatures you control gain first strike until end of turn if a creature you control has flying.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('parser/lower/same-for.ts + render/fold-stdcombat2.ts (CR 608.2c): "The same is true for A, B, and C" repeats the sentence before it for each keyword, in order; a repeat that names its own keyword twice or a keyword with a parameter is manual', () => {
    const a = face('At the beginning of each combat, creatures you control gain first strike until end of turn if a creature you control has first strike. The same is true for flying and trample.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities).match(/"keyword":"trample"/g)?.length, 'a grant and a test for trample').toBe(2);
    for (const other of ['At the beginning of each combat, creatures you control gain first strike until end of turn if a creature you control has first strike. The same is true for first strike.', 'At the beginning of each combat, creatures you control gain first strike until end of turn if a creature you control has first strike. The same is true for ward 2.']) {
      expect(fullyAutomated(face(other)), other).toBe(false);
    }
  });
  it('types/ability.ts + effects/eval.ts + statics/match.ts + render/qty.ts (CR 508.1): the quantity `attacksThisTurn` of the modified creature is advertised as a quantity of the statics and the resolution, and "for each time it has attacked this turn" renders back', () => {
    const f = face('Each creature you control gets +1/+0 for each time it has attacked this turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"q":"attacksThisTurn"');
    expect(fullyAutomated(face('Each creature you control gets +1/+0 for each time it has blocked this turn.'))).toBe(false);
  });
  it('parser/lower/that-combat.ts (CR 500.8, 603.7a): "At the beginning of that combat" is manual unless an earlier instruction of the same ability adds a combat phase', () => {
    expect(fullyAutomated(face('Whenever a land you control enters, there\'s an additional combat phase after this phase. At the beginning of that combat, untap all creatures you control.'))).toBe(true);
    expect(fullyAutomated(face('Whenever ~ attacks, untap target creature. At the beginning of that combat, untap all creatures you control.'))).toBe(false);
    expect(fullyAutomated(face("Whenever a land you control enters, at the beginning of the next end step, there's an additional combat phase after this phase. At the beginning of that combat, you gain 5 life.")), 'the added combat is made by another delayed trigger').toBe(false);
  });
});
