/**
 * M12-3 (m12 design D7, 3, 4.3): votes (CR 701.38) in 3-4 player games: each player votes in turn order starting with the specified player (CR 701.38a), for
 * objects (Council's Judgment), words (CR 701.38b: "carnage or homage", "if ... gets more votes", "or the vote is tied") or players; additional votes cast at
 * the same time as the player's own (CR 701.38d: Brago's Representative, Ballot Broker wordings); a player who left the game does not vote (CR 800.4a).
 * Cards are real fixture cards or invented wordings compiled by the default compiler (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, concede, drive, find, lifeOf, mpScenario, pass, passUntil } from '../rules/helpers';
import { scenario } from '../../m3/scenario';

const synthetic = (name: string, type: string, cost: string, text: string): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: cost, oracle_text: text, colors: [] } as unknown as OracleCard);

const WORDS = synthetic('Test Petition', 'Sorcery', '{W}',
  'Starting with you, each player votes for time or knowledge. If time gets more votes, each opponent loses 3 life. If knowledge gets more votes or the vote is tied, draw two cards.');
const DILEMMA = synthetic('Test Dilemma', 'Sorcery', '{W}', 'Starting with you, each player votes for death or taxes. You gain life equal to the number of death votes.');
const BROKER = synthetic('Test Broker', 'Creature — Human Advisor', '{W}', 'While voting, you get an additional vote.');
const MAYBE = synthetic('Test Maybe', 'Creature — Human Advisor', '{W}', 'While voting, you may vote an additional time.');
const PLAYERS = (() => {
  // a vote for players: no printed card votes for a player in turn order (the secret councils vote at the same time), so the node is built by hand
  const d = synthetic('Test Election', 'Sorcery', '{W}', 'Draw a card.');
  d.faces[0]!.abilities = [{
    kind: 'spell', text: 'Starting with you, each player votes for a player. Each player with the most votes or tied for most votes draws a card.',
    effect: { targets: [], steps: [
      { op: 'action', action: 'vote', who: { ref: 'you' }, subject: { ref: 'each', who: 'player' }, as: 'elected' },
      { op: 'draw', who: { ref: 'bound', name: 'elected' }, count: 1 },
    ] },
  }];
  return d;
})();
const READER = synthetic('Test Reader', 'Creature — Human Advisor', '{W}', 'When this creature enters, starting with you, each player votes for evidence or bribery. For each evidence vote, investigate. For each bribery vote, create a Treasure token.');
const DEFS = [WORDS, DILEMMA, BROKER, MAYBE, PLAYERS, READER];

const castSorcery = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => {
  let t = drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }));
  for (let i = 0; i < 8 && t.pending?.kind === 'priority' && t.zones.stack.length > 0; i++) t = pass(t);
  return t;
};
/** Each pending vote answered in turn: `votes[i]` is the i-th voter's answer (option ids, or object ids). Returns the voters asked, in order. */
function vote(s: GameState, votes: string[][]): { s: GameState; voters: PlayerId[] } {
  let t = s;
  const voters: PlayerId[] = [];
  for (const v of votes) {
    const d = t.pending!;
    voters.push(d.player);
    t = d.kind === 'chooseObjects' ? answer(t, { kind: 'chooseObjects', ids: v }) : answer(t, { kind: 'chooseOption', ids: v });
  }
  return { s: t, voters };
}
const handOf = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

describe("CR 701.38a: Council's Judgment (will of the council, votes for objects) in a 4-player game", () => {
  const setup = (): GameState => mpScenario({
    cards: ["Council's Judgment", 'Grizzly Bears', 'Hill Giant', 'Plains'],
    zones: { p1: { hand: ["Council's Judgment"], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Grizzly Bears'] }, p3: { battlefield: ['Hill Giant'] } },
  });

  it('CR 701.38a: starting with Alice and proceeding in turn order, each player votes for a nonland permanent Alice does not control; the most votes is exiled', () => {
    const s0 = setup();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const giant = find(s0, 'Hill Giant', 'battlefield', 'p3');
    let s = castSorcery(s0, "Council's Judgment");
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1, rules: ['CR 701.38a'] });
    expect([...(s.pending as { options: string[] }).options].sort()).toEqual([bears, giant].sort());
    const r = vote(s, [[bears], [giant], [bears], [bears]]);
    expect(r.voters).toEqual(['p1', 'p2', 'p3', 'p4']);
    s = r.s;
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Grizzly Bears']); // 3 votes to 1
    expect(s.zones.battlefield).toContain(giant);
  });

  it('CR 701.38a: each permanent tied for most votes is exiled', () => {
    const s0 = setup();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const giant = find(s0, 'Hill Giant', 'battlefield', 'p3');
    const s = vote(castSorcery(s0, "Council's Judgment"), [[bears], [giant], [bears], [giant]]).s;
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Grizzly Bears', 'Hill Giant']);
  });

  it('CR 800.4a: a player who left the game does not vote (and their permanents left with them)', () => {
    let s = concede(setup(), 'p3').state;
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = castSorcery(s, "Council's Judgment");
    const r = vote(s, [[bears], [bears], [bears]]);
    expect(r.voters).toEqual(['p1', 'p2', 'p4']);
    expect(r.s.pending).toMatchObject({ kind: 'priority' });
  });

  it('CR 701.38a: on Bob\'s turn, "starting with you" starts with Bob, then Carol, Dan and Alice', () => {
    let s = mpScenario({
      cards: ["Council's Judgment", 'Grizzly Bears', 'Plains'],
      zones: { p2: { hand: ["Council's Judgment"], battlefield: ['Plains', 'Plains', 'Plains'] }, p1: { battlefield: ['Grizzly Bears'] } },
    });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.player === 'p2', "Bob's main phase", 400);
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    s = castSorcery(s, "Council's Judgment", 'p2');
    expect(vote(s, [[bears], [bears], [bears], [bears]]).voters).toEqual(['p2', 'p3', 'p4', 'p1']);
  });
});

