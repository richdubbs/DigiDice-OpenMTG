/**
 * Shortcuts (CR 727; docs/design/shortcuts.md 7). Citations from memory, unverified (no rules/cr/ in a cloud session): CR 727.2a (the proposal), 727.2b (each
 * other player accepts or names where they want priority), 727.2c (the shortcut is performed up to there).
 *
 * - Recording (design 1): the settled actions of this turn, with their answers; cleared when a turn begins; at most TURN_ACTIONS_KEPT.
 * - The view (design 4): `repeatable` and `loop` for a seated viewer only; `turnActions` in no view.
 * - Running (design 5): every pass really played, recorded ids rebound (a token by its definition, a card by its card), a stop point, a step that no longer
 *   goes the same way, a loop that ends the game; the log condensed to pass 1 and one line.
 * - Proposals and answers out of range, another player's action in the span, three players, a saved game, the state-key pin.
 */
import { describe, expect, it } from 'vitest';
import {
  actionShapeProblem, applyAction, compileCard, createGame, gameDigest, GameSession, legalActions, openView, replay, SHORTCUT_MAX_STEPS, SHORTCUT_MAX_TIMES,
  TURN_ACTIONS_KEPT, viewFor, type Action, type CardDef, type DecisionAnswer, type GameConfig, type GameState, type OracleCard, type PlayerId,
} from '../../src/index';
import { FINGERPRINTED, NOT_READ_BY_LAYERS } from '../../src/rules/characteristics';
import { act, answer, find, findAll, life, reject, scenario } from '../m3/scenario';
import { mpScenario } from '../m12/rules/helpers';

