/**
 * State-based actions on objects (CR 704.5d-z). The player-loss checks (704.5a-c) are in core/sba.ts.
 *
 * One call is one check (CR 704.3): every applicable action is determined from the state as it is now, then they are all performed as a
 * single event; the caller repeats the check until nothing happens. The legend rule is the one place a player decides (CR 704.5j).
 *
 * Not implemented because the objects don't exist yet: 704.5r (counter limits, needs static abilities), 704.5u (space sculptor).
 * See STATUS.md. M6-6: 704.5s (Sagas, CR 714.4). MX4: 704.5t (dungeons) is core/dungeons.ts, dungeonSbas. FAST5X-4: 704.5aa (start your engines!, a player SBA) is core/sba.ts#speedSba.
 */
import type { ObjectId } from '../types/ids';
import type { AbilityDef } from '../types/ability';
import type { GameObject, GameState, PendingTrigger } from '../types/state';
import { abilitiesFromChars, abilityDefOnStack } from '../rules/abilities';
import { finalChapter } from '../statics/levels';
import { keptPreparedCopy, preparedCopiesToMake } from './prepare';
import { auraAttachedLegally, equipmentAttachedLegally, isAura, isEquipment, isFortification } from '../rules/attachment';
import { charsOfObject, hasKeyword, ptNumbers, readingStable, type Chars } from '../rules/characteristics';
import { addCounters } from '../rules/counters';
import { removeFromCombat } from '../rules/combat-state';
import { destroy } from '../rules/destroy';
import { zeroLoyaltyKept } from '../statics/hooks';
import type { Game } from './game';
import { chooseSiegeProtector, leavingTogether, moveObject, zoneArray } from './zones';
import { legendRuleExempt } from '../statics/hooks';

interface Item {
  o: GameObject;
  c: Chars;
}

/** CR 506.4: creatures that left the battlefield, changed controller or stopped being creatures are no longer in combat. */
function pruneCombat(g: Game): void {
  const combat = g.s.combat;
  if (!combat) return;
  const ap = g.s.turn.activePlayer;
  /** An attacker must still be a creature controlled by the active player; a blocker one controlled by the player who declared it (CR 506.4). */
  const stale = (id: ObjectId, controller: string): boolean => {
    const o = g.s.objects[id];
    if (!o || o.zone !== 'battlefield' || o.phasedOut) return true;
    if (!charsOfObject(g.s, o).types.includes('Creature')) return true;
    return o.controller !== controller;
  };
  for (const a of [...combat.attackers]) {
    if (stale(a.id, ap)) removeFromCombat(g.s, a.id);
    else if (a.defender !== null) {
      // A planeswalker or battle that is no longer one, or no longer controlled / protected by the defending player, is removed from combat (CR 506.4);
      // creatures that attacked it attack nothing (CR 506.4c).
      const d = g.s.objects[a.defender];
      if (d !== undefined) {
        const dc = charsOfObject(g.s, d);
        const walker = dc.types.includes('Planeswalker');
        const battle = dc.types.includes('Battle');
        const keeper = battle && d.protector !== undefined ? d.protector : d.controller;
        if (d.zone !== 'battlefield' || d.phasedOut || !(walker || battle) || keeper !== a.defendingPlayer) a.defender = null;
      } else if (!g.s.players.some((p) => p.id === a.defender && !p.hasLost)) a.defender = null; // M12-2 (E18): CR 800.4e, a player who left is attacked by nothing
    }
  }
  for (const b of [...combat.blockers]) {
    if (stale(b.id, b.defendingPlayer)) removeFromCombat(g.s, b.id);
  }
}

/** An object ceases to exist (CR 704.5d, 704.5e): it is removed from its zone without going anywhere. */
function cease(g: Game, o: GameObject, why: string, rule: string): void {
  const name = g.nameOf(o.id);
  const arr = zoneArray(g, o.zone, o.owner);
  const i = arr.indexOf(o.id);
  if (i >= 0) arr.splice(i, 1);
  delete g.s.objects[o.id];
  g.log(`${name} (${why}) ceases to exist.`, { rules: [rule], level: 'info' });
}

/**
 * Put a permanent into its owner's graveyard for a state-based action. WP11 INTERFACE CHANGE (review): the move goes through the proposal pipeline, which may
 * drop it (a "can't leave" effect, CR 614.17); then nothing happened, and false is returned so the pass does not count it (no endless loop of SBA passes).
 */
