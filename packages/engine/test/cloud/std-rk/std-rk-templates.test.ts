/**
 * Round std-rk (slot K, Commander precon cards): no new template file; four general fixes, each tested here with synthetic wordings (design 6.10) parsed by the
 * default compiler (the template set and capabilities a decklist card gets):
 *
 *   1. Event reading (parser/holes/event.ts#EACH_OF_YOUR_STEPS, render/evt.ts, family each-of-your-steps): "at the beginning of each of your postcombat main
 *      phases" is the step trigger of "your postcombat main phase" (CR 505.1a, 603.2).
 *   2. Qty readings (parser/holes/qty.ts#opponentCounts, render/qty.ts#countParts): "the number of opponents you have", "the number of opponents who control
 *      more lands than you", "for each opponent who controls fewer creatures than you" (`countPlayers`, `controlsVs`; CR 102.3, 608.2h).
 *   3. (Filter "that's a Wolf or a Werewolf": dropped in favour of round std-re's parser/holes/filter.ts#thatsKinds, which reached main first; no second mechanism.)
 *   4. Renderer (render/np.ts, family historic): "historic permanents" and "historic <card type>" (CR 700.6).
 *
 * Guards (design 6.8): every example is fully automated and gives the JSON stated; every counter-example does not give the same JSON; near misses (a swapped key
 * word) fail or differ (G9); a nonsense word in place of any word of an example never leaves an automated card (G2); examples are not real Oracle lines (6.10,
 * against the local index when present). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, OracleCard } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { renderGate } from '../../../src/index';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

interface Reading {
  id: string;
  cr: string[];
  /** Synthetic wordings, each fully automated, with a fragment of the JSON each must contain. */
  examples: { text: string; type?: string; contains: unknown }[];
  /** Wordings that must not give an example's JSON fully automated (another meaning, or no reading). */
  counterExamples: { text: string; type?: string; like: number }[];
}

