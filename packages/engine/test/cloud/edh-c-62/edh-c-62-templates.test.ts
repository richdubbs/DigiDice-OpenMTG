/**
 * Commander EDHREC ranks 25,001-25,500, round edh-c-62 (second pass): the template data of parser/templates/zz-cloud/edh-c-62.json ("The creature can't be regenerated.", "Draw a card for each time ~ was kicked",
 * "During turns other than yours, ~ is a P/T <subtypes> artifact creature with <abilities>", "<player> gains control of all <objects>") and the round's parser and renderer changes, tested at the end of this file and in
 * edh-c-62-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-62-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC62 from '../../../src/parser/templates/zz-cloud/edh-c-62.json';
import review62 from '../../m5/golden/cards/edh-c-62-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC62 as Template[];
/** The round's golden entries. */
const review = review62 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rid.edhv62.noregen.theCreature': ['Mephitic Ooze'],
  'eff.edhv62.draw.perKick': ['Spell Contortion'],
  'sta.edhv62.otherturns.is.sized.artifactcreature.with': ['Warden of the Wall'],
  'eff.edhv62.player.gainControl.all': ['Sky Swallower'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : t.id.startsWith('sta.') && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.id.startsWith('sta.') ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-62 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-62.json, path order: before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-62.json');
    expect(files.indexOf('zz-cloud/edh-c-62.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-4.json'));
    expect(files.indexOf('zz-cloud/edh-c-62.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv62.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv62\./);
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

describe('edh-c-62 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-62 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-62 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-62 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-62 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;
const enchantment = (text: string) => parseCard(card('Example Plan', 'Enchantment', text), OPTS).faces[0]!;

describe('edh-c-62 parser and renderer changes (one test each)', () => {
  it('render/steps-zones.ts (CR 701.19c, 608.2c; family destroyed-this-way-no-regen-the-noun): "Destroy that creature. The creature can\'t be regenerated." after a destroy; a rider on another instruction, or of another noun, stays manual', () => {
    const base = 'Whenever this creature deals combat damage to a creature, destroy that creature. The creature can\'t be regenerated.';
    expect(fullyAutomated(creature(base))).toBe(true);
    expect(JSON.stringify(creature(base).abilities)).toContain('"regeneration":"cant"');
    for (const bad of [base.replace('destroy that creature', 'exile that creature'), base.replace('The creature', 'The land'), base.replace('can\'t', 'can')]) expect(fullyAutomated(creature(bad)) && JSON.stringify(creature(bad).abilities).includes('"regeneration":"cant"'), bad).toBe(false);
  });
  it('parser/holes/cond.ts and render/cond.ts (CR 105.1, 202.2, 608.2c): "it shares a color with the most common color among all permanents or a color tied for most common" is any color the object is that is the most common (or tied); a lesser wording is another condition', () => {
    const base = 'Destroy target creature if it shares a color with the most common color among all permanents or a color tied for most common.';
    const ok = sorcery(base);
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"cond":"any"');
    for (const bad of [base.replace('most common color', 'least common color'), base.replace('shares a color with', 'is'), base.replace(' or a color tied for most common', '')]) expect(fullyAutomated(sorcery(bad)) && jsonKey(sorcery(bad).abilities) === jsonKey(ok.abilities), bad).toBe(false);
  });
  it('parser/lower/quantities.ts and render/steps-life.ts (CR 601.2i, 202.3, 608.2h): "that much damage" after a cast trigger that compares the spell\'s mana value is the spell\'s mana value; another trigger with no amount, or a spell without the comparison, stays manual', () => {
    const base = 'Whenever you cast a spell with mana value equal to the number of doom counters on this enchantment, this enchantment deals that much damage to any target.';
    const ok = enchantment(base);
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"stat":"manaValue"');
    for (const bad of ['Whenever you cast a spell, this enchantment deals that much damage to any target.', 'Whenever you attack, this enchantment deals that much damage to any target.', 'Whenever you cast a spell with mana value equal to the number of doom counters on this enchantment, this enchantment gains that much life.']) {
      const f = enchantment(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"stat":"manaValue"'), bad).toBe(false);
    }
  });
  it('render/fold-trek17.ts (CR 701.20a, 122.1, 608.2c): "For each nonland card revealed this way, put a +1/+1 counter on ~" also folds while the revealed cards are still in the library (the draw comes after); a different description of cards or two counters stays manual', () => {
    const base = 'When this creature enters, each player reveals the top card of their library. For each nonland card revealed this way, put a +1/+1 counter on this creature. Then each player draws a card.';
    expect(fullyAutomated(creature(base))).toBe(true);
    for (const bad of [base.replace('nonland', 'blorfty'), base.replace('a +1/+1 counter', 'two +1/+1 counters'), base.replace('each player reveals', 'you reveal')]) expect(fullyAutomated(creature(bad)) && jsonKey(creature(bad).abilities) === jsonKey(creature(base).abilities), bad).toBe(false);
  });
  it('render/mods.ts (CR 205.1b, 613.1d, 613.4b; family is-sized-artifact-creature-with): "~ is a 2/3 Gargoyle artifact creature with flying" says the added artifact creature types, the abilities and the base power and toughness; a creature (not artifact) or a different change stays manual', () => {
    const ok = artifact('During turns other than yours, this artifact is a 2/3 Gargoyle artifact creature with flying.');
    expect(fullyAutomated(ok)).toBe(true);
    for (const bad of ['During turns other than yours, this artifact is a 2/3 Gargoyle creature with flying.', 'During your turn, this artifact is a 2/3 Gargoyle artifact creature with flying.', 'During turns other than yours, this artifact gets +2/+3 and is a Gargoyle artifact creature with flying.']) expect(fullyAutomated(artifact(bad)) && jsonKey(artifact(bad).abilities) === jsonKey(ok.abilities), bad).toBe(false);
  });
  it('render/steps-flow.ts (CR 608.2c, 608.2d; family they-may-pay-caster): "Whenever a player casts a spell, they may pay {1}. If the player does, they draw a card ..." names the caster "they"; another trigger (a player draws a card) stays another reading', () => {
    const base = 'Whenever a player casts a spell, they may pay {1}. If the player does, they draw a card at the beginning of the next end step.';
    expect(fullyAutomated(artifact(base))).toBe(true);
    for (const bad of [base.replace('they may pay', 'you may pay'), base.replace('casts a spell', 'draws a card'), base.replace('If the player does', 'If the player doesn\'t')]) expect(fullyAutomated(artifact(bad)) && jsonKey(artifact(bad).abilities) === jsonKey(artifact(base).abilities), bad).toBe(false);
  });
  it('parser/holes/p2iv2.ts and render/p2iv2.ts (CR 601.2i, 603.4): "that player didn\'t cast a creature spell this turn" is no spell of that description cast by the player; "a spell" in its place is the older reading, a blorfty spell is none', () => {
    const base = 'At the beginning of each opponent\'s end step, if that player didn\'t cast a creature spell this turn, create a 2/2 green Lizard creature token.';
    const ok = enchantment(base);
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"spell":{"types":["Creature"]}');
    expect(JSON.stringify(enchantment(base.replace('a creature spell', 'a spell')).abilities)).not.toContain('"spell":{"types"');
    expect(fullyAutomated(enchantment(base.replace('creature', 'blorfty')))).toBe(false);
  });
  it('render/steps-lasting.ts (CR 508.1c, 611.2a; family comma-and-cant-attack): "..., and creatures that player controls can\'t attack this turn" joins a second instruction; the two-sentence wording stays one too; a duration other than this turn does not', () => {
    const one = 'Target player can\'t cast spells this turn, and creatures that player controls can\'t attack this turn.';
    const two = 'Target player can\'t cast spells this turn. Creatures that player controls can\'t attack this turn.';
    expect(fullyAutomated(sorcery(one))).toBe(true);
    expect(jsonKey(sorcery(one).abilities)).toBe(jsonKey(sorcery(two).abilities));
    expect(fullyAutomated(sorcery(one.replace('can\'t attack this turn', 'can\'t attack next turn')))).toBe(false);
  });
});
