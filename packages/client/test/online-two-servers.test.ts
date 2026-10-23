// @vitest-environment node
/**
 * Milestone 9 end to end on one machine, normal traffic only: two OpenMTG server processes (packages/server/src/main.ts) on 127.0.0.1, each with its
 * own card cache (the engine's fixture cards), the host's UDP game port bound to 127.0.0.1 only (`--game-address`), and two RemoteConnections, each
 * over its own server's localhost WebSocket exactly as a page of that server would connect (GET /api/online/session, then the socket with the token and
 * the page's Origin). A simple automatic player (packages/net autoAction) plays both sides through the connections to the end of the game.
 *
 * Checked: each side only ever sees its own player's view (CR 400.2: the host's hand and library stay hidden from the guest), the event feed arrives for
 * the board's animations, both sides see the result (CR 104.1), and leaving tells the other side and ends both games cleanly. CL4: in a second game on
 * the same servers the guest leaves while it runs, which concedes it (CR 104.3a): the host sees its win and why, not a dropped link.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HIDDEN_DEF, type GameView, type OracleCard, type PlayerId } from '@openmtg/engine';
import { autoAction } from '@openmtg/net';
import type { OnlineDeck } from '@openmtg/server/online';
import { afterAll, describe, expect, it } from 'vitest';
import { RemoteConnection } from '../src/connection/RemoteConnection';
import { OnlineLink, type SocketLike } from '../src/online/OnlineLink';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const SERVER_MAIN = path.join(ROOT, 'packages', 'server', 'src', 'main.ts');
const FIXTURE = path.join(ROOT, 'packages', 'engine', 'test', 'fixtures', 'cards.json');

const deck = (main: Record<string, number>): OnlineDeck => ({ main: Object.entries(main).map(([name, count]) => ({ name, count })), sideboard: [] });

const procs: ChildProcess[] = [];
const dirs: string[] = [];
afterAll(() => {
  for (const p of procs) if (p.exitCode === null) p.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A card cache with the engine's fixture cards (Oracle fields only, no network). */
function fixtureCache(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-cl2-'));
  dirs.push(dir);
  const cacheDir = path.join(dir, 'scryfall');
  mkdirSync(cacheDir);
  const data = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cards: OracleCard[]; tokens?: OracleCard[] };
  writeFileSync(path.join(cacheDir, 'cards.jsonl'), data.cards.map((c) => JSON.stringify(c)).join('\n') + '\n');
  writeFileSync(path.join(cacheDir, 'tokens.jsonl'), (data.tokens ?? []).map((c) => JSON.stringify(c)).join('\n') + '\n');
  return cacheDir;
}

/** Start one OpenMTG server process on a free port; resolves with its URL once it listens. */
function startServer(name: string): Promise<string> {
  const p = spawn(process.execPath, ['--import', 'tsx', SERVER_MAIN, '--port', '0', '--api-only', '--game-address', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...process.env, OPENMTG_CACHE_DIR: fixtureCache() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(p);
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}: the server did not start:\n${out}`)), 60000);
    const onData = (b: Buffer) => {
      out += b.toString();
      const m = /running at (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    };
    p.stdout!.on('data', onData);
    p.stderr!.on('data', (b: Buffer) => (out += b.toString()));
    p.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${name}: the server exited with ${code}:\n${out}`));
    });
  });
}

/** The link a page of the server at `base` would open: same-origin token request, then the socket with that page's Origin (audit m11). */
function pageLink(base: string): OnlineLink {
  return new OnlineLink({
    base,
    fetch: (url, init) => fetch(url, init),
    socket: (url) => new (WebSocket as unknown as new (u: string, o: { headers: Record<string, string> }) => SocketLike)(url, { headers: { Origin: base } }),
  });
}

