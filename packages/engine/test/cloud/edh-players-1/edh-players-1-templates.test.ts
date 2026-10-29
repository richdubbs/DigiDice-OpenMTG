/**
 * edh-players-1 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-1.json and the parser, lowering and renderer changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-1-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp1 from '../../../src/parser/templates/zz-cloud/edh-players-1.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP1 = edhp1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-players-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-1.json, path order: after cmd5, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-1.json');
    expect(files.indexOf('zz-cloud/edh-players-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json'));
    expect(files.indexOf('zz-cloud/edh-players-1.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp1.*', () => {
    for (const t of EP1) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP1) {
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

describe('edh-players-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP1) {
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

describe('edh-players-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP1) {
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

/**
 * The real cards that print each template's sentence and read it with the template (taken from the whole-index snapshot with `npm run cards`): FULL ones are fully
 * automated; the others have a sentence another slice owns (backlog/r4-owners.md) and are checked for this template's line only.
 */
const REAL: Readonly<Record<string, { full: readonly string[]; partial?: readonly string[] }>> = {
  'sta.edhp1.permit.extraLands.n': { full: ['Azusa, Lost but Seeking'] },
  'eff.edhp1.draw.mayUpTo': { full: ['Arcane Denial'] },
  'trg.edhp1.firstTime.eachOfTheirTurns': { full: ['Valgavoth, Harrower of Souls'] },
};

describe.skipIf(index === null)('edh-players-1 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a pattern with no hole is the rule's own words: its sentence alone is the one line an example can't avoid ("Combat damage can't be prevented."); a lone
    // keyword line ("Reach") is no card's text either
    const norm = (x: string): string => x.toLowerCase().replace(/\s+/g, ' ').replace(/ ([',.])/g, '$1').replace(/\.$/, '').trim();
    const own = (t: Template, l: string): boolean => /^[A-Z][a-z]+$/.test(l.trim()) || (!t.pattern.includes('{') && norm(l) === norm(t.pattern));
    const verbatim = EP1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
  it('every template of the file has its real cards listed (or is read by none yet, listed here with the reason)', () => {
    const none: Readonly<Record<string, string>> = {
    };
    for (const t of EP1) expect(REAL[t.id] !== undefined || none[t.id] !== undefined, t.id).toBe(true);
  });
});

// ---- the parser, lowering and renderer changes of the round (each with its negative cases) -----------------------------------------------------------------------------

const creatureText = (text: string, extra: Partial<OracleCard> = {}): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...extra });
const spellText = (text: string): OracleCard => card('Example Volley', 'Instant', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-1: "create or sacrifice a token" (parser/holes/event.ts, render/evt.ts; family create-or-sacrifice)', () => {
  it('reads "you create or sacrifice a token" as the token created or sacrificed, and says it back the same way', () => {
    expect(isFull(creatureText('Whenever you create or sacrifice a token, you gain 2 life.'))).toBe(true);
    expect(isFull(creatureText('Whenever an opponent creates or sacrifices a token, you gain 2 life.'))).toBe(true);
    expect(isFull(creatureText('Whenever you create a token or sacrifice a token, you gain 2 life.'))).toBe(true); // the longer wording of the same two events
  });
  it('the reverse order, a plural noun and a noun that is not a token are not read', () => {
    expect(isFull(creatureText('Whenever you sacrifice or create a token, you gain 2 life.'))).toBe(false);
    expect(isFull(creatureText('Whenever you create or sacrifice tokens, you gain 2 life.'))).toBe(false);
    expect(isFull(creatureText('Whenever you create or sacrifice a creature, you gain 2 life.'))).toBe(false);
    expect(isFull(creatureText('Whenever you create or sacrifice a token or draw a card, you gain 2 life.'))).toBe(false);
  });
});

describe('edh-players-1: "except the first one they draw in each of their draw steps" as a trigger event (triggers/normalize.ts, match.ts, forms.ts)', () => {
  it('is read for an opponent, for you and for a player, with the pronoun of the drawing player', () => {
    expect(isFull(creatureText('Whenever an opponent draws a card except the first one they draw in each of their draw steps, you gain 2 life.'))).toBe(true);
    expect(isFull(creatureText('Whenever you draw a card except the first one you draw in each of your draw steps, you gain 2 life.'))).toBe(true);
  });
  it('a mismatched pronoun, another ordinal, another step and "each turn" are not read', () => {
    expect(isFull(creatureText('Whenever an opponent draws a card except the first one you draw in each of your draw steps, you gain 2 life.'))).toBe(false);
    expect(isFull(creatureText('Whenever you draw a card except the first one they draw in each of their draw steps, you gain 2 life.'))).toBe(false);
    expect(isFull(creatureText('Whenever an opponent draws a card except the second one they draw in each of their draw steps, you gain 2 life.'))).toBe(false);
    expect(isFull(creatureText('Whenever an opponent draws a card except the first one they draw in each of their upkeeps, you gain 2 life.'))).toBe(false);
    expect(isFull(creatureText('Whenever an opponent draws a card except the first one they draw each turn, you gain 2 life.'))).toBe(false);
  });
});

