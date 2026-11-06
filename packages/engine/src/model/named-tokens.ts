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

/**
 * edh-next-64: the Tarmogoyf token: "{1}{G} Lhurgoyf creature with \"Tarmogoyf's power is equal to the number of card types among cards in all graveyards and its toughness is
 * equal to that number plus 1\"" (Disa the Restless, Tarmogoyf Nest: the reminder text of the card that makes it; Scryfall's token: green, mana cost {1}{G}). A token has no
 * mana cost unless an effect gives it one (CR 111.3); this one is given {1}{G} (its mana value is 2, CR 202.3), and the characteristic-defining ability sets its power and
 * toughness in every zone (CR 604.3, 613.4a). The ability is Tarmogoyf's own, as it compiles.
 */
export const TARMOGOYF_TOKEN: TokenDef = Object.freeze({
  name: 'Tarmogoyf',
  colors: ['G'],
  types: ['Creature'],
  subtypes: ['Lhurgoyf'],
  manaCost: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'G' }],
  abilities: [{
    kind: 'static',
    text: "~'s power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.",
    effects: [{
      s: 'continuous',
      cda: true,
      affects: { ref: 'self' },
      mods: [{
        layer: '7a',
        power: { q: 'distinct', what: 'cardTypes', among: { ref: 'each', filter: { zone: 'graveyard', isCard: true } } },
        toughness: { q: 'math', op: '+', args: [{ q: 'distinct', what: 'cardTypes', among: { ref: 'each', filter: { zone: 'graveyard', isCard: true } } }, 1] },
      }],
    }],
  }],
}) as TokenDef;

/**
 * edh-d-42: the Spellgorger Weird token: "a {2}{R} 2/2 Weird creature with \"Whenever you cast a noncreature spell, put a +1/+1 counter on Spellgorger Weird.\"" (Ral and the Implicit
 * Maze's reminder text; Scryfall's token: red, mana cost {2}{R}). A token has no mana cost unless an effect gives it one (CR 111.3); this one is given {2}{R} (its mana value is 3,
 * CR 202.3). Its ability is written as "put a +1/+1 counter on ~" compiles (the token's own name is the token itself, CR 201.4b).
 */
export const SPELLGORGER_WEIRD_TOKEN: TokenDef = Object.freeze({
  name: 'Spellgorger Weird',
  colors: ['R'],
  types: ['Creature'],
  subtypes: ['Weird'],
  power: 2,
  toughness: 2,
  manaCost: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'R' }],
  abilities: [{
    kind: 'triggered',
    text: 'Whenever you cast a noncreature spell, put a +1/+1 counter on ~.',
    trigger: { on: [{ ev: 'cast', player: 'you', spell: { notTypes: ['Creature'] } }] },
    effect: { targets: [], steps: [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 1 }] },
  }],
}) as TokenDef;

/**
 * edh-d-62: the Gingerbrute token: "a {1} 1/1 colorless Food Golem artifact creature with haste, \"{1}: This token can't be blocked this turn except by creatures with haste.\" and
 * \"{2}, {T}, Sacrifice this token: You gain 3 life.\"" (Ginger, Queen of Sweets' token; Scryfall's token oracle text of Gingerbrute, CR 111.4). A token has no mana cost unless an effect
 * gives it one (CR 111.3); this one is given {1} (its mana value is 1, CR 202.3). The abilities are written as the same sentences compile ("~" is the token itself, CR 201.5).
 */
export const GINGERBRUTE_TOKEN: TokenDef = Object.freeze({
  name: 'Gingerbrute',
  types: ['Artifact', 'Creature'],
  subtypes: ['Food', 'Golem'],
  power: 1,
  toughness: 1,
  manaCost: [{ kind: 'generic', amount: 1 }],
  abilities: [
    { kind: 'keyword', keyword: 'haste', text: 'Haste' },
    {
      kind: 'activated',
      text: "{1}: ~ can't be blocked this turn except by creatures with haste.",
      cost: { mana: [{ kind: 'generic', amount: 1 }] },
      effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlockedBy', other: { not: { types: ['Creature'], keyword: 'haste' } } }] }] },
    },
    {
      kind: 'activated',
      text: '{2}, {T}, Sacrifice ~: You gain 3 life.',
      cost: { mana: [{ kind: 'generic', amount: 2 }], tap: true, other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] },
      effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }] },
    },
  ],
}) as TokenDef;

/** The named tokens by name (Heartwood is CR 111.10x since the 2026-09-25 edition, in predefined-tokens.json; the Mutavault token is not in CR 111.10). */
export const NAMED_TOKENS: Readonly<Record<string, TokenDef>> = Object.freeze({ Mutavault: MUTAVAULT_TOKEN, Tarmogoyf: TARMOGOYF_TOKEN, 'Spellgorger Weird': SPELLGORGER_WEIRD_TOKEN, Gingerbrute: GINGERBRUTE_TOKEN });

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
