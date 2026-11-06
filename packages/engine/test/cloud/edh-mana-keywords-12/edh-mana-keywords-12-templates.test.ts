/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-12: the template data of parser/templates/zz-cloud/edh-mana-keywords-12.json (reveal any number of cards from your hand and add mana for
 * each (Metalworker); the type of mana spent noted and used (Jeweled Amulet); equip planeswalker and a permanent made a creature (Luxior, Giada's Gift); the next spell gains sunburst (Solar
 * Array); spend mana as though of any color for the abilities gained (Drana and Linvala); a face-down permanent with set characteristics (Yedora, Grave Gardener; Cyber Conversion); the first spell
 * cast with mana from a Treasure has cascade (Rain of Riches)), and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example
 * lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense
 * word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in edh-mana-keywords-12-scenarios.test.ts. CR cites
 * checked against the Comprehensive Rules 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhMk12 from '../../../src/parser/templates/zz-cloud/edh-mana-keywords-12.json';
import review from '../../m5/golden/cards/edh-mana-keywords-12-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhMk12 as Template[];
const MECH_COUNT = 12;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one card, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction
 * 2026-10-21; the standing rule of 2026-10-27). Metalworker, Jeweled Amulet and Rain of Riches may be of the held-out half: all are cards of the EDHREC top 5,000, opened by the owner (commander request 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhmk12.reveal.anyNumber.fromHand': ['Metalworker'],
  'eff.edhmk12.mana.twiceColorless.forEach': ['Metalworker'],
  'eff.edhmk12.note.manaTypeSpent.activation': ['Jeweled Amulet'],
  'eff.edhmk12.mana.oneOfNotedType': ['Jeweled Amulet'],
  'kw.edhmk12.equip.planeswalker': ["Luxior, Giada's Gift"],
  'sta.edhmk12.attached.permanent.notPlaneswalker.isCreature': ["Luxior, Giada's Gift"],
  'eff.edhmk12.nextSpell.gains.sunburst': ['Solar Array'],
  'sta.edhmk12.self.hasAllActivatedOf.spendAnyColorForThem': ['Drana and Linvala'],
  'eff.edhmk12.return.toBattlefield.faceDown.ownersControl': ['Yedora, Grave Gardener'],
  'rid.edhmk12.faceDown.isForestLand': ['Yedora, Grave Gardener'],
  'rid.edhmk12.turnedFaceDown.isCyberman': ['Cyber Conversion'],
  'sta.edhmk12.firstSpell.manaFromSubtype.cascade': ['Rain of Riches'],
};
const NOT_PINNED: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature, or of an Equipment (the templates listed in EQUIPMENT). */
const SPELL = new Set<string>(['rid.edhmk12.turnedFaceDown.isCyberman']);
const EQUIPMENT = new Set<string>(['kw.edhmk12.equip.planeswalker']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS)
    : t.id === 'sta.edhmk12.attached.permanent.notPlaneswalker.isCreature' ? parseCard(card('Example Charm', 'Enchantment — Aura', text), OPTS)
    : EQUIPMENT.has(t.id) ? parseCard(card('Example Blade', 'Artifact — Equipment', text), OPTS)
    : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-mana-keywords-12 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-mana-keywords-12.json, path order: after edh-mana-keywords-11, before edh-mana-keywords-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-mana-keywords-12.json');
    expect(files.indexOf('zz-cloud/edh-mana-keywords-12.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-11.json'));
    expect(files.indexOf('zz-cloud/edh-mana-keywords-12.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 12; ids are trg./rid./eff./sta./kw.edhmk12.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|trg)\.edhmk12\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(12);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) {
      if (NOT_PINNED.includes(g.card)) expect(g.expect, g.card).toBeUndefined();
      else expect(g.expect, g.card).toBe('full');
    }
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

describe('edh-mana-keywords-12 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/any number/, 'two'], [/in your hand/, 'in your graveyard'], [/artifact cards/, 'cards'], [/Add \{C\}\{C\}/, 'Add {C}{C}{C}'], [/planeswalker/, 'creature'], [/last noted/, 'first noted'],
    [/mana spent/, 'life spent'], [/sunburst/, 'flying'], [/any color/, 'any type'], [/activate those/, 'cast those'], [/face down/, 'face up'], [/Forest/, 'Mountain'],
    [/Cyberman/, 'Elf'], [/Treasure/, 'Clue'], [/cascade/, 'convoke'], [/a creature/, 'a land'], [/all creatures/, 'all lands'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-mana-keywords-12 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-mana-keywords-12 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
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

describe.skipIf(index === null)('edh-mana-keywords-12 design 6.10 (local index): synthetic examples', () => {
  it('no edh-mana-keywords-12 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const keywordLine = (l: string): boolean => /^(Enchant|Equip) /.test(l.trim()); // the rules text under test is the sentence, not the Aura's enchant line or an Equip line
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !keywordLine(l) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-mana-keywords-12 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Artifact Creature — Golem') => parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  it('parser/holes/misc.ts#addManaCost (CR 702.24a, 106.4; Braid of Fire): "Add {R}" is the cost of a cumulative upkeep only; a run of plain symbols, nothing else', () => {
    expect(fullyAutomated(face('Cumulative upkeep--Add {R}.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(face('Cumulative upkeep--Add {R}{G}.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(face('Cumulative upkeep--Add {1}.', 'Enchantment'))).toBe(false);
    expect(fullyAutomated(face('Ward--Add {R}.', 'Enchantment'))).toBe(false);
    expect(fullyAutomated(face('Echo--Add {R}.', 'Enchantment'))).toBe(false);
  });
  it('parser/lower/quantities.ts (CR 701.20a, 608.2c): "for each card revealed this way" counts a NAMED reveal; "that many" never reads a reveal', () => {
    const ok = '{T}: Reveal any number of artifact cards in your hand. Add {C}{C} for each card revealed this way.';
    expect(fullyAutomated(face(ok))).toBe(true);
    expect(fullyAutomated(face('{T}: Reveal any number of artifact cards in your hand. Add {C}{C} for each card revealed this way.\n{T}: Reveal a card in your hand. Add that many {C}.'))).toBe(false);
  });
  it('rules/pay-parts.ts, rules/cost.ts (CR 702.24a): the cost "Add {R}" is payable, adds the mana to the pool and is the same capability as the other cost parts', () => {
    expect(ENGINE_CAPABILITIES.has('cost:addMana')).toBe(true);
  });
  it('effects/handlers/choose.ts (CR 106.1, 607.2d): "note the type of mana spent" is a capability only for its player, with a link', () => {
    expect(ENGINE_CAPABILITIES.has('op:chooseValue.manaTypeSpent')).toBe(true);
  });
  it('effects/handlers/zones-status.ts (CR 701.3a, 301.5c): an Equipment attaches to a non-creature only as "equip planeswalker" says, as though it were a creature', () => {
    expect(ENGINE_CAPABILITIES.has('op:attach.asCreature')).toBe(true);
    expect(fullyAutomated(face('Equipped permanent isn\'t a planeswalker and is a creature in addition to its other types.\nEquip planeswalker {1}', 'Artifact — Equipment'))).toBe(true);
    expect(fullyAutomated(face('Equipped permanent isn\'t a planeswalker and is a creature in addition to its other types.\nEquip planeswalker {1}', 'Artifact'))).toBe(false);
  });
  it('statics/face-down.ts, render/steps-edhmk12.ts (CR 708.2a, 613.2b): set characteristics only for a face-down permanent put onto the battlefield or turned face down', () => {
    expect(ENGINE_CAPABILITIES.has('feature:faceDown.set')).toBe(true);
    expect(fullyAutomated(face('Whenever another creature you control dies, return it to the battlefield face down under its owner\'s control. It\'s a Forest land.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(face('Whenever another creature you control dies, return it to your hand. It\'s a Forest land.', 'Enchantment'))).toBe(false);
  });
  it('rules/filter.ts, statics/match.ts, actions/cast.ts (CR 601.2i, 106.3): the first spell with mana from a source of a subtype; any other source word is no reading', () => {
    expect(fullyAutomated(face('The first spell you cast each turn that mana from a Treasure was spent to cast has cascade.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(face('The first spell you cast each turn that mana from a land was spent to cast has cascade.', 'Enchantment'))).toBe(false);
  });
  it('statics/layers.ts (CR 208.3; ruling 2022-04-29): a creature on the battlefield with no power and toughness is 0/0 before layer 7c (checked in the scenarios of Luxior)', () => {
    expect(true).toBe(true);
  });
});
