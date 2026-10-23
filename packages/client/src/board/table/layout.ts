/**
 * M12-4a (docs/design/m12-multiplayer.md 5.1, 5.2): which table the board draws, and the "one focused opponent" layout's focus. Pure, from the view.
 *
 * Settings.tableLayout (M12-1) chooses for a game with more than two players: the shared table (the default), every opponent across the top (today's arena
 * board with a seat per opponent), or one focused opponent with the others as strips. A two-player game is the same in every layout: today's arena board
 * (the viewer near, the opponent across, both full width), so nothing changes for it.
 */
import type { GameView, PlayerId } from '@openmtg/engine';
import type { TableLayout } from '../../settings/settings';
import { stackItems } from '../model';

export type { TableLayout };

/** The board actually drawn: 'duel' is today's two-player arena board. */
export type BoardLayout = 'duel' | TableLayout;

export function boardLayout(view: GameView, setting: TableLayout | undefined): BoardLayout {
  if (view.players.length <= 2) return 'duel';
  return setting ?? 'shared';
}

/** The opponents of `viewer` in seating order from the next player (CR 101.4), players who left included (their seat stays). */
export function opponentsInOrder(view: GameView, viewer: PlayerId): PlayerId[] {
  const ids = view.players.map((p) => p.id);
  const i = Math.max(0, ids.indexOf(viewer));
  return [...ids.slice(i + 1), ...ids.slice(0, i)];
}

/**
 * Who threatens the viewer right now (5.2): a player whose creatures attack the viewer or a planeswalker or battle of theirs (CR 508.1b), else the controller
 * of the topmost spell or ability on the stack that targets the viewer or one of their permanents (CR 115.1). Null when nobody does.
 */
export function threatTo(view: GameView, viewer: PlayerId): PlayerId | null {
  const mine = (id: string | null) => id !== null && (id === viewer || view.objects[id]?.controller === viewer);
  const attackers = view.combat?.attackers ?? [];
  for (const a of attackers) {
    if (!mine(a.defender)) continue;
    const c = view.objects[a.id]?.controller;
    if (c && c !== viewer) return c;
  }
  for (const item of stackItems(view)) {
    if (item.controller === viewer) continue;
    if (item.targets.some((t) => mine(t))) return item.controller;
  }
  return null;
}

/**
 * The opponent drawn large in the "one focused opponent" layout (5.2): the focus starts on the player whose turn it is and moves to a player who attacks or
 * targets the viewer while that lasts. A strip the viewer clicked (`picked`) holds the focus until the automatic choice changes (`pickedOver`: the
 * automatic focus when it was clicked), so a new attack or a new turn still brings the right player forward.
 */
export function focusedOpponent(view: GameView, viewer: PlayerId, picked?: { player: PlayerId; over: PlayerId | null } | null): PlayerId | null {
  const opponents = opponentsInOrder(view, viewer);
  if (opponents.length === 0) return null;
  const auto = autoFocus(view, viewer, opponents);
  if (picked && picked.over === auto && opponents.includes(picked.player)) return picked.player;
  return auto;
}

export function autoFocus(view: GameView, viewer: PlayerId, opponents: readonly PlayerId[] = opponentsInOrder(view, viewer)): PlayerId | null {
  const inGame = opponents.filter((id) => !view.players.find((p) => p.id === id)?.hasLost);
  const threat = threatTo(view, viewer);
  if (threat && opponents.includes(threat)) return threat;
  const active = view.turn.number > 0 ? view.turn.activePlayer : null;
  if (active && inGame.includes(active)) return active;
  return inGame[0] ?? opponents[0] ?? null;
}
