/**
 * Shortcuts (CR 727, docs/design/shortcuts.md 6; citations from memory, unverified): the client side.
 *  - The priority prompt's "Repeat..." opens the player's steps of this turn (`view.repeatable`), oldest first; the loop's start is chosen with "from here",
 *    the number of times typed; "Propose" sends the `shortcut` action. A loop the engine noticed (`view.loop`) is preselected, with 100 times.
 *  - The `shortcut` decision (CR 727.2b): the other player sees the proposer's steps; "Let it run" (Space) accepts; "Stop at pass [n] after step [j]"
 *    names the point where they take priority.
 */
import { act as reactAct, fireEvent, screen, within } from '@testing-library/react';
import { compileCard, legalActions, viewFor, type GameState, type OracleCard } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { act, answer, click, clickRole, find, lifeOf, press, renderPrompt, scenario } from './harness';

const FOUNTAIN = compileCard({ name: 'Life Fountain', layout: 'normal', mana_cost: '{1}', type_line: 'Artifact', oracle_text: '{0}: You gain 1 life.' } as OracleCard);

/** Alice activates Life Fountain, passes, and Bob's pass resolves it (full control, the scenario default): `loops` times. Alice holds priority after. */
function looped(loops: number): GameState {
  let s = scenario([], { defs: [FOUNTAIN], p1: { battlefield: ['Life Fountain'] } });
  const source = find(s, 'Life Fountain', 'battlefield', 'p1');
  for (let i = 0; i < loops; i++) {
    s = act(s, legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === source)!.action);
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
  }
  return s;
}

async function change(label: string, value: string): Promise<void> {
  await reactAct(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

describe('shortcuts: proposing from the priority prompt (CR 727.2a)', () => {
  it('no "Repeat..." without steps to repeat; with steps, the panel lists them, the last one preselected and 10 times', async () => {
    const fresh = scenario([], { defs: [FOUNTAIN], p1: { battlefield: ['Life Fountain'] } });
    fresh.turnActions = []; // nothing done yet this turn (the scenario passed through the upkeep)
    expect(viewFor(fresh, 'p1').repeatable).toBeUndefined();
    const first = renderPrompt(fresh);
    expect(screen.getByRole('button', { name: 'Pass priority' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Repeat…' })).toBeNull();
    first.unmount();
    const s = looped(1);
    const steps = viewFor(s, 'p1').repeatable!;
    expect(steps.slice(-2)).toEqual(['Life Fountain: {0}: You gain 1 life.', 'Pass priority']);
    renderPrompt(s);
    expect(screen.queryByRole('group', { name: 'Repeat your steps' })).toBeNull();
    await click('Repeat…');
    const panel = screen.getByRole('group', { name: 'Repeat your steps' });
    const items = within(within(panel).getByRole('list', { name: 'Your steps this turn' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(steps.map((l, i) => `${i + 1}.${l}`));
    expect((within(panel).getByRole('radio', { name: `Repeat from step ${steps.length}: Pass priority` }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Times') as HTMLInputElement).value).toBe('10');
    expect(within(panel).getByText(/The other players are asked first; they can let it run or stop it at a pass\. The game really plays every pass/)).toBeTruthy();
  });

  it('"from here" on the activation and 5 times: Propose sends the shortcut; Bob lets it run (Space) and the engine plays the five passes', async () => {
    const s = looped(1);
    const n = viewFor(s, 'p1').repeatable!.length;
    const { conn } = renderPrompt(s);
    await click('Repeat…');
    await clickRole('radio', `Repeat from step ${n - 1}: Life Fountain: {0}: You gain 1 life.`);
    await change('Times', '5');
    await click('Propose');
    expect(conn.sent.at(-1)).toEqual({ type: 'shortcut', player: 'p1', steps: 2, times: 5 });
    // Bob's decision (the connection shows the player the engine waits for)
    expect(conn.state.pending).toMatchObject({ kind: 'shortcut', player: 'p2', proposer: 'p1', times: 5 });
    expect(screen.getByText('Alice proposes to repeat these 2 steps 5 times')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'The steps of one pass' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1.Life Fountain: {0}: You gain 1 life.',
      '2.Pass priority',
    ]);
    expect(screen.getByText(/a player with nothing to do is passed for as usual \(CR 727\.2b\)/)).toBeTruthy();
    await press(' ');
    expect(conn.lastAnswer()).toEqual({ kind: 'shortcut' });
    expect(conn.errors).toEqual([]);
    expect(lifeOf(conn.state, 'p1')).toBe(20 + 1 + 5);
    expect(conn.state.pending).toMatchObject({ kind: 'priority', player: 'p1' });
  });

  it('times outside 1 to 1000, or not whole, cannot be proposed', async () => {
    renderPrompt(looped(1));
    await click('Repeat…');
    for (const bad of ['0', '1001', '2.5', '']) {
      await change('Times', bad);
      expect((screen.getByRole('button', { name: 'Propose' }) as HTMLButtonElement).disabled, bad).toBe(true);
    }
  });

  it('a loop the engine noticed (done twice in a row): its steps are preselected, with 100 times', async () => {
    const s = looped(2);
    const v = viewFor(s, 'p1');
    expect(v.loop).toBe(2);
    const n = v.repeatable!.length;
    const { conn } = renderPrompt(s);
    await click('Repeat…');
    expect((screen.getByRole('radio', { name: `Repeat from step ${n - 1}: Life Fountain: {0}: You gain 1 life.` }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Times') as HTMLInputElement).value).toBe('100');
    await click('Propose');
    expect(conn.sent.at(-1)).toEqual({ type: 'shortcut', player: 'p1', steps: 2, times: 100 });
  });
});

describe('shortcuts: answering a proposal (CR 727.2b)', () => {
  it('"Stop at pass 3 after step 2": Bob gets priority there, with the third activation on the stack', async () => {
    const s = act(looped(1), { type: 'shortcut', player: 'p1', steps: 2, times: 10 });
    const { conn } = renderPrompt(s);
    expect(screen.getByText('Alice proposes to repeat these 2 steps 10 times')).toBeTruthy();
    expect((screen.getByLabelText('Step') as HTMLSelectElement).value).toBe('2'); // the last step by default
    expect([...(screen.getByLabelText('Pass') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    await change('Pass', '3');
    await click('Stop');
    expect(conn.lastAnswer()).toEqual({ kind: 'shortcut', stop: { pass: 3, step: 2 } });
    expect(conn.errors).toEqual([]);
    expect(conn.state.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(conn.state.zones.stack).toHaveLength(1);
    expect(lifeOf(conn.state, 'p1')).toBe(20 + 1 + 2);
  });
});
