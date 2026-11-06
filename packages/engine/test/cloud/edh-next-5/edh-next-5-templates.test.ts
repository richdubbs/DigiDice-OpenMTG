/**
 * Commander lane edh-next, round edh-next-5: the template data of parser/templates/zz-cloud/edh-next-5.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-5-scenarios.test.ts.
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
import edhNext5 from '../../../src/parser/templates/zz-cloud/edh-next-5.json';
import review from '../../m5/golden/cards/edh-next-5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext5 as Template[];
const MECH_COUNT = 10;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 15,000 that print each wording and are full
  'sta.edhn5.group.are.sized.creatures.stillLands': ["Nature's Revolt"],
  'sta.edhn5.group.are.sized.color.creatures.stillLands': ['Kormus Bell'],
  'sta.edhn5.group.are.sized.color.subtype.creatures.stillLands': ['Ambush Commander'],
  'sta.edhn5.lifeFloor.damageReducesTo1': ['Fortune Thief'],
  'sta.edhn5.lifeFloor.damageReducesTo7.asLongAs': ['Elderscale Wurm'],
  'trg.edhn5.you.castOrCycle.self': ['Drownyard Lurker', 'Warped Tusker'],
  'trg.edhn5.you.cycle.another.firstEachTurn': ['Valiant Rescuer'],
  'eff.edhn5.counter.unlessTheyPay': ['Hope-Ender Coatl'],
  'eff.edhn5.dur.pump.loseKeyword': ['Mu Yanling, Sky Dancer'],
  'sta.edhn5.duringTurn.anthem.grant': ['Street Riot'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-5.json, path order: after edh-next-3, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-5.json');
    expect(files.indexOf('zz-cloud/edh-next-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-3.json'));
    expect(files.indexOf('zz-cloud/edh-next-5.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn5.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhn5\./);
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

describe('edh-next-5 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-5 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-5 renderer and lowering changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('render/mods.ts (CR 205.1b, 613.1d): the group of lands is said "are N/N ... creatures that are still lands"; the same change of another group stays manual', () => {
    expect(fullyAutomated(creature('All lands are 2/2 creatures that are still lands.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('All artifacts are 2/2 creatures that are still lands.', 'Enchantment'))).toBe(false);
    expect(fullyAutomated(creature('All lands are 2/2 creatures that are still artifacts.', 'Enchantment'))).toBe(false);
    expect(fullyAutomated(creature('All Forests and all artifacts are 1/1 creatures that are still lands.', 'Enchantment'))).toBe(false);
  });
  it('render/stat.ts (CR 120.3a, 614.1a): the life floor of a static ability says its floor; a floor of 1 needs no condition, a floor above 1 says "as long as you have N or more life"', () => {
    expect(fullyAutomated(creature('Damage that would reduce your life total to less than 1 reduces it to 1 instead.'))).toBe(true);
    expect(fullyAutomated(creature('As long as you have 7 or more life, damage that would reduce your life total to less than 7 reduces it to 7 instead.'))).toBe(true);
    expect(fullyAutomated(creature('Damage that would reduce your life total to less than 7 reduces it to 7 instead.'))).toBe(false);
    expect(fullyAutomated(creature('As long as you have 6 or more life, damage that would reduce your life total to less than 7 reduces it to 7 instead.'))).toBe(false);
  });
  it('render/evt.ts (CR 702.29a, 601.2i): "When you cast or cycle ~" is one trigger of the two events; with one more word it stays manual', () => {
    expect(fullyAutomated(creature('When you cast or cycle ~, draw a card.\nCycling {1}'))).toBe(true);
    expect(fullyAutomated(creature('When you cast or cycle another creature, draw a card.\nCycling {1}'))).toBe(false);
  });
  it('lower/trigger-zone.ts (CR 113.6k): a cast-or-cycle trigger whose effect names the card (return it to your hand) stays manual', () => {
    expect(fullyAutomated(creature('When you cast or cycle ~, return it to your hand.\nCycling {1}'))).toBe(false);
  });
  it('lower/trigger-zone.ts (CR 118.12a): a payment on resolution keeps the cast-or-cycle trigger manual', () => {
    expect(fullyAutomated(creature('When you cast or cycle ~, you may pay {2}. If you do, draw two cards.\nCycling {1}'))).toBe(false);
  });
  it('render/steps-flow.ts (CR 118.12): "unless they pay" of a countered spell is said with "they"; for a player target it keeps its other readings', () => {
    expect(fullyAutomated(spell('Counter target spell unless they pay {2}.'))).toBe(true);
    expect(fullyAutomated(spell('Counter target spell unless that player pays {2}.'))).toBe(false);
  });
});
