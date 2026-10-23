/**
 * M15-3: the intake adapter (design 8.2, 13.2, D8, D10). Pure: a ledger record and its registry entry in, a `RatedGame` or an `IntakeSkip` out. The
 * service (src/service/create.ts) then stores the outcome in one atomic write: `applyGame` for a RatedGame, `markSkipped` for a skip that is stored,
 * with the registry entry's close in the same write (13.3). src/index.ts re-exports this file with `export *`.
 *
 * Nothing of the record is used beyond what a RatedGame carries: no sessions, deck fingerprints or timings ever leave this function (8.2).
 */
import { LADDERS, LOSS_CODES, seasonOf, validPlaces, type LadderId, type Place, type SeatNo } from '../api';
import type { IntakeSkip, LedgerGameRecord, LedgerPlacement, RankedStart, RatedGame, RatedSeat, SkipReason } from '../ledger';

function skip(reason: SkipReason, game: string, detail: string, closeStartAs: IntakeSkip['closeStartAs'], notRated: boolean): IntakeSkip {
  return { skip: reason, game, detail, closeStartAs, notRated };
}

const isNat = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

/**
 * What is wrong with a record's cap evidence (8.5, 13.2), or null when it is absent or well formed: the cap's kind, a verdict (void, or a driver
 * that is one of the seats with a share from 0 to 1), and one entry per distinct seat of `seats` with whole, non-negative `initiated` and `chargedMs`.
 * The service stores a cap event only from evidence that passes (a rated game's broken evidence is check 9's `malformed`; a void game's is dropped
 * with a warning, since the game is not rated anyway).
 */
export function capProblem(cap: LedgerGameRecord['cap'] | null | undefined, seats: readonly SeatNo[]): string | null {
  if (cap === undefined || cap === null) return null;
  if (typeof cap !== 'object') return 'the cap evidence is not an object';
  if (cap.kind !== 'actions' && cap.kind !== 'time') return `the cap kind ${String(cap.kind)} is not actions or time`;
  const v = cap.verdict as { kind?: unknown; seat?: unknown; share?: unknown } | null;
  if (typeof v !== 'object' || v === null) return 'the cap verdict is not an object';
  if (v.kind === 'driver') {
    if (!seats.includes(v.seat as SeatNo)) return `the cap driver ${String(v.seat)} is not a seat of the game`;
    if (typeof v.share !== 'number' || !Number.isFinite(v.share) || v.share < 0 || v.share > 1) return 'the cap driver\'s share is not from 0 to 1';
  } else if (v.kind !== 'void') return `the cap verdict ${String(v.kind)} is not void or driver`;
  if (!Array.isArray(cap.seats) || cap.seats.length === 0) return 'the cap evidence lists no seats';
  const seen = new Set<number>();
  for (const s of cap.seats) {
    if (typeof s !== 'object' || s === null || !seats.includes(s.seat) || seen.has(s.seat)) return 'the cap evidence\'s seats are not seats of the game';
    seen.add(s.seat);
    if (!isNat(s.initiated) || !isNat(s.chargedMs)) return `seat ${s.seat}'s cap counts are not whole numbers of at least 0`;
  }
  return null;
}

/** Check 9 beyond the shared-place rule: what the rest of a placement must be for the game to be rated (else 'malformed'). */
function placementProblem(p: LedgerPlacement): string | null {
  if (p.loss !== null && !(LOSS_CODES as readonly string[]).includes(p.loss)) return `seat ${p.seat}: an unknown loss code (${String(p.loss)})`;
  if (p.lossRule !== null && typeof p.lossRule !== 'string') return `seat ${p.seat}: lossRule is not text`;
  if (p.outTurn !== null && !isNat(p.outTurn)) return `seat ${p.seat}: outTurn is not a turn`;
  if (typeof p.name !== 'string') return `seat ${p.seat}: the name is not text`;
  return null;
}

/**
 * 8.2: pure; checks in the table's order (checks 1-10). The registry seat, never the ledger placement, says which account a seat is; a ledger
 * placement whose account is null while the registry seat names one is rated normally.
 *
 *  1 no entry, record not ranked           unranked      nothing stored
 *  2 no entry, record ranked               unregistered  stored (the service logs it at warn), no registry entry
 *  3 entry 'lost'                          lost          stored, the entry stays lost, the seats told
 *  4 entry applied, void or skipped        closed        nothing more (its marker exists: the service answers duplicate)
 *  5 record not ranked, entry running      mismatch      entry 'skipped', seats told
 *  6 outcome void                          void          entry 'void', seats told
 *  7 ladder, format, seat count, seats     mismatch      entry 'skipped', seats told
 *  8 a placement names another account     mismatch      entry 'skipped', seats told
 *  9 places, outcome, placement fields,    malformed     entry 'skipped', seats told
 *    turns, endedAt and the cap evidence
 * 10 the ladder no longer offered          ladderOff     entry 'skipped', seats told
 *
 * Check 8 when the registry seat's account is null (the ladder erased it while the game ran, 8.7): the placement may still name the erased account
 * until hosted's own erasure runs, so it is not compared; the seat is the deleted one either way, rated from its start snapshot.
 */
