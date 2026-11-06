/**
 * edh-players-9 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-9.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-9-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp9 from '../../../src/parser/templates/zz-cloud/edh-players-9.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP9 = edhp9 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  // a ~ that "is still a land" is a land (the rider's type word is the object's own)
  if (/\bstill a land\b/.test(text) && text.includes('~')) return card('Example Nexus', 'Land', text);
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-players-9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-9.json, path order: after edh-players-7, before edh-replace-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-9.json');
    expect(files.indexOf('zz-cloud/edh-players-9.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-7.json'));
    expect(files.indexOf('zz-cloud/edh-players-9.json')).toBeLessThan(files.indexOf('zz-cloud/edh-replace-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp9.*', () => {
    for (const t of EP9) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp9\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP9) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-9 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP9) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} at random.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\binstead\b/, 'also'], [/\btwice\b/, 'three times'], [/\bdouble\b/, 'triple'], [/\bplus\b/, 'minus'], [/\byou control\b/, 'an opponent controls'],
    [/\bexile it\b/, 'destroy it'], [/\byour graveyard\b/, 'your hand'], [/\bwould\b/, 'could'], [/\bone or more\b/, 'exactly one'], [/\bcreature spell\b/, 'artifact spell'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-players-9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP9) {
    it(`${t.id}: an appended "unless/at random/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('edh-players-9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP9) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || w === "~'s" || /^"?\{/.test(w) || w.includes('\n')) return;
          // a counter's kind is an open class (design 6.11: the word before "counter(s)" is any word, weak when it is not in the lexicon): not a G2 word here
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

/** The real cards that print each template's sentence and read it with the template (taken from the whole-index snapshot with `npm run cards`). */
const REAL: Readonly<Record<string, { full: readonly string[]; partial?: readonly string[] }>> = {
  'eff.edhp9.youCreate.token.ifCond': { full: ['Battle Angels of Tyr'] },
  'eff.edhp9.drawLose.commanderManaValue': { full: ['Stinging Study'] },
  'eff.edhp9.sacrifice.theirChoice.dealtDamageToYou': { full: ['Witch-king of Angmar'] },
};

describe.skipIf(index === null)('edh-players-9 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Vehicle|Saga)\b/gi, '~').trim());
        }
      }
    }
    // a pattern with no hole is the rule's own words: its sentence alone is the one line an example can't avoid ("Players can't lose life this turn and ..."); a lone keyword line is no card's text either
    const norm = (x: string): string => x.toLowerCase().replace(/\s+/g, ' ').replace(/ ([',.])/g, '$1').replace(/\.$/, '').trim();
    const own = (t: Template, l: string): boolean => /^[A-Z][a-z]+$/.test(l.trim()) || (!t.pattern.includes('{') && norm(l) === norm(t.pattern));
    const verbatim = EP9.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  for (const [id, { full, partial }] of Object.entries(REAL)) {
    it(`${id}: ${[...full, ...(partial ?? [])].join(', ')} read the line with it and pass the render gate${full.length > 0 ? ' (and the first are fully automated)' : ''}`, () => {
      for (const name of [...full, ...(partial ?? [])]) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        if (full.includes(name)) {
          expect(compileCard(oracle!).automation.level, name).toBe('full');
          expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
        }
      }
    }, 60_000);
  }
  it('every template of the file has its real cards listed', () => {
    for (const t of EP9) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});

// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const creatureText = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const enchantText = (text: string): OracleCard => card('Example Hymn', 'Enchantment', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-9: a count of players by their history of the turn (Quantity happenedPlayers; parser/holes/edhp9.ts, rules/history.ts#happenedPlayersOf, render/qty.ts; CR 121.1, 120.2a, 102.3)', () => {
  it('the engine advertises the quantity and the history', () => {
    expect(ENGINE_CAPABILITIES.has('q:happenedPlayers')).toBe(true);
  });
  it('"for each opponent who drew two or more cards this turn" is read and said back; one card, or a different count, is not this reading', () => {
    expect(isFull(enchantText('At the beginning of each end step, draw a card for each opponent who drew two or more cards this turn.'))).toBe(true);
    expect(isFull(enchantText('At the beginning of each end step, draw a card for each opponent who drew three or more cards this turn.'))).toBe(true);
    expect(isFull(enchantText('At the beginning of each end step, draw a card for each opponent who drew a card this turn.'))).toBe(false);
    expect(isFull(enchantText('At the beginning of each end step, draw a card for each opponent who drew two or fewer cards this turn.'))).toBe(false);
    expect(isFull(enchantText('At the beginning of each end step, draw a card for each opponent who drew two or more cards last turn.'))).toBe(false);
  });
  it('"for each opponent who had two or more lands enter the battlefield under their control this turn": lands of that player only', () => {
    expect(isFull(enchantText('At the beginning of each end step, create a Treasure token for each opponent who had two or more lands enter the battlefield under their control this turn.'))).toBe(true);
    expect(isFull(enchantText('At the beginning of each end step, create a Treasure token for each opponent who had two or more creatures enter the battlefield under their control this turn.'))).toBe(false);
    expect(isFull(enchantText('At the beginning of each end step, create a Treasure token for each opponent who had two or more lands enter the battlefield under your control this turn.'))).toBe(false);
  });
  it('"the number of opponents that were dealt combat damage this turn" (and "dealt damage"): opponents and players; creatures and planeswalkers are not players', () => {
    expect(isFull(creatureText('At the beginning of each of your postcombat main phases, you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.'))).toBe(true);
    expect(isFull(creatureText('At the beginning of each of your postcombat main phases, you may pay X life, where X is the number of players that were dealt combat damage this turn. If you do, draw X cards.'))).toBe(true);
    expect(isFull(creatureText('At the beginning of each of your postcombat main phases, you may pay X life, where X is the number of opponents that were dealt damage this turn. If you do, draw X cards.'))).toBe(true);
    expect(isFull(creatureText('At the beginning of each of your postcombat main phases, you may pay X life, where X is the number of creatures that were dealt combat damage this turn. If you do, draw X cards.'))).toBe(false);
    expect(isFull(creatureText('At the beginning of each of your postcombat main phases, you may pay X life, where X is the number of opponents that were dealt combat damage last turn. If you do, draw X cards.'))).toBe(false);
  });
  it('a static cost reduction or bonus reads no history of players (statics never read it)', () => {
    expect(isFull(card('Example Hymn', 'Enchantment', 'Creatures you control get +1/+1 for each opponent who drew two or more cards this turn.'))).toBe(false);
  });
});

