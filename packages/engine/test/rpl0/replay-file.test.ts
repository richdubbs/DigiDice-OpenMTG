/**
 * RPL-0 (replays design 4, 5, 11): the replay and bug report files. A real replay (a seeded AI-against-AI game with its checkpoints and the recording of
 * one seat) is written gzipped and read back unchanged; malformed, oversized and too-deep files are refused with a typed error and never thrown on; the
 * upgrade chain brings an older format up to date and refuses a newer one.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPatch, BUG_REPORT_FORMAT, checkBugReport, checkpointsOf, checkRecordingView, checkReplay, currentEngine, diffJson, ENGINE_VIEW_SCHEMA, eventsFor, fileText, gunzipBytes, gzipBytes,
  openView, parseBoundedJson, parseReplay, PATCH_MAX_WORK, readBugReportFile, readReplayFile, RECORDING_MAX_PATCH_RUN, REPLAY_FORMAT, REPLAY_FORMAT_VERSION,
  recordingFrameView, REPLAY_LIMITS, REPLAY_UPGRADES, replayedEvents, upgradeReplay, viewFor, writeGzippedJson, type BugReportFile, type Checked, type GameView,
  type PatchOp, type RecordingFrame, type RecordingKeyView, type ReplayFile, type ReplayLimits,
} from '../../src/index';
import { aiGame, botGame, discardConfig, faceDownConfig, type PlayedGame } from './games';

const MB = 1024 * 1024;
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * A replay as RPL-1 will write one: the game, a time per action, its checkpoints, and the recording of p1 (a key view every 5th turn, patches between;
 * views without their definitions, which the recording keeps once).
 */
function replayOf(g: PlayedGame): ReplayFile {
  const viewer = 'p1';
  const frames: RecordingFrame[] = [];
  const defs: Record<string, GameView['defs'][string]> = {};
  let prev: RecordingKeyView | null = null;
  let keyTurn = -Infinity;
  g.states.forEach((s, i) => {
    const view = viewFor(s, viewer);
    Object.assign(defs, view.defs);
    const raw = i === 0 ? [] : g.events[i - 1]!.slice(replayedEvents(g.states[i - 1]!, g.actions[i - 1]!, viewer));
    const events = i === 0 ? [] : eventsFor(s, raw, viewer, { before: g.states[i - 1]! });
    const { defs: _defs, ...key } = view;
    if (prev === null || s.turn.number - keyTurn >= 5) {
      frames.push({ seq: i + 1, t: i * 1000, key, events });
      keyTurn = s.turn.number;
    } else {
      frames.push({ seq: i + 1, t: i * 1000, patch: diffJson(prev, key), events });
    }
    prev = key;
  });
  const last = g.states[g.states.length - 1]!;
  const { checkpoints } = checkpointsOf(g.config, g.actions);
  return {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind: 'game',
    id: 'r-test-0001',
    title: 'One vs Two, test decks',
    createdAt: '2026-10-21T12:00:00.000Z',
    app: { version: '0.5.0', commit: 'a7970301' },
    engine: currentEngine('0'.repeat(64)),
    game: {
      mode: 'computer', format: 'test', players: [{ id: 'p1', name: 'One', kind: 'person' }, { id: 'p2', name: 'Two', kind: 'computer' }], savedBy: 'p1',
      ended: last.result ? 'finished' : 'abandoned', result: last.result, turns: last.turn.number, actions: g.actions.length,
      startedAt: '2026-10-21T11:30:00.000Z', endedAt: '2026-10-21T12:00:00.000Z',
    },
    reveal: { policy: 'own', agreed: ['p1'] },
    play: { config: roundTrip(g.config), actions: g.actions, times: g.actions.map((_, i) => i * 1000), checkpoints },
    recording: { viewer, defs, frames },
  };
}

let base: { game: PlayedGame; file: ReplayFile } | undefined;
function fixture(): { game: PlayedGame; file: ReplayFile } {
  if (!base) {
    const game = aiGame('rpl0-file', 0, 1);
    base = { game, file: roundTrip(replayOf(game)) };
  }
  return base;
}
/** A fresh copy of the valid file, to break. */
const valid = (): ReplayFile => roundTrip(fixture().file);

