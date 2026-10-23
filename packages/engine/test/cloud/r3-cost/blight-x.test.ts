/**
 * r3-cost: "As an additional cost to cast this spell, blight X. X can't be greater than the greatest toughness among creatures you control." (Soul Immolation;
 * types AdditionalCostDef.xMax, actions/cast.ts#xCap, parser/parse.ts#cardHasXCost), played with synthetic cards (design 6.10).
 *
 *   CR 107.3, 601.2b   X is announced with the spell, no larger than the greatest toughness among creatures you control, whatever the mana could pay
 *   CR 701.68a, 118.8  blighting X is paid: X -1/-1 counters on a creature you control
 *   CR 107.3           the X of the cost is the X of "deals X damage to each opponent and each creature they control"
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, answer, card, find, full, resolveAll, scenario } from './support';

const PYRE = card('Test Soul Pyre', 'Sorcery', "As an additional cost to cast this spell, blight X. X can't be greater than the greatest toughness among creatures you control.\nTest Soul Pyre deals X damage to each opponent and each creature they control.", '{0}');
const WALL = card('Test Thorn Wall', 'Creature — Plant Wall', '', '{1}', ['1', '3']);
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const DEFS = [PYRE, WALL, BEAR];
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

describe('r3-cost: blight X with "X can\'t be greater than the greatest toughness among creatures you control"', () => {
  it('is automated', () => {
    expect(full(PYRE)).toBe(true);
  });
  it('CR 107.3, 601.2b: the largest X offered is 3 (the Wall\'s toughness); X = 2 puts two -1/-1 counters on the Wall and deals 2 to the opponent and each of their creatures', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Soul Pyre'], battlefield: ['Test Thorn Wall'] }, p2: { battlefield: ['Test Bear'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Soul Pyre', 'hand', 'p1') });
    let max = -1;
    for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseNumber') { max = p.max; s = answer(s, { kind: 'chooseNumber', n: 2 }); }
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected ${p.kind}`);
    }
    expect(max).toBe(3);
    const wall = s.objects[find(s, 'Test Thorn Wall', 'battlefield', 'p1')]!;
    expect(wall.counters['-1/-1']).toBe(2);
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(false);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('without a creature to blight it is not castable (CR 701.68a)', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Soul Pyre'] } });
    expect(() => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Soul Pyre', 'hand', 'p1') })).toThrow();
  });
});

const RISE = card('Test Rising Fury', 'Sorcery', 'As an additional cost to cast this spell, choose a creature you control or reveal a creature card from your hand.\nYou gain 3 life.', '{0}');

describe('r3-cost: "choose a creature you control or reveal a creature card from your hand" is beholding a creature (CR 701.4a, 118.8)', () => {
  it('castable with a creature card in hand to reveal or a creature to choose; not without either', () => {
    expect(RISE.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
    const none = scenario([], { defs: [RISE, WALL], p1: { hand: ['Test Rising Fury'] } });
    expect(() => act(none, { type: 'cast', player: 'p1', card: find(none, 'Test Rising Fury', 'hand', 'p1') })).toThrow();
    let s = scenario([], { defs: [RISE, WALL], p1: { hand: ['Test Rising Fury', 'Test Thorn Wall'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rising Fury', 'hand', 'p1') });
    for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(1, p.min)) });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected ${p.kind}`);
    }
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Thorn Wall'); // revealed, kept (CR 701.20a)
  });
});
