/**
 * M12-1 (docs/design/m12-multiplayer.md 4.2-4.5, review finding 6): the contracts of milestone 12. The `seat` player reference ("the player to your left /
 * right", D6) is classified by ONE table, `PLAYER_ONLY_REFS`, and resolved, fixed, matched, rendered and capability-walked the same way on every path that
 * reads player references: effects/refs.ts (resolvePlayers, resolveRecipients), effects/handlers/lasting-fix.ts (lockSet), effects/handlers/actions-native.ts
 * (a vote whose subject stands for players), model/cap-walk.ts, statics/match.ts (isPlayerRef, playersOf), render/refs.ts, render/np.ts, render/state.ts,
 * triggers/cond.ts, triggers/filters.ts and rules/targets.ts (announcedPlayers). Plus the state, event and decision fields M12-2..M12-6 write.
 */
import { describe, expect, it } from 'vitest';
import {
  ABILITY_MODEL_VERSION, ENGINE_CAPABILITIES, PLAYER_ONLY_REFS, capabilitiesOf, isPlayerOnlyRef, isPlayerOnlyRefKind, renderAbility, renderGate, validateAbility,
  type AbilityDef, type Decision, type DecisionAsker, type GameEvent, type ObjRef, type PlayerOnlyRefKind, type PlayerRef,
} from '../../../src/index';
import { Game } from '../../../src/core/game';
import { resolvePlayers, resolveRecipients } from '../../../src/effects/refs';
import { lockSet } from '../../../src/effects/handlers/lasting-fix';
import { isPlayerRef as staticIsPlayerRef, playersOf } from '../../../src/statics/match';
import { isPlayerRef as renderIsPlayerRef } from '../../../src/render/refs';
import { renderFilter } from '../../../src/render/filter';
import { playerKey } from '../../../src/render/state';
import { localCondition } from '../../../src/triggers/cond';
import { playerMatches } from '../../../src/triggers/filters';
import { announcedPlayers } from '../../../src/rules/targets';
import schema from '../../../src/model/schema.generated.json';
import { cloneObject, cloneState } from '../../../src/util/clone';
import { ctxOn } from '../../m5/eval/helpers';
import { act, answer, find, passBoth, scenario, synth } from '../../m5/helpers';
import { drive } from '../../m5/announce/support';
import { mainPhaseGame } from './helpers';

const LEFT: PlayerRef = { ref: 'seat', side: 'left' };
const RIGHT: PlayerRef = { ref: 'seat', side: 'right' };
const LEFT_OF_ACTIVE: PlayerRef = { ref: 'seat', side: 'left', of: { ref: 'active' } };

/** A 4-player game at p1's first main phase (p1 p2 p3 p4 in turn order, CR 101.4), and an effect context of p1's (a card in p1's library). */
function fourPlayers(lost: string[] = []) {
  const s = cloneState(mainPhaseGame(4, 'm12-contracts'));
  for (const p of s.players) if (lost.includes(p.id)) p.hasLost = true;
  const card = s.zones.library['p1']![0]!;
  return { s, cx: ctxOn(s, card) };
}

// Type-level pin (checked by `npm run typecheck`): every PlayerRef kind that no ObjRef has is in PLAYER_ONLY_REFS. A new kind fails to compile in
// types/ability.ts (its Record) until it is listed; this line fails if the table and the union ever disagree the other way.
type Unlisted = Exclude<Exclude<PlayerRef['ref'], ObjRef['ref']>, PlayerOnlyRefKind>;
const ALL_LISTED: [Unlisted] extends [never] ? true : false = true;

