/**
 * H1, hidden-information hardening (docs/ARCHITECTURE.md "Hidden information", requested by packages/net): no player can follow a card into a library
 * and through a shuffle by its object id (CR 400.2, 401.2, 701.24a), and no object a player cannot see carries anything that identifies the card
 * (card id, timestamp, creation turn, face). Replays stay exact.
 */
import { describe, expect, it } from 'vitest';
import { GameSession, HIDDEN_DEF, replay, viewFor, type Action, type GameObject, type GameState, type GameView } from '../../src/index';
import { clone } from '../../src/util/clone';
import { FACE_DOWN_DEF_IDS } from '../../src/types/card';
import { simpleConfig, startedGame } from '../helpers';
import { act, answer, find, scenario } from '../m3/scenario';

/** Lightning Bolt resolved by hand (a manualResolve decision), p1's library holding some known cards. */
function resolvingByHand(): GameState {
  let s = scenario(['Lightning Bolt', 'Grizzly Bears', 'Hill Giant', 'Mountain'], {
    p1: { hand: ['Lightning Bolt', 'Hill Giant'], library: ['Mountain', 'Mountain', 'Mountain'], graveyard: ['Grizzly Bears'], battlefield: ['Mountain'] },
    manual: ['Lightning Bolt'],
  });
  s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') });
  s = answer(s, { kind: 'payCost', auto: true });
  s = act(s, { type: 'pass', player: 'p1' });
  s = act(s, { type: 'pass', player: 'p2' });
  expect(s.pending).toMatchObject({ kind: 'manualResolve' });
  return s;
}

/** The fields a hidden card in a hidden zone may have: who owns it and where it is; nothing about which card it is or when it was made. */
const BLANK: Omit<GameObject, 'id' | 'owner' | 'controller' | 'zone'> = {
  kind: 'card', defId: HIDDEN_DEF, timestamp: 0, tapped: false, flipped: false, faceDown: false, phasedOut: false, face: 0, controlledSinceTurn: 0,
  counters: {}, damage: 0, deathtouchDamaged: false,
};

function expectBlank(v: GameView, id: string): void {
  const o = v.objects[id]!;
  expect(o).toEqual({ ...BLANK, id, owner: o.owner, controller: o.controller, zone: o.zone });
}

describe('H1: shuffling gives library cards new object ids (CR 400.2, 401.2, 701.24a)', () => {
  it('CR 701.24a: a card revealed in a library and then shuffled cannot be matched by its id; the card itself (cardId) is the same', () => {
    let m = clone(resolvingByHand());
    const library0 = [...m.zones.library.p1!];
    const top = library0[0]!;
    const card = m.objects[top]!.cardId;
    // CR 701.20a: revealed to everybody. A decision re-runs the action from its base state, so the reveal is made there too (or it would be gone already).
    for (const st of [m, m.suspended!.base]) st.objects[top]!.revealedTo = ['p1', 'p2'];
    const before = viewFor(m, 'p2');
    expect(before.defs[before.objects[top]!.defId]?.name).toBe(m.defs[m.objects[top]!.defId]!.name);
    // The premise: an answer that does not shuffle leaves the card revealed.
    const unshuffled = answer(m, { kind: 'manualResolve', ops: [{ op: 'note', text: 'no shuffle' }] });
    expect(viewFor(unshuffled, 'p2').objects[top]!.defId).not.toBe(HIDDEN_DEF);
    // The engine's shuffle, here through a manual operation (core/manual.ts -> core/zones.ts#shuffleLibrary).
    m = answer(m, { kind: 'manualResolve', ops: [{ op: 'shuffle', player: 'p1' }] });
    const library1 = m.zones.library.p1!;
    expect(library1).toHaveLength(library0.length);
    expect(library1.filter((id) => library0.includes(id))).toEqual([]); // no id survives the shuffle
    expect(m.objects[top]).toBeUndefined();
    expect(m.lki[top]).toBeUndefined(); // nothing in the state links the old id to the new one (the engine follows it within the action only)
    expect(library1.filter((id) => m.objects[id]!.cardId === card)).toHaveLength(1); // the same physical card is still in the library
    for (const viewer of ['p1', 'p2', null] as const) {
      const v = viewFor(m, viewer);
      expect(v.lki[top]).toBeUndefined(); // no view links the old id to the new one
      for (const id of library1) expectBlank(v, id); // CR 701.20d: the card stopped being revealed; it is one blank card among others
    }
  });

  it('CR 400.2: a card put from a public zone on top of a library and then shuffled is not named to anyone, nor linked to its new place', () => {
    let s = resolvingByHand();
    const bears = find(s, 'Grizzly Bears', 'graveyard', 'p1');
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'move', object: bears, to: 'libraryTop' }, { op: 'shuffle', player: 'p1' }] });
    const where = s.zones.library.p1!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Grizzly Bears');
    expect(where).toHaveLength(1);
    const v = viewFor(s, 'p2');
    expect(Object.values(v.objects).some((o) => o.defId === 'Grizzly Bears')).toBe(false);
    // The move itself was public (CR 400.2: it left a graveyard), but nothing in the view points at a card now in the library.
    const now = new Set(s.zones.library.p1!);
    for (const e of v.history) if (e.subject !== undefined) expect(now.has(e.subject)).toBe(false);
  });

  it('CR 400.2: a look-back entry about a library card stays hidden after the shuffle (the old id is neither an object nor last known information)', () => {
    let s = clone(resolvingByHand());
    const card = s.zones.library.p1![1]!;
    const entry = { turn: s.turn.number, combat: 0, ev: 'zoneChange' as const, subject: card, facts: { name: 'H1 marker', to: 'library' } };
    for (const h of new Set([s.history, s.suspended?.base.history ?? s.history])) h.push(entry); // (a decision re-runs the action from its base state)
    const hidden = (st: GameState) => viewFor(st, 'p2').history.filter((e) => e.facts['name'] === 'H1 marker' || e.subject === card);
    expect(hidden(s)).toEqual([]);
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'shuffle', player: 'p1' }] });
    expect(s.history.some((e) => e.subject === card)).toBe(true); // (the entry is still in the state)
    expect(s.objects[card]).toBeUndefined();
    expect(hidden(s)).toEqual([]);
    expect(s.lki[card]).toBeUndefined();
    expect(viewFor(s, 'p1').lki[card]).toBeUndefined();
  });

  it('CR 400.2: a card put from a hand into a library and then shuffled is named to nobody else, in no part of the view', () => {
    let s = resolvingByHand();
    const giant = find(s, 'Hill Giant', 'hand', 'p1');
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'move', object: giant, to: 'libraryTop' }, { op: 'shuffle', player: 'p1' }] });
    expect(s.zones.library.p1!.some((id) => s.objects[id]!.defId === 'Hill Giant')).toBe(true);
    for (const viewer of ['p2', null] as const) expect(JSON.stringify(viewFor(s, viewer))).not.toContain('Hill Giant');
  });

  it('CR 103.3: after the opening shuffle no library card keeps the id it was created with', () => {
    const s = startedGame(); // two 40-card decks: objects o1-o80 are created, then shuffled (CR 103.3)
    const ids = Object.values(s.zones.library).flat();
    expect(ids.length).toBeGreaterThan(60);
    expect(ids.every((id) => Number(id.slice(1)) > 80)).toBe(true);
  });
});

