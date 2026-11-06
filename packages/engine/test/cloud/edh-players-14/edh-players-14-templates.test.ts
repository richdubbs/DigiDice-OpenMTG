/**
 * edh-players-14 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-14.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-14-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp14 from '../../../src/parser/templates/zz-cloud/edh-players-14.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP14 = edhp14 as Template[];
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

describe('edh-players-14 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-14.json, path order: after edh-players-11, before edh-players-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-14.json');
    expect(files.indexOf('zz-cloud/edh-players-14.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-11.json'));
    expect(files.indexOf('zz-cloud/edh-players-14.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp14.*', () => {
    for (const t of EP14) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp14\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP14) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-14 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP14) {
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

describe('edh-players-14 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP14) {
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

describe('edh-players-14 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP14) {
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
  'eff.edhp14.eachOpponentDiscards.thenWhoDidntLoses': { full: ["Kroxa, Titan of Death's Hunger"] },
  'eff.edhp14.player.getsNumberOfCounters': { full: ['Feral Ghoul'] },
  'eff.edhp14.grant.itAndGroup': { full: ['Wand of Orcus'] },
  'eff.edhp14.drawUnless.sacrificeOrPayLife': { full: ['Indulgent Tormentor'] },
};

describe.skipIf(index === null)('edh-players-14 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-14 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP14.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP14) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});




// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const creatureText = (text: string, type = 'Creature — Elf Warrior'): OracleCard => card('Example Brute', type, text, { power: '3', toughness: '3' });
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-14: "who discarded their hand this way" after a group `may` that begins with discarding the hand (parser/holes/player.ts, lower/mentions.ts#didOf, render/refs.ts; CR 701.9a, 608.2c)', () => {
  const T = (who: string): OracleCard => spell(`Each player may discard their hand and draw five cards. Then ~ deals 5 damage to ${who} who discarded their hand this way.`);
  it('is read and said back (opponents or players)', () => {
    expect(isFull(T('each opponent'))).toBe(true);
    expect(isFull(spell('Each player may discard their hand and draw five cards. Each player who discarded their hand this way loses 2 life.'))).toBe(true);
  });
  it('only an option that begins with discarding the whole hand is named so (fail closed)', () => {
    expect(isFull(spell('Each player may draw a card. Then ~ deals 5 damage to each opponent who discarded their hand this way.'))).toBe(false);
    expect(isFull(spell('Each player may discard a card and draw five cards. Then ~ deals 5 damage to each opponent who discarded their hand this way.'))).toBe(false);
    expect(isFull(spell('You may discard your hand and draw five cards. Then ~ deals 5 damage to each opponent who discarded their hand this way.'))).toBe(false);
    expect(isFull(spell('Each player discards their hand and draws five cards. Then ~ deals 5 damage to each opponent who discarded their hand this way.'))).toBe(false);
  });
  it('"who discarded their hand this turn" or a different group is another text', () => {
    expect(isFull(spell('Each player may discard their hand and draw five cards. Then ~ deals 5 damage to each opponent who discarded their hand this turn.'))).toBe(false);
    expect(isFull(spell('Each player may discard their hand and draw five cards. Then ~ deals 5 damage to each creature who discarded their hand this way.'))).toBe(false);
  });
});

describe('edh-players-14: "didn\'t discard a nonland card this way" with one card (parser/holes/moved.ts#notMoved, render/steps-flow.ts#didntDiscardEach, render/steps.ts commaThenWho; CR 701.9a, 608.2c)', () => {
  it('is read and said back, also as a sentence of its own with "For each opponent who didn\'t discard a card this way"', () => {
    expect(isFull(spell("Each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life."))).toBe(true);
    expect(isFull(spell("Each opponent discards a card. For each opponent who didn't discard a creature card this way, you draw a card."))).toBe(true);
    expect(isFull(spell("Each opponent discards two cards. For each opponent who didn't discard two nonland cards this way, you draw a card."))).toBe(true);
  });
  it('another count, kind of group, verb or tie to the discard is another text', () => {
    expect(isFull(spell("Each player discards a card, then each opponent who didn't discard a nonland card this way loses 3 life."))).toBe(false);
    expect(isFull(spell("Each opponent discards a card, then each opponent who didn't sacrifice a nonland card this way loses 3 life."))).toBe(false);
    expect(isFull(spell("Each opponent discards a card, then each opponent who didn't discard a nonland card this turn loses 3 life."))).toBe(false);
    expect(isFull(spell("Each opponent mills a card, then each opponent who didn't discard a nonland card this way loses 3 life."))).toBe(false);
  });
});

describe('edh-players-14: "nontoken historic permanent" (render/np.ts "nontoken historic"; CR 700.6, 603.2)', () => {
  const T = (type: string, sentence: string): OracleCard => creatureText(sentence, type);
  const S = 'Whenever ~ or another nontoken historic permanent you control enters, draw a card.';
  it('is read and said back, the object itself being historic or not (the trigger lists the object itself as its own event)', () => {
    expect(isFull(T('Legendary Creature — Human', S))).toBe(true);
    expect(isFull(T('Creature — Human', S))).toBe(true);
  });
  it('only the order Oracle prints is said ("nontoken historic", not "historic nontoken")', () => {
    expect(isFull(T('Legendary Creature — Human', 'Whenever ~ or another historic nontoken permanent you control enters, draw a card.'))).toBe(false);
  });
  it('"target nontoken historic permanent" is said back as well', () => {
    expect(isFull(spell('Destroy target nontoken historic permanent you control.'))).toBe(true);
  });
});

describe('edh-players-14: "for each opponent you attacked" (parser/holes/qty.ts#opponentCounts, render/qty.ts; CR 506.3, 508.1)', () => {
  it('is the opponents attacked this turn, with or without the words "this turn"', () => {
    expect(isFull(creatureText('At end of combat on your turn, if you attacked this turn, create a Treasure token for each opponent you attacked.'))).toBe(true);
    expect(isFull(creatureText('At end of combat on your turn, if you attacked this turn, create a Treasure token for each opponent you attacked this turn.'))).toBe(true);
  });
  it('another group or verb is another text', () => {
    expect(isFull(creatureText('At end of combat on your turn, if you attacked this turn, create a Treasure token for each opponent you blocked.'))).toBe(false);
    expect(isFull(creatureText('At end of combat on your turn, if you attacked this turn, create a Treasure token for each player you attacked.'))).toBe(false);
    expect(isFull(creatureText('At end of combat on your turn, if you attacked this turn, create a Treasure token for each creature you attacked.'))).toBe(false);
  });
});

describe('edh-players-14: the render forms (render/steps-flow.ts: the unless form of a target player; render/clause.ts#commaThenWho)', () => {
  it('"draw a card unless target opponent sacrifices ... or pays N life" needs a target player and both payments in this order', () => {
    expect(isFull(creatureText('At the beginning of your upkeep, draw a card unless target opponent pays 3 life or sacrifices a creature of their choice.'))).toBe(false);
    expect(isFull(creatureText('At the beginning of your upkeep, draw a card unless each opponent sacrifices a creature of their choice or pays 3 life.'))).toBe(false);
  });
});

describe('edh-players-14: the engine advertises what the round needs', () => {
  it('no new capability: the discard step\'s `as` and the `may` group binding are read as ever', () => {
    expect(ENGINE_CAPABILITIES.has('ref:bound')).toBe(true);
  });
});
