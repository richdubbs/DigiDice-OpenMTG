/**
 * Op handlers: control flow, choices and manual steps (design 8.7). Owner: WP10. The aggregator (handlers/index.ts) spreads this table into OP_HANDLERS; the
 * capability `op:<op>` appears only when the op has a handler here AND a renderer (design 5.2).
 * Ops: if may pay forEach repeat let chooseObjects chooseValue manual. `pay` lives in handlers/pay.ts, the two choices in handlers/choose.ts.
 *
 * None of these changes the game by itself: they decide which other steps run, in which order and for whom (CR 608.2c-f), and the steps they run act
 * through the proposal pipeline.
 */
import { beholdCandidates } from './behold';
import type { EffectStep, ObjRef, PlayerRef } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import type { ObjHandle } from '../../types/state';
import { findObjects } from '../../rules/filter';
import type { ExecCtx, OpHandlers, StepHandler, StepResult } from '../api';
import { evalCond, evalQty } from '../eval';
import { currentObjs, filterCtxOf, readInfo, resolveObjs, resolvePlayers, resolveRecipients } from '../refs';
import { askManual, notesOf, shownTo } from '../manual';
import { runSteps, spend } from '../run';
import { bindingOf, chooseObjectsHandler, chooseValueHandler } from './choose';
import { payHandler } from './pay';
import { ACTION_MACROS } from '../../keywords/actions';
import { canCollectEvidence, evidenceAmount } from './evidence';
import { canForage } from './forage';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;

const NOTHING: StepResult = { performed: false, count: 0 };

/** Players in APNAP order (CR 101.4); players the order does not know (they have left the game) keep their place at the end. */
function inApnap(cx: ExecCtx, ps: PlayerId[]): PlayerId[] {
  const order = cx.g.apnap();
  const rank = (p: PlayerId): number => { const i = order.indexOf(p); return i < 0 ? order.length : i; };
  return [...ps].sort((a, b) => rank(a) - rank(b));
}

function restoreIterating(cx: ExecCtx, before: ExecCtx['iterating']): void {
  if (before === undefined) delete cx.iterating;
  else cx.iterating = before;
}

// ---- if --------------------------------------------------------------------------------------------------------------------------------------------------------

/** CR 608.2c: "If [condition], [then]; otherwise [else]" (also the form of a self-replacement "instead", CR 614.15). Returns what the branch did. */
const ifHandler: StepHandler<Step<'if'>> = (cx, st) => (evalCond(cx, st.cond) ? runSteps(cx, st.then) : runSteps(cx, st.else ?? []));

// ---- may -------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The players who act in a step of the `may` of `player`: the step's own `who`, read as it will be read when the step runs (with `{ref:'iterating'}` = the
 * may player when the `may` is plural). "You may have target opponent discard a card" is acted by the opponent, not by the player who may.
 */
function actorsOf(cx: ExecCtx, who: PlayerRef, player: PlayerId, plural: boolean): PlayerId[] {
  if (!plural) return resolvePlayers(cx, who);
  const before = cx.iterating;
  cx.iterating = player;
  try {
    return resolvePlayers(cx, who);
  } finally {
    restoreIterating(cx, before);
  }
}

/**
 * CR 608.2d: a player can't choose to do something impossible. When the first thing `may` would do can't be done at all (nothing to sacrifice, the object is
 * gone, no card to discard) the player is not asked and does not do it (CR 118.12 Standstill example; 608.2d example: "A player who controls no
 * creatures can't choose the sacrifice option"). "Discard your hand" is never impossible (AF1: an empty hand can be discarded). A numeric count must be
 * met in full (CR 118.3: one who controls one Food can't choose to sacrifice two; CR 701.17b: nor mill two cards from a one-card library). Only shapes
 * whose impossibility is plain are judged; for anything else the player is asked. A discard, a mill or a sacrifice is judged for the players who would do it (the step's `who`): it is impossible only if it is impossible for every one of them.
 */
