/**
 * R1 (M6-7a), M6-7: attack and block requirements (CR 508.1d, 509.1c) and the legality of a whole declaration.
 *
 * CR 508.1d / 509.1c: a declaration that obeys every restriction (CR 508.1c, 509.1b: rules/combat-rules.ts) is legal only if the number of requirements it
 * obeys equals the maximum number that any declaration obeying every restriction could obey. Requirements that could be obeyed only by paying a cost do not
 * count (CR 508.1d, 509.1c-d). The engine models no cost to attack or block and only some restrictions, but manual cards impose both (Ghostly Prison,
 * Silent Arbiter, Ironclaw Orcs): while manual text that mentions attacking or blocking is in play (rules/requirements-manual.ts), or a requirement the
 * engine can't evaluate applies (it counts toward the maximum too), the maximum is not known and nothing is enforced (below).
 *
 * The maximum is found by an exact search (design m6 3.9, D13) over the creatures that matter, with a node budget. Greedy is wrong as soon as a restriction
 * ties creatures together (CR 509.1c example: a creature that "blocks if able" and a creature with no abilities facing a menace attacker must BOTH block).
 *   - Attacks: the restrictions of this build are all about one creature at a time (rules/combat-rules.ts#attackOptions; "can't attack alone" and "no more
 *     than N creatures can attack" have no model and stay manual), so a creature without a requirement never changes how many can be obeyed: the search
 *     runs over the creatures with requirements, each attacking something or not.
 *   - Blocks: a block of one pair is legal by itself or not (rules/combat-rules.ts#blockCandidates), and a set of blockers of one attacker is legal or not
 *     (menace, `hookpoints.blockSetValid`). The search runs over the creatures with a block requirement, the creatures that could block an attacker that
 *     must be blocked, and the creatures that could join a block those make (menace); every other creature does not block (an attacker no creature blocks
 *     is never illegal), so the maximum is exact.
 * Unchecked (manual text, a requirement it can't evaluate, or over budget): the decision still lists the requirements and, within budget, a declaration
 * that obeys the most of them as hints, plus `uncheckedNotes` saying why, before the choice; the declaration is accepted (never a wrong rejection) and the
 * caller logs a manual line and leaves a reminder chip (design m6 3.9, 9.1 #7: never a silent pass).
 *
 * `beBlocked` without `other` means "blocked by at least one creature if able" (Gaea's Protector, CR 509.1c). Lure's "All creatures able to block
 * enchanted creature do so." is NOT that shape: it is one `block` requirement per able creature with `other` naming the lured creature
 * (`feature:require.other.block`, M6-7).
 *
 * M6-7: the other-creature forms (`RestrictionDef.other`, statics/requirements.ts) carry the objects they name as `among`: what the creature must attack
 * (a planeswalker or a battle), the attacker it must block (Hunt Down, Lure, Prized Unicorn), the creatures that must block it (`beBlocked`, "must be
 * blocked by a Dalek if able": obeyed by one blocker among them). A requirement none of whose `among` the creature could be paired with is not listed and
 * not counted (CR 508.1d, 509.1c: only requirements that can be obeyed count). The search gives each creature ONE choice; a creature that can block more
 * than one attacker (`maxBlocks` > 1, CR 509.1a) among the creatures that matter is beyond it, so that declaration is not checked (an `unenforced` note,
 * never a wrong rejection and never a silent pass).
 *
 * The rejecting checks are pure: rules/combat-rules.ts#attackDenial/blocksDenial for the restrictions (CR 508.1c, 509.1b) and `requirementsDenial` here
 * for the requirements (CR 508.1d, 509.1c), on the plan of the same state (R1 INTERFACE CHANGE of design m6 3.9, which named only the first two).
 */
import type { CombatRequirement, DeclareAttackersDecision, DeclareBlockersDecision } from '../types/decisions';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import { requirementHits, type RequirementHit } from '../statics/requirements';
import { holdStill } from '../statics/stable-scope';
import { charsOfObject } from './characteristics';
import { attackCandidates, attackersOf, blockCandidates } from './combat-rules';
import { deny, type Denial } from './denial';
import { gameOf, hookpoints } from './hookpoints';
import { manualCombatTexts, type ManualCombatText } from './requirements-manual';

