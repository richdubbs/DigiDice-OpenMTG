/**
 * Native keyword actions about counters (design 7.5, `ActionMacro.native`), run by the `action` op through actions-native.ts#NATIVE_ACTIONS. Owner: PUSH1 T1.
 * None can be a fixed list of primitive steps (keywords/actions/index.ts gave the reasons; FAST5 T37 added monstrosity, CR 701.37, below):
 *
 *  - proliferate (CR 701.34a): choose any number of permanents and/or players that have a counter, then give each one additional counter of each kind that
 *    permanent or player already has. Step: `{op:'action', action:'proliferate', who, n?}` (`n`: "proliferate twice", each one a whole proliferate). The
 *    kinds are read for every chosen holder BEFORE any counter is put (the choice and the "already has" are one moment, CR 701.34a); each counter is proposed
 *    (CR 122.6, design 8.5), so a replacement that changes counters applies. CR 701.34b (Two-Headed Giant's shared poison) does not arise: the engine has no
 *    team variants.
 *  - bolster N (CR 701.39a): choose a creature you control with the least toughness or tied for least toughness among creatures you control; put N +1/+1
 *    counters on it. Step: `{op:'action', action:'bolster', who, n}`. Toughness is the layered value (CR 613.4); a creature whose toughness the engine cannot
 *    evaluate (an unset "*", rules/characteristics.ts#ptNumbers) makes "least" unknowable, so the action is resolved by hand. `as` binds the chosen creature.
 *
 * Fail closed like the other native actions: while text the engine does not run mentions the action (`modifiedByManualText`: "if you would proliferate,
 * proliferate twice instead"), it is resolved by hand; a manual trigger on the action ("whenever you proliferate, draw a card", CR 603.2) does not change how
 * the action is performed and is left to its own "Trigger now". `as` is bound first (design 3.1 rule 6, CR 609.3).
 */
import { charsOfObject, ptNumbers } from '../../rules/characteristics';
import type { EffectStep } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import type { ObjHandle } from '../../types/state';
import type { ExecCtx, StepHandler } from '../api';
import { evalQty } from '../eval';
import { performAction } from '../perform';
import { askManual } from '../manual';
import { spend } from '../run';
import { isCurrent, resolveRecipients } from '../refs';
import { countersOn } from './counters';
import { proposeMeasured, recordActed } from './lifedamage';
import { modifiedByManualText } from './manual-text';
import { proposeResult } from '../propose';
import { bindAs, did, firstPlayer, NOTHING, permanentsOf } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;
type Holder = ObjHandle | PlayerId;

/** Capability names (`feature:action.native.<name>`): the native actions of this module. */
export const COUNTER_FEATURES: readonly string[] = ['action.native.proliferate', 'action.native.bolster', 'action.native.monstrosity', 'action.native.renown' /* std-ry8 */, 'action.native.doubleEachKind' /* cloud std-spm */, 'action.native.anotherOfEachKind' /* r5-refs */];

const textOf = (st: ActionStep, fallback: string): string => st.span ?? fallback;

/** A whole number of times or counters: the step's `n` (1 when absent), or undefined when it can't be determined (CR 608.2b). Never negative (CR 107.1b). */
function amount(cx: ExecCtx, st: ActionStep): number | undefined {
  if (st.n === undefined) return 1;
  const raw = evalQty(cx, st.n);
  return raw === undefined || Number.isNaN(raw) ? undefined : Math.max(0, Math.floor(raw));
}

/** The kinds of counters on an object or a player now, in a fixed order (design 8.8 rule 1; counters.ts#countersOn: poison counters too, CR 122.1f). */
const kindsOn = (cx: ExecCtx, on: Holder): string[] => Object.keys(countersOn(cx, on));

const optionId = (h: Holder): string => (typeof h === 'string' ? `player:${h}` : `object:${h.id}`);
const holderName = (cx: ExecCtx, h: Holder): string => (typeof h === 'string' ? cx.g.player(h).name : cx.g.nameOf(h.id));

