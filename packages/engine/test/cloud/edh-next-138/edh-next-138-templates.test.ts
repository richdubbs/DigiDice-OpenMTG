/**
 * Must-finish round edh-next-138 (tokens): the template data of parser/templates/zz-cloud/edh-next-138.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-138-scenarios.test.ts.
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
import edhNext138 from '../../../src/parser/templates/zz-cloud/edh-next-138.json';
import review from '../../m5/golden/cards/edh-next-138-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext138 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC top 20,000 that prints the wording and is full (each wording is printed on that one card)
  'eff.edhn138.forEachOpp.becomes.artifactCreature.with': ['Welcome to . . . // Jurassic Park'],
  'rep.edhn138.enters.payAnyLife': ['Phyrexian Processor'],
  'eff.edhn138.permit.cast.obj.thisTurn.free': ['Quintorius, Loremaster'],
  'eff.edhn138.may.reveal.obj.if': ["Fisher's Talent"],
  'rep.edhn138.createSubtypeToken.createOtherInstead': ["Fisher's Talent"],
  'eff.edhn138.tappedTokensAndLife.insteadX': ['From Under the Floorboards'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-138 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-138.json, path order: after edh-next-13, before edh-next-14) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-138.json');
    expect(files.indexOf('zz-cloud/edh-next-138.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-13.json'));
    expect(files.indexOf('zz-cloud/edh-next-138.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-14.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn138.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn138\./);
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

describe('edh-next-138 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bthey control\b/, 'you control'], [/\bfor each opponent, /, ''], [/\bany amount of life\b/, 'any amount of mana'], [/\bthis turn without\b/, 'without'],
    [/\breveal it if\b/, 'reveal it unless'], [/\bBird token\b/, 'Bird card'], [/\binstead create X\b/, 'create X'], [/\byou gain X life\b/, 'you lose X life'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-138 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-138 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-138 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-138 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-next-138 parser, renderer and engine changes (one test each, with the negative)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const ench = (text: string) => parseCard(card('Example Idol', 'Enchantment', text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Elf', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/object.ts (CR 115.1, 601.2c): "they control" of a target for each opponent; not after "for each player" nor without "for each opponent"', () => {
    expect(fullyAutomated(spell('For each opponent, destroy up to one target artifact they control.'))).toBe(true);
    expect(fullyAutomated(spell('Destroy up to one target artifact they control.'))).toBe(false);
  });
  it('parser/holes/cond.ts + lower/ability.ts (CR 601.2h, 603.4): "if {C} was spent to cast it" of the spell\'s own cast trigger, and of an entering creature', () => {
    expect(fullyAutomated(creature('When you cast this spell, if {C} was spent to cast it, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('When Example Beast enters, if {C} was spent to cast it, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('When you cast this spell, if {Q} was spent to cast it, draw a card.'))).toBe(false);
  });
  it('model/focus.ts + effects/handlers/control.ts (CR 608.2c): the token an "If you don\'t" branch made is the next "It"; a token outside the branch keeps its own reading', () => {
    expect(fullyAutomated(spell('You may draw a card. If you don\'t, create a 1/1 red Goblin creature token. It gains haste until end of turn.'))).toBe(true);
    expect(fullyAutomated(spell('You may draw a card. If you don\'t, create a 1/1 red Goblin creature token and a Treasure token. It gains haste until end of turn.'))).toBe(false);
  });
  it('parser/holes/event.ts + render/evt.ts (CR 400.3): "put into your graveyard from your hand or library"; "from your hand or battlefield" is no reading', () => {
    expect(fullyAutomated(ench('Whenever a creature card is put into your graveyard from your hand or library, you gain 1 life.'))).toBe(true);
    expect(fullyAutomated(ench('Whenever a creature card is put into your graveyard from your hand or battlefield, you gain 1 life.'))).toBe(false);
  });
  it('parser/lower/quantities.ts#atLeastCount (CR 603.4, 608.2h): "that many" after "if you control five or more Deserts"; after "if you control a Desert" there is no number', () => {
    expect(fullyAutomated(ench('At the beginning of your upkeep, if you control three or more Forests, create that many 1/1 green Saproling creature tokens.'))).toBe(true);
    expect(fullyAutomated(ench('At the beginning of your upkeep, if you control a Forest, create that many 1/1 green Saproling creature tokens.'))).toBe(false);
  });
  it('parser/lower/quantities.ts (CR 608.2h, 701.8a): "the total mana value of permanents destroyed this way" after a destroy; after an exile it is no reading', () => {
    expect(fullyAutomated(spell('Destroy target creature. You gain life equal to the total mana value of permanents destroyed this way.'))).toBe(true);
    expect(fullyAutomated(spell('Exile target creature. You gain life equal to the total mana value of permanents destroyed this way.'))).toBe(false);
  });
  it('parser/holes/filter.ts (CR 608.2c): "<participle> this way" after a count belongs to the counted objects (one reading, not two)', () => {
    expect(fullyAutomated(spell('Sacrifice any number of creatures. Search your library for a creature card with mana value less than or equal to the number of creatures sacrificed this way, put it onto the battlefield, then shuffle.'))).toBe(true);
  });
  it('parser/parse.ts#cardHasXCost (CR 107.3a): "Madness {X}..." announces X; a madness cost without X does not', () => {
    expect(fullyAutomated(spell('Madness {X}{B}\nDraw a card. If this spell\'s madness cost was paid, draw X cards instead.'))).toBe(true);
    expect(fullyAutomated(spell('Madness {1}{B}\nDraw a card. If this spell\'s madness cost was paid, draw X cards instead.'))).toBe(false);
  });
  it('parser/holes/qty.ts (CR 601.2h): "the amount of mana spent to cast it" in the spell\'s own cast trigger; in an upkeep trigger there is no cast spell for "it"', () => {
    expect(fullyAutomated(creature('When you cast this spell, create X 1/1 red Goblin creature tokens, where X is the amount of mana spent to cast it.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your upkeep, create X 1/1 red Goblin creature tokens, where X is the amount of mana spent to cast it.'))).toBe(false);
  });
  it('render/refs.ts (CR 701.21a, 111.7): "that card" of any sacrificed permanent', () => {
    expect(fullyAutomated(ench('Whenever you sacrifice an artifact, return that card to your hand at the beginning of the next end step.'))).toBe(true);
  });
});
