/** The table channel's games recorded as replays in the library (library/replays.ts): saved at the end or on leaving, undo taken back, the file valid. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBugReportFile, readReplayFile } from '@openmtg/engine';
import { LocalConnection } from '@openmtg/play';
import type { ApiRequest, ServerContext } from '../src/context';
import {
  addReplay, GameRecording, type RecordingInfo, getLibraryReplays, loadReplay, postLibraryReplayDelete, postLibraryReplayImport, postLibraryReplayRetention,
  postLibraryReplayUpdate,
} from '../src/library/replays';
import { fallback } from '@openmtg/play';
import { checkSteps } from '@openmtg/play/replay/check';
import { TableService } from '../src/table/socket';
import { Table } from '../src/table/tables';
import { bearsConfig, FakeClient, pause, TOKEN } from './table/helpers';

let dir: string;
let ctx: ServerContext;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'openmtg-replays-'));
  ctx = { cacheDir: path.join(dir, 'scryfall'), compiledDir: path.join(dir, 'compiled'), version: '1.2.3' };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const req = (over: Partial<ApiRequest> = {}): ApiRequest => ({ query: {}, params: {}, body: undefined, ...over });
const settle = () => new Promise((r) => setTimeout(r, 50));

/** Wait until `test` holds (at most 5 s). */
async function until(test: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100 && !(await test()); i++) await settle();
}

/** A game recorded as the server records it (hot-seat unless told otherwise), passed `passes` times. */
async function played(passes: number, mode: 'hotseat' | 'computer' = 'hotseat', seated: string[] = ['p1', 'p2']) {
  const config = bearsConfig('replay-test', { skipMulligans: true, startingPlayer: 'p1' });
  const conn = new LocalConnection(config);
  const rec = new GameRecording(ctx, { config, mode, format: 'casual', seated, version: '1.2.3' });
  conn.observeLog({ applied: (a, i, b, af) => rec.applied(a, i, b, af), undone: (n) => rec.undone(n) });
  for (let i = 0; i < passes; i++) {
    // Hot-seat: the next player accepts the screen first.
    conn.acceptHandoff();
    const v = conn.view();
    expect((await conn.act({ type: 'pass', player: v.pending!.player })).ok).toBe(true);
  }
  conn.acceptHandoff();
  return { conn, rec };
}

async function list() {
  const r = await getLibraryReplays(req(), ctx);
  if (r.status !== 200) throw new Error('list failed');
  return r.body;
}

describe('recording', () => {
  it('saves a finished game as a valid replay, with every action, its times and checkpoints', async () => {
    const { conn, rec } = await played(5);
    expect((await conn.act({ type: 'concede', player: 'p2' })).ok).toBe(true);
    await rec.finish();
    const { replays } = await list();
    expect(replays).toHaveLength(1);
    const r = replays[0]!;
    expect(r).toMatchObject({ id: rec.id, title: 'Alice vs Bob, Casual', kind: 'game', keep: false, hasRecording: false });
    expect(r.game).toMatchObject({ mode: 'hotseat', format: 'casual', ended: 'conceded', actions: 6, result: { winner: 'p1' } });
    const read = await readReplayFile(new Uint8Array(readFileSync(r.path)));
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.play!.actions).toHaveLength(6);
      expect(read.value.play!.times).toHaveLength(6);
      expect(read.value.play!.checkpoints.at(-1)!.action).toBe(5);
      expect(read.value.app.version).toBe('1.2.3');
    }
  });

  it('takes undone actions off the record, and saves a game left unfinished as abandoned', async () => {
    const { conn, rec } = await played(0);
    // Pass until a land can be played, play it, then take it back (CR 733.1).
    for (let i = 0; i < 20 && !conn.legalActions().some((a) => a.kind === 'playLand'); i++) {
      conn.acceptHandoff();
      await conn.act({ type: 'pass', player: conn.view().pending!.player });
      conn.acceptHandoff();
    }
    const before = (rec.file()?.play?.actions.length) ?? 0;
    expect((await conn.act(conn.legalActions().find((a) => a.kind === 'playLand')!.action)).ok).toBe(true);
    expect(rec.file()!.play!.actions).toHaveLength(before + 1);
    expect(conn.undo()).toBe(true);
    await rec.finish();
    const { replays } = await list();
    expect(replays[0]!.game).toMatchObject({ ended: 'abandoned', result: null, actions: before });
  });

  it('keeps nothing for a game with no action', async () => {
    const { rec } = await played(0);
    await rec.finish();
    expect((await list()).replays).toEqual([]);
  });

  it('records a table started over the channel, and saves it when the table closes', async () => {
    const config = bearsConfig('replay-table', { skipMulligans: true, startingPlayer: 'p1' });
    const table = new Table({ t: 'start', kind: 'hotseat', config, format: 'standard' }, {
      record: (info) => new GameRecording(ctx, { ...info, version: '9' }),
    });
    const conn = (table as unknown as { game: LocalConnection }).game;
    conn.acceptHandoff();
    expect((await conn.act({ type: 'pass', player: conn.view().pending!.player })).ok).toBe(true);
    table.close();
    await table.recording!.finish();
    const { replays } = await list();
    expect(replays[0]!).toMatchObject({ title: 'Alice vs Bob, Standard', game: { mode: 'hotseat', format: 'standard', ended: 'abandoned', actions: 1 } });
  });
});

