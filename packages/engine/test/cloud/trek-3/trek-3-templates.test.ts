/**
 * trek-3 (lane trek, Star Trek cards): the template data of parser/templates/zz-cloud/trek-3.json ("<object> [also] gains <abilities> <duration> if <condition>",
 * "<objects> gain <abilities> <duration> if <condition>", "<player> exiles that card, then draws N cards", "<player> may search their library for a <card>, reveal
 * it, put it into their hand, then shuffle"), and the round's other changes, one test each:
 *   - scripts/gen-lexicon.ts: the creature types a card's rules text gives the creature tokens it creates ("two 2/2 black Romulan creature tokens") join the
 *     index subtypes (CR 111.4, 205.3m);
 *   - parser/holes/cost.ts#discardDesc: "a basic land card or a card named Starship Enterprise" (CR 201.2: a name needs no card of the index);
 *   - render/np.ts: "Spacecraft creatures" (a stationed Spacecraft is an artifact creature that keeps its artifact subtype, CR 205.3g, 721.2b); a type that does
 *     not go with a subtype is still refused (the gate is not loosened);
 *   - render/fold-trek3.ts with RefInfo.handOwner: "If you do, that player exiles that card, then draws a card" after a choice from that player's hand (the readings
 *     are in test/m5/render/equivalence.test.ts, family owner-exiles-chosen-then-draws).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in trek-3-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { GENERATED_LEXICON, lexiconIndex } from '../../../src/parser/front/lexicon-index';
import { renderGate } from '../../../src/render/gate';
import trek3 from '../../../src/parser/templates/zz-cloud/trek-3.json';
import ownReview from '../../m5/golden/cards/trek-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { indexSubtypes } from '../../../../../scripts/gen-lexicon';

const MECH = trek3 as Template[];
const MECH_COUNT = 4;
/** The golden cards of the round (its own review file, guide section 6). */
const review = [...ownReview] as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner. 70,000 Light-Years from Home is
 * in the held-out half, opened by the owner for the Star Trek request of 2026-10-24.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.trek3.player.exiles.chosen.thenDraws': ['Salt Vampire'],
  'eff.trek3.player.may.search.reveal.hand': ['70,000 Light-Years from Home'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature's triggered ability ("When ~ enters"), else a sorcery's effect. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(/~|^(When|At) /.test(text) ? card('Example Rider', 'Creature — Human Soldier', text, { power: '2', toughness: '2' }) : card('Example Rite', 'Sorcery', text), OPTS).faces[0]!;

describe('trek-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-3.json, after zz-cloud/std-woe.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-3.json');
    expect(files.indexOf('zz-cloud/trek-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-woe.json'));
    expect(files.indexOf('zz-cloud/trek-3.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.trek3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.trek3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
    // the plural form waits for its conditions ("if a creature you control has flying" has no Cond reading yet): no card it makes full, so experimental
    expect(MECH.find((t) => t.id === 'eff.trek3.grant.each.ifCond')!.status).toBe('experimental');
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = review.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const c of NARROW[t.id]!) expect(cards, t.id).toContain(c);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
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
        const same = t.examples.some((e) => jsonKey(parsedWith(t, e.text).abilities) === jsonKey(f.abilities));
        expect(fullyAutomated(f) && same, c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} this way.`];
  const swaps: [RegExp, string][] = [
    [/\bmay\b/, 'must'], [/\bgains\b/, 'loses'], [/\bgain\b/, 'lose'], [/\bif\b/, 'unless'], [/\buntil end of turn\b/, 'until your next turn'], [/\byou control\b/, 'an opponent controls'],
    [/\bexiles\b/, 'discards'], [/\bdraws\b/, 'mills'], [/\btheir hand\b/, 'your hand'], [/\breveal it\b/, 'exile it'], [/\btheir library\b/, 'your library'],
    [/\bthat player\b/, 'you'], [/\bthen shuffle\b/, 'then draw a card'], [/\bbasic\b/, 'nonbasic'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/this way" or a swapped key word never gives the example's JSON`, () => {
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

describe('trek-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe('trek-3 scripts/gen-lexicon.ts (CR 111.4, 205.3m): the creature types of the tokens a card creates are index subtypes', () => {
  const base = {
    cardTypes: ['Artifact', 'Creature', 'Enchantment', 'Instant', 'Land', 'Sorcery'], supertypes: ['Legendary', 'Snow'],
    subtypes: [{ singular: 'Elf', plural: 'Elves', class: 'creature' as const }, { singular: 'Gizmoid', plural: 'Gizmoids', class: 'artifact' as const }],
    colors: [{ word: 'white', color: 'W' }, { word: 'blue', color: 'U' }, { word: 'black', color: 'B' }, { word: 'red', color: 'R' }, { word: 'green', color: 'G' }],
  };
  it('reads "<P>/<T> [<colors>] <Types> [artifact] creature token(s)" (synthetic cards); a funny card and a known word are left alone, a type line keeps its class', () => {
    const cards = [
      { type_line: 'Sorcery', oracle_text: 'Create two 2/2 black Zorgian creature tokens.' },
      { type_line: 'Enchantment', oracle_text: 'Whenever you gain life, create a 1/1 white and blue Elf Quux creature token with flying.' },
      { type_line: 'Artifact', oracle_text: 'Create a 0/0 colorless Blorb artifact creature token.' },
      { type_line: 'Instant', oracle_text: 'Create an X/X red, green, and white Wumpet creature token, where X is your life.' },
      { type_line: 'Sorcery', set_type: 'funny', oracle_text: 'Create a 1/1 Fanboy creature token.' },
      { type_line: 'Artifact — Zibbit', oracle_text: 'Create a 1/1 Zibbit creature token.' },
      { type_line: 'Sorcery', oracle_text: 'Create a 1/1 green Elf creature token and a 1/1 Gizmoid creature token.' },
      { type_line: 'Sorcery', oracle_text: 'Create a Treasure token. Target creature gets +1/+1 until end of turn.' },
    ];
    expect(indexSubtypes(cards, base)).toEqual([
      { singular: 'Blorb', plural: 'Blorbs', class: 'creature' },
      { singular: 'Quux', plural: 'Quuxes', class: 'creature' },
      { singular: 'Wumpet', plural: 'Wumpets', class: 'creature' },
      { singular: 'Zorgian', plural: 'Zorgians', class: 'creature' },
      { singular: 'Zibbit', plural: 'Zibbits', class: 'artifact' },
    ]);
    // without colors (the old signature), a token description with a color word reads nothing; "colorless" (CR 105.2c) and a type line still do
    const { colors: _colors, ...noColors } = base;
    expect(indexSubtypes(cards, noColors).map((s) => s.singular)).toEqual(['Blorb', 'Zibbit']);
  });
  it('the checked-in lexicon knows Romulan (a creature type printed only on the tokens of In the Pale Moonlight), with its plural', () => {
    expect(GENERATED_LEXICON.subtypes.find((s) => s.singular === 'Romulan')).toEqual({ singular: 'Romulan', plural: 'Romulans', class: 'creature' });
    expect(lexiconIndex().subtypes.has('romulans')).toBe(true);
    const index = localIndex();
    if (index !== null) expect(indexSubtypes(index, GENERATED_LEXICON as never).length).toBe(0); // nothing of the local index is left out
  });
});

describe('trek-3 parser/holes/cost.ts#discardDesc (CR 201.2, 701.23a): "a basic land card or a card named <name>"', () => {
  const SEARCH = 'Search your library and/or graveyard for a basic land card or a card named Zorgo Blade, reveal it, and put it into your hand. If you search your library this way, shuffle.';
  it('reads either card, the second one by its name alone (no card of the index needs the name)', () => {
    const f = parsedWith(MECH[0]!, SEARCH);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (f.abilities[0] as AbilityDef & { effect: { steps: { op: string; filter?: unknown }[] } }).effect.steps;
    expect(steps[0]).toMatchObject({ op: 'search', zone: 'library', alsoZones: ['graveyard'], filter: { anyOf: [{ supertypes: ['Basic'], types: ['Land'] }, { name: 'Zorgo Blade' }] }, reveal: true });
  });
  it('only a name as the second half: "a basic land card or a creature card" is not this reading', () => {
    const f = parsedWith(MECH[0]!, SEARCH.replace('a card named Zorgo Blade', 'a creature card'));
    expect(JSON.stringify(f.abilities)).not.toContain('"name"');
  });
});

describe('trek-3 render/np.ts (CR 205.3g, 721.2b): "Spacecraft creatures"', () => {
  const ctx = { selfNames: ['Example Captain'], selfTypes: ['Creature'] };
  const anthem = (subtypes: string[]): AbilityDef => ({ kind: 'static', text: '', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], subtypes, controller: 'you' } }, mods: [{ layer: '7c', power: 3, toughness: 3 }] }] } as unknown as AbilityDef);
  it('a stationed Spacecraft is an artifact creature with its artifact subtype: the renderer says "Spacecraft creatures you control get +3/+3"', () => {
    expect(renderGate(anthem(['Spacecraft']), ['Spacecraft creatures you control get +3/+3.'], ctx).ok).toBe(true);
    const f = parseCard(card('Example Captain', 'Creature — Human Officer', 'Spacecraft creatures you control get +3/+3.', { power: '3', toughness: '3' }), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
  });
  it('the gate is not loosened: a creature type filter with an Equipment subtype is still refused', () => {
    const r = renderGate(anthem(['Equipment']), ['Equipment creatures you control get +3/+3.'], ctx);
    expect(r.ok).toBe(false);
    expect(r.rendered).toContain('does not go with the subtype Equipment');
  });
});

describe('trek-3 render/fold-trek3.ts (CR 406.1, 121.1, 608.2c): "that player exiles that card, then draws a card" only of the player whose hand it was', () => {
  const LOOK = "When ~ enters, look at target opponent's hand. You may choose a nonland card from it. If you do, ";
  it('the hand\'s owner exiles and draws: automated', () => {
    expect(fullyAutomated(parsedWith(MECH[0]!, `${LOOK}that player exiles that card, then draws a card.`))).toBe(true);
  });
  it('you draw instead of that player: not this fold, not automated by this template', () => {
    const f = parsedWith(MECH[0]!, `${LOOK}that player exiles that card, then you draw a card.`);
    expect(f.templatesUsed).not.toContain('eff.trek3.player.exiles.chosen.thenDraws');
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-3 design 6.10 (local index): synthetic examples', () => {
  it('no trek-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
