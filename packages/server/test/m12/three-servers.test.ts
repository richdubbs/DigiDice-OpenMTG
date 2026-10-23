// @vitest-environment node
/**
 * M12-5a (m12 design 6 and 9; owner permission 2026-10-15): ONE normal-traffic 3-player game between THREE local OpenMTG server processes on 127.0.0.1.
 * no hostile network testing; this is ordinary play only (no floods, no fuzzing, no forged traffic). Each server (packages/server/src/main.ts)
 * has its own card cache (the engine's fixture cards); the host's UDP game port is bound to 127.0.0.1 only (`--game-address`). Each "page" talks to its
 * own server over the localhost WebSocket exactly as the client does (GET /api/online/session, then the socket with the token and the page's Origin).
 *
 * The host hosts 3 seats and gets one code per guest seat; the two guests join with their own codes; the game starts when every seat is taken; the simple
 * automatic player plays each side; one guest leaves mid-game (its Leave concedes, CR 104.3a) and the game goes on to the end between the other two.
 * Checked: each page only ever gets its own player's view (CR 400.2: no other player's hand or library card, no other player's marker card name in any
 * message), every page sees the table and the result. Reported: the compressed size of the views each guest's server received (m12 design 8).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { HIDDEN_DEF, type Action, type GameView, type OracleCard, type PlayerId } from '@openmtg/engine';
import { autoAction } from '@openmtg/net';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, OnlineDeck, OnlineSessionResponse, OnlineStatus, ServerMessage } from '../../src/online/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..', '..');
const SERVER_MAIN = path.join(ROOT, 'packages', 'server', 'src', 'main.ts');
const FIXTURE = path.join(ROOT, 'packages', 'engine', 'test', 'fixtures', 'cards.json');

const deck = (main: Record<string, number>): OnlineDeck => ({ main: Object.entries(main).map(([name, count]) => ({ name, count })), sideboard: [] });
/** Each player's deck and its marker: a card of a color its lands cannot make, so it is never cast and its name is never public (the bots keep it, `botAction`). */
const PLAYERS = [
  { name: 'Hana', deck: deck({ Forest: 16, 'Grizzly Bears': 21, 'Abzan Charm': 3 }), marker: 'Abzan Charm' },
  { name: 'Gus', deck: deck({ Mountain: 16, 'Raging Goblin': 12, 'Hill Giant': 9, 'Chief of the Scale': 3 }), marker: 'Chief of the Scale' },
  { name: 'Bianca', deck: deck({ Plains: 16, 'Elite Vanguard': 21, 'Cuboid Colony': 3 }), marker: 'Cuboid Colony' },
];

/**
 * The bots' action: autoAction, but a card choice (discard to hand size, CR 514.1) keeps the marker cards, as packages/net/test/m12/table.ts#botAction does:
 * a marker discarded to the graveyard is public (CR 400.2, 404.2) and its name would rightly reach every page.
 */
function botAction(v: GameView, legal: Parameters<typeof autoAction>[1], me: PlayerId): Action | null {
  let a = autoAction(v, legal, me);
  if (a?.type === 'answer' && a.answer.kind === 'chooseObjects' && v.pending?.kind === 'chooseObjects') {
    const d = v.pending;
    const marker = (id: string) => Number(PLAYERS.some((p) => p.marker === v.defs[v.objects[id]?.defId ?? '']?.name));
    a = { ...a, answer: { kind: 'chooseObjects', ids: [...d.options].sort((x, y) => marker(x) - marker(y)).slice(0, d.min) } };
  }
  return a;
}

