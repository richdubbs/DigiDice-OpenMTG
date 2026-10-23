/**
 * The text of a printed loyalty or defense that is not a number ("X", CR 306.5b, 310.4b): the manual part the compile pipeline adds to such a face
 * (cards/pipeline.ts#variableCounterAbilities) and the prompt core/zones.ts gives as the permanent enters use the same words, so a player (and the smoke
 * test's backstop check) can tell the prompt is that part. Pure text, no game state. W3b.
 */
export function variableCounterText(counter: 'loyalty' | 'defense', printed: string): string {
  return `${counter === 'loyalty' ? 'Loyalty' : 'Defense'} ${printed} (a variable ${counter}: the engine can't set it yet)`;
}