describe('edh-players-1: "Y. If C, create a token that\'s a copy of this creature instead." (render/self-replacement.ts#notSelfReplacement)', () => {
  const head = 'Whenever a land you control enters, create a 1/1 green Insect creature token.';
  it('a token copy replaces the same number of tokens for the same player', () => {
    expect(isFull(creatureText(`${head} If you control five or more lands, create a token that's a copy of this creature instead.`))).toBe(true);
  });
  it('another number of tokens, a copy of a target, a tapped or attacking copy, a copy for another player or a copy with an exception is not read', () => {
    const two = 'Whenever a land you control enters, create two 1/1 green Insect creature tokens.';
    expect(isFull(creatureText(`${two} If you control five or more lands, create a token that's a copy of this creature instead.`))).toBe(false);
    expect(isFull(creatureText(`${head} If you control five or more lands, create a token that's a copy of target creature instead.`))).toBe(false);
    expect(isFull(creatureText(`${head} If you control five or more lands, create a tapped token that's a copy of this creature instead.`))).toBe(false);
    expect(isFull(creatureText(`${head} If you control five or more lands, each opponent creates a token that's a copy of this creature instead.`))).toBe(false);
    expect(isFull(creatureText(`${head} If you control five or more lands, create a token that's a copy of this creature, except it's an artifact, instead.`))).toBe(false);
  });
});

describe('edh-players-1: a delayed trigger reads "its controller" of a countered spell (parser/lower/normalize.ts#delayOnMoved, effects/handlers/lasting-fix.ts#prepareDeferred)', () => {
  it('is read for the controller and the owner of what this resolution countered', () => {
    expect(isFull(spellText("Counter target spell. Its controller draws a card at the beginning of the next turn's upkeep."))).toBe(true);
    expect(isFull(spellText("Counter target spell. Its owner draws a card at the beginning of the next turn's upkeep."))).toBe(true);
  });
  it('the moved object itself, or something it carries, still finds no object after the move (it stays manual)', () => {
    expect(isFull(spellText("Counter target spell. Return it to its owner's hand at the beginning of the next turn's upkeep."))).toBe(false);
    expect(isFull(spellText("Exile target creature. Exile it again at the beginning of the next turn's upkeep."))).toBe(false);
  });
});

describe('edh-players-1: "draw up to N cards" (effects/handlers/cards-draw.ts, render/steps-cards.ts)', () => {
  it('"may draw up to two cards" is read; a count of one, a computed count and a missing "may" are not', () => {
    expect(isFull(spellText('Target player may draw up to two cards.'))).toBe(true);
    expect(isFull(spellText('Target player may draw up to one card.'))).toBe(false);
    expect(isFull(spellText('Target player may draw up to X cards.'))).toBe(false);
    expect(isFull(spellText('Target player draws up to two cards.'))).toBe(false);
  });
});

describe('edh-players-1: "during their turn" for the Nth card or spell and "first time during each of their turns" (ported from the stopped p2-trigger-events-2)', () => {
  it('are read with their player, and are not read for another ordinal or another turn', () => {
    expect(isFull(card('Example Rune', 'Enchantment', 'Whenever a player draws their second card during their turn, you gain 2 life.'))).toBe(true);
    expect(isFull(card('Example Rune', 'Enchantment', 'Whenever a player casts their second spell during their turn, you gain 2 life.'))).toBe(true);
    expect(isFull(card('Example Rune', 'Enchantment', 'Whenever an opponent loses life for the first time during each of their turns, you gain 2 life.'))).toBe(true);
    expect(isFull(card('Example Rune', 'Enchantment', 'Whenever a player draws their second card during your turn, you gain 2 life.'))).toBe(false);
    expect(isFull(card('Example Rune', 'Enchantment', 'Whenever you draw their second card during their turn, you gain 2 life.'))).toBe(false);
    expect(isFull(card('Example Rune', 'Enchantment', 'Whenever an opponent loses life for the first time during each of your turns, you gain 2 life.'))).toBe(false);
  });
});

describe('edh-players-1: capabilities (model/cap-walk.ts, effects/handlers/cards-draw.ts#OP_FORMS, triggers/forms.ts)', () => {
  it('the engine advertises the draw up-to form and the draw-step trigger form', () => {
    expect(ENGINE_CAPABILITIES.has('op:draw.upTo')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:ev.draw.exceptFirstInDrawStep')).toBe(true);
  });
});
