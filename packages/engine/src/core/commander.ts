/**
 * M11-0 (docs/design/m11-commander.md 4.1, 4.6): the Commander variants as data, and the table of Commander capability names the engine runs.
 *
 * Owner: M11-0 writes this file; M11-1 (engine rules) owns it afterwards and adds its names to `COMMANDER_FEATURES` in the commit whose tests show them
 * working (the M6 pattern: a capability exists because its table entry exists). The pure readers of the Commander state are in statics/commander.ts.
 */
import type { CommanderOptions, CommanderVariant } from '../types/state';

/**
 * Each variant's starting life and rules (CR 903.7, 103.4c: Commander 40; CR 903.12f, 103.4d: two-player Brawl 25; Duel Commander 20, its own rules, as
 * packages/cards/src/formats/formats.ts has it). Commander damage (CR 903.10a, 704.6c) is 21 except in Brawl (CR 903.12h). The first mulligan is free in
 * Brawl (CR 903.12g); a two-player Commander game has no free mulligan (CR 103.5c names multiplayer games only). The tax is {2} (CR 903.8).
 * Duel Commander (m11 design 9 Q1): its own format rules, as MTGO plays it: 20 life, NO commander damage loss (the 21 rule of
 * CR 903.10a, 704.6c is not used, as in Brawl, CR 903.12h) and the normal mulligan.
 *
 * M12-1 (m12 design 4.2): `multiplayerLife`, the starting life in a game that begins with 3-4 players (`options.multiplayer`):
 * Commander 40 (CR 903.7), Brawl and Standard Brawl 30 (CR 903.12f: a multiplayer Brawl game starts at 30); null for Duel Commander, a two-player format only
 * (core/create.ts refuses it with `multiplayer`).
 */
export const COMMANDER_VARIANTS: Readonly<Record<CommanderVariant, { name: string; startingLife: number; multiplayerLife: number | null; options: CommanderOptions }>> = {
  commander: { name: 'Commander', startingLife: 40, multiplayerLife: 40, options: { variant: 'commander', damageLimit: 21, tax: 2, freeMulligan: false } },
  duel: { name: 'Duel Commander', startingLife: 20, multiplayerLife: null, options: { variant: 'duel', damageLimit: null, tax: 2, freeMulligan: false } },
  brawl: { name: 'Brawl', startingLife: 25, multiplayerLife: 30, options: { variant: 'brawl', damageLimit: null, tax: 2, freeMulligan: true } },
  standardbrawl: { name: 'Standard Brawl', startingLife: 25, multiplayerLife: 30, options: { variant: 'standardbrawl', damageLimit: null, tax: 2, freeMulligan: true } },
};

/** The rules of a variant (a fresh record), for `GameConfig.options.commander`. */
export const commanderOptions = (variant: CommanderVariant): CommanderOptions => ({ ...COMMANDER_VARIANTS[variant].options });

/**
 * The `feature:` capability names of milestone 11 that this engine build runs (model/capabilities.ts adds them). M11-1 lists them with its tests
 * (test/m11/rules/*):
 *   'mana.commanderIdentity'  an addMana of "any color in your commander's color identity" (CR 903.4, 903.4f, 702.124c): the addMana handler
 *                             (effects/handlers/cards-mana.ts) and the payment solver (rules/mana.ts#computedManaUnits) read statics/commander.ts;
 *   'zone.command'            an ability of a card that functions in the command zone (eminence, CR 113.6; commander ninjutsu, CR 702.49d): triggers are
 *                             collected there (triggers/collect.ts), static abilities apply from there (statics/live.ts, statics/rule-sources.ts), and
 *                             activated abilities are listed and activated from there (core/legal.ts, actions/activate.ts).
 */
export const COMMANDER_FEATURES: readonly string[] = ['mana.commanderIdentity', 'zone.command'];

/**
 * CMDF: the `static:` kinds of Commander cards this engine build handles. `deckConstruction` ("~ can be your commander", CR 903.3a) modifies the rules for deck
 * construction and functions before the game begins (CR 113.6n): it has no effect in a game, so nothing reads it here; packages/cards checks it while it
 * validates a deck (formats/commander.ts#canBeCommander). Registered so the ability no longer keeps its card manual.
 */
export const COMMANDER_STATIC_KINDS: readonly string[] = ['deckConstruction'];
