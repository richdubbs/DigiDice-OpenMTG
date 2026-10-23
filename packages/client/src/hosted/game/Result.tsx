/**
 * The end of a game on the DigiDice server (hosted design 4.4, 7): the server's result with the public placements: who won, each player's place and how they
 * lost. A game with no winner says why (a draw, or "ended without a result": nobody stayed connected, the server's own limits). The game screen's own end
 * panel (GameOver) is the engine's result; this adds what only the server knows: time-outs, leavers and the finishing order. Never the session, deck or
 * timing details of anyone (design 7: they stay on the server).
 */
import { useSyncExternalStore } from 'react';
import type { HostedLink } from '../HostedLink';
import { outcomeHeadline, placementLine } from './notices';

export function HostedResult({ link }: { link: HostedLink }) {
  const result = useSyncExternalStore(link.subscribe, link.result);
  if (!result) return null;
  const mine = link.seat();
  const rows = [...result.placements].sort((a, b) => a.place - b.place || a.seat - b.seat);
  return (
    <section className="hosted-result" aria-label="Result" data-outcome={result.outcome}>
      <h2>{outcomeHeadline(result.outcome, result.placements, mine)}</h2>
      {result.outcome === 'void' && <p className="hosted-note">{result.reason}</p>}
      {rows.length > 0 && (
        <ol className="hosted-placements" aria-label="Final standings">
          {rows.map((p) => (
            <li key={p.seat} data-you={p.seat === mine || undefined}>
              {placementLine(p, mine)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
