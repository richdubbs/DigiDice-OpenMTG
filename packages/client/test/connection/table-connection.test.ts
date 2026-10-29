// @vitest-environment node
/**
 * Godot plan phase 1: a local game played over the local server's table channel (src/connection/TableConnection.ts against a real server in this
 * process, packages/server startServer on an ephemeral port, Node's `ws` as the page's WebSocket with the page's Origin). The screen gets exactly what
 * a LocalConnection gives it (the shown player's `viewFor`, legal actions, redacted events; CR 400.2), change after change; the server's computer waits
 * for the game screen's pace (`attachComputerPacer` -> `shown`); closing the game leaves the table (the players at the screen concede, CR 104.3a).
 */
import { chooseAction } from '@openmtg/ai';
import { type Action, type GameConfig } from '@openmtg/engine';
import { startServer, type RunningServer } from '@openmtg/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { closeGame } from '../../src/connection/closeGame';
import type { GameConnection } from '../../src/connection/GameConnection';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { TableConnection, tableSocketUrl, type TableConnectionOptions } from '../../src/connection/TableConnection';
import { attachComputerPacer, fallback, withComputerStops, type ComputerPacer } from '../../src/game/computer';
import { sealConnection } from '../../src/game/sealed';
import type { SocketLike } from '../../src/online/OnlineLink';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/settings/settings';
import { hotSeatConfig } from '../game-fixtures';

let srv: RunningServer;
let dir: string;
let thinking = 0;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'openmtg-tablecon-'));
  srv = await startServer({
    port: 0, clientDist: null, cacheDir: path.join(dir, 'cache'), online: false,
    table: { tables: { delayMs: () => 0, maxBoardWaitMs: 60_000, choose: (v, d, seed) => (thinking++, chooseAction(v, d, seed)) } },
  });
});

