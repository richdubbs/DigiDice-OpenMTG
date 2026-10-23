/** Errors of the online layer, with a code a UI can switch on. */
export type NetErrorCode =
  | 'badCode' // the join code is malformed or does not match the host's
  | 'hostNotFound' // the host name does not resolve to an address
  | 'timeout' // no answer from the host
  | 'version' // protocol or engine versions differ
  | 'rulesPack' // rules packs differ and the host requires the same one
  | 'deckRejected' // the decklist could not be resolved or is not legal in the format
  | 'gameFull' // the seat is taken (two players: the host has its guest; 3-4 players, M12-5a: each code admits one guest, then only its session)
  | 'notStarted' // no game yet
  | 'notYourPlayer' // an action for a player this connection does not control
  | 'illegalAction' // the engine rejected the action (CR 733)
  | 'stale' // the action was chosen from an older view (the game moved on since): look at the latest view and choose again
  | 'manualRejected' // the manual adjustments were not accepted (two players: by the host; 3-4, M12-5a: by another player) or were withdrawn
  | 'engineError' // the engine failed on the action (a bug); the game state is unchanged
  | 'badMessage' // a malformed message
  | 'rateLimited' // too many messages, join attempts or connections in a short time; a connection that keeps it up is closed
  | 'protocol' // the other side broke the protocol
  | 'disconnected' // the link dropped
  | 'closed'; // the game was closed

export class NetError extends Error {
  constructor(readonly code: NetErrorCode, message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'NetError';
  }
}
