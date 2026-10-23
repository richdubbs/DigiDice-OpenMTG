/**
 * FAST5X E10: airbend (CR 701.65), run through actions-native.ts#NATIVE_ACTIONS (`feature:action.native.airbend`). Step: `{op:'action', action:'airbend', who,
 * subject}` (`subject`: the permanents to airbend, "target nonland permanent", "up to one other target creature"; `who`: the player who airbends).
 *
 * CR 701.65a: to airbend, the player exiles those objects; for each CARD exiled this way, for as long as it remains exiled, its owner may cast it by paying {2}
 * rather than paying its mana cost. The exile goes through the proposal pipeline (a replacement such as a commander's may put it elsewhere: then it was not
 * exiled and gets nothing); each card that ends in exile is marked `chosen.airbent` (a new object in exile, CR 400.7: the mark is gone once it leaves). The
 * permission is the cast option `airbend` (actions/cast-opt/airbend.ts): its owner, normal timing, alternative cost {2} (CR 118.9; additional costs still
 * apply). A token exiled this way is no card and ceases to exist (CR 111.7, 111.8).
 *
 * CR 701.65b: "whenever a player airbends" triggers when that player exiles one or more objects as a result of an instruction to airbend: the action emits
 * `actionPerformed` 'airbend' once when at least one object was exiled.
 *
 * std-rw6 (CR 701.65a, 405.1, 707.10a): a SPELL is airbent too (Aang, Swift Savior: "target creature or spell"): it leaves the stack for exile (it is not countered,
 * CR 701.6a), and the card is marked as a permanent card is; a copy of a spell is no card, so it ceases to exist and gets nothing (CR 707.10a, 704.5e).
 *
 * Fail closed (design 10): permanents and spells only. A card in another zone, or an ability on the stack, is airbent by hand. Text the engine does not run that
 * changes airbending ("if you would airbend") makes it manual too.
 */
import { AIRBENT } from '../../rules/airbent';
import type { EffectStep, ObjRef } from '../../types/ability';
import type { StepHandler } from '../api';
import { askManual } from '../manual';
import { performAction } from '../perform';
import { modifiedByManualText } from './manual-text';
import { actOn, bindAs, bindMoved, did, firstPlayer, movedHandles, NOTHING, proposeMove, type Moved } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const AIRBEND_FEATURES: readonly string[] = ['action.native.airbend'];

const airbend: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []);
  const text = st.span ?? 'Airbend.';
  const modified = modifiedByManualText(g, /\bwould airbend\b/i);
  if (modified) return askManual(cx, text, `airbending is modified by an ability the engine does not run, ${modified}`);
  if (st.subject === undefined) return askManual(cx, text, 'the step does not say what is airbent (CR 701.65a)');
  const player = firstPlayer(cx, st.who);
  if (player === undefined) return NOTHING; // fails to determine (CR 608.2b)
  const objs = actOn(cx, st.subject as ObjRef);
  // CR 701.65a: a permanent or a spell (std-rw6); anything else is not run here (fail closed)
  const spell = (h: (typeof objs)[number]): boolean => h.zone === 'stack' && g.s.objects[h.id]?.kind !== 'ability';
  if (objs.some((h) => h.zone !== 'battlefield' && !spell(h))) return askManual(cx, text, 'airbending an ability or a card that is not a permanent or a spell is not automated (CR 701.65a)');
  const moved: Moved[] = [];
  for (const h of objs) {
    const name = g.nameOf(h.id);
    const m = proposeMove(cx, h, 'exile', { cause: 'exile' });
    if (!m.ok) continue;
    moved.push(m);
    for (const to of movedHandles(m)) {
      const o = g.s.objects[to.id];
      if (!o || to.zone !== 'exile' || o.kind !== 'card') continue; // only a card that is exiled may be cast this way (CR 701.65a)
      o.chosen = { ...(o.chosen ?? {}), [AIRBENT]: true };
    }
    const exiled = movedHandles(m).some((to) => to.zone === 'exile');
    g.log(`${name} is airbent${exiled ? `: it is exiled, and while it stays exiled its owner may cast it for {2} rather than its mana cost` : ''}.`, { rules: ['CR 701.65a', 'CR 400.7'], level: 'action' });
  }
  const exiledAny = moved.some((m) => movedHandles(m).some((to) => to.zone === 'exile'));
  if (exiledAny) performAction(g, { verb: 'airbend', actor: player }); // CR 701.65b
  bindMoved(cx, st.as, moved);
  return did(moved.length);
};

/** The native action of this module by `ActionMacro.native` name (keywords/actions/native.ts). */
export const AIRBEND_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { airbend };
