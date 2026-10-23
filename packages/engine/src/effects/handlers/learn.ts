/**
 * FAST5 MX7: learn (CR 701.48a): "You may discard a card. If you do, draw a card. If you didn't discard a card, you may reveal a Lesson card you own from
 * outside the game and put it into your hand." Owner: MX7. Step: `{op:'action', action:'learn', who}` (template eff.mx7.learn, zz-fast5/mx7.json), run
 * through actions-native.ts#NATIVE_ACTIONS (`feature:action.native.learn`).
 *
 * The cards a player owns outside the game are their sideboard (CR 400.11a, 100.4): `GameState.outside`, given by the game config (`PlayerConfig.sideboard`).
 * With none, learn still offers the discard-then-draw. The player makes one choice among the outcomes the rule allows: discard a card (then draw), one of
 * their Lesson cards outside the game, or neither; a discard that discards nothing (every card in hand "can't be discarded", CR 101.2) is a discard they
 * didn't do, so the Lesson is offered next (CR 701.48a: "If you didn't discard a card").
 *
 * Text the engine does not run that replaces learning (CR 614.1a: "if you would learn, ... instead"):
 *  - an ability that says it works from its owner's graveyard ("As long as this card is in your graveyard, if you would learn, you may instead return this
 *    card to the battlefield.", Retriever Phoenix) functions only there (CR 113.6b), and its "you" is the card's owner. While such a card is in the learning
 *    player's own graveyard, the learn choice offers it as one more outcome next to the regular ones: "apply this replacement by hand" (one option per card,
 *    the player picks which replacement applies, CR 616.1); picking it resolves the replacement by hand (the manual `move` op returns the card). Anywhere
 *    else (battlefield, exile, another player's graveyard, a Phoenix spell that resolved this turn) it does nothing and is ignored (FAST5 MX7 review);
 *  - any other "would learn" text the engine does not run (none is printed today) makes the whole learn manual (fail closed, design 10): anywhere
 *    modifiedByManualText looks (battlefield, command zone, reminders, what resolved this turn) and in exile.
 */
import type { Game } from '../../core/game';
import { showCards } from '../../core/zones';
import { charsOfObject } from '../../rules/characteristics';
import type { EffectStep } from '../../types/ability';
import type { DefId, ObjectId, PlayerId } from '../../types/ids';
import type { StepHandler } from '../api';
import { askManual } from '../manual';
import { performAction } from '../perform';
import { performBringIntoGame } from '../perform-direct';
import { discardHandler, drawHandler } from './cards-draw';
import { modifiedByManualText } from './manual-text';
import { bindAs, did, firstPlayer, NOTHING } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const LEARN_FEATURES: readonly string[] = ['action.native.learn'];

