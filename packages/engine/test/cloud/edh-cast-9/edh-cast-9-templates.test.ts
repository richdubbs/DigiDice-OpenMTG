/**
 * Commander lane edh-cast, round edh-cast-9: the template data of parser/templates/zz-cloud/edh-cast-9.json ("they lose 1 life for each spell they've cast this turn",
 * "Each spell you cast that's a <A>, <B>, or <C> costs {N} less to cast", "counter that spell if it has the same mana value as the revealed card", "you may cast it without
 * paying its mana cost if the two spells have the same mana value", "you may activate loyalty abilities of ~ / of planeswalkers you control on any player's turn any time you could
 * cast an instant", "Take N extra turns after this one", "for each spell you've cast this turn, create a <token>") and the parser, renderer and engine changes of the round (one test
 * each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in edh-cast-9-scenarios.test.ts. CR cites are from the Comprehensive Rules 2026-09-25
 * (media.wizards.com) where the record says so.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast9 from '../../../src/parser/templates/zz-cloud/edh-cast-9.json';
import review from '../../m5/golden/cards/edh-cast-9-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast9 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * card of the EDHREC top 5,000, with their template tests (G9, G2) and played scenarios. Listed in the round's record (DECIDED BY THE OWNER'S STANDING RULE 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhc9.loseLife.forEach.qty': ['Rug of Smothering'],
  'cm.edhc9.spells.each.less.subtypes': ['Ancient Cellarspawn'],
  'eff.edhc9.counter.ifSameManaValueAsRevealed': ['Counterbalance'],
  'eff.edhc9.cast.free.sameManaValue': ['Powerbalance'],
  'sta.edhc9.permit.loyaltyAsInstant': ['Teferi, Temporal Archmage'],
  'sta.edhc9.permit.loyaltyAsInstant.self': ['Teferi, Master of Time'],
  'eff.edhc9.extraTurns.you.n': ['Teferi, Master of Time'],
  'eff.edhc9.token.forEach.qty.lead': ['Murmuration'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a trigger or an activated ability is a creature's, a static ability an enchantment's named "Example Subject", the rest a sorcery. */
const parsedWith = (t: Template, text: string) =>
  (t.kind === 'static'
    ? parseCard(card('Example Subject', 'Enchantment', text), OPTS)
    : /^(whenever|when|at the beginning)\b/i.test(text) || text.includes(':')
      ? parseCard(card('Example Wisp', 'Creature — Spirit', text, { power: '2', toughness: '2' }), OPTS)
      : parseCard(card('Example Plan', 'Sorcery', text), OPTS)).faces[0]!;

