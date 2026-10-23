/**
 * M12F (STATUS "Wave M12" gap 2): "whenever players finish voting" (CR 701.38a). Every vote ends with the `votesFinished` event (the ballots, or none for a
 * vote resolved by hand), so the vote-result triggers of Grudge Keeper, Model of Unity and Erestor of the Council are collected and put on the stack like any
 * other trigger instead of waiting for a "Trigger now" nobody is reminded of. Grudge Keeper is automated exactly as printed (the `voters` player reference);
 * M12 gaps: so are Model of Unity ("you and each opponent who voted for a choice you voted for may scry 2", `voters` with `andYou`) and Erestor of the
 * Council ("You scry X, where X is the number of opponents who ..."). The cards are compiled from their Oracle text by the default compiler (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, drive, find, lifeOf, mpScenario, pass, resolveStack } from '../rules/helpers';

const card = (name: string, type: string, cost: string, text: string): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: cost, oracle_text: text, colors: [] } as unknown as OracleCard);

const GRUDGE_KEEPER = card('Grudge Keeper', 'Creature — Zombie Wizard', '{1}{B}', "Whenever players finish voting, each opponent who voted for a choice you didn't vote for loses 2 life.");
const MODEL_OF_UNITY = card('Model of Unity', 'Artifact Creature — Construct', '{3}', 'Whenever players finish voting, you and each opponent who voted for a choice you voted for may scry 2.\n{T}: Add one mana of any color.');
const ERESTOR = card('Erestor of the Council', 'Legendary Creature — Elf Noble', '{1}{G}{U}',
  "Whenever players finish voting, each opponent who voted for a choice you voted for creates a Treasure token. You scry X, where X is the number of opponents who voted for a choice you didn't vote for. Draw a card.");
const PETITION = card('Test Petition', 'Sorcery', '{W}', 'Starting with you, each player votes for time or knowledge. If time gets more votes, each opponent loses 3 life. If knowledge gets more votes or the vote is tied, draw two cards.');
const SECRET = card('Test Secret Council', 'Sorcery', '{W}', 'Each player secretly votes for truth or consequences, then those votes are revealed. You draw cards equal to the number of truth votes.');
const DEFS = [GRUDGE_KEEPER, MODEL_OF_UNITY, ERESTOR, PETITION, SECRET];

const triggersOf = (d: CardDef) => d.faces[0]!.abilities.filter((a) => a.kind === 'triggered');

/** Cast a sorcery from Alice's hand and answer the votes in turn order (`votes[i]` for the i-th voter). Stops when the next decision is not a vote. */
function castAndVote(s0: GameState, name: string, votes: string[][]): GameState {
  let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }));
  for (let i = 0; i < 8 && s.pending?.kind === 'priority' && s.zones.stack.length > 0 && s.pending.kind === 'priority'; i++) {
    s = pass(s);
    if (s.pending?.kind === 'chooseOption') break;
  }
  for (const v of votes) {
    expect(s.pending?.kind).toBe('chooseOption');
    s = answer(s, { kind: 'chooseOption', ids: v });
  }
  return s;
}
const stackNames = (s: GameState): string[] => s.zones.stack.map((id) => s.objects[id]!.stack?.sourceName ?? s.defs[s.objects[id]!.defId]!.name);

describe('the cards compile with "whenever players finish voting" as a trigger event (CR 701.38a)', () => {
  it('Grudge Keeper is fully automated: the votesFinished trigger, the voters reference (opponents who voted for a choice you did not vote for), lose 2 life', () => {
    const [t] = triggersOf(GRUDGE_KEEPER);
    expect(t).toBeDefined();
    expect(t).toMatchObject({ trigger: { on: [{ ev: 'action', verb: 'votesFinished' }] } });
    expect(JSON.stringify(t)).toContain('"ref":"voters","agree":false');
    expect(GRUDGE_KEEPER.faces[0]!.abilities.some((a) => a.kind === 'manual')).toBe(false);
  });

  it('M12 gaps: Model of Unity and Erestor of the Council trigger on the same event and are fully automated (no manual step)', () => {
    for (const d of [MODEL_OF_UNITY, ERESTOR]) {
      const [t] = triggersOf(d);
      expect(t, d.name).toMatchObject({ trigger: { on: [{ ev: 'action', verb: 'votesFinished' }] } });
      expect(JSON.stringify(t), d.name).not.toContain('"op":"manual"');
      expect(d.automation.level, d.name).toBe('full');
    }
    // Model of Unity: one `may` of the group "you and each opponent who voted for a choice you voted for", each who says yes scries 2 (CR 608.2d, 101.4)
    expect(triggersOf(MODEL_OF_UNITY)[0]!.effect.steps).toEqual([
      { op: 'may', who: { ref: 'voters', agree: true, andYou: true }, do: [{ op: 'scry', who: { ref: 'iterating' }, count: 2 }] },
    ]);
    // Erestor: a Treasure for each opponent who voted with you; scry X, X the count of the opponents who voted otherwise (read as the step runs, CR 608.2h)
    expect(triggersOf(ERESTOR)[0]!.effect.steps).toEqual([
      { op: 'createToken', who: { ref: 'voters', agree: true }, count: 1, token: { predefined: 'Treasure' } },
      { op: 'scry', who: { ref: 'you' }, count: { q: 'countPlayers', of: { ref: 'voters', agree: false } } },
      { op: 'draw', who: { ref: 'you' }, count: 1 },
    ]);
  });
});

