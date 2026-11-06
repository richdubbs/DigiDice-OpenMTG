/**
 * edh-players-16 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-16.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-16-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp16 from '../../../src/parser/templates/zz-cloud/edh-players-16.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP16 = edhp16 as Template[];
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

describe('edh-players-16 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-16.json, path order: after edh-players-13, before edh-players-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-16.json');
    expect(files.indexOf('zz-cloud/edh-players-16.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-13.json'));
    expect(files.indexOf('zz-cloud/edh-players-16.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp16.*', () => {
    for (const t of EP16) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid)\.edhp16./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP16) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-16 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP16) {
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

describe('edh-players-16 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP16) {
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

describe('edh-players-16 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP16) {
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
  'eff.edhp16.mayPay.anyAmountOfLife': { full: ['Necrodominance'] },
};

describe.skipIf(index === null)('edh-players-16 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-16 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP16.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP16) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});


// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-16: "the number of creatures they controlled that were destroyed this way" (parser/holes/moved-words.ts#RELATIVE_FRONTS, render/moved.ts; CR 608.2c, 608.2h, 400.7)', () => {
  const T = 'Destroy all creatures. Each player loses life equal to the number of creatures they controlled that were destroyed this way.';
  it('is read and said back, for any card description of the destroy', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(isFull(spell(T.replace('all creatures', 'all artifacts').replace('number of creatures', 'number of artifacts')))).toBe(true);
  });
  it('the count is the iterated player\'s own (a resultCount filtered by the controller as it last existed), not every destroyed object', () => {
    const json = JSON.stringify(compileCard(spell(T)).faces[0]!.abilities);
    expect(json).toContain('"q":"resultCount"');
    expect(json).toContain('"controller":{"ref":"iterating"}');
  });
  it('"you controlled" is the other reading, and a group that is no loop or another verb are not read (fail closed)', () => {
    expect(JSON.stringify(compileCard(spell(T.replace('they controlled', 'you controlled'))).faces[0]!.abilities)).toContain('"controller":"you"');
    expect(isFull(spell(T.replace('Each player loses life', 'Target player loses life')))).toBe(false);
    expect(isFull(spell(T.replace('destroyed this way', 'exiled this way')))).toBe(false);
    expect(isFull(spell(T.replace('they controlled', 'they owned')))).toBe(false);
  });
});

describe('edh-players-16: "the damage dealt to <player> this turn" (parser/holes/qty.ts, render/qty.ts; CR 120.1, 120.3)', () => {
  const T = 'Draw cards equal to the damage dealt to target opponent this turn.';
  it('is read and said back for a target, for you and for your opponents; "the total amount of" stays the other wording', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(isFull(spell(T.replace('target opponent', 'you')))).toBe(true);
    expect(isFull(spell(T.replace('target opponent', 'your opponents')))).toBe(true);
    expect(isFull(spell(T.replace('target opponent', 'your opponents').replace('the damage dealt', 'the total amount of damage dealt')))).toBe(true);
  });
  it('the sum is of this turn\'s damage to the player; "combat damage", "this combat", another turn word or a creature recipient are other texts', () => {
    expect(JSON.stringify(compileCard(spell(T)).faces[0]!.abilities)).toContain('"sum":"amount"');
    expect(isFull(spell(T.replace('the damage dealt', 'the combat damage dealt')))).toBe(false);
    expect(isFull(spell(T.replace('this turn', 'this combat')))).toBe(false);
    expect(isFull(spell(T.replace('this turn', 'last turn')))).toBe(false);
    expect(isFull(spell(T.replace('target opponent', 'target creature')))).toBe(false);
    expect(isFull(spell(T.replace('target opponent', 'an opponent')))).toBe(false);
    expect(isFull(spell(T.replace('target opponent', 'each player')))).toBe(false);
  });
});

describe('edh-players-16: "If you do, draw that many cards" after "you may pay any amount" (effects/handlers/pay.ts#payHandler, model/lint-flow.ts, render/steps-flow.ts, render/steps-cards.ts; CR 118.12, 608.2c, 608.2d)', () => {
  it('a payment of {R} any number of times reads its own count in the same way', () => {
    expect(isFull(spell('You may pay any amount of {R}. If you do, draw that many cards.'))).toBe(true);
  });
  it('another branch word, another player or a fixed payment are other texts', () => {
    expect(isFull(spell('You may pay any amount of life. If you don\'t, draw that many cards.'))).toBe(false);
    expect(isFull(spell('Each opponent may pay any amount of life. If you do, draw that many cards.'))).toBe(false);
    expect(isFull(spell('You may pay 3 life. If you do, draw that many cards.'))).toBe(false);
  });
});

describe('edh-players-16: "If you do, draw that many cards" after a "you may discard any number of cards" inside a trigger that has an amount (parser/lower/quantities.ts; CR 608.2c, 608.2h)', () => {
  const T = 'Whenever ~ deals combat damage to a player, you may discard any number of cards. If you do, draw that many cards.';
  const creature = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
  it('is read, with the discard\'s count and never the damage', () => {
    expect(isFull(creature(T))).toBe(true);
    expect(JSON.stringify(compileCard(creature(T)).faces[0]!.abilities)).not.toContain('"q":"eventAmount"');
  });
  it('a "may" that does something a fixed number of times keeps "that many" ambiguous with the trigger\'s amount (fail closed)', () => {
    expect(isFull(creature('Whenever you gain life, you may discard a card. If you do, draw that many cards.'))).toBe(false);
    expect(isFull(creature(T.replace('discard any number of cards', 'discard a card')))).toBe(false);
    expect(isFull(creature(T.replace('discard any number of cards', 'discard your hand')))).toBe(true);
  });
  it('a sentence that is not "If you do" or has a step between stays ambiguous (fail closed)', () => {
    expect(isFull(creature(T.replace('If you do, draw', 'Draw')))).toBe(false);
    expect(isFull(creature(T.replace('If you do, draw that many cards.', 'If you do, gain 1 life. Draw that many cards.')))).toBe(false);
  });
});

describe('edh-players-16: "the engine advertises what the round needs"', () => {
  it('the pay capability of any amount is advertised', () => {
    expect(ENGINE_CAPABILITIES.has('op:pay.anyAmount')).toBe(true);
  });
});