function cannotStart(cx: ExecCtx, steps: EffectStep[], player: PlayerId, plural: boolean): boolean {
  const first = steps[0];
  if (!first) return false;
  if (evidenceImpossible(cx, steps, player, plural)) return true;
  switch (first.op) {
    case 'move': case 'destroy': case 'sacrifice': case 'attach': case 'phaseOut': case 'changeFace': case 'removeFromCombat':
      // FAST5 T65 (CR 608.2d, 701.24a): "you may shuffle your hand and graveyard into your library, then draw N cards": the cards of whole zones moved first, and the
      // library shuffled after them, which can always be done (an empty hand and graveyard are shuffled in as nothing), so it is never impossible to choose
      if (first.op === 'move' && first.what.ref === 'each' && steps.some((x) => x.op === 'shuffle')) return false;
      return currentObjs(cx, resolveObjs(cx, first.what)).length === 0;
    // CR 701.26a-b: only an untapped permanent can be tapped, only a tapped one untapped. "You may tap it. If you do, ..." with it already tapped: not done.
    case 'tap': case 'untap': {
      const wanted = first.op === 'untap';
      return !currentObjs(cx, resolveObjs(cx, first.what)).some((h) => { const o = cx.g.s.objects[h.id]; return o?.zone === 'battlefield' && o.tapped === wanted; });
    }
    case 'chooseObjects': {
      // FAST5 T78 (CR 608.2d, 118.3): "you may remove a +1/+1 counter from each of two creatures you control" needs two of them; a smaller group can't be chosen from
      const have = currentObjs(cx, resolveObjs(cx, first.from)).length;
      return have === 0 || (typeof first.min === 'number' && first.min > 1 && typeof first.max === 'number' && first.min === first.max && have < first.min);
    }
    case 'sacrificeChoice': {
      // T3 review: "you may sacrifice two Foods" needs two of them (CR 118.12: the action is a cost paid on resolution; CR 118.3: a cost is paid fully or not
      // at all). A count that is not a plain number is judged by "at least one", as before.
      const need = typeof first.count === 'number' ? Math.max(first.count, 1) : 1;
      const found = findObjects(cx.g.s, first.filter, filterCtxOf(cx));
      return !actorsOf(cx, first.who, player, plural).some((p) => found.filter((o) => o.controller === p).length >= need);
    }
    case 'discard': {
      // T3 review: "you may discard two cards" needs two cards in hand (CR 118.3, 118.12).
      // AF1: "you may discard your hand" can be chosen with an empty hand, and then "if you do" is true: the official ruling on Narset, Jeskai Waymaster
      // (WotC, 2025-04-04): "You may choose to discard your hand even if your hand contains zero cards." (CR 701.9a, 608.2c, 608.2d)
      if (first.count === 'hand' && first.filter === undefined) return false;
      const need = typeof first.count === 'number' ? Math.max(first.count, 1) : 1;
      return actorsOf(cx, first.who, player, plural).every((p) => (cx.g.s.zones.hand[p] ?? []).length < need);
    }
    case 'mill': {
      // CR 701.17b: a player given the choice to mill N cards can't choose to with fewer than N cards in library
      if (typeof first.count !== 'number') return false;
      const need = first.count;
      return actorsOf(cx, first.who, player, plural).every((p) => (cx.g.s.zones.library[p] ?? []).length < need);
    }
    case 'removeCounters': {
      // T3 (push wave): "you may remove a +1/+1 counter from ~. If you do, ..." can't be chosen without such a counter (CR 608.2d)
      if (typeof first.count !== 'number') return false;
      const r = resolveRecipients(cx, first.from);
      if (r.players.length > 0) return false;
      const n = first.count;
      return !currentObjs(cx, r.objects).some((h) => {
        const c = cx.g.s.objects[h.id]!.counters;
        return (first.kind === 'any' ? Object.values(c).reduce((a, b) => a + b, 0) : c[first.kind] ?? 0) >= n;
      });
    }
    case 'action': {
      // FAST5X E11 (CR 701.4a, 608.2d): "you may behold an Elf. If you do, ..." can't be chosen with no Elf in hand or on the battlefield under your control
      // FAST5X E28 (CR 701.61a, 608.2d): "you may forage" can't be chosen with neither three cards in the graveyard to exile nor a Food to sacrifice
      if (first.action === 'forage') return actorsOf(cx, first.who, player, plural).every((p) => !canForage(cx.g.s, p));
      if (first.action === 'behold') return first.arg !== undefined && actorsOf(cx, first.who, player, plural).every((p) => beholdCandidates(cx.g.s, p, first.arg!).length === 0);
      // FAST5X E12, CR 701.60d: a suspected permanent can't become suspected again ("you may suspect it" with it already suspected: not done)
      if (first.action === 'suspect' && first.subject !== undefined) {
        return !currentObjs(cx, resolveObjs(cx, first.subject as ObjRef)).some((h) => { const o = cx.g.s.objects[h.id]; return o?.zone === 'battlefield' && o.suspected === undefined; });
      }
      // FAST5X E9, CR 701.68b: a player who can't put N -1/-1 counters on a creature they control can't choose to blight: judged by the first step of the
      // macro's expansion (choose a creature you control). Other keyword actions keep asking.
      if (first.action !== 'blight') return false;
      const expand = ACTION_MACROS.blight?.expand;
      if (expand === undefined) return false;
      const { guard: _guard, ...bare } = first;
      return cannotStart(cx, expand(bare), player, plural);
    }
    default:
      return false;
  }
}

