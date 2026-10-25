/**
 * Lane trek, round trek-9 (Star Trek: library, graveyard and odd ones): the template data of parser/templates/zz-cloud/trek-9.json, the filter field
 * `attachedWith` (types/ability.ts#ObjectFilter; parser/holes/trek9.ts#attachedWithAt; rules/filter.ts, statics/match.ts; render/np.ts), the condition `share` with
 * `count: 'all'` (parser/holes/trek9.ts#allExiledShareCond; effects/eval.ts; render/cond.ts), the cost part `putIntoLibrary` (rules/cost.ts, rules/pay-parts.ts,
 * parser/holes/trek9.ts#putSelfIntoLibrary, render/costs.ts), the fold `ownersShuffleThem` (render/fold-trek9.ts), the renderer readings (render/steps-flow.ts,
 * render/np.ts, render/fold.ts#putOfThemAndRest) and the antecedent rule for "other" (parser/lower/anaphora.ts#withoutSizedOffFieldSources). Guard G9 (design 6.8): every example
 * lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design
 * 6.10), checked against the local index when it is present. The behavior is in trek-9-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the
 * cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-9.json';
import review from '../../m5/golden/cards/trek-9-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 3;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A spell: the sentences of a sorcery. */
const parse = (text: string, type = 'Sorcery', pt?: { power: string; toughness: string }) => parseCard(card('Example Ooze', type, text, pt ?? {}), OPTS).faces[0]!;
/** Fully automated, and no cost part the model cannot state (a `manual` cost part is no manual step: `automated` does not see it). */
const fully = (f: ReturnType<typeof parse>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('trek-9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-9.json, after trek-4, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-9.json');
    expect(files.indexOf('zz-cloud/trek-9.json')).toBeGreaterThan(files.indexOf('zz-cloud/trek-4.json'));
    expect(files.indexOf('zz-cloud/trek-9.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.trek9.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.trek9\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): each wording is printed on one card of the Star Trek set, so each template is stable on one hand-verified golden card', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual([
      'eff.trek9.dig.put.battlefieldTapped.rest.graveyard', 'eff.trek9.dig.reveal.hand.orCard.mvAtMost', 'eff.trek9.owners.shuffle.them.intoLibraries',
    ]);
    expect(evidence('eff.trek9.dig.put.battlefieldTapped.rest.graveyard')).toEqual(['Hit It!']);
    expect(evidence('eff.trek9.dig.reveal.hand.orCard.mvAtMost')).toEqual(["There's Coffee in that Nebula"]);
    expect(evidence('eff.trek9.owners.shuffle.them.intoLibraries')).toEqual(['Those Old Scientists']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-9 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bonto the battlefield tapped\b/, 'onto the battlefield'], [/\bthe rest into your graveyard\b/, 'the rest into your hand'], [/\bYou may reveal\b/, 'Reveal'], [/\binto your hand\b/, 'into your graveyard'],
    [/\bor less\b/, 'or greater'], [/\bshuffle them into their libraries\b/, 'shuffle them into their hands'], [/\bThe owners\b/, 'The controllers'], [/\bgraveyards\b/, 'hands'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-9 lowering and holes: the readings that are no template of their own', () => {
  it('CR 301.5, 303.4: "with a Communicator attached to it/them" is `attachedWith` (the lexicon knows Communicator, an Equipment type); "without" and a plural type word are no reading', () => {
    const one = parse('Destroy target creature with a Communicator attached to it.');
    expect(JSON.stringify(one.abilities)).toContain('"attachedWith":"Communicator"');
    expect(fullyAutomated(one), JSON.stringify(one.diagnostics)).toBe(true);
    const many = parse('You gain life equal to the number of creatures you control with an Equipment attached to them.');
    expect(JSON.stringify(many.abilities)).toContain('"attachedWith":"Equipment"');
    expect(fullyAutomated(many), JSON.stringify(many.diagnostics)).toBe(true);
    expect(fullyAutomated(parse('Destroy target creature without a Communicator attached to it.'))).toBe(false);
    expect(fullyAutomated(parse('Destroy target creature with Communicators attached to it.'))).toBe(false);
    expect(fullyAutomated(parse('Destroy target creature with a Dragon attached to it.'))).toBe(false); // a creature type is no attachment type
  });
  it('CR 205.2a, 607.2a: "all cards exiled with ~ share a card type" reads the cards the face\'s exiling instruction exiled (link `exiled`), `share` with `count: all`', () => {
    const saga = 'Enchantment — Saga';
    const f = parse('(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI, II, III -- Draw two cards, then exile a card from your hand.\nIV -- If all cards exiled with this Saga share a card type, you gain 10 life.', saga);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const json = JSON.stringify(f.abilities);
    expect(json).toContain('"cond":"share","what":"cardType","of":{"ref":"each","filter":{"zone":"exile","is":{"ref":"linked","link":"exiled"}}},"count":"all"');
    expect(json).toContain('"link":"exiled"'); // the chapters' exile is the linked instruction
    // no exiling instruction on the face: the condition reads nothing (unlinked), manual
    const lone = parse('IV -- If all cards exiled with this Saga share a card type, you gain 10 life.', saga);
    expect(fullyAutomated(lone)).toBe(false);
    // another description is no reading: "some", "two"
    expect(fullyAutomated(parse('(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI, II, III -- Draw two cards, then exile a card from your hand.\nIV -- If two cards exiled with this Saga share a card type, you gain 10 life.', saga))).toBe(false);
  });
  it('CR 118.3, 602.2b, 401.4: "Put this card from your graveyard on the bottom of your library" is the cost `putIntoLibrary` (graveyard, bottom or top); another zone is no reading', () => {
    const bottom = parse('{2}, Put this card from your graveyard on the bottom of your library: You gain 2 life.', 'Creature — Elf', { power: '1', toughness: '1' });
    expect(fully(bottom), JSON.stringify(bottom.diagnostics)).toBe(true);
    expect(JSON.stringify(bottom.abilities)).toContain('"other":[{"kind":"putIntoLibrary","zone":"graveyard","self":true,"position":"bottom"}]');
    expect(JSON.stringify(bottom.abilities)).toContain('"zone":["graveyard"]');
    const top = parse('{2}, Put this card from your graveyard on top of your library: You gain 2 life.', 'Creature — Elf', { power: '1', toughness: '1' });
    expect(fully(top), JSON.stringify(top.diagnostics)).toBe(true);
    expect(JSON.stringify(top.abilities)).toContain('"position":"top"');
    for (const other of ['{2}, Put this card from your hand on the bottom of your library: You gain 2 life.', '{2}, Put target card from your graveyard on the bottom of your library: You gain 2 life.', '{2}, Put this card from your graveyard into your library: You gain 2 life.']) {
      expect(fully(parse(other, 'Creature — Elf', { power: '1', toughness: '1' })), other).toBe(false);
    }
  });
  it('CR 608.2c, 122.1: "Then discard a card unless there are three or more quest counters on ~" is the negation of the count, said with "unless" (also with "this enchantment")', () => {
    for (const text of [
      'Whenever you cast a noncreature spell, put a quest counter on this enchantment. Draw a card. Then discard a card unless there are three or more quest counters on this enchantment.',
      'Whenever you cast a noncreature spell, draw a card. Then discard a card unless there are two or more quest counters on this enchantment.',
    ]) {
      const f = parse(text, 'Enchantment');
      expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.gate)}`).toBe(true);
    }
    // not for a count of another kind of thing, or "unless" with a bare comparison the renderer has no wording for
    expect(fullyAutomated(parse('Whenever you cast a noncreature spell, draw a card. Then discard a card unless you have three or more cards in hand.', 'Enchantment'))).toBe(false);
  });
  it('CR 701.20a, 202.3: "a Plains card or nonland permanent card with mana value 3 or less" is one article for the list (the words after the LAST description are its own), also with an article each', () => {
    for (const art of ['', 'a ']) {
      const f = parse(`Look at the top five cards of your library. You may reveal a Plains card or ${art}nonland permanent card with mana value 3 or less from among them and put it into your hand. Put the rest on the bottom of your library in a random order.`);
      expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
      expect(JSON.stringify(f.abilities)).toContain('"anyOf":[{"subtypes":["Plains"]},{"anyOf":[{"notTypes":["Land"],"types":["Artifact","Battle","Creature","Enchantment","Land","Planeswalker"]}],"manaValue":{"op":"<=","value":3}}]');
    }
  });
  it('CR 202.3: the one article for the list is said only when the descriptions before the last are lands: "a creature card or nonland permanent card with mana value 3 or less" is no reading (the limit could be the first\'s too), with an article each it is', () => {
    const text = (list: string): string => `Look at the top five cards of your library. You may reveal ${list} from among them and put it into your hand. Put the rest on the bottom of your library in a random order.`;
    expect(fullyAutomated(parse(text('a creature card or nonland permanent card with mana value 3 or less'))), 'no article for the second').toBe(false);
    expect(fullyAutomated(parse(text('a creature card or a nonland permanent card with mana value 3 or less')))).toBe(true);
    expect(fullyAutomated(parse(text('a land card or nonland permanent card with mana value 3 or less')))).toBe(true);
    expect(fullyAutomated(parse(text('a basic land card or nonland permanent card with mana value 3 or less')))).toBe(true);
  });
  it('CR 701.20e, 609.3: "Put a land card from among them onto the battlefield tapped and the rest into your graveyard" is said back for one chosen card of a description', () => {
    const f = parse('Look at the top five cards of your library. Put a land card from among them onto the battlefield tapped and the rest into your graveyard.');
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    expect(f.templatesUsed).toContain('eff.trek9.dig.put.battlefieldTapped.rest.graveyard');
    // "any number" and "up to two" stay their own templates' (the exactly-one fold reads min 1 / max 1 only)
    const any = parse('Look at the top five cards of your library. Put any number of land cards from among them onto the battlefield tapped and the rest into your graveyard.');
    expect(any.templatesUsed).not.toContain('eff.trek9.dig.put.battlefieldTapped.rest.graveyard');
  });
});

describe('trek-9 engine capabilities: registered by the code that honors them', () => {
  it('`cost:putIntoLibrary` and `cond:share` are engine capabilities; a cost part from another zone is not (`cost:putIntoLibrary.zone`)', () => {
    expect(ENGINE_CAPABILITIES.has('cost:putIntoLibrary')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('cond:share')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('cost:putIntoLibrary.zone')).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-9 design 6.10 (local index): synthetic examples', () => {
  it('no trek-9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
