/**
 * CR 614.15 self-replacement: when "Y. If C, X instead." is the step `if C then [X] else [Y]` (WP23 review). Shared by the parser's "instead" fold
 * (parser/lower/riders.ts) and the renderer's "instead" reading (render/steps-flow.ts), so the gate never accepts a shape the parser would not build.
 *
 * X replaces Y as a whole only when it is the same instruction on the same things: one step each, the same op, the same player, the same objects, and a
 * difference only in an amount, a destination, a token, mana, a duration, or the numbers of one continuous effect ("gets +2/+2" / "gets +4/+4"). Anything else is a
 * partial replacement or another instruction ("each player draws ... you draw two instead", "you may X instead", another target, CR 601.2c, 608.2d) and
 * cannot be an `else` branch without a guess.
 */

/** Steps that are not one instruction: a choice, a payment, control flow, a trigger. Never one side of an "instead" fold. */
const NOT_ONE_INSTRUCTION: ReadonlySet<string> = new Set(['may', 'pay', 'if', 'forEach', 'repeat', 'let', 'delay', 'reflexive', 'manual', 'chooseObjects', 'search', 'vote']);

/**
 * Fields in which X may differ from Y (`sentence` is bookkeeping). CLOUD std-msh (CR 614.15, 611.2a): also the duration of the same instruction ("Gain control
 * of target creature until end of turn. If ..., gain control of that creature until the end of your next turn instead.", Evil's Thrall).
 */
