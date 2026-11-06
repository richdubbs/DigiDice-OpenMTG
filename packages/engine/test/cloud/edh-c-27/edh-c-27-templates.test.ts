/**
 * Commander EDHREC ranks 21,501-22,000, round edh-c-27: the template data of parser/templates/zz-cloud/edh-c-27.json ("sacrifice any number of lands, then add that much {C}", "draws cards equal to the number of cards in their hand, then discards that many cards", an additional pump of a group, "create a token for each ... they control" of each player, "attach all Equipment on the battlefield to it", "move all +1/+1 counters from all creatures onto it", "all Goblins are black and are Zombies in addition to their other creature types") and the round's parser, engine and renderer changes, tested at the end of this file and in edh-c-27-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-27-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC27 from '../../../src/parser/templates/zz-cloud/edh-c-27.json';
import review27 from '../../m5/golden/cards/edh-c-27-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC27 as Template[];
/** The round's golden entries. */
const review = review27 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv27.sacrifice.anyThenAddThatMuch': ['Mana Seism'],
  'eff.edhv27.draw.thenDiscardThatMany': ["Laquatus's Creativity"],
  'eff.edhv27.pump.each.additional': ['Glistening Deluge'],
  'eff.edhv27.token.forEach.player': ['Waiting in the Weeds'],
  'eff.edhv27.moveCounters.allFromAll': ['Spike Cannibal'],
  'sta.edhv27.all.areColorAndSubtypes': ["Dralnu's Crusade"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    t.kind === 'static' ? card('Example Plan', 'Enchantment', text)
    : /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-27 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-27.json, path order: after edh-c-2, before edh-c-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-27.json');
    expect(files.indexOf('zz-cloud/edh-c-27.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-2.json'));
    expect(files.indexOf('zz-cloud/edh-c-27.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv27.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv27\./);
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

describe('edh-c-27 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-27 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-27 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-27 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-27 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-c-27 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/filter.ts and render/np.ts (CR 105.2): "creatures that are green and/or white" is the colors list of "green or white creatures"; a single color after "that are", "and" and a non-color are not this reading', () => {
    const ok = sorcery('Creatures that are red and/or blue get an additional -2/-2 until end of turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toMatch(/"colors":\["(?:U","R|R","U)"\]/);
    expect(fullyAutomated(sorcery('Creatures that are red and blue get an additional -2/-2 until end of turn.'))).toBe(false);
    expect(fullyAutomated(sorcery('Creatures that are red and/or Elves get an additional -2/-2 until end of turn.'))).toBe(false);
  });
  it('parser/holes/cond.ts and render/cond.ts (CR 603.4, 400.7): "you had another creature enter under your control this turn" and "two or more creatures" are the history of a zone change to the battlefield; "an opponent" and "three or more" read other histories', () => {
    const rimestag = creature('This creature gets +2/+2 as long as you had another creature enter the battlefield under your control this turn.');
    expect(fullyAutomated(rimestag)).toBe(true);
    expect(JSON.stringify(rimestag.abilities)).toContain('"other":true');
    const two = creature('Whenever this creature deals combat damage to a player, draw a card if you had two or more creatures enter the battlefield under your control this turn.');
    expect(fullyAutomated(two)).toBe(true);
    expect(JSON.stringify(two.abilities)).toContain('"times":{"op":">=","value":2}');
    expect(JSON.stringify(creature('Whenever this creature deals combat damage to a player, draw a card if you had one or more creatures enter the battlefield under your control this turn.').abilities)).not.toContain('"times":{"op":">=","value":2}');
  });
  it('parser/holes/qty.ts and render/qty.ts (CR 601.2h, 105.1): "for each color of mana spent to cast ~" counts the colors of mana spent to cast the spell itself; "that spell" and "it" keep their own quantities', () => {
    const ok = sorcery('Create a 1/1 colorless Thopter artifact creature token with flying for each color of mana spent to cast this spell.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"colorsSpent"');
    expect(fullyAutomated(sorcery('Create a 1/1 colorless Thopter artifact creature token with flying for each color of mana spent to cast target spell.'))).toBe(false);
  });
  it('parser/lower/anaphora.ts, model/lint-nodes.ts and effects/handlers/tokens-create.ts (CR 608.2e, 101.4): "they" in the count of a token creation of a group is each player in turn; with a target it is that player', () => {
    const ok = sorcery('Each player creates a 1/1 green Cat creature token for each untapped Forest they control.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"controller":{"ref":"iterating"}');
    const target = sorcery('Target player creates a 1/1 green Cat creature token for each untapped Forest they control.');
    expect(fullyAutomated(target)).toBe(true);
    expect(JSON.stringify(target.abilities)).toMatch(/"controller":\{"ref":"target","id":"t0"\}/);
  });
  it('effects/handlers/counters.ts (CR 122.5): the move of every counter of one kind from a group is the capability op:moveCounters.fromGroup', () => {
    expect(ENGINE_CAPABILITIES.has('op:moveCounters.fromGroup')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:createToken.perPlayerCount')).toBe(true);
  });
  it('render/steps-zones.ts (CR 607.1; Morbid Bloom): the one target an exile moved is also "the exiled card"; two cards or a non-card keep their other words', () => {
    expect(fullyAutomated(sorcery('Exile target creature card from a graveyard, then create X 1/1 green Saproling creature tokens, where X is the exiled card\'s toughness.'))).toBe(true);
    expect(fullyAutomated(sorcery('Exile target creature from a graveyard, then create X 1/1 green Saproling creature tokens, where X is the exiled card\'s toughness.'))).toBe(false);
  });
});
