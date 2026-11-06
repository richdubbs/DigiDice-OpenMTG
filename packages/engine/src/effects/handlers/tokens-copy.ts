/**
 * The `copy` op (CR 707): copies of spells and abilities on the stack (CR 707.10: Twincast, Fork, storm) and tokens that are copies of objects (CR 707.2, 111:
 * "create a token that's a copy of target creature"). Owner: WP14.
 *
 *  - `result: 'spell'`: a copy of each spell or ability is put onto the stack under `who` (effects/perform-direct.ts#performCopyOnStack), with every choice made for the
 *    original (modes, X, targets, division, costs paid). It is not cast (CR 707.10). With `newTargets` its controller may choose new targets first (CR 707.10c:
 *    any number may stay, even illegal ones; a changed target must be legal); `true` asks for them without the "do you want to" question. The original is read
 *    as it last existed on the stack, so storm copies a spell that has been countered meanwhile (CR 702.40a, 608.2h).
 *  - `result: 'token'`: a token copy of each object, created through the pipeline like any token. Its definition is the object's copiable values (CR 707.2,
 *    111.4; statics/copy.ts#copiableOrWhy): the card definition itself when the object is no copy (token-defs.ts#copiableTokenDef: a copy of a double-faced
 *    object is double-faced, CR 707.8a), otherwise a single-faced definition built from the copiable values (token-defs.ts#tokenDefFromCopied: a copy of a copy,
 *    of a face-down object, CR 708.2, or with the step's exceptions, CR 707.9b, "except it's a 1/1": capability `op:copy.except`, M6-2).
 *  - M6-2 (CR 707.10f, `op:copy.permanentSpell`): a copy of a permanent spell is put onto the stack like any copy; as it resolves it becomes a token
 *    (core/move-parts/copy.ts).
 *
 * M6-4 (CR 707.8a): a token copy of a transformed permanent is double-faced and enters with its back face up (effects/perform-events.ts reads the face).
 * Resolved by hand: a token copy of a double-faced object with exceptions (CR 707.8a with 707.9), a copy
 * of a spell with exceptions, an exception whose number can't be worked out, a copy of a Room spell (CR 709.5b, 709.5d).
 */
import { CLEAVE, effectFor } from '../cleave';
import type { EffectProgram, EffectStep, Modification, TargetSpec } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import type { CardDef } from '../../types/card';
import type { GameObject, ObjHandle, TargetChoice } from '../../types/state';
import { abilityDefOnStack } from '../../rules/abilities';
import { modeInstances } from '../../rules/mode-instances';
import { auraTargetProgram } from '../../rules/attachment';
import { isMutating, MUTATE_TARGET } from '../../rules/merge';
import { charsOfObject, isPermanentCard } from '../../rules/characteristics';
import { targetOptions } from '../../rules/targets';
import { hasSharedTypeLine } from '../../rules/base-parts/room';
import { charsFromCopiable, concreteSnapshot, copiableOrWhy } from '../../statics/copy';
import type { ExecCtx, StepHandler, StepResult } from '../api';
import { evalQty } from '../eval';
import { performCopyOnStack } from '../perform-direct';
import { performLink } from '../perform'; // edh-next-130
import { formerIds } from '../../rules/history'; // edh-next-130
import { propose } from '../propose';
import { readInfo, resolveObjs, resolvePlayers } from '../refs';
import { runSteps } from '../run';
import { copiableTokenDef, exceptedSpellDef, tokenDefFromCopied } from './token-defs';
import { extraSpellCopies, ruleDenial } from '../../statics/hooks';
import { tokenAttachment } from './tokens-attach';
import { tokensCreatedSince } from './tokens-create';
import { addToLink, bindAs, byHand, did, enterAttacking, enteringAttacking, firstPlayer, NOTHING, wholeNumber } from './zones-util';

type Copy = Extract<EffectStep, { op: 'copy' }>;

/** The target specs of a spell or ability on the stack, parallel to `StackInfo.targets` (the effective program: chosen modes in printed order, then its own; CR 700.2d). */
export function targetSpecsOf(cx: ExecCtx, o: GameObject): TargetSpec[] | null {
  const info = o.stack!;
  let programs: EffectProgram[];
  if (o.kind === 'ability') {
    const def = abilityDefOnStack(cx.g.s, o);
    if (!def || !('effect' in def) || def.effect === undefined) return null;
    programs = [def.effect];
  } else {
    const def = cx.g.s.defs[o.defId];
    if (!def || info.fused) return null;
    // edh-cast-2 (CR 115.1b, 303.4a, 702.140a): the specs are the ones the spell was announced with (actions/cast.ts#spellPrograms: the Aura's enchant target first, then the spell abilities), so an Aura spell's enchant target
    // (also a bestowed one's) is included; a mutating spell's own target follows (rules/merge.ts#MUTATE_TARGET)
    const c = charsOfObject(cx.g.s, o);
    const aura = auraTargetProgram(c);
    programs = [...(aura ? [aura] : []), ...c.abilities.flatMap((a) => (a.def.kind === 'spell' ? [effectFor(a.def, info.costsPaid.alternative === CLEAVE)] : []))]; // edh-next-100 (CR 702.148a, 707.10): a spell cast for its cleave cost has the cleaved text, so its copies and retargets do
  }
  const out: TargetSpec[] = [];
  for (const p of programs) {
    if (p.modes) for (const inst of modeInstances(p, info.modes)) out.push(...(inst?.program.targets ?? [])); // std-blb (CR 700.2d): each instance's own targets
    out.push(...p.targets);
  }
  for (const sp of info.splice ?? []) for (const p of sp.programs) out.push(...p.targets); // edh-next-69 (CR 702.47b, 707.10): the targets of the spliced text follow the spell's own
  if (isMutating(o)) out.push(MUTATE_TARGET);
  return out;
}

