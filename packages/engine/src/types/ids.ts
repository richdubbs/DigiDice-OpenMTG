/** Player identifier, e.g. "p1". Turn order is the order of GameState.players. */
export type PlayerId = string;
/**
 * Identifier of a game object (CR 109). A card that changes zones becomes a new
 * object with a new ObjectId (CR 400.7); `cardId` keeps the physical card identity.
 */
export type ObjectId = string;
/** Identifier of a physical card in a player's deck (stable for the whole game). */
export type CardId = string;
/** Key of a compiled card definition in GameState.defs (the Oracle name for real cards). */
export type DefId = string;
