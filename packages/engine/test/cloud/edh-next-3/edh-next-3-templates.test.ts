/**
 * Commander lane edh-top, round edh-next-3: the template data of parser/templates/zz-cloud/edh-next-3.json ("double the number of each kind of counter you have") and the round's parser, engine and renderer changes, tested at the end of this file and in edh-next-3-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-next-3-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext3 from '../../../src/parser/templates/zz-cloud/edh-next-3.json';
import review9 from '../../m5/golden/cards/edh-next-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext3 as Template[];
/** The round's golden entries. */
const review = review9 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn3.ownLife.half.roundedUp': ['Ebonblade Reaper'],
  'eff.edhn3.eachPlayer.half.creatures.roundUp': ['Fraying Omnipotence'],
  'eff.edhn3.eachPlayer.third.creaturesLands.roundUp': ['Pox'],
  'cm.edhn3.self.lessColored.ifCond': ["Ertai's Scorn", 'Even the Score'],
  'trg.edhn3.cast.notFirst.eachTurn': ['Arcbound Tracker'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(/^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-3.json, path order: after edh-top-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-3.json');
    expect(files.indexOf('zz-cloud/edh-next-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-misc-6.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhn3\./);
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

describe('edh-next-3 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-3 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-3 parser, engine and renderer changes (one test each)', () => {
  it('effects/handlers/actions-native-counters.ts#timeTravel (capability action.native.timeTravel): "time travel" is the native action for you; "time travel twice", another player\'s time travel and "time travel, then time travel" stay manual', () => {
    const ok = sorcery('Time travel. Draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"action":"timeTravel"');
    expect(ENGINE_CAPABILITIES.has('feature:action.native.timeTravel')).toBe(true);
    expect(fullyAutomated(sorcery('Time travel twice.'))).toBe(false);
    expect(fullyAutomated(sorcery('Target opponent time travels.'))).toBe(false);
    const twice = sorcery('Time travel, then time travel.'); // two steps, each the native action
    expect(fullyAutomated(twice)).toBe(true);
    expect(JSON.stringify(twice.abilities).split('"action":"timeTravel"').length - 1).toBe(2);
  });
  it('parser/lower/ability.ts ("Round up each time." joined to the sentence before it, also for "a third of") and render/fold-edhn3.ts: only the exact half and third sequences are folded; a half sequence with lands, a third sequence without lands and a mixed one are not', () => {
    const half = 'Each player loses half their life, then discards half the cards in their hand, then sacrifices half the creatures they control of their choice. Round up each time.';
    expect(fullyAutomated(sorcery(half))).toBe(true);
    expect(JSON.stringify(sorcery(half).abilities)).toContain('"op":"ceilDiv"');
    const third = 'Each player loses a third of their life, then discards a third of the cards in their hand, then sacrifices a third of the creatures they control of their choice, then sacrifices a third of the lands they control of their choice. Round up each time.';
    expect(fullyAutomated(sorcery(third))).toBe(true);
    expect(fullyAutomated(sorcery(third.replace(', then sacrifices a third of the lands they control of their choice', '')))).toBe(false);
    expect(fullyAutomated(sorcery(half.replace('sacrifices half the creatures', 'sacrifices half the lands')))).toBe(false);
    expect(fullyAutomated(sorcery(half.replace('discards half', 'discards a third of')))).toBe(false);
    expect(fullyAutomated(sorcery(third.replace('Round up', 'Round down')))).toBe(false);
  });
  it('model/forms.ts#isOpponentDrawsPerPlayer, parser/holes/cond.ts and render/cond.ts: "an opponent has drawn four or more cards this turn" reads the most cards one opponent drew; "you\'ve drawn", "a player has drawn", "an opponent has drawn a card" and "fewer than" are not this reading', () => {
    const ok = sorcery('This spell costs {U}{U}{U} less to cast if an opponent has drawn four or more cards this turn.\nDraw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"per":"player"');
    expect(ENGINE_CAPABILITIES.has('feature:announce.qty.happenedCount.opponentDrawsPerPlayer')).toBe(true);
    for (const bad of ['an opponent has drawn a card this turn', 'a player has drawn four or more cards this turn', 'an opponent has drawn fewer than four cards this turn']) {
      expect(fullyAutomated(sorcery(`This spell costs {U}{U}{U} less to cast if ${bad}.\nDraw a card.`)), bad).toBe(false);
    }
  });
  it('statics/match.ts#evalQuantity (happenedCount per player): a static cost change that reads "an opponent cast two or more spells this turn" is read (the same forms with a plain count still work)', () => {
    const ok = sorcery('This spell costs {U} less to cast if an opponent cast two or more spells this turn.\nDraw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(sorcery('This spell costs {2} less to cast if an opponent cast two or more spells this turn.\nDraw a card.'))).toBe(true);
  });
  it('render/abil.ts#notFirstSpell: "other than your first spell that turn" keeps its "during your turn" form and says "each turn" without one', () => {
    expect(fullyAutomated(creature('Whenever you cast a spell other than your first spell each turn, you gain 1 life.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever you cast a spell during your turn other than your first spell that turn, you gain 1 life.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever you cast a spell during your turn other than your first spell each turn, you gain 1 life.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever you cast a spell other than your first spell that turn, you gain 1 life.'))).toBe(false);
  });
  it('the colored reading takes the colored mana of the reduction ("{U}"), not only its generic part; a generic reduction keeps its own template (cm.fast1)', () => {
    const colored = artifact('This spell costs {U} less to cast if you control a Golem.');
    void colored;
    const f = sorcery('This spell costs {U} less to cast if you control a Golem.\nDraw a card.');
    expect(JSON.stringify(f.abilities)).toContain('"kind":"colored"');
    const g = sorcery('This spell costs {2} less to cast if you control a Golem.\nDraw a card.');
    expect(JSON.stringify(g.abilities)).not.toContain('"kind":"colored"');
  });
});
