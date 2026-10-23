/**
 * M12-4b (docs/design/m12-multiplayer.md 5.2-5.3, D8, D10): Settings for the table (layout, "Camera follows the mouse") reach the
 * board through the board slot; concession and leaving say that the game goes on for the others; a hot-seat game goes on after a concession and the
 * concession is never undone (M12 gaps: the undo floor's own "a player left" rule); the end screen's finishing order 1st-4th with how each player lost. Real 3-4 player states from M12-2's rules.
 */
import { act as reactAct, fireEvent, render, screen, within } from '@testing-library/react';
import { applyAction, viewFor, type GameState } from '@openmtg/engine';
import { describe, expect, it, vi } from 'vitest';
import type { GameBoardProps } from '../../src/board';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { irreversibleReason } from '../../src/connection/undoFloor';
import { GameBar } from '../../src/game/GameBar';
import { GameOver, finishingOrder, lossCause } from '../../src/game/GameOver';
import { BoardSlot } from '../../src/game/slots';
import { SettingsScreen } from '../../src/settings/SettingsScreen';
import { DEFAULT_SETTINGS, SettingsStore } from '../../src/settings/settings';
import { NavProvider } from '../../src/app/nav';
import { memoryStorage } from '../game-fixtures';
import { concede, mpConfig, mpScenario, step } from '../../../engine/test/m12/rules/helpers';

const boardProps = vi.hoisted(() => ({ last: null as GameBoardProps | null }));
vi.mock('../../src/board', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/board')>();
  return {
    ...m,
    GameBoard: (props: GameBoardProps) => {
      boardProps.last = props;
      return <p>board</p>;
    },
  };
});

/** Bob concedes, Carol goes to 0 life (CR 704.5a), Dan concedes: Alice wins (CR 104.2a); Dan never leaves (the game is over, m12 design D8). */
function finished(): GameState {
  let s = concede(mpScenario(), 'p2').state;
  s = structuredClone(s);
  s.players.find((p) => p.id === 'p3')!.life = 0;
  // SBAs are checked before the next player receives priority (CR 704.3)
  s = step(s, { type: 'pass', player: s.pending!.player }).state;
  s = concede(s, 'p4').state;
  return s;
}

