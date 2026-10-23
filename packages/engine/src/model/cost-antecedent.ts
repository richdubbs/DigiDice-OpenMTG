/**
 * PUSH1 T2 review (design 6.4, the unique-candidate rule): where the object an activation cost names ("Sacrifice ~", "Discard ~", "Remove a counter from
 * ~"; CR 602.2b, 118) may be what a pronoun of the effect means. Shared by the parser (parser/lower/anaphora.ts) and the renderer (render/steps.ts), so the
 * two never disagree.
 *
 * The cost object is a FALLBACK antecedent: it is taken only when no tracked mention fits. That is sound only where nothing the discourse model does NOT
 * track can have been introduced before the pronoun: a sacrificed creature chosen on resolution, a discarded, drawn, milled, searched, revealed or looked-at
 * card ("Discard a card. Return it to your hand.": "it" is the discarded card, never ~). So the cost object is a candidate only inside the FIRST
 * instruction of the effect, and only when that instruction consists of steps that act on objects already named and introduce none of their own ("Sacrifice
 * ~: It deals 2 damage to any target", "Regenerate it", "Put a +1/+1 counter on it", "Prevent all damage that would be dealt to it this turn").
 */

/** Ops that act on objects they are given and never introduce one a later word could mean. Anything else (draw, discard, mill, search, reveal, look,
 * sacrificeChoice, chooseObjects, createToken, copy, move, forEach, manual, ...) closes the window. */
const ACTS_ONLY: ReadonlySet<string> = new Set(['damage', 'regenerate', 'putCounters', 'removeCounters', 'effect', 'tap', 'untap', 'gainLife', 'loseLife', 'destroy', 'may', 'if']);

/**
 * FAST5X-4: a `forEach` over each player or opponent ("~ deals 2 damage to each player who doesn't have max speed", CR 608.2f) goes through players one at a
 * time and introduces no object; its body is judged like any step.
 */
function overPlayers(step: Record<string, unknown>): boolean {
  const over = step['over'] as Record<string, unknown> | undefined;
  return step['op'] === 'forEach' && over !== undefined && over['ref'] === 'each' && typeof over['who'] === 'string' && over['filter'] === undefined;
}

/** Does the step (with every step nested in it) only act on objects already named? Ops of comparisons are symbols and are skipped. */
export function actsOnlyOnNamed(step: unknown): boolean {
  let ok = true;
  const walk = (v: unknown): void => {
    if (!ok) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v !== 'object' || v === null) return;
    const op = (v as Record<string, unknown>)['op'];
    if (typeof op === 'string' && /^[a-z]/i.test(op) && !ACTS_ONLY.has(op) && !overPlayers(v as Record<string, unknown>)) { ok = false; return; }
    Object.values(v).forEach(walk);
  };
  walk(step);
  return ok;
}
