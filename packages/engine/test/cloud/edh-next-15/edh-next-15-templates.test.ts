/**
 * Commander lane edh-next, round edh-next-15: the template data of parser/templates/zz-cloud/edh-next-15.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-15-scenarios.test.ts.
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
import edhNext15 from '../../../src/parser/templates/zz-cloud/edh-next-15.json';
import review from '../../m5/golden/cards/edh-next-15-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext15 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'sta.edhn15.crewUsesToughness': ['Giant Ox'],
  'eff.edhn15.each.dealsItselfOwnPower': ['Solar Blaze'],
  'eff.edhn15.eachOfThose.dealsOwnPower': ['Polukranos, World Eater'],
  'eff.edhn15.ifPlayerDealtDamageThisWay.then': ['Play with Fire'],
  'rep.edhn15.enters.counters.numberEqual.onSelf': ['Dakkon, Shadow Slayer'],
  'eff.edhn15.youAnd.each.createTapped': ['Thran Spider'],
  'eff.edhn15.counters.eachGroup.andEachOtherGroup': ['Ajani Unyielding'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. A legendary creature for the wording that
 * calls the object "him" (CR 201.5, a named character: parser/front/selfref.ts), a planeswalker for "each other planeswalker you control".
 */
const parsedWith = (t: Template, text: string) => parseCard(
  t.id === 'rep.edhn15.enters.counters.numberEqual.onSelf' ? card('Example Relic', 'Legendary Creature — Construct', text, { power: '2', toughness: '2' })
    : t.id === 'eff.edhn15.counters.eachGroup.andEachOtherGroup' && text.startsWith('−') ? card('Example Walker', 'Planeswalker — Example', text, { loyalty: '4' })
      : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) || /^Example Relic /.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-15 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-15.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-15.json');
    expect(files.indexOf('zz-cloud/edh-next-15.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-1.json'));
    expect(files.indexOf('zz-cloud/edh-next-15.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 15; ids are *.edhn15.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm)\.edhn15\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(15);
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

describe('edh-next-15 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-15 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-15 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter kind is any word (Oracle invents them)
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

describe.skipIf(index === null)('edh-next-15 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-15 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-15 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('statics/hooks.ts#crewSaddleValue (CR 702.122a): the crew-only toughness rule is a rule modification the engine runs; the saddle wording stays the old template\'s and a different verb stays manual', () => {
    expect(fullyAutomated(creature('Defender\n~ crews Vehicles using its toughness rather than its power.'))).toBe(true);
    expect(fullyAutomated(creature('~ saddles Mounts and crews Vehicles using its toughness rather than its power.'))).toBe(true);
    expect(fullyAutomated(creature('~ assigns combat damage using its toughness rather than its power and crews Vehicles using its toughness rather than its power.'))).toBe(false);
  });
  it('render/steps-life.ts (CR 120.3, 608.2h): "each creature deals damage to itself equal to its power" and "each of those creatures deals damage equal to its power to ~"; another amount or recipient stays manual', () => {
    expect(fullyAutomated(spell('Each creature deals damage to itself equal to its power.'))).toBe(true);
    expect(fullyAutomated(spell('Each creature deals damage to itself equal to its toughness.'))).toBe(false);
    expect(fullyAutomated(spell('Each creature deals damage to itself equal to the number of creatures you control.'))).toBe(false);
    expect(fullyAutomated(creature('When ~ enters, it deals 3 damage divided as you choose among any number of target creatures your opponents control. Each of those creatures deals damage equal to its power to ~.'))).toBe(true);
    expect(fullyAutomated(creature('When ~ enters, it deals 3 damage divided as you choose among any number of target creatures your opponents control. Each of those creatures deals damage equal to its power to target player.'))).toBe(false);
  });
  it('parser/lower/quantities.ts#lifeLostSources + render/steps-util.ts (CR 119.3, 608.2h): "that much" after one loss of life by you or a target is the life actually lost; after two losses, or a loss by a group, it stays manual', () => {
    expect(fullyAutomated(spell('Target opponent loses 3 life. You gain that much life.'))).toBe(true);
    expect(fullyAutomated(spell('Target opponent loses 1 life for each attacking creature you control. You gain that much life.'))).toBe(true);
    expect(fullyAutomated(spell('You lose 2 life. Target opponent gains that much life.'))).toBe(true);
    expect(fullyAutomated(spell('Target opponent loses 3 life. You lose 1 life. You gain that much life.'))).toBe(false);
    expect(fullyAutomated(spell('Each opponent loses 3 life. You gain that much life.'))).toBe(false);
  });
  it('render/cond.ts (CR 608.2c, 120.3): "if a player is dealt damage this way" is at least one of the players the damage step dealt damage to; a creature, or "this turn", stays manual', () => {
    expect(fullyAutomated(spell('Example Plan deals 2 damage to any target. If a player is dealt damage this way, scry 1.'))).toBe(true);
    expect(fullyAutomated(spell('Example Plan deals 2 damage to any target. If a player is dealt damage this way, draw a card.'))).toBe(true);
    expect(fullyAutomated(spell('Example Plan deals 2 damage to any target. If a player is dealt damage this turn, scry 1.'))).toBe(false);
  });
  it('parser/holes/event.ts + render/evt.ts (CR 120.1): "deals damage to a creature or opponent" is damage to a creature or to an opponent of the controller; "or you" and "or planeswalker" stay manual', () => {
    expect(fullyAutomated(creature('Whenever this creature deals damage to a creature or opponent, this creature deals that much damage to you.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature deals damage to a creature or opponent, you gain that much life.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature deals damage to a creature or opponent or planeswalker, this creature deals that much damage to you.'))).toBe(false);
  });
});
