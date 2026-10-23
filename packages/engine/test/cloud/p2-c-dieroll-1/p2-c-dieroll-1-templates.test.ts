/**
 * p2-c-dieroll-1 (Phase 2 lane p2-c-dieroll): die rolls and result tables (CR 706; cites written from memory, unverified: rules/cr/ is not in cloud checkouts).
 * The template data of parser/templates/zz-cloud/p2-c-dieroll-1.json and the parser, lowering and renderer support it needed. Guard G9 (design 6.8): every
 * example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in p2-c-dieroll-1-scenarios.test.ts.
 *
 *   lower/ability.ts#rollTableAbilities, buildProgram   the result rows of an ability ("1-9 | ...") lowered after its own sentences, tagged `Unit.row` (CR 706.3a)
 *   lower/die-roll.ts#foldRollTable (conditions pass)    the rows move into the `table` of the one roll right before them; fail closed
 *   lower/anaphora.ts                                    a row's pronouns read the sentences before the table and its own row, never another row
 *   render/steps-lasting.ts#rollDie                      each row said from the state before the table; ", then roll"; "a six-sided die" (family six-sided-die)
 *   holes/event.ts, render/evt.ts                        "whenever you roll one or more dice": `dieRoll` with `batch`, one occurrence per roll instruction
 *   types/ability.ts, statics/hooks.ts, core/dice.ts     rule `diceAdvantage` (CR 706.6, 614.1a)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2cdr1 from '../../../src/parser/templates/zz-cloud/p2-c-dieroll-1.json';
import review from '../../m5/golden/cards/p2-c-dieroll-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const P2CDR1 = p2cdr1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: three or more hand-verified golden cards, or, for a wording printed on one or two cards of the tuning half ("Narrow
 * wordings", docs/CARD_AUTOMATION.md section 5), its golden card(s) plus these tests and the played scenarios (a deviation from 6.9 that the round's record names
 * for the owner: "roll a d4" is printed on 2 cards of the whole index, the dice advantage sentence on 3).
 */
const GOLDEN: Readonly<Record<string, readonly string[]>> = {
  'eff.p2cdr1.rollDie.d20': ['Hoarding Ogre', 'Contact Other Plane', 'Lightfoot Rogue', 'Chaos Channeler', 'Contraband Livestock', 'Goblin Morningstar', 'Overwhelming Encounter', 'Herald of Hadar', 'Nothic', 'Djinni Windseer', 'Sylvan Shepherd'],
  'eff.p2cdr1.rollDie.d4': ["Bucknard's Everfull Purse"],
  'sta.p2cdr1.rule.diceAdvantage': ['Pixie Guide', 'Barbarian Class'],
  // p2-c-dieroll-2: promoted on four golden cards (two needed p2-c-dieroll-2's "that much" reading of the result)
  'eff.p2cdr1.rollDie.sixSided': ['Vegetation Abomination', 'Velukan Dragon', 'Dissatisfied Customer', 'Non-Human Cannonball'],
};

