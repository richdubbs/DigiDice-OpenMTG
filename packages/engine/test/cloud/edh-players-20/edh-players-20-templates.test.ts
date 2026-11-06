/**
 * edh-players-20 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-20.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-20-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp20 from '../../../src/parser/templates/zz-cloud/edh-players-20.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP20 = edhp20 as Template[];
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

describe('edh-players-20 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-20.json, path order: after edh-players-2.json, before edh-players-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-20.json');
    expect(files.indexOf('zz-cloud/edh-players-20.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-2.json'));
    expect(files.indexOf('zz-cloud/edh-players-20.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp20.*', () => {
    for (const t of EP20) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid)\.edhp20./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP20) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-20 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP20) {
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

describe('edh-players-20 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP20) {
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

describe('edh-players-20 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP20) {
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
  'eff.edhp20.drawLose.youAndPlayer': { full: ['Karazikar, the Eye Tyrant'] },
  'eff.edhp20.then.draw.another.ifCond': { full: ['Tevesh Szat, Doom of Fools'] },
  'eff.edhp20.grant.eachOfThose': { full: ['Cauldron of Souls'] },
};

describe.skipIf(index === null)('edh-players-20 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-20 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP20.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP20) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});



// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const ench = (text: string): OracleCard => card('Example Ward', 'Enchantment', text);
const brute = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-20: "an opponent attacks another one of your opponents" (parser/holes/event.ts#opponentsAttacked, triggers/match.ts `otherThanAttacker`, render/evt.ts; CR 506.2, 508.1b, 603.2c)', () => {
  const T = 'Whenever an opponent attacks another one of your opponents, you and the attacking player each draw a card and lose 1 life.';
  it('is read as an opponent\'s creatures attacking an opponent that is not their own controller, one occurrence for each opponent attacked', () => {
    expect(isFull(ench(T))).toBe(true);
    const json = JSON.stringify(compileCard(ench(T)).faces[0]!.abilities);
    expect(json).toContain('"otherThanAttacker":true');
    expect(json).toContain('"defender":"opponent"');
    expect(json).toContain('"attacker":{"types":["Creature"],"controller":"opponent"}');
    expect(ENGINE_CAPABILITIES.has('feature:ev.attacks.otherThanAttacker')).toBe(true);
  });
  it('"a player", "you", or the single wording without "another" are other texts (fail closed)', () => {
    expect(isFull(ench(T.replace('an opponent attacks', 'a player attacks')))).toBe(false);
    expect(isFull(ench(T.replace('an opponent attacks', 'you attack')))).toBe(false);
    expect(JSON.stringify(compileCard(ench(T.replace('another one of your opponents', 'one of your opponents'))).faces[0]!.abilities)).not.toContain('otherThanAttacker');
  });
});

describe('edh-players-20: "the controller of those creatures" after a damage trigger of an opponent\'s creatures (parser/holes/player.ts#ofObjects, render/refs.ts, triggers/occurrences.ts#bySourceController; CR 109.4, 510.2, 603.2c)', () => {
  const T = 'Whenever one or more creatures an opponent controls deal combat damage to one or more of your opponents, you and the controller of those creatures each draw a card.';
  it('is read as the controller of the event\'s source creatures and said back', () => {
    expect(isFull(ench(T))).toBe(true);
    expect(JSON.stringify(compileCard(ench(T)).faces[0]!.abilities)).toContain('"who":{"ref":"controllerOf","object":{"ref":"event","role":"source"}}');
  });
  it('a wording about one creature, "you control", or damage to a player not an opponent are other readings (the controller named is a different one)', () => {
    expect(isFull(ench(T.replace('creatures an opponent controls', 'creatures you control')))).toBe(false);
    expect(isFull(ench(T.replace('the controller of those creatures', 'the owner of those creatures')))).toBe(false);
  });
});

describe('edh-players-20: "draw another card if the sacrificed permanent was a commander" (cond.ts past tense, render/cond.ts#PAST_FIELDS, render/fold-edhp20.ts; CR 608.2h, 903.3)', () => {
  const T = 'When ~ enters, you may sacrifice another creature or planeswalker. If you do, draw two cards, then draw another card if the sacrificed permanent was a commander.';
  it('is read inside the "if you do" of the optional sacrifice and said back', () => {
    expect(isFull(brute(T))).toBe(true);
    const json = JSON.stringify(compileCard(brute(T)).faces[0]!.abilities);
    expect(json).toContain('"cond":"matches","object":{"ref":"costSacrificed"},"filter":{"commander":true}');
  });
  it('the condition outside the "if you do", a different count, or "a Goblin" instead are other texts (the first two stay manual)', () => {
    expect(isFull(brute(T.replace('If you do, ', '')))).toBe(false);
    expect(isFull(brute(T.replace('draw another card', 'draw two more cards')))).toBe(false);
    expect(isFull(brute(T.replace('a commander', 'a Goblin')))).toBe(true);
  });
});

describe('edh-players-20: "each of those creatures gains X" (template eff.edhp20.grant.eachOfThose, render/mods.ts; CR 611.2a, 608.2c)', () => {
  const T = '{T}: Choose any number of target creatures. Each of those creatures gains haste until end of turn.';
  it('is read over the announced creatures', () => {
    expect(isFull(card('Example Pot', 'Artifact', T))).toBe(true);
    expect(JSON.stringify(compileCard(card('Example Pot', 'Artifact', T)).faces[0]!.abilities)).toContain('"max":"any"');
  });
  it('without an announcement, or with a verb for several ("gain"), it is not read with this template', () => {
    expect(isFull(card('Example Pot', 'Artifact', T.replace('Choose any number of target creatures. ', '')))).toBe(false);
    expect(isFull(card('Example Pot', 'Artifact', T.replace('gains haste', 'gain haste')))).toBe(false);
  });
});

describe('edh-players-20: the pronoun in the count of a draw (parser/lower/anaphora.ts#countWindow, eff.r4static.draw.forEachOther `sharesWith`; CR 121.1, 201.5)', () => {
  const T = 'Whenever ~ enters or attacks, you may draw a card for each other creature you control that shares a creature type with it. If you do, discard a card.';
  it('is read: the object itself is "it" in the count of the first instruction', () => {
    expect(isFull(brute(T))).toBe(true);
    const json = JSON.stringify(compileCard(brute(T)).faces[0]!.abilities);
    expect(json).toContain('"sharesWith":{"with":{"ref":"self"},"quality":"creatureType"}');
  });
  it('"it" in a later instruction or without "each other" is not made to mean the object (fail closed)', () => {
    expect(isFull(brute('Whenever ~ enters or attacks, you gain 1 life. Draw a card for each other creature you control that shares a creature type with it.'))).toBe(false);
  });
});

describe('edh-players-20: "one or more opponents each lose exactly 1 life" (parser/holes/event.ts#opponentsLoseExactly, triggers/occurrences.ts#byPlayerTotal; CR 119.3, 603.2c)', () => {
  const T = 'Whenever one or more opponents each lose exactly 1 life, draw a card.';
  it('is read as the total life each opponent lost in the batch', () => {
    expect(isFull(brute(T))).toBe(true);
    expect(JSON.stringify(compileCard(brute(T)).faces[0]!.abilities)).toContain('"totalAmount":true');
    expect(ENGINE_CAPABILITIES.has('feature:ev.life.totalAmount')).toBe(true);
  });
  it('"at least", "you", or no number are other texts (fail closed)', () => {
    expect(isFull(brute(T.replace('exactly 1', 'at least 1')))).toBe(false);
    expect(isFull(brute(T.replace('one or more opponents each', 'you')))).toBe(false);
    expect(isFull(brute(T.replace('exactly 1 life', 'exactly life')))).toBe(false);
  });
});

describe('edh-players-20: "becomes tapped, if it isn\'t being declared as an attacker" (parser/holes/event.ts, triggers/normalize.ts `asAttacker`, render/evt.ts; CR 508.1f, 603.4)', () => {
  const T = "Whenever a creature an opponent controls becomes tapped, if it isn't being declared as an attacker, you may draw a card.";
  it('is read as a tap that is not the attack declaration\'s', () => {
    expect(isFull(ench(T))).toBe(true);
    expect(JSON.stringify(compileCard(ench(T)).faces[0]!.abilities)).toContain('"notAsAttacker":true');
    expect(ENGINE_CAPABILITIES.has('feature:ev.becomes.notAsAttacker')).toBe(true);
  });
  it('another condition after the comma, or "becomes untapped", is another text (fail closed)', () => {
    expect(isFull(ench(T.replace("it isn't being declared as an attacker", "it isn't being declared as a blocker")))).toBe(false);
    expect(isFull(ench(T.replace('becomes tapped', 'becomes untapped')))).toBe(false);
  });
});
