/**
 * The turn structure (CR 500.1): every step of the turn, the current one lit, and the viewer's stops (Arena-style auto-pass settings, `StopSettings`): one
 * row of toggles for the viewer's own turns and one for the opponents' turns, under the steps. It sits in the side rail just above the prompt (like
 * Arena's phase lights by its Pass button). Clicking a stop toggles it through a `setStops` action (sent by the caller). No stop is offered for the untap
 * and cleanup steps, where nobody normally receives priority (CR 502.4, 514.3).
 *
 * `CenterLine` is the band across the middle of the table: whose turn it is and the current step, large.
 */
import type { PlayerState, Step, StopSettings } from '@openmtg/engine';
import { useBoard } from './context';
import { NO_PRIORITY_STEPS, STEP_LABELS, STEP_SHORT, STEPS, playerName } from './model';
import type { SetStopsAction } from './types';

type Side = 'ownTurn' | 'opponentTurn';

/** The stops with `step` toggled on one side (pure; exported for the prompts and settings screens). */
export function toggleStop(stops: StopSettings, side: Side, step: Step): StopSettings {
  const has = stops[side].includes(step);
  const next = has ? stops[side].filter((s) => s !== step) : STEPS.filter((s) => s === step || stops[side].includes(s));
  return { ...stops, [side]: next };
}

export function setStopsAction(player: PlayerState, side: Side, step: Step): SetStopsAction {
  return { type: 'setStops', player: player.id, stops: toggleStop(player.stops, side, step) };
}

function StopRow({ me, side, label, short }: { me: PlayerState; side: Side; label: string; short: string }) {
  const { interaction } = useBoard();
  const send = interaction.onSetStops;
  return (
    <div className={`stop-row stop-row-${side === 'ownTurn' ? 'own' : 'opp'}`} role="group" aria-label={`Stops: ${label}`}>
      <span className="stop-label" title={label}>
        {short}
      </span>
      {STEPS.map((step) => {
        if (NO_PRIORITY_STEPS.includes(step)) return <span key={step} className="stop-cell" />;
        const on = me.stops.fullControl || me.stops[side].includes(step);
        const name = `Stop at ${STEP_LABELS[step]} (${label.toLowerCase()})`;
        return (
          <span key={step} className="stop-cell">
            <button
              type="button"
              className={`stop-toggle${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={name}
              title={me.stops.fullControl ? 'Full control: you stop at every step' : name}
              disabled={!send || me.stops.fullControl}
              onClick={() => send?.(setStopsAction(me, side, step))}
            />
          </span>
        );
      })}
    </div>
  );
}

export function PhaseBar() {
  const { view } = useBoard();
  // CR 103.1: turn 0 is the start of the game (play order, mulligans): no player's turn and no step yet.
  const started = view.turn.number > 0;
  const current = started ? view.turn.step : null;
  const me = view.players.find((p) => p.id === view.viewer) ?? null;
  const myTurn = started && me !== null && view.turn.activePlayer === me.id;
  return (
    <section className={`phase-bar${myTurn ? ' is-my-turn' : ''}`} aria-label="Turn structure">
      <div className="phase-head">
        <span className="phase-turn">
          {started ? `Turn ${view.turn.number}: ${playerName(view, view.turn.activePlayer)}${view.turn.extra ? ' (extra turn)' : ''}` : 'Start of the game'}
        </span>
        {me && <FullControl me={me} />}
      </div>
      <div className="phase-row">
        <span className="stop-label" aria-hidden="true" />
        <ol className="phase-steps">
          {STEPS.map((step) => (
            <li key={step} className={`phase-step${step === current ? ' is-current' : ''}`} aria-current={step === current ? 'step' : undefined} data-step={step} title={STEP_LABELS[step]}>
              <span className="step-long">{STEP_LABELS[step]}</span>
              <span className="step-short" aria-hidden="true">
                {STEP_SHORT[step]}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {me && (
        <>
          <StopRow me={me} side="ownTurn" label="My turn" short="Me" />
          {/* M12-4a (C19): one row for every opponent's turn (the engine's stops are per side: own turn, another player's turn) */}
          <StopRow me={me} side="opponentTurn" label={view.players.length > 2 ? "Opponents' turns" : "Opponent's turn"} short="Op" />
        </>
      )}
    </section>
  );
}

function FullControl({ me }: { me: PlayerState }) {
  const { interaction } = useBoard();
  const send = interaction.onSetStops;
  const on = me.stops.fullControl;
  return (
    <label className="full-control" title="Full control: never pass priority automatically (CR 117.3)">
      <input
        type="checkbox"
        checked={on}
        disabled={!send}
        onChange={() => send?.({ type: 'setStops', player: me.id, stops: { ...me.stops, fullControl: !on } })}
      />
      Full control
    </label>
  );
}

/** The band across the middle of the table: the turn and the current step (CR 500.1), lit in the active player's colour. */
export function CenterLine() {
  const { view } = useBoard();
  const started = view.turn.number > 0;
  const mine = started && view.turn.activePlayer === view.viewer;
  return (
    <div className={`center-line${mine ? ' is-mine' : started ? ' is-theirs' : ''}`} aria-hidden="true">
      <span className="center-turn">{started ? `Turn ${view.turn.number}` : 'Game start'}</span>
      <span className="center-step">{started ? STEP_LABELS[view.turn.step] : 'Mulligans'}</span>
      <span className="center-player">{started ? (mine ? 'Your turn' : `${playerName(view, view.turn.activePlayer)}'s turn`) : ''}</span>
    </div>
  );
}
