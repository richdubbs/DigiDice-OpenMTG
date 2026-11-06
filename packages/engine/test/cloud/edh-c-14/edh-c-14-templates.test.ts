/**
 * Commander EDHREC ranks 16,251-16,875, round edh-c-14 (second pass): the template data of parser/templates/zz-cloud/edh-c-14.json (choose an opponent at random, "attacks that player this combat if able", "loses half their life, rounded down", search ... "and reveal that card", "reveal those cards, and put one onto the battlefield tapped and the other into your hand", "put a counter on ~, then it deals damage equal to its power", "you and another target player each draw a card", "return two lands to their owner's hand") and the round's parser, engine and renderer changes, tested at the end of this file and in edh-c-14-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-14-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC14 from '../../../src/parser/templates/zz-cloud/edh-c-14.json';
import review14 from '../../m5/golden/cards/edh-c-14-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC14 as Template[];
/** The round's golden entries. */
const review = review14 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv14.choose.opponentAtRandom': ['Ruhan of the Fomori', 'Raving Dead'],
  'eff.edhv14.obj.attacksPlayer.thisCombat': ['Ruhan of the Fomori', 'Raving Dead'],
  'eff.edhv14.player.loses.halfLife.roundedDown': ['Raving Dead'],
  'eff.edhv14.search.andRevealThatCard': ['Wild Research'],
  'eff.edhv14.search.upTo.revealPutOneOtherHand.noShuffle': ['Peregrination'],
  'eff.edhv14.draw.youAndAnotherTargetPlayer': ['Splinter, Aging Champion'],
  'eff.edhv14.self.counter.thenItDealsPower': ['Captain Ripley Vance'],
  'eff.edhv14.return.choose.theirOwnersHand': ['Khalni Gem'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-14 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-14.json, path order: before edh-c-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-14.json');
    expect(files.indexOf('zz-cloud/edh-c-14.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv14.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv14\./);
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

describe('edh-c-14 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-14 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-14 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // edh-next-76: a counter's kind is any word (CR 122.1); "it" after "on ~, then" is now the one source, so "a blorfty counter" parses
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

describe.skipIf(index === null)('edh-c-14 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-14 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const saga = (text: string) => parseCard(card('Example Plan', 'Enchantment — Saga', text), OPTS).faces[0]!;

describe('edh-c-14 parser, engine and renderer changes (one test each)', () => {
  it('parser/lower/anaphora.ts (CR 701.50a, 201.5): "it connives" after a trigger of the object itself (several events, or becoming the target of a spell you control); a bare "it" after other triggers is not changed', () => {
    expect(fullyAutomated(creature('Whenever this creature enters or attacks, it connives.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature becomes the target of a spell you control, it connives.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature enters or attacks, it connives twice.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever this creature enters or attacks, each creature you control connives.'))).toBe(false);
  });
  it('parser/holes/player.ts and render/refs.ts (CR 115.1, 601.2c, 603.3d): "target opponent chosen at random" is one random target; a player, two targets and "another" are other readings', () => {
    const ok = creature('At the beginning of your end step, target opponent chosen at random gains control of this creature.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"random":true');
    for (const bad of ['At the beginning of your end step, target player chosen at random gains control of this creature.', 'At the beginning of your end step, up to two target opponents chosen at random gain control of this creature.']) {
      expect(fullyAutomated(creature(bad)) && JSON.stringify(creature(bad).abilities).includes('"random":true'), bad).toBe(false);
    }
  });
  it('parser/holes/object.ts and render/np.ts (CR 208.1, 115.1): "target creature you control with the greatest power" is the tied greatest among creatures you control; another controller or "least" is not this reading', () => {
    const ok = saga('I — Put a +1/+1 counter on target creature you control with the greatest power.\nII — Put a +1/+1 counter on target creature you control with the greatest power.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"agg":"max"');
    for (const bad of ['I — Put a +1/+1 counter on target creature an opponent controls with the greatest power.', 'I — Put a +1/+1 counter on target creature you control with the least power.', 'I — Put a +1/+1 counter on target creature with the greatest power.']) {
      const f = saga(`${bad}\nII — Draw a card.`);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"agg":"max"') && JSON.stringify(f.abilities).includes('"controller":"you"'), bad).toBe(false);
    }
  });
  it('parser/holes/qty.ts (CR 122.1, 107.3): "the number of different kinds of counters among permanents you control" counts kinds; "colors" and "counters" are other readings', () => {
    const ok = sorcery('Target creature you control gets +X/+X until end of turn, where X is the number of different kinds of counters among permanents you control.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"what":"counterKinds"');
    expect(JSON.stringify(sorcery('Target creature you control gets +X/+X until end of turn, where X is the number of counters among permanents you control.').abilities)).not.toContain('"what":"counterKinds"');
  });
  it('parser/holes/filter.ts and render/np.ts (CR 702.29a, 702.29f): "cards with a cycling ability" is cycling or any typecycling; "without a cycling ability" is not read', () => {
    const ok = sorcery('This spell deals X damage to any target, where X is the number of cards with a cycling ability in your graveyard.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"keyword":["cycling","typecycling"]');
    expect(fullyAutomated(sorcery('This spell deals X damage to any target, where X is the number of cards without a cycling ability in your graveyard.'))).toBe(false);
  });
  it('render/steps.ts (CR 608.2c): a guarded pump of a target is said either way ("Target creature gets +2/+2 until end of turn if its power is 2." or "If its power is 2, target ... gets"); a different condition keeps both readings', () => {
    expect(fullyAutomated(sorcery('Target creature you control gets +2/+2 until end of turn if its power is 2. Then it fights target creature you don\'t control.'))).toBe(true);
    expect(fullyAutomated(sorcery('Target creature you control gets +2/+2 until end of turn if its power is 2 or less. Then it fights target creature you don\'t control.'))).toBe(true);
  });
  it('render/costs.ts (CR 118.3, 122.1): "Remove ten oil counters from among permanents you control and sacrifice ~" is one cost list; sacrificing another permanent is not this wording', () => {
    expect(fullyAutomated(parseCard(card('Example Plan', 'Artifact', '{T}, Remove ten oil counters from among permanents you control and sacrifice this artifact: It deals 10 damage to any target.'), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Plan', 'Artifact', '{T}, Remove ten oil counters from among permanents you control and sacrifice a creature: It deals 10 damage to any target.'), OPTS).faces[0]!)).toBe(false);
  });
});
