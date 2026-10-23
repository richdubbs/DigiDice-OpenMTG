/**
 * WP10, effects/handlers/pay.ts and the `may` handler: CR 118.12 ("[A player] may [do something]. If [they do]...") and 118.12a ("[Do something] unless [a
 * player does something else]": the PAYER decides first, design D3). Mana Leak and Rhystic Study as design 13.1 / 13.3 write them; `did` reads the choice.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, EffectStep, GameState } from '../../../src/index';
import {
  answer, byHand, castAuto, chosenObject, draw1, find, handSize, inGraveyard, instant, life, mark, no, pass, passBoth, pendingOf, putOnStack, scenario, targetSpell,
  watcher, withFakes, yes, you,
} from './helpers';

const one = { mana: [{ kind: 'generic' as const, amount: 1 }] };
const three = { mana: [{ kind: 'generic' as const, amount: 3 }] };

/** Mana Leak (design 13.1): "Counter target spell unless its controller pays {3}." */
const leak = (): CardDef => instant('Test Leak', {
  targets: [targetSpell],
  steps: [{ op: 'pay', who: { ref: 'controllerOf', object: { ref: 'target', id: 't0' } }, cost: three, else: [{ op: 'counter', what: { ref: 'target', id: 't0' } }] }],
}, 'Counter target spell unless its controller pays {3}.');

/** p2's Hill Giant spell under p1's Test Leak; p2 has `islands` untapped Islands. */
function leakOnStack(islands: number): GameState {
  const s = scenario(['Hill Giant', 'Island'], { p2: { battlefield: Array(islands).fill('Island') }, defs: [leak()] });
  const giant = putOnStack(s, { name: 'Hill Giant', owner: 'p2' });
  putOnStack(s, { name: 'Test Leak', targets: [[chosenObject(giant)]] });
  return s;
}

describe('CR 118.12a: "counter target spell unless its controller pays {3}" (Mana Leak)', () => {
  it('the controller of the target spell is asked, pays through a non-cancellable payCost decision addressed to them, and the spell stays', () => withFakes(() => {
    let s = passBoth(leakOnStack(3));
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p2', rules: ['CR 118.12a'] });
    s = yes(s);
    expect(s.pending).toMatchObject({ kind: 'payCost', player: 'p2', forPlayer: 'p2', origin: 'unless', cancellable: false, costText: '{3}' });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(pendingOf(s)).toBe('p1 priority');
    expect(s.zones.stack.map((id) => s.objects[id]!.defId)).toEqual(['Hill Giant']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(3);
  }));

  it('declining: the `else` branch runs and the spell is countered', () => withFakes(() => {
    let s = no(passBoth(leakOnStack(3)));
    expect(inGraveyard(s, 'Hill Giant', 'p2')).toBe(true);
    expect(s.zones.stack).toEqual([]);
  }));

  it('a player who can\'t pay is not asked (CR 118.3): the spell is countered at once', () => withFakes(() => {
    const s = passBoth(leakOnStack(2));
    expect(pendingOf(s)).toBe('p1 priority');
    expect(inGraveyard(s, 'Hill Giant', 'p2')).toBe(true);
  }));
});

describe('CR 118.12a: Rhystic Study asks the opponent (the payer) first, and only then its controller ("you may draw")', () => {
  const rhystic = (): CardDef => watcher('Test Rhystic', {
    text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    trigger: { on: [{ ev: 'cast', player: 'opponent' }] },
    effect: { targets: [], steps: [{ op: 'pay', who: { ref: 'event', role: 'player' }, cost: one, else: [{ op: 'may', who: you, do: [draw1()] }] }] },
  });
  /** p2 casts a free instant on p1's turn, with one Island to pay with; the Rhystic trigger is on the stack above it. */
  const setup = (): GameState => {
    let s = scenario(['Island'], { p1: { battlefield: ['Test Rhystic'] }, p2: { hand: ['Test Nothing'], battlefield: ['Island'] }, defs: [rhystic(), instant('Test Nothing', {})] });
    s = pass(s); // p1 passes priority to p2
    s = castAuto(s, 'Test Nothing', { player: 'p2' });
    expect(s.zones.stack).toHaveLength(2);
    return passBoth(s); // the trigger resolves
  };

  it('the opponent declines: then p1 is asked whether to draw, and draws', () => withFakes(() => {
    let s = setup();
    expect(pendingOf(s)).toBe('p2 yesNo');
    s = no(s);
    expect(pendingOf(s)).toBe('p1 yesNo');
    const before = handSize(s, 'p1');
    s = yes(s);
    expect(handSize(s, 'p1')).toBe(before + 1);
  }));

  it('the opponent pays {1}: p1 is never asked', () => withFakes(() => {
    let s = yes(setup());
    expect(s.pending).toMatchObject({ kind: 'payCost', player: 'p2', forPlayer: 'p2', origin: 'unless' });
    const before = handSize(s, 'p1');
    s = answer(s, { kind: 'payCost', auto: true });
    expect(pendingOf(s)).not.toBe('p1 yesNo');
    expect(handSize(s, 'p1')).toBe(before);
  }));
});

describe('CR 118.12: "if you do" reads the choice (`did` after `may` and `pay`)', () => {
  const ifYouDo = (first: EffectStep): CardDef => instant('Test If You Do', { steps: [first, { op: 'if', cond: { cond: 'did', step: 'choice' }, then: [mark('then')], else: [mark('otherwise')] }] });
  const run = (first: EffectStep, s0?: GameState): GameState => {
    const s = s0 ?? scenario(['Island'], { p1: { hand: ['Test If You Do'], battlefield: ['Island'] }, defs: [ifYouDo(first)] });
    return passBoth(castAuto(s, 'Test If You Do'));
  };

  it('may: yes -> the "if you do" branch, after the optional part', () => {
    let s = run({ op: 'may', who: you, as: 'choice', do: [mark('optional part')] });
    s = yes(s);
    expect(pendingOf(s)).toBe('p1 manual: optional part');
    s = byHand(s);
    expect(pendingOf(s)).toBe('p1 manual: then');
  });

  it('may: no -> the other branch', () => {
    const s = no(run({ op: 'may', who: you, as: 'choice', do: [mark('optional part')] }));
    expect(pendingOf(s)).toBe('p1 manual: otherwise');
  });

  it('pay: paying {1} -> "if you do"; declining -> the other branch', () => {
    const step: EffectStep = { op: 'pay', who: you, cost: one, as: 'choice' };
    let s = yes(run(step));
    s = answer(s, { kind: 'payCost', auto: true });
    expect(pendingOf(s)).toBe('p1 manual: then');
    expect(pendingOf(no(run(step)))).toBe('p1 manual: otherwise');
  });

  it('CR 608.2d example: a player who controls no creatures can\'t choose "you may sacrifice a creature"; "if you don\'t" happens without a question', () => {
    const s = run({ op: 'may', who: you, as: 'choice', do: [{ op: 'sacrificeChoice', who: you, filter: { types: ['Creature'] }, count: 1 }] });
    expect(pendingOf(s)).toBe('p1 manual: otherwise');
  });

  it('with a creature the same player is asked', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test If You Do'], battlefield: ['Grizzly Bears'] }, defs: [ifYouDo({ op: 'may', who: you, as: 'choice', do: [{ op: 'sacrificeChoice', who: you, filter: { types: ['Creature'] }, count: 1 }] })] });
    expect(pendingOf(run({ op: 'manual', text: 'unused', reason: 'x' }, s0))).toBe('p1 yesNo');
  });
});