describe('Grudge Keeper in a 4-player game (CR 701.38a, 603.2)', () => {
  const setup = (zones: { p1?: string[]; p2?: string[] } = {}): GameState => mpScenario({
    defs: DEFS, cards: ['Plains'],
    zones: { p1: { hand: ['Test Petition', 'Test Secret Council'], battlefield: ['Plains', 'Plains', ...(zones.p1 ?? ['Grudge Keeper'])] }, p2: { battlefield: zones.p2 ?? [] } },
  });

  it('after the vote, the trigger goes on the stack; each opponent who voted for a choice Alice did not vote for loses 2 life', () => {
    let s = castAndVote(setup(), 'Test Petition', [['time'], ['knowledge'], ['time'], ['knowledge']]);
    // the petition finished (a 2-2 tie: knowledge, Alice draws two); Grudge Keeper's trigger is waiting on the stack
    expect(stackNames(s)).toEqual(['Grudge Keeper']);
    s = resolveStack(s);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 18, 20, 18]);
  });

  it('an opponent who voted like Alice loses nothing; every vote the same: nobody loses life', () => {
    let s = castAndVote(setup(), 'Test Petition', [['time'], ['time'], ['time'], ['time']]);
    s = resolveStack(s);
    // the petition: time, each opponent loses 3; Grudge Keeper: nobody voted for a choice Alice didn't vote for
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([17, 17, 17]);
  });

  it("an opponent's Grudge Keeper reads the votes from its controller's side (Bob): Alice and Carol voted otherwise", () => {
    let s = castAndVote(setup({ p1: [], p2: ['Grudge Keeper'] }), 'Test Petition', [['time'], ['knowledge'], ['time'], ['knowledge']]);
    expect(stackNames(s)).toEqual(['Grudge Keeper']);
    s = resolveStack(s);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([18, 20, 18, 20]);
  });

  it('a vote resolved by hand (a secret council) still finishes a vote: the trigger goes on the stack and Alice says who voted otherwise (never a guess)', () => {
    const s0 = setup();
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Secret Council', 'hand', 'p1') }));
    for (let i = 0; i < 8 && s.pending?.kind === 'priority'; i++) s = pass(s);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    s = answer(s, { kind: 'manualResolve', ops: [] });
    expect(stackNames(s)).toEqual(['Grudge Keeper']);
    for (let i = 0; i < 8 && s.pending?.kind === 'priority'; i++) s = pass(s);
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', min: 0, max: 3, rules: ['CR 701.38a'] });
    expect(s.pending!.prompt).toMatch(/cast by hand/);
    s = answer(s, { kind: 'chooseOption', ids: ['p3'] });
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 18, 20]);
  });

  it('two votes, two triggers: each vote is finished once (once per vote, not once per voter)', () => {
    let s = mpScenario({ players: 3, defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Petition'], battlefield: ['Plains', 'Grudge Keeper'] } } });
    s = castAndVote(s, 'Test Petition', [['time'], ['knowledge'], ['knowledge']]);
    expect(stackNames(s)).toEqual(['Grudge Keeper']);
  });
});