/**
 * CR 707.10c: the copy's controller may change any of its targets; a new target must be legal, an unchanged one may stay even if illegal. The number of targets
 * of each instance of the word "target" stays the same. One `chooseTargets` decision per spec that has targets, listing the current targets and every legal one.
 */
function chooseNewTargets(cx: ExecCtx, st: Copy, original: GameObject, who: PlayerId): TargetChoice[][] {
  const g = cx.g;
  const current = original.stack!.targets;
  if (!st.newTargets || current.every((l) => l.length === 0)) return current;
  const specs = targetSpecsOf(cx, original);
  if (!specs || specs.length !== current.length) return current; // the specs can't be matched with the choices: the copy keeps them (CR 707.10)
  if (st.newTargets === 'may') {
    const yes = g.choose({ kind: 'yesNo', player: who, prompt: `Choose new targets for the copy of ${g.nameOf(original.id)}?`, yesLabel: 'Choose new targets', noLabel: 'Keep the targets', rules: ['CR 707.10c'] }).yes;
    if (!yes) return current;
  }
  const sourceId = g.s.objects[original.id] ? original.stack?.sourceId ?? original.id : original.stack?.sourceId;
  const out: TargetChoice[][] = current.map((list) => list.map((t) => ({ ...t })));
  current.forEach((list, i) => {
    if (list.length === 0) return;
    const spec = specs[i]!;
    // "another target" (CR 115.3, `distinctFrom`): a new target may not be one the listed specs of the copy have (as chosen so far).
    const taken = new Set((spec.distinctFrom ?? []).flatMap((id) => { const j = specs.findIndex((x) => x.id === id); return j >= 0 ? out[j]!.map((t) => t.id) : []; }));
    const legal = targetOptions(g.s, spec, who, sourceId);
    const objects = [...new Set([...list.filter((t) => t.kind === 'object').map((t) => t.id), ...legal.objects.filter((id) => !taken.has(id))])];
    const players = [...new Set([...list.filter((t) => t.kind === 'player').map((t) => t.id), ...legal.players.filter((id) => !taken.has(id))])];
    out[i] = g.choose({
      kind: 'chooseTargets', player: who, prompt: `Choose the targets of the copy (${spec.text}).`, targetText: spec.text,
      objects, players, min: list.length, max: list.length, rules: ['CR 707.10c'],
    }).targets;
  });
  return out;
}

/**
 * edh-cast-14 (CR 707.10c, 115.1, 601.2c, 608.2b; Scryfall ruling 2018-03-16 of Zada): the objects `retargetEach` names that are a legal target in every place the original spell has a target ("any
 * creature you control that couldn't be targeted by the original spell is just ignored"). A spell with a list of several targets in one place, a "another target" rule, or an ability on the stack
 * is not automated.
 */