/** Every permanent (not phased out, CR 702.26b) and every player still in the game that has a counter: what proliferate may choose (CR 701.34a). */
function proliferateCandidates(cx: ExecCtx): Holder[] {
  const s = cx.g.s;
  const out: Holder[] = [];
  for (const id of s.zones.battlefield) {
    const o = s.objects[id];
    if (o && !o.phasedOut && kindsOn(cx, { id, zone: 'battlefield' }).length > 0) out.push({ id, zone: 'battlefield' });
  }
  for (const p of s.players) if (!p.hasLost && kindsOn(cx, p.id).length > 0) out.push(p.id);
  return out;
}

/** One proliferate (CR 701.34a): returns the number of permanents and players that got at least one counter. */
function proliferateOnce(cx: ExecCtx, player: PlayerId, st: ActionStep): number {
  const g = cx.g;
  const candidates = proliferateCandidates(cx);
  if (candidates.length === 0) {
    g.log(`${g.player(player).name} proliferates: no permanent or player has a counter.`, { rules: ['CR 701.34a'], level: 'info' });
    performAction(g, { verb: 'proliferate', actor: player }); // p2-counters-move-1: a proliferate that chose nothing is still one (CR 701.34a)
    return 0;
  }
  const ans = g.choose({
    kind: 'chooseOption', player, min: 0, max: candidates.length, rules: ['CR 701.34a'],
    prompt: `Proliferate (${textOf(st, 'Proliferate.')}): choose any number of permanents and/or players that have a counter. Each gets one more counter of each kind it already has.`,
    options: candidates.map((h) => ({ id: optionId(h), label: `${holderName(cx, h)} (${kindsOn(cx, h).join(', ')})` })),
  });
  const chosen = candidates.filter((h) => ans.ids.includes(optionId(h)));
  const plan = chosen.map((on) => ({ on, kinds: kindsOn(cx, on) })); // "already has": read for all of them before any counter is put
  let acted = 0;
  for (const { on, kinds } of plan) {
    let got = 0;
    for (const kind of kinds) {
      spend(cx, 1);
      if (typeof on !== 'string' && g.s.objects[on.id]?.zone !== 'battlefield') break; // it left meanwhile (CR 400.7)
      const put = proposeMeasured(cx, { ev: 'counters', change: 'put', on, kind, count: 1 });
      if (put > 0) {
        got += put;
        g.log(`${put} ${kind} counter${put === 1 ? '' : 's'} put on ${holderName(cx, on)}.`, { rules: ['CR 701.34a', 'CR 122.6'], level: 'action' });
      }
    }
    if (got > 0) acted++;
  }
  // p2-counters-move-1 (CR 701.34a, 603.2; cites unverified): "whenever you proliferate" triggers once per proliferate, after the whole action, whatever was chosen
  performAction(g, { verb: 'proliferate', actor: player });
  return acted;
}

/** CR 701.34a: proliferate (`n` times). */
const proliferate: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []);
  const modified = modifiedByManualText(g, /(?<!whenever you )\bproliferat(e|es|ed|ing|ion)\b/i);
  if (modified) return askManual(cx, textOf(st, 'Proliferate.'), `proliferate is modified by an ability the engine does not run, ${modified}`);
  const player = firstPlayer(cx, st.who);
  const times = amount(cx, st);
  if (player === undefined || times === undefined) return NOTHING; // fails to determine (CR 608.2b)
  let acted = 0;
  for (let i = 0; i < times; i++) {
    // p2-replace-events-2 (CR 701.34a, 614.1a): each proliferate is proposed first, so "If you would proliferate, proliferate twice instead" replaces it
    // (effects/proposal-kinds/proliferate.ts); replaced, this proliferate does not run (the replacement's instructions did instead)
    if (proposeResult(g, { ev: 'proliferate', player }) === null) continue;
    acted += proliferateOnce(cx, player, st);
  }
  return did(acted);
};