describe('recording a game against the computer', { timeout: 20_000 }, () => {
  it('records the config the game started from (the computer seat\'s own stops), so the whole game replays exactly', async () => {
    const record = (info: Omit<RecordingInfo, 'version'>) => new GameRecording(ctx, { ...info, version: '9' });
    const service = new TableService({ token: TOKEN, version: '9', tables: { record, delayMs: () => 0, maxBoardWaitMs: 20 } });
    try {
      const c = new FakeClient(service);
      c.autoShown = true;
      await c.hello();
      c.send({ t: 'start', kind: 'computer', config: bearsConfig('replay-ai', { skipMulligans: true, startingPlayer: 'p1', startingLife: 8 }, false), computers: ['p2'], seed: 'replay-ai' });
      await c.next('view');
      // The person passes, or takes the always-legal answer, until the computer's bears win or 10 turns have gone by.
      for (let i = 0; i < 600 && !c.view.result && c.view.turn.number <= 10; i++) {
        const d = c.view.pending;
        if (d?.player === 'p1') {
          await c.act(d.kind === 'priority' ? { type: 'pass', player: 'p1' } : fallback(d));
        } else {
          const at = c.seq;
          await c.next('patch', (m) => m.seq > at, undefined, 2000).catch(() => undefined);
          if (c.seq === at) await pause(20);
        }
      }
      expect(c.view.turn.number).toBeGreaterThan(4);
      c.send({ t: 'leave', table: c.table });
      await until(async () => (await list()).replays.length > 0);
    } finally {
      await service.close();
    }
    const { replays } = await list();
    // This server recorded it with its own engine build: the library says it plays exactly.
    expect(replays[0]!.status).toBe('exact');
    const file = await loadReplay(ctx, replays[0]!.id);
    expect(file.play!.config.players[1]!.stops).toBeDefined();
    const steps = checkSteps(file.play!);
    let r = steps.next();
    while (!r.done) r = steps.next();
    expect(r.value.problem).toBeNull();
  });
});

describe("the end screen's replay panel", { timeout: 20_000 }, () => {
  it('says where the replay stands, marks it Keep and records who shows their cards, before and after it is saved', async () => {
    const record = (info: Omit<RecordingInfo, 'version'>) => new GameRecording(ctx, { ...info, version: '9' });
    const service = new TableService({ token: TOKEN, version: '9', tables: { record } });
    try {
      const c = new FakeClient(service);
      await c.hello();
      c.send({ t: 'start', kind: 'hotseat', config: bearsConfig('panel', { skipMulligans: true, startingPlayer: 'p1' }), format: 'casual' });
      expect(await c.next('recording')).toMatchObject({ state: 'recording', keep: false, people: ['p1', 'p2'], agreed: [], error: null });
      c.send({ t: 'recording', table: c.table, keep: true });
      await c.next('recording', (m) => m.keep);
      c.send({ t: 'recording', table: c.table, reveal: { player: 'p1', agreed: true } });
      await c.next('recording', (m) => m.agreed.includes('p1'));
      c.send({ t: 'recording', table: c.table, reveal: { player: 'p9', agreed: true } });
      expect((await c.act({ type: 'concede', player: 'p2' })).ok).toBe(true);
      const saved = await c.next('recording', (m) => m.state === 'saved');
      expect(saved.agreed).toEqual(['p1']);
      const { replays } = await list();
      expect(replays[0]).toMatchObject({ id: saved.id, keep: true, reveal: { policy: 'own', agreed: ['p1'] } });
      // The second person agrees after the save: the saved replay may now show every card (CR 400.2).
      c.send({ t: 'recording', table: c.table, reveal: { player: 'p2', agreed: true } });
      await c.next('recording', (m) => m.agreed.length === 2);
      await until(async () => (await loadReplay(ctx, saved.id)).reveal.policy === 'all');
      expect((await loadReplay(ctx, saved.id)).reveal).toEqual({ policy: 'all', agreed: ['p1', 'p2'] });
      expect((await list()).replays[0]!.reveal).toEqual({ policy: 'all', agreed: ['p1', 'p2'] });
    } finally {
      await service.close();
    }
  });

  it('says a game with no action has nothing to save', async () => {
    const rec = new GameRecording(ctx, { config: bearsConfig('empty'), mode: 'hotseat', format: '', seated: ['p1', 'p2'], version: '9' });
    const states: string[] = [];
    rec.onChange = () => states.push(rec.state);
    await rec.finish();
    expect(states).toEqual(['empty']);
  });
});

