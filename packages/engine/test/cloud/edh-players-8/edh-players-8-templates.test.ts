/**
 * edh-players-8 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-8.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-8-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp8 from '../../../src/parser/templates/zz-cloud/edh-players-8.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP8 = edhp8 as Template[];
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

describe('edh-players-8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-8.json, path order: after edh-players-6, before edh-replace-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-8.json');
    expect(files.indexOf('zz-cloud/edh-players-8.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-6.json'));
    expect(files.indexOf('zz-cloud/edh-players-8.json')).toBeLessThan(files.indexOf('zz-cloud/edh-replace-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp8.*', () => {
    for (const t of EP8) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp8\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP8) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-8 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP8) {
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

describe('edh-players-8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP8) {
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

describe('edh-players-8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP8) {
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
  'eff.edhp8.player.chooses.upTo.sacrificesRest': { full: ['Archfiend of Depravity'] },
  'eff.edhp8.returnOwnersNextEndStep': { full: ['The Eternal Wanderer'] },
  'eff.edhp8.choose.playerWithMostLife': { full: ['The Black Gate'] },
};

describe.skipIf(index === null)('edh-players-8 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP8.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP8) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});


// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const creatureText = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const enchantText = (text: string): OracleCard => card('Example Hymn', 'Enchantment', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-8: "that color" / "of that color" after "Choose a color." (parser/holes/misc.ts#qualityAt, holes/filter.ts, lower/links.ts; CR 607.2d, 608.2c, 702.11d)', () => {
  const HEAD = 'Choose a color. ';
  it('hexproof, protection and the blocking restriction read the color the same ability chose', () => {
    expect(isFull(spell(`${HEAD}Target creature gains hexproof from that color until end of turn.`))).toBe(true);
    expect(isFull(spell(`${HEAD}Target creature gains protection from that color until end of turn.`))).toBe(true);
    expect(isFull(spell(`${HEAD}Target creature can't be blocked by creatures of that color this turn.`))).toBe(true);
  });
  it('with no color chosen before it, or two choices, "that color" is not read (fail closed, design 6.4)', () => {
    expect(isFull(spell('Target creature gains hexproof from that color until end of turn.'))).toBe(false);
    expect(isFull(spell("Target creature can't be blocked by creatures of that color this turn."))).toBe(false);
    expect(isFull(spell(`${HEAD}Choose a color. Target creature gains hexproof from that color until end of turn.`))).toBe(false);
  });
  it('a color word in place of "that color" is the same keyword as before; "that kind" is nothing', () => {
    expect(isFull(spell(`${HEAD}Target creature gains hexproof from blue until end of turn.`))).toBe(true);
    expect(isFull(spell(`${HEAD}Target creature gains hexproof from that kind until end of turn.`))).toBe(false);
  });
});

describe('edh-players-8: "a graveyard has twenty or more cards in it" (parser/holes/cond.ts#aGraveyardHas, render/cond.ts; CR 404.1, 102.3)', () => {
  it('is read and said back in a condition of an instruction', () => {
    expect(isFull(spell('Draw a card. If a graveyard has twenty or more cards in it, draw three cards instead.'))).toBe(true);
    expect(isFull(spell('If a graveyard has seven or more cards in it, draw a card.'))).toBe(true);
  });
  it('"or fewer", an exact number and a graveyard that is not any graveyard are other conditions', () => {
    expect(isFull(spell('Draw a card. If a graveyard has twenty or fewer cards in it, draw three cards instead.'))).toBe(false);
    expect(isFull(spell('Draw a card. If a graveyard has twenty cards in it, draw three cards instead.'))).toBe(false);
    expect(isFull(spell('Draw a card. If your graveyard has twenty or more cards in it, draw three cards instead.'))).toBe(false);
  });
});

describe('edh-players-8: "an opponent attacks you with N or more creatures, draws their second card each turn, or casts their second spell each turn" (parser/holes/event.ts#opponentAttacksYouList, triggers/occurrences.ts#mixedAttackOccurrences, render/evt.ts)', () => {
  const T = 'Whenever an opponent attacks you with two or more creatures, draws their second card each turn, or casts their second spell each turn, you draw a card.';
  it('is read and said back', () => {
    expect(isFull(enchantText(T))).toBe(true);
    expect(isFull(enchantText('Whenever an opponent attacks you with two or more creatures or draws their second card each turn, you draw a card.'))).toBe(true);
  });
  it('a list with an "and", another subject or a batch ("one or more") member is not this reading', () => {
    expect(isFull(enchantText(T.replace(', or casts', ', and casts')))).toBe(false);
    expect(isFull(enchantText(T.replace('an opponent attacks', 'a player attacks')))).toBe(false);
    expect(isFull(enchantText('Whenever an opponent attacks you with two or more creatures, discards one or more cards, or casts their second spell each turn, you draw a card.'))).toBe(false);
  });
  it('the engine splits the list by kind: capabilities and the card carry no unregistered feature', () => {
    expect(compileCard(enchantText(T)).automation.level).toBe('full');
  });
});

describe('edh-players-8: "..., and until your next turn, ..." joins two instructions (render/steps.ts#joined with Clause.commaAnd; CR 608.2c)', () => {
  const T = "All permanents you control phase out, and until your next turn, your life total can't change and you gain protection from everything.";
  it('is read and said back, with the sentence break too', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(isFull(spell(T.replace(', and until', '. Until')))).toBe(true);
  });
  it('another duration, a dropped part or "or" in place of "and" are other texts', () => {
    expect(isFull(spell(T.replace('your next turn', 'end of turn')))).toBe(false);
    expect(isFull(spell(T.replace(' and you gain protection from everything', '')))).toBe(false);
    expect(isFull(spell(T.replace(', and until', ', or until')))).toBe(false);
  });
});

describe('edh-players-8: the engine advertises what the round needs', () => {
  it('chooseValue.mostLife is a registered capability', () => {
    expect(ENGINE_CAPABILITIES.has('op:chooseValue.mostLife')).toBe(true);
  });
  it('a most-life choice of anything but a player is not advertised (fail closed)', () => {
    expect(ENGINE_CAPABILITIES.has('op:chooseValue.mostLife.other')).toBe(false);
  });
});
