/**
 * FXH, audit 2026-10-12 C3 (CR 400.2): a log line about a card in a hidden zone names it only to the players who can see it. The move line of a card that
 * goes from a hand into a library, and the "stays where it is" line of a hand card that can't enter the battlefield (CR 400.4a), read "a card" for everybody
 * else; a card everybody sees keeps its name in the public text.
 */
import { describe, expect, it } from 'vitest';
import { viewFor, type EffectProgram, type EffectStep, type GameState } from '../../src/index';
import { cardLine } from '../../src/core/view';
import { find, scenario } from '../m3/scenario';
import { runProgram } from '../m5/zones/support';

const prog = (steps: EffectStep[]): EffectProgram => ({ targets: [], steps });
const texts = (s: GameState, viewer: string | null): string[] => viewFor(s, viewer).log.map((e) => e.text);

function board(): GameState {
  return scenario(['Lightning Bolt', 'Shock', 'Grizzly Bears'], {
    p1: { hand: ['Lightning Bolt', 'Shock'] },
    p2: { graveyard: ['Lightning Bolt'] },
  });
}

describe('C3: log lines about hidden cards (CR 400.2)', () => {
  it('CR 400.4a: a hand card that can\'t enter the battlefield is named only to its owner; a graveyard card is named to everybody', () => {
    const s = board();
    const r = runProgram(s, { name: 'Shock', owner: 'p1' }, prog((['hand', 'graveyard'] as const).map((zone) => ({
      op: 'move', what: { ref: 'each', filter: { zone, name: 'Lightning Bolt' } }, to: { zone: 'battlefield', controller: 'owner' },
    }))));
    expect(r.results).toEqual([{ performed: false, count: 0 }, { performed: false, count: 0 }]);
    expect(r.state.objects[find(s, 'Lightning Bolt', 'hand', 'p1')]!.zone).toBe('hand');
    const theirs = texts(r.state, 'p2');
    const mine = texts(r.state, 'p1');
    expect(theirs).toContain("Lightning Bolt can't be put onto the battlefield and stays where it is."); // the graveyard card (public)
    expect(theirs).toContain("A card can't be put onto the battlefield and stays where it is."); // the hand card
    expect(mine.filter((t) => t === "Lightning Bolt can't be put onto the battlefield and stays where it is.")).toHaveLength(2);
    expect(theirs.filter((t) => t.startsWith('Lightning Bolt'))).toHaveLength(1);
  });

  it('CR 400.2, 401.2: a card put from a hand into a library is "a card" to the other players, named to its owner', () => {
    const s = board();
    const r = runProgram(s, { name: 'Shock', owner: 'p1' }, prog([{ op: 'move', what: { ref: 'each', filter: { zone: 'hand', name: 'Shock' } }, to: { zone: 'library', position: 'top' } }]));
    expect(r.results[0]!.performed).toBe(true);
    expect(texts(r.state, 'p2')).toContain("A card is put into Alice's library.");
    expect(texts(r.state, null)).toContain("A card is put into Alice's library.");
    expect(texts(r.state, 'p1')).toContain("Shock is put into its owner's library.");
    expect(texts(r.state, 'p2').some((t) => t.includes('Shock is put'))).toBe(false);
  });

  it('CR 400.2: a card that goes from a public zone to a hidden zone was seen by everybody, so its line stays public', () => {
    const s = board();
    const r = runProgram(s, { name: 'Shock', owner: 'p1' }, prog([{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name: 'Lightning Bolt' } }, to: { zone: 'hand' } }]));
    expect(r.results[0]!.performed).toBe(true);
    expect(texts(r.state, 'p1')).toContain("Lightning Bolt is put into its owner's hand.");
    expect(texts(r.state, 'p2')).toContain("Lightning Bolt is put into its owner's hand.");
  });

  it('cardLine: public when every player saw the card, private to the seers otherwise, anonymous when nobody did', () => {
    const s = board();
    expect(cardLine(s, ['p1', 'p2'], 'X', 'a card')).toEqual({ text: 'X' });
    expect(cardLine(s, ['p1', 'p1'], 'X', 'a card')).toEqual({ text: 'a card', privateText: { players: ['p1'], text: 'X' } });
    expect(cardLine(s, [], 'X', 'a card')).toEqual({ text: 'a card' });
  });
});
