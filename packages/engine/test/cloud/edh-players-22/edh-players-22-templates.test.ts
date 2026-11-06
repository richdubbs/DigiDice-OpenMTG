/**
 * edh-players-22 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-22.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-22-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp22 from '../../../src/parser/templates/zz-cloud/edh-players-22.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP22 = edhp22 as Template[];
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

describe('edh-players-22 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-22.json, path order: after edh-players-2.json, before edh-players-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-22.json');
    expect(files.indexOf('zz-cloud/edh-players-22.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-2.json'));
    expect(files.indexOf('zz-cloud/edh-players-22.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp22.*', () => {
    for (const t of EP22) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid|rst)\.edhp22./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP22) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-22 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP22) {
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

describe('edh-players-22 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP22) {
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

describe('edh-players-22 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP22) {
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
  'rst.edhp22.stun.cant.beRemoved': { full: ['Fear of Sleep Paralysis'] },
  'trg.edhp22.opponentSpellDestroys': { full: ['Karmic Justice'] },
  'eff.edhp22.hexproofWaiver.thisTurn': { full: ['Detection Tower'] },
};

describe.skipIf(index === null)('edh-players-22 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-22 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP22.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP22) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});




// ---- the engine and parser changes of the round (each with its negative cases) ----------------------------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const ench = (text: string): OracleCard => card('Example Ward', 'Enchantment', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-22: "Stun counters can\'t be removed from <permanents>" (rule haveStunCountersRemoved, rules/counters.ts#stunRemovalDenial; CR 122.1d, 614.17)', () => {
  const T = "Stun counters can't be removed from permanents your opponents control.";
  it('is read as the restriction on counters removed from the permanents described, and said back', () => {
    expect(isFull(ench(T))).toBe(true);
    const json = JSON.stringify(compileCard(ench(T)).faces[0]!.abilities);
    expect(json).toContain('"action":"haveStunCountersRemoved"');
    expect(ENGINE_CAPABILITIES.has('rule:haveStunCountersRemoved')).toBe(true);
  });
  it('another counter kind, "can be", "put on", or a this-turn duration are other texts (fail closed)', () => {
    expect(isFull(ench(T.replace('Stun counters', '+1/+1 counters')))).toBe(false);
    expect(isFull(ench(T.replace("can't be removed", 'can be removed')))).toBe(false);
    expect(isFull(ench(T.replace("can't be removed from", "can't be put on")))).toBe(false);
    expect(isFull(ench(T.replace('control.', 'control this turn.')))).toBe(false);
  });
});

describe('edh-players-22: "a spell or ability an opponent controls destroys <permanent>" (action destroy with `by`, triggers/match.ts, render/evt.ts, model/lint-roles.ts; CR 701.8a, 109.5, 603.10a)', () => {
  const T = 'Whenever a spell or ability an opponent controls destroys a noncreature permanent you control, you may destroy target permanent that opponent controls.';
  it('is read with the destroying controller as "that opponent" and said back', () => {
    expect(isFull(ench(T))).toBe(true);
    const json = JSON.stringify(compileCard(ench(T)).faces[0]!.abilities);
    expect(json).toContain('"verb":"destroy"');
    expect(json).toContain('"by":"opponent"');
    expect(json).toContain('"role":"by"');
    expect(ENGINE_CAPABILITIES.has('feature:ev.action.destroy.by')).toBe(true);
  });
  it('"you control" as the destroyer, "a spell" alone, or "is destroyed" are other texts (fail closed); "that player" or "you" for the target are not "that opponent"', () => {
    expect(isFull(ench(T.replace('an opponent controls destroys', 'you control destroys')))).toBe(false);
    expect(isFull(ench(T.replace('a spell or ability an opponent controls destroys', 'a spell an opponent controls destroys')))).toBe(false);
    expect(isFull(ench(T.replace('a spell or ability an opponent controls destroys a noncreature permanent you control', 'a noncreature permanent you control is destroyed')))).toBe(false);
    expect(JSON.stringify(compileCard(ench(T.replace('that opponent controls', 'you control'))).faces[0]!.abilities)).not.toContain('"role":"by"');
  });
});

describe('edh-players-22: "your opponents ... can be the targets of spells and abilities you control as though they didn\'t have hexproof" (rule targetableThroughHexproof `ofPlayers`, `player`; statics/hooks.ts#hexproofIgnored; CR 702.11b-c, 609.4)', () => {
  const T = "{T}: Until end of turn, your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.";
  it('is read as the waiver of the players and the creatures, for what the controller controls, until end of turn', () => {
    expect(isFull(card('Example Tower', 'Land', T))).toBe(true);
    const json = JSON.stringify(compileCard(card('Example Tower', 'Land', T)).faces[0]!.abilities);
    expect(json).toContain('"rule":"targetableThroughHexproof"');
    expect(json).toContain('"ofPlayers":{"ref":"each","who":"opponent"}');
    expect(json).toContain('"player":{"ref":"you"}');
    expect(json).toContain('"duration":{"d":"endOfTurn"}');
  });
  it('shroud, spells and abilities anyone controls, "you" instead of your opponents, or a longer duration are other texts (fail closed)', () => {
    expect(isFull(card('Example Tower', 'Land', T.replace("have hexproof", 'have shroud')))).toBe(false);
    expect(isFull(card('Example Tower', 'Land', T.replace('abilities you control', 'abilities')))).toBe(false);
    expect(isFull(card('Example Tower', 'Land', T.replace('your opponents and creatures your opponents control', 'you and creatures you control')))).toBe(false);
    expect(isFull(card('Example Tower', 'Land', T.replace('Until end of turn', 'Until your next turn')))).toBe(false);
  });
});

describe('edh-players-22: prowl (keywords/data/prowl.json, rules/history.ts#factsMatchFilter `sharesWith`, parser/holes/cond.ts; CR 702.76a)', () => {
  const T = "Prowl {1}\nYou gain 1 life. If ~'s prowl cost was paid, draw a card.";
  it('is a keyword with an alternative cost and "its prowl cost was paid"', () => {
    expect(isFull(card('Example Scheme', 'Kindred Sorcery — Rogue', T, { mana_cost: '{4}' }))).toBe(true);
    const json = JSON.stringify(compileCard(card('Example Scheme', 'Kindred Sorcery — Rogue', T, { mana_cost: '{4}' })).faces[0]!.abilities);
    expect(json).toContain('"via":"prowl"');
  });
  it('the cost of another kind of keyword, or the paid condition of an unnamed keyword, is another text', () => {
    expect(isFull(card('Example Scheme', 'Kindred Sorcery — Rogue', T.replace("prowl cost was paid", "frobnicate cost was paid"), { mana_cost: '{4}' }))).toBe(false);
    expect(isFull(card('Example Scheme', 'Kindred Sorcery — Rogue', T.replace('Prowl {1}', 'Prowl'), { mana_cost: '{4}' }))).toBe(false);
  });
});
