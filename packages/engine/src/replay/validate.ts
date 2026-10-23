/**
 * RPL-0 (replays design 4, 5, 11): the validators of the replay and bug report files. A file is refused, never thrown on, when it is too large, nested
 * too deeply, has a string that is too long, is not JSON, is not an OpenMTG file, is of a newer format, or does not have the format's shape. The checks
 * run in this order: the bounds on the text before it is parsed (bounded.ts), JSON.parse, the bounds on the parsed value, the upgrade chain
 * (upgrade.ts), then the shape of the current format.
 *
 * The shape check covers the file's own fields fully (ids, names, the reveal policy, the seats, the checkpoints, the frames) and the engine's data as
 * far as the engine and the board read it without looking first: a config with a seed, players with decks, and card definitions with their faces; every
 * action as packages/net checks a guest's (core/action-shape.ts); views with every part the board reads (`checkRecordingView`). What the engine decides
 * as it runs the game is left to it: whether an action is legal (an illegal one is rejected, never half-applied, CR 733), and whether it can build the
 * config. A file that passes can still hold a game the engine cannot run (a config it refuses, abilities it cannot carry out, another build's log), so
 * the game is run through `startReplay` and `replayAction` (checkpoints.ts), which report anything the engine throws as a rejection, never throw.
 * Nothing in a file is ever run as code, and its text is shown as text.
 *
 * Browser-safe: no Node modules.
 */
import { measureValue, REPLAY_LIMITS, scanJsonText, type ReplayLimits } from './bounded';
import { refuse, type Checked, type ReplayError } from './errors';
import { actionShapeProblem } from '../core/action-shape';
import { hasControl } from '../util/shown-text';
import {
  BUG_REPORT_FORMAT, RECORDING_MAX_PATCH_RUN, REPLAY_FORMAT, type BugReportFile, type RecordingFrame, type RecordingKeyView, type ReplayFile,
} from './format';
import { HIDDEN_DEF } from '../core/view';
import { applyPatch, PATCH_MAX_WORK } from '../core/view-patch';
import { upgradeBugReport, upgradeReplay, type JsonRecord } from './upgrade';

const MODES = new Set(['hotseat', 'computer', 'onlineHost', 'onlineGuest', 'hosted']);
const ENDS = new Set(['finished', 'conceded', 'abandoned']);
const PATCH_OPS = new Set(['set', 'del', 'splice', 'keys']);
/** An id of the file itself (the library's key) or of a player: letters, digits and a few separators. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:\d{2})$/;

/** Seats a game may have; the engine plays 2-4 (CR 800), the bound leaves room. */
const MAX_SEATS = 8;

class Malformed extends Error {
  constructor(readonly path: string, message: string) {
    super(message);
  }
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A walker over the parsed JSON that names the path of the first value that does not fit. */
class Shape {
  constructor(private readonly path: string) {}

  at(key: string | number): Shape {
    return new Shape(typeof key === 'number' ? `${this.path}[${key}]` : this.path === '' ? key : `${this.path}.${key}`);
  }

  fail(message: string): never {
    throw new Malformed(this.path, `${this.path === '' ? 'The file' : this.path}: ${message}`);
  }

  record(x: unknown): Rec {
    if (!isRec(x)) this.fail('should be an object.');
    return x;
  }

  list(x: unknown, max = Infinity): unknown[] {
    if (!Array.isArray(x)) this.fail('should be a list.');
    if (x.length > max) this.fail(`has more than ${max} entries.`);
    return x;
  }

  str(x: unknown, max: number, opts: { shown?: boolean; empty?: boolean; pattern?: RegExp } = {}): string {
    if (typeof x !== 'string') this.fail('should be text.');
    if (x.length > max) this.fail(`is longer than ${max} characters.`);
    if (opts.empty !== true && x === '') this.fail('is empty.');
    // Text that is shown on screen (titles, names, reasons) carries no control characters (util/shown-text.ts, the rule of packages/net's protocol).
    if (opts.shown === true && hasControl(x)) this.fail('contains control characters.');
    if (opts.pattern && x !== '' && !opts.pattern.test(x)) this.fail('is not in the expected form.');
    return x;
  }