describe('M12-1: PLAYER_ONLY_REFS, the one table of player-only references (m12 design 4.3, review finding 6)', () => {
  it('lists exactly the PlayerRef kinds no ObjRef has, seat included; the shared kinds are not in it', () => {
    expect(ALL_LISTED).toBe(true);
    expect([...PLAYER_ONLY_REFS].sort()).toEqual(['active', 'anOpponent', 'controllerOf', 'controlsMost' /* C6 */, 'costChosen', 'defending', 'eachWho' /* std-combat-1 */, 'enchantedPlayer' /* std-rr */, 'iterating', 'otherOf' /* std-rx30 */, 'otherOpponents', 'ownerOf', 'seat', 'voters' /* M12F */, 'you']);
    for (const shared of ['target', 'bound', 'event', 'linked', 'each', 'fixed', 'self']) expect(isPlayerOnlyRefKind(shared), shared).toBe(false);
    expect(isPlayerOnlyRef(LEFT)).toBe(true);
    expect(Object.isFrozen(PLAYER_ONLY_REFS)).toBe(true);
  });

  it('ABILITY_MODEL_VERSION is 4 (M11-0: 3): a rules pack that uses seat is refused by an older engine; the regenerated schema has the node', () => {
    expect(ABILITY_MODEL_VERSION).toBe(4);
    expect(JSON.stringify(schema)).toContain('"seat"');
    const draw: AbilityDef = { kind: 'spell', text: 'The player to your left draws a card.', effect: { targets: [], steps: [{ op: 'draw', who: LEFT, count: 1 }] } };
    expect(validateAbility(draw, {})).toEqual([]);
    const bad = { ...draw, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'seat', side: 'up' }, count: 1 }] } } as unknown as AbilityDef;
    expect(validateAbility(bad, {})).not.toEqual([]);
  });
});

