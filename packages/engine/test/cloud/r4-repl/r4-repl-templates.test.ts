/**
 * Cloud r4-repl (Standard round 4: replacement and prevention effects): the template data of parser/templates/zz-cloud/r4-repl.json. Guard G9 (design 6.8): every
 * example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a pattern
 * spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in the other files of this folder.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r4repl from '../../../src/parser/templates/zz-cloud/r4-repl.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R4 = r4repl as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('r4-repl template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r4-repl.json, path order: after r3-repl, before std-) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r4-repl.json');
    expect(files.indexOf('zz-cloud/r4-repl.json')).toBeGreaterThan(files.indexOf('zz-cloud/r3-repl.json'));
    expect(files.indexOf('zz-cloud/r4-repl.json')).toBeLessThan(files.indexOf('zz-cloud/std-blb.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.r4repl.*', () => {
    for (const t of R4) {
      expect(t.id, t.id).toMatch(/^(rep|rid|eff|sta)\.r4repl\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of R4) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('r4-repl guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R4) {
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

describe('r4-repl guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R4) {
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

describe('r4-repl guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R4) {
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

/**
 * The real cards that print each template's sentence and read it with the template (taken from the whole-index snapshot with `npm run cards`): FULL ones are fully
 * automated; the others have a sentence another slice owns (backlog/r4-owners.md) and are checked for this template's line only.
 */
const REAL: Readonly<Record<string, { full: readonly string[]; partial?: readonly string[] }>> = {
  'rid.r4repl.instead.tokens.count': { full: ['Rite of Replication'] },
  // w8-followups: the five other cross-line cards of wave 7 (std-wave7-g10.txt section 3), golden w8-followups-review.json
  'rid.r4repl.cast.yourGraveyard.exileInstead': { full: ['Daring Waverider', 'Seifer Almasy', 'The Dawning Archaic', 'Vohar, Vodalian Desecrator', "Jace, Vryn's Prodigy // Jace, Telepath Unbound", 'Victor Timely, Wily Tycoon', 'Dreadhorde Arcanist', 'Torrential Gearhulk', 'Goblin Dark-Dwellers', 'Efreet Flamepainter'] }, // wave 7 merge: the cast sentence before it is r4-cost's; wave 8 r5-repl: Vohar and Jace after a permission (PermissionDef.graveyardInstead)
  'rid.r4repl.insteadFirst.tokens.whereX': { full: ['The Final Days'] },
  'rid.r4repl.instead.sourceYouControl.twice': { full: ['Chocobo Kick'] },
  'rid.r4repl.instead.exileTop.count': { full: ['Burning Curiosity'] },
  'eff.r4repl.search.n.bf.untapped': { full: ['Grow from the Ashes'] },
  'eff.r4repl.dig.putHand.only': { full: ['Consult the Star Charts'] },
  'eff.fxz.dig.anyNumber.bf': { full: ["Earth's Mightiest Heroes"] }, // wave 7 merge: r4-repl's eff.r4repl.dig.putAny.bf (same pattern and build) folded into r4-fxz's
  'rid.r4repl.instead.basePT.only': { full: ['Behind the Mask'] },
  'eff.r4repl.dig.putEach.hand': { full: ['Accumulate Wisdom'] },
  'rid.r4repl.ifX.orMore.insteadFront': { full: ['Finale of Revelation'] },
  'rep.r4repl.damage.double.opponentOrTheirs': { full: ['Twinflame Tyrant'] },
  'rep.r4repl.damage.source.twice': { full: ['Neriv, Heart of the Storm'] },
  'rep.r4repl.damage.plus.amountEqual.opponentOrTheirs': { full: ['Fated Firepower'] },
  'rep.r4repl.prevent.fromYourSources.toOpponent.then': { full: ['The Mindskinner'] },
  'rep.r4repl.counters.plus.byYou.eachKind': { full: ['Doc Samson, Super Psychiatrist'] },
  'rep.r4repl.dur.counters.plus.byYou.kind': { full: ['Prairie Dog'] },
  'rep.r4repl.drawMany.plus.asLongAs': { full: ['Quantum Riddler'] },
  'rep.r4repl.draw.while.skip': { full: [], partial: ['Living Conundrum'] },
  'rep.r4repl.tokens.plusOne.passive': { full: ['Case of the Pilfered Proof', 'Quina, Qu Gourmet'] },
  'rep.r4repl.tokens.typed.thatMany.other': { full: ['Draconic Visitor'] },
  'eff.r4repl.gy.cast.andExileInstead.thisTurn': { full: ['Walk-In Closet // Forgotten Cellar'] },
  'rep.r4repl.explore.scryFirst': { full: ['Twists and Turns // Mycoid Maze'] },
  'eff.r4repl.dur.prevent.toYou': { full: ["Morningtide's Light"] },
  'eff.r4repl.prevent.toYouAnd.bySources': { full: ['Eerie Interference'] },
  'eff.r4repl.thisTurn.noncombat.plus': { full: [], partial: ['Taii Wakeen, Perfect Shot'] },
  'rep.r4repl.enters.counter.forEach.diedUnderYourControl': { full: ['Callous Sell-Sword // Burn Together'] }, // std-rw9: full ("sacrifice it" never an any-target)
  'rep.r4repl.enters.counter.plusAdditional.forEach': { full: ['Sheriff of Safe Passage'] },
  'rep.r4repl.others.enter.additionalCounter.forEachAlready': { full: ['Giada, Font of Hope'] },
  'rep.r4repl.enters.chooseType.countersForEach': { full: [], partial: ['Banner of Kinship'] },
  'eff.r4repl.castSpell.entersWith.additional.forEach': { full: ['Torgal, A Fine Hound'] },
  'eff.r4repl.castSpell.entersWith.xAdditional.whereX': { full: ['Wildgrowth Archaic'] },
  'eff.r4repl.nextCast.entersWith.additional': { full: ['Summon: Fenrir'] },
  'rid.r4repl.cast.aGraveyard.exileInstead': { full: ['Quistis Trepe', 'Nita, Forum Conciliator', 'Dire Fleet Daredevil', 'Impulsivity', 'Deluxe Dragster', 'Wrexial, the Risen Deep'] }, // r5-repl: and after a permission (PermissionDef.graveyardInstead); w8-followups: the cross-line cards with r4-cost's cast
  'eff.r4repl.castSpell.exileAsItResolves': { full: [], partial: ['Lilah, Undefeated Slickshot'] },
  'sta.r4repl.duringTurn.equipped.grant': { full: ["Cloud, Planet's Champion"] }, // std-rw9: full ("that target Cloud" is the card)
};

describe.skipIf(index === null)('r4-repl design 6.10 (local index): synthetic examples, real cards', () => {
  it('no r4-repl line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = R4.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
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
  it('every template of the file has its real cards listed (or is read by none yet, listed here with the reason)', () => {
    const none: Readonly<Record<string, string>> = {
      'rid.r4repl.cast.aGraveyard.bottomInstead': "Kylox's Voltstrider: the cast sentence before it is r4-moved's",
      'eff.r4repl.castSpell.entersWith.additional': 'no Standard card prints it without "for each" (the whole index: see the snapshot)',
    };
    for (const t of R4) expect(REAL[t.id] !== undefined || none[t.id] !== undefined, t.id).toBe(true);
  });
});