  int(x: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) this.fail(`should be a whole number from ${min} to ${max}.`);
    return x;
  }

  num(x: unknown, min: number): number {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < min) this.fail(`should be a number of at least ${min}.`);
    return x;
  }

  oneOf<T extends string>(x: unknown, values: ReadonlySet<string>): T {
    if (typeof x !== 'string' || !values.has(x)) this.fail(`should be one of ${[...values].join(', ')}.`);
    return x as T;
  }

  bool(x: unknown): boolean {
    if (typeof x !== 'boolean') this.fail('should be true or false.');
    return x;
  }
}

/** The fields of `r` that are present (a key whose value is undefined does not occur in parsed JSON). */
const has = (r: Rec, k: string): boolean => Object.hasOwn(r, k);

function checkApp(s: Shape, x: unknown): void {
  const r = s.record(x);
  s.at('version').str(r['version'], 40, { shown: true });
  if (r['commit'] !== null) s.at('commit').str(r['commit'], 64, { shown: true }); // null: not built from a git checkout
}

function checkEngine(s: Shape, x: unknown): void {
  const r = s.record(x);
  if (r['build'] !== null) s.at('build').str(r['build'], 128, { shown: true });
  s.at('compiler').str(r['compiler'], 200, { shown: true });
  s.at('model').int(r['model'], 0);
  s.at('stateSchema').int(r['stateSchema'], 1);
  s.at('viewSchema').int(r['viewSchema'], 1);
}

function checkTime(s: Shape, x: unknown): void {
  s.str(x, 40, { pattern: ISO_TIME });
}

/** The game's facts; returns the seats' ids in seating order. */
function checkGame(s: Shape, x: unknown): string[] {
  const r = s.record(x);
  s.at('mode').oneOf(r['mode'], MODES);
  s.at('format').str(r['format'], 40, { shown: true, empty: true }); // '' when the game was played in no format
  const ps = s.at('players');
  const players = ps.list(r['players'], MAX_SEATS);
  if (players.length === 0) ps.fail('has no players.');
  const ids: string[] = [];
  players.forEach((p, i) => {
    const pi = ps.at(i);
    const pr = pi.record(p);
    const id = pi.at('id').str(pr['id'], 64, { pattern: ID });
    if (ids.includes(id)) pi.at('id').fail(`names the player ${id} twice.`);
    ids.push(id);
    pi.at('name').str(pr['name'], 64, { shown: true });
    pi.at('kind').oneOf(pr['kind'], new Set(['person', 'computer']));
  });
  if (r['savedBy'] !== null && !ids.includes(s.at('savedBy').str(r['savedBy'], 64))) s.at('savedBy').fail('is not a player of the game.');
  s.at('ended').oneOf(r['ended'], ENDS);
  if (r['result'] !== null) {
    const rs = s.at('result');
    const res = rs.record(r['result']);
    if (res['winner'] !== null && !ids.includes(rs.at('winner').str(res['winner'], 64))) rs.at('winner').fail('is not a player of the game.');
    rs.at('reason').str(res['reason'], 500, { shown: true, empty: true });
  }
  s.at('turns').int(r['turns'], 0);
  s.at('actions').int(r['actions'], 0);
  checkTime(s.at('startedAt'), r['startedAt']);
  checkTime(s.at('endedAt'), r['endedAt']);
  return ids;
}

function checkReveal(s: Shape, x: unknown, seats: readonly string[]): void {
  const r = s.record(x);
  s.at('policy').oneOf(r['policy'], new Set(['own', 'all']));
  const as = s.at('agreed');
  const agreed = as.list(r['agreed'], MAX_SEATS);
  const seen = new Set<string>();
  agreed.forEach((p, i) => {
    const id = as.at(i).str(p, 64);
    if (!seats.includes(id)) as.at(i).fail('is not a player of the game.');
    if (seen.has(id)) as.at(i).fail(`names ${id} twice.`);
    seen.add(id);
  });
}

/** A list of short texts (a type line's types, colors, keywords). */
function checkWords(s: Shape, x: unknown): void {
  s.list(x, 100).forEach((w, i) => s.at(i).str(w, 200, { empty: true }));
}

