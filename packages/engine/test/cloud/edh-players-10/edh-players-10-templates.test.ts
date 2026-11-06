/**
 * edh-players-10 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-10.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-10-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp10 from '../../../src/parser/templates/zz-cloud/edh-players-10.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP10 = edhp10 as Template[];
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

describe('edh-players-10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-10.json, path order: after edh-players-1, before edh-players-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-10.json');
    expect(files.indexOf('zz-cloud/edh-players-10.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-1.json'));
    expect(files.indexOf('zz-cloud/edh-players-10.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp10.*', () => {
    for (const t of EP10) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp10\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP10) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-10 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP10) {
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

describe('edh-players-10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP10) {
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

describe('edh-players-10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP10) {
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
  'eff.edhp10.choose.anyNumberTargetOpponents': { full: ['Call the Coppercoats'] },
  'eff.edhp10.forEachOpponent.exile': { full: ['The Balrog of Moria', 'Desecrate Reality'] },
  'eff.edhp10.forAnyNumberOfOpponents.destroy': { full: ["Windgrace's Judgment"] },
  'eff.edhp10.lose.allCreatureTypes.dur': { full: ['Amoeboid Changeling'] },
  'eff.edhp10.durFirst.cantBeBlockedBy': { full: ['Rikku, Resourceful Guardian'] },
  'eff.edhp10.eachPlayer.loseAllCounters': { full: ['Final Act'] },
};

describe.skipIf(index === null)('edh-players-10 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP10.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP10) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});


// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const creatureText = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...extra });
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-10: "those opponents" after "Choose any number of target opponents." (parser/holes/player.ts#W_THOSE_OPPONENTS, render/refs.ts; CR 115.1, 608.2c)', () => {
  const HEAD = 'Choose any number of target opponents. ';
  it('reads "creatures those opponents control" and says it back', () => {
    expect(isFull(spell(`${HEAD}Create a Clue token for each creature those opponents control.`))).toBe(true);
    expect(isFull(spell(`${HEAD}Those opponents each draw a card.`))).toBe(true);
  });
  it('without the choice, or with the choice of players, "those opponents" is not read (fail closed, design 6.4)', () => {
    expect(isFull(spell('Create a Clue token for each creature those opponents control.'))).toBe(false);
    expect(isFull(spell('Choose any number of target players. Create a Clue token for each creature those opponents control.'))).toBe(false);
    expect(isFull(spell(`${HEAD}Create a Clue token for each creature those spirits control.`))).toBe(false);
  });
});

describe('edh-players-10: "up to one target ... that player controls with an even mana value" after "for each opponent," (parser/holes/filter.ts, holes/object.ts#perPlayerTarget, render/refs.ts; CR 202.3)', () => {
  const T = 'For each opponent, exile up to one target permanent that player controls with an even mana value.';
  it('is read and said back, with and without the article', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(isFull(spell(T.replace('an even', 'odd')))).toBe(true);
    expect(isFull(spell('Exile target permanent with an odd mana value.'))).toBe(true);
    expect(isFull(spell('Exile target permanent with odd mana value.'))).toBe(true);
  });
  it('another parity word, a missing "mana", or a second restriction are other texts', () => {
    expect(isFull(spell(T.replace('even', 'prime')))).toBe(false);
    expect(isFull(spell(T.replace(' mana value', '')))).toBe(false);
    expect(isFull(spell(T.replace('up to one target', 'up to two target')))).toBe(false);
  });
});

describe('edh-players-10: "For any number of opponents, destroy target ... that player controls." (parser/holes/object.ts#anyOppTarget, render/steps.ts#perPlayerLead; CR 115.1, 601.2c)', () => {
  it('is read and said back', () => {
    expect(isFull(spell('For any number of opponents, destroy target creature that player controls.'))).toBe(true);
    expect(isFull(spell('For any number of opponents, destroy target nonland permanent that player controls.'))).toBe(true);
  });
  it('"up to one", "another", a number of targets and other verbs are other texts', () => {
    expect(isFull(spell('For any number of opponents, destroy up to one target creature that player controls.'))).toBe(false);
    expect(isFull(spell('For any number of opponents, destroy another target creature that player controls.'))).toBe(false);
    expect(isFull(spell('For any number of opponents, destroy two target creatures that player controls.'))).toBe(false);
    expect(isFull(spell('For any number of players, destroy target creature that player controls.'))).toBe(false);
  });
});

describe('edh-players-10: "at least three colorless mana was spent to cast ~" (parser/holes/cond.ts#adamant, render/cond.ts, types wasCast.spent.color \'C\'; CR 601.2h, 106.1b)', () => {
  const T = 'If at least three colorless mana was spent to cast ~, draw a card.';
  it('is read and said back like the colored adamant', () => {
    expect(isFull(spell(T, { mana_cost: '{3}' }))).toBe(true);
    expect(isFull(spell(T.replace('colorless', 'white'), { mana_cost: '{3}' }))).toBe(true);
  });
  it('"colorless" is no color of the Color hole, and fewer than one, a missing "at least" or other words are other texts', () => {
    expect(isFull(spell(T.replace('at least three', 'at most three'), { mana_cost: '{3}' }))).toBe(false);
    expect(isFull(spell(T.replace('colorless', 'multicolored'), { mana_cost: '{3}' }))).toBe(false);
    expect(isFull(spell(T.replace('mana was spent', 'mana was paid'), { mana_cost: '{3}' }))).toBe(false);
  });
});

describe('edh-players-10: "the life you\'ve lost this turn" / "the amount of life they lost this turn" (parser/holes/qty.ts, render/qty.ts; CR 119.3, 120.3a)', () => {
  it('reads the controller\'s and a named player\'s life lost', () => {
    expect(isFull(creatureText("Sacrifice ~: You gain life equal to the life you've lost this turn."))).toBe(true);
    expect(isFull(creatureText('Sacrifice ~: You gain life equal to the life you lost this turn.'))).toBe(true);
    expect(isFull(spell('Target opponent loses life equal to the amount of life they lost this turn.'))).toBe(true);
    expect(isFull(spell('Target opponent loses life equal to the amount of life that player lost this turn.'))).toBe(true);
  });
  it('life gained, another player and another period are other texts', () => {
    expect(isFull(creatureText("Sacrifice ~: You gain life equal to the life you've gained this turn."))).toBe(false);
    expect(isFull(creatureText('Sacrifice ~: You gain life equal to the life you lost last turn.'))).toBe(false);
    expect(isFull(spell('Target opponent loses life equal to the amount of life they lost this game.'))).toBe(false);
  });
});

describe('edh-players-10: "they" / "their" at "the beginning of your end step" is the target, never you (parser/lower/anaphora.ts, Mention.bareOnly; CR 503.1, 603.3a)', () => {
  it('reads their hand and their draw as the target opponent\'s', () => {
    expect(isFull(creatureText('At the beginning of your upkeep, target opponent loses life equal to the number of cards in their hand.'))).toBe(true);
    expect(isFull(creatureText('At the beginning of your end step, target opponent discards a card, then they draw a card.'))).toBe(true);
  });
  it('with two opponents named it is still ambiguous (the negative case), and the controller\'s own step is not "their"', () => {
    expect(isFull(creatureText('At the beginning of your end step, target opponent loses 1 life. Another target opponent loses life equal to the number of cards in their hand.'))).toBe(false);
  });
});

describe('edh-players-10: "you and that player each draw that many cards" / "... create X ..." (render/fold.ts#youAndPlayerEachDraw, #youAndPlayerEachCreate; CR 121.1, 111.2)', () => {
  it('is read and said back, for the amount of the event and for X', () => {
    expect(isFull(creatureText('Whenever ~ deals combat damage to a player, you and that player each draw that many cards.'))).toBe(true);
    expect(isFull(spell('Choose an opponent. You and that player each create X 1/1 green Elf Warrior creature tokens.', { mana_cost: '{X}{G}' }))).toBe(true);
  });
  it('two different amounts, or a group in place of that player, are other texts', () => {
    expect(isFull(creatureText('Whenever ~ deals combat damage to a player, you and each opponent each draw that many cards.'))).toBe(false);
    expect(isFull(creatureText('Whenever ~ deals combat damage to a player, you each draw that many cards and that player draws a card.'))).toBe(false);
  });
});

describe('edh-players-10: a second "Choose an opponent." names the player anew (parser/lower/anaphora.ts, Mention.rebinds; render/steps-flow.ts; CR 608.2c)', () => {
  const T = 'Choose an opponent. You and that player each create a 2/2 green Treefolk creature token. Choose an opponent. You and that player each create a 1/1 green Elf Warrior creature token.';
  it('is read and said back; each "that player" is the opponent chosen just before', () => {
    expect(isFull(spell(T))).toBe(true);
  });
  it('a "that player" before any choice, or after a choice of another kind, is not read', () => {
    expect(isFull(spell('You and that player each create a 2/2 green Treefolk creature token.'))).toBe(false);
    expect(isFull(spell(T.replace('Choose an opponent. You and that player each create a 2/2', 'Choose a color. You and that player each create a 2/2')))).toBe(false);
  });
});

describe('edh-players-10: "the engine advertises what the round needs"', () => {
  it('wasCast.spent accepts the colorless mana type and the per-opponent target remains advertised', () => {
    expect(ENGINE_CAPABILITIES.has('feature:target.perOpponent')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:wasCast.spent')).toBe(true);
  });
});
