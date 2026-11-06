/**
 * edh-players-5 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-5.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-5-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp5 from '../../../src/parser/templates/zz-cloud/edh-players-5.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP5 = edhp5 as Template[];
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

describe('edh-players-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-5.json, path order: after edh-players-1, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-5.json');
    expect(files.indexOf('zz-cloud/edh-players-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-3.json'));
    expect(files.indexOf('zz-cloud/edh-players-5.json')).toBeLessThan(files.indexOf('zz-cloud/edh-replace-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp5.*', () => {
    for (const t of EP5) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp5\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP5) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-5 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP5) {
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

describe('edh-players-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP5) {
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

describe('edh-players-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP5) {
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
  'trg.edhp5.opponent.activate.abilityOf.notMana': { full: ['Runic Armasaur'] },
  'trg.edhp5.opponent.activate.abilityOf.onBattlefield.ifNotMana': { full: ['Harsh Mentor'] },
  'eff.edhp5.draw.halfLibrary.loseHalfLife': { full: ['Peer into the Abyss'] },
  'eff.edhp5.you.add.units': { full: ['Priest of Forgotten Gods'] },
  'eff.edhp5.player.loseLife.andSacrificeChoice': { full: ['Priest of Forgotten Gods'] },
  'eff.edhp5.objAnd.objs.eachGet.pt.whereX': { full: ['Alandra, Sky Dreamer'] },
  'eff.edhp5.players.gain.hexproof': { full: ['Everybody Lives!'] },
  'eff.edhp5.players.cantLoseLife.cantLoseOrWinGame.thisTurn': { full: ['Everybody Lives!'] },
  'eff.edhp5.player.gainLife.andDraw.equalTo': { full: ['Lifeblood Hydra'] },
  'eff.edhp5.whenever.thatCreature.combatDamage.playerOrPlaneswalker.thisTurn': { full: ["Hunter's Insight"] },
  'eff.edhp5.payelse.life': { full: ['Athreos, God of Passage'] },
  'eff.edhp5.exile.self.and.objs': { full: ['Ajani, Strength of the Pride'] },
};

describe.skipIf(index === null)('edh-players-5 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP5.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP5) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});

// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const creatureText = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-5: "Round up each time." is joined to the sentence with the halves before it (parser/lower/ability.ts#joinRoundDown; CR 107.1a)', () => {
  it('is read after a draw of half a library and a loss of half the life; "Round down each time" and no rounding sentence are not this reading', () => {
    expect(isFull(spell('Target opponent draws cards equal to half the number of cards in their library and loses half their life. Round up each time.'))).toBe(true);
    expect(isFull(spell('Target opponent draws cards equal to half the number of cards in their library and loses half their life. Round down each time.'))).toBe(false);
    expect(isFull(spell('Target opponent draws cards equal to half the number of cards in their library and loses half their life.'))).toBe(false);
    expect(isFull(spell('Target opponent draws cards equal to half the number of cards in your library and loses half their life. Round up each time.'))).toBe(false);
  });
  it('"you" is not read (its words are "your library" and "your life")', () => {
    expect(isFull(spell('You draw cards equal to half the number of cards in their library and lose half their life. Round up each time.'))).toBe(false);
  });
  it('Pox Plague\'s "Round down each time." is still joined (unchanged)', () => {
    expect(isFull(spell('Each player loses half their life, then discards half the cards in their hand, then sacrifices half the permanents they control of their choice. Round down each time.'))).toBe(true);
  });
});

describe('edh-players-5: "twice -X/-X" (parser/holes/misc.ts#pt, render/mods.ts#powerToughness; CR 107.3a, 613.4c)', () => {
  it('reads each half twice the X of the cost, and says it back once', () => {
    expect(isFull(spell('Each creature gets twice -X/-X until end of turn.', { mana_cost: '{X}{B}' }))).toBe(true);
  });
  it('a number, a word that is not twice and an X the card has no cost for are not read', () => {
    expect(isFull(spell('Each creature gets three times -X/-X until end of turn.', { mana_cost: '{X}{B}' }))).toBe(false);
    expect(isFull(spell('Each creature gets twice -X/-X until end of turn.'))).toBe(false); // no {X} in its cost (CR 107.3)
    expect(isFull(spell('Each creature gets twice -2/-2 until end of turn.'))).toBe(false);
  });
});

describe('edh-players-5: "..., if it isn\'t a mana ability" after an ability of a permanent is the same event (render/evt.ts, `activate`)', () => {
  it('is read and said back in either form; a mana ability, a "you" and no filter are other events', () => {
    expect(isFull(creatureText('Whenever an opponent activates an ability of a creature on the battlefield, if it isn\'t a mana ability, draw a card.'))).toBe(true);
    expect(isFull(creatureText('Whenever an opponent activates an ability of a creature that isn\'t a mana ability, draw a card.'))).toBe(true);
    expect(isFull(creatureText('Whenever an opponent activates an ability of a creature on the battlefield, if it is a mana ability, draw a card.'))).toBe(false);
    expect(isFull(creatureText('Whenever you activate an ability of a creature on the battlefield, if it isn\'t a mana ability, draw a card.'))).toBe(false);
  });
});

describe('edh-players-5: "~ and <group> each get +X/+X" (render/mods.ts alt for a union of the object and a group)', () => {
  it('is read with "where X is"; "or", a count that is not an X and no duration are not', () => {
    expect(isFull(creatureText('Whenever you draw a card, ~ and Goblins you control each get +X/+X until end of turn, where X is the number of cards in your hand.'))).toBe(true);
    expect(isFull(creatureText('Whenever you draw a card, ~ and Goblins you control each get +X/+X, where X is the number of cards in your hand.'))).toBe(false);
    expect(isFull(creatureText('Whenever you draw a card, ~ or Goblins you control each get +X/+X until end of turn, where X is the number of cards in your hand.'))).toBe(false);
  });
});

describe('edh-players-5: "Players gain hexproof" is a restriction read relative to each player (types RestrictionDef.relativeToSubject, statics/hooks.ts#verdict)', () => {
  it('the engine advertises the form', () => {
    expect(ENGINE_CAPABILITIES.has('feature:restrict.relativeToSubject.beTargeted')).toBe(true);
  });
  it('is read with a duration and says it back; a color, shroud and no duration are other wordings', () => {
    expect(isFull(spell('Players gain hexproof until end of turn.'))).toBe(true);
    expect(isFull(spell('Players gain hexproof until your next turn.'))).toBe(true);
    expect(isFull(spell('Players gain hexproof.'))).toBe(false);
    expect(isFull(spell('Players gain shroud until end of turn.'))).toBe(false);
    expect(isFull(spell('Players gain hexproof from red until end of turn.'))).toBe(false);
  });
  it('"Players can\'t lose life this turn and players can\'t lose the game or win the game this turn" is read whole only', () => {
    expect(isFull(spell("Players can't lose life this turn and players can't lose the game or win the game this turn."))).toBe(true);
    expect(isFull(spell("Players can't lose life this turn."))).toBe(false);
    expect(isFull(spell("Players can't lose the game or win the game this turn."))).toBe(false);
  });
});

describe('edh-players-5: "unless <player> pays N life" (template eff.edhp5.payelse.life)', () => {
  it('is read for a target opponent and an opponent; "pays {N}" keeps its own template and life gained is no payment', () => {
    expect(isFull(creatureText('When this creature dies, return it to your hand unless target opponent pays 3 life.'))).toBe(true);
    expect(isFull(creatureText('When this creature dies, return it to your hand unless target opponent gains 3 life.'))).toBe(false);
    expect(isFull(creatureText('When this creature dies, return it to your hand if target opponent pays 3 life.'))).toBe(false);
  });
});
