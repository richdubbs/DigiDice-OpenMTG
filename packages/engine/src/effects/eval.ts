/**
 * Evaluators for quantities, conditions and counts (design 3.4, 8.3). Owner: WP4.
 *
 * A quantity that depends on an illegal target or an empty binding is `undefined` ("fails to determine", CR 608.2b); a step with an `undefined` quantity does
 * nothing and a comparison with an `undefined` side is false (design 3.4). The tables `COND_EVALUATORS` and `QTY_EVALUATORS` are the capability tables
 * (`cond:<name>`, `q:<name>`, design 5.2): a node is advertised exactly when it has an entry here.
 *
 * `q:dieResult` (WP15 INTERFACE CHANGE): the result of the last die roll of this resolution, which the `rollDie` handler keeps in the variable `DIE_RESULT_VAR`
 * (CR 706.2), or, in an ability triggered by a die roll, the triggering roll's result (the event's amount); undefined otherwise, and when several players
 * rolled (each roll has its own result). Not advertised until something writes the history: `cond:happened` / `q:happenedCount` (rules/history.ts
 * `HISTORY_WRITTEN`; WP8). The two history nodes are evaluated all the same (`evalCond` / `evalQty` read the full tables), they only are not capabilities yet.
 *
 * Amounts (CR 107.1b): `evalQty` keeps a negative result, because comparisons see it ("if its power is less than 0"); a COUNT is never negative (`evalCount`
 * clamps), and every handler that uses a quantity as an amount of damage, life, cards or counters must clamp it at 0 itself (WP12-WP15).
 */
import { EngineBug } from '../core/errors';
import { hasCompleted } from '../core/dungeon-data';
import type { Cmp, Condition, Count, ObjectFilter, ObjRef, PlayerRef, Quantity } from '../types/ability';
import { isPrime } from '../types/ability';
import type { PlayerId } from '../types/ids';
import { colorSymbolCount, manaValue as costManaValue, spentAtLeast, type ManaSymbol } from '../types/mana';
import type { BeheldSnapshot, CastOrigin, CostsPaid, GameObject, LastKnown, ObjHandle } from '../types/state';
import { charsOfObject, controllerOf, ptNumbers, type Chars } from '../rules/characteristics';
import { spellTargetTotal } from '../rules/target-total';
import { hasSharedTypeLine, unlockedHalves } from '../rules/base-parts/room';
import { creatureTypesOf, landTypesOf, matchesFilter, planeswalkerTypesOf } from '../rules/filter';
import { baseManaValue, faceIndexOf, sourceChars } from '../rules/base-chars';
import { countHistory, distinctHistory, firstTimeThisTurn, happenedCountOf, HISTORY_WRITTEN, type FactsEnv } from '../rules/history';
import { installHistoryCounter, wasCastKept } from '../statics/match';
import { partyCreatureOf, partySize, type PartyCreature } from '../statics/party';
import { compareNumbers, playerPredMatches } from '../rules/predicates';
import type { ExecCtx } from './api';
import { commanderCastsOf, commandersOf, identityManaColors } from '../statics/commander';
import { stationsUsingToughness } from '../statics/hooks';
import { charsThroughLayer7b } from '../statics/layers';
import { PERMANENT_TYPES } from '../statics/subtypes';
import { castCheckKey, resolutionKey } from '../rules/resolutions';
import { filterCtxOf, installQuantityEvaluator, linkValue, readInfo, resolveObjs, resolvePlayers, resolveRecipients, sourceObject, isCurrent } from './refs';

type CondOf<K extends Condition['cond']> = Extract<Condition, { cond: K }>;
type QtyOf<K extends Exclude<Quantity, number>['q']> = Extract<Quantity, { q: K }>;

const INTEGER = /^-?\d+$/;
// ---- helpers ----------------------------------------------------------------------------------------------------------------------------------------------

/** The one value of a set that must have exactly one: none = cannot be determined (CR 608.2b); several is a program error, loudly. */
function only<T>(xs: readonly T[], what: string): T | undefined {
  if (xs.length > 1) throw new EngineBug(`${what} refers to ${xs.length} things; the program must say which (design 3.4)`);
  return xs[0];
}

const onePlayer = (cx: ExecCtx, ref: PlayerRef, what: string): PlayerId | undefined => only(resolvePlayers(cx, ref), what);

/** Each answer a manual node asked is remembered for the rest of the resolution, so the same node is asked once (design 10.1). */
const manualAnswers = new WeakMap<ExecCtx, Map<object, number | boolean>>();
function askedBefore<T extends number | boolean>(cx: ExecCtx, node: object): T | undefined {
  return manualAnswers.get(cx)?.get(node) as T | undefined;
}
function remember(cx: ExecCtx, node: object, value: number | boolean): void {
  let m = manualAnswers.get(cx);
  if (!m) manualAnswers.set(cx, (m = new Map()));
  m.set(node, value);
}

/** Does the reference stand for a set of the game state (a filter over the battlefield, ...) rather than for something chosen earlier? An empty one is 0 things, not a missing one (CR 608.2h). */
// M12-1: `of` is read only on a union (the seat reference's `of` is one player reference, never a set of the game)
const isGameSet = (ref: { ref: string; of?: unknown }): boolean => ref.ref === 'each' || (ref.ref === 'union' && Array.isArray(ref.of) && (ref.of as { ref: string }[]).every((r) => isGameSet(r)));

/**
 * wave 6 line moved review (CR 608.2h, 603.12): the objects a statistic of a SET reads ("the greatest mana value among cards discarded this way", "for each card
 * type among cards discarded this way"). A set an earlier step bound and a reflexive or delayed ability captured (`{ref:'fixed'}`, triggers/delayed.ts#bakeSteps)
 * keeps the objects that left the zone they were bound in since: their values are read from their last known information (`readInfo`), as for a set still bound
 * in the same resolution. Nothing acts on them (CR 400.7): this is only for reading. Any other reference resolves as usual.
 */
function readSetOf(cx: ExecCtx, ref: ObjRef): ObjHandle[] {
  if (ref.ref !== 'fixed') return resolveObjs(cx, ref);
  const s = cx.g.s;
  return ref.objects.filter((h) => s.objects[h.id]?.zone === h.zone || s.lki[h.id] !== undefined).map((h) => ({ id: h.id, zone: h.zone }));
}

/** Power, toughness, mana value, loyalty or defense of the object a handle stands for, from its current or last known information. */
function statOf(cx: ExecCtx, h: ObjHandle, stat: QtyOf<'stat'>['stat']): number | undefined {
  const info = readInfo(cx, h);
  if (!info) return undefined;
  const { object: o, chars: c } = info;
  switch (stat) {
    case 'power': case 'toughness': return c ? (ptNumbers(c)[stat] ?? undefined) : undefined; // "*" is milestone 6; a noncreature has none
    case 'manaValue': return c ? (o.zone === 'stack' && o.stack?.x !== undefined ? costManaValue(c.manaCost, o.stack.x) : c.manaValue) : undefined; // CR 202.3e
    case 'loyalty': case 'defense': {
      if (o.zone === 'battlefield') return Object.hasOwn(o.counters, stat) ? o.counters[stat]! : 0; // loyalty / defense counters (CR 306.5b, 310.4b)
      const printed = c?.[stat];
      return printed !== undefined && INTEGER.test(printed) ? Number(printed) : undefined;
    }
  }
}

const symbolColors = (sym: ManaSymbol): string[] => {
  switch (sym.kind) {
    case 'colored': case 'monoHybrid': case 'colorlessHybrid': case 'phyrexian': return [sym.color];
    case 'hybrid': case 'hybridPhyrexian': return [...sym.colors];
    default: return [];
  }
};

function infoCharsOf(cx: ExecCtx, refs: readonly ObjHandle[]): { o: GameObject; c: Chars }[] {
  const out: { o: GameObject; c: Chars }[] = [];
  for (const h of refs) {
    const i = readInfo(cx, h);
    if (i?.chars) out.push({ o: i.object, c: i.chars });
  }
  return out;
}

const countersOn = (counters: Record<string, number>, kind: string): number =>
  kind === 'any' ? Object.values(counters).reduce((a, b) => a + b, 0) : (Object.hasOwn(counters, kind) ? counters[kind]! : 0); // counter names are data (CR 122)

/**
 * Cloud C7 (CR 608.2c, 608.2h): the objects a step reported it moved (`StepResult.before`) that match `which` as each last existed (its characteristics then,
 * its controller then; a token that ceased to exist too). Read by `{cond:'did', which}` and `{q:'resultCount', which}`.
 */
function movedMatching(cx: ExecCtx, before: readonly LastKnown[] | undefined, which: ObjectFilter): LastKnown[] {
  const ctx = filterCtxOf(cx);
  return (before ?? []).filter((i) => matchesFilter(cx.g.s, i.object, which, i.chars ? { ...ctx, chars: i.chars } : ctx));
}

function factsEnv(cx: ExecCtx): FactsEnv {
  return { you: cx.controller, sourceId: cx.source.id, resolvePlayers: (ref) => resolvePlayers(cx, ref), qty: (q) => evalQty(cx, q), objectIds: (ref) => resolveObjs(cx, ref).map((h) => h.id) }; // std-rx14: objectIds
}

