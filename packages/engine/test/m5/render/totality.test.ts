/**
 * WP2 review fixes: the gate is total (api.ts: "it never throws, a malformed ability is a rejection") and bounded. The input is JSON from a parser or an
 * LLM that nobody has reviewed yet (design 6.8, guard G6, pipeline gate C1), so junk, hostile names and enormous nesting are rejections, never exceptions,
 * never hangs, and never a pass.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep } from '../../../src/types/ability';
import { renderAbility, renderGate, type RenderContext } from '../../../src/index';
import { CTX, draw, passes, spell, statics, you } from './build';

const junk: [string, unknown][] = [
  ['undefined', undefined], ['null', null], ['an empty object', {}], ['an array', []], ['a number', 5], ['a string', 'spell'],
  ['an unknown kind', { kind: 'bogus' }], ['a kind in the wrong case', { kind: 'Spell' }], ['a spell without an effect', { kind: 'spell' }], ['a spell with an empty effect', { kind: 'spell', effect: {} }],
  ['a manual ability without text', { kind: 'manual' }], ['a trigger without a trigger', { kind: 'triggered', effect: { targets: [], steps: [] } }],
];

describe('CR 608.2 (totality): the gate never throws, whatever the ability is', () => {
  it.each(junk)('%s is a rejection', (_name, def) => {
    const r = renderGate(def as AbilityDef, ['Draw a card.'], CTX);
    expect(r.ok).toBe(false);
    expect(typeof r.rendered).toBe('string');
    expect(typeof r.expected).toBe('string');
  });
  it.each(junk)('renderAbility prints a marker for %s', (_name, def) => {
    const lines = renderAbility(def as AbilityDef, CTX);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });
  it('a missing context or missing oracle lines are a rejection', () => {
    expect(renderGate(spell([draw()]), undefined as never, CTX).ok).toBe(false);
    expect(renderGate(spell([draw()]), ['Draw a card.'], undefined as never).ok).toBe(false);
    expect(renderGate(spell([draw()]), ['Draw a card.'], { selfNames: undefined } as never).ok).toBe(true);
  });
});

describe('CR 608.2 (totality): a step or word that is a property of Object.prototype is not an op', () => {
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'])('op %s is refused, not printed as an empty sentence', (op) => {
    const def = spell([{ op } as unknown as EffectStep]);
    expect(renderGate(def, [''], CTX).ok).toBe(false);
    expect(renderGate(def, ['Draw a card.'], CTX).ok).toBe(false);
  });
  it('a reserved word as a value is refused', () => {
    const def = spell([{ op: 'action', action: 'constructor', who: you } as unknown as EffectStep]);
    expect(renderGate(def, [''], CTX).ok).toBe(false);
  });
});

describe('CR 702 (free text): a keyword name is letters, spaces and hyphens only', () => {
  it('rejects a keyword that smuggles a sentence', () => {
    const def = { kind: 'keyword', text: '', keyword: 'drain {1}{b}. you win the game' } as AbilityDef;
    expect(renderGate(def, ['Drain {1}{B}. You win the game'], CTX).ok).toBe(false);
  });
  it('still accepts the keywords with a space or a hyphen', () => {
    expect(passes({ kind: 'keyword', text: '', keyword: 'first strike' } as AbilityDef, 'First strike')).toBe(true);
  });
});

describe('bounded work: deep or enormous abilities are rejected quickly', () => {
  const quick = (f: () => void): number => {
    const t0 = performance.now();
    f();
    return performance.now() - t0;
  };
  it('a pay clause nested ten deep (4 readings per level) is refused in under a second', () => {
    let steps: EffectStep[] = [draw()];
    for (let i = 0; i < 10; i++) steps = [{ op: 'pay', who: you, cost: { mana: [{ kind: 'generic', amount: 1 }] }, else: steps } as EffectStep];
    const def = spell(steps);
    const ms = quick(() => expect(renderGate(def, ['Draw a card.'], CTX).ok).toBe(false));
    expect(ms).toBeLessThan(1000);
  });
  it('abilities that grant abilities that grant abilities (twelve deep) are refused in under a second', () => {
    let inner: AbilityDef = { kind: 'keyword', text: '', keyword: 'flying' };
    for (let i = 0; i < 12; i++) inner = statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'] } }, mods: [{ layer: 6, add: [inner] }] }]);
    const ms = quick(() => expect(renderGate(inner, ['Creatures have flying.'], CTX).ok).toBe(false));
    expect(ms).toBeLessThan(1000);
  });
  it('an ability of a hundred thousand JSON nodes is refused', () => {
    const steps = Array.from({ length: 30000 }, () => draw());
    expect(renderGate(spell(steps), ['Draw a card.'], CTX).ok).toBe(false);
  });
  it('real nesting depth (a reflexive trigger in a may in an if) is still printed', () => {
    const def = spell([{ op: 'if', cond: { cond: 'turnOf', whose: 'you' }, then: [{ op: 'may', who: you, do: [draw()] }] }]);
    expect(renderGate(def, ["If it's your turn, you may draw a card."], CTX).ok).toBe(true);
  });
});

describe('the false-reject metric survives a sample that breaks the gate', () => {
  it('counts a throwing gate as an unrenderable rejection and goes on', async () => {
    const { measureGate } = await import('../../../src/render/metrics');
    const samples = [
      { id: 'a', def: spell([draw()]), oracle: ['Draw a card.'], ctx: CTX },
      { id: 'b', def: spell([draw()]), oracle: ['Draw a card.'], ctx: CTX },
    ];
    let n = 0;
    const flaky = (def: AbilityDef, lines: string[], ctx: RenderContext): ReturnType<typeof renderGate> => {
      if (n++ === 0) throw new Error('boom');
      return renderGate(def, lines, ctx);
    };
    const report = measureGate(samples, flaky);
    expect(report.total).toBe(2);
    expect(report.unrenderable).toBe(1);
    expect(report.accepted).toBe(1);
  });
});
