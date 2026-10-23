/**
 * FXH, audit 2026-10-12 m4 (CR 400.2): object ids are handed out one after another, so the id of a card in another player's hand would tell when it was
 * drawn, and the hand's order the order the cards came in. A view shows the cards of another player's hand that the viewer can't see under aliases, in an
 * order that says nothing; the aliases stay the same while that hand is unchanged and all change when a card enters or leaves it.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, unaliasAction, viewFor, type Action, type GameState } from '../../src/index';
import { advanceTo, act, castAuto, passBoth, scenario } from '../m3/scenario';

const HAND = ['Lightning Bolt', 'Shock', 'Grizzly Bears', 'Island', 'Forest'];

function board(): GameState {
  return scenario([...HAND, 'Plains'], { p1: { hand: HAND } });
}

const idNumber = (id: string): number => Number(id.replace(/^o/, ''));

describe('m4: another player\'s hand is shown under aliases (CR 400.2)', () => {
  it('the owner sees their own ids, in their order; the other player and a spectator see none of them', () => {
    const s = board();
    const real = s.zones.hand['p1']!;
    expect(viewFor(s, 'p1').zones.hand['p1']).toEqual(real);
    for (const viewer of ['p2', null] as const) {
      const v = viewFor(s, viewer);
      const shown = v.zones.hand['p1']!;
      expect(shown).toHaveLength(real.length);
      expect(shown.filter((id) => real.includes(id)), String(viewer)).toEqual([]);
      expect(shown.every((id) => v.objects[id]?.zone === 'hand' && v.objects[id]?.owner === 'p1' && v.objects[id]?.defId === '__hidden__')).toBe(true);
      expect(real.every((id) => v.objects[id] === undefined)).toBe(true); // the real ids are nowhere in the view
      expect([...shown].sort()).toEqual(shown); // sorted by alias: the order says nothing about the draw order
    }
  });

  it('the aliases are stable while the hand is unchanged, and differ between viewers', () => {
    const s = board();
    expect(viewFor(s, 'p2').zones.hand['p1']).toEqual(viewFor(s, 'p2').zones.hand['p1']);
    expect(viewFor(s, 'p2').zones.hand['p1']).not.toEqual(viewFor(s, null).zones.hand['p1']);
  });

  it('a draw renews every alias, so no card can be followed across it, and a newly drawn card can\'t be told from the others by its alias', () => {
    let s = board();
    const before = viewFor(s, 'p2').zones.hand['p1']!;
    s = advanceTo(s, 3, 'main1'); // p1 draws in turn 3 (p2 draws in turn 2)
    const after = viewFor(s, 'p2').zones.hand['p1']!;
    expect(after.length).toBe(before.length + 1);
    expect(after.filter((id) => before.includes(id))).toEqual([]);
    // The real id of the drawn card is the highest; the aliases carry no such order.
    const real = s.zones.hand['p1']!;
    const newest = real.reduce((a, b) => (idNumber(a) > idNumber(b) ? a : b));
    expect(real.indexOf(newest)).toBe(real.length - 1);
    expect(after.some((id) => /^o\d+$/.test(id))).toBe(false);
  });

  it('a card the viewer can see in another player\'s hand (revealed to them) keeps its id', () => {
    const s = board();
    const bolt = s.zones.hand['p1']![0]!;
    s.objects[bolt]!.revealedTo = ['p2'];
    const v = viewFor(s, 'p2');
    expect(v.zones.hand['p1']![0]).toBe(bolt);
    expect(v.objects[bolt]!.defId).toBe('Lightning Bolt');
    expect(v.zones.hand['p1']!.filter((id) => s.zones.hand['p1']!.includes(id))).toEqual([bolt]);
  });

  it('an action chosen from the view names those cards by alias: a manual move of one of them is applied to the real card (translated back)', () => {
    let s = scenario(['Lightning Bolt', 'Mountain', ...HAND, 'Plains'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { hand: HAND }, manual: ['Lightning Bolt'] });
    s = passBoth(castAuto(s, 'Lightning Bolt'));
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    const v = viewFor(s, 'p1');
    const alias = v.zones.hand['p2']![2]!;
    expect(s.objects[alias]).toBeUndefined();
    const answer: Action = { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'manualResolve', ops: [{ op: 'move', object: alias, to: 'exile' }] } };
    const translated = unaliasAction(s, answer) as Extract<Action, { type: 'answer' }> & { answer: { kind: 'manualResolve' } };
    const real = (translated.answer.ops[0] as { object: string }).object;
    expect(s.zones.hand['p2']).toContain(real);
    const after = act(s, answer);
    expect(after.zones.hand['p2']).toHaveLength(HAND.length - 1);
    expect(after.zones.hand['p2']).not.toContain(real);
    expect(after.zones.exile.map((id) => after.objects[id]!.defId)).toEqual([s.objects[real]!.defId]);
    // Deterministic: the same action on the same state gives the same game (an action log replays).
    expect(JSON.stringify(act(s, answer))).toBe(JSON.stringify(after));
    // The owner's own view names their hand by the real ids, so an action of theirs needs no translation.
    expect(viewFor(s, 'p2').zones.hand['p2']).toEqual(s.zones.hand['p2']);
  });

  it('unaliasAction leaves an action without aliases untouched (the same object)', () => {
    const s = board();
    const a: Action = { type: 'pass', player: 'p1' };
    expect(unaliasAction(s, a)).toBe(a);
    const t = scenario([...HAND, 'Plains'], { p2: { hand: HAND } });
    const cast: Action = { type: 'cast', player: 'p1', card: viewFor(t, 'p1').zones.hand['p2']![0]! };
    // p1 names an alias of p2's hand: translated back, the cast is refused with the one hidden-card error (M1), never "That card is not here".
    expect(applyAction(t, cast).error?.message).toBe("You can't cast that card.");
  });
});