// ---- quantities -----------------------------------------------------------------------------------------------------------------------------------------

type QtyTable = { [K in Exclude<Quantity, number>['q']]?: (cx: ExecCtx, q: QtyOf<K>) => number | undefined };

const QTY: QtyTable = {
  // CR 107.3a: the value announced when the spell was cast / the ability activated; a permanent remembers it (CR 400.7d); otherwise 0 (CR 107.3b).
  // r4-fxb / r4-fxz (wave 7 merge, CR 107.3, 608.2h): a cast trigger ("When you cast this spell, copy it X times", "Whenever you cast a spell with {X} in its
  // mana cost, ...") has the X of the cast event on its own stack object (triggers/stack.ts#castX), so it keeps that X once the spell has left the stack
  X: (cx) => cx.stack?.x ?? cx.manaX ?? sourceObject(cx)?.cast?.x ?? 0, // p2-mana-1: `manaX`, a mana ability's announced X (effects/mana-ability.ts)
  // A `let` whose value could not be determined stores NaN (the interpreter's `let` handler); a name that was never set is a program error.
  var: (cx, q) => {
    if (!cx.vars.has(q.name)) throw new EngineBug(`The variable "${q.name}" was never set (design 3.4)`);
    const v = cx.vars.get(q.name)!;
    return Number.isNaN(v) ? undefined : v;
  },
  count: (cx, q) => resolveObjs(cx, q.of).length, // the size of the set: members that have moved since still count ("the number of cards returned this way"); use `exists` to ask whether they are still there
  countPlayers: (cx, q) => {
    // std-mkm (CR 119.3, 120.3a): only the players who lost life this turn
    let players = resolvePlayers(cx, q.of).filter((p) => q.lostLifeThisTurn !== true || cx.g.player(p).turnStats.lifeLost > 0);
    // Standard round P (CR 119.3, 120.3a): only the players whose life lost this turn compares with a fixed number ("if an opponent lost 3 or more life this turn")
    if (q.lostLifeIs !== undefined) players = players.filter((p) => compareNumbers(q.lostLifeIs!.op, cx.g.player(p).turnStats.lifeLost, q.lostLifeIs!.n));
    // std-rx12 (CR 102.3, 108.4): only the players who control a number of these permanents that compares with a fixed number ("opponents who control an artifact")
    if (q.controlsIs !== undefined) {
      const per = new Map<PlayerId, number>();
      for (const h of resolveObjs(cx, { ref: 'each', filter: q.controlsIs.filter })) {
        const p = controllerOf(cx.g.s, h.id);
        per.set(p, (per.get(p) ?? 0) + 1);
      }
      const { op, n } = q.controlsIs;
      players = players.filter((p) => compareNumbers(op, per.get(p) ?? 0, n));
    }
    // r5-fxz (CR 701.9a, 608.2c, 608.2h): only the players who did not discard such a card in the named step (a card is discarded from its owner's hand)
    if (q.didNot !== undefined) {
      const done = movedMatching(cx, cx.results.get(q.didNot.step)?.before, q.didNot.which);
      players = players.filter((p) => !done.some((i) => i.object.owner === p));
    }
    // std-control-1 (CR 702.179f): the players whose speed compares with another player's (no speed counts as 0)
    if (q.speedVs !== undefined) {
      if (q.sizeVs !== undefined || q.sizeIs !== undefined || q.lifeVs !== undefined) return undefined; // one comparison per count
      const than = onePlayer(cx, q.speedVs.than, 'a speed');
      if (than === undefined) return undefined;
      const speedOf = (p: PlayerId): number => cx.g.s.designations.speed?.[p] ?? 0;
      return players.filter((p) => compareNumbers(q.speedVs!.op, speedOf(p), speedOf(than))).length;
    }
    // std-lci (CR 119.1, 102.1): the players whose life total compares with another player's ("the player with the most life or tied for most life")
    if (q.lifeVs !== undefined) {
      if (q.sizeVs !== undefined || q.sizeIs !== undefined) return undefined; // one comparison per count
      const than = onePlayer(cx, q.lifeVs.than, 'a life total');
      if (than === undefined) return undefined;
      const lifeOf = (p: string): number => cx.g.player(p).life;
      return players.filter((p) => compareNumbers(q.lifeVs!.op, lifeOf(p), lifeOf(than))).length;
    }
    // std-hob (CR 404.1, 402.1): the players whose zone holds at least / at most a fixed number of cards ("for each graveyard with seven or more cards in it")
    if (q.sizeIs !== undefined) {
      const { zone, op, n } = q.sizeIs;
      return players.filter((p) => compareNumbers(op, (cx.g.s.zones[zone][p] ?? []).length, n)).length;
    }
    // r4-static (CR 119.1): the players whose life total compares with a fixed number ("as long as an opponent has 10 or less life")
    if (q.lifeIs !== undefined) {
      const { op, n } = q.lifeIs;
      return players.filter((p) => compareNumbers(op, cx.g.player(p).life, n)).length;
    }
    // std-rx24 (CR 122.1f): the players whose poison counters compare with a fixed number ("as long as an opponent has three or more poison counters")
    if (q.poisonIs !== undefined) {
      const { op, n } = q.poisonIs;
      return players.filter((p) => compareNumbers(op, cx.g.player(p).poison, n)).length;
    }
    if (q.controlsVs !== undefined) {
      // std-sos review (CR 102.2, 102.3): the players who control more (fewer, ...) of these permanents than another player, each player counted alone
      const than = onePlayer(cx, q.controlsVs.than, 'a number of permanents');
      if (than === undefined) return undefined;
      const per = new Map<PlayerId, number>();
      for (const h of resolveObjs(cx, { ref: 'each', filter: q.controlsVs.filter })) {
        const p = controllerOf(cx.g.s, h.id);
        per.set(p, (per.get(p) ?? 0) + 1);
      }
      const { op } = q.controlsVs;
      return players.filter((p) => compareNumbers(op, per.get(p) ?? 0, per.get(than) ?? 0)).length;
    }
    if (q.sizeVs === undefined) return players.length;
    // FAST5 T53 (CR 402.1, 102.3): the players whose zone is bigger / smaller than another player's
    const than = onePlayer(cx, q.sizeVs.than, 'a zone size');
    if (than === undefined) return undefined;
    const { zone, op } = q.sizeVs;
    const size = (p: string): number => (cx.g.s.zones[zone][p] ?? []).length;
    return players.filter((p) => compareNumbers(op, size(p), size(than))).length;
  },
  stat: (cx, q) => {
    const hs = q.agg !== undefined ? readSetOf(cx, q.of) : resolveObjs(cx, q.of); // wave 6 line moved review: a set read as it last existed (CR 608.2h)
    // the total of no creatures is 0 (CR 608.2h); FAST5X E15: so is the greatest (least) value among none, also of a step's result ("the greatest mana value
    // among cards discarded this way" when none was); an illegal target or an empty binding of ONE object fails to determine (CR 608.2b)
    if (hs.length === 0) return (q.sum && isGameSet(q.of)) || q.agg !== undefined ? 0 : undefined;
    // CR 712.21c, 712.21e: the cards a melded permanent became read the same last known information: one object, counted once
    const seen = new Set<LastKnown>();
    // cloud r3-mech (CR 702.184a): a station amount is the creature's toughness when "stations permanents using its toughness" applies to it (still on the battlefield)
    const statFor = (h: ObjHandle): QtyOf<'stat'>['stat'] => {
      if (q.station !== true || q.stat !== 'power') return q.stat;
      const i = readInfo(cx, h);
      return i?.chars && i.object.zone === 'battlefield' && cx.g.s.objects[i.object.id]?.zone === 'battlefield' && stationsUsingToughness(cx.g.s, i.object.id, i.chars) ? 'toughness' : 'power';
    };
    const values = hs.filter((h) => { const i = readInfo(cx, h); if (!i || !i.object.components) return true; if (seen.has(i)) return false; seen.add(i); return true; }).map((h) => statOf(cx, h, statFor(h)));
    if (values.some((v) => v === undefined)) return undefined;
    if (q.sum) return (values as number[]).reduce((a, b) => a + b, 0);
    // FAST5X E15 (CR 208.1, 202.3, 608.2h): the greatest / least value among the set, read once as the effect is applied
    if (q.agg !== undefined) return q.agg === 'max' ? Math.max(...(values as number[])) : Math.min(...(values as number[]));
    return only(values as number[], `the ${q.stat} of ${JSON.stringify(q.of)}`);
  },
  // std-rx29 (CR 208.1, 613.4): the power of one permanent after layer 7b; an object that is no longer on the battlefield has none recorded (undetermined, CR 608.2h)
  basePower: (cx, q) => {
    const hs = resolveObjs(cx, q.of);
    if (hs.length !== 1) return undefined;
    const o = cx.g.s.objects[hs[0]!.id];
    if (o === undefined || o.zone !== 'battlefield') return undefined;
    const p = charsThroughLayer7b(cx.g.s).get(o.id)?.power;
    return p !== undefined && INTEGER.test(String(p)) ? Number(p) : undefined;
  },
  life: (cx, q) => {
    // p2-group-actions-1 (CR 119.1): the highest or lowest life total among a set of players (none: undetermined, CR 608.2b)
    if (q.agg !== undefined) {
      const lives = resolvePlayers(cx, q.of).map((id) => cx.g.player(id).life);
      return lives.length === 0 ? undefined : q.agg === 'max' ? Math.max(...lives) : Math.min(...lives);
    }
    const p = onePlayer(cx, q.of, 'a life total');
    return p === undefined ? undefined : cx.g.player(p).life; // CR 119.1
  },
  zoneSize: (cx, q) => {
    const p = onePlayer(cx, q.of, 'a zone size');
    if (p === undefined) return undefined;
    const s = cx.g.s;
    const z = q.zone;
    if (z === 'library' || z === 'hand' || z === 'graveyard') return (s.zones[z][p] ?? []).length;
    const owned = z === 'exile' || z === 'command'; // the owner's bin, otherwise the controller's objects (CR 400.3)
    return s.zones[z].filter((id) => { const o = s.objects[id]; return o !== undefined && (owned ? o.owner : o.controller) === p; }).length;
  },
  counters: (cx, q) => {
    const r = resolveRecipients(cx, q.on);
    if (r.objects.length + r.players.length === 0) return isGameSet(q.on) ? 0 : undefined; // no permanents with counters: 0 (CR 608.2h); an illegal target: undetermined (CR 608.2b)
    let n = 0;
    for (const h of r.objects) { const i = readInfo(cx, h); if (i) n += countersOn(i.object.counters, q.kind); }
    for (const p of r.players) {
      const ps = cx.g.player(p);
      n += q.kind === 'poison' ? ps.poison : q.kind === 'any' ? ps.poison + countersOn(ps.counters, 'any') : countersOn(ps.counters, q.kind); // CR 122.1f
    }
    return n;
  },
  // CR 700.5: the number of mana symbols of the color(s) among the mana costs of the permanents the player controls (a hybrid symbol counts once).
  devotion: (cx, q) => {
    const p = onePlayer(cx, q.of, 'a devotion');
    if (p === undefined) return undefined;
    const s = cx.g.s;
    let n = 0;
    for (const id of s.zones.battlefield) {
      const o = s.objects[id];
      if (!o || o.controller !== p || o.phasedOut) continue; // a phased-out permanent is treated as though it doesn't exist (CR 702.26b)
      for (const sym of charsOfObject(s, o).manaCost ?? []) if (symbolColors(sym).some((c) => (q.to as string[]).includes(c))) n++;
    }
    return n;
  },
  // Standard round 5, r5-trig (CR 107.4, 202.1): the mana symbols of a color in the mana cost of one object, as it last existed (Namor's "that many")
  manaSymbols: (cx, q) => {
    const hs = resolveObjs(cx, q.of);
    const i = hs.length === 1 ? readInfo(cx, hs[0]!) : undefined;
    return i?.chars ? colorSymbolCount(i.chars.manaCost, q.color) : undefined;
  },
  // CR 700.8: the creatures the player controls, as they are now (statics/party.ts)
  partySize: (cx, q) => {
    const p = onePlayer(cx, q.of, 'a party');
    if (p === undefined) return undefined;
    const s = cx.g.s;
    const mine: PartyCreature[] = [];
    for (const id of s.zones.battlefield) {
      const o = s.objects[id];
      if (!o || o.controller !== p || o.phasedOut) continue;
      const c = charsOfObject(s, o);
      if (c.types.includes('Creature')) mine.push(partyCreatureOf(c));
    }
    return partySize(mine);
  },
  // r5-cost (CR 205.3m, 702.73a): the most objects that share one creature type; a changeling counts for every type
  mostSharingCreatureType: (cx, q) => {
    const byType = new Map<string, number>();
    let all = 0;
    for (const { c } of infoCharsOf(cx, resolveObjs(cx, q.among))) {
      const t = creatureTypesOf(c);
      if (t.all) { all++; continue; }
      for (const x of new Set(t.set)) byType.set(x, (byType.get(x) ?? 0) + 1);
    }
    return all + Math.max(0, ...byType.values());
  },
  distinct: (cx, q) => {
    const objs = infoCharsOf(cx, readSetOf(cx, q.among)); // wave 6 line moved review: a set read as it last existed (CR 608.2h)
    const seen = new Set<string | number>();
    for (const { o, c } of objs) {
      switch (q.what) {
        case 'colors': c.colors.forEach((x) => seen.add(x)); break;
        case 'cardTypes': c.types.forEach((x) => seen.add(x)); break;
        case 'permanentTypes': c.types.filter((x) => PERMANENT_TYPES.includes(x)).forEach((x) => seen.add(x)); break; // r4-cost (CR 110.4)
        case 'names': c.names.forEach((x) => seen.add(x)); break;
        case 'manaValues': seen.add(o.zone === 'stack' && o.stack?.x !== undefined ? costManaValue(c.manaCost, o.stack.x) : c.manaValue); break;
        case 'landTypes': landTypesOf(c).forEach((x) => seen.add(x)); break;
        case 'planeswalkerTypes': planeswalkerTypesOf(c).forEach((x) => seen.add(x)); break; // r5-fxb (CR 205.3j)
        case 'powers': { const p = ptNumbers(c).power; if (p !== null) seen.add(p); break; } // CLOUD std-misc (CR 208.1): an object with no power adds none
        case 'colorPairs': if (c.colors.length === 2) seen.add([...c.colors].sort().join('')); break; // r4-mech (CR 105.2a): only an object of exactly two colors
        case 'counterKinds': for (const [k, n] of Object.entries(o.counters)) if (n > 0) seen.add(k); break; // r4-static (CR 122.1): each kind of counter on the objects
        case 'creatureTypes': {
          // CR 702.73a, 205.3m: a changeling is every creature type because layer 4 gave it all of them, so the types it HAS count (trek-10: read from the computed
          // subtypes, not from the keyword: one that "becomes a Klingon" or "loses all creature types" is only what that effect says, Maskwood Nexus ruling 2021-02-05)
          creatureTypesOf(c).set.forEach((x) => seen.add(x));
          break;
        }
      }
    }
    return seen.size;
  },
  happenedCount: (cx, q) => {
    // FAST5 T45 (CR 702.40a): `beforeEvent`: only the history entries before the cast entry of the triggering spell (a spell cast in response is not counted);
    // not in an ability triggered by a cast, or when that entry is not in this turn's history, the value fails to determine
    if (q.beforeEvent === true) {
      const s = cx.g.s;
      const spell = cx.event?.ev === 'cast' ? cx.event.roles['spell'] : undefined;
      const id = spell !== undefined && 'objects' in spell ? spell.objects[0]?.id : undefined;
      let at = -1;
      if (id !== undefined) for (let i = s.history.length - 1; i >= 0 && at < 0; i--) if (s.history[i]!.ev === 'cast' && s.history[i]!.subject === id && s.history[i]!.turn === s.turn.number) at = i;
      return at < 0 ? undefined : happenedCountOf({ ...s, history: s.history.slice(0, at) }, q, factsEnv(cx));
    }
    return happenedCountOf(cx.g.s, q, factsEnv(cx)); // M6-0: `per: 'player'` is the per-player maximum, scope `lastTurn` the previous turn
  },
  // CLOUD std-tmt (CR 205.2a, 608.2h): "for each card type among spells you've cast this turn" (rules/history.ts#distinctHistory)
  happenedDistinct: (cx, q) => distinctHistory(cx.g.s, q.event, q.scope, q.by, factsEnv(cx), q.what), // cloud r3-mech: `what` 'sources' too
  // M6-0, CR 702.33d-e: how many times this spell (or the spell this permanent was, CR 400.7d) was kicked: every kicker payment counts, multikicker's too
  // (actions/cast.ts). An object that was never cast was kicked 0 times (CR 702.33d: only a spell can be kicked).
  kickCount: (cx, q) => {
    const paid = castRecord(cx)?.costsPaid;
    // M6-12 (CR 702.157a, 702.56a): "for each time its squad / replicate cost was paid": the payments of the additional cost of that name
    if (q.name !== undefined) return (paid?.additional ?? []).filter((n) => n === q.name).length;
    return paid?.kicked ?? 0;
  },
  // std-costs-1 (CR 601.2b): the number announced for the optional additional cost of that name (actions/cast-costs.ts); 0 when it was not paid
  costCount: (cx, q) => castRecord(cx)?.costsPaid.counts?.[q.name] ?? 0,
  // M6-0, CR 615.5: the damage the prevention effect whose `then` steps are running prevented; M6-1 runs those steps with the amount in `PREVENTED_AMOUNT_VAR`.
  // Anywhere else nothing was prevented "this way" and the value fails to determine (fails closed: the step does nothing, design 3.4).
  preventedAmount: (cx) => {
    const v = cx.vars.get(PREVENTED_AMOUNT_VAR);
    return v === undefined || Number.isNaN(v) ? undefined : v;
  },
  // M6-0, CR 702.37f, 702.168e: the X chosen as the source was turned face up by the morph / disguise special action (M6-3 writes GameObject.faceUpX). A
  // permanent that was not turned face up that way has no such X: fails to determine.
  faceUpX: (cx) => sourceObject(cx)?.faceUpX,
  // M11-0 (m11 design 4.5), CR 903.8: the controller's casts of their commander(s) from the command zone this game; 0 outside a Commander game (no commander
  // was ever cast from the command zone), which is the right number there too. M11-1 counts the casts (CommanderRec.casts).
  // CMD2 (CR 903.8): `of`, another player's casts ("for each time they've cast a commander from the command zone this game")
  commanderCasts: (cx, q) => { if (q.of === undefined) return commanderCastsOf(cx.g.s, cx.controller); const p = onePlayer(cx, q.of, 'a count of commander casts'); return p === undefined ? undefined : commanderCastsOf(cx.g.s, p); },
  // pc-statics-2 (CR 903.4, 903.4f): the colors of the controller's commanders' identity; 0 without a commander; unknown identity is not guessed
  commanderIdentitySize: (cx) => { if (commandersOf(cx.g.s, cx.controller).length === 0) return undefined; const c = identityManaColors(cx.g.s, cx.controller); return c === 'unknown' ? undefined : c.length; },
  eventAmount: (cx) => cx.event?.amount,
  // CLOUD std-misc (CR 608.2c-d, 607.2d): the number chosen by the linked "Choose a number ..." of this resolution (or remembered by the source)
  chosenNumber: (cx, q) => {
    const v = linkValue(cx, q.link)?.values?.[0];
    const n = v === undefined ? Number.NaN : Number(v);
    return Number.isInteger(n) ? n : undefined;
  },
  dieResult: (cx) => {
    // CR 706.2: the result of the die rolled by this resolution (the `rollDie` handler, WP15; NaN when several players rolled: no single result); otherwise, in
    // an ability triggered by a roll ("whenever you roll a die, ... equal to the result"), the triggering roll's (triggers/normalize.ts carries it as the amount)
    const v = cx.vars.get(DIE_RESULT_VAR);
    if (v !== undefined) return Number.isNaN(v) ? undefined : v;
    return cx.event?.ev === 'dieRoll' ? cx.event.amount : undefined;
  },
  spellsBefore: (cx) => (cx.event?.ev === 'cast' ? cx.event.spellsBefore : undefined), // CR 702.40a: fixed when the spell was cast, so a spell cast in response is not counted
  modesChosen: (cx) => (cx.event?.ev === 'cast' ? cx.event.modesChosen : undefined), // Standard round 3, r3-trig (CR 601.2b, 700.2): fixed when the spell was cast
  loyaltyRemoved: (cx) => (cx.event?.ev === 'activate' ? cx.event.loyaltyRemoved ?? 0 : undefined), // Standard round 3, r3-trig (CR 606.4): fixed as the cost was paid
  // FAST5X E19 (CR 106.4): the unspent mana in the controller's mana pool, of one type when given
  unspentMana: (cx, q) => cx.g.player(cx.controller).manaPool.filter((u) => q.type === undefined || u.type === q.type).length,
  // FAST5X E9 (CR 601.2h, 702.191a): the mana spent to cast the spell of the triggering cast event, fixed when it was cast.
  // FAST5X E19 (CR 601.2h, 707.10): `of` self is this spell or the permanent it became (its cast record); a copy or an object that was not cast spent none.
  // `from` (CR 106.3): only the mana whose source had that subtype as it produced it ("mana from a Treasure"); another filter fails to determine
  spellManaSpent: (cx, q) => {
    const of = q.of;
    const sub = q.from === undefined ? undefined : manaFromSubtype(q.from);
    if (sub === null) return undefined;
    if (of === undefined || (of.ref === 'event' && of.role === 'spell')) {
      if (cx.event?.ev !== 'cast') return undefined;
      return sub === undefined ? cx.event.manaSpent : cx.event.manaSpent === undefined ? undefined : cx.event.manaFrom?.[sub] ?? 0;
    }
    // r4-fxb (CR 601.2h, 608.2h): a target spell ("Counter target spell. If the amount of mana spent to cast that spell was less than its mana value, ..."): what
    // was spent to cast it, as it last existed on the stack once it has left it; a copy spent none (CR 707.10)
    if (of.ref === 'target') {
      const [h, more] = resolveObjs(cx, of);
      if (h === undefined || more !== undefined) return undefined;
      const o = readInfo(cx, h)?.object;
      if (o === undefined || o.stack === undefined || o.stack.kind !== 'spell') return undefined;
      if (o.kind === 'spellCopy' || o.stack.isCopy === true) return 0;
      const spent = o.stack.costsPaid.manaSpent ?? [];
      return sub === undefined ? spent.length : spent.filter((u) => u.sourceSubtypes?.includes(sub) === true).length;
    }
    if (of.ref !== 'self') return undefined;
    const src = sourceObject(cx);
    if (src === undefined || src.kind === 'spellCopy' || src.stack?.isCopy === true) return 0;
    const spent = castRecord(cx)?.costsPaid.manaSpent ?? [];
    return sub === undefined ? spent.length : spent.filter((u) => u.sourceSubtypes?.includes(sub) === true).length;
  },
  // FAST5X E17 (CR 608.2, 400.7): the resolutions this turn of the resolving ability of its source object, this one included (rules/resolutions.ts#countResolution)
  resolvedThisTurn: (cx) => {
    const key = cx.stack !== null ? resolutionKey(cx.stack) : null;
    return key === null ? undefined : cx.g.s.turnActivations[key] ?? 0;
  },
  resultCount: (cx, q) => {
    const r = cx.results.get(q.step);
    // p2-zone-moves-1 (CR 701.9a, 608.2c): "the greatest number of cards a player discarded this way": the moved objects counted by owner, the largest count
    if (q.maxPerOwner === true) {
      const per = new Map<string, number>();
      for (const i of q.which === undefined ? (r?.before ?? []) : movedMatching(cx, r?.before, q.which)) per.set(i.object.owner, (per.get(i.object.owner) ?? 0) + 1);
      return Math.max(0, ...per.values());
    }
    if (q.which === undefined) return r?.count ?? 0; // a step that did not run did nothing
    // Cloud C7 (CR 608.2c, 608.2h): "for each creature destroyed this way": what the step reports it moved that matched the filter as it last existed (its
    // controller then; a token that ceased to exist too). A step that reports nothing moved nothing that could be counted (0)
    // r5-fxz (CR 701.25a, 701.22a): of a surveil or a scry, the cards it left on top of the library (`kept`; such a step moves nothing it reports)
    return movedMatching(cx, r?.kept ?? r?.before, q.which).length;
  },
  // FAST5X E16 (CR 120.4a, 120.10, 608.2c): the excess damage the named damage or fight step dealt to permanents (to those of `to` only, as they are now: during
  // the resolution no state-based action has removed them yet, CR 704.3). A step that did not run dealt none; NaN (not computable) fails to determine.
  excessDamage: (cx, q) => {
    const excess = cx.results.get(q.step)?.excess;
    if (excess === undefined) return 0;
    const only = q.to === undefined ? null : new Set(resolveObjs(cx, q.to).map((h) => h.id));
    let n = 0;
    for (const [id, x] of excess) if (only === null || only.has(id)) n += x;
    return Number.isNaN(n) ? undefined : n;
  },
  // std-rx20 (CR 120.3, 608.2c): the damage the named damage step actually dealt; a step that did not run (or dealt nothing) dealt none
  damageDealt: (cx, q) => cx.results.get(q.step)?.dealt ?? 0,
  // M12-3 (CR 119.3, 608.2c): the life the named loseLife step made its players lose, summed; a step that did not run made nobody lose life
  // cloud std-spm (CR 119.3): with `who`, only the life those players lost in that step ("if you lost life this way", StepResult.lifeLostBy)
  lifeLost: (cx, q) => {
    const r = cx.results.get(q.step);
    if (q.who === undefined) return r?.lifeLost ?? 0;
    return resolvePlayers(cx, q.who).reduce((sum, p) => sum + (r?.lifeLostBy?.get(p) ?? 0), 0);
  },
  // std-rx14 (CR 122.1, 608.2c): the counters the named step actually removed (of one kind when given); a step that did not run removed none
  countersRemoved: (cx, q) => {
    const r = cx.results.get(q.step)?.countersRemoved;
    if (r === undefined) return 0;
    if (q.kind !== undefined) return r.get(q.kind) ?? 0;
    let n = 0;
    for (const v of r.values()) n += v;
    return n;
  },
  // trek-6 (CR 122.6, 608.2c): the counters the named step actually put (of one kind when given); a step that did not run put none
  countersPut: (cx, q) => {
    const r = cx.results.get(q.step)?.countersPut;
    if (r === undefined) return 0;
    if (q.kind !== undefined) return r.get(q.kind) ?? 0;
    let n = 0;
    for (const v of r.values()) n += v;
    return n;
  },
  // M12-3 (CR 702.121a, melee): the different opponents the controller attacked with creatures this combat (the history's player attacks of this combat phase)
  // trek-7 (CR 506.3, 508.1; Worf, Defiant Commander): `scope: 'turn'`, every combat of the turn so far, whether or not a combat is under way
  opponentsAttacked: (cx, q) => {
    const s = cx.g.s;
    const wholeTurn = q.scope === 'turn';
    if (!wholeTurn && s.combat === null) return 0;
    const attacked = new Set<string>();
    for (const e of s.history) {
      if (e.ev !== 'attacks' || e.turn !== s.turn.number || (!wholeTurn && e.combat !== s.combat!.number) || e.actor !== cx.controller || e.facts['defenderKind'] !== 'player') continue;
      const p = e.facts['defendingPlayer'];
      if (typeof p === 'string' && p !== cx.controller) attacked.add(p);
    }
    return attacked.size;
  },
  // M12-3 (CR 701.38a-b): the votes the named vote gave a word; a vote that did not happen gave none
  votes: (cx, q) => cx.results.get(q.step)?.votes?.get(q.choice) ?? 0,
  targetCount: (cx, q) => (cx.targets.get(q.id) ?? []).length, // CR 115.9a: the number of targets announced
  // CR 601.2c, 601.2f. FAST4 T21: the filtered form is read only by statics/costmods.ts (model/lint-nodes.ts allows it in self cost modifiers only): fails here
  spellTargetCount: (cx, q) => (q.filter !== undefined ? undefined : cx.stack?.targets.flat().length ?? 0),
  // std-costs-1 (CR 601.2f, 202.3): the total mana value of the spell's targets that are permanents (types/ability.ts); as a cost it is fixed by actions/cast.ts
  spellTargetTotal: (cx) => spellTargetTotal(cx.g.s, cx.stack?.targets ?? []),
  speed: (cx) => cx.g.s.designations.speed?.[cx.controller] ?? 0, // CR 702.179
  age: (cx) => countersOn(sourceObject(cx)?.counters ?? {}, 'age'), // CR 702.24 (cumulative upkeep)
  level: (cx) => countersOn(sourceObject(cx)?.counters ?? {}, 'level'), // CR 711
  turnNumber: (cx) => cx.g.s.turn.number,
  startingLife: (cx) => cx.g.s.options.startingLife, // FAST5 T60, CR 103.4
  cardsDrawnThisTurn: (cx) => cx.g.player(cx.controller).turnStats.cardsDrawn,
  spellsCastThisTurn: (cx) => cx.g.player(cx.controller).turnStats.spellsCast,
  lifeGainedThisTurn: (cx) => cx.g.player(cx.controller).turnStats.lifeGained,
  descendedThisTurn: (cx) => cx.g.player(cx.controller).turnStats.descended ?? 0, // FAST5X E22 (CR 700.11)
  turnsBegun: (cx) => cx.g.player(cx.controller).turnsBegun ?? 0, // std-r9 (CR 500.7, 500.11)
  // cloud std-dsk (CR 709.5c, 709.5j): "the number of unlocked doors among Rooms you control": each Room permanent's unlocked halves, summed (a Room that entered
  // with no door unlocked counts 0; a face-down permanent is no Room, CR 708.2)
  unlockedDoors: (cx, q) => {
    const s = cx.g.s;
    let n = 0;
    for (const h of resolveObjs(cx, q.among)) {
      const o = s.objects[h.id];
      const def = o ? s.defs[o.defId] : undefined;
      if (!o || !def || o.zone !== 'battlefield' || o.faceDown || o.kind === 'ability' || !hasSharedTypeLine(def)) continue;
      n += unlockedHalves(def, o).length;
    }
    return n;
  },
  // FAST4 T34 (CR 119.3, 120.3a): all the life one player lost this turn (rules/life.ts#changeLife counts every loss, damage included)
  lifeLostThisTurn: (cx, q) => {
    const p = onePlayer(cx, q.of, 'the player of "the life they lost this turn"');
    return p === undefined ? undefined : cx.g.player(p).turnStats.lifeLost;
  },
  // FAST4 T34 (CR 601.2h, 106.1; converge): the colors of mana spent to cast this spell or the permanent it became; a copy was not cast (CR 707.10), so 0
  colorsSpent: (cx) => {
    const src = sourceObject(cx);
    if (src === undefined || src.kind === 'spellCopy' || src.stack?.isCopy === true) return 0;
    const spent = castRecord(cx)?.costsPaid.manaSpent ?? [];
    return colorsAmong(spent);
  },
  // FAST5 T51 (CR 601.2h, 106.1): the colors of mana spent to cast the spell of the triggering cast event (it is on the stack when the trigger resolves, unless
  // something removed it: then its last known information, CR 608.2h)
  spellColorsSpent: (cx) => {
    if (cx.event?.ev !== 'cast') return undefined;
    const h = cx.event.roles.spell;
    const id = h !== undefined && 'objects' in h ? h.objects[0]?.id : undefined;
    const o = id === undefined ? undefined : cx.g.s.objects[id] ?? cx.event.before[id]?.object ?? cx.g.s.lki[id]?.object;
    if (o === undefined) return undefined;
    if (o.kind === 'spellCopy' || o.stack?.isCopy === true) return 0;
    const spent = o.zone === 'stack' && o.stack ? o.stack.costsPaid.manaSpent : o.cast?.costsPaid.manaSpent;
    return colorsAmong(spent ?? []);
  },
  // FAST5 T42 (CR 601.2h, 106.1): the mana spent to cast this spell or the permanent it became, every unit once; a copy was not cast (CR 707.10), so 0
  manaSpent: (cx) => {
    const src = sourceObject(cx);
    if (src === undefined || src.kind === 'spellCopy' || src.stack?.isCopy === true) return 0;
    return (castRecord(cx)?.costsPaid.manaSpent ?? []).length;
  },
  math: (cx, q) => {
    const args = q.args.map((a) => evalQty(cx, a));
    if (args.length === 0 || args.some((a) => a === undefined)) return undefined;
    const [first, ...rest] = args as number[];
    switch (q.op) {
      case '+': return args.reduce((a, b) => a! + b!, 0);
      case '-': return rest.reduce((a, b) => a - b, first!);
      case '*': return args.reduce((a, b) => a! * b!, 1);
      case 'min': return Math.min(...(args as number[]));
      case 'max': return Math.max(...(args as number[]));
      case 'floorDiv': case 'ceilDiv': {
        const d = rest[0];
        if (d === undefined || d === 0 || rest.length > 1) return undefined; // division by zero fails to determine
        return q.op === 'floorDiv' ? Math.floor(first! / d) : Math.ceil(first! / d); // "rounded down / up" (CR 107.1a)
      }
    }
  },
  live: (cx, q) => evalQty(cx, q.value),
  // MANUAL: the controller types the number. Asked once per resolution.
  ask: (cx, q) => {
    const before = askedBefore<number>(cx, q);
    if (before !== undefined) return before;
    const ans = cx.g.choose({ kind: 'chooseNumber', player: cx.controller, prompt: q.text, min: 0, max: 1000, rules: ['CR 608.2c'] });
    remember(cx, q, ans.n);
    return ans.n;
  },
};

