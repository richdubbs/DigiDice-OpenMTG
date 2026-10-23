/**
 * Decisions drawn large on the board's stage, Arena style: the opening hand (CR 103.5) and assigning combat damage (CR 510.1c-d,
 * 702.19b). The prompt keeps its rail content; on a board it also fills the stage and its buttons move under the stage's cards.
 */
import { act as reactAct, fireEvent, render, screen, within } from '@testing-library/react';
import { createGame, type AssignDamageDecision, type GameState } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { GameBoard } from '../../src/board';
import { useGameView } from '../../src/connection/useGame';
import { addDamage, AssignDamagePrompt } from '../../src/prompts/DamagePrompts';
import { PromptBar } from '../../src/prompts/PromptBar';
import { PromptSelectionProvider, SelectionStore } from '../../src/prompts/selection';
import { opponentsMulliganStatus } from '../../src/prompts/SimplePrompts';
import { smallConfig } from '../helpers';
import { declareAttackers, declareBlockers, drive, find, findAll, passUntil, scenario, StateConnection, toDeclareAttackers, toDeclareBlockers } from './harness';

function Board({ conn }: { conn: StateConnection }) {
  const view = useGameView(conn);
  return <GameBoard view={view} prompt={<PromptBar connection={conn} armDelayMs={0} />} />;
}

function renderOnBoard(state: GameState) {
  const conn = new StateConnection(state);
  const utils = render(
    <PromptSelectionProvider store={new SelectionStore()}>
      <Board conn={conn} />
    </PromptSelectionProvider>,
  );
  return { conn, ...utils };
}

const stage = () => document.querySelector<HTMLElement>('.prompt-stage')!;

function blockedBy(attacker: string, blockers: string[]): GameState {
  let s = scenario([attacker, ...blockers], { p1: { battlefield: [attacker] }, p2: { battlefield: blockers } });
  s = declareAttackers(toDeclareAttackers(s), [[find(s, attacker, 'battlefield', 'p1')]]);
  s = toDeclareBlockers(s);
  const a = find(s, attacker, 'battlefield', 'p1');
  s = declareBlockers(s, findAll(s, blockers[0]!, 'battlefield', 'p2').map((b) => [b, a] as [string, string]));
  return passUntil(s, (x) => x.pending?.kind === 'assignDamage', 'the damage assignment');
}

async function clickIn(el: HTMLElement) {
  await reactAct(async () => {
    fireEvent.click(el);
  });
}

describe('the damage screen (CR 510.1c-d)', () => {
  it('shows the attacker, the blockers First ... Last with their damage, and its buttons under them', () => {
    const s = blockedBy('Craw Wurm', ['Grizzly Bears', 'Grizzly Bears']);
    renderOnBoard(s);
    const st = stage();
    expect(st.getAttribute('aria-label')).toBe('Assign damage');
    expect(st.querySelectorAll('.prompt-dmg-row .prompt-dmg-slot')).toHaveLength(2);
    expect(st.querySelector('.prompt-dmg-ends')!.textContent).toBe('FirstLast');
    // The default: lethal damage in order, the rest to the first creature (CR 510.1c).
    expect([...st.querySelectorAll('.prompt-dmg-row .prompt-dmg-n')].map((n) => n.textContent)).toEqual(['4', '2']);
    expect(within(st).getByRole('button', { name: 'Assign damage' })).toBeTruthy();
    // No stage card is a board card: the animator and the arrows find the board's cards by data-object-id.
    expect(st.querySelector('[data-object-id]')).toBeNull();
  });

  it('a click assigns one more damage (taken from the last creature that has some), a right-click takes one back; Assign damage answers', async () => {
    const s = blockedBy('Craw Wurm', ['Grizzly Bears', 'Grizzly Bears']);
    const [b1, b2] = findAll(s, 'Grizzly Bears', 'battlefield', 'p2');
    const { conn } = renderOnBoard(s);
    const st = stage();
    const pick = (id: string) => st.querySelector<HTMLElement>(`[data-stage-id="${id}"]`)!.closest<HTMLElement>('.prompt-dmg-pick')!;
    await clickIn(pick(b2!));
    expect([...st.querySelectorAll('.prompt-dmg-row .prompt-dmg-n')].map((n) => n.textContent)).toEqual(['3', '3']);
    await reactAct(async () => {
      fireEvent.contextMenu(pick(b1!));
    });
    expect(st.querySelector('.prompt-dmg-total')!.textContent).toContain('1 left');
    expect((within(st).getByRole('button', { name: 'Assign damage' }) as HTMLButtonElement).disabled).toBe(true);
    await clickIn(pick(b1!));
    // Changing an amount by hand turns Auto allocate off.
    expect((within(st).getByRole('checkbox', { name: 'Auto allocate damage' }) as HTMLInputElement).checked).toBe(false);
    await clickIn(within(st).getByRole('button', { name: 'Assign damage' }));
    expect(conn.lastAnswer()).toEqual({ kind: 'assignDamage', amounts: [{ id: b1, amount: 3 }, { id: b2, amount: 3 }] });
    expect(conn.errors).toEqual([]);
  });

  it('CR 702.19b: with trample what it attacks is at the right; damage to it before the blocker has lethal damage cannot be assigned', async () => {
    const s = blockedBy('Colossal Dreadmaw', ['Grizzly Bears']);
    renderOnBoard(s);
    const st = stage();
    const player = st.querySelector<HTMLElement>('.prompt-dmg-player')!;
    expect(player.textContent).toContain('20');
    expect(st.querySelector('.prompt-dmg-target .prompt-dmg-n')!.textContent).toBe('4');
    await clickIn(player);
    expect(st.querySelector('.prompt-dmg-target .prompt-dmg-n')!.textContent).toBe('5');
    expect(st.querySelector('.prompt-stage-problem')!.textContent).toMatch(/lethal damage/);
    // Auto allocate puts it back: lethal to the blocker, the rest tramples over.
    await reactAct(async () => {
      fireEvent.click(within(st).getByRole('checkbox', { name: 'Auto allocate damage' }));
    });
    expect(st.querySelector('.prompt-dmg-target .prompt-dmg-n')!.textContent).toBe('4');
    expect(st.querySelector('.prompt-stage-problem')).toBeNull();
  });

  it('without a board the prompt draws no stage and keeps its buttons', () => {
    const s = blockedBy('Craw Wurm', ['Grizzly Bears', 'Grizzly Bears']);
    const conn = new StateConnection(s);
    render(<AssignDamagePrompt d={s.pending as AssignDamageDecision} view={conn.view()} legal={[]} answer={() => {}} act={() => {}} busy={false} />);
    expect(document.querySelector('.prompt-stage')).toBeNull();
    expect(screen.getByRole('button', { name: 'Assign damage' }).closest('.prompt-actions')).not.toBeNull();
  });

  it('addDamage: from what is unassigned first, then from the trample target, then from the last creature in order', () => {
    const d = { recipients: [{ id: 'a', lethal: 2 }, { id: 'b', lethal: 2 }, { id: 'p', lethal: 0, trampleTarget: true }], amount: 6 } as AssignDamageDecision;
    expect(addDamage(d, { a: 2, b: 2, p: 1 }, ['a', 'b'], 'a')).toEqual({ a: 3, b: 2, p: 1 });
    expect(addDamage(d, { a: 2, b: 2, p: 2 }, ['a', 'b'], 'a')).toEqual({ a: 3, b: 2, p: 1 });
    expect(addDamage(d, { a: 2, b: 4, p: 0 }, ['a', 'b'], 'a')).toEqual({ a: 3, b: 3, p: 0 });
    expect(addDamage(d, { a: 6, b: 0, p: 0 }, ['a', 'b'], 'a')).toEqual({ a: 6, b: 0, p: 0 });
  });
});

