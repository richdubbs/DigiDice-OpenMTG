/**
 * The executability smoke test (design 8.10.5, 11.3 gate 7, 15.4): every automated ability of every card runs on a generated board through the real
 * engine (`applyAction` only: no mocks, no shortcuts into the interpreter), and must complete without `EngineBug`, without an exception, without the
 * run-time backstop firing (guard G11), and must leave a consistent state (zones and objects agree; when a player holds priority, no state-based
 * action is left undone, CR 704.3, 117.5).
 *
 * The backstop is told apart from the card's own manual parts on EVERY card, whatever its level: a `manualResolve` whose reason is a backstop reason
 * (an op without a handler, an ability the engine cannot find, the step budget: effects/run.ts) is a failure, and so is a prompt whose text is none of
 * the card's manual spans (design 10.1: a partial card prompts only for the nodes it marks manual). On a `full` card every prompt is a failure.
 *
 * Per card with at least one automated ability, three phases, each from a fresh board:
 *   A. cast it (every cast action the engine lists for the copy in hand: faces, alternative costs) or play it as a land, and resolve the stack;
 *   B. with a copy on the battlefield, activate each of its activated abilities the engine lists (mana abilities included) and resolve the stack;
 *   C. with a copy on the battlefield, play a full turn cycle (to the third turn's first main phase): upkeep, draw, combat (the card attacks when it
 *      can), end step and the opponent's turn exercise its triggered and static abilities.
 * An action the engine refuses as illegal (no legal target on this board, a cost it cannot pay) is "not exercised", never a failure.
 */
import { EngineBug, applyAction, getChars, hasKeyword, legalActions, manualNodes, ptNumbers, type Action, type CardDef, type GameState, type ObjectId } from '@openmtg/engine';
import { respond } from './answer';
import { hasPermanentFace, makeBoard, type Board } from './board';

/** The reasons of the run-time backstop (guard G11, effects/run.ts): never a manual node of the card. */
export const BACKSTOP_REASONS: readonly RegExp[] = [/^the engine cannot perform this step yet\b/, /^ability not found$/, /^budget$/];
export const isBackstop = (reason: string | undefined): boolean => reason !== undefined && BACKSTOP_REASONS.some((r) => r.test(reason));

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** The texts of the card's manual nodes (design 10.1): what a partial card may legitimately prompt for. */
export function manualTexts(def: CardDef): string[] {
  const out = new Set<string>();
  for (const f of def.faces) {
    for (const a of f.abilities) {
      try {
        for (const n of manualNodes(a)) if (n.text) out.add(norm(n.text));
      } catch {
        /* a malformed ability prompts nothing it can claim */
      }
      if (a.kind === 'manual' && a.text) out.add(norm(a.text));
    }
  }
  for (const f of def.automation.faces ?? []) for (const a of f.abilities) for (const m of a.manual) if (m.text) out.add(norm(m.text));
  return [...out];
}

/** Is a prompt one of the card's own manual parts? (its text and a manual span contain one another: a prompt may join sentences or quote one line) */
const isOwnManual = (text: string, own: readonly string[]): boolean => {
  const t = norm(text);
  return t !== '' && own.some((m) => m.includes(t) || t.includes(m));
};

export type SmokeFailureKind = 'EngineBug' | 'exception' | 'invariant' | 'unexpected-manual' | 'stuck';

export interface SmokeFailure { card: string; phase: string; action: string; kind: SmokeFailureKind; message: string }

export interface SmokeCardResult {
  card: string;
  level: string;
  /** Actions tried per phase and how many completed. */
  tried: number;
  completed: number;
  /** Not exercised: refused as illegal on this board, or no such action exists. */
  refused: number;
  /** Stack objects of the card (its spell, its activated and triggered abilities) that resolved. */
  resolved: { spell: number; activated: number; triggered: number };
  manualPrompts: number;
  /** Phases not exercised because the permanent under test left the battlefield before anything of it ran. */
  leftEarly: string[];
  failures: SmokeFailure[];
}

export interface SmokeOptions {
  /** Upper bound of engine actions per phase (default 400). */
  maxActions?: number;
  /** Run phase C (the turn cycle). Default true. */
  turnCycle?: boolean;
}

