/**
 * Commander coordinator D, round edh-d-37 (lane lands): the template data of parser/templates/zz-cloud/edh-d-37.json (see the file) and the round's parser, renderer and engine
 * changes, tested at the end of this file and in edh-d-37-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites are from memory (no rules/cr in a cloud session) and listed as
 * unverified in the round's record.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD37 from '../../../src/parser/templates/zz-cloud/edh-d-37.json';
import review from '../../m5/golden/cards/edh-d-37-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD37 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhd37.destroyAllNonbasicLands.forEachLandSearchBasic': ['From the Ashes'],
  'eff.edhd37.playerSacrificesAll.forEachLandSearchBasicTapped': ['Wave of Vitriol'],
  'eff.edhd37.exileAll.battlefieldGraveyardsHands': ['Decree of Annihilation'],
  'trg.edhd37.playerPutsOntoBattlefield': ['Overburden'],
  'eff.edhd37.become.pl.ptSubtypes.creatures.with.permanent': ['Nissa, Worldwaker'],
  'eff.edhd37.player.may.search.upTo.bf.tapped.them': ['Dire-Strain Rampage'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered ability on an enchantment, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'trigger' || /^(When|Whenever|At the beginning)/.test(text) ? card('Example Relic', 'Enchantment', text) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-37 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-37.json, path order: after edh-d-3.json, before edh-d-4.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-37.json');
    expect(files.indexOf('zz-cloud/edh-d-37.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-3.json'));
    expect(files.indexOf('zz-cloud/edh-d-37.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhd37.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd37\./);
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

describe('edh-d-37 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bnonbasic\b/, 'basic'], [/\bbattlefield\b/, 'graveyard'], [/\bnontoken\b/, 'token'], [/\btapped\b/, 'untapped']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-37 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-37 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-37 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-37 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-d-37 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const perm = (text: string) => parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  it('parser/holes/edhd37.ts, render/cond.ts, render/evt.ts (CR 603.4, 305.1, 603.6a): "if that player had another land enter the battlefield under their control this turn" after a land-enters trigger; the event\'s player is the one it names, never "you"', () => {
    expect(fullyAutomated(perm('Whenever a land an opponent controls enters, if that player had another land enter the battlefield under their control this turn, ~ deals 2 damage to that player.'))).toBe(true);
    expect(fullyAutomated(perm('Whenever a land enters under an opponent\'s control, if that player had another land enter the battlefield under their control this turn, ~ deals 2 damage to that player.'))).toBe(true);
    expect(fullyAutomated(perm('Whenever a creature an opponent controls enters, if that player had another land enter the battlefield under their control this turn, ~ deals 2 damage to that player.'))).toBe(true);
    expect(fullyAutomated(perm('Whenever you gain life, if that player had another land enter the battlefield under their control this turn, ~ deals 2 damage to that player.'))).toBe(false);
    expect(fullyAutomated(perm('If that player had another land enter the battlefield under their control this turn, ~ deals 2 damage to that player.'))).toBe(false);
    expect(fullyAutomated(perm('Whenever a land an opponent controls enters, if that player had another creature enter the battlefield under their control this turn, ~ deals 2 damage to that player.'))).toBe(false);
    expect(fullyAutomated(perm('Whenever a land an opponent controls enters, if that player had another land enter the battlefield under their control this turn, they return a land they control to its owner\'s hand.'))).toBe(true);
    expect(fullyAutomated(perm('Whenever a land an opponent controls enters, they return a land they control to its owner\'s hand.'))).toBe(true);
    expect(fullyAutomated(perm('Whenever you cast a spell, they return a land they control to its owner\'s hand.'))).toBe(false);
  });
  it('parser/holes/qty.ts, render/qty.ts (CR 102.3, 608.2h): "the number of players who control at least two more lands than you"; a bare "at least one more" and a count of one are no such reading', () => {
    expect(fullyAutomated(spell('You gain life equal to the number of players who control at least two more lands than you.'))).toBe(true);
    expect(fullyAutomated(spell('You gain life equal to the number of players who control at least three more creatures than you.'))).toBe(true);
    expect(fullyAutomated(spell('You gain life equal to the number of players who control at least one more lands than you.'))).toBe(false);
    expect(fullyAutomated(spell('You gain life equal to the number of players who control at least two lands than you.'))).toBe(false);
    expect(fullyAutomated(spell('You gain life equal to the number of players who control more lands than you.'))).toBe(true);
  });
  it('parser/holes/edhd37.ts, render/cond.ts (CR 305.6, 105.1, 104.2b): "you control a land of each basic land type and a creature of each color" needs both halves, in this order', () => {
    expect(fullyAutomated(spell('You win the game if you control a land of each basic land type and a creature of each color.'))).toBe(true);
    expect(fullyAutomated(spell('You win the game if you control a creature of each color and a land of each basic land type.'))).toBe(false);
    expect(fullyAutomated(spell('You win the game if you control a land of each basic land type.'))).toBe(false);
    expect(fullyAutomated(spell('You gain 3 life if you control a land of each basic land type and a creature of each color.'))).toBe(true);
  });
  it('parser/lower/ability.ts#joinEdhD37 (CR 701.8a, 701.21a, 608.2c): the sentence that counts the lands destroyed or sacrificed is read with the one that destroyed or sacrificed them, and only with it', () => {
    expect(fullyAutomated(spell('Destroy all nonbasic lands. For each land destroyed this way, its controller may search their library for a basic land card and put it onto the battlefield. Then each player who searched their library this way shuffles.'))).toBe(true);
    expect(fullyAutomated(spell('Destroy all lands. For each land destroyed this way, its controller may search their library for a basic land card and put it onto the battlefield. Then each player who searched their library this way shuffles.'))).toBe(false);
    expect(fullyAutomated(spell('For each land destroyed this way, its controller may search their library for a basic land card and put it onto the battlefield.'))).toBe(false);
    expect(fullyAutomated(spell('Each player sacrifices all artifacts and nonbasic lands they control. For each land sacrificed this way, its controller may search their library for a basic land card and put it onto the battlefield tapped. Then each player who searched their library this way shuffles.'))).toBe(true);
    expect(fullyAutomated(spell('Each player sacrifices all artifacts and nonbasic lands they control. For each artifact sacrificed this way, its controller may search their library for a basic land card and put it onto the battlefield tapped.'))).toBe(false);
  });
});
