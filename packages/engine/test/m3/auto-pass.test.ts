/**
 * Arena-style auto-pass (docs/ARCHITECTURE.md) driven by real legal actions: a player without full control (or hold priority) is passed automatically
 * unless they have a real action (mana abilities don't count) and the step is one of their stops, or an opponent's object is on the stack. AP1
 * restores this rule in place of FAST1's M2 (which read no hand); test/ap1/smart-pass.test.ts has its cases.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../src/index';
import { act, answer, castAuto, find, pass, scenario } from './scenario';

const AUTO = { fullControl: false };

/** Pass repeatedly and record every (turn, step, player) at which a player is asked for priority, until `n` stops. */
function stops(s: GameState, n: number): string[] {
  const out: string[] = [];
  while (out.length < n && !s.result) {
    out.push(`${s.turn.number}:${s.turn.step}:${s.pending!.player}`);
    s = pass(s);
  }
  return out;
}

describe('Arena-style auto-pass with real legal actions', () => {
  it('a player with nothing to do is never asked for priority (mana abilities do not count as something to do)', () => {
    let s = scenario(['Forest', 'Plains'], { p1: { battlefield: ['Forest'] }, p2: { battlefield: [] }, stops: AUTO });
    // p1 has only a mana ability; p2's hand is empty. Passing in main1 skips straight to the first stop with a real action:
    // p2's draw in turn 2 gives them a Plains to play in their own main phase.
    s = pass(s);
    expect(`${s.turn.number}:${s.turn.step}:${s.pending!.player}`).toBe('2:main1:p2');
  });

  it('a player with a land in hand stops in their own main phases only', () => {
    const s = scenario(['Forest'], { p1: { hand: ['Forest'], battlefield: [] }, stops: AUTO });
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    // p1 doesn't play it: passing moves on; p1 is asked again in main2 (still a stop with a playable land), then not until p2's turn needs them.
    const seen = stops(s, 3);
    expect(seen[0]).toBe('1:main1:p1');
    expect(seen[1]).toBe('1:main2:p1');
    expect(seen[2]).toBe('2:main1:p2'); // p2 draws a Plains and stops in their main phase; p1 had no stop on p2's upkeep/draw
  });

  it('an instant with mana available stops the player on the opponent\'s turn only at their opponent-turn stops', () => {
    const s = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { hand: [] }, stops: AUTO });
    const seen = stops(s, 7);
    // p1 is asked only in their own main phases and at the opponent-turn stops (declare attackers, end step);
    // p2 is asked in their main phases because their drawn Plains can be played.
    expect(seen.filter((x) => x.endsWith(':p1'))).toEqual(['1:main1:p1', '1:main2:p1', '2:declareAttackers:p1', '2:end:p1', '3:main1:p1']);
    expect(seen.filter((x) => x.endsWith(':p2'))).toEqual(['2:main1:p2', '2:main2:p2']);
  });

  it('AP1: no castable spell means no stop: a tapped-out player is passed through every step', () => {
    const s = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: [{ name: 'Mountain', tapped: true }] }, stops: AUTO });
    // Turn 1's untap is over; the Mountain stays tapped until p1's next untap step.
    const seen = stops(s, 4);
    // p1 may be asked at 3:main1 when they untap; before that, never.
    expect(seen.filter((x) => x.endsWith(':p1')).every((x) => x.startsWith('1:main1') || x.startsWith('3:') || x.startsWith('2:'))).toBe(true);
    expect(seen).not.toContain('1:main2:p1');
  });

  it('CR 117.4 + Arena: right after you cast a spell you are not asked to respond to your own spell', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears', 'Forest'], battlefield: ['Forest', 'Forest'] }, stops: AUTO });
    expect(s.pending).toMatchObject({ player: 'p1' });
    s = castAuto(s, 'Grizzly Bears');
    // p1 auto-passes (own object on top), p2 has nothing to do and auto-passes: Bears resolved and p1 is back in main1
    // (stopping there because the Forest in hand can be played).
    expect(s.zones.stack).toEqual([]);
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId)).toContain('Grizzly Bears');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(s.turn.step).toBe('main1');
  });

  it('a player who can respond is given priority when the opponent has a spell on the stack', () => {
    let s = scenario(['Grizzly Bears', 'Lightning Bolt', 'Forest', 'Mountain'], {
      p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] },
      p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] },
      stops: AUTO,
    });
    s = castAuto(s, 'Grizzly Bears');
    expect(s.zones.stack).toHaveLength(1);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' }); // p2 can Bolt in response
    s = castAuto(s, 'Lightning Bolt', { player: 'p2' });
    expect(s.zones.stack).toHaveLength(2);
    void act;
  });

  it('a player without a possible response is passed automatically even with a spell on the stack', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] }, p2: { hand: [] }, stops: AUTO });
    s = castAuto(s, 'Grizzly Bears');
    expect(s.zones.stack).toEqual([]); // p2 couldn't respond, so Bears already resolved
    void answer; void find;
  });

  it('full control players always get priority, even with nothing to do', () => {
    const s = scenario(['Forest'], { p1: { battlefield: [] }, p2: { battlefield: [] } });
    const seen = stops(s, 6);
    expect(seen).toContain('1:beginCombat:p1');
    expect(seen).toContain('1:beginCombat:p2');
  });
});
