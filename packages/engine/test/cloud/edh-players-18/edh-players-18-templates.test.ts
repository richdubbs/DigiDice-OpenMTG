/**
 * edh-players-18 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-18.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-18-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp18 from '../../../src/parser/templates/zz-cloud/edh-players-18.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP18 = edhp18 as Template[];
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

describe('edh-players-18 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-18.json, path order: after edh-players-16, before edh-players-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-18.json');
    expect(files.indexOf('zz-cloud/edh-players-18.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-16.json'));
    expect(files.indexOf('zz-cloud/edh-players-18.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp18.*', () => {
    for (const t of EP18) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid|rep)\.edhp18./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP18) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-18 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP18) {
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

describe('edh-players-18 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP18) {
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

describe('edh-players-18 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP18) {
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
  'rep.edhp18.opponent.drawTwoOrMore.youAndThat': { full: ['Alms Collector'] },
};

describe.skipIf(index === null)('edh-players-18 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-18 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP18.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP18) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});


// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const creature = (text: string): OracleCard => card('Example Brute', 'Creature — Zombie Warrior', text, { power: '3', toughness: '3' });
const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';
const json = (c: OracleCard): string => JSON.stringify(compileCard(c).faces[0]!.abilities);

describe('edh-players-18: "to one or more of your opponents" and "the number of opponents dealt damage this way" (parser/holes/event.ts, parser/holes/qty.ts, render/evt.ts, render/qty.ts; CR 603.2c, 102.3, 510.2)', () => {
  const T = 'Whenever one or more Zombies you control deal combat damage to one or more of your opponents, you may draw cards equal to the number of opponents dealt damage this way. If you do, discard that many cards.';
  it('is read and said back, in the two wordings of the recipients', () => {
    expect(isFull(creature(T))).toBe(true);
    expect(isFull(creature(T.replace('one or more of your opponents', 'your opponents')))).toBe(true);
    expect(isFull(creature(T.replace('combat damage', 'damage')))).toBe(true);
  });
  it('the trigger is ONE for the whole batch (wholeBatch) with the opponents as its recipients, and the count is of the recipients of the event', () => {
    const j = json(creature(T));
    expect(j).toContain('"wholeBatch":true');
    expect(j).toContain('"recipient":{"player":"opponent"}');
    expect(j).toContain('"q":"countPlayers","of":{"ref":"event","role":"recipient"}');
  });
  it('the second count is the same number, not what the draw drew (ruling 2021-09-24): no resultCount of the draw', () => {
    expect(json(creature(T))).not.toContain('resultCount');
  });
  it('other recipients or subjects are other texts: a single creature, no "this way", another trigger (fail closed)', () => {
    expect(isFull(creature(T.replace('one or more Zombies you control deal', 'a Zombie you control deals')))).toBe(false);
    expect(isFull(creature(T.replace('number of opponents dealt damage this way', 'number of opponents dealt damage')))).toBe(false);
    expect(isFull(creature(T.replace('Whenever one or more Zombies you control deal combat damage to one or more of your opponents', 'Whenever you attack')))).toBe(false);
    expect(isFull(creature(T.replace('If you do, discard that many cards', 'If you do, you gain that much life')))).toBe(false);
  });
  it('"that many" after a draw of a FIXED number stays ambiguous with the trigger (fail closed)', () => {
    expect(isFull(creature(T.replace('draw cards equal to the number of opponents dealt damage this way', 'draw a card')))).toBe(false);
  });
});

describe('edh-players-18: "If the player is your opponent and has four or more cards in hand" (parser/holes/cond.ts#playerIsOpponent, render/cond.ts, effects/eval.ts#playerIs, triggers/cond.ts; CR 102.3, 603.4)', () => {
  const T = "At the beginning of each player's end step, that player draws a card. If the player is your opponent and has four or more cards in hand, ~ deals 2 damage to that player.";
  const ench = (text: string): OracleCard => card('Example Idol', 'Enchantment', text);
  it('is read and said back, with "the player" or "that player", "your opponent" or "an opponent", alone or with the hand', () => {
    expect(isFull(ench(T))).toBe(true);
    expect(isFull(ench(T.replace('the player is', 'that player is')))).toBe(true);
    expect(isFull(ench(T.replace('your opponent', 'an opponent')))).toBe(true);
    expect(isFull(ench(T.replace(' and has four or more cards in hand', '')))).toBe(true);
    expect(isFull(ench(T.replace('four or more', 'two or fewer')))).toBe(true);
  });
  it('the condition names the player of the end step and the hand of the same player', () => {
    const j = json(ench(T));
    expect(j).toContain('"cond":"playerIs"');
    expect(j).toContain('"is":"opponent"');
    expect(j).toContain('"q":"zoneSize","zone":"hand"');
  });
  it('other conditions on the player are other texts: "you", "a teammate", an exact hand size (fail closed)', () => {
    expect(isFull(ench(T.replace('your opponent', 'you')))).toBe(false);
    expect(isFull(ench(T.replace('your opponent', 'a teammate')))).toBe(false);
    expect(isFull(ench(T.replace('the player is your opponent', 'the player is not your opponent')))).toBe(false);
    expect(isFull(ench(T.replace('has four or more cards in hand', 'has exactly four cards in hand')))).toBe(false);
  });
});

describe('edh-players-18: "until an opponent becomes the monarch" (parser/holes/event.ts, parser/holes/dur.ts, effects/handlers/zones-move.ts#untilMonarchBecomes, triggers/normalize.ts, triggers/match.ts; CR 610.3, 725.1, 725.3)', () => {
  const T = 'When this creature enters, exile target creature an opponent controls until an opponent becomes the monarch.';
  it('is read and said back as an exile that waits for the event', () => {
    expect(isFull(creature(T))).toBe(true);
    const j = json(creature(T));
    expect(j).toContain('"until":{"d":"until","event":{"ev":"monarch","player":"opponent"}}');
  });
  it('"a player" also reads; "you" (an exile that ends when YOU become the monarch) and a non-exile move are other texts: the engine does not run them (fail closed)', () => {
    expect(isFull(creature(T.replace('an opponent becomes', 'a player becomes')))).toBe(true);
    expect(isFull(creature(T.replace('an opponent becomes', 'you become')))).toBe(false);
    expect(isFull(creature(T.replace('exile target creature', 'return target creature')))).toBe(false);
    expect(isFull(creature(T.replace('an opponent becomes the monarch', 'an opponent becomes the initiative')))).toBe(false);
  });
  it('the event as a trigger: "Whenever an opponent becomes the monarch" and "whenever you become the monarch"', () => {
    expect(isFull(creature('Whenever an opponent becomes the monarch, draw a card.'))).toBe(true);
    expect(isFull(creature('Whenever you become the monarch, draw a card.'))).toBe(true);
    expect(isFull(creature('Whenever a player becomes the monarch, draw a card.'))).toBe(true);
    expect(isFull(creature('Whenever you becomes the monarch, draw a card.'))).toBe(false);
  });
  it('the engine advertises the event and the move form', () => {
    expect(ENGINE_CAPABILITIES.has('ev:monarch')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:move.until')).toBe(true);
  });
});

describe('edh-players-18: "If an opponent would draw two or more cards" (types: action.atLeast, triggers/match.ts, render/evt.ts; CR 121.2, 614.1a)', () => {
  const T = 'If an opponent would draw two or more cards, instead you and that player each draw a card.';
  it('is read and said back; the pattern asks for the cards drawn at once (the drawMany proposal)', () => {
    expect(isFull(creature(T))).toBe(true);
    expect(json(creature(T))).toContain('"atLeast":2');
  });
  it('other numbers, other players or another instead are other texts', () => {
    expect(isFull(creature(T.replace('two or more', 'three or more')))).toBe(false);
    expect(isFull(creature(T.replace('an opponent', 'you')))).toBe(false);
    expect(isFull(creature(T.replace('each draw a card', 'each draw two cards')))).toBe(false);
    expect(isFull(creature(T.replace('instead you and that player each draw a card', 'you draw a card instead')))).toBe(false);
  });
  it('the engine advertises the form', () => {
    expect(ENGINE_CAPABILITIES.has('feature:ev.action.draw.atLeast')).toBe(true);
  });
});

describe('edh-players-18: the mana-keep rider after an "If you do" branch (parser/lower/riders.ts, render/steps-cards.ts; CR 106.4, 500.5, 608.2c)', () => {
  const T = "Whenever ~ deals combat damage to a player or planeswalker, you may discard any number of cards. If you do, draw that many cards and add that much {R}. Until end of turn, you don't lose this mana as steps and phases end.";
  it('is read: the mana the branch adds is kept, and the draw and the mana are said joined by "and"', () => {
    expect(isFull(creature(T))).toBe(true);
    expect(json(creature(T))).toContain('"keep":"endOfTurn"');
  });
  it('a rider after another branch, another duration or other mana is another text', () => {
    expect(isFull(creature(T.replace('Until end of turn', 'Until your next turn')))).toBe(false);
    expect(isFull(creature(T.replace('If you do, draw', 'If you don\'t, draw')))).toBe(false);
    expect(isFull(creature(T.replace('you don\'t lose this mana as steps and phases end', 'you don\'t lose unspent mana as steps and phases end')))).toBe(false);
  });
});

describe('edh-players-18: the new schema and capability members', () => {
  it('the condition playerIs and the events are in the committed schema', () => {
    expect(JSON.stringify(compileCard(card('Example Idol', 'Enchantment', "At the beginning of each player's end step, that player draws a card. If the player is your opponent, ~ deals 2 damage to that player.")).faces[0]!.abilities)).toContain('playerIs');
  });
});
