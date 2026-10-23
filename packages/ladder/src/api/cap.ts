/**
 * M15-2: the cap rule, m13's open item 5.5 decided (design 8.5, D11, 13.1). Browser-safe: no `node:` imports, here or in anything this file imports.
 * Exposed only through the named re-export in ../api.ts. The hosted table calls capVerdict at a ranked game's per-game cap (13.8).
 * Imports: values only from ./constants or files of this part's own; from ../api types only (`import type`). ../api re-exports this file, so a value
 * taken from ../api would be undefined while the contract loads (a cycle; test/m15-1/load.test.ts refuses one).
 *
 * In a ranked game that reaches the action cap or the time cap, a seat that clearly drove it there loses (loss code `limit`, CR 104.3a); otherwise
 * the game is void as in m13. Each cap is judged by its own measure only, never combined: at the action cap the actions each seat INITIATED (never
 * passes or answers), at the time cap the decision time each seat CAUSED (its own, plus others' answers to its objects up to the free delay). So a
 * forced-answer flood cannot make the answering seat the driver, and an honest long game is never given to anyone.
 */
import type { CapKind, CapSeat, CapVerdict, SeatNo } from '../api';

function checkSeats(n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`cap: the seats in the game must be a whole number of at least 1 (${String(n)})`);
  return n;
}

/** The least share of a driver: 1/n + 0.25 for n seats still in the game (1v1 0.75; 3 players 0.583; 4 players 0.5). */
export function capShareThreshold(seatsInGame: number): number {
  return 1 / checkSeats(seatsInGame) + 0.25;
}

/**
 * 8.5: by the cap's own measure only (`initiated` at the action cap, `chargedMs` at the time cap). A total of 0, or a tie for the largest share, is void.
 *   total = Σ m;  share_i = m_i / total;  top = the largest share;  threshold = 1/n + 0.25 (n = inGame.length, the seats still in)
 *   two or more seats share the top → void;  top ≥ threshold (inclusive) → that seat is the driver;  otherwise → void
 * The comparisons are made on the measures themselves (m_top · 4n ≥ total · (n + 4), equal measures for a tie), so "inclusive" is exact: 7/12 in
 * a 3-player pod is a driver although 7/12 and 1/3 + 0.25 differ in the last bit as doubles. `share` is m_top / total. An empty game is void.
 * Throws a RangeError on an unknown cap, a seat number outside 1-4 or repeated, or a measure that is not a finite number of at least 0.
 */
export function capVerdict(cap: CapKind, inGame: readonly CapSeat[]): CapVerdict {
  if (cap !== 'actions' && cap !== 'time') throw new RangeError(`cap: unknown cap (${String(cap)})`);
  const seen = new Set<SeatNo>();
  const measures = inGame.map((s, i) => {
    if (![1, 2, 3, 4].includes(s.seat) || seen.has(s.seat)) throw new RangeError(`cap: inGame[${i}].seat must be a seat 1-4, once (${String(s.seat)})`);
    seen.add(s.seat);
    const m = cap === 'actions' ? s.initiated : s.chargedMs;
    if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) {
      throw new RangeError(`cap: inGame[${i}].${cap === 'actions' ? 'initiated' : 'chargedMs'} must be a finite number of at least 0 (${String(m)})`);
    }
    return m;
  });
  const n = inGame.length;
  const total = measures.reduce((a, b) => a + b, 0);
  if (n === 0 || total === 0) return { kind: 'void' };
  const top = Math.max(...measures);
  const leaders = measures.flatMap((m, i) => (m === top ? [i] : []));
  if (leaders.length > 1) return { kind: 'void' };
  if (top * 4 * n < total * (n + 4)) return { kind: 'void' };
  return { kind: 'driver', seat: inGame[leaders[0]!]!.seat, share: top / total };
}
