/**
 * Lane trek, round trek-20 (Star Trek reprints that were not full): the template data of parser/templates/zz-cloud/trek-20.json and what finishes the cards around it:
 *  - "{Dur}, {Filter} can't attack you" (eff.trek20.creatures.cantAttackYou.dur.lead; Chronomantic Escape; the trailing-duration form has no real card and is not built): a lasting restriction of
 *    the creatures of every player on attacking the controller (players only, planeswalkers are not protected);
 *  - "After the second main phase this turn, there's an additional combat phase followed by an additional main phase" (eff.trek20.extraPhase.afterSecondMain.combatThenMain;
 *    World at War): `extraPhase` with `after: 'main2'` (core/turn-effects.ts: the entry waits for the postcombat main phase, and the main phase it is followed by waits for
 *    THAT combat phase), said back by render/steps-lasting.ts#extraPhase;
 *  - the two sentences of Promise of Loyalty (eff.trek20.eachPlayer.vowKeepOne.cantAttackYou, joined by parser/lower/ability.ts#joinTrek20Vow, said back by render/fold-trek20.ts);
 *  - the readings that are not templates: a bare "landwalk" in "The same is true for ..." and the variants of landwalk and protection it shares (parser/holes/misc.ts#inSameIsTrueFor,
 *    parser/lower/same-for.ts, effects/handlers/lasting.ts#expandVariants; Concerted Effort).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10). The behavior is in trek-20-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-20.json';
import review from '../../m5/golden/cards/trek-20-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 3;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** The spell ability of a sorcery. */
const parse = (text: string, type = 'Sorcery') => parseCard(card('Example Ooze', type, text), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`) || g.verified.includes(`${id})`)).map((g) => g.card);

describe('trek-20 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-20.json, in path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-20.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.trek20.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.trek20\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record, accepted by the owner on 2026-10-24 for single-printing Star Trek wordings): each wording is printed on one card, so the template is stable on one hand-verified golden card plus these tests', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(MECH.map((t) => t.id).sort());
    expect(evidence('eff.trek20.creatures.cantAttackYou.dur.lead')).toEqual(['Chronomantic Escape']);
    expect(evidence('eff.trek20.extraPhase.afterSecondMain.combatThenMain')).toEqual(['World at War']);
    expect(evidence('eff.trek20.eachPlayer.vowKeepOne.cantAttackYou')).toEqual(['Promise of Loyalty']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-20 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/can't attack you/, "can't block you"], [/can't attack you/, "can't attack target opponent"], [/until your next turn/, 'until end of turn'], [/second main phase/, 'first main phase'], [/an additional combat phase/, 'two additional combat phases'],
    [/an additional main phase/, 'an additional end step'], [/Each player puts/, 'Each opponent puts'], [/vow counter on a/, 'vow counter on up to two'], [/planeswalkers you control for/, 'planeswalkers you control until end of turn, for'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-20 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-20 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          const f = parse(mutated);
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-20 guard G2 on the whole cards: a nonsense word in any place of the cards own text never leaves them full (a counter kind is any word, so the word before "counter" is not mutated)', () => {
  const CARDS: { name: string; type: string; cost: string; text: string; pt?: [string, string] }[] = [
    { name: 'Chronomantic Escape', type: 'Sorcery', cost: '{2}{W}', text: 'Until your next turn, creatures can\'t attack you. Exile this spell with three time counters on it.' },
    { name: 'World at War', type: 'Sorcery', cost: '{2}{R}{R}', text: 'After the second main phase this turn, there\'s an additional combat phase followed by an additional main phase. At the beginning of that combat, untap all creatures that attacked this turn.' },
    { name: 'Promise of Loyalty', type: 'Sorcery', cost: '{4}{W}', text: 'Each player puts a vow counter on a creature they control and sacrifices the rest. Each of those creatures can\'t attack you or planeswalkers you control for as long as it has a vow counter on it.' },
    { name: 'Concerted Effort', type: 'Enchantment', cost: '{3}{W}', text: 'At the beginning of each upkeep, creatures you control gain flying until end of turn if a creature you control has flying. The same is true for fear, first strike, double strike, landwalk, protection, trample, and vigilance.' },
  ];
  const level = (c: (typeof CARDS)[number], text: string): { level: string; manualPart: boolean } => {
    const def = compileCard({ name: c.name, layout: 'normal', mana_cost: c.cost, type_line: c.type, oracle_text: text, colors: [], ...(c.pt ? { power: c.pt[0], toughness: c.pt[1] } : {}) } as OracleCard);
    return { level: def.automation.level, manualPart: JSON.stringify(def.faces).includes('"kind":"manual"') || JSON.stringify(def.faces).includes('"op":"manual"') };
  };
  for (const c of CARDS) {
    it(`${c.name}: as printed it is full, with no manual part; replacing any one word by an invented word is never full`, () => {
      expect(level(c, c.text)).toEqual({ level: 'full', manualPart: false });
      const words = c.text.split(' ');
      words.forEach((w, i) => {
        if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word
        const lead = w.match(/^["\n]+/)?.[0] ?? '';
        const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
        const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
        const r = level(c, mutated);
        expect(r.level === 'full' && !r.manualPart, mutated).toBe(false);
      });
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('trek-20 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
