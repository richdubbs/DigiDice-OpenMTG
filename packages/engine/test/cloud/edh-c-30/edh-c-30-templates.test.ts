/**
 * Commander lane edh-c, round edh-c-30: the template data of parser/templates/zz-cloud/edh-c-30.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-c-30-scenarios.test.ts.
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
import edhC30 from '../../../src/parser/templates/zz-cloud/edh-c-30.json';
import review from '../../m5/golden/cards/edh-c-30-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC30 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 30,000 that print each wording and are full
  'eff.edhv30.search.library.named.orName': ['Bogbrew Witch'],
  'eff.edhv30.search.library.named.andOrName.reveal': ['Alpine Houndmaster'],
  'eff.edhv30.search.libraryAndOrGraveyard.named.reveal.hand': ['Sun-Blessed Mount'],
  'eff.edhv30.damage.eachFilter.ifSpent.andEachFilter.ifSpent': ['Firespout'],
  'eff.edhv30.player.cant.playLands.ifSpent.cantCast.ifSpent': ['Moonhold'],
  'eff.edhv30.player.discards.chosen.thenRandom': ["Tourach's Canticle"],
  'eff.edhv30.draw.thenPutBottom': ['Sawtooth Loon'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.startsWith('~ deals')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-30 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-30.json, path order: after edh-c-3, before edh-c-4) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-30.json');
    expect(files.indexOf('zz-cloud/edh-c-30.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-3.json'));
    expect(files.indexOf('zz-cloud/edh-c-30.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhv30.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhv30\./);
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

describe('edh-c-30 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bElemental\b/, 'Elementals'], [/\bhaste\b/, 'x'], [/\bdouble\b/, 'triple'], [/\bloses\b/, 'gains'], [/\bcounters\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-30 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-30 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-30 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-30 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-c-30 renderer, hole and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Instant', cost = '{0}') => parseCard(card('Example Plan', type, text, { mana_cost: cost }), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Beast', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('render/fold-edhv30.ts (CR 601.2h, 106.1): two instructions that each carry "{R} was spent to cast ~" are said as one sentence; one condition alone, or two instructions of different kinds, stay as they were', () => {
    expect(fullyAutomated(spell('~ deals 3 damage to each creature without flying if {R} was spent to cast ~ and 3 damage to each creature with flying if {G} was spent to cast ~.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell('~ deals 3 damage to each creature without flying if {R} was spent to cast ~ and you gain 3 life if {G} was spent to cast ~.', 'Sorcery'))).toBe(false);
  });
  it('parser/holes/p2cst1.ts (CR 118.9, 119.3): "an opponent gained life this turn" is the history of a life gain by an opponent; "a player" or "you" in its place is another condition', () => {
    expect(fullyAutomated(spell("If an opponent gained life this turn, you may pay {B} rather than pay this spell's mana cost.\nTarget player loses 5 life and you gain 5 life.", 'Instant', '{5}{B}'))).toBe(true);
    expect(fullyAutomated(spell("If an opponent gained life this turn or last turn, you may pay {B} rather than pay this spell's mana cost.\nTarget player loses 5 life and you gain 5 life.", 'Instant', '{5}{B}'))).toBe(false);
  });
  it('parser/holes/p2cst1.ts (CR 118.9, 305.1, 102.3): "an opponent had two or more lands enter the battlefield under their control this turn" is one opponent judged alone; "one or more", and "a player" are not read', () => {
    const t = (n: string) => spell(`If an opponent had ${n} lands enter the battlefield under their control this turn, you may pay {R} rather than pay this spell's mana cost.\nYou gain 3 life.`, 'Instant', '{3}{R}{R}');
    expect(fullyAutomated(t('two or more'))).toBe(true);
    expect(fullyAutomated(t('one or more'))).toBe(false);
  });
  it('render/steps-flow.ts and render/cond.ts (CR 608.2c, 122.1f): "sacrifice a creature unless an opponent has three or more poison counters" is read; "unless each opponent has" and "unless an opponent has three or fewer poison counters" stay manual', () => {
    expect(fullyAutomated(creature('When ~ enters, sacrifice a creature unless an opponent has three or more poison counters.'))).toBe(true);
    expect(fullyAutomated(creature('When ~ enters, sacrifice a creature unless each opponent has three or more poison counters.'))).toBe(false);
    expect(fullyAutomated(creature('When ~ enters, sacrifice a creature unless an opponent has three or fewer poison counters.'))).toBe(false);
  });
});