describe('the opening hand screen (CR 103.5)', () => {
  function toMulliganDecision(seed: string): GameState {
    let s = createGame(smallConfig(seed));
    s = drive(s, [{ kind: 'playFirst', player: s.pending!.player }]);
    expect(s.pending?.kind).toBe('mulligan');
    return s;
  }

  it('says who goes first, fans the hand out large, and puts Keep and Mulligan under it', () => {
    const s = toMulliganDecision('stage-mulligan');
    const me = s.pending!.player;
    renderOnBoard(s);
    const st = stage();
    expect(st.querySelector('.prompt-stage-title')!.textContent).toBe(s.turn.startingPlayer === me ? 'You go first' : `${s.players.find((p) => p.id === s.turn.startingPlayer)!.name} goes first`);
    expect(st.querySelectorAll('.prompt-fan-slot')).toHaveLength(s.zones.hand[me]!.length);
    expect(within(st).getByRole('button', { name: `Keep ${s.zones.hand[me]!.length}` })).toBeTruthy();
    expect(within(st).getByRole('button', { name: /^Mulligan/ })).toBeTruthy();
    expect(st.querySelector('.prompt-mulligan-hint')!.textContent).toMatch(/put 1 card from it on the bottom/);
  });

  it('"View battlefield" steps the stage aside and keeps the buttons; Back brings it back', async () => {
    renderOnBoard(toMulliganDecision('stage-peek'));
    const st = stage();
    await clickIn(within(st).getByRole('button', { name: 'View battlefield' }));
    expect(st.classList.contains('is-peeking')).toBe(true);
    expect(within(st).getByRole('button', { name: /^Keep/ })).toBeTruthy();
    await clickIn(within(st).getByRole('button', { name: 'Back' }));
    expect(st.classList.contains('is-peeking')).toBe(false);
  });

  it('the line about the others: kept (with the hand size), mulligans taken, or deciding after', () => {
    const view = {
      players: [
        { id: 'p1', name: 'Alice', keptHand: false, mulligans: 0 },
        { id: 'p2', name: 'Bob', keptHand: true, mulligans: 1 },
        { id: 'p3', name: 'Cy', keptHand: false, mulligans: 2 },
        { id: 'p4', name: 'Di', keptHand: false, mulligans: 0 },
      ],
      zones: { hand: { p2: ['a', 'b', 'c', 'd', 'e', 'f'] } },
    } as never;
    expect(opponentsMulliganStatus(view, 'p1')).toBe('Bob kept a hand of 6 cards. Cy took 2 mulligans. Di decides after you.');
  });
});
