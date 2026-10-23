/**
 * Pure helpers for the combat prompts: default attack targets (CR 508.1b; M12-4b: none with several possible defenders in a multiplayer game, m12 design
 * D15), block toggling (CR 509.1a), damage division hints (CR 510.1c-d, 702.19b).
 */
import type { AssignDamageDecision, CombatRequirement, DeclareAttackersDecision, DeclareBlockersDecision, GameView } from '@openmtg/engine';
import { isPlayer } from './names';

/** What an attacker attacks unless the player picks something else: the first player it may attack, else the first planeswalker or battle. */
export function defaultDefender(view: GameView, defenders: readonly string[]): string | undefined {
  return defenders.find((id) => isPlayer(view, id)) ?? defenders[0];
}

/**
 * The attacks the prompt starts with: creatures that must attack (CR 508.1d) are already declared. M6-11 (M6-7): when the engine enforces the requirements
 * (`mustObey`), the declaration it found that obeys the most of them (`obeying`) is pre-selected, so a requirement to attack a particular player,
 * planeswalker or battle starts out obeyed; the player may still change it.
 */
export function initialAttacks(view: GameView, d: DeclareAttackersDecision): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of d.candidates) {
    const def = defaultDefender(view, c.defenders);
    if (c.mustAttack && def !== undefined) out[c.id] = def;
  }
  if (d.mustObey !== undefined) for (const x of d.obeying ?? []) if (d.candidates.some((c) => c.id === x.attacker && c.defenders.includes(x.defender))) out[x.attacker] = x.defender;
  return out;
}

/**
 * M12-4b (m12 design D15, 5.3 item 2): attacks in a multiplayer game. There is **no default target**: an attacker that may attack more than
 * one player, planeswalker or battle is declared without one (null: "needs a target") until the player picks it; an attacker with only one possible target
 * gets it. A two-player game never comes here (its prompt keeps `defaultDefender`, as before).
 */
export type MultiAttacks = Readonly<Record<string, string | null>>;

/** Is this a multiplayer game (CR 800.1: it began with more than two players; `options.multiplayer`, m12 design D1)? */
export function isMultiplayerView(view: GameView): boolean {
  return view.options.multiplayer !== undefined;
}

/** The target an attacker gets without asking: its only possible defender, else none (no default with several, D15). */
export function onlyTarget(defenders: readonly string[]): string | null {
  return defenders.length === 1 ? defenders[0]! : null;
}

/**
 * The attacks a multiplayer prompt starts with: creatures that must attack (CR 508.1d), and the attackers of the engine's obeying declaration when it
 * enforces the requirements (M6-11, CR 508.1d), are declared, each without a target unless it has only one: the player picks it (D15). The requirement
 * hint says which targets obey.
 */
export function initialMultiAttacks(d: DeclareAttackersDecision): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const c of d.candidates) if (c.mustAttack && c.defenders.length > 0) out[c.id] = onlyTarget(c.defenders);
  if (d.mustObey !== undefined)
    for (const x of d.obeying ?? []) {
      const c = d.candidates.find((k) => k.id === x.attacker);
      if (c && c.defenders.includes(x.defender) && out[c.id] === undefined) out[c.id] = onlyTarget(c.defenders);
    }
  return out;
}

/** Click on a creature: declare it as an attacker (without a target, unless it has only one), or take it back. */
export function toggleAttacker(attacks: MultiAttacks, d: DeclareAttackersDecision, id: string): Record<string, string | null> {
  if (attacks[id] !== undefined) {
    const { [id]: _gone, ...rest } = attacks;
    return rest;
  }
  const c = d.candidates.find((k) => k.id === id);
  return c && c.defenders.length > 0 ? { ...attacks, [id]: onlyTarget(c.defenders) } : { ...attacks };
}

/** The attackers still without a target, in the decision's order. */
export function untargeted(attacks: MultiAttacks, d: DeclareAttackersDecision): string[] {
  return d.candidates.filter((c) => attacks[c.id] === null).map((c) => c.id);
}

/** What the attackers without a target can be aimed at (the board's clickable defenders): their possible defenders, once each. */
export function aimable(attacks: MultiAttacks, d: DeclareAttackersDecision): string[] {
  const out: string[] = [];
  for (const c of d.candidates) if (attacks[c.id] === null) for (const def of c.defenders) if (!out.includes(def)) out.push(def);
  return out;
}