/**
 * FAST5X E12, CR 701.59b, 608.2d: "you may [exile it and] collect evidence N" can't be chosen when the player can't exile cards with total mana value N or more
 * from their graveyard. The cards an earlier unguarded step of the same choice moves out of the graveyard ("exile it") are not counted: they are gone first.
 */
function evidenceImpossible(cx: ExecCtx, steps: EffectStep[], player: PlayerId, plural: boolean): boolean {
  if (!steps.some((st) => st.op === 'action' && st.action === 'collectEvidence')) return false;
  const gone = new Set<string>();
  for (const st of steps) {
    if (st.guard) return false;
    if (st.op === 'move' && st.to.zone !== 'graveyard') {
      if (st.what.ref === 'bound' && !cx.bindings.has(st.what.name)) return false; // named by an earlier step of this choice: not known before it runs
      for (const h of currentObjs(cx, resolveObjs(cx, st.what))) if (h.zone === 'graveyard') gone.add(h.id);
      continue;
    }
    if (st.op === 'action' && st.action === 'collectEvidence') {
      const n = evidenceAmount(cx, st);
      if (n === undefined) return false;
      return actorsOf(cx, st.who, player, plural).every((p) => !canCollectEvidence(cx.g.s, p, n, gone));
    }
    return false;
  }
  return false;
}

/**
 * PAY1: the optional action in words, for a `may` step without its own sentence (Fatestitcher's "You may tap or untap another target permanent" asks
 * "do you tap Grizzly Bears?", then "do you untap Grizzly Bears?" instead of the generic question). Only a single tap or untap of objects that can be
 * named is described; anything else keeps the generic wording.
 */
function optionalAction(cx: ExecCtx, st: Step<'may'>): string | undefined {
  if (st.do.length !== 1) return undefined;
  const d = st.do[0]!;
  if ((d.op !== 'tap' && d.op !== 'untap') || d.guard) return undefined;
  const hs = currentObjs(cx, resolveObjs(cx, d.what));
  if (hs.length === 0 || hs.length > 3) return undefined;
  return `${d.op} ${hs.map((h) => cx.g.nameOf(h.id)).join(' and ')}`;
}

/**
 * r3-dig (CR 608.2c, 608.2b, design 3.1 rule 6): the names the optional instructions of one player's `may` bind themselves (the `as` of each of its own steps, and the
 * cards a `revealUntil` revealed), which a later sentence may name: "You may exile the top card of your library. You may play that card this turn." When the option was
 * not taken they name nothing, so a later instruction that reads them does nothing (an instruction that refers to something that doesn't exist does nothing). Only a
 * `may` of one player with no `otherwise` (model/lint-flow.ts lets the steps after it read exactly these names); a name already bound is kept.
 */
export function declinedNames(st: Step<'may'>): string[] {
  if (st.otherwise !== undefined || st.who.ref === 'each') return [];
  const out: string[] = [];
  for (const d of st.do) {
    if (d.op !== 'forEach' && typeof d.as === 'string') out.push(d.as);
    if (d.op === 'revealUntil' && typeof d.revealed === 'string') out.push(d.revealed);
    if (d.op === 'exileUntil' && typeof d.exiled === 'string') out.push(d.exiled); // trek-7: every card exiled
  }
  return out;
}

function bindDeclined(cx: ExecCtx, st: Step<'may'>): void {
  for (const n of declinedNames(st)) if (!cx.bindings.has(n)) cx.bindings.set(n, { objects: [], players: [], snapshots: {} });
}

