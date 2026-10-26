/**
 * Precon lane pc-counters, round pc-counters-3 (energy per object, half X counters, "the creature that died", counters "among" a group): the template data of
 * parser/templates/zz-cloud/pc-counters-3.json, the quantity readings of parser/holes/pccounters3.ts and parser/holes/qty.ts, and the renderer readings
 * (render/steps-life.ts, render/qty.ts). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves
 * an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in pc-counters-3-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/pc-counters-3.json';
import review from '../../m5/golden/cards/pc-counters-3-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 3;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A spell: the sentences of a sorcery. */
const parse = (text: string, type = 'Sorcery', pt?: { power: string; toughness: string }) => parseCard(card('Example Ooze', type, text, { ...(pt ?? {}), mana_cost: '{X}' }), OPTS).faces[0]!;
/** Fully automated, and no cost part the model cannot state. */
const fully = (f: ReturnType<typeof parse>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);
/** The type line an example needs: a trigger or a static ability goes on a permanent, an effect on a spell. */
const typeOf = (t: Template): string => (t.kind === 'effect' ? 'Sorcery' : /^equipped/i.test(t.examples[0]!.text) ? 'Artifact — Equipment' : /^enchanted/i.test(t.examples[0]!.text) ? 'Enchantment — Aura' : 'Artifact');

describe('pc-counters-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/pc-counters-3.json, after p2-zone-moves-1, before r3-choose) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/pc-counters-3.json');
    expect(files.indexOf('zz-cloud/pc-counters-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    expect(files.indexOf('zz-cloud/pc-counters-3.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.pcc3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff)\.pcc3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): each stable template is stable on one hand-verified golden card (energy.forEach: Aetherwind Basker, also printed on Sentry Bot; halfX.up: Contaminated Drink); halfX.down has no card and is experimental (the precon decks hold the others)', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(['eff.pcc3.counters.player.halfX.up', 'eff.pcc3.energy.forEach']);
    expect(MECH.filter((x) => x.status === 'experimental').map((t) => t.id)).toEqual(['eff.pcc3.counters.player.halfX.down']);
    expect(evidence('eff.pcc3.energy.forEach')).toEqual(['Aetherwind Basker', 'Sentry Bot']);
    expect(evidence('eff.pcc3.counters.player.halfX.up')).toEqual(['Contaminated Drink']);
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

describe('pc-counters-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const type = typeOf(t);
      const first = parse(t.examples[0]!.text, type);
      for (const e of t.examples) {
        const f = parse(e.text, type);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c, type);
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
    [/\brounded up\b/, 'rounded down'], [/\bhalf X\b/, 'half Y'], [/\bfor each\b/, 'for every'], [/\bTarget player\b/, 'Target creature'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('pc-counters-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      const type = typeOf(t);
      for (const e of t.examples) {
        const orig = parse(e.text, type);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m, type);
          const same = automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities);
          // "Enchanted" and "Equipped" are one reading of the attached-creature templates (both give attachedTo): not a near miss there
          if (/^(Enchanted|Equipped)/.test(e.text) && m.replace(/^(Enchanted|Equipped)/, '') === e.text.replace(/^(Enchanted|Equipped)/, '')) continue;
          expect(same, m).toBe(false);
        }
      }
    });
  }
});

describe('pc-counters-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      const type = typeOf(t);
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          // the word before "counter(s)" is a counter kind, and any word is one (an unlisted kind is a weak reading of the CounterKind hole: "a blorfty counter" is a counter kind)
          if (/^counters?\b/.test(words[i + 1] ?? '')) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated, type)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('pc-counters-3 lowering and holes: the readings that are no template of their own', () => {
  it('CR 603.10a, 700.4: "the power / toughness / mana value of the creature that died" is the statistic of the dies trigger\'s creature (last known information); only in a dies trigger', () => {
    for (const stat of ['power', 'toughness']) {
      const f = parse(`Whenever a creature you control dies, you gain life equal to the ${stat} of the creature that died.`, 'Enchantment');
      expect(fully(f), JSON.stringify(f.diagnostics)).toBe(true);
      expect(JSON.stringify(f.abilities)).toContain(`"q":"stat","stat":"${stat}","of":{"ref":"event","role":"subject"}`);
    }
    const x = parse('Whenever a creature you control dies, put X +1/+1 counters on target creature you control, where X is the power of the creature that died.', 'Enchantment');
    expect(fully(x), JSON.stringify(x.diagnostics)).toBe(true);
    // not outside a dies trigger, and not of another creature
    expect(fully(parse('Whenever a creature you control enters, you gain life equal to the power of the creature that died.', 'Enchantment'))).toBe(false);
    expect(fully(parse('You gain life equal to the power of the creature that died.'))).toBe(false);
    expect(fully(parse('Whenever a creature you control dies, you gain life equal to the power of the creature that attacked.', 'Enchantment'))).toBe(false);
  });
  it('CR 122.1: "the number of counters among creatures you control" is the same sum as "on creatures you control" (and kinds); "among" a single object is no reading', () => {
    const a = parse('You gain life equal to the number of +1/+1 counters among creatures you control.');
    const o = parse('You gain life equal to the number of +1/+1 counters on creatures you control.');
    expect(fully(a), JSON.stringify(a.diagnostics)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(o.abilities));
    expect(fully(parse('You gain life equal to the number of counters among target creature.'))).toBe(false);
  });
  it('CR 107.14, 122.1: five or more fixed energy counters are also said with a number word, "you get six {E}"; fewer stay as symbols', () => {
    const f = parse('When this creature enters, you get six {E}.', 'Creature — Elf', { power: '1', toughness: '1' });
    expect(fully(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"kind":"energy","count":6');
    expect(fully(parse('When this creature enters, you get {E}{E}.', 'Creature — Elf', { power: '1', toughness: '1' }))).toBe(true);
    expect(fully(parse('When this creature enters, you get two {E}.', 'Creature — Elf', { power: '1', toughness: '1' }))).toBe(false); // Oracle writes small amounts with symbols
  });
});

const index = localIndex();

describe.skipIf(index === null)('pc-counters-3 design 6.10 (local index): synthetic examples', () => {
  it('no pc-counters-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