/** Click on a player's life disc or name plate, a planeswalker or a battle: every attacker without a target that may attack it now attacks it. */
export function aimAt(attacks: MultiAttacks, d: DeclareAttackersDecision, target: string): Record<string, string | null> {
  const out = { ...attacks };
  for (const c of d.candidates) if (out[c.id] === null && c.defenders.includes(target)) out[c.id] = target;
  return out;
}

/** "All at Bianca": every creature that can attack that player attacks them (the others keep what they had). */
export function allAt(attacks: MultiAttacks, d: DeclareAttackersDecision, target: string): Record<string, string | null> {
  const out = { ...attacks };
  for (const c of d.candidates) if (c.defenders.includes(target)) out[c.id] = target;
  return out;
}

/** "Attack with all": every creature that can attack is declared; those already declared keep their target, the others get one only if they have one choice. */
export function armAll(attacks: MultiAttacks, d: DeclareAttackersDecision): Record<string, string | null> {
  const out = { ...attacks };
  for (const c of d.candidates) if (out[c.id] === undefined && c.defenders.length > 0) out[c.id] = onlyTarget(c.defenders);
  return out;
}

/** The players every creature could be sent at together ("All at ..."): the opponents some candidate can attack, in the view's (turn) order. */
export function allAtPlayers(view: GameView, d: DeclareAttackersDecision): string[] {
  return view.players.filter((p) => d.candidates.some((c) => c.defenders.includes(p.id))).map((p) => p.id);
}

/**
 * The split a declaration makes, for its button: "Bianca (2), Carol (1)" (the count in parentheses: a name may end in a number, "Computer 3 (1)") (attackers per player; a planeswalker or a battle counts under its own name, after
 * the players), players in the view's (turn) order.
 */
export function attackSplit(view: GameView, attacks: MultiAttacks, name: (id: string) => string): string {
  const counts = new Map<string, number>();
  for (const t of Object.values(attacks)) if (t !== null) counts.set(t, (counts.get(t) ?? 0) + 1);
  const players = view.players.map((p) => p.id);
  const rank = (id: string) => {
    const i = players.indexOf(id);
    return i < 0 ? players.length : i;
  };
  return [...counts]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([t, n]) => `${name(t)} (${n})`)
    .join(', ');
}

export interface Block {
  blocker: string;
  attacker: string;
}

/** M6-11 (M6-7, CR 509.1c): the blocks the prompt starts with: the engine's obeying declaration when it enforces the requirements, otherwise none. */
export function initialBlocks(d: DeclareBlockersDecision): Block[] {
  if (d.mustObey === undefined || !d.obeying) return [];
  return d.obeying.filter((b) => d.candidates.some((c) => c.id === b.blocker && c.attackers.includes(b.attacker))).map((b) => ({ blocker: b.blocker, attacker: b.attacker }));
}

/**
 * Whether a declaration obeys one requirement (CR 508.1d, 509.1c), as the engine reads it (rules/requirements.ts): `attack` - the creature attacks (one of
 * `among`, when given); `block` - the creature blocks (one of `among`); `beBlocked` - the attacking creature is blocked by at least one creature (one of
 * `among`).
 */
export function requirementObeyed(r: CombatRequirement, decl: { attacks?: readonly { attacker: string; defender: string }[]; blocks?: readonly Block[] }): boolean {
  const ok = (id: string) => !r.among || r.among.includes(id);
  switch (r.kind) {
    case 'attack':
      return (decl.attacks ?? []).some((a) => a.attacker === r.creature && ok(a.defender));
    case 'block':
      return (decl.blocks ?? []).some((b) => b.blocker === r.creature && ok(b.attacker));
    case 'beBlocked':
      return (decl.blocks ?? []).some((b) => b.attacker === r.creature && ok(b.blocker));
    default:
      return false;
  }
}

