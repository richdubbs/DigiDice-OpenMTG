/**
 * Top-rank round edh-next-85 (code edhn85): the template data of parser/templates/zz-cloud/edh-next-85.json, tested here and in edh-next-85-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10). CR cites from memory, unverified (cloud session).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext85 from '../../../src/parser/templates/zz-cloud/edh-next-85.json';
import review from '../../m5/golden/cards/edh-next-85-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const MECH = edhNext85 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only
 * one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 * Each wording is printed on one card: Chainer, Dementia Master; The Master, Transcendent; Grimoire of the Dead; Donal, Herald of Wings.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn85.is.color.and.subtype.inAddition': ['Chainer, Dementia Master'],
  'eff.edhn85.is.color.subtype.withBase': ['The Master, Transcendent'],
  'eff.edhn85.theyAre.color.subtypes.inAddition': ['Grimoire of the Dead'],
  'eff.edhn85.copy.spell.sizedSubtype': ['Donal, Herald of Wings'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** A synthetic card with the example as its ability: a static ability on an enchantment creature, a trigger on an artifact creature. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^(Whenever|When|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : t.kind === 'static' ? card('Example Shrine', 'Enchantment', text) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-85 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-85.json, path order: after edh-next-8.json, before edh-next-9.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-85.json');
    expect(files.indexOf('zz-cloud/edh-next-85.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-8.json'));
    expect(files.indexOf('zz-cloud/edh-next-85.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn85.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn85\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
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

describe('edh-next-85 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/graveyard/, 'hand'], [/exiling/, 'discarding'], [/sacrificing/, 'discarding'], [/tapped/, 'untapped'], [/mutate/, 'flashback']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-85 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-85 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b)
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

// ---- the round's parser, lowering and renderer changes (each with its negative case) ----------------------------------------------------------------------------
const parse = (type: string, text: string, cost = '{0}') => parseCard(card('Example Card', type, text, { mana_cost: cost, ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) }), OPTS);
const isFull = (type: string, text: string, cost?: string): boolean => fullyAutomated(parse(type, text, cost).faces[0]!);

describe('edh-next-85: "other" of a group of spells on the stack (parser/lower/anaphora.ts, CR 608.2c, 109.2)', () => {
  it('"Counter all other spells." in an instant is read, as other than this spell', () => {
    const f = parse('Instant', 'Counter all other spells.').faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"other":true');
  });
  it('negative: with a target named before it, or "other" of permanents, the sentence stays manual', () => {
    expect(isFull('Instant', 'Counter target spell. Counter all other spells.')).toBe(false);
    expect(isFull('Sorcery', 'Destroy all other creatures.')).toBe(false);
  });
});

describe('edh-next-85: "not named X" beside a zone (render/np.ts, family notname-beside-zone)', () => {
  it('"put target legendary permanent card not named ~ from a graveyard onto the battlefield" is read and rendered', () => {
    expect(isFull('Legendary Artifact', 'When this artifact enters, put target legendary permanent card not named Example Card from a graveyard onto the battlefield under your control.')).toBe(true);
  });
});

describe('edh-next-85: "it" of "as long as it was cast" in a static ability about the object itself (parser/lower/static-anaphora.ts#resolveStaticSelfCastMarker)', () => {
  it('"This creature has haste as long as it was cast." is read', () => {
    expect(isFull('Creature — Beast', 'This creature has haste as long as it was cast.')).toBe(true);
  });
  it('negative: a static ability about other creatures keeps the pronoun unresolved (manual)', () => {
    expect(isFull('Creature — Beast', 'Creatures you control have haste as long as it was cast.')).toBe(false);
  });
});

describe('edh-next-85: "that player" is the controller of the damage source (parser/lower/scope.ts, render/refs.ts)', () => {
  it('"Whenever a source an opponent controls deals damage to you, that player sacrifices a permanent of their choice." is read', () => {
    expect(isFull('Creature — Human', 'Whenever a source an opponent controls deals damage to you, that player sacrifices a permanent of their choice.')).toBe(true);
    expect(isFull('Creature — Human', 'Whenever a creature an opponent controls deals damage to you, that player loses 1 life.')).toBe(true);
  });
  it('negative: a source you control, or damage to another player, has no such player', () => {
    expect(isFull('Creature — Human', 'Whenever a source you control deals damage to you, that player loses 1 life.')).toBe(false);
    expect(isFull('Creature — Human', 'Whenever a source an opponent controls deals damage to target player, that player loses 1 life.')).toBe(false);
  });
});

describe('edh-next-85: "Spend only <color> mana on X." (ActivatedAbilityDef.spendOnlyX, SpellAbilityDef.spendOnlyX, CR 107.3a, 106.6)', () => {
  it('after the effect of an activated ability, or as the first sentence of a spell', () => {
    expect(isFull('Creature — Rat', '{X}: ~ deals X damage to each creature and each player. Spend only black mana on X.')).toBe(true);
    expect(isFull('Instant', 'Spend only red mana on X. ~ deals X damage to any target.', '{X}{R}')).toBe(true);
    const f = parse('Instant', 'Spend only black mana on X. ~ deals X damage to any target and you gain X life.', '{X}{1}{B}').faces[0]!;
    expect(JSON.stringify(f.abilities)).toContain('"spendOnlyX":"B"');
  });
  it('negative: a second sentence of a spell, or a modal spell, is not read (fail closed)', () => {
    expect(isFull('Instant', '~ deals X damage to any target. Spend only black mana on X.', '{X}{B}')).toBe(false);
    expect(isFull('Instant', 'Choose one — • Spend only black mana on X. ~ deals X damage to any target. • Draw a card.', '{X}{B}')).toBe(false);
    expect(isFull('Instant', 'Spend only purple mana on X. ~ deals X damage to any target.', '{X}{R}')).toBe(false);
  });
  it('the engine names both features', () => {
    expect(ENGINE_CAPABILITIES.has('feature:activate.spendOnlyX')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:spell.spendOnlyX')).toBe(true);
  });
});

describe('edh-next-85: wordings the round does not read (older negatives stay)', () => {
  it('"copy it" with a size but no "in addition to its other types" is not the sized copy', () => {
    expect(isFull('Creature — Wizard', 'Whenever you cast a creature spell, copy it, except the copy is a 1/1 Spirit.')).toBe(false);
  });
  it('"becomes" of several planeswalkers with "each" and "gains": not read by this round, read since edh-next-137 (Sarkhan the Masterless)', () => {
    // combined copy: edh-next-137 (Sarkhan the Masterless) reads it (eff.edhn137.dur.becomes.color.subtype.creature.andGains: types and subtypes SET, CR 205.1a, 613.1d)
    expect(isFull('Sorcery', 'Until end of turn, each planeswalker you control becomes a 4/4 red Dragon creature and gains flying.')).toBe(true);
  });
});
