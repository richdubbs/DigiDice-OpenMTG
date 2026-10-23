/**
 * RPL-3 (replays design 6, adopted answer 3): the online panel's "Show my cards in replays", on the game screen with a fake local server socket (normal
 * traffic only): off by default; ticking it sends `replayConsent` and shows the choice until the server's status says it; a choice the server could not
 * send yet (the link to the host is down) says the host has the earlier one; a refusal is shown and the box goes back; once the game was shared it is
 * final; the panel of a 3-4 player game has it too; a server that says nothing of replays shows no box. The
 * end screen of an online game offers Watch replay and Keep replay (its choice is the panel's).
 */
import { act as reactAct, fireEvent, render, screen, within } from '@testing-library/react';
import type { PlayerId } from '@openmtg/engine';
import type { OnlineReplayStatus, OnlineStatus } from '@openmtg/server/online';
import { describe, expect, it } from 'vitest';
import { RemoteConnection } from '../../src/connection/RemoteConnection';
import { recordOnlineGame } from '../../src/online/replays';
import { renderGameApp } from '../game-fixtures';
import { fakeLink, flush, gameViews } from '../online-fakes';
import { statusMsg, tableStatus, tableViews } from '../m12-online/fixtures';
import { testEnv } from '../replays/helpers';

const REPLAY: OnlineReplayStatus = { id: 'r-000000000000000panel', agree: false, shared: false };

const duel = (role: 'host' | 'guest', replay: OnlineReplayStatus | null): OnlineStatus => ({
  role, phase: 'playing', me: role === 'host' ? 'p1' : 'p2', opponent: role === 'host' ? 'Gus' : 'Hana', opponentConnected: true, warnings: [],
  ...(replay ? { replay: { ...replay, ...(role === 'host' ? { agreed: [] } : {}) } } : {}),
});

async function duelScreen(role: 'host' | 'guest', replay: OnlineReplayStatus | null = REPLAY) {
  const g = gameViews('rpl3-panel');
  const me: PlayerId = role === 'host' ? 'p1' : 'p2';
  const f = fakeLink({ initial: [{ t: 'status', status: duel(role, replay) }, g.msg(me)] });
  await f.link.connect();
  render(renderGameApp(new RemoteConnection(f.link), { online: f.link }));
  await screen.findByLabelText('Online game');
  return { ...f, g, me };
}

const box = () => screen.getByRole('checkbox', { name: 'Show my cards in replays' }) as HTMLInputElement;

