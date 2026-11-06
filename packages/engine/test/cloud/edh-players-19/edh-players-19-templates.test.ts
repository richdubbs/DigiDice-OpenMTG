/**
 * edh-players-19 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-19.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-19-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp19 from '../../../src/parser/templates/zz-cloud/edh-players-19.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP19 = edhp19 as Template[];
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

describe('edh-players-19 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-19.json, path order: after edh-players-16, before edh-players-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-19.json');
    expect(files.indexOf('zz-cloud/edh-players-19.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-16.json'));
    expect(files.indexOf('zz-cloud/edh-players-19.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp19.*', () => {
    for (const t of EP19) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid)\.edhp19./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP19) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-19 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP19) {
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

describe('edh-players-19 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP19) {
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

describe('edh-players-19 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP19) {
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
  'eff.edhp19.emblem.player': { full: ['Ob Nixilis Reignited'] },
  'eff.edhp19.untilNextTurn.eitherOfThose.combatDamage': { full: ['Tamiyo, Field Researcher'] },
  'eff.edhp19.counters.putAll.theyControl': { full: ['Shadrix Silverquill'] },
};

describe.skipIf(index === null)('edh-players-19 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-19 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP19.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP19) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});



// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const ench = (text: string): OracleCard => card('Example Ward', 'Enchantment', text);
const brute = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-19: "an opponent is dealt combat damage by one or more creatures you control" (parser/holes/event.ts#playerPredicates, render/evt.ts; CR 120.2, 510.2, 603.2c)', () => {
  const T = 'Whenever an opponent is dealt combat damage by one or more creatures you control, that player loses 1 life.';
  it('is read as the batch of combat damage your creatures deal to one opponent (the same pattern as "deal combat damage to an opponent"), and said back', () => {
    expect(isFull(ench(T))).toBe(true);
    const json = JSON.stringify(compileCard(ench(T)).faces[0]!.abilities);
    expect(json).toContain('"batch":true');
    expect(json).toContain('"source":{"types":["Creature"],"controller":"you"}');
    expect(json).toContain('"recipient":{"player":"opponent"}');
    const canon = (x: unknown): unknown => (Array.isArray(x) ? x.map(canon) : x !== null && typeof x === 'object' ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([k]) => k !== 'text').sort(([p], [q]) => p.localeCompare(q)).map(([k, v]) => [k, canon(v)])) : x);
    const other = compileCard(ench('Whenever one or more creatures you control deal combat damage to an opponent, that player loses 1 life.')).faces[0]!.abilities;
    expect(canon(other)).toEqual(canon(compileCard(ench(T)).faces[0]!.abilities));
  });
  it('"a player" is every player; your own damage taken is no such event ("you"), noncombat damage and other sources are other texts (fail closed)', () => {
    expect(isFull(ench(T.replace('an opponent', 'a player')))).toBe(true);
    expect(isFull(ench(T.replace('an opponent', 'you')))).toBe(false);
    expect(isFull(ench(T.replace('combat damage', 'noncombat damage')))).toBe(false);
    expect(isFull(ench(T.replace('creatures you control', 'creatures')))).toBe(false);
    expect(isFull(ench(T.replace('one or more creatures', 'a creature')))).toBe(false);
  });
});

describe('edh-players-19: "if that player lost less than 8 life this turn" and "equal to the difference" (parser/holes/cond.ts#anaphorLostLess, parser/lower/quantities.ts#differenceOf, render/cond.ts; CR 119.3, 120.3a, 603.4, 608.2h)', () => {
  const T = 'Whenever an opponent is dealt combat damage by one or more creatures you control, if that player lost less than 8 life this turn, they lose life equal to the difference.';
  it('is read: the 8 minus the life that player lost this turn, for the player the event named', () => {
    expect(isFull(ench(T))).toBe(true);
    const json = JSON.stringify(compileCard(ench(T)).faces[0]!.abilities);
    expect(json).toContain('"interveningIf":{"cond":"compare","left":{"q":"lifeLostThisTurn","of":{"ref":"event","role":"recipient"}},"op":"<","right":8}');
    expect(json).toContain('"amount":{"q":"math","op":"-","args":[8,{"q":"lifeLostThisTurn","of":{"ref":"event","role":"recipient"}}]}');
  });
  it('another number, "more than", you instead of that player, or "the difference" with no such condition are other texts (fail closed)', () => {
    expect(isFull(ench(T.replace('less than 8', 'less than 5')))).toBe(true);
    expect(isFull(ench(T.replace('less than 8', 'more than 8')))).toBe(false);
    expect(isFull(ench(T.replace('that player lost', 'you lost')))).toBe(false);
    expect(isFull(ench(T.replace('if that player lost less than 8 life this turn, ', '')))).toBe(false);
  });
});

describe('edh-players-19: "you may choose two" over modes (parser/lower/ability.ts#modalHeaderWords, render/program.ts#modeHeader, actions/announce.ts#chooseModes; CR 700.2, 603.3c)', () => {
  const T = 'At the beginning of combat on your turn, you may choose two. Each mode must target a different player.\n• Target player draws a card.\n• Target player gains 2 life.\n• Target player loses 1 life.';
  it('is read with the "each mode must target a different player" rider, as none or exactly two', () => {
    expect(isFull(brute(T))).toBe(true);
    const json = JSON.stringify(compileCard(brute(T)).faces[0]!.abilities);
    expect(json).toContain('"mayChoose":true');
    expect(json).toContain('"min":0,"max":2');
  });
  it('"you may choose one", more modes than printed, or a different rider are other texts (fail closed)', () => {
    expect(isFull(brute(T.replace('choose two', 'choose one')))).toBe(false);
    expect(isFull(brute(T.replace('choose two', 'choose four')))).toBe(false);
    expect(isFull(brute(T.replace('Each mode must target a different player.', 'Each mode must target a different creature.')))).toBe(false);
  });
});

describe('edh-players-19: "target player puts a +1/+1 counter on each creature they control" (the putCounters step\'s `by`, effects/handlers/counters.ts; CR 122.1, 122.6)', () => {
  it('is read with the target player as the one who puts them, and only on a group that player controls', () => {
    const T = 'Target player puts a +1/+1 counter on each creature they control.';
    expect(isFull(spell(T))).toBe(true);
    expect(JSON.stringify(compileCard(spell(T)).faces[0]!.abilities)).toContain('"by":{"ref":"target"');
    expect(isFull(spell(T.replace('they control', 'you control')))).toBe(false);
    // edh-c-29: "a creature they control" IS read now (eff.edhv29.player.putsCounters.onOneTheyControl: the player chooses one of their own creatures); this older negative is changed
    // to the shapes that stay closed: one creature of the group the player does not control, and one creature with no owner named
    expect(isFull(spell(T.replace('each creature they control', 'a creature you control')))).toBe(false);
    expect(isFull(spell(T.replace('each creature they control', 'a creature')))).toBe(false);
  });
});

describe('edh-players-19: "target opponent gets an emblem with ..." (template eff.edhp19.emblem.player; CR 114.1, 114.2)', () => {
  it('is read for a target opponent, a target player, and still read for you with the older template', () => {
    expect(isFull(spell('Target opponent gets an emblem with "Whenever a player casts a spell, you lose 1 life."'))).toBe(true);
    expect(isFull(spell('You get an emblem with "Whenever a player casts a spell, you lose 1 life."'))).toBe(true);
    expect(compileCard(spell('You get an emblem with "Whenever a player casts a spell, you lose 1 life."')).faces[0]!.abilities.length).toBe(1);
  });
  it('a count other than one, or a body that is not understood, stays manual (fail closed)', () => {
    expect(isFull(spell('Target opponent gets two emblems with "Whenever a player casts a spell, you lose 1 life."'))).toBe(false);
    expect(isFull(spell('Target opponent gets an emblem with "Whenever a player casts a spell, blorfty."'))).toBe(false);
  });
});

describe('edh-players-19: "whenever either of those creatures deals combat damage" (render/evt.ts#subjectOf; CR 603.7, 603.7c)', () => {
  const T = 'Choose up to two target creatures. Until your next turn, whenever either of those creatures deals combat damage, you draw a card.';
  it('is read over the two announced creatures and said back with "choose" first', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(JSON.stringify(compileCard(spell(T)).faces[0]!.abilities)).toContain('"source":{"is":{"ref":"target","id":"t0"}}');
  });
  it('another duration, noncombat damage, or no announcement are other texts', () => {
    expect(isFull(spell(T.replace('Until your next turn', 'Until end of turn')))).toBe(false);
    expect(isFull(spell(T.replace('combat damage', 'damage')))).toBe(false);
    expect(isFull(spell(T.replace('Choose up to two target creatures. ', '')))).toBe(false);
  });
});

describe('edh-players-19: the engine advertises what the round needs', () => {
  it('the capabilities of the round are advertised', () => {
    for (const c of ['op:putCounters.by', 'feature:modes.mayChoose']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
});

describe('edh-players-19 review fixes (fail closed)', () => {
  it('a group of players putting counters, or "you" with "they control", is not a reading of the counters template', () => {
    expect(isFull(spell('Each opponent puts a -1/-1 counter on each creature they control.'))).toBe(false);
    expect(isFull(spell('You put a +1/+1 counter on each creature they control.'))).toBe(false);
  });
  it('"either of those creatures" over cards that were in a graveyard (they change zones) is not read', () => {
    expect(isFull(spell('Return up to two target creature cards from your graveyard to the battlefield. Until your next turn, whenever either of those creatures deals combat damage, you draw a card.'))).toBe(false);
  });
  it('"you may choose two" on a spell is not read (it could be cast with no mode)', () => {
    expect(isFull(spell('You may choose two.\n• Draw a card.\n• You gain 2 life.\n• Each opponent loses 1 life.'))).toBe(false);
  });
});
