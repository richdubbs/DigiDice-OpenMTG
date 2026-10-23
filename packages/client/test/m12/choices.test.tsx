/**
 * M12-4b (docs/design/m12-multiplayer.md D13, 4.5, 5.3): the prompts of the choices a multiplayer game adds, on real 4-player states from M12-2's rules: the
 * protector of a Siege (CR 310.12a, 704.5x), "defending player" (CR 508.5a), "an opponent" (CR 601.7a), a choice made for a player who left (CR 800.4g-h),
 * the player on screen who has left a game that goes on, and the extension point for M12-3's votes (CR 701.38).
 */
import { render, screen } from '@testing-library/react';
import { compileCard, viewFor, type ChooseOptionDecision, type GameState, type OracleCard } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import type { GameConnection } from '../../src/connection/GameConnection';
import { PromptBar } from '../../src/prompts/PromptBar';
import { OPTION_PROMPTS, optionPromptFor, playerChoiceKind, redirectedPrompt } from '../../src/prompts/PlayerChoicePrompts';
import { PromptSelectionProvider, SelectionStore } from '../../src/prompts/selection';
import { StateConnection, click, clickRole, renderPrompt } from '../prompts/harness';
import { act, answer, concede, drive, find, mpScenario, pass, passUntil, resolveStack } from '../../../engine/test/m12/rules/helpers';

const SIEGE = 'Invasion of Tarkir // Defiant Thundermaw';

/** Alice cast a Siege: she chooses its protector among Bob, Carol and Dan (CR 310.12a). */
function siegeChoice(): GameState {
  let s = mpScenario({ cards: [SIEGE, 'Mountain'], zones: { p1: { hand: [SIEGE], battlefield: ['Mountain', 'Mountain'] } } });
  s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, SIEGE, 'hand', 'p1') }));
  return resolveStack(s);
}

