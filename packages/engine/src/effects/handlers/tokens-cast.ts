/**
 * The `cast` op (CR 701.5, 608.2g, 400.7h): "you may cast that card without paying its mana cost", "cast it". Owner: WP14.
 *
 * The player casts the card while the effect resolves, following CR 601.2a-i (modes, X, targets, costs and payment are the normal casting decisions), and no
 * player receives priority afterwards: the spell is the topmost object of the stack and the resolution continues (CR 608.2g). Casting itself is actions/cast.ts,
 * reached through effects/cast-hook.ts (design 5.4: the interpreter does not import actions). Each card is a separate cast; with `optional` the player chooses
 * for each one (CR 707.12a, 608.2d). A cast that is impossible now (no legal target, a "can't cast" effect, CR 101.2) doesn't happen and is logged. Other parts of
 * the effect can find the new spell (CR 400.7h): bindings are re-based onto it.
 *
 * M6-12 (`op:cast.costChange`): "cast it by paying [cost] rather than paying its mana cost" (`costChange: {kind: 'set', cost, name}`, madness CR 702.35a-b):
 * the cost is an alternative cost (CR 118.9) named `name`, paid as in CR 601.2b, 601.2f-h.
 *
 * Resolved by hand: any other changed cost (a reduction, an increase, a set mana amount: `op:cast.costChange.<kind>`, never registered), and any cast when the
 * casting module is not loaded.
 */
import type { Game } from '../../core/game';
import type { EffectStep } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import type { ObjHandle } from '../../types/state';
import { resolutionCaster, resolutionLandPlayer } from '../cast-hook';
import type { StepHandler } from '../api';
import { readInfo, rebase, resolveObjs } from '../refs';
import { performCreateCardCopy } from '../perform-direct';
import { runNested } from '../nested';
import { actOn, bindAs, byHand, did, firstPlayer, NOTHING } from './zones-util';
import { evalQty } from '../eval';
import { groupStat } from '../../rules/targets';

type Cast = Extract<EffectStep, { op: 'cast' }>;

/**
 * The game as the casting rules see it during a resolution: every decision they raise (targets, kicker, X, payment) is NOT cancellable. CR 733.1 lets a player
 * take back a spell they are casting by their own choice; one cast because a resolving spell or ability says so is part of that resolution, and cancelling it
 * would undo the whole resolution (core/apply.ts restores the state before the priority pass) and show the other players the state from before it
 * (core/view.ts). The same wrapper as triggers/stack.ts#uncancellable (CR 603.3d choices, not exported there).
 */