describe('Report a bug over the table channel', { timeout: 20_000 }, () => {
  const environment = {
    app: { version: '2.0.0', commit: null },
    browser: { userAgent: 'OpenMTG test', language: 'en', screen: 'window 1600x900' },
    settings: { animationSpeed: 'normal', reducedMotion: false },
    errors: [],
  };

  it('takes the moment when the report opens (the screen before any action, then the game so far) and makes a valid report file', async () => {
    const record = (info: Omit<RecordingInfo, 'version'>) => new GameRecording(ctx, { ...info, version: '9' });
    const service = new TableService({ token: TOKEN, version: '9', tables: { record } });
    try {
      const c = new FakeClient(service);
      await c.hello();
      c.send({ t: 'start', kind: 'hotseat', config: bearsConfig('bug', { skipMulligans: true, startingPlayer: 'p1' }), format: 'casual' });
      await c.next('view');
      c.send({ t: 'bugCapture', table: c.table, id: 1 });
      expect(await c.next('bugCaptured', (m) => m.id === 1)).toMatchObject({ holds: 'view', kind: 'recording', at: 0, length: 1 });
      c.send({ t: 'handoff', table: c.table });
      await c.next('view', () => true).catch(() => undefined);
      expect((await c.act({ type: 'pass', player: c.view.pending!.player })).ok).toBe(true);
      c.send({ t: 'bugCapture', table: c.table, id: 2 });
      expect(await c.next('bugCaptured', (m) => m.id === 2)).toMatchObject({ holds: 'game', kind: 'game', at: 0, length: 1 });
      c.send({ t: 'bugReport', table: c.table, id: 3, words: '', environment });
      expect((await c.next('bugReportFile', (m) => m.id === 3)).error).toContain('what happened');
      c.send({ t: 'bugReport', table: c.table, id: 4, words: 'The bear did not attack.', card: 'Test Bear', environment });
      const file = await c.next('bugReportFile', (m) => m.id === 4);
      expect(file.name).toMatch(/^openmtg-bug-\d{4}-\d{2}-\d{2}-\d{4}\.openmtg-bug-report$/);
      const read = await readBugReportFile(new Uint8Array(Buffer.from(file.data!, 'base64')));
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.value).toMatchObject({ at: { action: 0 }, words: 'The bear did not attack.', card: 'Test Bear', app: { version: '2.0.0' } });
        expect(read.value.replay.kind).toBe('game');
      }
    } finally {
      await service.close();
    }
  });

  it("carries a watched replay and the moment on screen", async () => {
    const { conn, rec } = await played(6);
    await conn.act({ type: 'concede', player: 'p2' });
    await rec.finish();
    const service = new TableService({ token: TOKEN, version: '9', loadReplay: (id) => loadReplay(ctx, id) });
    try {
      const c = new FakeClient(service);
      await c.hello();
      c.send({ t: 'watch', replay: rec.id });
      expect((await c.next('replayState')).offersReport).toBe(false);
      c.send({ t: 'replay', table: c.table, op: 'seek', value: 4 });
      await c.next('replayState', (m) => m.position === 4);
      c.send({ t: 'bugCapture', table: c.table, id: 1 });
      expect(await c.next('bugCaptured', (m) => m.id === 1)).toMatchObject({ holds: 'replay', kind: 'game', at: 3, length: 7 });
      c.send({ t: 'bugReport', table: c.table, id: 2, words: 'Something.', environment });
      const file = await c.next('bugReportFile', (m) => m.id === 2);
      const read = await readBugReportFile(new Uint8Array(Buffer.from(file.data!, 'base64')));
      expect(read.ok && read.value.replay.id).toBe(rec.id);
    } finally {
      await service.close();
    }
  });
});