const creature = (text: string, type = 'Creature — Elf Druid'): OracleCard => card('Example Brute', type, text, { power: '2', toughness: '2' });
const parsed = (text: string, type?: string) => parseCard(type?.startsWith('Sorcery') || type?.startsWith('Instant') ? card('Example Volley', type, text) : creature(text, type), OPTS).faces[0]!;
/** True when `want` matches `v` (every key of an object, every element of an array, in order) or a node somewhere inside `v`. */
function matches(v: unknown, want: unknown): boolean {
  if (Array.isArray(want)) return Array.isArray(v) && v.length === want.length && want.every((w, i) => matches(v[i], w));
  if (want !== null && typeof want === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.entries(want).every(([k, w]) => matches((v as Record<string, unknown>)[k], w));
  return v === want;
}
function somewhere(v: unknown, want: unknown): boolean {
  if (matches(v, want)) return true;
  if (Array.isArray(v)) return v.some((x) => somewhere(x, want));
  return v !== null && typeof v === 'object' && Object.values(v).some((x) => somewhere(x, want));
}
const contains = (abilities: readonly AbilityDef[], part: unknown): boolean => somewhere(abilities, part);

const OPPONENTS = { ref: 'each', who: 'opponent' };
const READINGS: Reading[] = [
  {
    id: 'event: at the beginning of each of your <steps>',
    cr: ['CR 505.1a', 'CR 603.2'],
    examples: [
      { text: 'At the beginning of each of your postcombat main phases, you gain 3 life.', contains: { on: [{ ev: 'step', step: 'main2', whose: 'you' }] } },
      { text: 'At the beginning of each of your end steps, draw a card.', contains: { on: [{ ev: 'step', step: 'end', whose: 'you' }] } },
    ],
    counterExamples: [
      { text: 'At the beginning of each of your main phases, you gain 3 life.', like: 0 },
      { text: 'At the beginning of each of your precombat main phases, you gain 3 life.', like: 0 },
      { text: "At the beginning of each of your opponents' postcombat main phases, you gain 3 life.", like: 0 },
      { text: 'At the beginning of each of your postcombat main phase, you gain 3 life.', like: 0 },
    ],
  },
  {
    id: 'Qty: the number of opponents you have',
    cr: ['CR 102.3', 'CR 608.2h'],
    examples: [
      { text: 'When this creature dies, draw cards equal to the number of opponents you have.', contains: { q: 'countPlayers', of: OPPONENTS } },
      { text: 'When this creature enters, create X 1/1 green Squirrel creature tokens, where X is the number of opponents you have.', contains: { q: 'countPlayers', of: OPPONENTS } },
    ],
    counterExamples: [
      { text: 'When this creature dies, draw cards equal to the number of opponents you attacked this turn.', like: 0 },
      { text: 'When this creature dies, draw cards equal to the number of players you have.', like: 0 },
    ],
  },
  {
    id: 'Qty: opponents who control more / fewer <X> than you',
    cr: ['CR 102.3', 'CR 608.2h'],
    examples: [
      { text: 'When this creature dies, draw a card for each opponent who controls fewer creatures than you.', contains: { q: 'countPlayers', of: OPPONENTS, controlsVs: { filter: { types: ['Creature'] }, op: '<', than: { ref: 'you' } } } },
      { text: 'At the beginning of your end step, create X 1/1 white Spirit creature tokens, where X is the number of opponents who control more lands than you.', contains: { q: 'countPlayers', of: OPPONENTS, controlsVs: { filter: { types: ['Land'] }, op: '>', than: { ref: 'you' } } } },
    ],
    counterExamples: [
      { text: 'When this creature dies, draw a card for each opponent who controls more creatures than you.', like: 0 },
      { text: 'When this creature dies, draw a card for each opponent who controls fewer creatures than that player.', like: 0 },
      { text: 'When this creature dies, draw a card for each player who controls fewer creatures than you.', like: 0 },
      { text: 'At the beginning of your end step, create X 1/1 white Spirit creature tokens, where X is the number of opponents who control more lands than you control.', like: 1 },
      { text: 'At the beginning of your end step, create X 1/1 white Spirit creature tokens, where X is the number of opponents who control more lands you control than you.', like: 1 },
    ],
  },
  {
    id: 'render: historic permanents, historic <card type>',
    cr: ['CR 700.6'],
    examples: [
      { text: 'When this creature enters, draw cards equal to the number of historic permanents you control.', contains: { anyOf: [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }] } },
      { text: 'Exile target historic creature.', type: 'Sorcery', contains: { types: ['Creature'], anyOf: [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }] } },
    ],
    counterExamples: [
      { text: 'When this creature enters, draw cards equal to the number of legendary permanents you control.', like: 0 },
      { text: 'Exile target legendary creature.', type: 'Sorcery', like: 1 },
      { text: 'Exile target historic land.', type: 'Sorcery', like: 1 },
    ],
  },
];

describe('std-rk readings: examples are fully automated with the stated JSON; counter-examples do not give it (design 6.8 G9)', () => {
  for (const r of READINGS) {
    it(`${r.id} (${r.cr.join(', ')})`, () => {
      for (const e of r.examples) {
        const f = parsed(e.text, e.type);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(contains(f.abilities, e.contains), `${e.text}: ${JSON.stringify(f.abilities)}`).toBe(true);
      }
      for (const c of r.counterExamples) {
        const ex = r.examples[c.like]!;
        const want = parsed(ex.text, ex.type);
        const f = parsed(c.text, c.type);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(want.abilities), c.text).toBe(false);
      }
    });
  }
});