export function toRatedGame(record: LedgerGameRecord, start: RankedStart | null, offered: (l: LadderId) => boolean): RatedGame | IntakeSkip {
  const game = record.game;
  // 1-4: the registry entry decides first (D8)
  if (start === null) {
    return record.ranked
      ? skip('unregistered', game, 'a ranked record the ladder never started', null, false)
      : skip('unranked', game, 'not a ranked game', null, false);
  }
  if (start.status === 'lost') return skip('lost', game, 'the registry entry was closed as lost (8.3)', null, true);
  if (start.status !== 'running') return skip('closed', game, `the registry entry is already ${start.status}`, null, false);
  // 5, 6
  if (record.ranked !== true) return skip('mismatch', game, 'a running ranked start, and a record that is not ranked', 'skipped', true);
  if (record.outcome === 'void') return skip('void', game, `void: ${String(record.reason)}`, 'void', true);
  // 7: the ladder, the format, the seat count and the seats
  const def = LADDERS[start.ladder];
  if (record.ladder !== start.ladder) return skip('mismatch', game, `the record's ladder ${String(record.ladder)} is not ${start.ladder}`, 'skipped', true);
  if (record.format !== def.format) return skip('mismatch', game, `the format ${String(record.format)} is not ${def.format}`, 'skipped', true);
  if (!(def.seats as readonly number[]).includes(record.seats) || record.seats !== start.seats.length) {
    return skip('mismatch', game, `${String(record.seats)} seats on a ${start.seats.length}-seat start of ${start.ladder}`, 'skipped', true);
  }
  const placements = Array.isArray(record.placements) ? record.placements : [];
  const startSeats = new Map(start.seats.map((s) => [s.seat, s]));
  const seen = new Set<number>();
  for (const p of placements) {
    if (!startSeats.has(p?.seat) || seen.has(p.seat)) return skip('mismatch', game, `the placements' seats are not the start's seats`, 'skipped', true);
    seen.add(p.seat);
  }
  if (seen.size !== start.seats.length) return skip('mismatch', game, `the placements' seats are not the start's seats`, 'skipped', true);
  // 8: the registry seat is authoritative; a placement may be null (anonymised already), never another account
  for (const p of placements) {
    const registered = startSeats.get(p.seat)!.account;
    if (registered !== null && p.account !== null && p.account !== registered) {
      return skip('mismatch', game, `seat ${p.seat}'s placement names another account than its registry seat`, 'skipped', true);
    }
  }
  // 9: the places, the outcome and the placements' own fields
  const bySeat = [...placements].sort((a, b) => a.seat - b.seat);
  const places = bySeat.map((p) => p.place);
  if (!validPlaces(places)) return skip('malformed', game, `places ${places.join(', ')} break the shared-place rule`, 'skipped', true);
  const firsts = places.filter((p) => p === 1).length;
  if ((record.outcome === 'win' && firsts !== 1) || (record.outcome === 'draw' && firsts < 2) || (record.outcome !== 'win' && record.outcome !== 'draw')) {
    return skip('malformed', game, `the outcome ${String(record.outcome)} does not agree with places ${places.join(', ')}`, 'skipped', true);
  }
  for (const p of bySeat) {
    const problem = placementProblem(p);
    if (problem !== null) return skip('malformed', game, problem, 'skipped', true);
  }
  if (!isNat(record.turns)) return skip('malformed', game, 'turns is not a count', 'skipped', true);
  const capIssue = capProblem(record.cap, start.seats.map((s) => s.seat));
  if (capIssue !== null) return skip('malformed', game, capIssue, 'skipped', true);
  let season: string;
  try {
    season = seasonOf(record.endedAt);
  } catch {
    return skip('malformed', game, `endedAt is not an ISO-8601 UTC time (${String(record.endedAt)})`, 'skipped', true);
  }
  // 10
  if (!offered(start.ladder)) return skip('ladderOff', game, `${start.ladder} is no longer offered`, 'skipped', true);

  const seats: RatedSeat[] = bySeat.map((p) => ({
    seat: p.seat,
    account: startSeats.get(p.seat)!.account,
    name: p.name,
    place: p.place as Place,
    loss: p.loss,
    lossRule: p.lossRule,
    outTurn: p.outTurn,
  }));
  return {
    game,
    ladder: start.ladder,
    season,
    endedAt: record.endedAt,
    outcome: record.outcome,
    turns: record.turns,
    seats,
    cap: record.cap ? copyCap(record.cap) : null,
  };
}

/** The cap evidence with exactly its fields (nothing else hosted may add rides along into the store). Call it on evidence capProblem passed. */
export function copyCap(cap: NonNullable<LedgerGameRecord['cap']>): NonNullable<LedgerGameRecord['cap']> {
  const v = cap.verdict;
  return {
    kind: cap.kind,
    verdict: v.kind === 'driver' ? { kind: 'driver', seat: v.seat, share: v.share } : { kind: 'void' },
    seats: cap.seats.map((s) => ({ seat: s.seat, initiated: s.initiated, chargedMs: s.chargedMs })),
  };
}

/** True for a skip; false for a RatedGame. */
export function isIntakeSkip(x: RatedGame | IntakeSkip): x is IntakeSkip {
  return 'skip' in x;
}
