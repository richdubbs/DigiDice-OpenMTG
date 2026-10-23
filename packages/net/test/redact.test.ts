/**
 * Hidden information in events (CR 400.2): what each player is sent of an event about a card it cannot see. NETFIX1, NETFIX2: another player's hand
 * cards hidden from the viewer by no id at all (`UNSEEN_ID`): not their object ids (audit m4), nor the aliases of the viewer's views (an alias in a draw
 * that matched the card leaving the hand later linked the two).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, createGame, legalActions, viewFor, type DecisionAnswer, type GameEvent, type GameState, type OracleCard, type PlayerId } from '@openmtg/engine';
import { autoAnswer } from '../src/game/autoplay';
import { eventsFor, UNSEEN_ID } from '../src/game/redact';
import { fixtureDb } from './helpers';

function game(): GameState {
  const db = fixtureDb();
  const defs = ['Forest', 'Grizzly Bears'].map((n) => compileCard(db.lookup(n) as OracleCard));
  const deck = [...Array<string>(20).fill('Forest'), ...Array<string>(20).fill('Grizzly Bears')];
  let s = createGame({ seed: 'redact', players: [{ name: 'A', deck }, { name: 'B', deck }], defs });
  // CR 103: choose who plays first, keep both hands
  while (s.pending && s.pending.kind !== 'priority') {
    const d = s.pending;
    s = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: autoAnswer(d, d.player) as DecisionAnswer }).state;
  }
  return s;
}

describe('eventsFor', () => {
  const s = game();
  const handCard = s.zones.hand['p1']![0]!;
  it('has a hand to test with', () => expect(s.objects[handCard]?.zone).toBe('hand'));
  const libraryCard = s.zones.library['p1']![0]!;
  const move = (newId: string, from: 'library' | 'hand' | 'battlefield', to: 'hand' | 'library' | 'graveyard'): GameEvent => ({
    type: 'zoneChanged', oldId: 'o999', newId, from, to, owner: 'p1', controller: 'p1', name: 'Grizzly Bears', cause: 'test',
    before: { object: { ...s.objects[newId]!, id: 'o999' }, leftZone: from } as never,
  });

  it('CR 400.2, 401.4: the opponent does not learn the name of a card put into its owner\'s hand or library, nor the object it became there', () => {
    const [toHand] = eventsFor(s, [move(handCard, 'library', 'hand')], 'p2');
    expect(toHand).toMatchObject({ type: 'zoneChanged', newId: null, from: 'library', to: 'hand', owner: 'p1', name: '' });
    expect(toHand).not.toHaveProperty('before');
    const [toLibrary] = eventsFor(s, [move(libraryCard, 'hand', 'library')], 'p2');
    expect(toLibrary).toMatchObject({ name: '', newId: null }); // H1: the place in the library is not linked to the card that moved
  });

  it('the owner sees its own hand card and its own events unchanged', () => {
    const e = move(handCard, 'library', 'hand');
    expect(eventsFor(s, [e], 'p1')).toEqual([e]);
    const drew: GameEvent = { type: 'drew', player: 'p1', objectId: handCard };
    expect(eventsFor(s, [drew], 'p1')).toEqual([drew]);
  });

  it("NETFIX2 (CR 400.2, audit m4): another player's draw names no card: neither its object id nor the alias the viewer's view shows", () => {
    const drew: GameEvent = { type: 'drew', player: 'p1', objectId: handCard };
    const [seen] = eventsFor(s, [drew], 'p2') as Extract<GameEvent, { type: 'drew' }>[];
    expect(seen).toEqual({ ...drew, objectId: UNSEEN_ID });
    expect(viewFor(s, 'p2').zones.hand['p1']).not.toContain(UNSEEN_ID);
    expect(eventsFor(s, [drew], 'p2', { before: s })).toEqual([seen]);
  });

  it('NETFIX2: a card that left a hidden hand is named by no id, every time; its owner knows it', () => {
    const active = s.pending!.player as PlayerId;
    const other: PlayerId = active === 'p1' ? 'p2' : 'p1';
    const land = legalActions(s, active).find((l) => l.kind === 'playLand')!;
    expect(land).toBeDefined();
    const r = applyAction(s, land.action);
    const played = r.events.find((e): e is Extract<GameEvent, { type: 'zoneChanged' }> => e.type === 'zoneChanged' && e.from === 'hand')!;
    expect(played.to).toBe('battlefield');
    const [seen] = eventsFor(r.state, [played], other, { before: s }) as (typeof played)[];
    expect(seen).toEqual({ ...played, oldId: UNSEEN_ID }); // a land played is public: its new id and name stay
    expect(eventsFor(r.state, [played], other)).toEqual([{ ...played, oldId: UNSEEN_ID }]);
    expect(eventsFor(r.state, [played], active, { before: s })).toEqual([played]); // its owner knows it
    // drawn and gone between two views of the viewer (`before` is already after it left): no id either
    const drew: GameEvent = { type: 'drew', player: active, objectId: played.oldId };
    expect(eventsFor(r.state, [drew], other, { before: r.state })).toEqual([{ ...drew, objectId: UNSEEN_ID }]);
    // a card drawn and gone with nothing left of it (a mulligan's hand, CR 103.5): no id
    const gone: GameEvent = { type: 'drew', player: active, objectId: 'o-gone' };
    expect(eventsFor(r.state, [gone], other, { before: s })).toEqual([{ ...gone, objectId: UNSEEN_ID }]);
  });

  it('NETFIX2: a card revealed to the viewer in the view before the change keeps its id as it leaves the hand', () => {
    const active = s.pending!.player as PlayerId;
    const other: PlayerId = active === 'p1' ? 'p2' : 'p1';
    const land = legalActions(s, active).find((l) => l.kind === 'playLand')!;
    const card = (land.action as { card: string }).card;
    const shown: GameState = { ...s, objects: { ...s.objects, [card]: { ...s.objects[card]!, revealedTo: [other] } } };
    const r = applyAction(shown, land.action);
    const played = r.events.find((e): e is Extract<GameEvent, { type: 'zoneChanged' }> => e.type === 'zoneChanged' && e.from === 'hand')!;
    expect(played.oldId).toBe(card);
    expect(eventsFor(r.state, [played], other, { before: shown })).toEqual([played]);
    expect(eventsFor(r.state, [played], other, { before: s })).toEqual([{ ...played, oldId: UNSEEN_ID }]); // not shown before: no id
  });

  it('NETFIX1, NETFIX2: a hand card revealed to the viewer keeps its id (the view shows it, CR 701.20b); other strings are left alone', () => {
    const shown: GameState = { ...s, objects: { ...s.objects, [handCard]: { ...s.objects[handCard]!, revealedTo: ['p2'] } } };
    expect(viewFor(shown, 'p2').objects[handCard]).toBeDefined();
    const drew: GameEvent = { type: 'drew', player: 'p1', objectId: handCard };
    expect(eventsFor(shown, [drew], 'p2')).toEqual([drew]);
    const named: GameEvent = { type: 'zoneChanged', oldId: 'constructor', newId: null, from: null, to: 'battlefield', owner: 'p1', controller: 'p1', name: 'toString' };
    expect(eventsFor(s, [named], 'p2')).toEqual([named]);
  });

  it("a move into a public zone is public; another player's card's snapshot from a hidden hand is not (NETFIX1: its timestamp)", () => {
    const e = { ...move('o-gone', 'hand', 'graveyard'), before: { object: { ...s.objects[handCard]!, id: 'o999' }, leftZone: 'hand' } as never };
    const { before: _before, ...rest } = e as Extract<GameEvent, { type: 'zoneChanged' }>;
    expect(eventsFor(s, [e], 'p2')).toEqual([{ ...rest, oldId: UNSEEN_ID }]); // NETFIX2: nor its id in that hand
    expect(eventsFor(s, [e], 'p1')).toEqual([e]);
  });

  it('withholds the events of another player\'s cancellable action in progress (CR 733.1), like viewFor', () => {
    const pending = { ...s, pending: { kind: 'chooseTargets', id: 'd1', player: 'p1', prompt: '', cancellable: true } as never, suspended: { base: s, action: { type: 'pass', player: 'p1' }, answers: [] } as never };
    const drew: GameEvent = { type: 'drew', player: 'p1', objectId: handCard };
    expect(eventsFor(pending, [drew], 'p2')).toEqual([]);
    expect(eventsFor(pending, [drew], 'p1')).toEqual([drew]);
  });
});