describe('H1: hidden objects carry nothing that identifies the card (CR 400.2, 708.6)', () => {
  it('CR 400.2, 401.2: another player\'s hand and every library: blank cards with no card id, timestamp, creation turn or face', () => {
    const s = startedGame();
    const v = viewFor(s, 'p2');
    // m4 (audit 2026-10-12): another player's hand is shown under aliases of the view (hand-aliases.test.ts), so the view's own hand ids are checked.
    expect(v.zones.hand.p1).toHaveLength(s.zones.hand.p1!.length);
    for (const id of [...v.zones.hand.p1!, ...s.zones.library.p1!, ...s.zones.library.p2!]) expectBlank(v, id);
    for (const id of s.zones.hand.p2!) expect(v.objects[id]!.cardId).toBe(s.objects[id]!.cardId); // the viewer's own hand is not hidden from them
    const spectator = viewFor(s, null);
    for (const id of [...spectator.zones.hand.p1!, ...spectator.zones.hand.p2!]) expectBlank(spectator, id);
  });

  it('CR 708.6: a face-down permanent shows its controller everything and the others no card id, face or memory, but what everybody sees of it', () => {
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    s = clone(s);
    const id = find(s, 'Grizzly Bears', 'battlefield');
    const o = s.objects[id]!;
    Object.assign(o, { faceDown: true, face: 1, tapped: true, counters: { '+1/+1': 1 }, chosen: { color: 'G' } });
    const mine = viewFor(s, 'p1').objects[id]!;
    expect(mine.cardId).toBe(o.cardId);
    expect(mine.defId).toBe(o.defId);
    const theirs = viewFor(s, 'p2').objects[id]!;
    expect(theirs.defId).toBe(FACE_DOWN_DEF_IDS.plain); // M6-3 (m6 design D7, E7): the public pseudo-definition of its profile, never the card's
    expect(theirs.defId).not.toBe(HIDDEN_DEF);
    expect(theirs.cardId).toBeUndefined();
    expect(theirs.chosen).toBeUndefined();
    expect(theirs.face).toBe(0);
    // Public facts of the face-down permanent: it is tapped, has a counter, and since when its controller controls it (CR 302.6).
    expect(theirs).toMatchObject({ faceDown: true, tapped: true, counters: { '+1/+1': 1 }, controlledSinceTurn: o.controlledSinceTurn, timestamp: o.timestamp });
  });
});

describe('H1: replay determinism is unchanged (the new ids come from the state\'s counters, not from randomness)', () => {
  function playSome(session: GameSession, n: number): void {
    for (let i = 0; i < n && !session.state.result; i++) {
      const d = session.state.pending!;
      let a: Action;
      if (d.kind === 'playFirst') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'playFirst', player: d.player } };
      else if (d.kind === 'mulligan') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'mulligan', keep: i % 3 !== 0 } };
      else if (d.kind === 'chooseObjects') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseObjects', ids: d.options.slice(0, d.min) } };
      else a = { type: 'pass', player: d.player };
      const r = session.apply(a);
      if (!r.ok) throw new Error(r.error.message);
    }
  }

  it('CR 701.24a, 103.3: the same seed and actions give the same ids; replaying the log (mulligans and their shuffles included) reproduces the exact state', () => {
    const cfg = simpleConfig('h1-replay');
    const a = new GameSession(cfg);
    const b = new GameSession(cfg);
    playSome(a, 80);
    playSome(b, 80);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(Object.values(a.state.zones.library).flat().every((id) => Number(id.slice(1)) > 80)).toBe(true); // shuffled: new ids
    const { state, errors } = replay(cfg, a.actions);
    expect(errors).toEqual([]);
    expect(JSON.stringify(state)).toBe(JSON.stringify(a.state));
  });
});