function refused<T>(r: Checked<T>, code: string): { message: string; path?: string } {
  if (r.ok) throw new Error(`expected a refusal (${code}), the file was accepted`);
  expect(r.error.code, r.error.message).toBe(code);
  return r.error;
}

describe('RPL-0: replay files (replays design 4)', { timeout: 300_000 }, () => {
  it('the limits are those of design 4: 8 MB stored, 128 MB expanded, and net\'s nesting depth', () => {
    expect(REPLAY_LIMITS.maxFileBytes).toBe(8 * MB);
    expect(REPLAY_LIMITS.maxTextBytes).toBe(128 * MB);
    expect(REPLAY_LIMITS.maxDepth).toBe(256);
    expect(currentEngine(null)).toMatchObject({ build: null, stateSchema: 1, viewSchema: ENGINE_VIEW_SCHEMA });
  });

  it('a real replay is accepted, and written gzipped it reads back unchanged', async () => {
    const file = valid();
    const checked = checkReplay(file);
    expect(checked.ok, checked.ok ? '' : checked.error.message).toBe(true);
    const bytes = await writeGzippedJson(file);
    if (!bytes.ok) throw new Error(bytes.error.message);
    expect(bytes.value[0]).toBe(0x1f);
    expect(bytes.value[1]).toBe(0x8b);
    expect(bytes.value.length).toBeLessThan(JSON.stringify(file).length / 4);
    const back = await readReplayFile(bytes.value);
    if (!back.ok) throw new Error(back.error.message);
    expect(back.value).toEqual(file);
    // a plain (not gzipped) JSON file is read too
    const plain = await readReplayFile(utf8(JSON.stringify(file)));
    expect(plain.ok).toBe(true);
    // RPL-0 review: a build made outside a repository checkout has no commit (packages/client src/engine-build.ts APP)
    expect(checkReplay({ ...valid(), app: { version: '0.2.3', commit: null } }).ok).toBe(true);
    refused(checkReplay({ ...valid(), app: { version: '0.2.3', commit: '' } }), 'malformed');
  });

  it('the recording rebuilds every view of its viewer from its key views and patches', () => {
    const { game, file } = fixture();
    let view: RecordingKeyView | null = null;
    file.recording!.frames.forEach((f, i) => {
      view = f.key ? f.key : applyPatch(view!, f.patch!);
      const { defs: _d, ...want } = viewFor(game.states[i]!, 'p1');
      expect(JSON.stringify(view), `frame ${i}`).toBe(JSON.stringify(want));
    });
    expect(file.recording!.frames.filter((f) => f.key).length).toBeGreaterThan(1);
  });

  it('RPL-0 review: each frame\'s view is checked as the board reads it, a patched one too, and a frame that fails stops playback without throwing', () => {
    const { file } = fixture();
    const rec = file.recording!;
    const ctx = { viewer: rec.viewer, defs: rec.defs };
    let view: RecordingKeyView | null = null;
    for (const f of rec.frames) {
      const r = recordingFrameView(view, f, ctx);
      if (!r.ok) throw new Error(r.error.message);
      view = r.value;
    }
    // The review's file: a key view with nothing the board reads is refused, and a patch that breaks a good view is refused when it is applied.
    const empty = { viewer: 'p1', players: [{}], zones: {}, objects: {}, turn: {}, log: [] };
    refused(checkRecordingView(empty, ctx), 'malformed');
    const broken = valid();
    broken.recording!.frames[0]!.key = empty as never;
    refused(checkReplay(broken), 'malformed');
    const key = rec.frames[0]!.key!;
    for (const patch of [[{ op: 'set', path: ['zones'], value: null }], [{ op: 'set', path: ['players'], value: 7 }], [{ op: 'del', path: ['turn'] }]] as PatchOp[][]) {
      const r = recordingFrameView(key, { seq: 2, t: 0, patch, events: [] }, ctx);
      expect(r.ok, JSON.stringify(patch)).toBe(false);
    }
    expect(recordingFrameView(key, { seq: 2, t: 0, patch: [{ op: 'del', path: ['nothing'] }], events: [] }, ctx)).toMatchObject({ ok: false, error: { code: 'malformed' } });
    expect(recordingFrameView(null, { seq: 2, t: 0, patch: [], events: [] }, ctx).ok).toBe(false);
  });

  it('RPL-0 review: every view of real games passes the board\'s check, for each seat, the public view and the open view (face-down cards, discards)', () => {
    for (const g of [botGame(faceDownConfig('rpl0-view-fd'), 500), botGame(discardConfig('rpl0-view-disc'), 500)]) {
      g.states.forEach((s, i) => {
        for (const viewer of ['p1', 'p2', null, 'open'] as const) {
          const { defs, ...view } = viewer === 'open' ? openView(s) : viewFor(s, viewer);
          const r = checkRecordingView(view, { viewer: viewer === 'open' ? null : viewer, defs });
          expect(r.ok, `${g.config.seed} state ${i} ${String(viewer)}: ${r.ok ? '' : r.error.message}`).toBe(true);
        }
      });
    }
  });

  it('refuses a file over 8 MB before reading it, and one that expands past the bound (a "zip bomb") while expanding it', async () => {
    refused(await readReplayFile(new Uint8Array(8 * MB + 1)), 'tooLarge');
    const small: ReplayLimits = { ...REPLAY_LIMITS, maxTextBytes: MB };
    const bomb = await gzipBytes(new Uint8Array(4 * MB).fill(0x20));
    if (!bomb.ok) throw new Error(bomb.error.message);
    expect(bomb.value.length).toBeLessThan(64 * 1024);
    refused(await readReplayFile(bomb.value, small), 'tooLarge');
    refused(await gunzipBytes(bomb.value, MB), 'tooLarge');
    const fine = await gunzipBytes(bomb.value, 4 * MB);
    expect(fine.ok && fine.value.length).toBe(4 * MB);
  });

  it('refuses damaged compressed data, text that is not UTF-8, and text that is not JSON', async () => {
    refused(await readReplayFile(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5, 6, 7])), 'badCompression');
    const good = await writeGzippedJson(valid());
    if (!good.ok) throw new Error(good.error.message);
    refused(await readReplayFile(good.value.slice(0, good.value.length >> 1)), 'badCompression');
    refused(await readReplayFile(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])), 'badText');
    refused(await readReplayFile(utf8('{"format": "openmtg-replay", ')), 'notJson');
    refused(parseReplay('not json at all'), 'notJson');
  });

  it('refuses nesting deeper than the bound, in the text and in a parsed value, without a stack overflow', async () => {
    const deep = (n: number) => `${'['.repeat(n)}${']'.repeat(n)}`;
    refused(parseReplay(deep(300)), 'tooDeep');
    refused(parseReplay(deep(200_000)), 'tooDeep');
    refused(await readReplayFile(utf8(`{"format":"openmtg-replay","x":${deep(1000)}}`)), 'tooDeep');
    let value: unknown = 1;
    for (let i = 0; i < 100_000; i++) value = [value];
    expect(() => checkReplay(value)).not.toThrow();
    refused(checkReplay(value), 'tooDeep');
  });

  it('refuses a string longer than the bound, and too many values', () => {
    const file = valid();
    file.title = 'x'.repeat(REPLAY_LIMITS.maxString + 1);
    refused(checkReplay(file), 'stringTooLong');
    const keyed = { ...valid(), ['k'.repeat(REPLAY_LIMITS.maxString + 1)]: 1 };
    refused(checkReplay(keyed), 'stringTooLong');
    refused(checkReplay(valid(), { ...REPLAY_LIMITS, maxValues: 1000 }), 'tooLarge');
    refused(parseReplay(JSON.stringify(valid()), { ...REPLAY_LIMITS, maxTextBytes: 1000 }), 'tooLarge');
  });

  it('counts the values in the text before JSON.parse builds them, exactly as in the parsed value (RPL-0 review: a flat list exhausted the heap)', () => {
    const file = valid();
    const count = (x: unknown): number => (Array.isArray(x) ? 1 + x.reduce<number>((n, v) => n + count(v), 0)
      : typeof x === 'object' && x !== null ? 1 + Object.values(x).reduce<number>((n, v) => n + count(v), 0) : 1);
    const n = count(file);
    const text = JSON.stringify(file, null, 1); // white space between the values is not counted
    expect(parseReplay(text, { ...REPLAY_LIMITS, maxValues: n }).ok).toBe(true);
    refused(parseReplay(text, { ...REPLAY_LIMITS, maxValues: n - 1 }), 'tooLarge');
    expect(checkReplay(file, { ...REPLAY_LIMITS, maxValues: n }).ok).toBe(true);
    refused(checkReplay(file, { ...REPLAY_LIMITS, maxValues: n - 1 }), 'tooLarge');
    // Brackets and commas inside strings are text, and empty lists and objects hold no element.
    const tricky = '{"a":"[,]{,}\\\\",",":[[],{}],"b":[1,[2,{"c":null}]]}';
    const m = count(JSON.parse(tricky));
    expect(parseBoundedJson(tricky, { ...REPLAY_LIMITS, maxValues: m }).ok).toBe(true);
    refused(parseBoundedJson(tricky, { ...REPLAY_LIMITS, maxValues: m - 1 }), 'tooLarge');
  });

  it('refuses a gzipped flat list just under 128 MB (63M zeros, a file of a few hundred KB) from its text, before it is parsed', async () => {
    const n = 63_000_000;
    const bytes = new Uint8Array(2 * n); // "[0,0,...,0" with no closing bracket: not JSON, so a refusal other than notJson was made before JSON.parse
    bytes.fill(0x30);
    bytes[0] = 0x5b;
    for (let i = 2; i < bytes.length; i += 2) bytes[i] = 0x2c;
    expect(bytes.length).toBeLessThan(REPLAY_LIMITS.maxTextBytes);
    const gz = await gzipBytes(bytes);
    if (!gz.ok) throw new Error(gz.error.message);
    expect(gz.value.length).toBeLessThan(REPLAY_LIMITS.maxFileBytes);
    expect(refused(await readReplayFile(gz.value), 'tooLarge').message).toMatch(/more than 10000000 values/);
  });

  it('measures a value of any size without allocating per element: a list of 11M zeros held in memory is refused at once', () => {
    const big = new Array<number>(11_000_000).fill(0);
    const t0 = Date.now();
    refused(checkReplay(big), 'tooLarge');
    refused(checkReplay({ format: REPLAY_FORMAT, list: big }), 'tooLarge');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('refuses what is not an OpenMTG replay', () => {
    for (const x of [null, 42, 'replay', [], {}, { format: 'something-else', formatVersion: 1 }]) refused(checkReplay(x), 'notReplay');
  });

  it('design 5.1: refuses a replay of a newer format ("Update to watch it"), and a format version that is not one', () => {
    const newer = { ...valid(), formatVersion: REPLAY_FORMAT_VERSION + 1 };
    expect(refused(checkReplay(newer), 'newerFormat').message).toMatch(/newer OpenMTG.*Update to watch it/);
    for (const v of [0, -1, 1.5, '1', null]) refused(checkReplay({ ...valid(), formatVersion: v }), 'unsupportedFormat');
    const noVersion: Record<string, unknown> = valid() as unknown as Record<string, unknown>;
    delete noVersion['formatVersion'];
    refused(checkReplay(noVersion), 'unsupportedFormat');
  });

  it('refuses a malformed replay and says where', () => {
    const breaks: [string, (f: ReplayFile & Record<string, unknown>) => void, RegExp][] = [
      ['a kind that is not one', (f) => { f.kind = 'movie' as never; }, /^kind$/],
      ['a game replay without the game', (f) => { delete f.play; }, /^play$/],
      ['a recording that holds the game', (f) => { f.kind = 'recording'; }, /^play$/],
      ['an id with a slash', (f) => { f.id = 'r/../x'; }, /^id$/],
      ['a title with a terminal escape', (f) => { f.title = 'Alice \u001b[2J'; }, /^title$/],
      ['a title with a bidirectional override', (f) => { f.title = 'Bob ‮'; }, /^title$/],
      ['a player name with a control character', (f) => { f.game.players[0]!.name = 'One\u0007'; }, /^game\.players\[0\]\.name$/],
      ['a time that is no time', (f) => { f.createdAt = 'yesterday'; }, /^createdAt$/],
      ['an unknown mode', (f) => { f.game.mode = 'arcade' as never; }, /^game\.mode$/],
      ['the same player twice', (f) => { f.game.players[1]!.id = 'p1'; }, /^game\.players\[1\]\.id$/],
      ['no players', (f) => { f.game.players = []; }, /^game\.players$/],
      ['saved by someone who did not play', (f) => { f.game.savedBy = 'p7'; }, /^game\.savedBy$/],
      ['a winner who did not play', (f) => { f.game.result = { winner: 'p7', reason: 'x' }; }, /^game\.result\.winner$/],
      ['agreement of someone who did not play', (f) => { f.reveal.agreed = ['p1', 'p9']; }, /^reveal\.agreed\[1\]$/],
      ['an unknown reveal policy', (f) => { f.reveal.policy = 'some' as never; }, /^reveal\.policy$/],
      ['a config of another number of players', (f) => { f.play!.config.players.pop(); }, /^play\.config\.players$/],
      ['an action without a type', (f) => { delete (f.play!.actions[3] as unknown as Record<string, unknown>)['type']; }, /^play\.actions\[3\]\.type$/],
      ['a time per action missing', (f) => { f.play!.times.pop(); }, /^play\.times$/],
      ['a negative time', (f) => { f.play!.times[2] = -5; }, /^play\.times\[2\]$/],
      ['checkpoints out of order', (f) => { const c = f.play!.checkpoints; [c[0], c[1]] = [c[1]!, c[0]!]; }, /^play\.checkpoints\[1\]\.action$/],
      ['a checkpoint after the last action', (f) => { f.play!.checkpoints.push({ action: f.play!.actions.length, turn: 1, digest: 'd1:x' }); }, /^play\.checkpoints\[\d+\]\.action$/],
      ['a definition without a name', (f) => { const d = f.play!.config.defs as unknown as Record<string, unknown>[]; delete d[0]!['name']; }, /^play\.config\.defs\[0\]\.name$/],
      ['a recording that starts with a patch', (f) => { const fr = f.recording!.frames[0]!; delete fr.key; fr.patch = []; }, /^recording\.frames\[0\]$/],
      ['a frame with a key view and a patch', (f) => { f.recording!.frames[1]!.key = f.recording!.frames[0]!.key!; }, /^recording\.frames\[1\]$/],
      ['frames out of order', (f) => { f.recording!.frames[2]!.seq = 1; }, /^recording\.frames\[2\]\.seq$/],
      ['a key view of another viewer', (f) => { (f.recording!.frames[0]!.key as { viewer: string | null }).viewer = 'p2'; }, /^recording\.frames\[0\]\.key\.viewer$/],
      ['a key view without its objects', (f) => { delete (f.recording!.frames[0]!.key as unknown as Record<string, unknown>)['objects']; }, /^recording\.frames\[0\]\.key\.objects$/],
      // RPL-0 review: every part the board reads without looking first.
      ['a key view without the hands', (f) => { delete (f.recording!.frames[0]!.key!.zones as Record<string, unknown>)['hand']; }, /^recording\.frames\[0\]\.key\.zones\.hand$/],
      ['a key view without a seat\'s library', (f) => { delete (f.recording!.frames[0]!.key!.zones.library as Record<string, unknown>)['p2']; }, /^recording\.frames\[0\]\.key\.zones\.library\.p2$/],
      ['a battlefield that is not a list', (f) => { (f.recording!.frames[0]!.key!.zones as Record<string, unknown>)['battlefield'] = 7; }, /^recording\.frames\[0\]\.key\.zones\.battlefield$/],
      ['a zone naming an object the view does not have', (f) => { f.recording!.frames[0]!.key!.zones.exile = ['o-nowhere']; }, /^recording\.frames\[0\]\.key\.zones\.exile\[0\]$/],
      ['a player without life', (f) => { delete (f.recording!.frames[0]!.key!.players[0] as unknown as Record<string, unknown>)['life']; }, /^recording\.frames\[0\]\.key\.players\[0\]\.life$/],
      ['a turn without its step', (f) => { delete (f.recording!.frames[0]!.key!.turn as unknown as Record<string, unknown>)['step']; }, /^recording\.frames\[0\]\.key\.turn\.step$/],
      ['an object of a definition the recording does not hold', (f) => {
        const objects = f.recording!.frames[0]!.key!.objects;
        const id = Object.keys(objects)[0]!;
        objects[id] = { ...objects[id]!, defId: 'Nothing Like It' };
      }, /^recording\.frames\[0\]\.key\.objects\..+\.defId$/],
      ['an unknown patch operation', (f) => { f.recording!.frames[1]!.patch = [{ op: 'eval', path: [] } as never]; }, /^recording\.frames\[1\]\.patch\[0\]\.op$/],
      ['an event without a type', (f) => { f.recording!.frames[1]!.events = [{} as never]; }, /^recording\.frames\[1\]\.events\[0\]\.type$/],
      ['a definition under another id', (f) => { const d = f.recording!.defs; const k = Object.keys(d)[0]!; d[k] = { ...d[k]!, id: 'other' }; }, /^recording\.defs\..+\.id$/],
      ['a recording viewer who did not play', (f) => { f.recording!.viewer = 'p5'; }, /^recording\.viewer$/],
      // RPL-0 review: going to a frame applies at most RECORDING_MAX_PATCH_RUN patches, and a patch has fewer ops than its work bound.
      ['too many patches in a row', (f) => {
        const fr = f.recording!.frames;
        const last = fr[fr.length - 1]!;
        for (let i = 1; i <= RECORDING_MAX_PATCH_RUN + 1; i++) fr.push({ seq: last.seq + i, t: last.t, patch: [], events: [] });
      }, /^recording\.frames\[\d+\]$/],
      ['a patch of more ops than any patch may cost', (f) => { f.recording!.frames[1]!.patch = new Array<PatchOp>(PATCH_MAX_WORK + 1).fill({ op: 'del', path: ['x'] }); }, /^recording\.frames\[1\]\.patch$/],
    ];
    for (const [what, br, path] of breaks) {
      const f = valid() as ReplayFile & Record<string, unknown>;
      br(f);
      const r = checkReplay(f);
      expect(r.ok, what).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, what).toBe('malformed');
      expect(r.error.path, `${what}: ${r.error.message}`).toMatch(path);
    }
  });

  it('never throws on randomly damaged replays (every result is accepted or a typed refusal)', () => {
    const pick = (seed: number, n: number) => (Math.imul(seed, 2654435761) >>> 0) % n;
    const junk: unknown[] = [null, -1, 1e308, '', 'x', [], {}, [null], { op: 'set' }, true, '\u0000', { __proto__: { evil: 1 } }];
    const paths = (x: unknown, prefix: (string | number)[] = [], out: (string | number)[][] = [], depth = 0): (string | number)[][] => {
      if (depth > 6 || out.length > 4000 || typeof x !== 'object' || x === null) return out;
      for (const [k, v] of Object.entries(x)) {
        const p = [...prefix, Array.isArray(x) ? Number(k) : k];
        out.push(p);
        paths(v, p, out, depth + 1);
      }
      return out;
    };
    const all = paths(valid());
    let refusedCount = 0;
    for (let i = 0; i < 400; i++) {
      const f = valid() as unknown as Record<string | number, unknown>;
      const p = all[pick(i + 1, all.length)]!;
      let parent: Record<string | number, unknown> = f;
      for (const seg of p.slice(0, -1)) parent = parent[seg] as Record<string | number, unknown>;
      const last = p[p.length - 1]!;
      if (i % 3 === 0) delete parent[last];
      else parent[last] = junk[pick(i + 7, junk.length)];
      let r: Checked<ReplayFile>;
      try {
        r = checkReplay(f);
      } catch (e) {
        throw new Error(`checkReplay threw on a break at ${JSON.stringify(p)}: ${String(e)}`);
      }
      if (!r.ok) refusedCount++;
    }
    expect(refusedCount).toBeGreaterThan(50); // many breaks fall in engine data the engine itself checks as it runs (CR 733)
  });
});

