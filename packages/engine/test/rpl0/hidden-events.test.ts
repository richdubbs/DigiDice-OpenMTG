/**
 * RPL-0 (replays design 6, 14.2): the shared event redaction (core/view-events.ts#eventsFor), the one packages/net and the client both use now. A replay
 * switches between seats, so the events a seat is shown must never say more than that seat's views (CR 400.2).
 *
 * The property test, in the style of M6-3's (test/m6/face-down/hidden-property.test.ts): random games with face-down cards (morph, megamorph, disguise,
 * manifest, cloak, Clone) and games of looting, cycling and discard spells (packages/net's NETFIX2 deck), played by the seeded random bot. After every
 * action, for each seat and the public view, the action's events as a screen gets them (the replayed ones dropped, `replayedEvents`, then `eventsFor`
 * with the state of the view before) are checked against that viewer's views before and after the change, which are the oracle:
 *  - no id names another player's hand card (now, before, or last known as having left the hand) that neither view shows by that id (NETFIX1, NETFIX2);
 *  - another player's draw names a card only if the view after shows it by that id;
 *  - a move names its card only if the view after shows that card (by its new id, or its last known information), or the card went to a public zone;
 *  - a snapshot of a card as it was (`before`) is one of the views' own: the view before showed that object with that definition, or the view after keeps
 *    its last known information with that definition (so a face-down card's snapshot never reaches a player who saw only the face-down 2/2, CR 708.5);
 *  - while another player's cancellable action is in progress, nothing at all (CR 733.1).
 * The open view (`open`) gets every event as the engine returned it.
 */
import { describe, expect, it } from 'vitest';
import {
  eventsFor, replayedEvents, UNSEEN_ID, viewFor, type GameEvent, type GameState, type GameView, type PlayerId,
} from '../../src/index';
import { botGame, discardConfig, faceDownConfig, type PlayedGame } from './games';

const OBJECT_ID = /^o\d+$/;

/** Every string in `x` (deeply). */
function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const v of x) strings(v, out);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) strings(v, out);
  return out;
}

/** The ids of cards in another player's hand in `s`, and of cards last known as having left another player's hand. */
function handLike(s: GameState, viewer: PlayerId | null): Set<string> {
  const out = new Set<string>();
  for (const [owner, ids] of Object.entries(s.zones.hand)) if (owner !== viewer) for (const id of ids) out.add(id);
  for (const [id, l] of Object.entries(s.lki)) if (l.leftZone === 'hand' && l.object.owner !== viewer) out.add(id);
  return out;
}

const shownBy = (v: GameView, id: string): boolean => Object.hasOwn(v.objects, id) || Object.hasOwn(v.lki, id);

function hiddenActionFor(s: GameState, viewer: PlayerId | null): boolean {
  return s.suspended !== null && s.pending !== null && s.pending.cancellable === true && s.pending.player !== viewer;
}

interface Tally { batches: number; events: number; blanked: number; unnamed: number; empty: number }

