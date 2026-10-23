/**
 * WP31: the interpreter side of a mana ability whose mana is decided as it resolves (rules/mana.ts#installManaAbilityResolver): "{T}: Add one mana of the
 * chosen color" (Paradise Plume), "Add X mana of any one color", a mana ability with a step beside `addMana`. Owner: WP31 (an addition to the files of design
 * 5.1). A mana ability doesn't use the stack (CR 605.3b): its steps run at once through the op handlers, in a context with no stack object, no targets
 * (CR 605.1a: a mana ability has none) and no triggering event. Loading this module installs the resolver; effects/funnels.ts loads it.
 *
 * PAY1: it also installs the amount reader (rules/mana.ts#installManaAmountReader): the amount of "Add X mana ..." evaluated in the same context as the
 * resolver's, so the auto-payer plans with the amount the ability will add (CR 106.1, 605.3b). The reader only reads: a Game around the state, no decision.
 */
import { Game } from '../core/game';
import type { GameObject, GameState } from '../types/state';
import type { PlayerId } from '../types/ids';
import type { ActivatedInfo } from '../rules/abilities';
import { activatingX, installManaAbilityResolver, installManaAmountReader, installTapManaMultiplier } from '../rules/mana';
import { tapManaMultiplier } from '../statics/hooks';
import type { ExecCtx } from './api';
import { evalQty } from './eval';
import { runSteps } from './run';

/** The context a mana ability resolves in (no stack object, no targets, no event). */
function manaCtx(g: Game, player: PlayerId, source: GameObject, info: ActivatedInfo): ExecCtx {
  return {
    g, source: { id: source.id, zone: 'battlefield' }, stackId: null, controller: player, program: info.def.effect, stack: null, targets: new Map(), event: null,
    bindings: new Map(), results: new Map(), vars: new Map(),
    choices: new Map(), // std-mana-12 (CR 106.1, 608.2c): what an addMana step with a `link` records ("becomes that color", lasting-fix.ts#fixChosen)
  };
}

installManaAbilityResolver((g, player, source, info) => {
  const x = activatingX(g); // p2-mana-1: the X announced for its cost (rules/mana.ts#counterXPart)
  const cx = { ...manaCtx(g, player, source, info), ...(x !== undefined ? { manaX: x } : {}) };
  runSteps(cx, info.def.effect.steps);
});

installTapManaMultiplier(tapManaMultiplier); // std-mana-1 (CR 106.12, 614.1a)

installManaAmountReader((s: GameState, player, source, info, count) => evalQty(manaCtx(new Game(s), player, source, info), count));