const card = (name: string, typeLine: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{1}', type_line: typeLine, oracle_text: text, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);

const FOUNTAIN = card('Life Fountain', 'Artifact', '{0}: You gain 1 life.');
const MAKER = card('Soldier Maker', 'Artifact', '{0}: Create a 1/1 white Soldier creature token.');
const ALTAR = card('Altar Test', 'Artifact', 'Sacrifice a creature: You gain 1 life.');
const BLINKER = card('Blinker', 'Creature — Spirit', '{0}: Exile target creature you control, then return it to the battlefield under its owner\'s control.', ['1', '1']);
const PINGER = card('Pinger', 'Artifact', '{0}: Target player loses 1 life.');
const LIMITED = card('Limited Fountain', 'Artifact', '{0}: You gain 1 life. Activate only three times each turn.');
const DEFS = [FOUNTAIN, MAKER, ALTAR, BLINKER, PINGER, LIMITED];

const AUTO = { fullControl: false };

it('the synthetic cards are automated (no manual ability), so the tests exercise the engine, not a by-hand resolution', () => {
  for (const d of DEFS) expect(d.faces[0]!.abilities.map((a) => a.kind), d.name).toEqual(['activated']);
});

/** `player` activates the ability of their permanent named `name`, answering the decisions with `answers` (costs paid automatically). */
function activate(s: GameState, player: PlayerId, name: string, answers: DecisionAnswer[] = []): GameState {
  const source = find(s, name, 'battlefield', player);
  const la = legalActions(s, player).find((a) => a.kind === 'activate' && a.object === source);
  if (!la) throw new Error(`${name} cannot be activated`);
  let t = act(s, la.action);
  const queue = [...answers];
  while (t.pending && t.pending.kind !== 'priority') {
    if (t.pending.kind === 'payCost' && queue[0]?.kind !== 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    else t = answer(t, queue.shift() ?? (() => { throw new Error(`No answer for ${t.pending!.kind}`); })());
  }
  return t;
}

const passBy = (s: GameState, player: PlayerId): GameState => act(s, { type: 'pass', player });
const propose = (s: GameState, steps: number, times: number, player: PlayerId = 'p1'): GameState => act(s, { type: 'shortcut', player, steps, times });
const consent = (s: GameState, stop?: { pass: number; step: number }): GameState => answer(s, { kind: 'shortcut', ...(stop ? { stop } : {}) });
const texts = (s: GameState): string[] => s.log.map((l) => l.text);
/** The log lines written since `before`. */
const since = (before: GameState, after: GameState): string[] => after.log.slice(before.log.length).map((l) => l.text);

/** Full control (the scenario default): one loop by hand, Alice activates Life Fountain, passes, and Bob's pass resolves it. Alice holds priority after. */
function fountainLoop(): GameState {
  let s = scenario([], { defs: DEFS, p1: { battlefield: ['Life Fountain'] } });
  s = activate(s, 'p1', 'Life Fountain');
  s = passBy(s, 'p1');
  return passBy(s, 'p2');
}

describe('design 1: the settled actions of this turn are recorded', () => {
  it('each settled priority action and pass, with the answers it took; an answer records the action it settled; nothing for a decision still pending', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Pinger'] } });
    const before = s.turnActions?.length ?? 0;
    expect(s.turnActions?.every((r) => r.action.type === 'pass')).toBe(true); // the scenario passed through the upkeep
    const source = find(s, 'Pinger', 'battlefield', 'p1');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === source)!;
    s = act(s, la.action);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(s.turnActions?.length ?? 0).toBe(before); // suspended: not settled yet
    const targets: DecisionAnswer = { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] };
    while (s.pending && s.pending.kind !== 'priority') s = answer(s, s.pending.kind === 'payCost' ? { kind: 'payCost', auto: true } : targets);
    expect(s.turnActions).toHaveLength(before + 1);
    const rec = s.turnActions!.at(-1)!;
    expect(rec.action).toEqual(la.action);
    expect(rec.answers).toContainEqual(targets);
    expect(rec.answeredBy).toBeUndefined(); // a two-player game records no answerers
    s = passBy(passBy(s, 'p1'), 'p2');
    expect(s.turnActions!.slice(-2).map((r) => [r.action.type, r.action.player])).toEqual([['pass', 'p1'], ['pass', 'p2']]);
  });

  it('a stops change, a cancel and a rejected action record nothing; a new turn clears the list (the pass that began it belongs to the turn before)', () => {
    let s = fountainLoop();
    const n = s.turnActions!.length;
    s = act(s, { type: 'setStops', player: 'p2', stops: { ...s.players[1]!.stops, fullControl: true } });
    expect(s.turnActions).toHaveLength(n);
    expect(applyAction(s, { type: 'pass', player: 'p2' }).error).toBeDefined();
    // to the next turn: Alice's turn ends, Bob's begins
    while (s.turn.number === 1) {
      const d = s.pending!;
      s = d.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : passBy(s, d.player);
    }
    expect(s.turn.number).toBe(2);
    expect(s.turnActions).toBeUndefined();
    s = passBy(s, s.pending!.player);
    expect(s.turnActions).toHaveLength(1);
  });

  it(`at most ${TURN_ACTIONS_KEPT} entries are kept, the oldest dropped`, () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Life Fountain'] }, stops: AUTO });
    for (let i = 0; i < TURN_ACTIONS_KEPT + 6; i++) s = activate(s, 'p1', 'Life Fountain');
    expect(life(s, 'p1')).toBe(20 + TURN_ACTIONS_KEPT + 6);
    expect(s.turnActions).toHaveLength(TURN_ACTIONS_KEPT);
    expect(s.turnActions!.every((r) => r.action.type === 'activate')).toBe(true);
  });

  it('state-key pin: turnActions is listed as not read by the layers (and is not in the fingerprint)', () => {
    expect(NOT_READ_BY_LAYERS).toContain('turnActions');
    expect(FINGERPRINTED).not.toContain('turnActions');
  });
});

