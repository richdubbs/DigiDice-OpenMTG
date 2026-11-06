/**
 * Commander effort, round edh-next-19 (EDHREC ranks 11,251 to 12,500, fourth pass; template id code edhn19): the template data of parser/templates/zz-cloud/edh-next-19.json (see the
 * file) and the round's parser, lowering, engine and renderer changes, tested at the end of this file and in edh-next-19-scenarios.test.ts.
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
import edhN19 from '../../../src/parser/templates/zz-cloud/edh-next-19.json';
import review from '../../m5/golden/cards/edh-next-19-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhN19 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21 and the standing rule of 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'sta.edhn19.group.lose.keyword': ['Melira, Sylvok Outcast'],
  'rst.edhn19.you.cant.getKindCounters': ['Melira, Sylvok Outcast'],
  'eff.edhn19.dur.control.andHaste': ['Besmirch'],
  'eff.edhn19.dur.youControl.andHaste': ['Grab the Reins'],
  'eff.edhn19.untapAndGoad': ['Besmirch'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Enchanted ') ? card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Instant', text), OPTS).faces[0]!;

describe('edh-next-19 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-19.json, path order: after edh-next-13, before edh-next-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-19.json');
    expect(files.indexOf('zz-cloud/edh-next-19.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-13.json'));
    expect(files.indexOf('zz-cloud/edh-next-19.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn19.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rst)\.edhn19\./);
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

describe('edh-next-19 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bhaste\b/, 'x'], [/\blose\b/, 'gain'], [/\bpoison\b/, 'x'], [/\buntap\b/, 'tap'], [/\bgoad\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-19 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-19 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words[i + 1]?.startsWith('counters')) return; // the name of a kind of counter is an open class (design 6.11): "blorfty counters" is a kind of counter
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

describe.skipIf(index === null)('edh-next-19 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-19 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-19 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/filter.ts, rules/filter.ts (CR 208.1, 613.4b): "with base power and toughness 2/2" is read with two numbers only; "base power or toughness" stays its own reading', () => {
    expect(fullyAutomated(creature('Whenever a creature you control with base power and toughness 2/2 attacks, it gets +1/+1 until end of turn.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever a creature you control with base power and toughness 2 attacks, it gets +1/+1 until end of turn.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever a creature you control without base power and toughness 2/2 attacks, it gets +1/+1 until end of turn.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever a creature you control with base power or toughness 1 attacks, it gets +1/+1 until end of turn.'))).toBe(true);
  });
  it('parser/holes/qty.ts, effects/eval.ts (CR 119.1, 500.1): "that player\'s life total as the turn began" is read after a life total only', () => {
    expect(fullyAutomated(creature("Whenever another player loses the game, you gain life equal to that player's life total as the turn began."))).toBe(true);
    expect(fullyAutomated(creature("Whenever another player loses the game, you gain life equal to that player's life total as the game began."))).toBe(false);
  });
  it('render/evt.ts (CR 102.2, 603.2): "another player loses the game" and "an opponent loses the game" are the same trigger; "a player" is not', () => {
    expect(fullyAutomated(creature('Whenever another player loses the game, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever an opponent loses the game, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever a player loses the game, draw a card.'))).toBe(true);
  });
  it('parser/holes/cond.ts, render/cond.ts (CR 107.1, 208.1): "~\'s power is even / odd" and "toughness"; another parity word is not read', () => {
    expect(fullyAutomated(creature("As long as ~'s power is even, you may cast noncreature spells as though they had flash."))).toBe(true);
    expect(fullyAutomated(creature("As long as ~'s power is odd, you may cast creature spells as though they had flash."))).toBe(true);
    expect(fullyAutomated(creature("As long as ~'s power is prime, you may cast creature spells as though they had flash."))).toBe(false);
  });
  it('render/stat.ts (CR 611.2a, 119.7): a ban on gaining life with no stated end is said "for the rest of the game"', () => {
    expect(fullyAutomated(creature("Whenever ~ deals damage to a player, that player can't gain life for the rest of the game."))).toBe(true);
    expect(fullyAutomated(creature("Whenever ~ deals damage to a player, that player can't gain life this turn."))).toBe(true);
  });
  it('render/fold-edhn19.ts (CR 611.2a, 701.15a): the control-and-haste sentence and "untap and goad that creature" only in their exact shapes', () => {
    expect(fullyAutomated(spell('Until end of turn, gain control of target creature and it gains haste. Untap and goad that creature.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell('Until end of turn, gain control of target creature and it gains haste. Goad and untap that creature.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(spell('Until your next turn, gain control of target creature and it gains haste.', 'Sorcery'))).toBe(true);
  });
  it('review: a static ability reads the life total as the turn began from the same record (statics/match.ts)', () => {
    expect(fullyAutomated(creature("As long as your life total is less than your life total as the turn began, ~ has flying."))).toBe(true);
  });
});
