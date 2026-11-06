/**
 * The `move` op (CR 400.7, 401.4, 610.3, 614.12; design 2.3 `Destination`): "exile target creature", "return it to its owner's hand", "put that card onto the
 * battlefield tapped under your control", "put them on the bottom of their owner's library in any order". Owner: WP14.
 *
 * Stages (design 8.6): the objects that can still be acted on; the destination evaluated once (controller, counters, position, what an entering Aura enchants);
 * the order of cards going to a library (CR 401.4: their owner arranges them); one `zoneChange` proposal per object (the performer calls `moveObject`); bindings
 * re-based onto the new objects (CR 400.7j); `link` stored on the source (CR 607.2a); `as` bound to the new objects.
 *
 * Forms this build does not run are resolved by hand, never approximated: a destination on the stack (that is casting or copying), and an `until` other
 * than the one below. The capability walker names them (`op:move.until.other`, `op:move.stack`) so a card that needs them is not classified as automated.
 * FAST4 MX1: "exile ... until ~ leaves the battlefield" (CR 610.3, `op:move.until`, OP_FORMS): if the source has already left the battlefield since the
 * ability triggered or was put onto the stack, nothing moves (CR 610.3a-b); otherwise the objects are exiled and a `GameState.untilMoves` record waits for
 * the source to leave (core/durations.ts), when they return (effects/until-return.ts, CR 610.3c-d). A source exiling itself is resolved by hand.
 * M6-3: face down (CR 406.3 exiled face down, CR 708.3 put onto the battlefield face down) is run; its capability is `layer:1b`.
 * Put onto the battlefield attacking: CR 508.4 (zones-util.ts).
 */
import { leavingTogether, renewedHandle } from '../../core/zones';
import { ceaseTokenInLibrary } from '../../core/sba-objects';
import { cardLine, seersOf } from '../../core/view';
import type { Destination, Duration, EffectStep, KeywordAbilityDef, ObjectFilter, ObjRef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameObject, LastKnown, ObjHandle, ZoneKind } from '../../types/state';
import { auraCanEnchantObject, auraCanEnchantPlayer, enchantRestriction, isAura, isEquipment, isFortification } from '../../rules/attachment';
import { faceChars, isPermanentCard, type Chars } from '../../rules/characteristics';
import { randomOrder } from '../../rules/random';
import type { DestinationFacts, ExecCtx, StepHandler, StepResult } from '../api';
import { performArrangeLibrary, performLink, performRenewLibrary } from '../perform';
import { performExiledSeers, performLookedAtExiled, performUntilMove } from '../perform-direct';
import { attachable } from './zones-status';
import { proposeMeasured } from './lifedamage';
import { closeEnteringGroup, ENTERING_TOGETHER } from '../entering-together';
import { evalCond } from '../eval';
import { filterCtxOf, isCurrent, resolveObjs, resolvePlayers } from '../refs';
import { matchesFilter } from '../../rules/filter';
import {
  actOn, addToLink, bindAs, bindMoved, byHand, enterAttacking, enteringAttacking, exiledLeavingStack, firstPlayer, libraryPosition, movedHandles, NOTHING, did, proposeMove, PUBLIC_ZONES, wholeNumber, type Moved,
} from './zones-util';

type Move = Extract<EffectStep, { op: 'move' }>;

/** FAST4 MX1: the value forms of `move` this handler runs (model/capabilities.ts; the walker names them, model/cap-walk.ts). */
export const OP_FORMS: readonly string[] = ['op:move.until', 'op:move.remember', 'op:move.attackingAsReturned', 'op:move.statusIf', 'op:move.countersIf.when' /* edh-c-6: CR 614.1c, 608.2c */, 'op:move.countersIf' /* edh-perms-10: CR 614.1c */, 'op:move.arrangedBy' /* p2-dig-1: CR 401.4 */, 'op:move.ownerChoosesEnd' /* edh-zones-21: CR 401.4, 400.3 */, 'op:move.endChosenBy' /* edh-c-107: CR 401.4, 400.3 */, 'op:move.attackingOrPlaneswalkers' /* edh-zones-22: CR 508.4 */, 'op:move.enchantOnly' /* edh-perms-21: CR 303.4f */, 'op:move.attachedToPlayer' /* edh-d-29: CR 303.4f */, 'op:move.faceUpOrDown' /* edh-next-80: CR 708.3 */, 'op:move.becomes' /* edh-next-125: CR 614.1c, 613.4b */, 'op:move.asAura' /* edh-next-140: CR 303.4f, 614.1c, 613.1d */]; // FAST5X E13: `remember` (craft, CR 702.167c); std-typechange-1: ninjutsu (CR 702.49c); std-typechange-2: `to.statusIf` (CR 608.2c, 508.4)

/**
 * FAST4 MX1 (CR 610.3): the one `until` a move runs: exiled until the source leaves the battlefield (`{d:'until', event:{ev:'zoneChange', subject:{self:true},
 * from:'battlefield'}}`, nothing else in the pattern). The capability walker uses the same test (model/cap-walk.ts#moveUntilForm), so a card with any
 * other form is never classified automated.
 */
/**
 * edh-perms-22 (CR 608.2c, 903.9; Flood of Tears, ruling 2019-07-12): `StepResult.attempted`, set only when a replacement effect put an object somewhere else than the destination (a commander
 * put into the command zone instead of the hand): every object the move was applied to as it last existed. Without such an object `before` says it all and nothing is added.
 */
function attemptedMore(moved: readonly Moved[], zone: string): { attempted?: LastKnown[] } {
  const all = moved.flatMap((m) => (m.before !== undefined ? [m.before] : []));
  const there = moved.filter((m) => m.before !== undefined && m.to?.zone === zone).length;
  return all.length > there ? { attempted: all } : {};
}

