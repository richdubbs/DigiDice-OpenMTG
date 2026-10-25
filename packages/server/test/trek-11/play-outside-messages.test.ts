/** trek-11 (CR 400.11b): the `playOutside` special action over the online socket: it needs priority and must be one the view offers, for the card it names. */
import { describe, expect, it } from 'vitest';
import type { GameView, LegalAction } from '@openmtg/engine';
import { checkClientAction } from '../../src/online/messages';

const priority = { pending: { kind: 'priority', id: 'd1', player: 'p1' }, result: null } as unknown as GameView;
const offer = (outside: string, label: string): LegalAction => ({ kind: 'special', label, isMana: false, action: { type: 'special', player: 'p1', kind: 'playOutside', outside } });
const offered = [offer('Example Bear', 'Cast Example Bear from outside the game'), offer('Example Cave', 'Play Example Cave from outside the game')];

describe('trek-11: playing a card from outside the game is taken with priority and names a card the view offers', () => {
  it('the offered card is accepted; another card, no card, or an object in its place is not', () => {
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'playOutside', outside: 'Example Bear' }, 'p1', priority, offered)).toBeNull();
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'playOutside', outside: 'Example Cave' }, 'p1', priority, offered)).toBeNull();
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'playOutside', outside: 'Example Wolf' }, 'p1', priority, offered)).toMatchObject({ code: 'illegalAction' });
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'playOutside' }, 'p1', priority, offered)).toMatchObject({ code: 'illegalAction' });
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'playOutside', object: 'o1' }, 'p1', priority, offered)).toMatchObject({ code: 'illegalAction' });
  });
  it('nothing is accepted when the view offers none (no permission now), and a decision in progress makes it stale', () => {
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'playOutside', outside: 'Example Bear' }, 'p1', priority, [])).toMatchObject({ code: 'illegalAction' });
    const deciding = { pending: { kind: 'chooseObjects', id: 'd2', player: 'p1' }, result: null } as unknown as GameView;
    expect(checkClientAction({ type: 'special', player: 'p1', kind: 'playOutside', outside: 'Example Bear' }, 'p1', deciding, offered)).toMatchObject({ code: 'stale' });
  });
  it('it is not taken for another player', () => {
    expect(checkClientAction({ type: 'special', player: 'p2', kind: 'playOutside', outside: 'Example Bear' }, 'p1', priority, offered)).toMatchObject({ code: 'notYourPlayer' });
  });
});
