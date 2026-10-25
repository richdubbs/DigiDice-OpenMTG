/**
 * Resolving the top object of the stack (CR 608). Owner: WP10.
 *
 * Instants, sorceries and abilities go to the effect interpreter (effects/run.ts#resolveStackObject, design 8.3): one program over the chosen modes, the
 * intervening "if" (CR 608.2a), ONE target check (CR 608.2b), the steps in order (CR 608.2c), then the object leaves the stack (CR 608.2n) by milestone 3's
 * layout rules. A step the engine can't perform yet, and a manual ability, raise a `manualResolve` decision: the controller reads the text and adjusts the
 * game by hand (docs/ARCHITECTURE.md). Permanent spells (CR 608.3) are resolved here: they enter the battlefield, an Aura attached to its target (CR 303.4f).
 */
import { setLink } from '../statics/links';
import type { AltCostDelay, EffectProgram, TargetSpec } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject } from '../types/state';
import { enchantRestriction, isAura } from '../rules/attachment';
import { charsOfObject, controllerOf, faceChars, hasKeyword, hasSubtype, isPermanentCard, type Chars } from '../rules/characteristics';
import { entersAttackingAsReturned } from '../rules/status';
import { recheckTargets } from '../rules/targets';
import { gameOf, hookpoints } from '../rules/hookpoints';
import { effectivePrograms } from '../actions/announce';
import { castRecordOf, spellPrograms } from '../actions/cast';
import { OP_HANDLERS } from '../effects/handlers'; // loading it installs the handler table into the interpreter
import { installLeaveStack, resolveStackObject } from '../effects/run';
import { EngineBug, type Game } from './game';
import { warnUnsupportedText } from './manual';
import { moveObject, shuffleLibrary, type MoveOptions } from './zones';
import { RESOLVE_PERMANENT_PARTS } from './registries';
import { createDelayedTrigger } from '../triggers/delayed';

/**
 * Where a spell goes when it leaves the stack without becoming a permanent (CR 608.2n). `resolved` is false when it did not resolve (CR 608.2a-b: it is put
 * into its owner's graveyard, it never resolved, so the "as it resolves" replacements of Adventures and Omens don't apply). Exile "any time it would leave
 * the stack" (flashback, aftermath) applies either way. These layout rules stay native in milestone 5 (design 15.3 ruling 8).
 */
export function leaveStack(g: Game, obj: GameObject, resolved: boolean): void {
  const info = obj.stack!;
  const def = g.s.defs[obj.defId]!;
  const half = info.fused ? undefined : faceChars(def, info.face ?? 0);
  if (info.costsPaid.alternative === 'flashback') {
    moveObject(g, obj.id, 'exile', { cause: 'flashback' }); // CR 702.34a
  } else if (info.exileOnLeave === true) {
    moveObject(g, obj.id, 'exile', { cause: 'exileOnLeave' }); // FAST5X E6: CR 702.180a (harmonize, StackInfo.exileOnLeave)
  } else if (half && info.castFrom === 'graveyard' && hasKeyword(half, 'aftermath')) {
    moveObject(g, obj.id, 'exile', { cause: 'aftermath' }); // CR 702.127a
  } else if (resolved && half && (info.face ?? 0) >= 1 && hasSubtype(half, 'Adventure')) {
    const n = moveObject(g, obj.id, 'exile', { cause: 'adventure' }); // CR 715.3d: only Adventures go to exile
    if (n) g.obj(n).chosen = { onAdventure: true };
  } else if (resolved && half && (info.face ?? 0) >= 1 && hasSubtype(half, 'Omen')) {
    // CR 720.3d: an Omen spell is shuffled into its owner's library as it resolves.
    const owner = obj.owner;
    moveObject(g, obj.id, 'library', { cause: 'omen' });
    shuffleLibrary(g, owner);
    g.log(`${half.name} is shuffled into ${g.player(owner).name}'s library.`, { rules: ['CR 720.3d'], level: 'info' });
  } else {
    moveObject(g, obj.id, 'graveyard', { cause: resolved ? 'resolve' : 'fizzle' }); // CR 608.2n, 608.2b
  }
}

installLeaveStack(leaveStack);
void OP_HANDLERS; // imported for its side effect: loading effects/handlers/index.ts installs the handler table into the interpreter

