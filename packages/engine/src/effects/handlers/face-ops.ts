/**
 * Face-down operations (CR 701.40, 701.58, 701.62, 702.37, 702.168, 708; m6 design 3.4). Owner: M6-3.
 *
 *   FACE_OPS            the `changeFace` forms faceUp (CR 708.7: an effect turns a face-down permanent face up, through the `turnFaceUp` proposal), faceDown (CR
 *                       708.2a: a face-up permanent becomes a face-down 2/2; CR 708.2b a face-down one and CR 712.16 a double-faced one stay as they are) and
 *                       manifest of a permanent (CR 701.40a: it is turned face down as a manifested permanent).
 *   FACE_NATIVES        the keyword actions manifest (CR 701.40a, 701.40e: one card at a time), cloak (CR 701.58a: with ward {2}) and manifest dread (CR
 *                       701.62a: look at the top two cards, manifest one, the rest into the graveyard), run by the `action` op (actions-native.ts#NATIVE_ACTIONS).
 *                       Each card is put onto the battlefield face down through the proposal pipeline (a zone change with `faceDown` and its status), so a
 *                       rule or effect that keeps it from entering leaves it where it was, face up if it was (CR 701.40f, 701.58f).
 *   the performer of `turnFaceUp` (installed into effects/proposal-kinds/turn-face-up.ts): CR 701.40g / 701.58g first (a manifested or cloaked instant or
 *                       sorcery card is revealed and stays face down), then the permanent is turned face up (CR 708.8, 613.7f), then the steps of the `during`
 *                       bodies (CR 708.11) and megamorph's +1/+1 counter (CR 702.37b) happen as part of the same event, before any trigger or state-based action
 *                       can look (they are checked only after the event).
 *   the special action  (installed into core/special/turn-face-up.ts, which can't import the payer or the pipeline): X (CR 702.37f, 107.3a), the payment
 *                       (cancellable decisions, CR 733.1) and the `turnFaceUp` proposal.
 *
 * Hidden information (CR 708.5, 400.2): a manifested card is named only to the player who manifests it (its controller); the log lines say "a card".
 */