/** The number of objects a reference stands for that can still be found (a moved object is a new one, CR 400.7). */
const currentCount = (cx: ExecCtx, ref: ObjRef): number => resolveObjs(cx, ref).filter((h) => isCurrent(cx, h)).length;

type QtyFn = (cx: ExecCtx, q: Quantity) => number | undefined;

/** The nodes that read `GameState.history`: evaluated, but advertised only once something writes it (rules/history.ts). */
const HISTORY_QTY: ReadonlySet<string> = new Set(['happenedCount']);
const HISTORY_COND: ReadonlySet<string> = new Set(['happened']);

/** The capability table (`q:<name>`, design 5.2). */
export const QTY_EVALUATORS: Readonly<Record<string, QtyFn>> = Object.fromEntries(
  Object.entries(QTY as unknown as Record<string, QtyFn>).filter(([name]) => HISTORY_WRITTEN || !HISTORY_QTY.has(name)),
);

/** The value of a quantity while an ability resolves; `undefined` = information that fails to determine (CR 608.2b). */
export function evalQty(cx: ExecCtx, q: Quantity): number | undefined {
  if (typeof q === 'number') return q;
  const f = Object.hasOwn(QTY_EVALUATORS, q.q) ? QTY_EVALUATORS[q.q] : HISTORY_QTY.has(q.q) ? (QTY as unknown as Record<string, QtyFn>)[q.q] : undefined;
  if (!f) throw new EngineBug(`No evaluator for the quantity "${q.q}" (the capability q:${q.q} is not advertised, so the degrade pass should have made it manual)`);
  return f(cx, q);
}
installQuantityEvaluator(evalQty);