/**
 * A card face (`FaceDef`): every field the engine and the board read without looking first (they iterate the type lists and the abilities, and draw the
 * names, the type line, the text and the mana cost). The abilities' contents are the engine's to check as it plays (CR 733).
 */
function checkFace(s: Shape, x: unknown): void {
  const r = s.record(x);
  s.at('name').str(r['name'], 500, { empty: true });
  if (r['manaCost'] !== null) s.at('manaCost').list(r['manaCost'], 100).forEach((m, i) => s.at('manaCost').at(i).record(m));
  s.at('typeLine').str(r['typeLine'], 500, { empty: true });
  for (const k of ['supertypes', 'types', 'subtypes', 'colors', 'keywords']) checkWords(s.at(k), r[k]);
  if (has(r, 'colorIndicator')) checkWords(s.at('colorIndicator'), r['colorIndicator']);
  s.at('oracleText').str(r['oracleText'], 20_000, { empty: true });
  for (const k of ['power', 'toughness', 'loyalty', 'defense']) if (has(r, k)) s.at(k).str(r[k], 20, { empty: true });
  s.at('abilities').list(r['abilities']).forEach((a, i) => s.at('abilities').at(i).record(a));
  if (has(r, 'prototype')) s.at('prototype').record(r['prototype']);
}

/**
 * A card definition (`CardDef`): its id (the key it is filed under), name, layout, faces, whether it is a token and its automation record, each with its
 * type. The engine builds a game from these and the board draws them; a definition without faces made the engine throw (RPL-0 review).
 */
function checkDef(s: Shape, x: unknown, key?: string): void {
  const r = s.record(x);
  const id = s.at('id').str(r['id'], 256);
  if (key !== undefined && id !== key) s.at('id').fail(`is not its key ${key}.`);
  s.at('name').str(r['name'], 500, { empty: true });
  s.at('layout').str(r['layout'], 64);
  const fs = s.at('faces');
  const faces = fs.list(r['faces'], 8);
  if (faces.length === 0) fs.fail('has no faces.');
  faces.forEach((f, i) => checkFace(fs.at(i), f));
  s.at('isToken').bool(r['isToken']);
  s.at('automation').at('level').str(s.at('automation').record(r['automation'])['level'], 64);
  if (has(r, 'meld')) s.at('meld').record(r['meld']);
  if (has(r, 'tokenNames')) checkWords(s.at('tokenNames'), r['tokenNames']);
  if (has(r, 'colorIdentity')) checkWords(s.at('colorIdentity'), r['colorIdentity']);
}

function checkDefs(s: Shape, x: unknown): void {
  if (Array.isArray(x)) x.forEach((d, i) => checkDef(s.at(i), d));
  else for (const [k, d] of Object.entries(s.record(x))) checkDef(s.at(k), d, k);
}

function checkConfig(s: Shape, x: unknown, seats: number): void {
  const r = s.record(x);
  s.at('seed').str(r['seed'], 256, { empty: true });
  const ps = s.at('players');
  const players = ps.list(r['players'], MAX_SEATS);
  if (players.length !== seats) ps.fail(`has ${players.length} players; the game has ${seats}.`);
  players.forEach((p, i) => {
    const pi = ps.at(i);
    const pr = pi.record(p);
    pi.at('name').str(pr['name'], 64, { shown: true });
    const deck = pi.at('deck');
    deck.list(pr['deck']).forEach((d, j) => deck.at(j).str(d, 256));
  });
  checkDefs(s.at('defs'), r['defs']);
  if (has(r, 'options')) s.at('options').record(r['options']);
}

/**
 * An action the engine can be handed (core/action-shape.ts, the check packages/net makes of a guest's action): a player's action type with its player
 * and fields of their types. Fields the engine does not read are let through (a newer build may add one); whether the action is legal is the engine's
 * to decide as it applies it.
 */