function check(g: PlayedGame, tally: Tally): void {
  const viewers: (PlayerId | null)[] = [...g.config.players.map((_, i) => `p${i + 1}`), null];
  const views = new Map<PlayerId | null, GameView>(viewers.map((v) => [v, viewFor(g.states[0]!, v)]));
  for (let i = 0; i < g.actions.length; i++) {
    const prev = g.states[i]!;
    const next = g.states[i + 1]!;
    const action = g.actions[i]!;
    for (const viewer of viewers) {
      const where = `${g.config.seed} #${i} (${String(viewer)})`;
      const vb = views.get(viewer)!;
      const va = viewFor(next, viewer);
      views.set(viewer, va);
      const raw = g.events[i]!.slice(replayedEvents(prev, action, viewer));
      const shown: GameEvent[] = eventsFor(next, raw, viewer, { before: prev });
      tally.batches++;
      tally.events += shown.length;
      if (hiddenActionFor(next, viewer)) {
        expect(shown, `${where}: another player's action in progress (CR 733.1)`).toEqual([]);
        tally.empty++;
        continue;
      }
      const hidden = new Set([...handLike(prev, viewer), ...handLike(next, viewer)]);
      for (const e of shown) {
        for (const s of strings(e)) {
          if (!OBJECT_ID.test(s) || !hidden.has(s)) continue;
          if (!shownBy(vb, s) && !shownBy(va, s)) throw new Error(`${where}: the ${e.type} event names ${s}, a hand card the viewer's views do not show by that id`);
        }
        if (e.type === 'drew' && e.player !== viewer) {
          if (e.objectId === UNSEEN_ID) tally.blanked++;
          else if (!Object.hasOwn(va.objects, e.objectId)) throw new Error(`${where}: another player's draw names ${e.objectId}`);
        }
        if (e.type !== 'zoneChanged') continue;
        if (e.name === '') tally.unnamed++;
        else {
          const seen = e.newId !== null && shownBy(va, e.newId) && (va.objects[e.newId]?.defId ?? va.lki[e.newId]?.object.defId) !== '__hidden__';
          if (!seen && (e.to === 'hand' || e.to === 'library')) throw new Error(`${where}: a move into a hidden zone names "${e.name}"`);
        }
        if (e.before) {
          const was = vb.objects[e.oldId]?.defId;
          const kept = va.lki[e.oldId]?.object.defId;
          if (was !== e.before.object.defId && kept !== e.before.object.defId) {
            throw new Error(`${where}: the snapshot of ${e.oldId} (${e.before.object.defId}) is not in the viewer's views (${String(was)}, ${String(kept)})`);
          }
        }
      }
    }
  }
}

describe('RPL-0: the shared event redaction (replays design 6)', { timeout: 300_000 }, () => {
  it('CR 400.2, 708.5, 733.1: no event a seat or the public view is shown says more than its views (property, random games)', () => {
    const tally: Tally = { batches: 0, events: 0, blanked: 0, unnamed: 0, empty: 0 };
    for (let k = 0; k < 3; k++) check(botGame(faceDownConfig(`rpl0-events-fd-${k}`), 400), tally);
    for (let k = 0; k < 3; k++) check(botGame(discardConfig(`rpl0-events-discard-${k}`), 400), tally);
    expect(tally.batches).toBeGreaterThan(3000);
    expect(tally.events).toBeGreaterThan(3000);
    expect(tally.blanked).toBeGreaterThan(50); // other players' draws were redacted
    expect(tally.unnamed).toBeGreaterThan(10); // moves the viewer cannot follow lost their names
    console.log(`RPL-0 event redaction property: ${JSON.stringify(tally)}`);
  });

  it('the open view gets every event as the engine returned it', () => {
    const g = botGame(discardConfig('rpl0-events-open'), 150);
    let n = 0;
    for (let i = 0; i < g.actions.length; i++) {
      const raw = g.events[i]!;
      const open = eventsFor(g.states[i + 1]!, raw, null, { open: true, before: g.states[i]! });
      expect(open).toEqual(raw);
      expect(open).not.toBe(raw);
      n += raw.length;
    }
    expect(n).toBeGreaterThan(100);
  });

  it('CR 400.2: the public view (null) sees no card drawn by anyone and no hand card by its id; the owner sees their own', () => {
    const g = botGame(discardConfig('rpl0-events-public'), 200);
    let draws = 0;
    for (let i = 0; i < g.actions.length; i++) {
      const next = g.states[i + 1]!;
      for (const e of eventsFor(next, g.events[i]!, null, { before: g.states[i]! })) {
        if (e.type === 'drew') {
          draws++;
          expect(e.objectId).toBe(UNSEEN_ID);
        }
        if (e.type === 'zoneChanged' && e.to === 'hand') expect(e).toMatchObject({ name: '', newId: null });
      }
      for (const e of eventsFor(next, g.events[i]!, 'p1', { before: g.states[i]! })) {
        if (e.type === 'drew' && e.player === 'p1' && next.zones.hand['p1']!.includes(e.objectId)) expect(e.objectId).not.toBe(UNSEEN_ID);
      }
    }
    expect(draws).toBeGreaterThan(10);
  });
});