/**
 * State-based actions left undone while a player holds priority (CR 117.5: they are checked before a player receives priority, CR 704.3: until none
 * applies). Only the checks that need no choice and no unknown value: a "*" toughness the engine cannot evaluate is never judged (ptNumbers).
 */
export function sbaProblems(s: GameState): string[] {
  if (s.result || s.pending?.kind !== 'priority') return [];
  const out: string[] = [];
  for (const p of s.players) {
    if (p.hasLost) continue;
    if (p.life <= 0) out.push(`CR 704.5a: ${p.id} has ${p.life} life and has not lost`);
    if (p.poison >= 10) out.push(`CR 704.5c: ${p.id} has ${p.poison} poison counters and has not lost`);
  }
  for (const id of s.zones.battlefield) {
    const o = s.objects[id];
    if (!o) continue;
    let c: ReturnType<typeof getChars>;
    try {
      c = getChars(s, id);
    } catch {
      continue; // reported by invariantProblems
    }
    if (c.types.includes('Creature')) {
      const t = ptNumbers(c).toughness;
      if (t !== null && t <= 0) out.push(`CR 704.5f: ${id} (${c.name}) has toughness ${t}`);
      else if (t !== null && !hasKeyword(c, 'indestructible') && o.damage >= t) out.push(`CR 704.5g: ${id} (${c.name}) has lethal damage (${o.damage} on toughness ${t})`);
    }
    if (c.types.includes('Planeswalker') && (o.counters['loyalty'] ?? 0) <= 0) out.push(`CR 704.5i: ${id} (${c.name}) has no loyalty`);
  }
  for (const id of Object.keys(s.objects)) {
    const o = s.objects[id]!;
    if (o.kind === 'token' && o.zone !== 'battlefield') out.push(`CR 704.5d: token ${id} is in ${o.zone}`);
  }
  return out;
}

/** State consistency after a phase: every zone entry is an object in that zone, and no object is in two zones; no state-based action left undone. */
export function invariantProblems(s: GameState): string[] {
  const problems: string[] = [];
  const seen = new Map<ObjectId, string>();
  const check = (zone: string, ids: readonly ObjectId[]): void => {
    for (const id of ids) {
      const o = s.objects[id];
      if (!o) problems.push(`${zone} lists ${id}, which is not an object`);
      else if (o.zone !== zone) problems.push(`${id} is listed in ${zone} but its zone is ${o.zone}`);
      if (seen.has(id)) problems.push(`${id} is in ${seen.get(id)} and ${zone}`);
      seen.set(id, zone);
    }
  };
  for (const z of ['battlefield', 'stack', 'exile', 'command'] as const) check(z, s.zones[z]);
  for (const z of ['hand', 'library', 'graveyard'] as const) for (const ids of Object.values(s.zones[z])) check(z, ids);
  for (const p of s.players) if (!Number.isFinite(p.life)) problems.push(`${p.id} has life ${p.life}`);
  for (const id of s.zones.battlefield) for (const [k, n] of Object.entries(s.objects[id]?.counters ?? {})) if (!Number.isInteger(n) || n < 0) problems.push(`${id} has ${n} ${k} counters`);
  return [...problems, ...sbaProblems(s)];
}

const describeAction = (a: Action): string => (a.type === 'cast' ? `cast${a.face !== undefined ? ` face ${a.face}` : ''}${a.method ? ` via ${a.method}` : ''}` : a.type === 'activate' ? `activate ${a.ability}` : a.type);

interface Track { stackSeen: Map<ObjectId, 'spell' | 'activated' | 'triggered'>; manual: number; unexpectedManual: string[]; seenPrompts: Set<string> }

