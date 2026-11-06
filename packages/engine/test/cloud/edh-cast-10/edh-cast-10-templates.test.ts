/**
 * Commander lane edh-cast, round edh-cast-10: the template data of parser/templates/zz-cloud/edh-cast-10.json ("reveal ... You may cast a spell with mana value X or less from among cards
 * revealed this way without paying its mana cost", "You may cast a spell from among those cards" after a look at a hand, "you may cast an instant or sorcery spell from among those exiled
 * cards" (one spell, over several turns), "you may cast a spell from among those cards" after a mill, "you may play one of those cards", "When you cast your next instant or sorcery
 * spell this turn, copy that spell", "If it's a permanent spell, the copy gains ...", "except it isn't legendary if the spell is legendary") and the parser, renderer and engine changes
 * of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not
 * parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-cast-10-scenarios.test.ts. CR cites are from the Comprehensive Rules 2026-09-25
 * (media.wizards.com) where the record says so.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast10 from '../../../src/parser/templates/zz-cloud/edh-cast-10.json';
import review from '../../m5/golden/cards/edh-cast-10-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast10 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * card of the EDHREC top 5,000, with their template tests (G9, G2) and played scenarios. Listed in the round's record (DECIDED BY THE OWNER'S STANDING RULE 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhc10.seen.cast.free.mvOrLess.revealedThisWay': ["Sunbird's Invocation"],
  'eff.edhc10.seenInHand.cast.free': ['Silent-Blade Oni'],
  'eff.edhc10.permit.cast.oneInstantSorcery.fromGroup.durFirst': ["Chandra, Hope's Beacon"],
  'eff.edhc10.permit.cast.oneSpell.fromMilled.durFirst': ['Locke, Treasure Hunter'],
  'eff.edhc10.permit.play.oneOfGroup.durFirst': ["Nashi, Moon Sage's Scion"],
  'eff.edhc10.cast.yourNext.copy.that': ['Twinferno'],
  'rid.edhc10.copy.gains.ifItsPermanent': ['Nalfeshnee'],
  'eff.edhc10.copy.spell.exceptNotLegendaryIfLegendary': ['Double Major'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a trigger or an activated ability is a creature's, a static ability an enchantment's named "Example Subject", the rest a sorcery. */
const parsedWith = (t: Template, text: string) =>
  (t.kind === 'static'
    ? parseCard(card('Example Subject', 'Enchantment', text), OPTS)
    : (/^(whenever|when|at the beginning)\b/i.test(text) && !/^when you cast your next\b/i.test(text)) || text.includes(':')
      ? parseCard(card('Example Wisp', 'Creature — Spirit', text, { power: '2', toughness: '2' }), OPTS)
      : parseCard(card('Example Plan', 'Sorcery', text), OPTS)).faces[0]!;