export interface Attack {
  attacker: ObjectId;
  defender: PlayerId | ObjectId;
}
export interface Block {
  blocker: ObjectId;
  attacker: ObjectId;
}

/** Design m6 3.9: the node budget of the search. */
export const REQUIREMENT_SEARCH_BUDGET = 100_000;

/** A requirement the engine can't check (statics/requirements.ts `unenforced`): logged for the players, never enforced. */
export interface UnenforcedRequirement {
  sourceName: string;
  text: string;
  why: string;
}

/** What a declare decision carries about requirements, and what its answer is checked against. */
export interface DeclarationPlan<A> {
  /** The requirements that apply and could be obeyed by some declaration (CR 508.1d: "the maximum possible number"). */
  requirements: CombatRequirement[];
  /** How many of them a legal declaration obeys; null when the engine can't know (`unenforced`, `manual`, `overBudget`): nothing is enforced. */
  mustObey: number | null;
  /** A declaration that obeys the most requirements the engine sees without breaking a restriction it models (only a hint when `mustObey` is null); null over budget. */
  obeying: A[] | null;
  /** Requirements that apply but that the engine can't evaluate: they count toward the maximum (CR 508.1d), so none is enforced. */
  unenforced: UnenforcedRequirement[];
  /** Manual text that may restrict or put a cost on the declaration (CR 508.1d, 509.1c); looked for only when a requirement applies. */
  manual: ManualCombatText[];
  overBudget: boolean;
}

/** The plan from the requirements and what the search found (null: over budget). Enforced only when the engine sees everything that counts. */
function planOf<A>(requirements: CombatRequirement[], unenforced: UnenforcedRequirement[], manual: ManualCombatText[], found: { best: number; obeying: A[] } | null): DeclarationPlan<A> {
  const checked = found !== null && unenforced.length === 0 && manual.length === 0;
  return { requirements, mustObey: checked ? found.best : null, obeying: found ? found.obeying : null, unenforced, manual, overBudget: found === null };
}

// ---- The search -------------------------------------------------------------------------------------------------------------------------------------------

/** One requirement of a search problem: the variables it reads and whether an assignment of them obeys it. */
export interface SearchRequirement {
  vars: readonly number[];
  obeyed(a: readonly (string | null)[]): boolean;
}

/**
 * A maximization problem: each variable (a creature) takes one of its choices (what it attacks or blocks, `null` = nothing). `checkAfter(i, a)` is called
 * once variable `i` is set (variables 0..i are set) and returns false when a restriction decided by those variables is broken.
 */
export interface SearchProblem {
  choices: readonly (readonly (string | null)[])[];
  requirements: readonly SearchRequirement[];
  checkAfter?: (i: number, a: readonly (string | null)[]) => boolean;
  budget?: number;
}

export interface SearchResult {
  /** The maximum number of requirements obeyed by an assignment that passes every check. */
  best: number;
  witness: (string | null)[];
  nodes: number;
}

class OverBudget extends Error {}

/**
 * CR 508.1d, 509.1c: the maximum number of requirements obeyed by an assignment that breaks no restriction, by depth-first branch and bound (an exact
 * search: a branch is cut only when even obeying every undecided requirement could not beat the best found). Null when the budget runs out.
 */
export function maximize(p: SearchProblem): SearchResult | null {
  const n = p.choices.length;
  const budget = p.budget ?? REQUIREMENT_SEARCH_BUDGET;
  const total = p.requirements.length;
  // A requirement is decided once its last variable is set.
  const decidedAt: SearchRequirement[][] = Array.from({ length: n + 1 }, () => []);
  for (const r of p.requirements) decidedAt[r.vars.length === 0 ? 0 : Math.max(...r.vars) + 1]!.push(r);
  const a: (string | null)[] = new Array<string | null>(n).fill(null);
  let best = -1;
  let witness: (string | null)[] | null = null;
  let nodes = 0;
  const obeyedAt = (k: number): number => decidedAt[k]!.reduce((x, r) => x + (r.obeyed(a) ? 1 : 0), 0);
  const dfs = (i: number, obeyed: number, undecided: number): void => {
    if (obeyed + undecided <= best) return; // bound: this branch can't beat the best found
    if (i === n) {
      best = obeyed;
      witness = a.slice();
      return;
    }
    for (const c of p.choices[i]!) {
      if (++nodes > budget) throw new OverBudget();
      a[i] = c;
      if (p.checkAfter && !p.checkAfter(i, a)) continue;
      dfs(i + 1, obeyed + obeyedAt(i + 1), undecided - decidedAt[i + 1]!.length);
      if (best === total) return; // nothing can do better
    }
    a[i] = null;
  };
  try {
    dfs(0, obeyedAt(0), total - decidedAt[0]!.length);
  } catch (e) {
    if (e instanceof OverBudget) return null;
    throw e;
  }
  return witness ? { best, witness, nodes } : { best: 0, witness: new Array<string | null>(n).fill(null), nodes };
}