describe('M12-1: seat through every reader of player references (m12 design D6; CR 101.4, 103.1)', () => {
  it('effects/refs.ts resolvePlayers: left = next in turn order, right = previous, `of` counts from another player; a player who left is skipped', () => {
    const { cx } = fourPlayers();
    expect(resolvePlayers(cx, LEFT)).toEqual(['p2']);
    expect(resolvePlayers(cx, RIGHT)).toEqual(['p4']);
    expect(resolvePlayers(cx, { ref: 'seat', side: 'right', of: { ref: 'each', who: 'opponent' } })).toEqual(['p1', 'p2', 'p3']); // the right of p2, p3, p4
    const gone = fourPlayers(['p2']).cx;
    expect(resolvePlayers(gone, LEFT)).toEqual(['p3']);
    expect(resolvePlayers(fourPlayers(['p2', 'p3', 'p4']).cx, LEFT)).toEqual([]); // nobody else in the game
  });

  it('effects/refs.ts resolveRecipients: seat is a player recipient, never an object', () => {
    const { cx } = fourPlayers();
    expect(resolveRecipients(cx, RIGHT)).toEqual({ objects: [], players: ['p4'] });
  });

  it('effects/handlers/lasting-fix.ts lockSet: seat is fixed as the players it stands for now (CR 611.2c), not as objects', () => {
    const { cx } = fourPlayers();
    expect(lockSet(cx, LEFT)).toEqual({ ref: { ref: 'fixed', players: ['p2'] }, empty: false });
  });

  it('statics/match.ts: isPlayerRef and playersOf (the static-ability evaluator)', () => {
    const { s } = fourPlayers();
    expect(staticIsPlayerRef(LEFT)).toBe(true);
    const ecx = { s, all: new Map(), source: null, controller: 'p3' };
    expect(playersOf(ecx, LEFT)).toEqual(['p4']);
    expect(playersOf(ecx, RIGHT)).toEqual(['p2']);
    expect(playersOf(ecx, LEFT_OF_ACTIVE)).toEqual(['p2']);
  });

  it('triggers/cond.ts and triggers/filters.ts: conditions and player predicates at trigger time', () => {
    const { s } = fourPlayers();
    s.players.find((p) => p.id === 'p2')!.life = 17;
    const g = new Game(s);
    const env = { source: { id: s.zones.library['p1']![0]!, zone: 'library' as const }, controller: 'p1', event: null };
    expect(localCondition(g, { cond: 'compare', left: { q: 'life', of: LEFT }, op: '==', right: 17 }, env)).toBe(true);
    expect(localCondition(g, { cond: 'compare', left: { q: 'life', of: RIGHT }, op: '==', right: 17 }, env)).toBe(false);
    expect(playerMatches(s, LEFT, 'p2', { source: env.source.id, controller: 'p1' })).toBe(true);
    expect(playerMatches(s, LEFT, 'p4', { source: env.source.id, controller: 'p1' })).toBe(false);
  });

  it('triggers/cond.ts and triggers/filters.ts: "each opponent" no longer includes a player who left (m12 design E24, E25; CR 800.4a)', () => {
    const { s } = fourPlayers(['p3']);
    const g = new Game(s);
    const env = { source: { id: s.zones.library['p1']![0]!, zone: 'library' as const }, controller: 'p1', event: null };
    s.players.find((p) => p.id === 'p2')!.life = 9;
    s.players.find((p) => p.id === 'p4')!.life = 9;
    // the player to the left of the player to your left: p2's left neighbor is p4, since p3 (20 life) has left the game
    expect(localCondition(g, { cond: 'compare', left: { q: 'life', of: { ref: 'seat', side: 'left', of: { ref: 'seat', side: 'left' } } }, op: '==', right: 9 }, env)).toBe(true); // left of p2 is p4 (p3 left)
    expect(playerMatches(s, { ref: 'each', who: 'opponent' }, 'p3', { source: env.source.id, controller: 'p1' })).toBe(false);
    expect(playerMatches(s, { ref: 'each', who: 'opponent' }, 'p4', { source: env.source.id, controller: 'p1' })).toBe(true);
    expect(playerMatches(s, { ref: 'each', who: 'player' }, 'p3', { source: env.source.id, controller: 'p1' })).toBe(false);
  });

  it('rules/targets.ts announcedPlayers: "target creature the player to your left controls" can be read as targets are chosen', () => {
    const { s } = fourPlayers();
    expect(announcedPlayers(s, LEFT, 'p1', undefined)).toEqual(['p2']);
    expect(announcedPlayers(s, { ref: 'seat', side: 'left', of: { ref: 'target', id: 't1' } }, 'p1', undefined, { chosen: new Map([['t1', [{ kind: 'player', id: 'p3' }]]]) })).toEqual(['p4']);
    expect(announcedPlayers(s, { ref: 'seat', side: 'left', of: { ref: 'event', role: 'player' } }, 'p1', undefined)).toBeNull(); // not readable then: never a guess
  });

  it('render/refs.ts, render/state.ts, render/np.ts: rendered as a player ("the player to your left"), keyed, and a filter that targets it', () => {
    const ctx = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
    expect(renderIsPlayerRef(LEFT, {} as never)).toBe(true);
    const draw: AbilityDef = { kind: 'spell', text: 'The player to your left draws a card.', effect: { targets: [], steps: [{ op: 'draw', who: LEFT, count: 1 }] } };
    expect(renderAbility(draw, ctx).join(' | ')).toMatch(/the player to your left draws a card/i);
    expect(renderGate(draw, [draw.text], ctx).ok).toBe(true);
    const right: AbilityDef = { ...draw, text: 'The player to the right of the active player draws a card.', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'seat', side: 'right', of: { ref: 'active' } }, count: 1 }] } };
    expect(renderAbility(right, ctx).join(' | ')).toMatch(/the player to the right of the active player draws a card/i);
    expect(playerKey(LEFT)).toBe('seat:left:you');
    expect(renderFilter({ stackKind: 'spell', zone: 'stack', targets: LEFT }, ctx)).toMatch(/that targets? the player to your left/);
  });

  // M12-3: a vote for players is run now (feature:vote.players, effects/handlers/actions-native.ts; CR 701.38b)
  it('model/cap-walk.ts: the walker names ref:seat (registered: the resolver above); a vote whose subject is seat is a vote for players (feature:vote.players)', () => {
    const draw: AbilityDef = { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'draw', who: LEFT, count: 1 }] } };
    expect(capabilitiesOf(draw)).toContain('ref:seat');
    expect(ENGINE_CAPABILITIES.has('ref:seat')).toBe(true);
    const vote: AbilityDef = { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'action', action: 'vote', who: { ref: 'you' }, subject: LEFT }] } };
    expect(capabilitiesOf(vote)).toContain('feature:vote.players');
    expect(capabilitiesOf(vote)).not.toContain('action:vote.words');
    expect(ENGINE_CAPABILITIES.has('feature:vote.players')).toBe(true);
  });

  it('effects/handlers/actions-native.ts: a vote whose subject is seat is not read as a vote for objects: M12-3, it is a vote for players (CR 701.38b)', () => {
    const seatVote = synth({
      name: 'Test Seat Vote', cost: '{1}', type: 'Sorcery',
      abilities: [{ kind: 'spell', text: 'Starting with you, each player votes for the player to your left.', effect: { targets: [], steps: [{ op: 'action', action: 'vote', who: { ref: 'you' }, subject: LEFT }] } }],
    });
    const s0 = scenario(['Plains'], { defs: [seatVote], p1: { hand: ['Test Seat Vote'], battlefield: ['Plains'] } });
    const s = passBoth(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Seat Vote', 'hand') }), []));
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', options: [{ id: 'p2', label: 'Bob' }] }); // the player to Alice's left
    const t = answer(answer(s, { kind: 'chooseOption', ids: ['p2'] }), { kind: 'chooseOption', ids: ['p2'] });
    expect(t.pending).toMatchObject({ kind: 'priority' });
    expect(t.log.some((l) => /Most votes or tied for most \(2\): Bob/.test(l.text))).toBe(true);
  });
});

