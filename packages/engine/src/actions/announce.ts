/**
 * The announcement steps shared by casting a spell and activating an ability (CR 601.2b-d, 602.2b):
 * choosing modes, the value of X, and targets. Every decision is cancellable (CR 733.1) unless another player makes it.
 * Targets, their counts, `distinctFrom`, `groupLimit`, `onlyIf`, `chooser` and the division (CR 601.2d) are in announce-targets.ts; the conditions read while
 * announcing are in announce-cond.ts. Owner: WP7.
 *
 * Modes (CR 601.2b, 700.2): the number of modes the card requires is never clamped to what is usable (a spell that cannot get its required modes is not
 * castable), a mode with its own cost (CR 700.2h) is checked together with the others chosen, and `override` (kicker, entwine) is read here.
 */
import type { CostDef, EffectProgram, ModeSpec, TargetSpec } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import { IllegalAction, IllegalAnswer, type Game } from '../core/game';
import { evalCount } from '../effects/eval';
import { countQuantityForms, programForms } from '../model/forms';
import { deny, type Denial } from '../rules/denial';
import { programHasTargets, specsFeasibility, TARGET_KINDS, type AnnouncedX } from '../rules/targets';
import { ANNOUNCE_READABLE, announceCond, announceQty, type AnnounceEnv } from './announce-cond';
import { modeInstances } from '../rules/mode-instances';
import { chooserOf, programWithFixedCounts, specRequired, specUnreadable } from './announce-targets';
import { readLink, setLink } from '../statics/links';
import { randomIndex } from '../rules/random';
import { syncHistory } from '../triggers/stack';
import { emitDilemma } from '../rules/crime';

export { announceTargets, chooseTargets, describeTargets, emitBecameTarget, specRequired, type AnnouncedTargets } from './announce-targets';
export type { AnnounceEnv } from './announce-cond';

/**
 * Features this module implements, WITHOUT the `feature:` prefix (design 5.2): the name of each field or value form of model/forms.ts that the announcement
 * code reads. `count.quantity` (a computed quantity as a count, a division total or a group limit) is not here: it waits for the evaluators of WP4
 * (`effects/eval.ts#evalCount`). `limit.combat` is not here: it needs a combat number the state does not keep yet. std-blb: `modes.repeatTargets` is here: a mode
 * chosen twice has one target list per instance (CR 700.2d), its later instances' target ids renamed (rules/mode-instances.ts, design 3.6: one list per id).
 *
 * The condition and player-reference names (`announce.*`, `ANNOUNCE_READABLE`) are as fine as what this code can really read: a Condition kind or a PlayerRef kind
 * that is missing there stays a missing capability even when WP4 can evaluate it while an effect resolves, so the degrade pass keeps such a card manual instead
 * of leaving it "full" and unplayable (design 15.1 item 5). Until a name is here, a spell or ability that uses the field is not offered (`unsupportedForms`,
 * `programsDenial`) instead of being played with the field ignored.
 */
