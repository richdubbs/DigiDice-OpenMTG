# @openmtg/ai

A heuristic AI opponent for OpenMTG. Pure TypeScript with no I/O, no `Math.random` and no `Date`: the same view, decision and seed always give the same action. The seed decides between equally good plays (for example, which of two copies of a card to cast), so different seeds can play differently.

```ts
import { viewFor, applyAction } from '@openmtg/engine';
import { chooseAction, AI_STOPS } from '@openmtg/ai';

const view = viewFor(state, botPlayer);            // the bot sees only what its player may see (CR 400.2)
const action = chooseAction(view, view.pending!, 'seed');
state = applyAction(state, action).state;
```

- Answers every decision kind the engine can pend (`types/decisions.ts`). Priority actions come from `legalActions`, so the engine accepts every play.
- Give the bot's player `AI_STOPS` as its stops. Without them, Arena-style auto-pass can skip the steps where it holds instants: the opponent's declare attackers step and end step, and its own combat after blockers.
- Heuristics: keeps hands with 2 to 5 lands, plays a land each turn, and casts its most valuable spells first. Removal and burn go at the opponent's best targets, and burn goes to the face when that is lethal. It attacks when no blocker kills its creature for free or the trade is fair, attacks with everything when that is lethal (life or poison), and keeps enough blockers home to survive the next attack. It blocks to kill an attacker, to trade fairly, or to chump when the damage or poison would be lethal. Pump spells wait for combat, and counterspells wait for a spell worth countering, or for one that would be lethal to the bot. As separator of piles (Fact or Fiction) it makes two piles of similar value; as chooser it takes the pile worth more.
- It never loses on its own: it never draws from a nearly empty library (its own draws, "each player draws", a targeted draw aimed at itself, X in "draw X cards", an optional draw), never pays life (Phyrexian mana, flashback costs) down to 0 or to what the opponent's creatures could deal next turn, and does not cast a creature whose mandatory harmful enters trigger could only hit its own things. It declines a "you may" that would hurt only its own things.
- Text the engine does not understand is never resolved by guessing:
  - `manualResolve`: the bot answers with only a `note` operation, so the log shows that nothing was done.
  - A condition or a number the engine asks for because it can't evaluate it (`{cond:'ask'}`, `{q:'ask'}`, rules `CR 608.2c`): the bot answers "no" and the least number (0), the values that leave the effect undone. The engine records the answer; the bot does not cast or activate anything for an effect that depends on such a question.
  - An activation restriction or a cost the controller must attest by hand ("Confirm: ...", "Pay this cost by hand and confirm"): the bot never attests; it cancels the activation (CR 733.1), and never ranks an ability whose "Activate only if" is manual.
  - It does not cast spells or activate abilities that are only manual text, nor a card whose additional or alternative cost, or casting restriction, is manual text (the engine would not enforce it).
- When a cast turns out worse than estimated, for example when the only legal targets are its own creatures, the bot cancels it (CR 733.1). Cancelling restores the state, so the bot counts its trailing "cancels." log lines and moves on to its next choice instead of trying the same play again.