export function untilSourceLeaves(until: unknown, to: unknown): boolean {
  const u = (typeof until === 'object' && until !== null ? until : {}) as Record<string, unknown>;
  const e = (typeof u['event'] === 'object' && u['event'] !== null ? u['event'] : {}) as Record<string, unknown>;
  const subj = (typeof e['subject'] === 'object' && e['subject'] !== null ? e['subject'] : {}) as Record<string, unknown>;
  const dest = (typeof to === 'object' && to !== null ? to : {}) as Record<string, unknown>;
  return u['d'] === 'until' && Object.keys(u).length === 2 && e['ev'] === 'zoneChange' && e['from'] === 'battlefield' && Object.keys(e).sort().join() === 'ev,from,subject'
    && subj['self'] === true && Object.keys(subj).length === 1 && dest['zone'] === 'exile' && Object.keys(dest).length === 1;
}

/**
 * edh-next-136 (CR 610.3, 610.3a-b, 608.2b; Calix, Destiny's Hand, ruling 2020-01-24): exiled until ANOTHER object leaves the battlefield ("until target enchantment you
 * control leaves the battlefield"): `{d:'until', event:{ev:'zoneChange', subject:{is:<ObjRef>}, from:'battlefield'}}`, nothing else in the pattern. The object is read
 * as the move resolves: exactly one object on the battlefield (an illegal target is none, CR 608.2b); else the event has already happened and nothing is exiled (the
 * ruling). The record then waits for THAT object (as the source of an "until ~ leaves" record). The capability walker uses the same test (model/cap-walk.ts#moveUntilForm).
 */
export function untilObjectLeaves(until: unknown, to: unknown): boolean {
  const u = (typeof until === 'object' && until !== null ? until : {}) as Record<string, unknown>;
  const e = (typeof u['event'] === 'object' && u['event'] !== null ? u['event'] : {}) as Record<string, unknown>;
  const subj = (typeof e['subject'] === 'object' && e['subject'] !== null ? e['subject'] : {}) as Record<string, unknown>;
  const is = (typeof subj['is'] === 'object' && subj['is'] !== null ? subj['is'] : {}) as Record<string, unknown>;
  const dest = (typeof to === 'object' && to !== null ? to : {}) as Record<string, unknown>;
  return u['d'] === 'until' && Object.keys(u).length === 2 && e['ev'] === 'zoneChange' && e['from'] === 'battlefield' && Object.keys(e).sort().join() === 'ev,from,subject'
    && Object.keys(subj).length === 1 && (is['ref'] === 'target' || is['ref'] === 'bound') && dest['zone'] === 'exile' && Object.keys(dest).length === 1;
}

/**
 * edh-players-18 (CR 610.3, 725.3; Palace Jailer): the other `until` a move runs: exiled until a player becomes the monarch (`{d:'until', event:{ev:'monarch', player}}`,
 * nothing else in the pattern; the player an opponent of the controller or any player). The exile does not depend on the source (it may leave the battlefield; the objects
 * return when the next player becomes the monarch, not because one already is). The capability walker uses the same test (model/cap-walk.ts#moveUntilForm).
 */
export function untilMonarchBecomes(until: unknown, to: unknown): boolean {
  const u = (typeof until === 'object' && until !== null ? until : {}) as Record<string, unknown>;
  const e = (typeof u['event'] === 'object' && u['event'] !== null ? u['event'] : {}) as Record<string, unknown>;
  const dest = (typeof to === 'object' && to !== null ? to : {}) as Record<string, unknown>;
  return u['d'] === 'until' && Object.keys(u).length === 2 && e['ev'] === 'monarch' && Object.keys(e).length === 2 && (e['player'] === 'opponent' || e['player'] === 'any')
    && dest['zone'] === 'exile' && Object.keys(dest).length === 1;
}

/** The face a card enters the battlefield with (CR 712.13-712.14a): the face it had on the stack, its back face when put there "transformed", else the front. */
function enteringFace(g: ExecCtx['g'], o: GameObject, transformed: boolean): number | null {
  const def = g.s.defs[o.defId];
  if (!def) return null;
  if (transformed) {
    // CR 712.14a: only a double-faced card can enter transformed; any other card stays where it is.
    const dfc = def.faces.length === 2 && (def.layout === 'transform' || def.layout === 'modal_dfc' || def.layout === 'double_faced_token');
    return dfc ? 1 : null;
  }
  return o.zone === 'stack' ? o.stack?.face ?? o.face : o.zone === 'battlefield' ? o.face : 0;
}

/** CR 400.4a, 712.14b: an instant or sorcery (or a modal double-faced card whose entering face isn't a permanent) can't enter the battlefield. */
function canEnter(g: ExecCtx['g'], o: GameObject, face: number): Chars | null {
  const def = g.s.defs[o.defId];
  if (!def || face >= def.faces.length) return null;
  const c = faceChars(def, face);
  return isPermanentCard(c) ? c : null;
}

/**
 * Where the cards of one owner go in a library: `moves`, the order they are moved in (each move puts the card at `position`, so later moves end above
 * earlier ones), and `secret`, the order they must end in (first = highest) when nobody else may learn it. CR 401.4: the owner arranges them only when they
 * go to a specific position ("on top", "on the bottom", "second from the top") or the effect says "in any order"; cards put into a library at no particular
 * place ("shuffle ... into", the shuffle follows) or each at a random place are moved as listed, with no question.
 * H1 (CR 400.2, 401.4): an order chosen by the owner, or a random one, is not the order of the moves (the events and the log of each move are public): the
 * cards are moved as listed, then arranged (`core/zones.ts#arrangeInLibrary`).
 */
