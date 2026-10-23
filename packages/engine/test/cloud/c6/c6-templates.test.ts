/**
 * CLOUD C6 (per-player instructions and their results): the template data of parser/templates/zz-cloud/c6.json and the parser pieces C6 added beside it:
 *   - "each opponent who can't" / "each player who can't" (parser/holes/player.ts, the `WhoCant` hole after "for each"): the players of a group who can't do what
 *     a discard or a sacrifice of ONE thing told each of them, bound by that step's `cantAs` (lower/mentions.ts#cantOf, CR 101.3, 608.2c);
 *   - "they" / "that player" in the filter of a group's sacrifice is each choosing player in turn, `{ref:'iterating'}` (lower/anaphora.ts#groupChooser, CR 608.2e);
 *   - "each player who controls the most <things>" / "the fewest" (`{ref:'controlsMost'}`, CR 109.4);
 *   - "for each player, choose a <thing> that player controls" (`chooseObjects.perPlayer`) and what it chose: "chosen this way", "those creatures",
 *     "the chosen permanents" (parser/holes/filter.ts, object.ts; CR 608.2c).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic (design 6.10).
 *
 * Evidence for `stable` (design 6.9): three hand-verified golden cards (test/m5/golden/cards/cloud-c6-review.json), or, for a sentence few cards print, every card
 * of the local index the template reads (its whole reach) is a golden card. The local-index block checks both.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import c6 from '../../../src/parser/templates/zz-cloud/c6.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import review from '../../m5/golden/cards/cloud-c6-review.json';
import r3refsReview from '../../m5/golden/cards/cloud-r3-refs-review.json';

const C6 = c6 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const parsedWith = (text: string, type = 'Sorcery') => parseCard(card('Example Edict', type, text), OPTS).faces[0]!;
const stepsOf = (text: string, type = 'Sorcery'): Record<string, unknown>[] => (parsedWith(text, type).abilities.find((a) => a.kind !== 'keyword') as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;

/** Templates whose sentence few cards print: their whole reach in the local index is golden (design 6.9). */
const WHOLE_REACH: ReadonlySet<string> = new Set(['eff.c6.choose.perPlayer.player', 'eff.c6.choose.perPlayer.opponent', 'eff.c6.player.sacrifice.all']);

describe('C6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/c6.json, path order: after trigger.json, before zz-cloud/std-hob.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/c6.json');
    expect(files.indexOf('zz-cloud/c6.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/c6.json')).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, is stable and of version 8', () => {
    expect(C6.map((t) => t.id)).toEqual(['eff.c6.forEach.cant', 'eff.c6.player.investigates', 'eff.c6.choose.perPlayer.player', 'eff.c6.choose.perPlayer.opponent', 'eff.c6.player.sacrifice.all']);
    for (const t of C6) {
      expect(t.id, t.id).toMatch(/^eff\.c6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable C6 template has its evidence (three hand-verified golden cards, or its whole reach golden: checked against the index below)', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of C6) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id})`) || g.verified.includes(`, ${t.id}`)).map((g) => g.card);
      if (!WHOLE_REACH.has(t.id)) expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C6) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('C6 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C6) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('C6: what the parser builds (CR 101.3, 101.4, 109.4, 608.2c, 608.2e)', () => {
  it('"each opponent who can\'t" names the players the step before binds with `cantAs` (CR 101.3)', () => {
    expect(stepsOf("Each opponent sacrifices an enchantment of their choice. Each opponent who can't loses 2 life.")).toEqual([
      { op: 'sacrificeChoice', who: { ref: 'each', who: 'opponent' }, filter: { types: ['Enchantment'] }, count: 1, cantAs: 'cant' },
      { op: 'loseLife', who: { ref: 'bound', name: 'cant' }, amount: 2 },
    ]);
    expect(stepsOf("Each opponent discards a card. For each opponent who can't, you create a Treasure token.")).toEqual([
      { op: 'discard', who: { ref: 'each', who: 'opponent' }, count: 1, cantAs: 'cant' },
      { op: 'forEach', over: { ref: 'bound', name: 'cant' }, as: 'each', do: [{ op: 'createToken', who: { ref: 'you' }, token: { predefined: 'Treasure' }, count: 1 }] },
    ]);
  });
  it('"they" in the filter of a group\'s sacrifice is each choosing player (`{ref:\'iterating\'}`, CR 608.2e); a target player stays the target', () => {
    const each = stepsOf('Each opponent sacrifices a creature with the greatest toughness among creatures they control.');
    expect(JSON.stringify(each[0]!['filter'])).toContain('"controller":{"ref":"iterating"}');
    const target = stepsOf('Target opponent sacrifices a creature with the greatest toughness among creatures they control.');
    expect(JSON.stringify(target[0]!['filter'])).toContain('"controller":{"ref":"target","id":"t0"}');
  });
  it('"each player who controls the most / the fewest" (CR 109.4)', () => {
    expect(stepsOf('Each player who controls the most artifacts draws a card.')).toEqual([{ op: 'draw', who: { ref: 'controlsMost', filter: { types: ['Artifact'] } }, count: 1 }]);
    expect(stepsOf('Each player who controls the fewest lands gains 2 life.')).toEqual([{ op: 'gainLife', who: { ref: 'controlsMost', filter: { types: ['Land'] }, fewest: true }, amount: 2 }]);
  });
  it('"for each player, choose ... that player controls" chooses one object per player, read with that player iterating; "chosen this way" is the group (CR 608.2c)', () => {
    expect(stepsOf('For each player, choose an enchantment that player controls. Then destroy all enchantments except enchantments chosen this way.')).toEqual([
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Enchantment'], controller: { ref: 'iterating' } } }, min: 1, max: 1, perPlayer: { ref: 'each', who: 'player' }, as: 'chosen' },
      { op: 'destroy', what: { ref: 'each', filter: { types: ['Enchantment'], not: { types: ['Enchantment'], is: { ref: 'bound', name: 'chosen' } } } } },
    ]);
  });
});

