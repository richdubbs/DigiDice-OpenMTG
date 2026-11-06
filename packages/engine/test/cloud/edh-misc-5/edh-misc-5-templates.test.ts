/**
 * Commander lane edh-misc, round edh-misc-5: the template data of parser/templates/zz-cloud/edh-misc-5.json ("if <things> entering or leaving the battlefield causes a
 * triggered ability ... to trigger, that ability triggers an additional time" (Gandalf the White), "manifest a card from your hand" (Scroll of Fate), "there is an additional
 * beginning phase after this phase" (Sphinx of the Second Sun)), the render folds and words the round added, and the promotions of this round (design 6.9 narrow wordings:
 * eff.put.lib.bottom.anyorder, eff.damage.evenly.down and eff.p2copyperm1.eachOther.becomeCopy.dur.except, which earlier rounds left experimental for lack of evidence). Guard
 * G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in edh-misc-5-scenarios.test.ts. CR cites checked against the Comprehensive Rules of
 * 2026-09-25 (fetched in the round).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/types/card';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/edh-misc-5.json';
import review from '../../m5/golden/cards/edh-misc-5-review.json';
import gandalfReview from '../../m5/golden/cards/fast3-t15-review.json';
import fireballReview from '../../m5/golden/cards/fast3-t11-review.json';
import t3Review from '../../m5/golden/cards/t3-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
/** An ability that works on the battlefield needs a permanent: a creature for a static, triggered or activated line, a sorcery for a spell. */
const typeFor = (text: string): string => (/^(\{|at the |if |whenever )/i.test(text) ? 'Creature' : 'Sorcery');
const parse = (text: string, type = typeFor(text)) => parseCard(card('Example Advisor', type, text, type.includes('Creature') ? { power: '1', toughness: '1' } : {}), OPTS).faces[0]!;
type Golden = { card: string; verified: string; expect?: string }[];
const golden = review as Golden;
const using = (file: Golden, id: string): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card).sort();

describe('edh-misc-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-misc-5.json, after edh-misc-3, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-misc-5.json');
    expect(files.indexOf('zz-cloud/edh-misc-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-misc-3.json'));
    expect(files.indexOf('zz-cloud/edh-misc-5.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (sta|eff).edhx5.*', () => {
    expect(MECH.map((t) => t.id)).toEqual(['sta.edhx5.triggerMod.enterLeave', 'eff.edhx5.manifest.fromHand', 'eff.edhx5.extraBeginningPhase']);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.edhx5\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 deviation (guide section 5, "Narrow wordings"): the three templates are stable on the one card of the EDHREC top 5,000 that prints each, golden (Gandalf the White, Scroll of Fate, Sphinx of the Second Sun)', () => {
    for (const t of MECH) expect(t.status, t.id).toBe('stable');
    expect(using(gandalfReview as Golden, 'sta.edhx5.triggerMod.enterLeave')).toEqual(['Gandalf the White']);
    expect(using(golden, 'eff.edhx5.manifest.fromHand')).toEqual(['Scroll of Fate']);
    expect(using(golden, 'eff.edhx5.extraBeginningPhase')).toEqual(['Sphinx of the Second Sun']);
    for (const g of [...golden, ...(gandalfReview as Golden).filter((x) => x.card === 'Gandalf the White')]) expect(g.expect, g.card).toBe('full');
  });
  it('the promotions of this round (design 6.9 narrow wordings, decided by the owner\'s standing rule 2026-10-27) have their golden cards and are stable', () => {
    const status = (id: string) => TEMPLATE_SET.find((t) => t.id === id)?.status;
    expect(using(golden, 'eff.put.lib.bottom.anyorder')).toEqual(['Bow of Nylea', 'Petals of Insight']);
    expect(using(t3Review as Golden, 'eff.damage.evenly.down')).toEqual(['Dwarven Catapult']);
    expect(using(fireballReview as Golden, 'eff.damage.evenly.down')).toEqual(['Fireball']);
    expect(using(golden, 'eff.p2copyperm1.eachOther.becomeCopy.dur.except')).toEqual(['Nanogene Conversion']);
    for (const id of ['eff.put.lib.bottom.anyorder', 'eff.damage.evenly.down', 'eff.p2copyperm1.eachOther.becomeCopy.dur.except']) expect(status(id), id).toBe('stable');
    // left alone here: sta.c3.pumpgrant.goaded (Ghoulish Impetus also had a manual sentence), eff.p2pt2.dur.group.get.foreach.and.gain (Nissa, Ascended Animist needed compleated; edh-top-2 made it stable)
    expect(status('sta.c3.pumpgrant.goaded')).toBe('stable'); // edh-misc-6: promoted on Ghoulish Impetus (its other sentence is automated now)
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

describe('edh-misc-5 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bentering or leaving\b/, 'entering or dying'], [/\ba permanent you control\b/, 'a permanent an opponent controls'], [/\bfrom your hand\b/, 'from your graveyard'],
    [/\bmanifest a card\b/i, 'Manifest two cards'], [/\bbeginning phase\b/, 'combat phase'], [/\bafter this phase\b/, 'after this step'], [/\ban additional time\b/, 'two additional times'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}
describe('edh-misc-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-misc-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('edh-misc-5 render folds and words (design 6.8 G6): the new wordings pass the gate, their near misses do not', () => {
  it('"manifest a card from your hand": only one card, only your own hand, only manifest', () => {
    expect(fullyAutomated(parse('{T}: Manifest a card from your hand.', 'Artifact'))).toBe(true);
    expect(fullyAutomated(parse('{T}: Manifest a card from your graveyard.', 'Artifact'))).toBe(false);
    expect(fullyAutomated(parse("{T}: Manifest a card from an opponent's hand.", 'Artifact'))).toBe(false);
    expect(fullyAutomated(parse('{T}: Manifest two cards from your hand.', 'Artifact'))).toBe(false);
  });
  it('"there is an additional beginning phase after this phase": exactly the three steps of a beginning phase, untap first; a main or combat phase is not read as a beginning phase', () => {
    expect(fullyAutomated(parse('At the beginning of your end step, there is an additional beginning phase after this phase.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(parse('At the beginning of your end step, there is an additional main phase after this phase.', 'Enchantment'))).toBe(false);
    expect(fullyAutomated(parse('At the beginning of your end step, there is an additional beginning phase after this step.', 'Enchantment'))).toBe(false);
  });
  it('"entering or leaving the battlefield": a union of two descriptions is said with an article each; a single description or the entering-only wording keeps its own template', () => {
    const doubler = (s: string) => parse(`If ${s} causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.`, 'Creature');
    expect(fullyAutomated(doubler('a Goblin or an artifact entering or leaving the battlefield'))).toBe(true);
    expect(fullyAutomated(doubler('a legendary creature or an enchantment entering or leaving the battlefield'))).toBe(true);
    expect(fullyAutomated(doubler('a Goblin or an artifact entering the battlefield'))).toBe(false); // the entering-only wording has no template for two descriptions: not guessed
    expect(fullyAutomated(doubler('a Goblin or an artifact leaving the battlefield'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-misc-5 design 6.10 (local index): synthetic examples', () => {
  it('no edh-misc-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
