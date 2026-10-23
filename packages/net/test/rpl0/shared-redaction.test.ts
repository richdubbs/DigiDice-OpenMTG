/**
 * RPL-0 (replays design 2, 6, 13): net's event redaction moved into the engine (`eventsFor`, core/view-events.ts) and net re-exports it (game/redact.ts).
 * The move changed no output: for every action of seeded random games (face-down cards; looting, cycling and discard spells), for each seat, with and
 * without the state before the change, the engine's events are byte for byte the ones net's own function gave (kept as `redact-before.ts`). In process
 * only: no socket is opened.
 */
import { describe, expect, it } from 'vitest';
import { eventsFor as engineEventsFor, replayedEvents } from '@openmtg/engine';
import { eventsFor, UNSEEN_ID } from '../../src/game/redact';
import { eventsFor as before, UNSEEN_ID as BEFORE_UNSEEN } from './redact-before';
import { botGame, discardConfig, faceDownConfig } from '../../../engine/test/rpl0/games';

describe('RPL-0: net redaction through the engine (CR 400.2)', { timeout: 300_000 }, () => {
  it('net re-exports the engine function, and the unseen id is still ""', () => {
    expect(eventsFor).toBe(engineEventsFor);
    expect(UNSEEN_ID).toBe(BEFORE_UNSEEN);
  });

  it('gives the same events, byte for byte, as net gave before the move (NETFIX1, NETFIX2)', () => {
    let compared = 0;
    let redacted = 0;
    const games = [
      botGame(discardConfig('rpl0-net-a'), 400), botGame(discardConfig('rpl0-net-b'), 400), botGame(faceDownConfig('rpl0-net-c'), 400),
    ];
    for (const g of games) {
      for (let i = 0; i < g.actions.length; i++) {
        const prev = g.states[i]!;
        const next = g.states[i + 1]!;
        for (const seat of ['p1', 'p2']) {
          const raw = g.events[i]!.slice(replayedEvents(prev, g.actions[i]!, seat));
          for (const opts of [{}, { before: prev }]) {
            const now = JSON.stringify(eventsFor(next, raw, seat, opts));
            expect(now, `${g.config.seed} #${i} ${seat}`).toBe(JSON.stringify(before(next, raw, seat, opts)));
            if (now !== JSON.stringify(raw)) redacted++;
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(3000);
    expect(redacted).toBeGreaterThan(100);
  });
});
