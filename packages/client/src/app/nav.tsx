/**
 * State-based navigation (no router, docs/design/m8-client.md "Dependencies"): the current route lives in React state with a back stack. Screens call
 * `useNav().go(...)`. Routes carry their own parameters; a game route carries its connection. A change of screen plays ui.navigate.
 *
 * RPL-1 (replays design 7.1): a game whose route leaves the back stack (Home, New game, another tab, a rematch) has left the game screen for good, and
 * its replay is saved then (replays/live.ts; Settings, About and the other screens the game's Menu opens keep it on the stack, so they do not). Soon after the page opens, the games
 * a closed tab or a crash left unfinished become abandoned replays (replays/record.ts), where the browser has IndexedDB to keep them in. A replay being
 * watched whose route leaves the back stack is disposed then: its clock, its background indexing and its check stop (replays/viewer/controllerOf.ts,
 * which brings no replay code into this chunk).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sfx } from '../audio/sfx';
import type { GameConnection } from '../connection/GameConnection';
import type { PlayerSleeves } from '../board/sleeves';
import type { HostedLink } from '../hosted/HostedLink';
import type { OnlineLink } from '../online/OnlineLink';
import type { GameSetup } from '../game/NewGameScreen';
import { leftGameScreen } from '../replays/live';
import { replayControllerOf } from '../replays/viewer/controllerOf';

export type Route =
  | { screen: 'home' }
  | { screen: 'decks' }
  | { screen: 'deckbuilder'; deckId?: string }
  | { screen: 'images' }
  /** RPL-1 (replays design 10): the replay library. Watching a replay opens the game route with a replay connection. */
  | { screen: 'replays' }
  /** M11-2 (INTERFACE CHANGE): `deckId` opens New game with that deck for player 1 (the deckbuilder's "Play this deck"). */
  | { screen: 'newGame'; deckId?: string; setup?: GameSetup }
  /** Milestone 9: host or join an online game (online/HostScreen.tsx, online/JoinScreen.tsx). */
  | { screen: 'hostOnline' }
  | { screen: 'joinOnline' }
  /** Milestone 13 (hosted design 12): play on the DigiDice server: a private table by invite code, its waiting room and ready check (hosted/room/HostedScreen.tsx). */
  | { screen: 'hosted' }
  /**
   * `rematch`, when the screen that opened the game can start the same game again, makes a fresh connection (the game screen never builds one).
   * `online`: the link of an online game (milestone 9), for what the game screen adds online: Leave ends the game for both sides, the host's consent to
   * the guest's adjustments by hand, chat. It holds only what the local server sends this player (its own view, CR 400.2).
   * `sleeves`: each player's deck sleeve for their card backs (board/sleeves.tsx); absent, everyone has the classic back.
   * `setup`: what New game started the game with, for a rematch with other decks (the end screen's "Change decks" opens New game with it).
   * `hosted` (milestone 13): the link of a game on the DigiDice server, for what the game screen adds there: the clocks and the rope, the server's notices,
   * chat, the approval of other players' adjustments by hand, the result with its placements; Leave concedes the game and leaves the table.
   */
  | { screen: 'game'; connection: GameConnection; rematch?: () => GameConnection; online?: OnlineLink; hosted?: HostedLink; sleeves?: PlayerSleeves; setup?: GameSetup }
  | { screen: 'settings' }
  | { screen: 'about' };

export type ScreenName = Route['screen'];

export interface Nav {
  route: Route;
  /** Open a screen; the current one goes on the back stack. */
  go(route: Route): void;
  /** Return to the previous screen (Home when there is none). */
  back(): void;
  /** Open a screen and forget the back stack (e.g. leaving a finished game). */
  reset(route?: Route): void;
  /**
   * Switch to a section (the top bar's tabs, the game menu): the same as `reset`, except that a game on the back stack stays there, under the new screen,
   * so the game keeps going and "Back to game" returns to it (owner, 2026-10-25: every menu stays usable in a game without leaving it).
   */
  open(route: Route): void;
  /** The game on the back stack under the current screen, if any. */
  inGame: boolean;
  /** Return to that game (the screens above it close). */
  toGame(): void;
}

const NavContext = createContext<Nav | null>(null);

/** The connections of the game routes on a back stack. */
const gamesOn = (stack: readonly Route[]): GameConnection[] => stack.flatMap((r) => (r.screen === 'game' ? [r.connection] : []));

/** Where the topmost game route is on a back stack (-1: none). */
const gameIndex = (stack: readonly Route[]): number => stack.map((r) => r.screen).lastIndexOf('game');

/** Once per page, after it has opened: the start-up sweep of unfinished games (replays/record.ts, loaded only then and only with IndexedDB). */
let sweepScheduled = false;
function scheduleReplaySweep(): void {
  if (sweepScheduled || typeof indexedDB === 'undefined') return;
  sweepScheduled = true;
  setTimeout(() => {
    void import('../replays/record').then((m) => m.sweepOnStart()).catch((e: unknown) => console.error('[Replays] start-up sweep', e));
  }, 2000);
}

export function NavProvider({ initial = { screen: 'home' }, children }: { initial?: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([initial]);
  // The stack as the last change left it: each change is worked out here, not in a state updater, so its sound (ui.navigate when the screen changes)
  // plays once and within the click that asked for it (audio/uiSounds.ts then leaves out the generic click).
  const current = useRef(stack);
  // Back plays the sweep mirrored (right to left), the way the screen goes.
  const change = useCallback((next: (s: Route[]) => Route[], backwards = false) => {
    const before = current.current;
    const after = next(before);
    current.current = after;
    if (before[before.length - 1]!.screen !== after[after.length - 1]!.screen) sfx('ui.navigate', backwards ? { mirror: true } : undefined);
    setStack(after);
    const still = new Set(gamesOn(after));
    for (const c of gamesOn(before)) {
      if (still.has(c)) continue;
      leftGameScreen(c);
      replayControllerOf(c)?.dispose();
    }
  }, []);
  useEffect(scheduleReplaySweep, []);
  const go = useCallback((route: Route) => change((s) => [...s, route]), [change]);
  const back = useCallback(() => change((s) => (s.length > 1 ? s.slice(0, -1) : [{ screen: 'home' }]), true), [change]);
  const reset = useCallback((route: Route = { screen: 'home' }) => change(() => [route]), [change]);
  const open = useCallback(
    (route: Route) =>
      change((s) => {
        const game = gameIndex(s);
        return game < 0 ? [route] : [...s.slice(0, game + 1), route];
      }),
    [change],
  );
  const toGame = useCallback(
    () =>
      change((s) => {
        const game = gameIndex(s);
        return game < 0 ? s : s.slice(0, game + 1);
      }, true),
    [change],
  );
  const route = stack[stack.length - 1]!;
  const inGame = route.screen !== 'game' && gameIndex(stack) >= 0;
  const nav = useMemo(() => ({ route, go, back, reset, open, inGame, toGame }), [route, go, back, reset, open, inGame, toGame]);
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

/** The navigation, or null outside a NavProvider (a component also rendered on its own, as the end screen is in tests). */
export function useOptionalNav(): Nav | null {
  return useContext(NavContext);
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside <NavProvider>');
  return nav;
}