function checkAction(s: Shape, x: unknown): void {
  s.record(x);
  const problem = actionShapeProblem(x);
  if (problem === null) return;
  const at = problem === 'unknown action type' ? s.at('type') : problem === 'action player missing' ? s.at('player') : problem === 'stops malformed' ? s.at('stops') : s;
  at.fail(`is not an action the engine can read (${problem}).`);
}

function checkPlay(s: Shape, x: unknown, seats: number): void {
  const r = s.record(x);
  checkConfig(s.at('config'), r['config'], seats);
  const as = s.at('actions');
  const actions = as.list(r['actions']);
  actions.forEach((a, i) => checkAction(as.at(i), a));
  const ts = s.at('times');
  const times = ts.list(r['times']);
  if (times.length !== actions.length) ts.fail(`has ${times.length} times for ${actions.length} actions.`);
  times.forEach((t, i) => ts.at(i).num(t, 0));
  const cs = s.at('checkpoints');
  let last = -1;
  const checkpoints = cs.list(r['checkpoints']);
  if (actions.length === 0 && checkpoints.length > 0) cs.fail('has checkpoints but there are no actions.');
  checkpoints.forEach((c, i) => {
    const ci = cs.at(i);
    const cr = ci.record(c);
    const at = ci.at('action').int(cr['action'], 0, actions.length - 1);
    if (at <= last) ci.at('action').fail('is not after the previous checkpoint.');
    last = at;
    ci.at('turn').int(cr['turn'], 0);
    ci.at('digest').str(cr['digest'], 64);
  });
}

const PER_SEAT_ZONES = ['library', 'hand', 'graveyard'] as const;
const SHARED_ZONES = ['battlefield', 'stack', 'exile', 'command'] as const;

/** What a recording's views are checked against: its viewer and the definitions it holds. */
export interface RecordingViewContext {
  viewer: string | null;
  /** The recording's definitions (`ReplayRecording.defs`): every object's definition is one of them, or the hidden one. */
  defs: Readonly<Record<string, unknown>>;
}

/**
 * A view as the board reads it (design 4: a recording's views pass a shape check before the board draws them; RPL-0 review: the board reads these parts
 * without looking first, and a view without them took down the page). The viewer; the players with their ids and life; every zone (libraries, hands
 * and graveyards as a list per seat, the battlefield, the stack, exile and the command zone as lists) naming only objects of the view; every object
 * with its id, kind, definition (one of the recording's, or the hidden one), owner, controller, zone and status; the turn with its number, step and
 * active player; the decision pending and the result, when there are any; and the log's lines with their text.
 */