describe('design 4: what the view shows', () => {
  it('the viewer sees their own repeatable steps in words and the loop the engine noticed; the opponent sees neither; a spectator nothing; no view carries turnActions', () => {
    let s = fountainLoop();
    s = activate(s, 'p1', 'Life Fountain');
    s = passBy(passBy(s, 'p1'), 'p2');
    const mine = viewFor(s, 'p1');
    const label = 'Life Fountain: {0}: You gain 1 life.';
    expect(mine.repeatable).toEqual(['Pass priority', label, 'Pass priority', label, 'Pass priority']); // the upkeep pass, then two loops
    expect(mine.loop).toBe(2);
    const theirs = viewFor(s, 'p2');
    expect(theirs.repeatable).toEqual(['Pass priority']); // Bob's own pass since Alice last did something but pass
    expect(theirs.loop).toBeUndefined();
    const spectator = viewFor(s, null);
    expect(spectator.repeatable).toBeUndefined();
    expect(spectator.loop).toBeUndefined();
    for (const v of [mine, theirs, spectator, openView(s)]) expect('turnActions' in v).toBe(false);
    expect(JSON.stringify(mine.repeatable)).not.toMatch(/\bo\d+\b/); // no object id
  });

  it('one loop done only once: steps but no loop yet', () => {
    const v = viewFor(fountainLoop(), 'p1');
    expect(v.repeatable).toEqual(['Pass priority', 'Life Fountain: {0}: You gain 1 life.', 'Pass priority']);
    expect(v.loop).toBeUndefined();
  });
});