/**
 * CR 608.2d, 603.5: "[who] may [do]; if they don't, [otherwise]". `performed` is whether the player chose to (CR 118.12) and the optional action was carried out
 * (merge wave 8, audit D2: its instructions did something, CR 603.12, 608.2c), so `did` reads that. With
 * several players (CR 608.2e) every player chooses first, in APNAP order, and then the actions are taken, each with `{ref:'iterating'}` = that player.
 * "Plural" is decided by the shape of `who` (`each`), not by how many players it finds: "each opponent may" in a two-player game still acts for that one
 * opponent through `{ref:'iterating'}`. A singular `who` keeps the `iterating` of an enclosing `forEach`.
 */
const mayHandler: StepHandler<Step<'may'>> = (cx, st) => {
  const g = cx.g;
  const source = notesOf(cx).sourceName;
  const players = inApnap(cx, resolvePlayers(cx, st.who));
  if (players.length === 0) { bindDeclined(cx, st); return NOTHING; }
  if (st.anyOne === true) return anyOneMay(cx, st, players);
  // M12 gaps: "[you and] each opponent who voted for ..." (`voters`) is a group like "each opponent", whoever it turns out to be
  const plural = st.who.ref === 'each' || st.who.ref === 'voters' || players.length > 1;
  const action = st.span ? undefined : optionalAction(cx, st);
  const what = st.span ?? action ?? 'the optional part of the effect';
  const yes = new Map<PlayerId, boolean>();
  for (const p of players) {
    if (cannotStart(cx, st.do, p, plural)) {
      g.log(`${g.player(p).name} can't do it, so doesn't: ${what} (${source}).`, { rules: ['CR 608.2d'], level: 'info' });
      yes.set(p, false);
      continue;
    }
    const prompt = st.span ? `${source}: ${st.span} Do you?` : action ? `${source}: do you ${action}?` : `${source}: do you do the optional part of the effect?`;
    const ans = g.choose({ kind: 'yesNo', player: p, prompt, yesLabel: 'Yes', noLabel: 'No', rules: ['CR 608.2d', 'CR 603.5'] }).yes;
    g.log(`${g.player(p).name} ${ans ? 'chooses to' : 'chooses not to'}: ${what} (${source}).`, { rules: ['CR 608.2d'], level: 'action' });
    yes.set(p, ans);
  }
  const before = cx.iterating;
  let count = 0;
  let lostBy: Map<PlayerId, number> | undefined;
  let removed: Map<string, number> | undefined; // std-rx14 (CR 122.1, 608.2c): the counters the optional action removed ("for each lore counter removed this way")
  let putIn: Map<string, number> | undefined; // trek-6 (CR 122.6, 608.2c): the counters the optional action put ("if you put two or more +1/+1 counters on creatures this way")
  for (const p of players) {
    if (plural) cx.iterating = p;
    const did = yes.get(p) === true;
    // std-rq (CR 608.2d, 122.6): the optional instructions of one other player are that player's ("that player may put a +1/+1 counter on ~": they put it)
    const performer = cx.performer;
    if (did && !plural && p !== cx.controller) cx.performer = p;
    const r = runSteps(cx, (did ? st.do : st.otherwise) ?? []);
    if (performer === undefined) delete cx.performer;
    else cx.performer = performer;
    // Merge wave 8 (audit D2, CR 603.12, 608.2c): "if you do" / "when you do" ask whether the optional action was carried out, not only chosen: a yes whose
    // instructions did nothing ("discard any number of cards" with none chosen, "sacrifice any number of creatures" with none) is not "you do"
    // (a part resolved by hand counts as done: the engine can't tell what the player did, design 10)
    if (did && (r.performed || r.byHand === true)) count++;
    // cloud std-spm (CR 119.3, 608.2c): the life the optional action made players lose, for "If you lost life this way, ..." after it (`{q:'lifeLost', who}`)
    if (did && r.lifeLostBy !== undefined) for (const [q, n] of r.lifeLostBy) (lostBy ??= new Map()).set(q, (lostBy.get(q) ?? 0) + n);
    if (did && r.countersRemoved !== undefined) for (const [k, n] of r.countersRemoved) (removed ??= new Map()).set(k, (removed.get(k) ?? 0) + n);
    if (did && r.countersPut !== undefined) for (const [k, n] of r.countersPut) (putIn ??= new Map()).set(k, (putIn.get(k) ?? 0) + n);
  }
  if (plural) restoreIterating(cx, before);
  if (count === 0) bindDeclined(cx, st);
  const rem = { ...(removed !== undefined ? { countersRemoved: removed } : {}), ...(putIn !== undefined ? { countersPut: putIn } : {}) };
  if (lostBy === undefined) return { performed: count > 0, count, ...rem };
  return { performed: count > 0, count, lifeLost: [...lostBy.values()].reduce((a, b) => a + b, 0), lifeLostBy: lostBy, ...rem };
};