export const FEATURES: readonly string[] = [
  'modes.override', 'modes.chooser', 'modes.cost',
  'modes.pawprints', // std-blb (CR 700.2i): chooseModes refuses a choice whose pawprints total more than the budget
  'modes.repeatTargets', // std-blb (CR 700.2d, 115.3): rules/mode-instances.ts
  'target.distinct', 'target.divide', 'target.groupLimit', 'target.sameOwner', 'target.differentNames', 'target.perOpponent', 'target.perPlayer' /* r5-fxb */, 'target.sharedCardType', 'target.onlyIf', 'target.chooser', 'target.random' /* p2-damage-2 */, 'target.playerRef',
  'activate.onlyIf', 'limit.game', 'activate.costChange',
  'activate.costChange.if', // r4-cost (CR 601.2f, 602.2b): "This ability costs {1} less to activate during your turn" (actions/activate.ts#costChangeOf)
  'activate.anyPlayer', // MX5: actions/activate.ts#activationDenialIn lets any player activate it (CR 602.2)
  'mana.whenSpent', // std-copy-3 (CR 106.6, 603.2): "When that mana is spent to cast ...": rules/mana.ts carries it on the mana, actions/cast.ts#manaSpentTriggers puts it on the stack
  'activate.xMin', // std-rx12 (CR 107.3a, 602.2b): "X can't be 0.": actions/activate.ts offers only values of X at least `xMin`
  'activate.uncopiable', // std-copy-1 (CR 707.10, 101.2): "This ability can't be copied.": effects/handlers/tokens-copy.ts#copySpells puts no copy of it onto the stack
  'activate.tapForMana', // std-rx27 (CR 601.2h, 602.2b): tap creatures rather than pay the generic mana of an activation cost (actions/activate.ts, rules/payment-options.ts)
  'activate.loyaltyX', // std-r9 (CR 606.4, 107.3a): "−X", announced as X and removed from the loyalty (rules/cost.ts#planFromCostDef)
  'target.sharedCreatureType', // CLOUD std-ecl: rules/targets.ts#sharedCreatureTypeHolds ("two target creature cards that share a creature type", CR 205.3m, 115.1)
  'target.differentControllers', // CLOUD std-tmt: actions/announce-targets.ts asks again when two targets have one controller (CR 115.1, 601.2c)
  'target.sameController', // std-rx30: actions/announce-targets.ts asks again when two targets have different controllers (CR 115.1, 601.2c)
  'target.perCardType', // std-cardcopy-7: actions/announce-targets.ts asks again when the targets can't be one of each card type (CR 115.1, 601.2c, 205.2a)
  'modes.unchosen', // r3-choose (CR 700.2, 603.3c): "choose one that hasn't been chosen [this turn]" (usedModes, rememberModes)
  'modes.triggerX', // r5-cost (CR 107.3m, 603.3c): a triggered ability's "choose up to X --" reads the X its source was cast with (modeLimits)
  'modes.random', // p2-modal-2 (CR 700.2): "choose one at random --" picks the modes with the game's random number generator (chooseModes); `override.chosen` lets the player choose
  ...ANNOUNCE_READABLE,
];

/** Whether this build honors a capability that `model/forms.ts` names (`target:<kind>` or `feature:<name>`). */
export function supportsForm(capability: string): boolean {
  if (capability.startsWith('target:')) return Object.hasOwn(TARGET_KINDS, capability.slice('target:'.length));
  if (capability.startsWith('feature:')) return FEATURES.includes(capability.slice('feature:'.length));
  return false;
}

/** The target kinds, fields and value forms of `program` (and of its modes) that this build can't announce yet. Empty = every spec can be read. */
export function unsupportedForms(program: EffectProgram): string[] {
  return programForms(program).filter((c) => !supportsForm(c));
}

/** The specs of a program, modes included. */
function allSpecs(p: EffectProgram): TargetSpec[] {
  return [...p.targets, ...(p.modes?.options.flatMap((o) => allSpecs(o.program)) ?? [])];
}

/**
 * CR 700.2: the programs that actually apply once modes are chosen. A modal program is replaced by its chosen modes, in PRINTED order (CR 700.2d, even if the
 * player named them in another order), followed by the ability's own targets and steps (design 3.6: "chosen modes run first, then `steps`").
 */
export function effectivePrograms(programs: EffectProgram[], modes: number[] | undefined): EffectProgram[] {
  const out: EffectProgram[] = [];
  for (const p of programs) {
    if (!p.modes) { out.push(p); continue; }
    const own = p.targets.length > 0 || p.steps.length > 0 ? [{ targets: p.targets, steps: p.steps }] : [];
    // r3-choose (CR 608.2c): "choose one that hasn't been chosen and you lose 2 life --": the ability's own instructions are written in the header, before the modes
    // (the parser and render/program.ts give an `unchosen` program steps only in that form)
    if (p.modes.unchosen !== undefined) out.push(...own);
    for (const inst of modeInstances(p, modes)) out.push(inst!.program); // std-blb (CR 700.2d): a repeated mode's later instances have their own target ids
    if (p.modes.unchosen === undefined) out.push(...own);
  }
  return out;
}