describe('the end screen (m12 design D10)', () => {
  it('finishing order 1st-4th with how each player lost', () => {
    const s = finished();
    expect(s.result?.winner).toBe('p1');
    const view = viewFor(s, 'p1');
    render(<GameOver view={view} result={s.result!} onNewGame={() => {}} onHome={() => {}} />);
    const rows = within(screen.getByRole('list', { name: 'Finishing order' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows[0]).toBe('1stAliceWinner');
    expect(rows[1]).toMatch(/^2ndDanConceded$/);
    expect(rows[2]).toMatch(/^3rdCarolLife: has 0 or less life \(turn 1\)$/);
    expect(rows[3]).toMatch(/^4thBobConceded \(turn 1\)$/);
    expect(screen.queryByText(/conceded \(CR 104\.3a\)\.$/)).toBeNull(); // said in the order instead
    expect(finishingOrder(view, s.result!).map((r) => r.player)).toEqual(['p1', 'p4', 'p3', 'p2']);
  });

  it('a two-player game\'s end screen is unchanged (no finishing order)', () => {
    let s = mpScenario({ players: 3 });
    s = { ...s, options: { ...s.options, multiplayer: undefined } } as GameState; // read as a two-player view
    const view = { ...viewFor(s, 'p1') };
    render(<GameOver view={view} result={{ winner: 'p1', reason: 'Bob has 0 or less life' }} onNewGame={() => {}} onHome={() => {}} />);
    expect(screen.queryByRole('list', { name: 'Finishing order' })).toBeNull();
  });

  it('how a player lost, in a word or two (CR 704.5a-c, 704.6c, 104.3a)', () => {
    expect(lossCause('has 0 or less life')).toBe('Life');
    expect(lossCause('has been dealt 21 combat damage by the commander Isamaru')).toBe('Commander damage');
    expect(lossCause('has ten or more poison counters')).toBe('Poison');
    expect(lossCause('attempted to draw from an empty library')).toBe('Empty library');
    expect(lossCause('conceded', ['CR 104.3a'])).toBe('Conceded');
    expect(lossCause('timed out: disconnected for 5 minutes')).toBe('Timed out');
    expect(lossCause('Alice won the game')).toBe('Another player won');
  });
});

describe('conceding in a game that goes on (m12 design D8, 5.3 item 6)', () => {
  it('the concede dialog says the game goes on for the others while three or more are in it', async () => {
    const s = mpScenario();
    render(
      <GameBar
        view={viewFor(s, 'p1')}
        undo={{ available: true, can: false, run: () => {} }}
        concedable={['p1']}
        onConcede={() => {}}
        onLeave={() => {}}
        onSettings={() => {}}
        onAbout={() => {}}
      />,
    );
    await reactAct(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Concede' }));
    });
    expect(screen.getByRole('dialog', { name: 'Concede' }).textContent).toMatch(/the game goes on for the others \(CR 104\.3a, 800\.4a\)/);
  });

  it('hot-seat: a concession leaves the game going on for the others, the next person is handed the screen, and it can never be undone', async () => {
    const conn = new LocalConnection({ ...mpConfig({ players: 3 }), seed: 'm12-4b-hotseat' });
    // the first person sits down
    conn.acceptHandoff();
    const first = conn.view().viewer!;
    const before = conn.session.state;
    const r = await conn.act({ type: 'concede', player: first });
    expect(r.ok).toBe(true);
    expect(conn.session.state.result).toBeNull();
    expect(conn.session.state.players.find((p) => p.id === first)!.left).toBeDefined();
    expect(conn.canUndo()).toBe(false);
    // M12 gaps (STATUS "Wave M12" gap 6): the undo floor says why, by its own rule (not only because the leave procedure changed the libraries)
    const name = before.players.find((p) => p.id === first)!.name;
    expect(irreversibleReason(before, conn.session.state)).toBe(`${name} left the game (CR 104.3a, CR 800.4a).`);
    expect(conn.handoff()).not.toBeNull();
    expect(conn.handoff()).not.toBe(first);
  });
});

describe('Settings: the table (m12 design 5.1-5.2)', () => {
  it('the layout and "Camera follows the mouse" are stored, and the board slot gives them to the board; the table\'s own switch stores its choice', async () => {
    const store = new SettingsStore(memoryStorage());
    expect(DEFAULT_SETTINGS.cameraFollow).toBe(true);
    render(
      <NavProvider initial={{ screen: 'settings' }}>
        <SettingsScreen store={store} />
      </NavProvider>,
    );
    const table = within(screen.getByRole('region', { name: 'Table (three or four players)' }));
    expect((table.getByRole('radio', { name: 'Shared table' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(table.getByRole('radio', { name: 'One focused opponent' }));
    fireEvent.click(table.getByRole('checkbox', { name: 'Camera follows the mouse' }));
    expect(store.get()).toMatchObject({ tableLayout: 'focused', cameraFollow: false });
    // stored and read back
    expect(new SettingsStore(memoryStorage()).get().cameraFollow).toBe(true);

    const s = mpScenario();
    render(<BoardSlot connection={{} as never} view={viewFor(s, 'p1')} legalActions={[]} interaction={{} as never} prompt={null} settings={store} />);
    expect(boardProps.last).toMatchObject({ tableLayout: 'focused', cameraFollow: false });
    await reactAct(async () => {
      boardProps.last!.onTableLayout!('acrossTop');
    });
    expect(store.get().tableLayout).toBe('acrossTop');
    expect(boardProps.last).toMatchObject({ tableLayout: 'acrossTop' });
  });
});

it('the engine refuses nothing the screen builds: a hot-seat concession of the last opponent ends the game (CR 104.2a)', () => {
  let s = concede(mpScenario({ players: 3 }), 'p2').state;
  s = applyAction(s, { type: 'concede', player: 'p3' }).state;
  expect(s.result?.winner).toBe('p1');
});
