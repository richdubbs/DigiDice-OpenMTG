/**
 * FAST4 MX1: opening-hand actions (CR 103.6, 103.6a; core/pregame.ts). "If this card is in your opening hand, you may begin the game with it on the
 * battlefield" (Leyline of the Void, Leyline of Sanctity): after the mulligans, the starting player, then each other player in turn order, chooses any of
 * those cards; they are put onto the battlefield (publicly logged) before the first turn begins (CR 103.8). Real fixture cards on the game path.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, createGame, ENGINE_CAPABILITIES, viewFor, type GameConfig, type GameState } from '../../../src/index';
import { getCard, compiledDefs } from '../../fixtures';
import { answer } from '../../helpers';

const VOID = 'Leyline of the Void';
const SANCTITY = 'Leyline of Sanctity';

/** p1 (who plays first) has only Leylines of Sanctity in their deck, p2 only Leylines of the Void and Plains. */
function config(mulligans = false): GameConfig {
  return {
    seed: 'mx1-pregame',
    players: [
      { name: 'Alice', deck: Array(40).fill(SANCTITY) as string[], stops: { fullControl: true } },
      { name: 'Bob', deck: [...Array(20).fill(VOID), ...Array(20).fill('Plains')] as string[], stops: { fullControl: true } },
    ],
    defs: compiledDefs([VOID, SANCTITY, 'Plains']),
    options: { startingPlayer: 'p1', ...(mulligans ? {} : { skipMulligans: true }) },
  };
}

const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const leylinesInHand = (s: GameState, p: 'p1' | 'p2', name: string): string[] => s.zones.hand[p]!.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);

describe('FAST4 MX1: static:pregame "begin the game with it on the battlefield" is a capability', () => {
  it('registers static:pregame and the one action it runs; the Leylines compile full', () => {
    expect(ENGINE_CAPABILITIES.has('static:pregame')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:pregame.beginOnBattlefield')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:pregame.reveal')).toBe(false); // CR 103.6b (the Chancellors) is not run
    expect(ENGINE_CAPABILITIES.has('feature:pregame.mandatory')).toBe(false);
    for (const name of [VOID, SANCTITY]) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
});

describe('CR 103.6: opening-hand actions', () => {
  it('the starting player chooses first, then the next player; the chosen cards begin the game on the battlefield, in the chosen order', () => {
    let s = createGame(config());
    expect(s.stage).toBe('mulligan');
    const d1 = s.pending!;
    expect(d1).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 0, ordered: true, rules: ['CR 103.6', 'CR 103.6a'] });
    const mine = leylinesInHand(s, 'p1', SANCTITY);
    expect(d1.kind === 'chooseObjects' && [...d1.options].sort()).toEqual([...mine].sort()); // every card with the ability, nothing else
    s = answer(s, { kind: 'chooseObjects', ids: [mine[1]!, mine[0]!] });
    expect(names(s, s.zones.battlefield)).toEqual([SANCTITY, SANCTITY]);
    const [first, second] = s.zones.battlefield.map((id) => s.objects[id]!);
    expect(first!.timestamp).toBeLessThan(second!.timestamp); // the order chosen (CR 103.6: "in any order")
    expect(s.zones.battlefield.every((id) => s.objects[id]!.controller === 'p1')).toBe(true);
    expect(s.zones.hand.p1).toHaveLength(5);
    // then Bob (CR 103.6: each other player in turn order)
    const d2 = s.pending!;
    expect(d2).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    const voids = leylinesInHand(s, 'p2', VOID);
    s = answer(s, { kind: 'chooseObjects', ids: voids.slice(0, 1) });
    expect(names(s, s.zones.battlefield)).toEqual([SANCTITY, SANCTITY, VOID]);
    expect(s.stage).toBe('playing');
    expect(s.turn.number).toBe(1);
    expect(s.log.filter((l) => / begins the game with /.test(l.text)).map((l) => l.text)).toEqual([
      `Alice begins the game with ${SANCTITY} on the battlefield.`,
      `Alice begins the game with ${SANCTITY} on the battlefield.`,
      `Bob begins the game with ${VOID} on the battlefield.`,
    ]);
  });

  it('a player may decline: the cards stay in the hand and nothing is logged (the hand stays hidden, CR 400.2)', () => {
    let s = createGame(config());
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(s.zones.battlefield).toEqual([]);
    expect(s.zones.hand.p1).toHaveLength(7);
    expect(s.log.some((l) => /begins the game with|Leyline/.test(l.text))).toBe(false);
    expect(s.stage).toBe('playing');
  });

  it('the actions come after the mulligans (CR 103.6: "once the mulligan process is complete")', () => {
    let s = createGame(config(true));
    expect(s.pending?.kind).toBe('mulligan');
    s = answer(s, { kind: 'mulligan', keep: true });
    expect(s.pending?.kind).toBe('mulligan');
    s = answer(s, { kind: 'mulligan', keep: true });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', rules: ['CR 103.6', 'CR 103.6a'] });
  });

  it('the other player does not see the cards being chosen from (CR 400.2)', () => {
    const s = createGame(config());
    const bob = viewFor(s, 'p2');
    expect(bob.pending?.player).toBe('p1');
    const real = s.pending?.kind === 'chooseObjects' ? s.pending.options : [];
    expect(real.length).toBeGreaterThan(0);
    for (const id of real) expect(JSON.stringify(bob.pending)).not.toContain(`"${id}"`);
    expect(Object.values(bob.objects).some((o) => o.defId === SANCTITY)).toBe(false);
  });

  it('a player with no such card is not asked', () => {
    const s = createGame({ ...config(), players: [config().players[0]!, { name: 'Bob', deck: Array(40).fill('Plains') as string[], stops: { fullControl: true } }] });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    const t = answer(s, { kind: 'chooseObjects', ids: [] }); // Bob is never asked
    expect(t.stage).toBe('playing');
    expect(t.pending?.kind).toBe('priority');
  });
});