describe('the library', () => {
  it('renames, keeps, deletes and imports, and keeps the newest of those not marked Keep', async () => {
    const { conn, rec } = await played(2);
    await conn.act({ type: 'concede', player: 'p1' });
    await rec.finish();
    const first = (await list()).replays[0]!;
    const renamed = await postLibraryReplayUpdate(req({ body: { id: first.id, title: 'Our game', keep: true } }), ctx);
    expect(renamed.status).toBe(200);
    expect((await list()).replays[0]).toMatchObject({ title: 'Our game', keep: true });
    const reread = await readReplayFile(new Uint8Array(readFileSync(first.path)));
    expect(reread.ok && reread.value.title).toBe('Our game');
    // Import: a copy of a file with an id already here gets a new id.
    const copy = path.join(dir, 'copy.openmtg-replay');
    writeFileSync(copy, readFileSync(first.path));
    const imported = await postLibraryReplayImport(req({ body: { path: copy } }), ctx);
    expect(imported.status).toBe(200);
    expect((await list()).replays.map((r) => r.title)).toEqual(['Our game', 'Our game']);
    writeFileSync(path.join(dir, 'bad.openmtg-replay'), 'not a replay');
    expect((await postLibraryReplayImport(req({ body: { path: path.join(dir, 'bad.openmtg-replay') } }), ctx)).status).toBe(400);
    // Retention 10: the kept one stays whatever happens; of the rest, the newest ten.
    expect((await postLibraryReplayRetention(req({ body: { limit: 10 } }), ctx)).status).toBe(200);
    expect((await postLibraryReplayRetention(req({ body: { limit: 7 } }), ctx)).status).toBe(400);
    const base = (await readReplayFile(new Uint8Array(readFileSync(first.path)))) as { ok: true; value: Parameters<typeof addReplay>[1] };
    for (let i = 0; i < 12; i++) await addReplay(ctx, { ...base.value, id: `r-${String(i).padStart(20, '0')}`, title: `Game ${i}` });
    const after = await list();
    expect(after.replays.filter((r) => !r.keep)).toHaveLength(10);
    expect(after.replays.some((r) => r.keep)).toBe(true);
    expect(after.retention).toBe(10);
    expect(await postLibraryReplayDelete(req({ body: { id: first.id } }), ctx)).toEqual({ status: 200, body: { deleted: true } });
    expect((await list()).replays.some((r) => r.id === first.id)).toBe(false);
  });
});

