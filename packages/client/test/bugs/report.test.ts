/**
 * RPL-4 (replays design 11, 6): the bug report container. A report is RPL-0's `BugReportFile` and nothing else: the replay (a local game's so far, the
 * replay being watched, or what the screen shows), the moment, the reporter's words and card, the app, the browser, the settings and the caught errors.
 * It round-trips through the saved file; what cannot be a report is refused without throwing; and a report of seat p (what an online player's report
 * carries) holds nothing `viewFor(…, p)` does not (the M6-3 property search, CR 400.2).
 */
import {
  BUG_REPORT_FORMAT, HIDDEN_DEF, applyAction, checkReplay, createGame, eventsFor, readBugReportFile, replayedEvents, viewFor, type Action, type BugReportFile,
  type GameConfig, type GameEvent, type GameState, type PlayerId, type ReplayFile,
} from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureReport, reportContent } from '../../src/bugs/capture';
import { pageEnvironment } from '../../src/bugs/environment';
import { clearErrorTrail, ERROR_MESSAGE_MAX, ERROR_TRAIL_SIZE, installErrorTrail, recentErrors, recordError } from '../../src/bugs/errors';
import { bugReport, bugReportFileName, CARD_MAX, encodeBugReport, momentOf, seatReplay, WORDS_MAX, type ReportContent } from '../../src/bugs/report';
import type { GameConnection } from '../../src/connection/GameConnection';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { sealConnection } from '../../src/game/sealed';
import { openReplay } from '../../src/replays/openReplay';
import { registerLiveReplay } from '../../src/replays/live';
import { recordLocalGame } from '../../src/replays/record';
import { replayControllerOf } from '../../src/replays/viewer/controllerOf';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { botGame, faceDownConfig } from '../../../engine/test/rpl0/games';
import { withCompleted } from '../../src/replays/fallback';
import { duel, inlineCompleter, playUntil, settle, testClock, testEnv } from '../replays/helpers';
import { FIXED_ENV, recordedDuel } from './helpers';

const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;

/** A hot-seat duel recorded by recordLocalGame (as the New game screen records it), played by the AI for `moves` actions. */
async function recordedGame(seed: string, moves: number) {
  const clock = testClock();
  const env = testEnv({ now: clock.now });
  const conn = recordLocalGame(new LocalConnection(duel(seed)), { format: 'casual' }, env);
  await playUntil(conn, () => conn.session.actions.length >= moves, 3000, () => clock.advance(1000));
  await settle();
  return { conn, sealed: sealConnection(conn), env, clock };
}