describe('edh-cast-10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-10.json, path order: after edh-cast-1, before edh-cast-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-10.json');
    expect(files.indexOf('zz-cloud/edh-cast-10.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    expect(files.indexOf('zz-cloud/edh-cast-10.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 10; ids are eff.edhc10.* (or sta., cm., rid.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|cm|rid)\.edhc10\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(10);
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

describe('edh-cast-10 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bless\b/, 'more'], [/\bonly\b/, 'also'], [/\bbefore\b/, 'after'], [/\bcast\b/, 'play'], [/\bplayers\b/, 'your opponents'], [/\bcopy\b/, 'exile'], [/\bcommander\b/, 'creature'],
    [/\bsame\b/, 'different'], [/\bextra\b/, 'additional'], [/\bmay\b/, 'must'], [/\bwithout paying\b/, 'by paying'], [/\bone\b/, 'two'], [/\blose\b/, 'gain'], [/\bloyalty\b/, 'activated'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w) || w === 'Example' || w === 'Subject') return; // the card's own name
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000);
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-cast-10 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-cast-10 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Spirit', name = 'Example Wisp') => parseCard(card(name, type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  const json = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);
  it('render/fold.ts#castFromGroupFree (CR 701.20a, 107.3, 608.2h): the cap may be the cast\'s own `maxManaValue` beside the same cap on the cards offered, said "from among cards revealed this way", and an X an earlier sentence named is X again; a land or a card of a greater mana value is never a choice', () => {
    const f = face("Whenever you cast a spell from your hand, reveal the top X cards of your library, where X is that spell's mana value. You may cast a spell with mana value X or less from among cards revealed this way without paying its mana cost. Put the rest on the bottom of your library in a random order.");
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"maxManaValue":{"q":"stat","stat":"manaValue","of":{"ref":"event","role":"spell"}}');
    expect(json(f)).toContain('"manaValue":{"op":"<="');
    expect(json(f)).toContain('"notTypes":["Land"]');
    // another cap word is another sentence
    expect(fullyAutomated(face("Whenever you cast a spell from your hand, reveal the top X cards of your library, where X is that spell's mana value. You may cast a spell with mana value X or greater from among cards revealed this way without paying its mana cost. Put the rest on the bottom of your library in a random order."))).toBe(false);
  });
  it('parser/lower/ability.ts#discourseOf, holes/object.ts#seenInHand, lower/mentions.ts (CR 701.20e, 402.3): "those cards" after a look at a hand is the cards of that hand and only after that look; after a look at the top cards of a library it is the library cards (the `Seen` hole), never two readings', () => {
    const hand = face("Whenever ~ deals combat damage to a player, look at that player's hand. You may cast a spell from among those cards without paying its mana cost.");
    expect(fullyAutomated(hand)).toBe(true);
    expect(json(hand)).toContain('"zone":"hand"');
    expect(json(hand)).toContain('"role":"recipient"');
    const lib = face('Whenever ~ deals combat damage to a player, look at the top three cards of your library. You may cast a spell from among those cards without paying its mana cost.');
    expect(json(lib)).not.toContain('"zone":"hand"');
    expect(fullyAutomated(face("Whenever ~ deals combat damage to a player, look at that player's hand. You may cast a spell from among those cards."))).toBe(false);
  });
  it('render/stat.ts#permit and core/turn.ts (CR 601.3, 611.2a): a one-card permission for a group (`single`) outlasts the turn and renders as "you may cast an instant or sorcery spell from among those exiled cards" / "a spell from among those cards" / "play one of those cards"', () => {
    const f = face('Exile the top five cards of your library. Until the end of your next turn, you may cast an instant or sorcery spell from among those exiled cards.', 'Sorcery', 'Example Plan');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"onlyTypes":["Instant","Sorcery"]');
    expect(json(f)).toContain('"single":true');
    // several spells, another type list, or no limit are other sentences
    for (const other of ['you may cast instant and sorcery spells from among those exiled cards', 'you may cast an instant spell from among those exiled cards', 'you may cast a creature spell from among those exiled cards']) {
      expect(json(face(`Exile the top five cards of your library. Until the end of your next turn, ${other}.`, 'Sorcery', 'Example Plan'))).not.toContain('"onlyTypes":["Instant","Sorcery"]');
    }
  });
  it('render/steps-cards.ts#mill (CR 701.17a, 608.2c): the one card EACH player mills is a group ("those cards"); one player\'s one card stays "that card" and several cards one player mills have no group', () => {
    expect(fullyAutomated(face('Mill three cards. Until end of turn, you may cast a spell from among those cards.', 'Sorcery', 'Example Plan'))).toBe(false); // (several cards one player milled: a group no round needed; fails closed)
    expect(fullyAutomated(face('Each player mills a card. Until end of turn, you may cast a spell from among those cards.', 'Sorcery', 'Example Plan'))).toBe(true);
    expect(fullyAutomated(face('Mill a card. Until end of turn, you may cast a spell from among those cards.', 'Sorcery', 'Example Plan'))).toBe(false);
  });
  it('parser/holes/event.ts and render/evt.ts (CR 305.1, 601.2a, 603.2): "you play a card from exile" is a land played from exile or a spell cast from exile; "from your hand" or an opponent playing is not that reading', () => {
    const f = face('Whenever you play a card from exile, create a Treasure token.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"verb":"playLand"');
    expect(json(f)).toContain('"from":"exile"');
    expect(fullyAutomated(face('Whenever you play a card from your hand, create a Treasure token.'))).toBe(false);
    expect(json(face('Whenever an opponent plays a card from exile, create a Treasure token.'))).not.toContain('"verb":"playLand"');
  });
  it('render/steps-lasting.ts#event (CR 603.7b): "when you cast your next <spell> this turn" is the delayed trigger of "when you next cast a <spell> this turn"; a creature spell is its own filter', () => {
    const f = face('When you cast your next instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.', 'Sorcery', 'Example Plan');
    expect(fullyAutomated(f)).toBe(true);
    const old = face('When you next cast an instant or sorcery spell this turn, copy it. You may choose new targets for the copy.', 'Sorcery', 'Example Plan');
    expect(JSON.stringify(old.abilities.map((x) => (x as { effect?: unknown }).effect))).toBe(JSON.stringify(f.abilities.map((x) => (x as { effect?: unknown }).effect)));
    expect(fullyAutomated(face('When you cast your next instant or sorcery spell, copy that spell.', 'Sorcery', 'Example Plan'))).toBe(false);
  });
  it('render/steps-zones.ts#copyGains (CR 707.10, 608.2c): "If it\'s a permanent spell, the copy gains ..." is the rider of "If the copy is a permanent spell, it gains ..."', () => {
    const a = face("Whenever you cast a spell from exile, copy it. If it's a permanent spell, the copy gains haste.");
    const b = face('Whenever you cast a spell from exile, copy it. If the copy is a permanent spell, it gains haste.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities.map((x) => (x as { effect?: unknown }).effect))).toBe(JSON.stringify(b.abilities.map((x) => (x as { effect?: unknown }).effect)));
    expect(fullyAutomated(face("Whenever you cast a spell from exile, copy it. If it's an instant spell, the copy gains haste."))).toBe(false);
  });
  it('render/copy-except.ts (CR 707.9b, 205.4a): "except it isn\'t legendary if the spell is legendary" is "except the copy isn\'t legendary" said of a spell; other conditions are not that wording', () => {
    const a = face("Copy target creature spell you control, except it isn't legendary if the spell is legendary.", 'Instant', 'Example Plan');
    const b = face("When you next cast a creature spell this turn, copy it, except the copy isn't legendary.", 'Sorcery', 'Example Plan');
    expect(fullyAutomated(a)).toBe(true);
    expect(json(a)).toContain('"supertypes":{"remove":["Legendary"]}');
    expect(fullyAutomated(b)).toBe(true);
    expect(fullyAutomated(face("Copy target creature spell you control, except it isn't legendary if the spell is blue.", 'Instant', 'Example Plan'))).toBe(false);
  });
});
