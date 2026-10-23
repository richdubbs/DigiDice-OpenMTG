/**
 * Standard round 10 (std-r10): the template data of parser/templates/zz-cloud/std-r10.json ("the next spell you cast this turn can't be countered", op
 * nextSpell) and the engine, capability and renderer support it needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes
 * the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of
 * any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 * The behavior is in std-r10-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdR10 from '../../../src/parser/templates/zz-cloud/std-r10.json';
import review from '../../m5/golden/cards/cloud-std-r10-review.json';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import { renderAbility, renderGate } from '../../../src/index';
import { NEXT_SPELL_FILTER_FIELDS, nextSpellFilterOk } from '../../../src/effects/handlers/next-spell';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdR10 as Template[];
const MECH_COUNT = 1;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-r10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-r10.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-r10.json');
    expect(files.indexOf('zz-cloud/std-r10.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-r10.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdr10.* or sta.stdr10.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdr10\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards of the tuning half that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-r10 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'], [/\beach\b/, 'all'], [/\bget\b/, 'gain'], [/\bgain\b/, 'lose'], [/\bhas\b/, 'loses'],
    [/\bDuring your turn\b/, 'During your end step'], [/\bflash\b/, 'haste'], [/\bits owner's control\b/, 'your control'], [/\binto your hand\b/, 'onto the battlefield'],
    [/\bmilled this way\b/, 'discarded this way'], [/\bloses all abilities\b/, 'loses flying'], [/\bmana cost\b/, 'power'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-r10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-r10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        const labelEnd = words.indexOf('--'); // a flavor word before "--" has no rules meaning (CR 207.2d): any words may stand there
        words.forEach((w, i) => {
          if (i <= labelEnd) return;
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole), as wp22-mutation.test.ts
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-r10 design 6.10 (local index): synthetic examples', () => {
  it('no std-r10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- the op, its capability and its renderer ---------------------------------------------------------------------------------------------------------------

const spellOf = (filter?: Record<string, unknown>) => ({
  kind: 'spell', effect: { targets: [], steps: [{ op: 'nextSpell', who: { ref: 'you' }, ...(filter ? { filter } : {}), rider: 'cantBeCountered' }] },
}) as never;
const RCTX = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };

describe('std-r10 renderer (CR 601.2i, 611.2): `nextSpell` prints its Oracle wording and the gate accepts exactly that wording', () => {
  const cases: [Record<string, unknown> | undefined, string][] = [
    [undefined, "The next spell you cast this turn can't be countered."],
    [{ stackKind: 'spell', zone: 'stack' }, "The next spell you cast this turn can't be countered."],
    [{ types: ['Creature'], stackKind: 'spell', zone: 'stack' }, "The next creature spell you cast this turn can't be countered."],
    [{ types: ['Instant', 'Sorcery'], stackKind: 'spell', zone: 'stack' }, "The next instant or sorcery spell you cast this turn can't be countered."],
    [{ notTypes: ['Creature'], stackKind: 'spell', zone: 'stack' }, "The next noncreature spell you cast this turn can't be countered."],
  ];
  it.each(cases)('%j', (filter, expected) => {
    const def = spellOf(filter);
    expect(renderAbility(def, RCTX).join(' ')).toBe(expected);
    expect(renderGate(def, [expected], RCTX).ok).toBe(true);
    expect(renderGate(def, [expected.replace(' this turn', '')], RCTX).ok).toBe(false);
  });
  it('another player\'s next spell has no renderer (the template only reads "you")', () => {
    const def = { kind: 'spell', effect: { targets: [], steps: [{ op: 'nextSpell', who: { ref: 'opponent' }, rider: 'cantBeCountered' }] } } as never;
    expect(renderGate(def, ["The next spell an opponent casts this turn can't be countered."], RCTX).ok).toBe(false);
  });
});

describe('std-r10 capability (design 5.2, fail closed): a `nextSpell` filter may describe only the spell itself', () => {
  it('op:nextSpell is an engine capability', () => {
    expect(ENGINE_CAPABILITIES.has('op:nextSpell')).toBe(true);
  });
  it('a filter of what the spell is needs nothing else; a filter of other fields needs feature:nextSpell.filter, which nothing registers', () => {
    expect(capabilitiesOfDef(spellOf({ types: ['Creature'], stackKind: 'spell', zone: 'stack' }))).not.toContain('feature:nextSpell.filter');
    for (const bad of [{ controller: 'you' }, { power: { op: '>=', value: 4 } }, { zone: 'graveyard' }, { other: true }, { anyOf: [{ types: ['Creature'] }, { tapped: true }] }]) {
      expect(capabilitiesOfDef(spellOf(bad)), JSON.stringify(bad)).toContain('feature:nextSpell.filter');
      expect(nextSpellFilterOk(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(ENGINE_CAPABILITIES.has('feature:nextSpell.filter')).toBe(false);
  });
  it('the handler\'s field list and the walker\'s agree (the walker imports no handler, design 5.4)', () => {
    for (const k of NEXT_SPELL_FILTER_FIELDS) {
      const v = k === 'zone' ? 'stack' : k === 'stackKind' ? 'spell' : k === 'anyOf' ? [{ types: ['Creature'] }] : ['X'];
      expect(capabilitiesOfDef(spellOf({ [k]: v })), k).not.toContain('feature:nextSpell.filter');
      expect(nextSpellFilterOk({ [k]: v }), k).toBe(true);
    }
  });
});

// ---- the "for each" readings of a count of what a target player controls (render/qty.ts#countParts, render/steps-util.ts#perForms) --------------------------

describe('std-r10 renderer (CR 115.1, 608.2c): "for each <X> target player controls" names the target there for the first time', () => {
  const t0 = (opp: boolean) => ({ id: 't0', kind: 'player', min: 1, max: 1, ...(opp ? { players: { who: 'opponent' } } : {}) });
  const count = (extra: Record<string, unknown> = {}) => ({ q: 'count', of: { ref: 'each', filter: { controller: { ref: 'target', id: 't0' }, types: ['Creature'], ...extra } } });
  const sorcery = (opp: boolean, steps: unknown[]) => ({ kind: 'spell', effect: { targets: [t0(opp)], steps } }) as never;
  const cases: [string, unknown, string, string][] = [
    ['draw', sorcery(true, [{ op: 'draw', who: { ref: 'you' }, count: count({ tapped: true }) }]), 'Draw a card for each tapped creature target opponent controls.', 'Draw a card for each tapped creature you control.'],
    ['draw (equal to)', sorcery(false, [{ op: 'draw', who: { ref: 'you' }, count: count() }]), 'Draw cards equal to the number of creatures target player controls.', 'Draw cards equal to the number of creatures you control.'],
    ['gain life (k each)', sorcery(false, [{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'math', op: '*', args: [2, count()] } }]), 'You gain 2 life for each creature target player controls.', 'You gain 2 life for each creature you control.'],
    ['gain life (1 each)', sorcery(false, [{ op: 'gainLife', who: { ref: 'you' }, amount: count() }]), 'You gain 1 life for each creature target player controls.', 'You gain 1 life for each creature you control.'],
  ];
  it.each(cases)('%s: the Oracle wording is accepted, a count of your own creatures is not', (_n, def, oracle, near) => {
    expect(renderGate(def as never, [oracle], RCTX).ok, oracle).toBe(true);
    expect(renderGate(def as never, [near], RCTX).ok, near).toBe(false);
  });
  it('a count of what you control keeps its readings ("draw a card for each creature you control")', () => {
    const def = { kind: 'spell', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'count', of: { ref: 'each', filter: { controller: 'you', types: ['Creature'] } } } }] } } as never;
    expect(renderGate(def, ['Draw a card for each creature you control.'], RCTX).ok).toBe(true);
    expect(renderGate(def, ['Draw cards equal to the number of creatures you control.'], RCTX).ok).toBe(true);
  });
});