function made(c: ReportContent, words = 'It did something wrong.', card: string | null = null): BugReportFile {
  const r = bugReport(c, { words, card }, FIXED_ENV);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

afterEach(() => clearErrorTrail());

describe('RPL-4: a report holds the replay, the moment, the words, the app, the browser, the settings and the errors, nothing else (design 11)', () => {
  it('a local game\'s report carries the game so far (config, log, times, checkpoints), at its last action, and round-trips through the saved file', async () => {
    const { conn, sealed } = await recordedGame('rpl4-trip', 24);
    const capture = captureReport(sealed);
    expect(capture.holds).toBe('game');
    expect(capture.kind).toBe('game');
    expect(capture.at).toBe(conn.session.actions.length - 1);
    expect(capture.length).toBe(conn.session.actions.length);
    const r = capture.report({ words: 'The bear survived.\nIt had 2 damage.', card: 'Test Bear' }, FIXED_ENV);
    if (!r.ok) throw new Error(r.error.message);
    const report = r.value;
    expect(Object.keys(report).sort()).toEqual(['app', 'at', 'browser', 'card', 'errors', 'format', 'formatVersion', 'replay', 'settings', 'words']);
    expect(report.format).toBe(BUG_REPORT_FORMAT);
    expect(report.at).toEqual({ action: conn.session.actions.length - 1 });
    expect(report.words).toBe('The bear survived.\nIt had 2 damage.');
    expect(report.card).toBe('Test Bear');
    expect(report.app).toEqual(FIXED_ENV.app);
    expect(report.browser).toEqual(FIXED_ENV.browser);
    expect(report.settings).toEqual(FIXED_ENV.settings);
    expect(report.errors).toEqual(FIXED_ENV.errors);
    // the game so far: the config and the log as played, a time per action, the last action's checkpoint; an unfinished game
    const play = report.replay.play!;
    expect(report.replay.kind).toBe('game');
    expect(play.config).toEqual(json(conn.session.config));
    expect(play.actions).toEqual(json(conn.session.actions));
    expect(play.times).toHaveLength(play.actions.length);
    expect(play.checkpoints[play.checkpoints.length - 1]!.action).toBe(play.actions.length - 1);
    expect(report.replay.game).toMatchObject({ mode: 'hotseat', ended: 'abandoned', result: null, actions: play.actions.length, savedBy: null });
    expect(report.replay.reveal).toEqual({ policy: 'own', agreed: [] });
    expect(checkReplay(report.replay).ok).toBe(true);
    // saved, read back: the same report
    const bytes = await encodeBugReport(report);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const back = await readBugReportFile(bytes);
    if (!back.ok) throw new Error(back.error.message);
    expect(back.value).toEqual(report);
    expect(bugReportFileName(new Date(2026, 9, 22, 15, 3))).toBe('openmtg-bug-2026-10-22-1503.openmtg-bug-report');
  });

  it('the moment is taken when the report is asked for: the game going on does not change it', async () => {
    const { conn, sealed } = await recordedGame('rpl4-moment', 12);
    const capture = captureReport(sealed);
    const n = conn.session.actions.length;
    await playUntil(conn, () => conn.session.actions.length >= n + 8);
    expect(conn.session.actions.length).toBeGreaterThan(n);
    const report = capture.report({ words: 'x' }, FIXED_ENV);
    expect(report.ok && report.value.replay.play!.actions.length).toBe(n);
    expect(report.ok && report.value.at.action).toBe(n - 1);
  });

  it('a finished local game\'s report says how it ended', async () => {
    const env = testEnv();
    const conn = recordLocalGame(new LocalConnection(duel('rpl4-ended', 4)), { format: 'casual' }, env);
    await playUntil(conn, () => conn.session.state.result !== null);
    await settle();
    const c = reportContent(sealConnection(conn));
    expect(c.holds).toBe('game');
    expect(c.replay.game.ended).not.toBe('abandoned');
    expect(c.replay.game.result).toEqual({ winner: conn.session.state.result!.winner, reason: conn.session.state.result!.reason });
  });

  it('the capture the dialog keeps holds no game: only facts and a function (FXH, CR 400.2)', async () => {
    const { sealed } = await recordedGame('rpl4-sealed', 6);
    const capture = captureReport(sealed);
    expect(Object.isFrozen(capture)).toBe(true);
    expect(Object.keys(capture).sort()).toEqual(['at', 'holds', 'kind', 'length', 'report']);
    expect(Object.values(capture).filter((v) => typeof v === 'object')).toEqual([]);
  });

  it('words and card are kept within the validator\'s bounds; a card is a shown name (no control characters); no card, no field', () => {
    const replay = seatReplay({
      view: viewFor(createGame(duel('rpl4-bounds')), 'p1'), events: [], changes: 0, mode: 'onlineGuest', format: '', id: 'r-bounds', now: '2026-10-22T12:00:00.000Z',
      app: FIXED_ENV.app, engine: { build: null, compiler: 'c', model: 4, stateSchema: 1, viewSchema: 1 },
    });
    const c: ReportContent = { replay, at: 0, holds: 'view' };
    const long = made(c, 'w'.repeat(WORDS_MAX + 50), `  Grizzly\u001b[2J Bears${'s'.repeat(CARD_MAX)}  `);
    expect(long.words).toHaveLength(WORDS_MAX);
    expect(long.card!.startsWith('Grizzly[2J Bears')).toBe(true);
    expect(long.card!.length).toBeLessThanOrEqual(CARD_MAX);
    expect('card' in made(c, 'w', '   ')).toBe(false);
    expect('card' in made(c, 'w', null)).toBe(false);
  });
});

describe('RPL-4: what cannot be a report is refused, never thrown (design 4)', () => {
  const content = (): ReportContent => ({
    replay: seatReplay({
      view: viewFor(createGame(duel('rpl4-refuse')), 'p1'), events: [], changes: 0, mode: 'onlineGuest', format: '', id: 'r-refuse', now: '2026-10-22T12:00:00.000Z',
      app: FIXED_ENV.app, engine: { build: null, compiler: 'c', model: 4, stateSchema: 1, viewSchema: 1 },
    }),
    at: 0,
    holds: 'view',
  });

  it('settings that are not plain values, a browser over its bounds, a replay that cannot be written: refused with the reason', () => {
    const nested = bugReport(content(), { words: 'x' }, { ...FIXED_ENV, settings: { layout: { a: 1 } as never } });
    expect(nested).toMatchObject({ ok: false, error: { code: 'malformed', path: 'settings.layout' } });
    const browser = bugReport(content(), { words: 'x' }, { ...FIXED_ENV, browser: { userAgent: 'x', language: '' } });
    expect(browser).toMatchObject({ ok: false, error: { code: 'malformed', path: 'browser.language' } });
    const cyclic = content();
    (cyclic.replay as unknown as Record<string, unknown>)['self'] = cyclic.replay;
    let r: ReturnType<typeof bugReport> | undefined;
    expect(() => (r = bugReport(cyclic, { words: 'x' }, FIXED_ENV))).not.toThrow();
    expect(r).toMatchObject({ ok: false, error: { code: 'malformed' } });
    const badTime = bugReport(content(), { words: 'x' }, { ...FIXED_ENV, errors: [{ message: 'x', time: 'yesterday' }] });
    expect(badTime).toMatchObject({ ok: false, error: { code: 'malformed', path: 'errors[0].time' } });
  });

  it('a saved file that is damaged, oversized or not a report is refused when it is read', async () => {
    const bytes = await encodeBugReport(made(content()));
    for (const [b, code] of [
      [bytes.slice(0, bytes.length >> 1), 'badCompression'],
      [new Uint8Array(8 * 1024 * 1024 + 1), 'tooLarge'],
      [new TextEncoder().encode('{"format":"openmtg-replay"}'), 'notReplay'],
      [new TextEncoder().encode('[[[[[['.repeat(100)), 'tooDeep'],
    ] as const) {
      const r = await readBugReportFile(b);
      expect(r.ok, code).toBe(false);
      expect(!r.ok && r.error.code).toBe(code);
    }
  });
});

/** Every string in a JSON value (keys and values). */
function strings(x: unknown, out = new Set<string>()): Set<string> {
  if (typeof x === 'string') out.add(x);
  else if (Array.isArray(x)) for (const v of x) strings(v, out);
  else if (x !== null && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      out.add(k);
      strings(v, out);
    }
  }
  return out;
}