function retargetCandidates(cx: ExecCtx, st: Copy, original: GameObject, who: PlayerId): { kind: 'object' | 'player'; id: string }[] | { reason: string } {
  const g = cx.g;
  const current = original.stack!.targets;
  // edh-next-74 (Radiant Performer): `retargetAll` also copies an ability on the stack; `retargetEach` (Zada) stays for spells
  const specs = original.kind === 'ability' && st.retargetAll !== true ? null : targetSpecsOf(cx, original);
  if (!specs || specs.length !== current.length || current.every((l) => l.length === 0)) return { reason: 'a copy per object of a spell with no target, or targets the engine cannot match (CR 707.10c)' };
  if (current.some((l) => l.length > 1) || specs.some((sp) => sp.distinctFrom !== undefined && sp.distinctFrom.length > 0)) return { reason: 'a copy per object of a spell with several targets in one place or an "another target" rule is not automated (CR 115.3, 707.10c)' };
  // every place holds the one object (the spell "targets only" it, Zada): a spell whose places hold different objects is copied by hand
  if (new Set(current.flat().map((t) => `${t.kind}:${t.id}`)).size > 1) return { reason: 'a copy per object of a spell whose targets are different objects is not automated (CR 707.10c)' };
  const sourceId = original.stack?.sourceId ?? original.id;
  const out: { kind: 'object' | 'player'; id: string }[] = [];
  // edh-next-74 (CR 707.10c, 115.1, 601.2c; Radiate, Radiant Performer; Scryfall rulings 2018-03-16 of Radiate): "for each other permanent or player the spell could target": every permanent and every player,
  // other than the object or player the original targets, that is a legal target in every place the original has a target, in the order of the game's objects and then the players
  if (st.retargetAll === true) {
    const only = current.flat()[0]!;
    for (const id of Object.keys(g.s.objects)) {
      const o = g.s.objects[id]!;
      if (o.zone !== 'battlefield' || (only.kind === 'object' && only.id === id)) continue;
      if (current.every((list, i) => list.length === 0 || targetOptions(g.s, specs[i]!, who, sourceId).objects.includes(id))) out.push({ kind: 'object', id });
    }
    for (const id of g.s.players.map((p) => p.id)) {
      if (only.kind === 'player' && only.id === id) continue;
      if (current.every((list, i) => list.length === 0 || targetOptions(g.s, specs[i]!, who, sourceId).players.includes(id))) out.push({ kind: 'player', id });
    }
    return out;
  }
  // edh-next-57 (CR 707.10c, 115.1; Precursor Golem, Mirrorwing Dragon, Scryfall ruling 2018-03-16 of Zada): "for each OTHER <objects> that the spell could target" is other than the object(s) the original spell
  // targets, which keep the original and get no copy of their own: a filter's `other` (other than the object that has the ability, said of Zada, who is the one target) is read that way here, so a
  // Golem that is not the target gets a copy even when it is the object that has the ability (Precursor Golem)
  // edhd60 (CR 707.10c, 115.1; Frontline Heroism): the copy targets the one object `targetsObject` names, when it is a legal target in every place the original has a target
  if (st.targetsObject !== undefined) {
    const sole: { kind: 'object' | 'player'; id: string }[] = [];
    for (const h of resolveObjs(cx, st.targetsObject)) {
      if (h.zone !== 'battlefield' || !g.s.objects[h.id]) continue;
      if (current.every((list, i) => list.length === 0 || targetOptions(g.s, specs[i]!, who, sourceId).objects.includes(h.id)) && !sole.some((x) => x.id === h.id)) sole.push({ kind: 'object', id: h.id });
    }
    // edh-next-133 (CR 115.1, 608.2b; Ivy, Gleeful Spellthief ruling 2022-09-09: "If Ivy isn't a legal target for the spell, no copy can be created"): no legal object, no copy
    if (sole.length === 0) g.log(`No copy of ${g.nameOf(original.id)} is created: the object the copy must target is not a legal target of it.`, { rules: ['CR 707.10e', 'CR 115.1'], level: 'action' });
    return sole.length <= 1 ? sole : { reason: 'more than one object the copy must target (CR 707.10c, 115.1)' };
  }
  const ref = st.retargetEach!;
  const otherThanTarget = ref.ref === 'each' && ref.filter.other === true;
  const group = otherThanTarget ? { ...ref, filter: { ...ref.filter, other: undefined } } : ref;
  const targeted = otherThanTarget ? new Set(current.flat().map((t) => `${t.kind}:${t.id}`)) : new Set<string>();
  for (const h of resolveObjs(cx, group)) {
    if (h.zone !== 'battlefield' || !g.s.objects[h.id]) continue;
    if (targeted.has(`object:${h.id}`)) continue;
    const ok = current.every((list, i) => list.length === 0 || targetOptions(g.s, specs[i]!, who, sourceId).objects.includes(h.id));
    if (ok && !out.some((x) => x.id === h.id)) out.push({ kind: 'object', id: h.id });
  }
  return out;
}

/** std-copy-1 (CR 707.10, 101.2): an ability that says "This ability can't be copied", or a spell that "can't be copied" (statics/hooks.ts#ruleDenial, `beCopied`). */
function uncopiable(cx: ExecCtx, original: GameObject): boolean {
  if (original.kind === 'ability') {
    const def = abilityDefOnStack(cx.g.s, original);
    return def !== undefined && def !== null && def.kind === 'activated' && def.uncopiable === true;
  }
  return cx.g.s.objects[original.id] !== undefined && ruleDenial(cx.g.s, { action: 'beCopied', subject: original.id }) !== null;
}

