/**
 * M12-4b (docs/design/m12-multiplayer.md D15, 5.3 item 2): declaring attackers with several possible defenders. There is no default:
 * each attacker picks its own target (a click on a player, a planeswalker or a battle, or its line in the prompt), "Attack with all" declares every creature
 * without a target or "All at <player>" sends them all at one player, the declare button waits until every attacker has a target and names the split, and
 * the targets are published for the board's arrows (BoardInteraction.attackTargets). Real 4-player states (M12-2's scenario helper). The two-player prompt
 * is unchanged (test/prompts/combat.test.tsx).
 */
import { act as reactAct, fireEvent, render, screen } from '@testing-library/react';
import type { DeclareAttackersDecision, GameState } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { PromptBar } from '../../src/prompts/PromptBar';
import { PromptSelectionProvider, SelectionStore } from '../../src/prompts/selection';
import { aimAt, allAt, armAll, attackSplit, initialMultiAttacks, toggleAttacker, untargeted } from '../../src/prompts/combat';
import { pendingAttackArrows } from '../../src/board/fx/TargetArrows';
import { StateConnection, click } from '../prompts/harness';
import { findAll, mpScenario, passUntil } from '../../../engine/test/m12/rules/helpers';

/** Alice (p1) at her declare attackers step with two Grizzly Bears; Bob, Carol and Dan are her opponents (Dan with a planeswalker when `jace`). */
function toAttack(jace = false): GameState {
  let s = mpScenario({
    cards: ['Grizzly Bears', 'Jace Beleren'],
    zones: { p1: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }, ...(jace ? { p4: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } } : {}) },
  });
  s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
  return s;
}

function renderAttack(s: GameState) {
  const conn = new StateConnection(s);
  const store = new SelectionStore();
  render(
    <PromptSelectionProvider store={store}>
      <PromptBar connection={conn} armDelayMs={0} />
    </PromptSelectionProvider>,
  );
  return { conn, store };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
async function boardClick(store: SelectionStore, id: string) {
  await reactAct(async () => {
    store.click(id);
  });
}

describe('declare attackers with several possible defenders (m12 design D15)', () => {
  it('no default: a clicked attacker "needs a target" and the declaration waits; a click on a player aims it; the split is named; the engine accepts it', async () => {
    const s = toAttack();
    const [a, b] = findAll(s, 'Grizzly Bears', 'battlefield', 'p1');
    const { conn, store } = renderAttack(s);
    expect(button('No attacks').disabled).toBe(false);
    await boardClick(store, a!);
    expect(store.snapshot().marks[a!]).toBe('needs a target');
    expect(button('Pick a target for 1 attacker').disabled).toBe(true);
    // the opponents are clickable on the board now (their life discs), never the attacker's own controller
    expect([...store.snapshot().selectable]).toEqual(expect.arrayContaining(['p2', 'p3', 'p4']));
    expect(store.snapshot().selectable.has('p1')).toBe(false);
    expect(store.snapshot().attackTargets).toEqual({});
    await boardClick(store, 'p3');
    expect(store.snapshot().marks[a!]).toBe('attacking Carol');
    expect(store.snapshot().attackTargets).toEqual({ [a!]: 'p3' });
    await boardClick(store, b!);
    await boardClick(store, 'p4');
    expect(store.snapshot().attackTargets).toEqual({ [a!]: 'p3', [b!]: 'p4' });
    await click('Attack: Carol (1), Dan (1)');
    expect(conn.errors).toEqual([]);
    expect(conn.lastAnswer()).toEqual({ kind: 'declareAttackers', attacks: [{ attacker: a, defender: 'p3' }, { attacker: b, defender: 'p4' }] });
    expect(conn.state.combat?.attackers.map((x) => [x.id, x.defender])).toEqual([[a, 'p3'], [b, 'p4']]);
  });

  it('each attacker\'s line in the prompt shows its target and can change it (a planeswalker too, CR 508.1b)', async () => {
    const s = toAttack(true);
    const [a] = findAll(s, 'Grizzly Bears', 'battlefield', 'p1');
    const jace = findAll(s, 'Jace Beleren', 'battlefield', 'p4')[0]!;
    const { conn } = renderAttack(s);
    await click(/^Grizzly Bears #1/);
    const line = screen.getByLabelText('Grizzly Bears #1 attacks') as HTMLSelectElement;
    expect(line.value).toBe('');
    expect([...line.options].map((o) => o.textContent)).toEqual(['Pick a target…', 'Bob', 'Carol', 'Dan', 'Jace Beleren']);
    await reactAct(async () => {
      fireEvent.change(line, { target: { value: jace } });
    });
    await click('Attack: Jace Beleren (1)');
    expect(conn.errors).toEqual([]);
    expect(conn.lastAnswer()).toEqual({ kind: 'declareAttackers', attacks: [{ attacker: a, defender: jace }] });
  });

  it('"Attack with all" declares every creature without a target; "All at Bob" sends them all at Bob', async () => {
    const s = toAttack();
    const [a, b] = findAll(s, 'Grizzly Bears', 'battlefield', 'p1');
    const { conn, store } = renderAttack(s);
    await click('Attack with all');
    expect(button('Pick a target for 2 attackers').disabled).toBe(true);
    expect(store.snapshot().selected).toEqual(new Set([a, b]));
    expect(screen.getByRole('group', { name: 'Attack with all at one player' }).textContent).toBe('All at BobAll at CarolAll at Dan');
    await click('All at Bob');
    await click('Attack: Bob (2)');
    expect(conn.errors).toEqual([]);
    expect(conn.state.combat?.attackers.map((x) => x.defender)).toEqual(['p2', 'p2']);
  });

  it('the board\'s arrows follow the published targets: none for an attacker without one (M12-4a pendingAttackArrows)', () => {
    const players = ['p1', 'p2', 'p3'].map((id) => ({ id, hasLost: false }));
    expect(pendingAttackArrows('p1', players, ['o1', 'o2'], { o1: 'p3' })).toEqual([{ attacker: 'o1', target: 'p3' }]);
  });

  it('pure helpers: arm, aim, all at, split', () => {
    const s = toAttack();
    const d = s.pending as DeclareAttackersDecision;
    const [a, b] = findAll(s, 'Grizzly Bears', 'battlefield', 'p1');
    expect(initialMultiAttacks(d)).toEqual({});
    let x = toggleAttacker({}, d, a!);
    expect(x).toEqual({ [a!]: null });
    expect(untargeted(x, d)).toEqual([a]);
    x = aimAt(armAll(x, d), d, 'p2');
    expect(x).toEqual({ [a!]: 'p2', [b!]: 'p2' });
    x = allAt({ [a!]: 'p4' }, d, 'p3');
    expect(x).toEqual({ [a!]: 'p3', [b!]: 'p3' });
    expect(toggleAttacker(x, d, a!)).toEqual({ [b!]: 'p3' });
    const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? id;
    const view = { players: s.players } as never;
    expect(attackSplit(view, { [a!]: 'p4', [b!]: 'p2' }, name)).toBe('Bob (1), Dan (1)');
  });
});
