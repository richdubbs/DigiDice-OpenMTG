/**
 * M12-2 (docs/design/m12-multiplayer.md D5, D13, 4.5, E14, E19-E21): who chooses in a multiplayer game. The decisions of a player who left the game
 * (CR 800.4f-h, `Game.choose`), the choices that exist only with several opponents (CR 310.12a, 508.5a, 601.7a; asked only with two or more), and a
 * resolution whose controller left (CR 800.4a).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { NeedDecision } from '../../../src/core/errors';
import { chooserOf } from '../../../src/actions/announce-targets';
import { playerMatches } from '../../../src/triggers/filters';
import { supportsForm } from '../../../src/actions/announce';
import { cloneState } from '../../../src/util/clone';
import { act, answer, concede, drive, find, lifeOf, logHas, mpScenario, pass, passUntil, playerOf, resolveStack } from './helpers';
import { mainPhaseGame } from '../skeleton/helpers';

const spell = (name: string, text: string, cost = '{R}'): ReturnType<typeof compileCard> =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: 'Instant', oracle_text: text } as OracleCard);

/** The decision `g.choose(input)` raises (or its answer when it returns one). */
function ask(g: Game, input: Parameters<Game['choose']>[0]): { decision?: NeedDecision['decision']; answer?: unknown } {
  try {
    return { answer: g.choose(input) };
  } catch (e) {
    if (e instanceof NeedDecision) return { decision: e.decision };
    throw e;
  }
}

/** A 4-player game in which Bob (p2) has left. */
const bobLeft = (): GameState => cloneState(concede(mpScenario(), 'p2').state);