/** Note the card's stack objects and manual prompts in the current state (`own`: the card's manual texts, `manualTexts`). */
function observe(s: GameState, def: CardDef, subjects: ReadonlySet<ObjectId>, track: Track, full: boolean, own: readonly string[]): void {
  for (const id of s.zones.stack) {
    const o = s.objects[id];
    if (!o?.stack) continue;
    // a zone change makes a new object (CR 400.7), so the card's abilities are recognized by their source's definition, not by one object id
    const source = o.stack.sourceId !== undefined ? s.objects[o.stack.sourceId] : undefined;
    const mine = o.stack.kind === 'spell' ? o.defId === def.id : (o.stack.sourceId !== undefined && subjects.has(o.stack.sourceId)) || source?.defId === def.id || o.stack.sourceName === def.name;
    if (mine && !track.stackSeen.has(id)) track.stackSeen.set(id, o.stack.kind);
  }
  const d = s.pending;
  if (d?.kind === 'manualResolve' && (d.sourceName === def.name || def.faces.some((f) => f.name === d.sourceName))) {
    // a decision stays pending until answered: count each prompt once
    if (track.seenPrompts.has(d.id)) return;
    track.seenPrompts.add(d.id);
    track.manual++;
    const why = full ? 'a full card prompts for nothing' : isBackstop(d.reason) ? 'the run-time backstop fired (G11)' : !isOwnManual(d.text, own) ? 'the text is none of the card\'s manual parts' : null;
    if (why) track.unexpectedManual.push(`${d.text}${d.reason ? ` (${d.reason})` : ''}: ${why}`);
  }
}

/**
 * Drive the game from `s` after `first` with the deterministic policy until `done` holds with p1 holding priority, the game ends or the budget runs out.
 * Returns the final state, or throws what the engine threw.
 */
function drive(s: GameState, first: Action | null, done: (s: GameState) => boolean, def: CardDef, subjects: ReadonlySet<ObjectId>, track: Track, opts: { max: number; full: boolean; own: readonly string[]; attacker?: ObjectId }): { state: GameState; refused?: string; stuck?: string } {
  let state = s;
  if (first) {
    const r = applyAction(state, first);
    if (r.error) return { state, refused: r.error.message };
    state = r.state;
  }
  for (let i = 0; i < opts.max; i++) {
    observe(state, def, subjects, track, opts.full, opts.own);
    if (state.result) return { state };
    const d = state.pending;
    if (!d) return { state, stuck: 'no pending decision' };
    let action: Action;
    if (d.kind === 'priority') {
      if (done(state)) return { state };
      action = { type: 'pass', player: d.player };
    } else action = respond(d, { cardName: def.name, ...(opts.attacker ? { attacker: opts.attacker } : {}) });
    const r = applyAction(state, action);
    if (r.error) {
      // the policy's answer was refused (an answer the decision did not allow): cancel if possible, else give up on this action
      if (d.kind !== 'priority' && d.cancellable) {
        const c = applyAction(state, { type: 'cancel', player: d.player });
        if (!c.error) {
          state = c.state;
          continue;
        }
      }
      return { state, stuck: `${d.kind} answer refused: ${r.error.message}` };
    }
    state = r.state;
  }
  return { state, stuck: `no end after ${opts.max} actions (step ${state.turn.step}, turn ${state.turn.number})` };
}

/** The board with one of p1's own filler spells (no text; the instant by default) cast and on the stack, p1 holding priority (CR 117.3c): something for a counterspell to target. */
export function withSpellOnStack(b: Board, filler = 'Smoke Spark'): Board {
  const spark = b.state.zones.hand['p1']!.find((id) => b.state.objects[id]!.defId === filler);
  const cast = legalActions(b.state, 'p1').find((l) => l.kind === 'cast' && l.object === spark);
  if (!cast) throw new Error(`board setup: the filler spell ${filler} cannot be cast`);
  let r = applyAction(b.state, cast.action);
  for (let i = 0; i < 10 && !r.error && r.state.pending && r.state.pending.kind !== 'priority'; i++) {
    const d = r.state.pending;
    r = applyAction(r.state, respond(d, { cardName: filler }));
  }
  if (r.error || r.state.zones.stack.length !== 1 || r.state.pending?.kind !== 'priority' || r.state.pending.player !== 'p1') throw new Error(`board setup: the filler spell ${filler} did not reach the stack`);
  return { ...b, state: r.state };
}

const stackEmptyP1 = (s: GameState): boolean => s.zones.stack.length === 0 && s.pending?.kind === 'priority' && s.pending.player === 'p1' && s.pendingTriggers.length === 0;