function copySpells(cx: ExecCtx, st: Copy, who: PlayerId, n: number): StepResult {
  const g = cx.g;
  const made: ObjHandle[] = [];
  const originals: GameObject[] = [];
  // CLOUD std-misc (CR 707.9b): the exceptions with their numbers worked out now (CR 608.2h); each copy's definition is made before any copy is put on the stack
  const ex = concreteExcept(cx, st.except ?? []);
  if ('reason' in ex) return byHand(cx, st, ex.reason);
  // edh-next-137 (CR 707.9b, 707.10, 306.5b; Ob Nixilis, the Adversary): "the copy has starting loyalty X": its printed loyalty, worked out now (CR 608.2h)
  const loyalty = st.startingLoyalty === undefined ? undefined : evalQty(cx, st.startingLoyalty);
  if (st.startingLoyalty !== undefined && (loyalty === undefined || !Number.isInteger(loyalty) || loyalty < 0)) return byHand(cx, st, 'the starting loyalty of the copy can\'t be worked out (CR 707.9b)');
  const defs = new Map<string, CardDef>();
  for (const h of resolveObjs(cx, st.what)) {
    if (st.exceptThis === true && h.id === cx.stackId) continue; // edh-cast-15 (CR 113.7a): "all other abilities" leaves out the ability being resolved
    const info = readInfo(cx, h); // as it is, or as it last existed on the stack (CR 608.2h, 702.40a)
    const original = info?.object;
    if (!original || !original.stack || (h.zone !== 'stack' && info.leftZone !== 'stack')) continue;
    // std-copy-1 (CR 707.10, 101.2): "This ability can't be copied." (ActivatedAbilityDef.uncopiable) and "This spell can't be copied." (a `cant` beCopied restriction
    // of the spell): no copy is put onto the stack (an ability whose definition can't be read is copied as before; Gogo's own is always readable)
    if (uncopiable(cx, original)) {
      g.log(`${g.nameOf(original.id)} can't be copied.`, { rules: ['CR 707.10', 'CR 101.2'], level: 'info' });
      continue;
    }
    // FAST5X E8 review: a copy of a Room spell has both halves' copiable values (CR 709.5b) and becomes a token Room (CR 707.10f) whose designations no rule
    // spells out for a spell that was not cast (CR 709.5d): resolved by hand, as statics/copy.ts#copiableOrWhy refuses a token copy of one
    const def = g.s.defs[original.defId];
    if (original.kind !== 'ability' && def && def.layout === 'split' && def.faces.length > 1 && hasSharedTypeLine(def)) {
      return byHand(cx, st, 'copying a Room spell is not automated yet (CR 709.5b, 709.5d)');
    }
    if (ex.length > 0 || loyalty !== undefined) {
      if (original.kind === 'ability' || original.prototyped === true || !def) return byHand(cx, st, 'a copy with exceptions of an ability or a prototyped spell is not automated (CR 707.9b, 707.10, 718.3c)');
      const d = exceptedSpellDef(def, original.face, ex, loyalty);
      if ('reason' in d) return byHand(cx, st, d.reason);
      defs.set(original.id, d);
    }
    originals.push(original);
  }
  for (const original of originals) {
    const own = defs.get(original.id);
    if (own) g.addDef(own);
    // edh-cast-14 (CR 707.10, 707.10c, 115.1, 601.2c; Zada, Hedron Grinder): one copy for each object of the group that the spell could target, each targeting only that object
    if (st.retargetEach !== undefined || st.retargetAll === true || st.targetsObject !== undefined) {
      if (st.different !== true && st.targetsObject === undefined) return byHand(cx, st, 'a copy per object that does not say each copy targets a different one (CR 707.10c)');
      const objs = retargetCandidates(cx, st, original, who);
      if ('reason' in objs) return byHand(cx, st, objs.reason);
      let order = objs;
      if (objs.length > 1) {
        // CR 707.10: their controller puts them onto the stack in the order they choose (the first chosen goes first, so resolves last)
        const label = (t: { kind: 'object' | 'player'; id: string }): string => (t.kind === 'player' ? g.player(t.id).name : g.nameOf(t.id));
        const ans = g.choose({ kind: 'order', player: who, prompt: `Choose the order in which the copies of ${g.nameOf(original.id)} are put onto the stack.`, items: objs.map((t) => ({ id: t.id, label: label(t) })), rules: ['CR 707.10', 'CR 405.1'] });
        order = [...ans.ids.flatMap((id) => objs.filter((t) => t.id === id)), ...objs.filter((t) => !ans.ids.includes(t.id))];
      }
      for (const target of order) {
        const targets = original.stack!.targets.map((list) => list.map(() => ({ kind: target.kind, id: target.id })));
        const id = performCopyOnStack(g, original, who, targets, own?.id);
        made.push({ id, zone: 'stack' });
        g.log(`${g.player(who).name} puts a copy of ${g.nameOf(original.id)} onto the stack targeting ${target.kind === 'player' ? g.player(target.id).name : g.nameOf(target.id)}.`, { rules: ['CR 707.10', 'CR 707.10c'], level: 'action' });
      }
      // edh-cast-13 (CR 614.1a, 707.10c; Twinning Staff): "instead copy it that many times plus an additional time": the additional copy of a spell, whose new targets may be chosen
      const more = original.kind === 'ability' || order.length === 0 ? 0 : extraSpellCopies(g.s, who);
      for (let i = 0; i < more; i++) {
        const targets = chooseNewTargets(cx, { ...st, newTargets: 'may' }, original, who);
        const id = performCopyOnStack(g, original, who, targets, own?.id);
        made.push({ id, zone: 'stack' });
        g.log(`${g.player(who).name} puts an additional copy of ${g.nameOf(original.id)} onto the stack.`, { rules: ['CR 707.10', 'CR 707.10c', 'CR 614.1a'], level: 'action' });
      }
      continue;
    }
    // M6-2: a copy of a permanent spell becomes a token as it resolves (CR 707.10f, core/move-parts/copy.ts)
    for (let i = 0; i < n; i++) {
      const targets = chooseNewTargets(cx, st, original, who);
      const id = performCopyOnStack(g, original, who, targets, own?.id);
      made.push({ id, zone: 'stack' });
      g.log(`${g.player(who).name} puts a copy of ${g.nameOf(original.id)} onto the stack${targets.flat().length > 0 ? ` targeting ${targets.flat().map((t) => (t.kind === 'player' ? g.player(t.id).name : g.nameOf(t.id))).join(', ')}` : ''}.`, {
        rules: ['CR 707.10', ...(st.newTargets ? ['CR 707.10c'] : [])], level: 'action',
      });
    }
    // edh-cast-13 (CR 707.10, 614.1a, 707.10c; Twinning Staff): "instead copy it that many times plus an additional time. You may choose new targets for the additional copy."
    // One more copy for each such effect of the copier, of a spell only (an ability is no spell), whose targets they may change even where the original copy's may not
    const extra = original.kind === 'ability' ? 0 : extraSpellCopies(g.s, who);
    for (let i = 0; i < extra && n > 0; i++) {
      const targets = chooseNewTargets(cx, { ...st, newTargets: 'may' }, original, who);
      const id = performCopyOnStack(g, original, who, targets, own?.id);
      made.push({ id, zone: 'stack' });
      g.log(`${g.player(who).name} puts an additional copy of ${g.nameOf(original.id)} onto the stack.`, { rules: ['CR 707.10', 'CR 707.10c', 'CR 614.1a'], level: 'action' });
    }
  }
  if (st.gains !== undefined) copiesGain(cx, st.gains, made);
  bindAs(cx, st.as, made);
  return did(made.length);
}

