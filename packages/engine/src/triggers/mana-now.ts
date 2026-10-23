/**
 * Triggered mana abilities (CR 605.1b, 605.4a). Owner: WP32.
 *
 * A triggered ability without a target that triggers from activating a mana ability and could add mana is itself a mana ability: it "doesn't go on the stack
 * ... it resolves immediately after the mana ability that triggered it, without waiting for priority" (CR 605.4a; Mana Flare, Wild Growth, Utopia Sprawl). So
 * the collection that runs when a player would receive priority (stack.ts, collect.ts mode `stack`) leaves them out, and this module finds them right after the
 * activation, in the middle of a payment if that is where the mana ability was activated: the extra mana can pay for the spell (the example of CR 605.4a).
 *
 * `rules/mana.ts#activateManaAbility` calls the function core/triggers.ts installs (`installTriggeredManaResolver`), which runs `triggeredManaAbilitiesFor` here
 * and resolves each result with the interpreter (effects/mana-now.ts): triggers/ may not import the interpreter, and rules/ may import neither (design 5.4).
 *
 * Cost: mana abilities are activated very often (every land tapped to pay for a spell). Before any object is looked at, `mayTrigger` asks whether any card definition of
 * the game or any delayed record mentions the trigger event at all; definitions are immutable (ARCHITECTURE.md, structural sharing), so the answer per
 * definition is remembered by identity. Every ability of the game, printed, granted or created by a resolution, is written in a definition (or in a delayed
 * record made from one), and no keyword expansion mentions the event (a test pins that). `MENTIONS` outlives an action: an accepted deviation from design 8.8
 * rule 3, declared in the WP32 review, safe because each answer is a pure function of an immutable definition compared by identity (as triggers/possible.ts).
 */
import type { Game } from '../core/game';
import type { TriggeredAbilityDef } from '../types/ability';
import type { CardDef } from '../types/card';
import type { PendingTrigger } from '../types/state';
import { collectManaTriggers } from './collect';
import { mentionsManaActivation } from './forms';
import { normalize } from './normalize';
import { pendingDef } from './stack';

/** Per card definition (immutable, compared by identity): does it mention the trigger event of a triggered mana ability anywhere? */
const MENTIONS = new WeakMap<CardDef, boolean>();

function defMentions(def: CardDef): boolean {
  let v = MENTIONS.get(def);
  if (v === undefined) {
    v = mentionsManaActivation(def.faces);
    MENTIONS.set(def, v);
  }
  return v;
}

/** Can anything in this game trigger from a mana activation? False is certain; true means "look". */
function mayTrigger(g: Game): boolean {
  for (const id in g.s.defs) if (defMentions(g.s.defs[id]!)) return true;
  return g.s.delayedTriggers.some((r) => mentionsManaActivation(r.when));
}

/** A triggered mana ability that triggered, with the definition it resolves with. */
export interface ManaTrigger {
  trigger: PendingTrigger;
  def: TriggeredAbilityDef;
}

/**
 * The triggered mana abilities the engine event at `g.events[at]` triggers (a `manaAdded` event of an activation, CR 605.3b), in APNAP order of their
 * controllers (CR 101.4) and then in the order they were found. Logs each trigger (CR 603.2), like the ordinary collection.
 */
export function triggeredManaAbilitiesFor(g: Game, at: number): ManaTrigger[] {
  const e = g.events[at];
  if (!e || e.type !== 'manaAdded' || e.viaActivation !== true) return [];
  if (!mayTrigger(g)) return [];
  const found = collectManaTriggers(g, normalize(g, [e], at));
  const out: ManaTrigger[] = [];
  for (const player of g.apnap()) {
    for (const t of found) {
      if (t.controller !== player) continue;
      const def = pendingDef(g, t);
      if (def?.kind === 'triggered') out.push({ trigger: t, def });
      else g.log(`${t.sourceName}: the engine can't find the triggered mana ability that triggered; add the mana by hand if it should have.`, { rules: ['CR 605.4a'], level: 'warning' });
    }
  }
  return out;
}
