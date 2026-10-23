/**
 * The end screen's replay panel (replays design 6, 10; RPL-1), inside the game-over panel next to Rematch, New game and Home: "Watch replay", "Keep
 * replay", and, when several people sat at the screen (hot-seat), each person's "Show my cards in replays" (default off). Each person ticks their own;
 * the choices are recorded in the replay file (`reveal`), and every seat and the open view can be watched only once every person has agreed (design
 * D4). A game against the computer with one person needs no agreement (adopted answer 1), so it shows no toggle.
 *
 * It holds only the game's `LiveReplay` (live.ts), never the game: before the game is over it offers nothing to watch.
 */
import { useId, useState, useSyncExternalStore } from 'react';
import { useOptionalNav } from '../app/nav';
import { sfx } from '../audio/sfx';
import type { LiveReplay } from './live';
import { openReplay } from './openReplay';
import './replays.css';

export function EndScreenReplay({ replay }: { replay: LiveReplay }) {
  const nav = useOptionalNav();
  const state = useSyncExternalStore(replay.subscribe, replay.state);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const ids = useId();
  const saving = state.phase === 'recording' || state.phase === 'saving';

  const watch = async () => {
    if (opening) return;
    setOpening(true);
    setNotice(null);
    try {
      const file = await replay.file();
      if (!file) {
        setNotice(state.error ? `The replay could not be saved: ${state.error}` : 'This game has no replay to watch.');
        sfx('ui.error');
        return;
      }
      const opened = await openReplay(file);
      if (!opened.connection) {
        setNotice(opened.notice);
        sfx('ui.error');
        return;
      }
      nav?.go({ screen: 'game', connection: opened.connection });
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="replays-end" role="group" aria-label="Replay">
      <div className="replays-end-buttons">
        <button type="button" onClick={() => void watch()} disabled={opening || state.phase === 'failed'} aria-describedby={saving ? `${ids}-saving` : undefined}>
          Watch replay
        </button>
        <button type="button" aria-pressed={state.kept} onClick={() => replay.setKept(!state.kept)}>
          Keep replay
        </button>
      </div>
      {saving && (
        <p id={`${ids}-saving`} className="replays-end-note" role="status">
          Saving the replay…
        </p>
      )}
      {state.phase === 'failed' && (
        <p className="replays-end-note" role="alert">
          The replay could not be saved{state.error ? `: ${state.error}` : '.'}
        </p>
      )}
      {replay.asksAgreement && (
        <fieldset className="replays-end-reveal" aria-describedby={`${ids}-reveal`}>
          <legend>Show my cards in replays</legend>
          {replay.people.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={state.agreed.includes(p.id)} onChange={(e) => replay.setAgreed(p.id, e.currentTarget.checked)} />
              {p.name}: show my cards in replays
            </label>
          ))}
          <p id={`${ids}-reveal`} className="replays-end-note">
            My cards are my hand, my face-down cards and my decklist. Until everyone here ticks this, the replay shows only what the table saw.
          </p>
        </fieldset>
      )}
      {notice && (
        <p className="replays-end-note" role="alert">
          {notice}
        </p>
      )}
    </div>
  );
}