/** The name a copy is bound to while the effect of `gains` is created (never a name the parser writes: those are letters and digits). */
const GAINS_NAME = '@copy.gains';

/**
 * std-copy-1 (CR 611.2a, 613.1f, 400.7a, 707.10f): "The copy gains haste and "..."" / "If the copy is a permanent spell, it gains haste.": each copy put onto the stack
 * (a permanent spell only, with `ifPermanent`: CR 110.4b, its characteristics on the stack) gains the abilities with no duration, a resolved layer-6 effect created as
 * an `effect` step would create it (effects/handlers/lasting.ts); the token the copy becomes keeps it (core/move-parts/spell-effects.ts).
 */
function copiesGain(cx: ExecCtx, gains: NonNullable<Copy['gains']>, made: readonly ObjHandle[]): void {
  const g = cx.g;
  for (const h of made) {
    const o = g.s.objects[h.id];
    if (!o || o.zone !== 'stack') continue;
    if (gains.ifPermanent === true && !isPermanentCard(charsOfObject(g.s, o))) continue;
    bindAs(cx, GAINS_NAME, [h]);
    runSteps(cx, [{ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'bound', name: GAINS_NAME }, mods: [{ layer: 6, add: gains.add }] }] }]);
  }
}

/** The step's exceptions with every number worked out now (CR 608.2h), or why one can't be. */
function concreteExcept(cx: ExecCtx, except: readonly Modification[]): Modification[] | { reason: string } {
  const out: Modification[] = [];
  for (const m of except) {
    if (m.layer === '1a' || m.layer === '1b' || m.layer === 3 || m.layer === 2) return { reason: `a copy exception of layer ${m.layer} is not automated (CR 707.9)` };
    if (m.layer === '7a' || m.layer === '7b' || m.layer === '7c') {
      const p = m.power === undefined ? undefined : evalQty(cx, m.power);
      const t = m.toughness === undefined ? undefined : evalQty(cx, m.toughness);
      if ((m.power !== undefined && p === undefined) || (m.toughness !== undefined && t === undefined)) return { reason: 'a number in the copy exception can\'t be worked out (CR 707.9b)' };
      out.push({ layer: m.layer, ...(p !== undefined ? { power: p } : {}), ...(t !== undefined ? { toughness: t } : {}) });
    } else out.push(m);
  }
  return out;
}

/**
 * The definition of a token copy of `original` (CR 707.2, 111.4) and the face it enters with. An object that is no copy, with no exception to add: its card
 * definition (double-faced when it is, CR 707.8a). Otherwise the copiable values (a copy's snapshot, a face-down profile, CR 708.2) with the step's exceptions
 * (CR 707.9b) as a single-faced definition.
 */
