/**
 * FXH, audit 2026-10-12 M1 and m3 (CR 400.2, 401.2): an action that names an object the player can't see (a card in another player's hand, a card in any
 * library, another player's face-down permanent) is rejected with the same error whatever the card is, so error messages can't be used to tell hidden cards
 * apart or to read a library's order.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, type Action, type GameState, type ObjectId, type PlayerId } from '../../src/index';
import { HIDDEN_ACTIVATE } from '../../src/actions/activate';
import { HIDDEN_CAST } from '../../src/actions/cast';
import { HIDDEN_LAND } from '../../src/actions/land';
import { find, scenario } from '../m3/scenario';
import { tutor } from './cards';

const VARIED = ['Island', 'Forest', 'Lightning Bolt', 'Grizzly Bears', 'Llanowar Elves', 'Fire // Ice', 'Bonecrusher Giant // Stomp', 'Counterspell', "Razaketh's Rite"];
const KEYS = ['p:0:0', 'p:0:1', 'p:1:0', 'p:1:1', 'k:0:0:0', 'k:0:1:0', 'k:1:0:0', 'r:basic:U', 'r:basic:G', 'no such ability'];

function board(): GameState {
  return scenario([...VARIED.filter((n) => n !== "Razaketh's Rite"), 'Plains', 'Swamp'], {
    defs: [tutor("Razaketh's Rite")],
    p1: { hand: ["Razaketh's Rite"], library: VARIED, battlefield: ['Swamp', 'Swamp'] },
    p2: { hand: VARIED, library: VARIED },
  });
}

/** Every object the player can't see: the other player's hand, both libraries. */
function hiddenFrom(s: GameState, p: PlayerId): ObjectId[] {
  return [...s.zones.hand['p2']!, ...s.zones.library['p1']!, ...s.zones.library['p2']!].filter((id) => !(s.objects[id]!.zone === 'hand' && s.objects[id]!.owner === p));
}

function errors(s: GameState, actions: Action[]): Set<string> {
  const out = new Set<string>();
  for (const a of actions) {
    const r = applyAction(s, a);
    expect(r.error, JSON.stringify(a)).toBeDefined();
    expect(r.state).toBe(s);
    out.add(`${r.error!.message} [${r.error!.rules.join(', ')}]`);
  }
  return out;
}

describe('M1, m3: actions naming hidden objects (or nothing at all) all fail the same way (CR 400.2, 401.2)', () => {
  const s = board();
  const hidden = hiddenFrom(s, 'p1');

  it('the board holds lands, spells, creatures, mana creatures, split, adventure and cycling cards in the hidden zones', () => {
    expect(hidden.length).toBeGreaterThanOrEqual(VARIED.length * 3);
  });

  it('CR 602.2: activating any ability of any hidden object gives one error', () => {
    // An id that names nothing answers the same (m4: guessing ids must not tell which ids another player's hand holds).
    const actions: Action[] = [...hidden, 'o99999', 'nothing'].flatMap((source) => KEYS.map((ability): Action => ({ type: 'activate', player: 'p1', source, ability })));
    const errs = errors(s, actions);
    expect([...errs]).toEqual([`${HIDDEN_ACTIVATE} [CR 602.2, CR 400.2]`]);
  });

  it('CR 601.3: casting any hidden card, with any face or method, gives one error', () => {
    const variants: Partial<Action & { type: 'cast' }>[] = [{}, { face: 1 }, { face: 2 }, { method: 'fuse' }, { method: 'flashback' }, { method: 'nonsense' }];
    const actions: Action[] = [...hidden, 'o99999'].flatMap((card) => variants.map((v): Action => ({ type: 'cast', player: 'p1', card, ...v }) as Action));
    const errs = errors(s, actions);
    expect([...errs]).toEqual([`${HIDDEN_CAST} [CR 601.3, CR 400.2]`]);
  });

  it('CR 305.1: playing any hidden card as a land gives one error', () => {
    const actions: Action[] = [...hidden, 'o99999'].flatMap((card) => [undefined, 0, 1].map((face): Action => ({ type: 'playLand', player: 'p1', card, ...(face === undefined ? {} : { face }) })));
    expect([...errors(s, actions)]).toEqual([`${HIDDEN_LAND} [CR 305.1, CR 400.2]`]);
  });

  it('the player\'s own hand is unaffected: its cards are offered and an illegal action on one still says why', () => {
    const rite = find(s, "Razaketh's Rite", 'hand', 'p1');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.object === rite)).toBe(true); // cycling {B} (CR 702.29a)
    const r = applyAction(s, { type: 'activate', player: 'p1', source: rite, ability: 'no such ability' });
    expect(r.error?.message).toBe('That ability does not exist.');
  });
});
