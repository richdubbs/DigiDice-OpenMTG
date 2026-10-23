/**
 * p2-counters-move-2 (lane p2-counters-move): the round adds no template; it changes a hole, the engine and the renderer. One test per change:
 *  - parser/holes/cost.ts: the cost "Remove all <kind> counters from ~" (CostPart removeCounters `all`, the ability's X with no choice; CR 118.3, 107.3a, 602.2b);
 *  - render/costs.ts, render/qty.ts, render/steps-life.ts, render/steps-util.ts: that X is printed nowhere, so the effect says "the number of <kind> counters removed
 *    this way" or "N life for each <kind> counter removed this way" (render/abil.ts sets RenderState.costAllCountersX);
 *  - rules/mana.ts#counterXPart: such a part is never a mana ability's announced X (fail closed);
 *  - render/cond.ts: "if you've drawn more than one card this turn" (CR 121.1, 603.4).
 * Examples are synthetic wordings (design 6.10). The behavior is in p2-counters-move-2-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { counterXPart } from '../../../src/rules/mana';
import type { ActivatedAbilityDef } from '../../../src/types/ability';
import { card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Codex', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const json = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('p2-counters-move-2 parser/holes/cost.ts (CR 118.3, 107.3a): "Remove all <kind> counters from ~"', () => {
  it('is a removeCounters part on ~ with `all` and the ability\'s X, and the effect\'s "for each <kind> counter removed this way" is that X', () => {
    const f = face('Artifact', '{T}, Remove all gloom counters from ~: You gain 2 life for each gloom counter removed this way.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"kind":"removeCounters","counter":"gloom","count":{"q":"X"},"self":true,"all":true');
    expect(json(f)).toContain('"amount":{"q":"math","op":"*","args":[2,{"q":"X"}]}');
  });
  it('"the number of +1/+1 counters removed this way" as an amount of damage, either order of recipient and amount', () => {
    const a = face('Creature — Dragon', '{T}, Remove all +1/+1 counters from ~: ~ deals damage to any target equal to the number of +1/+1 counters removed this way.', ['1', '1']);
    const b = face('Creature — Dragon', '{T}, Remove all +1/+1 counters from ~: ~ deals damage equal to the number of +1/+1 counters removed this way to any target.', ['1', '1']);
    expect(fullFace(a), JSON.stringify(a.diagnostics)).toBe(true);
    expect(fullFace(b), JSON.stringify(b.diagnostics)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
  it('"Put X +1/+1 counters on it, where X is the number of charge counters removed this way" after a token is created', () => {
    const f = face('Artifact', '{4}, {T}, Remove all charge counters from ~: Create a 0/0 green Ooze creature token. Put X +1/+1 counters on it, where X is the number of charge counters removed this way.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
  it('fail closed: the X is never printed bare ("You gain X life" after "Remove all ..." is not the same text), and "remove all counters" of no kind or from another permanent is not this part', () => {
    expect(fullFace(face('Artifact', '{T}, Remove all gloom counters from ~: You gain X life.'))).toBe(false);
    expect(json(face('Artifact', '{T}, Remove all counters from ~: You gain 2 life.'))).not.toContain('"all":true');
    expect(json(face('Artifact', '{T}, Remove all gloom counters from target artifact: You gain 2 life.'))).not.toContain('"all":true');
  });
  it('rules/mana.ts: a mana ability with such a cost has no announced X (counterXPart is undefined): "Remove all" is no choice', () => {
    const def = { kind: 'activated', cost: { tap: true, other: [{ kind: 'removeCounters', counter: 'gloom', count: { q: 'X' }, self: true, all: true }] }, effect: { targets: [], steps: [] } } as unknown as ActivatedAbilityDef;
    expect(counterXPart(def)).toBeUndefined();
    const chosen = { ...def, cost: { tap: true, other: [{ kind: 'removeCounters', counter: 'gloom', count: { q: 'X' }, self: true, anyNumber: true }] } } as unknown as ActivatedAbilityDef;
    expect(counterXPart(chosen)).toBeDefined();
  });
});

describe('p2-counters-move-2 render/cond.ts (CR 121.1, 603.4): "if you\'ve drawn more than one card this turn"', () => {
  it('is the strict comparison of the cards you drew this turn, and renders back', () => {
    const f = face('Enchantment', 'At the beginning of your end step, if you\'ve drawn more than one card this turn, you gain 2 life.');
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
    expect(json(f)).toContain('"interveningIf":{"cond":"compare","left":{"q":"cardsDrawnThisTurn"},"op":">","right":1}');
  });
  it('"more than two cards" is plural and not the same JSON as "two or more cards"', () => {
    const more = face('Enchantment', 'At the beginning of your end step, if you\'ve drawn more than two cards this turn, you gain 2 life.');
    const atLeast = face('Enchantment', 'At the beginning of your end step, if you\'ve drawn two or more cards this turn, you gain 2 life.');
    expect(fullFace(more), JSON.stringify(more.gate)).toBe(true);
    expect(jsonKey(more.abilities)).not.toBe(jsonKey(atLeast.abilities));
  });
});
