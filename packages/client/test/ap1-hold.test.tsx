/**
 * AP1: smart auto-pass in hot-seat and the hold-priority toggle.
 * - Hot-seat: the engine passes for a player who can do nothing in response (CR 117.3d), so the screen is not handed to them: no pass cover.
 * - The "Hold priority" toggle next to Pass (shortcut H) sends `setStops` with `holdPriority`; with it on the player keeps priority after their own spell
 *   (CR 117.3c).
 */
import { screen } from '@testing-library/react';
import { compileCard, type Action, type GameConfig } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { LocalConnection } from '../src/connection/LocalConnection';
import { holdPriorityAction } from '../src/prompts/PriorityPrompt';
import { castAuto, click, press, renderPrompt, scenario } from './prompts/harness';

const forest = compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '' });
const elf = compileCard({ name: 'Test Elf', layout: 'normal', mana_cost: '{G}', type_line: 'Creature — Elf', power: '1', toughness: '1', oracle_text: '' });
const bear = compileCard({ name: 'Test Bear', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' });
const quick = compileCard({ name: 'Test Quick', layout: 'normal', mana_cost: '{0}', type_line: 'Instant', oracle_text: 'You gain 1 life.' });

/** Alice (default stops, or full control) has Forests and Test Elves; Bob's deck is all `bobCard`. */
function game(bobCard: string, fullControl = false): LocalConnection {
  const cfg: GameConfig = {
    seed: `ap1-${bobCard}`,
    players: [
      { name: 'Alice', deck: [...Array<string>(20).fill('Forest'), ...Array<string>(20).fill('Test Elf')], stops: { fullControl } },
      { name: 'Bob', deck: Array<string>(40).fill(bobCard) },
    ],
    defs: [forest, elf, bear, quick],
    options: { skipMulligans: true, startingPlayer: 'p1' },
  };
  const conn = new LocalConnection(cfg);
  expect(conn.handoff()).toBe('p1');
  conn.acceptHandoff();
  return conn;
}

async function ok(conn: LocalConnection, a: Action): Promise<void> {
  const r = await conn.act(a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error.message}`);
}

/** Alice plays a Forest and casts a Test Elf in her first main phase, paying automatically. */
async function castElf(conn: LocalConnection): Promise<void> {
  while (conn.view().turn.step !== 'main1') await ok(conn, { type: 'pass', player: 'p1' }); // full control stops in the upkeep too
  const card = (name: string) => conn.view().zones.hand.p1!.find((id) => conn.view().objects[id]!.defId === name)!;
  await ok(conn, { type: 'playLand', player: 'p1', card: card('Forest') });
  await ok(conn, { type: 'cast', player: 'p1', card: card('Test Elf') });
  while (conn.view().pending?.kind === 'payCost' && conn.handoff() === null) {
    const d = conn.view().pending!;
    await ok(conn, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'payCost', auto: true } });
  }
}

const elfOnBattlefield = (conn: LocalConnection): boolean => conn.session.state.zones.battlefield.some((id) => conn.session.state.objects[id]!.defId === 'Test Elf');

describe('AP1 hot-seat: no pass cover for a player the engine passes for (CR 117.3d)', () => {
  it('Bob holds only creature cards and no land: the Elf resolves without the screen ever being handed to him', async () => {
    // Alice has full control, so she keeps priority over her Elf (CR 117.3c) and gets it back once it resolves (CR 117.3b): the screen stays hers.
    const conn = game('Test Bear', true);
    await castElf(conn);
    expect(conn.view().zones.stack).toHaveLength(1);
    await ok(conn, { type: 'pass', player: 'p1' });
    expect(conn.handoff()).toBeNull();
    expect(elfOnBattlefield(conn)).toBe(true);
    expect(conn.session.state.zones.stack).toEqual([]);
    expect(conn.view().pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(conn.view().turn).toMatchObject({ number: 1, step: 'main1' });
    // The automatic pass is in the log like a pass by hand.
    expect(conn.view().log.map((l) => l.text)).toContain('Bob passes.');
  });

  it('Bob holds an instant he can cast: the screen is handed to him with the Elf on the stack', async () => {
    const conn = game('Test Quick');
    await castElf(conn);
    expect(conn.handoff()).toBe('p2');
    expect(conn.session.state.zones.stack).toHaveLength(1);
  });

  it('Alice holding priority keeps the screen after her own spell (CR 117.3c), with no hand-off', async () => {
    const conn = game('Test Bear');
    const me = conn.view().players.find((p) => p.id === 'p1')!;
    await ok(conn, holdPriorityAction(me, true));
    await castElf(conn);
    expect(conn.handoff()).toBeNull();
    expect(conn.view().pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(conn.view().zones.stack).toHaveLength(1);
  });
});

describe('AP1 hold-priority toggle next to the Pass button', () => {
  const board = () => scenario(['Forest', 'Grizzly Bears'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] }, stops: { fullControl: false } });

  it('a click turns it on and off through setStops (holdPriority), keeping the other stops', async () => {
    const s = board();
    const { conn } = renderPrompt(s);
    const before = s.players[0]!.stops;
    const toggle = screen.getByRole('button', { name: 'Hold priority' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-keyshortcuts')).toBe('H');
    await click('Hold priority');
    expect(conn.sent.at(-1)).toEqual({ type: 'setStops', player: 'p1', stops: { ...before, holdPriority: true } });
    expect(conn.state.players[0]!.stops.holdPriority).toBe(true);
    expect(screen.getByRole('button', { name: 'Holding priority' }).getAttribute('aria-pressed')).toBe('true');
    expect(conn.state.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // still the same decision
    await click('Holding priority');
    expect(conn.state.players[0]!.stops.holdPriority).toBe(false);
  });

  it('the H key toggles it; not while typing in a field, not with Ctrl', async () => {
    const { conn } = renderPrompt(board());
    await press('h');
    expect(conn.state.players[0]!.stops.holdPriority).toBe(true);
    await press('H', window);
    expect(conn.state.players[0]!.stops.holdPriority).toBe(false);
    const sent = conn.sent.length;
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    await press('h');
    field.remove();
    const { fireEvent, act } = await import('@testing-library/react');
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'h', ctrlKey: true });
    });
    expect(conn.sent.length).toBe(sent);
  });

  it('with hold on, casting a spell leaves the player with priority over their own spell (CR 117.3c)', async () => {
    const { conn } = renderPrompt(board());
    await click('Hold priority');
    // Cast outside the UI (the cast prompts are tested elsewhere); the engine keeps the decision with Alice.
    const t = castAuto(conn.state, 'Grizzly Bears');
    expect(t.zones.stack).toHaveLength(1);
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p1' });
  });

  it('under full control the toggle is shown on and disabled (the game already stops at every priority)', () => {
    renderPrompt(scenario(['Forest'], { p1: { battlefield: ['Forest'] } })); // the scenario's default: full control
    const toggle = screen.getByRole('button', { name: 'Hold priority' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('RES-ALL: the Resolve all button next to Pass (owner, 2026-10-25)', () => {
  // The scenario's default is full control, so Alice keeps priority over her own spell.
  const board = () => scenario(['Forest', 'Grizzly Bears'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });

  it('is shown only while the stack holds something', () => {
    renderPrompt(board());
    expect(screen.queryByRole('button', { name: 'Resolve all' })).toBeNull();
  });

  it('sends a pass with resolveAll: the stack resolves', async () => {
    const t = castAuto(board(), 'Grizzly Bears');
    expect(t.zones.stack).toHaveLength(1);
    const { conn } = renderPrompt(t);
    await click('Resolve all');
    expect(conn.sent.at(-1)).toEqual({ type: 'pass', player: 'p1', resolveAll: true });
  });
});
