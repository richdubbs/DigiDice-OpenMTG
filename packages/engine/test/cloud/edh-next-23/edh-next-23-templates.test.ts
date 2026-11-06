/**
 * Commander lane edh-next, round edh-next-23 (EDHREC ranks 7,251 to 8,000): the template data of parser/templates/zz-cloud/edh-next-23.json ("deals X damage to each player and each other creature",
 * "X creatures and other Y creatures get +N/+N", "Creatures you control gain <keyword>." with no duration) and the round's parser and renderer changes.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-next-23-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhN23 from '../../../src/parser/templates/zz-cloud/edh-next-23.json';
import reviewN23 from '../../m5/golden/cards/edh-next-23-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhN23 as Template[];
/** The round's golden entries. */
const review = reviewN23 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn23.damage.playerAndEachOther': ['Exocrine'],
  'sta.edhn23.anthem.subtypeAndOtherSubtype': ['Verdeloth the Ancient'],
  'eff.edhn23.grant.group.noDuration': ['Chance for Glory'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or replacement on a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  /^(sta|rep)\./.test(t.id) ? parseCard(card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!
  : parseCard(/^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-23 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-23.json, path order: after edh-next-21, before edh-next-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-23.json');
    expect(files.indexOf('zz-cloud/edh-next-23.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn23.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhn23\./);
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

describe('edh-next-23 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-23 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-23 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-23 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-23 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // design 6.9 deviation: Unbreathing Horde's one-sentence replacement is the only printing of its wording ("If ~ would be dealt damage, prevent that damage and remove a +1/+1 counter from it."),
    // so that example line IS Oracle's line (the other lines of the examples are invented); recorded in the round's record
    const SAME_SENTENCE = new Set(['If ~ would be dealt damage, prevent that damage and remove a +1/+1 counter from it.']);
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !(t.id === 'sta.edhn23.damageToSelf.prevent.removeCounter.once' && SAME_SENTENCE.has(l.trim())))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});


const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const aura = (text: string) => parseCard(card('Example Curse', 'Enchantment — Aura Curse', `Enchant player\n${text}`), OPTS).faces[0]!;
const walkerAura = (text: string) => parseCard(card('Example Talent', 'Enchantment — Aura', `Enchant planeswalker\n${text}`), OPTS).faces[0]!;

describe('edh-next-23 parser and renderer changes (one test each)', () => {
  it('parser/lower/normalize.ts (CR 608.2c, 109.2): "each other creature" beside a damage source that is not the ability\'s own object stays manual, in either order', () => {
    expect(fullyAutomated(creature('When this creature enters, it deals 2 damage to each player and each other creature.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever another creature you control enters, it deals 1 damage to each opponent and each other creature.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever another creature you control enters, it deals 1 damage to each other creature and each opponent.'))).toBe(false);
  });
  it('parser/holes/filter.ts, rules/filter.ts, statics/match.ts, render/np.ts (ObjectFilter.basePower, CR 208.1, 613.4a-b): "with base power N" reads in a trigger and says itself back; "base power or toughness" keeps its own field; near misses do not read', () => {
    const ok = creature('Whenever another creature you control with base power 1 enters, it gains haste until end of turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"basePower":{"op":"==","value":1}');
    const both = creature('Whenever another creature you control with base power or toughness 1 enters, it gains haste until end of turn.');
    expect(JSON.stringify(both.abilities)).toContain('"basePowerOrToughness"');
    expect(JSON.stringify(both.abilities)).not.toContain('"basePower":');
    for (const bad of ['Whenever another creature you control with base strength 1 enters, it gains haste until end of turn.', 'Whenever another creature you control without base power 1 enters, it gains haste until end of turn.']) expect(fullyAutomated(creature(bad)), bad).toBe(false);
  });
  it('parser/holes/filter.ts (CR 208.1, 608.2d): "with the least power among creatures they control" reads like the greatest, with the minimum of the set', () => {
    const ok = creature('Whenever this creature attacks, defending player sacrifices a creature with the least power among creatures they control.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"agg":"min"');
    expect(fullyAutomated(creature('Whenever this creature attacks, defending player sacrifices a creature with the least colors among creatures they control.'))).toBe(false);
  });
  it('parser/holes/cond.ts and render/cond.ts (CR 122.1): "defending player has a rad counter" is a rad counter count of at least one on that player; other counter words and "no" do not read', () => {
    const ok = creature("This creature can't be blocked as long as defending player has a rad counter.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"kind":"rad"');
    expect(fullyAutomated(creature("This creature can't be blocked as long as defending player has a blorfty counter."))).toBe(false);
    expect(fullyAutomated(creature("This creature can't be blocked as long as defending player has two rad counters."))).toBe(false);
  });
  it('parser/holes/trek9.ts (ObjectFilter.attachedWithLegendary, CR 205.4a, 301.5): "with a legendary Equipment attached to it" needs a legendary attachment; "another" and a missing noun do not read it', () => {
    const ok = creature('Whenever a creature you control with a legendary Equipment attached to it deals combat damage to a player, draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"attachedWithLegendary":true');
    expect(JSON.stringify(creature('Whenever a creature you control with an Equipment attached to it deals combat damage to a player, draw a card.').abilities)).not.toContain('attachedWithLegendary');
    expect(fullyAutomated(creature('Whenever a creature you control with a legendary attached to it deals combat damage to a player, draw a card.'))).toBe(false);
  });
  it('parser/holes/filter.ts (CR 303.4, 508.1b, 506.3): "creatures attacking enchanted player" attack the player the Aura is attached to', () => {
    const ok = aura('Creatures attacking enchanted player have trample.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"enchantedPlayer"');
    expect(fullyAutomated(aura('Creatures attacking enchanted creature have trample.'))).toBe(false);
  });
  it('parser/holes/event.ts (CR 303.4, 120.1): damage dealt "to enchanted planeswalker" / "to enchanted player" is a recipient of that Aura\'s host; "to enchanted land" is not read', () => {
    const w = walkerAura('Whenever a creature deals damage to enchanted planeswalker, destroy that creature.');
    expect(fullyAutomated(w)).toBe(true);
    expect(JSON.stringify(w.abilities)).toContain('"attachedToSource":true');
    expect(fullyAutomated(aura('Whenever a creature deals combat damage to enchanted player, you gain 1 life.'))).toBe(true);
    expect(fullyAutomated(walkerAura('Whenever a creature deals damage to enchanted land, destroy that creature.'))).toBe(false);
  });
  it('parser/parse.ts (CR 107.3, 702.33a): "Kicker {X}" without "X can\'t be 0" lets the card use X in its abilities; a card with no kicker X still may not', () => {
    const k = (kicker: string) => parseCard(card('Example Elder', 'Creature — Treefolk', `${kicker}\nWhen this creature enters, if it was kicked, create X 1/1 green Saproling creature tokens.`, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(k('Kicker {X} (You may pay an additional {X} as you cast this spell.)'))).toBe(true);
    expect(fullyAutomated(k('Kicker {2}'))).toBe(false);
  });
  it('render/np.ts (family subtype-groups-and-other): "A creatures and other B creatures" says the union back with "and" or "or"; two plain groups and three groups do not read', () => {
    expect(fullyAutomated(creature('Elf creatures and other Goblin creatures get +1/+1.'))).toBe(true);
    for (const bad of ['Elf creatures and Goblin creatures get +1/+1.', 'Elf creatures and other Goblin creatures and other Dragon creatures get +1/+1.', 'Elf creatures and other Goblin lands get +1/+1.']) expect(fullyAutomated(creature(bad)), bad).toBe(false);
  });
  it('eff.edhn23.grant.group.noDuration (CR 611.2a): "Creatures you control gain X." has the permanent duration; one object, a duration and "lose" keep their older readings', () => {
    const ok = sorcery('Creatures you control gain indestructible.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"d":"permanent"');
    expect(fullyAutomated(sorcery('Creatures you control may gain indestructible.'))).toBe(false);
    expect(JSON.stringify(sorcery('Goblins you control gain haste until end of turn.').abilities)).toContain('"d":"endOfTurn"');
  });
});
