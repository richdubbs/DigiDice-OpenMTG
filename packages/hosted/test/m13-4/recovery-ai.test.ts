/**
 * A whole AI game's log through each store (M13-4; design 2.3, D4): the table's steps are committed as the runtime will (group commits of several
 * steps, a snapshot only after its record committed), then the recovery data rebuilds the live state exactly: from the newest snapshot plus the records
 * after it, and from the start with the stored config and seed; every checkpoint hash matches. This is what makes the log's exact JSON text matter
 * (a jsonb column reorders keys, and the replayed state's hash then differs).
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { createGame, type GameConfig, type GameState } from '@openmtg/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HostedStore } from '../../src/store';
import type { LogRecord, RecoveryData } from '../../src/store/api';
import { replayRecords, type TableStep } from '../../src/table';
import { checkpointOf } from '../../src/table/limits';
import { configOf, DECKS, Harness, playAi } from '../m13-2/harness';
import { newGame, T0 } from './fixtures';
import { KITS } from './kits';

const SEED = 'm13-4-recovery-ai-game-seed';
let config: GameConfig;
let steps: TableStep[];
let liveHash: string;
let total: number;

beforeAll(() => {
  config = configOf(SEED, DECKS[0]!, DECKS[1]!);
  const h = new Harness({ config, game: 'ai', limits: { checkpointEvery: 25 } });
  playAi(h, SEED);
  steps = h.steps;
  liveHash = checkpointOf(h.state).hash;
  total = h.records.length;
}, 120_000);

/** Commits the game's steps as the runtime does: every 3 steps one group commit, then the snapshots of the checkpoints it committed. */
async function commitSteps(s: HostedStore, game: string, snapshots: boolean): Promise<void> {
  const { seed, ...stored } = config;
  await s.createGame(newGame(game));
  await s.startGame(game, { config: stored, seed, seating: [1, 2], engineBuild: 'build-1', rulesPack: null, startedAt: T0, node: null });
  let pending: LogRecord[] = [];
  let cps: NonNullable<TableStep['checkpoint']>[] = [];
  for (let i = 0; i < steps.length; i++) {
    pending.push(...steps[i]!.records.map((r) => ({ ...r, game })));
    if (steps[i]!.checkpoint) cps.push(steps[i]!.checkpoint!);
    if ((i + 1) % 3 !== 0 && i !== steps.length - 1) continue;
    if (pending.length > 0) expect(await s.appendRecords(pending)).toEqual({ committed: [game], failed: [] });
    if (snapshots) {
      for (const c of cps) {
        await s.putSnapshot({ game, seq: c.seq, engineBuild: 'build-1', hash: c.hash, state: gzipSync(Buffer.from(c.stateJson, 'utf8')), createdAt: T0 });
      }
    }
    pending = [];
    cps = [];
  }
}

const configOfRecovery = (r: RecoveryData): GameConfig => ({ ...(r.config as Omit<GameConfig, 'seed'>), seed: r.seed }) as GameConfig;

for (const factory of KITS) {
  describe(`M13-4 recovery of an AI game: ${factory.name}`, () => {
    beforeAll(() => factory.setup(), 60_000);
    afterAll(() => factory.teardown());

    it('snapshot plus suffix, and the whole stored log from the start, both give the live state; every checkpoint hash matches', async () => {
      const kit = await factory.make(() => T0);
      try {
        await commitSteps(kit.store, 'with-snaps', true);
        await commitSteps(kit.store, 'log-only', false);
        const s = await kit.reopen();

        const a = await s.loadForRecovery('with-snaps');
        expect(a.lastSeq).toBe(total);
        expect(a.snapshot!.seq).toBe(Math.floor(total / 25) * 25);
        const full = configOfRecovery(a);
        const snapState = JSON.parse(gunzipSync(a.snapshot!.state).toString('utf8')) as Omit<GameState, 'defs'>;
        const fromSnap = replayRecords(full, a.records, { state: { ...snapState, defs: createGame(full).defs } as GameState, seq: a.snapshot!.seq });
        expect(fromSnap.mismatches).toEqual([]);
        expect(checkpointOf(fromSnap.state).hash).toBe(liveHash);

        const b = await s.loadForRecovery('log-only');
        expect(b.snapshot).toBeNull();
        expect(b.records).toHaveLength(total);
        const replay = replayRecords(configOfRecovery(b), b.records);
        expect(replay.mismatches).toEqual([]);
        expect(b.records.filter((r) => r.check).length).toBe(Math.floor(total / 25));
        expect(checkpointOf(replay.state).hash).toBe(liveHash);
      } finally {
        await kit.done();
      }
    }, 120_000);
  });
}
