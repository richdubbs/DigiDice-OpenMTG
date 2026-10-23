/**
 * WP10: the order of instructions and choices while resolving. CR 608.2c (in the order written), 608.2d (choices while resolving, nothing impossible,
 * CR 609.3), 608.2e (several players choose in APNAP order, then the action happens), 608.2f (one at a time: APNAP, then the controller orders a player's
 * objects).
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, EffectStep, GameState, ManualResolveDecision } from '../../../src/index';
import { advanceTo, answer, byHand, castAuto, draw1, find, handSize, instant, mark, passBoth, pendingOf, scenario, withFakes, yes } from './helpers';

const cast = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): GameState => passBoth(castAuto(s, name, { player }));
const boundOf = (s: GameState): { name: string; objects: string[] }[] | undefined => (s.pending as ManualResolveDecision).bound;

describe('CR 608.2c: the instructions are followed in the order written', () => {
  it('a manual step in the middle: what came before has happened (and is listed as done), what comes after happens next', () => withFakes(() => {
    const card = instant('Test Sequence', { steps: [mark('first'), { ...draw1(), span: 'Draw a card.' }, mark('third'), { ...draw1(), span: 'Draw another card.' }] });
    let s = scenario([], { p1: { hand: ['Test Sequence'] }, defs: [card] });
    const hand = handSize(s, 'p1') - 1; // after casting
    s = cast(s, 'Test Sequence');
    expect(pendingOf(s)).toBe('p1 manual: first');
    expect(handSize(s, 'p1')).toBe(hand);
    s = byHand(s);
    expect(pendingOf(s)).toBe('p1 manual: third');
    expect(handSize(s, 'p1')).toBe(hand + 1);
    expect((s.pending as ManualResolveDecision).done).toEqual(['Draw a card.']);
    s = byHand(s);
    expect(handSize(s, 'p1')).toBe(hand + 2);
    expect(pendingOf(s)).toBe('p1 priority');
  }));
});

describe('CR 608.2d, 609.3: choices made while resolving are only among what is possible', () => {
  const chooser = (min: number, max: number): CardDef => instant('Test Chooser', {
    steps: [{ op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Creature'] } }, min, max, as: 'chosen' }, mark('after')],
  });

  it('"choose two creatures" with only one on the battlefield: no question, that one is chosen (as much as possible)', () => {
    let s = scenario(['Grizzly Bears'], { p1: { hand: ['Test Chooser'], battlefield: ['Grizzly Bears'] }, defs: [chooser(2, 2)] });
    s = cast(s, 'Test Chooser');
    expect(pendingOf(s)).toBe('p1 manual: after');
    expect(boundOf(s)).toEqual([{ name: 'chosen', objects: ['Grizzly Bears'] }]);
  });

  it('with three creatures the player chooses exactly two of the three', () => {
    let s = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Chooser'], battlefield: ['Grizzly Bears', 'Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [chooser(2, 2)] });
    s = cast(s, 'Test Chooser');
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 2, max: 2, rules: ['CR 608.2d'] });
    if (s.pending?.kind !== 'chooseObjects') throw new Error('expected a choice');
    expect(s.pending.options).toHaveLength(3);
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = answer(s, { kind: 'chooseObjects', ids: [giant, find(s, 'Grizzly Bears', 'battlefield', 'p2')] });
    expect(boundOf(s)).toEqual([{ name: 'chosen', objects: ['Hill Giant', 'Grizzly Bears'] }]);
  });

  it('nothing to choose from: no question, an empty choice', () => {
    let s = scenario([], { p1: { hand: ['Test Chooser'] }, defs: [chooser(1, 1)] });
    s = cast(s, 'Test Chooser');
    expect(pendingOf(s)).toBe('p1 manual: after');
  });
});

describe('CR 608.2e: several players choose in APNAP order, then the action happens', () => {
  const eachMay = (): CardDef => instant('Test Each May', { steps: [{ op: 'may', who: { ref: 'each', who: 'player' }, do: [draw1({ ref: 'iterating' })] }] });

  it('p1 active: p1 chooses, then p2 chooses, and only then does anyone draw', () => withFakes(() => {
    let s = scenario([], { p1: { hand: ['Test Each May'] }, defs: [eachMay()] });
    s = cast(s, 'Test Each May');
    const [h1, h2] = [handSize(s, 'p1'), handSize(s, 'p2')];
    expect(pendingOf(s)).toBe('p1 yesNo');
    s = yes(s);
    expect(pendingOf(s)).toBe('p2 yesNo');
    expect([handSize(s, 'p1'), handSize(s, 'p2')]).toEqual([h1, h2]); // nothing happened yet
    s = answer(s, { kind: 'yesNo', yes: true });
    expect([handSize(s, 'p1'), handSize(s, 'p2')]).toEqual([h1 + 1, h2 + 1]);
  }));

  it('p2 active (turn 2): p2 chooses first; only those who said yes draw', () => withFakes(() => {
    let s = scenario([], { p2: { hand: ['Test Each May'] }, defs: [eachMay()] });
    s = advanceTo(s, 2, 'main1');
    s = cast(s, 'Test Each May', 'p2');
    const [h1, h2] = [handSize(s, 'p1'), handSize(s, 'p2')];
    expect(pendingOf(s)).toBe('p2 yesNo');
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(pendingOf(s)).toBe('p1 yesNo');
    s = yes(s);
    expect([handSize(s, 'p1'), handSize(s, 'p2')]).toEqual([h1 + 1, h2]);
  }));

  it('each player chooses an object, active player first', () => {
    const pick: EffectStep = { op: 'chooseObjects', who: { ref: 'each', who: 'player' }, from: { ref: 'each', filter: { types: ['Creature'] } }, min: 1, max: 1, as: 'picked' };
    let s = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Each Picks'], battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, defs: [instant('Test Each Picks', { steps: [pick, mark('done')] })] });
    s = cast(s, 'Test Each Picks');
    expect(pendingOf(s)).toBe('p1 chooseObjects');
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Hill Giant', 'battlefield')] });
    expect(pendingOf(s)).toBe('p2 chooseObjects');
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Grizzly Bears', 'battlefield')] });
    expect(boundOf(s)).toEqual([{ name: 'picked', objects: ['Hill Giant', 'Grizzly Bears'] }]);
  });
});

describe('CR 608.2f: an action that can\'t be simultaneous is taken one object or player at a time', () => {
  it('objects: APNAP order by controller; the controller of the spell orders the objects one player controls', () => {
    const card = instant('Test For Each Creature', { steps: [{ op: 'forEach', over: { ref: 'each', filter: { types: ['Creature'] } }, as: 'it', do: [mark('handle it')] }] });
    let s = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test For Each Creature'], battlefield: ['Grizzly Bears', 'Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [card] });
    s = cast(s, 'Test For Each Creature');
    expect(s.pending).toMatchObject({ kind: 'order', player: 'p1', rules: ['CR 608.2f'] });
    if (s.pending?.kind !== 'order') throw new Error('expected an order decision');
    expect(s.pending.items.map((i) => i.label)).toEqual(['Grizzly Bears', 'Hill Giant']); // p1's two creatures only; p2's one needs no order
    s = answer(s, { kind: 'order', ids: [...s.pending.items].reverse().map((i) => i.id) });
    const seen: string[] = [];
    while (s.pending?.kind === 'manualResolve') {
      seen.push(boundOf(s)![0]!.objects[0]!);
      s = byHand(s);
    }
    // p1's creatures first (p1 is the active player), in the order p1 chose; then p2's Grizzly Bears.
    expect(seen).toEqual(['Hill Giant', 'Grizzly Bears', 'Grizzly Bears']);
  });

  it('players: in APNAP order, no question; `as` names the current player', () => {
    const card = instant('Test For Each Player', { steps: [{ op: 'forEach', over: { ref: 'each', who: 'player' }, as: 'p', do: [mark('handle the player')] }] });
    let s = scenario([], { p1: { hand: ['Test For Each Player'] }, defs: [card] });
    s = cast(s, 'Test For Each Player');
    const seen: string[] = [];
    while (s.pending?.kind === 'manualResolve') {
      seen.push(boundOf(s)!.map((b) => `${b.name}=${b.objects.join(',')}`).join(';'));
      s = byHand(s);
    }
    expect(seen).toEqual(['p=Alice', 'p=Bob']);
  });
});
