/** @openmtg/net public API (Node only): online play over UDP, two players (docs/design/online.md) and 3-4 (M12-5a, docs/design/m12-multiplayer.md 6). */
export { NetError, type NetErrorCode } from './errors';
export { generateJoinCode, normalizeJoinCode, formatJoinCode, weakJoinCode, JOIN_CODE_LENGTH } from './wire/codes';
export { MAX_DATAGRAM } from './wire/packet';
export { FRAGMENT_BYTES } from './wire/frame';
export { Channel, DEFAULT_LINK_OPTIONS, type ChannelHooks, type ChannelStats, type LinkOptions } from './link/channel';
export { Connection, type ConnectionStats, type Remote } from './link/connection';
export { HostEndpoint, connect, DEFAULT_PORT, BYE_GRACE_MS, DEFAULT_HOST_LIMITS, type EndpointOptions, type EndpointStats, type HostLimits } from './link/endpoint';
export { MemoryTransport, memoryPair } from './link/memory';
export { FaultInjector, type FaultConfig, type FaultStats, type Scheduler } from './link/faults';
export {
  PROTOCOL_VERSION, LIMITS, parseGuestMessage, parseHostMessage, checkAction, checkDeckSubmission,
  type DeckEntry, type DeckSubmission, type Versions, type NetMessage, type GuestMessage, type HostMessage,
  type HelloMessage, type WelcomeMessage, type ActionMessage, type ViewMessage, type AckMessage, type ErrorMessage, type ChatMessage, type ByeMessage, type SyncMessage,
  // M12-5a: protocol 4 (3-4 player games)
  type GuestToHostMessage, type SeatPlayer, type LobbyMessage, type StartMessage, type PresencePlayer, type PresenceMessage, type NoticeKind, type NoticeMessage,
  type ManualProposalMessage, type ManualOutcome, type ManualClosedMessage, type ManualVoteMessage,
  // RPL-3: protocol 5 (replays of online games)
  REPLAY_GAME_MAX_BYTES, REPLAY_GAME_MAX_TEXT, isReplayGameData, type ReplayConsentMessage, type ReplayGameMessage,
} from './protocol/messages';
export {
  ONLINE_RECORD_VERSION, REPLAY_ID, newReplayId, endingOf, OnlineRecord, revealOf, onlineReplayFile, encodeReplayGame,
  type OnlineRecordStart, type OnlineRecordAction, type OnlineRecordEnd, type OnlineRecordData,
} from './game/record';
export { cleanText, printable } from './protocol/text';
export { jsonTextDepth, measureJson, type JsonBounds } from './protocol/bounded';
export { localVersions, compareVersions, localEngineBuild } from './protocol/versions';
// The default deck validator (milestone 7's validateDeck, adapted in game/deck.ts) stays internal; pass `validate` to GameHost for another one.
export { prepareDeck, deckFromText, commanderVariantOf, type CardSource, type DeckValidator, type DeckProblems, type PreparedDeck, type ResolvedDeck } from './game/deck';
export { eventsFor, UNSEEN_ID, type EventsForOptions } from './game/redact';
export {
  GameHost, gameConfigFor, tableConfigFor, HOST_PLAYER, GUEST_PLAYER, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH, FORFEIT_AFTER_MS,
  type HostOptions, type HostTransport, type ActResult, type ManualProposal, type SeatCode, type HostPlayerStatus, type TablePlayer,
} from './game/host';
export { ManualVotes, describeProposal, type VoteResult } from './game/manual';
export { playerOfSeat, seatOfPlayer, seatAtRandom } from './game/seating';
export { DEFAULT_GUEST_LIMITS, type GuestLimits } from './game/limits';
export { GameGuest, type GuestOptions, type GuestActResult, type GuestTablePlayer, type GuestManualProposal } from './game/guest';
export { autoAction, autoAnswer } from './game/autoplay';
