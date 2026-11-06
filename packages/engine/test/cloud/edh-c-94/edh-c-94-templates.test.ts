/**
 * Commander EDHREC ranks 26,501-27,000, round edh-c-94 (third pass): the template data of parser/templates/zz-cloud/edh-c-94.json (exiles from the hand and loses life, "that player sacrifices that creature", the
 * lure under a condition, a group that gets an additional +N/+N and gains an ability, adamant of one color on the enters-with replacement, base power alone, noncombat damage of your sources to your opponents)
 * and the parser and renderer changes of the round (one test each). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example
 * does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in edh-c-94-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC94 from '../../../src/parser/templates/zz-cloud/edh-c-94.json';
import review94 from '../../m5/golden/cards/edh-c-94-review.json';
import reviewT4 from '../../m5/golden/cards/fast1-t4-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC94 as Template[];
/** The round's golden entries (the end-step Aura card, Lingering Death, is in the file of the template it promotes). */
const review = [...(review94 as { card: string; verified: string; expect?: string }[]), ...(reviewT4 as { card: string; verified: string; expect?: string }[]).filter((e) => e.verified.includes('edh-c-94'))];
const MECH_COUNT = 11;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 30,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv94.player.exilesFromHand.andLosesLife': ['Witness the End'],
  'eff.edhv94.thatPlayer.sacrifices.thatObject': ['Lingering Death'],
  'sta.edhv94.aslong.lure': ['Stone-Tongue Basilisk'],
  'eff.edhv94.grp.getsAdditional.andGain': ['Take to the Streets'],
  'rep.edhv94.enters.counter.adamantSameColor': ['Henge Walker'],
  'eff.edhv94.has.basePower.dur': ['Crater Elemental'],
  'sta.edhv94.self.extraBlock.forEach': ["Kemba's Legion"],
  'sta.edhv94.self.cantAttackAlone.unlessHasCounter': ['Pipsqueak, Rebel Strongarm'],
  'sta.edhv94.attached.getsAsLongAsAttacking.otherwiseGets': ["Tahngarth's Rage"],
  'eff.edhv94.payelse.lifeEqualTo': ['Essence Vortex'],
  'trg.edhv94.sourceNoncombatDamage.oneOrMoreOpponents.yourTurn': ['Molten Lavamancer'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : t.id.startsWith('sta.') && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.id.startsWith('sta.') || t.id.startsWith('rep.') ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-94 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-94.json, path order: after edh-c-9, before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-94.json');
    expect(files.indexOf('zz-cloud/edh-c-94.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-9.json'));
    expect(files.indexOf('zz-cloud/edh-c-94.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv94.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv94\./);
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

describe('edh-c-94 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/half/, 'a third of'], [/rounded up/, 'rounded down'], [/round up/, 'round down'], [/your/, 'their'], [/first/, 'second'], [/an opponent/, 'you'], [/less/, 'more'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-94 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-94 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-94 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-94 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Wizard', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const aura = (text: string) => parseCard(card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;

describe('edh-c-94 parser and renderer changes (one test each)', () => {
  it('parser/holes/object.ts#pluralPronouns and render/refs.ts (CR 608.2c, 115.1): "each of those creatures with flying" is the objects of the earlier targets that match the description; the bare "each of those creatures", another noun and no earlier targets stay manual', () => {
    const ok = sorcery('Tap two target creatures. ~ deals 2 damage to each of those creatures with flying.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"is":{"ref":"target","id":"t0"}');
    expect(JSON.stringify(ok.abilities)).toContain('"keyword":"flying"');
    for (const bad of [
      'Tap two target creatures. ~ deals 2 damage to each of those creatures.',
      'Tap two target creatures. ~ deals 2 damage to each of those artifacts with flying.',
      '~ deals 2 damage to each of those creatures with flying.',
      'Tap two target creatures. ~ deals 2 damage to each of those creatures with flying and first strike.',
    ]) expect(fullyAutomated(sorcery(bad)) && JSON.stringify(sorcery(bad).abilities).includes('"is":{"ref":"target"'), bad).toBe(false);
  });
  it('parser/holes/p2iv2.ts#selfEnchanted and render/p2iv2.ts (CR 303.4, 602.5b): "~ isn\'t enchanted" / "~ is not enchanted" is a negated "an Aura is attached to ~"; it is read of ~ only, and not "or equipped"', () => {
    const ok = creature("{U}{U}: Draw a card. Activate only if ~ isn't enchanted.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"cond":"not"');
    expect(JSON.stringify(ok.abilities)).toContain('"enchanted":true');
    expect(fullyAutomated(creature('{U}{U}: Draw a card. Activate only if ~ is not enchanted.'))).toBe(true);
    const plain = creature('{U}{U}: Draw a card. Activate only if ~ is enchanted.');
    expect(JSON.stringify(plain.abilities)).not.toContain('"cond":"not"');
    for (const bad of ["{U}{U}: Draw a card. Activate only if ~ isn't enchanted or equipped.", "{U}{U}: Draw a card. Activate only if it isn't enchanted.", "{U}{U}: Draw a card. Activate only if ~ isn't attached."]) expect(fullyAutomated(creature(bad)) && JSON.stringify(creature(bad).abilities).includes('"enchanted":true'), bad).toBe(false);
  });
  it('parser/holes/cond.ts and render/cond.ts (CR 508.1, 603.4): "it / that creature (didn\'t) attack(ed) this turn" about the creature an earlier part named; "didn\'t block" and the source itself without an antecedent are not that', () => {
    const base = "At the beginning of the end step of enchanted creature's controller, destroy that creature if it didn't attack this turn.";
    const ok = aura(base);
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"ev":"attacks"');
    expect(JSON.stringify(ok.abilities)).toContain('"cond":"not"');
    const yes = aura(base.replace("didn't attack", 'attacked'));
    expect(JSON.stringify(yes.abilities)).not.toContain('"cond":"not"');
    const unless = aura("At the beginning of the upkeep of enchanted creature's controller, that player loses 1 life unless that creature attacked this turn.");
    expect(fullyAutomated(unless)).toBe(true);
    for (const bad of [base.replace('attack', 'block'), base.replace('that creature', 'a creature')]) expect(fullyAutomated(aura(bad)) && jsonKey(aura(bad).abilities) === jsonKey(ok.abilities), bad).toBe(false);
  });
  it('statics/rule-sources.ts#untapStepOf and statics/hooks.ts (CR 502.3, 611.2a): the lock of "during target player\'s next untap step" exists in the data only as a resolved effect with a player (played in the scenarios)', () => {
    const ok = parseCard(card('Example Plan', 'Instant', "Creatures don't untap during target player's next untap step."), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"d":"throughNextUntap","whose"');
  });
});
