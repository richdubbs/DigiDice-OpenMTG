/**
 * RPL-2 (replays design 9): what a replay shows in the prompt's place. In the rail, read-only: what is being decided, as the perspective's view shows it
 * (another player's decision stays "Waiting for Bob", as the engine's view redacts it, CR 400.2), the caption of the change just shown ("Bob blocks:
 * ..."), the perspective picker (the seats, Public and All cards that the reveal policy allows; absent on a recording), the status ("Exact", "Checked on
 * this version", "Recording from turn 9", "Watching up to turn 9") with its explanation, and the sound toggle of the fast speeds. On the table, in the
 * board's slot for the prompt's action buttons, the replay bar (ReplayBar.tsx). The replay's keys (useReplayKeys.ts) work while it is on screen.
 *
 * RPL-4 (replays design 5.2: a difference under the same build is an engine bug and offers a bug report): "Report this bug" under the notice, when the
 * game screen offers it (`onReportBug`).
 */
import { useContext, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { ActionError, GameView } from '@openmtg/engine';
import { PromptSlotsContext } from '../../board/context';
import type { GameConnection } from '../../connection/GameConnection';
import type { ReplayController } from '../../connection/ReplayConnection';
import { useGameView } from '../../connection/useGame';
import { playerName, resultHeadline } from '../../game/labels';
import { perspectiveKey, perspectiveLabel, samePerspective } from './policy';
import { ReplayBar } from './ReplayBar';
import { useReplayKeys } from './useReplayKeys';
import './replay.css';

/** The decision on screen, read-only: the deciding player's own prompt when the perspective sees it, else who is deciding (design 9, "The prompt"). */
export function readOnlyPrompt(view: GameView): string | null {
  if (view.result) return `The game is over. ${resultHeadline(view, view.result)}: ${view.result.reason}`;
  const d = view.pending;
  if (!d) return null;
  const sees = view.open === true || (view.viewer !== null && d.player === view.viewer);
  return sees ? `${playerName(view, d.player)}: ${d.prompt}` : `Waiting for ${playerName(view, d.player)}.`;
}

function PerspectivePicker({ controller }: { controller: ReplayController }) {
  const s = useSyncExternalStore(controller.subscribe, controller.state);
  const [error, setError] = useState<ActionError | null>(null);
  if (s.perspectives.length === 0) return null;
  const current = perspectiveKey(s.perspective);
  const listed = s.perspectives.some((p) => samePerspective(p, s.perspective));
  return (
    <div className="replay-perspective">
      <label>
        <span>Whose view</span>
        <select
          value={current}
          disabled={s.perspectiveFixed || !s.playable}
          title={s.perspectiveFixed ? 'The recording shows only its own view.' : 'Whose cards the replay shows'}
          onChange={(e) => {
            const p = s.perspectives.find((x) => perspectiveKey(x) === e.target.value);
            if (!p) return;
            const r = controller.setPerspective(p);
            setError(r.ok ? null : r.error);
          }}
        >
          {!listed && <option value={current}>{perspectiveLabel(s.perspective, s.players)}</option>}
          {s.perspectives.map((p) => (
            <option key={perspectiveKey(p)} value={perspectiveKey(p)}>
              {perspectiveLabel(p, s.players)}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="replay-error" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}

export interface ReplayPromptProps {
  /** The game screen's paced connection: the view on screen. */
  connection: GameConnection;
  controller: ReplayController;
  /** Esc: leave the replay. */
  onLeave: () => void;
  /** RPL-4 (optional): the replay plays differently on the build it was made on, an engine bug: "Report this bug" opens the bug report dialog. */
  onReportBug?: () => void;
}

export function ReplayPrompt({ connection, controller, onLeave, onReportBug }: ReplayPromptProps) {
  const view = useGameView(connection);
  const s = useSyncExternalStore(controller.subscribe, controller.state);
  const slots = useContext(PromptSlotsContext);
  useReplayKeys(controller, onLeave);
  const text = readOnlyPrompt(view);
  const bar = <ReplayBar controller={controller} />;
  return (
    <section className="replay-prompt" aria-label="Replay" data-badge={s.badge}>
      <div className="replay-live" aria-live="polite" aria-atomic="true">
        {text !== null && <p className="replay-text">{text}</p>}
      </div>
      {s.caption !== null && <p className="replay-caption">{s.caption}</p>}
      <PerspectivePicker controller={controller} />
      <div className="replay-state">
        <p className="replay-status" data-badge={s.badge}>
          {s.statusText}
        </p>
        {s.notice !== null && (
          <p className="replay-notice" role="note">
            {s.notice}
          </p>
        )}
        {onReportBug && (
          <button type="button" className="button-link" onClick={onReportBug}>
            Report this bug
          </button>
        )}
        <label className="replay-mute">
          <input type="checkbox" checked={s.muteFast} onChange={(e) => controller.setMuteFast(e.target.checked)} />
          <span>Mute sound above 4×</span>
        </label>
      </div>
      {slots?.actions ? createPortal(bar, slots.actions) : bar}
    </section>
  );
}

/** Instead of the table while a replay of another build is checked (design 5.3, with its progress), or when it cannot be watched here at all. */
export function ReplayCover({ controller, onLeave }: { controller: ReplayController; onLeave: () => void }) {
  const s = useSyncExternalStore(controller.subscribe, controller.state);
  useReplayKeys(controller, onLeave);
  const checking = s.badge === 'checking';
  return (
    <div className="replay-cover">
      <div className="replay-cover-panel" role="status" aria-live="polite">
        <h2>{checking ? 'Checking this replay' : 'This replay cannot be watched here'}</h2>
        {s.notice !== null && <p>{s.notice}</p>}
        {checking && <progress max={100} value={Math.round((s.progress ?? 0) * 100)} aria-label="Checking the replay" />}
        <button type="button" onClick={onLeave}>
          Leave the replay
        </button>
      </div>
    </div>
  );
}