const procs: ChildProcess[] = [];
const dirs: string[] = [];
const sockets: WebSocket[] = [];
afterAll(() => {
  for (const s of sockets) s.terminate();
  for (const p of procs) if (p.exitCode === null) p.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixtureCache(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-m12-5a-'));
  dirs.push(dir);
  const cacheDir = path.join(dir, 'scryfall');
  mkdirSync(cacheDir);
  const data = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cards: OracleCard[]; tokens?: OracleCard[] };
  writeFileSync(path.join(cacheDir, 'cards.jsonl'), data.cards.map((c) => JSON.stringify(c)).join('\n') + '\n');
  writeFileSync(path.join(cacheDir, 'tokens.jsonl'), (data.tokens ?? []).map((c) => JSON.stringify(c)).join('\n') + '\n');
  return cacheDir;
}

function startServer(name: string): Promise<string> {
  const p = spawn(process.execPath, ['--import', 'tsx', SERVER_MAIN, '--port', '0', '--api-only', '--game-address', '127.0.0.1'], {
    cwd: ROOT, env: { ...process.env, OPENMTG_CACHE_DIR: fixtureCache() }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(p);
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}: the server did not start:\n${out}`)), 60000);
    p.stdout!.on('data', (b: Buffer) => {
      out += b.toString();
      const m = /running at (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    });
    p.stderr!.on('data', (b: Buffer) => (out += b.toString()));
    p.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${name}: the server exited with ${code}:\n${out}`));
    });
  });
}

async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

type Cmd = ClientMessage extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never;
type Reply = Extract<ServerMessage, { t: 'reply' }>;
type ViewMsg = Extract<ServerMessage, { t: 'view' }>;

