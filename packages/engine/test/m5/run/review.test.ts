/**
 * WP10 review fixes: one test per finding, each named after the rule it pins.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, EffectStep, GameState, ManualResolveDecision } from '../../../src/index';
import { viewFor } from '../../../src/core/view';
import {
  byHand, castAuto, chosenObject, drainManual, draw1, find, handSize, inGraveyard, instant, life, mark, no, passBoth, pendingOf, putOnStack, scenario, synth,
  targetSpell, withFakes, yes, you, withoutHandlers
} from './helpers';

const cast = (s: GameState, name: string): GameState => passBoth(castAuto(s, name));
const run = (steps: EffectStep[], cards: string[] = [], zones: Parameters<typeof scenario>[1] = {}): GameState =>
  cast(scenario(cards, { ...zones, p1: { ...(zones.p1 ?? {}), hand: [...(zones.p1?.hand ?? []), 'Test Steps'] }, defs: [instant('Test Steps', { steps }), ...(zones.defs ?? [])] }), 'Test Steps');
const decision = (s: GameState): ManualResolveDecision => {
  if (s.pending?.kind !== 'manualResolve') throw new Error(`expected manualResolve, got ${s.pending?.kind}`);
  return s.pending;
};

describe('CR 400.2: a choice among cards a player may not see is not named to that player in the log', () => {
  it('a random pick from the opponent\'s hand: the chooser reads "1 card", the owner (who can see it) reads its name', () => {
    const steps: EffectStep[] = [
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { zone: 'hand', controller: 'opponent' } }, min: 1, max: 1, random: true, as: 'card' },
      mark('after'),
    ];
    const s = run(steps, ['Grizzly Bears'], { p2: { hand: ['Grizzly Bears'] } });
    const lines = (viewer: 'p1' | 'p2' | null): string[] => viewFor(s, viewer).log.map((e) => e.text).filter((t) => t.includes('chooses'));
    expect(lines('p1')).toEqual(['Alice chooses 1 card.']);
    expect(lines(null)).toEqual(['Alice chooses 1 card.']);
    expect(lines('p2')).toEqual(['Alice chooses Grizzly Bears.']);
  });

  it('CR 608.2f: the order decision of a forEach over cards the controller may not see labels them "a card"', () => {
    const steps: EffectStep[] = [{ op: 'forEach', over: { ref: 'each', filter: { zone: 'hand', controller: 'opponent' } }, as: 'it', do: [mark('each')] }];
    const s = run(steps, ['Grizzly Bears', 'Hill Giant'], { p2: { hand: ['Grizzly Bears', 'Hill Giant'] } });
    expect(s.pending).toMatchObject({ kind: 'order', player: 'p1' });
    if (s.pending?.kind !== 'order') throw new Error('expected order');
    expect(s.pending.items.map((i) => i.label)).toEqual(['a card', 'a card']);
  });
});

describe('CR 608.2e: "each opponent may" acts for each opponent, even when only one opponent remains', () => {
  it('two players: the opponent says yes and draws through {ref:"iterating"}', () => withFakes(() => {
    let s = run([{ op: 'may', who: { ref: 'each', who: 'opponent' }, do: [draw1({ ref: 'iterating' })] }]);
    const h2 = handSize(s, 'p2');
    expect(pendingOf(s)).toBe('p2 yesNo');
    s = yes(s);
    expect(handSize(s, 'p2')).toBe(h2 + 1);
  }));
});

describe('CR 608.2d: "you may have [another player] discard / sacrifice" is impossible only when it is impossible for THAT player', () => {
  const discard: EffectStep = { op: 'may', who: you, as: 'm', do: [{ op: 'discard', who: { ref: 'each', who: 'opponent' }, count: 1 }] };
  const sacrifice: EffectStep = { op: 'may', who: you, as: 'm', do: [{ op: 'sacrificeChoice', who: { ref: 'each', who: 'opponent' }, filter: { types: ['Creature'] }, count: 1 }] };

  it('discard: the controller\'s hand is empty, the opponent\'s is not: the controller is asked', () => {
    const s = run([discard, mark('end')], ['Hill Giant', 'Island'], { p2: { hand: ['Hill Giant', 'Island'] } });
    expect(handSize(s, 'p1')).toBe(0);
    expect(pendingOf(s)).toBe('p1 yesNo');
  });

  it('discard: the opponent\'s hand is empty too: not asked', () => {
    const s = run([discard, mark('end')]);
    expect(pendingOf(s)).toBe('p1 manual: end');
  });

  it('sacrifice: the controller controls no creature, the opponent does: the controller is asked', () => {
    const s = run([sacrifice, mark('end')], ['Hill Giant'], { p2: { battlefield: ['Hill Giant'] } });
    expect(pendingOf(s)).toBe('p1 yesNo');
  });

  it('sacrifice: only the controller has a creature: not asked (the opponent has nothing to sacrifice)', () => {
    const s = run([sacrifice, mark('end')], ['Hill Giant'], { p1: { battlefield: ['Hill Giant'] } });
    expect(pendingOf(s)).toBe('p1 manual: end');
  });
});

describe('design 3.1 rule 6, CR 609.3: a step that did not run binds its name as nothing, also in the next loop iteration', () => {
  it('a guarded choice inside forEach does not keep the previous iteration\'s object (CR 608.2c)', () => withFakes(() => {
    const steps: EffectStep[] = [{
      op: 'forEach', over: { ref: 'each', filter: { types: ['Creature'] } }, as: 'it', do: [
        { op: 'chooseObjects', who: you, from: { ref: 'bound', name: 'it' }, min: 1, max: 1, as: 'sel', guard: { cond: 'matches', object: { ref: 'bound', name: 'it' }, filter: { tapped: true } } },
        { op: 'gainLife', who: { ref: 'controllerOf', object: { ref: 'bound', name: 'sel' } }, amount: 1 },
      ],
    }];
    const s0 = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Steps'], battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, defs: [instant('Test Steps', { steps })] });
    s0.objects[find(s0, 'Grizzly Bears', 'battlefield')]!.tapped = true;
    const s = cast(s0, 'Test Steps');
    expect(life(s, 'p1')).toBe(21);
    expect(life(s, 'p2')).toBe(20);
  }));

  it('chooseValue with nothing to choose from binds its name before the manual fallback: a later reference finds an empty binding, not an EngineBug', () => {
    let s = run([{ op: 'chooseValue', who: you, what: 'option', as: 'o' }, { op: 'may', who: { ref: 'bound', name: 'o' }, do: [mark('never')] }, mark('end')]);
    expect(decision(s).reason).toMatch(/nothing to choose from/);
    s = byHand(s);
    expect(pendingOf(s)).toBe('p1 manual: end');
  });
});

describe('design 3.1 rule 7: `did` after chooseValue is true only when something was chosen', () => {
  it('a chooser who resolves to nobody chooses nothing', () => {
    const steps: EffectStep[] = [
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Creature'] } }, min: 0, max: 1, as: 'nobody' },
      { op: 'chooseValue', who: { ref: 'bound', name: 'nobody' }, what: 'color', as: 'c' },
      { op: 'if', cond: { cond: 'did', step: 'c' }, then: [mark('did')], else: [mark('did not')] },
    ];
    expect(pendingOf(run(steps))).toBe('p1 manual: did not');
  });
});

describe('CR 608.2d: a color choice offers only real colors (CR 105.1), and never an empty list', () => {
  it('color words are read as colors', () => {
    const s = run([{ op: 'chooseValue', who: you, what: 'color', options: ['white', 'blue'], as: 'c' }]);
    expect(s.pending).toMatchObject({ kind: 'chooseColor', options: ['W', 'U'] });
  });

  it('options that name no color: resolved by hand, not a decision no answer can satisfy', () => {
    const s = run([{ op: 'chooseValue', who: you, what: 'color', options: ['purple'], as: 'c', span: 'Choose purple.' }]);
    expect(decision(s)).toMatchObject({ text: 'Choose purple.' });
  });
});

describe('CR 118.12, 119.4: payments the engine pays by hand', () => {
  const payer = (step: EffectStep): CardDef => instant('Test Payer', { steps: [step] });
  const castPay = (step: EffectStep): GameState => cast(scenario(['Island'], { p1: { hand: ['Test Payer'], battlefield: ['Island'] }, defs: [payer(step)] }), 'Test Payer');
  const branches = { then: [mark('paid')], else: [mark('not paid')] };

  it('a mandatory payment with a part paid by hand is not offered as a choice: it goes straight to the by-hand payment', () => {
    let s = castPay({ op: 'pay', who: you, mandatory: true, cost: { other: [{ kind: 'exileFrom', zone: 'library', count: 1 }] }, ...branches });
    expect(decision(s)).toMatchObject({ player: 'p1', reason: 'a cost the engine cannot pay automatically' });
    s = byHand(s);
    expect(pendingOf(s)).toBe('p1 manual: paid');
  });

  it('a manual cost part (CostPart kind "manual") is paid by hand after the payer chooses to pay', () => {
    let s = castPay({ op: 'pay', who: you, cost: { other: [{ kind: 'manual', text: 'Return a land you control to its owner\'s hand.' }] }, ...branches });
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = yes(s);
    expect(decision(s)).toMatchObject({ player: 'p1', reason: 'a cost the engine cannot pay automatically' });
    s = byHand(s);
    expect(pendingOf(s)).toBe('p1 manual: paid');
  });

  it('a manual cost part declined: the other branch', () => {
    const s = no(castPay({ op: 'pay', who: you, cost: { other: [{ kind: 'manual', text: 'Return a land you control to its owner\'s hand.' }] }, ...branches }));
    expect(pendingOf(s)).toBe('p1 manual: not paid');
  });

  describe('CR 605.3a, 605.3b: mana from mana abilities activated by hand can pay during a resolution', () => {
    const painland = synth({ name: 'Test Painland', type: 'Land', abilities: [{ kind: 'manual', shape: 'activated', mana: true, text: '{T}: Add {C}. This land deals 1 damage to you.', reason: 'test' }] });
    const leak = instant('Test Leak', {
      targets: [targetSpell],
      steps: [{ op: 'pay', who: { ref: 'controllerOf', object: { ref: 'target', id: 't0' } }, cost: { mana: [{ kind: 'generic', amount: 3 }] }, else: [{ op: 'counter', what: { ref: 'target', id: 't0' } }] }],
    });
    const setup = (): GameState => {
      const s = scenario(['Hill Giant'], { p2: { battlefield: ['Test Painland', 'Test Painland', 'Test Painland'] }, defs: [painland, leak] });
      const giant = putOnStack(s, { name: 'Hill Giant', owner: 'p2' });
      putOnStack(s, { name: 'Test Leak', targets: [[chosenObject(giant)]] });
      return passBoth(s);
    };

    it('the payer is asked, and pays by hand', () => withFakes(() => {
      let s = setup();
      expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p2' });
      s = yes(s);
      expect(decision(s)).toMatchObject({ player: 'p2' });
      s = byHand(s);
      expect(s.zones.stack.map((id) => s.objects[id]!.defId)).toEqual(['Hill Giant']);
    }));

    it('declining: the spell is countered', () => withFakes(() => {
      const s = no(setup());
      expect(inGraveyard(s, 'Hill Giant', 'p2')).toBe(true);
    }));
  });
});

describe('CR 113.3a: only spell abilities are followed as instructions when an instant or sorcery resolves', () => {
  it('a manual triggered or static line of the spell is not asked at resolution; a manual spell or unknown line is', () => {
    const card = synth({ name: 'Test Lines', cost: '{0}', type: 'Instant', abilities: [
      { kind: 'spell', text: 'Destroy all creatures.', effect: { targets: [], steps: [mark('Destroy all creatures.')] } },
      { kind: 'manual', shape: 'triggered', text: 'When you cycle this card, all creatures get -2/-2 until end of turn.', reason: 'test' },
      { kind: 'manual', shape: 'static', text: 'This spell can\'t be countered.', reason: 'test' },
      { kind: 'manual', shape: 'unknown', text: 'Something mixed.', reason: 'test' },
    ] });
    const { seen } = drainManual(cast(scenario([], { p1: { hand: ['Test Lines'] }, defs: [card] }), 'Test Lines'));
    expect(seen).toEqual(['Destroy all creatures.', 'Something mixed.']);
  });

  it('design 10.5: the reminder of a manual spell ability is kept on its step (the chip of a manual shield)', () => {
    const card = synth({ name: 'Test Shield Line', cost: '{0}', type: 'Instant', abilities: [
      { kind: 'manual', shape: 'spell', text: 'If it would die this turn, exile it instead.', reason: 'test', reminder: { d: 'endOfTurn' } },
    ] });
    const s = cast(scenario([], { p1: { hand: ['Test Shield Line'] }, defs: [card] }), 'Test Shield Line');
    expect(decision(s).reminder).toEqual({ d: 'endOfTurn' });
  });

  it('design 10.5: the reminder of a manual activated ability is kept on its step', () => {
    const src = synth({ name: 'Test Shield Rod', cost: '{1}', type: 'Artifact', abilities: [
      { kind: 'manual', shape: 'activated', text: '{T}: The next time a source would deal damage to you this turn, prevent that damage.', reason: 'test', reminder: { d: 'endOfTurn' } },
    ] });
    const s0 = scenario([], { p1: { battlefield: ['Test Shield Rod'] }, defs: [src] });
    const id = putOnStack(s0, { name: 'Test Shield Rod', kind: 'activated' });
    s0.objects[id]!.stack!.abilityRef = { source: 'printed', face: 0, index: 0 };
    const s = passBoth(s0);
    expect(decision(s).reminder).toEqual({ d: 'endOfTurn' });
  });
});

describe('design 10.5: one sentence is shown once', () => {
  it('two unhandled steps lowered from one sentence: the prompt repeats it once', () => withoutHandlers(['tap', 'putCounters'], () => {
    const span = 'Tap target creature and put a stun counter on it.';
    const s = run([{ op: 'tap', what: { ref: 'self' }, span }, { op: 'putCounters', on: { ref: 'self' }, kind: 'stun', count: 1, span }]);
    expect(decision(s).text).toBe(span);
  }));

  it('two handled steps of one sentence are listed as done once', () => withFakes(() => {
    const span = 'Draw two cards.';
    const s = run([{ ...draw1(), span }, { ...draw1(), span }, mark('next')]);
    expect(decision(s).done).toEqual([span]);
  }));
});

describe('design 8.8 rule 6: the step budget is charged per loop iteration', () => {
  it('a repeat with an empty body and a huge count stops at the budget instead of hanging', () => {
    const s = run([{ op: 'repeat', times: 10_000_000, do: [] }, mark('after')]);
    expect(decision(s).reason).toBe('budget');
  });
});