// ---- Requirements as decision data ---------------------------------------------------------------------------------------------------------------------

const PHRASE: Record<CombatRequirement['kind'], string> = { attack: 'attacks if able', block: 'blocks if able', beBlocked: 'must be blocked if able' };

function nameOf(s: GameState, id: ObjectId): string {
  const o = s.objects[id];
  return o ? charsOfObject(s, o).name || 'a face-down creature' : id;
}

/** The ability's text with its source's name for "~" (CR 201.5), or a description of a resolved effect. */
const textOf = (s: GameState, h: RequirementHit): string => (h.text ? h.text.replace(/~/g, h.sourceName) : `${nameOf(s, h.subject)} ${PHRASE[h.action]} (an effect of ${h.sourceName}).`);

function toRequirement(s: GameState, h: RequirementHit): CombatRequirement {
  const kind = h.action;
  const text = textOf(s, h);
  return { id: `req:${kind}:${h.key}`, creature: h.subject, kind, ...(h.among ? { among: [...h.among] } : {}), sourceName: h.sourceName, text };
}

function split(s: GameState, hits: RequirementHit[]): { enforced: RequirementHit[]; unenforced: UnenforcedRequirement[] } {
  const unenforced = hits.filter((h) => h.unenforced !== undefined).map((h) => ({ sourceName: h.sourceName, text: textOf(s, h), why: h.unenforced! }));
  return { enforced: hits.filter((h) => h.unenforced === undefined), unenforced };
}

/** Is the requirement obeyed by this declaration? `beBlocked`: by at least one blocker, one of `among` when set (CR 509.1c; Lure is not this shape). */
export function isObeyed(r: CombatRequirement, d: { attacks?: readonly Attack[]; blocks?: readonly Block[] }): boolean {
  const among = r.among;
  switch (r.kind) {
    case 'attack': return (d.attacks ?? []).some((x) => x.attacker === r.creature && (!among || among.includes(x.defender)));
    case 'block': return (d.blocks ?? []).some((x) => x.blocker === r.creature && (!among || among.includes(x.attacker)));
    case 'beBlocked': return (d.blocks ?? []).some((x) => x.attacker === r.creature && (!among || among.includes(x.blocker)));
  }
}

// ---- Attacks (CR 508.1d) ------------------------------------------------------------------------------------------------------------------------------------

/** CR 508.1d: the attack requirements of the active player's creatures that can attack, and the maximum a legal declaration obeys. */
export function attackPlan(s: GameState, candidates: DeclareAttackersDecision['candidates']): DeclarationPlan<Attack> {
  return holdStill(s, () => attackPlanIn(s, candidates));
}

