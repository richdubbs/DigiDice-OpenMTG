/**
 * M12-4a (docs/design/m12-multiplayer.md 5.1 "Seats", 5.2): who sits where at the shared table (CR 101.4, 103.1: clockwise in turn order), seat views as a
 * half turn of the table, the placement of a player who left (D10), which layout is drawn, and the focused opponent.
 */
import { describe, expect, it } from 'vitest';
import type { GameView } from '@openmtg/engine';
import { autoFocus, boardLayout, focusedOpponent, opponentsInOrder, threatTo } from '../../src/board/table/layout';
import { isAcross, ordinal, placementLabel, relationOf, seatOrder, tableSeating } from '../../src/board/table/seats';
import { tableState, viewOf, withLeft } from './fixtures';

const seatsOf = (v: GameView, viewer: string, turned = false) => Object.fromEntries(tableSeating(v, viewer, turned).all.map((s) => [s.player.name, `${s.pos}/${s.relation}/${s.key}`]));

describe('seating (5.1)', () => {
  it('4 players: the viewer near-left, the next player across-left, then across-right, the previous player near-right (clockwise from above)', () => {
    const v = viewOf(tableState(4), 'p1');
    expect(seatsOf(v, 'p1')).toEqual({ Alice: 'nearLeft/you/1', Bianca: 'farLeft/next/2', Carol: 'farRight/across/3', Dmitri: 'nearRight/previous/4' });
    // every player sees themselves near-left, with the same clockwise order
    expect(seatsOf(viewOf(tableState(4), 'p3'), 'p3')).toEqual({ Carol: 'nearLeft/you/1', Dmitri: 'farLeft/next/2', Alice: 'farRight/across/3', Bianca: 'nearRight/previous/4' });
    const t = tableSeating(v, 'p1');
    expect(t.far.map((s) => s.col)).toEqual([0, 1]);
    expect(t.near.map((s) => s.player.name)).toEqual(['Alice', 'Dmitri']);
  });

  it('3 players: the viewer has the whole near side, the next player across-left, the previous across-right', () => {
    const v = viewOf(tableState(3), 'p2');
    expect(seatsOf(v, 'p2')).toEqual({ Bianca: 'near/you/1', Carol: 'farLeft/next/2', Alice: 'farRight/previous/3' });
    expect(tableSeating(v, 'p2').near[0]!.span).toBe(2);
  });

  it('2 players: near and far, both full width', () => {
    const v = viewOf(tableState(2), 'p2');
    expect(seatsOf(v, 'p2')).toEqual({ Bianca: 'near/you/1', Alice: 'far/next/2' });
  });

  it('a seat view across the table turns it half round: every seat to the opposite place, still clockwise', () => {
    const v = viewOf(tableState(4), 'p1');
    expect(isAcross(v, 'p1', 'p2')).toBe(true);
    expect(isAcross(v, 'p1', 'p4')).toBe(false);
    expect(isAcross(v, 'p1', null)).toBe(false);
    expect(seatsOf(v, 'p1', true)).toEqual({ Alice: 'farRight/you/1', Bianca: 'nearRight/next/2', Carol: 'nearLeft/across/3', Dmitri: 'farLeft/previous/4' });
    // 3 players turned: the two opponents come near, the viewer goes across
    const v3 = viewOf(tableState(3), 'p1');
    expect(seatsOf(v3, 'p1', true)).toEqual({ Alice: 'far/you/1', Bianca: 'nearRight/next/2', Carol: 'nearLeft/previous/3' });
  });

  it('a spectator view (hot-seat hand-off) seats the active player near', () => {
    const v = { ...viewOf(tableState(4), 'p1'), viewer: null };
    expect(tableSeating(v, null).near[0]!.player.id).toBe(v.turn.activePlayer);
  });

  it('seatOrder and relations', () => {
    const v = viewOf(tableState(4), 'p1');
    expect(seatOrder(v.players, 'p3').map((p) => p.id)).toEqual(['p3', 'p4', 'p1', 'p2']);
    expect([0, 1, 2, 3].map((i) => relationOf(i, 4))).toEqual(['you', 'next', 'across', 'previous']);
    expect([0, 1, 2].map((i) => relationOf(i, 3))).toEqual(['you', 'next', 'previous']);
  });

  it('a player who left keeps their place; the plate names their finishing place and how they lost (D10)', () => {
    const s = withLeft(withLeft(tableState(4), 'p2', 1, '21 combat damage from Isamaru'), 'p4', 2, 'has 0 or less life');
    const v = viewOf(s, 'p1');
    expect(seatsOf(v, 'p1').Bianca).toBe('farLeft/next/2');
    expect(placementLabel(v, 'p2')).toBe('4th: 21 combat damage from Isamaru');
    expect(placementLabel(v, 'p4')).toBe('3rd: has 0 or less life');
    expect(placementLabel(v, 'p1')).toBeNull();
    expect(ordinal(1)).toBe('1st');
  });
});

describe('which board is drawn (5.2)', () => {
  it('a two-player game is always today\'s board; 3-4 players follow the setting (shared by default)', () => {
    expect(boardLayout(viewOf(tableState(2), 'p1'), 'shared')).toBe('duel');
    expect(boardLayout(viewOf(tableState(2), 'p1'), 'focused')).toBe('duel');
    expect(boardLayout(viewOf(tableState(3), 'p1'), undefined)).toBe('shared');
    expect(boardLayout(viewOf(tableState(4), 'p1'), 'acrossTop')).toBe('acrossTop');
    expect(boardLayout(viewOf(tableState(4), 'p1'), 'focused')).toBe('focused');
  });
});

describe('one focused opponent (5.2)', () => {
  it('starts on the player whose turn it is; on the viewer\'s own turn, the next player', () => {
    const s = tableState(4);
    expect(opponentsInOrder(viewOf(s, 'p1'), 'p1')).toEqual(['p2', 'p3', 'p4']);
    expect(autoFocus(viewOf(s, 'p1'), 'p1')).toBe('p2');
    const theirs = structuredClone(s);
    theirs.turn.activePlayer = 'p3';
    expect(focusedOpponent(viewOf(theirs, 'p1'), 'p1')).toBe('p3');
  });

  it('moves to a player who attacks the viewer, or targets them or their permanents, while that lasts', () => {
    const s = structuredClone(tableState(4));
    s.turn.activePlayer = 'p3';
    const bear = s.zones.battlefield.find((oid) => s.objects[oid]!.controller === 'p4')!;
    s.combat = { attackers: [{ id: bear, defender: 'p1', blocked: false }], blockers: [] } as unknown as typeof s.combat;
    const v = viewOf(s, 'p1');
    expect(threatTo(v, 'p1')).toBe('p4');
    expect(focusedOpponent(v, 'p1')).toBe('p4');
  });

  it('a clicked strip holds the focus until the automatic choice changes; a player who left is never chosen automatically', () => {
    const s = tableState(4);
    const v = viewOf(s, 'p1');
    expect(focusedOpponent(v, 'p1', { player: 'p4', over: 'p2' })).toBe('p4');
    const later = structuredClone(s);
    later.turn.activePlayer = 'p3';
    expect(focusedOpponent(viewOf(later, 'p1'), 'p1', { player: 'p4', over: 'p2' })).toBe('p3');
    expect(autoFocus(viewOf(withLeft(s, 'p2', 1, 'conceded'), 'p1'), 'p1')).toBe('p3');
  });
});