/** CR 701.39a: bolster N. */
const bolster: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []);
  const modified = modifiedByManualText(g, /(?<!whenever you )\bbolster(s|ed|ing)?\b/i);
  if (modified) return askManual(cx, textOf(st, 'Bolster.'), `bolster is modified by an ability the engine does not run, ${modified}`);
  if (st.n === undefined) return askManual(cx, textOf(st, 'Bolster.'), 'the step does not say N (CR 701.39a)');
  const player = firstPlayer(cx, st.who);
  const n = amount(cx, st);
  if (player === undefined || n === undefined) return NOTHING; // fails to determine (CR 608.2b)
  // "creatures you control" is relative to the player who bolsters; the filter's `you` is the controller of the effect
  if (player !== cx.controller) return askManual(cx, textOf(st, 'Bolster.'), 'another player bolsters: the creatures they control are not a filter the engine has (CR 701.39a)');
  const creatures = permanentsOf(cx, { ref: 'each', filter: { types: ['Creature'], controller: 'you' } });
  if (creatures.length === 0) {
    g.log(`${g.player(player).name} bolsters ${n}: they control no creature.`, { rules: ['CR 701.39a'], level: 'info' });
    return NOTHING;
  }
  const toughness = creatures.map((h) => ({ h, t: ptNumbers(charsOfObject(g.s, g.s.objects[h.id]!)).toughness }));
  const unknown = toughness.find((x) => x.t === null);
  if (unknown) return askManual(cx, textOf(st, 'Bolster.'), `the toughness of ${g.nameOf(unknown.h.id)} cannot be determined, so the least toughness is unknown (CR 701.39a, 208.2)`);
  const least = Math.min(...toughness.map((x) => x.t!));
  const tied = toughness.filter((x) => x.t === least).map((x) => x.h);
  let chosen = tied[0]!;
  if (tied.length > 1) {
    const ans = g.choose({
      kind: 'chooseObjects', player, options: tied.map((h) => h.id), min: 1, max: 1, rules: ['CR 701.39a'],
      prompt: `Bolster ${n}: choose a creature you control with the least toughness (${least}).`,
    });
    chosen = tied.find((h) => h.id === ans.ids[0]) ?? chosen;
  }
  bindAs(cx, st.as, [chosen]);
  g.log(`${g.player(player).name} bolsters ${n}: ${g.nameOf(chosen.id)} (toughness ${least}).`, { rules: ['CR 701.39a'], level: 'action' });
  if (n === 0) return did(0);
  const put = proposeMeasured(cx, { ev: 'counters', change: 'put', on: chosen, kind: '+1/+1', count: n });
  if (put > 0) g.log(`${put} +1/+1 counter${put === 1 ? '' : 's'} put on ${g.nameOf(chosen.id)}.`, { rules: ['CR 701.39a', 'CR 122.6'], level: 'action' });
  return did(put > 0 ? 1 : 0);
};

/**
 * CR 701.37a-b: monstrosity N. "If this permanent isn't monstrous, put N +1/+1 counters on it and it becomes monstrous." The designation is
 * `GameObject.monstrous` (types/state.ts; it ends when the permanent leaves the battlefield, CR 701.37b, 400.7). The counters are proposed (CR 122.6, design
 * 8.5), so a replacement that changes them applies; the permanent becomes monstrous even if no counter ended up on it (CR 701.37a). It becomes monstrous
 * only if it is still on the battlefield after the counters (it may have left meanwhile). Step: `{op:'action', action:'monstrosity', who, n}`; only the
 * permanent itself performs it (no `subject`). The `actionPerformed` event 'monstrosity' is "becomes monstrous" to triggers (triggers/normalize.ts). Fail
 * closed: text that changes the action ("If a creature you control would become monstrous, ...") makes it a hand-resolved step.
 */