function attackPlanIn(s: GameState, candidates: DeclareAttackersDecision['candidates']): DeclarationPlan<Attack> {
  const isPlayer = (d: PlayerId | ObjectId): boolean => s.players.some((p) => p.id === d);
  const objectDefenders = [...new Set(candidates.flatMap((c) => c.defenders).filter((d) => !isPlayer(d)))]; // what `other` can name (M6-7)
  const { enforced, unenforced } = split(s, requirementHits(s, 'attack', candidates.map((c) => c.id), objectDefenders));
  // CR 508.1d: a requirement to attack one of `among` that this creature can't attack can't be obeyed: not counted
  const canObey = (h: RequirementHit): boolean => !h.among || candidates.find((c) => c.id === h.subject)!.defenders.some((d) => h.among!.includes(d));
  const requirements = enforced.filter(canObey).map((h) => toRequirement(s, h));
  if (requirements.length === 0) return planOf<Attack>(requirements, unenforced, [], { best: 0, obeying: [] });
  const manual = manualCombatTexts(s, 'attack');
  const creatures = [...new Set(requirements.map((r) => r.creature))];
  const index = new Map(creatures.map((id, i) => [id, i]));
  // Without `among` any defender obeys, so one choice stands for all of them; with `among` every defender is a choice.
  const choices = creatures.map((id) => {
    const defenders = candidates.find((c) => c.id === id)!.defenders;
    const anyAmong = requirements.some((r) => r.creature === id && r.among);
    return [...(anyAmong ? defenders : defenders.slice(0, 1)), null];
  });
  const result = maximize({
    choices,
    requirements: requirements.map((r) => {
      const v = index.get(r.creature)!;
      return { vars: [v], obeyed: (a) => a[v] !== null && (!r.among || r.among.includes(a[v]!)) };
    }),
  });
  if (!result) return planOf<Attack>(requirements, unenforced, manual, null);
  const obeying = creatures.flatMap((id, i) => (result.witness[i] === null ? [] : [{ attacker: id, defender: result.witness[i]! }]));
  return planOf(requirements, unenforced, manual, { best: result.best, obeying });
}

// ---- Blocks (CR 509.1c) -------------------------------------------------------------------------------------------------------------------------------------

/** CR 509.1c: the block requirements that apply to this defending player's declaration, and the maximum a legal declaration obeys. */
export function blockPlan(s: GameState, attackers: readonly ObjectId[], candidates: DeclareBlockersDecision['candidates']): DeclarationPlan<Block> {
  return holdStill(s, () => blockPlanIn(s, attackers, candidates));
}