function libraryOrder(cx: ExecCtx, st: Move, owner: PlayerId, ids: ObjectId[]): { moves: ObjectId[]; secret: ObjectId[] | null } {
  const g = cx.g;
  if (ids.length < 2) return { moves: ids, secret: null };
  const specific = st.to.position !== undefined && st.to.position !== 'random';
  let topToBottom: ObjectId[];
  if (st.to.order === 'random') topToBottom = randomOrder(g, ids);
  else if (st.to.order === 'asBound' || (st.to.order === undefined && !specific)) {
    // To the bottom, the first card moved ends highest; to the top or an nth position, the last card moved ends highest.
    return { moves: st.to.position === 'bottom' ? ids : [...ids].reverse(), secret: null };
  } else {
    // CR 401.4: the owner of the cards may arrange them in any order (and doesn't reveal it); p2-dig-1: or the player the effect names (`arrangedBy`, the one who looked)
    const by = st.to.arrangedBy !== undefined ? resolvePlayers(cx, st.to.arrangedBy)[0] : owner;
    if (by === undefined) return { moves: ids, secret: null }; // nobody to arrange them (CR 101.3): as listed
    const ans = g.choose({
      kind: 'order', player: by, prompt: 'Put these cards in order, the first one nearest the top of the library.',
      // edh-zones-14 (CR 406.3, 401.4; Scroll Rack): a card of theirs exiled face down that the arranging player looked at is named to them, not "a face-down card"
      items: ids.map((id) => {
        const o = g.s.objects[id];
        return { id, label: o !== undefined && o.faceDown && o.owner === by ? g.s.defs[o.defId]?.faces[o.face]?.name ?? g.nameOf(id) : g.nameOf(id) };
      }), rules: ['CR 401.4'],
    });
    topToBottom = ans.ids.filter((id) => ids.includes(id));
  }
  return { moves: ids, secret: topToBottom };
}

/**
 * CR 303.4f-g: an Aura put onto the battlefield without being cast is attached to an object chosen as it enters (not targeted) by the player putting it there;
 * with no legal object it stays where it is. Returns the object it will enchant, null when it stays, or 'manual' when this build can't tell what it may enchant.
 */
function auraHost(cx: ExecCtx, o: GameObject, c: Chars, controller: PlayerId, given: ObjHandle | undefined, only?: ObjectFilter): ObjectId | null | 'manual' {
  const kw = enchantRestriction(c);
  if (kw?.player !== undefined && (only !== undefined || given !== undefined)) return null; // edh-c-68 (CR 303.4g; Iridescent Drake): an Aura that enchants a player cannot be attached to the named object either; edh-perms-21 (CR 303.4g): "Only creatures can be enchanted this way": an Aura that enchants a player has no legal object, it stays
  if (!kw || kw.player !== undefined) return 'manual'; // an enchant restriction the compiler did not read, or "Enchant player" (not chosen here yet)
  const s = cx.g.s;
  const entering: GameObject = { ...o, controller, zone: 'battlefield' }; // "you" of the enchant filter is the player it enters under (CR 303.4f)
  // edh-perms-21 (CR 303.4f, 303.4g; Retether): "Only creatures can be enchanted this way": besides what the Aura can enchant, the object must match the effect's own description (`to.enchantOnly`)
  const legal = (t: GameObject | undefined): boolean => t !== undefined && t.zone === 'battlefield' && !t.phasedOut && auraCanEnchantObject(s, entering, c, kw, t)
    && (only === undefined || matchesFilter(s, t, only, filterCtxOf(cx)));
  if (given) return legal(s.objects[given.id]) ? given.id : null; // "attached to that creature": that one, or nothing (CR 303.4g)
  const options = s.zones.battlefield.filter((id) => legal(s.objects[id]));
  if (options.length === 0) return null;
  const ans = cx.g.choose({
    kind: 'chooseObjects', player: controller, prompt: `Choose what ${cx.g.nameOf(o.id)} enchants as it enters the battlefield.`,
    options, min: 1, max: 1, rules: ['CR 303.4f'],
  });
  return ans.ids[0] ?? null;
}

/**
 * edh-next-140 (CR 303.4f, 205.1a, 613.1d, 613.1f): the enchant keyword ability "Enchant <filter>" an object entering as an Aura gets (effects/perform-events.ts#applyEnterFacts adds it).
 */
export function asAuraEnchant(enchant: ObjectFilter): KeywordAbilityDef {
  return { kind: 'keyword', keyword: 'enchant', filter: enchant, text: 'Enchant' } as KeywordAbilityDef;
}

/** edh-next-140: the characteristics an object entering as an Aura will have (its card types and subtypes Enchantment and Aura only; its own abilities kept unless it loses the others). */
function asAuraChars(c: Chars, a: NonNullable<Destination['asAura']>): Chars {
  const kw = asAuraEnchant(a.enchant);
  const own = a.losesOthers === true ? [] : c.abilities;
  const added = [kw, ...a.abilities].map((def, i) => ({ key: `asAura:${i}`, def }));
  return { ...c, types: ['Enchantment'], subtypes: ['Aura'], abilities: [...own, ...added] as Chars['abilities'], keywords: [...(a.losesOthers === true ? [] : c.keywords.filter((k) => k.keyword !== 'enchant')), kw] };
}

const zoneWords: Record<ZoneKind, string> = {
  battlefield: 'onto the battlefield', graveyard: "into its owner's graveyard", hand: "into its owner's hand", library: "into its owner's library",
  exile: 'into exile', stack: 'onto the stack', command: 'into the command zone',
};

/**
 * "... can't be put onto the battlefield and stays where it is" (CR 400.4a, 303.4g, 712.14a). C3 (audit 2026-10-12, CR 400.2): cards every player can see are
 * named in one line; a card some player can't see (it stays in a hand or a library) gets a line of its own that names it only to those who can.
 */
function logStayed(g: ExecCtx['g'], ids: readonly ObjectId[]): void {
  if (ids.length === 0) return;
  const opts = { rules: ['CR 400.4a', 'CR 303.4g', 'CR 712.14a'], level: 'info' as const };
  const stays = (names: string[]) => `${names.join(', ')} can't be put onto the battlefield and stay${names.length === 1 ? 's' : ''} where ${names.length === 1 ? 'it is' : 'they are'}.`;
  const seen = ids.map((id) => ({ id, seers: seersOf(g.s, g.s.objects[id]!) }));
  const open = seen.filter((x) => x.seers.length === g.s.players.length);
  if (open.length > 0) g.log(stays(open.map((x) => g.nameOf(x.id))), opts);
  for (const x of seen) {
    if (x.seers.length === g.s.players.length) continue;
    const line = cardLine(g.s, x.seers, stays([g.nameOf(x.id)]), stays(['A card']));
    g.log(line.text, { ...opts, ...(line.privateText ? { privateText: line.privateText } : {}) });
  }
}