/**
 * std-rq (CR 608.2d, 101.4): "any opponent may sacrifice a creature of their choice. If a player does, ...": the players of the group, one at a time in APNAP order,
 * choose whether to do it; the first who does it ends the choice (no one else is asked). A player who can't start it is skipped. Inside, that player is
 * `{ref:'iterating'}`. `performed` is whether someone did.
 */
function anyOneMay(cx: ExecCtx, st: Step<'may'>, players: readonly PlayerId[]): StepResult {
  const g = cx.g;
  const source = notesOf(cx).sourceName;
  const what = st.span ?? 'the optional part of the effect';
  const before = cx.iterating;
  let done = false;
  for (const p of players) {
    if (cannotStart(cx, st.do, p, true)) {
      g.log(`${g.player(p).name} can't do it, so doesn't: ${what} (${source}).`, { rules: ['CR 608.2d'], level: 'info' });
      continue;
    }
    const prompt = st.span ? `${source}: ${st.span} Do you?` : `${source}: do you do the optional part of the effect?`;
    const ans = g.choose({ kind: 'yesNo', player: p, prompt, yesLabel: 'Yes', noLabel: 'No', rules: ['CR 608.2d', 'CR 101.4'] }).yes;
    g.log(`${g.player(p).name} ${ans ? 'chooses to' : 'chooses not to'}: ${what} (${source}).`, { rules: ['CR 608.2d'], level: 'action' });
    if (!ans) continue;
    cx.iterating = p;
    const r = runSteps(cx, st.do);
    restoreIterating(cx, before);
    if (r.performed || r.byHand === true) { done = true; break; }
  }
  if (!done) bindDeclined(cx, st);
  return { performed: done, count: done ? 1 : 0 };
}

// ---- forEach ---------------------------------------------------------------------------------------------------------------------------------------------

type Item = { player: PlayerId } | { obj: ObjHandle };

const itemKey = (it: Item): string => ('player' in it ? `p:${it.player}` : `o:${it.obj.id}`);

/**
 * CR 608.2f: one at a time. APNAP order first (the players, and the objects by their controller); among the items of one player (the player and objects
 * they control, or several objects they control) the controller of the resolving spell or ability chooses the order. A card the controller may not see is
 * labelled "a card" (CR 400.2).
 */
function orderItems(cx: ExecCtx, objects: ObjHandle[], players: PlayerId[]): Item[] {
  const g = cx.g;
  const groups = new Map<PlayerId | null, Item[]>(g.apnap().map((p) => [p, []]));
  groups.set(null, []); // players who have left the game, objects whose controller can't be told
  const groupOf = (p: PlayerId | undefined): Item[] => groups.get(p !== undefined && groups.has(p) ? p : null)!;
  for (const p of players) groupOf(p).push({ player: p });
  for (const h of objects) groupOf(readInfo(cx, h)?.object.controller).push({ obj: h });
  const out: Item[] = [];
  for (const items of groups.values()) {
    if (items.length < 2) {
      out.push(...items);
      continue;
    }
    const ids = g.choose({
      kind: 'order', player: cx.controller, prompt: `${notesOf(cx).sourceName}: choose the order in which these are handled, one at a time.`,
      items: items.map((it) => ({ id: itemKey(it), label: 'player' in it ? g.player(it.player).name : shownTo(cx, it.obj.id, cx.controller) })), rules: ['CR 608.2f'],
    }).ids;
    for (const id of ids) out.push(items.find((it) => itemKey(it) === id)!);
  }
  return out;
}