/** CR 700.2h: the additional costs of the chosen modes (Spree and the like), to be added to the total cost. A mode chosen twice pays its cost twice (CR 700.2d). */
export function modeCosts(programs: EffectProgram[], modes: number[] | undefined): CostDef[] {
  const out: CostDef[] = [];
  const modal = programs.find((p) => p.modes)?.modes;
  if (!modal) return out;
  for (const m of modes ?? []) {
    const c = modal.options[m]?.cost;
    if (c) out.push(c);
  }
  return out;
}

/**
 * The number of modes to choose once `override` has been read (kicked, entwined; CR 601.4, 702.42a), or null when the condition can't be read. r3-choose (CR 700.2,
 * 603.3c, 601.2b): a calculated number ("choose up to X, where X is the number of Lesson cards in your graveyard") is read now, on the board the modes are chosen on
 * (actions/announce-cond.ts#announceQty, as a calculated number of targets is); one that can't be read there gives null too.
 */
function modeLimits(env: AnnounceEnv, spec: ModeSpec): { min: ModeSpec['min']; max: ModeSpec['max'] } | null {
  const fixed = (c: ModeSpec['min']): ModeSpec['min'] | null => {
    // r5-cost (CR 107.3m, 603.3c): a triggered ability announces no X: its X is the X its source was cast with (the trigger's `x`, triggers/stack.ts), 0 for a
    // source not cast. A spell's or activated ability's X is announced after the modes (CR 601.2b): nothing to read yet, so it can't be chosen
    if (typeof c === 'object' && c.q === 'X') return env.modeMemory?.triggered === true ? (env.x ?? 0) : null;
    if (typeof c !== 'object') return c;
    // a count that only `feature:count.quantity` covers is not read here, as before (that capability is not advertised, so no such card is played)
    if (countQuantityForms(c).includes('feature:count.quantity')) return c;
    return announceQty(env, c) ?? null;
  };
  const counts = (l: { min: ModeSpec['min']; max: ModeSpec['max'] }): { min: ModeSpec['min']; max: ModeSpec['max'] } | null => {
    const min = fixed(l.min);
    const max = fixed(l.max);
    return min === null || max === null ? null : { min, max };
  };
  if (!spec.override) return counts(spec);
  // p2-modal-2 (CR 601.2b, 603.3c): the modes are chosen now, so "If you discarded a card this turn, ..." reads the turn's history so far (model/forms.ts, position 'mode')
  const ov = announceCond({ ...env, history: true }, spec.override.when);
  if (ov === undefined) return null;
  return counts(ov ? spec.override : spec);
}

/**
 * The state of X for the target checks of this announcement (rules/targets.ts#AnnouncedX): the announced X once there is one; before it (modes and optional
 * costs come first, CR 601.2b) unannounced, bounded by the largest payable X when the caller knows it (`xMax`, a legality check, CR 601.2c, 601.2h).
 */
export const announcedX = (aenv: AnnounceEnv | undefined): AnnouncedX => aenv?.x ?? (aenv?.xMax !== undefined ? { upTo: aenv.xMax } : 'unannounced');

/** The modes that have a legal target right now (CR 700.2a: a mode that would be illegal can't be chosen; one whose target reads X is legal if some X allows it). */
function modesWithTargets(s: GameState, spec: ModeSpec, player: PlayerId, sourceId: ObjectId, stackId: ObjectId | undefined, aenv: AnnounceEnv): boolean[] {
  // r3-choose (CR 700.2, `ModeSpec.unchosen`): ... and a mode the ability already had chosen ("choose one that hasn't been chosen") can't be chosen either
  const used = usedModes(s, spec, sourceId, aenv);
  return spec.options.map((o, i) => used !== null && !used.has(i) && programHasTargets(s, o.program, player, sourceId, stackId, (sp) => specRequired(aenv, sp), announcedX(aenv)));
}