describe('RPL-0: the upgrade chain (replays design 5.1)', () => {
  const v1 = () => ({ format: REPLAY_FORMAT, formatVersion: 1, title: 'old', seen: [] as number[] });
  const chain = {
    1: (f: Record<string, unknown>) => ({ ...f, formatVersion: 2, seen: [...(f['seen'] as number[]), 1], renamed: f['title'] }),
    2: (f: Record<string, unknown>) => ({ ...f, formatVersion: 3, seen: [...(f['seen'] as number[]), 2] }),
  };

  it('formatVersion 1 is the first: there are no upgrade functions yet, and a version 1 file is read as it is', () => {
    expect(REPLAY_FORMAT_VERSION).toBe(1);
    expect(Object.keys(REPLAY_UPGRADES)).toEqual([]);
    const f = v1();
    expect(upgradeReplay(f)).toEqual({ ok: true, value: f });
  });

  it('brings an older file to the current format, one step at a time and in order (upgrade1to2, then upgrade2to3)', () => {
    const r = upgradeReplay(v1(), chain, 3);
    expect(r).toEqual({ ok: true, value: { format: REPLAY_FORMAT, formatVersion: 3, title: 'old', renamed: 'old', seen: [1, 2] } });
    const from2 = upgradeReplay({ ...v1(), formatVersion: 2 }, chain, 3);
    expect(from2.ok && from2.value['seen']).toEqual([2]);
  });

  it('refuses a newer file, a missing step, a step that throws and a step that does not give the next version, without throwing', () => {
    refused(upgradeReplay({ ...v1(), formatVersion: 4 }, chain, 3), 'newerFormat');
    refused(upgradeReplay(v1(), { 2: chain[2] }, 3), 'unsupportedFormat');
    expect(refused(upgradeReplay(v1(), { 1: () => { throw new Error('no title'); } }, 2), 'malformed').message).toMatch(/no title/);
    refused(upgradeReplay(v1(), { 1: (f) => ({ ...f, formatVersion: 3 }) }, 2), 'malformed');
    refused(upgradeReplay(v1(), { 1: () => null as never }, 2), 'malformed');
  });
});