/** Add or remove `blocker` blocking `attacker`; a creature that can block only one attacker moves its block instead of adding one (CR 509.1a). */
export function toggleBlock(blocks: readonly Block[], d: DeclareBlockersDecision, blocker: string, attacker: string): Block[] {
  if (blocks.some((b) => b.blocker === blocker && b.attacker === attacker)) return blocks.filter((b) => !(b.blocker === blocker && b.attacker === attacker));
  const max = d.candidates.find((c) => c.id === blocker)?.maxBlocks ?? 1;
  const mine = blocks.filter((b) => b.blocker === blocker);
  const rest = mine.length >= max ? blocks.filter((b) => b.blocker !== blocker || b !== mine[0]) : [...blocks];
  return [...rest, { blocker, attacker }];
}

/** Every attacker the defending player could block, in a stable order (the decision's candidates first, then the rest of combat). */
export function attackersOf(view: GameView, d: DeclareBlockersDecision): string[] {
  const out: string[] = [];
  for (const c of d.candidates) for (const a of c.attackers) if (!out.includes(a)) out.push(a);
  for (const a of view.combat?.attackers ?? []) if (!out.includes(a.id)) out.push(a.id);
  return out;
}

/** Attackers with menace (or similar) blocked by too few creatures: the engine will reject this declaration (CR 702.111b, 509.1b; FAST5 T57: "three or more"). */
export function underBlocked(d: DeclareBlockersDecision, blocks: readonly Block[]): string[] {
  return d.needsMultiple.filter((a) => {
    const n = blocks.filter((b) => b.attacker === a).length;
    return n > 0 && n < (d.minBlockers?.find((x) => x.attacker === a)?.min ?? 2);
  });
}

/**
 * The starting division of combat damage: each recipient that is not the trample target gets its lethal damage in order (CR 510.1c), the rest goes to the
 * player or permanent the attacker attacks when it has trample (CR 702.19b), otherwise to the first recipient.
 */
export function defaultAssignment(d: AssignDamageDecision): Record<string, number> {
  return allocateInOrder(d, d.recipients.map((r) => r.id));
}

/**
 * Auto allocation in the player's order (the damage screen's First ... Last): each creature in `order` gets lethal damage while
 * any is left, the rest goes to what the creature attacks with trample (CR 702.19b), else to the first creature. Recipients missing from `order` come last.
 */
export function allocateInOrder(d: AssignDamageDecision, order: readonly string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(d.recipients.map((r) => [r.id, 0]));
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const ranked = [...d.recipients].sort((a, b) => rank(a.id) - rank(b.id));
  let left = d.amount;
  for (const r of ranked) {
    if (r.trampleTarget) continue;
    const n = Math.min(left, r.lethal);
    out[r.id] = n;
    left -= n;
  }
  if (left > 0) {
    const sink = (d.canTrample ? ranked.find((r) => r.trampleTarget) : undefined) ?? ranked.find((r) => !r.trampleTarget) ?? ranked[0];
    if (sink) out[sink.id] = (out[sink.id] ?? 0) + left;
  }
  return out;
}

/** Why an assignment is not acceptable yet (null when it is): the total must match (CR 510.1) and trample needs lethal damage first (CR 702.19b). */
export function assignmentProblem(d: AssignDamageDecision, amounts: Readonly<Record<string, number>>): string | null {
  const values = d.recipients.map((r) => amounts[r.id] ?? 0);
  if (!values.every((n) => Number.isInteger(n) && n >= 0)) return 'Use whole numbers of 0 or more.';
  const total = values.reduce((a, b) => a + b, 0);
  if (total !== d.amount) return total < d.amount ? `${d.amount - total} damage left to assign.` : `${total - d.amount} damage too many.`;
  const target = d.recipients.find((r) => r.trampleTarget);
  if (target && (amounts[target.id] ?? 0) > 0) {
    const short = d.recipients.find((r) => !r.trampleTarget && (amounts[r.id] ?? 0) < r.lethal);
    if (short) return 'With trample, every blocker needs lethal damage before any goes to what the creature attacks (CR 702.19b).';
  }
  return null;
}

/** CR 601.2d: each target gets at least 1; the rest goes to the first target. */
export function defaultDivision(total: number, targets: number): number[] {
  if (targets === 0) return [];
  const out = Array<number>(targets).fill(1);
  out[0] = Math.max(1, total - (targets - 1));
  return out;
}