/** r3-choose: where the modes an ability had chosen are remembered (`ModeSpec.unchosen`). */
const modesLink = (key: string): string => `modes:${key}`;
const turnKey = (sourceId: ObjectId, key: string, i: number): string => `${sourceId}|${modesLink(key)}:${i}`;

/**
 * r3-choose (CR 700.2, 400.7; `ModeSpec.unchosen`): the modes of "choose one that hasn't been chosen [this turn]" the ability of this object already had chosen: this
 * turn, in the record of this turn (`GameState.turnActivations`, reset every turn); ever, in the object's own link store (a new object after any zone change remembers
 * nothing, CR 400.7). Empty for modes that may repeat; null when the caller did not say which ability it is (`AnnounceEnv.modeMemory`): then no mode can be chosen.
 */
export function usedModes(s: GameState, spec: ModeSpec, sourceId: ObjectId, aenv: AnnounceEnv | undefined): Set<number> | null {
  if (spec.unchosen === undefined) return new Set();
  const key = aenv?.modeMemory?.key;
  if (key === undefined) return null;
  if (spec.unchosen === 'turn') return new Set(spec.options.map((_, i) => i).filter((i) => (s.turnActivations[turnKey(sourceId, key, i)] ?? 0) > 0));
  return new Set((readLink(s.objects[sourceId], modesLink(key))?.values ?? []).map(Number));
}

/** r3-choose: remember the modes just chosen for `ModeSpec.unchosen` (the ability is put on the stack with them, CR 603.3c, 602.2b). */
function rememberModes(s: GameState, spec: ModeSpec, sourceId: ObjectId, aenv: AnnounceEnv | undefined, chosen: readonly number[]): void {
  const key = aenv?.modeMemory?.key;
  if (spec.unchosen === undefined || key === undefined) return;
  if (spec.unchosen === 'turn') { for (const i of chosen) s.turnActivations[turnKey(sourceId, key, i)] = 1; return; }
  const o = s.objects[sourceId];
  if (o === undefined) return;
  const before = readLink(o, modesLink(key))?.values ?? [];
  setLink(o, modesLink(key), { values: [...new Set([...before, ...chosen.map(String)])] });
}

const MAX_COMBINATIONS = 3000;

/**
 * p2-modal-1 (CR 700.2, 115.3; unverified cites): "Each mode must target a different player." The parser gives each mode's player target a `distinctFrom` naming the
 * player targets of the modes printed before it (parser/lower/ability.ts#differentPlayerModes), so the targets of the chosen modes are announced as one set that
 * keeps them apart (announce-targets.ts). A SET of modes is then legal only if such a set of targets exists: true when the modes' targets name no other mode's.
 */
function crossModeDistinct(spec: ModeSpec): boolean {
  return spec.options.some((o, i) => o.program.targets.some((t) => (t.distinctFrom ?? []).some((id) => spec.options.some((q, j) => j !== i && q.program.targets.some((u) => u.id === id)))));
}

/** p2-modal-1: whether the chosen modes (indices) have a legal set of targets together; a search that gives up counts as legal (the targets are checked again). */
function modeSetFeasible(s: GameState, spec: ModeSpec, chosen: readonly number[], player: PlayerId, sourceId: ObjectId, stackId: ObjectId | undefined, aenv: AnnounceEnv): boolean {
  const specs = chosen.flatMap((i) => programWithFixedCounts(aenv, spec.options[i]!.program).targets);
  return specsFeasibility(s, specs, (sp) => specRequired(aenv, sp), player, sourceId, stackId, announcedX(aenv)) !== 'no';
}

