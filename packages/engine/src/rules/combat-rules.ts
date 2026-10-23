/**
 * The legality of attacking and blocking (CR 508.1, 509.1), as pure checks on GameState. The turn-based actions in core/combat.ts
 * offer only the choices these functions allow, and validate the whole declaration again before applying it.
 *
 * Restrictions imposed by other effects ("can't attack", "can't block", CR 508.1c, 509.1b) are asked of rules/hookpoints.ts (keywords and static
 * abilities); the evasion abilities and defender are keywords. Requirements ("attacks each combat if able", "must be blocked if able", CR 508.1d,
 * 509.1c) are counted over the whole declaration by rules/requirements.ts (R1, M6-7a), after these checks.
 */
import type { ObjectId, PlayerId } from '../types/ids';
import type { DeclareAttackersDecision, DeclareBlockersDecision } from '../types/decisions';
import type { GameObject, GameState } from '../types/state';
import { charsOfObject, type Chars } from './characteristics';
import { deny, type Denial } from './denial';
import { gameOf, hookpoints } from './hookpoints';
import { isSummoningSick } from './timing';
import { holdStill } from '../statics/stable-scope';
import { maxBlocks } from '../statics/hooks';

/** A creature's name for messages: a face-down creature has none (CR 708.2a). */
const nm = (c: Chars): string => c.name || 'a face-down creature';

const battlefield = (s: GameState): GameObject[] => s.zones.battlefield.map((id) => s.objects[id]!).filter(Boolean);

/**
 * CR 508.1a-b: what a creature may attack, or why nothing. Keyword and static restrictions (defender, CR 702.3b; "can't attack" effects) are asked of
 * rules/hookpoints.ts once per possible defender: the creature may be declared if it can attack at least one of them.
 */
function attackOptions(s: GameState, o: GameObject, c: Chars, defenders: readonly (PlayerId | ObjectId)[]): { denial: Denial | null; defenders: (PlayerId | ObjectId)[] } {
  if (o.zone !== 'battlefield' || !c.types.includes('Creature')) return { denial: deny('Only creatures can attack.', 'CR 506.3'), defenders: [] };
  if (c.types.includes('Battle')) return { denial: deny("A battle can't attack.", 'CR 508.1a'), defenders: [] };
  if (o.phasedOut) return { denial: deny("A phased-out permanent can't attack.", 'CR 702.26b'), defenders: [] };
  if (o.tapped) return { denial: deny('A tapped creature cannot attack.', 'CR 508.1a'), defenders: [] };
  // std-rq (CR 500.8, 508.1c): "Only land creatures can attack during that combat phase": an added combat phase that allows only some attackers
  if (!allowedAttacker(s, o)) return { denial: deny('Only some creatures can attack during this combat phase.', 'CR 508.1c', 'CR 500.8'), defenders: [] };
  const g = gameOf(s);
  const allowed: (PlayerId | ObjectId)[] = [];
  let veto: Denial | null = null;
  for (const defender of defenders) {
    const d = hookpoints.canAttack(g, o.id, defender);
    if (d) veto ??= d;
    else allowed.push(defender);
  }
  if (allowed.length === 0 && veto) return { denial: veto, defenders: [] };
  if (isSummoningSick(s, o, c)) return { denial: deny(`${nm(c)} came under your control this turn and has no haste.`, 'CR 508.1a', 'CR 302.6'), defenders: [] };
  return { denial: null, defenders: allowed };
}

/**
 * std-rq (CR 500.8, 508.1c): whether `o` may attack during the current combat phase as the attacker restriction of an added combat phase allows (none: any). The
 * creatures it allows were fixed as the declare attackers step began (core/turn-effects.ts#fixAllowedAttackers: nothing happens between that and the declaration).
 */
function allowedAttacker(s: GameState, o: GameObject): boolean {
  const only = s.turn.combatAttackers;
  return only === undefined || (only.allowed ?? []).includes(o.id);
}

/** CR 508.1a: a creature the active player may declare as an attacker. Returns null if it can attack, otherwise why not. `defenders` = everything that could be attacked. */
export function attackDenial(s: GameState, o: GameObject, c: Chars, defenders: readonly (PlayerId | ObjectId)[] = attackableBy(s, o.controller)): Denial | null {
  return attackOptions(s, o, c, defenders).denial;
}

/**
 * What a player's creatures may attack (CR 508.1b): each opponent still in the game, the planeswalkers they control, and the battles
 * they protect. Planeswalkers and battles are attacked by naming them (CR 506.3).
 */