/**
 * FAST5X E19 INTERFACE CHANGE: the spells `spellManaSpent.of` can name (model/cap-walk.ts): the triggering cast event's spell, or this spell itself (CR 601.2h);
 * and its `from` filter of one subtype (CR 106.3).
 */
export const QTY_FEATURES: readonly string[] = ['spellManaSpent.of.event', 'spellManaSpent.of.self', 'spellManaSpent.of.target' /* r4-fxb */, 'spellManaSpent.from.subtype', 'q.countPlayers.sizeVs', 'q.countPlayers.sizeIs', 'q.countPlayers.lifeIs' /* r4-static: also statics/match.ts */, 'lifeLost.who', 'q.countPlayers.lifeVs' /* std-lci: also statics/match.ts */, 'q.countPlayers.lostLife', 'q.countPlayers.controlsVs' /* std-sos review: also statics/match.ts */, 'resultCount.which' /* Cloud C7 */, 'q.distinct.powers' /* CLOUD std-misc */, 'q.distinct.colorPairs' /* r4-mech: also statics/match.ts */, 'q.distinct.permanentTypes' /* r4-cost: also statics/match.ts */, 'q.commanderCasts.of' /* CMD2 */, 'q.distinct.counterKinds' /* r4-static */, 'q.countPlayers.didNot' /* r5-fxz */, 'q.countPlayers.lostLifeIs' /* Standard round P: also statics/match.ts */, 'q.distinct.planeswalkerTypes' /* r5-fxb: also statics/match.ts */, 'q.countPlayers.controlsIs' /* std-rx12: also statics/match.ts */, 'q.countPlayers.poisonIs' /* std-rx24: also statics/match.ts, actions/announce-cond.ts */, 'q.countPlayers.speedVs' /* std-control-1: also statics/match.ts */, 'q.life.agg' /* p2-group-actions-1: also statics/match.ts */,
  'resultCount.maxPerOwner' /* p2-zone-moves-1 */]; // std-hob: countPlayers.sizeIs; FAST5 T53: countPlayers.sizeVs (also statics/match.ts); cloud std-spm: lifeLost.who; std-mkm: countPlayers.lostLifeThisTurn (also statics/match.ts)

