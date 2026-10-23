/**
 * PUSH1 T2: what "it", "that creature" and "that much" refer to in the pump, damage, counter and life shapes of the backlog (design 6.4, the unique-candidate
 * rule), and the render-gate rows those shapes needed (design 6.8 G6). Synthetic wordings (design 6.10), parsed on the game path.
 */
import { describe, expect, it } from 'vitest';
import { normalizeForGate } from '../../../src/render/equivalence';
import { automated, fullyAutomated, parsed } from './support';

type Rec = Record<string, unknown>;
const stepsOf = (text: string, typeLine?: string): Rec[] => ((parsed(text, typeLine).abilities[0] as unknown as { effect: { steps: Rec[] } }).effect.steps);
const unbound = (text: string, typeLine?: string): boolean => parsed(text, typeLine).diagnostics.some((d) => d.code === 'unbound-reference');

describe('CR 509.1, design 6.4: the combatant a "blocks" / "becomes blocked" clause does not name is no antecedent', () => {
  it('"Whenever ~ blocks, it gets +0/+3": "it" is the blocker, ~ (the unnamed attacker is no phrase of the text)', () => {
    const f = parsed('Whenever ~ blocks, it gets +0/+3 until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('{"ref":"event","role":"blocker"}');
  });
  it('"Whenever ~ becomes blocked, it gets +3/+3": "it" is the attacker, ~', () => {
    const f = parsed('Whenever ~ becomes blocked, it gets +3/+3 until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('{"ref":"event","role":"attacker"}');
  });
  it('"Whenever a creature you control becomes blocked, it gets +1/+3": "it" is that attacking creature', () => {
    const f = parsed('Whenever a creature you control becomes blocked, it gets +1/+3 until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('{"ref":"event","role":"attacker"}');
  });
  it('"Whenever ~ blocks or becomes blocked, it gets +3/-3": ~ itself in both events ({ref:"self"}; a block does not move it)', () => {
    const f = parsed('Whenever ~ blocks or becomes blocked, it gets +3/-3 until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(stepsOf('Whenever ~ blocks or becomes blocked, it gets +3/-3 until end of turn.')[0]).toMatchObject({ effects: [{ affects: { ref: 'self' } }] });
  });
  // FAST3 T14: the other combatant of each pattern is the event role `object` (the attacker ~ blocks; the creature blocking ~), one antecedent that is never ~
  it('a disjunction that names the other combatant: "that creature" is the other creature of each event (role `object`), never ~', () => {
    expect(unbound('Whenever ~ blocks or becomes blocked by a creature, ~ deals 3 damage to that creature.')).toBe(false);
    expect(stepsOf('Whenever ~ blocks or becomes blocked by a creature, ~ deals 3 damage to that creature.')[0]).toMatchObject({ op: 'damage', to: { ref: 'event', role: 'object' } });
    expect(unbound('Whenever ~ blocks or becomes blocked by a creature, ~ deals 3 damage to it.')).toBe(true); // "it" may still be ~
  });
});

describe('CR 120.3, design 6.4: event roles the event never fills, and unnamed roles, are no antecedent of a bare pronoun', () => {
  it('"Whenever ~ deals combat damage to a player, put a +1/+1 counter on it": "it" is ~ (damage to a player has no damaged object)', () => {
    const f = parsed('Whenever ~ deals combat damage to a player, put a +1/+1 counter on it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(stepsOf('Whenever ~ deals combat damage to a player, put a +1/+1 counter on it.')[0]).toMatchObject({ op: 'putCounters', on: { ref: 'event', role: 'source' } });
  });
  it('"Whenever ~ is dealt damage, put a +1/+1 counter on it": "it" is ~, not the unnamed source of the damage', () => {
    const f = parsed('Whenever ~ is dealt damage, put a +1/+1 counter on it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(stepsOf('Whenever ~ is dealt damage, put a +1/+1 counter on it.')[0]).toMatchObject({ op: 'putCounters', on: { ref: 'event', role: 'object' } });
  });
  it('"Whenever ~ becomes untapped, it gets +3/+0": a tapping has no spell or ability, so "it" is ~', () => {
    expect(fullyAutomated(parsed('Whenever ~ becomes untapped, it gets +3/+0 until end of turn.'))).toBe(true);
  });
  it('a pronoun with a head noun may still pick out the unnamed role: "that source" stays a candidate (no binding is lost)', () => {
    // "that source's controller" has one candidate, the source of the damage: it is not refused as an unnamed role
    expect(unbound("Whenever ~ is dealt damage, it deals that much damage to that source's controller.")).toBe(false);
  });
});

describe('CR 602.2b, 113.7a, design 6.4: an activation cost that names ~ makes it the antecedent of the effect\'s "it"', () => {
  it('"Sacrifice ~: It deals 3 damage to any target": the source is ~ (its last known information once sacrificed)', () => {
    const f = parsed('{1}, Sacrifice ~: It deals 3 damage to any target.');
    expect(fullyAutomated(f)).toBe(true);
    expect(stepsOf('{1}, Sacrifice ~: It deals 3 damage to any target.')[0]).toMatchObject({ op: 'damage', source: { ref: 'self' }, amount: 3 });
  });
  it('"Remove a +1/+1 counter from ~: It deals 1 damage to target creature" (the same object)', () => {
    expect(fullyAutomated(parsed('Remove a +1/+1 counter from ~: It deals 1 damage to target creature.'))).toBe(true);
  });
  it('a cost that names no object adds no antecedent: "{T}: It deals 1 damage to any target" stays manual', () => {
    expect(automated(parsed('{T}: It deals 1 damage to any target.').abilities)).toBe(false);
  });
  it('the object of the cost is only a fallback: with a target named, "it" stays what milestone 5 bound it to (the target), never ~ (guard G10)', () => {
    expect(stepsOf('Sacrifice ~: Tap target creature. It deals 3 damage to any target.')[1]).toMatchObject({ op: 'damage', source: { ref: 'target', id: 't0' } });
  });
  it('"Sacrifice ~: Search ... put it onto the battlefield" keeps "it" the searched card (the cost does not make it ambiguous)', () => {
    expect(JSON.stringify(stepsOf('{1}, {T}, Sacrifice ~: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', 'Land'))).not.toContain('"ref":"self"');
  });
  it('CR 701.19 (regenerate): "Remove a +1/+1 counter from ~: Regenerate it" keeps ~ (the first instruction, which introduces no object)', () => {
    const f = parsed('Remove a +1/+1 counter from ~: Regenerate it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"ref":"self"');
  });
});

describe('design 6.4 (unique-candidate rule), review of PUSH1 T2: the cost object is no fallback once an untracked object may have been introduced', () => {
  // each "it" / "that card" below means an object the discourse model does not track (the discarded, drawn, milled, sacrificed or searched card): binding
  // it to ~ would play wrongly, so the sentence stays manual ("no compatible antecedents"), as on main
  const cases: [string, string, string][] = [
    ['CR 701.9 (discard): "Discard a card. Return it to your hand."', '{1}, Sacrifice ~: Discard a card. Return it to your hand.', 'Artifact'],
    ['CR 121.1 (draw): "Draw a card. Exile it."', '{1}, Sacrifice ~: Draw a card. Exile it.', 'Artifact'],
    ['CR 701.17 (mill): "Mill two cards. Put a +1/+1 counter on it."', '{1}, Sacrifice ~: Mill two cards. Put a +1/+1 counter on it.', 'Artifact'],
    ['CR 701.21 (sacrifice): "Sacrifice a creature. Return it to the battlefield"', "{1}, Sacrifice ~: Sacrifice a creature. Return it to the battlefield under its owner's control.", 'Artifact'],
    ['CR 701.21: "You may sacrifice a creature. If you do, return that card to the battlefield"', "{2}, {T}, Sacrifice ~: You may sacrifice a creature. If you do, return that card to the battlefield under its owner's control.", 'Artifact'],
  ];
  for (const [name, text, type] of cases) {
    it(`${name} never binds the pronoun to ~`, () => {
      const f = parsed(text, type);
      expect(fullyAutomated(f)).toBe(false);
      expect(JSON.stringify(f.abilities)).not.toMatch(/"(what|on|source)":\{"ref":"self"\}/);
      expect(f.diagnostics.some((d) => /has no compatible antecedents/.test(d.message))).toBe(true); // as on main: unresolved, so contagious (design 6.7 T2)
    });
  }
  // FAST5 T75 (template eff.t75.search.or.reveal.hand): the search now binds what it found (`as: 'search'`), so "reveal it, put it into your hand" names the
  // searched card, never ~ (CR 701.23a, 608.2c): the sentence is automated, and the pronoun still never binds to the discarded ~
  it('CR 701.23 (search): "Discard ~: Search ..., reveal it, put it into your hand" binds the pronoun to the searched card, never to ~', () => {
    const f = parsed('{1}{G}, Discard ~: Search your library for a basic land card or a Desert card, reveal it, put it into your hand, then shuffle. You gain 3 life.', 'Creature — Armadillo');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).not.toMatch(/"(what|on|source)":\{"ref":"self"\}/);
    expect(JSON.stringify(f.abilities)).toContain('"what":{"ref":"bound","name":"search"}');
  });
});

describe('CR 509.1, design 6.4: the object itself in "blocks or becomes blocked" is "it", never "that creature"', () => {
  it('"Whenever ~ blocks or becomes blocked, destroy that creature" stays manual (where Oracle says "that creature" it means the other combatant)', () => {
    expect(fullyAutomated(parsed('Whenever ~ blocks or becomes blocked, destroy that creature.'))).toBe(false);
  });
});

describe('design 3.5, 6.4: "that much" is the amount of the trigger event', () => {
  it('"Whenever ~ deals damage, you gain that much life" (CR 119.1, 120.3) lowers to {q:"eventAmount"} and passes the gate', () => {
    const f = parsed('Whenever ~ deals damage, you gain that much life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(stepsOf('Whenever ~ deals damage, you gain that much life.')[0]).toEqual({ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'eventAmount' } });
  });
  it('"Whenever ~ is dealt damage, it deals that much damage to any target": "it" is ~, the amount the damage it was dealt', () => {
    const f = parsed('Whenever ~ is dealt damage, it deals that much damage to any target.');
    expect(fullyAutomated(f)).toBe(true);
    expect(stepsOf('Whenever ~ is dealt damage, it deals that much damage to any target.')[0]).toMatchObject({ op: 'damage', source: { ref: 'event', role: 'object' }, amount: { q: 'eventAmount' } });
  });
});

describe('design 6.8 G6: the render-gate rows of the pump shapes', () => {
  it('CR 613.4c: the sign of a zero half of a signed P/T change is not a difference ("-3/-0" = "-3/+0"), only inside a P/T pair', () => {
    expect(normalizeForGate('Target creature gets -3/-0 until end of turn.', [])).toBe(normalizeForGate('Target creature gets -3/+0 until end of turn.', []));
    expect(normalizeForGate('It gets -0/-2.', [])).toBe(normalizeForGate('It gets +0/-2.', []));
    expect(normalizeForGate('It gets -1/-1.', [])).not.toBe(normalizeForGate('It gets +1/-1.', []));
    expect(normalizeForGate('It gets -10/-1.', [])).not.toBe(normalizeForGate('It gets +10/-1.', []));
  });
  it('"Target creature gets -2/-0 until end of turn" is automated (it was a gate mismatch)', () => {
    expect(fullyAutomated(parsed('Target creature gets -2/-0 until end of turn.'))).toBe(true);
  });
  it('CR 107.3a: "+X/+0" with the X of the cost prints as written, without a "where X is X" clause', () => {
    expect(fullyAutomated(parsed('{X}: Target creature gets +X/+0 until end of turn.', 'Artifact'))).toBe(true);
    expect(stepsOf('{X}: Target creature gets -X/-X until end of turn.', 'Artifact')[0]).toMatchObject({ effects: [{ mods: [{ power: { q: 'math', op: '*', args: [-1, { q: 'X' }] } }] }] });
    expect(fullyAutomated(parsed('{X}: Target creature gets -X/-X until end of turn.', 'Artifact'))).toBe(true);
  });
});

describe('CR 603.2c: "one or more counters are put on" a SET of objects is one occurrence, which the engine does not group that way: not read', () => {
  it('"Whenever one or more +1/+1 counters are put on one or more creatures you control, ..." stays manual (the engine counts each creature apart)', () => {
    expect(fullyAutomated(parsed('Whenever one or more +1/+1 counters are put on one or more creatures you control, you gain 1 life.'))).toBe(false);
  });
  it('the singular reading is kept: "... are put on a creature you control" is automated, as a batch trigger', () => {
    const f = parsed('Whenever one or more +1/+1 counters are put on a creature you control, you gain 1 life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities[0]).toMatchObject({ kind: 'triggered', trigger: { batch: true } });
  });
});