export function attackableBy(s: GameState, attacker: PlayerId): (PlayerId | ObjectId)[] {
  const out: (PlayerId | ObjectId)[] = [];
  const opponents = s.players.filter((p) => p.id !== attacker && !p.hasLost).map((p) => p.id);
  out.push(...opponents);
  for (const o of battlefield(s)) {
    if (o.phasedOut) continue;
    const c = charsOfObject(s, o);
    if (c.types.includes('Planeswalker') && opponents.includes(o.controller)) out.push(o.id); // CR 506.2
    else if (c.types.includes('Battle') && o.protector !== undefined && opponents.includes(o.protector)) out.push(o.id); // CR 310.9b
  }
  return out;
}

/** CR 508.1a-b: the creatures the active player may attack with and what each may attack. Empty when nothing can attack. */
export function attackCandidates(s: GameState, player: PlayerId): DeclareAttackersDecision['candidates'] {
  return holdStill(s, () => attackCandidatesIn(s, player)); // P1: reads every creature of a state it does not change (one characteristics cache check)
}

function attackCandidatesIn(s: GameState, player: PlayerId): DeclareAttackersDecision['candidates'] {
  const defenders = attackableBy(s, player);
  if (defenders.length === 0) return [];
  const out: DeclareAttackersDecision['candidates'] = [];
  for (const o of battlefield(s)) {
    if (o.controller !== player) continue;
    const r = attackOptions(s, o, charsOfObject(s, o), defenders);
    if (r.denial) continue;
    out.push({ id: o.id, defenders: r.defenders });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * CR 509.1a-b: can this creature block that attacker, by itself? The evasion abilities of the attacker (flying and reach, shadow, horsemanship,
 * intimidate, fear, skulk, landwalk, protection) and "can't block" / "can't be blocked" effects are asked of rules/hookpoints.ts. Menace needs two
 * blockers and is checked on the whole declaration (`hookpoints.blockSetValid`). The defending player is the blocker's controller.
 */
export function blockDenial(s: GameState, blocker: GameObject, bc: Chars, attacker: GameObject, _ac: Chars, _defending: PlayerId): Denial | null {
  if (blocker.zone !== 'battlefield' || !bc.types.includes('Creature')) return deny('Only creatures can block.', 'CR 506.3');
  if (bc.types.includes('Battle')) return deny("A battle can't block.", 'CR 509.1a');
  if (blocker.tapped) return deny('A tapped creature cannot block.', 'CR 509.1a');
  if (blocker.phasedOut) return deny("A phased-out permanent can't block.", 'CR 702.26b');
  return hookpoints.canBlock(gameOf(s), blocker.id, attacker.id);
}

/** The attacking creatures that attack `defending` (or a planeswalker / battle they control or protect), in declaration order. */
export function attackersOf(s: GameState, defending: PlayerId): ObjectId[] {
  return (s.combat?.attackers ?? []).filter((a) => a.defendingPlayer === defending).map((a) => a.id);
}

/**
 * CR 509.1a-b: the creatures the defending player may block with and which attackers each can block. An attacker with menace is offered
 * only when at least two creatures could block it (CR 702.111b); `needsMultiple` names those attackers. `maxBlockers` names the attackers that can't be
 * blocked by more than some number of creatures (MX5, CR 509.1b), when that many fewer than the creatures able to block it.
 */
type BlockCandidates = {
  candidates: DeclareBlockersDecision['candidates']; needsMultiple: ObjectId[]; maxBlockers: { attacker: ObjectId; max: number }[];
  /** FAST5 T57: the attackers that can't be blocked except by three or more creatures (the fewest blockers a legal block of each has). */
  minBlockers: { attacker: ObjectId; min: number }[];
};

export function blockCandidates(s: GameState, defending: PlayerId): BlockCandidates {
  return holdStill(s, () => blockCandidatesIn(s, defending)); // P1: as attackCandidates
}

function blockCandidatesIn(s: GameState, defending: PlayerId): BlockCandidates {
  const attackers = attackersOf(s, defending).map((id) => s.objects[id]).filter((o): o is GameObject => o !== undefined && o.zone === 'battlefield');
  const attackerChars = new Map(attackers.map((a) => [a.id, charsOfObject(s, a)]));
  const per: { id: ObjectId; attackers: ObjectId[] }[] = [];
  for (const b of battlefield(s)) {
    if (b.controller !== defending) continue;
    const bc = charsOfObject(s, b);
    const can = attackers.filter((a) => !blockDenial(s, b, bc, a, attackerChars.get(a.id)!, defending)).map((a) => a.id);
    if (can.length > 0) per.push({ id: b.id, attackers: can });
  }
  // The block-set hook asked with 1, 2, ... of the creatures that could block each attacker (it judges the number of blockers, not which ones): attackers
  // that no single creature may block alone (menace, CR 702.111b) and attackers that can't be blocked by more than N creatures (MX5, CR 509.1b). An
  // attacker no number of them may legally block (menace with too few blockers, or menace and "can't be blocked by more than one creature") is not offered.
  const g = gameOf(s);
  const needsMultiple: ObjectId[] = [];
  const maxBlockers: { attacker: ObjectId; max: number }[] = [];
  const minBlockers: { attacker: ObjectId; min: number }[] = [];
  for (const a of attackers) {
    const able = per.filter((p) => p.attackers.includes(a.id)).map((p) => p.id);
    if (able.length === 0) continue;
    let lo = 0;
    let hi = 0;
    for (let n = 1; n <= able.length; n++) {
      if (hookpoints.blockSetValid(g, a.id, able.slice(0, n)) === null) { if (lo === 0) lo = n; hi = n; } else if (lo > 0) break; // a limit is an upper bound
    }
    if (lo === 0) { for (const p of per) p.attackers = p.attackers.filter((x) => x !== a.id); continue; }
    if (lo > 1) needsMultiple.push(a.id);
    if (lo > 2) minBlockers.push({ attacker: a.id, min: lo }); // FAST5 T57: "can't be blocked except by three or more creatures" (CR 509.1b)
    if (hi < able.length) maxBlockers.push({ attacker: a.id, max: hi });
  }
  // FAST4 T24 (CR 509.1a): "can block an additional creature each combat", "can block any number of creatures" (statics/hooks.ts#maxBlocks); a finite
  // number in the decision: at most the attackers it could block
  const candidates = per.filter((p) => p.attackers.length > 0).map((p) => ({ id: p.id, attackers: p.attackers, maxBlocks: Math.min(maxBlocks(s, p.id), p.attackers.length) }));
  const offered = (m: ObjectId): boolean => candidates.some((c) => c.attackers.includes(m));
  return { candidates, needsMultiple: needsMultiple.filter(offered), maxBlockers: maxBlockers.filter((x) => offered(x.attacker)), minBlockers: minBlockers.filter((x) => offered(x.attacker)) };
}

/**
 * CR 509.1a-b: does the whole declaration obey the restrictions? Each block must be allowed by itself (checked again here), a creature blocks at most as
 * many attackers as it can, and an attacker with menace is blocked by no creature or by at least two (CR 702.111b). The requirements (CR 509.1c) are the
 * second pure check, rules/requirements.ts#requirementsDenial on the `blockPlan` of the same state (R1, M6-7a); core/combat.ts asks both.
 */
export function blocksDenial(s: GameState, defending: PlayerId, blocks: { blocker: ObjectId; attacker: ObjectId }[]): Denial | null {
  const perAttacker = new Map<ObjectId, number>();
  const perBlocker = new Map<ObjectId, number>();
  for (const { blocker, attacker } of blocks) {
    const b = s.objects[blocker];
    const a = s.objects[attacker];
    if (!b || !a || b.controller !== defending) return deny('That creature cannot block.', 'CR 509.1a');
    if (!attackersOf(s, defending).includes(attacker)) return deny('That creature is not attacking you, a planeswalker you control or a battle you protect.', 'CR 509.1a');
    const d = blockDenial(s, b, charsOfObject(s, b), a, charsOfObject(s, a), defending);
    if (d) return d;
    perAttacker.set(attacker, (perAttacker.get(attacker) ?? 0) + 1);
    perBlocker.set(blocker, (perBlocker.get(blocker) ?? 0) + 1);
  }
  for (const [blocker, n] of perBlocker) {
    const max = maxBlocks(s, blocker); // FAST4 T24 (CR 509.1a)
    if (n > max) return deny(`${nm(charsOfObject(s, s.objects[blocker]!))} can block only ${max === 1 ? 'one creature' : `${max} creatures`}.`, 'CR 509.1a');
  }
  const g = gameOf(s);
  for (const attacker of perAttacker.keys()) {
    const d = hookpoints.blockSetValid(g, attacker, blocks.filter((x) => x.attacker === attacker).map((x) => x.blocker)); // CR 702.111b: menace
    if (d) return d;
  }
  return null;
}
