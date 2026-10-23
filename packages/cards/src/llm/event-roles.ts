/**
 * The event roles of design 3.5 for the prompt's glossary (design 11.2: "op catalog (8.7), event roles (3.5), keyword list (7.4), layer table (9.2)").
 * It mirrors the engine's `model/lint-roles.ts#EVENT_ROLES` (not exported by the engine's public surface, design 5.4); a test compares the two tables,
 * so they cannot drift.
 */
export const EVENT_ROLES: Readonly<Record<string, readonly string[]>> = {
  zoneChange: ['subject', 'player'], // CR 603.6
  cast: ['spell', 'player'], // CR 601.2i
  activate: ['source', 'player', 'spell'], // CR 602.2
  attacks: ['attacker', 'defender', 'player', 'subject'], // CR 508.1; std-rx16: `subject` = the combatant the event is about (here the attacker)
  blocks: ['blocker', 'attacker', 'object', 'subject'], // CR 509.1; FAST3 T14: `object` = the other combatant (the attacker it blocks / the creature blocking it)
  becomesBlocked: ['blocker', 'attacker', 'object', 'subject'],
  attacksUnblocked: ['attacker', 'player'], // std-rx35 (CR 509.1h)
  damage: ['source', 'object', 'recipient'], // CR 120.1
  step: ['player'], // CR 603.2b
  beginTurn: ['player'],
  life: ['player'],
  draw: ['player'],
  becomes: ['subject', 'spell', 'player', 'object'], // FAST5 T59: 'object' is the damaged object's name for the same creature (model/lint-roles.ts)
  counters: ['subject', 'player'],
  action: ['player', 'subject'],
  createToken: ['player', 'newObject'],
  dieRoll: ['player'],
  coinFlip: ['player'], // cloud r3-mech, CR 705.2: the player who flipped
  state: [], // CR 603.8
  resolves: ['subject'], // CR 608.2p
  phase: ['player'], // M6-0 (engine m6 design 2.1), CR 614.10: replacement patterns only
  dayNight: [], // M6-0, CR 731.1a
  loseGame: ['player'], // M12-3, CR 603.9: the player who lost the game
  controlChange: ['subject', 'player'], // Standard round 3, r3-trig, CR 108.4: the permanent, and the player who gained control of it
  abilityTriggered: ['subject', 'spell'], // std-copy-6 (CR 603.2): the object whose triggered ability triggered, and that ability
};