/** A synthetic card in which an example is an ability of the right kind: a static ability on an artifact, an effect on a sorcery, the rest on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'static') return card('Example Relic', 'Artifact', text);
  if (t.kind === 'effect' && !/^(When|Whenever|At|\{)/.test(text)) return card('Example Edict', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('p2-c-dieroll-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-c-dieroll-1.json, after look3.json, before p2-copy-perm-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-c-dieroll-1.json');
    expect(files.indexOf('zz-cloud/p2-c-dieroll-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-c-dieroll-1.json')).toBeLessThan(files.indexOf('zz-cloud/p2-copy-perm-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.p2cdr1.* or eff.p2cdr1.*', () => {
    expect(P2CDR1.map((t) => t.id)).toEqual(['eff.p2cdr1.rollDie.d20', 'eff.p2cdr1.rollDie.d4', 'eff.p2cdr1.rollDie.d6', 'eff.p2cdr1.rollDie.sixSided', 'sta.p2cdr1.rule.diceAdvantage']);
    for (const t of P2CDR1) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.p2cdr1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
    // "roll a d6" has no golden card: experimental (design 6.9); "roll a six-sided die" was promoted by p2-c-dieroll-2 on four golden cards
    expect(P2CDR1.filter((t) => t.status === 'experimental').map((t) => t.id)).toEqual(['eff.p2cdr1.rollDie.d6']);
  });
  it('design 6.9 (narrow wordings): a stable template has its hand-verified golden card(s); the review pins every card as full', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of P2CDR1.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.slice().sort(), t.id).toEqual([...(GOLDEN[t.id] ?? [])].sort());
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of P2CDR1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'still']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-c-dieroll-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of P2CDR1) {
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const [head, ...rows] = text.split('\n');
  const body = head!.replace(/\.$/, '');
  const tail = rows.length > 0 ? `\n${rows.join('\n')}` : '';
  const out = [`${body} unless it is blue.${tail}`, `${body} instead.${tail}`, `${body} twice.${tail}`, `${body} if able.${tail}`];
  const swaps: [RegExp, string][] = [
    [/\bd20\b/, 'd12'], [/\bd4\b/, 'd8'], [/\bd6\b/, 'd10'], [/\bsix-sided\b/, 'four-sided'], [/\blowest\b/, 'highest'], [/\bplus one\b/, 'plus two'],
    [/\byou would\b/, 'a player would'], [/\bRoll a\b/, 'Roll two'], [/\broll a\b/, 'roll two'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-c-dieroll-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of P2CDR1) {
    it(`${t.id}: an appended rider or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-c-dieroll-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of P2CDR1) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        const label = words.indexOf('--'); // a flavor word before " -- " is a label (CR 207.2d): any word reads the same
        words.forEach((w, i) => {
          if (i <= label) return;
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n') || /^\d+—\d+$|^\d+$|^\|$/.test(w)) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('p2-c-dieroll-1 parser, lowering and renderer support', () => {
  const face = (type: string, text: string) => parseCard(card('Example Edict', type, text), OPTS).faces[0]!;
  const json = (type: string, text: string): string => JSON.stringify(face(type, text).abilities);
  it('CR 706.3a: the rows move into the table of the roll right before them, each with its own instructions', () => {
    const j = json('Sorcery', 'Roll a d20.\n1—12 | Draw a card.\n13—20 | Draw two cards.');
    expect(j).toContain('"op":"rollDie","who":{"ref":"you"},"sides":20,"table":[{"min":1,"max":12,"do":[{"op":"draw","who":{"ref":"you"},"count":1}]},{"min":13,"max":20,"do":[{"op":"draw","who":{"ref":"you"},"count":2}]}]');
  });
  it('CR 706.3a, fail closed: a gap, an overlap, a missing top row, an "N+" row, a table with no roll right before it, or a row read in another row keeps the ability manual', () => {
    for (const text of [
      'Roll a d20.\n1—9 | Draw a card.\n11—20 | Draw two cards.',
      'Roll a d20.\n1—10 | Draw a card.\n10—20 | Draw two cards.',
      'Roll a d20.\n1—9 | Draw a card.\n10—19 | Draw two cards.',
      'Roll a d20.\n1—14 | Draw a card.\n15+ | Draw two cards.',
      'Draw a card.\n1—9 | Draw a card.\n10—20 | Draw two cards.',
      'Roll a d20. Draw a card.\n1—9 | Draw a card.\n10—20 | Draw two cards.',
      'Roll a d20.\n1—9 | Create a 1/1 red Goblin creature token.\n10—20 | Create two of those tokens.',
    ]) expect(fullyAutomated(face('Sorcery', text)), text).toBe(false);
  });
  it('design 6.4: a row\'s pronoun reads the target before the table, not another row\'s token ("its controller" in every row is the exiled creature\'s)', () => {
    const j = json('Instant', 'Exile target creature, then roll a d20.\n1—10 | Its controller creates a 3/3 green Elk creature token.\n11—20 | Its controller creates a 1/1 white Bird creature token.');
    expect(j.match(/"who":\{"ref":"controllerOf","object":\{"ref":"target","id":"t0"\}\}/g)).toHaveLength(2);
  });
  it('CR 603.2c: "whenever you roll one or more dice" is a dieRoll batch; "whenever you roll a die" stays one trigger per die; a result read of a batch is no reading', () => {
    expect(json('Creature — Elf', 'Whenever you roll one or more dice, draw a card.')).toContain('"trigger":{"on":[{"ev":"dieRoll","player":"you"}],"batch":true}');
    expect(json('Creature — Elf', 'Whenever you roll a die, draw a card.')).toContain('"trigger":{"on":[{"ev":"dieRoll","player":"you"}]}');
    const result = compileCard(card('Example Brute', 'Creature — Elf', 'Whenever you roll one or more dice, draw cards equal to the result.', { power: '1', toughness: '1' }));
    expect(result.automation.level).not.toBe('full');
    expect(JSON.stringify(result.automation)).toContain('feature:dieResult.batch');
  });
  it('rule `diceAdvantage` is advertised (statics/hooks.ts) and the advantage of another player is no reading', () => {
    expect(ENGINE_CAPABILITIES.has('rulemod:diceAdvantage')).toBe(true);
    expect(fullyAutomated(face('Artifact', 'If a player would roll one or more dice, instead they roll that many dice plus one and ignore the lowest roll.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-c-dieroll-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-c-dieroll-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const [name, text] of [[c.name, c.oracle_text], ...(c.card_faces ?? []).map((x) => [x.name, x.oracle_text])] as [string, string | undefined][]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = P2CDR1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card reads its line with the named template, passes the exact render gate and is fully automated
  for (const [id, names] of Object.entries(GOLDEN)) {
    it(`${id}: ${names.join(', ')} read their line with it, pass the render gate and are fully automated`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const p = parseCard(c!, OPTS);
        expect(p.faces.some((f) => f.templatesUsed.includes(id)), `${name}: ${p.faces.map((f) => f.templatesUsed.join(',')).join(' | ')}`).toBe(true);
        for (const f of p.faces) {
          expect(fullyAutomated(f), `${name}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
          expect(f.gate.every((g) => g.ok), name).toBe(true);
        }
      }
    }, 60_000);
  }
});
