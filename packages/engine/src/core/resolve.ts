/**
 * Resolving the top object of the stack (CR 608). Owner: WP10.
 *
 * Instants, sorceries and abilities go to the effect interpreter (effects/run.ts#resolveStackObject, design 8.3): one program over the chosen modes, the
 * intervening "if" (CR 608.2a), ONE target check (CR 608.2b), the steps in order (CR 608.2c), then the object leaves the stack (CR 608.2n) by milestone 3's
 * layout rules. A step the engine can't perform yet, and a manual ability, raise a `manualResolve` decision: the controller reads the text and adjusts the
 * game by hand (docs/ARCHITECTURE.md). Permanent spells (CR 608.3) are resolved here: they enter the battlefield, an Aura attached to its target (CR 303.4f).
 */
import { setLink } from '../statics/links';
import type { AltCostDelay, EffectProgram, KeywordAbilityDef, TargetSpec } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject } from '../types/state';
import { auraRestriction, isAura } from '../rules/attachment';
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
  // edh-top-2 (CR 702.99a, 702.99c; cipher): as the spell resolves, its controller may exile the card encoded on a creature they control. The card goes from the stack
  // straight to exile (never the graveyard: no replacement of "put into a graveyard" competes, flashback changes nothing); only a spell that is a card (a copy of a spell
  // is not represented by one). The static ability of the card that functions in exile reads the link `encoded` (keywords/data/cipher.json).
  if (resolved && obj.kind === 'card' && half && hasKeyword(half, 'cipher')) {
    const options = g.s.zones.battlefield.filter((id) => { const o = g.s.objects[id]; return o !== undefined && o.controller === obj.controller && !o.phasedOut && charsOfObject(g.s, o).types.includes('Creature'); });
    if (options.length > 0) {
      const host = g.choose({ kind: 'chooseObjects', player: obj.controller, prompt: `${faceChars(def, info.face ?? 0).name}: you may exile it encoded on a creature you control.`, options, min: 0, max: 1, rules: ['CR 702.99a'] }).ids[0];
      if (host !== undefined && g.s.objects[host]?.zone === 'battlefield') {
        const n = moveObject(g, obj.id, 'exile', { cause: 'cipher' });
        const card = n === null ? undefined : g.maybeObj(n);
        if (card !== undefined && card.zone === 'exile') {
          setLink(card, 'encoded', { objects: [{ id: host, zone: 'battlefield' }] });
          g.log(`${g.nameOf(card.id)} is encoded on ${g.nameOf(host)}.`, { rules: ['CR 702.99a', 'CR 702.99b'], level: 'action' });
        }
        return;
      }
    }
  }
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
  const auraTarget = isAura(c) && auraRestriction(c) ? info.targets[0]?.[0] : undefined; // CR 303.4a
  // WP31, CR 303.4i: an Aura spell that can't legally be attached to what it targets ("can't be enchanted" effects, CR 101.2) doesn't enter the battlefield;
  // it is put into its owner's graveyard (CR 608.3e). The target itself was legal (CR 608.3b), so the spell resolves.
  const cantAttach = auraTarget && g.s.objects[auraTarget.id]?.zone !== 'graveyard' ? hookpoints.canAttach(gameOf(g.s), obj.id, auraTarget.id) : null; // edh-perms-4: protection and "can't be enchanted" are about permanents; an Aura that enchants a card in a graveyard (Animate Dead) is not stopped by them (CR 702.16a, 113.6)
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
  const keptGrants = info.isCopy === true ? [] : grantsKeptOnBattlefield(g, obj); // edh-next-144 (CR 400.7b, 611.3d)
  // trek-8 re-review (CR 702.190b, 508.4): a replacement effect that makes it enter attacking (Kira Nerys) joins the combat the way the sneak cost says
  const byBefore = g.enterAttackingBy;
  const how = info.entersAttacking;
  if (how) g.enterAttackingBy = (ids) => ids.filter((id) => entersAttackingAsReturned(g, id, how));
  // edh-d-77 (CR 607.2q, 614.1c; Murktide Regent): the cards a cost exiled are linked to the spell while it enters, so a replacement effect as it enters ("enters with a +1/+1 counter on it for
  // each instant and sorcery card exiled with it") reads them; the permanent records them under the link again below
  if (!info.isCopy) for (const [link, objects] of Object.entries(info.costsPaid.costLinks ?? {})) setLink(g.obj(oldId), link, { objects });
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
  keepGrants(g, newId, controller, keptGrants); // edh-next-144 (CR 400.7b, 611.3d)
  // FAST5X E11 (CR 607.2q): what a cost of the spell exiled for a linked ability ("behold a Goblin and exile it" ... "When this creature leaves the battlefield,
  // return the exiled card to its owner's hand") is remembered by the permanent the spell became, under that link. Only a cast spell paid that cost: a copy
  // (CR 707.10) links nothing (rules/stack-objects.ts#putCopyOnStack drops the links; this guard keeps it so).
  if (!info.isCopy) for (const [link, objects] of Object.entries(info.costsPaid.costLinks ?? {})) setLink(g.obj(newId), link, { objects });
  g.log(`${name} resolves and enters the battlefield under ${g.player(controller).name}'s control.`, { rules: ['CR 608.3', 'CR 608.3a'], level: 'info' });
  if (info.altDelay && info.costsPaid.alternative !== undefined) altCostDelay(g, info.altDelay, newId, controller, `${name}: its ${info.costsPaid.alternative.split(':')[0]} cost was paid`);
  if (info.offTimingSacrifice === true && info.isCopy !== true) offTimingSacrifice(g, newId, controller, name); // edh-perms-4 (CR 601.3b, 603.7)
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