function tokenCopyDef(cx: ExecCtx, original: GameObject, except: readonly Modification[], noManaCost = false, startingLoyalty?: number): { def: CardDef; face: number } | { reason: string } {
  const s = cx.g.s;
  const copied = copiableOrWhy(s, original);
  if ('reason' in copied) return copied;
  // edh-next-136 (CR 707.9b, 306.5b; Jace, Mirror Mage): "its starting loyalty is 1" is an exception of the copiable values (statics/copy.ts#concreteSnapshot)
  if (startingLoyalty !== undefined) {
    const cv1 = concreteSnapshot(s, original, copied, [...except, { startingLoyalty }]);
    if ('reason' in cv1) return cv1;
    const def1 = s.defs[cv1.defId];
    if (!def1) return { reason: 'the copied definition is not in this game' };
    if (def1.faces.length !== 1 || def1.layout === 'flip' || cv1.prototyped === true) return { reason: 'a token copy with a starting loyalty of a card with more than one face is not automated yet (CR 707.8, 707.9b)' };
    const c1 = charsFromCopiable(s, cv1, original.id, original.controller);
    return {
      def: tokenDefFromCopied({
        name: c1.name, manaCost: noManaCost ? null : c1.manaCost, colors: c1.colors, supertypes: c1.supertypes, types: c1.types, subtypes: c1.subtypes,
        abilities: c1.abilities.filter((a) => a.parent === undefined && a.origin === 'copied').map((a) => a.def),
        ...(c1.power !== undefined ? { power: c1.power } : {}), ...(c1.toughness !== undefined ? { toughness: c1.toughness } : {}),
        loyalty: String(startingLoyalty), ...(c1.defense !== undefined ? { defense: c1.defense } : {}),
      }),
      face: 0,
    };
  }
  // CR 707.9b, 707.9d: the step's exceptions are appended, and a copied characteristic-defining ability that defines a characteristic an exception sets is not
  // copied ("except it's 1/1" over a P/T CDA), as for every other copy effect (statics/copy.ts#concreteSnapshot)
  const cv = concreteSnapshot(s, original, copied, except);
  if ('reason' in cv) return cv;
  // (wave 3 merge, CR 718.3d: a copy of a prototyped permanent has the prototype characteristics: built from the copiable values, not the card definition)
  const plain = cv.defId === original.defId && cv.except.length === 0 && cv.dropCda === undefined && !noManaCost && cv.prototyped !== true;
  if (plain) return copiableTokenDef(s.defs, original);
  const def = s.defs[cv.defId];
  if (!def) return { reason: 'the copied definition is not in this game' };
  const dfc = def.faces.length === 2 && ['transform', 'modal_dfc', 'double_faced_token'].includes(def.layout);
  if (dfc && cv.defId === original.defId && (except.length > 0 || noManaCost)) return { reason: 'a token copy of a double-faced object with exceptions is not automated yet (CR 707.8a, 707.9)' };
  if (def.layout === 'flip') return { reason: 'the copiable values of a flip card depend on its flipped status (CR 709.2), not automated yet' };
  const c = charsFromCopiable(s, cv, original.id, original.controller);
  const abilities = c.abilities.filter((a) => a.parent === undefined && a.origin === 'copied').map((a) => a.def);
  return {
    def: tokenDefFromCopied({
      // M6-12, CR 707.9b: "except it has no mana cost" (embalm, eternalize)
      name: c.name, manaCost: noManaCost ? null : c.manaCost, colors: c.colors, supertypes: c.supertypes, types: c.types, subtypes: c.subtypes, abilities,
      ...(c.power !== undefined ? { power: c.power } : {}), ...(c.toughness !== undefined ? { toughness: c.toughness } : {}),
      ...(c.loyalty !== undefined ? { loyalty: c.loyalty } : {}), ...(c.defense !== undefined ? { defense: c.defense } : {}),
      ...(def.layout === 'prepare' && def.faces[1] ? { prepare: def.faces[1] } : {}), // M6-6, CR 722.2b: the prepare spell is copied whatever the exceptions
    }),
    face: 0,
  };
}

/**
 * Review of r3-copy (CR 111.2, 101.4): "Each opponent creates a token that's a copy of it" (Life of the Party; `eff.r3copy.player.creates.copyToken` reads any
 * player phrase): every player `who` names creates its own copies (in the order the reference gives them, APNAP), each the owner and controller of its tokens.
 */