const WOULD_LEARN = /\bwould learn\b/i;
const IN_GRAVEYARD = /\bin (your|its owner's) graveyard\b/i;
/** "would learn" text that does not say it works from a graveyard: such text in a graveyard is read by `graveyardReplacements` only (CR 113.6b). */
const WOULD_LEARN_IN_PLAY = /^(?![\s\S]*\bin (your|its owner's) graveyard\b)[\s\S]*\bwould learn\b/i;

/** A Lesson card (CR 205.3k: the spell subtype; outside the game a card has its front face's characteristics, CR 712.8a). */
export function isLessonCard(g: Game, defId: DefId): boolean {
  const def = g.s.defs[defId];
  return def !== undefined && !def.isToken && (def.faces[0]?.subtypes ?? []).includes('Lesson');
}

/** The different Lesson cards `player` owns outside the game, in the order they were listed. */
export function lessonsOutside(g: Game, player: PlayerId): DefId[] {
  return [...new Set((g.s.outside?.[player] ?? []).filter((d) => isLessonCard(g, d)))];
}

/** A replacement of learning by a card in a graveyard whose text the engine does not run, offered as one outcome of the learn choice. */
interface GraveyardReplacement {
  readonly id: ObjectId;
  readonly text: string;
}

/**
 * The manual "would learn" abilities that say they work from their owner's graveyard (CR 113.6b), of the cards in `player`'s own graveyard: Retriever Phoenix.
 * "You" in such an ability is the card's owner, and a card is always in its owner's graveyard, so only that player's learning is replaced. One entry per
 * card (CR 616.1: the player picks which replacement applies).
 */
function graveyardReplacements(g: Game, player: PlayerId): GraveyardReplacement[] {
  const s = g.s;
  const out: GraveyardReplacement[] = [];
  for (const id of s.zones.graveyard[player] ?? []) {
    const o = s.objects[id];
    if (!o) continue;
    const hit = charsOfObject(s, o).abilities.find((a) => a.def.kind === 'manual' && WOULD_LEARN.test(a.def.text) && IN_GRAVEYARD.test(a.def.text));
    if (hit !== undefined && hit.def.kind === 'manual') out.push({ id, text: hit.def.text });
  }
  return out;
}

/** Fail closed: a manual "would learn" ability of a card in exile that does not say it works from a graveyard (none is printed today), or null. */
function replacedFromExile(g: Game): string | null {
  const s = g.s;
  for (const id of s.zones.exile) {
    const o = s.objects[id];
    if (!o) continue;
    for (const a of charsOfObject(s, o).abilities) if (a.def.kind === 'manual' && WOULD_LEARN_IN_PLAY.test(a.def.text)) return `${g.nameOf(id)}: "${a.def.text}"`;
  }
  return null;
}

/** CR 701.48a: learn. */
const learn: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []); // bound before any manual prompt or early exit (design 3.1 rule 6, CR 609.3)
  const text = st.span ?? 'Learn.';
  const modified = modifiedByManualText(g, WOULD_LEARN_IN_PLAY) ?? replacedFromExile(g);
  if (modified) return askManual(cx, text, `learn is modified by an ability the engine does not run (CR 614.1a), ${modified}`);
  const player = firstPlayer(cx, st.who);
  if (player === undefined) return NOTHING;
  const name = g.player(player).name;
  let mayDiscard = (g.s.zones.hand[player]?.length ?? 0) > 0;
  // Offered only in the first choice: a replacement applies to the learn event as a whole (CR 614.1a), not after the player started (a discard that failed).
  let replacements = graveyardReplacements(g, player);
  for (;;) {
    const lessons = lessonsOutside(g, player);
    if (!mayDiscard && lessons.length === 0 && replacements.length === 0) {
      g.log(`${name} learns: no card to discard and no Lesson card outside the game.`, { rules: ['CR 701.48a'], level: 'info' });
      return NOTHING;
    }
    const options = [
      ...(mayDiscard ? [{ id: 'discard', label: 'Discard a card, then draw a card' }] : []),
      ...lessons.map((d) => ({ id: `lesson:${d}`, label: `Reveal ${g.s.defs[d]!.name} from outside the game and put it into your hand` })),
      ...replacements.map((r) => ({ id: `replace:${r.id}`, label: `Instead apply ${g.nameOf(r.id)}: "${r.text}" (resolve by hand)` })),
      { id: 'none', label: 'Do neither' },
    ];
    const ans = g.choose({
      kind: 'chooseOption', player, min: 1, max: 1, options, rules: replacements.length > 0 ? ['CR 701.48a', 'CR 614.1a', 'CR 616.1'] : ['CR 701.48a'],
      prompt: (mayDiscard ? 'Learn: you may discard a card to draw a card, or reveal a Lesson card you own from outside the game and put it into your hand.' : 'Learn: you may reveal a Lesson card you own from outside the game and put it into your hand.')
        + (replacements.length > 0 ? ' Or apply a card\'s "if you would learn" replacement instead (resolved by hand).' : ''),
    });
    const pick = ans.ids[0] ?? 'none';
    const replaced = replacements.find((r) => `replace:${r.id}` === pick);
    if (replaced !== undefined) {
      // CR 614.1a, 616.1: the learn is replaced; the engine does not run the replacing text, so the player carries it out by hand (design 10).
      return askManual(cx, `${g.nameOf(replaced.id)}: ${replaced.text}`, 'learning is replaced by an ability the engine does not run (CR 614.1a, 616.1)', undefined, { player });
    }
    replacements = [];
    if (pick === 'discard' && mayDiscard) {
      const discarded = discardHandler(cx, { op: 'discard', who: st.who, count: 1 });
      if (discarded.performed) {
        drawHandler(cx, { op: 'draw', who: st.who, count: 1 }); // CR 701.48a: "If you do, draw a card."
        return did(1);
      }
      mayDiscard = false; // CR 701.48a: "If you didn't discard a card, you may reveal a Lesson card ..."
      continue;
    }
    const defId = pick.startsWith('lesson:') ? pick.slice('lesson:'.length) : null;
    if (defId !== null && lessons.includes(defId)) {
      const id = performBringIntoGame(g, player, defId);
      if (id === null) return NOTHING;
      showCards(g, [id], g.s.players.map((p) => p.id)); // revealed (CR 701.20a), so every player knows the card in hand
      performAction(g, { verb: 'reveal', actor: player, objectId: id });
      g.log(`${name} reveals ${g.nameOf(id)} from outside the game and puts it into their hand.`, { rules: ['CR 701.48a', 'CR 400.11b'], level: 'action' });
      return did(1);
    }
    g.log(`${name} learns: neither discards nor reveals a Lesson card.`, { rules: ['CR 701.48a'], level: 'info' });
    return NOTHING;
  }
};

/** The native action of this module by `ActionMacro.native` name (keywords/actions/native.ts#LEARN). */
export const LEARN_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { learn };