/** FAST5X E19: the one subtype of a `spellManaSpent.from` filter (`{subtypes: [X]}`), or null for any other filter (not read: fails to determine). */
export function manaFromSubtype(f: ObjectFilter): string | null {
  const keys = Object.keys(f);
  return keys.length === 1 && f.subtypes !== undefined && f.subtypes.length === 1 ? f.subtypes[0]! : null;
}
// FAST5X E9: statics/match.ts reads the history with the same reader ("as long as ... this turn", CR 611.3a); statics may not import rules/history (design 5.4)
installHistoryCounter((s, event, scope, by, env) => countHistory(s, event, scope, by, env));

// ---- conditions -----------------------------------------------------------------------------------------------------------------------------------------

type CondTable = { [K in Condition['cond']]?: (cx: ExecCtx, c: CondOf<K>) => boolean };

/** The colors (W, U, B, R, G) among the mana spent; colorless mana is no color (CR 105.1, 601.2h). */
const colorsAmong = (spent: readonly { type: string }[]): number =>
  new Set(spent.map((u) => u.type).filter((t) => t === 'W' || t === 'U' || t === 'B' || t === 'R' || t === 'G')).size;

/** The cast record of the source: the spell that is becoming a permanent (CR 400.7d), or what the permanent remembers (CR 607.2i-j). */
/** The cast record a spell keeps while it is on the stack (CR 601.2b-h): undefined for anything else. */
function stackCastRecord(o: GameObject): ReturnType<typeof castRecord> {
  if (o.zone !== 'stack' || !o.stack || o.kind === 'ability') return undefined;
  const st = o.stack;
  return { costsPaid: st.costsPaid, ...(st.x !== undefined ? { x: st.x } : {}), ...(st.castFrom !== undefined ? { from: st.castFrom } : {}), ...(st.costsPaid.alternative !== undefined ? { via: st.costsPaid.alternative } : {}), ...(st.caster !== undefined ? { by: st.caster } : {}) };
}

