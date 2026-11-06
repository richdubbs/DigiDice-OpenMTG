/**
 * FAST4 MX1: actions with cards in the opening hand (CR 103.6). "If this card is in your opening hand, you may begin the game with it on the battlefield"
 * (Leyline of the Void, Leyline of Sanctity, ...: a static ability that functions in the hand, `{ s: 'pregame', action: 'beginOnBattlefield', optional: true }`).
 *
 * Once the mulligans are over (CR 103.5), the starting player may take such actions, then each other player in turn order (CR 103.6): each is asked once,
 * with every card of their hand that has the ability, and may choose any of them, in the order the cards are put onto the battlefield (CR 103.6a: the
 * player puts the card onto the battlefield). The move goes through the proposal pipeline like any other (replacement effects, "as it enters" choices); what
 * triggers on it goes on the stack the first time a player would receive priority (CR 117.5). Each card put there is named in the public log; a player who
 * declines is not mentioned (their hand stays hidden, CR 400.2).
 *
 * The other actions of the model (`reveal`, CR 103.6b, and `exileBeforeShuffle`) and a mandatory one are not run: the walker names them
 * `feature:pregame.<action>` / `feature:pregame.mandatory` (model/cap-walk.ts) and only `PREGAME_FEATURES` below is registered (model/capabilities.ts).
 */
import type { AbilityDef, StaticEffect } from '../types/ability';
import type { ObjectId } from '../types/ids';
import type { Game } from './game';
import { addCounters } from '../rules/counters';
import { createDelayedTrigger } from '../triggers/delayed';
import { moveObject, zoneArray } from './zones';

/** The static kind and the action this module runs (model/capabilities.ts adds `static:pregame` and `feature:pregame.beginOnBattlefield`). */
export const PREGAME_STATIC_KINDS: Readonly<Record<string, true>> = { pregame: true };
export const PREGAME_FEATURES: readonly string[] = ['pregame.beginOnBattlefield', 'pregame.reveal.delayed' /* edhd32 */];

type Begin = Extract<StaticEffect, { s: 'pregame' }>;

/**
 * edhd32 (CR 103.6b, 603.7a): "You may reveal this card from your opening hand. If you do, at the beginning of [the | your] first upkeep, ..." (the Chancellors,
 * Devourer of Destiny, Sphinx of Foresight). The effects of a printed ability that functions in the hand and names a reveal. Only a reveal whose consequences are
 * delayed triggered abilities waiting for a step (`then`: `delay` steps) is run; any other (a reveal with no consequence is not a card of the model) is left
 * out by the capability walker (`feature:pregame.reveal.delayed` is registered; a reveal with no `then` or another form stays `feature:pregame.reveal`, unregistered: model/cap-walk.ts).
 */
function revealEffects(a: AbilityDef): Begin[] {
  if (a.kind !== 'static' || !(a.zone ?? []).includes('hand')) return [];
  return a.effects.filter((e): e is Begin => e.s === 'pregame' && e.action === 'reveal' && e.optional && e.then !== undefined && e.then.length > 0
    && e.then.every((t) => t.op === 'delay' && t.when.at === 'step'));
}

/** The reveal effects of the card in a player's hand (a card in a hand has its front face's characteristics, CR 712.8a). */
function revealEffectsOf(g: Game, id: ObjectId): Begin[] {
  const o = g.s.objects[id];
  const def = o ? g.s.defs[o.defId] : undefined;
  return (def?.faces[0]?.abilities ?? []).flatMap(revealEffects);
}

/** The "you may begin the game with it on the battlefield" effects of a printed ability that functions in the hand. */
function beginEffects(a: AbilityDef): Begin[] {
  if (a.kind !== 'static' || !(a.zone ?? []).includes('hand')) return [];
  return a.effects.filter((e): e is Begin => e.s === 'pregame' && e.action === 'beginOnBattlefield' && e.optional);
}

/** The cards in a player's hand whose front face has the ability (a card in a hand has its front face's characteristics, CR 712.8a). */
function beginEffectsOf(g: Game, id: ObjectId, player: string): Begin[] {
  const o = g.s.objects[id];
  const def = o ? g.s.defs[o.defId] : undefined;
  // edh-top-1 (CR 103.1, 103.6): "if ... you're not the starting player" is checked when the action is taken; the starting player is the first to act
  return (def?.faces[0]?.abilities ?? []).flatMap(beginEffects).filter((e) => !(e.notStarting && g.s.turn.startingPlayer === player));
}

function candidates(g: Game, player: string): ObjectId[] {
  return zoneArray(g, 'hand', player).filter((id) => beginEffectsOf(g, id, player).length > 0);
}