describe('M12 gaps: Model of Unity and Erestor of the Council are automated (CR 701.38a, 701.22a, 608.2d, 101.4)', () => {
  /** Answer the pending decision; a scry's choice of the cards for the bottom takes `bottom` of them (the top ones first). */
  const scryBottom = (s: GameState, player: PlayerId, bottom: number): GameState => {
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player, rules: ['CR 701.22a'] });
    const options = s.pending!.kind === 'chooseObjects' ? s.pending.options : [];
    return drive(answer(s, { kind: 'chooseObjects', ids: options.slice(0, bottom) }));
  };
  const scried = (s: GameState): string[] => s.log.filter((l) => / scries \d/.test(l.text)).map((l) => l.text.replace(/,.*$/, ''));
  const toResolve = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 8 && s.pending?.kind === 'priority'; i++) s = pass(s);
    return s;
  };

  it('Model of Unity: Alice and each opponent who voted like her are asked in APNAP order, then each who said yes scries 2; Carol (who voted otherwise) is not asked', () => {
    let s = mpScenario({ players: 3, defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Petition'], battlefield: ['Plains', 'Model of Unity'] } } });
    s = castAndVote(s, 'Test Petition', [['time'], ['time'], ['knowledge']]);
    expect(stackNames(s)).toEqual(['Model of Unity']);
    expect(MODEL_OF_UNITY.automation.level).toBe('full');
    s = toResolve(s);
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1', rules: ['CR 608.2d', 'CR 603.5'] });
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p2' });
    s = answer(s, { kind: 'yesNo', yes: true });
    s = scryBottom(s, 'p1', 1);
    s = scryBottom(s, 'p2', 2);
    expect(scried(s)).toEqual(['Alice scries 2', 'Bob scries 2']);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.stack).toEqual([]);
  });

  it('Model of Unity: a player who says no does not scry; with no opponent voting like Alice, only Alice is asked', () => {
    let s = mpScenario({ defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Petition'], battlefield: ['Plains', 'Model of Unity'] } } });
    s = castAndVote(s, 'Test Petition', [['time'], ['knowledge'], ['knowledge'], ['knowledge']]);
    s = toResolve(s);
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(scried(s)).toEqual([]);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.stack).toEqual([]);
  });

  it("Model of Unity on an opponent's side (Bob's): Bob and the opponents who voted like him (Carol), in APNAP order from Alice, the active player", () => {
    let s = mpScenario({ defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Petition'], battlefield: ['Plains'] }, p2: { battlefield: ['Model of Unity'] } } });
    s = castAndVote(s, 'Test Petition', [['time'], ['knowledge'], ['knowledge'], ['time']]);
    s = toResolve(s);
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p2' });
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p3' });
    s = answer(s, { kind: 'yesNo', yes: false });
    s = scryBottom(s, 'p2', 0);
    expect(scried(s)).toEqual(['Bob scries 2']);
  });

  it('Model of Unity after a vote cast by hand: Alice names who voted like her (never a guess), then the group is asked', () => {
    let s = mpScenario({ players: 3, defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Secret Council'], battlefield: ['Plains', 'Model of Unity'] } } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Secret Council', 'hand', 'p1') }));
    s = toResolve(s);
    s = answer(s, { kind: 'manualResolve', ops: [] });
    expect(stackNames(s)).toEqual(['Model of Unity']);
    s = toResolve(s);
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', rules: ['CR 701.38a'] });
    s = answer(s, { kind: 'chooseOption', ids: ['p3'] });
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p3' });
  });

  it('Erestor of the Council: a Treasure for each opponent who voted like Alice; Alice scries X = the opponents who voted otherwise; Alice draws', () => {
    expect(ERESTOR.automation.level).toBe('full');
    let s = mpScenario({ defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Petition'], battlefield: ['Plains', 'Erestor of the Council'] } } });
    s = castAndVote(s, 'Test Petition', [['time'], ['time'], ['knowledge'], ['time']]);
    expect(stackNames(s)).toEqual(['Erestor of the Council']);
    const hand = s.zones.hand['p1']!.length;
    s = toResolve(s);
    // X = 1 (Carol voted knowledge): Alice scries 1
    s = scryBottom(s, 'p1', 1);
    expect(scried(s)).toEqual(['Alice scries 1']);
    const treasures = (p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Treasure Token').length;
    expect([treasures('p1'), treasures('p2'), treasures('p3'), treasures('p4')]).toEqual([0, 1, 0, 1]);
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
  });

  it('Erestor of the Council: everyone voted like Alice: scry 0 is no scry (CR 701.22b), three Treasures, Alice draws', () => {
    let s = mpScenario({ defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Petition'], battlefield: ['Plains', 'Erestor of the Council'] } } });
    s = castAndVote(s, 'Test Petition', [['time'], ['time'], ['time'], ['time']]);
    const hand = s.zones.hand['p1']!.length;
    s = resolveStack(s);
    expect(scried(s)).toEqual([]);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Treasure Token').length).toBe(3);
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
  });
});

describe('two players (m12 design D16)', () => {
  it('Grudge Keeper works the same with one opponent', () => {
    let s = mpScenario({ players: 2, options: { multiplayer: undefined }, defs: DEFS, cards: ['Plains'], zones: { p1: { hand: ['Test Petition'], battlefield: ['Plains', 'Grudge Keeper'] } } });
    s = castAndVote(s, 'Test Petition', [['time'], ['knowledge']]);
    s = resolveStack(s);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
});
