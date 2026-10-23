/**
 * render/: JSON -> canonical English, a pure function of the JSON ALONE (never of the text it came from). Owner: WP2.
 *
 * Files:
 *   render/render.ts          renderAbility (dispatch over ability kinds, display text)
 *   render/gate.ts            renderGate (guard G6)           render/equivalence.ts   normalizeForGate (the normalization table), gateTokens
 *   render/metrics.ts         measureGate (false-reject rate, for the coverage report)
 *   render/guard.ts           checkAbility: the shape check in front of the renderer (known kind, no reserved words, bounded size); renderGateKeywordLine in gate.ts: the gate for a line of keywords
 *   render/{cost,filter,quantity,condition,duration,event,static,keyword}.ts   one public renderer per expression node
 *   render/step.ts            RENDERERS: one renderer per effect op (an op without one is not a capability, design 5.2)
 * Internals (not part of the contract):
 *   text.ts (alternative groups, English helpers), state.ts (anaphora state), kernel.ts + boot.ts (the knot of mutually recursive renderers, so that no
 *   import cycle is needed), np.ts / refs.ts / qty.ts / cond.ts / evt.ts / dur.ts / costs.ts / kw.ts (nodes), clause.ts / steps*.ts / fold.ts / program.ts /
 *   mods.ts / stat.ts / abil.ts (steps, programs, effects and ability frames).
 *
 * HOW THE GATE IS EXACT. The renderer returns English in which the positions where Oracle genuinely varies and the model does NOT are written as groups of
 * alternatives (`alt(...)` in render/text.ts): the pronoun or the noun for something already named ("it" / "that creature"), the joiner of two steps
 * (". " / " and " / ", then "), "all" / "each", "unless X pays" / "X may pay ... If X doesn't", "its owner's" / "your" for a zone of the owner, and so on. The gate
 * accepts the Oracle text if it equals some choice at every group (a position-set walk), so it is never "similar", only "equal to one reading of the JSON".
 * Everything outside a group (every filter field, number, player, zone, duration, condition) must match word for word, which is what makes a swapped filter, a
 * dropped duration or a missing "unless" fail. A node the renderer cannot print throws NoRenderer, and the gate reports that as a rejection (never as a pass).
 * A field the text has no words for is refused the same way (design 3.3: it would be a constraint nobody can see). A display-only option (`displayFirst` in text.ts)
 * is shown by the display and never matched by the gate.
 */
import type { AbilityDef } from '../types/ability';

export interface RenderContext {
  /** Face name and the other face names of the card (and the legendary short name), for "~" handling. */
  selfNames: string[];
  /**
   * WP2 ADDITION (optional, backward compatible): the card types and subtypes of the face being rendered ("Creature", "Land", "Aura", "Equipment").
   * Oracle's words depend on what the object is: "enchanted" or "equipped" creature (an attached-to reference), "dies" or "is put into a graveyard
   * from the battlefield", "~ or another creature" for a trigger on any creature, "It's still a land". Without it the renderer marks those positions
   * as alternatives (the gate accepts any of them) instead of guessing.
   */
  selfTypes?: string[];
  /**
   * WP2 ADDITION (optional, backward compatible; INTERFACE CHANGE of this file): the Oracle line(s) of the ability being rendered (the same lines as the
   * gate's `oracleLines`). `renderAbility` then returns the reading of the JSON that those lines match, so the display has the joiners, the pronouns and the
   * sentence breaks of the card (design 10.5). Without them, or when they do not match, it returns the first reading of every alternative group.
   */
  oracleLines?: string[];
  /**
   * p2-counters-state-1 ADDITION (optional): the kicker costs the face prints, in order and lower case ("Kicker {1}{R} and/or {G}" -> ["{1}{r}", "{g}"]), for
   * "kicked with its {1}{R} kicker" (the cast record's kicker names "kicker", "kicker:2", CR 702.33f).
   */
  kickerCosts?: string[];
}

/**
 * One string per sentence (a bullet of a modal spell is a sentence of its own): display, tooltips, "how OpenMTG plays this card". "~" is the first of
 * `selfNames`. INTERFACE CHANGE (declared in the WP2 report; design 10.5 and 15.2 say "same order and count as the ability's Oracle sentences", which one
 * function of the JSON alone cannot promise): with `ctx.oracleLines` that match, the sentences are the matched reading, in the order and number of the
 * Oracle sentences; without them the sentence count and the joiners ("then", "and", ". ") are those of the first reading of every alternative group and
 * may differ from the card's. Never throws: a node without a renderer prints as `[cannot render <node>]`.
 */
export type RenderAbility = (def: AbilityDef, ctx: RenderContext) => string[];

export interface GateResult {
  ok: boolean;
  /** normalize(render(def)): the first reading when the gate rejects; the reading that matched when it accepts. `<cannot render: ...>` for a node without a renderer. */
  rendered: string;
  /** normalize(oracle line(s) of the ability) */
  expected: string;
  /** On a rejection: the index of the first word (see `gateTokens` in render/equivalence.ts; punctuation counts as a word) of `expected` that no reading of the JSON matches. */
  firstDiff?: number;
}

/**
 * Guard G6. EXACT equality after normalization (case, straight quotes, "~", number words vs digits, articles a/an/one in
 * quantity position, "its owner's"/"their owner's" where the model says the same, listed anaphora variants it/that creature/them
 * at positions the renderer marks anaphoric, reminder text removed). Anything else is a mismatch; the ability becomes manual
 * with diagnostic `gate-mismatch`. The false-reject rate is a tracked metric (design 6.12), not a reason to loosen the gate.
 * `oracleLines` are joined with a space; they are the Oracle line(s) of the ability WITHOUT an ability word or flavor word label (`AbilityBase.label` is not
 * rendered). Total: it never throws (a malformed ability is a rejection).
 */
export type RenderGate = (def: AbilityDef, oracleLines: string[], ctx: RenderContext) => GateResult;

/** The normalization used on both sides of the gate. Exported so tests and the LLM repair prompt use the same one. */
export type NormalizeForGate = (text: string, selfNames: string[]) => string;