function checkView(s: Shape, x: unknown, ctx: RecordingViewContext): void {
  const r = s.record(x);
  if (r['viewer'] !== ctx.viewer) s.at('viewer').fail(`should be the recording's viewer (${String(ctx.viewer)}).`);
  const ps = s.at('players');
  const seats: string[] = [];
  ps.list(r['players'], MAX_SEATS).forEach((p, i) => {
    const pi = ps.at(i);
    const pr = pi.record(p);
    const id = pi.at('id').str(pr['id'], 64);
    if (seats.includes(id)) pi.at('id').fail(`names the player ${id} twice.`);
    seats.push(id);
    pi.at('name').str(pr['name'], 200, { empty: true });
    pi.at('life').num(pr['life'], -Number.MAX_VALUE);
    if (has(pr, 'poison')) pi.at('poison').num(pr['poison'], 0);
  });
  if (seats.length === 0) ps.fail('has no players.');
  const objects = s.at('objects').record(r['objects']);
  const viewDefs = isRec(r['defs']) ? r['defs'] : {};
  for (const [id, o] of Object.entries(objects)) {
    const oi = s.at('objects').at(id);
    const or = oi.record(o);
    if (oi.at('id').str(or['id'], 64) !== id) oi.at('id').fail(`is not its key ${id}.`);
    oi.at('kind').str(or['kind'], 32);
    const def = oi.at('defId').str(or['defId'], 256);
    if (def !== HIDDEN_DEF && !Object.hasOwn(ctx.defs, def) && !Object.hasOwn(viewDefs, def)) oi.at('defId').fail('is not a definition of the recording.');
    for (const k of ['owner', 'controller', 'zone']) oi.at(k).str(or[k], 64);
    for (const k of ['tapped', 'flipped', 'faceDown', 'phasedOut']) if (has(or, k)) oi.at(k).bool(or[k]);
    if (has(or, 'face')) oi.at('face').int(or['face'], 0, 8);
    if (has(or, 'counters')) for (const [k, n] of Object.entries(oi.at('counters').record(or['counters']))) oi.at('counters').at(k).num(n, -Number.MAX_VALUE);
  }
  const zs = s.at('zones');
  const zones = zs.record(r['zones']);
  const idList = (z: Shape, v: unknown): void => {
    z.list(v).forEach((id, i) => {
      if (!Object.hasOwn(objects, z.at(i).str(id, 64))) z.at(i).fail('is not an object of the view.');
    });
  };
  for (const zone of PER_SEAT_ZONES) {
    const perSeat = zs.at(zone).record(zones[zone]);
    for (const seat of seats) idList(zs.at(zone).at(seat), perSeat[seat]);
  }
  for (const zone of SHARED_ZONES) idList(zs.at(zone), zones[zone]);
  const ts = s.at('turn');
  const turn = ts.record(r['turn']);
  ts.at('number').int(turn['number'], 0);
  ts.at('step').str(turn['step'], 64);
  if (!seats.includes(ts.at('activePlayer').str(turn['activePlayer'], 64))) ts.at('activePlayer').fail('is not a player of the view.');
  if (r['pending'] !== null && r['pending'] !== undefined) {
    const d = s.at('pending').record(r['pending']);
    s.at('pending').at('kind').str(d['kind'], 64);
    s.at('pending').at('player').str(d['player'], 64);
  }
  if (r['result'] !== null && r['result'] !== undefined) {
    const res = s.at('result').record(r['result']);
    if (res['winner'] !== null) s.at('result').at('winner').str(res['winner'], 64);
  }
  const ls = s.at('log');
  ls.list(r['log']).forEach((e, i) => ls.at(i).at('text').str(ls.at(i).record(e)['text'], 20_000, { empty: true }));
}

/**
 * Check a view of a recording before the board draws it (see `checkView`): a key view as it is read, and every view a patch makes (RPL-2 runs each
 * frame through `recordingFrameView`, which calls this). A refusal is `malformed`, with the path in the view.
 */
export function checkRecordingView(view: unknown, ctx: RecordingViewContext): Checked<RecordingKeyView> {
  return runShape(() => {
    checkView(new Shape(''), view, ctx);
    return view as RecordingKeyView;
  });
}

/**
 * The view of a recording's frame, given the view of the frame before it (null before the first): the frame's key view, or the previous view with the
 * frame's patch applied (bounded work, core/view-patch.ts), each checked as the board reads it (`checkRecordingView`). Never throws: a patch that does
 * not fit or a view the board cannot draw is a refusal, and playback stops at the last good frame (design 4, RPL-0 review).
 */