describe('CR 800.4f-h: decisions of a player who left the game (core/game.ts#choose, m12 design 4.5)', () => {
  it('CR 800.4f: a cost the leaver would choose whether to pay is not paid (a yes / no question is answered no, nobody is asked)', () => {
    const g = new Game(bobLeft());
    const r = ask(g, { kind: 'yesNo', player: 'p2', prompt: 'Pay {2}?', asker: { kind: 'cost', controller: 'p1' } });
    expect(r.answer).toEqual({ kind: 'yesNo', yes: false });
    expect(g.s.log.at(-1)?.rules).toEqual(['CR 800.4f']);
  });

  it('CR 800.4g: an opponent\'s choice: the controller of the object chooses another opponent (asked with two or more), who makes it', () => {
    const input = { kind: 'chooseOption' as const, player: 'p2', prompt: 'Choose a mode.', min: 1, max: 1, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], asker: { kind: 'opponentChoice' as const, controller: 'p1' } };
    const first = ask(new Game(bobLeft()), input).decision!;
    expect(first).toMatchObject({ kind: 'chooseOption', player: 'p1', rules: ['CR 800.4g'] });
    expect((first as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(['p3', 'p4']);
    const picked: DecisionAnswer = { kind: 'chooseOption', ids: ['p4'] };
    const second = ask(new Game(bobLeft(), [picked]), input).decision!;
    expect(second).toMatchObject({ kind: 'chooseOption', player: 'p4' });
    expect(second.prompt).toMatch(/^Bob left the game; you choose for them \(CR 800\.4g\)\. Choose a mode\./);
  });

  it('CR 800.4h: a rule\'s choice (no asker) goes to the next player in turn order', () => {
    const d = ask(new Game(bobLeft()), { kind: 'chooseNumber', player: 'p2', prompt: 'Choose a number.', min: 0, max: 3 }).decision!;
    expect(d).toMatchObject({ kind: 'chooseNumber', player: 'p3' });
    expect(d.rules).toContain('CR 800.4h');
  });

  it('m12 design 4.5, D16: a decision asked while a spell resolves names its asker in a multiplayer game only', () => {
    const g = new Game(cloneState(mpScenario()));
    g.effectController = 'p1';
    expect(ask(g, { kind: 'yesNo', player: 'p3', prompt: '?' }).decision!.asker).toEqual({ kind: 'opponentChoice', controller: 'p1' });
    expect(ask(g, { kind: 'yesNo', player: 'p1', prompt: '?' }).decision!.asker).toEqual({ kind: 'choice', controller: 'p1' });
    const two = new Game(cloneState(mainPhaseGame(2)));
    two.effectController = 'p1';
    expect(Object.hasOwn(ask(two, { kind: 'yesNo', player: 'p2', prompt: '?' }).decision!, 'asker')).toBe(false);
  });
});

describe('choices that exist only with several opponents (m12 design D13)', () => {
  it('CR 601.7a: "an opponent" chooses: with several opponents the spell\'s controller decides which (before: the first, silently)', () => {
    const s = cloneState(mpScenario());
    let raised: NeedDecision['decision'] | undefined;
    try { chooserOf(new Game(s), 'p1', { ref: 'anOpponent' }, s.zones.library['p1']![0]!, new Map()); } catch (e) { if (e instanceof NeedDecision) raised = e.decision; else throw e; }
    expect(raised).toMatchObject({ kind: 'chooseOption', player: 'p1', rules: ['CR 601.7a'] });
    expect(chooserOf(new Game(s, [{ kind: 'chooseOption', ids: ['p3'] }]), 'p1', { ref: 'anOpponent' }, s.zones.library['p1']![0]!, new Map())).toBe('p3');
    const two = cloneState(mainPhaseGame(2));
    expect(chooserOf(new Game(two), 'p1', { ref: 'anOpponent' }, two.zones.library['p1']![0]!, new Map())).toBe('p2'); // one opponent: nothing to ask
  });

  it('CR 508.5a, 802.2a: "defending player" outside an attacker: the controller of the spell chooses one of the defending players', () => {
    const jab = spell('Defender Jab', 'Defending player loses 1 life.');
    let s = mpScenario({ cards: ['Grizzly Bears', 'Mountain'], defs: [jab], zones: { p1: { battlefield: ['Grizzly Bears'] }, p2: { hand: ['Defender Jab'], battlefield: ['Mountain'] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Grizzly Bears', 'battlefield', 'p1'), defender: 'p3' }] });
    s = pass(s); // Alice passes in the declare attackers step: Bob
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Defender Jab', 'hand', 'p2') }));
    s = resolveStack(s);
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p2', rules: ['CR 508.5a', 'CR 802.2a'] });
    expect((s.pending as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(['p2', 'p3', 'p4']);
    s = answer(s, { kind: 'chooseOption', ids: ['p4'] });
    expect(lifeOf(s, 'p4')).toBe(19);
  });

  it('CR 310.12a: a Siege\'s controller chooses its protector among their opponents as it enters (three here)', () => {
    let s = mpScenario({ cards: ['Invasion of Tarkir // Defiant Thundermaw', 'Mountain'], zones: { p1: { hand: ['Invasion of Tarkir // Defiant Thundermaw'], battlefield: ['Mountain', 'Mountain'] } } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Invasion of Tarkir // Defiant Thundermaw', 'hand', 'p1') }));
    s = resolveStack(s);
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', rules: ['CR 310.9a', 'CR 310.12a'] });
    expect((s.pending as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(['p2', 'p3', 'p4']);
    s = answer(s, { kind: 'chooseOption', ids: ['p3'] });
    const siege = find(s, 'Invasion of Tarkir // Defiant Thundermaw', 'battlefield', 'p1');
    expect(s.objects[siege]!.protector).toBe('p3');
  });

  it('CR 704.5x, 310.12a: the protector of a Siege leaves the game: its controller chooses a new one among the opponents left', () => {
    const s = mpScenario({
      cards: ['Invasion of Tarkir // Defiant Thundermaw'], zones: { p1: { battlefield: [{ name: 'Invasion of Tarkir // Defiant Thundermaw', counters: { defense: 5 } }] } },
      setup: (x) => { x.objects[find(x, 'Invasion of Tarkir // Defiant Thundermaw', 'battlefield', 'p1')]!.protector = 'p2'; },
    });
    let t = concede(s, 'p2').state;
    expect(t.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', rules: ['CR 704.5x', 'CR 310.12a'] });
    expect((t.pending as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(['p3', 'p4']);
    t = answer(t, { kind: 'chooseOption', ids: ['p4'] });
    expect(t.objects[find(t, 'Invasion of Tarkir // Defiant Thundermaw', 'battlefield', 'p1')]!.protector).toBe('p4');
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p1' });
  });

  it('CR 800.4a, 102.3: a player who left is nobody\'s opponent in trigger patterns any more; "the player to your left" can be announced', () => {
    const s = bobLeft();
    expect(playerMatches(s, 'opponent', 'p2', { source: 'x', controller: 'p1' })).toBe(false);
    expect(playerMatches(s, 'opponent', 'p3', { source: 'x', controller: 'p1' })).toBe(true);
    expect(supportsForm('feature:announce.cref.seat')).toBe(true);
    expect(supportsForm('feature:announce.sref.seat')).toBe(true);
  });
});

describe('CR 800.4a: a resolution whose controller left the game (core/resolve.ts, effects/run.ts)', () => {
  it('a resolving spell whose controller left stops at once: what it already did stays done, the rest does not happen', () => {
    const quit = spell('Rage Quit', 'Each opponent loses 2 life. You lose the game. Each opponent gains 5 life.');
    let s = mpScenario({ cards: ['Mountain'], defs: [quit], zones: { p2: { hand: ['Rage Quit'], battlefield: ['Mountain'] } } });
    s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Rage Quit', 'hand', 'p2') }));
    s = resolveStack(s);
    expect(playerOf(s, 'p2').left).toMatchObject({ order: 1, rules: ['CR 104.3e'] });
    expect(['p1', 'p3', 'p4'].map((p) => lifeOf(s, p))).toEqual([18, 18, 18]); // the loss happened, the gain never does
    expect(logHas(s, /Rage Quit stops resolving: its controller left the game/, 'CR 800.4a')).toBe(true);
    expect(s.zones.graveyard['p2']).toEqual([]); // it left the game with its owner
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
  });
});