/** Has the card at least one automated ability (design 10.3: full or partial)? */
export function isSmokeCandidate(def: CardDef): boolean {
  return def.automation.level !== 'manual' && def.faces.some((f) => f.abilities.length > 0);
}

export function smokeCard(def: CardDef, opts: SmokeOptions = {}): SmokeCardResult {
  const max = opts.maxActions ?? 400;
  const full = def.automation.level === 'full';
  const own = manualTexts(def);
  const res: SmokeCardResult = { card: def.name, level: def.automation.level, tried: 0, completed: 0, refused: 0, resolved: { spell: 0, activated: 0, triggered: 0 }, manualPrompts: 0, leftEarly: [], failures: [] };
  const fail =(phase: string, action: string, kind: SmokeFailureKind, message: string): void => {
    res.failures.push({ card: def.name, phase, action, kind, message });
  };

  const runPhase = (phase: string, make: () => Board, actions: (b: Board) => Action[], done: (s: GameState, start: GameState) => boolean, subjectsOf: (b: Board) => ObjectId[]): void => {
    let board: Board;
    try {
      board = make();
    } catch (e) {
      fail(phase, 'board', e instanceof EngineBug ? 'EngineBug' : 'exception', e instanceof Error ? e.message : String(e));
      return;
    }
    let list: Action[];
    try {
      list = actions(board);
    } catch (e) {
      fail(phase, 'legalActions', e instanceof EngineBug ? 'EngineBug' : 'exception', e instanceof Error ? e.message : String(e));
      return;
    }
    for (const a of list) {
      res.tried++;
      const track: Track = { stackSeen: new Map(), manual: 0, unexpectedManual: [], seenPrompts: new Set() };
      const subjects = new Set(subjectsOf(board));
      const name = describeAction(a);
      try {
        const out = drive(board.state, a, (s) => done(s, board.state), def, subjects, track, { max, full, own, ...(board.permanent ? { attacker: board.permanent } : {}) });
        if (out.refused !== undefined) {
          res.refused++;
          continue;
        }
        // the turn cycle exercises the permanent's triggers and statics only while it is there: if it left before anything of it ran (a battle
        // without defense counters, a creature the board kills), the phase tested nothing and is "not exercised", never "completed"
        if (phase === 'turn cycle' && board.permanent && !out.state.zones.battlefield.includes(board.permanent) && track.stackSeen.size === 0) {
          res.refused++;
          res.leftEarly.push(phase);
          continue;
        }
        if (out.stuck !== undefined) fail(phase, name, 'stuck', out.stuck);
        else res.completed++;
        const bad = invariantProblems(out.state);
        if (bad.length) fail(phase, name, 'invariant', bad.slice(0, 3).join('; '));
        // what resolved: seen on the stack and gone at the end
        for (const [id, kind] of track.stackSeen) if (!out.state.zones.stack.includes(id)) res.resolved[kind]++;
      } catch (e) {
        fail(phase, name, e instanceof EngineBug ? 'EngineBug' : 'exception', e instanceof Error ? `${e.message}${e.stack ? ` @ ${e.stack.split('\n').slice(1, 3).join(' <- ').trim()}` : ''}` : String(e));
      }
      res.manualPrompts += track.manual;
      for (const m of track.unexpectedManual) fail(phase, name, 'unexpected-manual', m);
    }
  };

  // A: cast it / play it from the hand; a spell that needs a spell to target (a counterspell) is tried again with p1's own instant on the stack
  const castActions = (b: Board): Action[] => {
    const seen = new Set<string>();
    return legalActions(b.state, 'p1').filter((l) => l.object === b.hand && (l.kind === 'cast' || l.kind === 'playLand')).map((l) => l.action).filter((a) => {
      const k = JSON.stringify(a);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const fresh = (): Board => makeBoard(def, { inHand: true, onBattlefield: false });
  let castable = true;
  try {
    castable = castActions(fresh()).length > 0;
  } catch {
    castable = true; // runPhase reports the failure
  }
  if (castable) runPhase('cast', fresh, castActions, (s) => stackEmptyP1(s), (b) => (b.hand ? [b.hand] : []));
  else {
    // an instant first (Counterspell), else a creature spell ("counter target creature spell")
    let filler = 'Smoke Spark';
    try {
      if (castActions(withSpellOnStack(fresh())).length === 0 && castActions(withSpellOnStack(fresh(), 'Smoke Bear')).length > 0) filler = 'Smoke Bear';
    } catch {
      /* runPhase reports it */
    }
    runPhase('cast over a spell', () => withSpellOnStack(fresh(), filler), castActions, (s) => stackEmptyP1(s), (b) => (b.hand ? [b.hand] : []));
  }

  if (hasPermanentFace(def)) {
    // B: activate each activated ability of the permanent
    runPhase('activate', () => makeBoard(def, { inHand: false, onBattlefield: true }), (b) => {
      const seen = new Set<string>();
      return legalActions(b.state, 'p1').filter((l) => l.kind === 'activate' && l.object === b.permanent).map((l) => l.action).filter((a) => {
        const k = JSON.stringify(a);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }, (s) => stackEmptyP1(s), (b) => (b.permanent ? [b.permanent] : []));

    // C: a turn cycle with the permanent on the battlefield (its triggers and statics), default stops so steps with nothing to do pass by
    if (opts.turnCycle !== false) {
      runPhase('turn cycle', () => makeBoard(def, { inHand: false, onBattlefield: true, fullControl: false }), () => [{ type: 'pass', player: 'p1' }], (s) => s.turn.number >= 3 && s.turn.step === 'main1' && stackEmptyP1(s), (b) => (b.permanent ? [b.permanent] : []));
    }
  }
  return res;
}

export interface SmokeSummary {
  cards: number;
  candidates: number;
  /** Candidates for which no action at all could be tried on the generated board (nothing to cast, activate or see trigger). */
  unexercised: string[];
  tried: number;
  completed: number;
  refused: number;
  resolved: { spell: number; activated: number; triggered: number };
  manualPrompts: number;
  /** Phases not exercised because the permanent under test left the battlefield before anything of it ran. */
  leftEarly: number;
  failures: SmokeFailure[];
  byKind: Record<SmokeFailureKind, number>;
}

export function summarize(results: readonly SmokeCardResult[], cards: number): SmokeSummary {
  const s: SmokeSummary = { cards, candidates: results.length, unexercised: results.filter((r) => r.tried === 0).map((r) => r.card), tried: 0, completed: 0, refused: 0, resolved: { spell: 0, activated: 0, triggered: 0 }, manualPrompts: 0, leftEarly: 0, failures: [], byKind: { EngineBug: 0, exception: 0, invariant: 0, 'unexpected-manual': 0, stuck: 0 } };
  for (const r of results) {
    s.tried += r.tried;
    s.completed += r.completed;
    s.refused += r.refused;
    s.resolved.spell += r.resolved.spell;
    s.resolved.activated += r.resolved.activated;
    s.resolved.triggered += r.resolved.triggered;
    s.manualPrompts += r.manualPrompts;
    s.leftEarly += r.leftEarly.length;
    for (const f of r.failures) {
      s.failures.push(f);
      s.byKind[f.kind]++;
    }
  }
  return s;
}

export function formatSmoke(s: SmokeSummary, top = 25): string[] {
  const out = [
    `Smoke test: ${s.candidates} cards with automated abilities (of ${s.cards}); ${s.tried} actions tried, ${s.completed} completed, ${s.refused} not exercised on the generated board`,
    `Cards with nothing exercised: ${s.unexercised.length}${s.unexercised.length ? ` (e.g. ${s.unexercised.slice(0, 5).join("; ")})` : ""}`,
    `Resolved from the cards: ${s.resolved.spell} spells, ${s.resolved.activated} activated and ${s.resolved.triggered} triggered abilities; manual prompts of partial cards: ${s.manualPrompts}; phases not exercised because the permanent left the battlefield first: ${s.leftEarly}`,
    `Failures: ${s.failures.length} (EngineBug ${s.byKind.EngineBug}, exception ${s.byKind.exception}, invariant ${s.byKind.invariant}, unexpected manual ${s.byKind['unexpected-manual']}, stuck ${s.byKind.stuck})`,
  ];
  for (const f of s.failures.slice(0, top)) out.push(`  ${f.kind} ${f.card} [${f.phase}: ${f.action}]: ${f.message}`);
  return out;
}
