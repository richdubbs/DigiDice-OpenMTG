/** LocalConnection: hot-seat views, hand-offs, action routing, undo and save (docs/design/m8-client.md "Data flow"). */
import { act as reactAct, fireEvent, render, screen } from '@testing-library/react';
import { compileCard, GameSession, HIDDEN_DEF, type Action, type GameView } from '@openmtg/engine';
import { describe, expect, it, vi } from 'vitest';
import { NavProvider } from '../src/app/nav';
import { LocalConnection } from '../src/connection/LocalConnection';
import { GameScreen } from '../src/game/GameScreen';
import { smallConfig } from './helpers';

/** Accept the pending hand-off, then answer start-of-game decisions (play first, keep) for whoever acts, until someone has priority. */
async function startGame(conn: LocalConnection): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (conn.handoff()) conn.acceptHandoff();
    const d = conn.view().pending!;
    if (d.kind === 'priority') return;
    let a: Action;
    if (d.kind === 'playFirst') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'playFirst', player: d.player } };
    else if (d.kind === 'mulligan') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'mulligan', keep: true } };
    else throw new Error(`unexpected decision ${d.kind}`);
    const r = await conn.act(a);
    if (!r.ok) throw new Error(r.error.message);
  }
  throw new Error('game did not start');
}

function hiddenHand(view: GameView, player: string): boolean {
  return (view.zones.hand[player] ?? []).every((id) => view.objects[id]!.defId === HIDDEN_DEF);
}

describe('LocalConnection (hot-seat)', () => {
  it('starts with a hand-off to the first player to act and a spectator view (CR 400.2: hands hidden)', async () => {
    const conn = new LocalConnection(smallConfig('handoff-start'));
    const first = conn.handoff();
    expect(first).not.toBeNull();
    const v = conn.view();
    expect(v.viewer).toBeNull();
    expect(hiddenHand(v, 'p1') && hiddenHand(v, 'p2')).toBe(true);
    const r = await conn.act({ type: 'pass', player: first! });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/Pass the screen to/);
  });

  it('after the hand-off shows the acting player their own hand and hides the opponent hand', () => {
    const conn = new LocalConnection(smallConfig('handoff-accept', { options: { skipMulligans: true, startingPlayer: 'p1' } }));
    expect(conn.handoff()).toBe('p1');
    conn.acceptHandoff();
    expect(conn.handoff()).toBeNull();
    const v = conn.view();
    expect(v.viewer).toBe('p1');
    expect(v.zones.hand.p1!.length).toBe(7);
    expect(hiddenHand(v, 'p1')).toBe(false);
    expect(hiddenHand(v, 'p2')).toBe(true);
  });

  it('returns the same view object until something changes and notifies subscribers on every change', async () => {
    const conn = new LocalConnection(smallConfig('stable'));
    const listener = vi.fn();
    const unsubscribe = conn.subscribe(listener);
    const v1 = conn.view();
    expect(conn.view()).toBe(v1);
    conn.acceptHandoff();
    expect(listener).toHaveBeenCalledTimes(1);
    const v2 = conn.view();
    expect(v2).not.toBe(v1);
    unsubscribe();
    await startGame(conn);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects actions for a player who is not on screen, and illegal actions with the engine explanation (CR 733), without changing anything', async () => {
    const conn = new LocalConnection(smallConfig('reject'));
    await startGame(conn);
    const v = conn.view();
    const me = v.viewer!;
    const other = v.players.find((p) => p.id !== me)!.id;
    const listener = vi.fn();
    conn.subscribe(listener);
    const notMine = await conn.act({ type: 'pass', player: other });
    expect(notMine.ok).toBe(false);
    if (!notMine.ok) expect(notMine.error.message).toMatch(/can act on this screen/);
    const illegal = await conn.act({ type: 'playLand', player: me, card: 'no-such-object' });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.message.length).toBeGreaterThan(0);
    expect(await conn.act({ type: 'startGame' })).toMatchObject({ ok: false });
    expect(conn.view()).toBe(v);
    expect(listener).not.toHaveBeenCalled();
  });

  it('hands off when the acting player changes (CR 117.3d: passing priority gives it to the next player)', async () => {
    const conn = new LocalConnection(smallConfig('pass'));
    await startGame(conn);
    const me = conn.view().viewer!;
    const r = await conn.act({ type: 'pass', player: me });
    expect(r.ok).toBe(true);
    const next = conn.handoff();
    expect(next).not.toBeNull();
    expect(next).not.toBe(me);
    expect(conn.view().viewer).toBeNull();
    conn.acceptHandoff();
    expect(conn.view().viewer).toBe(next);
    expect(hiddenHand(conn.view(), me)).toBe(true);
  });

  it("undoes the shown player's own last action", async () => {
    const cfg = smallConfig('undo', { options: { skipMulligans: true, startingPlayer: 'p1' } });
    // Bob keeps the default (Arena-like) stops, so the engine passes for him and Alice keeps priority until her precombat main phase.
    const conn = new LocalConnection({ ...cfg, players: [cfg.players[0]!, { name: 'Bob', deck: cfg.players[1]!.deck }] });
    conn.acceptHandoff();
    expect(conn.canUndo()).toBe(false);
    expect(conn.undo()).toBe(false);
    while (conn.view().turn.step !== 'main1') expect((await conn.act({ type: 'pass', player: 'p1' })).ok).toBe(true);
    expect(conn.handoff()).toBeNull();
    const before = JSON.stringify(conn.session.state);
    const land = conn.view().zones.hand.p1!.find((id) => conn.view().objects[id]!.defId === 'Forest');
    expect((await conn.act({ type: 'playLand', player: 'p1', card: land! })).ok).toBe(true);
    expect(conn.canUndo()).toBe(true);
    expect(conn.undo()).toBe(true);
    expect(JSON.stringify(conn.session.state)).toBe(before);
    expect(conn.view().zones.hand.p1).toContain(land);
  });

  it("never undoes the other player's action after a hand-off", async () => {
    const conn = new LocalConnection(smallConfig('undo-other', { options: { skipMulligans: true, startingPlayer: 'p1' } }));
    conn.acceptHandoff();
    expect((await conn.act({ type: 'pass', player: 'p1' })).ok).toBe(true);
    expect(conn.handoff()).toBe('p2');
    expect(conn.canUndo()).toBe(false);
    conn.acceptHandoff();
    expect(conn.canUndo()).toBe(false);
    expect(conn.undo()).toBe(false);
  });

  it('saves as config + action log and restores the same game', async () => {
    const conn = new LocalConnection(smallConfig('save'));
    await startGame(conn);
    const restored = new LocalConnection(GameSession.fromJSON(JSON.parse(JSON.stringify(conn.save()))));
    expect(JSON.stringify(restored.session.state)).toBe(JSON.stringify(conn.session.state));
  });

  it("drives the game screen through useSyncExternalStore: the pass cover, then the shown player's prompt", async () => {
    const conn = new LocalConnection(smallConfig('screen', { options: { skipMulligans: true, startingPlayer: 'p1' } }));
    render(
      <NavProvider>
        <GameScreen connection={conn} coverDelayMs={0} />
      </NavProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'I am Alice: continue' }));
    // C5's prompt bar shows Alice's own decision (CR 117.1).
    expect(document.querySelector('.prompt-bar .prompt-text')!.textContent).toContain(conn.view().pending!.prompt);
    expect(conn.view().pending!.player).toBe('p1');
    await reactAct(async () => {
      await conn.act({ type: 'pass', player: 'p1' });
    });
    expect(screen.getByRole('dialog', { name: 'Pass to Bob' })).toBeTruthy();
  });
});

