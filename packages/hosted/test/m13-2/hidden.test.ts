/**
 * Hidden information at the table (design 6.3, 6.4 table level): the scan the AI games run is not vacuous (it catches a planted hand id and a planted
 * card name), events name another seat's hidden hand cards only by the aliases of the seat's own view (the M13-2 finding about net's `eventsFor` and
 * `drew`), and while a seat is in the middle of a cancellable action the others see the state it started from and no events (CR 733.1, CR 400.2).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, viewFor, type GameEvent } from '@openmtg/engine';
import { eventsFor } from '@openmtg/net/server-kit';
import { seatEvents } from '../../src/table';
import { aiMove, configOf, DECKS, fixtureConfig, Harness, playAi, scanHidden, toCast } from './harness';

describe('M13-2: hidden information', () => {
  it('the scan catches a hidden hand id or a never-shown hidden card name planted in a payload', () => {
    const h = new Harness({ config: fixtureConfig('m13-2-scan', { Mountain: 20, 'Lightning Bolt': 20 }, { Forest: 20, 'Craw Wurm': 20 }), game: 'scan' });
    for (let i = 0; i < 5 && (h.state.zones.hand[h.b(2).player] ?? []).length === 0; i++) aiMove(h, 'scan');
    const s = h.state;
    const b1 = h.b(1);
    const hidden = s.zones.hand[h.b(2).player]![0]!;
    expect(hidden).toBeDefined();
    expect(() => scanHidden(s, b1, `{"x":"${hidden}"}`)).toThrow(/real id/);
    expect(b1.known.has('Craw Wurm')).toBe(false);
    expect(() => scanHidden(s, b1, '{"text":"Two draws Craw Wurm."}')).toThrow(/name of a hidden card/);
    expect(() => scanHidden(s, b1, `{"x":"${s.seed}"}`)).toThrow(/seed/);
    expect(() => scanHidden(s, b1, '{"text":"One draws Lightning Bolt."}')).not.toThrow(); // seat 1's own cards
  });

  it("events never name another seat's hidden hand card: drew ids and the old ids of moves out of that hand are '' (and net's eventsFor agrees since NETFIX2)", () => {
    const config = configOf('m13-2-drew', DECKS[0]!, DECKS[2]!);
    const h = new Harness({ config, game: 'drew', scan: false });
    playAi(h, 'm13-2-drew', 40);
    // replay, and look at each change's events for seat 1
    let s = createGame(config);
    let drew = 0;
    let moved = 0;
    for (const r of h.records) {
      const prevState = s;
      const out = applyAction(s, r.action);
      s = out.state;
      if (s.suspended) continue;
      const p2 = h.b(2).player;
      const raw = eventsFor(s, out.events, h.b(1).player);
      const prevView = viewFor(prevState, h.b(1).player);
      const view = viewFor(s, h.b(1).player);
      const mine = seatEvents(s, out.events, h.b(1).player, view, { state: prevState, view: prevView });
      raw.forEach((e, i) => {
        const m = mine[i]!;
        if (e.type === 'drew' && e.player === p2) {
          expect(e.objectId).toBe(''); // NETFIX2: net's eventsFor blanks it too
          expect(m).toEqual({ ...e, objectId: '' });
          drew++;
        }
        if (e.type === 'zoneChanged' && e.from === 'hand' && e.owner === p2) {
          expect(m).toEqual({ ...e, oldId: '' });
          moved++;
        }
      });
    }
    expect(drew).toBeGreaterThan(3);
    expect(moved).toBeGreaterThan(3);
  });

  // M13-2 re-review B (engine, NETFIX2 on fix/netfix2): core/view.ts redactHistory keeps a discarded card's old hidden hand id (`facts.id`) in another
  // seat's view. Marked `fails` until fix/netfix2 is merged into this branch: then this test fails as "expected to fail", and `.fails` comes off.
  it('a discard and looting game: no view or event names a hidden hand card (NETFIX2 in main)', () => {
    const h = new Harness({ config: fixtureConfig('m13-2-loot', { Mountain: 18, 'Faithless Looting': 22 }, { Forest: 20, 'Grizzly Bears': 20 }), game: 'loot' });
    let looted = 0;
    for (let i = 0; i < 400 && !h.actor.ended; i++) {
      const d = h.state.pending!;
      const b = h.b(h.seatOf(d.player));
      const pick = d.kind === 'priority' ? (b.legal.find((l) => l.kind === 'cast') ?? b.legal.find((l) => l.kind === 'playLand')) : undefined;
      if (pick) {
        if (pick.kind === 'cast') looted++;
        h.act(b.seat, pick.action);
      } else aiMove(h, 'loot');
    }
    expect(looted).toBeGreaterThan(2);
  }, 120_000);

  it('while a seat is in the middle of a cancellable action, the others see the state it started from and get no events (CR 733.1)', () => {
    const h = new Harness({ config: fixtureConfig('m13-2-mid', { Mountain: 20, 'Lightning Bolt': 20 }, { Forest: 20, 'Grizzly Bears': 20 }), game: 'mid' });
    const cast = toCast(h, 'mid');
    const seat = h.seatOf(h.state.pending!.player);
    const other = seat === 1 ? 2 : 1;
    const before = JSON.stringify(h.b(other).view!.zones);
    const { step } = h.act(seat, cast.action);
    expect(h.state.suspended).not.toBeNull();
    const patch = h.sent(step, other, 'patch')[0]!;
    expect(patch.events).toEqual([]);
    expect(JSON.stringify(h.b(other).view!.zones)).toBe(before); // the card is not on the stack for them yet
    expect(h.b(other).view!.zones.stack).toEqual([]);
  });
});