const toGraveyard = (g: Game, o: GameObject, why: string, rules: string[]): boolean => {
  const name = g.nameOf(o.id);
  moveObject(g, o.id, 'graveyard', { cause: why });
  if (g.s.objects[o.id]?.zone === o.zone) return false;
  g.log(`${name} is put into its owner's graveyard (${why}).`, { rules, level: 'action' });
  return true;
};

function unattach(g: Game, o: GameObject, why: string, rules: string[]): void {
  delete o.attachedTo;
  g.log(`${g.nameOf(o.id)} becomes unattached (${why}).`, { rules, level: 'action' });
}

/** True while the object is the source of an ability that has triggered but not yet left the stack (CR 704.5s, 704.5v). */
function isSourceOfPendingAbility(g: Game, id: ObjectId): boolean {
  return g.s.pendingTriggers.some((t) => t.sourceId === id) || g.s.zones.stack.some((sid) => g.s.objects[sid]?.stack?.kind === 'triggered' && g.s.objects[sid]?.stack?.sourceId === id);
}

/** The ability behind a pending trigger: the source's ability with its key now (or last known), else the printed one (as triggers/stack.ts#pendingDef). */
function pendingTriggerDef(s: GameState, t: PendingTrigger): AbilityDef | undefined {
  if (t.inline) return t.inline;
  const o = s.objects[t.sourceId];
  const lk = s.lki[t.sourceId];
  const chars = o ? charsOfObject(s, o) : lk ? lk.chars ?? charsOfObject(s, lk.object) : undefined;
  const found = chars ? abilitiesFromChars(chars).find((a) => a.key === t.abilityRef.key)?.def : undefined;
  if (found) return found;
  return t.abilityRef.source === 'printed' ? s.defs[o?.defId ?? lk?.object.defId ?? '']?.faces[t.abilityRef.face]?.abilities[t.abilityRef.index] : undefined;
}

/** M6-6, CR 704.5s, 714.4: is this Saga the source of a CHAPTER ability that has triggered but not yet left the stack (waiting to be put on it, or on it)? */
function isSourceOfPendingChapter(g: Game, id: ObjectId): boolean {
  const s = g.s;
  if (s.pendingTriggers.some((t) => t.sourceId === id && pendingTriggerDef(s, t)?.kind === 'chapter')) return true;
  return s.zones.stack.some((sid) => {
    const o = s.objects[sid];
    return o?.stack?.kind === 'triggered' && o.stack.sourceId === id && abilityDefOnStack(s, o)?.kind === 'chapter';
  });
}

/**
 * M6-6, CR 704.5s, 714.4: a Saga permanent with one or more chapter abilities whose lore counters are at least its final chapter number (CR 714.2d), and that
 * isn't the source of a chapter ability that has triggered but not yet left the stack: its controller sacrifices it.
 */
function finishedSagas(g: Game, bf: readonly Item[]): Item[] {
  return bf.filter(({ o, c }) => {
    if (!c.subtypes.includes('Saga')) return false;
    const final = finalChapter(c.abilities);
    return final > 0 && (o.counters['lore'] ?? 0) >= final && !isSourceOfPendingChapter(g, o.id);
  });
}

/** CR 704.5m, 704.5n, 704.5p: the Auras that go to the graveyard and the attachments that become unattached, judged on the current state (it reads only). */
function attachmentLosers(s: GameState, bf: readonly Item[], auraLosers: { it: Item; unattachFirst: boolean }[], unattachs: { o: GameObject; why: string; rule: string }[]): void {
  for (const it of bf) {
    const { o, c } = it;
    if (isAura(c)) {
      if (c.types.includes('Creature')) { auraLosers.push({ it, unattachFirst: true }); continue; } // CR 303.4d
      if (auraAttachedLegally(s, o, c) === false) auraLosers.push({ it, unattachFirst: false });
    } else if (o.attachedTo !== undefined && (c.types.includes('Creature') || c.types.includes('Battle'))) {
      // CR 704.5p: a creature or battle can't be attached, even if it is also an Equipment (CR 301.5c).
      unattachs.push({ o, why: 'a creature or battle can not be attached', rule: 'CR 704.5p' });
    } else if (isEquipment(c) || isFortification(c)) {
      if (o.attachedTo !== undefined && !equipmentAttachedLegally(s, o, c)) unattachs.push({ o, why: 'attached to an illegal permanent', rule: 'CR 704.5n' });
    } else if (o.attachedTo !== undefined) {
      unattachs.push({ o, why: c.types.includes('Creature') || c.types.includes('Battle') ? 'a creature or battle can not be attached' : 'it is neither an Aura, Equipment nor Fortification', rule: 'CR 704.5p' });
    }
  }
}