import type { Game } from '../../core/game';
import { installTurnFaceUp, type FaceUpProcedure } from '../../core/special/turn-face-up';
import { realName } from '../../core/move-parts/face-down';
import type { CostDef, EffectStep, FaceDownProfile, ObjRef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { FaceDownInfo, ObjHandle } from '../../types/state';
import { faceChars } from '../../rules/characteristics';
import { randomIndex } from '../../core/manual';
import { costFilterHasX, costHasX, payableXs, planDenial, planFromCostDef, type CostPlan } from '../../rules/cost';
import { resolveAnyCounts } from '../../rules/pay';
import { IllegalAction } from '../../core/game';
import type { ExecCtx, Proposed, StepHandler } from '../api';
import { askManual } from '../manual';
import { performAction, performEffectPayment, type Performed } from '../perform';
import { performExiledSeers, performTurnFaceDown, performTurnFaceUp } from '../perform-direct';
import { installTurnFaceUpPerformer } from '../proposal-kinds/turn-face-up';
import { propose, proposeResult } from '../propose';
import { contextFor } from '../replace-ctx';
import { ruleDenial } from '../../statics/hooks';
import { resolvePlayers } from '../refs';
import { runSteps, spend } from '../run';
import type { ChangeFaceOp, ChangeFaceTable } from './change-face';
import { lookHandler } from './cards-reveal';
import { modifiedByManualText } from './manual-text';
import { actOn, bindAs, did, firstPlayer, NOTHING, proposeMove, wholeNumber } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;
type TurnFaceUp = Extract<Proposed, { ev: 'turnFaceUp' }>;

// ---- turning face up (CR 708.7-708.8, 708.11, 702.37b, 701.40g) -----------------------------------------------------------------------------------------

/** CR 701.40g, 701.58g: a manifested or cloaked permanent represented by an instant or sorcery card can't be turned face up. */
function instantOrSorceryCard(g: Game, id: ObjectId): boolean {
  const o = g.s.objects[id];
  const def = o && g.s.defs[o.defId];
  if (!o || !def || o.kind !== 'card' || (o.faceDownInfo?.by !== 'manifest' && o.faceDownInfo?.by !== 'cloak')) return false;
  const card = faceChars(def, 0);
  return card.types.includes('Instant') || card.types.includes('Sorcery');
}

/** The performer of a `turnFaceUp` proposal (effects/proposal-kinds/turn-face-up.ts). Null when nothing happened. */
function performTurnFaceUpEvent(g: Game, e: TurnFaceUp): Performed | null {
  const id = e.object.id;
  const o = g.s.objects[id];
  if (!o || o.zone !== 'battlefield' || o.zone !== e.object.zone || !o.faceDown) return null;
  if (instantOrSorceryCard(g, id)) {
    // CR 701.40g, 701.58g: revealed, left face down; "whenever a permanent is turned face up" does not trigger (nothing happened)
    g.log(`A face-down permanent would be turned face up, but it is ${realName(g, o)}, an instant or sorcery card: it is revealed and stays face down.`, { rules: ['CR 701.40g', 'CR 701.58g'], level: 'info' });
    return null;
  }
  if (!performTurnFaceUp(g, id, { ...(e.x !== undefined ? { x: e.x } : {}), ...(e.by !== undefined ? { by: e.by } : {}) })) return null; // CR 708.8, 613.7f, 712.15a; `by` (CR 701.40b, 608.2)
  // CR 708.11: "As this permanent is turned face up, ..." happens while it is being turned face up (before any trigger or state-based action looks)
  for (const d of e.during ?? []) {
    const src = g.s.objects[d.source.id] ?? g.s.lki[d.source.id]?.object;
    if (!src) continue;
    runSteps(contextFor(g, src, d.controller), d.steps);
  }
  // CR 702.37b: "As this permanent is turned face up, put a +1/+1 counter on it if its megamorph cost was paid to turn it face up."
  if (e.megamorphPaid === true && g.s.objects[id]?.zone === 'battlefield') {
    propose(g, { ev: 'counters', change: 'put', on: { id, zone: 'battlefield' }, kind: '+1/+1', count: 1, cause: 'replacement' });
  }
  return { event: e, newIds: [id], amount: 1 };
}
installTurnFaceUpPerformer(performTurnFaceUpEvent);

/** "Turn ~ face up" by an effect (CR 708.7; not the special action: no cost, `via: 'effect'`). */
const faceUp: ChangeFaceOp = (cx, _st, id) => {
  const g = cx.g;
  const o = g.s.objects[id];
  if (!o || !o.faceDown) return false; // a face-up permanent can't be turned face up
  const before = realName(g, o);
  const r = proposeResult(g, { ev: 'turnFaceUp', object: { id, zone: 'battlefield' }, via: 'effect', by: cx.controller });
  // std-typechange-2 (CR 608.2c): what happened is read from the permanent afterwards (the performer refuses a face-down instant or sorcery card, CR 701.40g, 701.58g,
  // and a "can't be turned face up" effect stops the proposal, CR 708.7): "If you can't" holds when it is still face down
  const turned = r !== null && r !== undefined && g.s.objects[id]?.faceDown !== true;
  if (turned) g.log(`A face-down permanent is turned face up: it is ${before}.`, { rules: ['CR 708.7', 'CR 708.8'], level: 'action' });
  return turned;
};

// ---- turning face down (CR 708.2a-b, 712.16) and manifesting a permanent (CR 701.40a) ---------------------------------------------------------------------

/** CR 712.16: double-faced permanents (and melded ones) can't be turned face down. */
function doubleFaced(g: Game, id: ObjectId): boolean {
  const o = g.s.objects[id]!;
  const def = g.s.defs[o.defId];
  return o.components !== undefined || (def !== undefined && def.faces.length > 1 && ['transform', 'modal_dfc', 'meld', 'double_faced_token', 'reversible_card'].includes(def.layout));
}

function turnDown(cx: ExecCtx, id: ObjectId, info: FaceDownInfo): void {
  const g = cx.g;
  const o = g.s.objects[id];
  if (!o) return;
  if (o.faceDown) {
    g.log(`${g.nameOf(id)} is already face down: nothing happens.`, { rules: ['CR 708.2b'], level: 'info' }); // CR 708.2b
    return;
  }
  if (doubleFaced(g, id)) {
    g.log(`${g.nameOf(id)} is double-faced and can't be turned face down: nothing happens.`, { rules: ['CR 712.16'], level: 'info' });
    return;
  }
  const name = g.nameOf(id);
  if (performTurnFaceDown(g, id, info)) g.log(`${name} is turned face down${info.by === 'manifest' ? ' (manifested)' : ''}.`, { rules: [info.by === 'manifest' ? 'CR 701.40a' : 'CR 708.2a', 'CR 613.7f'], level: 'action' });
}

const faceDown: ChangeFaceOp = (cx, _st, id) => turnDown(cx, id, { by: 'effect', profile: 'plain' });
const manifestPermanent: ChangeFaceOp = (cx, _st, id) => turnDown(cx, id, { by: 'manifest', profile: 'plain' });

export const FACE_OPS: ChangeFaceTable = { faceUp, faceDown, manifest: manifestPermanent };

// ---- manifest, cloak, manifest dread (CR 701.40, 701.58, 701.62) ------------------------------------------------------------------------------------------

/** Capability names (`feature:action.native.<name>`) of the native actions of this module. */
export const FACE_NATIVE_FEATURES: readonly string[] = [
  'action.native.manifest', 'action.native.cloak', 'action.native.manifestDread',
  // FAST5X E25 (model/cap-walk.ts#stepForms): "manifest dread X times" (CR 701.62a, `n`); "shuffle that pile, then cloak them" (CR 701.58e, `arg: 'shuffle'`)
  'action.manifestDread.n', 'action.cloak.shuffle',
];

const RULE: Record<'manifest' | 'cloak', string> = { manifest: 'CR 701.40a', cloak: 'CR 701.58a' };

/**
 * Put one card onto the battlefield face down under `player`'s control as a manifested (or cloaked) permanent (CR 701.40a, 701.58a). The card is named only to
 * `player` (who controls it and may look at it, CR 708.5). Null when it was not manifested (CR 701.40f: it stays where it was).
 */
export function manifestCard(cx: ExecCtx, player: PlayerId, h: ObjHandle, by: 'manifest' | 'cloak', profile: FaceDownProfile): ObjHandle | null {
  const g = cx.g;
  const card = g.s.objects[h.id];
  if (!card || card.kind !== 'card' || card.zone !== h.zone) return null;
  const known = realName(g, card);
  const m = proposeMove(cx, h, 'battlefield', { controller: player, faceDown: true, faceDownInfo: { by, profile }, cause: by });
  const who = g.player(player).name;
  const verb = by === 'manifest' ? 'manifests' : 'cloaks';
  if (!m.ok || !m.to || m.to.zone !== 'battlefield' || !g.s.objects[m.to.id]?.faceDown) {
    if (!m.ok) g.log(`${who} can't ${by} a card: it can't enter the battlefield and stays where it was.`, { rules: [by === 'manifest' ? 'CR 701.40f' : 'CR 701.58f'], level: 'info' });
    return null;
  }
  g.log(`${who} ${verb} a card.`, { rules: [RULE[by]], level: 'action', privateText: { players: [player], text: `${who} ${verb} ${known}.` } });
  return m.to;
}

const textOf = (st: ActionStep, fallback: string): string => st.span ?? fallback;

/**
 * Text the engine does not run that changes HOW cards are manifested or cloaked ("if you would manifest ..., ... instead", "as you manifest"): then the action is
 * resolved by hand (fail closed, like the other native actions). A text that merely mentions manifesting (a trigger that manifests, "manifested creatures get
 * +1/+1") does not change the action.
 */
const MODIFIES_MANIFEST = /would (manifest|cloak)|(manifest|cloak)(s|ing)?.{0,60}instead|as (you|a player) (manifest|cloak)/i;

/** How many (the step's `n`, 1 when absent); undefined when it can't be determined (CR 608.2b). */
const howMany = (cx: ExecCtx, st: ActionStep): number | undefined => (st.n === undefined ? 1 : wholeNumber(cx, st.n));

/** Manifest or cloak N cards from the top of `who`'s library, one at a time (CR 701.40e, 701.58e). */
function topCards(by: 'manifest' | 'cloak', profile: FaceDownProfile): StepHandler<ActionStep> {
  return (cx, st) => {
    const g = cx.g;
    const player = firstPlayer(cx, st.who);
    const n = howMany(cx, st);
    if (player === undefined || n === undefined) {
      bindAs(cx, st.as, []);
      return NOTHING;
    }
    const manual = modifiedByManualText(g, MODIFIES_MANIFEST);
    if (manual) return askManual(cx, textOf(st, by), `${by} is changed by text the engine does not run (${manual})`);
    const made: ObjHandle[] = [];
    if (st.arg !== undefined && st.subject === undefined) return askManual(cx, textOf(st, by), `the engine does not run "${st.arg}" for ${by}`);
    if (st.subject !== undefined) {
      // "Manifest that card" (CR 701.40a: a card in any zone): the cards the subject stands for, one at a time (CR 701.40e); a permanent is turned face down
      const subject = st.subject;
      if (typeof subject !== 'object' || !('ref' in subject)) return askManual(cx, textOf(st, by), `the engine can't tell which card to ${by}`);
      if (st.arg !== undefined && st.arg !== 'shuffle') return askManual(cx, textOf(st, by), `the engine does not run "${st.arg}" for ${by}`);
      const handles = actOn(cx, subject as ObjRef);
      // FAST5X E25 (CR 406.3, 701.58e): "exile them in a face-down pile, shuffle that pile, then cloak them": the cards are cloaked one at a time in the pile's
      // random order, so nobody can tell which face-down permanent which card became (the shuffle is part of the instruction, CR 701.24a)
      if (st.arg === 'shuffle') {
        for (let i = handles.length - 1; i > 0; i--) { const j = randomIndex(g, i + 1); [handles[i], handles[j]] = [handles[j]!, handles[i]!]; } // the game's RNG (design 8.8)
        // CR 406.3: once part of a pile of cards that are shuffled, a card exiled face down can no longer be looked at by anyone
        performExiledSeers(g, handles.map((h) => h.id), []);
      }
      for (const h of handles) {
        spend(cx, 1);
        if (h.zone === 'battlefield') {
          turnDown(cx, h.id, { by, profile });
          if (g.s.objects[h.id]?.faceDown) made.push(h);
          continue;
        }
        const m = manifestCard(cx, player, h, by, profile);
        if (m) made.push(m);
      }
      bindAs(cx, st.as, made);
      return did(made.length);
    }
    for (let i = 0; i < n; i++) {
      const top = g.s.zones.library[player]?.[0];
      if (top === undefined) break;
      spend(cx, 1);
      const h = manifestCard(cx, player, { id: top, zone: 'library' }, by, profile);
      if (h) made.push(h);
    }
    bindAs(cx, st.as, made);
    return did(made.length);
  };
}

/**
 * CR 701.62a: look at the top two cards of your library, manifest one of them, put the others you looked at into your graveyard. Returns the manifested
 * permanent (null when none). CR 701.62b: the `manifestDread` action is reported after the whole process, even if some or all of it was impossible, with the
 * card put into the graveyard this way as its object (FAST5X E25: what "whenever you manifest dread, put a card you put into your graveyard this way into your
 * hand" reads).
 */
function dreadOnce(cx: ExecCtx, player: PlayerId): ObjHandle | null {
  const g = cx.g;
  const tops = (g.s.zones.library[player] ?? []).slice(0, 2).map((id) => ({ id, zone: 'library' as const }));
  let made: ObjHandle | null = null;
  let binned: ObjectId | undefined;
  if (tops.length > 0) {
    lookHandler(cx, { op: 'look', who: { ref: 'fixed', players: [player] }, at: { ref: 'fixed', objects: tops } }); // the player looks at them (CR 701.20e)
    let pick = tops[0]!;
    if (tops.length > 1) {
      const ans = g.choose({ kind: 'chooseObjects', player, prompt: 'Manifest dread: choose the card to manifest (the other one goes into your graveyard).', options: tops.map((h) => h.id), min: 1, max: 1, rules: ['CR 701.62a'] });
      pick = tops.find((h) => h.id === ans.ids[0]) ?? pick;
    }
    made = manifestCard(cx, player, pick, 'manifest', 'plain');
    for (const h of tops) {
      if (h.id === pick.id || g.s.objects[h.id]?.zone !== 'library') continue;
      spend(cx, 1);
      const m = proposeMove(cx, h, 'graveyard', { cause: 'manifestDread' }); // CR 701.62a (public: the card is named by the move)
      if (m.ok && m.to?.zone === 'graveyard') binned = m.to.id;
    }
  }
  performAction(g, { verb: 'manifestDread', actor: player, ...(binned !== undefined ? { objectId: binned } : {}) }); // CR 701.62b
  return made;
}

/**
 * CR 701.62a: manifest dread. FAST5X E25: `who` may be another player ("its controller manifests dread": that player looks, chooses and controls the permanent,
 * CR 701.40a); `n` repeats the whole action ("manifest dread X times", each one complete before the next, CR 701.62b) and `as` binds every permanent manifested
 * ("each of those creatures", CR 608.2c). More than one player manifesting dread at once is resolved by hand (no printed card does it; the engine does not
 * order their choices, CR 101.4).
 */
const manifestDread: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  const players = resolvePlayers(cx, st.who);
  if (players.length > 1) return askManual(cx, textOf(st, 'Manifest dread.'), 'more than one player manifests dread at once (CR 101.4)');
  const player = players[0];
  const times = howMany(cx, st);
  if (player === undefined || times === undefined) {
    bindAs(cx, st.as, []);
    return NOTHING;
  }
  const manual = modifiedByManualText(g, MODIFIES_MANIFEST);
  if (manual) return askManual(cx, textOf(st, 'Manifest dread.'), `manifesting is changed by text the engine does not run (${manual})`);
  const made: ObjHandle[] = [];
  for (let i = 0; i < times; i++) {
    const h = dreadOnce(cx, player);
    if (h) made.push(h);
  }
  bindAs(cx, st.as, made);
  return did(made.length);
};