/** A game with every state and every action's events. */
function played(config: GameConfig, actions: readonly Action[]): { states: GameState[]; events: GameEvent[][] } {
  let s = createGame(config);
  const states = [s];
  const events: GameEvent[][] = [];
  for (const a of actions) {
    const r = applyAction(s, a);
    if (r.error) throw new Error(r.error.message);
    s = r.state;
    states.push(s);
    events.push(r.events);
  }
  return { states, events };
}

/**
 * The property: the report of seat p at state i holds exactly p's view there and the events p was shown, its strings are strings of those, it holds no
 * seed, no config and no log, and every card p cannot see is a hidden card in it.
 */
function checkSeatReport(s: GameState, before: GameState | null, raw: readonly GameEvent[], action: Action | null, p: PlayerId, where: string): void {
  const view = viewFor(s, p);
  const shownEvents = before && action ? eventsFor(s, raw.slice(replayedEvents(before, action, p)), p, { before }) : [];
  const replay = seatReplay({ view, events: shownEvents, changes: 7, mode: 'onlineGuest', format: 'casual', id: 'r-seat', now: '2026-10-22T12:00:00.000Z', app: FIXED_ENV.app, engine: { build: null, compiler: 'c', model: 4, stateSchema: 1, viewSchema: 1 } });
  const report = made({ replay, at: 0, holds: 'view' }, 'What I saw.', null);
  const fail = (what: string): never => {
    throw new Error(`${where}, seat ${p}: ${what}`);
  };
  const r = report.replay;
  if (r.kind !== 'recording' || r.play !== undefined) fail('the report holds the game');
  if (strings(report).has('seed') || JSON.stringify(report).includes(s.seed)) fail('the report holds the seed');
  const rec = r.recording!;
  if (rec.viewer !== p) fail(`the recording is of ${String(rec.viewer)}`);
  const { defs, ...key } = view;
  expect(rec.frames).toHaveLength(1);
  expect(rec.frames[0]!.key, where).toEqual(json(key));
  expect(rec.frames[0]!.events, where).toEqual(json(shownEvents));
  for (const [id, d] of Object.entries(rec.defs)) if (JSON.stringify(d) !== JSON.stringify(defs[id])) fail(`the definition ${id} is not one of the view's`);
  // Every string of the game part (the recording's definitions, view and events, the seats) is a string of the view or its events.
  const seen = strings(json(view));
  strings(json(shownEvents), seen);
  const part = [rec.defs, rec.frames[0]!.key, rec.frames[0]!.events, r.game.players.map((pl) => [pl.id, pl.name])];
  for (const x of strings(part)) if (!seen.has(x)) fail(`"${x.slice(0, 80)}" is not in the view`);
  // A card p cannot see (another player's hand, a library, a face-down card of another player) is a hidden or face-down card in the report.
  const objects = rec.frames[0]!.key!.objects;
  for (const [id, o] of Object.entries(s.objects)) {
    const shown = view.objects[id];
    if (shown && shown.defId !== HIDDEN_DEF && shown.defId === o.defId) continue;
    const inReport = objects[id];
    if (inReport && inReport.defId === o.defId && o.defId !== HIDDEN_DEF) fail(`${id} (${s.defs[o.defId]?.name}) is named, which ${p} cannot see`);
    if (o.cardId !== undefined && (shown?.cardId ?? null) !== o.cardId && JSON.stringify(rec).includes(`"${o.cardId}"`)) fail(`the card id of ${id} is in the report`);
  }
}