const monstrosity: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []);
  const modified = modifiedByManualText(g, /\bwould become monstrous\b/i);
  if (modified) return askManual(cx, textOf(st, 'Monstrosity.'), `monstrosity is modified by an ability the engine does not run, ${modified}`);
  if (st.n === undefined) return askManual(cx, textOf(st, 'Monstrosity.'), 'the step does not say N (CR 701.37a)');
  if (st.subject !== undefined && (st.subject as { ref?: string }).ref !== 'self') return askManual(cx, textOf(st, 'Monstrosity.'), 'another permanent becomes monstrous (CR 701.37a)');
  const player = firstPlayer(cx, st.who);
  const n = amount(cx, st);
  if (player === undefined || n === undefined) return NOTHING; // fails to determine (CR 608.2b)
  const me = g.s.objects[cx.source.id];
  if (me === undefined || me.zone !== 'battlefield' || me.id !== cx.source.id) return NOTHING; // it left the battlefield: only permanents can be monstrous (CR 701.37b)
  if (me.monstrous === true) {
    g.log(`${g.nameOf(me.id)} is already monstrous.`, { rules: ['CR 701.37a'], level: 'info' });
    return NOTHING;
  }
  if (n > 0) {
    const put = proposeMeasured(cx, { ev: 'counters', change: 'put', on: { id: me.id, zone: 'battlefield' }, kind: '+1/+1', count: n });
    if (put > 0) g.log(`${put} +1/+1 counter${put === 1 ? '' : 's'} put on ${g.nameOf(me.id)}.`, { rules: ['CR 701.37a', 'CR 122.6'], level: 'action' });
  }
  const after = g.s.objects[me.id];
  if (after === undefined || after.zone !== 'battlefield') return NOTHING; // it left meanwhile (CR 400.7): it does not become monstrous
  after.monstrous = true;
  g.log(`${g.nameOf(me.id)} becomes monstrous.`, { rules: ['CR 701.37a', 'CR 701.37b'], level: 'action' });
  performAction(g, { verb: 'monstrosity', actor: player, objectId: me.id }); // "becomes monstrous" (triggers/normalize.ts)
  return did(1);
};

/**
 * std-ry8, CR 702.112a-b: renown N, the effect of the keyword's triggered ability ("When this creature deals combat damage to a player, if it isn't renowned, put N
 * +1/+1 counters on it and it becomes renowned"): as monstrosity, on the permanent itself only. `GameObject.renowned` (types/state.ts) ends as the permanent leaves
 * the battlefield (CR 400.7). An already renowned permanent gets nothing (the intervening "if" is checked again here, CR 603.4). The counters are proposed (CR 122.6);
 * the permanent becomes renowned even if no counter ended up on it, only if it is still on the battlefield. The `actionPerformed` event 'renown' is "becomes
 * renowned" to triggers (triggers/normalize.ts). Step: `{op:'action', action:'renown', who, n}`.
 */
const renown: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []);
  const modified = modifiedByManualText(g, /\bwould become renowned\b/i);
  if (modified) return askManual(cx, textOf(st, 'Renown.'), `renown is modified by an ability the engine does not run, ${modified}`);
  if (st.n === undefined) return askManual(cx, textOf(st, 'Renown.'), 'the step does not say N (CR 702.112a)');
  if (st.subject !== undefined && (st.subject as { ref?: string }).ref !== 'self') return askManual(cx, textOf(st, 'Renown.'), 'another permanent becomes renowned (CR 702.112a)');
  const player = firstPlayer(cx, st.who);
  const n = amount(cx, st);
  if (player === undefined || n === undefined) return NOTHING; // fails to determine (CR 608.2b)
  const me = g.s.objects[cx.source.id];
  if (me === undefined || me.zone !== 'battlefield' || me.id !== cx.source.id) return NOTHING; // it left the battlefield (CR 400.7)
  if (me.renowned === true) {
    g.log(`${g.nameOf(me.id)} is already renowned.`, { rules: ['CR 702.112a', 'CR 603.4'], level: 'info' });
    return NOTHING;
  }
  if (n > 0) {
    const put = proposeMeasured(cx, { ev: 'counters', change: 'put', on: { id: me.id, zone: 'battlefield' }, kind: '+1/+1', count: n });
    if (put > 0) g.log(`${put} +1/+1 counter${put === 1 ? '' : 's'} put on ${g.nameOf(me.id)}.`, { rules: ['CR 702.112a', 'CR 122.6'], level: 'action' });
  }
  const after = g.s.objects[me.id];
  if (after === undefined || after.zone !== 'battlefield') return NOTHING; // it left meanwhile (CR 400.7): it does not become renowned
  after.renowned = true;
  g.log(`${g.nameOf(me.id)} becomes renowned.`, { rules: ['CR 702.112a', 'CR 702.112b'], level: 'action' });
  performAction(g, { verb: 'renown', actor: player, objectId: me.id }); // "becomes renowned" (triggers/normalize.ts)
  return did(1);
};

