/**
 * edh-players-13 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-13.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-13-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp13 from '../../../src/parser/templates/zz-cloud/edh-players-13.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP13 = edhp13 as Template[];
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

describe('edh-players-13 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-13.json, path order: after edh-players-10, before edh-players-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-13.json');
    expect(files.indexOf('zz-cloud/edh-players-13.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-10.json'));
    expect(files.indexOf('zz-cloud/edh-players-13.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp13.*', () => {
    for (const t of EP13) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid)\.edhp13./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP13) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-13 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP13) {
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

describe('edh-players-13 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP13) {
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

describe('edh-players-13 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP13) {
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
  'eff.edhp13.eachPlayer.choose.creatureType': { full: ["Patriarch's Bidding"] },
  'eff.edhp13.eachPlayer.returnAll.graveyard.bf': { full: ["Patriarch's Bidding"] },
  'eff.edhp13.eachOpponent.chooses.words': { full: ['Master of Ceremonies', 'Seize the Spotlight'] },
  'eff.edhp13.forEachPlayerWhoChose': { full: ['Master of Ceremonies', 'Seize the Spotlight'] },
  'eff.edhp13.gainControl.aThatPlayerControls.dur': { full: ['Seize the Spotlight'] },
  'eff.edhp13.forEachVote': { full: ['Tivit, Seller of Secrets'] },
};

describe.skipIf(index === null)('edh-players-13 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-13 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP13.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP13) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});


// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const creatureText = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...extra });
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-13: "a type chosen this way" after "Each player chooses a creature type." (parser/holes/choicewords.ts#chosenAll, render/np.ts, render/steps-zones.ts; CR 608.2d, 607.2d)', () => {
  const HEAD = 'Each player chooses a creature type. ';
  const T = `${HEAD}Each player returns all creature cards of a type chosen this way from their graveyard to the battlefield.`;
  it('is read and said back, for any card description', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(isFull(spell(T.replace('creature cards', 'Goblin cards')))).toBe(true);
  });
  it('one chooser\'s "the chosen type", a choice by you only, another word for the types or another destination are other texts (fail closed)', () => {
    expect(isFull(spell(T.replace('of a type chosen this way', 'of the chosen type')))).toBe(false);
    expect(isFull(spell(T.replace('Each player chooses', 'Choose')))).toBe(false);
    expect(isFull(spell(T.replace('Each player chooses', 'Each opponent chooses')))).toBe(false);
    expect(isFull(spell(T.replace('of a type chosen this way', 'of a color chosen this way')))).toBe(false);
    expect(isFull(spell(T.replace('to the battlefield', 'to their hand')))).toBe(false);
    expect(isFull(spell(T.replace('Each player chooses a creature type. ', '')))).toBe(false);
  });
});

describe('edh-players-13: "For each player who chose <word>" reads a word the earlier choice offered, and "that player" is the player of its own loop (parser/lower/links.ts#checkChoseWords, lower/mentions.ts; CR 608.2d, 608.2f)', () => {
  const HEAD = 'Each opponent chooses money, friends, or secrets. ';
  it('three loops in one ability each name their own player', () => {
    expect(isFull(spell(`${HEAD}For each player who chose money, you and that player each draw a card. For each player who chose friends, you and that player each draw a card. For each player who chose secrets, you and that player each draw a card.`))).toBe(true);
  });
  it('a word the choice did not offer, a choice by a different player group or no choice at all are not read', () => {
    expect(isFull(spell(`${HEAD}For each player who chose fame, you and that player each draw a card.`))).toBe(false);
    expect(isFull(spell('For each player who chose money, you and that player each draw a card.'))).toBe(false);
    expect(isFull(spell(`${HEAD.replace('Each opponent', 'Each player')}For each player who chose money, you and that player each draw a card.`))).toBe(false);
  });
  it('the words are a closed list: an invented word is no choice (guard G2)', () => {
    expect(isFull(spell('Each opponent chooses fame or blorfty. For each player who chose fame, you draw a card.'))).toBe(false);
    expect(isFull(spell('Each opponent chooses fame or fortune. For each player who chose blorfty, you draw a card.'))).toBe(false);
  });
});

describe('edh-players-13: "Untap those creatures and they gain haste" after the loop that gained control of them (render/fold-edhp13.ts, lower/mentions.ts; CR 608.2c, 611.2a)', () => {
  const T = 'Each opponent chooses fame or fortune. For each player who chose fame, gain control of a creature that player controls until end of turn. Untap those creatures and they gain haste until end of turn.';
  it('is read and said back', () => expect(isFull(spell(T))).toBe(true));
  it('another duration, "you control" in place of "that player controls", or a second opponent group are other texts', () => {
    expect(isFull(spell(T.replace('gain control of a creature that player controls until end of turn', 'gain control of a creature that player controls'))) ).toBe(false);
    expect(isFull(spell(T.replace('that player controls', 'you control')))).toBe(false);
    expect(isFull(spell(T.replace('Untap those creatures and they gain haste until end of turn.', 'Untap those creatures and they gain flying until end of turn.')))).toBe(true); // any granted ability reads the same way
    expect(isFull(spell(T.replace('those creatures', 'those lands')))).toBe(false);
  });
});

describe('edh-players-13: "For each <word> vote, ..." (parser/holes/vote.ts#voteCount, render/qty.ts; CR 701.38a-b)', () => {
  const T = 'Starting with you, each player votes for evidence or bribery. For each evidence vote, investigate.';
  it('is read and said back, for each of the two words', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(isFull(spell(T.replace('For each evidence vote', 'For each bribery vote')))).toBe(true);
  });
  it('a word that is not one of the vote\'s two, or no vote before it, is not read', () => {
    expect(isFull(spell(T.replace('For each evidence vote', 'For each carnage vote')))).toBe(false);
    expect(isFull(spell('For each evidence vote, investigate.'))).toBe(false);
    expect(isFull(spell(T.replace('votes for evidence or bribery', 'chooses evidence or bribery')))).toBe(false);
  });
});

describe('edh-players-13: a delayed "whenever one or more creatures ... deal combat damage to one or more players this turn" is one occurrence (types delay.wholeBatch, triggers/delayed.ts, lower/normalize.ts, render/steps-lasting.ts; CR 603.2c)', () => {
  const T = 'Draw a card. Whenever one or more creatures you control deal combat damage to one or more players this turn, you become the monarch.';
  it('is read and said back; "to a player" is another reading of the same sentence start', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(isFull(spell(T.replace('to one or more players', 'to a player')))).toBe(true);
    expect(compileCard(spell(T)).faces[0]!.abilities).not.toEqual(compileCard(spell(T.replace('to one or more players', 'to a player'))).faces[0]!.abilities);
  });
  it('"one or more" of the creatures only, or of the damage in the plural for a single object, is no wholeBatch', () => {
    expect(JSON.stringify(compileCard(spell(T.replace('to one or more players', 'to a player'))).faces[0]!.abilities)).not.toContain('wholeBatch');
    expect(JSON.stringify(compileCard(spell(T)).faces[0]!.abilities)).toContain('"wholeBatch":true');
    expect(isFull(spell(T.replace('one or more creatures you control deal', 'a creature you control deals').replace('to one or more players', 'to one or more players')))).toBe(false);
  });
});

describe('edh-players-13: "the engine advertises what the round needs"', () => {
  it('the player reference chose and the whole-batch delay are capabilities', () => {
    expect(ENGINE_CAPABILITIES.has('ref:chose')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:delay.batch.whole')).toBe(true);
  });
});