describe('design 5: running the shortcut', () => {
  it('a free "{0}: You gain 1 life." repeated 50 times with the opponent agreeing: every pass played, the log condensed to pass 1 and one line', () => {
    const s = fountainLoop();
    expect(life(s, 'p1')).toBe(21);
    let t = propose(s, 2, 50);
    expect(t.pending).toMatchObject({ kind: 'shortcut', player: 'p2', proposer: 'p1', times: 50, steps: ['Life Fountain: {0}: You gain 1 life.', 'Pass priority'] });
    expect(t.pending!.cancellable).toBeUndefined();
    expect(viewFor(t, 'p1').pending).toMatchObject({ kind: 'priority', player: 'p2' }); // the proposer sees "waiting"
    expect(applyAction(t, { type: 'cancel', player: 'p2' }).error).toBeDefined();
    const r = applyAction(t, { type: 'answer', player: 'p2', decisionId: t.pending!.id, answer: { kind: 'shortcut' } });
    expect(r.error).toBeUndefined();
    t = r.state;
    expect(life(t, 'p1')).toBe(71);
    expect(t.players[0]!.turnStats.lifeGained).toBe(51); // the state keeps every pass
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(t.zones.stack).toEqual([]);
    expect(t.suspended).toBeNull();
    const lines = since(s, t);
    expect(lines.filter((l) => /gains 1 life/.test(l))).toHaveLength(1); // pass 1 only
    expect(lines[0]).toMatch(/^Alice proposes a shortcut: Life Fountain: \{0\}: You gain 1 life\. \/ Pass priority, 50 times\.$/);
    expect(lines[1]).toBe('Bob lets it run.');
    expect(lines.at(-1)).toBe('Passes 2 to 50 went the same way (50 passes in all).');
    expect(lines).toHaveLength(8); // proposal, consent, pass 1 (activate, two passes, life, resolves), summary
    expect(r.events.length).toBeGreaterThan(0);
    expect(t.turnActions).toEqual(s.turnActions); // what a shortcut plays is not recorded
  });

  it('the auto-pass shape: the activation alone resolves within one action, so the body is one step', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Life Fountain'] }, stops: AUTO });
    s = activate(s, 'p1', 'Life Fountain');
    expect(life(s, 'p1')).toBe(21);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(viewFor(s, 'p1').repeatable).toEqual(['Life Fountain: {0}: You gain 1 life.']);
    const t = consent(propose(s, 1, 10));
    expect(life(t, 'p1')).toBe(31);
    expect(texts(t).at(-1)).toBe('Passes 2 to 10 went the same way (10 passes in all).');
  });

  it('the opponent stops at pass 3: they hold priority there with the ability on the stack (CR 727.2b)', () => {
    const s = fountainLoop();
    let t = consent(propose(s, 2, 50), { pass: 3, step: 2 });
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(t.zones.stack).toHaveLength(1);
    expect(life(t, 'p1')).toBe(23); // passes 1 and 2 resolved
    const lines = since(s, t);
    expect(lines[1]).toBe('Bob will take priority at pass 3, after step 2.');
    expect(lines.at(-1)).toBe('Bob takes priority at pass 3, after step 2, as they asked: the shortcut ends there (2 passes done in full).');
    t = passBy(t, 'p2');
    expect(life(t, 'p1')).toBe(24);
  });

  it('a stop at a step the proposer reaches without the opponent getting priority waits for the first time they do (pass 3 step 1: after the pass)', () => {
    const t = consent(propose(fountainLoop(), 2, 50), { pass: 3, step: 1 });
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(t.zones.stack).toHaveLength(1);
    expect(texts(t).at(-1)).toMatch(/^Bob takes priority at pass 3, after step 2/);
  });

  it('a token made and sacrificed each pass: the sacrifice names the new token (rebinding by definition)', () => {
    let s = scenario(['Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Soldier Maker', 'Altar Test', 'Grizzly Bears'] }, stops: AUTO });
    s = activate(s, 'p1', 'Soldier Maker');
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    s = activate(s, 'p1', 'Altar Test', [{ kind: 'chooseObjects', ids: [token] }]);
    expect(s.objects[token]).toBeUndefined();
    expect(s.turnActions!.at(-1)!.answers).toContainEqual({ kind: 'chooseObjects', ids: [token] });
    expect(life(s, 'p1')).toBe(21);
    const t = consent(propose(s, 2, 5));
    expect(life(t, 'p1')).toBe(26);
    expect(t.zones.battlefield.filter((id) => t.objects[id]!.kind === 'token')).toEqual([]);
    expect(findAll(t, 'Grizzly Bears', 'battlefield')).toHaveLength(1); // never the Bears
    expect(texts(t).at(-1)).toBe('Passes 2 to 5 went the same way (5 passes in all).');
  });

  it('a card that leaves and returns each pass: the activation names it by its card (rebinding by cardId)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Blinker'] }, stops: AUTO });
    const first = find(s, 'Blinker', 'battlefield', 'p1');
    const cardId = s.objects[first]!.cardId;
    s = activate(s, 'p1', 'Blinker', [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: first }] }]);
    const second = find(s, 'Blinker', 'battlefield', 'p1');
    expect(second).not.toBe(first);
    const t = consent(propose(s, 1, 5));
    const last = find(t, 'Blinker', 'battlefield', 'p1');
    expect(t.objects[last]!.cardId).toBe(cardId);
    expect(last).not.toBe(second);
    expect(texts(t).at(-1)).toBe('Passes 2 to 5 went the same way (5 passes in all).');
    expect(t.history.length).toBeGreaterThan(s.history.length);
  });

  it('a step that becomes illegal part-way ("Activate only three times each turn") stops the shortcut with the state after the last complete pass (CR 733.1)', () => {
    // Full control: with automatic passing, Alice would have nothing left to do after the third activation and the turn would move on by itself
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Limited Fountain'] } });
    s = activate(s, 'p1', 'Limited Fountain');
    s = passBy(passBy(s, 'p1'), 'p2');
    const t = consent(propose(s, 2, 10));
    expect(life(t, 'p1')).toBe(23);
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(t.zones.stack).toEqual([]);
    const lines = since(s, t);
    expect(lines.at(-1)).toMatch(/^The shortcut stops before pass 3, step 1: the loop no longer goes the same way: .+\. Alice plays on by hand \(2 passes done in full\)\.$/);
    expect(t.log.at(-1)!.level).toBe('warning');
    expect(lines.filter((l) => /gains 1 life/.test(l))).toHaveLength(1); // pass 2 went the same way: not worded again
  });

  it('under automatic passing, a step that moves the game to a later turn ends the shortcut after it (the step stays applied; the runner does not go on)', () => {
    // The third activation leaves Alice nothing to do: the engine passes for both players into the next turns. The shortcut ends there, it is not carried on.
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Limited Fountain'] }, stops: AUTO });
    s = activate(s, 'p1', 'Limited Fountain');
    expect(s.turn.number).toBe(1);
    const t = consent(propose(s, 1, 5));
    expect(life(t, 'p1')).toBe(23); // the activations of passes 1 and 2; nothing in the later turn
    expect(t.turn.number).toBeGreaterThan(1);
    expect(t.log.at(-1)!.rules).toEqual(['CR 727.2c']);
    expect(texts(t).at(-1)).toMatch(/^The shortcut ends during pass 2, step 1: the turn moved on \(to turn \d+, [a-z].*\)\. Alice plays on by hand \(2 passes done in full\)\.$/);
    expect(texts(t).filter((l) => /loop no longer goes the same way/.test(l))).toEqual([]);
  });

  it('a loop that wins the game part-way ends the game there', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Pinger'] }, stops: AUTO, life: 3 });
    s = activate(s, 'p1', 'Pinger', [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect(life(s, 'p2')).toBe(2);
    const t = consent(propose(s, 1, 50));
    expect(life(t, 'p2')).toBe(0);
    expect(t.result).toMatchObject({ winner: 'p1' });
    expect(t.pending).toBeNull();
    expect(texts(t).at(-1)).toBe('The game is over: the shortcut ends during pass 2 (1 pass done in full before it).');
  });
});

