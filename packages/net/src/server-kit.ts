/**
 * `@openmtg/net/server-kit`: milestone 9's pure, audited pieces for the hosted game server (packages/hosted, milestone 13; docs/design/m13-hosted-server.md
 * 2.5-2.6). Re-exports only: no code of its own. The hosted server has no host player and no UDP link, so it does not use `GameHost`, `GameGuest` or
 * `link/*`'s channel; it reuses the validators, the flood gate and token buckets, deck preparation, event redaction, the manual-change descriptions and
 * the `setStops` rule, which carry the 2026-10-12 audit's fixes.
 *
 * OWNERSHIP EXCEPTION (named in both designs: m13-hosted-server.md 2.6, m12-multiplayer.md section 9): this file and its `exports` line belong to M13-1,
 * although it sits inside M12-5a's `packages/net/src/**`. M12-5a may rewrite the re-exported modules (`game/manual.ts`, `game/limits.ts`, ...) but keeps
 * the names and signatures below, which `packages/hosted/test/m13-1/server-kit.types.test.ts` pins; a change updates this file and that test in the same
 * commit and says so in its report.
 */

// protocol: shape checks, bounds and text (audit C4, M3, M4)
export { LIMITS, checkAction, checkDeckSubmission, type DeckEntry, type DeckSubmission, type GuestMessage } from './protocol/messages';
export { jsonTextDepth, measureJson, type JsonBounds } from './protocol/bounded';
export { cleanText, hasControl, printable } from './protocol/text';

// flood control (audit M4, M5, m6, m7)
export { GuestGate, DEFAULT_GUEST_LIMITS, type GuestLimits, type GateHandlers } from './game/limits';
export { TokenBucket, KeyedLimiter, type RateConfig } from './link/ratelimit';

// decks (milestone 7's validateDeck; M11-3's commander variants)
export { prepareDeck, commanderVariantOf, type CardSource, type DeckValidator, type DeckProblems, type PreparedDeck, type PrepareResult, type ResolvedDeck } from './game/deck';

// hidden information in events (CR 400.2)
// NETFIX1/2: eventsFor takes the previous state (opts.before) and blanks hidden hand ids to UNSEEN_ID; RPL-0 moved both to the engine (a null viewer is
// the open view: the hosted server always passes a seat)
export { eventsFor, hiddenActionInProgress, UNSEEN_ID, type EventsForOptions } from './game/redact';

// by-hand changes (CR 400.2: described as each approver may know the game)
export { needsConsent, describeOps, unaliasOps } from './game/manual';

// setStops (audit M4)
export { stopsVerdict } from './game/stops';

// invite codes (80 random bits, Crockford base32)
export { generateJoinCode, normalizeJoinCode, formatJoinCode, weakJoinCode, JOIN_CODE_LENGTH } from './wire/codes';
