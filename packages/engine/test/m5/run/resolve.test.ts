/**
 * WP10, effects/run.ts#resolveStackObject and core/resolve.ts: resolution as CR 608.2 orders it. 608.2a (intervening "if" again), 608.2b (ONE check over
 * the targets of every chosen mode), 700.2d (modes in printed order), 608.2n (where the object goes). Synthetic cards, real actions.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import {
  castAuto, chosenObject, draw1, drainManual, find, instant, inGraveyard, life, logHas, mark, passBoth, pendingOf, putOnStack, scenario, targetPermanent, targetSpell, tweak,
  watcher, withFakes, you, withoutHandlers
} from './helpers';

/** Cryptic Command as design 13.4 writes it (target ids unique across all modes). The "tap all" mode is a marker: `tap` is WP14's. */
const cryptic = (): CardDef => instant('Test Cryptic', {
  targets: [],
  steps: [],
  modes: {
    min: 2, max: 2,
    options: [
      { text: 'Counter target spell.', program: { targets: [targetSpell], steps: [{ op: 'counter', what: { ref: 'target', id: 't0' } }] } },
      { text: "Return target permanent to its owner's hand.", program: { targets: [targetPermanent], steps: [{ op: 'move', what: { ref: 'target', id: 't1' }, to: { zone: 'hand' } }] } },
      { text: 'Tap all creatures your opponents control.', program: { targets: [], steps: [mark('Tap all creatures your opponents control.')] } },
      { text: 'Draw a card.', program: { targets: [], steps: [draw1()] } },
    ],
  },
}, 'Choose two -- Counter target spell. / Return target permanent to its owner\'s hand. / Tap all creatures your opponents control. / Draw a card.');

/** p2's Hill Giant spell on the stack, p1's Cryptic Command above it targeting the spell and p2's Grizzly Bears (modes 0 and 1). */
function crypticOnStack(): { s: GameState; giantSpell: string; bears: string; cmd: string } {
  const s = scenario(['Grizzly Bears', 'Hill Giant'], { p2: { battlefield: ['Grizzly Bears'] }, defs: [cryptic()] });
  const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
  const giantSpell = putOnStack(s, { name: 'Hill Giant', owner: 'p2' });
  const cmd = putOnStack(s, { name: 'Test Cryptic', targets: [[chosenObject(giantSpell)], [chosenObject(bears)]] });
  s.objects[cmd]!.stack!.modes = [0, 1];
  return { s, giantSpell, bears, cmd };
}

/** Take an object off the stack the way the engine does (a new object in the graveyard: the old target is gone, CR 400.7). */
const removeFromStack = (s: GameState, id: string): GameState => tweak(s, (t) => { moveObject(new Game(t), id, 'graveyard'); });