function castRecord(cx: ExecCtx): { costsPaid: CostsPaid; x?: number; from?: CastOrigin; via?: string; by?: PlayerId } | undefined {
  const src = sourceObject(cx);
  if (!src) return undefined;
  const onStack = stackCastRecord(src);
  if (onStack !== undefined) return onStack;
  if (!src.cast) return undefined;
  const { costsPaid, x, from, by } = src.cast;
  const via = src.cast.via ?? costsPaid.alternative;
  return { costsPaid, ...(x !== undefined ? { x } : {}), from, ...(via !== undefined ? { via } : {}), ...(by !== undefined ? { by } : {}) };
}

/**
 * std-tdm (CR 601.2a, 603.4, 400.7d): the cast record of the object a `wasCast.object` names ("Whenever a creature you control enters, if you cast it"): what the
 * permanent that entered keeps of the spell it was, read from last known information once it has left (CR 608.2h). Undefined for an object that was not cast.
 */
function castRecordOf(cx: ExecCtx, ref: ObjRef): ReturnType<typeof castRecord> {
  const h = resolveObjs(cx, ref)[0];
  const o = h === undefined ? undefined : cx.g.s.objects[h.id] ?? cx.g.s.lki[h.id]?.object;
  // p2-intervening-1 (CR 601.2i, 702.33d): a spell on the stack keeps its record there ("Whenever you cast a spell, if that spell was kicked", the spell of the event)
  const onStack = o === undefined ? undefined : stackCastRecord(o);
  if (onStack !== undefined) return onStack;
  if (o?.cast === undefined) return undefined;
  const { costsPaid, x, from, by } = o.cast;
  const via = o.cast.via ?? costsPaid.alternative;
  return { costsPaid, ...(x !== undefined ? { x } : {}), from, ...(via !== undefined ? { via } : {}), ...(by !== undefined ? { by } : {}) };
}

/**
 * FAST5X E11 (CR 701.4b): does a beheld card or permanent, as it was when it was beheld, have the quality? A quality names only types, subtypes and supertypes
 * (each list: any of them, as rules/filter.ts reads them); any other field is not something a snapshot holds, so the answer is no (fail closed).
 */
export function beheldHas(b: BeheldSnapshot, q: ObjectFilter): boolean {
  if (Object.keys(q).some((k) => k !== 'types' && k !== 'subtypes' && k !== 'supertypes')) return false;
  if (q.types && !q.types.some((t) => b.types.includes(t))) return false;
  if (q.subtypes && !q.subtypes.some((t) => b.subtypes.includes(t))) return false;
  if (q.supertypes && !q.supertypes.some((t) => b.supertypes.includes(t))) return false;
  return true;
}

/**
 * FAST5X E26 (CR 702.192a, paradigm): is the resolving source a spell whose name no spell controlled by this resolution's controller has had in an earlier
 * resolution this game? The earlier resolutions are the game history's `resolves` entries (triggers/history.ts: written once each resolution is over, so the
 * resolution in progress is not among them); an entry counts when its object was a spell (a card or a copy of a spell, CR 707.10: never an ability, which has
 * no card type) controlled by that player and shares a name with the source (CR 201.2). Outside the resolution of a spell it is false.
 */
function firstNamedResolution(cx: ExecCtx): boolean {
  const src = sourceObject(cx);
  if (!src || src.zone !== 'stack' || src.kind === 'ability' || src.kind === 'emblem') return false;
  const names = charsOfObject(cx.g.s, src).names;
  if (names.length === 0) return false;
  const spellTypes = new Set(['Instant', 'Sorcery', 'Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Kindred', 'Tribal']);
  return !cx.g.s.history.some((e) => {
    if (e.ev !== 'resolves' || e.facts['controller'] !== cx.controller) return false;
    const types = String(e.facts['types'] ?? '').split('|'); // rules/history.ts#objectFacts writes lists as |a|b|
    if (!types.some((t) => spellTypes.has(t))) return false; // an ability has no card type (CR 113.1)
    const theirs = [...String(e.facts['names'] ?? '').split('|'), String(e.facts['name'] ?? '')];
    return theirs.some((n) => n !== '' && names.includes(n));
  });
}

/**
 * trek-2 (CR 601.2i, 707.10): is the resolving source a spell whose own `cast` history entry is the first `cast` entry of this resolution's controller this game
 * ("If this spell is the first spell you've cast this game")? The entries are in the order the spells became cast (triggers/history.ts, never pruned), so a spell
 * cast in response to this one comes after it. A copy that was not cast (CR 707.10) has no cast entry: false. Outside the resolution of a spell it is false.
 */
function firstSpellCast(cx: ExecCtx): boolean {
  const src = sourceObject(cx);
  if (!src || src.zone !== 'stack' || src.kind === 'ability' || src.kind === 'emblem') return false;
  const h = cx.g.s.history;
  const own = h.findIndex((e) => e.ev === 'cast' && e.subject === src.id);
  if (own < 0 || h[own]!.actor !== cx.controller) return false;
  return !h.slice(0, own).some((e) => e.ev === 'cast' && e.actor === cx.controller);
}