/** A page of one server: its socket, everything it received (and the raw text, for the scans), and its commands. */
class Page {
  readonly inbox: ServerMessage[] = [];
  readonly texts: string[] = [];
  private nextId = 1;
  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const text = data.toString();
      this.texts.push(text);
      this.inbox.push(JSON.parse(text) as ServerMessage);
    });
  }

  static async open(base: string): Promise<Page> {
    const session = (await (await fetch(`${base}/api/online/session`)).json()) as OnlineSessionResponse;
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/online/socket?token=${session.token}`, { origin: base });
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new Page(ws);
  }

  async cmd(m: Cmd, ms = 20000): Promise<Reply> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ ...m, id }));
    let reply: Reply | undefined;
    await until(() => (reply = this.inbox.find((x): x is Reply => x.t === 'reply' && x.id === id)) !== undefined, ms, `the reply to ${m.t}`);
    return reply!;
  }

  get status(): OnlineStatus | undefined {
    return [...this.inbox].reverse().find((x): x is Extract<ServerMessage, { t: 'status' }> => x.t === 'status')?.status;
  }

  get views(): ViewMsg[] {
    return this.inbox.filter((x): x is ViewMsg => x.t === 'view');
  }

  get last(): ViewMsg | undefined {
    return this.views.at(-1);
  }

  close(): void {
    this.ws.close();
  }
}

describe('M12-5a: a 3-player online game between three local server processes (127.0.0.1, normal traffic only)', () => {
  it('per-seat codes, the lobby, the start; a guest leaves mid-game and the game goes on to the end; each page only ever sees its own player\'s view', async () => {
    const bases = await Promise.all(['host', 'gus', 'bianca'].map(startServer));
    const pages = await Promise.all(bases.map((b) => Page.open(b)));
    const [host, gus, bianca] = pages as [Page, Page, Page];

    expect(await host.cmd({ t: 'host', name: 'Hana', deck: PLAYERS[0]!.deck, port: 0, seats: 3 })).toMatchObject({ ok: true });
    await until(() => host.status?.phase === 'waiting' && (host.status.codes?.length ?? 0) === 2, 10000, 'the codes');
    const { codes, port } = host.status!;
    expect(codes!.map((c) => c.seat)).toEqual([2, 3]);
    expect(codes![0]!.code).not.toBe(codes![1]!.code);

    // Seat 3 first, then seat 2: each with its own code.
    expect(await bianca.cmd({ t: 'join', address: `127.0.0.1:${port}`, code: codes![1]!.code, name: 'Bianca', deck: PLAYERS[2]!.deck })).toMatchObject({ ok: true });
    await until(() => bianca.status?.phase === 'waiting', 10000, 'Bianca in the lobby');
    expect(bianca.status).toMatchObject({ role: 'guest', me: 'p3', seat: 3, seats: 3 });
    expect(await gus.cmd({ t: 'join', address: `127.0.0.1:${port}`, code: codes![0]!.code, name: 'Gus', deck: PLAYERS[1]!.deck })).toMatchObject({ ok: true });
    await until(() => pages.every((p) => p.status?.phase === 'playing' && p.last !== undefined), 20000, 'the start everywhere');
    for (const p of pages) expect(p.status!.players!.map((x) => x.id).sort()).toEqual(['p1', 'p2', 'p3']);

    const sides: { page: Page; me: PlayerId }[] = [{ page: host, me: 'p1' }, { page: gus, me: 'p2' }, { page: bianca, me: 'p3' }];
    const problems: string[] = [];
    let leftAt = 0;
    const deadline = Date.now() + 180000;
    while (!sides.filter((s) => s.me !== 'p3').every((s) => s.page.last?.view.result)) {
      if (Date.now() > deadline) throw new Error('the game did not end');
      // Bianca leaves mid-game: her page's Leave concedes first (CR 104.3a); the game goes on for the other two (CR 800.4a).
      if (!leftAt && (gus.last?.view.turn.number ?? 0) >= 4) {
        expect(await bianca.cmd({ t: 'leave' })).toMatchObject({ ok: true });
        leftAt = gus.last!.view.turn.number;
        expect(bianca.status!.phase).toBe('idle');
      }
      let acted = false;
      for (const s of sides) {
        if (s.me === 'p3' && leftAt) continue;
        const v = s.page.last;
        if (!v || v.view.result || v.view.pending?.player !== s.me) continue;
        const a = botAction(v.view, v.legal, s.me);
        if (!a) continue;
        acted = true;
        const r = await s.page.cmd({ t: 'act', action: a });
        if (!r.ok && r.error.code !== 'stale') problems.push(`${s.me}: ${r.error.code} ${r.error.message}`);
      }
      if (!acted) await new Promise((r) => setTimeout(r, 5));
    }
    expect(problems).toEqual([]);
    expect(leftAt).toBeGreaterThan(0);
    expect(host.last!.view.result).toEqual(gus.last!.view.result);
    expect(host.last!.view.players.find((p) => p.id === 'p3')!.conceded).toBe(true);
    await until(() => host.inbox.some((m) => m.t === 'notice' && m.player === 'p3' && m.kind === 'opponentLeft'), 5000, 'the host told Bianca left');
    await until(() => gus.inbox.some((m) => m.t === 'notice' && m.player === 'p3' && m.kind === 'opponentLeft'), 5000, 'Gus told Bianca left');

    // CR 400.2: only one's own view, ever; no other player's hand or library card; no other player's marker name in anything a page received.
    for (const [i, s] of sides.entries()) {
      expect(s.page.views.length).toBeGreaterThan(5);
      const text = s.page.texts.join('\n');
      PLAYERS.forEach((p, j) => {
        if (j !== i) expect(text).not.toContain(p.marker);
      });
      for (const m of s.page.views) {
        expect(m.view.viewer).toBe(s.me);
        for (const key of ['rng', 'seed']) expect(key in m.view).toBe(false);
        for (const o of Object.values(m.view.objects)) if (o.owner !== s.me && (o.zone === 'hand' || o.zone === 'library') && !o.revealedTo?.includes(s.me)) expect(o.defId).toBe(HIDDEN_DEF);
      }
    }

    // m12 design 8: the compressed size of the views each guest received (deflated JSON, as the link's codec sends them).
    for (const [name, page] of [['Gus', gus], ['Bianca', bianca]] as const) {
      const sizes = page.views.map((v) => deflateRawSync(Buffer.from(JSON.stringify({ v: 4, type: 'view', seq: v.seq, view: v.view, events: v.events, legal: v.legal }))).length).sort((a, b) => a - b);
      const median = sizes[Math.floor(sizes.length / 2)]!;
      console.log(`M12-5a view sizes for ${name}: ${sizes.length} views, compressed median ${median} B, max ${sizes.at(-1)} B`);
      expect(median).toBeLessThan(64 * 1024);
    }

    // Everyone leaves; the servers are idle again.
    expect(await gus.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(await host.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    await until(() => host.status?.phase === 'idle', 5000, 'the host idle');
    for (const p of pages) p.close();
  }, 300000);
});
