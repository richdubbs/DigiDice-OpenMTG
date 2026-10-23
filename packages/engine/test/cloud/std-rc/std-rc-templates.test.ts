/**
 * Standard round C (std-rc): the template data of parser/templates/zz-cloud/std-rc.json ("This ability costs {X} less to activate, where X is <a quantity>",
 * CR 602.2b, 601.2f, 107.3) and the renderer reading it needed (render/abil.ts#withRestrictions, family ability-cost-where-x); the Qty reading "<creatures> that
 * died / were exiled under <your | your opponents' | an opponent's> control this turn" (parser/holes/qty.ts#historyCounts, render/qty.ts#happened, family
 * exiled-under-control). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate
 * (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example
 * never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rc-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRc from '../../../src/parser/templates/zz-cloud/std-rc.json';
import review from '../../m5/golden/cards/cloud-std-rc-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { renderGate } from '../../../src/index';

const MECH = stdRc as Template[];
const MECH_COUNT = 1;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic creature with the example as its activated ability. */
const exampleCard = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const parsed = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('std-rc template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rc.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rc.json');
    expect(files.indexOf('zz-cloud/std-rc.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rc.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    // path order, as the template files are read from disk ('std-rc' sorts after 'std-r9' and 'std-r9b', before 'std-sos')
    expect(files.indexOf('zz-cloud/std-rc.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-r9.json'));
    expect(files.indexOf('zz-cloud/std-rc.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-r9b.json'));
    expect(files.indexOf('zz-cloud/std-sos.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rc.json')); // (the std-re, std-rm, std-rn, std-ro and std-rp files sort between them)
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrc.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdrc\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  // design 6.9: three golden cards; the narrow wording "This ability costs {X} less to activate, where X is ..." is printed on four cards (one held out and not
  // Standard, one needing control of another player's turn) and is stable on its two golden cards plus the scenarios, a 6.9 deviation named in the round's record
  const NARROW: Record<string, number> = { 'eff.stdrc.cost.ability.less.whereX': 2 };
  it('design 6.9: a stable template has three hand-verified golden cards of the tuning half or Standard that use it (a named narrow wording: its golden cards)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(NARROW[t.id] ?? 3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
});

describe('std-rc guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example line (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} during your turn.`, `${body} unless it is blue.`, `${body} twice.`, `${body} for each opponent.`];
  const swaps: [RegExp, string][] = [
    [/ less to activate/, ' more to activate'], [/ to activate/, ' to cast'], [/costs \{X\}/, 'costs {1}'], [/ you control\.$/, ' your opponents control.'], [/ the number of /, ' twice the number of '],
    [/^(\w+) from (\w+)/, '$1 from non$2'], [/ from (\w+)$/, ' from all $1'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rc guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended condition or count, or a swapped key word ("more", "cast", "{1}", "your opponents", "twice") never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsed(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rc guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || /^\{/.test(w)) return; // a cost symbol or the card's own name is no English word
          const mutated = [...words.slice(0, i), 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsed(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rc design 6.10 (local index): synthetic examples', () => {
  it('no std-rc line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replace(/\s*\([^)]*\)\s*$/, '').trim()); // the same line without its reminder text
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- the renderer reading (family ability-cost-where-x) -----------------------------------------------------------------------------------------------------

describe('std-rc renderer (CR 602.2b, 601.2f, 107.3): an activated ability\'s own reduction of one per counted object reads "{X} ..., where X is the number of ..."', () => {
  const RCTX = { selfNames: ['Test Card'], selfTypes: ['Artifact'] };
  const ability = (generic: unknown, mana: unknown[] = []) => ({
    kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 8 }], tap: true }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] },
    costChange: { kind: 'reduce', generic, ...(mana.length > 0 ? { mana } : {}), floor: 'zero' },
  }) as never;
  const artifacts = { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } };
  it('both wordings of a count are accepted', () => {
    expect(renderGate(ability(artifacts), ['{8}, {T}: Draw a card. This ability costs {X} less to activate, where X is the number of artifacts you control.'], RCTX).ok).toBe(true);
    expect(renderGate(ability(artifacts), ['{8}, {T}: Draw a card. This ability costs {1} less to activate for each artifact you control.'], RCTX).ok).toBe(true);
  });
  it('a quantity that is not a count keeps its one "where X" wording; twice a count is not "the number of"', () => {
    const greatest = { q: 'stat', stat: 'power', agg: 'max', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } };
    expect(renderGate(ability(greatest), ['{8}, {T}: Draw a card. This ability costs {X} less to activate, where X is the greatest power among creatures you control.'], RCTX).ok).toBe(true);
    const twice = { q: 'math', op: '*', args: [2, artifacts] };
    expect(renderGate(ability(twice), ['{8}, {T}: Draw a card. This ability costs {X} less to activate, where X is the number of artifacts you control.'], RCTX).ok).toBe(false);
  });
});

// ---- the Qty reading "that died / were exiled under <player's> control this turn" (parser/holes/qty.ts#historyCounts) ---------------------------------------

describe('std-rc Qty (CR 700.4, 406.1, 603.10a): "the number of creatures that died / were exiled under <player\'s> control this turn"', () => {
  const sorcery = (text: string) => parseCard(card('Example Tally', 'Sorcery', text), OPTS).faces[0]!;
  const countOf = (text: string): unknown => {
    const f = sorcery(text);
    expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
    return (f.abilities[0] as { effect: { steps: { count: unknown }[] } }).effect.steps[0]!.count;
  };
  const hc = (controller: string, to: string) => ({ q: 'happenedCount', event: { ev: 'zoneChange', subject: { types: ['Creature'], controller }, from: 'battlefield', to }, scope: 'turn' });
  it('the zone changes of the turn from the battlefield, the controller as the creature last existed there', () => {
    expect(countOf("Draw X cards, where X is the number of creatures that were exiled under your opponents' control this turn.")).toEqual(hc('opponent', 'exile'));
    expect(countOf("Draw X cards, where X is the number of creatures that were exiled under an opponent's control this turn.")).toEqual(hc('opponent', 'exile'));
    expect(countOf('Draw X cards, where X is the number of creatures that were exiled under your control this turn.')).toEqual(hc('you', 'exile'));
    expect(countOf("Draw X cards, where X is the number of creatures that died under your opponents' control this turn.")).toEqual(hc('opponent', 'graveyard'));
    expect(countOf('Draw X cards, where X is the number of creatures that died under your control this turn.')).toEqual(hc('you', 'graveyard'));
  });
  it('design 6.3 rule 2 (weak): the fixed "for each creature that died under your control this turn" template keeps its sentence', () => {
    const f = sorcery('Draw a card for each creature that died under your control this turn.');
    expect(f.templatesUsed).toContain('eff.r4static.draw.forEachDiedUnderYourControl');
  });
  it('fail closed: a card filter, a zone or a controller of its own, another verb or another time is not read', () => {
    for (const x of [
      "Draw X cards, where X is the number of creature cards that were exiled under your opponents' control this turn.",
      "Draw X cards, where X is the number of creatures you control that were exiled under your opponents' control this turn.",
      "Draw X cards, where X is the number of creatures that were exiled under your opponents' control last turn.",
      "Draw X cards, where X is the number of creatures that were blorfted under your opponents' control this turn.",
      "Draw X cards, where X is the number of creatures that were exiled under target player's control this turn.",
    ]) expect(fullyAutomated(sorcery(x)), x).toBe(false);
  });
});