describe('LocalConnection events (ui/arena animations)', () => {
  it("an answer does not give the screen again what it was given while the decision waited: the end step's trigger before the cleanup's discard (CR 514.1)", async () => {
    const ringer = compileCard({
      name: 'Bell Ringer', layout: 'normal', mana_cost: '{0}', type_line: 'Artifact Creature — Construct', power: '1', toughness: '1',
      oracle_text: 'At the beginning of your end step, you gain 1 life.',
    });
    const forest = compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '' });
    const deck = [...Array<string>(20).fill(ringer.id), ...Array<string>(20).fill(forest.id)];
    const conn = new LocalConnection(
      { seed: 'replayed-trigger', players: [{ name: 'Alice', deck }, { name: 'Bob', deck }], defs: [ringer, forest], options: { startingPlayer: 'p1', skipMulligans: true, startingHandSize: 10 } },
      { seats: ['p1'] },
    );
    const card = conn.view().zones.hand.p1!.find((id) => conn.view().objects[id]!.defId === ringer.id)!;
    expect((await conn.act({ type: 'cast', player: 'p1', card })).ok).toBe(true);
    const triggered: string[] = [];
    for (let i = 0; i < 10 && conn.view().pending?.kind === 'priority'; i++) {
      expect((await conn.act({ type: 'pass', player: 'p1' })).ok).toBe(true);
      triggered.push(...conn.events().events.filter((e) => e.type === 'abilityTriggered').map((e) => e.objectId));
    }
    const d = conn.view().pending!;
    expect(d.kind).toBe('chooseObjects');
    expect(triggered).toHaveLength(1);
    const seq = conn.events().seq;
    const r = await conn.act({ type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseObjects', ids: d.kind === 'chooseObjects' ? d.options.slice(0, d.min) : [] } });
    expect(r.ok).toBe(true);
    const batch = conn.events();
    expect(batch.seq).toBe(seq + 1);
    // the discard and the next turn, without the trigger (or the steps before the discard) again
    expect(batch.events.filter((e) => e.type === 'abilityTriggered' || e.type === 'lifeChanged')).toEqual([]);
    expect(batch.events.filter((e) => e.type === 'zoneChanged' && e.from === 'hand' && e.to === 'graveyard')).toHaveLength(d.kind === 'chooseObjects' ? d.min : -1);
    expect(batch.events.some((e) => e.type === 'turnBegan')).toBe(true);
  });
});
