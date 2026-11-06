/**
 * Commander EDHREC ranks 27,501-28,000, round edh-c-75 (second pass): the template data of parser/templates/zz-cloud/edh-c-75.json ("Each of them gets +N/+N until end of turn", "target creature becomes a color
 * until end of turn and attacks this turn if able", "prevent all damage that would be dealt by <spells or creatures>", "unless <player> pays {N} or N life", "has <keyword> for as long as ~ remains tapped",
 * "choose an opponent ... enters with a counter for each creature that player controls", "when a creature dealt damage this way dies this turn") and the
 * round's parser and renderer changes, tested at the end of this file and in edh-c-75-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-75-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC75 from '../../../src/parser/templates/zz-cloud/edh-c-75.json';
import review75 from '../../m5/golden/cards/edh-c-75-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC75 as Template[];
/** The round's golden entries. */
const review = review75 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv75.eachOfThem.get': ['Hope and Glory'],
  'eff.edhv75.becomesColor.andAttacks': ['Incite'],
  'sta.edhv75.prevent.allDamageBy.group': ['Energy Storm'],
  'eff.edhv75.payelse.costOrLife': ['Erosion'],
  'eff.edhv75.has.whileSourceTapped': ["Hisoka's Guard"],
  'rep.edhv75.enters.chooseOpponent.countersPerTheirCreature': ['Canker Abomination'],
  'eff.edhv75.whenDealtDamageThisWay.dies.thisTurn': ['Skeletonize'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^Equipped/.test(text) ? card('Example Plan', 'Artifact — Equipment', text)
    : /^Prevent all/.test(text) ? card('Example Plan', 'Enchantment', text)
    : /^(As |~ enters)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : /^Enchanted/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-75 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-75.json, path order: after edh-c-6, before edh-c-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-75.json');
    expect(files.indexOf('zz-cloud/edh-c-75.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-6.json'));
    expect(files.indexOf('zz-cloud/edh-c-75.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-8.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv75.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv75\./);
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

describe('edh-c-75 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-75 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-75 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-75 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-75 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    expect(verbatim, JSON.stringify(verbatim)).toEqual([]);
  }, 120_000);
});

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const instant = (text: string) => parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const aura = (text: string) => parseCard(card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;

describe('edh-c-75 parser and renderer changes (one test each)', () => {
  it('parser/holes/filter.ts (CR 303.4, 115.1): "target enchanted permanent" is any permanent an Aura is attached to; "enchanted permanent" without "target" is the Aura\'s own host, not a description', () => {
    const f = instant("Return target enchanted permanent to its owner's hand.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"enchanted":true}');
    expect(fullyAutomated(instant("Return target enchanting permanent to its owner's hand."))).toBe(false);
  });
  it('parser/holes/filter.ts (CR 202.3, 608.2c): "with the same mana value as <object>" compares the mana value of that object; "the same name as" is another quality; "without" has no reading', () => {
    const f = creature('{B}, Sacrifice a creature: Destroy each creature with the same mana value as the sacrificed creature.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toMatch(/"sharesWith":\{"with":\{"ref":"costSacrificed"\},"quality":"manaValue"\}/);
    expect(fullyAutomated(instant('Destroy target creature. Destroy each creature with the same mana value as that creature.'))).toBe(true);
    for (const bad of ['{B}, Sacrifice a creature: Destroy each creature with the same power as the sacrificed creature.', '{B}, Sacrifice a creature: Destroy each creature without the same mana value as the sacrificed creature.', '{B}, Sacrifice a creature: Destroy each creature with the same mana value as a creature.']) {
      const g = creature(bad);
      expect(fullyAutomated(g) && JSON.stringify(g.abilities).includes('"stat":"manaValue"'), bad).toBe(false);
    }
  });
  it('render/np.ts (CR 202.3): the same comparison is also said "mana value equal to the sacrificed creature\'s mana value"', () => {
    expect(fullyAutomated(creature("{B}, Sacrifice a creature: Destroy each creature with mana value equal to the sacrificed creature's mana value."))).toBe(true);
    expect(JSON.stringify(creature("{B}, Sacrifice a creature: Destroy each creature with mana value equal to the sacrificed creature's power.").abilities)).not.toContain('"stat":"manaValue"},"types"');
  });
  it('parser/holes/cond.ts (CR 508.1, 603.4): "unless that creature attacked this turn" reads the object the Aura is attached to; "unless that creature blocked this turn" or "attacks" is not read', () => {
    const f = aura("At the beginning of the end step of enchanted creature's controller, ~ deals 2 damage to that player unless that creature attacked this turn.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"ev":"attacks","attacker":{"is":{"ref":"attachedTo"}}');
    for (const bad of ["At the beginning of the end step of enchanted creature's controller, ~ deals 2 damage to that player unless that creature blocked this turn.", "At the beginning of the end step of enchanted creature's controller, ~ deals 2 damage to that player unless that creature attacks this turn."]) {
      const g = aura(bad);
      expect(fullyAutomated(g) && JSON.stringify(g.abilities).includes('"ev":"attacks"'), bad).toBe(false);
    }
  });
  it('parser/parse.ts#linkChosenOpponent (CR 614.12a, 607.2d): one body that chooses an opponent and counts that player\'s creatures is both producer and reader; a second choice or a reader in another ability without a choice is still unlinked', () => {
    expect(fullyAutomated(creature('As ~ enters, choose an opponent. ~ enters with a +1/+1 counter on it for each creature that player controls.'))).toBe(true);
    expect(fullyAutomated(creature('As ~ enters, choose an opponent.\nWhen the chosen player loses the game, you win the game.'))).toBe(true);
    const bad = creature('When the chosen player loses the game, you win the game.');
    expect(fullyAutomated(bad)).toBe(false);
  });
  it('render/steps-flow.ts (CR 118.12a, 119.4): "unless that player pays {1} or 1 life" is a payment of the mana, else of the life, else the instruction; only a payment of mana first', () => {
    const f = aura("At the beginning of the upkeep of enchanted creature's controller, ~ deals 2 damage to that player unless that player pays {1} or 1 life.");
    expect(fullyAutomated(f)).toBe(true);
    expect(fullyAutomated(aura("At the beginning of the upkeep of enchanted creature's controller, ~ deals 2 damage to that player unless that player pays 1 life or {1}."))).toBe(false);
  });
});