describe('CR 701.38b: votes for words (will of the council)', () => {
  const setup = (extra: Partial<Record<PlayerId, string[]>> = {}, players = 4): GameState => mpScenario({
    players, defs: DEFS, cards: ['Plains'],
    zones: { p1: { hand: ['Test Petition', 'Test Dilemma'], battlefield: ['Plains', 'Plains', ...(extra.p1 ?? [])] }, p2: { battlefield: extra.p2 ?? [] } },
  });

  it('CR 701.38b: "time" gets more votes: each opponent loses 3 life; knowledge does not happen', () => {
    let s = castSorcery(setup(), 'Test Petition');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', min: 1, max: 1, options: [{ id: 'time', label: 'time' }, { id: 'knowledge', label: 'knowledge' }] });
    const hand = handOf(s, 'p1');
    s = vote(s, [['time'], ['knowledge'], ['time'], ['time']]).s;
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([17, 17, 17]);
    expect(handOf(s, 'p1')).toBe(hand);
    expect(s.log.some((l) => /The votes: time 3, knowledge 1/.test(l.text))).toBe(true);
  });

  it('CR 701.38b: "knowledge gets more votes or the vote is tied": a 2-2 tie draws two cards, and "time" does not happen', () => {
    let s = castSorcery(setup(), 'Test Petition');
    const hand = handOf(s, 'p1');
    s = vote(s, [['time'], ['knowledge'], ['knowledge'], ['time']]).s;
    expect(handOf(s, 'p1')).toBe(hand + 2);
    expect(lifeOf(s, 'p2')).toBe(20);
  });

  it('CR 701.38b: "the number of death votes" counts the votes for that word', () => {
    let s = castSorcery(setup(), 'Test Dilemma');
    s = vote(s, [['death'], ['taxes'], ['death'], ['death']]).s;
    expect(lifeOf(s, 'p1')).toBe(23);
  });

  it('m12 design D16: in a two-player game the vote is the same (two voters; a 1-1 tie is "tied")', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Petition'], battlefield: ['Plains'] } });
    s = castSorcery(s, 'Test Petition');
    const hand = handOf(s, 'p1');
    const r = vote(s, [['time'], ['knowledge']]);
    expect(r.voters).toEqual(['p1', 'p2']);
    expect(handOf(r.s, 'p1')).toBe(hand + 2);
  });
});

describe('CR 701.38d: additional votes happen at the same time as the player\'s own vote', () => {
  it('"While voting, you get an additional vote": Alice casts two votes in one decision (the same word allowed twice)', () => {
    let s = mpScenario({ players: 3, defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Petition'], battlefield: ['Plains', 'Test Broker'] } } });
    s = castSorcery(s, 'Test Petition');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', min: 2, max: 2, allowRepeat: true, rules: ['CR 701.38a', 'CR 701.38d'] });
    s = vote(s, [['time', 'time'], ['knowledge'], ['knowledge']]).s; // 2 to 2: tied
    const lost = [lifeOf(s, 'p2'), lifeOf(s, 'p3')];
    expect(lost).toEqual([20, 20]);
    expect(s.log.some((l) => /Alice votes for time and time/.test(l.text) && l.rules?.includes('CR 701.38d'))).toBe(true);
  });

  it('"While voting, you may vote an additional time": one or two votes; the additional vote counts for the result', () => {
    let s = mpScenario({ players: 3, defs: DEFS, cards: ['Plains'], zones: { p2: { battlefield: ['Test Maybe'] }, p1: { hand: ['Test Petition'], battlefield: ['Plains'] } } });
    s = castSorcery(s, 'Test Petition');
    let r = vote(s, [['time']]);
    expect(r.s.pending).toMatchObject({ kind: 'chooseOption', player: 'p2', min: 1, max: 2 });
    r = vote(r.s, [['knowledge', 'knowledge'], ['time']]);
    expect(lifeOf(r.s, 'p2')).toBe(20); // knowledge 2, time 2: tied, so no life loss
  });
});

describe('CR 701.38d: what modifies a vote', () => {
  it('a manual sentence that only reads the result ("for each evidence vote") does not make the vote manual; the sentence is resolved by hand after it', () => {
    let s = mpScenario({ players: 3, defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Reader'], battlefield: ['Plains'] } } });
    s = castSorcery(s, 'Test Reader');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1' });
    s = vote(s, [['evidence'], ['bribery'], ['evidence']]).s;
    expect(s.log.some((l) => /The votes: evidence 2, bribery 1/.test(l.text))).toBe(true);
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
  });
});

describe('CR 701.38b: votes for players', () => {
  it('each player votes for a player (a player who left can\'t be voted for); the most votes is bound and draws', () => {
    let s = mpScenario({ defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Election'], battlefield: ['Plains'] } } });
    s = concede(s, 'p4').state;
    s = castSorcery(s, 'Test Election');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1' });
    expect((s.pending as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(['p1', 'p2', 'p3']);
    const hands = (['p1', 'p2', 'p3'] as PlayerId[]).map((p) => handOf(s, p));
    s = vote(s, [['p3'], ['p3'], ['p1']]).s;
    expect((['p1', 'p2', 'p3'] as PlayerId[]).map((p) => handOf(s, p))).toEqual([hands[0], hands[1], hands[2]! + 1]);
  });
});
