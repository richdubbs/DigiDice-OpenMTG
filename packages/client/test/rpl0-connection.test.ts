/**
 * RPL-0 (replays design 2, 6, 8): the client's event redaction is the engine's shared one (packages/net uses the same), so local games get its stricter
 * rules (NETFIX1, NETFIX2: no event names another player's hidden hand card by any id) and keep the public view (viewer null); `GameConnection.kind`
 * has a third value, 'replay'; the engine build of the browser is defined (a fixed value in tests).
 */
import { compileCard, eventsFor, UNSEEN_ID, type Action, type GameConfig, type GameEvent, type GameView } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import type { EventBatch, GameConnection } from '../src/connection/GameConnection';
import { LocalConnection } from '../src/connection/LocalConnection';
import { PacedConnection } from '../src/connection/PacedConnection';
import { eventsForViewer } from '../src/connection/redactEvents';
import { ENGINE_BUILD } from '../src/engine-build';
import { smallConfig } from './helpers';

/** Pass priority (and keep the first cards when asked) for whoever must act, p1 here and the computer seat p2 through its own connection. */
async function passUntil(conn: LocalConnection, until: () => boolean, steps = 120): Promise<void> {
  const p2 = conn.seat('p2');
  for (let i = 0; i < steps && !until(); i++) {
    const d = conn.view().pending;
    if (!d) return;
    const seat = d.player === 'p1' ? conn : p2;
    const sd = seat.view().pending!;
    let a: Action;
    if (sd.kind === 'priority') a = { type: 'pass', player: sd.player };
    else if (sd.kind === 'chooseObjects') a = { type: 'answer', player: sd.player, decisionId: sd.id, answer: { kind: 'chooseObjects', ids: sd.options.slice(0, sd.min) } };
    else throw new Error(`unexpected decision ${sd.kind}`);
    const r = await seat.act(a);
    if (!r.ok) throw new Error(r.error.message);
  }
}

describe('RPL-0: one event redaction for the client and packages/net (CR 400.2)', () => {
  it('eventsForViewer is the engine eventsFor, for a seat and for the public view', async () => {
    const conn = new LocalConnection(smallConfig('rpl0-client-same', { options: { skipMulligans: true, startingPlayer: 'p1' } }), { seats: ['p1'] });
    const batches: GameEvent[][] = [];
    await passUntil(conn, () => {
      batches.push([...conn.session.lastEvents]);
      return batches.length > 40;
    });
    const state = conn.session.state;
    for (const events of batches) {
      for (const viewer of ['p1', 'p2', null]) expect(eventsForViewer(state, events, viewer)).toEqual(eventsFor(state, events, viewer));
    }
  });

  it("NETFIX2 in a local game: the computer's draw names no card, by any id, on the human's screen", async () => {
    const conn = new LocalConnection(smallConfig('rpl0-client-draw', { options: { skipMulligans: true, startingPlayer: 'p1' } }), { seats: ['p1'] });
    let drew: Extract<GameEvent, { type: 'drew' }> | undefined;
    await passUntil(conn, () => (drew = conn.events().events.find((e): e is Extract<GameEvent, { type: 'drew' }> => e.type === 'drew' && e.player === 'p2')) !== undefined);
    expect(drew, 'the computer drew').toBeDefined();
    expect(drew!.objectId).toBe(UNSEEN_ID);
    const hand = conn.session.state.zones.hand['p2']!;
    const text = JSON.stringify(conn.events().events);
    for (const id of hand) expect(text).not.toContain(`"${id}"`);
  });
});

describe('RPL-0 review: a local game redacts events as an online game does, with the state the screen showed before (CR 400.2, 701.20b)', () => {
  const forest = compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '' });
  const bear = compileCard({ name: 'Test Bear', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' });
  const pilfer = compileCard({
    name: 'Test Pilfer', layout: 'normal', mana_cost: '{G}', type_line: 'Sorcery',
    oracle_text: 'Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.',
  });

  async function ok(conn: LocalConnection, a: Action): Promise<void> {
    const r = await conn.act(a);
    if (!r.ok) throw new Error(`${a.type}: ${r.error.message}`);
  }

  it("a card of the opponent's hand revealed to the player keeps its id in the event of its discard", async () => {
    const cfg: GameConfig = {
      seed: 'rpl0-client-pilfer',
      players: [
        { name: 'Alice', deck: [...Array<string>(20).fill('Forest'), ...Array<string>(20).fill('Test Pilfer')], stops: { fullControl: true } },
        { name: 'Bob', deck: Array<string>(40).fill('Test Bear') },
      ],
      defs: [forest, bear, pilfer],
      options: { skipMulligans: true, startingPlayer: 'p1' },
    };
    const conn = new LocalConnection(cfg);
    conn.acceptHandoff();
    while (conn.view().turn.step !== 'main1') await ok(conn, { type: 'pass', player: 'p1' });
    const card = (name: string) => conn.view().zones.hand.p1!.find((id) => conn.view().objects[id]!.defId === name)!;
    await ok(conn, { type: 'playLand', player: 'p1', card: card('Forest') });
    await ok(conn, { type: 'cast', player: 'p1', card: card('Test Pilfer') });
    let chosen: string | undefined;
    for (let i = 0; i < 12 && chosen === undefined; i++) {
      if (conn.handoff() !== null) conn.acceptHandoff();
      const d = conn.view().pending!;
      if (d.kind === 'chooseTargets') await ok(conn, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } });
      else if (d.kind === 'payCost') await ok(conn, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'payCost', auto: true } });
      else if (d.kind === 'priority') await ok(conn, { type: 'pass', player: d.player });
      else if (d.kind === 'chooseObjects') {
        chosen = d.options[0]!;
        // The hand is revealed to Alice (CR 701.20b): her view shows the card she chooses by its id.
        expect(conn.view().objects[chosen]!.defId).toBe('Test Bear');
        await ok(conn, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseObjects', ids: [chosen] } });
      } else throw new Error(`unexpected decision ${d.kind}`);
    }
    expect(chosen, 'Alice chose a card').toBeDefined();
    const discard = conn.events().events.find((e): e is Extract<GameEvent, { type: 'zoneChanged' }> => e.type === 'zoneChanged' && e.from === 'hand' && e.owner === 'p2');
    expect(discard, 'the discard').toBeDefined();
    expect(discard!.oldId).toBe(chosen); // without the state before, every card leaving another player's hand was UNSEEN_ID
  });
});

describe("RPL-0: GameConnection.kind 'replay' (replays design 8)", () => {
  it('a read-only connection of kind replay is a GameConnection, and PacedConnection keeps its kind', () => {
    const view = { pending: null, players: [], zones: {}, objects: {}, result: null } as unknown as GameView;
    const batch: EventBatch = { seq: 0, events: [] };
    const replay: GameConnection = {
      kind: 'replay',
      view: () => view,
      legalActions: () => [],
      act: async () => ({ ok: false, error: { message: 'This is a replay.', rules: [] } }),
      subscribe: () => () => {},
      canUndo: () => false,
      undo: () => false,
      handoff: () => null,
      acceptHandoff: () => {},
      events: () => batch,
    };
    const paced = new PacedConnection(replay);
    expect(paced.kind).toBe('replay');
    expect(paced.legalActions()).toEqual([]);
  });
});

describe('RPL-0: the engine build of the browser (replays design 5)', () => {
  it('is defined for the client (a fixed value in tests)', () => {
    expect(ENGINE_BUILD).toBe('test-engine-build');
  });
});