const COND: CondTable = {
  all: (cx, c) => c.of.every((x) => evalCond(cx, x)),
  any: (cx, c) => c.of.some((x) => evalCond(cx, x)),
  not: (cx, c) => !evalCond(cx, c.of),
  compare: (cx, c) => {
    const l = evalQty(cx, c.left);
    const r = evalQty(cx, c.right);
    return l === undefined || r === undefined ? false : compareNumbers(c.op as Cmp, l, r); // a side that fails to determine makes it false (design 3.4)
  },
  // std-rx1: "you control a prime number of lands"; a quantity that fails to determine makes it false (design 3.4)
  prime: (cx, c) => {
    const n = evalQty(cx, c.of);
    return n !== undefined && isPrime(n);
  },
  exists: (cx, c) => {
    const need = c.atLeast === undefined ? 1 : evalQty(cx, c.atLeast);
    return need === undefined ? false : currentCount(cx, c.of) >= need;
  },
  // std-cardcopy-1 (CR 205.2a, 105.2, 608.2c, 608.2h): "if two cards that share a card type / a color were milled this way": some card type (or color) is one of
  // those of at least `count` of the objects, each read where it is now or as it last existed (an object counted once; a colorless one has no color)
  share: (cx, c) => {
    const seen = new Set<string>();
    const tally = new Map<string, number>();
    for (const { o, c: ch } of infoCharsOf(cx, resolveObjs(cx, c.of))) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      for (const t of new Set<string>(c.what === 'color' ? ch.colors : ch.types)) tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    // trek-9: `all`, a type (color) every one of them has, with at least one object (an empty set has nothing in common)
    const need = c.count === 'all' ? seen.size : c.count;
    return (c.count !== 'all' || seen.size > 0) && [...tally.values()].some((n) => n >= need);
  },
  matches: (cx, c) => {
    const hs = resolveObjs(cx, c.object);
    if (hs.length === 0) return false; // nothing to test (an illegal target, an empty binding)
    const ctx = filterCtxOf(cx);
    return hs.every((h) => {
      const i = readInfo(cx, h); // last known information if it moved (CR 608.2h)
      if (i === undefined) return false;
      // r4-dig (CR 708.2a, 701.20a): "Reveal target face-down permanent. If it's a creature card, you may turn it face up." The question is about the CARD
      // (`isCard`), so a face-down card on the battlefield is read with the characteristics of its face-up face, not the face-down 2/2 profile (every face-down
      // permanent is a creature): a manifested land card is no creature card. Only that one question; anything else reads the face-down characteristics.
      const o = i.object;
      const def = c.filter.isCard === true && o.faceDown && o.zone === 'battlefield' && o.kind === 'card' ? cx.g.s.defs[o.defId] : undefined;
      if (def !== undefined) {
        const up = { ...o, faceDown: false };
        const card = sourceChars(def, { kind: 'face', face: faceIndexOf(def, up) });
        const { name, names, colors, supertypes, types, subtypes, manaCost } = card;
        const chars: Chars = { ...charsOfObject(cx.g.s, o), name, names, colors, supertypes, types, subtypes, manaCost, manaValue: baseManaValue(def, card, up) };
        return matchesFilter(cx.g.s, up, c.filter, { ...ctx, chars });
      }
      return matchesFilter(cx.g.s, o, c.filter, i.chars ? { ...ctx, chars: i.chars } : ctx);
    });
  },
  // Standard round 5, r5-trig (CR 603.4, 608.2h): "one or more of them ...": at least one of the objects matches (as `matches` reads each one)
  someMatch: (cx, c) => {
    const ctx = filterCtxOf(cx);
    return resolveObjs(cx, c.object).some((h) => {
      const i = readInfo(cx, h);
      return i !== undefined && matchesFilter(cx.g.s, i.object, c.filter, i.chars ? { ...ctx, chars: i.chars } : ctx);
    });
  },
  turnOf: (cx, c) => {
    const s = cx.g.s;
    const active = s.turn.activePlayer;
    const r = playerPredMatches(c.whose, active, cx.controller, (ref) => resolvePlayers(cx, ref));
    if (r !== true) return false;
    if (c.step === undefined) return true;
    return ([] as string[]).concat(c.step).includes(s.turn.step);
  },
  // Cast history of THIS object: it must have been cast for any of the fields to hold.
  wasCast: (cx, c) => {
    const r = c.object !== undefined ? castRecordOf(cx, c.object) : castRecord(cx);
    // CR 702.33d: only a spell can be kicked, so an object that was never cast (put onto the battlefield) was not kicked; every other part is false for it.
    if (!r) return c.kicked === false && c.via === undefined && c.from === undefined && c.spent === undefined && !(c.xAtLeast !== undefined && c.xAtLeast > 0);
    if (c.kicked !== undefined) {
      const kicked = typeof c.kicked === 'string' ? (r.costsPaid.additional ?? []).includes(c.kicked) : (r.costsPaid.kicked ?? 0) > 0;
      if (typeof c.kicked === 'boolean' ? kicked !== c.kicked : !kicked) return false;
    }
    if (c.via !== undefined && !(r.via === c.via || (r.via?.startsWith(`${c.via}:`) ?? false))) return false; // p2-graveyard-1: `<via>:2`, a cost from another zone (CR 601.3)
    if (c.kept === true && (c.object !== undefined || !wasCastKept(sourceObject(cx), cx.controller))) return false; // std-rx22 (CR 702.62a)
    if (c.from !== undefined && r.from !== c.from) return false;
    // Standard round 4, r4-trig (CR 400.3, 601.2a): "cast from your graveyard": the card was in its owner's zone, and the owner is the controller of this ability
    if (c.fromOwner === 'you' && readInfo(cx, cx.source)?.object.owner !== cx.controller) return false;
    if (c.xAtLeast !== undefined && (r.x ?? 0) < c.xAtLeast) return false;
    if (c.by === 'you' && r.by !== cx.controller) return false; // FAST4 T27 (CR 601.2a): "if you cast it"
    if (c.spent !== undefined && !spentAtLeast(r.costsPaid.manaSpent, c.spent)) return false; // FAST5 T37 (CR 601.2h): adamant
    return true;
  },
  // FAST5X E11 (CR 701.4b): "if a Dragon was beheld": something with that quality, as it was when it was beheld, paid this spell's behold cost (the cast
  // record of the spell, or of the spell this permanent was, CR 400.7d). Nothing was beheld for an object that was never cast.
  beheld: (cx, c) => (castRecord(cx)?.costsPaid.beheld ?? []).some((b) => beheldHas(b, c.quality)),
  happened: (cx, c) => {
    const n = countHistory(cx.g.s, c.event, c.scope, c.by, factsEnv(cx));
    if (!c.times) return n >= 1;
    const want = evalQty(cx, c.times.value);
    return want === undefined ? false : compareNumbers(c.times.op, n, want);
  },
  // CR 118.12 / 608.2c: "if you do" asks whether the earlier step was carried out (for `may` and `pay`: whether the player chose to).
  // FAST5X E17 (CR 601.2i): decided when this spell became cast (actions/cast-checks.ts); a spell that was not cast has no record
  asCast: (cx, c) => {
    const src = sourceObject(cx);
    return src?.zone === 'stack' && src.kind !== 'ability' ? src.stack?.castChecks?.[castCheckKey(c.held)] === true : false;
  },
  // FAST5X E26 (CR 702.192a, paradigm): "if this is the first time a spell you control with this spell's name has resolved this game"
  firstNamedResolution: (cx) => firstNamedResolution(cx),
  // trek-2 (CR 601.2i): "if this spell is the first spell you've cast this game"
  firstSpellCast: (cx) => firstSpellCast(cx),
  // CMD3 (CR 702.30a, echo): no player gets priority in an untap step (CR 502.4), so nothing comes under a player's control between the beginning of their turn
  // and the beginning of its upkeep: "during or after the turn of that upkeep" is "since the beginning of that upkeep"
  controlledSinceUpkeep: (cx, c) => {
    const s = cx.g.s;
    const hs = resolveObjs(cx, c.object);
    const p = s.players.find((x) => x.id === cx.controller);
    if (hs.length === 0 || p === undefined) return false;
    const ups = p.upkeepTurns ?? [];
    const during = s.turn.step === 'upkeep' && s.turn.activePlayer === p.id && ups.at(-1) === s.turn.number;
    const since = during ? ups.at(-2) : ups.at(-1);
    return hs.every((h) => {
      const o = isCurrent(cx, h) ? s.objects[h.id] : undefined;
      return o !== undefined && o.zone === 'battlefield' && o.controller === p.id && (since === undefined || o.controlledSinceTurn >= since);
    });
  },
  // Standard round 4, r4-trig (CR 500.8, 505.1a, 506.1): "if it's the first combat phase of the turn": the combat in progress is the turn's first (rules/combat-state.ts numbers them)
  firstCombat: (cx) => cx.g.s.combat !== null && cx.g.s.combat.number === 1,
  // Standard round 5, r5-trig (CR 603.4, 603.2c): "if it's the first time that creature has become tapped this turn": every such event of the turn about that object
  // is one batch (rules/history.ts#firstTimeThisTurn); the history is brought up to date first, as for `happened`
  firstTime: (cx, c) => firstTimeThisTurn(cx.g.s, resolveObjs(cx, c.object).map((h) => h.id), c.event, factsEnv(cx)),
  did: (cx, c) => {
    const r = cx.results.get(c.step);
    if (c.which === undefined) return (r?.performed ?? false) !== (c.not === true);
    // FAST5X E17 (CR 608.2c, 608.2h): an object the step moved matched the filter as it last existed (its controller then; a token that ceased to exist)
    // std-rw9 (CR 701.8a, 614.6): of a destroy, only the objects that went to the zone `to` names (StepResult.beforeTo)
    const to = r?.beforeTo;
    const before = c.to !== undefined && to !== undefined ? r?.before?.filter((_, i) => to[i] === c.to) : r?.before;
    const any = movedMatching(cx, before, c.which).length > 0;
    return any !== (c.not === true);
  },
  designation: (cx, c) => {
    const d = cx.g.s.designations;
    switch (c.what) {
      case 'monarch': return resolvePlayers(cx, c.who).some((p) => d.monarch === p); // CR 724
      case 'initiative': return resolvePlayers(cx, c.who).some((p) => d.initiative === p); // CR 725
      case 'day': return d.dayNight === 'day'; // CR 726
      case 'night': return d.dayNight === 'night';
      case 'citysBlessing': return resolvePlayers(cx, c.who).some((p) => d.citysBlessing?.includes(p) === true); // CR 702.131c
      case 'maxSpeed': return resolvePlayers(cx, c.who).some((p) => (d.speed?.[p] ?? 0) >= 4); // FAST5X-4, CR 702.179e-f: speed 4; no speed is 0
      case 'enduringStory': return resolvePlayers(cx, c.who).some((p) => d.enduringStory?.includes(p) === true); // FAST5X E18: Storied reminder text, CR 702.131c analogue
    }
  },
  // MX4, CR 309.7: "you've completed a dungeon" / "you haven't completed Tomb of Annihilation" (the latter as `not`)
  completedDungeon: (cx, c) => resolvePlayers(cx, c.who).some((p) => hasCompleted(cx.g.s, p, c.name)),
  // The value a linked ability chose (CR 607.2d); an undefined choice equals nothing (CR 607.5a).
  chosen: (cx, c) => linkValue(cx, c.link)?.values?.[0]?.toLowerCase() === c.equals.toLowerCase(),
  // M6-0, CR 716.2a-d: "as long as this Class is level N or greater" reads the Class's level designation (absent = level 1, CR 716.2d), never level counters
  // (CR 716.4). An object that is not a Class has no level designation: false (it is checked on its current or last known characteristics, CR 608.2h).
  classLevel: (cx, c) => {
    const hs = resolveObjs(cx, c.object);
    if (hs.length === 0) return false;
    return hs.every((h) => {
      const i = readInfo(cx, h);
      return i !== undefined && i.chars !== null && i.chars.subtypes.includes('Class') && (i.object.classLevel ?? 1) >= c.atLeast;
    });
  },
  // M6-0, CR 702.37b: a flag of the event being replaced, set by the `during` body (M6-3) in `EVENT_FLAG_VARS`; outside such a body there is no event: false.
  eventFlag: (cx, c) => (cx.vars.get(EVENT_FLAG_VARS[c.flag]) ?? 0) === 1,
  // MANUAL: the named player (the controller by default) is asked yes / no. Asked once per resolution.
  ask: (cx, c) => {
    const before = askedBefore<boolean>(cx, c);
    if (before !== undefined) return before;
    const who = c.who ? onePlayer(cx, c.who, 'a manual condition') ?? cx.controller : cx.controller;
    const ans = cx.g.choose({ kind: 'yesNo', player: who, prompt: c.text, rules: ['CR 608.2c'] });
    remember(cx, c, ans.yes);
    return ans.yes;
  },
};