describe('RPL-4: a report of seat p holds nothing viewFor(…, p) does not (design 6, 11; CR 400.2)', { timeout: 300_000 }, () => {
  it('an online player\'s report carries the view on the screen: the capture of a remote connection is that view', async () => {
    const local = new LocalConnection(duel('rpl4-remote'));
    await playUntil(local, () => local.session.actions.length >= 20);
    local.acceptHandoff();
    const remote: GameConnection = { ...local, kind: 'remote', handoff: () => null, acceptHandoff: () => {}, canUndo: () => false, undo: () => false };
    delete (remote as { seated?: unknown }).seated;
    const c = reportContent(remote, { online: { role: 'guest', format: 'standard' } });
    expect(c.holds).toBe('view');
    expect(c.replay.kind).toBe('recording');
    expect(c.replay.play).toBeUndefined();
    expect(c.replay.game).toMatchObject({ mode: 'onlineGuest', format: 'standard', savedBy: local.view().viewer });
    expect(c.replay.game.players.every((pl) => pl.kind === 'person')).toBe(true);
    const { defs: _defs, ...key } = local.view();
    expect(c.replay.recording!.frames[0]!.key).toEqual(key);
    expect(c.replay.recording!.frames[0]!.events).toEqual(local.events().events);
    const host = reportContent(remote, { online: { role: 'host' } });
    expect(host.replay.game.mode).toBe('onlineHost');
    expect(checkReplay(json(c.replay)).ok).toBe(true);
  });

  it('an online game with its replay so far registered: its recording; the game itself only when every person agreed (roadmap)', async () => {
    const { recorder } = await recordedDuel('rpl4-online-live', 16);
    const game = recorder.live.soFar!();
    const local = new LocalConnection(duel('rpl4-online-live'));
    const remote: GameConnection = { ...local, kind: 'remote', handoff: () => null, acceptHandoff: () => {}, canUndo: () => false, undo: () => false };
    const recording = seatReplay({
      view: viewFor(local.session.state, 'p1'), events: [], changes: 0, mode: 'onlineGuest', format: '', id: 'r-guest', now: '2026-10-22T12:00:00.000Z',
      app: FIXED_ENV.app, engine: game.engine,
    });
    const live = (file: typeof game) => ({ ...recorder.live, soFar: () => file });
    registerLiveReplay([remote], live(recording));
    expect(reportContent(remote)).toMatchObject({ holds: 'recording', at: 0, replay: recording });
    // the host's game, its reveal policy 'own': not in an online report, which falls back to the view on screen
    registerLiveReplay([remote], live(game));
    expect(reportContent(remote).holds).toBe('view');
    expect(reportContent(remote).replay.play).toBeUndefined();
    // once every person agreed
    registerLiveReplay([remote], live({ ...game, reveal: { policy: 'all', agreed: ['p1', 'p2'] } }));
    expect(reportContent(remote)).toMatchObject({ holds: 'game', at: game.play!.actions.length - 1 });
  });

  it('the property, at every few actions of a duel and of face-down games (morph, manifest, cloak, Clone), for each seat', () => {
    const games: { config: GameConfig; actions: readonly Action[]; name: string }[] = [];
    for (const seed of ['rpl4-prop-fd-1', 'rpl4-prop-fd-2']) {
      const g = botGame(faceDownConfig(seed), 260);
      games.push({ config: g.config, actions: g.actions, name: seed });
    }
    let checks = 0;
    let hiddenHands = 0;
    for (const g of games) {
      const { states, events } = played(g.config, g.actions);
      for (let i = 0; i < states.length; i += 5) {
        const s = states[i]!;
        for (const p of ['p1', 'p2'] as PlayerId[]) {
          checkSeatReport(s, i > 0 ? states[i - 1]! : null, i > 0 ? events[i - 1]! : [], i > 0 ? g.actions[i - 1]! : null, p, `${g.name} state ${i}`);
          checks++;
          const other = p === 'p1' ? 'p2' : 'p1';
          if ((s.zones.hand[other]?.length ?? 0) > 0) hiddenHands++;
        }
      }
    }
    expect(checks).toBeGreaterThan(100);
    expect(hiddenHands).toBeGreaterThan(50); // the other player held cards the seat could not see
  });

  it('the same for a hot-seat duel played by the AI, through the seat each player is shown', async () => {
    const { conn } = await recordedDuel('rpl4-prop-duel', 60);
    const { states, events } = played(conn.session.config, conn.session.actions);
    for (let i = 1; i < states.length; i += 3) {
      for (const p of ['p1', 'p2'] as PlayerId[]) checkSeatReport(states[i]!, states[i - 1]!, events[i - 1]!, conn.session.actions[i - 1]!, p, `duel state ${i}`);
    }
  });
});

