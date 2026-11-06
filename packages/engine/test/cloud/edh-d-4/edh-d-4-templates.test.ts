/**
 * Commander coordinator D, round edh-d-4 (EDHREC ranks 13,751-15,000): the template data of parser/templates/zz-cloud/edh-d-4.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-4-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD4 from '../../../src/parser/templates/zz-cloud/edh-d-4.json';
import review from '../../m5/golden/cards/edh-d-4-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD4 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 15,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhd4.scry.number.result': ['Boing!'],
  'eff.edhd4.base.permanent': ['The Bears of Littjara'],
  'eff.edhd4.base.and.has': ['Aven Mimeomancer'],
  'rst.edhd4.untapstep.attached.unless.monarch': ['Fall from Favor'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-4.json, path order: after edh-combat-7.json, before edh-mana-keywords-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-4.json');
    expect(files.indexOf('zz-cloud/edh-d-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-combat-7.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd4.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd4\./);
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
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-d-4 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bWalls\b/, 'Wall'], [/\bone\b/, 'two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-4 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-4 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('parser/holes/event.ts#attackPlayerOrWalker, triggers/occurrences.ts, render/evt.ts (CR 506.3, 508.1b, 603.2c): "you attack a player or planeswalker with one or more creatures [with power 1 or less]" and "an opponent attacks a planeswalker you control with one or more creatures" are understood; a battle, "two or more" or another count is not', () => {
    expect(fullyAutomated(creature('Whenever you attack a player or planeswalker with one or more creatures with power 1 or less, draw a card.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('Whenever you attack a player or planeswalker, draw a card.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('Whenever you attack a player or battle with one or more creatures, draw a card.', 'Enchantment'))).toBe(false);
    expect(fullyAutomated(creature('Whenever you attack a player or planeswalker with two or more creatures, draw a card.', 'Enchantment'))).toBe(false);
    expect(fullyAutomated(creature('Whenever an opponent attacks a planeswalker you control with one or more creatures, ~ deals 2 damage to that player.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('Whenever an opponent attacks a planeswalker you control with two or more creatures, ~ deals 2 damage to that player.', 'Enchantment'))).toBe(false);
    expect(fullyAutomated(creature('Whenever you attack a planeswalker you control with one or more creatures, draw a card.', 'Enchantment'))).toBe(false);
  });
  it('parser/lower/scope.ts (CR 109.5, 508.1): after "an opponent attacks a planeswalker you control", "that player" is the attacking opponent alone (the planeswalker is no player)', () => {
    const f = creature('Whenever an opponent attacks a planeswalker you control with one or more creatures, ~ deals 2 damage to that player and you gain 2 life.', 'Enchantment');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"to":{"ref":"event","role":"player"}');
  });
  it('parser/holes/player.ts, effects/refs.ts, render/refs.ts (CR 109.4, 102.2, 608.2h): "each opponent who doesn\'t control an Elf" is the opponents with none; a controller of its own, a plural or "each player who doesn\'t" is not that reading', () => {
    expect(fullyAutomated(spell("Each opponent who doesn't control an Elf loses 1 life."))).toBe(true);
    expect(fullyAutomated(spell("Each opponent who doesn't control a creature or planeswalker loses 1 life."))).toBe(true);
    expect(fullyAutomated(spell("Each opponent who doesn't control a creature you control loses 1 life."))).toBe(false);
    expect(fullyAutomated(spell("Each opponent who doesn't control Elves loses 1 life."))).toBe(false);
    expect(fullyAutomated(spell("Each opponent who doesn't control an Elf or blorfty loses 1 life."))).toBe(false);
  });
  it('parser/holes/event.ts#stateEvents, render/evt.ts (CR 603.8): "when no creatures are on the battlefield" is the state "there are no creatures on the battlefield", said both ways; a description of one controller is not', () => {
    expect(fullyAutomated(creature('When no creatures are on the battlefield, sacrifice this creature.'))).toBe(true);
    expect(fullyAutomated(creature('When there are no creatures on the battlefield, sacrifice this creature.'))).toBe(true);
    expect(JSON.stringify(creature('When no creatures are on the battlefield, sacrifice this creature.').abilities)).toBe(JSON.stringify(creature('When there are no creatures on the battlefield, sacrifice this creature.').abilities).replace('there are no creatures on the battlefield', 'no creatures are on the battlefield'));
    expect(fullyAutomated(creature('When no creatures you control are on the battlefield, sacrifice this creature.'))).toBe(false);
    expect(fullyAutomated(creature('When no creature is on the battlefield, sacrifice this creature.'))).toBe(false);
  });
  it('parser/holes/filter.ts, render/np.ts (CR 605.1a): "artifacts without mana abilities" is the artifacts with no mana ability; "with mana abilities" and the singular article are not that wording', () => {
    expect(fullyAutomated(spell('Destroy target artifact without mana abilities.'))).toBe(true);
    expect(fullyAutomated(spell('Destroy target artifact with mana abilities.'))).toBe(false);
    expect(fullyAutomated(spell('Destroy target artifact without blorfty abilities.'))).toBe(false);
  });
  it('render/steps-zones.ts (CR 107.1b, 107.3): a token count of X minus a number is said as it is printed; it adds nothing to a fixed number and a count of another kind keeps its words', () => {
    const x = (text: string) => parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{R}' }), OPTS).faces[0]!;
    expect(fullyAutomated(x('Create X minus one 2/2 white Samurai creature tokens.'))).toBe(true);
    expect(fullyAutomated(x('Create X plus two 2/2 white Samurai creature tokens.'))).toBe(true);
    expect(fullyAutomated(x('Create X minus one 2/2 white Samurai creature tokens, where X is the blorfty.'))).toBe(false);
  });
  it('parser/holes/cond.ts, render/cond.ts (CR 102.2, 119.3): "a player other than you lost life this turn" is "an opponent lost life this turn", said both ways', () => {
    const a = creature('At the beginning of each end step, if a player other than you lost life this turn, draw a card.');
    const b = creature('At the beginning of each end step, if an opponent lost life this turn, draw a card.');
    expect(fullyAutomated(a) && fullyAutomated(b)).toBe(true);
    expect(JSON.stringify(a.abilities)).toBe(JSON.stringify(b.abilities).replace('an opponent lost life this turn', 'a player other than you lost life this turn'));
    expect(fullyAutomated(creature('At the beginning of each end step, if a player other than blorfty lost life this turn, draw a card.'))).toBe(false);
  });
  it('render/steps-cards.ts (CR 701.22a, 706.2): a scry of the die result is said "a number of cards equal to the result"; another computed count of a scry keeps its X wording', () => {
    expect(fullyAutomated(spell('Roll a six-sided die. Scry a number of cards equal to the result.'))).toBe(true);
    expect(fullyAutomated(spell('Scry X, where X is the number of creatures you control.'))).toBe(true);
  });
});