function copyAsTokens(cx: ExecCtx, st: Copy, whos: readonly PlayerId[], n: number): StepResult {
  const g = cx.g;
  const created: ObjHandle[] = [];
  // edh-next-122 (CR 608.2c, 707.9b; Benthic Anomaly): with nothing to copy no token is made, so the exceptions' numbers (the total power of an empty group) are not needed
  const whats = resolveObjs(cx, st.what);
  const ex = whats.length === 0 ? [] : concreteExcept(cx, st.except ?? []);
  if ('reason' in ex) return byHand(cx, st, ex.reason);
  const except = ex;
  // edh-next-131 (CR 303.4f, 301.5c, 707.2; Arna Kennerüd, Skycaptain, rulings 2024-06-07): "create a token that's a copy of that permanent attached to that creature": an Aura copy enters attached to
  // that object, or is not created when it can't legally enchant it (or the object is gone); an Equipment copy that can't equip it enters unattached (token-attach.ts#tokenAttachment)
  const given: ObjHandle | null | undefined = st.attachTo === undefined ? undefined : (resolveObjs(cx, st.attachTo).find((x) => x.zone === 'battlefield' && g.s.objects[x.id]?.zone === 'battlefield') ?? null);
  for (const h of whats) {
    if (h.zone === 'battlefield' && g.s.objects[h.id]?.phasedOut) continue; // CR 702.26b: a phased-out permanent is treated as though it doesn't exist
    let original = readInfo(cx, h)?.object; // a copy of an object that left uses its last known information (CR 608.2h)
    // edh-next-130 (CR 603.10a, 608.2h, 400.7): "a copy of that creature" of an object that left the battlefield since: as it last existed there
    if (st.lastOnBattlefield === true && original !== undefined && original.zone !== 'battlefield') {
      const last = lastOnBattlefield(cx, h.id);
      if (last === 'byHand') return byHand(cx, st, 'the creature was a copy or changed as it last existed on the battlefield: its copiable values then are not kept (CR 603.10a, 707.2)');
      if (last !== undefined) original = last;
    }
    if (!original || original.kind === 'ability') continue;
    // edh-next-136 (CR 707.9b): a token copy's starting loyalty is a fixed number (edh-next-137's amounts are of a spell copy, #copySpells)
    if (st.startingLoyalty !== undefined && typeof st.startingLoyalty !== 'number') return byHand(cx, st, 'a token copy with a starting loyalty that is not a fixed number is not automated (CR 707.9b)');
    const c = tokenCopyDef(cx, original, except, st.noManaCost === true, typeof st.startingLoyalty === 'number' ? st.startingLoyalty : undefined);
    if ('reason' in c) return byHand(cx, st, c.reason);
    const def = c.def;
    // M6-4, CR 707.8a: a copy of a transformed permanent is a double-faced token that enters with its back face up (and can transform back)
    const backUp = c.face !== 0;
    if (backUp && !(def.faces.length === 2 && ['transform', 'modal_dfc', 'double_faced_token'].includes(def.layout))) return byHand(cx, st, 'a token copy of this face is not automated yet (CR 707.8a)');
    const types = def.faces[backUp ? c.face : 0]!.types;
    if (types.includes('Instant') || types.includes('Sorcery')) continue; // CR 111.5: no token is created
    // CR 303.4f-g: a token copy of an Aura enters attached to what its controller chooses as it enters (each token its own choice), and isn't created when
    // nothing is legal. Every choice is made before any token is created (design 8.6 stage 3).
    const plans: { who: PlayerId; hosts: (string | null)[] }[] = [];
    for (const who of whos) {
      const hosts: (string | null)[] = [];
      for (let i = 0; i < n; i++) {
        const where = tokenAttachment(cx, def, who, given);
        if (where === 'manual') return byHand(cx, st, `the engine can't tell what a copy of ${g.nameOf(original.id)} may enchant (CR 303.4f)`);
        if (where === 'none') break;
        hosts.push(where);
      }
      if (hosts.length > 0) plans.push({ who, hosts });
    }
    if (plans.length === 0) {
      g.log(`No copy of ${g.nameOf(original.id)} is created: there is nothing it can legally enchant.`, { rules: ['CR 303.4g', 'CR 707.2'], level: 'info' });
      continue;
    }
    g.addDef(def);
    const enter = (host: string | null): { enter?: { tapped?: true; attachTo?: string; face?: number; counters?: { kind: string; count: number }[]; embalmed?: true } } => {
      // edh-fix-1 (CR 614.6, 110.5b, 122.6): copies made INSTEAD of a token creation (Moonlit Meditation) enter tapped and with the counters the creating instruction gave
      // edh-next-114 (CR 707.9e, 122.6; Littjara Mirrorlake): the counters the instruction itself gives each copy, counted as the copy is made
      const own = (st.counters ?? []).map((k) => ({ kind: k.kind, count: typeof k.count === 'number' ? k.count : evalQty(cx, k.count) ?? 0 })).filter((k) => k.count > 0);
      const instead = cx.insteadCounters !== undefined ? cx.insteadCounters.map((k) => ({ kind: k.kind, count: k.count })) : [];
      const counters = own.length + instead.length > 0 ? { counters: [...instead, ...own] } : {};
      // edh-next-122 (CR 702.128b): a token a resolving embalm ability creates is "embalmed" as it enters (an "except if this creature was embalmed" copy reads it)
      const facts = { ...(st.tapped || cx.insteadTapped === true ? { tapped: true as const } : {}), ...counters, ...(host !== null ? { attachTo: host } : {}), ...(backUp ? { face: c.face } : {}), ...(st.embalmed === true ? { embalmed: true as const } : {}) };
      return Object.keys(facts).length > 0 ? { enter: facts } : {};
    };
    for (const { who, hosts } of plans) {
      const batches: { count: number; host: string | null }[] = hosts.every((x) => x === null) ? [{ count: hosts.length, host: null }] : hosts.map((host) => ({ count: 1, host }));
      for (const b of batches) {
        const mark = g.events.length;
        const ok = propose(g, { ev: 'createToken', player: who, count: b.count, token: def.id, ...enter(b.host) });
        // edh-fix-1 (CR 614.6, 111.1): tokens a replacement made INSTEAD of this copy ("that many 4/4 Angel tokens are created instead", Divine Visitation) are the tokens this instruction
        // created: "it gains haste", "sacrifice it at the beginning of the next end step", "tapped and attacking" and the name it binds apply to them (as tokens-create.ts does)
        const made = tokensCreatedSince(cx, mark);
        if (st.embalmed === true) for (const h of made) { const t = g.s.objects[h.id]; if (t) t.embalmed = true; } // edh-next-122 (CR 702.128b)
        // edh-next-130 (CR 607.2a, 607.1; Hofri Ghostforge, ruling 2021-04-16): each token's own link holds the card it was copied from, in exile now ("the exiled card" of its granted ability)
        if (st.linkCopied !== undefined && h.zone === 'exile' && g.s.objects[h.id]?.zone === 'exile') for (const t of made) performLink(g, t, st.linkCopied, { objects: [{ id: h.id, zone: 'exile' }] });
        if (ok || made.length > 0) created.push(...made);
      }
      g.log(`${g.player(who).name} creates ${hosts.length === 1 ? 'a token that is a copy' : `${hosts.length} tokens that are copies`} of ${g.nameOf(original.id)}.`, { rules: ['CR 707.2', 'CR 111.1'], level: 'action' });
    }
  }
  if (st.attacking) enterAttacking(cx, created.map((h) => h.id), st.attacking); // CR 508.4; M6-12: the named defender (myriad, CR 702.116a)
  addToLink(cx, st.link, created); // edh-perms-21: "all other tokens created with ~" (Faerie Artisans)
  bindAs(cx, st.as, created);
  return did(created.length);
}