describe('watching a replay over the table channel', { timeout: 20_000 }, () => {
  /** A replay of the library watched over a new connection: the client, and the replay's first state. */
  async function watch(service: TableService, id: string) {
    const c = new FakeClient(service);
    await c.hello();
    c.send({ t: 'watch', replay: id });
    const first = await c.next('replayState');
    return { c, first };
  }

  it('opens a recorded game as a table: the first view, steps, seeks, the views the policy allows, the speed, and act refused', async () => {
    const { conn, rec } = await played(6);
    await conn.act({ type: 'concede', player: 'p2' });
    await rec.finish();
    const service = new TableService({ token: TOKEN, version: '9', loadReplay: (id) => loadReplay(ctx, id) });
    try {
      const { c, first } = await watch(service, rec.id);
      // This build recorded it: it plays exactly, and a hot-seat game shows only the public view (replays design 6).
      expect(first).toMatchObject({ position: 0, last: 7, playing: false, speed: 1, playable: true, badge: 'exact', statusText: 'Exact', notice: null });
      expect(first.perspective).toEqual({ key: 'public', label: 'Public' });
      expect(first.perspectives).toEqual([{ key: 'public', label: 'Public' }]);
      expect(first.label).toMatch(/ · action 0 of 7$/);
      expect(first.players).toEqual([{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }]);
      // The table's first view came before the replay's state.
      expect(c.held).not.toBeNull();
      c.send({ t: 'replay', table: c.table, op: 'step', value: 1 });
      expect(await c.next('replayState', (m) => m.position === 1)).toMatchObject({ jumps: 0 });
      c.send({ t: 'replay', table: c.table, op: 'seek', value: 7 });
      expect((await c.next('replayState', (m) => m.position === 7)).jumps).toBe(1);
      expect(c.view.result).toMatchObject({ winner: 'p1' });
      // A step back is a jump: shown at once, without its events.
      c.send({ t: 'replay', table: c.table, op: 'step', value: -1 });
      expect((await c.next('replayState', (m) => m.position === 6)).jumps).toBe(2);
      expect(c.view.result).toBeFalsy();
      c.send({ t: 'replay', table: c.table, op: 'previousTurn' });
      await c.next('replayState', (m) => m.position < 6);
      // A seat this game may not show is refused, with the rule.
      c.send({ t: 'replay', table: c.table, op: 'perspective', value: 'seat:p1' });
      expect((await c.next('replayRefused')).message).toContain('CR 400.2');
      c.send({ t: 'replay', table: c.table, op: 'speed', value: 4 });
      expect(await c.next('replayState', (m) => m.speed === 4)).toMatchObject({ muted: false });
      c.send({ t: 'replay', table: c.table, op: 'changeSpeed', value: 1 });
      expect(await c.next('replayState', (m) => m.speed === 8)).toMatchObject({ muted: true });
      c.send({ t: 'replay', table: c.table, op: 'muteFast', value: false });
      expect(await c.next('replayState', (m) => !m.muteFast)).toMatchObject({ muted: false });
      c.send({ t: 'replay', table: c.table, op: 'speed', value: 'real' });
      await c.next('replayState', (m) => m.speed === 'real');
      expect((await c.act({ type: 'pass', player: 'p1' })).ok).toBe(false);
      c.send({ t: 'watch', replay: 'r-00000000000000000000' });
      expect(await c.next('notice')).toMatchObject({ text: expect.stringContaining('no longer in the library') });
    } finally {
      await service.close();
    }
  });

  it('plays by itself once the screen has shown each change, and pauses at the end', async () => {
    const { conn, rec } = await played(4);
    await conn.act({ type: 'concede', player: 'p2' });
    await rec.finish();
    const service = new TableService({ token: TOKEN, version: '9', loadReplay: (id) => loadReplay(ctx, id) });
    try {
      const { c } = await watch(service, rec.id);
      c.send({ t: 'replay', table: c.table, op: 'speed', value: 16 });
      await c.next('replayState', (m) => m.speed === 16);
      c.send({ t: 'replay', table: c.table, op: 'play' });
      await c.next('replayState', (m) => m.playing);
      // The screen has not said it shows the view it holds: the clock waits for it.
      await pause(200);
      expect(c.messages.filter((m) => m.t === 'replayState').at(-1)).toMatchObject({ position: 0, playing: true });
      c.autoShown = true;
      c.send({ t: 'shown', table: c.table, seq: c.seq });
      expect(await c.next('replayState', (m) => m.position === 5 && !m.playing)).toMatchObject({ last: 5 });
    } finally {
      await service.close();
    }
  });

  it("opens a game against the computer on the person's seat, and also shows the computer's seat, the public view and every card", async () => {
    const { conn, rec } = await played(4, 'computer', ['p1']);
    await conn.act({ type: 'concede', player: 'p2' });
    await rec.finish();
    const service = new TableService({ token: TOKEN, version: '9', loadReplay: (id) => loadReplay(ctx, id) });
    try {
      const { c, first } = await watch(service, rec.id);
      expect(first.perspective).toEqual({ key: 'seat:p1', label: 'Alice' });
      expect(first.perspectives.map((p) => p.key)).toEqual(['seat:p1', 'seat:p2', 'public', 'open']);
      expect(c.view.viewer).toBe('p1');
      c.send({ t: 'replay', table: c.table, op: 'perspective', value: 'open' });
      await c.next('replayState', (m) => m.perspective.key === 'open');
      expect(c.view.open).toBe(true);
    } finally {
      await service.close();
    }
  });
});