function blockPlanIn(s: GameState, attackers: readonly ObjectId[], candidates: DeclareBlockersDecision['candidates']): DeclarationPlan<Block> {
  const blockable = attackers.filter((a) => candidates.some((c) => c.attackers.includes(a))); // CR 509.1c: only requirements that could be obeyed count
  const blockHits = split(s, requirementHits(s, 'block', candidates.map((c) => c.id), blockable));
  const beHits = split(s, requirementHits(s, 'beBlocked', blockable, candidates.map((c) => c.id)));
  // CR 509.1c: a requirement no pairing of this declaration could obey is not counted (M6-7: the attacker it must block, the creatures it must be blocked by)
  const canAttackers = (id: ObjectId): ObjectId[] => candidates.find((c) => c.id === id)?.attackers ?? [];
  const canObey = (h: RequirementHit): boolean =>
    h.action === 'block' ? !h.among || canAttackers(h.subject).some((a) => h.among!.includes(a)) : candidates.some((c) => c.attackers.includes(h.subject) && (!h.among || h.among.includes(c.id)));
  const requirements = [...blockHits.enforced, ...beHits.enforced].filter(canObey).map((h) => toRequirement(s, h));
  const unenforced = [...blockHits.unenforced, ...beHits.unenforced];
  if (requirements.length === 0) return planOf<Block>(requirements, unenforced, [], { best: 0, obeying: [] });
  const manual = manualCombatTexts(s, 'block');

  // The creatures that matter: those with a block requirement, those that could block an attacker that matters (an attacker that must be blocked, or one a
  // creature with a requirement could block: another blocker may be needed to make that block legal, CR 702.111b).
  const required = [...new Set(requirements.filter((r) => r.kind === 'block').map((r) => r.creature))];
  const mustBeBlocked = new Set(requirements.filter((r) => r.kind === 'beBlocked').map((r) => r.creature));
  const relevant = new Set<ObjectId>([...mustBeBlocked, ...required.flatMap((id) => candidates.find((c) => c.id === id)!.attackers)]);
  const helpers = candidates.filter((c) => !required.includes(c.id) && c.attackers.some((a) => relevant.has(a))).map((c) => c.id);
  const vars = [...required, ...helpers];
  // M6-7: one choice per creature; a creature that matters and can block more than one attacker (CR 509.1a) is beyond the search: not checked, said so
  const multi = vars.filter((id) => (candidates.find((c) => c.id === id)!.maxBlocks ?? 1) > 1);
  const why = 'a creature that can block more than one attacker could obey more of them than the engine counts';
  for (const id of multi) unenforced.push({ sourceName: nameOf(s, id), text: `${nameOf(s, id)} can block more than one creature.`, why });
  const index = new Map(vars.map((id, i) => [id, i]));
  const choices = vars.map((id, i) => {
    const can = candidates.find((c) => c.id === id)!.attackers;
    if (i < required.length) return [...can, null];
    const useful = can.filter((a) => relevant.has(a));
    return [...useful.filter((a) => mustBeBlocked.has(a)), ...useful.filter((a) => !mustBeBlocked.has(a)), null];
  });

  // CR 509.1b: the blockers of one attacker as a set (menace), checked once every creature that could block it is decided; memoized per set.
  const g = gameOf(s);
  const memo = new Map<string, boolean>();
  const setValid = (attacker: ObjectId, blockers: ObjectId[]): boolean => {
    if (blockers.length === 0) return true;
    const key = `${attacker}|${[...blockers].sort().join(',')}`;
    let v = memo.get(key);
    if (v === undefined) memo.set(key, (v = hookpoints.blockSetValid(g, attacker, blockers) === null));
    return v;
  };
  const lastVar = new Map<ObjectId, number>();
  vars.forEach((_, i) => {
    for (const c of choices[i]!) if (c !== null) lastVar.set(c, i);
  });
  const closingAt: ObjectId[][] = vars.map(() => []);
  for (const [a, i] of lastVar) closingAt[i]!.push(a);
  const blockersOf = (a: readonly (string | null)[], attacker: ObjectId, upTo: number): ObjectId[] => vars.filter((_, j) => j <= upTo && a[j] === attacker);
  const checkAfter = (i: number, a: readonly (string | null)[]): boolean => closingAt[i]!.every((att) => setValid(att, blockersOf(a, att, i)));

  const result = maximize({
    choices,
    requirements: requirements.map((r) => {
      if (r.kind === 'block') {
        const v = index.get(r.creature)!;
        return { vars: [v], obeyed: (a) => a[v] !== null && (!r.among || r.among.includes(a[v]!)) };
      }
      const vs = vars.map((_, j) => j).filter((j) => choices[j]!.includes(r.creature) && (!r.among || r.among.includes(vars[j]!)));
      return { vars: vs, obeyed: (a) => vs.some((j) => a[j] === r.creature) };
    }),
    checkAfter,
  });
  if (!result) return planOf<Block>(requirements, unenforced, manual, null);

  // A smaller example: a helper whose block is not needed (the count and every set stay legal without it) does not block.
  const w = result.witness;
  const count = (a: readonly (string | null)[]): number => requirements.filter((r) => isObeyed(r, { blocks: toBlocks(vars, a) })).length;
  for (let i = vars.length - 1; i >= required.length; i--) {
    const was = w[i]!;
    if (was === null) continue;
    w[i] = null;
    if (count(w) < result.best || !setValid(was, blockersOf(w, was, vars.length - 1))) w[i] = was;
  }
  return planOf(requirements, unenforced, manual, { best: result.best, obeying: toBlocks(vars, w) });
}

const toBlocks = (vars: readonly ObjectId[], a: readonly (string | null)[]): Block[] => vars.flatMap((id, i) => (a[i] === null ? [] : [{ blocker: id, attacker: a[i]! }]));

/**
 * Design m6 3.9 contract: the requirements that apply to `player`'s declaration right now (CR 508.1d: the active player's creatures that can attack;
 * CR 509.1c: the defending player's creatures that can block and the attackers they could block), as the declare decision lists them.
 */
export function requirementsFor(s: GameState, kind: 'attack' | 'block', player: PlayerId): CombatRequirement[] {
  if (kind === 'attack') {
    const candidates = attackCandidates(s, player);
    return candidates.length === 0 ? [] : attackPlan(s, candidates).requirements;
  }
  const { candidates } = blockCandidates(s, player);
  return candidates.length === 0 ? [] : blockPlan(s, attackersOf(s, player), candidates).requirements;
}

/**
 * CR 508.1d, 509.1c: what the engine does not check in this plan, in words for the players: shown in the decision before the choice and logged (manual)
 * with a reminder chip after it. Empty when the requirements are enforced.
 */