function uncancellable(g: Game): Game {
  return new Proxy(g, {
    get(target, prop) {
      if (prop === 'choose') return (input: Parameters<Game['choose']>[0]) => target.choose({ ...input, cancellable: false });
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set: (target, prop, value) => Reflect.set(target, prop, value, target),
  });
}

/**
 * M6-12 (m6 design 7, `OP_FORMS`): the value form of `cast` this handler runs, as the walker writes it (model/cap-walk.ts): an alternative cost paid instead of
 * the mana cost (CR 118.9, 702.35b). Read by model/capabilities.ts.
 */
export const OP_FORMS: readonly string[] = ['op:cast.costChange', 'op:cast.copy' /* FAST5X E26: a copy of the card created in exile and cast (CR 707.12) */, 'op:cast.play' /* FAST5X E26: a land is played (CR 305.9) */, 'op:cast.anyManaType' /* FAST5X E29: CR 609.4b */,
  'op:cast.graveyardInstead' /* Cloud r4-repl: "If that spell would be put into a graveyard, exile it instead", CR 614.1a */,
  'op:cast.maxManaValue' /* std-rq: "if that spell's mana value is 8 or less", CR 601.2, 202.3 */,
  'op:cast.select' /* std-cardcopy-7: "cast up to three of the copies", "... with total mana value 6 or less from among the copies", CR 608.2d */];

/**
 * FAST5X E26 (CR 707.12, 702.192a): "create a copy of [it] in exile. You may cast the copy without paying its mana cost": a copy of the card each handle stands
 * for (the object as it is, or as it last existed, CR 608.2h: paradigm's delayed trigger copies the spell that created it, which has left the stack) is created in
 * `zone`, owned and controlled by the caster, and is then the object the cast below casts. A copy of a card is never a card (`kind: 'spellCopy'`); one that is
 * not cast ceases to exist at the next state-based action check (CR 707.10a, 704.5e: core/sba-objects.ts). Returns the copies' handles.
 */
/** The faces a card may be played or cast with (CR 712.12: each face of a modal double-faced card; otherwise its front face, CR 709.3 split halves are spells). */
function playableFaces(g: Game, id: string): { types: readonly string[] }[] {
  const o = g.s.objects[id];
  const def = o ? g.s.defs[o.defId] : undefined;
  if (!def) return [];
  return def.layout === 'modal_dfc' ? def.faces : def.faces.slice(0, 1);
}
/** CR 305.9, 712.12: can this card be played as a land (a land face)? */
const hasLandFace = (g: Game, id: string): boolean => playableFaces(g, id).some((f) => f.types.includes('Land'));
/** CR 712.12: has this card a face that is not a land (a modal double-faced card that is a spell on one face)? */
const hasNonlandFace = (g: Game, id: string): boolean => playableFaces(g, id).some((f) => !f.types.includes('Land'));

function copiesIn(cx: Parameters<StepHandler<Cast>>[0], st: Cast, zone: 'exile', who: PlayerId): ObjHandle[] {
  const g = cx.g;
  const out: ObjHandle[] = [];
  for (const h of resolveObjs(cx, st.what)) {
    const info = readInfo(cx, h);
    const o = info?.object;
    if (!o || o.kind === 'ability' || o.kind === 'emblem' || !g.s.defs[o.defId]) continue;
    const copy = performCreateCardCopy(g, o, who, zone);
    g.log(`${g.player(who).name} creates a copy of ${g.nameOf(copy)} in exile.`, { rules: ['CR 707.12', 'CR 702.192a'], level: 'action' });
    out.push({ id: copy, zone });
  }
  return out;
}

export const cast: StepHandler<Cast> = (cx, st) => {
  const ch = st.costChange;
  const alternative = ch && ch.kind === 'set' && ch.cost !== undefined && ch.mana === undefined && ch.generic === undefined && !st.free ? { name: ch.name ?? 'alternative', cost: ch.cost } : undefined;
  if (ch && !alternative) return byHand(cx, st, 'casting with a changed cost during a resolution is not automated yet (CR 601.2f)');
  const caster = resolutionCaster();
  if (!caster) return byHand(cx, st, 'the casting rules are not loaded in this module graph (CR 608.2g)');
  const g = cx.g;
  const who = firstPlayer(cx, st.who);
  if (who === undefined) return NOTHING;
  const opts = {
    free: st.free === true, ...(st.transformed === true ? { transformed: true } : {}), ...(alternative ? { alternative } : {}), // CR 712.11a; M6-12: CR 118.9
    ...(st.copyIn !== undefined ? { copy: true as const } : {}), // FAST5X E26
    ...(st.anyManaType === true ? { anyManaType: true } : {}), // FAST5X E29: CR 609.4b
    // std-rq: only a resulting spell of at most that mana value (CR 601.2, 202.3); std-rx31: a quantity is read as the step runs (CR 608.2h)
    ...(st.maxManaValue !== undefined ? { maxManaValue: evalQty(cx, st.maxManaValue) ?? -1 } /* an unknown amount casts nothing */ : {}),
  };
  const spells: ObjHandle[] = [];
  let objects = st.copyIn !== undefined ? copiesIn(cx, st, st.copyIn, who) : actOn(cx, st.what); // FAST5X E26: cast a copy (CR 707.12)
  // std-cardcopy-7 (CR 608.2d, 202.3): "cast up to three of the copies", "any number of spells with total mana value 6 or less from among the copies": one choice of
  // the objects to cast among those that can be cast now, with the limits read once (CR 608.2h); each chosen one is then cast without asking again
  let chosenAll = false;
  if (st.select !== undefined && st.play !== true) {
    const castable = objects.filter((h) => { const o = g.s.objects[h.id]; return o !== undefined && caster.check(g, who, o.id, opts) === null; });
    const ids = castable.map((h) => h.id);
    const max = st.select.max === undefined ? ids.length : Math.max(0, Math.min(ids.length, Math.floor(evalQty(cx, st.select.max) ?? 0)));
    const total = st.select.totalManaValue === undefined ? undefined : evalQty(cx, st.select.totalManaValue);
    if (st.select.totalManaValue !== undefined && total === undefined) return NOTHING; // CR 608.2b: an amount that fails to determine casts nothing
    const limit = total === undefined ? undefined : { stat: 'manaValue' as const, op: '<=' as const, value: total, values: Object.fromEntries(ids.map((id) => [id, groupStat(g.s, { kind: 'object', id }, 'manaValue')])) };
    const picked = max === 0 ? [] : g.choose({
      kind: 'chooseObjects', player: who, prompt: `Choose the spells to cast${opts.free ? ' without paying their mana costs' : ''}${total !== undefined ? ` (total mana value ${total} or less)` : ''}.`,
      options: ids, min: st.optional === false ? max : 0, max, ...(limit !== undefined ? { limit } : {}), rules: ['CR 608.2d', 'CR 608.2g'],
    }).ids;
    objects = picked.map((id) => castable.find((h) => h.id === id)!);
    chosenAll = true;
  }
  for (const h of objects) {
    const o = g.s.objects[h.id];
    // only cards that aren't spells or permanents can be cast (CR 601.2a); FAST5X E26: or the copy of a card this step just created (CR 707.12)
    if (!o || (o.kind !== 'card' && !(st.copyIn !== undefined && o.kind === 'spellCopy')) || o.zone === 'stack' || o.zone === 'battlefield') continue;
    const name = g.nameOf(o.id);
    // FAST5X E26 (CR 305.9, 702.75a): "play" a land card: it is played as a land (never cast) as part of this resolution, if the player can play one now
    if (st.play === true && hasLandFace(g, o.id)) {
      const lands = resolutionLandPlayer();
      if (!lands) return byHand(cx, st, 'the land rules are not loaded in this module graph (CR 305.1)');
      const no = lands.check(g, who, o.id);
      // CR 712.12: a modal double-faced card with a spell face may instead be cast (its spell face); otherwise a land card is only played (CR 305.9)
      const castable = hasNonlandFace(g, o.id) && caster.check(g, who, o.id, opts) === null;
      if (no && !castable) {
        g.log(`${g.player(who).name} can't play ${name} now: ${no.message}`, { rules: ['CR 608.2g', ...no.rules], level: 'info' });
        continue;
      }
      if (!no) {
        const choice = g.choose({
          kind: 'chooseOption', player: who, prompt: `Play ${name}?`, min: st.optional ? 0 : 1, max: 1, rules: ['CR 608.2d', 'CR 305.2a', 'CR 712.12'],
          options: [{ id: 'land', label: 'Play it as a land' }, ...(castable ? [{ id: 'cast', label: `Cast it${opts.free ? ' without paying its mana cost' : ''}` }] : [])],
        }).ids[0];
        if (choice === undefined) continue;
        if (choice === 'land') {
          const id = lands.play(g, who, o.id);
          if (id) rebase(cx, h.id, { id, zone: 'battlefield' }); // CR 400.7h
          continue;
        }
        // 'cast': below, without asking again
        const id = caster.cast(uncancellable(g), who, o.id, opts);
        if (!id) continue;
        const spell: ObjHandle = { id, zone: 'stack' };
        rebase(cx, h.id, spell);
        spells.push(spell);
        continue;
      }
    }
    const denial = caster.check(g, who, o.id, opts);
    if (denial) {
      g.log(`${g.player(who).name} can't cast ${name} now: ${denial.message}`, { rules: ['CR 608.2g', ...denial.rules], level: 'info' });
      continue;
    }
    if (st.optional && !chosenAll) {
      const yes = g.choose({
        kind: 'yesNo', player: who, prompt: `Cast ${name}${opts.transformed ? ' transformed' : ''}${opts.free ? ' without paying its mana cost' : ''}${alternative ? ` for its ${alternative.name} cost` : ''}?`, yesLabel: 'Cast it', noLabel: "Don't cast it", rules: ['CR 608.2d', 'CR 608.2g'],
      }).yes;
      if (!yes) continue;
    }
    const id = caster.cast(uncancellable(g), who, o.id, opts); // CR 608.2g: part of the resolution, never taken back alone
    if (!id) continue;
    const spell: ObjHandle = { id, zone: 'stack' };
    rebase(cx, h.id, spell); // CR 400.7h
    spells.push(spell);
  }
  bindAs(cx, st.as, spells);
  // Cloud r4-repl (CR 614.1a, 400.7, 611.2c): "If that spell would be put into a graveyard, exile it instead": a replacement effect of this resolution for each spell
  // just cast, about that object on the stack only (a fixed handle: once it resolves or leaves the stack it is a new object the effect no longer sees); std-rw7
  // (CR 614.1a, 205.2a): with `types`, only a spell of one of those card types ("If an instant or sorcery spell cast this way would be put into your graveyard")
  if (st.graveyardInstead !== undefined && spells.length > 0) {
    const gi = st.graveyardInstead;
    runNested(cx, spells.map((h): EffectStep => ({
      op: 'effect', duration: { d: 'permanent' },
      effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { is: { ref: 'fixed', objects: [{ id: h.id, zone: h.zone }] }, ...(gi.yours === true ? { owner: 'you' } : {}), ...(gi.types !== undefined ? { types: [...gi.types] } : {}) }, from: 'stack', to: 'graveyard' }, body: { b: 'modify', destination: gi.to } }],
    })));
  }
  return did(spells.length);
};
