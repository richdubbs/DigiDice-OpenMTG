/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-4: the template data of parser/templates/zz-cloud/edh-mana-keywords-4.json ("{Player} may spend mana as though it
 * were mana of any color" (Chromatic Orrery, Mycosynth Lattice) and "If that mana is spent on a creature spell, it gains haste" (Hall of the
 * Bandit Lord)). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10). The behavior is in edh-mana-keywords-4-scenarios.test.ts. CR cites checked against the Comprehensive Rules 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhMk4 from '../../../src/parser/templates/zz-cloud/edh-mana-keywords-4.json';
import review from '../../m5/golden/cards/edh-mana-keywords-4-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhMk4 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'sta.edhmk4.spend.anyColor': ['Chromatic Orrery'],
  'rid.edhmk4.spent.gains.permanent': ['Hall of the Bandit Lord'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>();
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-mana-keywords-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-mana-keywords-4.json, path order: after edh-mana-keywords-3, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-mana-keywords-4.json');
    expect(files.indexOf('zz-cloud/edh-mana-keywords-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-3.json'));
    expect(files.indexOf('zz-cloud/edh-mana-keywords-4.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are sta.edhmk4.* (or eff., rid., kw., cm.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm)\.edhmk4\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-mana-keywords-4 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bdifferent colors\b/, 'the same color'], [/\bless\b/, 'more'], [/\byou activate\b/, 'your opponents activate'], [/\btwo mana\b/, 'three mana'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-mana-keywords-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-mana-keywords-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
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

describe.skipIf(index === null)('edh-mana-keywords-4 design 6.10 (local index): synthetic examples', () => {
  it('no edh-mana-keywords-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-mana-keywords-4 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Artifact') => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('parser/lower/ability.ts (CR 605.3b, 119.3): a mana ability may also make each opponent gain a fixed amount of life; a variable amount, a target and "that player" stay manual', () => {
    expect(fullyAutomated(face('{T}: Add {R} or {G}. Each opponent gains 1 life.', 'Land'))).toBe(true);
    expect(fullyAutomated(face('{T}: Add {R} or {G}. Each opponent gains 2 life.', 'Land'))).toBe(true);
    const targeted = face('{T}: Add {R} or {G}. Target opponent gains 1 life.', 'Land'); // a target: no mana ability (CR 605.1a), an ability that uses the stack
    expect(JSON.stringify(targeted.abilities)).not.toContain('"isMana":true');
    const variable = face('{T}: Add {R} or {G}. Each opponent gains life equal to the number of lands you control.', 'Land'); // an amount read as it resolves: not the fixed form
    expect(JSON.stringify(variable.abilities)).not.toContain('"isMana":true');
  });
  it('parser/lower/ability.ts, parser/lower/mentions.ts (CR 605.3b, 122.1): "If there are no <kind> counters on ~, sacrifice it." after the mana, also beside the counter the cost removes; any other consequence stays manual', () => {
    expect(fullyAutomated(face('{T}, Remove a mining counter from ~: Add one mana of any color. If there are no mining counters on ~, sacrifice it.', 'Land'))).toBe(true);
    expect(fullyAutomated(face('{T}, Remove a mining counter from ~: Add one mana of any color. If there are no mining counters on ~, destroy it.', 'Land'))).toBe(false);
    expect(fullyAutomated(face('{T}, Remove a mining counter from ~: Add one mana of any color. If there are three mining counters on ~, sacrifice it.', 'Land'))).toBe(false);
    expect(fullyAutomated(face('{T}, Remove a mining counter from ~: Add one mana of any color. If there are no mining counters on ~, sacrifice a creature.', 'Land'))).toBe(false);
  });
  it('parser/holes/filter.ts, render/evt.ts, render/refs.ts (CR 120.3, 603.2): "Whenever a source deals damage to ~" and "that source\'s controller"; "that sorcery" is not read', () => {
    const ok = face("Whenever a source deals damage to ~, that source's controller sacrifices that many permanents of their choice.", 'Creature');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"source":{}');
    expect(fullyAutomated(face("Whenever a creature deals damage to ~, that creature's controller sacrifices that many permanents of their choice.", 'Creature'))).toBe(true);
    expect(fullyAutomated(face("Whenever a source deals damage to ~, that sorcery's controller sacrifices that many permanents of their choice.", 'Creature'))).toBe(false);
  });
  it("parser/holes/spend.ts (CR 106.6, 108.3): \"Spend this mana only to cast spells you don't own.\" restricts to spells whose owner is another player; \"you own\" and \"you don't control\" are not read", () => {
    const ok = face("{T}: Add {R}. Spend this mana only to cast spells you don't own.", 'Artifact');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"restriction":{"spells":{"not":{"owner":"you"}}}');
    expect(fullyAutomated(face('{T}: Add {R}. Spend this mana only to cast spells you own.', 'Artifact'))).toBe(false);
    expect(fullyAutomated(face("{T}: Add {R}. Spend this mana only to cast spells you don't control.", 'Artifact'))).toBe(false);
  });
  it('rules/pay.ts, rules/cost-pick.ts, statics/play-permits.ts (CR 609.4b): the permission is read only from a static ability of an object; an effect that grants it for a time is not the same JSON', () => {
    expect(fullyAutomated(face('You may spend mana as though it were mana of any color.'))).toBe(true);
    const timed = face('Until end of turn, you may spend mana as though it were mana of any color.', 'Instant');
    expect(JSON.stringify(timed.abilities)).not.toContain('"asThough":"any color"}]');
  });
  it('parser/holes/cond.ts, render/cond.ts (CR 607.2a): "a card is exiled with ~" is one or more of the cards its linked ability exiled; "two cards" and a card exiled by another object are not read', () => {
    const ok = face('Imprint -- When ~ enters, you may exile a card from your hand.\n{T}: Add {C}. If a card is exiled with ~, add {C}{C} instead.', 'Land');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"left":{"q":"count","of":{"ref":"linked","link":"exiled"}},"op":">=","right":1');
    expect(fullyAutomated(face('Imprint -- When ~ enters, you may exile a card from your hand.\n{T}: Add {C}. If two cards are exiled with ~, add {C}{C} instead.', 'Land'))).toBe(false);
  });
  it('core/mana-riders.ts, render/steps-cards.ts (CR 611.2a): a rider with no duration is permanent; the one with "until end of turn" keeps its end', () => {
    const forever = face('{T}: Add {C}. If that mana is spent on a creature spell, it gains haste.', 'Land');
    const turn = face('{T}: Add {C}. If that mana is spent on a creature spell, it gains haste until end of turn.', 'Land');
    expect(JSON.stringify(forever.abilities)).toContain('"permanent":true');
    expect(JSON.stringify(turn.abilities)).not.toContain('"permanent":true');
    expect(fullyAutomated(forever) && fullyAutomated(turn)).toBe(true);
  });
});