describe('RPL-0: bug report files (replays design 11)', { timeout: 300_000 }, () => {
  const report = (): BugReportFile => ({
    format: BUG_REPORT_FORMAT, formatVersion: 1, replay: valid(), at: { action: 12 }, words: 'The bear did not die.', card: 'Grizzly Bears',
    app: { version: '0.5.0', commit: 'a7970301' }, browser: { userAgent: 'Test/1.0', language: 'en' }, settings: { animationSpeed: 'normal', sounds: true },
    errors: [{ message: 'TypeError: x is undefined', time: '2026-10-21T12:00:01.000Z' }],
  });

  it('a report with its replay is accepted, and written gzipped it reads back unchanged', async () => {
    const r = report();
    expect(checkBugReport(r).ok).toBe(true);
    const bytes = await writeGzippedJson(r);
    if (!bytes.ok) throw new Error(bytes.error.message);
    const back = await readBugReportFile(bytes.value);
    if (!back.ok) throw new Error(back.error.message);
    expect(back.value).toEqual(r);
    const text = await fileText(bytes.value);
    expect(text.ok && JSON.parse(text.value)).toEqual(r);
  });

  it('refuses a malformed report, and a report whose replay is malformed (the path says so)', () => {
    const notReport = { ...report(), format: REPLAY_FORMAT };
    refused(checkBugReport(notReport), 'notReplay');
    refused(checkBugReport({ ...report(), formatVersion: 2 }), 'newerFormat');
    const settings = { ...report(), settings: { nested: { a: 1 } } } as unknown;
    expect(refused(checkBugReport(settings), 'malformed').path).toBe('settings.nested');
    const at = { ...report(), at: { action: -1 } };
    expect(refused(checkBugReport(at), 'malformed').path).toBe('at.action');
    const inner = report();
    inner.replay.title = 'bad\u0000';
    expect(refused(checkBugReport(inner), 'malformed').path).toBe('replay.title');
    const noReplay = { ...report(), replay: { format: 'x' } };
    expect(refused(checkBugReport(noReplay), 'notReplay').path).toBe('replay');
  });
});
