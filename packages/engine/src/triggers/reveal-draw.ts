/**
 * edh-next-144 (CR 701.20a, 121.2, 603.2, 607.2; Keranos, God of Storms, Primitive Etchings, Rowen): "Reveal the first card you draw each turn" (`revealFirstDraw`, "... on each of your
 * turns" with `onYourTurns`). A static ability, so the card is revealed AS it is drawn (core/zones.ts#drawCard calls the hook installed here), with no choice and no stack, and only the
 * first card its controller draws in a turn (`turnStats.cardsDrawn`, CR 121.2; their own turns only with `onYourTurns`) while the game is being played (the opening hand is drawn
 * before the first turn, CR 103.5). Each object with such a rule reveals it: the card is shown to every player (core/zones.ts#showCards) and an event `revealedThisWay` of that object
 * is emitted, which its own linked "Whenever you reveal a <kind> card this way" triggers read (`{ev:'reveal', thisWay: true}`, triggers/match.ts; CR 607.2: another object's reveal is not
 * "this way"). They go on the stack the next time a player would receive priority (CR 603.3).
 */
import type { Game } from '../core/game';
import { installDrawHook, revealDrawnThisWay } from '../core/zones';
import type { ObjectId, PlayerId } from '../types/ids';
import { revealFirstDrawOptional, revealFirstDrawSources } from '../statics/hooks';

function onDraw(g: Game, player: PlayerId, id: ObjectId): void {
  if (g.s.stage !== 'playing' || g.s.turn.number < 1) return; // CR 103.5: the opening hand is not drawn in a turn
  if (g.player(player).turnStats.cardsDrawn !== 1) return; // CR 121.2: only the first card drawn this turn
  for (const src of revealFirstDrawSources(g.s, player)) {
    if (g.s.objects[id]?.zone !== 'hand') return;
    // edh-next-132 (CR 701.20a; God-Eternal Kefnet, ruling 2019-05-03): "You may reveal ... as you draw it": the player has seen the card and chooses; declined, nothing is revealed this way
    if (revealFirstDrawOptional(g.s, player, src) && !g.choose({ kind: 'yesNo', player, prompt: `${g.nameOf(src)}: reveal ${g.nameOf(id)}, the first card you drew this turn?`, rules: ['CR 701.20a', 'CR 121.2'] }).yes) continue;
    revealDrawnThisWay(g, player, id, src); // CR 701.20a
  }
}

installDrawHook(onDraw);