describe('edh-cast-9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-9.json, path order: after edh-cast-7, before edh-combat-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-9.json');
    expect(files.indexOf('zz-cloud/edh-cast-9.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-cast-7.json'));
    expect(files.indexOf('zz-cloud/edh-cast-9.json')).toBeLessThan(files.indexOf('zz-cloud/edh-combat-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhc9.* (or sta., cm.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|cm)\.edhc9\./);
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

describe('edh-cast-9 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-cast-9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-cast-9 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-cast-9 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Spirit', name = 'Example Wisp') => parseCard(card(name, type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  const json = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);
  it('std-rj eff.stdrj.cast.free.ifSpellMvLess (G10 change by the owner\'s standing rule 2026-10-27): "cast ... if the spell\'s mana value is less than N" is the cast limited to a resulting spell of mana value N - 1 or less, not a check of the card before it is cast', () => {
    const f = face("Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the spell's mana value is less than the number of Swamps you control.", 'Sorcery', 'Example Plan');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"maxManaValue":{"q":"math","op":"-","args":[{"q":"count"');
    expect(json(f)).not.toContain('"cond":"compare"');
    // "less than or equal to", "greater than" and "unless" are other sentences
    for (const other of ["if the spell's mana value is greater than the number of Swamps you control", "unless the spell's mana value is less than the number of Swamps you control"]) {
      expect(fullyAutomated(face(`Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost ${other}.`, 'Sorcery', 'Example Plan'))).toBe(false);
    }
  });
  it('parser/holes/qty.ts (CR 601.2i, 608.2h): "for each spell they\'ve cast this turn" counts the casts of the player the trigger names; "this game", "you\'ve" and "other" are not that reading', () => {
    const f = face("Whenever a player casts a spell, they lose 1 life for each spell they've cast this turn.");
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"by":{"ref":"event","role":"player"}');
    expect(fullyAutomated(face("Whenever a player casts a spell, they lose 1 life for each spell they've cast this game."))).toBe(false);
    expect(json(face("Whenever a player casts a spell, you lose 1 life for each spell you've cast this turn."))).not.toContain('"by":{"ref"');
  });
  it('parser/lower/quantities.ts#differenceOf and render/qty.ts#isDifference (CR 202.3, 601.2h): "the difference" after "if the amount of mana spent to cast it was less than its mana value" is the mana value minus the mana spent; after "more than" or with another amount it is not that', () => {
    const f = face('Whenever you cast a spell, if the amount of mana spent to cast it was less than its mana value, target opponent loses life equal to the difference.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"op":"-","args":[{"q":"stat","stat":"manaValue"');
    expect(fullyAutomated(face('Whenever you cast a spell, if the amount of mana spent to cast it was less than 3, target opponent loses life equal to the difference.'))).toBe(false);
    expect(fullyAutomated(face('Whenever you cast a spell, if the amount of mana spent to cast it was more than its mana value, target opponent loses life equal to the difference.'))).toBe(false);
  });
  it('render/refs.ts (CR 601.2a, 400.1): "that spell" stays one reading when the other thing named is a card in a library; two spells or a card on the battlefield are still ambiguous', () => {
    const ok = face('Whenever an opponent casts a spell, reveal the top card of your library. Counter that spell if it has the same mana value as the revealed card.');
    expect(fullyAutomated(ok)).toBe(true);
    // the revealed card is the object of "it" and is not a spell: a sentence naming two spells for "that spell" stays manual
    expect(fullyAutomated(face('Whenever an opponent casts a spell, counter that spell if it has the same mana value as target spell.', 'Enchantment', 'Example Charm'))).toBe(false);
  });
  it('cast.exactManaValue (CR 202.3, 601.2; render/steps-zones.ts): only "if the two spells have the same mana value" is said for an exact mana value (the spell that caused the trigger); the cap forms are unchanged', () => {
    const f = face('Whenever an opponent casts a spell, you may reveal the top card of your library. If you do, you may cast that card without paying its mana cost if the two spells have the same mana value.', 'Enchantment', 'Example Charm');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"exactManaValue":{"q":"stat","stat":"manaValue","of":{"ref":"event","role":"spell"}}');
    const lesser = face("Whenever you cast a spell, reveal the top card of your library. You may cast it without paying its mana cost if the spell's mana value is less than 3.", 'Enchantment', 'Example Charm');
    expect(json(lesser)).not.toContain('exactManaValue');
  });
  it('render/stat.ts (CR 606.3): "loyalty abilities of ~" and "of <planeswalkers you control>" are the same permission as the earlier "activate ~\'s loyalty abilities"; other action words are not that reading', () => {
    expect(fullyAutomated(face("You may activate loyalty abilities of Example Subject on any player's turn any time you could cast an instant.", 'Enchantment', 'Example Subject'))).toBe(true);
    expect(fullyAutomated(face("You may activate loyalty abilities of planeswalkers you control on any player's turn any time you could cast an instant.", 'Enchantment', 'Example Subject'))).toBe(true);
    expect(fullyAutomated(face("You may activate loyalty abilities of Example Subject on any player's turn any time you could cast a sorcery.", 'Enchantment', 'Example Subject'))).toBe(false);
  });
});