describe('C6 fails closed (design 6.4, 6.7): wordings the pieces do not read stay manual', () => {
  const cases: [string, string][] = [
    ['"each opponent who can\'t" after "each player" (a part of the group, no reference stands for it)', "Each player discards a card. Each opponent who can't loses 3 life."],
    ['"who can\'t" after an instruction of two cards (whether "can\'t" means "fewer" is not decided)', "Each opponent discards two cards. Each opponent who can't loses 3 life."],
    ['"who can\'t" with nothing before it', "Each opponent who can't loses 3 life."],
    ['one life total read for the whole group (it is per player: lint, CR 101.3)', "Each opponent sacrifices a creature of their choice. Each opponent who can't loses half their life, rounded up."],
    ['a choice for each player that never names that player (lint)', 'For each player, choose an artifact. Destroy those artifacts.'],
    ['"chosen this way" with no choice before it', 'Destroy all creatures except creatures chosen this way.'],
    ['a pronoun inside the instruction of the group who can\'t: each of them is a candidate (CR 608.2c, design 6.4)', "Each opponent discards a card. Each opponent who can't loses 1 life for each creature they control."],
    ['a pronoun inside the instruction of the players who control the most: each of them is a candidate', 'Target opponent discards a card. Each player who controls the most creatures loses 1 life for each creature they control.'],
  ];
  for (const [why, text] of cases) {
    it(`${why}: "${text}"`, () => {
      expect(fullyAutomated(parsedWith(text)), text).toBe(false);
    });
  }
});

describe('C6 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of C6) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const f = parsedWith(mutated);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && f.templatesUsed.includes(t.id), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('C6 design 6.9, 6.10 (local index): synthetic examples; the real cards the templates read', () => {
  const texts = (c: OracleCard): string[] => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].filter((x): x is string => typeof x === 'string');
  it('no C6 line of an example or counter-example is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) for (const text of texts(c)) for (const l of text.split('\n')) lines.add(l.trim());
    const verbatim = C6.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('a template of WHOLE_REACH reads only golden cards: every card of the index that prints its opening words and uses it is in the review file', () => {
    // merge wave 6: r3-refs's "for each player, you choose" was folded into eff.c6.choose.perPlayer.player; its golden card (Winnowing) is in r3-refs's review file
    const golden = new Set([...(review as { card: string }[]), ...(r3refsReview as { card: string }[])].map((g) => g.card));
    const words = /for each (player|opponent), choose|sacrifices? all/i;
    for (const c of index ?? []) {
      if (!texts(c).some((x) => words.test(x))) continue;
      const used = parseCard(c, OPTS).faces.flatMap((f) => f.templatesUsed).filter((id) => WHOLE_REACH.has(id));
      if (used.length > 0) expect(golden.has(c.name), `${c.name} (${used.join(', ')})`).toBe(true);
    }
  }, 120_000);
});
