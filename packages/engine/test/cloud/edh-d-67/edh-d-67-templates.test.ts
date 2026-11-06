/**
 * Commander coordinator D, lane prevent-r2 (second pass of A's lane prevent), round edh-d-67: the template data of parser/templates/zz-cloud/edh-d-67.json (Dark Sphere, Penance, Batwing Brume, Sokrates, Tarrasque, Impulsive Maneuvers, Fear, Fire, Foes! and Desperate Gambit) and the parser, renderer and engine
 * changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10).
 * The behavior is in edh-d-67-scenarios.test.ts. CR cites from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD67 from '../../../src/parser/templates/zz-cloud/edh-d-67.json';
import review from '../../m5/golden/cards/edh-d-67-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD67 as Template[];
const MECH_COUNT = 11;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhd67.prevent.nextSourceOfChoice.you.halfDown': ['Dark Sphere'],
  'eff.edhd67.prevent.nextDescribedSourceOfChoice.any': ['Penance'],
  'eff.edhd67.fog.combat.ifCond': ['Batwing Brume'],
  'eff.edhd67.loselife.foreach.ifCond': ['Batwing Brume'],
  'eff.edhd67.must.lure.opponents': ['You Look Upon the Tarrasque'],
  'sta.edhd67.damage.prevent.thenControllerAndRecipientDrawHalf': ['Sokrates, Athenian Teacher'],
  'eff.edhd67.nextTime.objDealsCombat.double': ['Impulsive Maneuvers'],
  'eff.edhd67.nextTime.objDealsCombat.prevent': ['Impulsive Maneuvers'],
  'eff.edhd67.damage.targetAndEachOtherSameController': ['Fear, Fire, Foes!'],
  'eff.edhd67.choose.sourceYouControl': ['Desperate Gambit'],
  'eff.edhd67.nextTime.objDeals.double': ['Desperate Gambit'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered, replacement). */
const SPELL = new Set<string>([
  'eff.edhd67.fog.combat.ifCond', 'eff.edhd67.loselife.foreach.ifCond', 'eff.edhd67.must.lure.opponents', 'eff.edhd67.nextTime.objDealsCombat.double', 'eff.edhd67.nextTime.objDealsCombat.prevent',
  'eff.edhd67.damage.targetAndEachOtherSameController', 'eff.edhd67.choose.sourceYouControl', 'eff.edhd67.nextTime.objDeals.double',
]);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{R}' }), OPTS)
    : parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-d-67 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-67.json, path order: after edh-d-6, before edh-d-7) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-67.json');
    expect(files.indexOf('zz-cloud/edh-d-67.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-6.json'));
    expect(files.indexOf('zz-cloud/edh-d-67.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-7.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhd67.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg|rep)\.edhd67\./);
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

describe('edh-d-67 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bor more\b/, 'or less'], [/\bhaste\b/, 'flying'], [/\btop\b/, 'bottom'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bor less\b/, 'or more'], [/\bplay\b/, 'cast'], [/\battacked\b/, 'blocked'], [/\bspell\b/, 'ability'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-67 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-67 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
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

describe.skipIf(index === null)('edh-d-67 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-67 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-67 parser, renderer and engine changes (one test each)', () => {
  const creature = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{1}' }), OPTS).faces[0]!;
  it('render/fold.ts#sourceOfChoiceShield (CR 609.7a, 615.1, 107.1a; Dark Sphere): "prevent half that damage, rounded down" is a source of any color and damage to you only', () => {
    const t = '{2}: The next time a source of your choice would deal damage to you this turn, prevent half that damage, rounded down.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(JSON.stringify(creature(t).abilities)).toContain('"op":"floorDiv"');
    expect(fullyAutomated(creature(t.replace('to you', 'to target creature')))).toBe(false);
    expect(fullyAutomated(creature(t.replace('a source', 'a red source')))).toBe(false);
  });
  it('render/fold-p2rd4.ts (CR 609.7a, 615.1a; Penance): a described source of your choice with no recipient is any damage; with "to you" it is still the older template\'s', () => {
    const t = '{2}: The next time a green or white source of your choice would deal damage this turn, prevent that damage.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(JSON.stringify(creature(t).abilities)).not.toContain('"recipient"');
    const older = '{2}: The next time a green or white source of your choice would deal damage to you this turn, prevent that damage.';
    expect(fullyAutomated(creature(older))).toBe(true);
    expect(JSON.stringify(creature(older).abilities)).toContain('"recipient":{"player":"you"}');
  });
  it('render/stat.ts (CR 614.1a, 615.8; Impulsive Maneuvers): the next-time shields of a creature the attack trigger names are said through the trigger\'s roles; a non-combat or other kind of shield is not folded in', () => {
    const t = 'Whenever a creature attacks, flip a coin. If you win the flip, the next time that creature would deal combat damage this turn, it deals double that damage instead. If you lose the flip, the next time that creature would deal combat damage this turn, prevent that damage.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(fullyAutomated(creature(t.replace('it deals double', 'it deals triple')))).toBe(false);
  });
  it('effects/bodies/m5.ts (CR 615.12, 107.1a; Sokrates, ruling 2024-07-05): a draw of half "that many" when the damage can\'t be prevented reads the damage', () => {
    const t = 'Until end of turn, target creature gains "If ~ would deal combat damage to a player, prevent that damage. ~\'s controller and that player each draw half that many cards, rounded down."';
    expect(fullyAutomated(spell(t))).toBe(true);
    expect(JSON.stringify(spell(t).abilities)).toContain('"q":"preventedAmount"');
    expect(fullyAutomated(spell(t.replace('half', 'twice')))).toBe(false);
  });
  it('render/fold-edhd67.ts (CR 609.7a; Desperate Gambit): the choice of a source and the coin flip are one sentence only with the exact pair of shields', () => {
    const t = 'Choose a source you control and flip a coin. If you win the flip, the next time that source would deal damage this turn, it deals double that damage instead. If you lose the flip, the next time it would deal damage this turn, prevent that damage.';
    expect(fullyAutomated(spell(t))).toBe(true);
    expect(fullyAutomated(spell(t.replace('this turn, prevent', 'this turn, prevent half of'))) ).toBe(false);
    expect(fullyAutomated(spell('Choose a source you control. You gain 1 life.'))).toBe(false);
  });
});