describe('RPL-3: "Show my cards in replays" in the online panel', () => {
  it('a two-player guest: off by default; ticking it tells the server; the status confirms it; once shared it is final', async () => {
    const s = await duelScreen('guest');
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(false);
    expect(screen.getByText(/Your hand, face-down cards and decklist\. Only if every player ticks this/)).toBeTruthy();
    fireEvent.click(box());
    await reactAct(flush);
    expect(s.socket().last('replayConsent')).toMatchObject({ t: 'replayConsent', agree: true });
    expect(box().checked).toBe(true); // shown as sent, until the server says it
    reactAct(() => {
      s.socket().reply('replayConsent');
      s.socket().push({ t: 'status', status: duel('guest', { ...REPLAY, agree: true }) });
    });
    expect(box().checked).toBe(true);
    // Untick, and tick again: the last choice is what the server holds.
    fireEvent.click(box());
    await reactAct(flush);
    expect(s.socket().last('replayConsent')).toMatchObject({ agree: false });
    reactAct(() => {
      s.socket().reply('replayConsent');
      s.socket().push({ t: 'status', status: duel('guest', { ...REPLAY, agree: false }) });
    });
    expect(box().checked).toBe(false);
    // Every player agreed after the end: the game was shared, and the choice is final.
    reactAct(() => s.socket().push({ t: 'status', status: { ...duel('guest', { ...REPLAY, agree: true, shared: true }), phase: 'over' } }));
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(true);
    expect(screen.getByText('Every player agreed: every replay of this game holds the whole game.')).toBeTruthy();
  });

  it('a guest\'s choice made while the link to the host is down is shown with the note that the host still has the earlier one', async () => {
    const s = await duelScreen('guest', { ...REPLAY, agree: true });
    expect(box().checked).toBe(true);
    fireEvent.click(box());
    await reactAct(flush);
    expect(s.socket().last('replayConsent')).toMatchObject({ agree: false });
    // The server could not send it (the link is down): it keeps the host's choice and says the new one waits.
    reactAct(() => {
      s.socket().reply('replayConsent');
      s.socket().push({ t: 'status', status: { ...duel('guest', { ...REPLAY, agree: true, pending: false }), phase: 'reconnecting' } });
    });
    expect(box().checked).toBe(false); // the player's latest choice
    expect(screen.getByText(/^Not sent yet: the link to the host is down\. Until it is back the host has your earlier choice \(show my cards\)/)).toBeTruthy();
    // The game ended meanwhile and the host shared it with the earlier choice: the box says what counted.
    reactAct(() => s.socket().push({ t: 'status', status: { ...duel('guest', { ...REPLAY, agree: true, shared: true }), phase: 'over' } }));
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(true);
    expect(screen.queryByText(/Not sent yet/)).toBeNull();
  });

  it('a choice made while the link is down, sent when it is back', async () => {
    const s = await duelScreen('guest', { ...REPLAY, agree: true });
    fireEvent.click(box());
    await reactAct(flush);
    reactAct(() => {
      s.socket().reply('replayConsent');
      s.socket().push({ t: 'status', status: { ...duel('guest', { ...REPLAY, agree: true, pending: false }), phase: 'reconnecting' } });
    });
    reactAct(() => s.socket().push({ t: 'status', status: duel('guest', { ...REPLAY, agree: false }) }));
    expect(box().checked).toBe(false);
    expect(screen.queryByText(/Not sent yet/)).toBeNull();
  });

  it('a refused choice is shown, and the box goes back to what the server holds', async () => {
    const s = await duelScreen('host');
    fireEvent.click(box());
    await reactAct(flush);
    expect(box().checked).toBe(true);
    reactAct(() => s.socket().reply('replayConsent', { code: 'noGame', message: 'There is no game to choose for.' }));
    await reactAct(flush);
    expect(box().checked).toBe(false);
    expect(screen.getByRole('alert').textContent).toMatch(/game/i);
  });

  it('a server that keeps no replays (no `replay` in its status) shows no box', async () => {
    await duelScreen('guest', null);
    expect(screen.queryByRole('checkbox', { name: 'Show my cards in replays' })).toBeNull();
  });

  it('the panel of a 3-4 player game has it too', async () => {
    const g = tableViews(3);
    const st = tableStatus({ role: 'guest', me: 'p3', replay: { ...REPLAY } });
    const f = fakeLink({ initial: [statusMsg(st), g.msg('p3')] });
    await f.link.connect();
    render(renderGameApp(new RemoteConnection(f.link), { online: f.link }));
    const panel = await screen.findByLabelText('Online game');
    expect(within(panel).getByRole('list', { name: 'Players online' })).toBeTruthy();
    fireEvent.click(box());
    await reactAct(flush);
    expect(f.socket().last('replayConsent')).toMatchObject({ t: 'replayConsent', agree: true });
    reactAct(() => {
      f.socket().reply('replayConsent');
      f.socket().push(statusMsg(tableStatus({ role: 'guest', me: 'p3', replay: { ...REPLAY, agree: true } })));
    });
    expect(box().checked).toBe(true);
  });

  it('the end screen of an online game offers Watch replay and Keep replay; the choice stays the panel\'s', async () => {
    const g = gameViews('rpl3-panel-end');
    const f = fakeLink({ initial: [{ t: 'status', status: duel('guest', REPLAY) }, g.msg('p2')] });
    await f.link.connect();
    const conn = new RemoteConnection(f.link);
    const env = testEnv({ completer: null });
    const started = recordOnlineGame(conn, f.link, env);
    expect(started?.role).toBe('guest');
    render(renderGameApp(conn, { online: f.link }));
    await screen.findByLabelText('Online game');
    // The guest concedes (CR 104.3a): the game is over, its recording is kept.
    reactAct(() => {
      g.session.apply({ type: 'concede', player: 'p2' });
      f.socket().push({ ...g.msg('p2'), seq: 1 });
    });
    await reactAct(flush);
    const end = await screen.findByRole('group', { name: 'Replay' });
    expect(within(end).getByRole('button', { name: 'Watch replay' })).toBeTruthy();
    expect(within(end).getByRole('button', { name: 'Keep replay' })).toBeTruthy();
    expect(within(end).queryByRole('checkbox')).toBeNull();
    expect(screen.getAllByRole('checkbox', { name: 'Show my cards in replays' })).toHaveLength(1);
    await reactAct(async () => {
      for (let i = 0; i < 20 && started?.live.state().phase !== 'saved'; i++) await flush();
    });
    expect((await env.library.list()).map((e) => e.summary.kind)).toEqual(['recording']);
  });
});
