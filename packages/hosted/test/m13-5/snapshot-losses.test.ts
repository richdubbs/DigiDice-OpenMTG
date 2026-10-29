/**
 * F31: a snapshot carries the losses up to it (out order, turn, the engine's citations: facts of a change's events, not of the state), so a 3-4 player
 * table where a player has lost recovers from its newest snapshot instead of replaying every record from the start; the result is the same as a full
 * replay. A snapshot without them (written before F31) is still taken only while nobody has lost.
 */
import { createGame, type GameConfig, type GameState } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot } from '../../src/runtime';
import type { SeatNumber } from '../../src/api';
import { TableActor, type TableStep } from '../../src/table';
import { checkpointOf } from '../../src/table/limits';
import { aiMove, configOf, DECKS, Harness } from '../m13-2/harness';

/** Three players (Free-for-All, M12): the two-player AI config plus a third player with the first deck. */
function threePlayers(seed: string): GameConfig {
  const two = configOf(seed, DECKS[0]!, DECKS[1]!);
  return {
    ...two,
    players: [...two.players, { ...two.players[0]!, name: 'Three' }],
    options: { ...two.options, multiplayer: { variant: 'freeForAll', attack: 'multiple' } },
  };
}

describe('F31: recovery from a snapshot after a player has lost', () => {
  it('the snapshot keeps the losses: only the records after it are replayed, and the table equals a full replay', () => {
    const config = threePlayers('f31-three');
    const seating: SeatNumber[] = [1, 2, 3];
    const h = new Harness({ config, game: 'f31', seating, limits: { checkpointEvery: 5 }, scan: false });
    for (let i = 0; i < 6; i++) aiMove(h, 'f31');
    // p2 concedes (CR 104.3a): the game goes on for the other two (CR 800.4a).
    const conceder = h.seatOf('p2');
    expect(h.act(conceder, { type: 'concede', player: 'p2' }).reply).toMatchObject({ ok: true });
    expect(h.state.result).toBeNull();
    const lostAt = h.actor.seq;
    // Play on to the next checkpoint after the loss.
    let at: { seq: number; stateJson: string; hash: string; losses?: unknown; defs: GameState['defs'] } | null = null;
    for (let i = 0; i < 200 && !at && !h.state.result; i++) {
      aiMove(h, 'f31');
      const cp = h.steps[h.steps.length - 1]!.checkpoint;
      if (cp && cp.seq > lostAt && cp.seq === h.actor.seq) at = { ...cp, defs: h.state.defs };
    }
    expect(at, 'a checkpoint after the loss').not.toBeNull();
    expect(at!.losses).toEqual([{ player: 'p2', order: 1, turn: expect.any(Number), rules: expect.anything() }]);
    for (let i = 0; i < 8 && !h.state.result; i++) aiMove(h, 'f31');

    // The snapshot bytes as the worker writes them, read back as the worker reads them.
    const configDefs = createGame(config).defs;
    const added = Object.values(at!.defs).filter((d) => !configDefs[d.id]);
    const back = decodeSnapshot(encodeSnapshot(at!.stateJson, added, at!.losses as never));
    expect(back.losses).toEqual(at!.losses);
    const defs = { ...configDefs };
    for (const d of back.defs) defs[d.id] = d;
    const rest = JSON.parse(back.stateJson) as Omit<GameState, 'defs'>;
    const state = { ...rest, defs } as GameState;

    const replayed: number[] = [];
    const fromSnap = TableActor.recover({
      game: 'f31', config, seating, at: h.at + 1_000, records: h.records, from: { state, seq: at!.seq, losses: back.losses! }, onRecord: (r) => replayed.push(r.seq),
    });
    expect(fromSnap.fromSnapshot).toBe(at!.seq);
    expect(replayed).toEqual(h.records.filter((r) => r.seq > at!.seq).map((r) => r.seq));
    const full = TableActor.recover({ game: 'f31', config, seating, at: h.at + 1_000, records: h.records });
    expect(full.fromSnapshot).toBeNull();
    expect(checkpointOf(fromSnap.actor.state).hash).toBe(checkpointOf(full.actor.state).hash);
    expect(checkpointOf(fromSnap.actor.state).hash).toBe(checkpointOf(h.state).hash);

    // The out order, turn and citations survive: the same concessions end both tables with the same placements.
    const finish = (actor: TableActor): TableStep['end'] => {
      let end: TableStep['end'] = null;
      for (const p of ['p1', 'p3']) {
        if (actor.ended) break;
        const seat = seating[config.players.findIndex((x, i) => (x.id ?? `p${i + 1}`) === p)]!;
        const step = actor.handle({ t: 'act', seat, at: h.at + 2_000, id: 1_000, seq: actor.seq, action: { type: 'concede', player: p } });
        end = step.end ?? end;
      }
      return end;
    };
    const a = finish(fromSnap.actor);
    const b = finish(full.actor);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);

    // A snapshot without the losses (written before F31) is not taken once someone has lost: every record is replayed.
    const old = TableActor.recover({ game: 'f31', config, seating, at: h.at + 1_000, records: h.records, from: { state, seq: at!.seq } });
    expect(old.fromSnapshot).toBeNull();
    // Nor one whose losses do not match its state.
    const wrong = TableActor.recover({ game: 'f31', config, seating, at: h.at + 1_000, records: h.records, from: { state, seq: at!.seq, losses: [] } });
    expect(wrong.fromSnapshot).toBeNull();
  }, 120_000);

  it('snapshot losses are checked against their hash', async () => {
    const { gunzipSync, gzipSync } = await import('node:zlib');
    const bytes = encodeSnapshot('{"a":1}', [], [{ player: 'p2', order: 1, turn: 3, rules: ['CR 104.3a'] }]);
    expect(decodeSnapshot(bytes).losses).toEqual([{ player: 'p2', order: 1, turn: 3, rules: ['CR 104.3a'] }]);
    const text = gunzipSync(bytes).toString('utf8').replace('"turn":3', '"turn":4');
    expect(() => decodeSnapshot(new Uint8Array(gzipSync(Buffer.from(text))))).toThrow(/losses/);
    expect(decodeSnapshot(encodeSnapshot('{"a":1}', [])).losses).toBeUndefined();
  });
});
