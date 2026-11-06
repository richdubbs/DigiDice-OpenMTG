/**
 * edh-players-21 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-21.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-21-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp21 from '../../../src/parser/templates/zz-cloud/edh-players-21.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP21 = edhp21 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (/^(Destroy|Each|Target)/.test(text) && !/ gets -1\/-1/.test(text) || / gets -1\/-1/.test(text)) return card('Example Volley', 'Sorcery', text);
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  // a ~ that "is still a land" is a land (the rider's type word is the object's own)
  if (/\bstill a land\b/.test(text) && text.includes('~')) return card('Example Nexus', 'Land', text);
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-players-21 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-21.json, path order: after edh-players-2, before edh-players-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-21.json');
    expect(files.indexOf('zz-cloud/edh-players-21.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-2.json'));
    expect(files.indexOf('zz-cloud/edh-players-21.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp21.*', () => {
    for (const t of EP21) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid)\.edhp21./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP21) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-21 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP21) {
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

describe('edh-players-21 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP21) {
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

describe('edh-players-21 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP21) {
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
  'eff.edhp21.choose.ownPerPlayer.opponent': { full: ['Summon: Valefor'] },
  'eff.edhp21.choose.ownPerPlayer.player': { full: ['Consuming Tide'] },
  'eff.edhp21.exile.ownPerPlayer.opponent': { full: ["Olórin's Searing Light"] },
  'eff.edhp21.draw.forEach.qty': { full: ['Consuming Tide'] },
  'eff.edhp21.pump.minus.forEachPoisonItsController': { full: ['Phyresis Outbreak'] },
};

describe.skipIf(index === null)('edh-players-21 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-21 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP21.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP21) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});




// ---- the parser, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';
const json = (c: OracleCard): string => JSON.stringify(compileCard(c).faces[0]!.abilities);

describe('edh-players-21: "each opponent chooses a <thing> they control" (own choice of every player of a group; render/steps-flow.ts#chooseObjects, CR 608.2d, 101.4)', () => {
  const T = "Each opponent chooses a creature with the greatest power among creatures they control. Return those creatures to their owners' hands.";
  it('is read as one choice for each player, made by that player, among their own objects (the filter reads the iterating player)', () => {
    expect(isFull(spell(T))).toBe(true);
    const j = json(spell(T));
    expect(j).toContain('"who":{"ref":"iterating"}');
    expect(j).toContain('"perPlayer":{"ref":"each","who":"opponent"}');
    expect(j).toContain('"controller":{"ref":"iterating"}');
    expect(j).not.toContain('"controller":"opponent"');
  });
  it('two objects, an object of yours, or no description of whose are other texts (fail closed)', () => {
    expect(isFull(spell(T.replace('a creature', 'two creatures')))).toBe(false);
    expect(isFull(spell(T.replace('they control', 'you control')))).toBe(false);
    expect(isFull(spell(T.replace('Each opponent', 'Each other player')))).toBe(false);
  });
});

describe('edh-players-21: "each opponent exiles a <thing> with the greatest power among <things> that player controls" and the damage "equal to the power of the creature they exiled"', () => {
  const T = 'Each opponent exiles a creature they control. If there are two or more instant cards in your graveyard, Example Volley deals damage to each opponent equal to the power of the creature they exiled.';
  it('the exile is the opponent\'s own choice; the amount is read for each opponent, of the one they exiled (`stat.by`)', () => {
    expect(isFull(spell(T))).toBe(true);
    const j = json(spell(T));
    expect(j).toContain('"as":"ownExiled"');
    expect(j).toContain('"by":{"ref":"iterating"}');
  });
  it('the power of something else, or of a creature "you exiled", is another text; a group that is not opponents or players does not exile for itself', () => {
    expect(isFull(spell(T.replace('the creature they exiled', 'the creature you exiled')))).toBe(false);
    expect(isFull(spell(T.replace('Each opponent exiles', 'Each other player exiles')))).toBe(false);
    expect(isFull(spell('If there are two or more instant cards in your graveyard, Example Volley deals damage to each opponent equal to the power of the creature they exiled.'))).toBe(false);
  });
  it('the older reading of "target opponent exiles an artifact they control" is unchanged', () => {
    expect(isFull(spell('Target opponent exiles an artifact they control.'))).toBe(true);
  });
});

describe('edh-players-21: "you draw a card for each opponent who has more cards in their hand than you" (parser/holes/qty.ts#opponentCounts, CR 402.1, 102.3, 608.2h)', () => {
  const T = 'Destroy target artifact. Then you draw a card for each opponent who has more cards in their hand than you.';
  it('counts the opponents whose hand is bigger than yours, each opponent judged alone, either spelling of the hand', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(json(spell(T))).toContain('"sizeVs":{"zone":"hand","op":">","than":{"ref":"you"}}');
    expect(isFull(spell(T.replace('their hand', 'hand')))).toBe(true);
  });
  it('fewer cards, a hand compared with another player, or "two cards" for each are other texts', () => {
    expect(isFull(spell(T.replace('more cards', 'fewer cards'))) && json(spell(T.replace('more cards', 'fewer cards'))).includes('"op":">"')).toBe(false);
    expect(isFull(spell(T.replace('than you', 'than each other player')))).toBe(false);
    expect(isFull(spell(T.replace('a card', 'two cards')))).toBe(false);
  });
});

describe('edh-players-21: "gets -1/-1 ... for each poison counter its controller has" (a quantity read for each affected object, effects/handlers/lasting.ts; CR 122.1f, 611.2c, 613.4c)', () => {
  const T = 'Each Elf your opponents control gets -1/-1 until end of turn for each poison counter its controller has.';
  it('is read per object: the poison counters of the controller of the affected object', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(json(spell(T))).toContain('{"q":"counters","on":{"ref":"controllerOf","object":{"ref":"subject"}},"kind":"poison"}');
  });
  it('your own counters, another amount or another kind of counter are other texts', () => {
    expect(isFull(spell(T.replace('its controller has', 'you have')))).toBe(false);
    expect(isFull(spell(T.replace('-1/-1', '-2/-2')))).toBe(false);
    expect(isFull(spell(T.replace('poison', 'energy')))).toBe(false);
  });
});

describe('edh-players-21: the engine advertises what the round needs', () => {
  it('the capabilities of the round are advertised', () => {
    for (const c of ['op:chooseObjects.perPlayer.ownChoice', 'feature:q.stat.by', 'feature:q.countPlayers.sizeVs']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
});