afterAll(async () => {
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The page's socket: Node's ws with this server's own Origin (the page is served by it). */
function pageOptions(): TableConnectionOptions {
  return { base: srv.url, socket: (url) => new WebSocket(url, { origin: srv.url, perMessageDeflate: false }) as unknown as SocketLike };
}

/** Wait until `test` holds (polling; the socket delivers in its own time). */
async function until(test: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * Everything a screen reads of a connection but its events, as text. The events are checked per action (below): the table channel sends each change's
 * new events once, so a change without new events (a hand-off, an undo, an action that made none) keeps the batch the screen has.
 */
function snap(c: GameConnection): string {
  return JSON.stringify({ view: c.view(), legal: c.legalActions(), handoff: c.handoff(), canUndo: c.canUndo(), seated: c.seated?.(), status: c.status?.() ?? null });
}

describe('TableConnection (Godot plan phase 1)', () => {
  it('is behind the development setting "Run the game in the server", off by default', () => {
    expect(DEFAULT_SETTINGS.gameInServer).toBe(false);
    expect(sanitizeSettings({}).gameInServer).toBe(false);
    expect(sanitizeSettings({ gameInServer: 'yes' }).gameInServer).toBe(false);
    expect(sanitizeSettings({ gameInServer: true }).gameInServer).toBe(true);
  });

  it('builds the socket URL of the page\'s own server', () => {
    expect(tableSocketUrl('http://127.0.0.1:47600')).toBe('ws://127.0.0.1:47600/table');
    expect(tableSocketUrl('http://127.0.0.1:47600', 'ab')).toBe('ws://127.0.0.1:47600/table?token=ab');
  });

  it('a hot-seat game in the server gives the screen what a LocalConnection gives it, change after change, as patches of the last view', async () => {
    const cfg: GameConfig = hotSeatConfig('table-con-mirror', 6);
    const local = new LocalConnection(cfg);
    const conn = TableConnection.hotSeat(cfg, pageOptions());
    expect(await conn.ready).toBe(true);
    const off = conn.subscribe(() => {});
    expect(snap(conn)).toBe(snap(local));
    let steps = 0;
    let kept = 0;
    for (; steps < 120 && !local.view().result; steps++) {
      if (local.handoff()) {
        local.acceptHandoff();
        conn.acceptHandoff();
        await until(() => conn.handoff() === null);
        expect(snap(conn)).toBe(snap(local));
      }
      const d = local.view().pending!;
      let action: Action = chooseAction(local.view(), d, `t:${d.id}`);
      if (!(await local.act(action)).ok) {
        action = fallback(d)!;
        expect((await local.act(action)).ok).toBe(true);
      }
      const defs = conn.view().defs;
      const batch = conn.events();
      expect(await conn.act(action)).toEqual({ ok: true });
      expect(snap(conn)).toBe(snap(local));
      // The action's events, redacted for the screen's viewer as LocalConnection redacts them (CR 400.2); none: the screen's batch stays.
      if (local.events().events.length > 0) {
        expect(JSON.stringify(conn.events().events)).toBe(JSON.stringify(local.events().events));
        expect(conn.events().seq).toBeGreaterThan(batch.seq);
      } else expect(conn.events()).toBe(batch);
      if (conn.view().defs === defs) kept++;
    }
    off();
    expect(steps).toBeGreaterThan(30);
    // A patch keeps what did not change (the card definitions) as the same object, so the board's memos hold.
    expect(kept).toBeGreaterThan(steps / 3);
    conn.close();
  });

  it('refuses an action the server refuses, with its reason; undo goes through the server', async () => {
    const cfg = hotSeatConfig('table-con-undo', 6);
    const conn = TableConnection.hotSeat({ ...cfg, options: { ...cfg.options, skipMulligans: true, startingPlayer: 'p1' } }, pageOptions());
    expect(await conn.ready).toBe(true);
    const r = await conn.act({ type: 'pass', player: 'p1' });
    expect(r).toMatchObject({ ok: false, error: { message: expect.stringMatching(/Pass the screen to/) } });
    conn.acceptHandoff();
    await until(() => conn.handoff() === null);
    expect(conn.view().viewer).toBe('p1');
    for (let i = 0; i < 20 && !conn.legalActions().some((a) => a.kind === 'playLand'); i++) {
      expect((await conn.act({ type: 'pass', player: conn.view().pending!.player })).ok).toBe(true);
      if (conn.handoff()) {
        conn.acceptHandoff();
        await until(() => conn.handoff() === null);
      }
    }
    const land = conn.legalActions().find((a) => a.kind === 'playLand')!;
    const before = JSON.stringify(conn.view());
    expect((await conn.act(land.action)).ok).toBe(true);
    expect(conn.canUndo()).toBe(true);
    expect(await conn.undoNow()).toBe(true);
    expect(JSON.stringify(conn.view())).toBe(before);
    conn.close();
  });

  it('against the computer: the server\'s computer waits for the game screen\'s pace, attached as for a ComputerGame', async () => {
    const base = hotSeatConfig('table-con-pace', 20);
    const cfg: GameConfig = { ...base, options: { ...base.options, skipMulligans: true, startingPlayer: 'p2' } };
    thinking = 0;
    const conn = TableConnection.computer(cfg, 'p1', 'p2', { speed: 'off', seed: 'pace' }, pageOptions());
    expect(conn.config).toEqual(withComputerStops(cfg, 'p2'));
    expect(await conn.ready).toBe(true);
    expect(conn.seated()).toEqual(['p1']);
    // A busy board: the computer does not act (the page does not report `shown`).
    let busy = true;
    const listeners = new Set<() => void>();
    const pacer: ComputerPacer = { busy: () => busy, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) };
    const detach = attachComputerPacer(sealConnection(conn), pacer);
    const off = conn.subscribe(() => {});
    // The person passes until the computer must decide.
    for (let i = 0; i < 20 && conn.view().pending?.player !== 'p2'; i++) {
      const d = conn.view().pending!;
      expect((await conn.act(d.kind === 'priority' ? { type: 'pass', player: 'p1' } : fallback(d)!)).ok).toBe(true);
    }
    expect(conn.view().pending?.player).toBe('p2');
    const view = conn.view();
    await new Promise((r) => setTimeout(r, 200));
    expect(thinking).toBe(0);
    expect(conn.view()).toBe(view);
    // The board is idle: the page reports it and the computer plays.
    busy = false;
    for (const l of [...listeners]) l();
    await until(() => thinking > 0 && conn.view() !== view);
    detach();
    off();
    closeGame(sealConnection(conn));
  });

  it('closing the game leaves the table: the players at this screen concede (CR 104.3a) and the server forgets it', async () => {
    await until(() => srv.table!.tables.size === 0); // the tables of the tests above, closed as they ended
    const before = 0;
    const conn = TableConnection.computer(hotSeatConfig('table-con-leave', 20), 'p1', 'p2', { speed: 'off', seed: 'leave' }, pageOptions());
    expect(await conn.ready).toBe(true);
    await until(() => srv.table!.tables.size === before + 1);
    closeGame(sealConnection(conn));
    await until(() => srv.table!.tables.size === before);
    expect((await conn.act({ type: 'pass', player: 'p1' })).ok).toBe(false);
  });

  it('a server that cannot run the game: `ready` settles false and the screen is told why', async () => {
    const conn = TableConnection.hotSeat({ seed: 'x', players: [], defs: [] }, pageOptions());
    expect(await conn.ready).toBe(false);
    const refused = TableConnection.hotSeat(hotSeatConfig('x', 6), { base: srv.url, socket: (url) => new WebSocket(url, { origin: 'http://evil.test' }) as unknown as SocketLike });
    expect(await refused.ready).toBe(false);
  });
});
