/**
 * Top-rank part 6 (EDHREC ranks 12,001-13,500), round edh-next-90: the template data of parser/templates/zz-cloud/edh-next-90.json (see the file) and the round's renderer, anaphora and engine
 * changes, tested at the end of this file and in edh-next-90-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked
 * against the local index when it is present.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext90 from '../../../src/parser/templates/zz-cloud/edh-next-90.json';
import review from '../../m5/golden/cards/edh-next-90-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext90 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (the round's record names each one "narrow wording, decided by the owner's standing rule 2026-10-27")
  'rid.edhn90.instead.mayPutThatCardBattlefield.if': ['Caravan Vigil'],
  'sta.edhn90.self.splitSecond.if': ['Molten Disaster'],
  'eff.edhn90.prevent.byChosenColorSources': ['Prismatic Strands'],
  'eff.edhn90.loyalty.twiceThisTurn': ['Urza Assembles the Titans'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  (t.kind === 'static' && !/^(Bargain|Kicker|Multikicker)/.test(text)) || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-90 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-90.json, path order: after edh-next-5.json, before zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-90.json');
    expect(files.indexOf('zz-cloud/edh-next-90.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-5.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn90.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhn90\./);
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

describe('edh-next-90 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bWalls\b/, 'Wall'], [/\bone\b/, 'two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-90 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-90 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b: a counter with a name no rule defines is allowed)
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

describe.skipIf(index === null)('edh-next-90 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-90 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-90 parser, renderer and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  /** fullyAutomated, and no manual cost part (a cost the model cannot state leaves the ability partial). */
  const strict = (f: ReturnType<typeof creature>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('parser/holes/cost.ts + render/costs.ts (CR 701.21a, 118.3): "Sacrifice ~ and another green creature" is a cost of two permanents; "another" only with one other permanent, not with several', () => {
    expect(strict(creature('{T}, Sacrifice this creature and another green creature: Draw a card.'))).toBe(true);
    expect(strict(creature('{T}, Sacrifice this creature and another creature you control: Draw a card.'))).toBe(true);
    expect(strict(creature('{T}, Sacrifice this creature and two other green creatures: Draw a card.'))).toBe(false);
    expect(strict(creature('{T}, Sacrifice another green creature and this creature: Draw a card.'))).toBe(false);
  });
  it('parser/holes/cost.ts + rules/cost.ts (CR 118.3, 701.9a, 201.2): "Discard three cards with different names" is a fixed number of two or more; one card, "at random" and "the same name" are not that', () => {
    expect(strict(creature('{1}{U}, Discard three cards with different names: Draw five cards.'))).toBe(true);
    expect(strict(creature('{1}{U}, Discard a card with a different name: Draw five cards.'))).toBe(false);
    expect(strict(creature('{1}{U}, Discard three cards at random with different names: Draw five cards.'))).toBe(false);
  });
  it('parser/lower/trigger-zone.ts (CR 701.9a, 113.6k, 603.12): a discard trigger may pay a fixed mana cost on resolution; an {X} or life payment keeps it manual', () => {
    expect(fullyAutomated(spell('Draw a card.\nWhen you discard this card, you may pay {B}. When you do, draw a card.'))).toBe(true);
    expect(fullyAutomated(spell('Draw a card.\nWhen you discard this card, you may pay {X}. When you do, draw a card.'))).toBe(false);
    expect(fullyAutomated(spell('Draw a card.\nWhen you discard this card, you may pay 2 life. When you do, draw a card.'))).toBe(false);
  });
  it('parser/holes/filter.ts + render/np.ts (CR 702.29a, 702.29f): "cards with cycling abilities" is the keyword filter of "a cycling ability"; another keyword plural is not read', () => {
    expect(fullyAutomated(creature('When this creature enters, return any number of target permanent cards with cycling abilities from your graveyard to the battlefield.'))).toBe(true);
    expect(fullyAutomated(creature('When this creature enters, return any number of target permanent cards with kicker abilities from your graveyard to the battlefield.'))).toBe(false);
  });
  it('parser/front/spellforms.ts + render/abil.ts (CR 702.61a, 702.33d): "If ~ was kicked, it has split second." is a static of the spell; another keyword or condition of the same wording is not that', () => {
    expect(fullyAutomated(spell('Kicker {4}{U}{U}{G}\nIf this spell was kicked, it has split second.\nYou gain 7 life and draw three cards.'))).toBe(true);
    expect(fullyAutomated(spell('Kicker {4}{U}{U}{G}\nIf this spell was kicked, it has flash.\nYou gain 7 life and draw three cards.'))).toBe(false);
    expect(fullyAutomated(spell('Kicker {4}{U}{U}{G}\nIf you control a Goblin, it has split second.\nYou gain 7 life and draw three cards.'))).toBe(false);
  });
  it('parser/lower/riders.ts (@alsoStep with @before, @guardPrevious; CR 614.15, 608.2d): the rider reaches the move before a shuffle; without a search that shuffles after the move it is not read', () => {
    expect(fullyAutomated(spell('Search your library for a basic land card, reveal it, put it into your hand, then shuffle.\nYou may put that card onto the battlefield instead of putting it into your hand if you control a Goblin.'))).toBe(true);
    expect(fullyAutomated(spell('Search your library for a basic land card, reveal it, put it into your hand, then shuffle.\nYou may put that card onto the battlefield tapped instead of putting it into your hand if you control a Goblin.'))).toBe(false);
  });
  it('render/evt.ts (CR 603.10a, 120.3, 608.2c): "whenever a creature you control dealt damage this way dies this turn" is said only for the group the damage step right before marked; another group or a creature that was not dealt damage by it is not that', () => {
    expect(fullyAutomated(spell('Example Plan deals 5 damage to each creature. Whenever a creature you control dealt damage this way dies this turn, add {R}.'))).toBe(true);
    expect(fullyAutomated(spell('Example Plan deals 5 damage to each creature. Whenever a creature you control dealt damage this way is exiled this turn, add {R}.'))).toBe(false);
    expect(fullyAutomated(spell('Draw a card. Whenever a creature you control dealt damage this way dies this turn, add {R}.'))).toBe(false);
  });
});