// r4-repl (CR 614.15, 610.3): also how long a move's result lasts, "Exile that creature until ~ leaves the battlefield. If C, instead exile the chosen creature."
// (Turncoat Kunoichi: the same exile of the same object, without the return; `until` is the move's duration)
const REPLACEABLE_FIELDS: ReadonlySet<string> = new Set(['count', 'amount', 'units', 'to', 'token', 'sentence', 'duration', 'until']);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Canonical JSON (sorted keys, undefined dropped); with `numbers` false, the numbers inside `mods` (except the layer) are one value. */
function canon(v: unknown, numbers = true, inMods = false, key = ''): string {
  if (Array.isArray(v)) return `[${v.map((x) => canon(x, numbers, inMods, key)).join(',')}]`;
  if (!isRec(v)) return !numbers && inMods && key !== 'layer' && typeof v === 'number' ? '#' : (JSON.stringify(v) ?? 'undefined');
  // FAST5 T56 (CR 614.15, 702.34a): "gains flashback {0} until end of turn instead" replaces the cost of the keyword the earlier sentence granted ("equal to its mana cost"): the
  // cost of a granted keyword is an amount like the numbers of a modification, so it is one value too (the keyword itself, and the objects and duration, are not)
  const costless = !numbers && inMods && v['kind'] === 'keyword';
  return `{${Object.keys(v).filter((k) => v[k] !== undefined && !(costless && (k === 'cost' || k === 'costIsManaCost' || k === 'text'))).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k], numbers, inMods || k === 'mods', k)}`).join(',')}}`;
}

/**
 * FAST5X E1: a condition decided when the spell is cast (its cast record: kicker, bargain, gift, CR 601.2b, 607.2i-j). "Y. If [it], X instead." with such a
 * condition is a choice between two instructions made at announcement: the spell has X's targets only if the condition holds and Y's only if it does not
 * (CR 601.2c, 702.166d, 702.174m; parser/lower/riders.ts gives Y's targets the negated condition), and nothing of Y is done when X is. So one instruction
 * may replace another one AS A WHOLE whatever its op and objects; a choice, a payment or control flow on either side is still refused.
 */
export function isCastChoice(c: unknown): boolean {
  if (!isRec(c)) return false;
  if (c['cond'] === 'not') return isCastChoice(c['of']);
  // r4-repl (CR 107.3, 601.2b): "if X is 10 or more" in a spell: X is announced as the spell is cast, before its targets (CR 601.2c), and never changes
  if (c['cond'] === 'compare' && isRec(c['left']) && c['left']['q'] === 'X' && Object.keys(c['left']).length === 1 && typeof c['right'] === 'number') return true;
  return c['cond'] === 'wasCast';
}

/**
 * FAST5X E19 (CR 601.2h, 603.3d, 614.15; opus): "Y. If five or more mana was spent to cast that spell, X instead." The mana spent to cast the triggering
 * spell was fixed when it was cast, before the ability triggered: the condition is decided before the ability is put on the stack and cannot change, so, as
 * with `isCastChoice`, one instruction may replace another as a whole whatever its op and objects ("this creature gets +3/+0 until end of turn. If ...,
 * put three +1/+1 counters on this creature instead"). Only when neither instruction has a target (no target needs a condition, CR 601.2c, 603.3d).
 */
export function isFixedChoice(c: unknown, y: unknown, x: unknown): boolean {
  if (!isRec(c) || c['cond'] !== 'compare' || hasTarget(y) || hasTarget(x)) return false;
  const left = c['left'];
  if (!isRec(left) || left['q'] !== 'spellManaSpent' || typeof c['right'] !== 'number') return false;
  const of = left['of'];
  return isRec(of) && of['ref'] === 'event' && of['role'] === 'spell';
}

/** The objects a continuous-effect step affects and the layers it changes (CR 613.1), or null when it is not only continuous effects. */
function layersOf(step: Rec): { affects: string; layers: Set<string> } | null {
  const effects = step['effects'];
  if (!Array.isArray(effects) || effects.length === 0) return null;
  const affects = new Set<string>();
  const layers = new Set<string>();
  for (const e of effects) {
    if (!isRec(e) || e['s'] !== 'continuous' || !Array.isArray(e['mods'])) return null;
    affects.add(canon(e['affects']));
    for (const m of e['mods']) if (isRec(m)) layers.add(String(m['layer']));
  }
  return { affects: [...affects].sort().join('|'), layers };
}

/** FAST5 batch 5 merge (CR 614.15, 613.1): X changes the same objects as Y in fewer layers, every one of them a layer Y changes too. */
function replacesPartOfEffect(y: Rec, x: Rec): boolean {
  const a = layersOf(y);
  const b = layersOf(x);
  if (a === null || b === null || a.affects !== b.affects) return false;
  return b.layers.size < a.layers.size && [...b.layers].every((l) => a.layers.has(l));
}

const hasTarget = (v: unknown): boolean => (Array.isArray(v) ? v.some(hasTarget) : isRec(v) && (v['ref'] === 'target' || Object.values(v).some(hasTarget)));

/** Why X does not replace Y as a whole (CR 614.15), or null when it does. `castChoice`: the condition is decided at announcement (`isCastChoice`). */
export function notSelfReplacement(y: unknown, x: unknown, castChoice = false): string | null {
  if (!isRec(y) || !isRec(x)) return 'not a step';
  const op = y['op'];
  // FAST5X E11 (CR 614.15, 118.12): "Counter target spell unless its controller pays {2}. ... counter that spell unless its controller pays {4} instead": the
  // same offer to the same player with the same consequence, only another cost to pay (the amount of the payment is what "instead" replaces)
  if (op === 'pay' && x['op'] === 'pay') {
    for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
      if (k === 'cost' || k === 'sentence') continue;
      if (canon(y[k]) !== canon(x[k])) return `X changes ${k} of the payment, not only its cost`;
    }
    return null;
  }
  // r4-repl (CR 614.15, 608.2c): "Put one of those cards into your hand. If C, put two of those cards into your hand instead.": the same choice by the same player
  // from the same cards with another number of cards (`min` / `max`) is that choice with another amount, nothing else
  if (op === 'chooseObjects' && x['op'] === 'chooseObjects') {
    for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
      if (k === 'min' || k === 'max' || k === 'sentence') continue;
      if (canon(y[k]) !== canon(x[k])) return `X changes ${k} of the choice, not only how many objects are chosen`;
    }
    return null;
  }
  if (typeof op !== 'string' || NOT_ONE_INSTRUCTION.has(op)) return `the replaced instruction is a ${String(op)} step, not one instruction`;
  // FAST5 batch 5 merge (CR 614.15: "part or all" of the effect; CR 613.1): "Until end of turn, target artifact or creature becomes an artifact creature with
  // base power and toughness 4/3. If evidence was collected, it has base power and toughness 1/1 until end of turn instead." (Behind the Mask): a continuous
  // effect on the same objects that changes only some of the layers the replaced one changes replaces only that part; as a whole it would drop the rest
  // (here the type change), so the fold is refused even with a condition decided at announcement
  if (castChoice && op === 'effect' && x['op'] === 'effect' && replacesPartOfEffect(y, x)) return 'X changes only some of the layers of the continuous effect it replaces';
  // r4-repl (CR 608.2c, 601.2b): the new instructions may include a choice of objects that a later one of them acts on ("untap up to five lands"): it is part of
  // doing them, not an option to do them or not (a `may` or a payment on either side is still refused)
  // trek-8 (CR 614.15, 601.2c, 608.2c): or a "for each" over the objects it names ("If this spell was kicked, instead for each creature target opponent controls, create
  // a token that's a copy of that creature"): the loop is the whole of what is done in place of Y, chosen at announcement like any other instruction
  if (castChoice) return typeof x['op'] !== 'string' || (NOT_ONE_INSTRUCTION.has(x['op']) && x['op'] !== 'chooseObjects' && x['op'] !== 'forEach') ? `the new instruction is a ${String(x['op'])} step, not one instruction` : null;
  if (x['op'] !== op) return `another instruction (${String(x['op'])} for ${op})`;
  for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
    if (REPLACEABLE_FIELDS.has(k)) continue;
    // one continuous effect with other numbers ("gets +4/+4 instead"); another modification or another object is not that
    const numbersOnly = op === 'effect' && k === 'effects';
    if (canon(y[k], !numbersOnly) !== canon(x[k], !numbersOnly)) return `X changes ${k}, not only an amount or a destination`;
  }
  return null;
}

/** `if C then [X] else [Y]` reads "Y. If C, X instead." (CR 614.15). */
export const isSelfReplacement = (then: readonly unknown[], els: readonly unknown[], castChoice = false): boolean =>
  // FAST5X E11: a choice made at announcement may replace one instruction with several (parser/lower/riders.ts#applyRider)
  (then.length === 1 || (castChoice && then.length > 1)) && els.length === 1 && then.every((x) => notSelfReplacement(els[0], x, castChoice) === null);

/*
 * CLOUD C9 (CR 608.2c, 614.15; rules unverified in this checkout): an "instead" sentence that replaces a different instruction, or a whole sentence of several
 * instructions. In spell text "Y. If C, [instead] X [instead]." says X is done in place of the instruction(s) of the sentence before it, decided as the ability
 * resolves (CR 608.2c); it is the self-replacement of CR 614.15, not a replacement effect that watches an event (CR 614.1a). What X replaces is decided from the
 * sentence structure only, and only when that leaves one reading:
 *   - one instruction by ANOTHER instruction on the same objects ("All creatures get -2/-2 until end of turn. If C, destroy all creatures instead.", "Target
 *     creature gets +2/+2 until end of turn. If C, instead put two +1/+1 counters on it."): X names again exactly the objects Y acts on, so it replaces Y and
 *     nothing else. Instructions on players only ("You gain 2 life. If C, draw two cards instead.") stay refused (WP23 review);
 *   - a search by a search of the same player, zone and result ("Search your library for a basic land card. If C, instead search your library for a creature
 *     card. Reveal that card, ..."): the description and the number of cards are what X changes (CR 701.23);
 *   - one instruction by several, each on the same objects as Y ("... gets +2/+2 until end of turn. If C, instead put a +1/+1 counter on it and it gets +1/+1
 *     until end of turn.");
 *   - a sentence of several instructions by a sentence that restates it instruction for instruction, the same ops in the same order ("Search ..., reveal it, put
 *     it into your hand, then shuffle. If C, instead search ..., put it into your hand, then shuffle."): the whole sentence is replaced.
 * Under a condition decided as the ability resolves, X may not have a target Y does not have (it would be chosen as the spell is cast whether or not X is done,
 * CR 601.2c); a "may" on either side, a partial replacement (a subset of a group, some layers of an effect) and anything else stay refused (manual).
 */

/** The field naming the objects an instruction of each op acts on (CLOUD C9). `damage` names a recipient that may be a player: it is only ever compared with an
 *  instruction of ANOTHER op, which names objects, so an equal value is an object. */
const OBJECT_FIELD: Readonly<Record<string, string>> = {
  destroy: 'what', move: 'what', sacrifice: 'what', counter: 'what', tap: 'what', untap: 'what', phaseOut: 'what', regenerate: 'what', removeFromCombat: 'what',
  changeFace: 'what', putCounters: 'on', removeCounters: 'from', action: 'subject', damage: 'to',
};

/** CLOUD C9: the objects one instruction acts on (canonical JSON), or null when it is not one instruction on one set of objects. */
function objectsOf(step: Rec): string | null {
  const op = step['op'];
  if (op === 'effect') {
    const l = layersOf(step);
    return l !== null && !l.affects.includes('|') ? l.affects : null;
  }
  if (op === 'damage' && (step['also'] !== undefined || step['perSource'] !== undefined || step['divided'] !== undefined)) return null;
  const field = typeof op === 'string' && Object.hasOwn(OBJECT_FIELD, op) ? OBJECT_FIELD[op]! : undefined;
  const v = field === undefined ? undefined : step[field];
  return isRec(v) ? canon(v) : null;
}

/**
 * CLOUD C9: X is another instruction on exactly the objects Y acts on (each one instruction). With the same op only a continuous effect qualifies, and only
 * when it changes every layer Y changes ("it gets +1/+1 ... If C, it gets +2/+2 and gains indestructible ... instead"); one that changes fewer replaces only
 * part of Y (Behind the Mask, `replacesPartOfEffect`) and is refused.
 */
function otherInstructionOnSameObjects(y: Rec, x: Rec): boolean {
  if (typeof y['op'] !== 'string' || typeof x['op'] !== 'string' || NOT_ONE_INSTRUCTION.has(y['op']) || NOT_ONE_INSTRUCTION.has(x['op'])) return false;
  if (x['op'] === y['op']) {
    if (x['op'] !== 'effect') return false;
    const a = layersOf(y);
    const b = layersOf(x);
    return a !== null && b !== null && a.affects === b.affects && !a.affects.includes('|') && [...a.layers].every((l) => b.layers.has(l));
  }
  const a = objectsOf(y);
  return a !== null && a === objectsOf(x);
}

/** CLOUD C9 (CR 701.23): X is a search by the same player of the same zone with the same result name; only what is searched for (and how many) differs. */
function searchForSearch(y: Rec, x: Rec): boolean {
  return y['op'] === 'search' && x['op'] === 'search' && ['who', 'zone', 'owner', 'as'].every((k) => canon(y[k]) === canon(x[k]));
}

const targetIds = (v: unknown, out: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(v)) for (const x of v) targetIds(x, out);
  else if (isRec(v)) {
    if (v['ref'] === 'target' && typeof v['id'] === 'string') out.add(v['id']);
    for (const x of Object.values(v)) targetIds(x, out);
  }
  return out;
};

/** CLOUD C9 (CR 601.2c): X names a target that the replaced sentence Y does not. */
function newTarget(ys: readonly unknown[], xs: readonly unknown[]): boolean {
  const have = targetIds(ys);
  return [...targetIds(xs)].some((id) => !have.has(id));
}

/**
 * r4-repl (CR 614.15, 701.20e, 608.2c): `ys` is [a choice by you among a group G still in the library, the move of the chosen cards to Z, the move of the rest of G]
 * and `x` is the move of every card of G (still in the library) to Z: x does with every card what ys does with the chosen ones, so it replaces the whole sentence.
 */
export function everyCardInstead(ys: readonly Rec[], x: Rec): boolean {
  if (ys.length !== 3) return false;
  const [a, b, c] = ys as [Rec, Rec, Rec];
  if (a['op'] !== 'chooseObjects' || b['op'] !== 'move' || c['op'] !== 'move' || x['op'] !== 'move' || typeof a['as'] !== 'string') return false;
  const from = a['from'];
  const pool = isRec(from) && from['ref'] === 'each' && isRec(from['filter']) ? from['filter'] : null;
  if (pool === null || pool['zone'] !== 'library' || !isRec(pool['is']) || Object.keys(pool).some((k) => k !== 'is' && k !== 'zone')) return false;
  if (canon(b['what']) !== canon({ ref: 'bound', name: a['as'] }) || b['as'] !== undefined || c['as'] !== undefined || x['as'] !== undefined) return false;
  const rest = c['what'];
  if (!isRec(rest) || rest['ref'] !== 'each' || !isRec(rest['filter']) || canon(rest['filter']['is']) !== canon(pool['is']) || canon(rest['filter']['not']) !== canon({ is: { ref: 'bound', name: a['as'] } })) return false;
  return canon(x['what']) === canon({ ref: 'each', filter: { is: pool['is'], zone: 'library' } }) && canon(x['to']) === canon(b['to']) && Object.keys(x).every((k) => k === 'op' || k === 'what' || k === 'to' || k === 'sentence');
}

/** r4-repl: X is Y with another acting player (`who`, a player either way) and perhaps another amount, nothing else (one instruction each). */
function otherPlayerOnly(y: Rec, x: Rec): boolean {
  if (y['op'] !== x['op'] || typeof y['op'] !== 'string' || NOT_ONE_INSTRUCTION.has(y['op']) || !isRec(y['who']) || !isRec(x['who'])) return false;
  const players = new Set(['you', 'each', 'opponent', 'controllerOf', 'ownerOf', 'target', 'defending', 'activePlayer']);
  if (!players.has(String(y['who']['ref'])) || !players.has(String(x['who']['ref'])) || (x['who']['ref'] === 'target' && y['who']['ref'] !== 'target')) return false;
  for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
    if (k === 'who' || REPLACEABLE_FIELDS.has(k)) continue;
    if (canon(y[k]) !== canon(x[k])) return false;
  }
  return true;
}

/**
 * Why `if C then xs else ys` is not "ys. If C, [instead] xs [instead]." with the sentence `ys` replaced as a whole (CR 614.15, 608.2c), or null when it is.
 * The readings of WP23, FAST5X E1/E11/E19 (`notSelfReplacement`) and those of CLOUD C9 (the comment above). `castChoice`: `cond` is decided at announcement
 * (`isCastChoice`; the parser passes it only for a spell). Shared by parser/lower/riders.ts#applyRider and render/steps-flow.ts, so the gate never reads a
 * fold the parser would not build.
 */
export function notWideReplacement(ys: readonly unknown[], xs: readonly unknown[], cond: unknown, castChoice = false): string | null {
  if (ys.length === 0 || xs.length === 0 || !ys.every(isRec) || !xs.every(isRec)) return 'not a step';
  if (ys.length === 1) {
    const y = ys[0]!;
    // WP23 / FAST5X: one instruction replaced as a whole (E19: a condition fixed before the ability triggered allows any one; E11: at announcement, several)
    const why = xs.length === 1 || castChoice ? xs.map((x) => notSelfReplacement(y, x, castChoice || isFixedChoice(cond, y, x))).find((w) => w !== null) ?? null
      : '"instead" with several instructions';
    if (why === null) return null;
    if (!castChoice && newTarget(ys, xs)) return why;
    // CLOUD C9: a search by a search, another instruction on the same objects, or several instructions each on the same objects
    if (xs.length === 1 && (searchForSearch(y, xs[0]!) || otherInstructionOnSameObjects(y, xs[0]!))) return null;
    if (xs.length > 1 && xs.every((x) => otherInstructionOnSameObjects(y, x) || (x['op'] === y['op'] && notSelfReplacement(y, x) === null))) return null;
    return why;
  }
  // r4-repl (CR 614.15, 701.20e): "Put one of them into your hand and the rest on the bottom of your library in any order. Put each of those cards into your hand
  // instead if C." (Accumulate Wisdom): the choice among a group looked at, the move of the chosen cards and the move of the rest, replaced by the move of every
  // card of the group to where the chosen ones would go
  if (xs.length === 1 && everyCardInstead(ys, xs[0]!)) return null;
  // CLOUD C9: a sentence of several instructions is replaced only by a sentence that restates it instruction for instruction
  if (xs.length !== ys.length) return '"instead" after a sentence with several instructions';
  if (!castChoice && newTarget(ys, xs)) return 'X names a target the replaced sentence does not (CR 601.2c)';
  let changed = false;
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i]!;
    const x = xs[i]!;
    if (canon(y) === canon(x)) continue;
    changed = true;
    if (x['op'] !== y['op']) return `instruction ${i + 1} of X is another instruction (${String(x['op'])} for ${String(y['op'])})`;
    if (searchForSearch(y, x)) continue;
    const w = notSelfReplacement(y, x, castChoice);
    // r4-repl (CR 614.15, 608.2c): in a sentence restated instruction for instruction, an instruction may also name another player ("You draw two cards and lose
    // 2 life. If C, instead you draw two cards and each opponent loses 2 life."): the whole sentence is replaced, so which instruction X replaces is not a guess
    if (w !== null && !(ys.length > 1 && otherPlayerOnly(y, x))) return `instruction ${i + 1}: ${w}`;
  }
  return changed ? null : 'X repeats the sentence it replaces';
}

/** `if C then xs else ys` reads "ys. If C, [instead] xs [instead]." (CR 614.15; CLOUD C9: `notWideReplacement`). */
export const isWideReplacement = (then: readonly unknown[], els: readonly unknown[], cond: unknown): boolean =>
  notWideReplacement(els, then, cond, isCastChoice(cond)) === null;