describe('CR 118.12, 119.4: other forms of `pay`', () => {
  const payer = (step: EffectStep): CardDef => instant('Test Payer', { steps: [step, mark('next')] });
  const cast = (step: EffectStep): GameState => passBoth(castAuto(scenario(['Island'], { p1: { hand: ['Test Payer'], battlefield: ['Island', 'Island'] }, defs: [payer(step)] }), 'Test Payer'));

  it('a mandatory payment ("pay 2 life" as an instruction) is paid without a question', () => {
    const s = cast({ op: 'pay', who: you, cost: { other: [{ kind: 'payLife', amount: 2 }] }, mandatory: true });
    expect(pendingOf(s)).toBe('p1 manual: next');
    expect(life(s, 'p1')).toBe(18);
  });

  it('`times` pays the cost that many times ({1} twice is {1}{1}, asked for as {2}: CMDF canonical order, CR 107.4, 202.1)', () => {
    const s = yes(cast({ op: 'pay', who: you, cost: one, times: 2 }));
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{2}', origin: 'optional' });
  });

  it('a cost part the engine can\'t pay automatically is not treated as unpayable: the payer decides, then pays it by hand', () => {
    let s = cast({ op: 'pay', who: you, cost: { other: [{ kind: 'exileFrom', zone: 'library', count: 1 }] }, then: [mark('paid')] });
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    expect((s.pending as { prompt: string }).prompt).toMatch(/can't pay/);
    s = yes(s);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1', reason: 'a cost the engine cannot pay automatically' });
    s = byHand(s);
    expect(pendingOf(s)).toBe('p1 manual: paid');
  });

  it('a resolution can\'t be taken back: the yes/no of the payer is not cancellable (CR 733.1 covers casting, not resolving)', () => {
    const s = cast({ op: 'pay', who: you, cost: one });
    expect(s.pending).toMatchObject({ kind: 'yesNo' });
    expect(s.pending!.cancellable).not.toBe(true);
    expect(find(s, 'Test Payer', 'stack')).toBeDefined();
  });
});