describe('design 2, 3: proposals and answers that are not legal are rejected, never half-applied (CR 733)', () => {
  it('steps and times out of range, more steps than taken, a player without priority', () => {
    const s = fountainLoop();
    for (const [steps, times] of [[0, 5], [SHORTCUT_MAX_STEPS + 1, 5], [1.5, 5], [1, 0], [1, SHORTCUT_MAX_TIMES + 1], [1, 2.5]] as const) {
      expect(reject(s, { type: 'shortcut', player: 'p1', steps, times }).rules).toContain('CR 727.2a');
    }
    expect(reject(s, { type: 'shortcut', player: 'p1', steps: 4, times: 5 }).message).toMatch(/You have taken 3 actions this turn, not 4/);
    expect(reject(s, { type: 'shortcut', player: 'p2', steps: 1, times: 5 }).message).toMatch(/Alice has priority/);
    expect(applyAction(s, { type: 'shortcut', player: 'p1', steps: 3, times: SHORTCUT_MAX_TIMES }).error).toBeUndefined();
  });

  it('answers out of range: a pass or a step outside the proposal, a malformed stop', () => {
    const t = propose(fountainLoop(), 2, 5);
    const bad = [{ pass: 0, step: 1 }, { pass: 6, step: 1 }, { pass: 1, step: 0 }, { pass: 1, step: 3 }, { pass: 1.5, step: 1 }, null, 'x'];
    for (const stop of bad) {
      reject(t, { type: 'answer', player: 'p2', decisionId: t.pending!.id, answer: { kind: 'shortcut', stop } as unknown as DecisionAnswer });
    }
    expect(reject(t, { type: 'answer', player: 'p1', decisionId: t.pending!.id, answer: { kind: 'shortcut' } }).message).toMatch(/Waiting for Bob/);
    expect(applyAction(t, { type: 'answer', player: 'p2', decisionId: t.pending!.id, answer: { kind: 'shortcut', stop: { pass: 5, step: 2 } } }).error).toBeUndefined();
  });

  it('another player\'s action inside the span is rejected; a span with only their passes is legal', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Life Fountain'] }, p2: { battlefield: ['Life Fountain'] } });
    s = activate(s, 'p1', 'Life Fountain');
    s = passBy(s, 'p1');
    s = activate(s, 'p2', 'Life Fountain'); // in response
    s = passBy(s, 'p2');
    s = passBy(s, 'p1'); // Bob's ability resolves
    s = passBy(s, 'p1');
    s = passBy(s, 'p2'); // Alice's resolves
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(reject(s, { type: 'shortcut', player: 'p1', steps: 3, times: 2 }).message).toMatch(/Another player acted during those steps/);
    expect(applyAction(s, { type: 'shortcut', player: 'p1', steps: 2, times: 2 }).error).toBeUndefined();
    expect(viewFor(s, 'p1').repeatable).toEqual(['Pass priority', 'Pass priority']); // since Bob's activation
  });
});

describe('multiplayer (CR 727.2b, in turn order)', () => {
  it('three players: each other player is asked in turn order after the proposer, and the earliest stop wins', () => {
    let s = mpScenario({ players: 3, defs: [FOUNTAIN], zones: { p1: { battlefield: ['Life Fountain'] } } });
    s = activate(s, 'p1', 'Life Fountain');
    s = passBy(passBy(passBy(s, 'p1'), 'p2'), 'p3');
    expect(life(s, 'p1')).toBe(21);
    let t = propose(s, 2, 10);
    expect(t.pending).toMatchObject({ kind: 'shortcut', player: 'p2' });
    t = consent(t, { pass: 5, step: 2 });
    expect(t.pending).toMatchObject({ kind: 'shortcut', player: 'p3' });
    expect(t.suspended!.answeredBy).toEqual(['p2']);
    t = consent(t, { pass: 3, step: 2 });
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p3' });
    expect(t.zones.stack).toHaveLength(1);
    expect(life(t, 'p1')).toBe(23);
    expect(texts(t).at(-1)).toMatch(/^Carol takes priority at pass 3, after step 2/);
  });
});