export function uncheckedNotes(kind: 'attack' | 'block', plan: DeclarationPlan<Attack> | DeclarationPlan<Block>): { sourceName: string; text: string }[] {
  const rule = kind === 'attack' ? 'CR 508.1d' : 'CR 509.1c';
  const reqs = plan.requirements.map((r) => `"${r.text}"`).join('; ');
  const notes = plan.unenforced.map((u) => ({
    sourceName: u.sourceName,
    text: `"${u.text}" is not checked by the engine (${u.why}), so no requirement is checked for this declaration. Make sure it obeys as many requirements as possible (${rule}).`,
  }));
  if (plan.requirements.length === 0) return notes;
  for (const m of plan.manual) {
    // r5-static (CR 508.1c-d, 509.1b-d): a cost the engine charges, or a limit it enforces, is no manual text, but the search knows neither
    if (m.cost) {
      notes.push({
        sourceName: m.sourceName,
        text: `${m.sourceName}: "${m.text}" puts a cost or a limit on declarations, which the engine's count of requirements does not take into account (a requirement that could be obeyed only by paying a cost is not counted), so the requirements (${reqs}) are not checked. Obey as many of them as the rules allow (${rule}).`,
      });
      continue;
    }
    notes.push({
      sourceName: m.sourceName,
      text: `${m.sourceName}: "${m.text}" is not run by the engine and can change which declarations are legal, so the requirements (${reqs}) are not checked. Obey as many of them as the rules allow, counting restrictions and costs (${rule}).`,
    });
  }
  if (plan.overBudget) {
    const names = [...new Set(plan.requirements.map((r) => r.sourceName))].join(', ');
    notes.push({ sourceName: names, text: `There are too many ways to declare to check every requirement (${reqs}). Make sure the declaration obeys as many of them as possible (${rule}).` });
  }
  return notes;
}

// ---- Checking an answer ------------------------------------------------------------------------------------------------------------------------------------

/**
 * CR 508.1d, 509.1c: does the declaration (already known to obey every restriction) obey as many requirements as the plan's maximum? The denial names the
 * requirements the example obeys and the declaration does not.
 */
export function requirementsDenial(kind: 'attack' | 'block', plan: DeclarationPlan<Attack> | DeclarationPlan<Block>, decl: { attacks?: readonly Attack[]; blocks?: readonly Block[] }): Denial | null {
  if (plan.mustObey === null || plan.requirements.length === 0) return null;
  const obeyed = plan.requirements.filter((r) => isObeyed(r, decl));
  if (obeyed.length >= plan.mustObey) return null;
  const example = kind === 'attack' ? { attacks: plan.obeying as Attack[] } : { blocks: plan.obeying as Block[] };
  const missed = plan.requirements.filter((r) => isObeyed(r, example) && !isObeyed(r, decl)).map((r) => `"${r.text}" (${r.sourceName})`);
  const rule = kind === 'attack' ? 'CR 508.1d' : 'CR 509.1c';
  return deny(
    `This declaration obeys ${obeyed.length} of the requirements, but ${plan.mustObey} can be obeyed without breaking a restriction. Not obeyed: ${missed.join('; ')}.`,
    rule,
  );
}

/**
 * For clients and bots (pure, from the decision alone): the answer if it obeys as many requirements as the decision demands; otherwise, for attacks, the
 * answer plus the example's attacks of the creatures it left out (attack restrictions are per creature in this build), and for blocks the example itself.
 */
export function obeyRequirements(d: DeclareAttackersDecision, attacks: Attack[]): Attack[];
export function obeyRequirements(d: DeclareBlockersDecision, blocks: Block[]): Block[];
export function obeyRequirements(d: DeclareAttackersDecision | DeclareBlockersDecision, answer: Attack[] | Block[]): Attack[] | Block[] {
  const reqs = d.requirements ?? [];
  if (reqs.length === 0 || d.mustObey === undefined || !d.obeying) return answer;
  if (d.kind === 'declareAttackers') {
    const attacks = answer as Attack[];
    if (reqs.filter((r) => isObeyed(r, { attacks })).length >= d.mustObey) return attacks;
    const merged = [...attacks.filter((x) => !d.obeying!.some((y) => y.attacker === x.attacker)), ...d.obeying];
    return reqs.filter((r) => isObeyed(r, { attacks: merged })).length >= d.mustObey ? merged : d.obeying;
  }
  const blocks = answer as Block[];
  return reqs.filter((r) => isObeyed(r, { blocks })).length >= d.mustObey ? blocks : d.obeying;
}
