/**
 * The results ledger (design 7; package M13-7): loss codes from the engine's `playerLost.rules` and the table's causes, placements with shared places
 * and draws, the `GameRecord` of a game's end, the append-only write through `GameStore`, the public projection and match-history readers, deck
 * fingerprints of prepared decks. The contract types are in types.ts (M13-1).
 */
export * from './losses';
export * from './placements';
export * from './record';
export * from './writer';
export * from './history';
export * from './fingerprint';