describe('M12-1: the state, event and decision contracts (m12 design 4.2, 4.4, 4.5)', () => {
  it('GameObject.goaded (CR 701.15a-d) is copied, never shared, by the clone of a state (replay determinism)', () => {
    const { s } = fourPlayers();
    const id = s.zones.library['p1']![0]!;
    s.objects[id]!.goaded = [{ by: 'p2' }, { by: 'p3' }];
    const c = cloneObject(s.objects[id]!);
    expect(c.goaded).toEqual([{ by: 'p2' }, { by: 'p3' }]);
    c.goaded![0]!.by = 'p4';
    c.goaded!.push({ by: 'p4' });
    expect(s.objects[id]!.goaded).toEqual([{ by: 'p2' }, { by: 'p3' }]);
    const t = cloneState(s);
    expect(t.objects[id]!.goaded).not.toBe(s.objects[id]!.goaded);
  });

  it('PlayerState.left (CR 104.5, 800.4i) is plain data kept with the player; the playerLeft event names removed, exiled and revealed objects (CR 708.9)', () => {
    const { s } = fourPlayers();
    s.players[2]!.left = { turn: 3, order: 1, reason: 'conceded' };
    expect(cloneState(s).players[2]!.left).toEqual({ turn: 3, order: 1, reason: 'conceded' });
    const e: GameEvent = { type: 'playerLeft', player: 'p3', reason: 'conceded', removed: ['o1'], exiled: ['o2'], revealed: [{ id: 'o3', name: 'Grizzly Bears' }] };
    expect(e.type).toBe('playerLeft');
  });

  it('DecisionBase.asker (CR 800.4f-h): optional, absent = a rule\'s choice', () => {
    const asker: DecisionAsker = { kind: 'opponentChoice', controller: 'p1' };
    const d: Decision = { id: 'd1', kind: 'chooseOption', player: 'p2', prompt: 'Choose.', min: 1, max: 1, options: [{ id: 'a', label: 'A' }], asker };
    expect(d.asker).toEqual(asker);
  });
});
