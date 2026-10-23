/**
 * RPL-3 test fixtures of a game the host shares (packages/net record.ts): the host's record of a played game as its server would hold it after the end,
 * the views the host sends a guest, and a guest page (a fake local server socket: normal traffic only) that was shown the whole game and kept its
 * recording.
 */
import { checkpointsOf, currentEngine, legalActions, viewFor, type GameState, type PlayerId } from '@openmtg/engine';
import { endingOf, type OnlineRecordData } from '@openmtg/net';
import type { OnlineStatus, ServerMessage } from '@openmtg/server/online';
import { RemoteConnection } from '../../src/connection/RemoteConnection';
import { OnlineGuestRecorder } from '../../src/online/recording';
import type { ReplayEnv } from '../../src/replays/env';
import type { PlayedGame } from '../../../engine/test/rpl0/games';
import { fakeLink, flush } from '../online-fakes';

/** The engine build the record says it was played by (the guests' test environments have it too). */
export const SHARED_BUILD = 'test-engine-build';
export const SHARED_APP = { version: '9.9.9', commit: null };

/** The host's record of `g` (packages/net record.ts), as its server would hold it after the end. */
export function recordOf(g: PlayedGame, o: { names?: [string, string]; actions?: number } = {}): OnlineRecordData {
  const actions = g.actions.slice(0, o.actions ?? g.actions.length);
  const names = o.names ?? ['Alice', 'Bob'];
  const config = { ...g.config, players: g.config.players.map((p, i) => ({ ...p, id: `p${i + 1}`, name: names[i]! })) };
  const final = g.states[actions.length]!;
  const ending = endingOf(final);
  return {
    start: {
      version: 1, id: 'r-0000000000000000host', startedAt: '2026-10-22T10:00:00.000Z', startMs: Date.UTC(2026, 9, 22, 10), format: 'casual', host: 'p1',
      players: names.map((name, i) => ({ id: `p${i + 1}`, name, kind: 'person' as const })), engine: currentEngine(SHARED_BUILD), config,
    },
    actions,
    times: actions.map((_, i) => i * 500),
    checkpoints: checkpointsOf(config, actions).checkpoints,
    agreed: ['p1', 'p2'],
    end: ending ? { ...ending, actions: actions.length, endedAt: '2026-10-22T10:30:00.000Z', checkpoint: null } : null,
  };
}

/** A guest's status of the game whose replay id is `id`. */
export const guestStatus = (me: PlayerId, id: string, replay: Partial<NonNullable<OnlineStatus['replay']>> = {}): OnlineStatus => ({
  role: 'guest', phase: 'playing', me, format: 'casual', warnings: [], opponent: 'Alice', opponentConnected: true, replay: { id, agree: true, shared: false, ...replay },
});

/** The view the host sends `me` after `seq` actions (no events). */
export const viewMsg = (s: GameState, seq: number, me: PlayerId): Extract<ServerMessage, { t: 'view' }> =>
  JSON.parse(JSON.stringify({ t: 'view', seq, view: viewFor(s, me), events: [], legal: legalActions(s, me) }));

/** A guest page (p2) of the game `id`, shown every state of `g` and its recording saved in `env`: its fake link and its recorder. */
export async function recordedGuest(g: PlayedGame, env: ReplayEnv, id: string) {
  const f = fakeLink({ initial: [{ t: 'status', status: guestStatus('p2', id) }, viewMsg(g.states[0]!, 0, 'p2')] });
  await f.link.connect();
  const recorder = OnlineGuestRecorder.start(new RemoteConnection(f.link), f.link, env);
  await flush();
  for (let i = 1; i < g.states.length; i++) f.socket().push(viewMsg(g.states[i]!, i, 'p2'));
  await recorder.finish();
  return { f, recorder };
}