type CondFn = (cx: ExecCtx, c: Condition) => boolean;

/** The capability table (`cond:<name>`, design 5.2). */
export const COND_EVALUATORS: Readonly<Record<string, CondFn>> = Object.fromEntries(
  Object.entries(COND as unknown as Record<string, CondFn>).filter(([name]) => HISTORY_WRITTEN || !HISTORY_COND.has(name)),
);

/** Whether a condition holds while an ability resolves. */
export function evalCond(cx: ExecCtx, c: Condition): boolean {
  const f = Object.hasOwn(COND_EVALUATORS, c.cond) ? COND_EVALUATORS[c.cond] : HISTORY_COND.has(c.cond) ? (COND as unknown as Record<string, CondFn>)[c.cond] : undefined;
  if (!f) throw new EngineBug(`No evaluator for the condition "${c.cond}" (the capability cond:${c.cond} is not advertised)`);
  return f(cx, c);
}

/**
 * The `Duration` discriminators (`d`) the engine can end correctly (capabilities `dur:<d>`). WP15 INTERFACE CHANGE: filled with the forms core/durations.ts ends
 * (design 3.7); the table stays here, where the builder of the capability set reads it. NOT `asLongAs`: design 3.7 says it is "evaluated live", i.e. every
 * time the effect is read, but the build judges it only when a player would receive priority (core/durations.ts#endDurations); the layer system
 * (statics/live.ts) cannot evaluate a general condition, so an effect read later in the same resolution, or by a turn-based action, would still apply. It is
 * advertised once statics/live.ts (WP9) judges it like `whileSource`.
 */
export const DUR_EVALUATORS: Readonly<Record<string, true>> = {
  endOfTurn: true, endOfCombat: true, permanent: true, whileSource: true, until: true, untilNextTurn: true, untilNextStep: true,
  throughNextUntap: true, // MX5: ends as that untap step ends (core/durations.ts#expireAfterUntapStep, CR 502.3)
  endOfNextTurn: true, // FAST5X E29: becomes endOfTurn as that player's next turn begins (core/durations.ts#expireAtTurnStart, CR 611.2a, 514.2)
  untilExiledWith: true, // r5-dig: until the source exiles another card (core/durations.ts#endDurations, CR 611.2a, 607.2a)
  whileObject: true, // std-rx32: judged live from the named object's state (statics/while-object.ts, core/durations.ts#endDurations, CR 611.2b)
  duringNextTurn: true, // std-control-1: dormant until the next turn begins, then endOfTurn (core/durations.ts#expireAtTurnStart, statics/rule-sources.ts#durationActive); restrictions only (cap-walk)
  remainsExiled: true, // FAST5X E29: while a named object stays in exile (core/durations.ts#endDurations, CR 611.2b, 400.7); permissions only (cap-walk)
};

/**
 * audit-fix-2 (CR 500.7, 611.2a): the variable of a resolution that holds the id of the one extra turn its last `extraTurn` step created (-1 when that step
 * created none or more than one), for "During that turn" (`duringNextTurn.turn`, effects/handlers/lasting-fix.ts#fixDuration).
 */
export const EXTRA_TURN_VAR = '$extraTurn';

/** The variable of a resolution that holds the result of its last die roll (`q:dieResult`); `$` names are the interpreter's own, never a `let` name. */
export const DIE_RESULT_VAR = '$dieResult';

/** M6-0: the variable that holds the damage a prevention effect prevented while its `then` steps run (`q:preventedAmount`, CR 615.5; set by M6-1). */
export const PREVENTED_AMOUNT_VAR = '$preventedAmount';

/** M6-0: the variables that hold the flags of the event a `during` body replaces (`cond:eventFlag`, 1 = set; written by M6-3's `during` body). */
export const EVENT_FLAG_VARS: Readonly<Record<Extract<Condition, { cond: 'eventFlag' }>['flag'], string>> = { megamorphPaid: '$event.megamorphPaid' };

// ---- counts ----------------------------------------------------------------------------------------------------------------------------------------------

export interface CountEnv {
  /** The announced value of X (CR 107.3), when it is known. */
  x?: number;
  /** A resolution context: with it a computed `Count` (a quantity other than X) can be read; without it only numbers, "any" and X can. */
  cx?: ExecCtx;
}

/**
 * A `Count` as a number: a fixed number, "any number" (unbounded, `Infinity`: callers clamp it to what is available), the announced X (CR 107.3a), or, when
 * the caller has a resolution context (`env.cx`), any quantity (one that fails to determine counts as 0: nothing).
 *
 * X is announced (CR 601.2b) before targets are chosen (CR 601.2c), so a caller that has X MUST pass it: reading X without an environment throws instead of
 * quietly answering 0 (a spell like "up to X target creatures" would otherwise be put on the stack with no targets). A caller that asks BEFORE X is announced
 * (is the spell castable at all, CR 601.2c-d, 107.3b) passes `{ x: 0 }` on purpose: X = 0 is always a legal announcement.
 */
export function evalCount(count: Count, env: CountEnv = {}): number {
  if (typeof count === 'number') return count;
  if (count === 'any') return Number.POSITIVE_INFINITY;
  if (typeof count === 'object' && count.q === 'X' && env.x !== undefined) return env.x;
  if (env.cx) return Math.max(0, evalQty(env.cx, count) ?? 0); // CR 107.1b: a calculated number of things is 0 if the result is negative
  if (typeof count === 'object' && count.q === 'X') throw new EngineBug('evalCount: X has not been announced yet (CR 601.2b, 107.3a); the caller must pass { x }');
  throw new EngineBug('evalCount of a computed quantity needs CountEnv.cx, the resolution context');
}
