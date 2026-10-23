/** CMP1 (CR 116.2g, 702.139a): the computer puts its companion into its hand for {3} once its other plays are made. */
import { describe, expect, it } from 'vitest';
import { createGame, viewFor, type GameState } from '@openmtg/engine';
import { clone } from '../../engine/src/util/clone';
import { compiledDefs } from '../../engine/test/fixtures';
import { act, put } from '../../engine/test/m3/scenario';
import { chooseAction, explainPriority } from '../src/index';

const LURRUS = 'Lurrus of the Dream-Den';

function atMain(lands: number): GameState {
  const deck = Array(40).fill('Plains') as string[];
  let s = clone(createGame({
    seed: 'cmp1-ai',
    players: [{ name: 'Bot', deck, companion: LURRUS, stops: { fullControl: true } }, { name: 'Ann', deck, stops: { fullControl: true } }],
    defs: compiledDefs(['Plains', 'Mountain', LURRUS]),
    options: { startingPlayer: 'p1', skipMulligans: true },
  }));
  for (let i = 0; i < lands; i++) put(s, 'p1', 'battlefield', 'Mountain');
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  return s;
}

describe('CMP1: the computer and its companion (CR 116.2g, 702.139a)', () => {
  it('takes the companion special action when it can pay {3}', () => {
    const s = atMain(3);
    const view = viewFor(s, 'p1');
    expect(explainPriority(view, 'x')).toEqual(expect.arrayContaining([expect.objectContaining({ label: `Companion: pay {3} and put ${LURRUS} into your hand`, score: 1 })]));
    // its land drop first (the hand holds Plains), then the companion
    const land = chooseAction(view, view.pending!, 'x');
    expect(land.type).toBe('playLand');
    const t = act(s, land);
    const next = viewFor(t, 'p1');
    expect(chooseAction(next, next.pending!, 'x')).toEqual({ type: 'special', player: 'p1', kind: 'companion' });
  });
});
