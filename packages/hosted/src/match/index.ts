/**
 * Matchmaking (design 4.5; package M13-9): the contract (`api.ts`, M13-1), the unranked `FifoMatcher`, the configuration helpers, and the steps a match
 * goes through after it forms (admission request, ready check, settling a failure). The ranked matcher of milestone 15 is `RatedMatcher` in
 * `@openmtg/ladder`, with its own interface (`RankedMatcher`) beside `Matcher`.
 *
 * How the gateway (M13-6) wires it in:
 * - Build one: `new FifoMatcher({ sessionBusy, offered: offeredQueues(config), policy: matchPolicyFor(config) }, { metrics, matchable })`.
 *   `sessionBusy`: the session is seated at a table or has a start waiting for capacity (and, once the ranked queue exists, is queued there:
 *   `RatedMatcher`'s own `sessionBusy` should in turn ask `matcher.queued(session)`). `matchable`: the session has a connection.
 * - `queue`: after the deck pool accepted the deck, `enter({ session, addressKey, key, deck, enteredAt: now, recentOpponents }, now)`;
 *   `recentOpponents` are the other sessions of the session's last matched game. A refusal maps to: `inQueue`, `atTable` -> `busy`; `address` ->
 *   `limitReached`; `cooldown` -> `limitReached` with `retryAfterMs: cooldownLeftMs(session, now)`; `notOffered` -> `notYet` for a pod queue while
 *   `PODS_ENABLED` is off, else `notAllowed`. `unqueue`, and a closed or long-gone session: `leave(session)`.
 * - Every second (the timer wheel), and at once after an `enter` or `requeueFront`: `tick(now)`. For each `Match`: create the table (`source:
 *   'matched'`, the decks are checked), `admission.request(matchStartRequest(match, table, now, config.units), now)`; when admitted, start a
 *   `MatchReadyCheck(match, now)` (15 s), send `readyCheck` from `players()`, feed it `ready` (`confirm`), leaves (`leave`) and the deadline (`poll`),
 *   and on `start` call `admission.begun`; on a failed outcome call `admission.released(table, now, outcome.reason === 'timeout' ? 'readyCheck' : 'left')`
 *   (admission counts the failure) and `settleReadyCheck(matcher, outcome, now)`. A refused match, an expired capacity wait, or a player who leaves while
 *   the start waits for capacity: `requeueFront` the entries that stay.
 * - `queueStatus` (at most one per 5 s): `status(key, now)` (already rounded). A drain: `drain()` and a `queueLost` notice to each returned entry.
 *
 * M13-13 built that wiring: `MatchmakingService` (service.ts) is the gateway's `MatchService`, and `MatchAdmission` routes admission's events between the
 * matched tables and the tables layer's own (main.ts wires both).
 */
export * from './api';
export * from './fifo';
export * from './policy';
export * from './start';
export * from './service';
