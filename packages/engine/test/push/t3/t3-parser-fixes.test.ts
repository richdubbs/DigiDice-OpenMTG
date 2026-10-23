/**
 * T3 (push wave): the parser fixes the template review needed (parser/holes/event.ts, parser/lower/scope.ts, parser/lower/conditions.ts). Before them two
 * cards on main were full and wrong (Ghost Hounds triggered on blocking any creature; Clockwork Hydra removed the counter from the creature it blocked).
 * Synthetic wordings (design 6.10), parsed with the default template set.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';

const OPTS = defaultParseOptions();
const parse = (text: string): AbilityDef => parseCard({ name: 'Test Card', layout: 'normal', type_line: 'Creature — Bear', oracle_text: text } as never, OPTS).faces[0]!.abilities[0]!;
const json = (a: AbilityDef): string => JSON.stringify(a);

describe('CR 509.3b, 509.3d: "blocks or becomes blocked by <NP>" (parser/holes/event.ts)', () => {
  it('CR 509.3b, 509.3d: the noun phrase is the object of "blocks" too: blocks a white creature, or becomes blocked by one', () => {
    const a = parse('Whenever ~ blocks or becomes blocked by a white creature, ~ gains first strike until end of turn.') as Extract<AbilityDef, { kind: 'triggered' }>;
    expect(a.trigger.on).toEqual([
      { ev: 'blocks', blocker: { self: true }, attacker: { colors: ['W'], types: ['Creature'] } },
      { ev: 'becomesBlocked', attacker: { self: true }, by: { colors: ['W'], types: ['Creature'] } },
    ]);
  });
  it('CR 509.3c: "blocks or becomes blocked" with no noun phrase keeps the bare events', () => {
    const a = parse('Whenever ~ blocks or becomes blocked, draw a card.') as Extract<AbilityDef, { kind: 'triggered' }>;
    expect(a.trigger.on).toEqual([{ ev: 'blocks', blocker: { self: true } }, { ev: 'becomesBlocked', attacker: { self: true } }]);
  });
});

describe('CR 509.1, design 6.4: who "it" is after "attacks or blocks" (parser/lower/scope.ts)', () => {
  it('CR 509.1: "Whenever ~ attacks or blocks, it gets +1/+1" pumps the object itself (in the blocks event the attacker is the OTHER creature)', () => {
    const a = parse('Whenever ~ attacks or blocks, it gets +1/+1 until end of turn.');
    expect(json(a)).toContain('"affects":{"ref":"self"}');
    expect(json(a)).not.toContain('"role":"attacker"');
  });
  // FAST3 T14: "that creature" is the other creature (event role `object`, the attacker it blocks or the creature blocking it), never the object itself
  it('design 6.4: "that creature" after "blocks or becomes blocked by" is the other creature, never the object', () => {
    const a = parse('Whenever ~ blocks or becomes blocked by a creature, destroy that creature at end of combat.');
    expect(json(a)).not.toContain('"op":"manual"');
    expect(json(a)).toContain('{"op":"destroy","what":{"ref":"event","role":"object"}}');
  });
  it('CR 508.1, 509.1: "attacks or becomes blocked" names the attacker in both events, as before', () => {
    expect(json(parse('Whenever ~ attacks or becomes blocked, it gets +1/+1 until end of turn.'))).toContain('"affects":{"ref":"event","role":"attacker"}');
  });
});

describe('CR 608.2c: "If C, you may X. If you do, Y." (parser/lower/conditions.ts)', () => {
  it('CR 608.2c: the instruction before stays automated; FAST5 T78: the "if you do" sentence moves into the branch of the "if", after the `may` it reads (parser/lower/conditions.ts#foldMayInIf), so its `did` is bound on every path that reaches it', () => {
    const a = parseCard({ name: 'Test Card', layout: 'normal', type_line: 'Instant', oracle_text: 'Draw a card. If you control a Forest, you may discard a card. If you do, gain 2 life.' } as never, OPTS).faces[0]!.abilities[0]!;
    const steps = (a as Extract<AbilityDef, { kind: 'spell' }>).effect.steps;
    expect(steps[0]).toMatchObject({ op: 'draw' });
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ op: 'if' });
    const branch = (steps[1] as unknown as { then: { op: string; as?: string }[] }).then;
    expect(branch.map((x) => x.op)).toEqual(['may', 'if']);
    expect(branch[1]).toMatchObject({ op: 'if', cond: { cond: 'did', step: branch[0]!.as } });
    expect(json(a)).not.toContain('"op":"manual"');
  });
  it('CR 608.2c: "If C, you may X. If you don\'t, Y." is not read through the "if" (not being offered X is not settled by the text): Y is a manual step', () => {
    const a = parseCard({ name: 'Test Card', layout: 'normal', type_line: 'Instant', oracle_text: "Draw a card. If you control a Forest, you may discard a card. If you don't, lose 2 life." } as never, OPTS).faces[0]!.abilities[0]!;
    const steps = (a as Extract<AbilityDef, { kind: 'spell' }>).effect.steps;
    expect(json(a)).not.toContain('"cond":"did"');
    expect(steps[steps.length - 1]).toMatchObject({ op: 'manual' });
  });
});
