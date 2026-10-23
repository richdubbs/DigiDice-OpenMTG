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
import type { EffectProgram, EffectStep, Modification, TargetSpec } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import type { CardDef } from '../../types/card';
import type { GameObject, ObjHandle, TargetChoice } from '../../types/state';
import { abilityDefOnStack } from '../../rules/abilities';
import { modeInstances } from '../../rules/mode-instances';
import { charsOfObject, faceChars, isPermanentCard } from '../../rules/characteristics';
import { targetOptions } from '../../rules/targets';
import { hasSharedTypeLine } from '../../rules/base-parts/room';
import { charsFromCopiable, concreteSnapshot, copiableOrWhy } from '../../statics/copy';
import type { ExecCtx, StepHandler, StepResult } from '../api';
import { evalQty } from '../eval';
import { performCopyOnStack } from '../perform-direct';
import { propose } from '../propose';
import { readInfo, resolveObjs, resolvePlayers } from '../refs';
import { runSteps } from '../run';
import { copiableTokenDef, exceptedSpellDef, tokenDefFromCopied } from './token-defs';
import { ruleDenial } from '../../statics/hooks';
import { tokenAttachment } from './tokens-attach';
import { tokensCreatedSince } from './tokens-create';
import { bindAs, byHand, did, enterAttacking, firstPlayer, NOTHING, wholeNumber } from './zones-util';

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
    programs = faceChars(def, info.face ?? o.face).abilities.flatMap((a) => (a.def.kind === 'spell' ? [a.def.effect] : []));
  }
  const out: TargetSpec[] = [];
  for (const p of programs) {
    if (p.modes) for (const inst of modeInstances(p, info.modes)) out.push(...(inst?.program.targets ?? [])); // std-blb (CR 700.2d): each instance's own targets
    out.push(...p.targets);
  }
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
  const defs = new Map<string, CardDef>();
  for (const h of resolveObjs(cx, st.what)) {
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
    if (ex.length > 0) {
      if (original.kind === 'ability' || original.prototyped === true || !def) return byHand(cx, st, 'a copy with exceptions of an ability or a prototyped spell is not automated (CR 707.9b, 707.10, 718.3c)');
      const d = exceptedSpellDef(def, original.face, ex);
      if ('reason' in d) return byHand(cx, st, d.reason);
      defs.set(original.id, d);
    }
    originals.push(original);
  }
  for (const original of originals) {
    const own = defs.get(original.id);
    if (own) g.addDef(own);
    // M6-2: a copy of a permanent spell becomes a token as it resolves (CR 707.10f, core/move-parts/copy.ts)
    for (let i = 0; i < n; i++) {
      const targets = chooseNewTargets(cx, st, original, who);
      const id = performCopyOnStack(g, original, who, targets, own?.id);
      made.push({ id, zone: 'stack' });
      g.log(`${g.player(who).name} puts a copy of ${g.nameOf(original.id)} onto the stack${targets.flat().length > 0 ? ` targeting ${targets.flat().map((t) => (t.kind === 'player' ? g.player(t.id).name : g.nameOf(t.id))).join(', ')}` : ''}.`, {
        rules: ['CR 707.10', ...(st.newTargets ? ['CR 707.10c'] : [])], level: 'action',
      });
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
function tokenCopyDef(cx: ExecCtx, original: GameObject, except: readonly Modification[], noManaCost = false): { def: CardDef; face: number } | { reason: string } {
  const s = cx.g.s;
  const copied = copiableOrWhy(s, original);
  if ('reason' in copied) return copied;
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
  const ex = concreteExcept(cx, st.except ?? []);
  if ('reason' in ex) return byHand(cx, st, ex.reason);
  const except = ex;
  for (const h of resolveObjs(cx, st.what)) {
    if (h.zone === 'battlefield' && g.s.objects[h.id]?.phasedOut) continue; // CR 702.26b: a phased-out permanent is treated as though it doesn't exist
    const original = readInfo(cx, h)?.object; // a copy of an object that left uses its last known information (CR 608.2h)
    if (!original || original.kind === 'ability') continue;
    const c = tokenCopyDef(cx, original, except, st.noManaCost === true);
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
        const where = tokenAttachment(cx, def, who, undefined);
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
    const enter = (host: string | null): { enter?: { tapped?: true; attachTo?: string; face?: number } } => {
      const facts = { ...(st.tapped ? { tapped: true as const } : {}), ...(host !== null ? { attachTo: host } : {}), ...(backUp ? { face: c.face } : {}) };
      return Object.keys(facts).length > 0 ? { enter: facts } : {};
    };
    for (const { who, hosts } of plans) {
      const batches: { count: number; host: string | null }[] = hosts.every((x) => x === null) ? [{ count: hosts.length, host: null }] : hosts.map((host) => ({ count: 1, host }));
      for (const b of batches) {
        const mark = g.events.length;
        if (propose(g, { ev: 'createToken', player: who, count: b.count, token: def.id, ...enter(b.host) })) created.push(...tokensCreatedSince(cx, mark));
      }
      g.log(`${g.player(who).name} creates ${hosts.length === 1 ? 'a token that is a copy' : `${hosts.length} tokens that are copies`} of ${g.nameOf(original.id)}.`, { rules: ['CR 707.2', 'CR 111.1'], level: 'action' });
    }
  }
  if (st.attacking) enterAttacking(cx, created.map((h) => h.id), st.attacking); // CR 508.4; M6-12: the named defender (myriad, CR 702.116a)
  bindAs(cx, st.as, created);
  return did(created.length);
}

/**
 * M6-2: the value forms of `copy` this handler runs (capability names as the walker writes them, model/cap-walk.ts): copy exceptions on token copies (CR 707.9b)
 * and copies of permanent spells (CR 707.10f). Read by model/capabilities.ts.
 */
export const OP_FORMS: readonly string[] = ['op:copy.except', 'op:copy.permanentSpell', 'op:copy.gains' /* std-copy-1: copiesGain */, 'op:copy.spellExcept' /* CLOUD std-misc: types, colors, P/T (token-defs.ts#exceptedSpellDef) */];

export const copy: StepHandler<Copy> = (cx, st) => {
  if (st.result === 'spell' && st.noManaCost) return byHand(cx, st, 'a copy of a spell with no mana cost is not automated yet (CR 707.9b, 707.10)');
  const n = st.count === undefined ? 1 : wholeNumber(cx, st.count);
  if (n === undefined || n === 0) return NOTHING;
  if (st.result !== 'spell') {
    const whos = resolvePlayers(cx, st.who);
    return whos.length === 0 ? NOTHING : copyAsTokens(cx, st, whos, n);
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

