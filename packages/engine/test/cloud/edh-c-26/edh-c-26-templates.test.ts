/**
 * Commander lane edh-c, round edh-c-26: the template data of parser/templates/zz-cloud/edh-c-26.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-c-26-scenarios.test.ts.
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
import edhC26 from '../../../src/parser/templates/zz-cloud/edh-c-26.json';
import review from '../../m5/golden/cards/edh-c-26-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC26 as Template[];
const MECH_COUNT = 10;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 30,000 that print each wording and are full
  'sta.edhv26.creatures.cantBeTargetedBySpells': ['Dense Foliage'],
  'eff.edhv26.player.draw.lose.get.energy2': ['Live Fast'],
  'eff.edhv26.destroy.obj.andSelf': ['Loyal Sentry'],
  'rep.edhv26.damage.toAttached.redirectController': ['Treacherous Link'],
  'eff.edhv26.destroy.all.typeOfYourChoice': ['Extinction'],
  'sta.edhv26.loyaltyAbilities.oppPlaneswalkers.costMore': ['Eidolon of Obstruction'],
  'sta.edhv26.self.cantattack.ifAnotherCreature': ['Shauku, Endbringer'],
  'eff.edhv26.damage.unlessTheyControlNOrMore': ['Furnace Punisher'],
  'abl.edhv26.kicked.counters2.grant': ['Voidpouncer'],
  'sta.edhv26.duringYourTurn.self.isSubtype.basePT': ['Circle of the Moon Druid'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-26 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-26.json, path order: after edh-c-2, before edh-c-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-26.json');
    expect(files.indexOf('zz-cloud/edh-c-26.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-2.json'));
    expect(files.indexOf('zz-cloud/edh-c-26.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv26.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|abl)\.edhv26\./);
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

describe('edh-c-26 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-26 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-26 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-26 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-26 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-c-26 renderer and lowering changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('render/stat.ts (CR 115.1; family group-cant-be-targeted-by-spells): "Creatures can\'t be the targets of spells." says the group without "all"; spells AND abilities, or a group that only an opponent\'s spells may not target, stay other readings', () => {
    const aura = (text: string) => parseCard(card('Example Moss', 'Enchantment', text), OPTS).faces[0]!;
    expect(fullyAutomated(aura("Creatures can't be the targets of spells."))).toBe(true);
    expect(fullyAutomated(aura("Creatures can't be the targets of spells your opponents control."))).toBe(false);
    expect(fullyAutomated(aura("Creatures can't be the targets of spells or abilities your opponents control."))).toBe(false);
  });
  it('render/stat.ts (CR 614.9): a static redirection of all the damage the enchanted creature would be dealt reads with no duration; "to you" and "combat damage" are other replacements and stay as they were', () => {
    const aura = (text: string) => parseCard(card('Example Aura', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
    expect(fullyAutomated(aura('All damage that would be dealt to enchanted creature is dealt to its controller instead.'))).toBe(true);
    expect(fullyAutomated(aura('All damage that would be dealt to enchanted creature is dealt to its controller instead. Spells you cast cost {1} less to cast.'))).toBe(false);
    expect(fullyAutomated(aura('All damage that would be dealt to enchanted creature is dealt to target player instead.'))).toBe(false);
  });
  it('render/steps.ts (CR 608.2c, 109.5): "unless they control two or more basic lands" is read for a damage step; one land ("a Forest") still reads as before, and "two or fewer" or "exactly two" stay manual', () => {
    expect(fullyAutomated(creature("At the beginning of each player's upkeep, ~ deals 2 damage to that player unless they control two or more basic lands.", 'Creature — Goblin'))).toBe(true);
    expect(fullyAutomated(creature("At the beginning of each player's upkeep, ~ deals 2 damage to that player unless they control a Forest.", 'Creature — Goblin'))).toBe(true);
    expect(fullyAutomated(creature("At the beginning of each player's upkeep, ~ deals 2 damage to that player unless they control two or fewer basic lands.", 'Creature — Goblin'))).toBe(false);
  });
  it('render/fold-edhv26.ts (CR 205.3m, 608.2c): the choice of a creature type and the destruction of the chosen type are both the one-sentence wording and the two sentences; a different follow-up stays manual', () => {
    expect(fullyAutomated(spell('Choose a creature type. Destroy all creatures of the chosen type.'))).toBe(true);
    expect(fullyAutomated(spell('Destroy all creatures of the creature type of your choice.'))).toBe(true);
    expect(fullyAutomated(spell('Choose a creature type. Destroy all creatures of the chosen type. Draw a card.'))).toBe(true);
    expect(fullyAutomated(spell('Destroy all lands of the creature type of your choice.'))).toBe(false);
  });
  it('model/cap-walk.ts (CR 605.1a, 606.1): a cost increase of loyalty abilities has its call-site (statics/costmods.ts#abilityCostModsFor); an increase with another ability kind is still not automated', () => {
    expect(fullyAutomated(creature('Loyalty abilities of planeswalkers your opponents control cost {1} more to activate.', 'Creature — Spirit'))).toBe(true);
    expect(fullyAutomated(creature('Loyalty abilities of planeswalkers your opponents control cost {1} less to activate.', 'Creature — Spirit'))).toBe(false);
  });
});
