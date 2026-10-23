/**
 * LocalConnection and the rules of hot-seat play: what undo may never take back (CR 733.1, 400.2, 401.2, 104.1), concession at any time (CR 104.3a),
 * the legal actions of the shown player (CR 117.1) and engine errors that must not escape `act` as exceptions.
 */
import { compileCard, HIDDEN_DEF, type Action, type GameConfig } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalConnection } from '../src/connection/LocalConnection';
import { smallConfig } from './helpers';

const forest = compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '' });
const bear = compileCard({ name: 'Test Bear', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' });
const peek = compileCard({ name: 'Test Peek', layout: 'normal', mana_cost: '{G}', type_line: 'Sorcery', oracle_text: "Look at target player's hand." });
const shuffle = compileCard({ name: 'Test Shuffle', layout: 'normal', mana_cost: '{G}', type_line: 'Sorcery', oracle_text: 'Shuffle your library.' });

/**
 * Alice (full control) holds Forests and `spell`; Bob holds only bears and keeps the default stops. AP1 (replacing FXH's M2):
 * Bob can cast nothing in response, so the engine passes for him and the screen is not handed to him (`bothPass`).
 */
function spellGame(spell: string): LocalConnection {
  const cfg: GameConfig = {
    seed: `rules-${spell}`,
    players: [
      { name: 'Alice', deck: [...Array<string>(20).fill('Forest'), ...Array<string>(20).fill(spell)], stops: { fullControl: true } },
      { name: 'Bob', deck: Array<string>(40).fill('Test Bear') },
    ],
    defs: [forest, bear, peek, shuffle],
    options: { skipMulligans: true, startingPlayer: 'p1' },
  };
  const conn = new LocalConnection(cfg);
  conn.acceptHandoff();
  return conn;
}

async function ok(conn: LocalConnection, a: Action): Promise<void> {
  const r = await conn.act(a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error.message}`);
}

/** Alice plays a Forest in her first main phase and casts the first card named `spell` from her hand at Bob, stopping with it on the stack. */
async function castAtBob(conn: LocalConnection, spell: string): Promise<void> {
  while (conn.view().turn.step !== 'main1') await ok(conn, { type: 'pass', player: 'p1' });
  const card = (name: string) => conn.view().zones.hand.p1!.find((id) => conn.view().objects[id]!.defId === name)!;
  await ok(conn, { type: 'playLand', player: 'p1', card: card('Forest') });
  await ok(conn, { type: 'cast', player: 'p1', card: card(spell) });
  for (let i = 0; i < 5; i++) {
    const d = conn.view().pending!;
    if (d.kind === 'chooseTargets') await ok(conn, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } });
    else if (d.kind === 'payCost') await ok(conn, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'payCost', auto: true } });
    else break;
  }
  expect(conn.view().zones.stack).toHaveLength(1);
}

/** Alice passes with her spell on the stack; Bob has nothing to respond with, so the engine passes for him (no pass cover) and the spell resolves. */
async function bothPass(conn: LocalConnection): Promise<void> {
  await ok(conn, { type: 'pass', player: 'p1' });
  expect(conn.handoff()).toBeNull(); // AP1: no hand-off to a player the engine passed for
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('undo never takes back hidden information (CR 733.1)', () => {
  it('CR 733.1, CR 400.2: looking at the opponent hand can never be undone', async () => {
    const conn = spellGame('Test Peek');
    await castAtBob(conn, 'Test Peek');
    expect(conn.canUndo()).toBe(true); // casting a spell is still reversible (CR 733.1)
    await bothPass(conn);
    expect(conn.handoff()).toBeNull();
    const v = conn.view();
    expect(v.zones.stack).toHaveLength(0);
    expect(v.zones.hand.p2!.every((id) => v.objects[id]!.defId !== HIDDEN_DEF)).toBe(true);
    expect(conn.canUndo()).toBe(false);
    expect(conn.undo()).toBe(false);
  });

  it('CR 733.1: shuffling a library can never be undone', async () => {
    const conn = spellGame('Test Shuffle');
    await castAtBob(conn, 'Test Shuffle');
    const before = conn.session.state.rng;
    await bothPass(conn);
    expect(conn.session.state.rng).not.toEqual(before);
    expect(conn.canUndo()).toBe(false);
    expect(conn.undo()).toBe(false);
  });

  it('CR 733.1, CR 401.2: a pass that draws a card can never be undone', async () => {
    // Bob starts; Alice (full control) stops in her upkeep, and passing there draws her card for the turn (CR 504.1).
    const base = smallConfig('rules-draw', { options: { skipMulligans: true, startingPlayer: 'p2' } });
    const conn = new LocalConnection({ ...base, players: [base.players[0]!, { name: 'Bob', deck: base.players[1]!.deck }] });
    for (let i = 0; i < 200; i++) {
      if (conn.handoff()) conn.acceptHandoff();
      const v = conn.view();
      if (v.turn.activePlayer === 'p1' && v.turn.step === 'upkeep' && v.pending?.player === 'p1') break;
      await ok(conn, { type: 'pass', player: v.pending!.player });
    }
    expect(conn.view().turn.step).toBe('upkeep');
    const library = conn.session.state.zones.library.p1!.length;
    await ok(conn, { type: 'pass', player: 'p1' });
    expect(conn.handoff()).toBeNull();
    expect(conn.view().turn.step).toBe('draw');
    expect(conn.session.state.zones.library.p1!.length).toBe(library - 1);
    expect(conn.canUndo()).toBe(false);
    expect(conn.undo()).toBe(false);
  });

  it('CR 104.3a, CR 104.1: a concession ends the game and can never be undone', async () => {
    const conn = spellGame('Test Peek');
    await ok(conn, { type: 'concede', player: 'p1' });
    expect(conn.session.state.result).toMatchObject({ winner: 'p2' });
    expect(conn.canUndo()).toBe(false);
    expect(conn.undo()).toBe(false);
    expect(conn.session.state.result).not.toBeNull();
  });

  it('CR 733.1: a restored game cannot undo past the loaded save (what happened before it is not known to be reversible)', async () => {
    const conn = spellGame('Test Peek');
    await ok(conn, { type: 'pass', player: 'p1' });
    const restored = new LocalConnection(conn.session);
    restored.acceptHandoff();
    expect(restored.canUndo()).toBe(false);
  });
});

describe('concession (CR 104.3a: at any time)', () => {
  it('CR 104.3a: the player who is not on screen can concede, even while the pass cover is up', async () => {
    const conn = new LocalConnection(smallConfig('concede-cover', { options: { skipMulligans: true, startingPlayer: 'p1' } }));
    expect(conn.handoff()).toBe('p1');
    expect(await conn.act({ type: 'concede', player: 'p2' })).toEqual({ ok: true });
    expect(conn.session.state.result).toMatchObject({ winner: 'p1' });
    expect(conn.handoff()).toBeNull();
  });

  it('CR 104.3a: the player who is not on screen can concede while the other player acts, but cannot take other actions', async () => {
    const conn = new LocalConnection(smallConfig('concede-off', { options: { skipMulligans: true, startingPlayer: 'p1' } }));
    conn.acceptHandoff();
    const pass = await conn.act({ type: 'pass', player: 'p2' });
    expect(pass.ok).toBe(false);
    expect(await conn.act({ type: 'concede', player: 'p2' })).toEqual({ ok: true });
    expect(conn.session.state.result).toMatchObject({ winner: 'p1' });
  });
});

describe('legal actions (CR 117.1)', () => {
  it('CR 117.1: lists the shown player legal actions, stable between changes, and none while a hand-off is pending', async () => {
    const conn = new LocalConnection(smallConfig('legal', { options: { skipMulligans: true, startingPlayer: 'p1' } }));
    expect(conn.legalActions()).toEqual([]);
    conn.acceptHandoff();
    const first = conn.legalActions();
    expect(first.some((a) => a.kind === 'pass')).toBe(true);
    expect(first.every((a) => 'player' in a.action && a.action.player === 'p1')).toBe(true);
    expect(conn.legalActions()).toBe(first);
    await ok(conn, { type: 'pass', player: 'p1' });
    expect(conn.handoff()).toBe('p2');
    expect(conn.legalActions()).toEqual([]);
  });
});

describe('engine errors', () => {
  it('turns an unexpected engine error into a rejected result instead of throwing (CR 733: nothing is half-applied)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const conn = new LocalConnection(smallConfig('engine-error'));
    conn.acceptHandoff();
    const d = conn.view().pending!;
    const before = conn.session.actions.length;
    let result: unknown;
    expect(() => {
      result = conn.act({ type: 'answer', player: d.player, decisionId: d.id, answer: null as never });
    }).not.toThrow();
    const r = await (result as ReturnType<LocalConnection['act']>);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/^Engine error: /);
    expect(conn.session.actions.length).toBe(before);
    expect(error).toHaveBeenCalled();
  });
});