describe('RPL-4: a report made while watching a replay carries that replay and the position on screen', { timeout: 120_000 }, () => {
  it('the replay as the player has it, at the last action applied on screen (0 at the start); a recording at its frame', async () => {
    const { recorder } = await recordedDuel('rpl4-watched', 20);
    const file = json(recorder.live.soFar!()) as ReturnType<NonNullable<typeof recorder.live.soFar>>;
    const opened = await openReplay(file, { engineBuild: 'test-engine-build', sliceMs: 40 });
    const connection = opened.connection!;
    const controller = replayControllerOf(connection)!;
    await controller.ready();
    for (const form of [connection, sealConnection(connection)]) {
      controller.seek(0);
      expect(reportContent(form)).toMatchObject({ holds: 'replay', at: 0 });
      expect(reportContent(form).replay).toBe(file);
      controller.seek(7);
      expect(reportContent(form).at).toBe(6);
    }
    controller.dispose();
    expect(momentOf(file, 0)).toBe(0);
    expect(momentOf(file, 1)).toBe(0);
    expect(momentOf(file, 12)).toBe(11);
    expect(momentOf(file, 10_000)).toBe(file.play!.actions.length - 1);
    expect(momentOf({ ...file, kind: 'recording', play: undefined, recording: { viewer: null, defs: {}, frames: [{ seq: 0, t: 0, events: [] }, { seq: 1, t: 1, events: [] }] } } as never, 1)).toBe(1);
  });

  it('RPL-3: the replay of an online game not every person agreed to show: only what the saver\'s seat was shown up to the position, never the file', async () => {
    const { recorder } = await recordedDuel('rpl3-watched-host', 20);
    const local = json(recorder.live.soFar!()) as ReplayFile;
    // The host's file of an online game (its server ran the game, so it holds the guest's cards); the guest did not agree.
    const host: ReplayFile = { ...local, game: { ...local.game, mode: 'onlineHost', savedBy: 'p1' }, reveal: { policy: 'own', agreed: ['p1'] } };
    const seed = host.play!.config.seed;
    const watch = async (file: ReplayFile, at: number) => {
      const connection = (await openReplay(file, { engineBuild: file.engine.build, sliceMs: 40 })).connection!;
      const controller = replayControllerOf(connection)!;
      await controller.ready();
      controller.seek(at);
      const content = reportContent(sealConnection(connection));
      controller.dispose();
      return content;
    };
    // Without a fallback recording: the view on screen (the host's seat, the replay's default perspective).
    const view = await watch(host, 7);
    expect(view.holds).toBe('view');
    expect(view.replay).toMatchObject({ kind: 'recording', game: { mode: 'onlineHost', savedBy: 'p1' }, recording: { viewer: 'p1' } });
    expect(view.replay.play).toBeUndefined();
    expect(JSON.stringify(view.replay).includes(seed)).toBe(false);
    // With its fallback recording (the worker's, of the saver's seat): its frames up to the position.
    const done = (await inlineCompleter(host, host.engine.build))!;
    const completed = withCompleted(host, done);
    expect(completed.recording?.viewer).toBe('p1');
    const seat = await watch(completed, 7);
    expect(seat.holds).toBe('recording');
    expect(seat.replay.play).toBeUndefined();
    expect(seat.replay.recording!.viewer).toBe('p1');
    expect(seat.replay.recording!.frames.map((f) => f.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(seat.at).toBe(7);
    expect(JSON.stringify(seat.replay).includes(seed)).toBe(false);
    expect(checkReplay(json(made(seat).replay)).ok).toBe(true);
    // With every person's agreement the report carries the file as the player has it.
    const all: ReplayFile = { ...completed, reveal: { policy: 'all', agreed: ['p1', 'p2'] } };
    const whole = await watch(all, 7);
    expect(whole).toMatchObject({ holds: 'replay', at: 6 });
    expect(whole.replay).toBe(all);
  });
});

describe('RPL-4: the errors the page caught, kept for a report (roadmap: recent client errors)', () => {
  it('keeps console.error calls, uncaught errors and unhandled rejections, the newest only, each within its bound; console.error still prints', () => {
    const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = installErrorTrail(window);
    try {
      console.error('[LocalConnection] engine error', { type: 'pass', player: 'p1' }, new Error('no such object o12'));
      expect(printed).toHaveBeenCalledTimes(1);
      const [first] = recentErrors();
      expect(first!.message).toBe('[LocalConnection] engine error {"type":"pass","player":"p1"} Error: no such object o12');
      expect(first!.stack).toMatch(/no such object o12/);
      expect(first!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new TypeError('x is undefined') }));
      expect(recentErrors()[1]!.message).toBe('TypeError: x is undefined');
      const rejection = new Event('unhandledrejection') as Event & { reason: unknown };
      rejection.reason = new Error('lost');
      window.dispatchEvent(rejection);
      expect(recentErrors()[2]!.message).toBe('Unhandled rejection: Error: lost');
      for (let i = 0; i < ERROR_TRAIL_SIZE + 5; i++) recordError(`e${i} ${'x'.repeat(ERROR_MESSAGE_MAX)}`);
      expect(recentErrors()).toHaveLength(ERROR_TRAIL_SIZE);
      expect(recentErrors()[0]!.message.startsWith('e5 ')).toBe(true);
      expect(recentErrors().every((e) => e.message.length <= ERROR_MESSAGE_MAX)).toBe(true);
    } finally {
      stop();
      printed.mockRestore();
    }
    expect(installErrorTrail(window)).not.toBe(stop); // installed again once stopped
  });

  it('the page environment holds the app, the browser, the settings as plain values and the errors, and nothing personal', () => {
    recordError('caught');
    const env = pageEnvironment({ ...DEFAULT_SETTINGS, playerNames: ['Alice Secret', 'B', 'C', 'D'] }, window);
    expect(env.app).toEqual({ version: '0.0.0-test', commit: 'testcommit' });
    expect(env.browser.userAgent).toBe(navigator.userAgent);
    expect(env.browser.screen).toMatch(/^window \d+x\d+, screen \d+x\d+, [\d.]+x$/);
    expect(env.settings).toMatchObject({ animationSpeed: 'normal', tableLayout: 'shared', fullControl: false, sound: true });
    expect(Object.values(env.settings).every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))).toBe(true);
    expect(JSON.stringify(env)).not.toContain('Alice Secret');
    expect(env.errors.map((e) => e.message)).toEqual(['caught']);
  });
});