describe('CR 608.2b: one legality check over the targets of all chosen modes (design D1)', () => {
  it('Cryptic Command whose spell target is gone still resolves: the bounce happens, the counter does nothing', () => withFakes(() => {
    const { s: s0, giantSpell, bears } = crypticOnStack();
    let s = removeFromStack(s0, giantSpell);
    s = passBoth(s);
    expect(s.pending?.kind).toBe('priority');
    expect(s.objects[bears]).toBeUndefined();
    expect(s.zones.hand.p2!.map((id) => s.objects[id]!.defId)).toContain('Grizzly Bears');
    expect(inGraveyard(s, 'Test Cryptic', 'p1')).toBe(true);
    expect(logHas(s, /fizzles/)).toBe(false);
    expect(logHas(s, /Test Cryptic resolves/, 'CR 608.2')).toBe(true);
  }));

  it('with both targets legal both modes act: the spell is countered and the permanent returned', () => withFakes(() => {
    let { s } = crypticOnStack();
    s = passBoth(s);
    expect(inGraveyard(s, 'Hill Giant', 'p2')).toBe(true);
    expect(s.zones.hand.p2!.map((id) => s.objects[id]!.defId)).toContain('Grizzly Bears');
  }));

  it('every target of every chosen mode illegal: it does not resolve, nothing happens, and it goes to the graveyard', () => withFakes(() => {
    const { s: s0, giantSpell, bears } = crypticOnStack();
    let s = removeFromStack(s0, giantSpell);
    s = tweak(s, (t) => { moveObject(new Game(t), bears, 'exile'); });
    const hand = s.zones.hand.p1!.length;
    s = passBoth(s);
    expect(logHas(s, /Test Cryptic fizzles: all of its targets are illegal/, 'CR 608.2b')).toBe(true);
    expect(logHas(s, /Test Cryptic resolves/)).toBe(false);
    expect(inGraveyard(s, 'Test Cryptic', 'p1')).toBe(true);
    expect(s.zones.hand.p1!.length).toBe(hand);
  }));

  it('a spell whose only target is illegal does nothing at all, not even its untargeted part (Sorin\'s Thirst example)', () => withFakes(() => {
    const thirst = instant("Test Thirst", {
      targets: [{ id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' }],
      steps: [mark('Test Thirst deals 2 damage to target creature.'), { op: 'gainLife', who: you, amount: 2 }],
    });
    let s = scenario(['Grizzly Bears'], { p2: { battlefield: ['Grizzly Bears'] }, defs: [thirst] });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    putOnStack(s, { name: 'Test Thirst', targets: [[chosenObject(bears)]] });
    s = tweak(s, (t) => { moveObject(new Game(t), bears, 'graveyard'); });
    s = passBoth(s);
    expect(s.pending?.kind).toBe('priority');
    expect(life(s, 'p1')).toBe(20);
  }));
});

describe('CR 700.2d: the chosen modes run in printed order, then the ability\'s own steps', () => {
  const charm = (): CardDef => instant('Test Marker Charm', {
    targets: [], steps: [mark('own step')],
    modes: { min: 2, max: 2, options: [{ text: 'A', program: { targets: [], steps: [mark('A')] } }, { text: 'B', program: { targets: [], steps: [mark('B')] } }, { text: 'C', program: { targets: [], steps: [mark('C')] } }] },
  });

  it('modes 2 and 0 chosen: A, then C, then the own step', () => {
    const s0 = scenario([], { defs: [charm()] });
    const id = putOnStack(s0, { name: 'Test Marker Charm' });
    s0.objects[id]!.stack!.modes = [2, 0];
    const { seen } = drainManual(passBoth(s0));
    expect(seen).toEqual(['A', 'C', 'own step']);
  });

  it('a mode chosen twice runs twice, and a step the engine can\'t perform is asked once per time it runs', () => withoutHandlers(['tap'], () => {
    const twice = instant('Test Twice', {
      targets: [], steps: [],
      modes: { min: 2, max: 2, allowRepeat: true, options: [{ text: 'Tap it.', program: { targets: [], steps: [{ op: 'tap', what: { ref: 'self' } }] } }, { text: 'B', program: { targets: [], steps: [mark('B')] } }] },
    });
    const s0 = scenario([], { defs: [twice] });
    const id = putOnStack(s0, { name: 'Test Twice' });
    s0.objects[id]!.stack!.modes = [0, 0];
    expect(drainManual(passBoth(s0)).seen).toEqual(['Tap it.', 'Tap it.']);
  }));
});

describe('CR 608.2a, 603.4: an intervening "if" is checked again as the ability resolves', () => {
  const tappedWatcher = (): CardDef => watcher('Test Tapped Watcher', {
    text: 'Whenever you cast a spell, if ~ is tapped, you gain 1 life.',
    trigger: { on: [{ ev: 'cast', player: 'you' }] },
    interveningIf: { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } },
    effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 1 }] },
  });
  const setup = (): GameState => {
    const s = scenario([], { p1: { hand: ['Test Nothing'], battlefield: [{ name: 'Test Tapped Watcher', tapped: true }] }, defs: [tappedWatcher(), instant('Test Nothing', {})] });
    return castAuto(s, 'Test Nothing');
  };

  it('still true: the ability resolves and its controller gains 1 life', () => withFakes(() => {
    let s = setup();
    expect(s.zones.stack).toHaveLength(2); // the spell and, above it, the triggered ability
    s = passBoth(s);
    expect(life(s, 'p1')).toBe(21);
  }));

  it('false by now (the watcher was untapped in response): removed from the stack, nothing happens, the ability ceases to exist (CR 608.2n)', () => withFakes(() => {
    let s = setup();
    const ability = s.zones.stack[1]!;
    s = tweak(s, (t) => { t.objects[find(t, 'Test Tapped Watcher', 'battlefield')]!.tapped = false; });
    s = passBoth(s);
    expect(life(s, 'p1')).toBe(20);
    expect(logHas(s, /does nothing: its "if" condition is no longer true/, 'CR 608.2a')).toBe(true);
    expect(s.objects[ability]).toBeUndefined();
    expect(s.zones.stack).toHaveLength(1); // the spell is still there
    expect(pendingOf(s)).toBe('p1 priority');
  }));
});

describe('CR 608.2n: where the object goes when it has resolved', () => {
  it('an instant goes to its owner\'s graveyard after its last step', () => withFakes(() => {
    let s = scenario([], { p1: { hand: ['Test Drawer'] }, defs: [instant('Test Drawer', { steps: [draw1()] })] });
    const hand = s.zones.hand.p1!.length;
    s = passBoth(castAuto(s, 'Test Drawer'));
    expect(s.zones.hand.p1!.length).toBe(hand); // cast one, drew one
    expect(inGraveyard(s, 'Test Drawer', 'p1')).toBe(true);
    expect(s.zones.stack).toEqual([]);
  }));
});
