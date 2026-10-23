/**
 * CLOUD std-mkm (the Standard backlog of Murders at Karlov Manor, tuning half): the template data of parser/templates/zz-cloud/std-mkm.json and the promotion of
 * eff.m6.turnFaceUp (zz-m6/face.json): "Sacrifice it at the beginning of your next end step", "Target player gains 2 life and draws a card", "~ loses defender and
 * gains vigilance until end of turn", "Equipped creature gets +1/+2, has reach, and can't be blocked by more than one creature", the no-longer-suspected sentences
 * and "can't become suspected", "investigate for each opponent who lost life this turn", "attacks or blocks this turn if able", "You may turn a creature you
 * control face up", "Until end of turn, you don't lose this mana as steps and phases end", the per-player punishers "each opponent loses 3 life unless they
 * discard a card or sacrifice a creature", Case of the Gorgon's Kiss's solved type change and Frantic Scapegoat's "you may suspect one of the other creatures".
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the std-mkm templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdMkm from '../../../src/parser/templates/zz-cloud/std-mkm.json';
import review from '../../m5/golden/cards/cloud-std-mkm-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const STD_MKM = stdMkm as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence only a few real cards print, every one of them (the regular
 * expression finds the line in the index; each card it finds has a golden entry citing the template). `readOnly`: a card of the corpus whose line the template
 * reads (checked below on the real card) but whose ability the golden harness cannot hold, named here with the reason.
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp; readOnly?: Readonly<Record<string, string>> }>> = {
  'eff.stdmkm.lose.gain.trail': { cards: ['Jaded Analyst'], line: /\bloses [a-z ]+ and gains [a-z ]+ until end of turn\./ },
  'sta.stdmkm.pump.has.blocked.max.one': { cards: ['Rope'], line: /gets [+-]\d+\/[+-]\d+, has [a-z ]+, and can't be blocked by more than one creature/ },
  'eff.stdmkm.ifsuspected.nolonger.it': { cards: ['Airtight Alibi'], line: /If it's suspected, it's no longer suspected/ },
  'eff.stdmkm.ifanysuspected.nolonger.they': { cards: ['Eliminate the Impossible'], line: /If any of them are suspected, they're no longer suspected/ },
  'sta.stdmkm.pump.cantbesuspected': { cards: ['Airtight Alibi'], line: /gets [+-]\d+\/[+-]\d+ and can't become suspected/ },
  'eff.stdmkm.investigate.foreach.lostlife': { cards: ['Teysa, Opulent Oligarch'], line: /investigate for each opponent who lost life this turn/i },
  'eff.stdmkm.must.attack.or.block': { cards: ['Hustle // Bustle', 'Boros Battleshaper'], line: /attacks or blocks this (turn|combat) if able/ },
  'eff.stdmkm.turn.chosen.faceup': {
    cards: ['Hustle // Bustle', "Ugin's Mastery"],
    line: /you may turn an? [a-z -]+ you control face up\./i,
    readOnly: { 'Zimone, Mystery Unraveler': 'the "X if C. Otherwise, Y." pair is one if/else step; the parse masks two sentences, which no golden step can stand for (harness rule: a mask is one or more elements)' },
  },
  'eff.stdmkm.each.opponent.loselife.unless.discard.or.sacrifice': { cards: ['Polygraph Orb'], line: /each opponent loses \w+ life unless they discard a card or sacrifice/i },
  'eff.stdmkm.each.player.loselife.unless.they': { cards: ['Bellowing Mauler'], line: /each player loses \w+ life unless they/i },
  'sta.stdmkm.self.is.sized.subtype.creature.with.inaddition': { cards: ["Case of the Gorgon's Kiss"], line: /is an? \d+\/\d+ [A-Z][a-z]+ creature with [^.]+ in addition to its other types/ },
  'eff.stdmkm.may.suspect.one.of.group': { cards: ['Frantic Scapegoat'], line: /you may suspect one of/i },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a std-mkm example is an ability of the right kind (a trigger is a creature's, an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text) || /^\{/.test(text) || /^solved --/i.test(text)) {
    if (/^solved --/i.test(text)) return card('Example Case', 'Enchantment — Case', `When this Case enters, you gain 1 life.\nTo solve -- You have 30 or more life.\n${text}`);
    return card('Example Brute', 'Creature — Elf Warrior', text);
  }
  const aura = /^enchanted (\w+)/i.exec(text);
  if (aura) return card('Example Charm', 'Enchantment — Aura', `Enchant ${aura[1]!.toLowerCase()}\n${text}`);
  if (/^equipped /i.test(text)) return card('Example Blade', 'Artifact — Equipment', `${text}\nEquip {2}`);
  if (/^~ is /i.test(text)) return card('Example Idol', 'Artifact', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;
/** `fullyAutomated`, and no manual ability nested in another (a Case's solved abilities, CR 719.3b), where `automated` does not look. */
const fullyAutomatedDeep = (f: ReturnType<typeof parsedWith>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');

describe('std-mkm template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-mkm.json, path order: before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-mkm.json');
    expect(files.indexOf('zz-cloud/std-mkm.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-mkm.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(STD_MKM.length).toBe(16);
    for (const t of STD_MKM) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid)\.stdmkm\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
    // the general "each opponent loses N life unless they <cost>" waits for golden cards: every index card with it is partial for another reason
    expect(STD_MKM.filter((t) => t.status === 'experimental').map((t) => t.id)).toEqual(['eff.stdmkm.each.opponent.loselife.unless.they']);
  });
  it('design 6.9: a stable std-mkm template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of STD_MKM.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => new RegExp(`\\([^)]*${t.id.replace(/\./g, '\\.')}[^)]*\\)`).test(g.verified)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.verified, g.card).toMatch(/CR \d{3}/);
  });
  it('design 6.9: eff.m6.turnFaceUp (zz-m6/face.json) is promoted with three hand-verified golden cards, each pinned full', () => {
    expect(TEMPLATE_SET.find((t) => t.id === 'eff.m6.turnFaceUp')?.status).toBe('stable');
    const golden = (review as { card: string; verified: string; expect?: string }[]).filter((g) => g.verified.includes('(eff.m6.turnFaceUp)'));
    expect(golden.map((g) => g.card).sort()).toEqual(['Break Open', 'Expose the Culprit', 'Ixidor, Reality Sculptor']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of STD_MKM) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      // a word is consumed alone or inside a consumed phrase ("if able", design 6.8 G3 reads phrases: parser/lower/units.ts#criticalWordProblem)
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('std-mkm guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of STD_MKM) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        if (t.status === 'stable') expect(fullyAutomatedDeep(f), `${e.text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/your next end step/, 'your next upkeep'], [/gains? (\d+) life/, 'loses $1 life'], [/draws? two cards/, 'discards two cards'], [/loses defender/, 'gains defender'],
    [/can't be blocked by more than one creature/, "can't be blocked by more than two creatures"], [/no longer suspected/, 'suspected'], [/can't become suspected/, "can't become tapped"],
    [/lost life/, 'gained life'], [/attacks or blocks/, 'attacks and blocks'], [/face up/, 'face down'], [/until end of turn, you don't lose/i, "Until end of combat, you don't lose"],
    [/unless they/, 'unless you'], [/discard a card or sacrifice/, 'discard a card and sacrifice'], [/in addition to its other types/, 'in addition to its other colors'],
    [/suspect one of/, 'suspect two of'], [/If any of them/, 'If all of them'], [/If it's suspected/, "If it's tapped"],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('std-mkm guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of STD_MKM) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-mkm guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of STD_MKM) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '--' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomatedDeep(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-mkm design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no std-mkm line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Case)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = STD_MKM.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].flatMap((x) => x.split('\n')).filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards, ...Object.keys(w.readOnly ?? {})].sort());
    }
  }, 120_000);

  // the try step on real cards: each card's line is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.stdmkm.delay.yournextend.tail': ['Harried Dronesmith', 'Greasefang, Okiba Boss', 'Stone Idol Trap'],
    'eff.stdmkm.gainlife.draw': ['Cease // Desist', 'Kiss of the Amesha', 'Everything Pizza'],
    'eff.stdmkm.lose.gain.trail': ['Jaded Analyst'],
    'sta.stdmkm.pump.has.blocked.max.one': ['Rope'],
    'eff.stdmkm.ifsuspected.nolonger.it': ['Airtight Alibi'],
    'eff.stdmkm.ifanysuspected.nolonger.they': ['Eliminate the Impossible'],
    'sta.stdmkm.pump.cantbesuspected': ['Airtight Alibi'],
    'eff.stdmkm.investigate.foreach.lostlife': ['Teysa, Opulent Oligarch'],
    'eff.stdmkm.must.attack.or.block': ['Hustle // Bustle', 'Boros Battleshaper'],
    'eff.stdmkm.turn.chosen.faceup': ['Hustle // Bustle', "Ugin's Mastery", 'Zimone, Mystery Unraveler'],
    'rid.stdmkm.mana.keep.endofturn': ['Branch of Vitu-Ghazi', 'Brazen Collector', 'Savage Ventmaw'],
    'eff.stdmkm.each.opponent.loselife.unless.discard.or.sacrifice': ['Polygraph Orb'],
    'eff.stdmkm.each.player.loselife.unless.they': ['Bellowing Mauler'],
    'sta.stdmkm.self.is.sized.subtype.creature.with.inaddition': ["Case of the Gorgon's Kiss"],
    'eff.stdmkm.may.suspect.one.of.group': ['Frantic Scapegoat'],
    'eff.m6.turnFaceUp': ['Expose the Culprit', 'Ixidor, Reality Sculptor', 'Break Open'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it and pass the render gate`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        compileCard(oracle!);
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
  it('the std-mkm cards this work made fully automated stay so (the backlog slice, design 6.12 tuning half)', () => {
    const FULL = ['Harried Dronesmith', 'Cease // Desist', 'Jaded Analyst', 'Rope', 'Expose the Culprit', 'Aurelia, the Law Above', 'Innocent Bystander', 'Eliminate the Impossible',
      'Airtight Alibi', 'Teysa, Opulent Oligarch', 'Treacherous Greed', 'Hustle // Bustle', 'Branch of Vitu-Ghazi', 'Polygraph Orb', "Case of the Gorgon's Kiss",
      'Audience with Trostani', 'Frantic Scapegoat'];
    for (const name of FULL) {
      const oracle = (index ?? []).find((c) => c.name === name);
      expect(oracle, name).toBeDefined();
      expect(compileCard(oracle!).automation.level, name).toBe('full');
    }
  }, 120_000);
});
