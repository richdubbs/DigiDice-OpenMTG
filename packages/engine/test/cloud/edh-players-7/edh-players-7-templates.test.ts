/**
 * edh-players-7 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-7.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-7-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp7 from '../../../src/parser/templates/zz-cloud/edh-players-7.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP7 = edhp7 as Template[];
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

describe('edh-players-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-7.json, path order: after edh-players-5, before edh-replace-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-7.json');
    expect(files.indexOf('zz-cloud/edh-players-7.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-5.json'));
    expect(files.indexOf('zz-cloud/edh-players-7.json')).toBeLessThan(files.indexOf('zz-cloud/edh-replace-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp7.*', () => {
    for (const t of EP7) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp7\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP7) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-7 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP7) {
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

describe('edh-players-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP7) {
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

describe('edh-players-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP7) {
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
  'eff.edhp7.player.scries.thenDraws': { full: ["Kozilek's Command"] },
  'eff.edhp7.choose.nCards.handDrawnThisTurn': { full: ['Sylvan Library'] },
  'eff.edhp7.forEach.chosen.payLifeOrPutTop': { full: ['Sylvan Library'] },
  'eff.edhp7.objs.lose.two.cantHave.two': { full: ['Arcane Lighthouse'] },
};

describe.skipIf(index === null)('edh-players-7 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP7.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP7) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});

// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const creatureText = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const enchantText = (text: string): OracleCard => card('Example Hymn', 'Enchantment', text);
const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-7: "for each other attacking creature that shares a creature type with it" in the attack trigger of another creature (parser/lower/targets.ts#otherNotSource; templates eff.t9.pump.foreach.other.*)', () => {
  const ATTACK = 'Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it.';
  it('an enchantment reads "other" as other than the attacker (CR 508.1, 109.2) and says it back', () => {
    expect(isFull(enchantText(ATTACK))).toBe(true);
  });
  it('the other pump values keep the shared quality too', () => {
    expect(isFull(enchantText('Whenever a creature you control attacks, it gets +2/+2 until end of turn for each other attacking creature that shares a creature type with it.'))).toBe(true);
  });
  it('a batch trigger has no single attacker for "other" to leave out, and a group that is not attacking is no reading of it', () => {
    expect(isFull(enchantText('Whenever you attack with two or more creatures, target creature you control gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it.'))).toBe(false);
    expect(isFull(enchantText('Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other creature you control that shares a creature type with it.'))).toBe(false);
  });
  it('a shared color is kept the same way, and a trailing "unless" is not read', () => {
    expect(isFull(enchantText('Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a color with it.'))).toBe(true);
    expect(isFull(enchantText('Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it unless it is blue.'))).toBe(false);
  });
});

describe('edh-players-7: "each creature other than ~" after a sentence that named the group (parser/lower/anaphora.ts#explicitOtherThanSelf; render/np.ts, CR 109.2, 608.2h)', () => {
  const HEAD = 'When ~ enters, each other creature gets -1/-1 until end of turn. ';
  it('is read and said back when the source is named outright', () => {
    expect(isFull(creatureText(`${HEAD}Whenever a creature dies this turn, each creature other than ~ gets -1/-1 until end of turn.`))).toBe(true);
  });
  it('a bare "each other creature" in the second sentence after a sentence that names only an "other" group is other than ~ too (edh-next-31: anaphoricOther exempts an earlier "other" group, CR 109.2, 608.2c; before, two candidates, not read)', () => {
    expect(isFull(creatureText(`${HEAD}Whenever a creature dies this turn, each other creature gets -1/-1 until end of turn.`))).toBe(true);
  });
  it('"other than" something else is not "other than ~"', () => {
    expect(isFull(creatureText(`${HEAD}Whenever a creature dies this turn, each creature other than target creature gets -1/-1 until end of turn.`))).toBe(false);
  });
});

describe('edh-players-7: "if you didn\'t cast it from your hand" of the creature that entered is "it", never "~" (render/cond.ts#isEventSubject; CR 601.2a, 603.4)', () => {
  it('is read in both polarities with an effect that says "it" back', () => {
    expect(isFull(creatureText("Whenever a nontoken creature you control enters, if you didn't cast it from your hand, it gains haste until your next turn."))).toBe(true);
    expect(isFull(creatureText('Whenever a nontoken creature you control enters, if you cast it from your hand, it gains haste until end of turn.'))).toBe(true);
  });
  it('another zone, another player and a bare "if it was cast" are other conditions', () => {
    expect(isFull(creatureText("Whenever a nontoken creature you control enters, if you didn't cast it from your graveyard, it gains haste until end of turn."))).toBe(false);
    expect(isFull(creatureText("Whenever a nontoken creature you control enters, if an opponent didn't cast it from your hand, it gains haste until end of turn."))).toBe(false);
  });
  it('the creature\'s own enters trigger is unchanged', () => {
    expect(isFull(creatureText("When ~ enters, if you didn't cast it from your hand, draw a card."))).toBe(true);
  });
});

describe('edh-players-7: "add {R} for each 1 life your opponents have lost this turn" (render/steps-cards.ts, family of the mana "for each"; CR 119.3, 106.4)', () => {
  it('is read and said back', () => {
    expect(isFull(creatureText('At the beginning of each of your postcombat main phases, add {R} for each 1 life your opponents have lost this turn.'))).toBe(true);
  });
  it('life you lost, damage and a count of cards are other quantities', () => {
    expect(isFull(creatureText('At the beginning of each of your postcombat main phases, add {R} for each 1 life you have lost this turn.'))).toBe(false);
    expect(isFull(creatureText('At the beginning of each of your postcombat main phases, add {R} for each 2 life your opponents have lost this turn.'))).toBe(false);
  });
});

describe('edh-players-7: "cards in your hand drawn this turn" (ObjectFilter.drawnThisTurn; rules/filter.ts, render/np.ts; CR 121.1, 400.7)', () => {
  it('the engine advertises the filter field', () => {
    expect(ENGINE_CAPABILITIES.has('filter:drawnThisTurn')).toBe(true);
  });
  it('is chosen from and said back; a graveyard, "up to" and another player\'s hand are other wordings', () => {
    expect(isFull(creatureText('At the beginning of your upkeep, choose two cards in your hand drawn this turn. For each of those cards, pay 2 life or put the card on top of your library.'))).toBe(true);
    expect(isFull(creatureText('At the beginning of your upkeep, choose up to two cards in your hand drawn this turn. For each of those cards, pay 2 life or put the card on top of your library.'))).toBe(false);
    expect(isFull(creatureText("At the beginning of your upkeep, choose two cards in target opponent's hand drawn this turn. For each of those cards, pay 2 life or put the card on top of your library."))).toBe(false);
  });
  it('"pay N life or put the card on the bottom" and an opponent paying are other effects', () => {
    expect(isFull(creatureText('At the beginning of your upkeep, choose two cards in your hand drawn this turn. For each of those cards, pay 2 life or put the card on the bottom of your library.'))).toBe(false);
    expect(isFull(creatureText('At the beginning of your upkeep, choose two cards in your hand drawn this turn. For each of those cards, target opponent pays 2 life or you put the card on top of your library.'))).toBe(false);
  });
});

describe('edh-players-7: "creatures lose K and K and can\'t have K or K" said either way (render/mods.ts, family cant-have-or-gain; CR 613.1f)', () => {
  it('is read with the duration first and with the long wording; one keyword in the second half is not this reading', () => {
    expect(isFull(creatureText('{1}, {T}: Until end of turn, creatures your opponents control lose flying and menace and can\'t have flying or menace.'))).toBe(true);
    expect(isFull(creatureText('{1}, {T}: Until end of turn, creatures your opponents control lose flying and menace and can\'t have flying.'))).toBe(false);
  });
});