/** p2-modal-1: some set of exactly `n` of the usable modes has a legal set of targets together (bounded like modesDenial; past the bound, optimistic). */
function someModeSetFeasible(s: GameState, spec: ModeSpec, usable: readonly number[], n: number, player: PlayerId, sourceId: ObjectId, stackId: ObjectId | undefined, aenv: AnnounceEnv): boolean {
  let leaves = 0;
  const pick = (start: number, chosen: number[]): boolean => {
    if (++leaves > MAX_COMBINATIONS) return true;
    if (chosen.length === n) return modeSetFeasible(s, spec, chosen, player, sourceId, stackId, aenv);
    for (let k = start; k < usable.length; k++) if (pick(k + 1, [...chosen, usable[k]!])) return true;
    return false;
  };
  return pick(0, []);
}

/**
 * Can the required number of modes (CR 601.2b, 700.2) be chosen AND paid for? `afford` says whether a set of mode costs (CR 700.2h) could be paid on top of
 * everything else. The fewest modes are the cheapest, so only sets of exactly `min` modes are tried (a bounded search; past the bound the answer is optimistic and the
 * choice itself is validated again when it is made). Pure: used by `castCheck`, `activationDenial` and the kicker / entwine affordability test.
 */
export function modesDenial(s: GameState, programs: EffectProgram[], player: PlayerId, sourceId: ObjectId, stackId: ObjectId | undefined, aenv: AnnounceEnv, afford?: (costs: CostDef[]) => boolean): Denial | null {
  const spec = programs.find((p) => p.modes)?.modes;
  if (!spec) return null;
  const limits = modeLimits(aenv, spec);
  if (!limits) return deny("This engine build can't check the condition that changes the number of modes, so it is not offered.", 'CR 601.2b', 'CR 700.2');
  const min = evalCount(limits.min, { x: 0 });
  if (min <= 0) return null;
  const ok = modesWithTargets(s, spec, player, sourceId, stackId, aenv);
  const usable = spec.options.map((_, i) => i).filter((i) => ok[i]);
  const short = deny(`It needs ${min} mode${min === 1 ? '' : 's'} that can be chosen and paid for, and there are not enough.`, 'CR 601.2b', 'CR 700.2', 'CR 700.2h');
  if (usable.length === 0 || (!spec.allowRepeat && usable.length < min)) return short;
  // p2-modal-1 (CR 700.2, 115.3): modes whose targets must differ from each other's need a set of `min` of them with a legal set of targets together
  if (!spec.allowRepeat && min > 1 && crossModeDistinct(spec) && !someModeSetFeasible(s, spec, usable, min, player, sourceId, stackId, aenv)) return short;
  const costOf = (i: number): CostDef[] => (spec.options[i]!.cost ? [spec.options[i]!.cost!] : []);
  if (!afford || usable.every((i) => costOf(i).length === 0)) return null;
  if (spec.allowRepeat) return usable.some((i) => afford(Array.from({ length: min }, () => costOf(i)).flat())) ? null : short;
  let leaves = 0;
  const pick = (start: number, chosen: number[]): boolean => {
    if (++leaves > MAX_COMBINATIONS) return true;
    if (chosen.length === min) return afford(chosen.flatMap(costOf));
    for (let k = start; k < usable.length; k++) if (pick(k + 1, [...chosen, usable[k]!])) return true;
    return false;
  };
  return pick(0, []) ? null : short;
}

/**
 * CR 601.2b: choose modes for the (first) modal program. Returns the chosen indices (printed order), or undefined if nothing is modal.
 * `aenv.costsPaid` holds the additional costs announced so far, so "if this spell was kicked, choose any number instead" and entwine are read here
 * (`ModeSpec.override`, CR 601.2b, 700.2, 702.42a); without `aenv` (a triggered ability, CR 603.3c) nothing has been paid. `affordModes` says whether a SET of
 * mode costs (CR 700.2h) could be paid on top of everything else: a mode whose cost can't be paid even alone is disabled, and a set that can't be paid together
 * is refused when it is chosen, with the decision still open. The required number of modes is never lowered to what is usable (CR 700.2): the caller's
 * `modesDenial` keeps such a spell from being cast, and reaching here with too few usable modes is an `IllegalAction`.
 */
