/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-5: the template data of parser/templates/zz-cloud/edh-mana-keywords-5.json (activation triggers with "if it isn't a
 * mana ability" (Rings of Brighthearth, Illusionist's Bracers), "When you spend this mana to cast ..., you gain life / scry" (Scaled Nurturer, Lapis Orb of Dragonkind), "For each
 * creature destroyed / exiled this way, its controller creates a token" (Curse of the Swine and others) and mana of the chosen color (Caged Sun, Gauntlet of Power)). Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10).
 * The behavior is in edh-mana-keywords-5-scenarios.test.ts. CR cites checked against the Comprehensive Rules 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhMk5 from '../../../src/parser/templates/zz-cloud/edh-mana-keywords-5.json';
import review from '../../m5/golden/cards/edh-mana-keywords-5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhMk5 as Template[];
const MECH_COUNT = 9;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards that print each wording and are full (all of the EDHREC top 5,000 or of the tuning half; Caged Sun is held-out, opened by the owner, commander request 2026-10-27)
  'trg.edhmk5.you.activate.ifNotMana': ['Rings of Brighthearth'],
  'trg.edhmk5.abilityOf.equipped.activated.ifNotMana': ['Illusionist\'s Bracers', 'Battlemage\'s Bracers'],
  'rid.edhmk5.mana.youSpend.gain': ['Scaled Nurturer'],
  'rid.edhmk5.mana.youSpend.scry': ['Lapis Orb of Dragonkind'],
  'trg.edhmk5.landAbility.addsChosenColor': ['Caged Sun'],
  'trg.edhmk5.tappedForChosenColor': ['Gauntlet of Power'],
  'eff.edhmk5.mana.additional.thatColor': ['Caged Sun'],
  'eff.edhmk5.mana.itsController.additional.thatColor': ['Gauntlet of Power'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['eff.edhmk5.forEach.thisWay.controllerCreates']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-mana-keywords-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-mana-keywords-5.json, path order: after edh-mana-keywords-4, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-mana-keywords-5.json');
    expect(files.indexOf('zz-cloud/edh-mana-keywords-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-4.json'));
    expect(files.indexOf('zz-cloud/edh-mana-keywords-5.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are trg./rid./eff.edhmk5.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|trg)\.edhmk5\./);
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

describe('edh-mana-keywords-5 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-mana-keywords-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-mana-keywords-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-mana-keywords-5 design 6.10 (local index): synthetic examples', () => {
  it('no edh-mana-keywords-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-mana-keywords-5 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Artifact') => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('parser/lower/scope.ts, model/lint-roles.ts, render/refs.ts (CR 602.2): "copy that ability" and "copy it" name the activated ability; the source of the activation is never "that ability"', () => {
    expect(fullyAutomated(face("Whenever you activate an ability, if it isn't a mana ability, copy that ability. You may choose new targets for the copy."))).toBe(true);
    expect(fullyAutomated(face('Whenever you activate an ability that isn\'t a mana ability, copy it. You may choose new targets for the copy.'))).toBe(true);
    expect(fullyAutomated(face("Whenever you activate an ability that targets a creature or player, copy that ability. You may choose new targets for the copy."))).toBe(true);
    // a spell is not an ability: a cast trigger has no "that ability"; the activation's source is "that creature" when described, never "that ability" (and "that permanent" is the source, not the ability)
    expect(fullyAutomated(face('Whenever you cast a spell, copy that ability.'))).toBe(false);
    // review finding: "it" is the ability, which only a copy or a counter acts on (CR 707.10, 701.5)
    expect(fullyAutomated(face("Whenever you activate an ability that isn't a mana ability, untap it."))).toBe(false);
    expect(fullyAutomated(face("Whenever you activate an ability that isn't a mana ability, put a +1/+1 counter on it.", 'Creature'))).toBe(false);
  });
  it("render/evt.ts (CR 603.4, 605.1a): \"if it isn't a mana ability\" after the comma is the same trigger as \"that isn't a mana ability\"; other conditions (a mana ability, an opponent) are not read", () => {
    const a = face("Whenever you activate an ability, if it isn't a mana ability, draw a card.");
    const b = face("Whenever you activate an ability that isn't a mana ability, draw a card.");
    expect(fullyAutomated(a) && fullyAutomated(b)).toBe(true);
    expect(JSON.stringify((a.abilities as unknown as { trigger?: unknown }[]).map((x) => x.trigger))).toBe(JSON.stringify((b.abilities as unknown as { trigger?: unknown }[]).map((x) => x.trigger)));
    expect(fullyAutomated(face("Whenever you activate an ability, if it is a mana ability, draw a card."))).toBe(false);
  });
  it('parser/lower/quantities.ts#movedGroups, render/steps-flow.ts (CR 608.2c, 608.2h, 701.8a): "for each <type> destroyed / exiled this way" loops over what the ONE earlier destroy or exile moved; a narrower description, a graveyard and a bare "of them" stay manual', () => {
    expect(fullyAutomated(face('Destroy all creatures. For each creature destroyed this way, its controller creates a 2/2 green Wolf creature token.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(face('Destroy all permanents. For each creature destroyed this way, its controller creates a 2/2 green Wolf creature token.', 'Sorcery'))).toBe(false); // the group has non-creatures: the description adds a type
    expect(fullyAutomated(face('Destroy all creatures. For each white creature destroyed this way, its controller creates a 2/2 green Wolf creature token.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(face('Destroy all creatures. For each creature put into a graveyard this way, its controller creates a 2/2 green Wolf creature token.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(face('Destroy target creature. For each creature destroyed this way, its controller creates a 2/2 green Wolf creature token.', 'Sorcery'))).toBe(false); // one target: "its" is ambiguous
  });
  it('triggers/match.ts#producedChosen, #stillAttached (CR 106.4, 607.2d, 301.5): mana of the chosen color needs a chosen color; an equipped creature that left the battlefield is no longer equipped', () => {
    expect(fullyAutomated(face("As ~ enters, choose a color.\nWhenever a land's ability causes you to add one or more mana of the chosen color, you gain 1 life."))).toBe(true);
    expect(fullyAutomated(face("Whenever a land's ability causes you to add one or more mana of any color, you gain 1 life."))).toBe(false);
  });
  it("render/steps-cards.ts (CR 106.6, 603.2): \"When you spend this mana to cast <spells>, ...\" is the mana's trigger; only a life gain and a scry are read; \"each opponent\" is not", () => {
    expect(fullyAutomated(face('{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, you gain 2 life.'))).toBe(true);
    expect(fullyAutomated(face('{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, scry 2.'))).toBe(true);
    expect(fullyAutomated(face('{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, each opponent loses 2 life.'))).toBe(false);
  });
});