describe('design 6: a saved game with a shortcut', () => {
  const SPRING = card('Life Spring', 'Land', '{0}: You gain 1 life.');
  const config = (): GameConfig => ({
    seed: 'shortcut-replay',
    players: [{ name: 'Alice', deck: Array(40).fill('Life Spring'), stops: { fullControl: true } }, { name: 'Bob', deck: Array(40).fill('Life Spring'), stops: { fullControl: true } }],
    defs: [SPRING],
    options: { startingPlayer: 'p1', skipMulligans: true },
  });

  it('replays to the same digest, and its actions pass the outside shape check', () => {
    const session = new GameSession(config());
    const apply = (a: Action): void => {
      const r = session.apply(a);
      if (!r.ok) throw new Error(r.error.message);
    };
    const pending = () => session.state.pending!;
    while (session.state.turn.step !== 'main1') apply({ type: 'pass', player: pending().player });
    const land = legalActions(session.state, 'p1').find((a) => a.kind === 'playLand')!;
    apply(land.action);
    const ability = legalActions(session.state, 'p1').find((a) => a.kind === 'activate')!;
    apply(ability.action);
    while (pending().kind === 'payCost') apply({ type: 'answer', player: pending().player, decisionId: pending().id, answer: { kind: 'payCost', auto: true } });
    apply({ type: 'pass', player: 'p1' });
    apply({ type: 'pass', player: 'p2' });
    apply({ type: 'shortcut', player: 'p1', steps: 2, times: 20 });
    apply({ type: 'answer', player: 'p2', decisionId: pending().id, answer: { kind: 'shortcut', stop: { pass: 15, step: 2 } } });
    expect(session.state.players[0]!.life).toBe(20 + 1 + 14);
    for (const a of session.actions) expect(actionShapeProblem(a, { exactFields: true }), JSON.stringify(a)).toBeNull();
    const saved = JSON.parse(JSON.stringify(session.toJSON())) as ReturnType<GameSession['toJSON']>;
    const again = GameSession.fromJSON(saved);
    expect(gameDigest(again.state)).toBe(gameDigest(session.state));
    expect(texts(again.state)).toEqual(texts(session.state));
    const r = replay(config(), saved.actions);
    expect(r.errors).toEqual([]);
    expect(gameDigest(r.state)).toBe(gameDigest(session.state));
    expect(createGame(config()).turnActions).toBeUndefined();
  });

  it('the shape check refuses a shortcut out of the caps and unknown fields', () => {
    const ok = { type: 'shortcut', player: 'p1', steps: 2, times: 50 };
    expect(actionShapeProblem(ok, { exactFields: true })).toBeNull();
    expect(actionShapeProblem({ ...ok, steps: 0 })).toBe('action malformed');
    expect(actionShapeProblem({ ...ok, steps: SHORTCUT_MAX_STEPS + 1 })).toBe('action malformed');
    expect(actionShapeProblem({ ...ok, times: SHORTCUT_MAX_TIMES + 1 })).toBe('action malformed');
    expect(actionShapeProblem({ ...ok, times: '5' })).toBe('action malformed');
    expect(actionShapeProblem({ ...ok, extra: 1 }, { exactFields: true })).toMatch(/unknown action field/);
    const answerOk = { type: 'answer', player: 'p2', decisionId: 'd9', answer: { kind: 'shortcut', stop: { pass: 1, step: 1 } } };
    expect(actionShapeProblem(answerOk, { exactFields: true })).toBeNull();
    expect(actionShapeProblem({ ...answerOk, answer: { kind: 'shortcut', junk: 1 } }, { exactFields: true })).toMatch(/unknown answer field/);
  });
});