export function chooseModes(
  g: Game, player: PlayerId, programs: EffectProgram[], sourceId: ObjectId, stackId: ObjectId, what: string, aenv?: AnnounceEnv, affordModes?: (costs: CostDef[]) => boolean,
): number[] | undefined {
  const modal = programs.find((p) => p.modes);
  if (!modal?.modes) return undefined;
  const spec = modal.modes;
  const env: AnnounceEnv = aenv ?? { s: g.s, player, sourceId, costsPaid: {} };
  // p2-modal-2 (CR 601.2b, 603.3c): an override that reads this turn's history ("If you discarded a card this turn, ...") sees everything that happened so far, also
  // when the modes are chosen in the middle of a resolution (a spell cast while another resolves): the history is written lazily (triggers/stack.ts#syncHistory)
  if (spec.override !== undefined && JSON.stringify(spec.override.when).includes('"happened"')) syncHistory(g);
  const limits = modeLimits(env, spec);
  if (!limits) throw new IllegalAction("This engine build can't check the condition that changes the number of modes.", ['CR 601.2b', 'CR 700.2']);
  const ok = modesWithTargets(g.s, spec, player, sourceId, stackId, env);
  const used = usedModes(g.s, spec, sourceId, env); // r3-choose
  const options = spec.options.map((o, i) => {
    const disabled = used !== null && used.has(i) ? `it has been chosen${spec.unchosen === 'turn' ? ' this turn' : ''}` : !ok[i] ? 'it has no legal targets' : o.cost && affordModes && !affordModes([o.cost]) ? "you can't pay its additional cost" : undefined;
    // std-blb (CR 700.2i): a mode with pawprints shows them before its text, as printed
    const label = spec.pawprints !== undefined ? `${'{P}'.repeat(o.pawprints ?? 0)} -- ${o.text}` : o.text;
    return { id: String(i), label, ...(disabled ? { disabled } : {}) };
  });
  const usable = options.filter((o) => !o.disabled).length;
  const min = evalCount(limits.min, { x: 0 });
  // r3-choose (CR 603.3c, 700.2): "choose one that hasn't been chosen" with every mode used: no mode can be chosen, so a triggered ability is removed from the stack
  if (spec.unchosen !== undefined && usable === 0 && aenv?.modeMemory?.triggered === true) return [];
  if (min > 0 && (usable === 0 || (!spec.allowRepeat && usable < min))) {
    throw new IllegalAction(`${what} needs ${min} mode${min === 1 ? '' : 's'} that can be chosen and paid for, and there are not enough.`, ['CR 601.2b', 'CR 700.2', 'CR 700.2h']);
  }
  const specMax = evalCount(limits.max, { x: 0 });
  const max = spec.allowRepeat ? (Number.isFinite(specMax) ? specMax : usable) : Math.min(specMax, usable);
  const costsOf = (ids: readonly number[]): CostDef[] => ids.flatMap((i) => (spec.options[i]!.cost ? [spec.options[i]!.cost!] : []));
  const refuseUnpayable = (ids: readonly number[]): void => {
    if (affordModes && !affordModes(costsOf(ids))) throw new IllegalAction('The modes you chose cost more together than you can pay (the cost of each chosen mode is added, CR 700.2h).', ['CR 700.2h', 'CR 118.3']);
  };
  // r5-cost (CR 700.2, 107.3m): "choose up to X --" with X = 0: no mode can be chosen (nothing to ask; a triggered ability with no mode is removed, CR 603.3c)
  if (min === 0 && max === 0) return [];
  // p2-modal-2 (CR 700.2; unverified cite): "choose one at random --": `min` of the modes that can be chosen, picked with the game's random number generator (design
  // 8.8), nobody asked; "If you discarded a card this turn, you choose one instead." (`override.chosen`): with the override's condition true the player chooses
  if (spec.random === true && !(spec.override?.chosen === true && announceCond({ ...env, history: true }, spec.override.when) === true)) {
    if (spec.allowRepeat || specMax !== min) throw new IllegalAction(`${what}: modes chosen at random other than a fixed number of them.`, ['CR 700.2']);
    const pool = options.filter((o) => !o.disabled).map((o) => Number(o.id));
    const picked: number[] = [];
    while (picked.length < min && pool.length > 0) picked.push(pool.splice(randomIndex(g, pool.length), 1)[0]!);
    picked.sort((a, b) => a - b);
    refuseUnpayable(picked);
    rememberModes(g.s, spec, sourceId, env, picked);
    return picked;
  }
  if (!spec.allowRepeat && min === max && usable === options.length && max === options.length) { // all modes: nothing to choose
    const all = options.map((o) => Number(o.id));
    refuseUnpayable(all);
    rememberModes(g.s, spec, sourceId, env, all);
    // trek-2 (CR 700.2, 601.2b): every mode is still chosen, by the player (an opponent who would choose is not asked here: no dilemma is guessed for them)
    if (all.length > 0 && spec.chooser === undefined) emitDilemma(g, player);
    return all;
  }
  const chooser = chooserOf(g, player, spec.chooser, sourceId, new Map());
  const ans = g.choose({
    kind: 'chooseOption',
    player: chooser,
    prompt: spec.pawprints !== undefined ? `Choose up to ${spec.pawprints} {P} worth of modes for ${what}.` : `Choose ${min === max ? (min === 1 ? 'a mode' : `${min} modes`) : `${min} to ${max} modes`} for ${what}.`,
    options,
    min,
    max,
    ...(spec.allowRepeat ? { allowRepeat: true } : {}),
    cancellable: chooser === player,
    rules: ['CR 601.2b', 'CR 700.2'],
  });
  const chosen = ans.ids.map(Number).sort((a, b) => a - b);
  // p2-modal-1 (CR 700.2, 115.3): "Each mode must target a different player": a set of modes with no legal set of targets together is refused and asked again
  // when a legal set of `min` or more modes exists, and is no legal choice otherwise (a triggered ability is then removed, CR 603.3c, 603.3d)
  if (!spec.allowRepeat && crossModeDistinct(spec) && !modeSetFeasible(g.s, spec, chosen, player, sourceId, stackId, env)) {
    const usableIds = options.filter((o) => !o.disabled).map((o) => Number(o.id));
    const message = `The modes you chose for ${what} must each target a different player, and there are not enough players to target.`;
    if (someModeSetFeasible(g.s, spec, usableIds, Math.max(min, 1), player, sourceId, stackId, env)) throw new IllegalAnswer(message, ['CR 700.2', 'CR 115.3']);
    throw new IllegalAction(message, ['CR 700.2', 'CR 115.3']);
  }
  refuseUnpayable(chosen);
  rememberModes(g.s, spec, sourceId, env, chosen); // r3-choose (CR 700.2, `ModeSpec.unchosen`; a mode chosen before is disabled above, so no answer, core/validate.ts)
  // std-blb (CR 700.2i, 700.2d): "Choose up to N {P} worth of modes": the pawprints of the chosen modes, each instance counted, total at most N
  if (spec.pawprints !== undefined) {
    const total = chosen.reduce((n, i) => n + (spec.options[i]!.pawprints ?? 0), 0);
    if (total > spec.pawprints) throw new IllegalAction(`The modes you chose have ${total} pawprints together; ${what} allows ${spec.pawprints}.`, ['CR 700.2i']);
  }
  // trek-2 (CR 700.2; "face a dilemma" is a new term, its rule number unverified): the player who chose one or more modes faced a dilemma ("Whenever you face a
  // dilemma", Seven of Nine). Choosing no mode ("choose up to one" with none chosen) is none.
  if (chosen.length > 0) emitDilemma(g, chooser);
  return chosen;
}