/** Near misses (design 6.8 G9): a key word swapped never gives the example's JSON. */
const SWAPS: [RegExp, string][] = [
  [/\beach of your\b/, 'each of their'], [/\bpostcombat\b/, 'precombat'], [/\bend steps\b/, 'upkeeps'], [/\bopponents you have\b/, 'opponents you attacked'],
  [/\bfewer\b/, 'more'], [/\bmore\b/, 'fewer'], [/\bthan you\b/, 'than that player'], [/\bthat's a\b/, 'that is not a'], [/\bor a\b/, 'and a'], [/\bor Ox\b/, 'and Ox'],
  [/\bhistoric\b/, 'legendary'], [/\byou control\b/, 'an opponent controls'],
];
describe('std-rk guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const r of READINGS) {
    it(`${r.id}: a swapped key word never gives the example's JSON`, () => {
      for (const e of r.examples) {
        const orig = parsed(e.text, e.type);
        for (const [re, by] of SWAPS) {
          if (!re.test(e.text)) continue;
          const m = e.text.replace(re, by);
          const f = parsed(m, e.type);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rk guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const r of READINGS) {
    it(`${r.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of r.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsed(mutated, e.type)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rk design 6.10 (local index): synthetic examples', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const all = READINGS.flatMap((r) => [...r.examples.map((e) => e.text), ...r.counterExamples.map((c) => c.text)]);
    const verbatim = all.filter((x) => lines.has(x.trim()) || lines.has(x.replace(/\bthis creature\b/g, '~').trim()));
    expect(verbatim, verbatim.join(' | ')).toEqual([]);
  }, 120_000);
});

// ---- the renderer changes, one test each ---------------------------------------------------------------------------------------------------------------------

const RCTX = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
const etbDraw = (count: unknown) => ({
  kind: 'triggered', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count }] },
}) as never;

describe('std-rk renderer (render/qty.ts, CR 102.3, 608.2h): a count of opponents who control more or fewer permanents than you', () => {
  const fewer = { q: 'countPlayers', of: OPPONENTS, controlsVs: { filter: { types: ['Creature'] }, op: '<', than: { ref: 'you' } } };
  it('"for each opponent who controls fewer creatures than you" and "the number of opponents who control fewer creatures than you" are accepted', () => {
    expect(renderGate(etbDraw(fewer), ['When Test Card enters, draw a card for each opponent who controls fewer creatures than you.'], RCTX).ok).toBe(true);
    expect(renderGate(etbDraw(fewer), ['When Test Card enters, draw cards equal to the number of opponents who control fewer creatures than you.'], RCTX).ok).toBe(true);
  });
  it('the comparison, the counted permanents and the counted players are each in the words', () => {
    for (const near of [
      'When Test Card enters, draw a card for each opponent who controls more creatures than you.',
      'When Test Card enters, draw a card for each opponent who controls fewer lands than you.',
      'When Test Card enters, draw a card for each player who controls fewer creatures than you.',
      'When Test Card enters, draw a card for each opponent.',
    ]) expect(renderGate(etbDraw(fewer), [near], RCTX).ok, near).toBe(false);
  });
  it('compared with a player other than you, or by "as many", it stays a condition-only idiom (std-sos review): no words', () => {
    const other = { ...fewer, controlsVs: { ...fewer.controlsVs, than: { ref: 'event', role: 'player' } } };
    expect(renderGate(etbDraw(other), ['When Test Card enters, draw a card for each opponent who controls fewer creatures than that player.'], RCTX).ok).toBe(false);
    const same = { ...fewer, controlsVs: { ...fewer.controlsVs, op: '==' } };
    expect(renderGate(etbDraw(same), ['When Test Card enters, draw a card for each opponent who controls as many creatures as you.'], RCTX).ok).toBe(false);
  });
});

describe('std-rk renderer (render/np.ts, CR 700.6; family historic): historic permanents and a historic creature', () => {
  const HISTORIC = [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }];
  it('"the number of historic permanents you control" is the three kinds of permanents you control', () => {
    const def = etbDraw({ q: 'count', of: { ref: 'each', filter: { controller: 'you', anyOf: HISTORIC } } });
    expect(renderGate(def, ['When Test Card enters, draw cards equal to the number of historic permanents you control.'], RCTX).ok).toBe(true);
    expect(renderGate(def, ['When Test Card enters, draw cards equal to the number of historic permanents an opponent controls.'], RCTX).ok).toBe(false);
    expect(renderGate(def, ['When Test Card enters, draw cards equal to the number of historic creatures you control.'], RCTX).ok).toBe(false);
  });
  it('"target historic creature" is a creature that is one of the three kinds (not an artifact, a legendary or a Saga of any card type)', () => {
    const def = { kind: 'spell', effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'], anyOf: HISTORIC } }], steps: [{ op: 'destroy', what: { ref: 'target', id: 't0' } }] } } as never;
    const sctx = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
    expect(renderGate(def, ['Destroy target historic creature.'], sctx).ok).toBe(true);
    expect(renderGate(def, ['Destroy target historic permanent.'], sctx).ok).toBe(false);
    expect(renderGate(def, ['Destroy target legendary creature.'], sctx).ok).toBe(false);
  });
});