export function recordingFrameView(prev: RecordingKeyView | null, frame: RecordingFrame, ctx: RecordingViewContext): Checked<RecordingKeyView> {
  let view: unknown;
  if (frame.key !== undefined) view = frame.key;
  else {
    if (prev === null) return refuse('malformed', 'A patch frame has no view before it to apply to.');
    try {
      view = applyPatch(prev, frame.patch ?? []);
    } catch (e) {
      return refuse('malformed', `Frame ${frame.seq} does not fit the view before it: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return checkRecordingView(view, ctx);
}

function checkPatch(s: Shape, x: unknown): void {
  // Every op costs at least one unit of work, so a patch of more ops than PATCH_MAX_WORK could never be applied (core/view-patch.ts).
  s.list(x, PATCH_MAX_WORK).forEach((op, i) => {
    const oi = s.at(i);
    const r = oi.record(op);
    oi.at('op').oneOf(r['op'], PATCH_OPS);
    const ps = oi.at('path');
    ps.list(r['path']).forEach((seg, j) => {
      if (typeof seg === 'string') return;
      ps.at(j).int(seg, 0);
    });
  });
}

function checkEvents(s: Shape, x: unknown): void {
  s.list(x).forEach((e, i) => s.at(i).at('type').str(s.at(i).record(e)['type'], 64));
}

function checkRecording(s: Shape, x: unknown, seats: readonly string[]): void {
  const r = s.record(x);
  const viewer = r['viewer'] === null ? null : s.at('viewer').str(r['viewer'], 64);
  if (viewer !== null && !seats.includes(viewer)) s.at('viewer').fail('is not a player of the game.');
  const defs = s.at('defs').record(r['defs']);
  for (const [k, d] of Object.entries(defs)) checkDef(s.at('defs').at(k), d, k);
  const fs = s.at('frames');
  let lastSeq = -1;
  let run = 0; // patch frames since the last key frame
  fs.list(r['frames']).forEach((f, i) => {
    const fi = fs.at(i);
    const fr = fi.record(f);
    const seq = fi.at('seq').int(fr['seq'], 0);
    if (seq <= lastSeq) fi.at('seq').fail('is not after the previous frame.');
    lastSeq = seq;
    fi.at('t').num(fr['t'], 0);
    const key = has(fr, 'key');
    const patch = has(fr, 'patch');
    if (key === patch) fi.fail('should have either a key view or a patch.');
    if (i === 0 && !key) fi.fail('the first frame should be a key view.');
    run = key ? 0 : run + 1;
    if (run > RECORDING_MAX_PATCH_RUN) fi.fail(`is patch ${run} in a row; a recording has a key view at least every ${RECORDING_MAX_PATCH_RUN + 1} frames.`);
    if (key) checkView(fi.at('key'), fr['key'], { viewer, defs });
    else checkPatch(fi.at('patch'), fr['patch']);
    checkEvents(fi.at('events'), fr['events']);
  });
}

/** The shape of a current-format replay (after the upgrade chain). */
function checkReplayShape(r: Rec, s: Shape): ReplayFile {
  const kind = s.at('kind').oneOf<'game' | 'recording'>(r['kind'], new Set(['game', 'recording']));
  s.at('id').str(r['id'], 64, { pattern: ID });
  s.at('title').str(r['title'], 200, { shown: true, empty: true });
  checkTime(s.at('createdAt'), r['createdAt']);
  checkApp(s.at('app'), r['app']);
  checkEngine(s.at('engine'), r['engine']);
  const seats = checkGame(s.at('game'), r['game']);
  checkReveal(s.at('reveal'), r['reveal'], seats);
  if (kind === 'game') {
    if (!has(r, 'play')) s.at('play').fail('is missing (a game replay holds the game).');
    checkPlay(s.at('play'), r['play'], seats.length);
  } else if (has(r, 'play')) s.at('play').fail('should not be in a recording.');
  if (kind === 'recording' && !has(r, 'recording')) s.at('recording').fail('is missing.');
  if (has(r, 'recording')) checkRecording(s.at('recording'), r['recording'], seats);
  return r as unknown as ReplayFile;
}

function runShape<T>(check: () => T): Checked<T> {
  try {
    return { ok: true, value: check() };
  } catch (e) {
    if (e instanceof Malformed) return refuse('malformed', e.message, e.path);
    return refuse('malformed', `The file could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function boundsError(value: unknown, limits: ReplayLimits): ReplayError | null {
  const over = measureValue(value, limits);
  if (over === 'depth') return { code: 'tooDeep', message: `The file is nested more than ${limits.maxDepth} levels deep.` };
  if (over === 'string') return { code: 'stringTooLong', message: `The file has a text longer than ${limits.maxString} characters.` };
  if (over === 'values') return { code: 'tooLarge', message: `The file has more than ${limits.maxValues} values.` };
  return null;
}

/** A replay at `base` (the whole file: '', inside a bug report: 'replay'): upgraded to the current format and checked. */
function upgradedReplay(value: unknown, base: string): Checked<ReplayFile> {
  if (!isRec(value) || value['format'] !== REPLAY_FORMAT) return refuse('notReplay', 'This is not an OpenMTG replay.', base === '' ? undefined : base);
  const up = upgradeReplay(value as JsonRecord);
  if (!up.ok) return up;
  return runShape(() => checkReplayShape(up.value, new Shape(base)));
}

/** Check a parsed replay (bounds, upgrade chain, shape). The result is the file in the current format. */
export function checkReplay(value: unknown, limits: ReplayLimits = REPLAY_LIMITS): Checked<ReplayFile> {
  const over = boundsError(value, limits);
  if (over) return { ok: false, error: over };
  return upgradedReplay(value, '');
}

/** Check a parsed bug report and the replay inside it. */
export function checkBugReport(value: unknown, limits: ReplayLimits = REPLAY_LIMITS): Checked<BugReportFile> {
  const over = boundsError(value, limits);
  if (over) return { ok: false, error: over };
  if (!isRec(value) || value['format'] !== BUG_REPORT_FORMAT) return refuse('notReplay', 'This is not an OpenMTG bug report.');
  const up = upgradeBugReport(value as JsonRecord);
  if (!up.ok) return up;
  const r = up.value;
  const replay = upgradedReplay(r['replay'], 'replay');
  if (!replay.ok) return replay;
  return runShape(() => {
    const s = new Shape('');
    const at = s.at('at').record(r['at']);
    s.at('at').at('action').int(at['action'], 0);
    s.at('words').str(r['words'], 20_000, { empty: true });
    if (has(r, 'card')) s.at('card').str(r['card'], 200, { shown: true });
    checkApp(s.at('app'), r['app']);
    const b = s.at('browser').record(r['browser']);
    s.at('browser').at('userAgent').str(b['userAgent'], 1000, { empty: true });
    if (has(b, 'language')) s.at('browser').at('language').str(b['language'], 64);
    if (has(b, 'screen')) s.at('browser').at('screen').str(b['screen'], 64);
    const settings = s.at('settings').record(r['settings']);
    if (Object.keys(settings).length > 500) s.at('settings').fail('has more than 500 entries.');
    for (const [k, v] of Object.entries(settings)) {
      if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') s.at('settings').at(k).fail('should be a plain value.');
      if (typeof v === 'string') s.at('settings').at(k).str(v, 1000, { empty: true });
    }
    const es = s.at('errors');
    es.list(r['errors'], 200).forEach((e, i) => {
      const er = es.at(i).record(e);
      es.at(i).at('message').str(er['message'], 10_000, { empty: true });
      if (has(er, 'stack')) es.at(i).at('stack').str(er['stack'], 50_000, { empty: true });
      if (has(er, 'time')) checkTime(es.at(i).at('time'), er['time']);
    });
    return { ...r, replay: replay.value } as unknown as BugReportFile;
  });
}

/** Parse JSON text within the bounds, without throwing. */
export function parseBoundedJson(text: string, limits: ReplayLimits = REPLAY_LIMITS): Checked<unknown> {
  // A UTF-16 code unit is at least one UTF-8 byte, so a longer text is over the byte bound whatever it holds.
  if (text.length > limits.maxTextBytes) return refuse('tooLarge', `The file expands to more than ${limits.maxTextBytes} bytes.`);
  // Before JSON.parse: a text of too many values is refused before they are built (a flat list of zeros is 2 bytes a value, 64M of them in 128 MB).
  const over = scanJsonText(text, limits);
  if (over === 'depth') return refuse('tooDeep', `The file is nested more than ${limits.maxDepth} levels deep.`);
  if (over === 'values') return refuse('tooLarge', `The file has more than ${limits.maxValues} values.`);
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return refuse('notJson', 'This file is not a replay: it is not JSON.');
  }
}

/** Parse and check a replay's JSON text. */
export function parseReplay(text: string, limits: ReplayLimits = REPLAY_LIMITS): Checked<ReplayFile> {
  const parsed = parseBoundedJson(text, limits);
  return parsed.ok ? checkReplay(parsed.value, limits) : parsed;
}

/** Parse and check a bug report's JSON text. */
export function parseBugReport(text: string, limits: ReplayLimits = REPLAY_LIMITS): Checked<BugReportFile> {
  const parsed = parseBoundedJson(text, limits);
  return parsed.ok ? checkBugReport(parsed.value, limits) : parsed;
}