/**
 * CR 601.2b / 107.3a: the player announces the value of X. `max` is the largest X they could pay for. `allowed` (ascending) lists the values that can be paid
 * when they are not every value from 0 to `max` (an X in a cost part's filter, rules/cost.ts#payableXs): the choice ranges from the first to the last, and a
 * value in between that can't be paid is refused (CR 601.2h), with the decision still open.
 */
export function chooseX(g: Game, player: PlayerId, max: number, what: string, allowed?: readonly number[]): number {
  const min = allowed?.[0] ?? 0;
  if (max <= min) return Math.max(max, 0);
  const n = g.choose({
    kind: 'chooseNumber',
    player,
    prompt: `Choose a value for X for ${what}.`,
    min,
    max,
    cancellable: true,
    rules: ['CR 601.2b', 'CR 107.3a'],
  }).n;
  if (allowed && !allowed.includes(n)) throw new IllegalAction(`You can't pay the cost of ${what} with X = ${n}.`, ['CR 601.2h', 'CR 107.3a']);
  return n;
}

/**
 * Why these programs can't be announced right now, or null (CR 601.2c). Pure, never throws for a definition it can't read: a spec using a kind, field or value
 * form this build doesn't honor (`unsupportedForms`: target kinds, fields, computed counts, and the conditions and player references of `ANNOUNCE_READABLE`)
 * makes the spell or ability NOT OFFERED, with the reason, instead of letting it be played with the field ignored or crashing `legalActions` and the auto-pass
 * loop. A condition that passes that check but still can't be answered on this board (a life total of "an opponent" with several opponents) is refused the
 * same way: never read as false or as "not required". `noTarget` is the denial for a spec that has no legal target. `aenv` (the cast choices so far) decides which
 * conditional targets are required; without it a spec with an `onlyIf` is not required.
 */