/** The native actions of this module by `ActionMacro.native` name (keywords/actions/face-down.ts). */
export const FACE_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = {
  manifest: topCards('manifest', 'plain'),
  cloak: topCards('cloak', 'ward2'),
  manifestDread,
};

// ---- the special action (core/special/turn-face-up.ts) ----------------------------------------------------------------------------------------------------

/**
 * The plan of a turn-face-up cost: mana for this action (a special action is not a spell or an ability, CR 116.2b; the source is the permanent). FAST5X E23
 * (CR 106.6): spent as the cost to turn this permanent face up ('faceUp'), so mana restricted to "turn a permanent face up" pays it and mana restricted to
 * abilities does not.
 */
const planOf = (cost: CostDef, x: number | 'unannounced', id: ObjectId): CostPlan => ({ ...planFromCostDef(cost, x), spend: { kind: 'faceUp', id } });

function performSpecial(g: Game, player: PlayerId, id: ObjectId, p: FaceUpProcedure, given: number | undefined): void {
  const o = g.obj(id);
  const what = `turning ${realName(g, o)} face up (${p.via})`;
  // CR 702.37f, 107.3a: X in the cost is chosen as the special action is taken
  let x = 0;
  if (costHasX(p.cost)) {
    const xs = payableXs((n) => planDenial(g.s, player, id, planOf(p.cost, n, id)) === null, costFilterHasX(p.cost));
    if (xs.length === 0) throw new IllegalAction(`You can't pay for ${what} with any value of X.`, ['CR 601.2h', 'CR 107.3a']);
    if (given !== undefined) {
      if (!xs.includes(given)) throw new IllegalAction(`You can't pay for ${what} with X = ${given}.`, ['CR 601.2h', 'CR 107.3a']);
      x = given;
    } else if (xs.length > 1) {
      x = g.choose({ kind: 'chooseNumber', player, prompt: `Choose a value for X for ${what}.`, min: xs[0]!, max: xs[xs.length - 1]!, cancellable: true, rules: ['CR 702.37f', 'CR 107.3a'] }).n;
      if (!xs.includes(x)) throw new IllegalAction(`You can't pay for ${what} with X = ${x}.`, ['CR 601.2h', 'CR 107.3a']);
    } else x = xs[0]!;
  }
  // CR 702.37e, 701.40b: show the cost (the log names it once the permanent is face up), pay it, then turn the permanent face up
  performEffectPayment(g, player, id, resolveAnyCounts(g, player, id, planOf(p.cost, x, id), what), what);
  const who = g.player(player).name;
  const name = realName(g, o);
  const r = proposeResult(g, { ev: 'turnFaceUp', object: { id, zone: 'battlefield' }, via: p.via, by: player, ...(costHasX(p.cost) ? { x } : {}), ...(p.via === 'megamorph' ? { megamorphPaid: true } : {}) });
  const how = p.via === 'manifest' || p.via === 'cloak' ? `for its mana cost (a ${p.via}ed creature card)` : `for its ${p.via} cost`;
  g.log(r ? `${who} turns a face-down creature face up ${how}: it is ${name}.` : `${who} pays to turn a face-down creature face up ${how}, but it stays face down.`, {
    rules: ['CR 116.2b', p.via === 'manifest' ? 'CR 701.40b' : p.via === 'cloak' ? 'CR 701.58b' : p.via === 'disguise' ? 'CR 702.168d' : 'CR 702.37e'], level: 'action',
  });
}

installTurnFaceUp({
  payable: (s, player, id, cost) => planDenial(s, player, id, planOf(cost, 0, id)) === null,
  denied: (s, id) => ruleDenial(s, { action: 'beTurnedFaceUp', subject: id }) !== null, // FAST5X E25 (CR 708.7, 101.2)
  perform: performSpecial,
});