/**
 * edh-perms-4 (CR 601.3b, 603.7, 701.21a; Necromancy): "If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the
 * next cleanup step": the static ability of the spell creates a delayed triggered ability as the permanent spell resolves (like warp's, `altCostDelay`). Its controller is the player who controlled
 * the spell; the permanent is captured with the zone it entered, so if it leaves the battlefield first it is a new object and the ability does nothing (CR 400.7); whoever controls the
 * permanent then sacrifices it, whoever controlled the spell.
 */
function offTimingSacrifice(g: Game, permanent: ObjectId, controller: PlayerId, name: string): void {
  const handle = { id: permanent, zone: 'battlefield' as const };
  const it = { ref: 'bound' as const, name: 'permanent' };
  createDelayedTrigger(g, {
    source: handle, controller, when: { at: 'step', step: 'cleanup' },
    do: [{ op: 'sacrificeChoice', who: { ref: 'controllerOf', object: it }, filter: { is: it }, count: 1 }],
    captured: { permanent: [handle] },
  });
  g.log(`${name} was cast at a time a sorcery couldn't have been cast: its controller sacrifices it at the beginning of the next cleanup step.`, { rules: ['CR 601.3b', 'CR 603.7'], level: 'info' });
}

/**
 * edh-next-144 (CR 400.7b, 611.3d, 702.152a; Henzie "Toolbox" Torre): the keywords a static ability grants to a permanent SPELL whose abilities include one that functions on the battlefield
 * ("Each creature spell you cast with mana value 4 or greater has blitz": "As long as this permanent's blitz cost was paid, it has haste and ..."): the permanent the spell becomes keeps that
 * ability for the rest of the game (no duration stated). Only the keywords of KEPT_ON_BATTLEFIELD (blitz); a keyword the card prints itself is not granted, so nothing is added for it.
 */
const KEPT_ON_BATTLEFIELD: ReadonlySet<string> = new Set(['blitz']);
function grantsKeptOnBattlefield(g: Game, spell: GameObject): KeywordAbilityDef[] {
  const out: KeywordAbilityDef[] = [];
  const abilities = charsOfObject(g.s, spell).abilities;
  // review finding (edh-next-144, CR 702.152b): a permanent with a blitz of its own keeps no granted one: each instance's "as long as its blitz cost was paid" can't tell which
  // instance was paid, so a second instance would give haste and the dies-draw twice
  const own = new Set(abilities.filter((a) => a.origin !== 'granted' && (a.def as KeywordAbilityDef).kind === 'keyword').map((a) => (a.def as KeywordAbilityDef).keyword));
  for (const a of abilities) {
    const d = a.def as KeywordAbilityDef;
    if (a.origin === 'granted' && d.kind === 'keyword' && KEPT_ON_BATTLEFIELD.has(d.keyword) && !own.has(d.keyword) && !out.some((x) => x.keyword === d.keyword) && !out.some((x) => JSON.stringify(x) === JSON.stringify(d))) out.push(structuredClone(d));
  }
  return out;
}
function keepGrants(g: Game, id: ObjectId, controller: PlayerId, kept: readonly KeywordAbilityDef[]): void {
  if (kept.length === 0) return;
  g.s.continuousEffects.push({
    id: g.newEffectId(), source: null, sourceName: g.nameOf(id), controller, timestamp: g.newTimestamp(), startedTurn: g.s.turn.number, duration: { d: 'permanent' },
    effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] }, mods: [{ layer: 6, add: kept.map((k) => structuredClone(k)) }] },
  });
  g.log(`${g.nameOf(id)} keeps ${kept.map((k) => k.keyword).join(', ')} granted to it as a spell (it functions on the battlefield).`, { rules: ['CR 400.7b', 'CR 611.3d'], level: 'info' });
}