export function programsDenial(s: GameState, programs: EffectProgram[], player: PlayerId, sourceId: ObjectId, noTarget: Denial, stackId?: ObjectId, aenv?: AnnounceEnv): Denial | null {
  const missing = [...new Set(programs.flatMap(unsupportedForms))];
  if (missing.length > 0) {
    const reading = missing.every((m) => m.startsWith('feature:announce.'));
    return deny(`This engine build can't ${reading ? 'read' : 'announce'} part of this yet (${missing.join(', ')}), so it is not offered.`, 'CR 601.2c', 'CR 115.1');
  }
  if (aenv && programs.some((p) => allSpecs(p).some((sp) => specUnreadable(aenv, sp)))) {
    return deny("This engine build can't read part of this yet (a condition of a target can't be answered here), so it is not offered.", 'CR 601.2c', 'CR 115.1');
  }
  return programsPlayable(s, programs, player, sourceId, stackId, aenv) ? null : noTarget;
}

/** Programs of `state` with no spec needing a choice: used by legality checks. */
export function programsPlayable(s: GameState, programs: EffectProgram[], player: PlayerId, sourceId: ObjectId, stackId?: ObjectId, aenv?: AnnounceEnv): boolean {
  const required = aenv ? (sp: TargetSpec): boolean => specRequired(aenv, sp) : undefined;
  // FAST5 T69: a calculated number of targets is read from the board as it is announced (announce-targets.ts#withFixedCounts)
  const env: AnnounceEnv = aenv ?? { s, player, sourceId, costsPaid: {} };
  return programs.every((p) => programHasTargets(s, programWithFixedCounts(env, p), player, sourceId, stackId, required, announcedX(aenv)));
}