/** Returns true if any state-based action was performed. */
export function performObjectSbas(g: Game): boolean {
  pruneCombat(g);
  const madeCopies = preparedCopiesToMake(g); // M6-6, CR 722.3c: a permanent that phased in prepared
  const s = g.s;
  const bf: Item[] = readingStable(s, () => s.zones.battlefield.map((id) => s.objects[id]!).filter(Boolean).map((o) => ({ o, c: charsOfObject(s, o) })));
  let any = madeCopies;
  const gone = new Set<ObjectId>();
  const moved = (o: GameObject): boolean => gone.has(o.id);

  // ---- Determine everything from the current state (CR 704.3: simultaneously) ----------------------------------------------------
  const ceasing: { o: GameObject; why: string; rule: string }[] = [];
  for (const id of Object.keys(s.objects)) {
    const o = s.objects[id]!;
    if (o.kind === 'token' && o.zone !== 'battlefield') ceasing.push({ o, why: 'token', rule: 'CR 704.5d' });
    else if (o.kind === 'spellCopy' && o.zone !== 'stack' && !keptPreparedCopy(s, o)) ceasing.push({ o, why: 'copy of a spell', rule: 'CR 704.5e' }); // M6-6: CR 722.3c exception
  }

  const zeroToughness: Item[] = [];
  const toDestroy: { it: Item; why: string; rule: string }[] = [];
  for (const it of bf) {
    if (!it.c.types.includes('Creature')) continue;
    const t = ptNumbers(it.c).toughness; // null: a "*" toughness the engine can't evaluate yet (milestone 6), which is never judged by its value
    if (t !== null && t <= 0) { zeroToughness.push(it); continue; } // CR 704.5f
    if (hasKeyword(it.c, 'indestructible')) continue; // CR 702.12b: ignores lethal damage and deathtouch damage
    if (t !== null && it.o.damage >= t) toDestroy.push({ it, why: 'lethal damage', rule: 'CR 704.5g' });
    else if (it.o.deathtouchDamaged) toDestroy.push({ it, why: 'damage from a source with deathtouch', rule: 'CR 704.5h' }); // any amount is lethal, whatever the toughness (CR 704.5h)
  }
  const walkersAtZero = bf.filter(({ o, c }) => c.types.includes('Planeswalker') && (o.counters.loyalty ?? 0) <= 0 && !zeroLoyaltyKept(g.s, o.id)); // CR 704.5i (r4-mech: unless exempt)
  // CR 704.5v: a Siege waits while it is the source of an ability that has triggered but not yet left the stack; CR 704.5w: any other battle goes at once
  const battlesAtZero = bf.filter(({ o, c }) => c.types.includes('Battle') && (o.counters.defense ?? 0) <= 0 && (!c.subtypes.includes('Siege') || !isSourceOfPendingAbility(g, o.id)));

  // Legend rule (CR 704.5j) and world rule (CR 704.5k).
  const groups = new Map<string, Item[]>();
  for (const it of bf) {
    if (!it.c.supertypes.includes('Legendary')) continue;
    if (legendRuleExempt(g.s, it.o.id)) continue; // r3-static: "The "legend rule" doesn't apply to ..." (CR 704.5j)
    const key = `${it.o.controller}|${it.c.name}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const legendLosers: Item[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep = g.choose({
      kind: 'chooseObjects',
      player: group[0]!.o.controller,
      prompt: `Legend rule: you control more than one legendary permanent named ${group[0]!.c.name}. Choose one to keep; the rest are put into their owners' graveyards.`,
      options: group.map((x) => x.o.id),
      min: 1,
      max: 1,
      rules: ['CR 704.5j'],
    }).ids[0]!;
    legendLosers.push(...group.filter((x) => x.o.id !== keep));
  }
  const worlds = bf.filter(({ c }) => c.supertypes.includes('World'));
  const worldLosers: Item[] = [];
  if (worlds.length >= 2) {
    // The permanent that has had the world supertype for the shortest time stays (its timestamp is the latest); a tie removes them all.
    const newest = Math.max(...worlds.map((w) => w.o.timestamp));
    const newestOnes = worlds.filter((w) => w.o.timestamp === newest);
    worldLosers.push(...(newestOnes.length === 1 ? worlds.filter((w) => w !== newestOnes[0]) : worlds));
  }

  // Attachments (CR 704.5m, 704.5n, 704.5p).
  const auraLosers: { it: Item; unattachFirst: boolean }[] = [];
  const unattachs: { o: GameObject; why: string; rule: string }[] = [];
  readingStable(s, () => attachmentLosers(s, bf, auraLosers, unattachs)); // P1: pure checks of the state the loop does not change (one cache check)
  // Roles (CR 704.5z): of several Roles one player controls on the same permanent, only the newest stays.
  const roleGroups = new Map<string, Item[]>();
  for (const it of bf) {
    if (it.c.subtypes.includes('Role') && it.o.attachedTo !== undefined) {
      const key = `${it.o.attachedTo}|${it.o.controller}`;
      roleGroups.set(key, [...(roleGroups.get(key) ?? []), it]);
    }
  }
  const roleLosers: Item[] = [];
  for (const grp of roleGroups.values()) {
    if (grp.length < 2) continue;
    const newest = Math.max(...grp.map((x) => x.o.timestamp));
    roleLosers.push(...grp.filter((x) => x.o.timestamp !== newest));
  }
  // Sagas (CR 704.5s, M6-6).
  const sagaLosers = finishedSagas(g, bf);
  // Counters (CR 704.5q).
  const annihilate = bf.filter(({ o }) => (o.counters['+1/+1'] ?? 0) > 0 && (o.counters['-1/-1'] ?? 0) > 0);
  // Battle protectors (CR 704.5x, 704.5y).
  const protectorFixes: { it: Item; protector: string | null; siege?: true; rule: string }[] = [];
  for (const it of bf) {
    if (!it.c.types.includes('Battle')) continue;
    const { o, c } = it;
    const siege = c.subtypes.includes('Siege');
    const inGame = o.protector !== undefined && s.players.some((x) => x.id === o.protector && !x.hasLost);
    const siegeSelfProtected = siege && inGame && o.protector === o.controller; // CR 704.5y
    if (inGame && !siegeSelfProtected) continue;
    // CR 704.5x: a battle that has no protector gets one, but not while creatures are attacking it.
    if (!siegeSelfProtected && (s.combat?.attackers ?? []).some((a) => a.defender === o.id)) continue;
    // M12-2 (m12 design E20, D13): a Siege's controller chooses among their opponents as it is performed (asked only with two or more, CR 310.12a)
    protectorFixes.push({ it, protector: siege ? (g.opponents(o.controller)[0]?.id ?? null) : o.controller, ...(siege ? { siege: true as const } : {}), rule: siegeSelfProtected ? 'CR 704.5y' : 'CR 704.5x' });
  }

  // ---- Perform -----------------------------------------------------------------------------------------------------------------
  // FAST5X E28 review (CR 704.3, 603.10a): the actions are performed at the same time, so every permanent that leaves is as it was when they were checked (the
  // characteristics worked out above), whichever moves first
  return leavingTogether(g, bf.map((it) => it.o.id), () => {
    for (const x of ceasing) {
      // M6-6, CR 722.3c: the copy of a prepare spell of a permanent that phased out is gone; a new one is made as it phases in prepared (core/prepare.ts)
      const p = x.o.preparedFor !== undefined ? s.objects[x.o.preparedFor] : undefined;
      if (p && p.preparedCopy === x.o.id && p.prepared === true && p.phasedOut) delete p.preparedCopy;
      cease(g, x.o, x.why, x.rule); gone.add(x.o.id); any = true;
    }
    for (const it of zeroToughness) {
      if (moved(it.o)) continue;
      if (toGraveyard(g, it.o, 'toughness 0 or less', ['CR 704.5f'])) { gone.add(it.o.id); any = true; } // regeneration can't replace this
    }
    for (const d of toDestroy) {
      if (moved(d.it.o)) continue;
      const r = destroy(g, d.it.o.id, { reason: d.why, rules: [d.rule], stateBased: true }); // FAST5X E28: not "as the result of an effect" (CR 122.1c)
      if (r === 'destroyed') gone.add(d.it.o.id);
      if (r === 'destroyed' || r === 'regenerated') any = true;
    }
    for (const it of walkersAtZero) {
      if (moved(it.o)) continue;
      if (toGraveyard(g, it.o, 'loyalty 0', ['CR 704.5i'])) { gone.add(it.o.id); any = true; }
    }
    for (const it of battlesAtZero) {
      if (moved(it.o)) continue;
      if (toGraveyard(g, it.o, 'defense 0', [it.c.subtypes.includes('Siege') ? 'CR 704.5v' : 'CR 704.5w'])) { gone.add(it.o.id); any = true; }
    }
    for (const it of legendLosers) {
      if (moved(it.o)) continue;
      if (toGraveyard(g, it.o, 'legend rule', ['CR 704.5j'])) { gone.add(it.o.id); any = true; }
    }
    for (const it of worldLosers) {
      if (moved(it.o)) continue;
      if (toGraveyard(g, it.o, 'world rule', ['CR 704.5k'])) { gone.add(it.o.id); any = true; }
    }
    for (const { it, unattachFirst } of auraLosers) {
      if (moved(it.o)) continue;
      // std-ry7 (CR 702.103f, an exception to 704.5m; cite unverified): a bestowed Aura that is unattached or attached illegally becomes unattached and stops being
      // bestowed: it stays on the battlefield as the enchantment creature it is (the same object, so it keeps its counters and the turn it came under its
      // controller's control, CR 302.6), rules/base-parts/bestow.ts no longer claims it
      if (it.o.bestowed === true && !unattachFirst) {
        const name = g.nameOf(it.o.id);
        delete it.o.bestowed;
        if (it.o.attachedTo !== undefined) unattach(g, it.o, 'a bestowed Aura attached to an illegal object', ['CR 702.103f']);
        g.log(`${name} is no longer attached to anything: it stops being bestowed and is a creature again.`, { rules: ['CR 702.103f'], level: 'info' });
        any = true;
        continue;
      }
      const why = unattachFirst ? 'an Aura that is also a creature can not enchant anything' : it.o.attachedTo === undefined ? 'Aura not attached to anything' : 'Aura attached to an illegal object or player';
      if (unattachFirst) delete it.o.attachedTo;
      if (toGraveyard(g, it.o, why, ['CR 704.5m', unattachFirst ? 'CR 303.4d' : 'CR 303.4c'])) { gone.add(it.o.id); any = true; }
    }
    for (const it of roleLosers) {
      if (moved(it.o)) continue;
      if (toGraveyard(g, it.o, 'more than one Role', ['CR 704.5z'])) { gone.add(it.o.id); any = true; }
    }
    for (const it of sagaLosers) {
      if (moved(it.o)) continue;
      // CR 704.5s: "that Saga's controller sacrifices it" (CR 701.21a: a sacrifice, so "whenever you sacrifice" sees it)
      const name = g.nameOf(it.o.id);
      moveObject(g, it.o.id, 'graveyard', { cause: 'sacrifice' });
      if (g.s.objects[it.o.id]?.zone === it.o.zone) continue; // a "can't be sacrificed" effect or a replacement kept it there (CR 614.17)
      g.log(`${g.player(it.o.controller).name} sacrifices ${name}: it has as many lore counters as its final chapter number.`, { rules: ['CR 704.5s', 'CR 714.4'], level: 'action' });
      gone.add(it.o.id);
      any = true;
    }
    for (const u of unattachs) {
      if (moved(u.o) || u.o.attachedTo === undefined) continue;
      unattach(g, u.o, u.why, [u.rule]); any = true;
    }
    for (const it of annihilate) {
      if (moved(it.o)) continue;
      const n = Math.min(it.o.counters['+1/+1'] ?? 0, it.o.counters['-1/-1'] ?? 0);
      addCounters(g, it.o.id, '+1/+1', -n);
      addCounters(g, it.o.id, '-1/-1', -n);
      g.log(`${g.nameOf(it.o.id)} loses ${n} +1/+1 and ${n} -1/-1 counters.`, { rules: ['CR 704.5q'], level: 'info' });
      any = true;
    }
    for (const f of protectorFixes) {
      if (moved(f.it.o)) continue;
      if (f.protector === null) {
        if (toGraveyard(g, f.it.o, 'no player can protect it', [f.rule])) { gone.add(f.it.o.id); any = true; }
      } else {
        const protector = f.siege ? chooseSiegeProtector(g, f.it.o.controller, g.nameOf(f.it.o.id), [f.rule, 'CR 310.12a']) ?? f.protector : f.protector;
        f.it.o.protector = protector;
        g.log(`${g.player(protector).name} becomes the protector of ${g.nameOf(f.it.o.id)}.`, { rules: [f.rule, 'CR 310.9a'], level: 'info' });
        any = true;
      }
    }

    // CR 704.5h: "since the last time state-based actions were checked": the flags have been used up.
    for (const id of s.zones.battlefield) {
      const o = s.objects[id];
      if (o && o.deathtouchDamaged) o.deathtouchDamaged = false;
    }
    return any;
  }, new Map(bf.map((it) => [it.o.id, it.c])));
}
