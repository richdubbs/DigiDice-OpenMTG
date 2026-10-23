/**
 * M11-1: the numbers that differ between the Commander variants (data, core/commander.ts#COMMANDER_VARIANTS): the free first mulligan (CR 903.12g, 103.5c)
 * and Duel Commander's own format rules.
 */
import { describe, expect, it } from 'vitest';
import { COMMANDER_VARIANTS, commanderOptions, createGame, type GameState } from '../../../src/index';
import { answer } from '../../m3/scenario';
import { commanderConfig, commanderOnBattlefield, commanderScenario, legend, lifeOf, runCombat, tweak } from './helpers';

const TITANIA = legend('Test Titania', '{G}', ['5', '5'], ['G']);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);

const hand = (s: GameState, p: string): number => s.zones.hand[p]!.length;

/** Alice takes one mulligan, Bob keeps; returns the state after Alice's new hand is drawn (and any card put on the bottom). */
function oneMulligan(variant: 'commander' | 'brawl'): GameState {
  let s = createGame(commanderConfig({ variant, p1Commanders: [TITANIA], p2Commanders: [BOB], mulligans: true }));
  expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p1' });
  s = answer(s, { kind: 'mulligan', keep: false });
  s = answer(s, { kind: 'mulligan', keep: true });
  return s;
}

describe('M11-1: the mulligan of a Commander game (CR 103.5, 903.12g)', () => {
  it('CR 903.12g: in Brawl the first mulligan is free: no card is put on the bottom and the next hand offered is 7 cards', () => {
    let s = oneMulligan('brawl');
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p1', handSize: 6 }); // asked again at once: nothing to put on the bottom
    expect(s.pending!.prompt).toMatch(/Keep this 7-card hand/);
    expect(hand(s, 'p1')).toBe(7);
    // the second mulligan counts as the first (CR 903.12g: "subsequent mulligans are counted as normal")
    s = answer(s, { kind: 'mulligan', keep: false });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1 });
    expect(s.players.find((p) => p.id === 'p1')!.mulligans).toBe(2);
  });

  it('CR 103.5c: a two-player Commander game has no free mulligan: one card goes on the bottom', () => {
    const s = oneMulligan('commander');
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1 });
  });
});

describe('M11-1: Duel Commander plays by its own format rules', () => {
  it('Duel Commander: 20 starting life, no commander-damage loss and the normal mulligan; CR 903.10a\'s 21 rule is the plain Commander variant\'s', () => {
    expect(COMMANDER_VARIANTS.duel.startingLife).toBe(20);
    expect(commanderOptions('duel')).toEqual({ variant: 'duel', damageLimit: null, tax: 2, freeMulligan: false });
    expect(commanderOptions('commander').damageLimit).toBe(21); // CR 903.10a, 704.6c
    let s = commanderScenario({ variant: 'duel', p1Commanders: [TITANIA], p2Commanders: [BOB], p1: { battlefield: ['Test Titania'] } });
    s = commanderOnBattlefield(s, 'Test Titania');
    s = tweak(s, (t) => { t.players.find((p) => p.id === 'p2')!.commanderDamage = { [t.players[0]!.commanders![0]!.card]: 30 }; });
    const titania = s.zones.battlefield.find((id) => s.objects[id]!.defId === TITANIA.id)!;
    s = runCombat(s, { attack: [[titania]] });
    expect(lifeOf(s, 'p2')).toBe(15);
    expect(s.result).toBeFalsy(); // no 704.6c
    expect(s.players.find((p) => p.id === 'p2')!.commanderDamage).toEqual({ [s.players[0]!.commanders![0]!.card]: 30 }); // nothing tallied
    const d = oneMulliganDuel();
    expect(d.pending).toMatchObject({ kind: 'chooseObjects', min: 1, max: 1 }); // the normal mulligan
  });
});

function oneMulliganDuel(): GameState {
  let s = createGame(commanderConfig({ variant: 'duel', p1Commanders: [TITANIA], p2Commanders: [BOB], mulligans: true }));
  s = answer(s, { kind: 'mulligan', keep: false });
  return answer(s, { kind: 'mulligan', keep: true });
}
