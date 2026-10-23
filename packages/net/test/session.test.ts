/**
 * The host's online session (audit 2026-10-12, M4: no history of states), session tokens (M3: compared as bytes, any encoding refused without a
 * throw) and the `setStops` verdict (M4: nothing applied when unchanged or after the game is over, CR 104.1). Called directly: no sockets.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_STOPS, type GameConfig } from '@openmtg/engine';
import { prepareDeck } from '../src/game/deck';
import { newSessionToken, OnlineSession, sameSessionToken } from '../src/game/session';
import { normalizeSteps, sameStops, stopsVerdict } from '../src/game/stops';
import { deck, fixtureDb } from './helpers';

async function config(): Promise<GameConfig> {
  const p = await prepareDeck(deck({ Forest: 20, 'Grizzly Bears': 20 }), { cards: fixtureDb(), format: 'casual' });
  if (!p.ok) throw new Error(p.errors.join('; '));
  return { seed: 'session-1', players: [{ id: 'p1', name: 'A', deck: p.deck.main }, { id: 'p2', name: 'B', deck: p.deck.main }], defs: p.deck.defs };
}

describe('session tokens (audit M3)', () => {
  it('are 32 lowercase hex digits; only the same token matches', () => {
    const t = newSessionToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(sameSessionToken(t, t)).toBe(true);
    expect(sameSessionToken(newSessionToken(), t)).toBe(false);
    expect(sameSessionToken(t.toUpperCase(), t)).toBe(false);
  });

  it('a token with multibyte characters (same UTF-16 length, longer in UTF-8) is refused without throwing', () => {
    const t = newSessionToken();
    for (const bad of ['é'.repeat(32), '😀'.repeat(16), `${t.slice(0, 31)}é`, '', null, 42, { length: 32 }]) {
      expect(() => sameSessionToken(bad, t)).not.toThrow();
      expect(sameSessionToken(bad, t)).toBe(false);
    }
  });
});

describe('online session (audit M4)', () => {
  it('keeps the current state and the action log, not a state per action', async () => {
    const s = new OnlineSession(await config());
    const before = s.state;
    const p = s.state.pending;
    expect(p).toBeTruthy();
    const r = s.apply({ type: 'setStops', player: 'p2', stops: { ownTurn: ['upkeep'], opponentTurn: [], fullControl: false } });
    expect(r.ok).toBe(true);
    expect(s.actions).toHaveLength(1);
    expect(s.state).not.toBe(before);
    expect(Object.keys(s).some((k) => /history/i.test(k))).toBe(false);
    const bad = s.apply({ type: 'pass', player: 'p1' });
    if (!bad.ok) expect(s.actions).toHaveLength(1); // a refused action changes nothing
  });
});

describe('setStops verdict (audit M4)', () => {
  it('normalizes step lists: no repeats, turn order (CR 500.1)', () => {
    expect(normalizeSteps(['end', 'upkeep', 'end', 'bogus'])).toEqual(['upkeep', 'end']);
    expect(sameStops({ ownTurn: ['end', 'upkeep'], opponentTurn: [], fullControl: false }, { ownTurn: ['upkeep', 'end', 'end'], opponentTurn: [], fullControl: false })).toBe(true);
    expect(sameStops({ ownTurn: [], opponentTurn: [], fullControl: true }, { ownTurn: [], opponentTurn: [], fullControl: false })).toBe(false);
  });

  it('applies a change, skips an unchanged one, and refuses any once the game is over (CR 104.1)', async () => {
    const s = new OnlineSession(await config());
    const current = s.state.players.find((p) => p.id === 'p2')!.stops;
    expect(stopsVerdict(s.state, { type: 'setStops', player: 'p2', stops: { ...current } })).toBe('unchanged');
    const changed = { ...DEFAULT_STOPS, fullControl: !current.fullControl };
    expect(stopsVerdict(s.state, { type: 'setStops', player: 'p2', stops: changed })).toBeNull();
    expect(stopsVerdict(s.state, { type: 'pass', player: 'p2' })).toBeNull();
    expect(s.apply({ type: 'concede', player: 'p2' }).ok).toBe(true);
    expect(s.state.result).toBeTruthy();
    expect(stopsVerdict(s.state, { type: 'setStops', player: 'p2', stops: changed })).toBe('over');
  });
});