describe('the multiplayer choices among players (m12 design D13)', () => {
  it('CR 310.12a: the Siege protector: the rule in words, the opponents with their life, clickable on the board; the engine takes the answer', async () => {
    const s = siegeChoice();
    expect(s.pending?.kind).toBe('chooseOption');
    const { conn } = renderPrompt(s);
    expect(screen.getByText(/chooses its protector among their opponents: that player defends it/)).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Players' }).textContent).toBe('Bob (20 life)Carol (20 life)Dan (20 life)');
    expect(screen.getByRole('button', { name: 'Board p3' })).toBeTruthy(); // the life disc on the board
    expect(screen.queryByRole('button', { name: 'Board p1' })).toBeNull();
    await click('Board p3');
    await click('Choose Carol as the protector');
    expect(conn.errors).toEqual([]);
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseOption', ids: ['p3'] });
    expect(conn.state.objects[find(conn.state, SIEGE, 'battlefield', 'p1')]!.protector).toBe('p3');
  });

  it('CR 508.5a: "defending player" outside an attacker: choose which of the defending players it means', async () => {
    const jab = compileCard({ name: 'Defender Jab', layout: 'normal', mana_cost: '{R}', type_line: 'Instant', oracle_text: 'Defending player loses 1 life.' } as OracleCard);
    let s = mpScenario({ cards: ['Grizzly Bears', 'Mountain'], defs: [jab], zones: { p1: { battlefield: ['Grizzly Bears'] }, p2: { hand: ['Defender Jab'], battlefield: ['Mountain'] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Grizzly Bears', 'battlefield', 'p1'), defender: 'p3' }] });
    s = pass(s);
    s = resolveStack(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Defender Jab', 'hand', 'p2') })));
    const { conn } = renderPrompt(s);
    expect(screen.getByText(/choose which defending player it means \(CR 508\.5a, 802\.2a\)/)).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Players' }).textContent).toBe('Bob (you, 20 life)Carol (20 life)Dan (20 life)');
    await clickRole('button', 'Dan (20 life)');
    await click('Choose Dan as the defending player');
    expect(conn.errors).toEqual([]);
    expect(conn.state.players.find((p) => p.id === 'p4')!.life).toBe(19);
  });

  it('kinds by the rules cited (CR 601.7a, 800.4g); a two-player game never uses these prompts', () => {
    const s = siegeChoice();
    const view = viewFor(s, 'p1');
    const d = s.pending as ChooseOptionDecision;
    expect(playerChoiceKind(d, view)).toBe('siegeProtector');
    expect(playerChoiceKind({ ...d, rules: ['CR 601.7a'], prompt: 'Choose an opponent.' }, view)).toBe('anOpponent');
    expect(playerChoiceKind({ ...d, rules: ['CR 601.7a'], prompt: 'Choose which of your opponents makes this choice.' }, view)).toBe('opponentChooses');
    expect(playerChoiceKind({ ...d, rules: ['CR 800.4g'], prompt: 'Bob has left the game: choose another opponent to make their choice (Choose a mode.)' }, view)).toBe('anotherOpponent');
    expect(playerChoiceKind({ ...d, options: [{ id: 'a', label: 'A' }] }, view)).toBeNull();
    const two = { ...view, options: { ...view.options, multiplayer: undefined } };
    expect(playerChoiceKind(d, two)).toBeNull();
    expect(optionPromptFor(d, two)).toBeUndefined();
  });

  it('CR 800.4g-h: a choice made for a player who left says so above the decision, and its prompt is the original one', async () => {
    const s = siegeChoice();
    const redirected = { ...s, pending: { ...(s.pending as ChooseOptionDecision), prompt: `Bob left the game; you choose for them (CR 800.4h). ${s.pending!.prompt}` } } as GameState;
    expect(redirectedPrompt(redirected.pending!.prompt)).toEqual({ who: 'Bob', rule: 'CR 800.4h', rest: s.pending!.prompt });
    expect(redirectedPrompt('Choose a mode.')).toBeNull();
    renderPrompt(redirected);
    expect(screen.getByRole('note').textContent).toBe('Bob left the game: you make this choice for them (CR 800.4h).');
    expect(screen.getByText(s.pending!.prompt, { exact: false, selector: '.prompt-text' })).toBeTruthy();
  });

  it('CR 701.38 (M12-3\'s votes): OPTION_PROMPTS draws a vote as a vote; the extension point is one table', async () => {
    expect(OPTION_PROMPTS.map((e) => e.id)).toEqual(['vote', 'multiplayerPlayers']);
    const s = siegeChoice();
    const vote = { ...s, pending: { ...(s.pending as ChooseOptionDecision), prompt: 'Will of the council: vote.', rules: ['CR 701.38a'], options: [{ id: 'grace', label: 'Grace' }, { id: 'condemnation', label: 'Condemnation' }] } } as GameState;
    renderPrompt(vote);
    expect(screen.getByText(/Vote for one of these: every player votes in turn order/)).toBeTruthy();
    await click('Grace');
    expect(screen.getByRole('button', { name: 'Vote for Grace' })).toBeTruthy();
  });

  it('CR 701.38d: a player with an additional vote casts both at once, for the same choice or different ones', async () => {
    const s = siegeChoice();
    const base = s.pending as ChooseOptionDecision;
    const vote = { ...s, pending: { ...base, prompt: 'Vote for a player (vote).', rules: ['CR 701.38a', 'CR 701.38d'], min: 2, max: 2, allowRepeat: true } } as GameState;
    renderPrompt(vote);
    expect(screen.getByText(/You have 2 votes; they can be for the same choice or different ones \(CR 701\.38d\)\./)).toBeTruthy();
    await click('Board p3');
    await click('Board p3');
    expect(screen.getByRole('button', { name: 'Carol (20 life) x2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vote for Carol and Carol' })).toBeTruthy();
    await click('Clear');
    expect(screen.getByRole('button', { name: 'Vote' })).toBeTruthy();
  });
});

/** A connection that always shows one player's view (the human against the computers, who keeps watching after leaving). */
function fixed(state: GameState, viewer: string): GameConnection {
  const conn = new StateConnection(state);
  const view = viewFor(state, viewer);
  const none: never[] = [];
  return { ...conn, view: () => view, legalActions: () => none };
}

describe('a player who left a game that goes on (m12 design D8, 5.3 item 6)', () => {
  it('the prompt bar says they left and that the game goes on for the others', () => {
    const s = concede(mpScenario(), 'p2').state;
    expect(s.result).toBeNull();
    const store = new SelectionStore();
    render(
      <PromptSelectionProvider store={store}>
        <PromptBar connection={fixed(s, 'p2')} armDelayMs={0} />
      </PromptSelectionProvider>,
    );
    expect(screen.getByText(/^You have left the game; it goes on for the others\. Waiting for (Alice|Carol|Dan)\./)).toBeTruthy();
  });
});