/**
 * cloud std-spm, CR 701.10e: "double the number of each kind of counter on <subject>": each permanent or player of `subject` gets as many of each kind of counter
 * as it already has. A holder's kinds and their numbers are read before any counter is put on it, so doubling one kind never changes what another kind doubles
 * to; each kind is its own proposed `counters` event (CR 122.6, design 8.5), so a replacement that changes counters applies. The holders are done one at a time
 * in the order the reference gives them (the `doubleCounters` macro's `forEach`), each still where it was (CR 400.7). Step: `{op:'action', action:
 * 'doubleEachKind', subject, who}`; `as` binds the holders that got counters. A holder with no counters gets none.
 */
const doubleEachKind: StepHandler<ActionStep> = (cx, st) => eachKind(cx, st, 'double');

/**
 * Standard round 5, r5-refs (CR 122.1, 122.6): "for each kind of counter on target permanent or player, give that permanent or player another counter of that kind":
 * each holder of `subject` gets one counter of every kind it has, the kinds read before any counter is put (a kind put now is never "already there"), each kind its
 * own proposed `counters` event, as doubleEachKind. Step: `{op:'action', action:'anotherOfEachKind', subject, who}`.
 */
const anotherOfEachKind: StepHandler<ActionStep> = (cx, st) => eachKind(cx, st, 'another');

/** doubleEachKind and anotherOfEachKind: as many more of each kind as the holder has (`double`), or one more (`another`). */
function eachKind(cx: ExecCtx, st: ActionStep, how: 'double' | 'another'): ReturnType<StepHandler<ActionStep>> {
  const g = cx.g;
  const rule = how === 'double' ? 'CR 701.10e' : 'CR 122.6';
  if (st.subject === undefined) return askManual(cx, textOf(st, how === 'double' ? 'Double the number of each kind of counter.' : 'Give another counter of each kind.'), `the step does not say whose counters (${rule})`);
  const r = resolveRecipients(cx, st.subject);
  const current = (h: Holder): boolean => (typeof h === 'string' ? !g.player(h).hasLost : isCurrent(cx, h));
  const acted: Holder[] = [];
  for (const on of [...r.objects, ...r.players]) {
    if (!current(on)) continue;
    const plan = countersOn(cx, on); // "already has": every kind and its number, before any counter is put
    let got = 0;
    for (const [kind, n] of Object.entries(plan)) {
      spend(cx, 1);
      if (!current(on)) break; // it left meanwhile (CR 400.7)
      const put = proposeMeasured(cx, { ev: 'counters', change: 'put', on, kind, count: how === 'double' ? n : 1 });
      if (put <= 0) continue;
      got += put;
      g.log(`${put} ${kind} counter${put === 1 ? '' : 's'} put on ${holderName(cx, on)}.`, { rules: [rule, 'CR 122.6'], level: 'action' });
    }
    if (got > 0) acted.push(on);
  }
  return recordActed(cx, st.as, acted);
}

/** The native actions of this module by `ActionMacro.native` name (keywords/actions/native.ts). */
export const COUNTER_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { proliferate, bolster, monstrosity, renown, doubleEachKind, anotherOfEachKind };