/**
 * edh-next-130 (CR 603.10a, 608.2h, 400.7): the object `id` was (it, or an id it had before) as it last existed on the battlefield: its last known information there. 'byHand' when that form
 * showed other characteristics than its card's printed ones (a copy effect or another effect changed its name or types: the copiable values then are not kept); undefined when it was never
 * on the battlefield (the caller copies it as it is).
 */
function lastOnBattlefield(cx: ExecCtx, id: string): GameObject | 'byHand' | undefined {
  const s = cx.g.s;
  for (const old of [id, ...formerIds(s, id)]) {
    const l = s.lki[old];
    if (l === undefined || l.leftZone !== 'battlefield') continue;
    const def = s.defs[l.object.defId];
    const face = def?.faces[l.object.face ?? 0];
    if (l.object.faceDown === true || def === undefined || face === undefined || l.chars === null) return 'byHand';
    const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
    if (l.chars.name !== face.name || !same(l.chars.types, face.types) || !same(l.chars.subtypes, face.subtypes) || !same(l.chars.supertypes, face.supertypes)) return 'byHand';
    return l.object;
  }
  return undefined;
}

/**
 * M6-2: the value forms of `copy` this handler runs (capability names as the walker writes them, model/cap-walk.ts): copy exceptions on token copies (CR 707.9b)
 * and copies of permanent spells (CR 707.10f). Read by model/capabilities.ts.
 */
export const OP_FORMS: readonly string[] = ['op:copy.except', 'op:copy.embalmed' /* edh-next-122 */, 'op:copy.targetsObject' /* edhd60 */, 'op:copy.permanentSpell', 'op:copy.gains' /* std-copy-1: copiesGain */, 'op:copy.spellExcept' /* CLOUD std-misc: types, colors, P/T (token-defs.ts#exceptedSpellDef) */, 'op:copy.retargetEach' /* edh-cast-14: copySpells */, 'op:copy.link' /* edh-perms-21: tokens created with ~ */, 'op:copy.exceptThis' /* edh-cast-15 */, 'op:copy.counters' /* edh-next-114: a token copy enters with counters */, 'op:copy.retargetAll' /* edh-next-74: copySpells, retargetCandidates */, 'op:copy.attachTo' /* edh-next-131: a token copy enters attached to an object */, 'op:copy.lastOnBattlefield' /* edh-next-130 */, 'op:copy.linkCopied' /* edh-next-130 */, 'op:copy.startingLoyalty' /* edh-next-137: copySpells, token-defs.ts#exceptedSpellDef (CR 707.9b, 306.5b) */];

export const copy: StepHandler<Copy> = (cx, st) => {
  if (st.result === 'spell' && st.noManaCost) return byHand(cx, st, 'a copy of a spell with no mana cost is not automated yet (CR 707.9b, 707.10)');
  const n = st.count === undefined ? 1 : wholeNumber(cx, st.count);
  // edh-next-114 (CR 608.2c, 111.1; Mirror March: "For each flip you won, create a token that's a copy of that creature. Those tokens gain haste."): no copy made, the name a later sentence reads ("those tokens") is bound to nothing
  if (n === 0 && st.result !== 'spell') bindAs(cx, st.as, []);
  if (n === undefined || n === 0) return NOTHING;
  if (st.result !== 'spell') {
    const whos = resolvePlayers(cx, st.who);
    return whos.length === 0 ? NOTHING : enteringAttacking(cx, st.attacking, () => copyAsTokens(cx, st, whos, n)); // trek-8 review (CR 508.4)
  }
  // p2-copy-spell-3 (CR 707.10c, 101.4): several players who each copy the spell ("each opponent copies it and may choose new targets for the copy") each put a copy
  // of their own onto the stack, in turn order, each choosing its new targets; a name for all those copies (`as`) is not read
  const whos = resolvePlayers(cx, st.who);
  if (whos.length > 1) {
    if (st.as !== undefined) return byHand(cx, st, 'copies of a spell made by several players and named later are not automated (CR 707.10c)');
    let made = 0;
    for (const p of whos) made += copySpells(cx, st, p, n).count;
    return did(made);
  }
  const who = firstPlayer(cx, st.who);
  if (who === undefined) return NOTHING;
  return copySpells(cx, st, who, n);
};