/** CR 103.6, 103.6a: the opening-hand actions, the starting player first, then each other player in turn order (`GameState.players` is in turn order). */
export function openingHandActions(g: Game, due: () => boolean = () => false): void {
  for (const p of g.s.players) {
    if (due()) return; // M12-2 (review fix 2): the concessions made while the start of the game waited apply at their point (core/start.ts)
    if (p.hasLost) continue;
    revealActions(g, p.id, due); // CR 103.6b (edhd32); a card begun on the battlefield is no longer in the hand, so it is not asked again
    const options = candidates(g, p.id);
    if (options.length === 0) continue;
    const ans = g.choose({
      kind: 'chooseObjects',
      player: p.id,
      prompt: `Begin the game with any of these cards on the battlefield? Choose the ones you want (none to keep them in your hand)${options.length > 1 ? ', in the order they are put there' : ''}.`,
      options,
      min: 0,
      max: options.length,
      ...(options.length > 1 ? { ordered: true } : {}),
      rules: ['CR 103.6', 'CR 103.6a'],
    });
    for (const id of ans.ids) {
      if (!options.includes(id) || g.s.objects[id]?.zone !== 'hand') continue;
      const name = g.nameOf(id);
      const effect = beginEffectsOf(g, id, p.id)[0]!;
      const now = moveObject(g, id, 'battlefield', { controller: p.id, cause: 'pregame' });
      g.log(`${p.name} begins the game with ${name} on the battlefield.`, { rules: ['CR 103.6a'], level: 'action' });
      if (now === null || g.s.objects[now]?.zone !== 'battlefield') continue; // a replacement kept it elsewhere: "if you do" did not happen
      if (effect.counters) addCounters(g, now, effect.counters.kind, effect.counters.count, p.id);
      if (effect.exileFromHand !== undefined) exileFromHand(g, p.id, effect.exileFromHand);
    }
  }
}

/** edh-top-1: "If you do, exile a card from your hand" (CR 103.6, 406.1): the player chooses `count` cards of their hand (fewer if they have fewer). */
function exileFromHand(g: Game, player: string, count: number): void {
  const hand = zoneArray(g, 'hand', player);
  const n = Math.min(count, hand.length);
  if (n === 0) return;
  const ans = g.choose({
    kind: 'chooseObjects',
    player,
    prompt: `Exile ${n === 1 ? 'a card' : `${n} cards`} from your hand.`,
    options: hand,
    min: n,
    max: n,
    rules: ['CR 103.6'],
  });
  for (const id of ans.ids) {
    if (!hand.includes(id)) continue;
    const name = g.nameOf(id);
    moveObject(g, id, 'exile', { cause: 'pregame' });
    g.log(`${g.player(player).name} exiles ${name} from their hand.`, { rules: ['CR 103.6'], level: 'action' });
  }
}

/**
 * edhd32 (CR 103.6b, 603.7a, 603.7d): the player may reveal each such card from their opening hand, once each (the card stays revealed until the first turn begins,
 * so the reveal is public). For each card revealed, the delayed triggered abilities of "If you do, ..." are created now, controlled by the player, with the card as
 * their source (CR 603.7d-e); they cannot trigger before the game begins, and fire at the first such step (triggers/delayed.ts: a step trigger fires at the first
 * such step after it was created). "your first upkeep" has `whose: you`, so it waits for that player's own turn.
 */
function revealActions(g: Game, player: string, due: () => boolean): void {
  const options = zoneArray(g, 'hand', player).filter((id) => revealEffectsOf(g, id).length > 0);
  if (options.length === 0 || due()) return;
  const ans = g.choose({
    kind: 'chooseObjects',
    player,
    prompt: `Reveal any of these cards from your opening hand? Choose the ones you want (none to keep them hidden).`,
    options,
    min: 0,
    max: options.length,
    rules: ['CR 103.6', 'CR 103.6b'],
  });
  for (const id of ans.ids) {
    if (!options.includes(id) || g.s.objects[id]?.zone !== 'hand') continue;
    const name = g.nameOf(id);
    g.log(`${g.player(player).name} reveals ${name} from their opening hand.`, { rules: ['CR 103.6b'], level: 'action' });
    const handle = { id, zone: 'hand' as const };
    for (const effect of revealEffectsOf(g, id)) {
      for (const step of effect.then ?? []) {
        if (step.op !== 'delay') continue;
        createDelayedTrigger(g, { source: handle, controller: player, when: step.when, do: step.do });
      }
    }
  }
}