/**
 * edh-perms-10 (CR 614.1c, 613.1d; Teferi's Time Twist ruling of 2019-05-03: "consider any effects that will modify that permanent's characteristics once it's on the battlefield, including
 * that permanent's own abilities that affect only itself"): does the card have an ability of its own that changes its own card types (a Theros god that isn't a creature below its
 * devotion, a Vehicle, a land that becomes a creature)? Then whether it enters as a creature is not its printed types, and a `countersIf` entry judged on types is left to the players.
 * Read from the words of the card's static abilities, automated or not (an ability the engine does not understand is still a possible type change); triggered and activated abilities
 * are not working as it enters.
 */
const OWN_TYPE_CHANGE = /\b(?:isn't|is not|aren't|are not) (?:a|an) [\w -]*?(?:creature|artifact|enchantment|land|planeswalker)\b|\b(?:is|are|becomes?|become) (?:a|an) [\w/ -]*?(?:creature|artifact|enchantment|land)\b/i;
// (review: also a card that enters as a copy or with a choice of its own, "as ~ enters", and one that is a creature only away from the battlefield, "as long as ~ isn't on the battlefield, it's a 1/1 ...")
const OWN_ENTERS_CHOICE = /\benters? as (?:a|an) (?:copy|clone)\b|\bas (?:this|~|it)\b[^.]*\benters?\b|isn't on the battlefield|\bit's an? [^,.]*\bcreature\b/i;
function changesOwnTypes(g: { s: { defs: Record<string, { faces: { abilities?: { text?: string; kind?: string }[] }[] }>; objects: Record<string, GameObject> } }, o: GameObject): boolean {
  const def = g.s.defs[o.defId];
  if (def === undefined) return false;
  return def.faces.some((f) => (f.abilities ?? []).some((a) => (a.kind === 'static' || a.kind === 'manual' || a.kind === 'replacement') && (OWN_TYPE_CHANGE.test(a.text ?? '') || OWN_ENTERS_CHOICE.test(a.text ?? ''))));
}

/**
 * edh-next-32 review (CR 614.12, 613.1d; Recommission ruling 2022-10-14): another permanent on the battlefield whose static ability makes a whole group of permanents creatures or other types
 * ("Each noncreature artifact is an artifact creature", Opalescence) changes what enters. The cards entering are judged on their printed types here, so such a battlefield is left to the player.
 */
function groupTypeChangerOnBattlefield(g: { s: { defs: Record<string, { faces: { abilities?: { text?: string; kind?: string }[] }[] }>; objects: Record<string, GameObject> } }): boolean {
  return Object.values(g.s.objects).some((x) => x.zone === 'battlefield' && (g.s.defs[x.defId]?.faces ?? []).some((f) => (f.abilities ?? []).some((a) => (a.kind === 'static' || a.kind === 'manual' || a.kind === 'replacement') && OWN_TYPE_CHANGE.test(a.text ?? '') && /\b(?:each|all|every|other)\b/i.test(a.text ?? ''))));
}

/** edh-perms-10 (CR 614.1c, 608.2c): `to.countersIf`: the counters the move gives, plus those of every entry whose description the card matches before it moves, added kind by kind. */
function withCountersIf(cx: ExecCtx, o: GameObject, base: { kind: string; count: number }[], extra: Destination['countersIf']): { kind: string; count: number }[] {
  const out = base.map((x) => ({ ...x }));
  for (const e of extra ?? []) {
    if (!matchesFilter(cx.g.s, o, e.if, filterCtxOf(cx))) continue;
    if (e.when !== undefined && !evalCond(cx, e.when)) continue; // edh-c-6 (CR 608.2c): a condition of the resolving ability
    for (const c of e.counters) {
      const n = wholeNumber(cx, c.count);
      if (n === undefined || n <= 0) continue;
      const hit = out.find((x) => x.kind === c.kind);
      if (hit) hit.count += n; else out.push({ kind: c.kind, count: n });
    }
  }
  return out;
}

