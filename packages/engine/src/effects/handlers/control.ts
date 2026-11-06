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
import type { ObjHandle, ZoneKind } from '../../types/state';
import { findObjects } from '../../rules/filter';
import { auraCanEnchantPlayer, enchantRestriction } from '../../rules/attachment';
import { charsOfObject } from '../../rules/characteristics';
import { cantHappen, villainousChoiceTimes } from '../../statics/hooks';
import type { ExecCtx, OpHandlers, StepHandler, StepResult } from '../api';
import { evalCond, evalQty } from '../eval';
import { currentObjs, filterCtxOf, linkValue, readInfo, resolveObjs, resolvePlayers, resolveRecipients } from '../refs';
import { seatNeighbor } from '../../statics/seats';
import { askManual, notesOf, shownTo } from '../manual';
import { runSteps, spend } from '../run';
import { bindingOf, chooseObjectsHandler, chooseValueHandler } from './choose';
import { payHandler } from './pay';
import { bindUnrun } from './unrun';
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
const ifHandler: StepHandler<Step<'if'>> = (cx, st) => {
  if (evalCond(cx, st.cond)) return runSteps(cx, st.then);
  // edh-zones-22 (CR 608.2c; Birthing Ritual): "If you do, you may put a creature card ... from among those cards onto the battlefield. Put the rest on the bottom ...": a branch not taken has its
  // own options (a `may` of one player) bind nothing, as a declined option does (declinedNames), so the instruction after the `if` that excludes "the chosen cards" excludes none
  // edh-next-138 (CR 608.2c; Baral and Kari Zev, "If you don't, create First Mate Ragavan ... It gains haste until end of turn."): "If you don't" too: the branch not taken made nothing, so what it would have named is nothing
  if (st.else === undefined) bindUnrun(cx, st.then, st.cond.cond === 'did'); // ("If you do" / "If you don't"; any other condition keeps FAST5 T78's reading, model/lint-flow.ts)
  return runSteps(cx, st.else ?? []);
};

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
/**
 * edh-d-97 (CR 406.2, 608.2d; Herigast, Erupting Nullkite ruling 2024-06-07: "You may choose to exile your hand even if you have no cards in hand. If you do, you'll still draw three
 * cards"): the one instruction "exile your hand" (every card of the controller's own hand): it can always be chosen and is done once chosen, an empty hand included.
 */
const WHOLE_HAND_EXILE = '{"op":"move","what":{"ref":"each","filter":{"zone":"hand","owner":"you","isCard":true}},"to":{"zone":"exile"}}';
const isWholeHandExile = (steps: readonly EffectStep[] | undefined): boolean => steps !== undefined && steps.length === 1 && JSON.stringify(steps[0]) === WHOLE_HAND_EXILE;

