/**
 * Quick match (hosted design 4.5, 12; package M13-12): the unranked matchmaking queue of a format and a table size. `QuickMatchChoice` starts a search
 * with the deck and format chosen on the screen; `Searching` is what the player sees while the server looks: the kind of game, how long it has been,
 * how many others wait (rounded by the server, never who) and its estimate, and Stop looking.
 *
 * A match found arrives as a table of source 'matched' and goes to the waiting room (Room.tsx: the ready check, the wait for room on a busy server);
 * a match whose ready check fails puts a player who had confirmed back here at the front of the queue (HostedLink.ts `matchDissolved`).
 */
import type { QueueSize } from '@openmtg/hosted/api';
import { useState, useSyncExternalStore } from 'react';
import { explainHostedError, type ExplainedHostedError } from '../errors';
import { useNow } from '../game/useNow';
import type { HostedLink } from '../HostedLink';
import { elapsedText, queueText, waitPhrase } from '../lobby/words';
import { HostedErrorBox } from '../room/HostedErrorBox';

export interface QuickMatchChoiceProps {
  /** The table sizes the chosen format allows on this server: a pod (3 or 4) is offered when it allows more than 2. */
  sizes: readonly number[];
  /** Why a search cannot start now (no deck, a deck for another format, a name the server would refuse, not connected), or null. */
  blocked: string | null;
  busy: boolean;
  find: (size: QueueSize) => void;
}

export function QuickMatchChoice({ sizes, blocked, busy, find }: QuickMatchChoiceProps) {
  const pods = sizes.some((n) => n > 2);
  const [size, setSize] = useState<QueueSize>(2);
  const chosen: QueueSize = pods ? size : 2;
  return (
    <section className="hosted-choice" aria-label="Quick match">
      <h2>Quick match</h2>
      <p className="hosted-note">
        The server finds you an opponent{pods ? ' or a pod' : ''} for the format chosen above. Everyone confirms they are ready before the game starts.
      </p>
      {pods && (
        <label className="hosted-code-field">
          Game size
          <select value={String(size)} onChange={(e) => setSize(e.target.value === 'pod' ? 'pod' : 2)}>
            <option value="2">Two players</option>
            <option value="pod">A pod of 3 or 4</option>
          </select>
        </label>
      )}
      <div className="hosted-buttons">
        <button type="button" className="button-primary" disabled={blocked !== null || busy} onClick={() => find(chosen)}>
          {busy ? 'Starting the search…' : 'Find a game'}
        </button>
      </div>
    </section>
  );
}

export function Searching({ link }: { link: HostedLink }) {
  const search = useSyncExternalStore(link.subscribe, link.searching);
  const queue = useSyncExternalStore(link.subscribe, link.queue);
  const state = useSyncExternalStore(link.subscribe, link.linkState);
  const now = useNow(search !== null, 1000);
  const [stopping, setStopping] = useState(false);
  const [problem, setProblem] = useState<ExplainedHostedError | null>(null);
  if (!search) return null;
  const status = queue?.kind === 'match' && queue.format === search.format && queue.size === search.size ? queue : null;

  const stop = async () => {
    setStopping(true);
    setProblem(null);
    const r = await link.unqueue();
    setStopping(false);
    if (!r.ok) setProblem(explainHostedError(r.error));
  };

  // The server's count holds this player too, exact up to 5 and rounded past that (match/api.ts `roundedWaiting`).
  const waiting = status?.waiting ?? null;
  return (
    <section className="hud-panel hosted-panel hosted-searching" aria-label="Looking for a game">
      <h2>Looking for a game</h2>
      <p className="hosted-status" role="status">
        {queueText(search.format, search.size)}. Searching for <span role="timer">{elapsedText(now - search.since)}</span>.
      </p>
      {status && (
        <p className="hosted-note">
          {waiting === null || waiting <= 1
            ? 'Nobody else is waiting for this kind of game right now.'
            : `${waiting > 5 ? 'About ' : ''}${waiting} players are waiting for this kind of game, you included.`}
          {status.estimatedWaitMs !== null ? ` The server expects a match in ${waitPhrase(status.estimatedWaitMs)}.` : ''}
        </p>
      )}
      <p className="hosted-note">
        Keep this page open: when a match is found you are asked to confirm that you are ready, and the game starts when everyone has.
      </p>
      {state !== 'open' && (
        <p className="hosted-error" role="alert">
          Lost the connection to the game server; trying again… Your place in the queue is kept for a short while.
        </p>
      )}
      {problem && <HostedErrorBox error={problem} />}
      <div className="hosted-buttons">
        <button type="button" onClick={() => void stop()} disabled={stopping}>
          {stopping ? 'Stopping…' : 'Stop looking'}
        </button>
      </div>
    </section>
  );
}