export const move: StepHandler<Move> = (cx, st) => enteringAttacking(cx, st.to.attacking, () => moveStep(cx, st)); // trek-8 review (CR 508.4): see zones-util.ts#enteringAttacking
const moveStep: StepHandler<Move> = (cx, st) => {
  const to: Destination = st.to;
  // Forms of the step this build does not run (named by the capability walker; never approximated).
  if (st.until && !untilSourceLeaves(st.until, to) && !untilMonarchBecomes(st.until, to) && !untilObjectLeaves(st.until, to)) return byHand(cx, st, 'a move that lasts until this event happens (CR 610.3) is not automated yet');
  if (to.zone === 'stack') return byHand(cx, st, 'putting an object onto the stack is casting or copying it (CR 601.2a, 707.10), not a move');

  const g = cx.g;
  if (st.until && untilSourceLeaves(st.until, to) && !(isCurrent(cx, cx.source) && cx.source.zone === 'battlefield')) {
    // CR 610.3a-b: the source left the battlefield after the ability triggered or was put onto the stack: the event has happened, the object doesn't move
    g.log(`${g.nameOf(cx.source.id)} has already left the battlefield: nothing is exiled.`, { rules: ['CR 610.3a', 'CR 610.3b'], level: 'info' });
    bindAs(cx, st.as, []);
    return NOTHING;
  }
  // edh-players-18 (CR 610.3a-b, 725.3; Palace Jailer): the event the exile lasts until (a player becomes the monarch) already happened after this ability was put onto the stack: the
  // object doesn't move. A stack object's timestamp is older than every later monarch change (core/designations.ts#setMonarch writes the counter as it stands then)
  if (st.until && untilMonarchBecomes(st.until, to) && cx.stackTimestamp !== undefined) {
    const who = ((st.until as { event: { player: string } }).event.player);
    const already = (g.s.designations.monarchLog ?? []).some((e) => e.timestamp > cx.stackTimestamp! && (who === 'any' || e.player !== cx.controller));
    if (already) {
      g.log(`A player has already become the monarch: ${g.nameOf(cx.source.id)} exiles nothing.`, { rules: ['CR 610.3a', 'CR 610.3b'], level: 'info' });
      bindAs(cx, st.as, []);
      return NOTHING;
    }
  }
  // edh-next-136 (CR 610.3a-b, 608.2b; Calix, ruling 2020-01-24): the object the exile lasts until is read now; when it is not one object on the battlefield (it left, or
  // the target is illegal) the event has already happened: nothing is exiled
  let watched: ObjHandle | undefined;
  if (st.until && untilObjectLeaves(st.until, to)) {
    const ws = resolveObjs(cx, (st.until as { event: { subject: { is: ObjRef } } }).event.subject.is).filter((h) => isCurrent(cx, h) && g.s.objects[h.id]?.zone === 'battlefield');
    if (ws.length !== 1) {
      g.log(`The permanent ${g.nameOf(cx.source.id)}'s exile lasts until is not on the battlefield: nothing is exiled.`, { rules: ['CR 610.3a', 'CR 610.3b', 'CR 608.2b'], level: 'info' });
      bindAs(cx, st.as, []);
      return NOTHING;
    }
    watched = { id: ws[0]!.id, zone: 'battlefield' };
  }
  const objs = actOn(cx, st.what).filter((h) => {
    const o = g.s.objects[h.id]!;
    if (o.kind === 'ability') return false; // an ability on the stack is not a card: it can't be moved, only countered (CR 113.7)
    if (o.kind === 'token' && o.zone !== 'battlefield') return false; // CR 111.8: a token that left the battlefield can't move again
    return o.zone !== to.zone || to.zone === 'library'; // an object isn't moved to the zone it's in (a library card can be moved within it)
  });
  if (objs.length === 0) {
    bindAs(cx, st.as, []);
    return NOTHING;
  }
  // FAST4 MX1: the source exiling itself "until it leaves the battlefield" (a source that is also one of the objects: "exile all creatures ..." on a creature,
  // a permanent targeting itself) ends the duration in the same event; the engine does not decide what returns then: resolved by hand, never guessed. No
  // printed card does this in normal play (Temporary Lockdown and Pinnacle Starcage have mana value 3; Aligned Hedron Network is not a creature), so the
  // walker does not mark it; this is the run-time backstop (G11).
  if (st.until && untilSourceLeaves(st.until, to) && objs.some((h) => h.id === cx.source.id)) return byHand(cx, st, 'the source would exile itself until it leaves the battlefield (CR 610.3)');
  if (watched !== undefined && objs.some((h) => h.id === watched!.id)) return byHand(cx, st, 'the permanent would be exiled until it leaves the battlefield itself (CR 610.3)');

  // The destination, evaluated once (CR 608.2h). CR 400.3: an object goes to its OWNER's library, hand or graveyard whatever `owner` says.
  let controller: PlayerId | 'owner' = 'owner';
  if (to.zone === 'battlefield' && to.controller !== 'owner') {
    const p = firstPlayer(cx, to.controller);
    if (p === undefined) return NOTHING; // the player fails to determine (CR 608.2b)
    controller = p;
    // edh-next-143 (CR 110.2a, 608.2c; Pir's Whim): a group of players who each put the card they found onto the battlefield ("Each friend searches their library for a land
    // card, puts it onto the battlefield tapped"): each object enters under the control of the player of the group who owns it (they searched their own library). Only when every
    // object's owner is one of those players; otherwise the first player of the group, as before
    const group = resolvePlayers(cx, to.controller);
    if (group.length > 1 && objs.every((h) => group.includes(g.s.objects[h.id]?.owner ?? ''))) controller = 'owner';
  }
  const counters: { kind: string; count: number }[] = [];
  for (const c of to.counters ?? []) {
    const n = wholeNumber(cx, c.count);
    if (n !== undefined && n > 0) counters.push({ kind: c.kind, count: n });
  }
  // "Attached to that creature": the host as it is now, if it is still a permanent (actOn drops a phased-out one, CR 702.26b). When it is gone, only an Aura
  // depends on it (CR 303.4i: it stays where it is); an Equipment or Fortification enters unattached (CR 301.5e), any other permanent ignores it (CR 303.4h).
  const givenHost = to.attachedTo ? actOn(cx, to.attachedTo).find((h) => h.zone === 'battlefield') : undefined;
  const hostGone = to.attachedTo !== undefined && givenHost === undefined;
  // edh-d-29 (CR 303.4f, 303.4g; Bitterheart Witch): "attached to target player": that player as it is now (a player who left the game is no host: the Aura stays)
  const givenPlayer = to.attachedToPlayer !== undefined ? firstPlayer(cx, to.attachedToPlayer) : undefined;

  // CR 401.4: cards going to a library together are ordered by their owner (one decision per owner, APNAP order, CR 101.4).
  let ordered = objs;
  const secret: ObjectId[][] = [];
  const endOf = new Map<ObjectId, 'top' | 'bottom'>(); // edh-zones-21: the end of the library each card goes to, chosen by its owner (`to.ownerChoosesEnd`)
  if (to.zone === 'library') {
    ordered = [];
    if (to.ownerChoosesEnd === true || to.endChosenBy !== undefined) {
      // CR 608.2d, 101.4: the decisions in APNAP order of the owners, each owner deciding for their cards one at a time, before anything moves (CR 401.4: simultaneously)
      for (const owner of g.apnap()) {
        for (const h of objs) {
          if (g.s.objects[h.id]!.owner !== owner) continue;
          // edh-c-107 (Not Forgotten): the player the effect names chooses the end of the owner's library, not the owner (CR 401.4: "unless the effect says otherwise")
          const chooser = to.endChosenBy !== undefined ? resolvePlayers(cx, to.endChosenBy)[0] ?? owner : owner;
          const pick = g.choose({
            kind: 'chooseOption', player: chooser, min: 1, max: 1, prompt: chooser === owner ? `Put ${g.nameOf(h.id)} on the top or the bottom of your library?` : `Put ${g.nameOf(h.id)} on the top or the bottom of its owner's library?`,
            options: [{ id: 'top', label: 'the top' }, { id: 'bottom', label: 'the bottom' }], rules: ['CR 401.4', 'CR 608.2d'],
          }).ids[0];
          endOf.set(h.id, pick === 'bottom' ? 'bottom' : 'top');
        }
      }
    }
    for (const owner of g.apnap()) {
      const mine = objs.filter((h) => g.s.objects[h.id]!.owner === owner).map((h) => h.id);
      if (to.ownerChoosesEnd === true || to.endChosenBy !== undefined) {
        // edh-zones-21 (CR 401.4, 400.3; Aetherspouts): the owner picks the top or the bottom of their library for each of their cards, then arranges the ones for each end
        for (const end of ['top', 'bottom'] as const) {
          const here = mine.filter((id) => endOf.get(id) === end);
          const plan = libraryOrder(cx, { ...st, to: { ...st.to, position: end, order: 'chosen' } }, owner, here);
          for (const id of plan.moves) ordered.push(objs.find((h) => h.id === id)!);
          if (plan.secret) secret.push(plan.secret);
        }
        continue;
      }
      const plan = libraryOrder(cx, st, owner, mine);
      for (const id of plan.moves) ordered.push(objs.find((h) => h.id === id)!);
      if (plan.secret) secret.push(plan.secret);
    }
  }

  // edh-perms-10: counters that depend on the card types of what enters are not judged for a card whose own ability changes its types (see changesOwnTypes)
  if (to.zone === 'battlefield' && (to.countersIf ?? []).some((e) => e.if.types !== undefined || e.if.notTypes !== undefined)) {
    const odd = ordered.find((h) => changesOwnTypes(g, g.s.objects[h.id]!));
    if (odd === undefined && groupTypeChangerOnBattlefield(g)) return byHand(cx, st, 'a permanent on the battlefield changes the card types of a whole group, so whether the card enters as a creature is not its printed types (CR 614.12, 613.1d)');
    if (odd !== undefined) return byHand(cx, st, `${g.nameOf(odd.id)} has an ability of its own that changes its card types, so whether it enters as a creature is not its printed types (CR 614.1c, 613.1d)`);
  }
  // Stage 3 (design 8.6): every decision before anything moves. Where each object goes and how it enters; an Aura's object is chosen now (CR 303.4f: the
  // objects entering together are not on the battlefield yet, so it can't enchant one of them).
  const plans: { h: ObjHandle; dest: ZoneKind; facts: DestinationFacts }[] = [];
  const stayed: ObjectId[] = [];
  const ungated = new Set<ObjectId>(); // std-typechange-2: objects `to.statusIf` does not match (they enter untapped and not attacking)
  for (const h of ordered) {
    const o = g.s.objects[h.id]!;
    let dest: ZoneKind = to.zone;
    if (o.zone === 'stack' && exiledLeavingStack(g, o)) dest = 'exile'; // CR 702.34a, 702.127a
    const facts: DestinationFacts = { cause: dest === 'exile' ? 'exile' : 'effect' };
    if (dest === 'battlefield') facts.viaSource = cx.source.id; // edh-perms-9 (CR 608.2): "put onto the battlefield with this ability"
    // edh-next-80 (CR 708.3, 400.7; Deathmist Raptor): "face up or face down": the player who moves it chooses, for each object, whether it enters face down
    const down = to.faceDown === true || (to.faceUpOrDown === true && to.faceDown === undefined && dest === 'battlefield'
      && g.choose({ kind: 'yesNo', player: cx.controller, prompt: `Put ${g.nameOf(o.id)} onto the battlefield face down?`, yesLabel: 'Face down', noLabel: 'Face up', rules: ['CR 708.3'] }).yes);
    if (down) facts.faceDown = true; // M6-3: CR 406.3 (exiled face down), 708.3 (put onto the battlefield face down)
    if (dest === 'battlefield' && down) {
      // M6-3, CR 708.3, 708.2a: turned face down before it enters, so it enters as a face-down 2/2 creature whatever the card is (its own "as enters" effects
      // don't apply, effects/replacements.ts#involved; an Aura enchants nothing: it is a creature, CR 303.4)
      facts.controller = controller === 'owner' ? o.owner : controller; // CR 110.2
      facts.faceDownInfo = { by: 'effect', profile: to.faceDownAs ?? 'plain' }; // edh-mana-keywords-12: or with set characteristics ("It's a Forest land.")
      if (to.tapped) facts.tapped = true;
      if (counters.length > 0) facts.counters = counters.map((x) => ({ ...x }));
    } else if (dest === 'battlefield') {
      const ctl = controller === 'owner' ? o.owner : controller; // CR 110.2
      const face = enteringFace(g, o, to.transformed === true);
      const c = face === null ? null : canEnter(g, o, face);
      if (face === null || !c) { stayed.push(o.id); continue; } // CR 400.4a, 712.14a-b: it stays in its zone
      if (to.asAura !== undefined) {
        // edh-next-140 (CR 303.4f, 303.4g, 614.1c; Harold and Bob, rulings 2024-03-08): it enters as an Aura enchantment whose enchant ability the effect gives: its host is chosen with the
        // characteristics it will have (only Enchantment and Aura, the new abilities), and with nothing it could enchant it stays where it is
        const aura = asAuraChars(c, to.asAura);
        const host = hostGone ? null : auraHost(cx, o, aura, ctl, givenHost, to.enchantOnly);
        if (host === 'manual') return byHand(cx, st, `the engine can't tell what ${g.nameOf(o.id)} may enchant as it enters (CR 303.4f)`);
        if (host === null) { stayed.push(o.id); continue; } // CR 303.4g
        facts.attachTo = host;
        facts.asAura = { enchant: to.asAura.enchant, abilities: to.asAura.abilities, ...(to.asAura.losesOthers === true ? { losesOthers: true as const } : {}) };
      } else if (isAura(c) && to.attachedToPlayer !== undefined) {
        // edh-d-29 (CR 303.4f-g; Bitterheart Witch, Radiant Grace): an Aura that enchants players enters attached to the named player if it may; any other Aura, or a player
        // it can't enchant (protection from the Aura, an opponent-only Aura on yourself, a player who left), leaves it where it is
        const kw = enchantRestriction(c);
        if (!kw) return byHand(cx, st, `the engine can't tell what ${g.nameOf(o.id)} may enchant as it enters (CR 303.4f)`);
        const entering: GameObject = { ...o, controller: ctl, zone: 'battlefield' };
        if (givenPlayer === undefined || kw.player === undefined || !auraCanEnchantPlayer(g.s, entering, kw, givenPlayer)) { stayed.push(o.id); continue; }
        facts.attachTo = givenPlayer;
      } else if (isAura(c)) {
        const host = hostGone ? null : auraHost(cx, o, c, ctl, givenHost, to.enchantOnly);
        if (host === 'manual') return byHand(cx, st, `the engine can't tell what ${g.nameOf(o.id)} may enchant as it enters (CR 303.4f)`);
        if (host === null) { stayed.push(o.id); continue; } // CR 303.4g, 303.4i
        facts.attachTo = host;
      } else if (givenHost && (isEquipment(c) || isFortification(c))) {
        // CR 301.5e: attached only to an object it can legally equip (or fortify); otherwise it enters unattached. CR 303.4h: other permanents never attach.
        if (attachable(cx, o, g.s.objects[givenHost.id]!) === true) facts.attachTo = givenHost.id;
      }
      facts.controller = ctl;
      facts.face = face;
      // std-typechange-2 (CR 608.2c): "If that card is an enchantment card, it enters tapped and attacking": the card as it is before it moves
      const gated = to.statusIf === undefined || matchesFilter(g.s, o, to.statusIf, filterCtxOf(cx));
      if (!gated) ungated.add(o.id);
      if (to.tapped && gated) facts.tapped = true;
      // edh-perms-10 (CR 614.1c, 608.2c): the extra counters of the entries whose description this card matches, as it is before it moves, added kind by kind
      const own = withCountersIf(cx, o, counters, to.countersIf);
      if (own.length > 0) facts.counters = own;
      // edh-next-125 (CR 614.1c, 613.1d, 613.4b, 608.2c; Dance of the Manse ruling 2019-10-04): "If X is 6 or more, those permanents are 4/4 creatures in addition to their other
      // types": each one ENTERS as a 4/4 creature (layers 4 and 7b on the new object from the moment it enters), when the resolving ability's condition holds as it moves
      if (to.becomes !== undefined && (to.becomes.when === undefined || evalCond(cx, to.becomes.when))) {
        const { when: _when, ...bc } = to.becomes;
        facts.becomes = bc;
      }
    }
    plans.push({ h, dest, facts });
  }

  // Stage 4: one proposal per object, in order (CR 608.2f: they move together, as one batch of events).
  const moved: Moved[] = [];
  const intoLibrary = new Map<ObjectId, ObjectId>(); // H1: the object each card became in a library (for the secret arrangement below)
  const randomPlaces = new Set<PlayerId>();
  // FAST5X E28 review (CR 603.10a): permanents that leave together are each as they were before the first one left (a persist granted by another one moved)
  const previousGroup = ENTERING_TOGETHER.get(g);
  if (plans.filter((p) => p.dest === 'battlefield').length > 1) ENTERING_TOGETHER.set(g, new Set()); // pc-counters-1 (CR 614.12): the new objects join as they arrive; restored below
  try {
  leavingTogether(g, plans.flatMap((p) => (p.h.zone === 'battlefield' ? [p.h.id] : [])), () => {
    for (const plan of plans) {
      const { dest, facts } = plan;
      const h = renewedHandle(g, plan.h); // H1: a library card a shuffle renewed meanwhile (a replacement of an earlier move, CR 614.1a) is still that card
      const o = g.s.objects[h.id];
      if (!o || o.zone !== h.zone) continue; // a replacement of an earlier move took it meanwhile
      if (dest === 'library') {
        const position = to.ownerChoosesEnd === true || to.endChosenBy !== undefined ? endOf.get(plan.h.id) ?? 'top' : libraryPosition(cx, st.to.position, o.owner); // "at random" is drawn as the card moves (design 8.8 rule 2)
        if (position === undefined) continue; // the position fails to determine (CR 608.2b)
        facts.position = position;
      }
      const from = o.zone;
      const name = g.nameOf(o.id);
      const owner = g.player(o.owner).name;
      const sawIt = seersOf(g.s, o); // CR 400.2: who could see the card before it moved (a searched card: the searcher; a revealed one: everybody)
      const m = proposeMove(cx, h, dest, facts);
      if (!m.ok) continue;
      moved.push(m);
      if (m.to?.zone === 'battlefield') ENTERING_TOGETHER.get(g)?.add(m.to.id); // the new object (CR 400.7) enters with the others
      if (m.to?.zone === 'library') {
        intoLibrary.set(plan.h.id, m.to.id);
        if (st.to.position === 'random') randomPlaces.add(g.s.objects[m.to.id]!.owner);
      }
      // FAST5X E25 (CR 406.3): a card exiled face down can be looked at only by the players who could see it as it was exiled ("search your library for a card,
      // exile it face down": the searcher; "look at the top two cards of your library and exile them face down": the player who looked), until it leaves exile
      if (m.to && m.to.zone === 'exile' && to.faceDown === true) performExiledSeers(g, [m.to.id], sawIt);
      if (m.to) {
        // C3 (audit 2026-10-12; CR 400.2, 701.23e): a card that goes from a hidden zone into a hidden zone (a tutor's "put that card into your hand") is named only
        // to the players who saw it before or see it now; the others read "a card".
        const after = g.s.objects[m.to.id];
        const where = zoneWords[m.to.zone];
        const named = `${name} is put ${where}${from === 'stack' && dest === 'exile' && to.zone !== 'exile' ? ' instead (it would leave the stack)' : ''}.`;
        const line = cardLine(g.s, [...sawIt, ...(after ? seersOf(g.s, after) : [])], named, `A card is put ${where.replace("its owner's", `${owner}'s`)}.`);
        g.log(line.text, {
          rules: [...(m.to.zone === 'exile' ? ['CR 701.13a'] : []), ...(dest !== to.zone ? ['CR 702.34a'] : []), 'CR 400.7', 'CR 608.2c'], level: 'action',
          ...(line.privateText ? { privateText: line.privateText } : {}),
        });
      }
    }
  });
  } finally { closeEnteringGroup(g, ENTERING_TOGETHER.get(g) === previousGroup ? undefined : ENTERING_TOGETHER.get(g)) /* edh-next-122 */; if (previousGroup) ENTERING_TOGETHER.set(g, previousGroup); else ENTERING_TOGETHER.delete(g); }
  // H1 (CR 400.2, 401.4): the order nobody else may learn, once every card is in its library; cards each put at a random place make the whole library new.
  for (const order of secret) performArrangeLibrary(g, order.flatMap((id) => intoLibrary.get(id) ?? []));
  for (const p of randomPlaces) performRenewLibrary(g, p);
  for (const m of moved) if (m.to?.zone === 'library') ceaseTokenInLibrary(g, g.renewedId(m.to.id)); // edh-next-66 (CR 111.7, 704.5d): a token put into a library is gone at once, counted by this step
  logStayed(g, stayed);
  // edh-perms-17 (CR 608.2c, 303.4g; Armored Skyhunter ruling): a chosen card that could not enter (an Aura that can't enchant anything) was not put onto the battlefield: it is no longer
  // among "the chosen cards", so "the rest" of the group it was chosen from (put on the bottom) includes it
  if (stayed.length > 0 && to.zone === 'battlefield' && st.what.ref === 'bound') {
    const b = cx.bindings.get(st.what.name);
    if (b !== undefined) cx.bindings.set(st.what.name, { ...b, objects: b.objects.filter((h) => !stayed.includes(h.id)) });
  }
  // std-rx27 (CR 122.1, 400.7): "exile it ... with a stash counter on it": the counters go on the card it became in exile (a counter put on a card, as a time
  // counter in exile; the counters a permanent enters with are its entering facts above)
  if (to.zone === 'exile' && counters.length > 0) {
    for (const h of moved.flatMap(movedHandles)) {
      if (h.zone !== 'exile') continue;
      for (const c of counters) proposeMeasured(cx, { ev: 'counters', change: 'put', on: { id: h.id, zone: 'exile' }, kind: c.kind, count: c.count });
    }
  }

  // CR 607.2a: the linked ability remembers the objects this one put somewhere everyone can see, added to what earlier resolutions put there (zones-util.ts).
  addToLink(cx, st.link, moved.flatMap(movedHandles).filter((h) => PUBLIC_ZONES.includes(h.zone))); // CR 712.21c: each card a melded permanent became
  // edh-next-62 (CR 406.3, 607.2a; rulings of Colfenor's Plans 2013-04-15, Kheru Mind-Eater 2017-08-25): a face-down card a static "you may look at the cards exiled with ~" lets its controller look at has been looked at
  if (st.link) performLookedAtExiled(g, cx.source.id, moved.flatMap(movedHandles).map((h) => h.id));
  if (st.remember) {
    // FAST5X E13 (CR 702.167c, 607.2a): each permanent put onto the battlefield remembers these objects in its own link store ("the exiled cards used to
    // craft it"); nothing else moved here, so they are read now
    const remembered = resolveObjs(cx, st.remember.what);
    for (const h of moved.flatMap(movedHandles)) if (h.zone === 'battlefield') performLink(g, h, st.remember.link, { objects: remembered });
  }
  // CR 508.4: put onto the battlefield attacking.
  if (to.attacking !== undefined && to.attacking !== false) {
    const gatedIds = moved.flatMap((m) => (m.before !== undefined && ungated.has(m.before.object.id) ? [] : movedHandles(m))).flatMap((h) => (h.zone === 'battlefield' ? [h.id] : []));
    enterAttacking(cx, gatedIds, to.attacking);
  }
  if (st.until && (untilSourceLeaves(st.until, to) || untilMonarchBecomes(st.until, to) || watched !== undefined)) {
    // CR 610.3: the objects exiled this way wait for the source (or, edh-players-18, for a player to become the monarch) to leave the battlefield (only those that ended in exile: a commander put into the command zone
    // instead, CR 903.9a, was not exiled and doesn't return). Their previous zone is where each was when the move began.
    const objects = moved.flatMap((m) => (m.to && m.to.zone === 'exile' && m.before ? [{ object: { id: m.to.id, zone: m.to.zone }, back: m.before.leftZone }] : []));
    if (objects.length > 0) {
      performUntilMove(g, {
        // edh-next-136: a record that waits for another object has that object as its source, the event "it leaves the battlefield" (CR 610.3)
        id: g.newEffectId(), source: watched ?? { id: cx.source.id, zone: 'battlefield' }, controller: cx.controller,
        duration: watched !== undefined ? { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' } } : st.until as Extract<Duration, { d: 'until' }>,
        objects, sourceName: g.nameOf((watched ?? cx.source).id),
      });
    }
  }
  bindMoved(cx, st.as, moved, to.zone);
  // FAST5 T75 (CR 608.2c, 608.2h, 400.7): what a move to the hand really put there, as each card was before it moved ("if you put a Town card into your hand this way",
  // `{cond:'did', which, to:'hand'}`); only for a named step (only a named step's result can be read), only the cards that ended in the hand (a replacement may have put
  // one elsewhere); Cloud std-fin: the same for a move to exile ("if a creature card was exiled this way")
  // Cloud C7 (CR 608.2c, 608.2h, 400.7): every destination reports the same way ("if a creature card was exiled this way", "for each card put into a graveyard this
  // way", "if you put an artifact onto the battlefield this way"): only the objects that ended in the destination (a commander put into the command zone instead
  // of exile, CR 903.9a, was not exiled), as each was before it moved
  // edh-perms-22 (CR 608.2c, 903.9; Flood of Tears, ruling 2019-07-12): `attempted` is every object the move was applied to as it last existed, one a replacement effect put in the command zone instead too
  return st.as === undefined ? did(moved.length) : { ...did(moved.length), before: moved.flatMap((m) => (m.before !== undefined && m.to?.zone === to.zone ? [m.before] : [])), ...attemptedMore(moved, to.zone) };
};

