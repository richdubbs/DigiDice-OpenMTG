/**
 * FAST5 T48 merge: in model/ (pure data over the ability model, importing only types) so the renderer may import it (design 5.4 import rules).
 * Tokens that a card names and defines in its own reminder text, not in CR 111.10 (a set newer than the Comprehensive Rules in rules/cr). They are inline
 * `TokenDef`s: not in predefined-tokens.json (that file holds the Comprehensive Rules' rules text and nothing else), and never guessed: an entry is the
 * card's own reminder text, written as the ability model. When the CR lists the token, it moves to predefined-tokens.json and its templates build
 * `{ predefined }` (the Heartwood token, the first entry here, became CR 111.10x in the 2026-09-25 edition).
 *
 * The parser's templates write the same definition as JSON; their tests pin the two together. The renderer (render/steps-zones.ts#tokenText) prints a
 * definition equal to an entry as "a <Name> token", which is how Oracle names it (CR 111.4).
 */
import type { TokenDef } from '../types/ability';

/**
 * r5-mech: the Mutavault token: "a land with \"{T}: Add {C}\" and \"{1}: This token becomes a 2/2 creature with all creature types until end of turn. It's still a
 * land.\"" (Mutable Explorer's reminder text; CR 111.4, 205.1b, 205.3m). A colorless land with no subtype; written as Mutavault's own two abilities compile.
 */
export const MUTAVAULT_TOKEN: TokenDef = Object.freeze({
  name: 'Mutavault',
  types: ['Land'],
  abilities: [
    { kind: 'activated', text: '{T}: Add {C}.', isMana: true, cost: { tap: true }, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['C']] }] } },
    {
      kind: 'activated',
      text: "{1}: This token becomes a 2/2 creature with all creature types until end of turn. It's still a land.",
      cost: { mana: [{ kind: 'generic', amount: 1 }] },
      effect: {
        targets: [],
        steps: [{
          op: 'effect',
          duration: { d: 'endOfTurn' },
          effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, types: { add: ['Creature'] }, subtypes: { all: true } }, { layer: '7b', power: 2, toughness: 2 }] }],
        }],
      },
    },
  ],
}) as TokenDef;

/** The named tokens by name (Heartwood is CR 111.10x since the 2026-09-25 edition, in predefined-tokens.json; the Mutavault token is not in CR 111.10). */
export const NAMED_TOKENS: Readonly<Record<string, TokenDef>> = Object.freeze({ Mutavault: MUTAVAULT_TOKEN });

const canon = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};

/** The name of the named token `t` is exactly equal to, or undefined (any other definition is described by its characteristics). */
export function namedTokenOf(t: TokenDef): string | undefined {
  if (t.name === undefined) return undefined;
  const known = NAMED_TOKENS[t.name];
  return known !== undefined && canon(known) === canon(t) ? t.name : undefined;
}
