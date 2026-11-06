/**
 * Commander lane edh-cast, round edh-cast-8: the template data of parser/templates/zz-cloud/edh-cast-8.json ("you may cast it without paying its mana cost if it's a spell with
 * lesser mana value", Rashmi, Eternities Crafter) and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers
 * with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is
 * present. The behavior is in edh-cast-8-scenarios.test.ts. CR cites from memory unless named in the record (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast8 from '../../../src/parser/templates/zz-cloud/edh-cast-8.json';
import review from '../../m5/golden/cards/edh-cast-8-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast8 as Template[];
const MECH_COUNT = 1;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhc8.cast.free.lesserMv': ['Rashmi, Eternities Crafter'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered). */
const SPELL = new Set<string>([]);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text), OPTS)
    : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-cast-8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-8.json, path order: after edh-cast-6, before edh-combat-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-8.json');
    expect(files.indexOf('zz-cloud/edh-cast-8.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-cast-6.json'));
    expect(files.indexOf('zz-cloud/edh-cast-8.json')).toBeLessThan(files.indexOf('zz-cloud/edh-combat-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhc8.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg)\.edhc8\./);
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

describe('edh-cast-8 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\blesser\b/, 'greater'], [/\bfirst\b/, 'second'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bit's a spell\b/, "it's a land"], [/\bspell\b/, 'ability'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-cast-8 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-cast-8 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Golem', name = 'Example Relic') => parseCard(card(name, type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  it("parser/lower/anaphora.ts, render/refs.ts (CR 115.1, 603.2; Unsettled Mariner): \"that spell or ability\" after \"you or a permanent you control becomes the target of\" is the targeting spell or ability, not the targeted object; another noun is still the permanent or no reading", () => {
    const head = 'Whenever you or a permanent you control becomes the target of a spell or ability an opponent controls, ';
    expect(fullyAutomated(face(`${head}counter that spell or ability unless its controller pays {1}.`))).toBe(true);
    expect(fullyAutomated(face(`${head}counter that spell or ability.`))).toBe(true);
    expect(fullyAutomated(face(`${head}counter that spell.`))).toBe(true);
    // the targeted permanent is still "it" / "that permanent" for effects that act on a permanent; "it" alone has two readings
    expect(JSON.stringify(face(`${head}counter that spell or ability.`).abilities)).toContain('"role":"spell"');
    expect(fullyAutomated(face(`${head}counter it.`))).toBe(false); // "it" is the targeted permanent or the spell: two readings
  });
  it('parser/holes/filter.ts, render/np.ts (CR 110.4b, 205.3; Archmage of Echoes): "a <subtype> or <subtype> permanent spell" is a spell with any of the subtypes and a permanent type; a Kindred instant or a card is not it', () => {
    expect(fullyAutomated(face('Whenever you cast a Faerie or Wizard permanent spell, copy it.'))).toBe(true);
    expect(fullyAutomated(face('Whenever you cast a Wizard permanent spell, draw a card.'))).toBe(true);
    expect(fullyAutomated(face('Whenever you cast a Wizard permanent card, draw a card.'))).toBe(false);
    expect(fullyAutomated(face('Whenever you cast a Wizard creature or land permanent spell, draw a card.'))).toBe(false);
    const permanent = JSON.stringify(face('Whenever you cast a Wizard permanent spell, draw a card.').abilities);
    expect(permanent).toContain('"Planeswalker"');
    expect(permanent).not.toContain('"Instant"');
  });
  it("parser/holes/filter.ts, render/np.ts (CR 205.3m; Heliod, the Radiant Dawn): \"that isn't a <subtype>\" is one subtype excluded, before the zone phrase of a card; \"that isn't\" with no article or with a type is not", () => {
    expect(fullyAutomated(face("Return target enchantment card that isn't a God from your graveyard to your hand.", 'Sorcery'))).toBe(true);
    expect(fullyAutomated(face("Return target creature card that isn't a Zombie from your graveyard to your hand.", 'Sorcery'))).toBe(true);
    expect(fullyAutomated(face("Destroy target creature you control that isn't a Zombie.", 'Sorcery'))).toBe(true);
    expect(fullyAutomated(face("Return target creature card that isn't Zombie from your graveyard to your hand.", 'Sorcery'))).toBe(false);
    const json = JSON.stringify(face("Return target enchantment card that isn't a God from your graveyard to your hand.", 'Sorcery').abilities);
    expect(json).toContain('"notSubtypes":["God"]');
  });
  it("parser/holes/qty.ts, render/qty.ts, render/stat.ts (CR 121.1, 608.2h; Heliod, the Warped Eclipse): \"for each card your opponents have drawn this turn\" counts the draws of the turn by your opponents; your own draws or other actions are other counts", () => {
    expect(fullyAutomated(face('Spells you cast cost {1} less to cast for each card your opponents have drawn this turn.'))).toBe(true);
    const mine = JSON.stringify(face("Spells you cast cost {1} less to cast for each card you've drawn this turn.").abilities);
    const theirs = JSON.stringify(face('Spells you cast cost {1} less to cast for each card your opponents have drawn this turn.').abilities);
    expect(theirs).toContain('"player":"opponent"');
    expect(mine).not.toBe(theirs);
    expect(fullyAutomated(face('Spells you cast cost {1} less to cast for each card your opponents have discarded this turn.'))).toBe(false);
  });
  it('parser/lower/ability.ts, render/program.ts (CR 700.2, 601.2b; Flame of Anor): "Choose one. If C as you cast this spell, you may choose two instead." over three modes is one or two modes; over two modes, or "three instead", is not', () => {
    const modes = '\n• Target player draws two cards.\n• Destroy target artifact.\n• ~ deals 5 damage to target creature.';
    expect(fullyAutomated(face(`Choose one. If you control a Wizard as you cast this spell, you may choose two instead.${modes}`, 'Instant'))).toBe(true);
    expect(fullyAutomated(face(`Choose one. If you control a Wizard, you may choose two instead.${modes}`, 'Instant'))).toBe(true);
    expect(fullyAutomated(face(`Choose one. If you control a Wizard as you cast this spell, you may choose three instead.${modes}`, 'Instant'))).toBe(false);
    expect(fullyAutomated(face('Choose one. If you control a Wizard as you cast this spell, you may choose two instead.\n• Target player draws two cards.\n• Destroy target artifact.', 'Instant'))).toBe(false);
    const json = JSON.stringify(face(`Choose one. If you control a Wizard as you cast this spell, you may choose two instead.${modes}`, 'Instant').abilities);
    expect(json).toContain('"override":{"when":{"cond":"exists"');
    expect(json).toContain('"min":1,"max":2');
  });
  it("parser/holes/cond.ts, render/cond.ts (CR 608.2c, 601.2; Descendants' Path, Rashmi): \"if you don't cast it\" names the optional cast right before it; with no cast before it (or a cast that is not optional) it stays manual", () => {
    const head = 'At the beginning of your upkeep, reveal the top card of your library. ';
    expect(fullyAutomated(face(`${head}You may cast it without paying its mana cost. If you don't cast it, put it on the bottom of your library.`, 'Enchantment'))).toBe(true);
    expect(fullyAutomated(face(`${head}You may cast it without paying its mana cost. If you don't cast it this way, put it into your hand.`, 'Enchantment'))).toBe(true);
    expect(fullyAutomated(face(`${head}If you don't cast it, put it into your hand.`, 'Enchantment'))).toBe(false);
    expect(fullyAutomated(face(`${head}Draw a card. If you don't cast it, put it into your hand.`, 'Enchantment'))).toBe(false);
    expect(fullyAutomated(face(`${head}You may cast it without paying its mana cost. If you cast it, put it into your hand.`, 'Enchantment'))).toBe(false);
  });
  it("render/cond.ts (CR 205.3m, 108.1; Descendants' Path): \"if it's a creature card that shares a creature type with a creature you control\" says the card noun and what it shares", () => {
    const head = 'At the beginning of your upkeep, reveal the top card of your library. ';
    expect(fullyAutomated(face(`${head}If it's a creature card that shares a creature type with a creature you control, you may cast it without paying its mana cost.`, 'Enchantment'))).toBe(true);
    const color = JSON.stringify(face(`${head}If it's a creature card that shares a color with a creature you control, you may cast it without paying its mana cost.`, 'Enchantment').abilities);
    expect(color).toContain('"quality":"color"'); // another quality is another condition (the reading is not specific to creature types)
    expect(color).not.toContain('"quality":"creatureType"');
  });
  it("model/cap-walk.ts, effects/eval.ts, rules/mana.ts, parser/holes/cond.ts, render/cond.ts (CR 106.3, 205.2a, 601.2h; Inga and Esika): \"N or more mana from <card type, plural> was spent to cast it\" counts the mana of sources of that card type; a number with no \"or more\" or a subtype list is not read", () => {
    const head = 'Whenever you cast a creature spell, if ';
    expect(fullyAutomated(face(`${head}three or more mana from creatures was spent to cast it, draw a card.`))).toBe(true);
    expect(fullyAutomated(face(`${head}two or more mana from artifacts was spent to cast it, draw a card.`))).toBe(true);
    expect(fullyAutomated(face(`${head}mana from a creature was spent to cast it, draw a card.`))).toBe(true);
    expect(fullyAutomated(face(`${head}three mana from creatures was spent to cast it, draw a card.`))).toBe(false);
    expect(fullyAutomated(face(`${head}three or more mana from Elves was spent to cast it, draw a card.`))).toBe(false);
    const json = JSON.stringify(face(`${head}three or more mana from creatures was spent to cast it, draw a card.`).abilities);
    expect(json).toContain('"from":{"types":["Creature"]}');
  });
  it("render/steps-zones.ts (CR 118.9, 202.3; Rashmi): the free cast under \"if it's a spell with lesser mana value\" is the mana value of the card against the spell that caused the trigger; \"greater\" is not that reading", () => {
    const head = 'Whenever you cast your first spell each turn, reveal the top card of your library. ';
    expect(fullyAutomated(face(`${head}You may cast it without paying its mana cost if it's a spell with lesser mana value. If you don't cast it, put it into your hand.`))).toBe(true);
    expect(fullyAutomated(face(`${head}You may cast it without paying its mana cost if it's a spell with greater mana value. If you don't cast it, put it into your hand.`))).toBe(false);
  });
});
