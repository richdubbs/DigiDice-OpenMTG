/**
 * Top-rank round edh-next-96 (code edhn96, second pass 4): the template data of parser/templates/zz-cloud/edh-next-96.json, tested here and in edh-next-96-scenarios.test.ts.
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
import edhNext96 from '../../../src/parser/templates/zz-cloud/edh-next-96.json';
import review from '../../m5/golden/cards/edh-next-96-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const MECH = edhNext96 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only
 * one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 * Each wording is printed on one card: Mind Funeral; Pyretic Charge; Courageous Resolve; Yavimaya Dryad.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn96.player.revealUntilN.areRevealed': ['Mind Funeral'],
  'eff.edhn96.forEach.lead.pump.group.dur': ['Pyretic Charge'],
  'eff.edhn96.put.bf.tapped.underPlayer': ['Yavimaya Dryad'],
  'eff.edhn96.youCantLoseLife.youCantLoseGame.oppsCantWin.thisTurn': ['Courageous Resolve'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** A synthetic card with the example as its ability: a static ability on an enchantment creature, a trigger on an artifact creature. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^(Whenever|When|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : t.kind === 'static' ? card('Example Shrine', 'Enchantment', text) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-96 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-96.json, path order: after edh-next-9.json, before edh-perms-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-96.json');
    expect(files.indexOf('zz-cloud/edh-next-96.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-9.json'));
    expect(files.indexOf('zz-cloud/edh-next-96.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn96.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn96\./);
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

describe('edh-next-96 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-96 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-96 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
const parse = (type: string, text: string, cost = '{0}', name = 'Example Card') => parseCard(card(name, type, text, { mana_cost: cost, ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) }), OPTS);
const isFull = (type: string, text: string, cost?: string, name?: string): boolean => fullyAutomated(parse(type, text, cost, name).faces[0]!);

describe('edh-next-96: a token named with the card\'s short name (parser/front/selfref.ts#possessiveTokenName, CR 111.4, 201.2)', () => {
  it('"create Testra\'s Journal, a legendary colorless Book artifact token" is read, the name being the token\'s', () => {
    const f = parse('Legendary Creature — Human', 'When Testra enters, create Testra\'s Journal, a legendary colorless Book artifact token.', '{0}', 'Testra, Test Scribe').faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"name":"Testra\'s Journal"');
  });
  it('negative: elsewhere "Testra\'s" stays the object itself, and a name that is not introduced by "create" is not a token name', () => {
    const f = parse('Legendary Creature — Human', 'When Testra enters, you gain life equal to Testra\'s power.', '{0}', 'Testra, Test Scribe').faces[0]!;
    expect(JSON.stringify(f.abilities)).not.toContain('Testra\'s');
    expect(isFull('Legendary Creature — Human', 'When Testra enters, exile Testra\'s Journal.', '{0}', 'Testra, Test Scribe')).toBe(false);
  });
});

describe('edh-next-96: an epithet with "to" in a token\'s given name (parser/holes/token.ts#epithet, CR 111.4)', () => {
  it('"create Voxa, Friend to Elves, a legendary 3/3 green Wolf creature token" is read', () => {
    expect(isFull('Creature — Elf', 'When this creature enters, create Voxa, Friend to Elves, a legendary 3/3 green Wolf creature token.')).toBe(true);
  });
  it('negative: an epithet that goes on past the article, or a lower-case run, is not a name', () => {
    expect(isFull('Creature — Elf', 'When this creature enters, create Voxa, friend to elves, a legendary 3/3 green Wolf creature token.')).toBe(false);
    expect(isFull('Creature — Elf', 'When this creature enters, create Voxa, Friend to Elves a legendary 3/3 green Wolf creature token.')).toBe(false);
  });
});

describe('edh-next-96: "Exile all other spells and counter all abilities." (parser/lower/anaphora.ts#stackKindsDisjoint, CR 405.1, 113.1)', () => {
  it('is read as other than this spell, abilities being no spells', () => {
    expect(isFull('Instant', 'Exile all other spells and counter all abilities.')).toBe(true);
  });
  it('negative: another group of permanents or spells keeps the refusal', () => {
    expect(isFull('Instant', 'Exile all other spells and destroy all creatures.')).toBe(false);
    expect(isFull('Sorcery', 'Exile all other creatures and counter all abilities.')).toBe(false);
  });
});

describe('edh-next-96: "the greatest mana value among <spells> you\'ve cast this turn" (parser/holes/qty.ts, rules/history.ts#maxHistoryPerSource, CR 202.3, 601.2i)', () => {
  const MAKER = 'Create an X/X blue Elemental creature token, where X is the greatest mana value among instant and sorcery spells you\'ve cast this turn.';
  it('is read for spells of card types', () => {
    expect(isFull('Sorcery', MAKER)).toBe(true);
  });
  it('negative: a spell description with more than card types, or another history, is not read', () => {
    expect(isFull('Sorcery', MAKER.replace('instant and sorcery spells', 'red spells'))).toBe(false);
    expect(isFull('Sorcery', MAKER.replace('you\'ve cast', 'your opponents have cast'))).toBe(false);
  });
});