function cannotStart(cx: ExecCtx, steps: EffectStep[], player: PlayerId, plural: boolean): boolean {
  const first = steps[0];
  if (!first) return false;
  if (!plural && isWholeHandExile(steps)) return false; // edh-d-97: an empty hand can be exiled (above)
  if (evidenceImpossible(cx, steps, player, plural)) return true;
  switch (first.op) {
    case 'move': case 'destroy': case 'sacrifice': case 'attach': case 'phaseOut': case 'changeFace': case 'removeFromCombat':
      // FAST5 T65 (CR 608.2d, 701.24a): "you may shuffle your hand and graveyard into your library, then draw N cards": the cards of whole zones moved first, and the
      // library shuffled after them, which can always be done (an empty hand and graveyard are shuffled in as nothing), so it is never impossible to choose
      if (first.op === 'move' && first.what.ref === 'each' && steps.some((x) => x.op === 'shuffle')) return false;
      // edh-c-89 (CR 608.2d, 404.1; Grip of Amnesia, Scryfall ruling 2004-10-04: "You can choose to exile all cards from your graveyard even if it has no cards in it"): the whole graveyard of
      // the player an object's controller is ("unless its controller exiles all cards from their graveyard") is never impossible to choose; only that shape, other graveyard moves are judged as before
      if (first.op === 'move' && first.what.ref === 'each' && 'filter' in first.what && first.what.filter.zone === 'graveyard' && (first.what.filter.owner as { ref?: string } | undefined)?.ref === 'controllerOf' && first.to.zone === 'exile'
        && Object.keys(first.what.filter).sort().join() === 'owner,zone') return false;
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
    // trek-15 (CR 608.2d, 121.3, 121.3a; Tell Me What You See): "target opponent may have you draw a card" can't be chosen when the drawing player can't draw under a rule ("can't
    // draw more than one card each turn" after one draw); an empty library is not that (the draw is made, CR 121.3), so only a restriction makes it impossible
    case 'draw': {
      const drawers = resolvePlayers(cx, first.who);
      return drawers.length > 0 && drawers.every((p) => cantHappen(cx.g.s, { action: 'draw', subject: p }) !== null);
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
      // edhn63 (Overseer of Vault 76 ruling 2024-03-08): "you may remove three quest counters from among permanents you control" needs three in all, from any of them; "up to" is always possible
      if (first.among === true) {
        if (first.upTo === true) return false;
        const total = currentObjs(cx, r.objects).reduce((acc, h) => { const c = cx.g.s.objects[h.id]!.counters; return acc + (first.kind === 'any' ? Object.values(c).reduce((a, b) => a + b, 0) : c[first.kind] ?? 0); }, 0);
        return total < n;
      }
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

/**
 * edh-players-11 (CR 608.2c, 608.2d, 101.4): a `may` of a group of players (`each`, `voters`) with an `as` name binds the players who did it under that name, in the
 * order they were asked (APNAP), for "each player who drew a card this way" / "each opponent who does" / "If a player does, ... that player" after it. Nobody when
 * none did or the step did not run (effects/run.ts#recordSkipped). A single player's `may` binds nothing under its `as` (declinedNames binds the names inside).
 */
function bindDoers(cx: ExecCtx, st: Step<'may'>, doers: readonly PlayerId[]): void {
  if (st.as === undefined || (st.who.ref !== 'each' && st.who.ref !== 'voters')) return;
  cx.bindings.set(st.as, { objects: [], players: [...doers], snapshots: {} });
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
  if (players.length === 0) { bindDeclined(cx, st); bindDoers(cx, st, []); return NOTHING; }
  if (st.anyOne === true) return anyOneMay(cx, st, players);
  // M12 gaps: "[you and] each opponent who voted for ..." (`voters`) is a group like "each opponent", whoever it turns out to be
  const plural = st.who.ref === 'each' || st.who.ref === 'voters' || st.who.ref === 'otherOf' /* edh-players-12: "each of that player's opponents" */ || players.length > 1;
  const action = st.span ? undefined : optionalAction(cx, st);
  const what = st.span ?? action ?? 'the optional part of the effect';
  const yes = new Map<PlayerId, boolean>();
  for (const p of players) {
    // edh-players-11 (CR 608.2d, 101.4): what the option names with `{ref:'iterating'}` ("a creature they control") is judged for the player asked, as it is when the option runs
    const asking = cx.iterating;
    if (plural) cx.iterating = p;
    const impossible = st.villainous !== true && cannotStart(cx, st.do, p, plural);
    if (plural) restoreIterating(cx, asking);
    if (impossible) {
      g.log(`${g.player(p).name} can't do it, so doesn't: ${what} (${source}).`, { rules: ['CR 608.2d'], level: 'info' });
      yes.set(p, false);
      continue;
    }
    if (st.villainous === true) continue; // asked just before its options are carried out, one player at a time (below)
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
  const gathered: ObjHandle[] = []; // edh-top-5 (CR 608.2c): what the run of each player bound under `gather`, together
  const doers: PlayerId[] = []; // edh-players-11 (CR 608.2c): the players of a group who did it, bound under the step's `as` (bindDoers)
  let searched: { owner: PlayerId; zone: ZoneKind }[] | undefined; // edh-zones-8 (CR 701.23a, 608.2c): the zones every player who did it searched ("each player who searched a library this way shuffles")
  // edh-next-135 (CR 701.55c; The Valeyard): a player who faces a villainous choice an additional time faces the whole choice again, one time after the other
  const turns = st.villainous === true ? players.flatMap((p) => Array<PlayerId>(villainousChoiceTimes(g.s, p)).fill(p)) : players;
  for (const p of turns) {
    if (plural) cx.iterating = p;
    // pc-keywords-mana-3 (CR 701.55, ruling: the first player in turn order chooses and their option is carried out before the next player chooses; cite unverified): a
    // villainous choice is a choice between two options, "Yes" the first, "No" the second; an option that can't be carried out may still be chosen
    if (st.villainous === true) {
      const text = st.span ?? notesOf(cx).text;
      const pick = g.choose({ kind: 'yesNo', player: p, prompt: `${source}: ${g.player(p).name} faces a villainous choice. ${text} First option: Yes. Second option: No.`, yesLabel: 'First option', noLabel: 'Second option', rules: ['CR 701.55'] }).yes;
      g.log(`${g.player(p).name} faces a villainous choice and chooses the ${pick ? 'first' : 'second'} option (${source}).`, { rules: ['CR 701.55'], level: 'action' });
      yes.set(p, pick);
    }
    const did = yes.get(p) === true;
    // std-rq (CR 608.2d, 122.6): the optional instructions of one other player are that player's ("that player may put a +1/+1 counter on ~": they put it)
    const performer = cx.performer;
    // edh-players-11 (CR 122.6, ruling of Orzhov Advokist 2020-11-10): and so for each player of a group, who puts the counters they chose ("each player may put two +1/+1 counters on a creature they control")
    if (did && p !== cx.controller && st.villainous !== true) cx.performer = p;
    if (st.gather !== undefined) cx.bindings.delete(st.gather); // edh-top-5: what this player's run binds under `gather` is added below
    const r = runSteps(cx, (did ? st.do : st.otherwise) ?? []);
    if (st.gather !== undefined) for (const h of cx.bindings.get(st.gather)?.objects ?? []) if (!gathered.some((x) => x.id === h.id)) gathered.push(h);
    if (performer === undefined) delete cx.performer;
    else cx.performer = performer;
    // Merge wave 8 (audit D2, CR 603.12, 608.2c): "if you do" / "when you do" ask whether the optional action was carried out, not only chosen: a yes whose
    // instructions did nothing ("discard any number of cards" with none chosen, "sacrifice any number of creatures" with none) is not "you do"
    // (a part resolved by hand counts as done: the engine can't tell what the player did, design 10)
    // edh-players-7 (ruling of Sylvan Library 2022-12-08: "If you choose to draw two cards, then replace one or more of those draws with some other effect, the rest of Sylvan Library's
    // ability still happens"): a "may" whose instructions are only draws is done once the player chose it, whatever replaced the draws
    const onlyDraws = (st.do ?? []).length > 0 && (st.do ?? []).every((x) => x.op === 'draw');
    // edh-d-97 (Herigast ruling 2024-06-07): "you may exile your hand" is done once chosen, an empty hand included (isWholeHandExile)
    const wholeHand = !plural && isWholeHandExile(st.do);
    // trek-16 (CR 608.2d, 601.2c; Cmdr. Troi): "may cast a spell ... If they do": an option that ends with a named cast is done only if a spell was cast, not by the choice of a card that could not be cast
    const lastStep = (st.do ?? [])[(st.do ?? []).length - 1];
    const castUndone = lastStep?.op === 'cast' && lastStep.as !== undefined && cx.results.get(lastStep.as)?.performed !== true;
    if (did && !castUndone && (r.performed || r.byHand === true || onlyDraws || wholeHand)) count++;
    // edh-players-11 (CR 608.2c, ruling of Kwain 2020: "who drew a card this way"): the players who DID it are those whose draw happened; a draw a replacement effect took over, or
    // an empty library, is no draw, however the player chose (the Sylvan Library rule above is for "if you do", not for a card drawn)
    if (did && !castUndone && (r.performed || r.byHand === true) && !doers.includes(p)) doers.push(p);
    // cloud std-spm (CR 119.3, 608.2c): the life the optional action made players lose, for "If you lost life this way, ..." after it (`{q:'lifeLost', who}`)
    if (did && r.lifeLostBy !== undefined) for (const [q, n] of r.lifeLostBy) (lostBy ??= new Map()).set(q, (lostBy.get(q) ?? 0) + n);
    if (did && r.countersRemoved !== undefined) for (const [k, n] of r.countersRemoved) (removed ??= new Map()).set(k, (removed.get(k) ?? 0) + n);
    if (did && r.countersPut !== undefined) for (const [k, n] of r.countersPut) (putIn ??= new Map()).set(k, (putIn.get(k) ?? 0) + n);
    if (did && r.searched !== undefined) (searched ??= []).push(...r.searched);
  }
  if (plural) restoreIterating(cx, before);
  if (st.gather !== undefined) cx.bindings.set(st.gather, bindingOf(cx, gathered)); // edh-top-5: the group, empty when nobody put any
  if (count === 0) bindDeclined(cx, st);
  bindDoers(cx, st, doers);
  const rem = { ...(searched !== undefined ? { searched } : {}), ...(removed !== undefined ? { countersRemoved: removed } : {}), ...(putIn !== undefined ? { countersPut: putIn } : {}) };
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
  let doer: PlayerId | undefined;
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
    // edh-c-29 (CR 608.2d, 120.3; ruling of Vexing Devil 2012-05-01, Browbeat, Book Burning): choosing to be dealt the damage is what counts, even when the damage is prevented or
    // redirected: the choice ends there and "if no one does" does not happen
    const damageOnly = st.do.length > 0 && st.do.every((x) => x.op === 'damage');
    if (r.performed || r.byHand === true || damageOnly) { done = true; doer = p; break; }
  }
  if (!done) bindDeclined(cx, st);
  bindDoers(cx, st, done && doer !== undefined ? [doer] : []); // edh-d-97 (CR 608.2c; Sin Prodder): "that player", the one who did it (lower/mentions.ts#anyOneDidOf)
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
    // edh-players-17 (CR 608.2f, 701.38d): the same player several times (one iteration per vote of a voter with additional votes) has no order to choose
    if (items.length < 2 || items.every((it) => itemKey(it) === itemKey(items[0]!))) {
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

/**
 * edhd63 (CR 101.4, 608.2c; Order of Succession): the players of a group in the order "starting with you and proceeding in the chosen direction": the controller first, then the next
 * player on the chosen side (still in the game) until the group's players are all taken. No chosen side: nobody.
 */
function inDirectionItems(cx: ExecCtx, link: string, players: readonly PlayerId[]): { player: PlayerId }[] {
  const side = linkValue(cx, link)?.values?.[0];
  if (side !== 'left' && side !== 'right') return [];
  const out: PlayerId[] = [];
  for (let p: PlayerId | undefined = cx.controller; p !== undefined && !out.includes(p) && out.length < cx.g.s.players.length; p = seatNeighbor(cx.g.s, p, side)) if (players.includes(p)) out.push(p);
  return out.map((player) => ({ player }));
}

/** CR 608.2f: "for each [object or player], [do]", one at a time; inside, `as` and `{ref:'iterating'}` stand for the current one. Counts the turns that did something. */
const forEachHandler: StepHandler<Step<'forEach'>> = (cx, st) => {
  const { objects, players } = resolveRecipients(cx, st.over);
  const items = st.inDirection === undefined ? orderItems(cx, objects, players) : inDirectionItems(cx, st.inDirection, players);
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
export const OP_FORMS: readonly string[] = ['op:repeat.again', 'op:repeat.optional', 'op:repeat.until', 'op:forEach.inDirection' /* edhd63: CR 101.4, */, 'op:look.rebind' /* edh-next-126 (CR 608.2c): effects/handlers/cards-reveal.ts#lookHandler binds `as` again */, 'op:reveal.anyNumber' /* edh-next-135 (CR 603.12): effects/handlers/cards-reveal.ts#revealHandler */];

/** edh-d-101: the `as` names of the steps of a list, nested ones included (a repeat's own copy of the process holds no other loop). */
function namedSteps(list: readonly EffectStep[]): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const r = v as Record<string, unknown>;
    if (typeof r['op'] === 'string' && typeof r['as'] === 'string' && !out.includes(r['as'])) out.push(r['as']);
    for (const k of ['do', 'then', 'else', 'otherwise']) if (k in r) walk(r[k]);
  };
  walk(list);
  return out;
}

/** edh-d-101 (CR 608.2c): the results of one named step over several runs of a process, as one: done if any run did it, the counts added, the objects each run reports together. */
function mergedResult(rs: readonly StepResult[]): StepResult {
  const last = rs[rs.length - 1]!;
  const all = <K extends 'before' | 'attempted'>(k: K): StepResult[K] => (rs.some((r) => r[k] !== undefined) ? rs.flatMap((r) => r[k] ?? []) as StepResult[K] : undefined);
  const before = all('before');
  const attempted = all('attempted');
  const { before: _b, attempted: _a, beforeTo: _t, kept: _k, ...rest } = last;
  return { ...rest, performed: rs.some((r) => r.performed), count: rs.reduce((n, r) => n + r.count, 0), ...(before !== undefined ? { before } : {}), ...(attempted !== undefined ? { attempted } : {}) };
}

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
    // edh-d-101 (CR 608.2c; Demonlord Belzenlok): an instruction after the process that counts what a step of it did "this way" ("for each card put into your hand this way") counts
    // every run: the first one (the effect's own steps, already done) and each repeat. The results of the named steps of the process are gathered, and stand together once the loop is
    // over (inside a run each step's result is that run's own, as the condition of the repeat reads it)
    const names = namedSteps(st.do);
    const runs = new Map<string, StepResult[]>();
    const keep = (): void => { for (const n of names) { const r = cx.results.get(n); if (r !== undefined) runs.set(n, [...(runs.get(n) ?? []), r]); } };
    keep();
    for (;;) {
      spend(cx, 1);
      againAsked.delete(cx);
      for (const n of names) cx.results.delete(n); // a step this run does not reach did nothing in it
      const r = runSteps(cx, st.do);
      keep();
      performed ||= r.performed;
      count += r.count;
      if (!againAsked.has(cx)) break;
    }
    againAsked.delete(cx);
    for (const [n, rs] of runs) cx.results.set(n, mergedResult(rs));
    return { performed, count };
  }
  // edh-zones-10 (CR 608.2c; Tainted Pact): "Repeat this process until C": the process is done, then again while C is false after a run. The cards a run took (`gather.of`) join the
  // group `gather.as` after it: the group is empty at the first run, holds the earlier runs' cards inside a run and all of them when C is read. A run that took no card
  // (nothing left to take) is the last. Each run costs, as above.
  if (st.until !== undefined) {
    const group: ObjHandle[] = [];
    let performed = false;
    let count = 0;
    for (;;) {
      spend(cx, 1);
      if (st.gather !== undefined) {
        cx.bindings.set(st.gather.as, bindingOf(cx, group));
        if (st.gather.of !== undefined) cx.bindings.delete(st.gather.of);
      }
      const r = runSteps(cx, st.do);
      performed ||= r.performed;
      count += r.count;
      let took = true;
      if (st.gather !== undefined) {
        const before = group.length;
        if (st.gather.of !== undefined) for (const h of cx.bindings.get(st.gather.of)?.objects ?? []) if (!group.some((x) => x.id === h.id)) group.push(h);
        cx.bindings.set(st.gather.as, bindingOf(cx, group));
        took = group.length > before;
      }
      if (!took || evalCond(cx, st.until)) break;
    }
    return { performed, count };
  }
  // edh-zones-5 (CR 608.2c, 608.2d): "You may repeat this process any number of times.": the controller decides after each run, seeing what the last one did, and the
  // loop ends at the first "no" (each run costs, as above)
  if (st.optional === true) {
    let performed = false;
    let count = 0;
    // edh-zones-26 (CR 608.2c; Dance with Calamity): the cards each run bound (`gather.of`) join the group `gather.as`, bound from the start (empty when the player never repeats)
    const group: ObjHandle[] = [];
    if (st.gather !== undefined) cx.bindings.set(st.gather.as, bindingOf(cx, group));
    for (;;) {
      const ans = cx.g.choose({ kind: 'yesNo', player: cx.controller, prompt: `${notesOf(cx).sourceName}: repeat this process?`, yesLabel: 'Repeat', noLabel: 'Stop', rules: ['CR 608.2d'] }).yes;
      cx.g.log(`${cx.g.player(cx.controller).name} ${ans ? 'repeats' : 'does not repeat'} the process (${notesOf(cx).sourceName}).`, { rules: ['CR 608.2c'], level: 'action' });
      if (!ans) break;
      spend(cx, 1);
      if (st.gather?.of !== undefined) cx.bindings.delete(st.gather.of);
      const r = runSteps(cx, st.do);
      performed ||= r.performed;
      count += r.count;
      if (st.gather !== undefined) {
        if (st.gather.of !== undefined) for (const h of cx.bindings.get(st.gather.of)?.objects ?? []) if (!group.some((x) => x.id === h.id)) group.push(h);
        cx.bindings.set(st.gather.as, bindingOf(cx, group));
      }
    }
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

/**
 * edh-next-135 (CR 101.4, 608.2c, 303.4f; Thieves' Auction, rulings 2004-10-04 and 2005-08-01): "Starting with you, each player chooses one of the exiled cards and puts it onto the battlefield
 * tapped under their control. Repeat this process until all cards exiled this way have been chosen." The players in turn order from `startingWith` (players who left are skipped, CR 800.4a),
 * round after round, each choose one card of `cards` still in exile (the same object, CR 400.7) and put it onto the battlefield under their own control (one move each, so an Aura is attached
 * as it enters, CR 303.4f, not targeting). A card the move could not put there (an Aura with nothing it can enchant) stays exiled, is not offered again until another card was put, and the
 * player picks again (a card that can't be put can't be picked, ruling 2004-10-04); once no card left can be put (a whole round without one), the rest stay exiled. The count is the number of cards put onto the battlefield.
 */
const auctionHandler: StepHandler<Step<'auction'>> = (cx, st) => {
  const g = cx.g;
  const [start] = resolvePlayers(cx, st.startingWith);
  let pool = currentObjs(cx, resolveObjs(cx, st.cards)).filter((h) => g.s.objects[h.id]?.zone === 'exile');
  if (start === undefined || pool.length === 0) return NOTHING;
  const seats = g.s.players.map((p) => p.id);
  const at = Math.max(0, seats.indexOf(start));
  const order = [...seats.slice(at), ...seats.slice(0, at)];
  const source = notesOf(cx).sourceName;
  let stuck = new Set<string>(); // cards that could not be put onto the battlefield since the last card that was
  let put = 0;
  for (let round = 0; round < 1000; round++) {
    let progress = false;
    for (const p of order) {
      if (g.s.players.find((x) => x.id === p)?.hasLost !== false) continue;
      // ruling 2004-10-04: a card that can't be put onto the battlefield can't be picked: a pick that could not be put stays exiled and the player picks again
      for (;;) {
        pool = pool.filter((h) => g.s.objects[h.id]?.zone === 'exile');
        const ids = pool.filter((h) => !stuck.has(h.id)).map((h) => h.id);
        if (ids.length === 0) break;
        const pick = ids.length === 1 ? ids[0]! : (g.choose({ kind: 'chooseObjects', player: p, prompt: `${source}: choose one of the exiled cards to put onto the battlefield${st.tapped === true ? ' tapped' : ''} under your control.`, options: ids, min: 1, max: 1, rules: ['CR 608.2d', 'CR 101.4'] }).ids[0] ?? ids[0]!);
        // review (CR 303.4f; ruling 2005-08-01): an Aura that enchants a player (a Curse) is put attached to a player the picker chooses among those it can enchant; with none, it can't be put
        const o = g.s.objects[pick];
        const kw = o === undefined ? undefined : enchantRestriction(charsOfObject(g.s, o));
        let enchanted: PlayerId | undefined;
        if (o !== undefined && kw?.player !== undefined) {
          const entering = { ...o, controller: p };
          const hosts = g.s.players.map((x) => x.id).filter((q) => auraCanEnchantPlayer(g.s, entering, kw, q));
          enchanted = hosts.length <= 1 ? hosts[0] : g.choose({ kind: 'chooseOption', player: p, prompt: `Choose the player ${g.nameOf(pick)} enchants as it enters the battlefield.`, min: 1, max: 1, options: hosts.map((q) => ({ id: q, label: g.player(q).name })), rules: ['CR 303.4f'] }).ids[0] as PlayerId | undefined;
          if (enchanted === undefined) {
            stuck.add(pick);
            g.log(`${g.nameOf(pick)} can't be put onto the battlefield now; it stays exiled (${source}).`, { rules: ['CR 303.4f', 'CR 608.2c'], level: 'info' });
            continue;
          }
        }
        const before = cx.iterating;
        cx.iterating = p;
        const r = runSteps(cx, [{ op: 'move', what: { ref: 'fixed', objects: [{ id: pick, zone: 'exile' }] }, to: { zone: 'battlefield', controller: { ref: 'iterating' }, ...(st.tapped === true ? { tapped: true } : {}), ...(enchanted !== undefined ? { attachedToPlayer: { ref: 'fixed', players: [enchanted] } } : {}) } }]);
        restoreIterating(cx, before);
        if (r.performed && g.s.objects[pick]?.zone !== 'exile') {
          put++;
          progress = true;
          stuck = new Set();
          pool = pool.filter((h) => h.id !== pick);
          break;
        }
        stuck.add(pick);
        g.log(`${g.nameOf(pick)} can't be put onto the battlefield now; it stays exiled (${source}).`, { rules: ['CR 303.4f', 'CR 608.2c'], level: 'info' });
      }
    }
    pool = pool.filter((h) => g.s.objects[h.id]?.zone === 'exile');
    if (pool.length === 0 || (!progress && pool.every((h) => stuck.has(h.id)))) break;
  }
  return put > 0 ? { performed: true, count: put } : NOTHING;
};

export const CONTROL_HANDLERS: OpHandlers = {
  if: ifHandler,
  auction: auctionHandler, // edh-next-135 (CR 101.4, 608.2c): Thieves' Auction
  may: mayHandler,
  pay: payHandler,
  forEach: forEachHandler,
  repeat: repeatHandler,
  let: letHandler,
  chooseObjects: chooseObjectsHandler,
  chooseValue: chooseValueHandler,
  manual: manualHandler,
};
