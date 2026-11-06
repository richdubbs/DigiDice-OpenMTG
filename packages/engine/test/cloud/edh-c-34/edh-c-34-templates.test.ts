/**
 * Commander EDHREC ranks 25,001-25,500, round edh-c-34 (first pass): the template data of parser/templates/zz-cloud/edh-c-34.json ("All creatures lose <keyword>", "... and islandwalk", "discards a card if <condition>", "activated abilities of <filter> cost {N} more to activate", "each other <filter> gains <abilities>") and the round's parser, engine and renderer changes, tested at the end of this file and in edh-c-34-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-34-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC34 from '../../../src/parser/templates/zz-cloud/edh-c-34.json';
import review34 from '../../m5/golden/cards/edh-c-34-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC34 as Template[];
/** The round's golden entries. */
const review = review34 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhv34.group.lose.keyword': ['Gravity Sphere'],
  'sta.edhv34.group.lose.keywordAndIslandwalk': ['Mystic Decree'],
  'eff.edhv34.discard.player.ifCond': ['Triumph of Cruelty'],
  'sta.edhv34.activatedAbilitiesOf.costMore': ['Gloom'],
  'eff.edhv34.eachOther.gains': ['Smogsteed Rider'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    t.kind === 'static' ? card('Example Plan', 'World Enchantment', text)
    : /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-34 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-34.json, path order: before edh-c-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-34.json');
    expect(files.indexOf('zz-cloud/edh-c-34.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-4.json'));
    expect(files.indexOf('zz-cloud/edh-c-3.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-34.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv34.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv34\./);
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

describe('edh-c-34 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-34 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-34 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-34 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-34 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const world = (text: string) => parseCard(card('Example Plan', 'World Enchantment', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const aura = (text: string) => parseCard(card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
const instant = (text: string) => parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;

describe('edh-c-34 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/player.ts (CR 608.2c; Greener Pastures): "the player creates a token" after "if that player controls ..." is "that player"; without an antecedent, or after a different player, it is not read', () => {
    const ok = card('Example Plan', 'Enchantment', "At the beginning of each player's upkeep, if that player controls more lands than each other player, the player creates a 1/1 green Saproling creature token.");
    expect(fullyAutomated(parseCard(ok, OPTS).faces[0]!)).toBe(true);
    expect(JSON.stringify(parseCard(ok, OPTS).faces[0]!.abilities)).toContain('"role":"player"');
    for (const bad of ['You draw a card. The player creates a 1/1 green Saproling creature token.', "At the beginning of your upkeep, target opponent loses 1 life. Target player gains 1 life. The player creates a 1/1 green Saproling creature token."]) {
      expect(fullyAutomated(parseCard(card('Example Plan', 'Enchantment', bad), OPTS).faces[0]!), bad).toBe(false);
    }
  });
  it('parser/lower/scope.ts and render/refs.ts (CR 201.5, 115.1; Elder Cathar): after "When ~ dies, ... target creature you control", "that creature" and "it" are the target, not the dead object; another trigger subject is not changed', () => {
    const ok = creature('When this creature dies, put a +1/+1 counter on target creature you control. If that creature is a Human, put two +1/+1 counters on it instead.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"id":"t0"');
    expect(fullyAutomated(creature('Whenever another creature you control dies, put a +1/+1 counter on target creature you control. If that creature is a Human, put two +1/+1 counters on it instead.'))).toBe(false); // two creatures to mean: still not read
    expect(fullyAutomated(creature('When this creature dies, put a +1/+1 counter on target creature you control. If that creature is a Human, put two +1/+1 counters on this creature instead.'))).toBe(false);
  });
  it('parser/holes/cond.ts (CR 105.2, 608.2h; Filigree Fracture): "if that permanent was blue or black" is any of the colors; "and" and a color the permanent cannot be are other readings', () => {
    const ok = instant('Destroy target artifact or enchantment. If that permanent was blue or black, draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"colors":["U","B"]');
    expect(fullyAutomated(instant("Destroy target artifact or enchantment. If that permanent wasn't blue or black, draw a card."))).toBe(true);
    expect(fullyAutomated(instant('Destroy target artifact or enchantment. If that permanent was blue and black, draw a card.'))).toBe(false);
  });
  it('statics/mods.ts and render/mods.ts (CR 702.14a, 702.14c, 613.1f): "lose ... islandwalk" takes away the island landwalk only, written "islandwalk"', () => {
    const ok = world('All creatures lose flying and islandwalk.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"landwalk:island"');
    expect(fullyAutomated(world('All creatures lose flying and swampwalk.'))).toBe(false);
  });
  it('parser/holes/filter.ts and render/np.ts (CR 509.1g-h, 506.4; Wall of Corpses): "target creature this creature is blocking" is the creature the object blocks; another object or "blocked by" a third one is not this reading', () => {
    const ok = creature('{B}, Sacrifice this creature: Destroy target creature this creature is blocking.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"blockedByObject":{"ref":"self"}');
    expect(fullyAutomated(creature('{B}, Sacrifice this creature: Destroy target creature that creature is blocking.'))).toBe(false);
  });
  it('parser/holes/player.ts, rules/targets.ts and render/refs.ts (CR 115.1, 119.3; Rix Maadi Guildmage): "target player who lost life this turn" is a target restriction; two targets, "another" or an opponent who lost life are not this reading', () => {
    const ok = creature('{B}{R}: Target player who lost life this turn loses 1 life.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"lostLife":true');
    expect(fullyAutomated(creature('{B}{R}: Target player who gained life this turn loses 1 life.'))).toBe(false);
    expect(fullyAutomated(creature('{B}{R}: Two target players who lost life this turn each lose 1 life.'))).toBe(false);
  });
});