/** CR 608.2f: "for each [object or player], [do]", one at a time; inside, `as` and `{ref:'iterating'}` stand for the current one. Counts the turns that did something. */
const forEachHandler: StepHandler<Step<'forEach'>> = (cx, st) => {
  const { objects, players } = resolveRecipients(cx, st.over);
  const items = orderItems(cx, objects, players);
  const before = cx.iterating;
  const bound = cx.bindings.get(st.as);
  let count = 0;
  const gathered: ObjHandle[] = []; // std-rx32: what the body bound under `gather`, every iteration
  for (const it of items) {
    spend(cx, 1); // design 8.8 rule 6: every iteration costs, even with an empty body
    cx.iterating = 'player' in it ? it.player : it.obj;
    cx.bindings.set(st.as, 'player' in it ? { objects: [], players: [it.player], snapshots: {} } : bindingOf(cx, [it.obj]));
    if (st.gather !== undefined) cx.bindings.delete(st.gather);
    if (runSteps(cx, st.do).performed) count++;
    if (st.gather !== undefined) for (const h of cx.bindings.get(st.gather)?.objects ?? []) if (!gathered.some((x) => x.id === h.id)) gathered.push(h);
  }
  restoreIterating(cx, before);
  if (bound) cx.bindings.set(st.as, bound);
  else cx.bindings.delete(st.as);
  if (st.gather !== undefined) cx.bindings.set(st.gather, bindingOf(cx, gathered)); // std-rx32 (CR 608.2f, 608.2c)
  return { performed: count > 0, count };
};

// ---- repeat, let, manual ---------------------------------------------------------------------------------------------------------------------------------

/**
 * std-cardcopy-1 (m6 design 7, `OP_FORMS`): the value forms of the control ops these handlers run, as the walker writes them (model/cap-walk.ts): "repeat this
 * process" with no count (`again`).
 */
export const OP_FORMS: readonly string[] = ['op:repeat.again'];

/** std-cardcopy-1: set by the empty `again` repeat inside the body of a running `again` repeat ("... and repeat this process"), read by that repeat. */
const againAsked = new WeakSet<object>();

/** "Repeat this process N times": N is read once, when the step starts (CR 608.2h); one that fails to determine does nothing (CR 608.2b). */
const repeatHandler: StepHandler<Step<'repeat'>> = (cx, st) => {
  // std-cardcopy-1 (CR 608.2c): "If C, draw a card and repeat this process.": the empty marker inside the copy of the effect asks for one more run of it; the
  // repeat that holds the copy runs it again for as long as an iteration reaches the marker (each run costs, design 8.8 rule 6: a loop that never ends meets the
  // "budget" prompt). An empty marker outside such a repeat does nothing (model/lint-flow.ts refuses it).
  if (st.again === true) {
    if (st.do.length === 0) {
      againAsked.add(cx);
      return { performed: true, count: 0 };
    }
    let performed = false;
    let count = 0;
    for (;;) {
      spend(cx, 1);
      againAsked.delete(cx);
      const r = runSteps(cx, st.do);
      performed ||= r.performed;
      count += r.count;
      if (!againAsked.has(cx)) break;
    }
    againAsked.delete(cx);
    return { performed, count };
  }
  const n = evalQty(cx, st.times);
  if (n === undefined) return NOTHING;
  let performed = false;
  let count = 0;
  for (let i = 0; i < Math.floor(n); i++) {
    spend(cx, 1); // design 8.8 rule 6: a huge count with an empty body ends in the "budget" prompt instead of hanging every re-execution
    const r = runSteps(cx, st.do);
    performed ||= r.performed;
    count += r.count;
  }
  return { performed, count };
};

/** CR 608.2h, 611.2d: fix a value once. A value that fails to determine is stored as NaN, which `{q:'var'}` reads as undetermined (effects/eval.ts). */
const letHandler: StepHandler<Step<'let'>> = (cx, st) => {
  const v = evalQty(cx, st.value);
  cx.vars.set(st.name, v ?? Number.NaN);
  return { performed: v !== undefined, count: 0 };
};

/** A sentence the compiler could not understand (or a node degraded to manual): its players resolve it by hand (design 8.9). */
const manualHandler: StepHandler<Step<'manual'>> = (cx, st) => askManual(cx, st.text, st.reason, st.reminder);

export const CONTROL_HANDLERS: OpHandlers = {
  if: ifHandler,
  may: mayHandler,
  pay: payHandler,
  forEach: forEachHandler,
  repeat: repeatHandler,
  let: letHandler,
  chooseObjects: chooseObjectsHandler,
  chooseValue: chooseValueHandler,
  manual: manualHandler,
};