async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('an online game between two RemoteConnections through two local server processes (127.0.0.1)', () => {
  it('plays to the end; each side sees only its own view, gets the event feed and the result; leaving ends both games cleanly', async () => {
    const [hostUrl, guestUrl] = await Promise.all([startServer('host'), startServer('guest')]);
    const hostLink = pageLink(hostUrl);
    const guestLink = pageLink(guestUrl);
    await Promise.all([hostLink.connect(), guestLink.connect()]);
    expect(hostLink.status()).toEqual({ role: 'none', phase: 'idle', warnings: [] });

    // Host (port 0: any free UDP port on 127.0.0.1), then join with the code and the bound port.
    const hosted = await hostLink.host({ name: 'Hana', deck: deck({ Forest: 20, 'Grizzly Bears': 20 }), port: 0 });
    expect(hosted).toEqual({ ok: true });
    await until(() => hostLink.status().phase === 'waiting' && hostLink.status().code !== undefined, 10000, 'the join code');
    const { code, port } = hostLink.status();
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    expect(port).toBeGreaterThan(0);

    // A wrong code is refused with badCode (normal traffic: one handshake with the wrong code).
    const wrong = await guestLink.join({ address: `127.0.0.1:${port}`, code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', name: 'Gus', deck: deck({ Mountain: 20, 'Hill Giant': 20 }) });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'badCode' } });
    expect(guestLink.status().phase).toBe('idle');

    const joined = await guestLink.join({ address: `127.0.0.1:${port}`, code: code!.toLowerCase(), name: 'Gus', deck: deck({ Mountain: 20, 'Hill Giant': 20 }) });
    expect(joined).toEqual({ ok: true });
    await until(() => hostLink.view() !== null && guestLink.view() !== null, 10000, 'the first views');
    expect(hostLink.status()).toMatchObject({ role: 'host', phase: 'playing', me: 'p1', opponent: 'Gus', opponentConnected: true });
    expect(guestLink.status()).toMatchObject({ role: 'guest', phase: 'playing', me: 'p2', opponent: 'Hana', opponentConnected: true });

    const sides = [
      { conn: new RemoteConnection(hostLink), me: 'p1' as PlayerId, views: [] as GameView[], batches: 0 },
      { conn: new RemoteConnection(guestLink), me: 'p2' as PlayerId, views: [] as GameView[], batches: 0 },
    ];
    for (const s of sides) {
      let seq = s.conn.events().seq;
      s.conn.subscribe(() => {
        s.views.push(s.conn.view());
        const b = s.conn.events();
        if (b.seq !== seq && b.events.length > 0) s.batches++;
        seq = b.seq;
      });
    }

    const problems: string[] = [];
    const deadline = Date.now() + 150000;
    while (!sides.every((s) => s.conn.view().result)) {
      if (Date.now() > deadline) throw new Error('the game did not end');
      let acted = false;
      for (const s of sides) {
        const v = s.conn.view();
        const a = autoAction(v, s.conn.legalActions() as never, s.me);
        if (!a) continue;
        acted = true;
        const r = await s.conn.act(a);
        if (!r.ok && !/moved on/.test(r.error.message)) problems.push(`${s.me}: ${r.error.message}`);
      }
      if (!acted) await new Promise((r) => setTimeout(r, 5));
    }
    expect(problems).toEqual([]);

    // Only this player's view, ever (CR 400.2), and the host's hidden cards are hidden from the guest.
    for (const s of sides) {
      expect(s.views.length).toBeGreaterThan(20);
      for (const v of s.views) {
        expect(v.viewer).toBe(s.me);
        for (const key of ['rng', 'seed']) expect(key in v).toBe(false);
      }
      expect(s.batches).toBeGreaterThan(5); // the event feed for the board's animations
    }
    let hidden = 0;
    for (const v of sides[1]!.views)
      for (const o of Object.values(v.objects)) {
        if (o.owner !== 'p1' || (o.zone !== 'hand' && o.zone !== 'library') || o.revealedTo?.includes('p2')) continue;
        expect(o.defId).toBe(HIDDEN_DEF);
        hidden++;
      }
    expect(hidden).toBeGreaterThan(100);
    expect(sides[0]!.conn.view().result).toEqual(sides[1]!.conn.view().result);
    expect(sides[0]!.conn.view().turn.number).toBeGreaterThan(3);
    await until(() => hostLink.status().phase === 'over' && guestLink.status().phase === 'over', 5000, 'both statuses over');
    expect(sides.map((s) => s.conn.legalActions())).toEqual([[], []]);

    // The guest leaves: its server goes idle, the host hears of it; then the host leaves too.
    expect(await guestLink.leave()).toEqual({ ok: true });
    expect(guestLink.status()).toEqual({ role: 'none', phase: 'idle', warnings: [] });
    await until(() => hostLink.notices().some((n) => n.kind === 'opponentLeft'), 5000, 'the host to hear the guest left');
    expect(sides[0]!.conn.status()).toBe('Gus left.');
    expect(await hostLink.leave()).toEqual({ ok: true });
    expect(hostLink.status().phase).toBe('idle');

    // CL4: a second game on the same two servers. The guest chooses Leave while it runs: its server concedes for it first (CR 104.3a), so the host
    // sees that it won and why, not a dropped link it waits on.
    expect(await hostLink.host({ name: 'Hana', deck: deck({ Forest: 20, 'Grizzly Bears': 20 }), port: 0 })).toEqual({ ok: true });
    await until(() => hostLink.status().phase === 'waiting' && hostLink.status().code !== undefined, 10000, 'the second join code');
    const second = hostLink.status();
    expect(await guestLink.join({ address: `127.0.0.1:${second.port}`, code: second.code!, name: 'Gus', deck: deck({ Mountain: 20, 'Hill Giant': 20 }) })).toEqual({ ok: true });
    await until(() => hostLink.status().phase === 'playing' && guestLink.view() !== null && guestLink.view()!.view.result === null, 10000, 'the second game');
    const hostConn = new RemoteConnection(hostLink);
    expect(hostConn.view().result).toBeNull();
    expect(await guestLink.leave()).toEqual({ ok: true });
    expect(guestLink.status()).toEqual({ role: 'none', phase: 'idle', warnings: [] });
    await until(() => hostLink.notices().some((n) => n.kind === 'opponentLeft' && /conceded/.test(n.text)), 5000, 'the host to hear the guest left and conceded');
    expect(hostLink.notices().filter((n) => n.kind === 'opponentDropped')).toEqual([]);
    expect(hostLink.notices().at(-1)!.text).toBe('Gus left the game and conceded (CR 104.3a).');
    expect(hostConn.view().result).toMatchObject({ winner: 'p1' });
    expect(hostConn.view().players.find((p) => p.id === 'p2')!.conceded).toBe(true);
    expect(hostLink.status()).toMatchObject({ phase: 'over', opponentConnected: false, result: { winner: 'p1' } });
    expect(await hostLink.leave()).toEqual({ ok: true });
    hostLink.close();
    guestLink.close();
  }, 240000);
});