export function resolveTopOfStack(g: Game): void {
  const id = g.s.zones.stack[g.s.zones.stack.length - 1];
  if (!id) throw new EngineBug('resolveTopOfStack: the stack is empty');
  const obj = g.obj(id);
  if (obj.kind !== 'ability') {
    const c = charsOfObject(g.s, obj);
    if (isPermanentCard(c)) {
      resolvePermanentSpell(g, obj, c);
      return;
    }
  }
  resolveStackObject(g, obj);
}

const specsOf = (programs: EffectProgram[]): TargetSpec[] => programs.flatMap((p) => p.targets);

/**
 * CR 608.3: a permanent spell becomes a permanent. Its only targets are an Aura's (CR 303.4a); if it has targets and all are illegal it doesn't resolve
 * (CR 608.2b, 608.3b) and goes to its owner's graveyard.
 */
function resolvePermanentSpell(g: Game, obj: GameObject, c: Chars): void {
  const info = obj.stack!;
  const name = c.name;
  const programs = effectivePrograms(spellPrograms(c), info.modes);
  const specs = specsOf(programs);
  // M6-9 (CR 702.140b): the target a cast option added (mutate's, announced after the spell's own: actions/cast.ts) is not one of the spell's own targets: an
  // illegal mutate target makes the spell resolve as a creature spell (core/resolve-parts/mutate.ts), it never makes it fizzle
  const r = recheckTargets(g.s, specs, info.targets.slice(0, specs.length), obj.controller, info.sourceId ?? obj.id, obj.id);
  // std-ry7 (CR 702.103e, cite unverified): a bestowed Aura spell whose target is illegal as it resolves doesn't fizzle: it stops being bestowed and resolves as
  // the enchantment creature spell it is (the base characteristics are the card's again, rules/base-parts/bestow.ts), with no target
  if (obj.bestowed === true && r.total > 0 && r.legal === 0) {
    delete obj.bestowed;
    info.targets = [];
    g.log(`${name}'s target is illegal: it is no longer bestowed and resolves as a creature spell.`, { rules: ['CR 702.103e'], level: 'info' });
    resolvePermanentSpell(g, obj, charsOfObject(g.s, obj));
    return;
  }
  if (r.total > 0 && r.legal === 0) {
    g.log(`${name} fizzles: all of its targets are illegal.`, { rules: ['CR 608.2b'], level: 'info' });
    leaveStack(g, obj, false);
    return;
  }
  // CR 608.3a: a permanent spell becomes a permanent and enters the battlefield under its controller's control.
  const face = info.face ?? obj.face;
  const controller = obj.controller;
  const oldId = obj.id;
  const auraTarget = isAura(c) && enchantRestriction(c) ? info.targets[0]?.[0] : undefined; // CR 303.4a
  // WP31, CR 303.4i: an Aura spell that can't legally be attached to what it targets ("can't be enchanted" effects, CR 101.2) doesn't enter the battlefield;
  // it is put into its owner's graveyard (CR 608.3e). The target itself was legal (CR 608.3b), so the spell resolves.
  const cantAttach = auraTarget ? hookpoints.canAttach(gameOf(g.s), obj.id, auraTarget.id) : null;
  if (cantAttach) {
    moveObject(g, obj.id, 'graveyard', { cause: 'resolve' });
    g.emit({ type: 'resolved', objectId: obj.id });
    g.log(`${name} resolves but can't be attached to ${auraTarget!.kind === 'player' ? g.player(auraTarget!.id).name : g.nameOf(auraTarget!.id)}, so it is put into its owner's graveyard. ${cantAttach.message}`, { rules: ['CR 303.4i', 'CR 608.3e'], level: 'info' });
    return;
  }
  // M6-0 (m6 design 2.6): a resolve part may take the resolution over (a copy of a permanent spell becomes a token, CR 707.10f; mutating, CR 702.140c) or
  // change how it enters (face down, CR 708.4; transformed, CR 712.14; prototyped, CR 718.3c). Empty in M6-0.
  for (const p of RESOLVE_PERMANENT_PARTS) if (p.instead?.(g, obj)) return;
  let opts: MoveOptions = { face, controller, cause: 'resolve' };
  for (const p of RESOLVE_PERMANENT_PARTS) if (p.options) opts = p.options(g, obj, opts);
  if (info.entersAttacking) opts = { ...opts, tapped: true }; // FAST5X E7, CR 702.190b: "enters the battlefield tapped and attacking"
  const cast = castRecordOf(obj, g.s.turn.number); // CR 400.7d, 607.2i: the permanent remembers how its spell was cast (kicker, alternative cost, X)
  // trek-8 re-review (CR 702.190b, 508.4): a replacement effect that makes it enter attacking (Kira Nerys) joins the combat the way the sneak cost says
  const byBefore = g.enterAttackingBy;
  const how = info.entersAttacking;
  if (how) g.enterAttackingBy = (ids) => ids.filter((id) => entersAttackingAsReturned(g, id, how));
  let moved: ObjectId | null;
  try {
    moved = moveObject(g, oldId, 'battlefield', opts);
  } finally {
    g.enterAttackingBy = byBefore;
  }
  // WP11 INTERFACE CHANGE (review): the move goes through the proposal pipeline, which may forbid it ("can't enter", CR 614.17) or send it elsewhere (CR
  // 303.4g, 614.1a). CR 608.3e: a permanent spell that can't be put onto the battlefield is put into its owner's graveyard.
  if (moved === null && g.maybeObj(oldId)?.zone === 'stack') moveObject(g, oldId, 'graveyard', { cause: 'resolve' });
  const newId = moved !== null && g.maybeObj(moved)?.zone === 'battlefield' ? moved : null;
  g.emit({ type: 'resolved', objectId: oldId });
  if (!newId) {
    g.log(`${name} resolves but can't enter the battlefield; it is put into its owner's graveyard or where an effect sent it.`, { rules: ['CR 608.3e'], level: 'info' });
    return;
  }
  if (cast) g.obj(newId).cast = cast;
  // FAST5X E11 (CR 607.2q): what a cost of the spell exiled for a linked ability ("behold a Goblin and exile it" ... "When this creature leaves the battlefield,
  // return the exiled card to its owner's hand") is remembered by the permanent the spell became, under that link. Only a cast spell paid that cost: a copy
  // (CR 707.10) links nothing (rules/stack-objects.ts#putCopyOnStack drops the links; this guard keeps it so).
  if (!info.isCopy) for (const [link, objects] of Object.entries(info.costsPaid.costLinks ?? {})) setLink(g.obj(newId), link, { objects });
  g.log(`${name} resolves and enters the battlefield under ${g.player(controller).name}'s control.`, { rules: ['CR 608.3', 'CR 608.3a'], level: 'info' });
  if (info.altDelay && info.costsPaid.alternative !== undefined) altCostDelay(g, info.altDelay, newId, controller, `${name}: its ${info.costsPaid.alternative.split(':')[0]} cost was paid`);
  if (info.entersAttacking) entersAttackingAsReturned(g, newId, info.entersAttacking);
  if (newId && auraTarget) {
    // CR 303.4f: an Aura spell that resolves enters the battlefield attached to the object or player it was targeting.
    g.obj(newId).attachedTo = auraTarget.id;
    g.emit({ type: 'attached', objectId: newId, to: auraTarget.id }); // CR 701.3a "becomes attached" (WP14 INTERFACE CHANGE: triggers/forms.ts advertises it)
    g.log(`${name} is attached to ${auraTarget.kind === 'player' ? g.player(auraTarget.id).name : g.nameOf(auraTarget.id)}.`, { rules: ['CR 303.4f'], level: 'info' });
  }
  if (newId) warnUnsupportedText(g, newId); // never silently skip text the engine can't automate yet
}

/**
 * FAST5X E2 (CR 702.185a, 603.7a, 603.7d): "If this spell's warp cost was paid, exile the permanent this spell becomes at the beginning of the next end step":
 * the static ability of the alternative cost, which functions on the stack (CR 113.6d), creates its delayed triggered ability as the spell resolves. Its
 * controller is the player who controlled the spell; the permanent is captured with the zone it entered, so if it leaves the battlefield first it is a new
 * object and the ability does nothing to it (CR 400.7). A copy of the spell carries the costs paid (CR 707.10), so the token it becomes is exiled too.
 */
function altCostDelay(g: Game, delay: AltCostDelay, permanent: ObjectId, controller: PlayerId, why: string): void {
  const handle = { id: permanent, zone: 'battlefield' as const };
  createDelayedTrigger(g, { source: handle, controller, when: delay.when, do: delay.do, captured: { permanent: [handle] } });
  g.log(`${why}, so a delayed triggered ability is created.`, { rules: ['CR 702.185a', 'CR 603.7'], level: 'info' });
}