describe('edh-players-9: "that player has more life / cards in hand / controls more lands than each other player" (Cond; parser/holes/cond.ts#playerMoreThanEachOther, render/cond.ts; CR 102.1, 119.1, 402.1)', () => {
  const trig = (effect: string): OracleCard => creatureText(`Whenever ~ deals combat damage to a player, ${effect}`);
  it('life, hand and lands are read and said back for the player the trigger names', () => {
    expect(isFull(trig('you gain 3 life if that player has more life than each other player.'))).toBe(true);
    expect(isFull(trig('draw a card if that player has more cards in hand than each other player.'))).toBe(true);
    expect(isFull(trig('you gain 3 life if that player controls more lands than each other player.'))).toBe(true);
  });
  it('"than you", "or tied" and a different statistic are other conditions', () => {
    expect(isFull(trig('you gain 3 life if that player has more life than you.'))).toBe(true); // the older reading, unchanged
    expect(isFull(trig('you gain 3 life if that player has at least as much life as each other player.'))).toBe(false);
    expect(isFull(trig('you gain 3 life if that player has more poison counters than each other player.'))).toBe(false);
    expect(isFull(trig('you gain 3 life if that player controls more lands than each other opponent.'))).toBe(false);
  });
  it('"then you create a Treasure token if" is the template eff.edhp9.youCreate.token.ifCond', () => {
    expect(isFull(trig('draw a card. Then you create a Treasure token if that player controls more lands than each other player.'))).toBe(true);
    expect(isFull(trig('draw a card. Then you create two Treasure tokens if that player controls more lands than each other player.'))).toBe(false);
  });
});

describe('edh-players-9: "the mana value of a commander you own" is a choice among the commanders (chooseObjects; CR 903.3, ruling 2021-04-16)', () => {
  it('the "greatest" reading of the older cards is unchanged and this one is a choice', () => {
    expect(isFull(card('Example Hymn', 'Instant', 'You draw X cards and you lose X life, where X is the greatest mana value of a commander you own on the battlefield or in the command zone.'))).toBe(true);
    expect(isFull(card('Example Hymn', 'Instant', 'You draw X cards and you lose X life, where X is the mana value of a commander you own on the battlefield or in the command zone.'))).toBe(true);
  });
  it('another zone, or somebody else\'s commander, is no reading of it', () => {
    expect(isFull(card('Example Hymn', 'Instant', 'You draw X cards and you lose X life, where X is the mana value of a commander you own in your graveyard.'))).toBe(false);
    expect(isFull(card('Example Hymn', 'Instant', 'You draw X cards and you lose X life, where X is the mana value of a commander an opponent owns on the battlefield or in the command zone.'))).toBe(false);
  });
});

describe('edh-players-9: "a creature that dealt (combat) damage to you this turn" (ObjectFilter.dealtDamageToYouThisTurn; rules/history.ts#dealtDamageToPlayerThisTurn, render/np.ts; CR 120.1, 510.2)', () => {
  it('the engine advertises the filter field', () => {
    expect(ENGINE_CAPABILITIES.has('filter:dealtDamageToYouThisTurn')).toBe(true);
  });
  it('is read in a target phrase and a group and said back, with and without "combat"', () => {
    expect(isFull(card('Example Volley', 'Instant', 'Exile target creature that dealt damage to you this turn.'))).toBe(true);
    expect(isFull(card('Example Volley', 'Sorcery', 'Destroy all creatures that dealt combat damage to you this turn.'))).toBe(true);
  });
  it('another player, an opponent\'s damage to a creature, and "last turn" are other wordings', () => {
    expect(isFull(card('Example Volley', 'Instant', 'Exile target creature that dealt damage to target player this turn.'))).toBe(false);
    expect(isFull(card('Example Volley', 'Instant', 'Exile target creature that dealt damage to you last turn.'))).toBe(false);
    expect(isFull(card('Example Volley', 'Instant', 'Exile target creature that was dealt damage to you this turn.'))).toBe(false);
  });
  it('"of their choice" before the clause is the sacrifice of the template (never an unknown "their")', () => {
    expect(isFull(creatureText('Whenever one or more creatures deal combat damage to you, each opponent sacrifices a creature of their choice that dealt combat damage to you this turn.'))).toBe(true);
    expect(isFull(creatureText('Whenever one or more creatures deal combat damage to you, you sacrifice a creature of their choice that dealt combat damage to you this turn.'))).toBe(false);
  });
});
